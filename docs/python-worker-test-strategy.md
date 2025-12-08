# EC2 Python Worker - Comprehensive Testing Strategy

## Overview

このドキュメントは、EC2 Spot Instances上で動作するPythonワーカーアプリケーションの包括的なテスト戦略を定義します。TDD原則に基づき、80%以上のコードカバレッジを目標とし、堅牢で信頼性の高いシステムを実現します。

## System Architecture Context

### Worker Application Components

```
SQS Message Polling
    ↓
File Download (S3)
    ↓
OCR Processing (Tesseract)
    ↓
Image Vectorization (Bedrock Titan)
    ↓
Thumbnail Generation
    ↓
Data Indexing (OpenSearch + DynamoDB)
    ↓
Message Deletion (SQS)
```

### Testing Scope

- **File Processor**: メインワーカーロジック
- **OCR Engine**: Tesseract統合
- **Bedrock Client**: 画像ベクトル化API
- **Storage Handler**: S3操作
- **Queue Manager**: SQSメッセージング
- **Index Manager**: OpenSearch/DynamoDB操作
- **Spot Handler**: スポットインスタンス中断処理

---

## Test Pyramid Strategy

```
         ┌──────────────┐
        /   E2E Tests    \       5% - Full workflow validation
       /──────────────────\
      / Integration Tests  \    25% - AWS service integration
     /──────────────────────\
    /    Unit Tests         \ 70% - Core logic and functions
   /────────────────────────\
```

### Coverage Goals

| Test Type | Target Coverage | Priority |
|-----------|-----------------|----------|
| Unit Tests | 85%+ | Critical |
| Integration Tests | 80%+ | High |
| E2E Tests | Key workflows 100% | Medium |
| Performance Tests | Load scenarios | High |
| Resilience Tests | Failure scenarios | Critical |

---

## 1. Unit Testing

### 1.1 Testing Framework Setup

**Framework**: pytest with extensive plugin ecosystem

```bash
# requirements-test.txt
pytest==7.4.3
pytest-cov==4.1.0
pytest-asyncio==0.21.1
pytest-mock==3.12.0
pytest-timeout==2.2.0
pytest-xdist==3.5.0  # Parallel execution
moto==4.2.9  # AWS service mocking
boto3-stubs[s3,sqs,dynamodb,opensearch]==1.34.0
mypy==1.7.1
black==23.12.1
pylint==3.0.3
coverage[toml]==7.4.0
```

### 1.2 Test Configuration

**pytest.ini**

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts =
    --verbose
    --strict-markers
    --cov=src
    --cov-report=term-missing
    --cov-report=html
    --cov-report=xml
    --cov-fail-under=80
    --maxfail=5
    --tb=short
    -n auto  # Parallel execution
markers =
    unit: Unit tests
    integration: Integration tests
    e2e: End-to-end tests
    performance: Performance tests
    resilience: Resilience tests
    slow: Slow running tests
timeout = 300
```

**pyproject.toml (coverage configuration)**

```toml
[tool.coverage.run]
source = ["src"]
omit = [
    "*/tests/*",
    "*/test_*.py",
    "*/__pycache__/*",
    "*/site-packages/*",
]
branch = true

[tool.coverage.report]
precision = 2
show_missing = true
skip_covered = false
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "if TYPE_CHECKING:",
    "raise AssertionError",
    "raise NotImplementedError",
    "if __name__ == .__main__.:",
]

[tool.black]
line-length = 100
target-version = ['py311']
include = '\.pyi?$'

[tool.mypy]
python_version = "3.11"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
```

### 1.3 Core Worker Unit Tests

**tests/unit/test_file_processor.py**

```python
"""
Unit tests for the main file processor module.

Tests cover:
- Message processing logic
- File type detection
- Error handling
- Retry mechanisms
"""

import pytest
from unittest.mock import Mock, patch, MagicMock, call
from datetime import datetime
from pathlib import Path
import json

from src.file_processor import FileProcessor, ProcessingError
from src.models import FileMessage, ProcessingResult


class TestFileProcessor:
    """Test suite for FileProcessor class."""

    @pytest.fixture
    def processor(self) -> FileProcessor:
        """Create FileProcessor instance with mocked dependencies."""
        return FileProcessor(
            sqs_client=Mock(),
            s3_client=Mock(),
            bedrock_client=Mock(),
            ocr_engine=Mock(),
            index_manager=Mock(),
        )

    @pytest.fixture
    def sample_message(self) -> FileMessage:
        """Create sample SQS message for testing."""
        return FileMessage(
            event_type="FILE_UPLOADED",
            s3_bucket="cis-filesearch-raw-files-prod",
            s3_key="documents/2025/contract_001.pdf",
            file_size=2048576,
            uploaded_at=datetime.fromisoformat("2025-01-30T12:34:56Z"),
            metadata={
                "original_path": "/NAS/contracts/2025/contract_001.pdf",
                "mime_type": "application/pdf"
            }
        )

    def test_process_message_success_pdf(
        self,
        processor: FileProcessor,
        sample_message: FileMessage
    ) -> None:
        """
        Test successful processing of PDF file.

        Validates:
        - File download from S3
        - OCR text extraction
        - Metadata indexing
        - Message deletion
        """
        # Arrange
        processor.s3_client.download_file.return_value = "/tmp/test_file.pdf"
        processor.ocr_engine.extract_text.return_value = "契約書の内容テキスト"
        processor.index_manager.index_document.return_value = True

        # Act
        result = processor.process_message(sample_message)

        # Assert
        assert result.status == "SUCCESS"
        assert result.ocr_text == "契約書の内容テキスト"
        processor.s3_client.download_file.assert_called_once_with(
            bucket="cis-filesearch-raw-files-prod",
            key="documents/2025/contract_001.pdf",
            local_path="/tmp/test_file.pdf"
        )
        processor.ocr_engine.extract_text.assert_called_once()
        processor.index_manager.index_document.assert_called_once()

    def test_process_message_success_image(
        self,
        processor: FileProcessor
    ) -> None:
        """
        Test successful processing of image file with Bedrock vectorization.

        Validates:
        - Image download
        - Bedrock embedding generation
        - Vector indexing to OpenSearch
        """
        # Arrange
        image_message = FileMessage(
            event_type="FILE_UPLOADED",
            s3_bucket="cis-filesearch-raw-files-prod",
            s3_key="images/photo_001.jpg",
            file_size=1024000,
            uploaded_at=datetime.now(),
            metadata={"mime_type": "image/jpeg"}
        )

        processor.s3_client.download_file.return_value = "/tmp/photo_001.jpg"
        processor.bedrock_client.get_embeddings.return_value = [0.123] * 1024
        processor.index_manager.index_image_vector.return_value = True

        # Act
        result = processor.process_message(image_message)

        # Assert
        assert result.status == "SUCCESS"
        assert len(result.image_vector) == 1024
        processor.bedrock_client.get_embeddings.assert_called_once()
        processor.index_manager.index_image_vector.assert_called_once()

    def test_process_message_ocr_failure(
        self,
        processor: FileProcessor,
        sample_message: FileMessage
    ) -> None:
        """
        Test OCR failure handling with proper error reporting.

        Validates:
        - Exception catching
        - Error logging
        - Status reporting
        """
        # Arrange
        processor.s3_client.download_file.return_value = "/tmp/test_file.pdf"
        processor.ocr_engine.extract_text.side_effect = Exception("OCR failed")

        # Act & Assert
        with pytest.raises(ProcessingError) as exc_info:
            processor.process_message(sample_message)

        assert "OCR failed" in str(exc_info.value)
        assert exc_info.value.retry_allowed is True

    def test_process_message_s3_download_failure(
        self,
        processor: FileProcessor,
        sample_message: FileMessage
    ) -> None:
        """Test S3 download failure with retry logic."""
        # Arrange
        from botocore.exceptions import ClientError
        processor.s3_client.download_file.side_effect = ClientError(
            {"Error": {"Code": "NoSuchKey"}},
            "GetObject"
        )

        # Act & Assert
        with pytest.raises(ProcessingError) as exc_info:
            processor.process_message(sample_message)

        assert exc_info.value.retry_allowed is False  # No retry for missing file

    @pytest.mark.parametrize("file_extension,expected_type", [
        ("pdf", "application/pdf"),
        ("jpg", "image/jpeg"),
        ("png", "image/png"),
        ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("txt", "text/plain"),
    ])
    def test_detect_file_type(
        self,
        processor: FileProcessor,
        file_extension: str,
        expected_type: str
    ) -> None:
        """Test file type detection for various extensions."""
        # Arrange
        file_path = f"/tmp/test_file.{file_extension}"

        # Act
        detected_type = processor.detect_file_type(file_path)

        # Assert
        assert detected_type == expected_type

    def test_validate_message_format_valid(
        self,
        processor: FileProcessor,
        sample_message: FileMessage
    ) -> None:
        """Test message validation with valid input."""
        # Act
        is_valid = processor.validate_message(sample_message)

        # Assert
        assert is_valid is True

    def test_validate_message_format_invalid(
        self,
        processor: FileProcessor
    ) -> None:
        """Test message validation with invalid input."""
        # Arrange
        invalid_message = FileMessage(
            event_type="FILE_UPLOADED",
            s3_bucket="",  # Invalid: empty bucket
            s3_key="documents/test.pdf",
            file_size=0,  # Invalid: zero size
            uploaded_at=datetime.now(),
            metadata={}
        )

        # Act
        is_valid = processor.validate_message(invalid_message)

        # Assert
        assert is_valid is False

    def test_cleanup_temp_files(self, processor: FileProcessor) -> None:
        """Test temporary file cleanup after processing."""
        # Arrange
        temp_file = "/tmp/test_cleanup.pdf"
        Path(temp_file).touch()

        # Act
        processor.cleanup_temp_files([temp_file])

        # Assert
        assert not Path(temp_file).exists()
