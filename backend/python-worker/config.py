"""
Configuration Module for Python Worker
Centralized configuration management with environment variable support
"""

import os
import logging
from typing import Dict, Set
from pathlib import Path
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class AWSConfig:
    """AWS service configuration"""

    # Region
    region: str = os.environ.get('AWS_REGION', 'ap-northeast-1')

    # S3 Configuration
    s3_bucket: str = os.environ.get('S3_BUCKET', 'cis-filesearch-storage')
    s3_processed_prefix: str = os.environ.get('S3_PROCESSED_PREFIX', 'processed/')
    s3_failed_prefix: str = os.environ.get('S3_FAILED_PREFIX', 'failed/')

    # SQS Configuration
    sqs_queue_url: str = os.environ.get('SQS_QUEUE_URL', '')
    sqs_wait_time_seconds: int = int(os.environ.get('SQS_WAIT_TIME', '20'))
    sqs_visibility_timeout: int = int(os.environ.get('SQS_VISIBILITY_TIMEOUT', '600'))  # Increased to 10 minutes
    sqs_max_messages: int = int(os.environ.get('SQS_MAX_MESSAGES', '10'))  # Optimized: batch 10 messages

    # OpenSearch Configuration
    opensearch_endpoint: str = os.environ.get('OPENSEARCH_ENDPOINT', '')
    opensearch_index: str = os.environ.get('OPENSEARCH_INDEX', 'cis-files-v2')
    opensearch_username: str = os.environ.get('OPENSEARCH_USERNAME', '')
    opensearch_password: str = os.environ.get('OPENSEARCH_PASSWORD', '')
    opensearch_use_ssl: bool = os.environ.get('OPENSEARCH_USE_SSL', 'true').lower() == 'true'
    opensearch_verify_certs: bool = os.environ.get('OPENSEARCH_VERIFY_CERTS', 'true').lower() == 'true'

    # CloudWatch Logs
    cloudwatch_log_group: str = os.environ.get('CLOUDWATCH_LOG_GROUP', '/aws/ec2/file-processor')
    cloudwatch_log_stream: str = os.environ.get('CLOUDWATCH_LOG_STREAM', 'worker')

    def validate(self) -> bool:
        """Validate AWS configuration"""
        if not self.sqs_queue_url:
            logger.error("SQS_QUEUE_URL is required")
            return False

        if not self.s3_bucket:
            logger.error("S3_BUCKET is required")
            return False

        if not self.opensearch_endpoint:
            logger.warning("OPENSEARCH_ENDPOINT not configured - indexing will be disabled")

        return True


@dataclass
class ProcessingConfig:
    """File processing configuration"""

    # File Size Limits (in MB)
    max_file_size_mb: int = int(os.environ.get('MAX_FILE_SIZE_MB', '100'))
    max_image_size_mb: int = int(os.environ.get('MAX_IMAGE_SIZE_MB', '50'))
    max_office_size_mb: int = int(os.environ.get('MAX_OFFICE_SIZE_MB', '100'))
    max_pdf_size_mb: int = int(os.environ.get('MAX_PDF_SIZE_MB', '100'))

    # Processing Timeouts (in seconds)
    processing_timeout: int = int(os.environ.get('PROCESSING_TIMEOUT', '300'))
    ocr_timeout: int = int(os.environ.get('OCR_TIMEOUT', '180'))

    # Temporary Storage
    temp_dir: str = os.environ.get('TEMP_DIR', '/tmp/file-processor')
    cleanup_temp_files: bool = os.environ.get('CLEANUP_TEMP_FILES', 'true').lower() == 'true'

    # Concurrent Processing (I/O bound work benefits from more workers than CPU cores)
    # t3.xlarge has 4 vCPUs, but file processing is I/O bound so we use 8 workers
    max_workers: int = int(os.environ.get('MAX_WORKERS', '8'))

    # Retry Configuration
    max_retries: int = int(os.environ.get('MAX_RETRIES', '3'))
    retry_delay_seconds: int = int(os.environ.get('RETRY_DELAY', '5'))

    def __post_init__(self):
        """Create temp directory if it doesn't exist"""
        Path(self.temp_dir).mkdir(parents=True, exist_ok=True)


