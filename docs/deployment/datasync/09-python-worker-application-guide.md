# 🐍 CIS File Search - Python Worker Application実装ガイド

## 🎯 概要

このガイドでは、EC2インスタンス上で動作するPython Workerアプリケーションの完全な実装を提供します。SQSメッセージの処理、Tesseract OCRによるテキスト抽出、各種ファイル形式の対応を含みます。

## 📁 プロジェクト構造

```
/var/app/cis-file-processor/
├── main.py                 # メインエントリーポイント
├── config.py              # 設定管理
├── processors/
│   ├── __init__.py
│   ├── base.py           # 基底プロセッサクラス
│   ├── pdf_processor.py  # PDF処理
│   ├── image_processor.py # 画像処理（OCR）
│   ├── office_processor.py # Office文書処理
│   └── text_processor.py  # テキストファイル処理
├── services/
│   ├── __init__.py
│   ├── sqs_service.py    # SQS操作
│   ├── s3_service.py     # S3操作
│   ├── opensearch_service.py # OpenSearch索引
│   └── metrics_service.py # CloudWatchメトリクス
├── utils/
│   ├── __init__.py
│   ├── logger.py         # ロギング設定
│   └── exceptions.py     # カスタム例外
├── requirements.txt       # 依存パッケージ
└── tests/                # テストコード
```

## 🔧 実装コード

### 1. メインエントリーポイント (`main.py`)