```

### 1.4 OCR Engine Unit Tests

**tests/unit/test_ocr_engine.py**

```python
"""
Unit tests for OCR processing engine using Tesseract.

Tests cover:
- Text extraction from images
- PDF to text conversion
- Language detection
- Preprocessing optimization
- Error handling
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from PIL import Image
import numpy as np

from src.ocr_engine import OCREngine, OCRError
from src.image_preprocessor import ImagePreprocessor


class TestOCREngine:
    """Test suite for OCR Engine."""

    @pytest.fixture
    def ocr_engine(self) -> OCREngine:
        """Create OCR engine instance."""
        return OCREngine(
            languages=['jpn', 'eng'],
            preprocessor=ImagePreprocessor()
        )

    @pytest.fixture
    def sample_image(self, tmp_path) -> str:
        """Create sample test image."""
        img = Image.new('RGB', (800, 600), color='white')
        img_path = tmp_path / "test_image.jpg"
        img.save(img_path)
        return str(img_path)

    @patch('pytesseract.image_to_string')
    def test_extract_text_from_image_success(
        self,
        mock_tesseract,
        ocr_engine: OCREngine,
        sample_image: str
    ) -> None:
        """Test successful text extraction from image."""
        # Arrange
        expected_text = "これはテストテキストです"
        mock_tesseract.return_value = expected_text

        # Act
        result = ocr_engine.extract_text(sample_image)

        # Assert
        assert result == expected_text
        mock_tesseract.assert_called_once()

    @patch('pytesseract.image_to_string')
    def test_extract_text_with_preprocessing(
        self,
        mock_tesseract,
        ocr_engine: OCREngine,
        sample_image: str
    ) -> None:
        """Test OCR with image preprocessing enabled."""
        # Arrange
        mock_tesseract.return_value = "Enhanced text"

        # Act
        result = ocr_engine.extract_text(
            sample_image,
            preprocess=True
        )

        # Assert
        assert result == "Enhanced text"
        # Verify preprocessing was applied
        assert ocr_engine.preprocessor.last_operations == [
            'grayscale', 'denoise', 'threshold'
        ]

    @patch('pdf2image.convert_from_path')
    @patch('pytesseract.image_to_string')
    def test_extract_text_from_pdf(
        self,
        mock_tesseract,
        mock_convert_pdf,
        ocr_engine: OCREngine,
        tmp_path
    ) -> None:
        """Test text extraction from multi-page PDF."""
        # Arrange
        pdf_path = tmp_path / "test.pdf"
        pdf_path.touch()

        mock_images = [
            Mock(spec=Image.Image),
            Mock(spec=Image.Image),
        ]
        mock_convert_pdf.return_value = mock_images
        mock_tesseract.side_effect = ["Page 1 text", "Page 2 text"]

        # Act
        result = ocr_engine.extract_text_from_pdf(str(pdf_path))

        # Assert
        assert "Page 1 text" in result
        assert "Page 2 text" in result
        assert mock_tesseract.call_count == 2

    @patch('pytesseract.image_to_string')
    def test_extract_text_language_detection(
        self,
        mock_tesseract,
        ocr_engine: OCREngine,
        sample_image: str
    ) -> None:
        """Test automatic language detection."""
        # Arrange
        mock_tesseract.return_value = "日本語テキスト English text"

        # Act
        result = ocr_engine.extract_text(
            sample_image,
            auto_detect_language=True
        )

        # Assert
        assert result == "日本語テキスト English text"
        # Verify both languages were used
        call_args = mock_tesseract.call_args
        assert 'jpn+eng' in str(call_args)

    def test_extract_text_invalid_file(
        self,
        ocr_engine: OCREngine
    ) -> None:
        """Test error handling for invalid file."""
        # Act & Assert
        with pytest.raises(OCRError) as exc_info:
            ocr_engine.extract_text("/nonexistent/file.jpg")

        assert "File not found" in str(exc_info.value)

    @pytest.mark.parametrize("confidence,expected", [
        (95.0, True),
        (85.0, True),
        (50.0, False),
        (30.0, False),
    ])
    def test_validate_ocr_confidence(
        self,
        ocr_engine: OCREngine,
        confidence: float,
        expected: bool
    ) -> None:
        """Test OCR confidence validation."""
        # Act
        is_valid = ocr_engine.validate_confidence(
            confidence,
            threshold=70.0
        )

        # Assert
        assert is_valid == expected
```

### 1.5 Bedrock Client Unit Tests

**tests/unit/test_bedrock_client.py**

```python
"""
Unit tests for Amazon Bedrock API client.

Tests cover:
- Image embedding generation
- API error handling
- Rate limiting
- Retry logic
"""

import pytest
from unittest.mock import Mock, patch
import base64
import json
from botocore.exceptions import ClientError

from src.bedrock_client import BedrockClient, BedrockError


class TestBedrockClient:
    """Test suite for Bedrock Client."""

    @pytest.fixture
    def bedrock_client(self) -> BedrockClient:
        """Create Bedrock client instance."""
        return BedrockClient(
            region='us-east-1',
            model_id='amazon.titan-embed-image-v1'
        )

    @pytest.fixture
    def sample_image_bytes(self) -> bytes:
        """Create sample image data."""
        return b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR...'

    @patch('boto3.client')
    def test_get_embeddings_success(
        self,
        mock_boto_client,
        bedrock_client: BedrockClient,
        sample_image_bytes: bytes,
        tmp_path
    ) -> None:
        """Test successful embedding generation."""
        # Arrange
        image_path = tmp_path / "test.jpg"
        image_path.write_bytes(sample_image_bytes)

        mock_runtime = Mock()
        mock_boto_client.return_value = mock_runtime

        expected_embeddings = [0.123] * 1024
        mock_runtime.invoke_model.return_value = {
            'body': Mock(read=lambda: json.dumps({
                'embedding': expected_embeddings
            }).encode())
        }

        # Act
        result = bedrock_client.get_embeddings(str(image_path))

        # Assert
        assert len(result) == 1024
        assert result == expected_embeddings
        mock_runtime.invoke_model.assert_called_once()

    @patch('boto3.client')
    def test_get_embeddings_rate_limit_retry(
        self,
        mock_boto_client,
        bedrock_client: BedrockClient,
        tmp_path
    ) -> None:
        """Test retry logic for rate limiting."""
        # Arrange
        image_path = tmp_path / "test.jpg"
        image_path.write_bytes(b'fake image data')

        mock_runtime = Mock()
        mock_boto_client.return_value = mock_runtime

        # First call raises throttle, second succeeds
        mock_runtime.invoke_model.side_effect = [
            ClientError(
                {'Error': {'Code': 'ThrottlingException'}},
                'InvokeModel'
            ),
            {
                'body': Mock(read=lambda: json.dumps({
                    'embedding': [0.1] * 1024
                }).encode())
            }
        ]

        # Act
        result = bedrock_client.get_embeddings(
            str(image_path),
            max_retries=3
        )

        # Assert
        assert len(result) == 1024
        assert mock_runtime.invoke_model.call_count == 2

    @patch('boto3.client')
    def test_get_embeddings_invalid_image(
        self,
        mock_boto_client,
        bedrock_client: BedrockClient
    ) -> None:
        """Test error handling for invalid image."""
        # Arrange
        mock_runtime = Mock()
        mock_boto_client.return_value = mock_runtime

        mock_runtime.invoke_model.side_effect = ClientError(
            {'Error': {'Code': 'ValidationException'}},
            'InvokeModel'
        )

        # Act & Assert
        with pytest.raises(BedrockError) as exc_info:
            bedrock_client.get_embeddings("/nonexistent/file.jpg")

        assert exc_info.value.retry_allowed is False

    def test_validate_image_size(
        self,
        bedrock_client: BedrockClient,
        tmp_path
    ) -> None:
        """Test image size validation (max 5MB)."""
        # Arrange
        large_image = tmp_path / "large.jpg"
        large_image.write_bytes(b'x' * (6 * 1024 * 1024))  # 6MB

        # Act & Assert
        with pytest.raises(BedrockError) as exc_info:
            bedrock_client.get_embeddings(str(large_image))

        assert "exceeds maximum size" in str(exc_info.value)

    @pytest.mark.parametrize("model_id,expected_dimension", [
        ("amazon.titan-embed-image-v1", 1024),
        ("amazon.titan-embed-text-v1", 1536),
    ])
    def test_embedding_dimension_validation(
        self,
        model_id: str,
        expected_dimension: int
    ) -> None:
        """Test embedding dimension matches model specification."""
        # Arrange
        client = BedrockClient(model_id=model_id)

        # Act
        dimension = client.get_embedding_dimension()

        # Assert
        assert dimension == expected_dimension
```

---

## 2. Integration Testing

### 2.1 SQS Integration Tests

**tests/integration/test_sqs_integration.py**

```python
"""
Integration tests for SQS message processing.

