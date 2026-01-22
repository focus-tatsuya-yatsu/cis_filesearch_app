"""
Metadata Only Processor Module
Handles files that should be indexed with metadata only (no OCR/text extraction)
Used for CAD files, archives, and other unsupported file types
"""

import logging
import mimetypes
from pathlib import Path
from typing import Set
from datetime import datetime

from .base_processor import BaseProcessor, ProcessingResult

logger = logging.getLogger(__name__)


class MetadataOnlyProcessor(BaseProcessor):
    """
    Processor for files that don't require text extraction
    Indexes file with metadata only (path, name, size, dates, etc.)
    """

    # File extensions handled by this processor
    SUPPORTED_EXTENSIONS: Set[str] = {
        # CAD files
        '.sfc', '.bvf', '.dwg', '.dxf', '.jww', '.jwc',
        # Archive files
        '.zip', '.rar', '.7z', '.tar', '.gz', '.lzh',
        # Other files
        '.exe', '.dll', '.msi', '.iso',
        # Data files
        '.xml', '.json', '.yaml', '.yml',
        # Video files
        '.mp4', '.avi', '.mov', '.wmv', '.flv',
        # Audio files
        '.mp3', '.wav', '.wma', '.aac', '.flac',
    }

    def __init__(self, config):
        """Initialize processor"""
        super().__init__(config)
        self.logger.info(f"MetadataOnlyProcessor initialized with {len(self.SUPPORTED_EXTENSIONS)} extensions")

    def can_process(self, file_path: str) -> bool:
        """
        Check if this processor can handle the file
        Returns True for any file extension in SUPPORTED_EXTENSIONS

        Args:
            file_path: Path to the file

        Returns:
            True if file extension is in supported list
        """
        ext = Path(file_path).suffix.lower()
        return ext in self.SUPPORTED_EXTENSIONS

    def process(self, file_path: str) -> ProcessingResult:
        """
        Process file - extract metadata only (no text extraction)

        Args:
            file_path: Path to the file

        Returns:
            ProcessingResult with metadata
        """
        start_time = datetime.utcnow()
        path = Path(file_path)

        try:
            # Get file info
            file_info = self._get_file_info(file_path)

            # Get MIME type
            mime_type, _ = mimetypes.guess_type(file_path)
            if not mime_type:
                mime_type = 'application/octet-stream'

            # Extract metadata
            metadata = self._extract_metadata(file_path)
            metadata['processor_type'] = 'metadata_only'
            metadata['has_text_content'] = False

            # Calculate processing time
            processing_time = (datetime.utcnow() - start_time).total_seconds()

            self.logger.info(
                f"Metadata extraction complete: {path.name} "
                f"({file_info['file_size']} bytes) in {processing_time:.2f}s"
            )

            return ProcessingResult(
                success=True,
                file_path=file_info['file_path'],
                file_name=file_info['file_name'],
                file_size=file_info['file_size'],
                file_type=file_info['file_type'],
                mime_type=mime_type,
                extracted_text="",  # No text extraction
                page_count=0,
                word_count=0,
                char_count=0,
                metadata=metadata,
                processing_time_seconds=processing_time,
                processor_name=self.__class__.__name__,
            )

        except Exception as e:
            self.logger.error(f"Failed to process {path.name}: {e}")
            return self._create_error_result(file_path, str(e))
