# Python Worker Testing - Quick Start Guide

## Overview

このガイドは、EC2 Pythonワーカーのテスト環境を迅速にセットアップし、テストを実行するための実践的な手順を提供します。

## Prerequisites

```bash
# Required software
- Python 3.11+
- Docker Desktop
- AWS CLI (configured)
- Git

# Optional (for development)
- PyCharm or VS Code
- Tesseract OCR (local testing)
```

## Quick Setup (5 minutes)

### Step 1: Create Project Structure

```bash
# Navigate to project root
cd /Users/tatsuya/focus_project/cis_filesearch_app

# Create Python worker directory structure
mkdir -p backend/worker/{src,tests/{unit,integration,performance,resilience,autoscaling,fixtures}}

# Create __init__.py files
touch backend/worker/src/__init__.py
touch backend/worker/tests/__init__.py
touch backend/worker/tests/unit/__init__.py
touch backend/worker/tests/integration/__init__.py
touch backend/worker/tests/performance/__init__.py
touch backend/worker/tests/resilience/__init__.py
touch backend/worker/tests/autoscaling/__init__.py
```

### Step 2: Install Dependencies

Create `backend/worker/requirements.txt`:

```txt
# Core dependencies
boto3==1.34.19
botocore==1.34.19
pytesseract==0.3.10
Pillow==10.1.0
pdf2image==1.17.0
opensearch-py==2.4.2
requests==2.31.0
python-dotenv==1.0.0
```

Create `backend/worker/requirements-test.txt`:

```txt
# Testing framework
pytest==7.4.3
pytest-cov==4.1.0
pytest-asyncio==0.21.1
pytest-mock==3.12.0
pytest-timeout==2.2.0
pytest-xdist==3.5.0
pytest-benchmark==4.0.0

# AWS mocking
moto[all]==4.2.9
boto3-stubs[s3,sqs,dynamodb,autoscaling,cloudwatch]==1.34.19

# Code quality
black==23.12.1
pylint==3.0.3
mypy==1.7.1
bandit==1.7.5

# Performance testing
locust==2.20.0
memory-profiler==0.61.0
pytest-memprof==0.2.0

# Coverage
coverage[toml]==7.4.0
```

Install dependencies:

```bash
cd backend/worker

# Create virtual environment
python3.11 -m venv venv

# Activate virtual environment
source venv/bin/activate  # macOS/Linux
# or
venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-test.txt
```

### Step 3: Create Test Configuration

Create `backend/worker/pytest.ini`:

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
    --cov-fail-under=80
    -n auto
markers =
    unit: Unit tests (fast, isolated)
    integration: Integration tests (requires AWS services)
    e2e: End-to-end tests (full workflow)
    performance: Performance and benchmark tests
    resilience: Resilience and failure tests
    slow: Slow running tests (>5 seconds)
timeout = 300
```

Create `backend/worker/pyproject.toml`:

```toml
[tool.coverage.run]
source = ["src"]
omit = [
    "*/tests/*",
    "*/__pycache__/*",
]
branch = true

[tool.coverage.report]
precision = 2
show_missing = true
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "if TYPE_CHECKING:",
    "raise NotImplementedError",
]

[tool.black]
line-length = 100
target-version = ['py311']

