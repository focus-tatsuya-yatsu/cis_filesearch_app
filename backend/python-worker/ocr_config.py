"""
OCR Configuration Module for Python Worker
Provides Tesseract OCR integration for file processing pipeline

Usage:
    from ocr_config import OCRProcessor

    processor = OCRProcessor()
    text = processor.extract_text_from_image('path/to/image.jpg', lang='jpn')
    text = processor.extract_text_from_pdf('path/to/document.pdf', lang='jpn+eng')
"""

import os
import sys
import logging
from typing import Optional, Dict, Any, List
from pathlib import Path

try:
    import pytesseract
    from PIL import Image
    import pdf2image
except ImportError as e:
    logging.error(f"Required package not installed: {e}")
    logging.error("Install with: pip install pytesseract Pillow pdf2image")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class TesseractConfig:
    """Tesseract OCR configuration constants"""

    # Tesseract binary paths (try in order)
    POSSIBLE_TESSERACT_PATHS = [
        '/usr/bin/tesseract',           # Package manager install
        '/usr/local/bin/tesseract',     # Source install
        '/snap/bin/tesseract',          # Snap install
    ]

    # TESSDATA paths (try in order)
    POSSIBLE_TESSDATA_PATHS = [
        '/usr/share/tessdata',
        '/usr/local/share/tessdata',
        '/snap/tesseract/current/usr/share/tessdata',
    ]

    # OCR Engine Modes (OEM)
    OEM_LEGACY = 0          # Legacy engine only
    OEM_NEURAL = 1          # Neural nets LSTM engine only
    OEM_COMBINED = 2        # Legacy + LSTM engines
    OEM_DEFAULT = 3         # Default, based on what is available

    # Page Segmentation Modes (PSM)
    PSM_OSD_ONLY = 0        # Orientation and script detection only
    PSM_AUTO_OSD = 1        # Automatic page segmentation with OSD
    PSM_AUTO = 3            # Fully automatic page segmentation
    PSM_SINGLE_COLUMN = 4   # Assume a single column of text
    PSM_SINGLE_BLOCK = 6    # Assume a single uniform block of text
    PSM_SINGLE_LINE = 7     # Treat the image as a single text line
    PSM_SINGLE_WORD = 8     # Treat the image as a single word
    PSM_SINGLE_CHAR = 10    # Treat the image as a single character

    # Default configurations for different document types
    CONFIG_DEFAULT = f'--oem {OEM_DEFAULT} --psm {PSM_AUTO}'
    CONFIG_JAPANESE_DOC = f'--oem {OEM_DEFAULT} --psm {PSM_SINGLE_BLOCK} -l jpn'
    CONFIG_JAPANESE_ENG_DOC = f'--oem {OEM_DEFAULT} --psm {PSM_SINGLE_BLOCK} -l jpn+eng'
    CONFIG_SINGLE_LINE = f'--oem {OEM_DEFAULT} --psm {PSM_SINGLE_LINE}'
    CONFIG_SINGLE_WORD = f'--oem {OEM_DEFAULT} --psm {PSM_SINGLE_WORD}'

    # Supported image formats
    SUPPORTED_IMAGE_FORMATS = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.gif'}

    # Supported languages
    REQUIRED_LANGUAGES = {'jpn', 'eng'}


