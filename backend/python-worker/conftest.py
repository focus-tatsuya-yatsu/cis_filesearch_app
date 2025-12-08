"""
Pytest configuration and shared fixtures
"""

import pytest
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

# Add src directory to Python path
PROJECT_ROOT = Path(__file__).parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))


# ===== Configuration Fixtures =====

@pytest.fixture(scope="session")
def test_config():
    """Test configuration settings"""
    return {
        'aws': {
            'region': 'us-east-1',
            'endpoint_url': os.getenv('AWS_ENDPOINT_URL', 'http://localhost:4566'),
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
            'mock_mode': True,
        },
        'docuworks': {
            'max_concurrent': 1,
            'enable_sdk': False,  # Default to OCR mode for tests
        },
    }


@pytest.fixture(scope="session")
def fixtures_dir():
    """Path to test fixtures directory"""
    return PROJECT_ROOT / "tests" / "fixtures"


# ===== Mock Fixtures =====

@pytest.fixture
def mock_aws_credentials(monkeypatch):
    """Mock AWS credentials for testing"""
    monkeypatch.setenv('AWS_ACCESS_KEY_ID', 'testing')
    monkeypatch.setenv('AWS_SECRET_ACCESS_KEY', 'testing')
    monkeypatch.setenv('AWS_SECURITY_TOKEN', 'testing')
    monkeypatch.setenv('AWS_SESSION_TOKEN', 'testing')
    monkeypatch.setenv('AWS_DEFAULT_REGION', 'us-east-1')


@pytest.fixture
def mock_bedrock_response():
    """Mock Bedrock API response"""
    return {
        'embedding': [0.1] * 1024,  # 1024-dimensional vector
        'inputTextTokenCount': 10,
    }


@pytest.fixture
def mock_opensearch_client():
    """Mock OpenSearch client"""
    mock = MagicMock()
    mock.index.return_value = {'result': 'created', '_id': 'test-doc-id'}
    mock.search.return_value = {
        'hits': {
            'total': {'value': 1},
            'hits': [
                {
                    '_id': 'test-doc-id',
                    '_source': {
                        'file_name': 'test.xdw',
                        'content': 'Test content',
                    }
                }
            ]
        }
    }
    return mock


# ===== Test Data Fixtures =====

@pytest.fixture
def sample_xdw_content():
    """Sample XDW file content (mock)"""
    # XDW file header
    return b'XDWF' + b'\x00' * 1000


@pytest.fixture
def sample_text():
    """Sample text content for testing"""
    return """
    これはテストドキュメントです。
    This is a test document for the CIS File Search Application.

    DocuWorks integration testing with Bedrock vector search.
    日本語とEnglishの混在テキスト。
    """


@pytest.fixture
def sample_vector():
    """Sample 1024-dimensional vector"""
    import numpy as np
    np.random.seed(42)
    return np.random.randn(1024).tolist()


# ===== Cleanup Fixtures =====

@pytest.fixture(autouse=True)
def cleanup_temp_files():
    """Automatically cleanup temporary test files"""
    import tempfile
    import shutil

    temp_dirs = []

    yield

    # Cleanup after test
    for temp_dir in temp_dirs:
        if temp_dir.exists():
            shutil.rmtree(temp_dir)


# ===== Skip Markers =====

def pytest_configure(config):
    """Configure custom markers"""
    config.addinivalue_line(
        "markers", "requires_sdk: mark test as requiring DocuWorks SDK"
    )
    config.addinivalue_line(
        "markers", "requires_license: mark test as requiring valid license"
    )


def pytest_collection_modifyitems(config, items):
    """Modify test collection to add skip markers"""
    skip_no_sdk = pytest.mark.skip(reason="DocuWorks SDK not available")

    for item in items:
        if "requires_sdk" in item.keywords:
            # Check if SDK is available
            try:
                import win32com.client
                win32com.client.Dispatch("DocuWorks.DeskApp")
            except:
                item.add_marker(skip_no_sdk)
