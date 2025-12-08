"""
Thumbnail Generation Module
"""

import logging
import io
from typing import Optional, Tuple
from pathlib import Path
from PIL import Image
import PyPDF2
from pdf2image import convert_from_path
from config import config

logger = logging.getLogger(__name__)


class ThumbnailGenerator:
    """サムネイル生成クラス"""

    def __init__(self):
        """初期化"""
        self.max_width = config.thumbnail.max_width
        self.max_height = config.thumbnail.max_height
        self.quality = config.thumbnail.quality
        self.format = config.thumbnail.format

    def generate(self, file_path: str) -> Optional[bytes]:
        """
        ファイルからサムネイルを生成

        Args:
            file_path: ファイルパス

        Returns:
            サムネイル画像のバイトデータ
        """
        file_path = Path(file_path)
        file_type = file_path.suffix.lower()

        try:
            if file_type in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff']:
                return self._generate_from_image(file_path)

            elif file_type == '.pdf':
                return self._generate_from_pdf(file_path)

            elif file_type == '.xdw':
                return self._generate_from_docuworks(file_path)

            elif file_type in ['.mp4', '.avi', '.mov', '.wmv']:
                return self._generate_from_video(file_path)

            else:
                # サムネイル生成不可能なファイルタイプ
                return self._generate_placeholder(file_type)

        except Exception as e:
            logger.error(f"Thumbnail generation failed for {file_path}: {str(e)}")
            return self._generate_error_placeholder()

    def _generate_from_image(self, file_path: Path) -> bytes:
        """画像ファイルからサムネイル生成"""
        try:
            logger.info(f"Generating thumbnail from image: {file_path}")

            # 画像を開く
            with Image.open(file_path) as image:
                # EXIF情報に基づいて回転を修正
                image = self._fix_orientation(image)

                # RGBAをRGBに変換（必要な場合）
                if image.mode in ('RGBA', 'LA', 'P'):
                    # 白背景を作成
                    background = Image.new('RGB', image.size, (255, 255, 255))
                    if image.mode == 'P':
                        image = image.convert('RGBA')
                    background.paste(image, mask=image.split()[-1] if 'A' in image.mode else None)
                    image = background

                # サムネイルサイズを計算
                thumbnail_size = self._calculate_thumbnail_size(image.size)

                # リサイズ
                image.thumbnail(thumbnail_size, Image.Resampling.LANCZOS)

                # バイトデータに変換
                output = io.BytesIO()
                image.save(output, format=self.format, quality=self.quality, optimize=True)
                return output.getvalue()

        except Exception as e:
            logger.error(f"Image thumbnail generation failed: {str(e)}")
            raise

    def _generate_from_pdf(self, file_path: Path) -> bytes:
        """PDFファイルからサムネイル生成"""
        try:
            logger.info(f"Generating thumbnail from PDF: {file_path}")

            # PDFの最初のページを画像に変換
            images = convert_from_path(
                file_path,
                dpi=150,  # サムネイル用なので低解像度
                first_page=1,
                last_page=1
            )

            if not images:
                return self._generate_placeholder('.pdf')

            # 最初のページからサムネイル生成
            image = images[0]

            # サムネイルサイズを計算
            thumbnail_size = self._calculate_thumbnail_size(image.size)

            # リサイズ
            image.thumbnail(thumbnail_size, Image.Resampling.LANCZOS)

            # バイトデータに変換
            output = io.BytesIO()
            image.save(output, format=self.format, quality=self.quality)
            return output.getvalue()

        except Exception as e:
            logger.error(f"PDF thumbnail generation failed: {str(e)}")
            return self._generate_placeholder('.pdf')

    def _generate_from_docuworks(self, file_path: Path) -> bytes:
        """DocuWorksファイルからサムネイル生成"""
        try:
            logger.info(f"Generating thumbnail from DocuWorks: {file_path}")

            # DocuWorksの処理は専用ツールが必要
            # プレースホルダーを返す
            return self._generate_placeholder('.xdw')

        except Exception as e:
            logger.error(f"DocuWorks thumbnail generation failed: {str(e)}")
            return self._generate_placeholder('.xdw')

    def _generate_from_video(self, file_path: Path) -> bytes:
        """動画ファイルからサムネイル生成"""
        try:
            logger.info(f"Generating thumbnail from video: {file_path}")

            # ffmpegを使用して動画からフレーム抽出（別途実装が必要）
            # ここではプレースホルダーを返す
            return self._generate_placeholder(file_path.suffix)

        except Exception as e:
            logger.error(f"Video thumbnail generation failed: {str(e)}")
            return self._generate_placeholder(file_path.suffix)

    def _generate_placeholder(self, file_type: str) -> bytes:
        """プレースホルダー画像を生成"""
        try:
            # ファイルタイプに応じた色を設定
            colors = {
                '.pdf': (220, 53, 69),     # 赤
                '.xdw': (255, 193, 7),      # 黄
                '.doc': (13, 110, 253),     # 青
                '.docx': (13, 110, 253),    # 青
                '.xls': (25, 135, 84),      # 緑
                '.xlsx': (25, 135, 84),     # 緑
                '.ppt': (220, 53, 69),      # 赤
                '.pptx': (220, 53, 69),     # 赤
                '.txt': (108, 117, 125),    # グレー
                '.csv': (25, 135, 84),      # 緑
            }

            color = colors.get(file_type.lower(), (108, 117, 125))  # デフォルトはグレー

            # プレースホルダー画像を作成
            image = Image.new('RGB', (self.max_width, self.max_height), color)

            # ファイルタイプのテキストを追加（Pillowの基本機能のみ使用）
            # より高度な実装では、PIL.ImageDraw と PIL.ImageFont を使用

            # バイトデータに変換
            output = io.BytesIO()
            image.save(output, format=self.format, quality=self.quality)
            return output.getvalue()

        except Exception as e:
            logger.error(f"Placeholder generation failed: {str(e)}")
            return self._generate_error_placeholder()

    def _generate_error_placeholder(self) -> bytes:
        """エラー用プレースホルダー画像を生成"""
        try:
            # グレーの画像を生成
            image = Image.new('RGB', (self.max_width, self.max_height), (128, 128, 128))

            output = io.BytesIO()
            image.save(output, format=self.format, quality=self.quality)
            return output.getvalue()

        except Exception:
            # 最小限のグレー画像を返す
            return b''

    def _calculate_thumbnail_size(self, original_size: Tuple[int, int]) -> Tuple[int, int]:
        """
        サムネイルサイズを計算（アスペクト比を維持）

        Args:
            original_size: 元画像のサイズ (width, height)

        Returns:
            サムネイルサイズ (width, height)
        """
        width, height = original_size
        max_width = self.max_width
        max_height = self.max_height

        # アスペクト比を計算
        aspect_ratio = width / height

        # 最大サイズに収まるようにリサイズ
        if width > max_width or height > max_height:
            if aspect_ratio > max_width / max_height:
                # 幅が制限要因
                new_width = max_width
                new_height = int(max_width / aspect_ratio)
            else:
                # 高さが制限要因
                new_height = max_height
                new_width = int(max_height * aspect_ratio)
        else:
            # リサイズ不要
            new_width = width
            new_height = height

        return (new_width, new_height)

    def _fix_orientation(self, image: Image.Image) -> Image.Image:
        """
        EXIF情報に基づいて画像の向きを修正

        Args:
            image: PIL画像オブジェクト

        Returns:
            向きを修正した画像
        """
        try:
            # EXIF情報を取得
            exif = image.getexif()

            # Orientationタグ（274）を確認
            orientation = exif.get(274)

            if orientation:
                # 回転/反転処理
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

    def generate_with_metadata(self, file_path: str) -> dict:
        """
        サムネイル生成とメタデータ取得

        Args:
            file_path: ファイルパス

        Returns:
            サムネイルとメタデータの辞書
        """
        result = {
            'thumbnail': None,
            'width': 0,
            'height': 0,
            'format': self.format,
            'size': 0
        }

        try:
            thumbnail_bytes = self.generate(file_path)

            if thumbnail_bytes:
                result['thumbnail'] = thumbnail_bytes
                result['size'] = len(thumbnail_bytes)

                # サムネイルのサイズを取得
                with Image.open(io.BytesIO(thumbnail_bytes)) as img:
                    result['width'] = img.width
                    result['height'] = img.height

        except Exception as e:
            logger.error(f"Failed to generate thumbnail with metadata: {str(e)}")

        return result