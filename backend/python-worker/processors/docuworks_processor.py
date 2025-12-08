"""
DocuWorks Processor Module
Handles Fuji Xerox DocuWorks files (.xdw, .xbd)

IMPORTANT: Requires DocuWorks SDK and commercial license
"""

import time
import subprocess
from pathlib import Path
from typing import Optional

from PIL import Image
import pytesseract

from .base_processor import BaseProcessor, ProcessingResult


class DocuWorksProcessor(BaseProcessor):
    """
    Processor for DocuWorks files
    Supports: .xdw (DocuWorks document), .xbd (DocuWorks binder)

    Note: This processor requires:
    1. DocuWorks Viewer/SDK installed
    2. Valid commercial license from Fuji Xerox
    3. Windows environment (DocuWorks is Windows-only)
    """

    def can_process(self, file_path: str) -> bool:
        """Check if this processor can handle the file"""
        ext = Path(file_path).suffix.lower()
        return ext in self.config.file_types.docuworks_extensions

    def process(self, file_path: str) -> ProcessingResult:
        """
        Process DocuWorks file

        Args:
            file_path: Path to DocuWorks file

        Returns:
            ProcessingResult object
        """
        start_time = time.time()

        try:
            # Get file info
            file_info = self._get_file_info(file_path)

            # Check if DocuWorks SDK is configured
            if not self.config.docuworks.is_configured():
                self.logger.warning("DocuWorks SDK not configured, using OCR fallback")

                if self.config.docuworks.use_ocr_fallback:
                    return self._process_with_ocr_fallback(file_path, file_info, start_time)
                else:
                    return self._create_error_result(
                        file_path,
                        "DocuWorks SDK not configured and OCR fallback is disabled"
                    )

            # Try to process with DocuWorks SDK
            try:
                extracted_text, metadata = self._process_with_sdk(file_path)
            except Exception as sdk_error:
                self.logger.error(f"DocuWorks SDK processing failed: {sdk_error}")

                if self.config.docuworks.use_ocr_fallback:
                    self.logger.info("Falling back to OCR processing")
                    return self._process_with_ocr_fallback(file_path, file_info, start_time)
                else:
                    raise

            # Add file metadata
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
                page_count=metadata.get('page_count', 0),
                metadata=metadata,
                processing_time_seconds=processing_time,
                processor_name=self.__class__.__name__,
            )

            self.logger.info(
                f"Successfully processed DocuWorks file: {file_info['file_name']} "
                f"({len(extracted_text)} chars in {processing_time:.2f}s)"
            )

            return result

        except Exception as e:
            self.logger.error(f"Error processing DocuWorks file: {e}", exc_info=True)
            return self._create_error_result(
                file_path,
                f"Processing error: {str(e)}"
            )

    def _process_with_sdk(self, file_path: str) -> tuple[str, dict]:
        """
        Process DocuWorks file using official SDK

        Args:
            file_path: Path to DocuWorks file

        Returns:
            Tuple of (extracted_text, metadata)

        Note: This is a placeholder implementation.
        Actual implementation requires DocuWorks SDK integration.
        """
        self.logger.info("Processing with DocuWorks SDK...")

        # TODO: Implement actual DocuWorks SDK integration
        # This would typically involve:
        # 1. Loading DocuWorks COM object (Windows)
        # 2. Opening the .xdw file
        # 3. Extracting text from each page
        # 4. Extracting embedded images if needed
        # 5. Getting document metadata

        # Example pseudo-code (actual implementation depends on SDK):
        """
        import win32com.client

        dw_app = win32com.client.Dispatch("DocuWorks.Application")
        doc = dw_app.Documents.Open(file_path)

        text_parts = []
        for page in doc.Pages:
            page_text = page.GetText()
            text_parts.append(page_text)

        extracted_text = '\n\n'.join(text_parts)

        metadata = {
            'page_count': doc.Pages.Count,
            'title': doc.Title,
            'author': doc.Author,
            'subject': doc.Subject,
        }

        doc.Close()
        dw_app.Quit()
        """

        # Placeholder return
        raise NotImplementedError(
            "DocuWorks SDK integration not implemented. "
            "Please install DocuWorks SDK and implement COM integration."
        )

    def _process_with_ocr_fallback(
        self,
        file_path: str,
        file_info: dict,
        start_time: float
    ) -> ProcessingResult:
        """
        Process DocuWorks file using OCR fallback

        This method converts DocuWorks to images and uses OCR

        Args:
            file_path: Path to DocuWorks file
            file_info: File information dict
            start_time: Processing start time

        Returns:
            ProcessingResult object
        """
        self.logger.info("Processing DocuWorks with OCR fallback...")

        try:
            # First, try to convert DocuWorks to PDF
            pdf_path = self._convert_to_pdf(file_path)

            if pdf_path and Path(pdf_path).exists():
                # Process as PDF
                from .pdf_processor import PDFProcessor
                pdf_processor = PDFProcessor(self.config)
                result = pdf_processor.process(pdf_path)

                # Clean up temporary PDF
                try:
                    Path(pdf_path).unlink()
                except:
                    pass

                # Update processor name
                result.processor_name = f"{self.__class__.__name__} (OCR Fallback via PDF)"

                return result

            else:
                # If PDF conversion fails, try direct image extraction
                images = self._extract_images(file_path)

                if not images:
                    return self._create_error_result(
                        file_path,
                        "Failed to extract images from DocuWorks file"
                    )

                # OCR each image
                text_parts = []
                for i, image_path in enumerate(images, 1):
                    self.logger.debug(f"OCR processing page {i}/{len(images)}")

                    try:
                        image = Image.open(image_path)
                        page_text = pytesseract.image_to_string(
                            image,
                            lang=self.config.ocr.default_language,
                            config='--oem 3 --psm 3'
                        )

                        if page_text.strip():
                            text_parts.append(page_text)

                    except Exception as e:
                        self.logger.warning(f"Failed to OCR page {i}: {e}")
                    finally:
                        # Clean up image
                        try:
                            Path(image_path).unlink()
                        except:
                            pass

                extracted_text = '\n\n'.join(text_parts)

                # Create metadata
                metadata = {
                    'document_type': 'docuworks',
                    'page_count': len(images),
                    'processing_method': 'ocr_fallback',
                }
                metadata.update(self._extract_metadata(file_path))

                # Calculate processing time
                processing_time = time.time() - start_time

                # Create result
                return ProcessingResult(
                    success=True,
                    file_path=file_info['file_path'],
                    file_name=file_info['file_name'],
                    file_size=file_info['file_size'],
                    file_type=file_info['file_type'],
                    mime_type=self.config.file_types.get_mime_type(file_info['file_type']),
                    extracted_text=extracted_text,
                    word_count=self._count_words(extracted_text),
                    char_count=len(extracted_text),
                    page_count=len(images),
                    metadata=metadata,
                    processing_time_seconds=processing_time,
                    processor_name=f"{self.__class__.__name__} (OCR Fallback)",
                    ocr_language=self.config.ocr.default_language,
                )

        except Exception as e:
            self.logger.error(f"OCR fallback failed: {e}", exc_info=True)
            return self._create_error_result(
                file_path,
                f"OCR fallback error: {str(e)}"
            )

    def _convert_to_pdf(self, file_path: str) -> Optional[str]:
        """
        Convert DocuWorks file to PDF

        Args:
            file_path: Path to DocuWorks file

        Returns:
            Path to converted PDF or None

        Note: This requires DocuWorks Printer or converter utility
        """
        if not self.config.docuworks.convert_to_pdf:
            return None

        try:
            # This is a placeholder for DocuWorks to PDF conversion
            # Actual implementation would use:
            # 1. DocuWorks Printer (Windows)
            # 2. DocuWorks Converter utility
            # 3. Third-party conversion tools

            self.logger.warning("DocuWorks to PDF conversion not implemented")
            return None

        except Exception as e:
            self.logger.error(f"Failed to convert DocuWorks to PDF: {e}")
            return None

    def _extract_images(self, file_path: str) -> list:
        """
        Extract images from DocuWorks file

        Args:
            file_path: Path to DocuWorks file

        Returns:
            List of image file paths

        Note: This is a placeholder. Actual implementation requires:
        - DocuWorks SDK for proper extraction
        - Or third-party tools for .xdw image extraction
        """
        try:
            # This is a placeholder for image extraction
            # Actual implementation would use DocuWorks SDK or tools

            self.logger.warning("DocuWorks image extraction not implemented")
            return []

        except Exception as e:
            self.logger.error(f"Failed to extract images from DocuWorks: {e}")
            return []


# NOTE: Full DocuWorks Integration Guide
"""
To fully implement DocuWorks processing, you need:

1. **DocuWorks Viewer/SDK Installation**
   - Download from Fuji Xerox website
   - Install on Windows server/EC2 instance
   - Activate with commercial license

2. **Python COM Integration** (Windows only)
   - Install pywin32: pip install pywin32
   - Use win32com.client to interact with DocuWorks COM object

3. **Example Implementation**:
   ```python
   import win32com.client

   def extract_text_from_xdw(file_path):
       dw = win32com.client.Dispatch("DocuWorks.Application")
       doc = dw.Documents.Open(file_path)

       text_parts = []
       for i in range(doc.Pages.Count):
           page = doc.Pages.Item(i + 1)
           text_parts.append(page.GetText())

       doc.Close()
       dw.Quit()

       return '\n\n'.join(text_parts)
   ```

4. **Alternative: Use Conversion Tools**
   - DocuWorks Print: Convert .xdw to PDF
   - Then process PDF with existing pipeline

5. **Linux/Mac Limitation**
   - DocuWorks SDK is Windows-only
   - For Linux: Use Windows VM or Wine (unreliable)
   - Recommended: Dedicated Windows EC2 instance for .xdw processing
"""