Uses moto for AWS service mocking.
Tests cover end-to-end message flow.
"""

import pytest
import boto3
from moto import mock_sqs, mock_s3
import json
from datetime import datetime

from src.queue_manager import QueueManager
from src.file_processor import FileProcessor


@mock_sqs
@mock_s3
class TestSQSIntegration:
    """Integration tests for SQS message processing."""

    @pytest.fixture
    def sqs_client(self):
        """Create mocked SQS client."""
        return boto3.client('sqs', region_name='us-east-1')

    @pytest.fixture
    def s3_client(self):
        """Create mocked S3 client."""
        return boto3.client('s3', region_name='us-east-1')

    @pytest.fixture
    def queue_url(self, sqs_client):
        """Create test queue."""
        response = sqs_client.create_queue(
            QueueName='test-file-processing-queue',
            Attributes={
                'VisibilityTimeout': '900',
                'MessageRetentionPeriod': '345600'
            }
        )
        return response['QueueUrl']

    @pytest.fixture
    def test_bucket(self, s3_client):
        """Create test S3 bucket."""
        bucket_name = 'test-raw-files-bucket'
        s3_client.create_bucket(Bucket=bucket_name)
        return bucket_name

    def test_receive_and_process_message(
        self,
        sqs_client,
        s3_client,
        queue_url,
        test_bucket
    ):
        """
        Test complete message flow from SQS to processing.

        Validates:
        - Message reception
        - File download
        - Processing execution
        - Message deletion
        """
        # Arrange
        message_body = {
            "eventType": "FILE_UPLOADED",
            "s3Bucket": test_bucket,
            "s3Key": "test/file.pdf",
            "fileSize": 1024,
            "uploadedAt": datetime.now().isoformat(),
            "metadata": {"mimeType": "application/pdf"}
        }

        # Upload test file to S3
        s3_client.put_object(
            Bucket=test_bucket,
            Key="test/file.pdf",
            Body=b"PDF content"
        )

        # Send message to SQS
        sqs_client.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps(message_body)
        )

        queue_manager = QueueManager(sqs_client, queue_url)

        # Act
        messages = queue_manager.receive_messages(max_messages=1)

        # Assert
        assert len(messages) == 1
        assert messages[0]['s3Bucket'] == test_bucket
        assert messages[0]['s3Key'] == "test/file.pdf"

    def test_dead_letter_queue_on_failure(
        self,
        sqs_client,
        queue_url
    ):
        """Test message moves to DLQ after max retries."""
        # Arrange - Create DLQ
        dlq_response = sqs_client.create_queue(
            QueueName='test-dlq'
        )
        dlq_url = dlq_response['QueueUrl']

        dlq_arn = sqs_client.get_queue_attributes(
            QueueUrl=dlq_url,
            AttributeNames=['QueueArn']
        )['Attributes']['QueueArn']

        # Configure redrive policy
        sqs_client.set_queue_attributes(
            QueueUrl=queue_url,
            Attributes={
                'RedrivePolicy': json.dumps({
                    'deadLetterTargetArn': dlq_arn,
                    'maxReceiveCount': '3'
                })
            }
        )

        # Send failing message
        sqs_client.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({"invalid": "message"})
        )

        queue_manager = QueueManager(sqs_client, queue_url)

        # Act - Receive and fail 3 times
        for _ in range(3):
            messages = queue_manager.receive_messages()
            # Simulate processing failure (don't delete)

        # Assert - Check DLQ
        dlq_messages = sqs_client.receive_message(QueueUrl=dlq_url)
        assert 'Messages' in dlq_messages
        assert len(dlq_messages['Messages']) == 1

    def test_long_polling_configuration(
        self,
        sqs_client,
        queue_url
    ):
        """Test long polling reduces empty receives."""
        # Arrange
        queue_manager = QueueManager(
            sqs_client,
            queue_url,
            wait_time_seconds=20
        )

        # Act - Receive with no messages
        start_time = datetime.now()
        messages = queue_manager.receive_messages(max_messages=1)
        duration = (datetime.now() - start_time).total_seconds()

        # Assert
        assert len(messages) == 0
        assert duration >= 19  # Should wait ~20 seconds

    @pytest.mark.parametrize("batch_size", [1, 5, 10])
    def test_batch_message_processing(
        self,
        sqs_client,
        queue_url,
        batch_size
    ):
        """Test processing multiple messages in batch."""
        # Arrange - Send multiple messages
        for i in range(batch_size):
            sqs_client.send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps({
                    "eventType": "FILE_UPLOADED",
                    "s3Bucket": "test-bucket",
                    "s3Key": f"file_{i}.pdf",
                    "fileSize": 1024,
                    "uploadedAt": datetime.now().isoformat()
                })
            )

        queue_manager = QueueManager(sqs_client, queue_url)

        # Act
        messages = queue_manager.receive_messages(
            max_messages=batch_size
        )

        # Assert
        assert len(messages) == batch_size
```

### 2.2 S3 Integration Tests

**tests/integration/test_s3_integration.py**

```python
"""
Integration tests for S3 file operations.

Tests cover:
- File download
- Multipart upload
- File deletion
- Presigned URL generation
"""

import pytest
import boto3
from moto import mock_s3
from pathlib import Path
import io

from src.storage_handler import StorageHandler, S3Error


@mock_s3
class TestS3Integration:
    """Integration tests for S3 operations."""

    @pytest.fixture
    def s3_client(self):
        """Create mocked S3 client."""
        return boto3.client('s3', region_name='us-east-1')

    @pytest.fixture
    def test_bucket(self, s3_client):
        """Create test bucket with versioning."""
        bucket_name = 'test-cis-filesearch-bucket'
        s3_client.create_bucket(Bucket=bucket_name)

        # Enable versioning
        s3_client.put_bucket_versioning(
            Bucket=bucket_name,
            VersioningConfiguration={'Status': 'Enabled'}
        )

        return bucket_name

    @pytest.fixture
    def storage_handler(self, s3_client):
        """Create storage handler instance."""
        return StorageHandler(s3_client)

    def test_download_file_success(
        self,
        s3_client,
        storage_handler,
        test_bucket,
        tmp_path
    ):
        """Test successful file download from S3."""
        # Arrange
        s3_key = "documents/test.pdf"
        file_content = b"PDF file content"

        s3_client.put_object(
            Bucket=test_bucket,
            Key=s3_key,
            Body=file_content
        )

        local_path = tmp_path / "downloaded.pdf"

        # Act
        storage_handler.download_file(
            bucket=test_bucket,
            key=s3_key,
            local_path=str(local_path)
        )

        # Assert
        assert local_path.exists()
        assert local_path.read_bytes() == file_content

    def test_upload_large_file_multipart(
        self,
        storage_handler,
        test_bucket,
        tmp_path
    ):
        """Test multipart upload for large files."""
        # Arrange - Create 10MB file
        large_file = tmp_path / "large_file.bin"
        large_file.write_bytes(b'x' * (10 * 1024 * 1024))

        s3_key = "large/file.bin"

        # Act
        storage_handler.upload_file(
            local_path=str(large_file),
            bucket=test_bucket,
            key=s3_key,
            use_multipart=True,
            part_size=5 * 1024 * 1024  # 5MB parts
        )

        # Assert
        response = storage_handler.s3_client.head_object(
            Bucket=test_bucket,
            Key=s3_key
        )
        assert response['ContentLength'] == 10 * 1024 * 1024

    def test_delete_file_success(
        self,
        s3_client,
        storage_handler,
        test_bucket
    ):
        """Test file deletion from S3."""
        # Arrange
        s3_key = "temp/file_to_delete.txt"
        s3_client.put_object(
            Bucket=test_bucket,
            Key=s3_key,
            Body=b"temporary content"
        )

        # Act
        storage_handler.delete_file(
            bucket=test_bucket,
            key=s3_key
        )

        # Assert
        with pytest.raises(s3_client.exceptions.NoSuchKey):
            s3_client.head_object(Bucket=test_bucket, Key=s3_key)

    def test_generate_presigned_url(
        self,
        s3_client,
        storage_handler,
        test_bucket
    ):
        """Test presigned URL generation."""
        # Arrange
        s3_key = "secure/document.pdf"
        s3_client.put_object(
            Bucket=test_bucket,
            Key=s3_key,
            Body=b"secure content"
        )

        # Act
        url = storage_handler.generate_presigned_url(
            bucket=test_bucket,
            key=s3_key,
            expiration=900  # 15 minutes
        )

        # Assert
        assert url is not None
        assert test_bucket in url
        assert s3_key in url
        assert 'X-Amz-Expires=900' in url

    def test_copy_file_between_buckets(
        self,
        s3_client,
        storage_handler
    ):
        """Test file copy operation between buckets."""
        # Arrange
        source_bucket = 'source-bucket'
        dest_bucket = 'dest-bucket'

        s3_client.create_bucket(Bucket=source_bucket)
        s3_client.create_bucket(Bucket=dest_bucket)

        s3_key = "data/file.txt"
        s3_client.put_object(
            Bucket=source_bucket,
            Key=s3_key,
            Body=b"file content"
        )

        # Act
        storage_handler.copy_file(
            source_bucket=source_bucket,
            source_key=s3_key,
            dest_bucket=dest_bucket,
            dest_key=s3_key
        )

        # Assert
        response = s3_client.get_object(
            Bucket=dest_bucket,
            Key=s3_key
        )
        assert response['Body'].read() == b"file content"

    @pytest.mark.parametrize("error_code,expected_retry", [
        ("NoSuchKey", False),
        ("NoSuchBucket", False),
        ("RequestTimeout", True),
        ("ServiceUnavailable", True),
    ])
    def test_error_handling_and_retry_logic(
        self,
        s3_client,
        storage_handler,
        error_code,
        expected_retry
    ):
        """Test S3 error handling with retry decision."""
        # This would be tested with actual error injection
        # Here we verify the retry logic exists
        error = storage_handler.should_retry_error(error_code)
        assert error == expected_retry
```

### 2.3 OpenSearch Integration Tests

**tests/integration/test_opensearch_integration.py**

```python
"""
Integration tests for OpenSearch indexing operations.

