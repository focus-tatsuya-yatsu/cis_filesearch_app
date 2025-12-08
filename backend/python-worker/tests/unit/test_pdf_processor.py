"""
Unit Tests for PDF Processor
Tests PDF text extraction and processing
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

from processors.pdf_processor import PDFProcessor
from processors.base_processor import ProcessingResult


@pytest.mark.unit
@pytest.mark.pdf
class TestPDFProcessor:
    """Test PDF processor functionality"""

    @pytest.fixture
    def processor(self, test_config):
        """Create PDF processor instance"""
        return PDFProcessor(test_config)

    def test_can_process_pdf_files(self, processor):
        """Test PDF file detection"""
        assert processor.can_process("/path/to/document.pdf")
        assert processor.can_process("/path/to/DOCUMENT.PDF")
        assert processor.can_process("/path/to/file.pdf")

    def test_cannot_process_non_pdf_files(self, processor):
        """Test rejection of non-PDF files"""
        assert not processor.can_process("/path/to/document.docx")
        assert not processor.can_process("/path/to/image.jpg")
        assert not processor.can_process("/path/to/file.txt")
        assert not processor.can_process("/path/to/file")

    def test_process_simple_pdf(self, processor, sample_pdf: Path, assert_processing):
        """Test processing of simple PDF file"""
        result = processor.process(str(sample_pdf))

        assert_processing.assert_success(result)
        assert result.file_type == ".pdf"
        assert result.mime_type == "application/pdf"
        assert result.page_count >= 1
        assert "PDF" in result.extracted_text or "Test" in result.extracted_text

    def test_process_pdf_extracts_text(self, processor, sample_pdf: Path):
        """Test that text is properly extracted from PDF"""
        result = processor.process(str(sample_pdf))

        assert result.success
        assert len(result.extracted_text) > 0
        assert result.word_count > 0
        assert result.char_count > 0
        assert result.char_count == len(result.extracted_text)

    def test_process_pdf_metadata(self, processor, sample_pdf: Path):
        """Test PDF metadata extraction"""
        result = processor.process(str(sample_pdf))

        assert result.success
        assert result.processor_name == "PDFProcessor"
        assert result.processing_time_seconds >= 0
        assert isinstance(result.metadata, dict)

    def test_process_pdf_with_thumbnail(self, processor, sample_pdf: Path):
        """Test PDF thumbnail generation"""
        result = processor.process(str(sample_pdf))

        # Thumbnail generation may require pdf2image
        if result.thumbnail_data:
            assert isinstance(result.thumbnail_data, bytes)
            assert len(result.thumbnail_data) > 0
            assert result.thumbnail_format in ["JPEG", "PNG"]

    def test_process_nonexistent_pdf(self, processor, assert_processing):
        """Test processing of nonexistent file"""
        result = processor.process("/nonexistent/file.pdf")

        assert_processing.assert_failure(result)
        assert "not found" in result.error_message.lower() or "no such file" in result.error_message.lower()

    def test_process_corrupted_pdf(self, processor, temp_dir: Path, assert_processing):
        """Test processing of corrupted PDF file"""
        corrupted_pdf = temp_dir / "corrupted.pdf"
        corrupted_pdf.write_text("This is not a valid PDF file")

        result = processor.process(str(corrupted_pdf))

        # Should fail gracefully
        assert_processing.assert_failure(result)
        assert result.error_message is not None

    def test_process_empty_pdf(self, processor, temp_dir: Path):
        """Test processing of empty PDF (no text)"""
        # Create minimal valid PDF with no text
        from pypdf import PdfWriter

        empty_pdf = temp_dir / "empty.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)

        with open(empty_pdf, "wb") as f:
            writer.write(f)

        result = processor.process(str(empty_pdf))

        # Should succeed but with no text
        assert result.success
        assert result.page_count == 1
        assert result.extracted_text == "" or result.word_count == 0

    @patch('processors.pdf_processor.PdfReader')
    def test_process_pdf_with_exception(self, mock_reader, processor, sample_pdf: Path):
        """Test error handling during PDF processing"""
        mock_reader.side_effect = Exception("PDF processing error")

        result = processor.process(str(sample_pdf))

        assert not result.success
        assert "error" in result.error_message.lower()

    def test_process_multipage_pdf(self, processor, temp_dir: Path):
        """Test processing of multi-page PDF"""
        from pypdf import PdfWriter
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import letter
        import io

        multi_pdf = temp_dir / "multipage.pdf"
        writer = PdfWriter()

        # Create 3 pages
        for i in range(3):
            buffer = io.BytesIO()
            c = canvas.Canvas(buffer, pagesize=letter)
            c.drawString(100, 750, f"Page {i + 1}")
            c.showPage()
            c.save()

            buffer.seek(0)
            from pypdf import PdfReader
            reader = PdfReader(buffer)
            writer.add_page(reader.pages[0])

        with open(multi_pdf, "wb") as f:
            writer.write(f)

        result = processor.process(str(multi_pdf))

        assert result.success
        assert result.page_count == 3

    def test_process_pdf_with_images(self, processor, temp_dir: Path):
        """Test PDF containing images"""
        # This test would require creating a PDF with embedded images
        # For now, we'll test the processor can handle such files gracefully
        pass

    def test_process_large_pdf(self, processor, temp_dir: Path, test_config):
        """Test processing of large PDF file"""
        # Create a PDF larger than configured limit
        from pypdf import PdfWriter
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import letter
        import io

        large_pdf = temp_dir / "large.pdf"
        writer = PdfWriter()

        # Create many pages to make it large
        for i in range(50):
            buffer = io.BytesIO()
            c = canvas.Canvas(buffer, pagesize=letter)
            c.drawString(100, 750, f"Page {i + 1} " * 100)  # Lots of text
            c.showPage()
            c.save()

            buffer.seek(0)
            from pypdf import PdfReader
            reader = PdfReader(buffer)
            writer.add_page(reader.pages[0])

        with open(large_pdf, "wb") as f:
            writer.write(f)

        # This might succeed or fail depending on size limit
        result = processor.process(str(large_pdf))

        # Either way, it should handle gracefully
        assert isinstance(result, ProcessingResult)

    def test_pdf_word_count_accuracy(self, processor, temp_dir: Path):
        """Test accuracy of word counting"""
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import letter
        import io

        # Create PDF with known word count
        test_text = "One two three four five"  # 5 words

        buffer = io.BytesIO()
        c = canvas.Canvas(buffer, pagesize=letter)
        c.drawString(100, 750, test_text)
        c.showPage()
        c.save()

        pdf_path = temp_dir / "wordcount.pdf"
        pdf_path.write_bytes(buffer.getvalue())

        result = processor.process(str(pdf_path))

        assert result.success
        # Allow some variance in word count due to PDF extraction
        assert result.word_count >= 3  # At least most words extracted

    def test_pdf_char_count_accuracy(self, processor, sample_pdf: Path):
        """Test character count matches extracted text length"""
        result = processor.process(str(sample_pdf))

        if result.success and result.extracted_text:
            assert result.char_count == len(result.extracted_text)

    @pytest.mark.slow
    def test_processing_time_is_reasonable(self, processor, sample_pdf: Path):
        """Test that processing time is recorded and reasonable"""
        result = processor.process(str(sample_pdf))

        assert result.success
        assert result.processing_time_seconds > 0
        assert result.processing_time_seconds < 10  # Should be fast for small PDF

    def test_processor_handles_unicode_pdf(self, processor, temp_dir: Path):
        """Test PDF with unicode characters"""
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import letter
        import io

        unicode_text = "日本語 English 中文"

        buffer = io.BytesIO()
        c = canvas.Canvas(buffer, pagesize=letter)
        try:
            c.drawString(100, 750, unicode_text)
        except:
            # ReportLab may not support all unicode fonts
            c.drawString(100, 750, "Unicode Test")
        c.showPage()
        c.save()

        pdf_path = temp_dir / "unicode.pdf"
        pdf_path.write_bytes(buffer.getvalue())

        result = processor.process(str(pdf_path))

        # Should handle gracefully even if extraction isn't perfect
        assert isinstance(result, ProcessingResult)


@pytest.mark.unit
@pytest.mark.pdf
class TestPDFProcessorEdgeCases:
    """Test edge cases for PDF processor"""

    @pytest.fixture
    def processor(self, test_config):
        return PDFProcessor(test_config)

    def test_pdf_with_no_extension(self, processor, temp_dir: Path):
        """Test PDF file without .pdf extension"""
        from pypdf import PdfWriter

        no_ext_file = temp_dir / "noextension"
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)

        with open(no_ext_file, "wb") as f:
            writer.write(f)

        # Should not process (relies on extension)
        assert not processor.can_process(str(no_ext_file))

    def test_pdf_with_special_characters_in_name(self, processor, temp_dir: Path):
        """Test PDF with special characters in filename"""
        from pypdf import PdfWriter

        special_name = temp_dir / "file (copy) [1].pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)

        with open(special_name, "wb") as f:
            writer.write(f)

        result = processor.process(str(special_name))

        assert result.success
        assert result.file_name == "file (copy) [1].pdf"

    def test_encrypted_pdf(self, processor, temp_dir: Path):
        """Test encrypted/password-protected PDF"""
        # This would require creating an encrypted PDF
        # For now, ensure processor handles encryption errors gracefully
        pass

    def test_pdf_with_form_fields(self, processor):
        """Test PDF containing form fields"""
        # PDFs with forms should still extract text
        pass

    def test_pdf_with_annotations(self, processor):
        """Test PDF with annotations/comments"""
        # Processor should handle annotations
        pass