```python
#!/usr/bin/env python3
"""
CIS File Processor - Main Entry Point
SQSメッセージを処理し、ファイルからテキストを抽出してOpenSearchに索引付けする
"""

import os
import sys
import signal
import time
import json
import threading
from typing import Optional, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
import structlog

from config import Config
from services.sqs_service import SQSService
from services.s3_service import S3Service
from services.opensearch_service import OpenSearchService
from services.metrics_service import MetricsService
from processors import ProcessorFactory
from utils.logger import setup_logging

# ロガー設定
logger = setup_logging()

class FileProcessor:
    """メインのファイル処理クラス"""

    def __init__(self):
        self.config = Config()
        self.sqs_service = SQSService(self.config)
        self.s3_service = S3Service(self.config)
        self.opensearch_service = OpenSearchService(self.config)
        self.metrics_service = MetricsService(self.config)
        self.processor_factory = ProcessorFactory()

        self.shutdown_event = threading.Event()
        self.executor = ThreadPoolExecutor(
            max_workers=self.config.MAX_WORKERS
        )

        # グレースフルシャットダウン設定
        signal.signal(signal.SIGTERM, self._shutdown_handler)
        signal.signal(signal.SIGINT, self._shutdown_handler)

        logger.info("File Processor initialized",
                   config=self.config.to_dict())

    def _shutdown_handler(self, signum, frame):
        """シャットダウンハンドラー"""
        logger.info(f"Received signal {signum}, initiating shutdown...")
        self.shutdown_event.set()

    def run(self):
        """メイン処理ループ"""
        logger.info("Starting File Processor...")

        while not self.shutdown_event.is_set():
            try:
                # SQSからメッセージを取得
                messages = self.sqs_service.receive_messages(
                    max_messages=10,
                    wait_time=20  # ロングポーリング
                )

                if not messages:
                    continue

                # 並列処理
                futures = []
                for message in messages:
                    future = self.executor.submit(
                        self.process_message, message
                    )
                    futures.append((future, message))

                # 結果を待つ
                for future, message in futures:
                    try:
                        future.result(timeout=self.config.PROCESSING_TIMEOUT)
                    except Exception as e:
                        logger.error("Failed to process message",
                                   error=str(e),
                                   message_id=message.get('MessageId'))
                        self.metrics_service.record_error('processing_error')

            except Exception as e:
                logger.error("Error in main loop", error=str(e))
                self.metrics_service.record_error('main_loop_error')
                time.sleep(5)  # エラー時は少し待つ

        self._cleanup()

    def process_message(self, message: Dict[str, Any]):
        """個別メッセージの処理"""
        message_id = message.get('MessageId')
        receipt_handle = message.get('ReceiptHandle')

        try:
            # メッセージボディをパース
            body = json.loads(message.get('Body', '{}'))

            # EventBridge経由のS3イベント処理
            if 'detail' in body:
                s3_event = body['detail']
                bucket = s3_event['bucket']['name']
                key = s3_event['object']['key']
            else:
                # 直接のS3イベント
                records = json.loads(body).get('Records', [])
                if not records:
                    logger.warning("No S3 records in message",
                                 message_id=message_id)
                    self.sqs_service.delete_message(receipt_handle)
                    return

                s3_info = records[0]['s3']
                bucket = s3_info['bucket']['name']
                key = s3_info['object']['key']

            logger.info("Processing file",
                       bucket=bucket,
                       key=key,
                       message_id=message_id)

            # 処理開始時間を記録
            start_time = time.time()
            self.metrics_service.record_metric('files_processing', 1)

            # ファイルを処理
            result = self.process_file(bucket, key)

            # OpenSearchに索引付け
            if result['success']:
                self.opensearch_service.index_document(result['document'])

                # 処理済みファイルを移動
                self.s3_service.move_to_processed(bucket, key)

                # 成功メトリクス
                processing_time = time.time() - start_time
                self.metrics_service.record_metric(
                    'processing_time',
                    processing_time
                )
                self.metrics_service.record_metric('files_processed', 1)

                logger.info("File processed successfully",
                          bucket=bucket,
                          key=key,
                          processing_time=processing_time)
            else:
                # エラーファイルを別の場所に移動
                self.s3_service.move_to_error(bucket, key)
                self.metrics_service.record_metric('files_failed', 1)

                logger.error("File processing failed",
                           bucket=bucket,
                           key=key,
                           error=result.get('error'))

            # メッセージを削除
            self.sqs_service.delete_message(receipt_handle)

        except Exception as e:
            logger.error("Error processing message",
                       error=str(e),
                       message_id=message_id)

            # エラーカウントを増やす
            error_count = int(message.get('Attributes', {})
                            .get('ApproximateReceiveCount', 0))

            if error_count >= self.config.MAX_RETRIES:
                # DLQに移動させるためメッセージを削除
                logger.error("Max retries exceeded, moving to DLQ",
                           message_id=message_id,
                           error_count=error_count)
                self.sqs_service.delete_message(receipt_handle)

            raise

    def process_file(self, bucket: str, key: str) -> Dict[str, Any]:
        """ファイル処理のメイン関数"""
        try:
            # ファイルをダウンロード
            local_path = self.s3_service.download_file(bucket, key)

            # ファイルタイプを判定
            file_extension = os.path.splitext(key)[1].lower()

            # 適切なプロセッサを取得
            processor = self.processor_factory.get_processor(file_extension)

            # テキスト抽出
            extracted_text = processor.extract_text(local_path)

            # メタデータ取得
            metadata = self.s3_service.get_object_metadata(bucket, key)

            # ドキュメント作成
            document = {
                'id': f"{bucket}/{key}",
                'bucket': bucket,
                'key': key,
                'file_name': os.path.basename(key),
                'file_path': key,
                'file_size': metadata.get('ContentLength', 0),
                'file_type': file_extension,
                'content': extracted_text,
                'last_modified': metadata.get('LastModified'),
                'indexed_at': time.time(),
                'metadata': {
                    'content_type': metadata.get('ContentType'),
                    'etag': metadata.get('ETag'),
                    'storage_class': metadata.get('StorageClass')
                }
            }

            # クリーンアップ
            if os.path.exists(local_path):
                os.remove(local_path)

            return {
                'success': True,
                'document': document
            }

        except Exception as e:
            logger.error("Error processing file",
                       bucket=bucket,
                       key=key,
                       error=str(e))
            return {
                'success': False,
                'error': str(e)
            }

    def _cleanup(self):
        """クリーンアップ処理"""
        logger.info("Shutting down executor...")
        self.executor.shutdown(wait=True, timeout=30)

        logger.info("Closing connections...")
        self.opensearch_service.close()

        logger.info("File Processor stopped")

def main():
    """エントリーポイント"""
    processor = FileProcessor()
    processor.run()

if __name__ == "__main__":
    main()
```

### 2. 設定管理 (`config.py`)

