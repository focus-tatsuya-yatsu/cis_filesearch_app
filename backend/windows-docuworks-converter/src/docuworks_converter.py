"""
DocuWorks Converter Service for Windows
DocuWorks SDKを使用してXDW/XBDファイルをPDFに変換

Requirements:
- Windows OS
- DocuWorks Viewer/SDK (Fuji Xerox)
- pywin32 (pip install pywin32)
- boto3 (pip install boto3)
"""

import os
import sys
import logging
import tempfile
import time
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass

# Windows COM support
try:
    import win32com.client
    import pythoncom
    HAS_WIN32COM = True
except ImportError:
    HAS_WIN32COM = False
    print("Warning: pywin32 not installed. Install with: pip install pywin32")

# AWS SDK
import boto3
from botocore.exceptions import ClientError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('docuworks_converter.log', encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)


@dataclass
class ConverterConfig:
    """変換サービス設定"""
    # AWS設定
    aws_region: str = 'ap-northeast-1'
    s3_source_bucket: str = ''        # 変換元ファイルのバケット
    s3_target_bucket: str = ''        # 変換後PDFのバケット
    s3_source_prefix: str = ''        # 変換元ファイルのプレフィックス
    s3_target_prefix: str = 'converted-pdf/'  # 変換後PDFのプレフィックス

    # SQS設定（オプション）
    sqs_queue_url: str = ''           # 変換リクエストキュー

    # ローカル設定
    temp_dir: str = ''                # 一時ファイルディレクトリ
    poll_interval: int = 10           # ポーリング間隔（秒）
    max_file_size_mb: int = 100       # 最大ファイルサイズ

    def __post_init__(self):
        if not self.temp_dir:
            self.temp_dir = tempfile.gettempdir()