@dataclass
class OCRConfig:
    """OCR processing configuration"""

    # Tesseract Configuration
    tesseract_cmd: str = os.environ.get('TESSERACT_CMD', 'tesseract')
    tessdata_prefix: str = os.environ.get('TESSDATA_PREFIX', '/usr/local/share/tessdata')

    # Language Settings
    default_language: str = os.environ.get('OCR_LANGUAGE', 'jpn+eng')
    supported_languages: Set[str] = field(default_factory=lambda: {'jpn', 'eng', 'jpn+eng'})

    # OCR Quality Settings
    pdf_dpi: int = int(os.environ.get('PDF_DPI', '300'))
    image_preprocessing: bool = os.environ.get('IMAGE_PREPROCESSING', 'true').lower() == 'true'

    # Confidence Threshold
    min_confidence: float = float(os.environ.get('MIN_OCR_CONFIDENCE', '50.0'))

    # Page Limits
    max_pdf_pages: int = int(os.environ.get('MAX_PDF_PAGES', '1000'))


@dataclass
class FileTypeConfig:
    """File type and extension configuration"""

    # Supported File Extensions
    image_extensions: Set[str] = field(default_factory=lambda: {
        '.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff', '.tif', '.webp'
    })

    office_extensions: Set[str] = field(default_factory=lambda: {
        '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp'
    })

    pdf_extensions: Set[str] = field(default_factory=lambda: {
        '.pdf'
    })

    docuworks_extensions: Set[str] = field(default_factory=lambda: {
        '.xdw', '.xbd'
    })

    text_extensions: Set[str] = field(default_factory=lambda: {
        '.txt', '.csv', '.tsv', '.log', '.md', '.rst'
    })

    # MIME Type Mappings
    mime_type_map: Dict[str, str] = field(default_factory=lambda: {
        # Images
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.bmp': 'image/bmp',
        '.gif': 'image/gif',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff',
        '.webp': 'image/webp',

        # Office
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

        # PDF
        '.pdf': 'application/pdf',

        # DocuWorks
        '.xdw': 'application/vnd.fujixerox.docuworks',
        '.xbd': 'application/vnd.fujixerox.docuworks.binder',

        # Text
        '.txt': 'text/plain',
        '.csv': 'text/csv',
    })

    def get_file_category(self, extension: str) -> str:
        """
        Get file category from extension

        Args:
            extension: File extension (with dot)

        Returns:
            Category name: 'image', 'office', 'pdf', 'docuworks', 'text', or 'unknown'
        """
        ext = extension.lower()

        if ext in self.image_extensions:
            return 'image'
        elif ext in self.office_extensions:
            return 'office'
        elif ext in self.pdf_extensions:
            return 'pdf'
        elif ext in self.docuworks_extensions:
            return 'docuworks'
        elif ext in self.text_extensions:
            return 'text'
        else:
            return 'unknown'

    def is_supported(self, extension: str) -> bool:
        """Check if file extension is supported"""
        return self.get_file_category(extension) != 'unknown'

    def get_mime_type(self, extension: str) -> str:
        """Get MIME type for file extension"""
        return self.mime_type_map.get(extension.lower(), 'application/octet-stream')


@dataclass
class ThumbnailConfig:
    """Thumbnail generation configuration"""

    # Thumbnail Sizes
    thumbnail_width: int = int(os.environ.get('THUMBNAIL_WIDTH', '200'))
    thumbnail_height: int = int(os.environ.get('THUMBNAIL_HEIGHT', '200'))
    thumbnail_quality: int = int(os.environ.get('THUMBNAIL_QUALITY', '85'))

    # Thumbnail Format
    thumbnail_format: str = os.environ.get('THUMBNAIL_FORMAT', 'JPEG')

    # Generate thumbnails for these categories
    generate_for_images: bool = os.environ.get('THUMBNAIL_IMAGES', 'true').lower() == 'true'
    generate_for_pdfs: bool = os.environ.get('THUMBNAIL_PDFS', 'true').lower() == 'true'
    generate_for_office: bool = os.environ.get('THUMBNAIL_OFFICE', 'true').lower() == 'true'
    generate_for_docuworks: bool = os.environ.get('THUMBNAIL_DOCUWORKS', 'true').lower() == 'true'


