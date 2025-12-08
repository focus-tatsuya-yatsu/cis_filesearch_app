"""
File Processors Module
Contains specialized processors for different file types
"""

from .base_processor import BaseProcessor, ProcessingResult
from .image_processor import ImageProcessor
from .pdf_processor import PDFProcessor
from .office_processor import OfficeProcessor
from .docuworks_processor import DocuWorksProcessor

__all__ = [
    'BaseProcessor',
    'ProcessingResult',
    'ImageProcessor',
    'PDFProcessor',
    'OfficeProcessor',
    'DocuWorksProcessor',
]