```python
"""設定管理モジュール"""

import os
import json
from dataclasses import dataclass
from typing import Optional

@dataclass
class Config:
    """アプリケーション設定"""

    # AWS設定
    AWS_REGION: str = os.environ.get('AWS_REGION', 'ap-northeast-1')

    # SQS設定
    SQS_QUEUE_URL: str = os.environ.get(
        'SQS_QUEUE_URL',
        'https://sqs.ap-northeast-1.amazonaws.com/123456789012/CIS-FileProcessing-Queue'
    )
    SQS_DLQ_URL: str = os.environ.get(
        'SQS_DLQ_URL',
        'https://sqs.ap-northeast-1.amazonaws.com/123456789012/CIS-FileProcessing-DLQ'
    )

    # S3設定
    S3_LANDING_BUCKET: str = os.environ.get(
        'S3_LANDING_BUCKET',
        'cis-filesearch-landing'
    )
    S3_PROCESSED_BUCKET: str = os.environ.get(
        'S3_PROCESSED_BUCKET',
        'cis-filesearch-processed'
    )
    S3_ERROR_BUCKET: str = os.environ.get(
        'S3_ERROR_BUCKET',
        'cis-filesearch-error'
    )

    # OpenSearch設定
    OPENSEARCH_ENDPOINT: str = os.environ.get(
        'OPENSEARCH_ENDPOINT',
        'https://search-cis-filesearch.ap-northeast-1.es.amazonaws.com'
    )
    OPENSEARCH_INDEX: str = os.environ.get(
        'OPENSEARCH_INDEX',
        'cis-files'
    )

    # 処理設定
    MAX_WORKERS: int = int(os.environ.get('MAX_WORKERS', '4'))
    MAX_RETRIES: int = int(os.environ.get('MAX_RETRIES', '3'))
    PROCESSING_TIMEOUT: int = int(os.environ.get('PROCESSING_TIMEOUT', '300'))

    # Tesseract設定
    TESSERACT_LANG: str = os.environ.get('TESSERACT_LANG', 'jpn+eng')
    TESSERACT_CONFIG: str = os.environ.get('TESSERACT_CONFIG', '--psm 3')

    # ログ設定
    LOG_LEVEL: str = os.environ.get('LOG_LEVEL', 'INFO')

    def to_dict(self) -> dict:
        """設定を辞書として返す"""
        return {
            key: getattr(self, key)
            for key in dir(self)
            if key.isupper()
        }

    @classmethod
    def from_json(cls, json_path: str) -> 'Config':
        """JSONファイルから設定を読み込む"""
        with open(json_path, 'r') as f:
            config_dict = json.load(f)

        config = cls()
        for key, value in config_dict.items():
            if hasattr(config, key):
                setattr(config, key, value)

        return config
```

### 3. PDF処理 (`processors/pdf_processor.py`)

```python
"""PDF処理モジュール"""

import os
import tempfile
from typing import Optional
import structlog
import PyPDF2
import pdfplumber
from pdf2image import convert_from_path
import pytesseract

from .base import BaseProcessor

logger = structlog.get_logger()

class PDFProcessor(BaseProcessor):
    """PDF処理クラス"""

    def extract_text(self, file_path: str) -> str:
        """PDFからテキストを抽出"""
        text = ""

        try:
            # まずpdfplumberで試す（日本語対応が良い）
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"

            # テキストが抽出できない場合はOCRを試す
            if not text.strip():
                logger.info("No text found, trying OCR",
                          file_path=file_path)
                text = self._extract_with_ocr(file_path)

            return text.strip()

        except Exception as e:
            logger.error("Error processing PDF",
                       file_path=file_path,
                       error=str(e))

            # フォールバックとしてPyPDF2を試す
            try:
                return self._extract_with_pypdf2(file_path)
            except Exception as e2:
                logger.error("Fallback PDF processing failed",
                           file_path=file_path,
                           error=str(e2))
                raise

    def _extract_with_ocr(self, file_path: str) -> str:
        """OCRでPDFからテキストを抽出"""
        text = ""

        with tempfile.TemporaryDirectory() as temp_dir:
            # PDFを画像に変換
            images = convert_from_path(
                file_path,
                dpi=300,
                output_folder=temp_dir
            )

            # 各ページをOCR処理
            for i, image in enumerate(images):
                logger.info(f"Processing page {i+1}/{len(images)} with OCR")

                # Tesseract OCRでテキスト抽出
                page_text = pytesseract.image_to_string(
                    image,
                    lang='jpn+eng',
                    config='--psm 3'
                )

                text += f"--- Page {i+1} ---\n{page_text}\n"

        return text

    def _extract_with_pypdf2(self, file_path: str) -> str:
        """PyPDF2でテキスト抽出（フォールバック）"""
        text = ""

        with open(file_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)

            for page_num in range(len(pdf_reader.pages)):
                page = pdf_reader.pages[page_num]
                text += page.extract_text() + "\n"

        return text
```

