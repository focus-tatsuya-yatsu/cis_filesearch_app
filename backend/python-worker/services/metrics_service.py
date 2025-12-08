"""
Metrics and Monitoring Service
CloudWatch Metricsへのメトリクス送信と構造化ログ
"""

import logging
import json
from typing import Dict, Any, List, Optional
from datetime import datetime
from dataclasses import dataclass, asdict
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


@dataclass
class ProcessingMetrics:
    """処理メトリクス"""

    # 処理統計
    files_processed: int = 0
    files_succeeded: int = 0
    files_failed: int = 0

    # 処理時間
    total_processing_time_seconds: float = 0.0
    avg_processing_time_seconds: float = 0.0

    # ファイルサイズ
    total_bytes_processed: int = 0
    avg_file_size_bytes: int = 0

    # ファイルタイプ別
    files_by_type: Dict[str, int] = None

    # エラー統計
    errors_by_type: Dict[str, int] = None

    # OCR統計
    ocr_used_count: int = 0
    avg_ocr_confidence: Optional[float] = None

    def __post_init__(self):
        if self.files_by_type is None:
            self.files_by_type = {}
        if self.errors_by_type is None:
            self.errors_by_type = {}

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class StructuredLogger:
    """
    構造化ログ出力
    JSON形式でログを出力し、CloudWatch Logs Insightsでクエリ可能にする
    """

    def __init__(self, name: str):
        self.logger = logging.getLogger(name)

    def log_structured(
        self,
        level: str,
        message: str,
        **kwargs
    ):
        """
        構造化ログを出力

        Args:
            level: ログレベル (INFO, WARNING, ERROR, etc.)
            message: ログメッセージ
            **kwargs: 追加の構造化データ
        """
        log_entry = {
            'timestamp': datetime.utcnow().isoformat(),
            'level': level,
            'message': message,
            **kwargs
        }

        log_func = getattr(self.logger, level.lower(), self.logger.info)
        log_func(json.dumps(log_entry, ensure_ascii=False))

    def log_processing_start(
        self,
        file_key: str,
        file_size: int,
        file_type: str
    ):
        """処理開始ログ"""
        self.log_structured(
            'INFO',
            'Processing started',
            event='processing_start',
            file_key=file_key,
            file_size=file_size,
            file_type=file_type,
        )

    def log_processing_success(
        self,
        file_key: str,
        processing_time_seconds: float,
        char_count: int,
        processor_name: str
    ):
        """処理成功ログ"""
        self.log_structured(
            'INFO',
            'Processing succeeded',
            event='processing_success',
            file_key=file_key,
            processing_time_seconds=processing_time_seconds,
            char_count=char_count,
            processor_name=processor_name,
        )

    def log_processing_failure(
        self,
        file_key: str,
        error_type: str,
        error_message: str,
        retry_count: int
    ):
        """処理失敗ログ"""
        self.log_structured(
            'ERROR',
            'Processing failed',
            event='processing_failure',
            file_key=file_key,
            error_type=error_type,
            error_message=error_message,
            retry_count=retry_count,
        )

    def log_indexing_success(
        self,
        file_key: str,
        index_name: str,
        document_size: int
    ):
        """インデックス成功ログ"""
        self.log_structured(
            'INFO',
            'Indexing succeeded',
            event='indexing_success',
            file_key=file_key,
            index_name=index_name,
            document_size=document_size,
        )

    def log_resource_usage(
        self,
        cpu_percent: float,
        memory_percent: float,
        disk_percent: float
    ):
        """リソース使用状況ログ"""
        self.log_structured(
            'INFO',
            'Resource usage',
            event='resource_usage',
            cpu_percent=cpu_percent,
            memory_percent=memory_percent,
            disk_percent=disk_percent,
        )