Tests cover:
- Document indexing
- k-NN vector search
- Bulk operations
- Index management
"""

import pytest
from opensearchpy import OpenSearch, helpers
from datetime import datetime
import json

from src.index_manager import IndexManager, OpenSearchError


class TestOpenSearchIntegration:
    """Integration tests for OpenSearch."""

    @pytest.fixture
    def opensearch_client(self):
        """Create OpenSearch client (requires local instance)."""
        return OpenSearch(
            hosts=[{'host': 'localhost', 'port': 9200}],
            http_auth=('admin', 'admin'),
            use_ssl=False,
            verify_certs=False
        )

    @pytest.fixture
    def index_manager(self, opensearch_client):
        """Create index manager instance."""
        return IndexManager(opensearch_client)

    @pytest.fixture(autouse=True)
    def setup_and_cleanup_indices(self, opensearch_client):
        """Setup and cleanup test indices."""
        test_indices = ['test-files', 'test-images']

        # Cleanup before test
        for index in test_indices:
            if opensearch_client.indices.exists(index=index):
                opensearch_client.indices.delete(index=index)

        yield

        # Cleanup after test
        for index in test_indices:
            if opensearch_client.indices.exists(index=index):
                opensearch_client.indices.delete(index=index)

    def test_create_files_index(
        self,
        index_manager,
        opensearch_client
    ):
        """Test files index creation with kuromoji analyzer."""
        # Act
        index_manager.create_files_index('test-files')

        # Assert
        assert opensearch_client.indices.exists(index='test-files')

        # Verify index settings
        settings = opensearch_client.indices.get_settings(
            index='test-files'
        )
        assert 'kuromoji_analyzer' in str(settings)

    def test_index_document_success(
        self,
        index_manager,
        opensearch_client
    ):
        """Test document indexing."""
        # Arrange
        index_manager.create_files_index('test-files')

        document = {
            'file_id': 'f_001',
            'file_name': '契約書_2025.pdf',
            'file_path': '/documents/contracts/2025.pdf',
            'file_size': 2048576,
            'file_type': 'pdf',
            'ocr_text': '契約書の本文内容',
            'indexed_at': datetime.now().isoformat()
        }

        # Act
        index_manager.index_document(
            index='test-files',
            doc_id='f_001',
            document=document
        )

        opensearch_client.indices.refresh(index='test-files')

        # Assert
        result = opensearch_client.get(
            index='test-files',
            id='f_001'
        )
        assert result['_source']['file_name'] == '契約書_2025.pdf'

    def test_bulk_indexing_performance(
        self,
        index_manager,
        opensearch_client
    ):
        """Test bulk indexing of multiple documents."""
        # Arrange
        index_manager.create_files_index('test-files')

        documents = [
            {
                '_index': 'test-files',
                '_id': f'f_{i:03d}',
                '_source': {
                    'file_id': f'f_{i:03d}',
                    'file_name': f'document_{i}.pdf',
                    'file_path': f'/docs/file_{i}.pdf',
                    'indexed_at': datetime.now().isoformat()
                }
            }
            for i in range(100)
        ]

        # Act
        start_time = datetime.now()
        success, failed = helpers.bulk(
            opensearch_client,
            documents,
            raise_on_error=False
        )
        duration = (datetime.now() - start_time).total_seconds()

        opensearch_client.indices.refresh(index='test-files')

        # Assert
        assert success == 100
        assert failed == 0
        assert duration < 5.0  # Should complete within 5 seconds

        # Verify count
        count = opensearch_client.count(index='test-files')
        assert count['count'] == 100

    def test_knn_vector_search(
        self,
        index_manager,
        opensearch_client
    ):
        """Test k-NN image vector search."""
        # Arrange
        index_manager.create_images_index('test-images')

        # Index sample image vectors
        for i in range(10):
            vector = [0.1 * i] * 1024  # Simplified vector
            index_manager.index_image_vector(
                index='test-images',
                doc_id=f'img_{i}',
                vector=vector,
                file_path=f'/images/photo_{i}.jpg'
            )

        opensearch_client.indices.refresh(index='test-images')

        # Act - Search for similar images
        query_vector = [0.5] * 1024
        query = {
            'size': 5,
            'query': {
                'knn': {
                    'image_vector': {
                        'vector': query_vector,
                        'k': 5
                    }
                }
            }
        }

        result = opensearch_client.search(
            index='test-images',
            body=query
        )

        # Assert
        assert len(result['hits']['hits']) == 5
        assert result['hits']['hits'][0]['_score'] > 0

    def test_japanese_text_search_with_kuromoji(
        self,
        index_manager,
        opensearch_client
    ):
        """Test Japanese text search using kuromoji analyzer."""
        # Arrange
        index_manager.create_files_index('test-files')

        documents = [
            {
                'file_id': 'f_001',
                'file_name': '営業報告書_2025年1月.pdf',
                'ocr_text': '2025年1月の営業実績について報告します。売上は前年比120%でした。'
            },
            {
                'file_id': 'f_002',
                'file_name': '技術仕様書.docx',
                'ocr_text': 'システムの技術仕様について記載しています。'
            }
        ]

        for doc in documents:
            index_manager.index_document(
                index='test-files',
                doc_id=doc['file_id'],
                document=doc
            )

        opensearch_client.indices.refresh(index='test-files')

        # Act - Search for "営業"
        query = {
            'query': {
                'match': {
                    'ocr_text': {
                        'query': '営業',
                        'analyzer': 'kuromoji_analyzer'
                    }
                }
            }
        }

        result = opensearch_client.search(
            index='test-files',
            body=query
        )

        # Assert
        assert result['hits']['total']['value'] == 1
        assert result['hits']['hits'][0]['_id'] == 'f_001'

    @pytest.mark.slow
    def test_index_refresh_and_consistency(
        self,
        index_manager,
        opensearch_client
    ):
        """Test index refresh for search consistency."""
        # Arrange
        index_manager.create_files_index('test-files')

        document = {
            'file_id': 'f_test',
            'file_name': 'test.pdf',
            'ocr_text': 'test content'
        }

        # Act - Index without refresh
        index_manager.index_document(
            index='test-files',
            doc_id='f_test',
            document=document,
            refresh=False
        )

        # Search immediately (should not find)
        result_before = opensearch_client.search(
            index='test-files',
            body={'query': {'match_all': {}}}
        )

        # Refresh index
        opensearch_client.indices.refresh(index='test-files')

        # Search after refresh (should find)
        result_after = opensearch_client.search(
            index='test-files',
            body={'query': {'match_all': {}}}
        )

        # Assert
        assert result_before['hits']['total']['value'] == 0
        assert result_after['hits']['total']['value'] == 1
```

---

## 3. Performance Testing

### 3.1 Load Testing Configuration

**tests/performance/locustfile.py**

```python
"""
Load testing for Python worker using Locust.

