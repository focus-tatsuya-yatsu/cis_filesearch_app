"""
Base Processor Module
Abstract base class for all file processors
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class ProcessingResult:
    """Result of file processing"""

    # Processing Status
    success: bool
    error_message: Optional[str] = None

    # File Information
    file_path: str = ""
    file_name: str = ""
    file_size: int = 0
    file_type: str = ""
    mime_type: str = ""

    # Extracted Content
    extracted_text: str = ""
    page_count: int = 0
    word_count: int = 0
    char_count: int = 0

    # Thumbnail
    thumbnail_data: Optional[bytes] = None
    thumbnail_format: str = "JPEG"

    # Metadata
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Processing Information
    processing_time_seconds: float = 0.0
    processor_name: str = ""
    processor_version: str = "1.0.0"
    processed_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    # OCR Information (if applicable)
    ocr_confidence: Optional[float] = None
    ocr_language: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for OpenSearch indexing"""
        return {
            'success': self.success,
            'error_message': self.error_message,
            'file_path': self.file_path,
            'file_name': self.file_name,
            'file_size': self.file_size,
            'file_type': self.file_type,
            'mime_type': self.mime_type,
            'extracted_text': self.extracted_text,
            'page_count': self.page_count,
            'word_count': self.word_count,
            'char_count': self.char_count,
            'metadata': self.metadata,
            'processing_time_seconds': self.processing_time_seconds,
            'processor_name': self.processor_name,
            'processor_version': self.processor_version,
            'processed_at': self.processed_at,
            'ocr_confidence': self.ocr_confidence,
            'ocr_language': self.ocr_language,
        }


class BaseProcessor(ABC):
    """
    Abstract base class for file processors
    All file type processors should inherit from this class
    """

    def __init__(self, config):
        """
        Initialize processor

        Args:
            config: Configuration object
        """
        self.config = config
        self.logger = logging.getLogger(self.__class__.__name__)

    @abstractmethod
    def can_process(self, file_path: str) -> bool:
        """
        Check if this processor can handle the file

        Args:
            file_path: Path to the file

        Returns:
            True if processor can handle this file
        """
        pass

    @abstractmethod
    def process(self, file_path: str) -> ProcessingResult:
        """
        Process the file and extract content

        Args:
            file_path: Path to the file

        Returns:
            ProcessingResult object
        """
        pass

    def _get_file_info(self, file_path: str) -> Dict[str, Any]:
        """
        Get basic file information

        Args:
            file_path: Path to the file

        Returns:
            Dictionary with file information
        """
        path = Path(file_path)

        return {
            'file_name': path.name,
            'file_size': path.stat().st_size,
            'file_type': path.suffix.lower(),
            'file_path': str(path),
        }

    def _count_words(self, text: str) -> int:
        """
        Count words in text

        Args:
            text: Text to count

        Returns:
            Word count
        """
        if not text:
            return 0
        return len(text.split())

    def _create_error_result(
        self,
        file_path: str,
        error_message: str
    ) -> ProcessingResult:
        """
        Create error result

        Args:
            file_path: Path to the file
            error_message: Error description

        Returns:
            ProcessingResult with error
        """
        file_info = self._get_file_info(file_path)

        return ProcessingResult(
            success=False,
            error_message=error_message,
            file_path=file_info['file_path'],
            file_name=file_info['file_name'],
            file_size=file_info['file_size'],
            file_type=file_info['file_type'],
            processor_name=self.__class__.__name__,
        )

    def _validate_file_size(self, file_path: str, max_size_mb: int) -> bool:
        """
        Validate file size

        Args:
            file_path: Path to the file
            max_size_mb: Maximum file size in MB

        Returns:
            True if file size is within limit
        """
        file_size = Path(file_path).stat().st_size
        max_size_bytes = max_size_mb * 1024 * 1024

        if file_size > max_size_bytes:
            self.logger.error(
                f"File too large: {file_size} bytes (max: {max_size_bytes})"
            )
            return False

        return True

    def _extract_metadata(self, file_path: str) -> Dict[str, Any]:
        """
        Extract file metadata

        Args:
            file_path: Path to the file

        Returns:
            Dictionary with metadata
        """
        path = Path(file_path)
        stat = path.stat()

        return {
            'created_at': datetime.fromtimestamp(stat.st_ctime).isoformat(),
            'modified_at': datetime.fromtimestamp(stat.st_mtime).isoformat(),
            'accessed_at': datetime.fromtimestamp(stat.st_atime).isoformat(),
        }
