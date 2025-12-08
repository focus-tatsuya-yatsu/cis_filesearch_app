"""
Optimized PDF Processor Module
High-performance PDF processing with memory efficiency
Target: Process 100MB+ PDFs with <2GB memory usage
"""

import io
import time
import gc
from pathlib import Path
from typing import Optional, List
import logging

import PyPDF2
import pdfplumber
from PIL import Image
from pdf2image import convert_from_path
import pytesseract

from .base_processor import BaseProcessor, ProcessingResult


logger = logging.getLogger(__name__)


class PDFProcessorOptimized(BaseProcessor):
    """
    Optimized processor for PDF files
    Memory-efficient processing for large PDFs
    """

    def can_process(self, file_path: str) -> bool:
        """Check if this processor can handle the file"""
        ext = Path(file_path).suffix.lower()
        return ext in self.config.file_types.pdf_extensions

    def process(self, file_path: str) -> ProcessingResult:
        """
        Process PDF file with memory optimization

        Args:
            file_path: Path to PDF file

        Returns:
            ProcessingResult object
        """
        start_time = time.time()

        try:
            # Validate file size
            if not self._validate_file_size(
                file_path,
                self.config.processing.max_pdf_size_mb
            ):
                return self._create_error_result(
                    file_path,
                    f"File exceeds maximum size of {self.config.processing.max_pdf_size_mb}MB"
                )

            # Get file info
            file_info = self._get_file_info(file_path)
            file_size_mb = file_info['file_size'] / (1024 * 1024)

            # Get page count
            page_count = self._get_page_count(file_path)

            # Check page limit
            if page_count > self.config.ocr.max_pdf_pages:
                return self._create_error_result(
                    file_path,
                    f"PDF has {page_count} pages (max: {self.config.ocr.max_pdf_pages})"
                )

            self.logger.info(f"Processing PDF: {page_count} pages, {file_size_mb:.1f}MB")

            # Choose processing strategy based on size
            if file_size_mb > 50 or page_count > 100:
                # Large PDF - use streaming approach
                extracted_text = self._extract_text_streaming(file_path, page_count)
            else:
                # Small/medium PDF - standard approach
                extracted_text = self._extract_text_native(file_path)

                # If no text found, use OCR
                if not extracted_text.strip():
                    self.logger.info("No native text found, using OCR fallback")
                    extracted_text = self._extract_text_ocr_optimized(file_path)

            # Generate thumbnail from first page
            thumbnail_data = self._generate_thumbnail_optimized(file_path)

            # Extract PDF metadata
            metadata = self._extract_pdf_metadata(file_path)
            metadata.update(self._extract_metadata(file_path))
            metadata['page_count'] = page_count
            metadata['file_size_mb'] = file_size_mb

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
                page_count=page_count,
                thumbnail_data=thumbnail_data,
                thumbnail_format=self.config.thumbnail.thumbnail_format,
                metadata=metadata,
                processing_time_seconds=processing_time,
                processor_name=self.__class__.__name__,
            )

            self.logger.info(
                f"Successfully processed PDF: {file_info['file_name']} "
                f"({page_count} pages, {len(extracted_text):,} chars in {processing_time:.2f}s)"
            )

            return result

        except Exception as e:
            self.logger.error(f"Error processing PDF: {e}", exc_info=True)
            return self._create_error_result(
                file_path,
                f"Processing error: {str(e)}"
            )

    def _get_page_count(self, file_path: str) -> int:
        """
        Get number of pages in PDF

        Args:
            file_path: Path to PDF file

        Returns:
            Number of pages
        """
        try:
            with open(file_path, 'rb') as file:
                reader = PyPDF2.PdfReader(file)
                return len(reader.pages)
        except Exception as e:
            self.logger.warning(f"Failed to get page count: {e}")
            return 0

    def _extract_text_native(self, file_path: str) -> str:
        """
        Extract text using native PDF text extraction

        Args:
            file_path: Path to PDF file

        Returns:
            Extracted text
        """
        try:
            # Try pdfplumber first (better formatting)
            with pdfplumber.open(file_path) as pdf:
                text_parts = []
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_parts.append(page_text)

                text = '\n\n'.join(text_parts)

                if text.strip():
                    self.logger.debug(f"Extracted {len(text)} characters using pdfplumber")
                    return text

            # Fallback to PyPDF2
            with open(file_path, 'rb') as file:
                reader = PyPDF2.PdfReader(file)
                text_parts = []

                for page in reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_parts.append(page_text)

                text = '\n\n'.join(text_parts)

                if text.strip():
                    self.logger.debug(f"Extracted {len(text)} characters using PyPDF2")
                    return text

            return ""

        except Exception as e:
            self.logger.warning(f"Native text extraction failed: {e}")
            return ""

    def _extract_text_streaming(self, file_path: str, page_count: int) -> str:
        """
        Extract text using streaming approach for large PDFs
        Process pages in chunks to minimize memory usage

        Args:
            file_path: Path to PDF file
            page_count: Total number of pages

        Returns:
            Extracted text
        """
        self.logger.info("Using streaming approach for large PDF")

        text_parts = []
        chunk_size = 10  # Process 10 pages at a time

        try:
            with pdfplumber.open(file_path) as pdf:
                for chunk_start in range(0, page_count, chunk_size):
                    chunk_end = min(chunk_start + chunk_size, page_count)

                    self.logger.debug(f"Processing pages {chunk_start+1}-{chunk_end}")

                    # Process chunk
                    for page_num in range(chunk_start, chunk_end):
                        try:
                            page = pdf.pages[page_num]
                            page_text = page.extract_text()

                            if page_text:
                                text_parts.append(page_text)

                        except Exception as e:
                            self.logger.warning(f"Error processing page {page_num+1}: {e}")

                    # Force garbage collection after each chunk
                    gc.collect()

                    self.logger.debug(f"Processed chunk, total chars: {sum(len(t) for t in text_parts)}")

            text = '\n\n'.join(text_parts)
            self.logger.info(f"Streaming extraction complete: {len(text)} characters")

            return text

        except Exception as e:
            self.logger.error(f"Streaming extraction failed: {e}")
            return ""

    def _extract_text_ocr_optimized(self, file_path: str) -> str:
        """
        Extract text using OCR with memory optimization
        Process pages one at a time and clean up immediately

        Args:
            file_path: Path to PDF file

        Returns:
            Extracted text
        """
        try:
            self.logger.info("Starting optimized OCR extraction...")

            # Get page count
            page_count = self._get_page_count(file_path)

            # Limit pages for OCR (prevent excessive processing)
            max_pages = min(page_count, self.config.ocr.max_pdf_pages)

            if page_count > max_pages:
                self.logger.warning(f"Limiting OCR to first {max_pages} of {page_count} pages")

            text_parts = []

            # Process pages one at a time
            for page_num in range(1, max_pages + 1):
                try:
                    # Convert single page to image
                    images = convert_from_path(
                        file_path,
                        dpi=self.config.ocr.pdf_dpi,
                        first_page=page_num,
                        last_page=page_num,
                        fmt='jpeg',  # JPEG uses less memory than PNG
                        thread_count=1,  # Single-threaded to control memory
                        use_pdftocairo=True  # Faster than pdftoppm
                    )

                    if not images:
                        continue

                    image = images[0]

                    # OCR configuration
                    config = '--oem 3 --psm 3'

                    # Extract text
                    page_text = pytesseract.image_to_string(
                        image,
                        lang=self.config.ocr.default_language,
                        config=config
                    )

                    if page_text.strip():
                        text_parts.append(page_text)

                    # Critical: Clean up immediately
                    image.close()
                    del image
                    del images

                    # Force GC every 5 pages
                    if page_num % 5 == 0:
                        gc.collect()
                        self.logger.debug(f"Processed {page_num}/{max_pages} pages, GC completed")

                except Exception as e:
                    self.logger.warning(f"Error OCR'ing page {page_num}: {e}")

            text = '\n\n'.join(text_parts)

            self.logger.info(f"Optimized OCR complete: {len(text)} characters from {len(text_parts)} pages")

            return text

        except Exception as e:
            self.logger.error(f"OCR extraction failed: {e}")
            return ""

    def _generate_thumbnail_optimized(self, file_path: str) -> Optional[bytes]:
        """
        Generate thumbnail from first page with memory optimization

        Args:
            file_path: Path to PDF file

        Returns:
            Thumbnail as bytes or None
        """
        if not self.config.thumbnail.generate_for_pdfs:
            return None

        try:
            # Convert first page to image with low DPI
            images = convert_from_path(
                file_path,
                dpi=100,  # Lower DPI for thumbnail
                first_page=1,
                last_page=1,
                fmt='jpeg',
                use_pdftocairo=True
            )

            if not images:
                return None

            image = images[0]

            # Create thumbnail
            image.thumbnail(
                (
                    self.config.thumbnail.thumbnail_width,
                    self.config.thumbnail.thumbnail_height
                ),
                Image.Resampling.LANCZOS
            )

            # Convert to RGB if necessary
            if image.mode not in ('RGB', 'L'):
                image = image.convert('RGB')

            # Save to bytes
            buffer = io.BytesIO()
            image.save(
                buffer,
                format=self.config.thumbnail.thumbnail_format,
                quality=self.config.thumbnail.thumbnail_quality,
                optimize=True  # Optimize for smaller size
            )

            thumbnail_data = buffer.getvalue()

            # Clean up
            image.close()
            del image
            del images
            buffer.close()

            self.logger.debug(f"Generated thumbnail: {len(thumbnail_data)} bytes")

            return thumbnail_data

        except Exception as e:
            self.logger.warning(f"Thumbnail generation failed: {e}")
            return None

    def _extract_pdf_metadata(self, file_path: str) -> dict:
        """
        Extract metadata from PDF

        Args:
            file_path: Path to PDF file

        Returns:
            Dictionary with metadata
        """
        metadata = {}

        try:
            with open(file_path, 'rb') as file:
                reader = PyPDF2.PdfReader(file)

                if reader.metadata:
                    # Convert metadata to dict
                    pdf_info = {
                        'title': reader.metadata.get('/Title', ''),
                        'author': reader.metadata.get('/Author', ''),
                        'subject': reader.metadata.get('/Subject', ''),
                        'creator': reader.metadata.get('/Creator', ''),
                        'producer': reader.metadata.get('/Producer', ''),
                        'creation_date': str(reader.metadata.get('/CreationDate', '')),
                        'modification_date': str(reader.metadata.get('/ModDate', '')),
                    }

                    # Remove empty values
                    metadata['pdf_info'] = {
                        k: v for k, v in pdf_info.items() if v
                    }

        except Exception as e:
            self.logger.warning(f"Failed to extract PDF metadata: {e}")

        return metadata