class DocuWorksConverter:
    """
    DocuWorks to PDF Converter

    DocuWorks COM APIを使用してXDW/XBDファイルをPDFに変換
    """

    SUPPORTED_EXTENSIONS = {'.xdw', '.xbd'}
    PDF_EXPORT_TYPE = 17  # DocuWorks PDF export type constant

    def __init__(self, config: Optional[ConverterConfig] = None):
        """初期化"""
        self.config = config or ConverterConfig()
        self._dw_app = None

        # Windows環境チェック
        if sys.platform != 'win32':
            raise RuntimeError("DocuWorks converter requires Windows OS")

        if not HAS_WIN32COM:
            raise RuntimeError("pywin32 is required. Install with: pip install pywin32")

        # AWS clients
        self.s3_client = boto3.client('s3', region_name=self.config.aws_region)
        if self.config.sqs_queue_url:
            self.sqs_client = boto3.client('sqs', region_name=self.config.aws_region)
        else:
            self.sqs_client = None

        logger.info("DocuWorksConverter initialized")

    def _init_docuworks(self) -> bool:
        """DocuWorks COMオブジェクトを初期化"""
        try:
            pythoncom.CoInitialize()
            self._dw_app = win32com.client.Dispatch("DocuWorks.Application")
            logger.info("DocuWorks COM object initialized successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to initialize DocuWorks: {e}")
            logger.error("Please ensure DocuWorks is installed and licensed")
            return False

    def _cleanup_docuworks(self):
        """DocuWorks COMオブジェクトをクリーンアップ"""
        try:
            if self._dw_app:
                self._dw_app.Quit()
                self._dw_app = None
            pythoncom.CoUninitialize()
        except Exception as e:
            logger.warning(f"Error during DocuWorks cleanup: {e}")

    def convert_to_pdf(self, input_path: str, output_path: Optional[str] = None) -> Optional[str]:
        """
        DocuWorksファイルをPDFに変換

        Args:
            input_path: 入力XDW/XBDファイルパス
            output_path: 出力PDFパス（省略時は自動生成）

        Returns:
            生成されたPDFのパス、失敗時はNone
        """
        input_path = Path(input_path)

        if not input_path.exists():
            logger.error(f"Input file not found: {input_path}")
            return None

        if input_path.suffix.lower() not in self.SUPPORTED_EXTENSIONS:
            logger.error(f"Unsupported file type: {input_path.suffix}")
            return None

        # 出力パス設定
        if output_path is None:
            output_path = input_path.with_suffix('.pdf')
        output_path = Path(output_path)

        try:
            # DocuWorks初期化
            if not self._init_docuworks():
                return None

            logger.info(f"Converting: {input_path.name} -> {output_path.name}")

            # ドキュメントを開く
            doc = self._dw_app.Documents.Open(str(input_path))

            try:
                # PDFとして保存
                doc.SaveAs(str(output_path), self.PDF_EXPORT_TYPE)
                logger.info(f"Successfully converted to PDF: {output_path}")

            finally:
                # ドキュメントを閉じる
                doc.Close()

            if output_path.exists():
                return str(output_path)
            else:
                logger.error("PDF file was not created")
                return None

        except Exception as e:
            logger.error(f"Conversion failed: {e}")
            return None

        finally:
            self._cleanup_docuworks()

    def get_page_count(self, input_path: str) -> int:
        """DocuWorksファイルのページ数を取得"""
        input_path = Path(input_path)

        if not input_path.exists():
            return 0

        try:
            if not self._init_docuworks():
                return 0

            doc = self._dw_app.Documents.Open(str(input_path))
            try:
                page_count = doc.Pages.Count
                return page_count
            finally:
                doc.Close()

        except Exception as e:
            logger.error(f"Failed to get page count: {e}")
            return 0

        finally:
            self._cleanup_docuworks()

    def download_from_s3(self, s3_key: str, local_path: str) -> bool:
        """S3からファイルをダウンロード"""
        try:
            self.s3_client.download_file(
                self.config.s3_source_bucket,
                s3_key,
                local_path
            )
            logger.info(f"Downloaded from S3: {s3_key}")
            return True
        except ClientError as e:
            logger.error(f"S3 download failed: {e}")
            return False

    def upload_to_s3(self, local_path: str, s3_key: str) -> bool:
        """S3にファイルをアップロード"""
        try:
            self.s3_client.upload_file(
                local_path,
                self.config.s3_target_bucket,
                s3_key,
                ExtraArgs={'ContentType': 'application/pdf'}
            )
            logger.info(f"Uploaded to S3: {s3_key}")
            return True
        except ClientError as e:
            logger.error(f"S3 upload failed: {e}")
            return False

    def process_s3_file(self, s3_key: str) -> Optional[str]:
        """
        S3上のDocuWorksファイルを処理

        Args:
            s3_key: S3オブジェクトキー

        Returns:
            変換後のS3キー、失敗時はNone
        """
        file_name = Path(s3_key).name
        local_input = Path(self.config.temp_dir) / file_name
        local_output = local_input.with_suffix('.pdf')

        try:
            # S3からダウンロード
            if not self.download_from_s3(s3_key, str(local_input)):
                return None

            # PDF変換
            pdf_path = self.convert_to_pdf(str(local_input), str(local_output))
            if not pdf_path:
                return None

            # S3にアップロード
            output_key = f"{self.config.s3_target_prefix}{Path(file_name).stem}.pdf"
            if not self.upload_to_s3(pdf_path, output_key):
                return None

            logger.info(f"Successfully processed: {s3_key} -> {output_key}")
            return output_key

        finally:
            # ローカルファイルをクリーンアップ
            for path in [local_input, local_output]:
                try:
                    if path.exists():
                        path.unlink()
                except Exception:
                    pass

    def process_sqs_message(self, message: Dict[str, Any]) -> bool:
        """
        SQSメッセージを処理

        Expected message format:
        {
            "s3_key": "path/to/file.xdw",
            "request_id": "uuid",
            "callback_queue": "optional_callback_queue_url"
        }
        """
        try:
            import json
            body = json.loads(message.get('Body', '{}'))

            s3_key = body.get('s3_key')
            if not s3_key:
                logger.error("Missing s3_key in message")
                return False

            result = self.process_s3_file(s3_key)

            # コールバック通知（オプション）
            callback_queue = body.get('callback_queue')
            if callback_queue and result:
                try:
                    self.sqs_client.send_message(
                        QueueUrl=callback_queue,
                        MessageBody=json.dumps({
                            'request_id': body.get('request_id'),
                            'status': 'completed',
                            'original_key': s3_key,
                            'converted_key': result
                        })
                    )
                except Exception as e:
                    logger.warning(f"Failed to send callback: {e}")

            return result is not None

        except Exception as e:
            logger.error(f"Failed to process SQS message: {e}")
            return False

    def run_service(self):
        """
        変換サービスをメインループとして実行

        SQSキューからメッセージを受信し、変換処理を行う
        """
        if not self.config.sqs_queue_url:
            logger.error("SQS queue URL not configured")
            return

        logger.info("Starting DocuWorks conversion service...")
        logger.info(f"Polling queue: {self.config.sqs_queue_url}")

        while True:
            try:
                # SQSからメッセージ受信
                response = self.sqs_client.receive_message(
                    QueueUrl=self.config.sqs_queue_url,
                    MaxNumberOfMessages=1,
                    WaitTimeSeconds=20,  # Long polling
                    VisibilityTimeout=300  # 5分
                )

                messages = response.get('Messages', [])

                for message in messages:
                    receipt_handle = message['ReceiptHandle']

                    try:
                        # メッセージ処理
                        success = self.process_sqs_message(message)

                        if success:
                            # 処理成功時はメッセージを削除
                            self.sqs_client.delete_message(
                                QueueUrl=self.config.sqs_queue_url,
                                ReceiptHandle=receipt_handle
                            )
                            logger.info("Message processed and deleted")
                        else:
                            logger.warning("Message processing failed, will be retried")

                    except Exception as e:
                        logger.error(f"Error processing message: {e}")

                if not messages:
                    logger.debug(f"No messages, waiting {self.config.poll_interval}s...")
                    time.sleep(self.config.poll_interval)

            except KeyboardInterrupt:
                logger.info("Shutting down...")
                break
            except Exception as e:
                logger.error(f"Service error: {e}")
                time.sleep(self.config.poll_interval)