@dataclass
class DocuWorksConfig:
    """DocuWorks processing configuration"""

    # DocuWorks SDK Path (if installed)
    sdk_path: str = os.environ.get('DOCUWORKS_SDK_PATH', '')

    # License Information
    license_key: str = os.environ.get('DOCUWORKS_LICENSE_KEY', '')

    # Processing Options
    extract_text: bool = os.environ.get('DOCUWORKS_EXTRACT_TEXT', 'true').lower() == 'true'
    extract_images: bool = os.environ.get('DOCUWORKS_EXTRACT_IMAGES', 'false').lower() == 'true'
    convert_to_pdf: bool = os.environ.get('DOCUWORKS_TO_PDF', 'false').lower() == 'true'

    # Fallback Options
    use_ocr_fallback: bool = os.environ.get('DOCUWORKS_OCR_FALLBACK', 'true').lower() == 'true'

    def is_configured(self) -> bool:
        """Check if DocuWorks SDK is configured"""
        return bool(self.sdk_path) and Path(self.sdk_path).exists()


@dataclass
class LoggingConfig:
    """Logging configuration"""

    # Log Level
    log_level: str = os.environ.get('LOG_LEVEL', 'INFO')

    # Log Format
    log_format: str = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    date_format: str = '%Y-%m-%d %H:%M:%S'

    # Log Files
    log_file: str = os.environ.get('LOG_FILE', '/var/log/file-processor.log')
    max_log_size: int = 10 * 1024 * 1024  # 10 MB
    backup_count: int = 5

    # CloudWatch Integration
    use_cloudwatch: bool = os.environ.get('USE_CLOUDWATCH', 'false').lower() == 'true'

    def get_log_level(self) -> int:
        """Get numeric log level"""
        levels = {
            'DEBUG': logging.DEBUG,
            'INFO': logging.INFO,
            'WARNING': logging.WARNING,
            'ERROR': logging.ERROR,
            'CRITICAL': logging.CRITICAL,
        }
        return levels.get(self.log_level.upper(), logging.INFO)


class Config:
    """
    Main configuration class
    Aggregates all configuration sections
    """

    def __init__(self):
        """Initialize all configuration sections"""
        self.aws = AWSConfig()
        self.processing = ProcessingConfig()
        self.ocr = OCRConfig()
        self.file_types = FileTypeConfig()
        self.thumbnail = ThumbnailConfig()
        self.docuworks = DocuWorksConfig()
        self.logging = LoggingConfig()

    def validate(self) -> bool:
        """
        Validate all configuration sections

        Returns:
            True if all required configuration is valid
        """
        logger.info("Validating configuration...")

        if not self.aws.validate():
            return False

        logger.info("Configuration validation successful")
        return True

    def print_summary(self):
        """Print configuration summary"""
        logger.info("=== Configuration Summary ===")
        logger.info(f"AWS Region: {self.aws.region}")
        logger.info(f"S3 Bucket: {self.aws.s3_bucket}")
        logger.info(f"SQS Queue: {self.aws.sqs_queue_url[:50]}...")
        logger.info(f"OpenSearch: {self.aws.opensearch_endpoint[:50]}...")
        logger.info(f"Max File Size: {self.processing.max_file_size_mb} MB")
        logger.info(f"OCR Language: {self.ocr.default_language}")
        logger.info(f"PDF DPI: {self.ocr.pdf_dpi}")
        logger.info(f"Max Workers: {self.processing.max_workers}")
        logger.info(f"DocuWorks SDK: {'Configured' if self.docuworks.is_configured() else 'Not configured'}")
        logger.info(f"Log Level: {self.logging.log_level}")
        logger.info("============================")


# Singleton instance
_config = None


def get_config() -> Config:
    """
    Get configuration singleton instance

    Returns:
        Config instance
    """
    global _config
    if _config is None:
        _config = Config()
    return _config
