"""
Configuration Management for CIS File Processor Worker

Supports multiple configuration sources:
1. Environment variables (highest priority)
2. .env file in application directory
3. /etc/cis-worker.env (systemd environment file)
4. Default values (lowest priority)
"""

import os
import sys
import logging
from dataclasses import dataclass
from typing import Optional, List
from pathlib import Path

# Setup basic logging before config is fully loaded
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def load_env_files():
    """
    Load environment variables from multiple sources.
    Priority (highest to lowest):
    1. Already set environment variables
    2. .env file in current working directory
    3. .env file in application directory
    4. /etc/cis-worker.env (systemd)
    """
    env_files: List[Path] = [
        Path('/etc/cis-worker.env'),
        Path('/opt/cis-file-processor/.env'),
        Path(__file__).parent.parent / '.env',
        Path.cwd() / '.env',
    ]

    loaded_files = []

    for env_file in env_files:
        if env_file.exists():
            try:
                _load_env_file(env_file)
                loaded_files.append(str(env_file))
            except Exception as e:
                logger.warning(f"Failed to load {env_file}: {e}")

    if loaded_files:
        logger.info(f"Loaded environment from: {', '.join(loaded_files)}")
    else:
        logger.warning("No .env files found. Using environment variables only.")

def _load_env_file(filepath: Path):
    """
    Parse and load environment variables from a file.
    Does NOT override existing environment variables.
    """
    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            # Skip comments and empty lines
            if not line or line.startswith('#'):
                continue
            # Handle export prefix (shell-style)
            if line.startswith('export '):
                line = line[7:]
            # Parse KEY=VALUE
            if '=' in line:
                key, _, value = line.partition('=')
                key = key.strip()
                value = value.strip()
                # Remove quotes if present
                if (value.startswith('"') and value.endswith('"')) or \
                   (value.startswith("'") and value.endswith("'")):
                    value = value[1:-1]
                # Only set if not already in environment
                if key and key not in os.environ:
                    os.environ[key] = value

# Load environment files at module import
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    logger.info("python-dotenv not available, using custom loader")
    load_env_files()


@dataclass
class AWSConfig:
    """AWS関連の設定"""
    region: str
    access_key_id: Optional[str]
    secret_access_key: Optional[str]


@dataclass
class S3Config:
    """S3バケット設定"""
    landing_bucket: str
    thumbnail_bucket: str


@dataclass
class SQSConfig:
    """SQSキュー設定"""
    queue_url: str
    visibility_timeout: int
    max_messages: int


@dataclass
class OpenSearchConfig:
    """OpenSearch設定"""
    endpoint: str
    index_name: str
    username: Optional[str]
    password: Optional[str]
    use_aws_auth: bool


@dataclass
class BedrockConfig:
    """Bedrock設定"""
    model_id: str
    region: str


@dataclass
class WorkerConfig:
    """Worker設定"""
    threads: int
    batch_size: int
    poll_interval: int
    shutdown_timeout: int = 30


@dataclass
class ThumbnailConfig:
    """サムネイル設定"""
    max_width: int
    max_height: int
    quality: int
    format: str = 'JPEG'



@dataclass
class PreviewConfig:
    """プレビュー設定"""
    dpi: int = 150                    # 解像度
    max_width: int = 1240             # 最大幅（A4横幅相当）
    max_height: int = 1754            # 最大高さ
    quality: int = 85                 # JPEG品質
    format: str = "JPEG"              # 出力形式
    max_pages: int = 50               # 最大ページ数
    enabled: bool = True              # プレビュー機能有効化

@dataclass
class OCRConfig:
    """OCR設定"""
    languages: str
    timeout: int = 60


@dataclass
class LoggingConfig:
    """ロギング設定"""
    level: str
    file: Optional[str]
    cloudwatch_group: Optional[str]
    cloudwatch_stream: Optional[str]


@dataclass
class FeatureFlags:
    """機能フラグ"""
    enable_ocr: bool
    enable_thumbnail: bool
    enable_vector_search: bool


