"""
Configuration Management for CIS File Processor Worker - OPTIMIZED VERSION
パフォーマンス最適化版の設定
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
    """SQSキュー設定 - 最適化版"""
    queue_url: str
    visibility_timeout: int
    max_messages: int
    # ✅ NEW: 並列受信リクエスト数
    parallel_fetch_count: int


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
    """Worker設定 - 最適化版"""
    threads: int
    batch_size: int
    poll_interval: int
    shutdown_timeout: int = 30
    # ✅ NEW: 動的スレッド数調整
    auto_scale_threads: bool = True
    # ✅ NEW: メモリ制限（MB）
    max_memory_mb: int = 3072  # t3.mediumの4GBのうち3GB使用可能


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


@dataclass
class PerformanceConfig:
    """✅ NEW: パフォーマンス最適化設定"""
    # 目標処理速度（メッセージ/分）
    target_messages_per_minute: int = 500

    # 統計ログ出力間隔（秒）
    stats_log_interval: int = 30

    # メモリ使用量チェック間隔（秒）
    memory_check_interval: int = 60

    # メモリ使用率警告閾値（%）
    memory_warning_threshold: int = 80

    # 処理タイムアウトの動的調整を有効化
    dynamic_timeout: bool = True

    # バッチ処理の最大待機時間（秒）
    max_batch_wait_time: int = 2


class Config:
    """アプリケーション設定 - 最適化版"""

    def __init__(self):
        """設定の初期化"""
        # AWS設定
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

        # ✅ OPTIMIZED: SQS設定
        self.sqs = SQSConfig(
            queue_url=os.getenv('SQS_QUEUE_URL', ''),
            # VisibilityTimeoutを短縮（処理が早い場合は60秒で十分）
            visibility_timeout=int(os.getenv('SQS_VISIBILITY_TIMEOUT', '120')),
            max_messages=int(os.getenv('SQS_MAX_MESSAGES', '10')),
            # 並列受信リクエスト数（3リクエスト並列 = 最大30メッセージ同時取得）
            parallel_fetch_count=int(os.getenv('SQS_PARALLEL_FETCH', '3'))
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

        # ✅ OPTIMIZED: Worker設定
        self.worker = WorkerConfig(
            # スレッド数を増加（t3.mediumで8-12推奨）
            threads=int(os.getenv('WORKER_THREADS', '10')),
            batch_size=int(os.getenv('WORKER_BATCH_SIZE', '30')),  # 10 → 30に増加
            # ポーリング間隔を短縮（メッセージがある限り待機なし）
            poll_interval=int(os.getenv('WORKER_POLL_INTERVAL', '1')),
            auto_scale_threads=os.getenv('WORKER_AUTO_SCALE', 'true').lower() == 'true'
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

        # ✅ NEW: パフォーマンス最適化設定
        self.performance = PerformanceConfig(
            target_messages_per_minute=int(os.getenv('TARGET_MSG_PER_MIN', '500')),
            stats_log_interval=int(os.getenv('STATS_LOG_INTERVAL', '30')),
            memory_check_interval=int(os.getenv('MEMORY_CHECK_INTERVAL', '60')),
            memory_warning_threshold=int(os.getenv('MEMORY_WARNING_THRESHOLD', '80')),
            dynamic_timeout=os.getenv('DYNAMIC_TIMEOUT', 'true').lower() == 'true',
            max_batch_wait_time=int(os.getenv('MAX_BATCH_WAIT_TIME', '2'))
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

        # ✅ NEW: パフォーマンス設定の検証
        if self.worker.threads < 1:
            errors.append("WORKER_THREADS must be >= 1")

        if self.worker.threads > 20:
            errors.append(f"WORKER_THREADS={self.worker.threads} is too high (max recommended: 20)")

        if self.sqs.visibility_timeout < 60:
            errors.append(f"SQS_VISIBILITY_TIMEOUT={self.sqs.visibility_timeout} is too short (min: 60)")

        if errors:
            for error in errors:
                print(f"Configuration Error: {error}")
            return False

        return True

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

    def get_optimal_thread_count(self) -> int:
        """
        ✅ NEW: システムリソースに基づいた最適なスレッド数を計算

        Returns:
            最適なスレッド数
        """
        import psutil
        from multiprocessing import cpu_count

        if not self.worker.auto_scale_threads:
            return self.worker.threads

        # CPU数に基づく計算
        cpu_cores = cpu_count()
        cpu_based_threads = cpu_cores * 4  # I/O bound処理のため CPU x 4

        # メモリに基づく計算
        # 1スレッドあたり約300MB使用と仮定
        available_memory_mb = psutil.virtual_memory().available / (1024 * 1024)
        memory_based_threads = int(available_memory_mb / 300)

        # 設定値、CPU、メモリベースの最小値を採用（安全マージン）
        optimal = min(
            self.worker.threads,
            cpu_based_threads,
            memory_based_threads,
            20  # 絶対最大値
        )

        return max(optimal, 1)  # 最低1スレッドは確保


# グローバル設定インスタンス
config = Config()