def main():
    """メイン関数"""
    import argparse

    parser = argparse.ArgumentParser(description='DocuWorks to PDF Converter')
    parser.add_argument('--mode', choices=['service', 'single'], default='service',
                       help='Execution mode: service (SQS polling) or single (single file)')
    parser.add_argument('--input', '-i', help='Input file path (single mode)')
    parser.add_argument('--output', '-o', help='Output file path (single mode)')
    parser.add_argument('--s3-key', help='S3 key to process (single mode)')

    args = parser.parse_args()

    # 環境変数から設定を読み込み
    config = ConverterConfig(
        aws_region=os.environ.get('AWS_REGION', 'ap-northeast-1'),
        s3_source_bucket=os.environ.get('S3_SOURCE_BUCKET', ''),
        s3_target_bucket=os.environ.get('S3_TARGET_BUCKET', ''),
        s3_source_prefix=os.environ.get('S3_SOURCE_PREFIX', ''),
        s3_target_prefix=os.environ.get('S3_TARGET_PREFIX', 'converted-pdf/'),
        sqs_queue_url=os.environ.get('SQS_QUEUE_URL', ''),
        poll_interval=int(os.environ.get('POLL_INTERVAL', '10')),
    )

    converter = DocuWorksConverter(config)

    if args.mode == 'single':
        if args.input:
            # ローカルファイル変換
            result = converter.convert_to_pdf(args.input, args.output)
            if result:
                print(f"Converted: {result}")
                sys.exit(0)
            else:
                print("Conversion failed")
                sys.exit(1)
        elif args.s3_key:
            # S3ファイル変換
            result = converter.process_s3_file(args.s3_key)
            if result:
                print(f"Converted: {result}")
                sys.exit(0)
            else:
                print("Conversion failed")
                sys.exit(1)
        else:
            print("Error: --input or --s3-key required for single mode")
            sys.exit(1)
    else:
        # サービスモード
        converter.run_service()


if __name__ == '__main__':
    main()
