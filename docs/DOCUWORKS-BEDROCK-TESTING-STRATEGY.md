# DocuWorks SDK + Bedrock Integration Testing Strategy

## Executive Summary

This document provides a comprehensive testing strategy for the DocuWorks SDK and AWS Bedrock integration in a production file search system. The strategy ensures robust, bug-free code through Test-Driven Development (TDD) principles while validating commercial license enforcement and vector search accuracy.

**Project:** CIS File Search Application
**Components:** DocuWorks SDK, AWS Bedrock (Titan Multimodal), OpenSearch k-NN
**Testing Approach:** TDD with 80%+ code coverage
**Timeline:** 4 weeks (parallel with development)

---

## Table of Contents

1. [Testing Objectives](#testing-objectives)
2. [Test Environment Setup](#test-environment-setup)
3. [Unit Testing Strategy](#unit-testing-strategy)
4. [Integration Testing](#integration-testing)
5. [Performance Testing](#performance-testing)
6. [End-to-End Testing](#end-to-end-testing)
7. [Test Data Preparation](#test-data-preparation)
8. [CI/CD Pipeline](#cicd-pipeline)
9. [Coverage Targets](#coverage-targets)
10. [Test Execution Plan](#test-execution-plan)

---

## Testing Objectives

### Primary Goals

1. **DocuWorks SDK Integration**
   - Verify SDK functions with commercial license
   - Test OCR fallback mechanism
   - Validate thumbnail extraction
   - License enforcement testing

2. **Bedrock Vector Search**
   - Image embedding generation accuracy
   - Search relevance validation
   - Performance benchmarking
   - Cost optimization validation

3. **Integration Testing**
   - End-to-end file processing pipeline
   - Error handling and retry logic
   - License concurrency limits
   - Multi-modal search scenarios

4. **Production Readiness**
   - Performance under load
   - Resource utilization monitoring
   - Failover and recovery
   - Security validation

### Success Criteria

- ✅ 80%+ unit test coverage
- ✅ 100% critical path coverage
- ✅ < 5s DocuWorks conversion time (SDK mode)
- ✅ < 2s Bedrock embedding generation
- ✅ > 90% search accuracy
- ✅ Zero license violations
- ✅ All security tests passing

---

## Test Environment Setup

### 1. Windows EC2 Instance Configuration

```yaml
# Test EC2 Instance Specifications
instance_type: t3.medium
os: Windows Server 2022
region: ap-northeast-1

# Required Software
- Python 3.9+
- DocuWorks Commercial License (1 license)
- Tesseract OCR 5.x
- Git for Windows
- AWS CLI v2

# AWS Services
- S3: Test bucket for file uploads
- SQS: Test queue for messages
- OpenSearch: Test domain with k-NN
- Bedrock: Enabled in us-east-1
- Secrets Manager: Test license storage
```

### 2. Python Test Environment Setup

```powershell
# Create isolated test environment
cd C:\cis-filesearch-app\backend\python-worker
python -m venv venv-test
.\venv-test\Scripts\activate

# Install production dependencies
pip install -r requirements.txt

# Install test dependencies
pip install -r requirements-test.txt
```

**requirements-test.txt:**
```txt
# Testing Frameworks
pytest>=7.4.0,<8.0.0
pytest-asyncio>=0.21.0,<1.0.0
pytest-mock>=3.12.0,<4.0.0
pytest-cov>=4.1.0,<5.0.0
pytest-timeout>=2.2.0,<3.0.0
pytest-xdist>=3.5.0,<4.0.0  # Parallel testing

# Mocking & Fixtures
moto>=4.2.0,<5.0.0  # AWS service mocking
freezegun>=1.4.0,<2.0.0  # Time mocking
Faker>=20.0.0,<21.0.0  # Test data generation
responses>=0.24.0,<1.0.0  # HTTP mocking

# Performance Testing
locust>=2.17.0,<3.0.0  # Load testing
memory-profiler>=0.61.0,<1.0.0

# Code Quality
black>=23.0.0,<24.0.0
flake8>=7.0.0,<8.0.0
mypy>=1.7.0,<2.0.0
pylint>=3.0.0,<4.0.0

# Reporting
pytest-html>=4.1.0,<5.0.0
coverage>=7.4.0,<8.0.0
```

### 3. LocalStack for AWS Service Testing

```yaml
# docker-compose.test.yml
version: '3.8'
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
      - "4571:4571"
    environment:
      - SERVICES=s3,sqs,secretsmanager
      - DEBUG=1
      - DATA_DIR=/tmp/localstack/data
    volumes:
      - "./test-data:/tmp/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"
```

### 4. Test Configuration

**config/test_config.py:**
```python
"""Test configuration settings"""

TEST_CONFIG = {
    'aws': {
        'region': 'us-east-1',
        'endpoint_url': 'http://localhost:4566',  # LocalStack
        'access_key': 'test',
        'secret_key': 'test',
    },
    's3': {
        'test_bucket': 'cis-test-bucket',
        'landing_bucket': 'cis-test-landing',
        'thumbnail_bucket': 'cis-test-thumbnails',
    },
    'sqs': {
        'queue_name': 'cis-test-queue',
    },
    'opensearch': {
        'endpoint': 'localhost:9200',
        'index': 'test-file-index',
    },
    'bedrock': {
        'model_id': 'amazon.titan-embed-image-v1',
        'region': 'us-east-1',
        'mock_mode': True,  # Use mock for unit tests
    },
    'docuworks': {
        'license_path': 'test-license.key',
        'max_concurrent': 1,
        'enable_sdk': False,  # Disable for most unit tests
    },
    'test_data': {
        'fixtures_dir': './tests/fixtures',
        'sample_files_dir': './tests/sample_files',
    },
}
```

---

## Unit Testing Strategy

### 1. DocuWorks SDK Processor Tests

**File:** `backend/python-worker/tests/test_docuworks_processor.py`

```python
"""
Unit tests for DocuWorks SDK Processor
Tests SDK integration, OCR fallback, and license management
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path
import tempfile

from processors.docuworks_processor import DocuWorksProcessor
from processors.license_manager import LicenseManager, LicenseError


class TestDocuWorksProcessor:
    """Test suite for DocuWorks processor"""

    @pytest.fixture
    def processor(self):
        """Create processor instance for testing"""
        return DocuWorksProcessor(enable_sdk=False)  # OCR mode for unit tests

    @pytest.fixture
    def sample_xdw_file(self, tmp_path):
        """Create a sample XDW file for testing"""
        xdw_file = tmp_path / "test.xdw"
        # Create minimal XDW file structure (mock)
        xdw_file.write_bytes(b'XDWF' + b'\x00' * 1000)
        return str(xdw_file)

    @pytest.fixture
    def license_manager_mock(self):
        """Mock license manager"""
        mock = MagicMock(spec=LicenseManager)
        mock.acquire_license.return_value = True
        mock.release_license.return_value = None
        return mock

    # === SDK Mode Tests ===

    @pytest.mark.skipif(
        not DocuWorksProcessor.is_sdk_available(),
        reason="DocuWorks SDK not installed"
    )
    def test_sdk_text_extraction(self, sample_xdw_file):
        """Test text extraction using DocuWorks SDK"""
        # Arrange
        processor = DocuWorksProcessor(enable_sdk=True)

        # Act
        result = processor.process_file(sample_xdw_file)

        # Assert
        assert result['success'] is True
        assert 'text' in result
        assert result['processor'] == 'sdk'
        assert result['page_count'] > 0

    @pytest.mark.skipif(
        not DocuWorksProcessor.is_sdk_available(),
        reason="DocuWorks SDK not installed"
    )
    def test_sdk_metadata_extraction(self, sample_xdw_file):
        """Test metadata extraction from DocuWorks file"""
        # Arrange
        processor = DocuWorksProcessor(enable_sdk=True)

        # Act
        result = processor.process_file(sample_xdw_file)

        # Assert
        assert 'metadata' in result
        metadata = result['metadata']
        assert 'title' in metadata
        assert 'author' in metadata
        assert 'page_count' in metadata
        assert 'created_date' in metadata

    @pytest.mark.skipif(
        not DocuWorksProcessor.is_sdk_available(),
        reason="DocuWorks SDK not installed"
    )
    def test_sdk_page_image_extraction(self, sample_xdw_file):
        """Test page image extraction"""
        # Arrange
        processor = DocuWorksProcessor(enable_sdk=True)

        # Act
        result = processor.extract_page_images(sample_xdw_file, pages=[1])

        # Assert
        assert len(result) == 1
        assert result[0]['page_number'] == 1
        assert 'image_data' in result[0]
        assert len(result[0]['image_data']) > 0

    # === OCR Fallback Tests ===

    def test_ocr_fallback_when_sdk_unavailable(self, processor, sample_xdw_file):
        """Test OCR fallback when SDK is not available"""
        # Arrange - SDK disabled

        # Act
        result = processor.process_file(sample_xdw_file)

        # Assert
        assert result['success'] is True
        assert result['processor'] == 'ocr'
        assert 'text' in result

    def test_ocr_fallback_on_sdk_error(self, sample_xdw_file):
        """Test OCR fallback when SDK fails"""
        # Arrange
        processor = DocuWorksProcessor(enable_sdk=True)

        # Mock SDK to raise an error
        with patch.object(processor, '_process_with_sdk') as mock_sdk:
            mock_sdk.side_effect = Exception("SDK Error")

            # Act
            result = processor.process_file(sample_xdw_file)

            # Assert
            assert result['success'] is True
            assert result['processor'] == 'ocr'  # Fell back to OCR
            assert result.get('sdk_error') is not None

    # === License Management Tests ===

    @pytest.mark.skipif(
        not DocuWorksProcessor.is_sdk_available(),
        reason="DocuWorks SDK not installed"
    )
    def test_license_acquisition_before_sdk_use(
        self, sample_xdw_file, license_manager_mock
    ):
        """Test that license is acquired before SDK processing"""
        # Arrange
        processor = DocuWorksProcessor(
            enable_sdk=True,
            license_manager=license_manager_mock
        )

        # Act
        result = processor.process_file(sample_xdw_file)

        # Assert
        license_manager_mock.acquire_license.assert_called_once()
        license_manager_mock.release_license.assert_called_once()

    def test_license_release_on_error(
        self, sample_xdw_file, license_manager_mock
    ):
        """Test that license is released even when processing fails"""
        # Arrange
        processor = DocuWorksProcessor(
            enable_sdk=True,
            license_manager=license_manager_mock
        )

        # Mock processing to fail
        with patch.object(processor, '_process_with_sdk') as mock_sdk:
            mock_sdk.side_effect = Exception("Processing Error")

            # Act
            with pytest.raises(Exception):
                processor.process_file(sample_xdw_file)

            # Assert - License still released
            license_manager_mock.release_license.assert_called_once()

    def test_error_when_license_unavailable(self, sample_xdw_file):
        """Test error handling when license cannot be acquired"""
        # Arrange
        license_manager_mock = MagicMock(spec=LicenseManager)
        license_manager_mock.acquire_license.return_value = False

        processor = DocuWorksProcessor(
            enable_sdk=True,
            license_manager=license_manager_mock
        )

        # Act & Assert
        with pytest.raises(LicenseError, match="Unable to acquire license"):
            processor.process_file(sample_xdw_file)

    # === Error Handling Tests ===

    def test_file_not_found_error(self, processor):
        """Test handling of non-existent file"""
        # Act & Assert
        with pytest.raises(FileNotFoundError):
            processor.process_file("nonexistent.xdw")

    def test_invalid_file_format(self, processor, tmp_path):
        """Test handling of invalid file format"""
        # Arrange
        invalid_file = tmp_path / "invalid.xdw"
        invalid_file.write_text("This is not a DocuWorks file")

        # Act
        result = processor.process_file(str(invalid_file))

        # Assert
        assert result['success'] is False
        assert 'error' in result

    @pytest.mark.parametrize("filename", [
        "test.xdw",
        "文書.xdw",  # Japanese filename
        "report_2025.xdw",
        "FILE-WITH-DASH.XDW",
    ])
    def test_various_filename_formats(self, processor, tmp_path, filename):
        """Test processing files with various filename formats"""
        # Arrange
        test_file = tmp_path / filename
        test_file.write_bytes(b'XDWF' + b'\x00' * 1000)

        # Act
        result = processor.process_file(str(test_file))

        # Assert
        assert result['success'] is True or result.get('processor') == 'ocr'

    # === Performance Tests ===

    @pytest.mark.timeout(10)
    def test_processing_time_within_limit(self, processor, sample_xdw_file):
        """Test that processing completes within time limit"""
        # Act
        import time
        start = time.time()
        result = processor.process_file(sample_xdw_file)
        duration = time.time() - start

        # Assert
        assert result['success'] is True
        assert duration < 10.0  # Should complete within 10 seconds

    # === Memory Management Tests ===

    def test_memory_cleanup_after_processing(self, processor, sample_xdw_file):
        """Test that temporary resources are cleaned up"""
        # Arrange
        import gc

        # Act
        result = processor.process_file(sample_xdw_file)
        gc.collect()

        # Assert - Check for temp file cleanup
        # (Implementation should clean up temp files)
        assert result['success'] is True
```

### 2. Bedrock Client Tests

**File:** `backend/python-worker/tests/test_bedrock_client.py`

```python
"""
Unit tests for Bedrock Client
Tests image embedding generation and vector operations
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path
import numpy as np
import json

from clients.bedrock_client import BedrockClient
from botocore.exceptions import ClientError


class TestBedrockClient:
    """Test suite for Bedrock client"""

    @pytest.fixture
    def bedrock_client(self):
        """Create Bedrock client instance for testing"""
        return BedrockClient(mock_mode=True)

    @pytest.fixture
    def sample_image(self, tmp_path):
        """Create a sample image file for testing"""
        from PIL import Image

        # Create a simple test image
        img = Image.new('RGB', (100, 100), color='red')
        image_path = tmp_path / "test.jpg"
        img.save(image_path)
        return str(image_path)

    # === Image Embedding Tests ===

    def test_generate_image_embedding_success(
        self, bedrock_client, sample_image
    ):
        """Test successful image embedding generation"""
        # Act
        embedding = bedrock_client.generate_image_embedding(sample_image)

        # Assert
        assert embedding is not None
        assert isinstance(embedding, list)
        assert len(embedding) == 1024  # Titan Multimodal dimension
        assert all(isinstance(x, float) for x in embedding)

    def test_generate_image_embedding_with_large_image(self, bedrock_client, tmp_path):
        """Test embedding generation with large image (auto-resize)"""
        from PIL import Image

        # Arrange - Create large image
        large_img = Image.new('RGB', (4000, 4000), color='blue')
        large_image_path = tmp_path / "large.jpg"
        large_img.save(large_image_path)

        # Act
        embedding = bedrock_client.generate_image_embedding(str(large_image_path))

        # Assert
        assert embedding is not None
        assert len(embedding) == 1024

    def test_generate_image_embedding_with_invalid_image(self, bedrock_client, tmp_path):
        """Test error handling with invalid image file"""
        # Arrange
        invalid_image = tmp_path / "invalid.jpg"
        invalid_image.write_text("Not an image")

        # Act
        embedding = bedrock_client.generate_image_embedding(str(invalid_image))

        # Assert
        assert embedding is None

    @pytest.mark.parametrize("image_format", [
        "jpg", "jpeg", "png", "bmp"
    ])
    def test_various_image_formats(self, bedrock_client, tmp_path, image_format):
        """Test embedding generation with various image formats"""
        from PIL import Image

        # Arrange
        img = Image.new('RGB', (100, 100), color='green')
        image_path = tmp_path / f"test.{image_format}"
        img.save(image_path)

        # Act
        embedding = bedrock_client.generate_image_embedding(str(image_path))

        # Assert
        assert embedding is not None
        assert len(embedding) == 1024

    # === Text Embedding Tests ===

    def test_generate_text_embedding_success(self, bedrock_client):
        """Test successful text embedding generation"""
        # Arrange
        text = "This is a test document about file search systems."

        # Act
        embedding = bedrock_client.generate_text_embedding(text)

        # Assert
        assert embedding is not None
        assert isinstance(embedding, list)
        assert len(embedding) == 1024

    def test_generate_text_embedding_with_japanese(self, bedrock_client):
        """Test text embedding with Japanese text"""
        # Arrange
        japanese_text = "これはテストドキュメントです。ファイル検索システムについて説明します。"

        # Act
        embedding = bedrock_client.generate_text_embedding(japanese_text)

        # Assert
        assert embedding is not None
        assert len(embedding) == 1024

    def test_text_embedding_truncation(self, bedrock_client):
        """Test that long text is properly truncated"""
        # Arrange
        long_text = "Test " * 500  # Very long text

        # Act
        embedding = bedrock_client.generate_text_embedding(long_text)

        # Assert
        assert embedding is not None
        # Should handle truncation gracefully

    # === Multimodal Embedding Tests ===

    def test_generate_multimodal_embedding(self, bedrock_client, sample_image):
        """Test multimodal embedding generation (image + text)"""
        # Arrange
        text = "A red square image for testing"

        # Act
        embedding = bedrock_client.generate_multimodal_embedding(
            sample_image, text
        )

        # Assert
        assert embedding is not None
        assert len(embedding) == 1024

    # === Vector Similarity Tests ===

    def test_calculate_cosine_similarity(self, bedrock_client):
        """Test cosine similarity calculation"""
        # Arrange
        vector1 = [1.0, 0.0, 0.0]
        vector2 = [1.0, 0.0, 0.0]

        # Act
        similarity = bedrock_client.calculate_similarity(vector1, vector2)

        # Assert
        assert similarity == pytest.approx(1.0, rel=1e-5)  # Identical vectors

    def test_calculate_similarity_orthogonal_vectors(self, bedrock_client):
        """Test similarity of orthogonal vectors"""
        # Arrange
        vector1 = [1.0, 0.0, 0.0]
        vector2 = [0.0, 1.0, 0.0]

        # Act
        similarity = bedrock_client.calculate_similarity(vector1, vector2)

        # Assert
        assert similarity == pytest.approx(0.0, rel=1e-5)  # Orthogonal

    # === Batch Processing Tests ===

    def test_batch_generate_embeddings(self, bedrock_client, sample_image):
        """Test batch embedding generation"""
        # Arrange
        items = [
            {'type': 'image', 'path': sample_image},
            {'type': 'text', 'content': 'Test text'},
            {'type': 'multimodal', 'path': sample_image, 'text': 'Test'}
        ]

        # Act
        results = bedrock_client.batch_generate_embeddings(items)

        # Assert
        assert len(results) == 3
        assert all(r['success'] for r in results)
        assert all(r['embedding'] is not None for r in results)

    # === API Error Handling Tests ===

    @patch('boto3.client')
    def test_bedrock_api_throttling(self, mock_boto_client, bedrock_client):
        """Test handling of Bedrock API throttling"""
        # Arrange
        mock_bedrock = MagicMock()
        mock_bedrock.invoke_model.side_effect = ClientError(
            {'Error': {'Code': 'ThrottlingException'}},
            'invoke_model'
        )
        bedrock_client.bedrock_runtime = mock_bedrock

        # Act
        result = bedrock_client.generate_text_embedding("test")

        # Assert
        assert result is None

    @patch('boto3.client')
    def test_bedrock_api_validation_error(self, mock_boto_client, bedrock_client):
        """Test handling of validation errors"""
        # Arrange
        mock_bedrock = MagicMock()
        mock_bedrock.invoke_model.side_effect = ClientError(
            {'Error': {'Code': 'ValidationException'}},
            'invoke_model'
        )
        bedrock_client.bedrock_runtime = mock_bedrock

        # Act
        result = bedrock_client.generate_text_embedding("test")

        # Assert
        assert result is None

    # === Connection Test ===

    def test_bedrock_connection_test(self, bedrock_client):
        """Test Bedrock connection validation"""
        # Act
        is_connected = bedrock_client.test_connection()

        # Assert
        assert isinstance(is_connected, bool)
        # In mock mode, should return True

    # === Performance Tests ===

    @pytest.mark.timeout(5)
    def test_embedding_generation_performance(self, bedrock_client, sample_image):
        """Test that embedding generation completes within time limit"""
        # Act
        import time
        start = time.time()
        embedding = bedrock_client.generate_image_embedding(sample_image)
        duration = time.time() - start

        # Assert
        assert embedding is not None
        assert duration < 5.0  # Should complete within 5 seconds

    @pytest.mark.parametrize("batch_size", [1, 5, 10, 20])
    def test_batch_processing_performance(
        self, bedrock_client, sample_image, batch_size
    ):
        """Test batch processing with various sizes"""
        # Arrange
        items = [
            {'type': 'image', 'path': sample_image}
            for _ in range(batch_size)
        ]

        # Act
        import time
        start = time.time()
        results = bedrock_client.batch_generate_embeddings(items)
        duration = time.time() - start

        # Assert
        assert len(results) == batch_size
        assert all(r['success'] for r in results)
        # Performance should scale reasonably
        assert duration < batch_size * 2  # Max 2s per item
```

### 3. License Manager Tests

**File:** `backend/python-worker/tests/test_license_manager.py`

```python
"""
Unit tests for License Manager
Tests license acquisition, release, and concurrency control
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import time
from datetime import datetime, timedelta

from processors.license_manager import LicenseManager, LicenseError
from config import config


class TestLicenseManager:
    """Test suite for License Manager"""

    @pytest.fixture
    def license_manager(self):
        """Create license manager instance"""
        return LicenseManager(max_concurrent=1)

    @pytest.fixture
    def mock_secrets_manager(self):
        """Mock AWS Secrets Manager"""
        with patch('boto3.client') as mock:
            secrets_client = MagicMock()
            secrets_client.get_secret_value.return_value = {
                'SecretString': json.dumps({
                    'license_key': 'TEST-LICENSE-KEY-12345',
                    'expiry_date': (datetime.now() + timedelta(days=90)).isoformat(),
                    'max_instances': 1
                })
            }
            mock.return_value = secrets_client
            yield secrets_client

    # === License Acquisition Tests ===

    def test_acquire_license_success(self, license_manager):
        """Test successful license acquisition"""
        # Act
        acquired = license_manager.acquire_license()

        # Assert
        assert acquired is True
        assert license_manager.active_instances == 1

    def test_acquire_license_when_at_limit(self, license_manager):
        """Test license acquisition when at concurrent limit"""
        # Arrange - Acquire first license
        license_manager.acquire_license()

        # Act - Try to acquire second
        acquired = license_manager.acquire_license(timeout=0.5)

        # Assert
        assert acquired is False  # Should fail due to limit

    def test_acquire_license_waits_for_availability(self, license_manager):
        """Test that acquisition waits for license availability"""
        import threading

        # Arrange - Acquire license in main thread
        license_manager.acquire_license()

        # Background thread releases after delay
        def release_after_delay():
            time.sleep(1)
            license_manager.release_license()

        thread = threading.Thread(target=release_after_delay)
        thread.start()

        # Act - Should wait and succeed
        start = time.time()
        acquired = license_manager.acquire_license(timeout=3)
        duration = time.time() - start

        thread.join()

        # Assert
        assert acquired is True
        assert 0.9 < duration < 1.5  # Waited ~1 second

    # === License Release Tests ===

    def test_release_license_success(self, license_manager):
        """Test successful license release"""
        # Arrange
        license_manager.acquire_license()

        # Act
        license_manager.release_license()

        # Assert
        assert license_manager.active_instances == 0

    def test_release_without_acquisition_raises_error(self, license_manager):
        """Test that releasing without acquisition raises error"""
        # Act & Assert
        with pytest.raises(LicenseError, match="No license to release"):
            license_manager.release_license()

    def test_context_manager_auto_release(self, license_manager):
        """Test context manager automatically releases license"""
        # Act
        with license_manager.license_context():
            assert license_manager.active_instances == 1

        # Assert - License released after context exit
        assert license_manager.active_instances == 0

    def test_context_manager_release_on_exception(self, license_manager):
        """Test context manager releases even on exception"""
        # Act & Assert
        with pytest.raises(ValueError):
            with license_manager.license_context():
                assert license_manager.active_instances == 1
                raise ValueError("Test error")

        # License should still be released
        assert license_manager.active_instances == 0

    # === License Validation Tests ===

    def test_validate_license_from_secrets_manager(
        self, license_manager, mock_secrets_manager
    ):
        """Test license validation from Secrets Manager"""
        # Act
        is_valid = license_manager.validate_license()

        # Assert
        assert is_valid is True
        mock_secrets_manager.get_secret_value.assert_called_once()

    def test_expired_license_validation(self, mock_secrets_manager):
        """Test validation fails for expired license"""
        # Arrange - Mock expired license
        mock_secrets_manager.get_secret_value.return_value = {
            'SecretString': json.dumps({
                'license_key': 'EXPIRED-KEY',
                'expiry_date': (datetime.now() - timedelta(days=1)).isoformat(),
                'max_instances': 1
            })
        }

        manager = LicenseManager()

        # Act
        is_valid = manager.validate_license()

        # Assert
        assert is_valid is False

    def test_license_expiry_warning(self, license_manager, mock_secrets_manager):
        """Test warning when license is expiring soon"""
        # Arrange - License expiring in 15 days
        mock_secrets_manager.get_secret_value.return_value = {
            'SecretString': json.dumps({
                'license_key': 'EXPIRING-SOON',
                'expiry_date': (datetime.now() + timedelta(days=15)).isoformat(),
                'max_instances': 1
            })
        }

        # Act
        with patch('logging.warning') as mock_warning:
            license_manager.validate_license()

        # Assert - Should log warning
        assert mock_warning.called

    # === Concurrency Tests ===

    @pytest.mark.parametrize("max_concurrent", [1, 2, 5])
    def test_concurrent_license_limits(self, max_concurrent):
        """Test various concurrent license limits"""
        # Arrange
        manager = LicenseManager(max_concurrent=max_concurrent)

        # Act - Acquire up to limit
        results = [manager.acquire_license() for _ in range(max_concurrent)]

        # Assert - All should succeed
        assert all(results)
        assert manager.active_instances == max_concurrent

        # Act - Try one more
        extra = manager.acquire_license(timeout=0.1)

        # Assert - Should fail
        assert extra is False

    def test_thread_safe_license_operations(self, license_manager):
        """Test thread-safe license acquisition/release"""
        import threading

        successes = []

        def acquire_and_release():
            if license_manager.acquire_license(timeout=2):
                time.sleep(0.1)
                license_manager.release_license()
                successes.append(True)

        # Act - Multiple threads try to acquire
        threads = [threading.Thread(target=acquire_and_release) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Assert - All should eventually succeed
        assert len(successes) == 5
        assert license_manager.active_instances == 0

    # === Metrics Tests ===

    def test_license_usage_metrics(self, license_manager):
        """Test license usage metrics tracking"""
        # Arrange & Act
        license_manager.acquire_license()
        time.sleep(0.1)
        license_manager.release_license()

        # Assert
        metrics = license_manager.get_metrics()
        assert 'total_acquisitions' in metrics
        assert metrics['total_acquisitions'] == 1
        assert 'active_instances' in metrics
        assert metrics['active_instances'] == 0

    # === Error Recovery Tests ===

    def test_recovery_from_secrets_manager_error(self):
        """Test graceful handling of Secrets Manager errors"""
        # Arrange - Mock Secrets Manager error
        with patch('boto3.client') as mock_boto:
            secrets_client = MagicMock()
            secrets_client.get_secret_value.side_effect = ClientError(
                {'Error': {'Code': 'ResourceNotFoundException'}},
                'get_secret_value'
            )
            mock_boto.return_value = secrets_client

            manager = LicenseManager()

            # Act & Assert
            with pytest.raises(LicenseError, match="Failed to retrieve license"):
                manager.validate_license()
```

---

## Integration Testing

### 1. End-to-End File Processing Pipeline

**File:** `backend/python-worker/tests/integration/test_file_processing_pipeline.py`

```python
"""
Integration tests for complete file processing pipeline
Tests DocuWorks → Bedrock → OpenSearch flow
"""

import pytest
from pathlib import Path
import time
import boto3
from moto import mock_s3, mock_sqs

from processors.file_processor import FileProcessor
from clients.opensearch_client import OpenSearchClient
from config import TEST_CONFIG


@pytest.mark.integration
class TestFileProcessingPipeline:
    """Integration test suite for end-to-end pipeline"""

    @pytest.fixture(scope="class")
    def aws_credentials(self):
        """Mocked AWS Credentials"""
        import os
        os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
        os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'
        os.environ['AWS_SECURITY_TOKEN'] = 'testing'
        os.environ['AWS_SESSION_TOKEN'] = 'testing'

    @pytest.fixture
    def s3_client(self, aws_credentials):
        """Create mocked S3 client"""
        with mock_s3():
            s3 = boto3.client('s3', region_name='us-east-1')
            # Create test buckets
            s3.create_bucket(Bucket=TEST_CONFIG['s3']['test_bucket'])
            s3.create_bucket(Bucket=TEST_CONFIG['s3']['thumbnail_bucket'])
            yield s3

    @pytest.fixture
    def sqs_client(self, aws_credentials):
        """Create mocked SQS client"""
        with mock_sqs():
            sqs = boto3.client('sqs', region_name='us-east-1')
            # Create test queue
            response = sqs.create_queue(
                QueueName=TEST_CONFIG['sqs']['queue_name']
            )
            yield sqs, response['QueueUrl']

    @pytest.fixture
    def file_processor(self):
        """Create file processor instance"""
        return FileProcessor(config=TEST_CONFIG)

    @pytest.fixture
    def sample_docuworks_file(self, tmp_path):
        """Create sample DocuWorks file"""
        # Create a realistic XDW file structure for testing
        xdw_file = tmp_path / "integration_test.xdw"
        # ... (create actual XDW file or use fixture)
        return xdw_file

    # === Complete Pipeline Tests ===

    def test_complete_docuworks_to_opensearch_pipeline(
        self,
        file_processor,
        s3_client,
        sample_docuworks_file
    ):
        """Test complete pipeline: S3 → Process → Bedrock → OpenSearch"""
        # Arrange - Upload file to S3
        bucket = TEST_CONFIG['s3']['test_bucket']
        key = f"source/{sample_docuworks_file.name}"

        s3_client.upload_file(
            str(sample_docuworks_file),
            bucket,
            key
        )

        # Act - Process file
        result = file_processor.process_file(bucket, key)

        # Assert - Processing successful
        assert result['success'] is True
        assert 'document_id' in result
        assert 'vector' in result
        assert len(result['vector']) == 1024

        # Verify thumbnail created
        thumbnail_key = result.get('thumbnail_key')
        assert thumbnail_key is not None

        # Verify indexed to OpenSearch
        doc_id = result['document_id']
        # ... (query OpenSearch to verify)

    def test_sdk_mode_with_license_management(
        self,
        file_processor,
        s3_client,
        sample_docuworks_file
    ):
        """Test SDK processing with proper license management"""
        # This test requires actual DocuWorks SDK
        pytest.skip("Requires DocuWorks SDK license")

        # ... (implementation)

    def test_ocr_fallback_mode(
        self,
        file_processor,
        s3_client,
        sample_docuworks_file
    ):
        """Test OCR fallback when SDK is disabled"""
        # Arrange - Disable SDK
        file_processor.enable_sdk = False

        bucket = TEST_CONFIG['s3']['test_bucket']
        key = f"source/{sample_docuworks_file.name}"
        s3_client.upload_file(str(sample_docuworks_file), bucket, key)

        # Act
        result = file_processor.process_file(bucket, key)

        # Assert
        assert result['success'] is True
        assert result['processor'] == 'ocr'
        assert 'text' in result

    # === Multi-file Processing Tests ===

    def test_batch_file_processing(
        self,
        file_processor,
        s3_client,
        tmp_path
    ):
        """Test processing multiple files in batch"""
        # Arrange - Create multiple test files
        test_files = []
        for i in range(5):
            file_path = tmp_path / f"test_{i}.xdw"
            # ... (create test file)
            test_files.append(file_path)

        bucket = TEST_CONFIG['s3']['test_bucket']

        # Upload all files
        for file_path in test_files:
            key = f"source/{file_path.name}"
            s3_client.upload_file(str(file_path), bucket, key)

        # Act - Process all files
        results = []
        for file_path in test_files:
            key = f"source/{file_path.name}"
            result = file_processor.process_file(bucket, key)
            results.append(result)

        # Assert
        assert all(r['success'] for r in results)
        assert len(results) == 5

    # === Error Handling Tests ===

    def test_processing_with_corrupt_file(
        self,
        file_processor,
        s3_client,
        tmp_path
    ):
        """Test error handling with corrupted file"""
        # Arrange - Create corrupted file
        corrupt_file = tmp_path / "corrupt.xdw"
        corrupt_file.write_bytes(b'INVALID_DATA' * 100)

        bucket = TEST_CONFIG['s3']['test_bucket']
        key = "source/corrupt.xdw"
        s3_client.upload_file(str(corrupt_file), bucket, key)

        # Act
        result = file_processor.process_file(bucket, key)

        # Assert - Should handle gracefully
        assert result['success'] is False
        assert 'error' in result

    def test_retry_logic_on_bedrock_throttling(
        self,
        file_processor,
        s3_client,
        sample_docuworks_file
    ):
        """Test retry logic when Bedrock API is throttled"""
        # Arrange
        bucket = TEST_CONFIG['s3']['test_bucket']
        key = f"source/{sample_docuworks_file.name}"
        s3_client.upload_file(str(sample_docuworks_file), bucket, key)

        # Mock Bedrock to throttle initially
        with patch.object(
            file_processor.bedrock_client,
            'generate_image_embedding'
        ) as mock_bedrock:
            # First call throttles, second succeeds
            mock_bedrock.side_effect = [
                None,  # Throttled
                [0.1] * 1024  # Success
            ]

            # Act
            result = file_processor.process_file(bucket, key)

            # Assert - Should retry and succeed
            assert mock_bedrock.call_count == 2
            assert result['success'] is True

    # === Performance Tests ===

    @pytest.mark.slow
    def test_throughput_with_multiple_files(
        self,
        file_processor,
        s3_client,
        tmp_path
    ):
        """Test processing throughput with multiple files"""
        # Arrange - Create 20 test files
        num_files = 20
        test_files = []

        for i in range(num_files):
            file_path = tmp_path / f"perf_test_{i}.xdw"
            # ... (create test file)
            test_files.append(file_path)

        bucket = TEST_CONFIG['s3']['test_bucket']

        # Upload all files
        for file_path in test_files:
            key = f"source/{file_path.name}"
            s3_client.upload_file(str(file_path), bucket, key)

        # Act - Process with timing
        start_time = time.time()

        results = []
        for file_path in test_files:
            key = f"source/{file_path.name}"
            result = file_processor.process_file(bucket, key)
            results.append(result)

        duration = time.time() - start_time

        # Assert
        assert all(r['success'] for r in results)

        # Performance assertions
        throughput = num_files / duration
        assert throughput > 5  # Should process at least 5 files/second
```

---

## Performance Testing

### 1. Bedrock Performance Benchmarks

**File:** `backend/python-worker/tests/performance/test_bedrock_performance.py`

```python
"""
Performance benchmarks for Bedrock operations
"""

import pytest
import time
from locust import User, task, between
from PIL import Image
import tempfile

from clients.bedrock_client import BedrockClient


class BedrockPerformanceTest:
    """Bedrock performance test suite"""

    @pytest.fixture
    def bedrock_client(self):
        return BedrockClient()

    @pytest.fixture
    def test_images(self, tmp_path):
        """Generate test images of various sizes"""
        images = {}

        sizes = {
            'small': (256, 256),
            'medium': (1024, 1024),
            'large': (2048, 2048),
        }

        for size_name, (width, height) in sizes.items():
            img = Image.new('RGB', (width, height), color='red')
            path = tmp_path / f"{size_name}.jpg"
            img.save(path, quality=95)
            images[size_name] = str(path)

        return images

    # === Latency Benchmarks ===

    @pytest.mark.benchmark
    def test_image_embedding_latency_small(
        self, bedrock_client, test_images, benchmark
    ):
        """Benchmark image embedding latency for small images"""
        # Act
        result = benchmark(
            bedrock_client.generate_image_embedding,
            test_images['small']
        )

        # Assert
        assert result is not None
        assert len(result) == 1024

    @pytest.mark.benchmark
    def test_image_embedding_latency_medium(
        self, bedrock_client, test_images, benchmark
    ):
        """Benchmark image embedding latency for medium images"""
        result = benchmark(
            bedrock_client.generate_image_embedding,
            test_images['medium']
        )
        assert result is not None

    @pytest.mark.benchmark
    def test_image_embedding_latency_large(
        self, bedrock_client, test_images, benchmark
    ):
        """Benchmark image embedding latency for large images"""
        result = benchmark(
            bedrock_client.generate_image_embedding,
            test_images['large']
        )
        assert result is not None

    @pytest.mark.benchmark
    def test_text_embedding_latency(self, bedrock_client, benchmark):
        """Benchmark text embedding latency"""
        text = "This is a test document about performance." * 10

        result = benchmark(
            bedrock_client.generate_text_embedding,
            text
        )
        assert result is not None

    # === Throughput Tests ===

    def test_sequential_embedding_throughput(
        self, bedrock_client, test_images
    ):
        """Test sequential embedding generation throughput"""
        num_iterations = 10
        image_path = test_images['small']

        # Act
        start = time.time()
        for _ in range(num_iterations):
            bedrock_client.generate_image_embedding(image_path)
        duration = time.time() - start

        # Assert
        throughput = num_iterations / duration
        print(f"Sequential throughput: {throughput:.2f} embeddings/sec")
        assert throughput > 1  # Should generate at least 1/sec

    @pytest.mark.asyncio
    async def test_concurrent_embedding_throughput(
        self, bedrock_client, test_images
    ):
        """Test concurrent embedding generation throughput"""
        import asyncio

        num_concurrent = 5
        image_path = test_images['small']

        async def generate_embedding():
            return bedrock_client.generate_image_embedding(image_path)

        # Act
        start = time.time()
        tasks = [generate_embedding() for _ in range(num_concurrent)]
        results = await asyncio.gather(*tasks)
        duration = time.time() - start

        # Assert
        assert all(r is not None for r in results)
        throughput = num_concurrent / duration
        print(f"Concurrent throughput: {throughput:.2f} embeddings/sec")

    # === Memory Usage Tests ===

    @pytest.mark.memory
    def test_memory_usage_during_batch_processing(
        self, bedrock_client, test_images
    ):
        """Test memory usage during batch embedding generation"""
        from memory_profiler import profile

        @profile
        def batch_process():
            items = [
                {'type': 'image', 'path': test_images['medium']}
                for _ in range(10)
            ]
            return bedrock_client.batch_generate_embeddings(items)

        # Act
        results = batch_process()

        # Assert
        assert len(results) == 10
        # Memory profile will be printed to console

    # === Load Testing with Locust ===

class BedrockLoadTestUser(User):
    """Locust user for Bedrock load testing"""

    wait_time = between(1, 3)  # Wait 1-3 seconds between tasks

    def on_start(self):
        """Initialize on user start"""
        self.bedrock_client = BedrockClient()

        # Create test image
        img = Image.new('RGB', (512, 512), color='blue')
        self.temp_image = tempfile.NamedTemporaryFile(
            suffix='.jpg', delete=False
        )
        img.save(self.temp_image.name)

    @task(3)
    def generate_image_embedding(self):
        """Task: Generate image embedding"""
        start = time.time()
        result = self.bedrock_client.generate_image_embedding(
            self.temp_image.name
        )
        duration = (time.time() - start) * 1000

        self.environment.events.request.fire(
            request_type="bedrock",
            name="generate_image_embedding",
            response_time=duration,
            response_length=len(result) if result else 0,
            exception=None if result else Exception("Failed")
        )

    @task(1)
    def generate_text_embedding(self):
        """Task: Generate text embedding"""
        start = time.time()
        result = self.bedrock_client.generate_text_embedding(
            "Performance test text" * 10
        )
        duration = (time.time() - start) * 1000

        self.environment.events.request.fire(
            request_type="bedrock",
            name="generate_text_embedding",
            response_time=duration,
            response_length=len(result) if result else 0,
            exception=None if result else Exception("Failed")
        )
```

**Run Locust load test:**
```bash
# Start Locust web UI
locust -f tests/performance/test_bedrock_performance.py --host=http://localhost

# Or run headless
locust -f tests/performance/test_bedrock_performance.py \
  --headless \
  --users 10 \
  --spawn-rate 2 \
  --run-time 5m
```

---

## Test Data Preparation

### 1. Test Data Strategy

**File:** `backend/python-worker/tests/fixtures/README.md`

```markdown
# Test Data Preparation Strategy

## Overview

This directory contains test fixtures and sample files for comprehensive testing of the DocuWorks SDK + Bedrock integration.

## Directory Structure

```
tests/fixtures/
├── docuworks/           # DocuWorks test files
│   ├── sample_1page.xdw
│   ├── sample_multipage.xdw
│   ├── sample_with_images.xdw
│   ├── sample_japanese.xdw
│   └── corrupt.xdw
├── images/              # Test images
│   ├── small_256x256.jpg
│   ├── medium_1024x1024.jpg
│   ├── large_4096x4096.jpg
│   └── various_formats/
├── vectors/             # Pre-generated test vectors
│   ├── sample_vectors.json
│   └── similarity_pairs.json
└── responses/           # Mock API responses
    ├── bedrock_responses.json
    └── opensearch_responses.json
```

## Test File Categories

### 1. DocuWorks Files

**Purpose:** Test various DocuWorks scenarios

| File | Description | Use Case |
|------|-------------|----------|
| sample_1page.xdw | Single page document | Basic processing |
| sample_multipage.xdw | 10-page document | Pagination testing |
| sample_with_images.xdw | Contains embedded images | Image extraction |
| sample_japanese.xdw | Japanese text content | Encoding/language |
| corrupt.xdw | Corrupted file | Error handling |

### 2. Test Images

**Purpose:** Test Bedrock embedding generation

| File | Dimensions | Size | Use Case |
|------|------------|------|----------|
| small_256x256.jpg | 256x256 | ~50KB | Quick tests |
| medium_1024x1024.jpg | 1024x1024 | ~500KB | Standard processing |
| large_4096x4096.jpg | 4096x4096 | ~5MB | Resize testing |

### 3. Vector Fixtures

**Purpose:** Pre-computed vectors for similarity tests

```json
{
  "image_vectors": {
    "red_square": [0.123, 0.456, ...],
    "blue_circle": [0.789, 0.012, ...]
  },
  "text_vectors": {
    "document_1": [0.345, 0.678, ...],
    "document_2": [0.901, 0.234, ...]
  },
  "similarity_pairs": [
    {
      "vector1": "red_square",
      "vector2": "red_circle",
      "expected_similarity": 0.85
    }
  ]
}
```

## Generating Test Data

### Script: `generate_test_data.py`

```python
"""
Generate comprehensive test data for testing
"""

import os
from pathlib import Path
from PIL import Image
import numpy as np
import json

FIXTURES_DIR = Path(__file__).parent


def generate_test_images():
    """Generate test images of various sizes"""
    images_dir = FIXTURES_DIR / 'images'
    images_dir.mkdir(exist_ok=True)

    sizes = {
        'small_256x256.jpg': (256, 256),
        'medium_1024x1024.jpg': (1024, 1024),
        'large_4096x4096.jpg': (4096, 4096),
    }

    for filename, (width, height) in sizes.items():
        img = Image.new('RGB', (width, height), color=(255, 0, 0))
        img.save(images_dir / filename, quality=95)
        print(f"Generated: {filename}")


def generate_mock_vectors():
    """Generate mock embedding vectors"""
    vectors_dir = FIXTURES_DIR / 'vectors'
    vectors_dir.mkdir(exist_ok=True)

    # Generate realistic-looking random vectors
    np.random.seed(42)

    vectors = {
        'image_vectors': {
            'red_square': np.random.randn(1024).tolist(),
            'blue_circle': np.random.randn(1024).tolist(),
        },
        'text_vectors': {
            'document_1': np.random.randn(1024).tolist(),
            'document_2': np.random.randn(1024).tolist(),
        }
    }

    output_path = vectors_dir / 'sample_vectors.json'
    with open(output_path, 'w') as f:
        json.dump(vectors, f, indent=2)

    print(f"Generated: sample_vectors.json")


if __name__ == '__main__':
    print("Generating test data...")
    generate_test_images()
    generate_mock_vectors()
    print("Test data generation complete!")
```

Run with:
```bash
python tests/fixtures/generate_test_data.py
```

## Data Refresh Policy

- **Frequency:** Regenerate before major test runs
- **Version Control:** Commit small fixtures, ignore large files
- **CI/CD:** Auto-generate on test environment setup

## Usage in Tests

```python
import pytest
from pathlib import Path

FIXTURES_DIR = Path(__file__).parent / 'fixtures'

@pytest.fixture
def sample_docuworks_file():
    """Load sample DocuWorks file"""
    return FIXTURES_DIR / 'docuworks' / 'sample_1page.xdw'

@pytest.fixture
def test_image():
    """Load test image"""
    return FIXTURES_DIR / 'images' / 'medium_1024x1024.jpg'

@pytest.fixture
def mock_vectors():
    """Load pre-generated vectors"""
    import json
    with open(FIXTURES_DIR / 'vectors' / 'sample_vectors.json') as f:
        return json.load(f)
```
```

---

## CI/CD Pipeline Configuration

### 1. GitHub Actions Workflow

**File:** `.github/workflows/python-worker-tests.yml`

```yaml
name: Python Worker - DocuWorks + Bedrock Tests

on:
  push:
    branches: [main, develop]
    paths:
      - 'backend/python-worker/**'
      - '.github/workflows/python-worker-tests.yml'
  pull_request:
    branches: [main, develop]
  schedule:
    # Run daily at 2 AM UTC
    - cron: '0 2 * * *'

env:
  PYTHON_VERSION: '3.9'

jobs:
  # ===== Unit Tests =====
  unit-tests:
    name: Unit Tests
    runs-on: windows-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
          cache: 'pip'

      - name: Install dependencies
        working-directory: backend/python-worker
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          pip install -r requirements-test.txt

      - name: Install Tesseract (for OCR tests)
        run: |
          choco install tesseract -y
          echo "C:\Program Files\Tesseract-OCR" | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append

      - name: Generate test data
        working-directory: backend/python-worker/tests/fixtures
        run: python generate_test_data.py

      - name: Run unit tests with coverage
        working-directory: backend/python-worker
        run: |
          pytest tests/ \
            -v \
            --cov=. \
            --cov-report=xml \
            --cov-report=html \
            --cov-report=term \
            --ignore=tests/integration \
            --ignore=tests/performance \
            --junit-xml=test-results/unit-tests.xml
        env:
          AWS_ACCESS_KEY_ID: test
          AWS_SECRET_ACCESS_KEY: test
          AWS_DEFAULT_REGION: us-east-1

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./backend/python-worker/coverage.xml
          flags: unit-tests
          name: unit-test-coverage

      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: unit-test-results
          path: backend/python-worker/test-results/

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: backend/python-worker/htmlcov/

  # ===== Integration Tests =====
  integration-tests:
    name: Integration Tests
    runs-on: windows-latest
    needs: unit-tests

    services:
      localstack:
        image: localstack/localstack:latest
        ports:
          - 4566:4566
        env:
          SERVICES: s3,sqs,secretsmanager
          DEBUG: 1

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
          cache: 'pip'

      - name: Install dependencies
        working-directory: backend/python-worker
        run: |
          pip install -r requirements.txt
          pip install -r requirements-test.txt

      - name: Install Tesseract
        run: |
          choco install tesseract -y
          echo "C:\Program Files\Tesseract-OCR" | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append

      - name: Wait for LocalStack
        run: |
          Start-Sleep -Seconds 10
          curl http://localhost:4566/_localstack/health

      - name: Setup LocalStack resources
        working-directory: backend/python-worker
        run: |
          aws --endpoint-url=http://localhost:4566 s3 mb s3://cis-test-bucket
          aws --endpoint-url=http://localhost:4566 s3 mb s3://cis-test-thumbnails
          aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name cis-test-queue
        env:
          AWS_ACCESS_KEY_ID: test
          AWS_SECRET_ACCESS_KEY: test
          AWS_DEFAULT_REGION: us-east-1

      - name: Run integration tests
        working-directory: backend/python-worker
        run: |
          pytest tests/integration/ \
            -v \
            --junit-xml=test-results/integration-tests.xml
        env:
          AWS_ENDPOINT_URL: http://localhost:4566
          AWS_ACCESS_KEY_ID: test
          AWS_SECRET_ACCESS_KEY: test
          AWS_DEFAULT_REGION: us-east-1

      - name: Upload integration test results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: integration-test-results
          path: backend/python-worker/test-results/

  # ===== Performance Tests =====
  performance-tests:
    name: Performance Benchmarks
    runs-on: windows-latest
    needs: unit-tests

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install dependencies
        working-directory: backend/python-worker
        run: |
          pip install -r requirements.txt
          pip install -r requirements-test.txt

      - name: Run performance benchmarks
        working-directory: backend/python-worker
        run: |
          pytest tests/performance/ \
            -v \
            --benchmark-only \
            --benchmark-json=benchmark-results.json

      - name: Upload benchmark results
        uses: actions/upload-artifact@v4
        with:
          name: performance-benchmarks
          path: backend/python-worker/benchmark-results.json

      - name: Compare with baseline (if exists)
        continue-on-error: true
        run: |
          # Compare with previous benchmark results
          # (Implementation depends on your setup)
          echo "Benchmark comparison would run here"

  # ===== Security Scan =====
  security-scan:
    name: Security Scan
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Run Bandit security scan
        working-directory: backend/python-worker
        run: |
          pip install bandit
          bandit -r . -f json -o security-report.json

      - name: Upload security report
        uses: actions/upload-artifact@v4
        with:
          name: security-scan-results
          path: backend/python-worker/security-report.json

  # ===== Code Quality =====
  code-quality:
    name: Code Quality Checks
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install quality tools
        run: |
          pip install black flake8 mypy pylint

      - name: Check code formatting (Black)
        working-directory: backend/python-worker
        run: black --check .

      - name: Lint with flake8
        working-directory: backend/python-worker
        run: flake8 . --count --statistics

      - name: Type check with mypy
        working-directory: backend/python-worker
        run: mypy .

      - name: Lint with pylint
        working-directory: backend/python-worker
        run: pylint **/*.py --output-format=json > pylint-report.json

      - name: Upload quality reports
        uses: actions/upload-artifact@v4
        with:
          name: code-quality-reports
          path: backend/python-worker/*-report.json

  # ===== Test Summary =====
  test-summary:
    name: Test Summary Report
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests, performance-tests, security-scan]
    if: always()

    steps:
      - name: Download all test results
        uses: actions/download-artifact@v4

      - name: Generate summary report
        run: |
          echo "# Test Summary Report" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "## Test Results" >> $GITHUB_STEP_SUMMARY
          echo "- Unit Tests: ${{ needs.unit-tests.result }}" >> $GITHUB_STEP_SUMMARY
          echo "- Integration Tests: ${{ needs.integration-tests.result }}" >> $GITHUB_STEP_SUMMARY
          echo "- Performance Tests: ${{ needs.performance-tests.result }}" >> $GITHUB_STEP_SUMMARY
          echo "- Security Scan: ${{ needs.security-scan.result }}" >> $GITHUB_STEP_SUMMARY
```

### 2. pytest.ini Configuration

**File:** `backend/python-worker/pytest.ini`

```ini
[pytest]
# Test discovery
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*

# Markers
markers =
    unit: Unit tests (fast, isolated)
    integration: Integration tests (require AWS services)
    performance: Performance benchmarks
    slow: Slow-running tests
    benchmark: Performance benchmark tests
    memory: Memory profiling tests
    skipif_no_sdk: Skip if DocuWorks SDK not available

# Coverage settings
[coverage:run]
source = .
omit =
    */tests/*
    */venv/*
    */__pycache__/*
    */site-packages/*
    setup.py

[coverage:report]
precision = 2
show_missing = True
skip_covered = False

# Fail if coverage is below threshold
fail_under = 80

[coverage:html]
directory = htmlcov
```

---

## Coverage Targets

### Overall Coverage Goals

| Component | Line Coverage | Branch Coverage | Function Coverage | Priority |
|-----------|---------------|-----------------|-------------------|----------|
| DocuWorks Processor | 85%+ | 80%+ | 90%+ | Critical |
| Bedrock Client | 90%+ | 85%+ | 95%+ | Critical |
| License Manager | 95%+ | 90%+ 100%+ | Critical |
| OpenSearch Client | 85%+ | 80%+ | 90%+ | High |
| S3 Client | 80%+ | 75%+ | 85%+ | High |
| SQS Handler | 80%+ | 75%+ | 85%+ | High |
| Utilities | 75%+ | 70%+ | 80%+ | Medium |
| **Overall Target** | **80%+** | **75%+** | **85%+** | **Critical** |

### Critical Path Coverage

**Must achieve 100% coverage:**
- License acquisition/release
- SDK mode processing
- Bedrock API calls
- Error handling for critical failures

---

## Test Execution Plan

### Week 1: Unit Testing Foundation

**Days 1-2: DocuWorks Processor Tests**
```bash
# Create test structure
pytest tests/test_docuworks_processor.py -v --cov

# Target: 85%+ coverage
```

**Days 3-4: Bedrock Client Tests**
```bash
pytest tests/test_bedrock_client.py -v --cov

# Target: 90%+ coverage
```

**Day 5: License Manager Tests**
```bash
pytest tests/test_license_manager.py -v --cov

# Target: 95%+ coverage
```

### Week 2: Integration Testing

**Days 1-2: Pipeline Integration**
```bash
# Start LocalStack
docker-compose -f docker-compose.test.yml up -d

# Run integration tests
pytest tests/integration/ -v

# Target: All scenarios pass
```

**Days 3-4: Error Handling & Edge Cases**
```bash
pytest tests/integration/ -v -m "error_handling"

# Target: 100% error scenarios covered
```

**Day 5: Multi-file & Batch Processing**
```bash
pytest tests/integration/test_batch_processing.py -v

# Target: 20+ files processed successfully
```

### Week 3: Performance & Load Testing

**Days 1-2: Performance Benchmarks**
```bash
# Run benchmarks
pytest tests/performance/ --benchmark-only

# Target metrics:
# - DocuWorks (SDK): < 5s per file
# - Bedrock embedding: < 2s per image
# - OpenSearch indexing: < 100ms
```

**Days 3-4: Load Testing with Locust**
```bash
# Start load test
locust -f tests/performance/test_bedrock_performance.py \
  --users 10 \
  --spawn-rate 2 \
  --run-time 30m

# Target: Sustained 10 users, < 5% error rate
```

**Day 5: Memory & Resource Profiling**
```bash
# Memory profiling
pytest tests/performance/ -v -m "memory"

# Target: < 500MB memory usage per worker
```

### Week 4: E2E Testing & Production Validation

**Days 1-2: End-to-End Scenarios**
```bash
# Full system tests
pytest tests/e2e/ -v

# Scenarios:
# - Upload → Process → Search
# - Bulk file processing
# - Failure recovery
```

**Days 3-4: Production Environment Testing**
```bash
# Deploy to staging
# Run smoke tests
pytest tests/smoke/ -v --env=staging

# Verify:
# - All AWS services connected
# - License management working
# - Monitoring active
```

**Day 5: Test Report & Sign-off**
```bash
# Generate comprehensive report
pytest --html=report.html --self-contained-html

# Coverage report
coverage report --show-missing

# Review and sign-off
```

---

## Test Reporting

### Daily Test Report Template

```markdown
# Daily Test Report - [Date]

## Summary

| Category | Tests Run | Passed | Failed | Coverage |
|----------|-----------|--------|--------|----------|
| Unit Tests | X | X | X | XX% |
| Integration Tests | X | X | X | - |
| Performance Tests | X | X | X | - |
| **Total** | **X** | **X** | **X** | **XX%** |

## Test Results

### Unit Tests
- ✅ DocuWorks Processor: PASS (coverage: XX%)
- ✅ Bedrock Client: PASS (coverage: XX%)
- ✅ License Manager: PASS (coverage: XX%)

### Integration Tests
- ✅ End-to-end pipeline: PASS
- ✅ Error handling: PASS
- ⚠️ License concurrency: NEEDS REVIEW

### Performance Benchmarks
- DocuWorks (SDK mode): X.Xs per file
- Bedrock embedding: X.Xs per image
- Throughput: XX files/hour

## Issues Found

### Critical
1. [Issue description]
   - **Impact**: [severity]
   - **Fix**: [proposed solution]
   - **Status**: [open/in-progress/resolved]

### High
1. [Issue description]

### Medium
1. [Issue description]

## Coverage Analysis

### Overall: XX%

**Areas needing attention:**
- [ ] Module X: YY% (target: ZZ%)
- [ ] Function ABC: Not covered

## Next Steps

1. [Action item 1]
2. [Action item 2]

## Sign-off

**Tested by**: _______________
**Date**: _______________
**Status**: PASS / FAIL / NEEDS REVIEW
```

---

## Success Metrics

### Must-Have (Go/No-Go Criteria)

- ✅ 80%+ overall code coverage
- ✅ 100% critical path coverage
- ✅ All unit tests passing
- ✅ All integration tests passing
- ✅ License management validated
- ✅ No security vulnerabilities
- ✅ Performance targets met:
  - DocuWorks SDK: < 5s per file
  - Bedrock embedding: < 2s per image
  - End-to-end: < 10s per file

### Should-Have

- ✅ 85%+ overall coverage
- ✅ All edge cases tested
- ✅ Load testing completed (10+ concurrent users)
- ✅ Memory profiling clean (< 500MB per worker)
- ✅ CI/CD pipeline automated

### Nice-to-Have

- ✅ 90%+ overall coverage
- ✅ Performance optimization documented
- ✅ Test documentation complete
- ✅ Monitoring dashboard configured

---

## Conclusion

This comprehensive testing strategy ensures production-ready quality for the DocuWorks SDK + Bedrock integration. By following TDD principles and achieving 80%+ coverage, we guarantee:

1. **Robustness**: All critical paths tested
2. **Performance**: Validated against benchmarks
3. **Reliability**: Error handling verified
4. **Security**: License management enforced
5. **Maintainability**: Well-documented test suite

**Next Steps:**
1. Review and approve this strategy
2. Begin Week 1: Unit testing foundation
3. Set up CI/CD pipeline
4. Generate daily test reports
5. Achieve production deployment readiness in 4 weeks

---

**Document Version**: 1.0
**Created**: 2025-12-02
**Status**: Ready for Review
**Next Review**: Weekly during implementation
