"""
Unit Tests for Base Processor
Tests the abstract base class and ProcessingResult
"""

import pytest
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, patch

from processors.base_processor import BaseProcessor, ProcessingResult


class TestProcessingResult:
    """Test ProcessingResult dataclass"""

    def test_processing_result_success(self):
        """Test successful processing result"""
        result = ProcessingResult(
            success=True,
            file_path="/test/file.pdf",
            file_name="file.pdf",
            file_size=1024,
            file_type=".pdf",
            extracted_text="Test content",
            page_count=1,
            word_count=2,
            char_count=12,
        )

        assert result.success
        assert result.error_message is None
        assert result.file_name == "file.pdf"
        assert result.extracted_text == "Test content"

    def test_processing_result_failure(self):
        """Test failed processing result"""
        result = ProcessingResult(
            success=False,
            error_message="File not found",
            file_path="/test/missing.pdf",
        )

        assert not result.success
        assert result.error_message == "File not found"
        assert result.extracted_text == ""

    def test_to_dict_conversion(self):
        """Test conversion to dictionary"""
        result = ProcessingResult(
            success=True,
            file_path="/test/file.pdf",
            file_name="file.pdf",
            file_size=2048,
            extracted_text="Sample text",
            word_count=2,
        )

        result_dict = result.to_dict()

        assert isinstance(result_dict, dict)
        assert result_dict['success'] is True
        assert result_dict['file_name'] == "file.pdf"
        assert result_dict['file_size'] == 2048
        assert result_dict['word_count'] == 2
        assert 'processed_at' in result_dict

    def test_processing_result_with_metadata(self):
        """Test processing result with custom metadata"""
        metadata = {
            'author': 'Test Author',
            'created_date': '2024-01-01',
        }

        result = ProcessingResult(
            success=True,
            file_path="/test/file.pdf",
            metadata=metadata,
        )

        assert result.metadata == metadata
        assert result.metadata['author'] == 'Test Author'

    def test_processing_result_with_ocr_info(self):
        """Test processing result with OCR information"""
        result = ProcessingResult(
            success=True,
            file_path="/test/image.jpg",
            ocr_confidence=0.95,
            ocr_language='eng',
        )

        assert result.ocr_confidence == 0.95
        assert result.ocr_language == 'eng'

    def test_processing_result_with_thumbnail(self):
        """Test processing result with thumbnail data"""
        thumbnail_data = b'\x00\x01\x02\x03'

        result = ProcessingResult(
            success=True,
            file_path="/test/image.jpg",
            thumbnail_data=thumbnail_data,
            thumbnail_format="JPEG",
        )

        assert result.thumbnail_data == thumbnail_data
        assert result.thumbnail_format == "JPEG"


class ConcreteProcessor(BaseProcessor):
    """Concrete implementation for testing"""

    def can_process(self, file_path: str) -> bool:
        return file_path.endswith('.test')

    def process(self, file_path: str) -> ProcessingResult:
        file_info = self._get_file_info(file_path)
        return ProcessingResult(
            success=True,
            **file_info,
            extracted_text="test content",
            processor_name=self.__class__.__name__,
        )