class OCRProcessor:
    """
    OCR Processor for extracting text from images and PDFs
    Integrates with Tesseract OCR engine
    """

    def __init__(self, tesseract_cmd: Optional[str] = None,
                 tessdata_prefix: Optional[str] = None):
        """
        Initialize OCR Processor

        Args:
            tesseract_cmd: Path to tesseract binary (auto-detected if None)
            tessdata_prefix: Path to tessdata directory (auto-detected if None)
        """
        self._setup_tesseract(tesseract_cmd, tessdata_prefix)
        self._verify_setup()

    def _setup_tesseract(self, tesseract_cmd: Optional[str],
                         tessdata_prefix: Optional[str]) -> None:
        """Configure Tesseract paths"""

        # Set Tesseract command
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        else:
            # Auto-detect
            for path in TesseractConfig.POSSIBLE_TESSERACT_PATHS:
                if os.path.isfile(path):
                    pytesseract.pytesseract.tesseract_cmd = path
                    logger.info(f"Using Tesseract binary: {path}")
                    break

        # Set TESSDATA_PREFIX
        if tessdata_prefix:
            os.environ['TESSDATA_PREFIX'] = tessdata_prefix
        elif 'TESSDATA_PREFIX' not in os.environ:
            # Auto-detect
            for path in TesseractConfig.POSSIBLE_TESSDATA_PATHS:
                if os.path.isdir(path):
                    os.environ['TESSDATA_PREFIX'] = path
                    logger.info(f"Using TESSDATA_PREFIX: {path}")
                    break

    def _verify_setup(self) -> None:
        """Verify Tesseract is properly configured"""
        try:
            version = pytesseract.get_tesseract_version()
            logger.info(f"Tesseract version: {version}")

            langs = set(pytesseract.get_languages())
            logger.info(f"Available languages: {', '.join(sorted(langs))}")

            # Check required languages
            missing_langs = TesseractConfig.REQUIRED_LANGUAGES - langs
            if missing_langs:
                raise RuntimeError(
                    f"Required languages not available: {', '.join(missing_langs)}"
                )

            logger.info("✓ Tesseract setup verified successfully")

        except Exception as e:
            logger.error(f"Tesseract setup verification failed: {e}")
            raise

    def get_info(self) -> Dict[str, Any]:
        """Get OCR processor information"""
        return {
            'tesseract_version': str(pytesseract.get_tesseract_version()),
            'tesseract_cmd': pytesseract.pytesseract.tesseract_cmd,
            'tessdata_prefix': os.environ.get('TESSDATA_PREFIX'),
            'available_languages': pytesseract.get_languages(),
        }

    def extract_text_from_image(self,
                                image_path: str,
                                lang: str = 'jpn',
                                config: Optional[str] = None) -> str:
        """
        Extract text from image file

        Args:
            image_path: Path to image file
            lang: Language(s) for OCR (e.g., 'jpn', 'eng', 'jpn+eng')
            config: Custom Tesseract configuration

        Returns:
            Extracted text

        Raises:
            FileNotFoundError: If image file not found
            ValueError: If unsupported image format
        """
        image_path_obj = Path(image_path)

        # Check file exists
        if not image_path_obj.exists():
            raise FileNotFoundError(f"Image file not found: {image_path}")

        # Check file format
        if image_path_obj.suffix.lower() not in TesseractConfig.SUPPORTED_IMAGE_FORMATS:
            raise ValueError(
                f"Unsupported image format: {image_path_obj.suffix}. "
                f"Supported: {', '.join(TesseractConfig.SUPPORTED_IMAGE_FORMATS)}"
            )

        try:
            # Open image
            image = Image.open(image_path)

            # Use custom config or default
            if config is None:
                if lang == 'jpn':
                    config = TesseractConfig.CONFIG_JAPANESE_DOC
                elif lang in ['jpn+eng', 'eng+jpn']:
                    config = TesseractConfig.CONFIG_JAPANESE_ENG_DOC
                else:
                    config = f'--oem {TesseractConfig.OEM_DEFAULT} --psm {TesseractConfig.PSM_AUTO} -l {lang}'

            # Extract text
            text = pytesseract.image_to_string(image, lang=lang, config=config)

            logger.info(
                f"Extracted {len(text)} characters from {image_path_obj.name}"
            )

            return text.strip()

        except Exception as e:
            logger.error(f"Failed to extract text from {image_path}: {e}")
            raise

    def extract_text_from_pdf(self,
                             pdf_path: str,
                             lang: str = 'jpn',
                             config: Optional[str] = None,
                             first_page: Optional[int] = None,
                             last_page: Optional[int] = None,
                             dpi: int = 300) -> str:
        """
        Extract text from PDF file using OCR

        Args:
            pdf_path: Path to PDF file
            lang: Language(s) for OCR
            config: Custom Tesseract configuration
            first_page: First page to process (1-indexed)
            last_page: Last page to process (1-indexed)
            dpi: DPI for PDF to image conversion (higher = better quality but slower)

        Returns:
            Extracted text from all pages

        Raises:
            FileNotFoundError: If PDF file not found
        """
        pdf_path_obj = Path(pdf_path)

        # Check file exists
        if not pdf_path_obj.exists():
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        try:
            # Convert PDF to images
            logger.info(f"Converting PDF to images: {pdf_path_obj.name}")
            images = pdf2image.convert_from_path(
                pdf_path,
                dpi=dpi,
                first_page=first_page,
                last_page=last_page
            )

            logger.info(f"Processing {len(images)} pages from PDF")

            # Use custom config or default
            if config is None:
                if lang == 'jpn':
                    config = TesseractConfig.CONFIG_JAPANESE_DOC
                elif lang in ['jpn+eng', 'eng+jpn']:
                    config = TesseractConfig.CONFIG_JAPANESE_ENG_DOC
                else:
                    config = f'--oem {TesseractConfig.OEM_DEFAULT} --psm {TesseractConfig.PSM_AUTO} -l {lang}'

            # Extract text from each page
            all_text = []
            for i, image in enumerate(images, start=1):
                logger.debug(f"Processing page {i}/{len(images)}")
                text = pytesseract.image_to_string(image, lang=lang, config=config)
                all_text.append(text.strip())

            combined_text = '\n\n'.join(all_text)

            logger.info(
                f"Extracted {len(combined_text)} characters from {len(images)} pages"
            )

            return combined_text

        except Exception as e:
            logger.error(f"Failed to extract text from PDF {pdf_path}: {e}")
            raise

    def extract_text_with_confidence(self,
                                    image_path: str,
                                    lang: str = 'jpn',
                                    config: Optional[str] = None) -> Dict[str, Any]:
        """
        Extract text with confidence scores

        Args:
            image_path: Path to image file
            lang: Language(s) for OCR
            config: Custom Tesseract configuration

        Returns:
            Dictionary with text and confidence information
        """
        image_path_obj = Path(image_path)

        if not image_path_obj.exists():
            raise FileNotFoundError(f"Image file not found: {image_path}")

        try:
            image = Image.open(image_path)

            if config is None:
                config = TesseractConfig.CONFIG_DEFAULT

            # Get detailed data
            data = pytesseract.image_to_data(
                image,
                lang=lang,
                config=config,
                output_type=pytesseract.Output.DICT
            )

            # Calculate average confidence
            confidences = [int(conf) for conf in data['conf'] if conf != '-1']
            avg_confidence = sum(confidences) / len(confidences) if confidences else 0

            # Extract text
            text = pytesseract.image_to_string(image, lang=lang, config=config)

            return {
                'text': text.strip(),
                'confidence': avg_confidence,
                'word_count': len([w for w in data['text'] if w.strip()]),
                'low_confidence_words': sum(1 for c in confidences if c < 60),
            }

        except Exception as e:
            logger.error(f"Failed to extract text with confidence from {image_path}: {e}")
            raise


def verify_tesseract_installation() -> bool:
    """
    Verify Tesseract installation and configuration

    Returns:
        True if installation is valid, False otherwise
    """
    try:
        processor = OCRProcessor()
        info = processor.get_info()

        print("✓ Tesseract OCR Installation Verified")
        print(f"  Version: {info['tesseract_version']}")
        print(f"  Binary: {info['tesseract_cmd']}")
        print(f"  TESSDATA: {info['tessdata_prefix']}")
        print(f"  Languages: {', '.join(sorted(info['available_languages']))}")

        return True

    except Exception as e:
        print(f"✗ Tesseract verification failed: {e}")
        return False


if __name__ == '__main__':
    # Run verification when executed directly
    import sys

    success = verify_tesseract_installation()
    sys.exit(0 if success else 1)
