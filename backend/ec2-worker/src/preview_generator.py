"""
Preview Generation Module
高解像度プレビュー画像生成（全ページ対応）

対応フォーマット:
- PDF: ネイティブサポート
- 画像: jpg, jpeg, png, gif, bmp, tiff, tif
- Office: doc, docx, xls, xlsx, ppt, pptx, odt, ods, odp (LibreOffice経由)
- DocuWorks: xdw, xbd (別途変換サービス必要)
"""

import logging
import io
import os
import shutil
from typing import Optional, List, Dict, Tuple
from pathlib import Path
from PIL import Image
from pdf2image import convert_from_path
from dataclasses import dataclass

from office_converter import OfficeConverter

logger = logging.getLogger(__name__)


@dataclass
class PreviewConfig:
    """プレビュー設定"""
    dpi: int = 150                    # 解像度（150-200推奨）
    max_width: int = 1240             # 最大幅（A4横幅相当）
    max_height: int = 1754            # 最大高さ（A4縦幅相当）
    quality: int = 85                 # JPEG品質
    format: str = 'JPEG'              # 出力形式
    max_pages: int = 50               # 最大ページ数
    max_file_size_mb: int = 2         # 1ページあたりの最大サイズ(MB)


class PreviewGenerator:
    """高解像度プレビュー生成クラス"""

    def __init__(self, config: Optional[PreviewConfig] = None):
        """初期化"""
        self.config = config or PreviewConfig()
        self.office_converter = OfficeConverter()
        logger.info(f"PreviewGenerator initialized with DPI={self.config.dpi}, "
                   f"max_size={self.config.max_width}x{self.config.max_height}")
        if self.office_converter.is_available():
            logger.info("LibreOffice is available for Office file conversion")

    def generate_previews(
        self,
        file_path: str,
        s3_client=None,
        s3_bucket: str = None,
        converted_pdf_prefix: str = 'converted-pdf/'
    ) -> List[Dict]:
        """
        ファイルから全ページのプレビュー画像を生成

        Args:
            file_path: ファイルパス
            s3_client: S3クライアント（DocuWorks用、オプション）
            s3_bucket: S3バケット名（DocuWorks用、オプション）
            converted_pdf_prefix: 変換済みPDFのS3プレフィックス

        Returns:
            プレビュー画像のリスト [{'page': 1, 'data': bytes, 'width': int, 'height': int}, ...]
        """
        file_path = Path(file_path)
        file_type = file_path.suffix.lower()

        try:
            if file_type == '.pdf':
                return self._generate_from_pdf(file_path)

            elif file_type in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif']:
                return self._generate_from_image(file_path)

            elif file_type in OfficeConverter.SUPPORTED_EXTENSIONS:
                return self._generate_from_office(file_path)

            elif file_type in ['.xdw', '.xbd']:
                # DocuWorksは別途Windows EC2での変換が必要
                logger.info(f"DocuWorks preview requires Windows EC2 conversion: {file_path}")
                return self._generate_from_docuworks(
                    file_path,
                    s3_client=s3_client,
                    s3_bucket=s3_bucket,
                    converted_pdf_prefix=converted_pdf_prefix
                )

            else:
                logger.debug(f"Preview not supported for file type: {file_type}")
                return []

        except Exception as e:
            logger.error(f"Preview generation failed for {file_path}: {str(e)}")
            return []

    def _generate_from_pdf(self, file_path: Path) -> List[Dict]:
        """PDFから全ページのプレビュー画像を生成"""
        previews = []
        
        try:
            logger.info(f"Generating PDF previews: {file_path}")

            # まずページ数を確認
            from PyPDF2 import PdfReader
            try:
                reader = PdfReader(str(file_path))
                total_pages = len(reader.pages)
                logger.info(f"PDF has {total_pages} pages")
            except Exception as e:
                logger.warning(f"Could not read PDF page count: {e}")
                total_pages = self.config.max_pages

            # 最大ページ数を制限
            pages_to_process = min(total_pages, self.config.max_pages)

            # PDFを画像に変換（全ページ）
            images = convert_from_path(
                file_path,
                dpi=self.config.dpi,
                first_page=1,
                last_page=pages_to_process,
                fmt='jpeg',
                thread_count=2
            )

            for page_num, image in enumerate(images, 1):
                try:
                    preview_data = self._process_image(image)
                    if preview_data:
                        previews.append({
                            'page': page_num,
                            'data': preview_data['data'],
                            'width': preview_data['width'],
                            'height': preview_data['height'],
                            'size': len(preview_data['data'])
                        })
                        logger.debug(f"Generated preview for page {page_num}/{pages_to_process}")
                except Exception as e:
                    logger.error(f"Failed to process page {page_num}: {e}")

            logger.info(f"Generated {len(previews)} preview images from PDF")
            return previews

        except Exception as e:
            logger.error(f"PDF preview generation failed: {str(e)}")
            return []

    def _generate_from_image(self, file_path: Path) -> List[Dict]:
        """画像ファイルからプレビュー生成（1ページとして扱う）"""
        try:
            logger.info(f"Generating image preview: {file_path}")

            with Image.open(file_path) as image:
                # EXIF情報に基づいて回転を修正
                image = self._fix_orientation(image)

                preview_data = self._process_image(image)
                if preview_data:
                    return [{
                        'page': 1,
                        'data': preview_data['data'],
                        'width': preview_data['width'],
                        'height': preview_data['height'],
                        'size': len(preview_data['data'])
                    }]

            return []

        except Exception as e:
            logger.error(f"Image preview generation failed: {str(e)}")
            return []

    def _generate_from_office(self, file_path: Path) -> List[Dict]:
        """
        Office文書からプレビュー生成

        LibreOfficeを使用してPDFに変換後、既存のPDF処理を再利用
        """
        try:
            logger.info(f"Generating Office preview: {file_path}")

            # LibreOfficeが利用可能かチェック
            if not self.office_converter.is_available():
                logger.error("LibreOffice is not available. Cannot generate Office preview.")
                return []

            # Office → PDF 変換
            pdf_path = self.office_converter.convert_to_pdf(str(file_path))

            if not pdf_path:
                logger.error(f"Failed to convert Office file to PDF: {file_path}")
                return []

            try:
                # PDF → プレビュー画像（既存メソッドを再利用）
                previews = self._generate_from_pdf(Path(pdf_path))
                logger.info(f"Generated {len(previews)} preview images from Office file")
                return previews
            finally:
                # 中間PDFファイルをクリーンアップ
                try:
                    if pdf_path and os.path.exists(pdf_path):
                        os.remove(pdf_path)
                        # 親ディレクトリが一時ディレクトリの場合は削除
                        parent_dir = os.path.dirname(pdf_path)
                        if parent_dir and 'office_convert_' in parent_dir:
                            shutil.rmtree(parent_dir, ignore_errors=True)
                except Exception as cleanup_error:
                    logger.warning(f"Failed to cleanup temp PDF: {cleanup_error}")

        except Exception as e:
            logger.error(f"Office preview generation failed: {str(e)}")
            return []

    def _generate_from_docuworks(
        self,
        file_path: Path,
        s3_client=None,
        s3_bucket: str = None,
        converted_pdf_prefix: str = 'converted-pdf/'
    ) -> List[Dict]:
        """
        DocuWorksファイルからプレビュー生成

        注意: DocuWorks SDKはWindows専用のため、
        ファイルスキャンPCで変換されたPDFをS3経由で取得します。

        検索パス:
        1. ローカルの同じディレクトリ
        2. S3の docuworks-converted/ フォルダ（ファイル名部分一致）
        3. S3の converted-pdf/ フォルダ（従来の方法）

        Args:
            file_path: DocuWorksファイルパス
            s3_client: S3クライアント（オプション、S3から変換済みPDFを取得する場合）
            s3_bucket: S3バケット名（オプション）
            converted_pdf_prefix: 変換済みPDFのS3プレフィックス

        Returns:
            プレビュー画像のリスト
        """
        temp_pdf_path = None

        try:
            logger.info(f"Processing DocuWorks file: {file_path}")

            # 拡張子なしのファイル名を取得
            base_filename = file_path.stem
            pdf_filename = f"{base_filename}.pdf"

            # 1. まずローカルで変換済みPDFを探す（同じディレクトリ）
            same_dir_pdf = file_path.parent / pdf_filename
            if same_dir_pdf.exists():
                logger.info(f"Found converted PDF locally: {same_dir_pdf}")
                return self._generate_from_pdf(same_dir_pdf)

            # 2. S3から変換済みPDFを取得（s3_clientが提供されている場合）
            if s3_client and s3_bucket:
                # 2a. まず docuworks-converted/ フォルダを検索（ファイル名部分一致）
                # ファイルスキャンPCが生成するPDF: docuworks-converted/road/.../timestamp_server_filename.pdf
                converted_pdf_key = self._find_converted_pdf_in_s3(
                    s3_client, s3_bucket, base_filename
                )

                if converted_pdf_key:
                    logger.info(f"Found converted PDF in S3: {converted_pdf_key}")
                    try:
                        temp_pdf_path = s3_client.download_file(s3_bucket, converted_pdf_key)

                        if temp_pdf_path and os.path.exists(temp_pdf_path):
                            previews = self._generate_from_pdf(Path(temp_pdf_path))
                            logger.info(f"Generated {len(previews)} previews from S3 PDF")
                            return previews
                    except Exception as download_error:
                        logger.warning(f"Failed to download converted PDF: {download_error}")

                # 2b. 従来の方法: converted-pdf/ フォルダを確認
                s3_pdf_key = f"{converted_pdf_prefix}{pdf_filename}"
                try:
                    metadata = s3_client.get_object_metadata(s3_bucket, s3_pdf_key)
                    if metadata:
                        logger.info(f"Found converted PDF in S3 (legacy path): {s3_pdf_key}")

                        temp_pdf_path = s3_client.download_file(s3_bucket, s3_pdf_key)

                        if temp_pdf_path and os.path.exists(temp_pdf_path):
                            previews = self._generate_from_pdf(Path(temp_pdf_path))
                            logger.info(f"Generated {len(previews)} previews from S3 PDF")
                            return previews
                except Exception as s3_error:
                    logger.debug(f"Converted PDF not found in legacy S3 path: {s3_error}")

            # 3. 変換済みPDFが見つからない場合
            logger.warning(
                f"DocuWorks file requires conversion. "
                f"File: {file_path.name}. "
                f"Expected PDF in S3 docuworks-converted/ folder with filename containing: {base_filename}"
            )
            return []

        except Exception as e:
            logger.error(f"DocuWorks preview generation failed: {str(e)}")
            return []

        finally:
            # 一時ファイルをクリーンアップ
            if temp_pdf_path:
                try:
                    if os.path.exists(temp_pdf_path):
                        os.remove(temp_pdf_path)
                except Exception:
                    pass

    def _find_converted_pdf_in_s3(
        self,
        s3_client,
        bucket: str,
        base_filename: str
    ) -> Optional[str]:
        """
        S3のdocuworks-converted/フォルダから変換済みPDFを検索

        ファイルスキャンPCが生成するPDFのパターン:
        docuworks-converted/road/ts-server3/2025/12/26/200428_ts-server5_filename.pdf

        Args:
            s3_client: S3クライアント
            bucket: バケット名
            base_filename: 元のファイル名（拡張子なし）

        Returns:
            見つかったPDFのS3キー、見つからない場合はNone
        """
        try:
            # docuworks-converted/ フォルダをリスト
            objects = s3_client.list_objects(bucket, prefix='docuworks-converted/', max_keys=5000)

            # ファイル名を含むPDFを検索
            for obj in objects:
                key = obj['Key']
                if key.endswith('.pdf'):
                    # S3キーからファイル名部分を取得
                    s3_filename = Path(key).stem  # timestamp_server_filename
                    # 元のファイル名が含まれているか確認
                    if base_filename in s3_filename:
                        logger.debug(f"Found matching PDF: {key} for {base_filename}")
                        return key

            logger.debug(f"No converted PDF found for {base_filename} in docuworks-converted/")
            return None

        except Exception as e:
            logger.warning(f"Error searching for converted PDF: {e}")
            return None

    def _process_image(self, image: Image.Image) -> Optional[Dict]:
        """
        画像を処理してプレビュー用に変換
        
        ※サムネイルと異なり、大きく縮小しない
        """
        try:
            # RGBAをRGBに変換（必要な場合）
            if image.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', image.size, (255, 255, 255))
                if image.mode == 'P':
                    image = image.convert('RGBA')
                if 'A' in image.mode:
                    background.paste(image, mask=image.split()[-1])
                else:
                    background.paste(image)
                image = background
            elif image.mode != 'RGB':
                image = image.convert('RGB')

            # サイズ調整（必要な場合のみ）
            # ※サムネイルと異なり、max_width/max_heightを超える場合のみリサイズ
            width, height = image.size
            if width > self.config.max_width or height > self.config.max_height:
                image = self._resize_image(image)
                width, height = image.size

            # JPEG形式でバイトデータに変換
            output = io.BytesIO()
            image.save(output, format=self.config.format, quality=self.config.quality, optimize=True)
            data = output.getvalue()

            # ファイルサイズが大きすぎる場合は品質を下げる
            if len(data) > self.config.max_file_size_mb * 1024 * 1024:
                for quality in [70, 60, 50]:
                    output = io.BytesIO()
                    image.save(output, format=self.config.format, quality=quality, optimize=True)
                    data = output.getvalue()
                    if len(data) <= self.config.max_file_size_mb * 1024 * 1024:
                        break

            return {
                'data': data,
                'width': width,
                'height': height
            }

        except Exception as e:
            logger.error(f"Image processing failed: {str(e)}")
            return None

    def _resize_image(self, image: Image.Image) -> Image.Image:
        """アスペクト比を維持してリサイズ"""
        width, height = image.size
        aspect_ratio = width / height

        if aspect_ratio > self.config.max_width / self.config.max_height:
            # 幅が制限要因
            new_width = self.config.max_width
            new_height = int(self.config.max_width / aspect_ratio)
        else:
            # 高さが制限要因
            new_height = self.config.max_height
            new_width = int(self.config.max_height * aspect_ratio)

        return image.resize((new_width, new_height), Image.Resampling.LANCZOS)

    def _fix_orientation(self, image: Image.Image) -> Image.Image:
        """EXIF情報に基づいて画像の向きを修正"""
        try:
            exif = image.getexif()
            orientation = exif.get(274)

            if orientation:
                if orientation == 2:
                    image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                elif orientation == 3:
                    image = image.rotate(180, expand=True)
                elif orientation == 4:
                    image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                elif orientation == 5:
                    image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).rotate(270, expand=True)
                elif orientation == 6:
                    image = image.rotate(270, expand=True)
                elif orientation == 7:
                    image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).rotate(90, expand=True)
                elif orientation == 8:
                    image = image.rotate(90, expand=True)

        except Exception as e:
            logger.debug(f"Could not process EXIF orientation: {str(e)}")

        return image

    def get_page_count(self, file_path: str) -> int:
        """ファイルのページ数を取得"""
        file_path = Path(file_path)
        file_type = file_path.suffix.lower()

        try:
            if file_type == '.pdf':
                from PyPDF2 import PdfReader
                reader = PdfReader(str(file_path))
                return len(reader.pages)
            elif file_type in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif']:
                return 1
            elif file_type in OfficeConverter.SUPPORTED_EXTENSIONS:
                # Office文書の場合、PDFに変換してページ数を取得
                return self._get_office_page_count(file_path)
            elif file_type in ['.xdw', '.xbd']:
                # DocuWorksの場合、変換済みPDFがあればページ数を取得
                pdf_path = file_path.parent / f"{file_path.stem}.pdf"
                if pdf_path.exists():
                    from PyPDF2 import PdfReader
                    reader = PdfReader(str(pdf_path))
                    return len(reader.pages)
                return 0
            else:
                return 0
        except Exception as e:
            logger.error(f"Failed to get page count: {e}")
            return 0

    def _get_office_page_count(self, file_path: Path) -> int:
        """Office文書のページ数を取得（PDF変換経由）"""
        if not self.office_converter.is_available():
            logger.warning("LibreOffice not available, cannot get Office page count")
            return 0

        try:
            pdf_path = self.office_converter.convert_to_pdf(str(file_path))
            if not pdf_path:
                return 0

            try:
                from PyPDF2 import PdfReader
                reader = PdfReader(pdf_path)
                page_count = len(reader.pages)
                logger.debug(f"Office file {file_path.name} has {page_count} pages")
                return page_count
            finally:
                # 一時PDFをクリーンアップ
                try:
                    if os.path.exists(pdf_path):
                        os.remove(pdf_path)
                        parent_dir = os.path.dirname(pdf_path)
                        if parent_dir and 'office_convert_' in parent_dir:
                            shutil.rmtree(parent_dir, ignore_errors=True)
                except Exception:
                    pass

        except Exception as e:
            logger.error(f"Failed to get Office page count: {e}")
            return 0