Simulates concurrent file processing workload.
Measures throughput, latency, and error rates.
"""

from locust import User, task, between, events
import boto3
import json
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class FileProcessingUser(User):
    """Simulates file processing workload."""

    wait_time = between(1, 3)

    def on_start(self):
        """Initialize AWS clients."""
        self.sqs = boto3.client('sqs', region_name='us-east-1')
        self.s3 = boto3.client('s3', region_name='us-east-1')

        self.queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
        self.bucket = 'test-raw-files-bucket'

    @task(weight=3)
    def send_pdf_processing_message(self):
        """Send PDF file processing message to SQS."""
        start_time = datetime.now()

        try:
            message = {
                'eventType': 'FILE_UPLOADED',
                's3Bucket': self.bucket,
                's3Key': f'documents/test_{datetime.now().timestamp()}.pdf',
                'fileSize': 2048576,
                'uploadedAt': datetime.now().isoformat(),
                'metadata': {'mimeType': 'application/pdf'}
            }

            self.sqs.send_message(
                QueueUrl=self.queue_url,
                MessageBody=json.dumps(message)
            )

            duration = (datetime.now() - start_time).total_seconds() * 1000

            events.request.fire(
                request_type="SQS",
                name="send_pdf_message",
                response_time=duration,
                response_length=len(json.dumps(message)),
                exception=None,
                context={}
            )

        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds() * 1000
            events.request.fire(
                request_type="SQS",
                name="send_pdf_message",
                response_time=duration,
                response_length=0,
                exception=e,
                context={}
            )

    @task(weight=2)
    def send_image_processing_message(self):
        """Send image file processing message to SQS."""
        start_time = datetime.now()

        try:
            message = {
                'eventType': 'FILE_UPLOADED',
                's3Bucket': self.bucket,
                's3Key': f'images/photo_{datetime.now().timestamp()}.jpg',
                'fileSize': 1024000,
                'uploadedAt': datetime.now().isoformat(),
                'metadata': {'mimeType': 'image/jpeg'}
            }

            self.sqs.send_message(
                QueueUrl=self.queue_url,
                MessageBody=json.dumps(message)
            )

            duration = (datetime.now() - start_time).total_seconds() * 1000

            events.request.fire(
                request_type="SQS",
                name="send_image_message",
                response_time=duration,
                response_length=len(json.dumps(message)),
                exception=None,
                context={}
            )

        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds() * 1000
            events.request.fire(
                request_type="SQS",
                name="send_image_message",
                response_time=duration,
                response_length=0,
                exception=e,
                context={}
            )

    @task(weight=1)
    def check_queue_depth(self):
        """Monitor queue depth."""
        start_time = datetime.now()

        try:
            attrs = self.sqs.get_queue_attributes(
                QueueUrl=self.queue_url,
                AttributeNames=['ApproximateNumberOfMessages']
            )

            queue_depth = int(attrs['Attributes']['ApproximateNumberOfMessages'])

            duration = (datetime.now() - start_time).total_seconds() * 1000

            events.request.fire(
                request_type="SQS",
                name="check_queue_depth",
                response_time=duration,
                response_length=0,
                exception=None,
                context={'queue_depth': queue_depth}
            )

            logger.info(f"Current queue depth: {queue_depth}")

        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds() * 1000
            events.request.fire(
                request_type="SQS",
                name="check_queue_depth",
                response_time=duration,
                response_length=0,
                exception=e,
                context={}
            )


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Log test start."""
    logger.info("Load test started")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Log test results."""
    logger.info("Load test completed")
    logger.info(f"Total requests: {environment.stats.total.num_requests}")
    logger.info(f"Total failures: {environment.stats.total.num_failures}")
```

**Load Test Execution Commands**

```bash
# Run load test with 10 concurrent users
locust -f tests/performance/locustfile.py \
  --users 10 \
  --spawn-rate 2 \
  --run-time 10m \
  --headless \
  --html tests/performance/reports/load_test_report.html

# Run spike test (rapid user increase)
locust -f tests/performance/locustfile.py \
  --users 50 \
  --spawn-rate 10 \
  --run-time 5m \
  --headless

# Run stress test (gradual increase to failure)
locust -f tests/performance/locustfile.py \
  --users 100 \
  --spawn-rate 5 \
  --run-time 30m \
  --headless
```

### 3.2 Memory Profiling Tests

**tests/performance/test_memory_profiling.py**

```python
"""
Memory profiling tests to detect memory leaks.

Uses memory_profiler and pytest-memprof.
"""

import pytest
from memory_profiler import profile
import gc
import psutil
import os

from src.file_processor import FileProcessor
from src.ocr_engine import OCREngine


class TestMemoryProfiling:
    """Memory profiling test suite."""

    @pytest.fixture
    def processor(self):
        """Create processor instance."""
        return FileProcessor()

    @profile
    def test_process_large_batch_no_memory_leak(self, processor):
        """
        Test processing 100 files doesn't cause memory leak.

        Validates:
        - Memory usage stays stable
        - Garbage collection works
        - No retained references
        """
        process = psutil.Process(os.getpid())
        initial_memory = process.memory_info().rss / 1024 / 1024  # MB

        # Process 100 files
        for i in range(100):
            mock_message = create_mock_message(f"file_{i}.pdf")
            processor.process_message(mock_message)

            if i % 10 == 0:
                gc.collect()  # Force garbage collection

        final_memory = process.memory_info().rss / 1024 / 1024  # MB
        memory_increase = final_memory - initial_memory

        # Assert memory increase is reasonable (<100MB for 100 files)
        assert memory_increase < 100, \
            f"Memory increased by {memory_increase:.2f}MB, possible leak"

    def test_ocr_engine_memory_cleanup(self):
        """Test OCR engine properly cleans up resources."""
        engine = OCREngine()
        process = psutil.Process(os.getpid())

        memories = []

        for i in range(50):
            initial_mem = process.memory_info().rss / 1024 / 1024

            # Process image
            engine.extract_text(f"test_image_{i}.jpg")

            # Force cleanup
            gc.collect()

            final_mem = process.memory_info().rss / 1024 / 1024
            memories.append(final_mem - initial_mem)

        # Check memory doesn't continuously increase
        avg_first_10 = sum(memories[:10]) / 10
        avg_last_10 = sum(memories[-10:]) / 10

        assert avg_last_10 < avg_first_10 * 1.5, \
            "Memory usage increased significantly, possible leak"


def create_mock_message(filename):
    """Helper to create mock message."""
    return {
        's3Bucket': 'test-bucket',
        's3Key': f'files/{filename}',
        'fileSize': 1024000
    }
```

### 3.3 CPU Profiling Tests

**tests/performance/test_cpu_profiling.py**

```python
"""
CPU profiling tests to identify performance bottlenecks.

Uses cProfile and pytest-benchmark.
"""

import pytest
from cProfile import Profile
from pstats import Stats
import io

from src.file_processor import FileProcessor
from src.ocr_engine import OCREngine


class TestCPUProfiling:
    """CPU profiling test suite."""

    def test_ocr_processing_performance(self, benchmark):
        """
        Benchmark OCR processing performance.

        Target: <2 seconds per page
        """
        engine = OCREngine()

        def run_ocr():
            return engine.extract_text("sample_document.pdf")

        # Run benchmark
        result = benchmark(run_ocr)

        # Assert performance target
        assert benchmark.stats.mean < 2.0, \
            f"OCR took {benchmark.stats.mean:.2f}s, target <2s"

    def test_bedrock_api_latency(self, benchmark):
        """
        Benchmark Bedrock API call latency.

        Target: <1 second per image
        """
        from src.bedrock_client import BedrockClient
        client = BedrockClient()

        def get_embeddings():
            return client.get_embeddings("test_image.jpg")

        result = benchmark(get_embeddings)

        assert benchmark.stats.mean < 1.0, \
            f"Bedrock API took {benchmark.stats.mean:.2f}s, target <1s"

    def test_profile_full_processing_pipeline(self):
        """Profile complete file processing pipeline."""
        profiler = Profile()
        profiler.enable()

        # Run processing
        processor = FileProcessor()
        for i in range(10):
            processor.process_message(create_mock_message(f"file_{i}.pdf"))

        profiler.disable()

        # Analyze results
        s = io.StringIO()
        stats = Stats(profiler, stream=s).sort_stats('cumulative')
        stats.print_stats(20)

        profile_output = s.getvalue()

        # Save profile report
        with open('tests/performance/reports/cpu_profile.txt', 'w') as f:
            f.write(profile_output)

        print("\nTop 20 functions by cumulative time:")
        print(profile_output)


def create_mock_message(filename):
    """Helper to create mock message."""
    return {
        's3Bucket': 'test-bucket',
        's3Key': f'files/{filename}',
        'fileSize': 1024000
    }
```

---

## 4. Resilience Testing

### 4.1 Spot Interruption Handling Tests

**tests/resilience/test_spot_interruption.py**

```python
"""
Resilience tests for EC2 Spot Instance interruption handling.

Tests cover:
- Graceful shutdown
- Message requeue
- State persistence
- Recovery procedures
"""

import pytest
from unittest.mock import Mock, patch
import signal
import time
from datetime import datetime, timedelta

from src.spot_handler import SpotInterruptionHandler
from src.file_processor import FileProcessor


class TestSpotInterruptionHandling:
    """Test suite for spot interruption resilience."""

    @pytest.fixture
    def spot_handler(self):
        """Create spot interruption handler."""
        return SpotInterruptionHandler(
            check_interval=1,  # Check every 1 second in tests
            grace_period=120   # 2 minute grace period
        )

    @pytest.fixture
    def processor(self):
        """Create file processor with spot handling."""
        return FileProcessor(spot_aware=True)

    def test_detect_spot_interruption_notice(
        self,
        spot_handler
    ):
        """Test detection of spot interruption notice."""
        # Mock EC2 metadata endpoint
        with patch('requests.get') as mock_get:
            mock_get.return_value.status_code = 200
            mock_get.return_value.json.return_value = {
                'action': 'terminate',
                'time': (datetime.now() + timedelta(minutes=2)).isoformat()
            }

            # Act
            is_interrupted = spot_handler.check_interruption_notice()

            # Assert
            assert is_interrupted is True
            assert spot_handler.termination_time is not None

    def test_graceful_shutdown_on_interruption(
        self,
        spot_handler,
        processor
    ):
        """
        Test graceful shutdown when interruption detected.

        Validates:
        - Processing stops
        - In-progress messages return to queue
        - State is saved
        """
        # Arrange
        spot_handler.set_interrupted(True)

        processing_messages = [
            {'receipt_handle': 'msg_1', 's3Key': 'file1.pdf'},
            {'receipt_handle': 'msg_2', 's3Key': 'file2.pdf'}
        ]

        # Act
        result = spot_handler.handle_graceful_shutdown(
            processor,
            processing_messages
        )

        # Assert
        assert result['status'] == 'GRACEFUL_SHUTDOWN'
        assert result['messages_requeued'] == 2
        assert result['state_saved'] is True

    def test_message_visibility_timeout_extension(
        self,
        spot_handler
    ):
        """Test extending message visibility during long processing."""
        # Arrange
        sqs_client = Mock()
        message = {
            'receipt_handle': 'test_receipt',
            'initial_visibility': 900  # 15 minutes
        }

        # Act
        spot_handler.extend_message_visibility(
            sqs_client=sqs_client,
            queue_url='test-queue',
            receipt_handle=message['receipt_handle'],
            extension_seconds=600  # Extend by 10 minutes
        )

        # Assert
        sqs_client.change_message_visibility.assert_called_once_with(
            QueueUrl='test-queue',
            ReceiptHandle='test_receipt',
            VisibilityTimeout=600
        )

    @pytest.mark.slow
    def test_continuous_interruption_monitoring(
        self,
        spot_handler
    ):
        """Test background monitoring thread for interruptions."""
        # Arrange
        interrupt_detected = []

        def on_interrupt():
            interrupt_detected.append(datetime.now())

        spot_handler.on_interrupt_callback = on_interrupt

        # Act - Start monitoring in background
        spot_handler.start_monitoring()

        # Simulate interruption after 3 seconds
        time.sleep(3)
        with patch('requests.get') as mock_get:
            mock_get.return_value.status_code = 200
            mock_get.return_value.json.return_value = {
                'action': 'terminate',
                'time': (datetime.now() + timedelta(minutes=2)).isoformat()
            }

            time.sleep(2)  # Wait for detection

        spot_handler.stop_monitoring()

        # Assert
        assert len(interrupt_detected) > 0

    def test_save_and_restore_processing_state(
        self,
        processor,
        tmp_path
    ):
        """Test state persistence for recovery."""
        # Arrange
        state_file = tmp_path / "processor_state.json"

        processor.current_state = {
            'processing_messages': [
                {'s3Key': 'file1.pdf', 'progress': 0.5},
                {'s3Key': 'file2.pdf', 'progress': 0.3}
            ],
            'timestamp': datetime.now().isoformat()
        }

        # Act - Save state
        processor.save_state(str(state_file))

        # Create new processor and restore
        new_processor = FileProcessor(spot_aware=True)
        new_processor.restore_state(str(state_file))

        # Assert
        assert len(new_processor.current_state['processing_messages']) == 2
        assert new_processor.current_state['processing_messages'][0]['s3Key'] == 'file1.pdf'
```

### 4.2 Network Failure Resilience Tests

**tests/resilience/test_network_failures.py**

```python
"""
Resilience tests for network failures and service unavailability.

