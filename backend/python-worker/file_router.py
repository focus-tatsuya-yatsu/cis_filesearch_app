"""
File Router Module
Routes files to appropriate processors based on file type
"""

import logging
from pathlib import Path
from typing import Optional

from processors import (
    BaseProcessor,
    ProcessingResult,
    ImageProcessor,
    PDFProcessor,
    OfficeProcessor,
    DocuWorksProcessor,
    MetadataOnlyProcessor,
)

logger = logging.getLogger(__name__)


class FileRouter:
    """
    Routes files to appropriate processors
    Automatically detects file type and selects processor
    """

    def __init__(self, config):
        """
        Initialize file router

        Args:
            config: Configuration object
        """
        self.config = config

        # Initialize all processors
        # MetadataOnlyProcessor is last as fallback for CAD/archive files
        self.processors = [
            ImageProcessor(config),
            PDFProcessor(config),
            OfficeProcessor(config),
            DocuWorksProcessor(config),
            MetadataOnlyProcessor(config),
        ]

        logger.info(f"Initialized {len(self.processors)} file processors")

    def get_processor(self, file_path: str) -> Optional[BaseProcessor]:
        """
        Get appropriate processor for file

        Args:
            file_path: Path to file

        Returns:
            Processor instance or None if no processor can handle the file
        """
        for processor in self.processors:
            if processor.can_process(file_path):
                logger.debug(
                    f"Selected processor: {processor.__class__.__name__} "
                    f"for file: {Path(file_path).name}"
                )
                return processor

        logger.warning(f"No processor found for file: {file_path}")
        return None

    def process_file(self, file_path: str) -> ProcessingResult:
        """
        Process file with appropriate processor

        Args:
            file_path: Path to file

        Returns:
            ProcessingResult object
        """
        # Get processor
        processor = self.get_processor(file_path)

        if not processor:
            # Create error result for unsupported file type
            ext = Path(file_path).suffix.lower()
            return ProcessingResult(
                success=False,
                error_message=f"Unsupported file type: {ext}",
                file_path=file_path,
                file_name=Path(file_path).name,
                file_size=Path(file_path).stat().st_size if Path(file_path).exists() else 0,
                file_type=ext,
                processor_name="FileRouter"
            )

        # Process file
        try:
            result = processor.process(file_path)
            return result

        except Exception as e:
            logger.error(f"Error processing file with {processor.__class__.__name__}: {e}")
            return ProcessingResult(
                success=False,
                error_message=f"Processing failed: {str(e)}",
                file_path=file_path,
                file_name=Path(file_path).name,
                file_size=Path(file_path).stat().st_size if Path(file_path).exists() else 0,
                file_type=Path(file_path).suffix.lower(),
                processor_name=processor.__class__.__name__
            )

    def get_supported_extensions(self) -> set:
        """
        Get set of all supported file extensions

        Returns:
            Set of supported extensions
        """
        extensions = set()

        extensions.update(self.config.file_types.image_extensions)
        extensions.update(self.config.file_types.pdf_extensions)
        extensions.update(self.config.file_types.office_extensions)
        extensions.update(self.config.file_types.docuworks_extensions)
        extensions.update(self.config.file_types.text_extensions)
        # Add MetadataOnlyProcessor extensions (CAD, archives, etc.)
        extensions.update(MetadataOnlyProcessor.SUPPORTED_EXTENSIONS)

        return extensions

    def is_supported(self, file_path: str) -> bool:
        """
        Check if file type is supported

        Args:
            file_path: Path to file

        Returns:
            True if file type is supported
        """
        ext = Path(file_path).suffix.lower()
        return ext in self.get_supported_extensions()