### 4. 画像処理 (`processors/image_processor.py`)

```python
"""画像処理モジュール（OCR）"""

from PIL import Image
import pytesseract
import cv2
import numpy as np
import structlog

from .base import BaseProcessor

logger = structlog.get_logger()

class ImageProcessor(BaseProcessor):
    """画像処理クラス"""

    SUPPORTED_FORMATS = {
        '.jpg', '.jpeg', '.png', '.gif', '.bmp',
        '.tiff', '.tif', '.webp'
    }

    def extract_text(self, file_path: str) -> str:
        """画像からテキストを抽出"""
        try:
            # 画像を読み込み
            image = cv2.imread(file_path)

            # 前処理
            processed_image = self._preprocess_image(image)

            # Tesseract OCRでテキスト抽出
            text = pytesseract.image_to_string(
                processed_image,
                lang='jpn+eng',
                config='--psm 3 -c preserve_interword_spaces=1'
            )

            # 検出された文字の信頼度を取得
            data = pytesseract.image_to_data(
                processed_image,
                lang='jpn+eng',
                output_type=pytesseract.Output.DICT
            )

            # 信頼度が低い場合は警告
            confidences = [int(conf) for conf in data['conf'] if int(conf) > 0]
            if confidences:
                avg_confidence = sum(confidences) / len(confidences)
                if avg_confidence < 60:
                    logger.warning("Low OCR confidence",
                                 file_path=file_path,
                                 avg_confidence=avg_confidence)

            return text.strip()

        except Exception as e:
            logger.error("Error processing image",
                       file_path=file_path,
                       error=str(e))
            raise

    def _preprocess_image(self, image: np.ndarray) -> np.ndarray:
        """画像の前処理（OCR精度向上）"""
        # グレースケール変換
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # ノイズ除去
        denoised = cv2.fastNlMeansDenoising(gray)

        # コントラスト改善（CLAHE）
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(denoised)

        # 二値化（Otsu's method）
        _, binary = cv2.threshold(
            enhanced, 0, 255,
            cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )

        # 傾き補正
        corrected = self._deskew(binary)

        return corrected

    def _deskew(self, image: np.ndarray) -> np.ndarray:
        """画像の傾き補正"""
        coords = np.column_stack(np.where(image > 0))
        angle = cv2.minAreaRect(coords)[-1]

        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle

        (h, w) = image.shape[:2]
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        rotated = cv2.warpAffine(
            image, M, (w, h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE
        )

        return rotated
```

### 5. SQSサービス (`services/sqs_service.py`)

```python
"""SQS操作サービス"""

import json
from typing import List, Dict, Any
import boto3
import structlog
from botocore.exceptions import ClientError

logger = structlog.get_logger()

class SQSService:
    """SQS操作を管理するサービスクラス"""

    def __init__(self, config):
        self.config = config
        self.sqs_client = boto3.client('sqs', region_name=config.AWS_REGION)
        self.queue_url = config.SQS_QUEUE_URL

    def receive_messages(self,
                        max_messages: int = 10,
                        wait_time: int = 20) -> List[Dict[str, Any]]:
        """SQSからメッセージを取得"""
        try:
            response = self.sqs_client.receive_message(
                QueueUrl=self.queue_url,
                MaxNumberOfMessages=max_messages,
                WaitTimeSeconds=wait_time,
                AttributeNames=['All'],
                MessageAttributeNames=['All']
            )

            messages = response.get('Messages', [])

            if messages:
                logger.info(f"Received {len(messages)} messages from SQS")

            return messages

        except ClientError as e:
            logger.error("Error receiving messages from SQS",
                       error=str(e))
            raise

    def delete_message(self, receipt_handle: str):
        """メッセージを削除"""
        try:
            self.sqs_client.delete_message(
                QueueUrl=self.queue_url,
                ReceiptHandle=receipt_handle
            )
            logger.debug("Message deleted from SQS")

        except ClientError as e:
            logger.error("Error deleting message from SQS",
                       error=str(e))
            raise

    def send_to_dlq(self, message: Dict[str, Any], error_reason: str):
        """DLQにメッセージを送信"""
        try:
            dlq_message = {
                'original_message': message,
                'error_reason': error_reason,
                'timestamp': time.time()
            }

            self.sqs_client.send_message(
                QueueUrl=self.config.SQS_DLQ_URL,
                MessageBody=json.dumps(dlq_message)
            )

            logger.info("Message sent to DLQ",
                       message_id=message.get('MessageId'))

        except ClientError as e:
            logger.error("Error sending message to DLQ",
                       error=str(e))
            raise
```