class Config:
    """アプリケーション設定"""

    def __init__(self):
        """設定の初期化"""
        # AWS設定
        # ✅ SECURITY FIX: Use IAM role instead of hardcoded credentials
        # On EC2, boto3 automatically uses instance IAM role
        self.aws = AWSConfig(
            region=os.getenv('AWS_REGION', 'ap-northeast-1'),
            access_key_id=None,  # Use IAM role
            secret_access_key=None  # Use IAM role
        )

        # S3設定
        self.s3 = S3Config(
            landing_bucket=os.getenv('S3_LANDING_BUCKET', 'cis-landing-bucket'),
            thumbnail_bucket=os.getenv('S3_THUMBNAIL_BUCKET', 'cis-thumbnail-bucket')
        )

        # SQS設定
        self.sqs = SQSConfig(
            queue_url=os.getenv('SQS_QUEUE_URL', ''),
            visibility_timeout=int(os.getenv('SQS_VISIBILITY_TIMEOUT', '300')),
            max_messages=int(os.getenv('SQS_MAX_MESSAGES', '10'))
        )

        # OpenSearch設定
        self.opensearch = OpenSearchConfig(
            endpoint=os.getenv('OPENSEARCH_ENDPOINT', ''),
            index_name=os.getenv('OPENSEARCH_INDEX_NAME', 'cis-files'),
            username=os.getenv('OPENSEARCH_USERNAME'),
            password=os.getenv('OPENSEARCH_PASSWORD'),
            use_aws_auth=os.getenv('OPENSEARCH_USE_AWS_AUTH', 'true').lower() == 'true'
        )

        # Bedrock設定
        self.bedrock = BedrockConfig(
            model_id=os.getenv('BEDROCK_MODEL_ID', 'amazon.titan-embed-image-v1'),
            region=os.getenv('BEDROCK_REGION', self.aws.region)
        )

        # Worker設定
        self.worker = WorkerConfig(
            threads=int(os.getenv('WORKER_THREADS', '4')),
            batch_size=int(os.getenv('WORKER_BATCH_SIZE', '10')),
            poll_interval=int(os.getenv('WORKER_POLL_INTERVAL', '20'))
        )

        # サムネイル設定
        self.thumbnail = ThumbnailConfig(
            max_width=int(os.getenv('THUMBNAIL_MAX_WIDTH', '300')),
            max_height=int(os.getenv('THUMBNAIL_MAX_HEIGHT', '300')),
            quality=int(os.getenv('THUMBNAIL_QUALITY', '85'))
        )

        # プレビュー設定
        self.preview = PreviewConfig(
            dpi=int(os.getenv("PREVIEW_DPI", "150")),
            max_width=int(os.getenv("PREVIEW_MAX_WIDTH", "1240")),
            max_height=int(os.getenv("PREVIEW_MAX_HEIGHT", "1754")),
            quality=int(os.getenv("PREVIEW_QUALITY", "85")),
            max_pages=int(os.getenv("PREVIEW_MAX_PAGES", "50")),
            enabled=os.getenv("ENABLE_PREVIEW", "true").lower() == "true"
        )

        # OCR設定
        self.ocr = OCRConfig(
            languages=os.getenv('TESSERACT_LANG', 'jpn+eng'),
            timeout=int(os.getenv('OCR_TIMEOUT', '60'))
        )

        # ロギング設定
        self.logging = LoggingConfig(
            level=os.getenv('LOG_LEVEL', 'INFO'),
            file=os.getenv('LOG_FILE'),
            cloudwatch_group=os.getenv('CLOUDWATCH_LOG_GROUP'),
            cloudwatch_stream=os.getenv('CLOUDWATCH_LOG_STREAM')
        )

        # 機能フラグ
        self.features = FeatureFlags(
            enable_ocr=os.getenv('ENABLE_OCR', 'true').lower() == 'true',
            enable_thumbnail=os.getenv('ENABLE_THUMBNAIL', 'true').lower() == 'true',
            enable_vector_search=os.getenv('ENABLE_VECTOR_SEARCH', 'true').lower() == 'true'
        )

    def validate(self, require_sqs: bool = True, require_preview_queue: bool = False) -> bool:
        """
        設定の妥当性確認

        Args:
            require_sqs: Main SQS queue URLが必須かどうか
            require_preview_queue: Preview queue URLが必須かどうか

        Returns:
            True if validation passes, False otherwise
        """
        errors = []
        warnings = []

        # Check OpenSearch endpoint (always required)
        if not self.opensearch.endpoint:
            errors.append("OPENSEARCH_ENDPOINT is required (current value is empty)")
        elif not self.opensearch.endpoint.startswith('http'):
            warnings.append(f"OPENSEARCH_ENDPOINT should include protocol (current: {self.opensearch.endpoint})")

        # Check S3 buckets
        if not self.s3.landing_bucket:
            errors.append("S3_LANDING_BUCKET is required")

        if not self.s3.thumbnail_bucket:
            warnings.append("S3_THUMBNAIL_BUCKET is not set, using default")

        # Check SQS queue (conditional)
        if require_sqs and not self.sqs.queue_url:
            errors.append("SQS_QUEUE_URL is required for main worker")

        # Check Preview queue URL from environment
        preview_queue_url = os.getenv('PREVIEW_QUEUE_URL', '')
        if require_preview_queue and not preview_queue_url:
            errors.append("PREVIEW_QUEUE_URL is required for preview worker")

        # Log all findings
        for warning in warnings:
            logger.warning(f"Configuration Warning: {warning}")

        if errors:
            for error in errors:
                logger.error(f"Configuration Error: {error}")

            # Print environment debug info
            logger.error("=" * 60)
            logger.error("Environment Debug Information:")
            logger.error(f"  OPENSEARCH_ENDPOINT: '{self.opensearch.endpoint}'")
            logger.error(f"  S3_LANDING_BUCKET: '{self.s3.landing_bucket}'")
            logger.error(f"  S3_THUMBNAIL_BUCKET: '{self.s3.thumbnail_bucket}'")
            logger.error(f"  SQS_QUEUE_URL: '{self.sqs.queue_url}'")
            logger.error(f"  PREVIEW_QUEUE_URL: '{preview_queue_url}'")
            logger.error(f"  AWS_REGION: '{self.aws.region}'")
            logger.error("=" * 60)
            return False

        logger.info("Configuration validation passed")
        return True

    def print_config_summary(self):
        """Print a summary of the current configuration (for debugging)"""
        preview_queue_url = os.getenv('PREVIEW_QUEUE_URL', 'NOT SET')
        logger.info("=" * 60)
        logger.info("Configuration Summary:")
        logger.info(f"  AWS Region: {self.aws.region}")
        logger.info(f"  S3 Landing Bucket: {self.s3.landing_bucket}")
        logger.info(f"  S3 Thumbnail Bucket: {self.s3.thumbnail_bucket}")
        logger.info(f"  OpenSearch Endpoint: {self.opensearch.endpoint[:50]}..." if len(self.opensearch.endpoint) > 50 else f"  OpenSearch Endpoint: {self.opensearch.endpoint}")
        logger.info(f"  OpenSearch Index: {self.opensearch.index_name}")
        logger.info(f"  OpenSearch AWS Auth: {self.opensearch.use_aws_auth}")
        logger.info(f"  SQS Queue URL: {self.sqs.queue_url[:50]}..." if len(self.sqs.queue_url) > 50 else f"  SQS Queue URL: {self.sqs.queue_url}")
        logger.info(f"  Preview Queue URL: {preview_queue_url[:50]}..." if len(preview_queue_url) > 50 else f"  Preview Queue URL: {preview_queue_url}")
        logger.info(f"  Worker Threads: {self.worker.threads}")
        logger.info(f"  Preview Enabled: {self.preview.enabled}")
        logger.info("=" * 60)

    def get_boto3_config(self) -> dict:
        """
        Boto3クライアント用の設定を取得

        ✅ SECURITY: EC2上ではIAMロールを使用（認証情報不要）
        """
        config = {
            'region_name': self.aws.region
        }

        # EC2 IAM roleを使用する場合は認証情報を指定しない
        # boto3が自動的にInstance Metadata Serviceから取得

        return config


# グローバル設定インスタンス
config = Config()