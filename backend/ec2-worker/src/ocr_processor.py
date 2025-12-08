"""
OCR Processing Module using Tesseract
"""

import logging
import subprocess
import tempfile
from typing import Optional, List, Dict
from pathlib import Path
import pytesseract
from PIL import Image
import PyPDF2
from pdf2image import convert_from_path
from config import config

logger = logging.getLogger(__name__)


class OCRProcessor:
    """OCR処理クラス"""

    def __init__(self):
        """初期化"""
        self.languages = config.ocr.languages
        self.timeout = config.ocr.timeout

        # Tesseractのパスを確認
        try:
            self.tesseract_cmd = pytesseract.get_tesseract_version()
            logger.info(f"Tesseract version: {self.tesseract_cmd}")
        except Exception as e:
            logger.error(f"Tesseract not found: {str(e)}")
            raise RuntimeError("Tesseract is not installed or not in PATH")

    def process_file(self, file_path: str) -> Dict[str, any]:
        """
        ファイルからテキストを抽出

        Args:
            file_path: ファイルパス

        Returns:
            抽出結果の辞書
        """
        file_path = Path(file_path)
        file_type = file_path.suffix.lower()

        result = {
            'file_path': str(file_path),
            'file_type': file_type,
            'text': '',
            'pages': 1,
            'success': False,
            'error': None
        }

        try:
            if file_type in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff']:
                # 画像ファイルの処理
                result.update(self._process_image(file_path))

            elif file_type == '.pdf':
                # PDFファイルの処理
                result.update(self._process_pdf(file_path))

            elif file_type == '.xdw':
                # DocuWorksファイルの処理
                result.update(self._process_docuworks(file_path))

            elif file_type in ['.txt', '.md', '.csv', '.log']:
                # テキストファイルの処理
                result.update(self._process_text(file_path))

            elif file_type in ['.docx', '.xlsx', '.pptx']:
                # Office文書の処理（簡易版）
                result.update(self._process_office(file_path))

            else:
                logger.warning(f"Unsupported file type: {file_type}")
                result['error'] = f"Unsupported file type: {file_type}"

        except Exception as e:
            logger.error(f"OCR processing failed for {file_path}: {str(e)}")
            result['error'] = str(e)

        return result

    def _process_image(self, file_path: Path) -> Dict:
        """画像ファイルの処理"""
        try:
            logger.info(f"Processing image: {file_path}")

            # 画像を開く
            image = Image.open(file_path)

            # 必要に応じて前処理
            image = self._preprocess_image(image)

            # OCR実行
            text = pytesseract.image_to_string(
                image,
                lang=self.languages,
                timeout=self.timeout
            )

            # OCR詳細情報も取得
            data = pytesseract.image_to_data(
                image,
                lang=self.languages,
                output_type=pytesseract.Output.DICT,
                timeout=self.timeout
            )

            confidence = self._calculate_confidence(data)

            return {
                'text': text.strip(),
                'success': True,
                'confidence': confidence,
                'width': image.width,
                'height': image.height
            }

        except Exception as e:
            logger.error(f"Image OCR failed: {str(e)}")
            return {'error': str(e)}

    def _process_pdf(self, file_path: Path) -> Dict:
        """PDFファイルの処理"""
        try:
            logger.info(f"Processing PDF: {file_path}")
            texts = []
            total_pages = 0

            # まずテキスト抽出を試みる
            try:
                with open(file_path, 'rb') as file:
                    pdf_reader = PyPDF2.PdfReader(file)
                    total_pages = len(pdf_reader.pages)

                    for page_num, page in enumerate(pdf_reader.pages):
                        text = page.extract_text()
                        if text and text.strip():
                            texts.append(f"[Page {page_num + 1}]\n{text}")

            except Exception as e:
                logger.warning(f"PDF text extraction failed: {str(e)}")

            # テキストが抽出できない場合はOCRを実行
            if not texts or all(not t.strip() for t in texts):
                logger.info("No text found in PDF, performing OCR...")

                # PDFを画像に変換
                with tempfile.TemporaryDirectory() as temp_dir:
                    images = convert_from_path(
                        file_path,
                        dpi=200,
                        output_folder=temp_dir
                    )
                    total_pages = len(images)

                    for i, image in enumerate(images):
                        # 各ページでOCR実行
                        image = self._preprocess_image(image)
                        text = pytesseract.image_to_string(
                            image,
                            lang=self.languages,
                            timeout=self.timeout
                        )
                        if text.strip():
                            texts.append(f"[Page {i + 1}]\n{text}")

            combined_text = '\n\n'.join(texts)

            return {
                'text': combined_text.strip(),
                'pages': total_pages,
                'success': True
            }

        except Exception as e:
            logger.error(f"PDF processing failed: {str(e)}")
            return {'error': str(e)}

    def _process_docuworks(self, file_path: Path) -> Dict:
        """DocuWorksファイルの処理"""
        try:
            logger.info(f"Processing DocuWorks: {file_path}")

            # DocuWorksの処理は専用のツールが必要
            # ここでは簡易的な実装を示す
            # 実際の環境では、DocuWorks SDKまたは変換ツールを使用

            # DocuWorksをPDFに変換（外部ツール使用を想定）
            pdf_path = file_path.with_suffix('.pdf')

            # 変換コマンド実行（例）
            # subprocess.run(['xdw2pdf', str(file_path), str(pdf_path)], check=True)

            logger.warning("DocuWorks processing requires additional tools")
            return {
                'text': '',
                'success': False,
                'error': 'DocuWorks processing not fully implemented'
            }

        except Exception as e:
            logger.error(f"DocuWorks processing failed: {str(e)}")
            return {'error': str(e)}

    def _process_text(self, file_path: Path) -> Dict:
        """テキストファイルの処理"""
        try:
            logger.info(f"Processing text file: {file_path}")

            # エンコーディングを自動検出して読み込み
            encodings = ['utf-8', 'shift_jis', 'euc-jp', 'iso-2022-jp']

            for encoding in encodings:
                try:
                    with open(file_path, 'r', encoding=encoding) as f:
                        text = f.read()
                    break
                except UnicodeDecodeError:
                    continue
            else:
                # バイナリとして読み込み
                with open(file_path, 'rb') as f:
                    text = f.read().decode('utf-8', errors='ignore')

            return {
                'text': text.strip(),
                'success': True
            }

        except Exception as e:
            logger.error(f"Text file processing failed: {str(e)}")
            return {'error': str(e)}

    def _process_office(self, file_path: Path) -> Dict:
        """Office文書の処理（簡易版）"""
        try:
            logger.info(f"Processing Office document: {file_path}")

            # Office文書の処理は追加ライブラリが必要
            # python-docx, openpyxl, python-pptxなど

            logger.warning("Office document processing requires additional libraries")
            return {
                'text': '',
                'success': False,
                'error': 'Office document processing not implemented'
            }

        except Exception as e:
            logger.error(f"Office document processing failed: {str(e)}")
            return {'error': str(e)}

    def _preprocess_image(self, image: Image.Image) -> Image.Image:
        """画像の前処理"""
        try:
            # グレースケール変換
            if image.mode != 'L':
                image = image.convert('L')

            # サイズ調整（大きすぎる画像は縮小）
            max_dimension = 4000
            if max(image.width, image.height) > max_dimension:
                ratio = max_dimension / max(image.width, image.height)
                new_size = (int(image.width * ratio), int(image.height * ratio))
                image = image.resize(new_size, Image.Resampling.LANCZOS)

            return image

        except Exception as e:
            logger.warning(f"Image preprocessing failed: {str(e)}")
            return image

    def _calculate_confidence(self, ocr_data: Dict) -> float:
        """OCR信頼度を計算"""
        try:
            confidences = [
                float(conf) for conf in ocr_data['conf']
                if conf != -1  # -1は信頼度なしを示す
            ]

            if confidences:
                return sum(confidences) / len(confidences)
            else:
                return 0.0

        except Exception:
            return 0.0

    def extract_text_with_coordinates(self, image_path: str) -> List[Dict]:
        """
        テキストと座標情報を抽出

        Args:
            image_path: 画像ファイルパス

        Returns:
            テキストと座標のリスト
        """
        try:
            image = Image.open(image_path)
            data = pytesseract.image_to_data(
                image,
                lang=self.languages,
                output_type=pytesseract.Output.DICT
            )

            results = []
            for i in range(len(data['text'])):
                if data['text'][i].strip():
                    results.append({
                        'text': data['text'][i],
                        'x': data['left'][i],
                        'y': data['top'][i],
                        'width': data['width'][i],
                        'height': data['height'][i],
                        'confidence': data['conf'][i]
                    })

            return results

        except Exception as e:
            logger.error(f"Failed to extract text with coordinates: {str(e)}")
            return []