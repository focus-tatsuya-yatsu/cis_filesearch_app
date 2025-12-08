"""
Image Processor Module
Handles image files with OCR and thumbnail generation
"""

import io
import time
from pathlib import Path
from typing import Optional

from PIL import Image
import pytesseract

from .base_processor import BaseProcessor, ProcessingResult


class ImageProcessor(BaseProcessor):
    """
    Processor for image files
    Supports: JPG, PNG, BMP, GIF, TIFF, WebP
    """

    def can_process(self, file_path: str) -> bool:
        """Check if this processor can handle the file"""
        ext = Path(file_path).suffix.lower()
        return ext in self.config.file_types.image_extensions

    def process(self, file_path: str) -> ProcessingResult:
        """
        Process image file

        Args:
            file_path: Path to image file

        Returns:
            ProcessingResult object
        """
        start_time = time.time()

        try:
            # Validate file size
            if not self._validate_file_size(
                file_path,
                self.config.processing.max_image_size_mb
            ):
                return self._create_error_result(
                    file_path,
                    f"File exceeds maximum size of {self.config.processing.max_image_size_mb}MB"
                )

            # Get file info
            file_info = self._get_file_info(file_path)

            # Open image
            try:
                image = Image.open(file_path)
            except Exception as e:
                self.logger.error(f"Failed to open image: {e}")
                return self._create_error_result(
                    file_path,
                    f"Failed to open image: {str(e)}"
                )

            # Extract text using OCR
            extracted_text = self._extract_text_ocr(image)

            # Generate thumbnail
            thumbnail_data = self._generate_thumbnail(image)

            # Extract image metadata
            metadata = self._extract_image_metadata(image)
            metadata.update(self._extract_metadata(file_path))

            # Calculate processing time
            processing_time = time.time() - start_time

            # Create result
            result = ProcessingResult(
                success=True,
                file_path=file_info['file_path'],
                file_name=file_info['file_name'],
                file_size=file_info['file_size'],
                file_type=file_info['file_type'],
                mime_type=self.config.file_types.get_mime_type(file_info['file_type']),
                extracted_text=extracted_text,
                word_count=self._count_words(extracted_text),
                char_count=len(extracted_text),
                page_count=1,
                thumbnail_data=thumbnail_data,
                thumbnail_format=self.config.thumbnail.thumbnail_format,
                metadata=metadata,
                processing_time_seconds=processing_time,
                processor_name=self.__class__.__name__,
                ocr_language=self.config.ocr.default_language,
            )

            self.logger.info(
                f"Successfully processed image: {file_info['file_name']} "
                f"({len(extracted_text)} chars in {processing_time:.2f}s)"
            )

            return result

        except Exception as e:
            self.logger.error(f"Error processing image: {e}", exc_info=True)
            return self._create_error_result(
                file_path,
                f"Processing error: {str(e)}"
            )

    def _extract_text_ocr(self, image: Image.Image) -> str:
        """
        Extract text from image using OCR

        Args:
            image: PIL Image object

        Returns:
            Extracted text
        """
        try:
            # Preprocess image if enabled
            if self.config.ocr.image_preprocessing:
                image = self._preprocess_image(image)

            # Configure OCR
            config = f'--oem 3 --psm 3'

            # Extract text
            text = pytesseract.image_to_string(
                image,
                lang=self.config.ocr.default_language,
                config=config
            )

            # Clean text
            text = text.strip()

            self.logger.debug(f"Extracted {len(text)} characters via OCR")

            return text

        except Exception as e:
            self.logger.error(f"OCR failed: {e}")
            return ""

    def _preprocess_image(self, image: Image.Image) -> Image.Image:
        """
        Preprocess image for better OCR accuracy

        Args:
            image: PIL Image object

        Returns:
            Preprocessed image
        """
        try:
            # Convert to grayscale
            if image.mode != 'L':
                image = image.convert('L')

            # Increase contrast (simple method)
            from PIL import ImageEnhance
            enhancer = ImageEnhance.Contrast(image)
            image = enhancer.enhance(2.0)

            return image

        except Exception as e:
            self.logger.warning(f"Image preprocessing failed: {e}")
            return image

    def _generate_thumbnail(self, image: Image.Image) -> Optional[bytes]:
        """
        Generate thumbnail from image

        Args:
            image: PIL Image object

        Returns:
            Thumbnail as bytes or None
        """
        if not self.config.thumbnail.generate_for_images:
            return None

        try:
            # Create thumbnail
            thumb = image.copy()
            thumb.thumbnail(
                (
                    self.config.thumbnail.thumbnail_width,
                    self.config.thumbnail.thumbnail_height
                ),
                Image.Resampling.LANCZOS
            )

            # Convert to RGB if necessary (for JPEG)
            if thumb.mode not in ('RGB', 'L'):
                thumb = thumb.convert('RGB')

            # Save to bytes
            buffer = io.BytesIO()
            thumb.save(
                buffer,
                format=self.config.thumbnail.thumbnail_format,
                quality=self.config.thumbnail.thumbnail_quality
            )

            return buffer.getvalue()

        except Exception as e:
            self.logger.warning(f"Thumbnail generation failed: {e}")
            return None

    def _extract_image_metadata(self, image: Image.Image) -> dict:
        """
        Extract metadata from image

        Args:
            image: PIL Image object

        Returns:
            Dictionary with metadata
        """
        metadata = {
            'width': image.width,
            'height': image.height,
            'format': image.format,
            'mode': image.mode,
        }

        # Extract EXIF data if available
        try:
            exif = image._getexif()
            if exif:
                metadata['exif'] = {
                    str(k): str(v) for k, v in exif.items()
                }
        except:
            pass

        return metadata