Tests cover:
- Connection timeouts
- Retry with exponential backoff
- Circuit breaker pattern
- Fallback mechanisms
"""

import pytest
from unittest.mock import Mock, patch
from requests.exceptions import ConnectionError, Timeout
from botocore.exceptions import ClientError, EndpointConnectionError
import time

from src.retry_handler import RetryHandler, CircuitBreaker
from src.file_processor import FileProcessor


class TestNetworkFailureResilience:
    """Test suite for network failure handling."""

    @pytest.fixture
    def retry_handler(self):
        """Create retry handler with exponential backoff."""
        return RetryHandler(
            max_retries=3,
            initial_delay=1,
            max_delay=10,
            backoff_factor=2
        )

    @pytest.fixture
    def circuit_breaker(self):
        """Create circuit breaker."""
        return CircuitBreaker(
            failure_threshold=5,
            timeout=30,
            expected_exception=ConnectionError
        )

    def test_retry_with_exponential_backoff(
        self,
        retry_handler
    ):
        """
        Test retry logic with exponential backoff.

        Validates:
        - Retry count
        - Delay increases exponentially
        - Final failure after max retries
        """
        # Arrange
        attempt_times = []
        mock_function = Mock(side_effect=ConnectionError("Network error"))

        def tracked_function():
            attempt_times.append(time.time())
            return mock_function()

        # Act & Assert
        with pytest.raises(ConnectionError):
            retry_handler.execute(tracked_function)

        # Verify retry count
        assert len(attempt_times) == 4  # Initial + 3 retries

        # Verify exponential backoff (approximately)
        if len(attempt_times) >= 2:
            delay_1 = attempt_times[1] - attempt_times[0]
            delay_2 = attempt_times[2] - attempt_times[1]
            assert delay_2 > delay_1 * 1.5  # Should roughly double

    def test_circuit_breaker_opens_on_failures(
        self,
        circuit_breaker
    ):
        """Test circuit breaker opens after failure threshold."""
        # Arrange
        failing_function = Mock(side_effect=ConnectionError("Service unavailable"))

        # Act - Cause failures to reach threshold
        for i in range(5):
            with pytest.raises(ConnectionError):
                circuit_breaker.call(failing_function)

        # Assert - Circuit should be open
        assert circuit_breaker.state == 'OPEN'

        # Next call should fail fast
        with pytest.raises(Exception) as exc_info:
            circuit_breaker.call(failing_function)

        assert "Circuit breaker is OPEN" in str(exc_info.value)

    def test_circuit_breaker_half_open_recovery(
        self,
        circuit_breaker
    ):
        """Test circuit breaker transitions to half-open for recovery."""
        # Arrange - Open the circuit
        failing_function = Mock(side_effect=ConnectionError("Error"))

        for _ in range(5):
            with pytest.raises(ConnectionError):
                circuit_breaker.call(failing_function)

        assert circuit_breaker.state == 'OPEN'

        # Act - Wait for timeout
        time.sleep(circuit_breaker.timeout + 1)

        # Assert - Should be half-open
        assert circuit_breaker.state == 'HALF_OPEN'

        # Successful call should close circuit
        success_function = Mock(return_value="Success")
        result = circuit_breaker.call(success_function)

        assert result == "Success"
        assert circuit_breaker.state == 'CLOSED'

    @pytest.mark.parametrize("exception,should_retry", [
        (ConnectionError("Timeout"), True),
        (Timeout("Request timeout"), True),
        (EndpointConnectionError(endpoint_url="http://example.com"), True),
        (ClientError({'Error': {'Code': 'NoSuchKey'}}, 'GetObject'), False),
        (ValueError("Invalid input"), False),
    ])
    def test_retry_decision_based_on_exception(
        self,
        retry_handler,
        exception,
        should_retry
    ):
        """Test selective retry based on exception type."""
        # Act
        result = retry_handler.should_retry(exception)

        # Assert
        assert result == should_retry

    def test_s3_download_with_retry_on_timeout(
        self,
        retry_handler,
        tmp_path
    ):
        """Test S3 download retries on timeout."""
        # Arrange
        from src.storage_handler import StorageHandler
        s3_client = Mock()

        # First call times out, second succeeds
        s3_client.download_file.side_effect = [
            Timeout("Connection timeout"),
            None  # Success
        ]

        handler = StorageHandler(s3_client, retry_handler=retry_handler)

        # Act
        handler.download_file(
            bucket='test-bucket',
            key='test.pdf',
            local_path=str(tmp_path / 'test.pdf')
        )

        # Assert
        assert s3_client.download_file.call_count == 2

    def test_opensearch_indexing_fallback_on_failure(self):
        """Test fallback to DynamoDB when OpenSearch unavailable."""
        # Arrange
        from src.index_manager import IndexManager

        opensearch_client = Mock()
        opensearch_client.index.side_effect = ConnectionError("OpenSearch down")

        dynamodb_client = Mock()

        manager = IndexManager(
            opensearch_client=opensearch_client,
            dynamodb_fallback=dynamodb_client
        )

        document = {
            'file_id': 'f_001',
            'file_name': 'test.pdf'
        }

        # Act
        manager.index_document_with_fallback(document)

        # Assert - Should fall back to DynamoDB
        dynamodb_client.put_item.assert_called_once()
```

### 4.3 Service Throttling Response Tests

**tests/resilience/test_throttling.py**

```python
"""
Tests for AWS service throttling and rate limiting responses.

Tests cover:
- Throttling detection
- Adaptive rate limiting
- Backoff strategies
- Queue-based rate control
"""

import pytest
from unittest.mock import Mock, patch
from botocore.exceptions import ClientError
import time

from src.rate_limiter import AdaptiveRateLimiter
from src.bedrock_client import BedrockClient


class TestThrottlingResilience:
    """Test suite for throttling handling."""

    @pytest.fixture
    def rate_limiter(self):
        """Create adaptive rate limiter."""
        return AdaptiveRateLimiter(
            initial_rate=10,  # 10 requests/second
            min_rate=1,
            max_rate=50
        )

    def test_detect_throttling_exception(self):
        """Test detection of throttling exceptions."""
        # Arrange
        throttle_error = ClientError(
            {'Error': {'Code': 'ThrottlingException'}},
            'InvokeModel'
        )

        from src.error_handler import ErrorHandler
        handler = ErrorHandler()

        # Act
        is_throttled = handler.is_throttling_error(throttle_error)

        # Assert
        assert is_throttled is True

    def test_adaptive_rate_decrease_on_throttle(
        self,
        rate_limiter
    ):
        """Test rate limiter decreases rate on throttling."""
        # Arrange
        initial_rate = rate_limiter.current_rate

        # Act
        rate_limiter.on_throttle()

        # Assert
        assert rate_limiter.current_rate < initial_rate
        assert rate_limiter.current_rate >= rate_limiter.min_rate

    def test_adaptive_rate_increase_on_success(
        self,
        rate_limiter
    ):
        """Test rate limiter increases rate on success."""
        # Arrange
        rate_limiter.current_rate = 5

        # Act - Record successful requests
        for _ in range(10):
            rate_limiter.on_success()

        # Assert
        assert rate_limiter.current_rate > 5

    @patch('boto3.client')
    def test_bedrock_api_throttling_retry(
        self,
        mock_boto_client,
        rate_limiter
    ):
        """Test Bedrock API handles throttling with retry."""
        # Arrange
        mock_runtime = Mock()
        mock_boto_client.return_value = mock_runtime

        # Simulate throttling then success
        mock_runtime.invoke_model.side_effect = [
            ClientError(
                {'Error': {'Code': 'ThrottlingException'}},
                'InvokeModel'
            ),
            {
                'body': Mock(read=lambda: b'{"embedding": [0.1]}')
            }
        ]

        client = BedrockClient(rate_limiter=rate_limiter)

        # Act
        result = client.get_embeddings("test.jpg")

        # Assert
        assert mock_runtime.invoke_model.call_count == 2
        assert rate_limiter.throttle_count > 0

    def test_queue_based_rate_control(self):
        """Test queue-based rate control for message processing."""
        # Arrange
        from src.queue_manager import QueueManager

        sqs_client = Mock()
        rate_limiter = AdaptiveRateLimiter(initial_rate=5)

        queue_manager = QueueManager(
            sqs_client=sqs_client,
            rate_limiter=rate_limiter
        )

        # Mock messages
        messages = [{'MessageId': f'msg_{i}'} for i in range(20)]
        sqs_client.receive_message.return_value = {'Messages': messages}

        # Act
        start_time = time.time()
        processed = queue_manager.receive_and_process_batch(
            max_messages=20
        )
        duration = time.time() - start_time

        # Assert - Should take ~4 seconds at 5 msgs/sec
        assert duration >= 3.0  # Allow some variance
        assert len(processed) == 20
```

---

## 5. Auto Scaling Testing

### 5.1 Scale-Out Trigger Tests

**tests/autoscaling/test_scale_out.py**

```python
"""
Tests for Auto Scaling scale-out behavior.

