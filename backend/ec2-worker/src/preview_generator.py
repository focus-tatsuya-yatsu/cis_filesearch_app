"""
Preview Generation Module
高解像度プレビュー画像生成（全ページ対応）
"""

import logging
import io
import os
from typing import Optional, List, Dict, Tuple
from pathlib import Path
from PIL import Image
from pdf2image import convert_from_path
from dataclasses import dataclass

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
        logger.info(f"PreviewGenerator initialized with DPI={self.config.dpi}, "
                   f"max_size={self.config.max_width}x{self.config.max_height}")

    def generate_previews(self, file_path: str) -> List[Dict]:
        """
        ファイルから全ページのプレビュー画像を生成

        Args:
            file_path: ファイルパス

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

            elif file_type == '.xdw':
                # DocuWorksは別途変換が必要（現状はスキップ）
                logger.info(f"DocuWorks preview not yet supported: {file_path}")
                return []

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
            else:
                return 0
        except Exception as e:
            logger.error(f"Failed to get page count: {e}")
            return 0