[tool.mypy]
python_version = "3.11"
warn_return_any = true
warn_unused_configs = true
```

### Step 4: Create Sample Source Code

Create `backend/worker/src/models.py`:

```python
"""
Data models for file processing.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional


@dataclass
class FileMessage:
    """SQS message representing file upload event."""

    event_type: str
    s3_bucket: str
    s3_key: str
    file_size: int
    uploaded_at: datetime
    metadata: Dict[str, str]

    @classmethod
    def from_dict(cls, data: Dict) -> 'FileMessage':
        """Create FileMessage from dictionary."""
        return cls(
            event_type=data['eventType'],
            s3_bucket=data['s3Bucket'],
            s3_key=data['s3Key'],
            file_size=data['fileSize'],
            uploaded_at=datetime.fromisoformat(data['uploadedAt']),
            metadata=data.get('metadata', {})
        )


@dataclass
class ProcessingResult:
    """Result of file processing operation."""

    status: str  # SUCCESS, FAILED, PARTIAL
    file_id: str
    ocr_text: Optional[str] = None
    image_vector: Optional[List[float]] = None
    thumbnail_url: Optional[str] = None
    error_message: Optional[str] = None
    processing_time_seconds: float = 0.0
```

Create `backend/worker/src/file_processor.py`:

```python
"""
Main file processor for handling SQS messages.
"""

import logging
from pathlib import Path
from typing import Optional
import time

from .models import FileMessage, ProcessingResult

logger = logging.getLogger(__name__)


class ProcessingError(Exception):
    """Custom exception for processing errors."""

    def __init__(self, message: str, retry_allowed: bool = True):
        super().__init__(message)
        self.retry_allowed = retry_allowed


class FileProcessor:
    """
    Main file processor class.

    Handles complete file processing workflow:
    1. Download from S3
    2. OCR processing
    3. Image vectorization
    4. Indexing
    """

    def __init__(
        self,
        s3_client=None,
        bedrock_client=None,
        ocr_engine=None,
        index_manager=None,
        spot_aware: bool = False
    ):
        """Initialize file processor with dependencies."""
        self.s3_client = s3_client
        self.bedrock_client = bedrock_client
        self.ocr_engine = ocr_engine
        self.index_manager = index_manager
        self.spot_aware = spot_aware

    def process_message(self, message: FileMessage) -> ProcessingResult:
        """
        Process a single file message.

        Args:
            message: FileMessage instance

        Returns:
            ProcessingResult with status and extracted data

        Raises:
            ProcessingError: If processing fails
        """
        start_time = time.time()

        try:
            logger.info(f"Processing file: {message.s3_key}")

            # Validate message
            if not self.validate_message(message):
                raise ProcessingError("Invalid message format", retry_allowed=False)

            # Download file from S3
            local_path = self._download_file(message)

            # Detect file type
            file_type = self.detect_file_type(local_path)

            result = ProcessingResult(
                status="SUCCESS",
                file_id=self._generate_file_id(message)
            )

            # Process based on file type
            if file_type in ['application/pdf', 'image/jpeg', 'image/png']:
                # OCR processing
                if self.ocr_engine:
                    result.ocr_text = self.ocr_engine.extract_text(local_path)

            if file_type in ['image/jpeg', 'image/png']:
                # Image vectorization
                if self.bedrock_client:
                    result.image_vector = self.bedrock_client.get_embeddings(local_path)

            # Index to OpenSearch/DynamoDB
            if self.index_manager:
                self.index_manager.index_document({
                    'file_id': result.file_id,
                    'file_path': message.s3_key,
                    'ocr_text': result.ocr_text,
                    'image_vector': result.image_vector
                })

            # Cleanup temp files
            self.cleanup_temp_files([local_path])

            result.processing_time_seconds = time.time() - start_time
            logger.info(f"Successfully processed {message.s3_key} in {result.processing_time_seconds:.2f}s")

            return result

        except Exception as e:
            logger.error(f"Failed to process {message.s3_key}: {str(e)}")
            raise ProcessingError(str(e))

    def validate_message(self, message: FileMessage) -> bool:
        """Validate message has required fields."""
        if not message.s3_bucket or not message.s3_key:
            return False
        if message.file_size <= 0:
            return False
        return True

    def detect_file_type(self, file_path: str) -> str:
        """Detect MIME type from file extension."""
        ext_map = {
            '.pdf': 'application/pdf',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.txt': 'text/plain',
        }
        ext = Path(file_path).suffix.lower()
        return ext_map.get(ext, 'application/octet-stream')

    def cleanup_temp_files(self, file_paths: list) -> None:
        """Clean up temporary files."""
        for path in file_paths:
            try:
                Path(path).unlink(missing_ok=True)
            except Exception as e:
                logger.warning(f"Failed to cleanup {path}: {e}")

    def _download_file(self, message: FileMessage) -> str:
        """Download file from S3 to local temp directory."""
        # Implementation would use S3 client
        local_path = f"/tmp/{Path(message.s3_key).name}"
        if self.s3_client:
            self.s3_client.download_file(
                bucket=message.s3_bucket,
                key=message.s3_key,
                local_path=local_path
            )
        return local_path

    def _generate_file_id(self, message: FileMessage) -> str:
        """Generate unique file ID."""
        import hashlib
        hash_input = f"{message.s3_bucket}:{message.s3_key}:{message.uploaded_at}"
        return hashlib.sha256(hash_input.encode()).hexdigest()[:16]
```

### Step 5: Create Your First Test

Create `backend/worker/tests/unit/test_file_processor.py`:

```python
"""
Unit tests for file processor.
"""

import pytest
from unittest.mock import Mock, MagicMock
from datetime import datetime

from src.file_processor import FileProcessor, ProcessingError
from src.models import FileMessage, ProcessingResult


class TestFileProcessor:
    """Test suite for FileProcessor."""

    @pytest.fixture
    def processor(self):
        """Create processor with mocked dependencies."""
        return FileProcessor(
            s3_client=Mock(),
            bedrock_client=Mock(),
            ocr_engine=Mock(),
            index_manager=Mock()
        )

    @pytest.fixture
    def sample_message(self):
        """Create sample file message."""
        return FileMessage(
            event_type="FILE_UPLOADED",
            s3_bucket="test-bucket",
            s3_key="documents/test.pdf",
            file_size=1024,
            uploaded_at=datetime.now(),
            metadata={"mimeType": "application/pdf"}
        )

    def test_validate_message_valid(self, processor, sample_message):
        """Test message validation with valid input."""
        assert processor.validate_message(sample_message) is True

    def test_validate_message_empty_bucket(self, processor, sample_message):
        """Test message validation rejects empty bucket."""
        sample_message.s3_bucket = ""
        assert processor.validate_message(sample_message) is False

    def test_validate_message_zero_size(self, processor, sample_message):
        """Test message validation rejects zero file size."""
        sample_message.file_size = 0
        assert processor.validate_message(sample_message) is False

    def test_detect_file_type_pdf(self, processor):
        """Test PDF file type detection."""
        file_type = processor.detect_file_type("/tmp/document.pdf")
        assert file_type == "application/pdf"

    def test_detect_file_type_jpg(self, processor):
        """Test JPG file type detection."""
        file_type = processor.detect_file_type("/tmp/image.jpg")
        assert file_type == "image/jpeg"

    def test_detect_file_type_unknown(self, processor):
        """Test unknown file type defaults to octet-stream."""
        file_type = processor.detect_file_type("/tmp/file.xyz")
        assert file_type == "application/octet-stream"

    def test_process_message_success(self, processor, sample_message):
        """Test successful message processing."""
        # Mock dependencies
        processor.s3_client.download_file.return_value = "/tmp/test.pdf"
        processor.ocr_engine.extract_text.return_value = "PDF content"
        processor.index_manager.index_document.return_value = True

        # Execute
        result = processor.process_message(sample_message)

        # Verify
        assert result.status == "SUCCESS"
        assert result.ocr_text == "PDF content"
        processor.s3_client.download_file.assert_called_once()
        processor.ocr_engine.extract_text.assert_called_once()
        processor.index_manager.index_document.assert_called_once()

    def test_process_message_invalid_format(self, processor):
        """Test processing fails with invalid message."""
        invalid_message = FileMessage(
            event_type="FILE_UPLOADED",
            s3_bucket="",  # Invalid
            s3_key="test.pdf",
            file_size=1024,
            uploaded_at=datetime.now(),
            metadata={}
        )

        with pytest.raises(ProcessingError) as exc_info:
            processor.process_message(invalid_message)

        assert "Invalid message format" in str(exc_info.value)
        assert exc_info.value.retry_allowed is False
```

### Step 6: Run Your First Test

```bash
# Activate virtual environment
cd backend/worker
source venv/bin/activate

# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=term-missing

# Run specific test
pytest tests/unit/test_file_processor.py -v

# Run with detailed output
pytest -v -s

# Expected output:
# ============================= test session starts ==============================
# collected 7 items
#
# tests/unit/test_file_processor.py::TestFileProcessor::test_validate_message_valid PASSED
# tests/unit/test_file_processor.py::TestFileProcessor::test_validate_message_empty_bucket PASSED
# tests/unit/test_file_processor.py::TestFileProcessor::test_validate_message_zero_size PASSED
# tests/unit/test_file_processor.py::TestFileProcessor::test_detect_file_type_pdf PASSED
# tests/unit/test_file_processor.py::TestFileProcessor::test_detect_file_type_jpg PASSED
# tests/unit/test_file_processor.py::TestFileProcessor::test_detect_file_type_unknown PASSED
# tests/unit/test_file_processor.py::TestFileProcessor::test_process_message_success PASSED
#
# ----------- coverage: platform darwin, python 3.11.7 -----------
# Name                          Stmts   Miss  Cover   Missing
# -----------------------------------------------------------
# src/file_processor.py            45      2    96%   78-79
# src/models.py                    15      0   100%
# -----------------------------------------------------------
# TOTAL                            60      2    97%
#
# ============================== 7 passed in 0.15s ===============================
```

## Docker-based Testing (Recommended)

### Create Docker Test Environment

Create `backend/worker/Dockerfile.test`:

```dockerfile
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-jpn \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements
COPY requirements.txt requirements-test.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir -r requirements-test.txt

# Copy source code
COPY src/ ./src/
COPY tests/ ./tests/
COPY pytest.ini pyproject.toml ./

# Run tests by default
CMD ["pytest", "--cov=src", "--cov-report=term-missing"]
```

Create `backend/worker/docker-compose.test.yml`:

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
    volumes:
      - ./src:/app/src
      - ./tests:/app/tests
      - ./coverage:/app/coverage
    depends_on:
      - localstack
      - opensearch

  localstack:
    image: localstack/localstack:3.0
    environment:
      - SERVICES=s3,sqs,dynamodb
      - DEFAULT_REGION=us-east-1
    ports:
      - "4566:4566"

  opensearch:
    image: opensearchproject/opensearch:2.11.0
    environment:
      - discovery.type=single-node
      - OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m
      - DISABLE_SECURITY_PLUGIN=true
    ports:
      - "9200:9200"
```

### Run Tests in Docker

```bash
cd backend/worker

# Build and run all tests
docker-compose -f docker-compose.test.yml up --build

# Run specific test suite
docker-compose -f docker-compose.test.yml run worker-tests \
  pytest tests/unit -v

# Run with interactive shell
docker-compose -f docker-compose.test.yml run worker-tests bash

# Cleanup
docker-compose -f docker-compose.test.yml down -v
```

## Test Development Workflow

### 1. Write Failing Test (RED)

```python
# tests/unit/test_ocr_engine.py
def test_extract_text_from_pdf():
    """Test OCR extracts text from PDF."""
    engine = OCREngine()
    text = engine.extract_text("sample.pdf")
    assert "expected text" in text
```

### 2. Run Test (Should Fail)

```bash
pytest tests/unit/test_ocr_engine.py::test_extract_text_from_pdf -v

# Expected: FAILED (method not implemented)
```

### 3. Implement Minimal Code (GREEN)

```python
# src/ocr_engine.py
class OCREngine:
    def extract_text(self, file_path: str) -> str:
        """Extract text from PDF using Tesseract."""
        import pytesseract
        from pdf2image import convert_from_path

        images = convert_from_path(file_path)
        text = ""
        for img in images:
            text += pytesseract.image_to_string(img, lang='jpn')
        return text
```

### 4. Run Test (Should Pass)

```bash
pytest tests/unit/test_ocr_engine.py::test_extract_text_from_pdf -v

# Expected: PASSED
```

### 5. Refactor (REFACTOR)

```python
# Improve implementation while keeping tests green
class OCREngine:
    def __init__(self, languages: List[str] = None):
        self.languages = languages or ['jpn', 'eng']

    def extract_text(self, file_path: str) -> str:
        """Extract text with configurable languages."""
        # ... improved implementation
```

### 6. Verify Tests Still Pass

```bash
pytest tests/unit/test_ocr_engine.py -v
```

## Common Testing Patterns

### Pattern 1: Mocking AWS Services

```python
from moto import mock_s3, mock_sqs
import boto3

@mock_s3
def test_s3_download():
    # Create mock S3
    s3 = boto3.client('s3', region_name='us-east-1')
    s3.create_bucket(Bucket='test-bucket')
    s3.put_object(Bucket='test-bucket', Key='file.txt', Body=b'content')

    # Test your code
    handler = S3Handler(s3)
    content = handler.download('test-bucket', 'file.txt')
    assert content == b'content'
```

### Pattern 2: Fixture Reuse

```python
# tests/fixtures/file_messages.py
import pytest

@pytest.fixture
def pdf_message():
    return FileMessage(
        event_type="FILE_UPLOADED",
        s3_bucket="test-bucket",
        s3_key="document.pdf",
        file_size=1024,
        uploaded_at=datetime.now(),
        metadata={"mimeType": "application/pdf"}
    )

# Use in tests
def test_process_pdf(processor, pdf_message):
    result = processor.process_message(pdf_message)
    assert result.status == "SUCCESS"
```

### Pattern 3: Parametrized Tests

```python
@pytest.mark.parametrize("file_ext,mime_type", [
    ("pdf", "application/pdf"),
    ("jpg", "image/jpeg"),
    ("png", "image/png"),
])
def test_file_type_detection(processor, file_ext, mime_type):
    detected = processor.detect_file_type(f"file.{file_ext}")
    assert detected == mime_type
```

## Troubleshooting

### Issue: Tests fail with "Module not found"

```bash
# Solution: Add src to Python path
export PYTHONPATH="${PYTHONPATH}:${PWD}/src"

# Or use pytest plugin
pip install pytest-pythonpath
```

### Issue: Coverage not showing all files

```bash
# Solution: Ensure .coveragerc is configured correctly
[run]
source = src
omit = */tests/*
```

### Issue: Tests timeout

```bash
# Solution: Increase timeout in pytest.ini
[pytest]
timeout = 600  # 10 minutes
```

### Issue: LocalStack connection refused

```bash
# Solution: Wait for services to start
docker-compose up -d
sleep 10
pytest tests/integration
```

## Next Steps

1. **Implement remaining modules**:
   - OCR Engine
   - Bedrock Client
   - Storage Handler
   - Queue Manager
   - Index Manager

2. **Add integration tests**:
   - SQS message flow
   - S3 file operations
   - OpenSearch indexing

3. **Set up CI/CD**:
   - GitHub Actions workflow
   - Automated test execution
   - Coverage reporting

4. **Performance testing**:
   - Load tests with Locust
   - Memory profiling
   - CPU benchmarking

5. **Resilience testing**:
   - Spot interruption handling
   - Network failure scenarios
   - Service throttling

## Resources

- [pytest Documentation](https://docs.pytest.org/)
- [moto (AWS Mocking)](https://docs.getmoto.org/)
- [coverage.py](https://coverage.readthedocs.io/)
- [Python Testing Best Practices](https://realpython.com/pytest-python-testing/)

---

**Quick Reference Commands**

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific marker
pytest -m unit

# Run in parallel
pytest -n auto

# Watch mode (requires pytest-watch)
ptw

# Generate coverage badge
coverage-badge -o coverage.svg
```

---

**Status**: Ready for Development
**Last Updated**: 2025-01-17
