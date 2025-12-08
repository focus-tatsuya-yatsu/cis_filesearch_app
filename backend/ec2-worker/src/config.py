"""
Configuration Management for CIS File Processor Worker
"""

import os
from dataclasses import dataclass
from typing import Optional
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


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
        self.aws = AWSConfig(
            region=os.getenv('AWS_REGION', 'ap-northeast-1'),
            access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY')
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

    def validate(self) -> bool:
        """設定の妥当性確認"""
        errors = []

        # 必須項目の確認
        if not self.sqs.queue_url:
            errors.append("SQS_QUEUE_URL is required")

        if not self.opensearch.endpoint:
            errors.append("OPENSEARCH_ENDPOINT is required")

        if not self.s3.landing_bucket:
            errors.append("S3_LANDING_BUCKET is required")

        if errors:
            for error in errors:
                print(f"Configuration Error: {error}")
            return False

        return True

    def get_boto3_config(self) -> dict:
        """Boto3クライアント用の設定を取得"""
        config = {
            'region_name': self.aws.region
        }

        if self.aws.access_key_id and self.aws.secret_access_key:
            config['aws_access_key_id'] = self.aws.access_key_id
            config['aws_secret_access_key'] = self.aws.secret_access_key

        return config


# グローバル設定インスタンス
config = Config()