### 6. 起動スクリプト (`run.sh`)

```bash
#!/bin/bash
# File Processor起動スクリプト

# 環境変数を設定
export AWS_REGION=${AWS_REGION:-ap-northeast-1}
export LOG_LEVEL=${LOG_LEVEL:-INFO}

# 仮想環境をアクティベート
source /var/app/cis-file-processor/venv/bin/activate

# アプリケーションを起動
cd /var/app/cis-file-processor
python main.py
```

## 📦 依存パッケージ (`requirements.txt`)

```text
# Core
boto3==1.34.0
botocore==1.34.0

# Logging
structlog==24.1.0

# PDF Processing
PyPDF2==3.0.1
pdfplumber==0.10.3
pdf2image==1.16.3

# OCR
pytesseract==0.3.10
Pillow==10.2.0
opencv-python==4.9.0.80
numpy==1.24.3

# Office Documents
python-docx==1.1.0
openpyxl==3.1.2
python-pptx==0.6.23

# OpenSearch
opensearch-py==2.4.2
requests-aws4auth==1.2.3

# Monitoring
prometheus-client==0.19.0

# Testing
pytest==7.4.4
pytest-cov==4.1.0
pytest-mock==3.12.0
moto==4.2.12
```

## 🚀 デプロイメント

### S3へのアップロード

```bash
# アプリケーションをパッケージング
cd /path/to/your/code
tar -czf file-processor.tar.gz *.py processors/ services/ utils/ requirements.txt

# S3にアップロード
aws s3 cp file-processor.tar.gz s3://cis-filesearch-deployment/latest/
aws s3 cp config/processor-config.json s3://cis-filesearch-deployment/config/
```

### EC2 User Dataでの自動デプロイ

User Dataスクリプト内で自動的にS3から最新コードを取得します。

## 📊 モニタリングとメトリクス

### カスタムメトリクス

アプリケーションは以下のメトリクスをCloudWatchに送信：

- `files_processing` - 処理中のファイル数
- `files_processed` - 処理完了ファイル数
- `files_failed` - 処理失敗ファイル数
- `processing_time` - ファイル処理時間
- `ocr_confidence` - OCR信頼度スコア

### ログ出力

構造化ログ（JSON形式）をCloudWatch Logsに送信：

```json
{
  "timestamp": "2024-01-20T10:30:00Z",
  "level": "INFO",
  "message": "File processed successfully",
  "bucket": "cis-filesearch-landing",
  "key": "documents/report.pdf",
  "processing_time": 12.5,
  "file_size": 2048576
}
```

## 🔍 トラブルシューティング

### Tesseract言語パック確認

```bash
tesseract --list-langs
# 出力に jpn と eng が含まれることを確認
```

### Python依存関係の問題

```bash
# 仮想環境の再作成
rm -rf venv
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### メモリ不足エラー

```python
# config.pyで調整
MAX_WORKERS = 2  # ワーカー数を減らす
```

## ✅ テスト

### ユニットテスト実行

```bash
pytest tests/ -v --cov=./ --cov-report=html
```

### 統合テスト

```bash
# テスト用SQSメッセージ送信
aws sqs send-message \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/xxx/CIS-FileProcessing-Queue \
  --message-body '{
    "Records": [{
      "s3": {
        "bucket": {"name": "cis-filesearch-landing"},
        "object": {"key": "test/sample.pdf"}
      }
    }]
  }'
```

## 📚 参考リンク

- [Tesseract OCR Documentation](https://github.com/tesseract-ocr/tesseract/wiki)
- [OpenSearch Python Client](https://opensearch.org/docs/latest/clients/python/)
- [Boto3 Documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html)

## 🚀 次のステップ

Python Workerアプリケーションの実装後は、[10-spot-interruption-handling-guide.md](./10-spot-interruption-handling-guide.md)でSpot Instance中断への対応方法を確認します。