class MetricsService:
    """
    メトリクスサービス
    CloudWatch Metricsへのメトリクス送信
    """

    def __init__(self, config):
        """
        初期化

        Args:
            config: アプリケーション設定
        """
        self.config = config
        self.cloudwatch = boto3.client('cloudwatch', region_name=config.aws.region)
        self.namespace = 'CISFileSearch/Processing'

        # メトリクスバッファ（バッチ送信用）
        self.metrics_buffer: List[Dict[str, Any]] = []
        self.buffer_size_limit = 20  # CloudWatchの1回の送信上限

        logger.info(f"MetricsService initialized (namespace: {self.namespace})")

    def record_processing_success(
        self,
        file_type: str,
        processing_time_seconds: float,
        file_size_bytes: int,
        char_count: int
    ):
        """
        処理成功メトリクスを記録

        Args:
            file_type: ファイルタイプ
            processing_time_seconds: 処理時間
            file_size_bytes: ファイルサイズ
            char_count: 抽出文字数
        """
        timestamp = datetime.utcnow()

        metrics = [
            {
                'MetricName': 'FilesProcessed',
                'Value': 1.0,
                'Unit': 'Count',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'FileType', 'Value': file_type},
                    {'Name': 'Status', 'Value': 'Success'},
                ]
            },
            {
                'MetricName': 'ProcessingTime',
                'Value': processing_time_seconds,
                'Unit': 'Seconds',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'FileType', 'Value': file_type},
                ]
            },
            {
                'MetricName': 'FileSize',
                'Value': file_size_bytes,
                'Unit': 'Bytes',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'FileType', 'Value': file_type},
                ]
            },
            {
                'MetricName': 'ExtractedCharacters',
                'Value': char_count,
                'Unit': 'Count',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'FileType', 'Value': file_type},
                ]
            },
        ]

        self._add_metrics_to_buffer(metrics)

    def record_processing_failure(
        self,
        file_type: str,
        error_type: str,
        retry_count: int
    ):
        """
        処理失敗メトリクスを記録

        Args:
            file_type: ファイルタイプ
            error_type: エラータイプ
            retry_count: リトライ回数
        """
        timestamp = datetime.utcnow()

        metrics = [
            {
                'MetricName': 'FilesProcessed',
                'Value': 1.0,
                'Unit': 'Count',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'FileType', 'Value': file_type},
                    {'Name': 'Status', 'Value': 'Failed'},
                ]
            },
            {
                'MetricName': 'ProcessingErrors',
                'Value': 1.0,
                'Unit': 'Count',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'ErrorType', 'Value': error_type},
                    {'Name': 'FileType', 'Value': file_type},
                ]
            },
            {
                'MetricName': 'RetryCount',
                'Value': float(retry_count),
                'Unit': 'Count',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'FileType', 'Value': file_type},
                ]
            },
        ]

        self._add_metrics_to_buffer(metrics)

    def record_indexing_success(
        self,
        index_name: str,
        document_size: int
    ):
        """
        インデックス成功メトリクスを記録

        Args:
            index_name: インデックス名
            document_size: ドキュメントサイズ
        """
        timestamp = datetime.utcnow()

        metrics = [
            {
                'MetricName': 'DocumentsIndexed',
                'Value': 1.0,
                'Unit': 'Count',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'IndexName', 'Value': index_name},
                    {'Name': 'Status', 'Value': 'Success'},
                ]
            },
            {
                'MetricName': 'DocumentSize',
                'Value': document_size,
                'Unit': 'Bytes',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'IndexName', 'Value': index_name},
                ]
            },
        ]

        self._add_metrics_to_buffer(metrics)

    def record_queue_metrics(
        self,
        messages_received: int,
        messages_deleted: int,
        queue_wait_time_seconds: float
    ):
        """
        SQSキューメトリクスを記録

        Args:
            messages_received: 受信メッセージ数
            messages_deleted: 削除メッセージ数
            queue_wait_time_seconds: キュー待機時間
        """
        timestamp = datetime.utcnow()

        metrics = [
            {
                'MetricName': 'MessagesReceived',
                'Value': float(messages_received),
                'Unit': 'Count',
                'Timestamp': timestamp,
            },
            {
                'MetricName': 'MessagesDeleted',
                'Value': float(messages_deleted),
                'Unit': 'Count',
                'Timestamp': timestamp,
            },
            {
                'MetricName': 'QueueWaitTime',
                'Value': queue_wait_time_seconds,
                'Unit': 'Seconds',
                'Timestamp': timestamp,
            },
        ]

        self._add_metrics_to_buffer(metrics)

    def record_ocr_metrics(
        self,
        language: str,
        confidence: float,
        page_count: int,
        processing_time_seconds: float
    ):
        """
        OCRメトリクスを記録

        Args:
            language: OCR言語
            confidence: 信頼度
            page_count: ページ数
            processing_time_seconds: 処理時間
        """
        timestamp = datetime.utcnow()

        metrics = [
            {
                'MetricName': 'OCRConfidence',
                'Value': confidence,
                'Unit': 'Percent',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'Language', 'Value': language},
                ]
            },
            {
                'MetricName': 'OCRPageCount',
                'Value': float(page_count),
                'Unit': 'Count',
                'Timestamp': timestamp,
            },
            {
                'MetricName': 'OCRProcessingTime',
                'Value': processing_time_seconds,
                'Unit': 'Seconds',
                'Timestamp': timestamp,
                'Dimensions': [
                    {'Name': 'Language', 'Value': language},
                ]
            },
        ]

        self._add_metrics_to_buffer(metrics)

    def _add_metrics_to_buffer(self, metrics: List[Dict[str, Any]]):
        """
        メトリクスをバッファに追加

        Args:
            metrics: メトリクスリスト
        """
        self.metrics_buffer.extend(metrics)

        # バッファが上限に達したらフラッシュ
        if len(self.metrics_buffer) >= self.buffer_size_limit:
            self.flush_metrics()

    def flush_metrics(self) -> bool:
        """
        バッファ内のメトリクスをCloudWatchに送信

        Returns:
            成功した場合True
        """
        if not self.metrics_buffer:
            return True

        try:
            # CloudWatchに送信
            self.cloudwatch.put_metric_data(
                Namespace=self.namespace,
                MetricData=self.metrics_buffer
            )

            logger.debug(f"Sent {len(self.metrics_buffer)} metrics to CloudWatch")

            # バッファをクリア
            self.metrics_buffer.clear()

            return True

        except ClientError as e:
            logger.error(f"Failed to send metrics to CloudWatch: {e}")
            return False

    def get_metric_statistics(
        self,
        metric_name: str,
        start_time: datetime,
        end_time: datetime,
        period: int = 300,
        statistics: List[str] = None
    ) -> Dict[str, Any]:
        """
        メトリクス統計を取得

        Args:
            metric_name: メトリクス名
            start_time: 開始時刻
            end_time: 終了時刻
            period: 集計期間（秒）
            statistics: 統計タイプのリスト

        Returns:
            統計データ
        """
        if statistics is None:
            statistics = ['Average', 'Sum', 'Maximum', 'Minimum']

        try:
            response = self.cloudwatch.get_metric_statistics(
                Namespace=self.namespace,
                MetricName=metric_name,
                StartTime=start_time,
                EndTime=end_time,
                Period=period,
                Statistics=statistics
            )

            return response.get('Datapoints', [])

        except Exception as e:
            logger.error(f"Failed to get metric statistics: {e}")
            return []

    def create_dashboard(self, dashboard_name: str = 'FileProcessingDashboard'):
        """
        CloudWatchダッシュボードを作成

        Args:
            dashboard_name: ダッシュボード名
        """
        dashboard_body = {
            'widgets': [
                {
                    'type': 'metric',
                    'properties': {
                        'metrics': [
                            [self.namespace, 'FilesProcessed', {'stat': 'Sum'}],
                        ],
                        'period': 300,
                        'stat': 'Sum',
                        'region': self.config.aws.region,
                        'title': 'Files Processed',
                    }
                },
                {
                    'type': 'metric',
                    'properties': {
                        'metrics': [
                            [self.namespace, 'ProcessingTime', {'stat': 'Average'}],
                        ],
                        'period': 300,
                        'stat': 'Average',
                        'region': self.config.aws.region,
                        'title': 'Average Processing Time',
                    }
                },
                {
                    'type': 'metric',
                    'properties': {
                        'metrics': [
                            [self.namespace, 'ProcessingErrors', {'stat': 'Sum'}],
                        ],
                        'period': 300,
                        'stat': 'Sum',
                        'region': self.config.aws.region,
                        'title': 'Processing Errors',
                    }
                },
            ]
        }

        try:
            self.cloudwatch.put_dashboard(
                DashboardName=dashboard_name,
                DashboardBody=json.dumps(dashboard_body)
            )

            logger.info(f"CloudWatch dashboard '{dashboard_name}' created")

        except Exception as e:
            logger.error(f"Failed to create dashboard: {e}")

    def __enter__(self):
        """コンテキストマネージャー開始"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """コンテキストマネージャー終了時にフラッシュ"""
        self.flush_metrics()