class TestBaseProcessor:
    """Test BaseProcessor abstract class"""

    @pytest.fixture
    def processor(self, test_config):
        """Create concrete processor instance"""
        return ConcreteProcessor(test_config)

    @pytest.fixture
    def test_file(self, temp_dir: Path):
        """Create test file"""
        file_path = temp_dir / "test.test"
        file_path.write_text("test content")
        return file_path

    def test_processor_initialization(self, processor, test_config):
        """Test processor initialization"""
        assert processor.config == test_config
        assert processor.logger is not None

    def test_can_process(self, processor):
        """Test can_process method"""
        assert processor.can_process("/path/to/file.test")
        assert not processor.can_process("/path/to/file.pdf")

    def test_get_file_info(self, processor, test_file: Path):
        """Test _get_file_info helper method"""
        file_info = processor._get_file_info(str(test_file))

        assert file_info['file_name'] == test_file.name
        assert file_info['file_size'] == test_file.stat().st_size
        assert file_info['file_type'] == '.test'
        assert file_info['file_path'] == str(test_file)

    def test_count_words(self, processor):
        """Test _count_words helper method"""
        assert processor._count_words("Hello world") == 2
        assert processor._count_words("Single") == 1
        assert processor._count_words("One two three four") == 4
        assert processor._count_words("") == 0
        assert processor._count_words(None) == 0

    def test_count_words_with_multiple_spaces(self, processor):
        """Test word counting with irregular spacing"""
        assert processor._count_words("Hello    world") == 2
        assert processor._count_words("  Leading spaces") == 2
        assert processor._count_words("Trailing spaces  ") == 2

    def test_create_error_result(self, processor, test_file: Path):
        """Test _create_error_result helper method"""
        error_msg = "Test error message"
        result = processor._create_error_result(str(test_file), error_msg)

        assert not result.success
        assert result.error_message == error_msg
        assert result.file_name == test_file.name
        assert result.file_path == str(test_file)
        assert result.processor_name == "ConcreteProcessor"

    def test_validate_file_size_within_limit(self, processor, test_file: Path):
        """Test file size validation - file within limit"""
        # test_file is very small, so 1MB limit should pass
        assert processor._validate_file_size(str(test_file), max_size_mb=1)

    def test_validate_file_size_exceeds_limit(self, processor, temp_dir: Path):
        """Test file size validation - file exceeds limit"""
        # Create a file larger than limit
        large_file = temp_dir / "large.test"
        large_file.write_bytes(b'x' * (2 * 1024 * 1024))  # 2MB

        # Should fail with 1MB limit
        assert not processor._validate_file_size(str(large_file), max_size_mb=1)

    def test_validate_file_size_exactly_at_limit(self, processor, temp_dir: Path):
        """Test file size validation - file exactly at limit"""
        limit_file = temp_dir / "limit.test"
        limit_file.write_bytes(b'x' * (1024 * 1024))  # Exactly 1MB

        # Should pass with 1MB limit
        assert processor._validate_file_size(str(limit_file), max_size_mb=1)

    def test_extract_metadata(self, processor, test_file: Path):
        """Test _extract_metadata helper method"""
        metadata = processor._extract_metadata(str(test_file))

        assert 'created_at' in metadata
        assert 'modified_at' in metadata
        assert 'accessed_at' in metadata

        # Verify ISO format timestamps
        datetime.fromisoformat(metadata['created_at'])
        datetime.fromisoformat(metadata['modified_at'])
        datetime.fromisoformat(metadata['accessed_at'])

    def test_process_method(self, processor, test_file: Path):
        """Test process method of concrete implementation"""
        result = processor.process(str(test_file))

        assert result.success
        assert result.file_name == test_file.name
        assert result.extracted_text == "test content"
        assert result.processor_name == "ConcreteProcessor"

    def test_processor_with_nonexistent_file(self, processor):
        """Test processor with nonexistent file"""
        with pytest.raises(FileNotFoundError):
            processor._get_file_info("/nonexistent/file.test")

    @patch('processors.base_processor.logger')
    def test_validate_file_size_logs_error(self, mock_logger, processor, temp_dir: Path):
        """Test that file size validation logs errors"""
        large_file = temp_dir / "large.test"
        large_file.write_bytes(b'x' * (2 * 1024 * 1024))  # 2MB

        processor._validate_file_size(str(large_file), max_size_mb=1)

        # Verify error was logged
        assert processor.logger.error.called or mock_logger.error.called


@pytest.mark.unit
class TestProcessingResultEdgeCases:
    """Test edge cases for ProcessingResult"""

    def test_very_long_text(self):
        """Test with very long extracted text"""
        long_text = "word " * 100000  # 100k words

        result = ProcessingResult(
            success=True,
            file_path="/test/large.pdf",
            extracted_text=long_text,
        )

        assert len(result.extracted_text) > 500000
        assert result.success

    def test_unicode_text(self):
        """Test with unicode characters"""
        unicode_text = "日本語テキスト English 中文 العربية"

        result = ProcessingResult(
            success=True,
            file_path="/test/unicode.pdf",
            extracted_text=unicode_text,
            char_count=len(unicode_text),
        )

        assert result.extracted_text == unicode_text
        assert result.char_count > 0

    def test_special_characters_in_path(self):
        """Test with special characters in file path"""
        special_path = "/test/file (copy) [1].pdf"

        result = ProcessingResult(
            success=True,
            file_path=special_path,
            file_name="file (copy) [1].pdf",
        )

        assert result.file_path == special_path

    def test_empty_metadata_dict(self):
        """Test with empty metadata"""
        result = ProcessingResult(
            success=True,
            file_path="/test/file.pdf",
            metadata={},
        )

        assert result.metadata == {}
        assert isinstance(result.metadata, dict)

    def test_nested_metadata(self):
        """Test with nested metadata structure"""
        metadata = {
            'document': {
                'author': 'Test',
                'properties': {
                    'version': '1.0',
                    'tags': ['test', 'sample']
                }
            }
        }

        result = ProcessingResult(
            success=True,
            file_path="/test/file.pdf",
            metadata=metadata,
        )

        assert result.metadata['document']['author'] == 'Test'
        assert 'test' in result.metadata['document']['properties']['tags']