Tests cover:
- SQS queue depth triggers
- Instance launch validation
- Capacity reservation
- Scaling metrics
"""

import pytest
from unittest.mock import Mock, patch
import boto3
from moto import mock_autoscaling, mock_sqs, mock_cloudwatch

from src.scaling_manager import ScalingManager


@mock_autoscaling
@mock_sqs
@mock_cloudwatch
class TestAutoScalingScaleOut:
    """Test suite for scale-out scenarios."""

    @pytest.fixture
    def autoscaling_client(self):
        """Create Auto Scaling client."""
        return boto3.client('autoscaling', region_name='us-east-1')

    @pytest.fixture
    def sqs_client(self):
        """Create SQS client."""
        return boto3.client('sqs', region_name='us-east-1')

    @pytest.fixture
    def cloudwatch_client(self):
        """Create CloudWatch client."""
        return boto3.client('cloudwatch', region_name='us-east-1')

    @pytest.fixture
    def asg_name(self, autoscaling_client):
        """Create Auto Scaling Group."""
        autoscaling_client.create_auto_scaling_group(
            AutoScalingGroupName='test-worker-asg',
            MinSize=0,
            MaxSize=10,
            DesiredCapacity=2,
            AvailabilityZones=['us-east-1a', 'us-east-1b']
        )
        return 'test-worker-asg'

    def test_scale_out_trigger_on_high_queue_depth(
        self,
        sqs_client,
        cloudwatch_client,
        asg_name
    ):
        """
        Test scale-out triggers when queue depth exceeds threshold.

        Validates:
        - Queue depth monitoring
        - Alarm triggers
        - Desired capacity increases
        """
        # Arrange
        queue_response = sqs_client.create_queue(
            QueueName='test-processing-queue'
        )
        queue_url = queue_response['QueueUrl']

        # Send messages to exceed threshold (>10)
        for i in range(15):
            sqs_client.send_message(
                QueueUrl=queue_url,
                MessageBody=f'Message {i}'
            )

        scaling_manager = ScalingManager(
            asg_name=asg_name,
            queue_url=queue_url,
            scale_out_threshold=10
        )

        # Act
        scaling_decision = scaling_manager.evaluate_scaling()

        # Assert
        assert scaling_decision['action'] == 'SCALE_OUT'
        assert scaling_decision['current_queue_depth'] == 15
        assert scaling_decision['desired_capacity'] > 2

    def test_gradual_scale_out_prevents_over_provisioning(
        self,
        autoscaling_client,
        asg_name
    ):
        """Test gradual scale-out to avoid over-provisioning."""
        # Arrange
        scaling_manager = ScalingManager(
            asg_name=asg_name,
            scale_out_increment=2  # Add 2 instances at a time
        )

        current_capacity = 2
        target_capacity = 10

        # Act
        new_capacity = scaling_manager.calculate_scale_out_capacity(
            current=current_capacity,
            target=target_capacity
        )

        # Assert
        assert new_capacity == 4  # Should increment by 2, not jump to 10

    def test_cooldown_period_prevents_rapid_scaling(
        self,
        autoscaling_client,
        asg_name
    ):
        """Test cooldown period prevents consecutive scale-outs."""
        # Arrange
        scaling_manager = ScalingManager(
            asg_name=asg_name,
            cooldown_seconds=300  # 5 minute cooldown
        )

        # Act - First scale-out
        first_scale = scaling_manager.trigger_scale_out(desired_capacity=4)

        # Immediate second scale-out attempt
        second_scale = scaling_manager.trigger_scale_out(desired_capacity=6)

        # Assert
        assert first_scale['status'] == 'SUCCESS'
        assert second_scale['status'] == 'COOLDOWN'
        assert 'cooldown period' in second_scale['message'].lower()

    @pytest.mark.parametrize("queue_depth,expected_instances", [
        (5, 1),
        (15, 2),
        (30, 3),
        (50, 5),
        (100, 10),
    ])
    def test_instance_count_calculation_based_on_queue_depth(
        self,
        queue_depth,
        expected_instances
    ):
        """Test instance count calculation based on queue depth."""
        # Arrange
        scaling_manager = ScalingManager(
            messages_per_instance=10  # Each instance handles 10 messages
        )

        # Act
        calculated_instances = scaling_manager.calculate_required_instances(
            queue_depth=queue_depth
        )

        # Assert
        assert calculated_instances == expected_instances
```

### 5.2 Scale-In Behavior Tests

**tests/autoscaling/test_scale_in.py**

```python
"""
Tests for Auto Scaling scale-in behavior.

Tests cover:
- Low queue depth triggers
- Instance termination protection
- Graceful shutdown
- Cost optimization
"""

import pytest
from unittest.mock import Mock
import boto3
from moto import mock_autoscaling, mock_sqs

from src.scaling_manager import ScalingManager


@mock_autoscaling
@mock_sqs
class TestAutoScalingScaleIn:
    """Test suite for scale-in scenarios."""

    @pytest.fixture
    def scaling_manager(self):
        """Create scaling manager."""
        return ScalingManager(
            asg_name='test-worker-asg',
            scale_in_threshold=2,
            scale_in_cooldown=300
        )

    def test_scale_in_trigger_on_low_queue_depth(
        self,
        scaling_manager
    ):
        """Test scale-in when queue depth is low for sustained period."""
        # Arrange
        queue_depth_history = [1, 1, 0, 1, 0]  # Low for 5 minutes

        # Act
        should_scale_in = scaling_manager.evaluate_scale_in(
            queue_depth_history=queue_depth_history,
            threshold=2,
            sustained_minutes=5
        )

        # Assert
        assert should_scale_in is True

    def test_protect_minimum_capacity(
        self,
        scaling_manager
    ):
        """Test scale-in respects minimum capacity."""
        # Arrange
        current_capacity = 1  # At minimum

        # Act
        new_capacity = scaling_manager.calculate_scale_in_capacity(
            current=current_capacity,
            min_capacity=1
        )

        # Assert
        assert new_capacity == 1  # Should not scale below minimum

    def test_instance_termination_order(self):
        """Test instances terminate in correct order (oldest first)."""
        # Arrange
        from datetime import datetime, timedelta

        instances = [
            {'InstanceId': 'i-001', 'LaunchTime': datetime.now() - timedelta(hours=5)},
            {'InstanceId': 'i-002', 'LaunchTime': datetime.now() - timedelta(hours=2)},
            {'InstanceId': 'i-003', 'LaunchTime': datetime.now() - timedelta(hours=1)},
        ]

        scaling_manager = ScalingManager()

        # Act
        termination_order = scaling_manager.get_termination_order(instances)

        # Assert
        assert termination_order[0]['InstanceId'] == 'i-001'  # Oldest first

    def test_prevent_scale_in_during_active_processing(
        self,
        scaling_manager
    ):
        """Test scale-in prevented when instances are actively processing."""
        # Arrange
        active_instances = [
            {'InstanceId': 'i-001', 'processing_messages': 5},
            {'InstanceId': 'i-002', 'processing_messages': 0},
        ]

        # Act
        safe_to_terminate = scaling_manager.get_safe_termination_candidates(
            instances=active_instances
        )

        # Assert
        assert len(safe_to_terminate) == 1
        assert safe_to_terminate[0]['InstanceId'] == 'i-002'
```

---

## 6. CI/CD Integration

### 6.1 GitHub Actions Workflow

**.github/workflows/python-worker-tests.yml**

```yaml
name: Python Worker Test Suite

on:
  push:
    branches: [main, develop]
    paths:
      - 'backend/worker/**'
      - 'tests/**'
  pull_request:
    branches: [main]

env:
  PYTHON_VERSION: '3.11'

jobs:
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
          cache: 'pip'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          pip install -r requirements-test.txt

      - name: Run unit tests with coverage
        run: |
          pytest tests/unit \
            --cov=src \
            --cov-report=xml \
            --cov-report=term-missing \
            --junitxml=test-results/unit-tests.xml \
            -v

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage.xml
          flags: unit
          name: unit-tests

      - name: Publish test results
        uses: EnricoMi/publish-unit-test-result-action@v2
        if: always()
        with:
          files: test-results/unit-tests.xml

  integration-tests:
    name: Integration Tests
    runs-on: ubuntu-latest

    services:
      localstack:
        image: localstack/localstack:latest
        env:
          SERVICES: s3,sqs,dynamodb
          DEFAULT_REGION: us-east-1
        ports:
          - 4566:4566

      opensearch:
        image: opensearchproject/opensearch:2.11.0
        env:
          discovery.type: single-node
          OPENSEARCH_JAVA_OPTS: -Xms512m -Xmx512m
        ports:
          - 9200:9200

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install Tesseract OCR
        run: |
          sudo apt-get update
          sudo apt-get install -y tesseract-ocr tesseract-ocr-jpn

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -r requirements-test.txt

      - name: Wait for services
        run: |
          timeout 60 bash -c 'until curl -s http://localhost:9200; do sleep 2; done'
          timeout 60 bash -c 'until curl -s http://localhost:4566; do sleep 2; done'

      - name: Run integration tests
        env:
          AWS_ENDPOINT_URL: http://localhost:4566
          OPENSEARCH_ENDPOINT: http://localhost:9200
        run: |
          pytest tests/integration \
            --cov=src \
            --cov-report=xml \
            --junitxml=test-results/integration-tests.xml \
            -v

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage.xml
          flags: integration

  performance-tests:
    name: Performance Tests
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest-benchmark locust memory_profiler

      - name: Run CPU profiling tests
        run: |
          pytest tests/performance/test_cpu_profiling.py \
            --benchmark-only \
            --benchmark-json=benchmark-results.json

      - name: Run memory profiling tests
        run: |
          pytest tests/performance/test_memory_profiling.py -v

      - name: Upload benchmark results
        uses: actions/upload-artifact@v4
        with:
          name: benchmark-results
          path: benchmark-results.json

  security-scan:
    name: Security Scanning
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Run Bandit security scan
        run: |
          pip install bandit
          bandit -r src -f json -o bandit-report.json

      - name: Run Safety dependency check
        run: |
          pip install safety
          safety check --json > safety-report.json

      - name: Upload security reports
        uses: actions/upload-artifact@v4
        with:
          name: security-reports
          path: |
            bandit-report.json
            safety-report.json

  code-quality:
    name: Code Quality
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install linters
        run: |
          pip install black pylint mypy

      - name: Run Black formatter check
        run: black --check src tests

      - name: Run Pylint
        run: pylint src --output-format=json > pylint-report.json

      - name: Run MyPy type checking
        run: mypy src --junit-xml=mypy-report.xml

      - name: Upload quality reports
        uses: actions/upload-artifact@v4
        with:
          name: code-quality-reports
          path: |
            pylint-report.json
            mypy-report.xml
```

### 6.2 Pre-commit Hooks

**.pre-commit-config.yaml**

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files
        args: ['--maxkb=1000']
      - id: check-json
      - id: check-merge-conflict
      - id: debug-statements

  - repo: https://github.com/psf/black
    rev: 23.12.1
    hooks:
      - id: black
        language_version: python3.11

  - repo: https://github.com/PyCQA/pylint
    rev: v3.0.3
    hooks:
      - id: pylint
        args: ['--rcfile=.pylintrc']

  - repo: https://github.com/PyCQA/bandit
    rev: 1.7.5
    hooks:
      - id: bandit
        args: ['-r', 'src']

  - repo: local
    hooks:
      - id: pytest-unit
        name: pytest-unit
        entry: pytest tests/unit --cov=src --cov-fail-under=80
        language: system
        pass_filenames: false
        always_run: true
```

---

## 7. Test Execution Commands

### 7.1 Local Development Commands

```bash
# Install dependencies
pip install -r requirements.txt
pip install -r requirements-test.txt

# Run all tests
pytest

# Run specific test categories
pytest tests/unit -m unit
pytest tests/integration -m integration
pytest tests/performance -m performance
pytest tests/resilience -m resilience

# Run with coverage report
pytest --cov=src --cov-report=html --cov-report=term

# Run tests in parallel
pytest -n auto

# Run tests with verbose output
pytest -v -s

# Run specific test file
pytest tests/unit/test_file_processor.py

# Run specific test method
pytest tests/unit/test_file_processor.py::TestFileProcessor::test_process_message_success_pdf

# Run tests matching pattern
pytest -k "test_ocr"

# Run slow tests
pytest -m slow

# Generate coverage badge
coverage-badge -o coverage.svg

# Run performance benchmarks
pytest tests/performance --benchmark-only

# Run memory profiling
python -m memory_profiler tests/performance/test_memory_profiling.py

# Run load tests with Locust
locust -f tests/performance/locustfile.py --users 10 --spawn-rate 2
```

### 7.2 Docker Test Environment

**docker-compose.test.yml**

```yaml
version: '3.8'

services:
  worker-tests:
    build:
      context: .
      dockerfile: Dockerfile.test
    environment:
      - AWS_ENDPOINT_URL=http://localstack:4566
      - OPENSEARCH_ENDPOINT=http://opensearch:9200
      - PYTHONUNBUFFERED=1
    volumes:
      - ./src:/app/src
      - ./tests:/app/tests
      - ./coverage:/app/coverage
    depends_on:
      - localstack
      - opensearch
    command: pytest tests --cov=src --cov-report=html:/app/coverage

  localstack:
    image: localstack/localstack:latest
    environment:
      - SERVICES=s3,sqs,dynamodb,secretsmanager
      - DEFAULT_REGION=us-east-1
      - DATA_DIR=/tmp/localstack/data
    ports:
      - "4566:4566"
    volumes:
      - localstack-data:/tmp/localstack

  opensearch:
    image: opensearchproject/opensearch:2.11.0
    environment:
      - discovery.type=single-node
      - OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m
      - DISABLE_SECURITY_PLUGIN=true
    ports:
      - "9200:9200"
      - "9600:9600"
    volumes:
      - opensearch-data:/usr/share/opensearch/data

volumes:
  localstack-data:
  opensearch-data:
```

**Run tests in Docker**

```bash
# Build and run tests
docker-compose -f docker-compose.test.yml up --build

# Run specific test suite
docker-compose -f docker-compose.test.yml run worker-tests \
  pytest tests/unit -v

# Cleanup
docker-compose -f docker-compose.test.yml down -v
```

---

## 8. Coverage Reports and Metrics

### 8.1 Coverage Configuration

**.coveragerc**

```ini
[run]
source = src
omit =
    */tests/*
    */test_*.py
    */__pycache__/*
    */venv/*
branch = True

[report]
precision = 2
show_missing = True
skip_covered = False
exclude_lines =
    pragma: no cover
    def __repr__
    if TYPE_CHECKING:
    raise AssertionError
    raise NotImplementedError
    if __name__ == .__main__.:
    @abstractmethod
    @abc.abstractmethod

[html]
directory = coverage_html
title = Python Worker Coverage Report

[xml]
output = coverage.xml
```

### 8.2 Coverage Targets by Module

| Module | Target Coverage | Current | Status |
|--------|----------------|---------|--------|
| file_processor.py | 90% | TBD | Pending |
| ocr_engine.py | 85% | TBD | Pending |
| bedrock_client.py | 85% | TBD | Pending |
| storage_handler.py | 90% | TBD | Pending |
| queue_manager.py | 90% | TBD | Pending |
| index_manager.py | 85% | TBD | Pending |
| spot_handler.py | 80% | TBD | Pending |
| retry_handler.py | 90% | TBD | Pending |
| **Overall** | **85%** | **TBD** | **Pending** |

---

## 9. Continuous Monitoring

### 9.1 Test Metrics Dashboard

Key metrics to track:

- **Test Execution Time**: Monitor for performance degradation
- **Test Flakiness Rate**: Target <2% flaky tests
- **Code Coverage Trend**: Track coverage over time
- **Test Failure Rate**: Monitor CI/CD pipeline health
- **Performance Benchmarks**: CPU/memory trends

### 9.2 Alerting Rules

```yaml
# .github/workflows/alerts.yml
test_quality_alerts:
  - name: Coverage Drop Alert
    condition: coverage < 80%
    action: create_issue

  - name: High Flakiness Alert
    condition: flaky_test_rate > 5%
    action: notify_slack

  - name: Performance Degradation
    condition: test_duration_increase > 20%
    action: notify_team
```

---

## Summary

This comprehensive testing strategy provides:

1. **80%+ Code Coverage** through unit, integration, and E2E tests
2. **Resilience Validation** for spot interruptions and network failures
3. **Performance Benchmarks** for CPU, memory, and throughput
4. **Auto Scaling Verification** for scale-out/scale-in scenarios
5. **CI/CD Integration** with automated test execution
6. **Quality Metrics** and continuous monitoring

### Next Steps

1. Implement test suites in `/backend/worker/tests/`
2. Configure CI/CD pipeline
3. Set up code coverage reporting
4. Establish performance baselines
5. Create test data fixtures
6. Document test execution procedures

---

**Document Version**: 1.0
**Last Updated**: 2025-01-17
**Status**: Ready for Implementation
