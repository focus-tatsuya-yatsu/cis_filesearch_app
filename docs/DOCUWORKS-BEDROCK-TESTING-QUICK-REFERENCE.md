# DocuWorks + Bedrock Testing - Quick Reference Guide

## Essential Commands

### Test Execution

```powershell
# Run all tests
pytest tests/ -v

# Run specific test category
pytest tests/unit/ -v                    # Unit tests only
pytest tests/integration/ -v             # Integration tests only
pytest tests/performance/ -v             # Performance tests only

# Run with coverage
pytest tests/ -v --cov --cov-report=html

# Run marked tests
pytest -m unit                          # Unit tests
pytest -m integration                   # Integration tests
pytest -m "not slow"                    # Exclude slow tests
pytest -m requires_license              # Tests needing license

# Run specific test file
pytest tests/unit/test_bedrock_client.py -v

# Run specific test function
pytest tests/unit/test_bedrock_client.py::TestBedrockClient::test_generate_image_embedding_success -v

# Parallel execution (faster)
pytest tests/ -n auto

# Watch mode (re-run on file changes)
pytest-watch tests/

# Generate HTML report
pytest --html=report.html --self-contained-html
```

### Coverage Analysis

```powershell
# Generate coverage report
coverage run -m pytest tests/
coverage report
coverage html

# View coverage in browser
start htmlcov/index.html  # Windows
open htmlcov/index.html   # macOS

# Check coverage threshold
pytest --cov --cov-fail-under=80

# Coverage by file
coverage report --sort=cover
```

### Performance Testing

```powershell
# Run benchmarks
pytest tests/performance/ --benchmark-only

# Save benchmark results
pytest tests/performance/ --benchmark-save=baseline

# Compare with baseline
pytest tests/performance/ --benchmark-compare=baseline

# Locust load testing
locust -f tests/performance/test_bedrock_performance.py \
  --users 10 \
  --spawn-rate 2 \
  --run-time 5m \
  --html=locust-report.html
```

### Test Environment Setup

```powershell
# Create test environment
python -m venv venv-test
.\venv-test\Scripts\activate

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-test.txt

# Generate test data
python tests/fixtures/generate_test_data.py

# Start LocalStack (AWS mocking)
docker-compose -f docker-compose.test.yml up -d

# Verify LocalStack
curl http://localhost:4566/_localstack/health
```

---

## Test Categories

### 1. Unit Tests (70% of tests)

**Purpose:** Test individual components in isolation

**Location:** `tests/unit/`

**Coverage Target:** 80%+

**Key Files:**
- `test_docuworks_processor.py` - DocuWorks SDK integration
- `test_bedrock_client.py` - Bedrock vector generation
- `test_license_manager.py` - License management
- `test_opensearch_client.py` - OpenSearch operations

**Run:**
```bash
pytest tests/unit/ -v --cov=src
```

### 2. Integration Tests (20% of tests)

**Purpose:** Test component interactions and AWS services

**Location:** `tests/integration/`

**Coverage Target:** Critical paths 100%

**Key Files:**
- `test_file_processing_pipeline.py` - End-to-end workflow
- `test_aws_integration.py` - S3, SQS, Secrets Manager
- `test_bedrock_opensearch_integration.py` - Vector search flow

**Requirements:**
- LocalStack running
- Test AWS resources configured

**Run:**
```bash
# Start LocalStack first
docker-compose -f docker-compose.test.yml up -d

# Run tests
pytest tests/integration/ -v
```

### 3. Performance Tests (10% of tests)

**Purpose:** Validate performance benchmarks

**Location:** `tests/performance/`

**Key Metrics:**
- DocuWorks SDK processing: < 5s per file
- Bedrock embedding: < 2s per image
- OpenSearch indexing: < 100ms
- Throughput: > 10 files/minute

**Key Files:**
- `test_bedrock_performance.py` - Bedrock benchmarks
- `test_docuworks_performance.py` - DocuWorks benchmarks

**Run:**
```bash
pytest tests/performance/ --benchmark-only
```

---

## Test Fixtures

### Location: `tests/fixtures/`

### Available Fixtures

#### DocuWorks Files
```
fixtures/docuworks/
├── sample_1page.xdw          # Basic single page
├── sample_multipage.xdw      # 10 pages
├── sample_with_images.xdw    # Contains images
├── sample_japanese.xdw       # Japanese text
└── corrupt.xdw               # Error testing
```

#### Test Images
```
fixtures/images/
├── small_256x256.jpg         # Quick tests
├── medium_1024x1024.jpg      # Standard
└── large_4096x4096.jpg       # Resize testing
```

#### Mock Vectors
```
fixtures/vectors/
└── sample_vectors.json       # Pre-computed vectors
```

### Using Fixtures in Tests

```python
import pytest
from pathlib import Path

@pytest.fixture
def sample_xdw_file(fixtures_dir):
    """Get sample DocuWorks file"""
    return fixtures_dir / 'docuworks' / 'sample_1page.xdw'

def test_process_file(sample_xdw_file):
    # Use fixture
    result = processor.process_file(str(sample_xdw_file))
    assert result['success'] is True
```

---

## Mocking Strategies

### Mock AWS Services (LocalStack)

```python
from moto import mock_s3, mock_sqs
import boto3

@mock_s3
def test_s3_upload():
    s3 = boto3.client('s3', region_name='us-east-1')
    s3.create_bucket(Bucket='test-bucket')

    # Test S3 operations
    s3.put_object(Bucket='test-bucket', Key='test.xdw', Body=b'data')
```

### Mock Bedrock Client

```python
from unittest.mock import patch, MagicMock

@patch('boto3.client')
def test_bedrock_embedding(mock_boto_client):
    mock_bedrock = MagicMock()
    mock_bedrock.invoke_model.return_value = {
        'body': MockStreamingBody({'embedding': [0.1] * 1024})
    }
    mock_boto_client.return_value = mock_bedrock

    # Test Bedrock operations
    embedding = bedrock_client.generate_image_embedding('test.jpg')
    assert len(embedding) == 1024
```

### Mock DocuWorks SDK

```python
@patch('win32com.client.Dispatch')
def test_docuworks_sdk(mock_dispatch):
    mock_app = MagicMock()
    mock_doc = MagicMock()
    mock_doc.Pages.Count = 5
    mock_app.Documents.Open.return_value = mock_doc
    mock_dispatch.return_value = mock_app

    # Test SDK operations
    result = processor.process_with_sdk('test.xdw')
    assert result['page_count'] == 5
```

---

## Common Test Patterns

### 1. Arrange-Act-Assert (AAA)

```python
def test_function():
    # Arrange - Set up test data and preconditions
    processor = DocuWorksProcessor()
    test_file = create_test_file()

    # Act - Execute the code under test
    result = processor.process_file(test_file)

    # Assert - Verify expectations
    assert result['success'] is True
    assert 'text' in result
```

### 2. Parametrized Tests

```python
@pytest.mark.parametrize("filename,expected_ext", [
    ("test.xdw", ".xdw"),
    ("document.XDW", ".xdw"),
    ("file.jpg", ".jpg"),
])
def test_file_extensions(filename, expected_ext):
    ext = Path(filename).suffix.lower()
    assert ext == expected_ext
```

### 3. Context Managers for Cleanup

```python
@pytest.fixture
def temp_file():
    """Create temporary file that auto-cleans"""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.xdw', delete=False) as f:
        f.write(b'test data')
        temp_path = f.name

    yield temp_path

    # Cleanup automatically
    if Path(temp_path).exists():
        Path(temp_path).unlink()
```

### 4. Async Testing

```python
@pytest.mark.asyncio
async def test_async_operation():
    result = await async_function()
    assert result is not None
```

---

## CI/CD Integration

### GitHub Actions Workflow

**File:** `.github/workflows/python-worker-tests.yml`

**Triggers:**
- Push to `main` or `develop`
- Pull requests
- Daily scheduled runs

**Jobs:**
1. **unit-tests** - Fast unit tests with coverage
2. **integration-tests** - AWS integration with LocalStack
3. **performance-tests** - Benchmark validation
4. **security-scan** - Bandit security scanning
5. **code-quality** - Black, flake8, mypy, pylint

### Running Locally (Same as CI)

```powershell
# Install pre-commit hooks
pip install pre-commit
pre-commit install

# Run all quality checks
black .
flake8 .
mypy .
pylint **/*.py

# Run full test suite
pytest tests/ -v --cov --cov-report=html

# Security scan
bandit -r src/ -f json -o security-report.json
```

---

## Debugging Failed Tests

### Verbose Output

```powershell
# Detailed failure information
pytest tests/ -vv

# Show local variables
pytest tests/ --showlocals

# Enter debugger on failure
pytest tests/ --pdb

# Drop into debugger at specific point
pytest tests/ --trace
```

### Logging

```powershell
# Show print statements
pytest tests/ -s

# Show log output
pytest tests/ --log-cli-level=DEBUG

# Capture warnings
pytest tests/ -W error  # Treat warnings as errors
```

### Isolate Failing Tests

```powershell
# Run only failed tests from last run
pytest --lf

# Run failed first, then others
pytest --ff

# Stop on first failure
pytest -x

# Stop after N failures
pytest --maxfail=3
```

---

## Performance Benchmarking

### Benchmark Decorators

```python
import pytest

@pytest.mark.benchmark
def test_processing_performance(benchmark):
    """Benchmark file processing"""
    result = benchmark(processor.process_file, 'test.xdw')
    assert result['success'] is True

    # Benchmark will automatically measure:
    # - Mean time
    # - Standard deviation
    # - Min/Max times
```

### Custom Timing

```python
import time

def test_custom_timing():
    start = time.time()

    # Operation to measure
    result = expensive_operation()

    duration = time.time() - start

    assert duration < 5.0  # Should complete within 5 seconds
    assert result is not None
```

---

## Code Coverage Best Practices

### 1. Aim for High Coverage, Not 100%

- Target: 80%+ overall
- Critical paths: 100%
- Utilities: 75%+

### 2. Exclude Non-Testable Code

```python
# pytest.ini
[coverage:report]
exclude_lines =
    pragma: no cover
    def __repr__
    if __name__ == .__main__.:
    if TYPE_CHECKING:
```

### 3. Focus on Valuable Tests

```python
# Good - Tests behavior
def test_license_acquisition_prevents_overuse():
    assert manager.acquire_license() is True
    assert manager.acquire_license() is False  # Limit reached

# Bad - Tests implementation details
def test_license_counter_increments():
    manager._counter += 1  # Don't test internals
```

---

## Troubleshooting

### Common Issues

#### 1. Import Errors

**Problem:** `ModuleNotFoundError: No module named 'src'`

**Solution:**
```python
# conftest.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "src"))
```

#### 2. LocalStack Not Responding

**Problem:** Tests fail with connection timeout

**Solution:**
```powershell
# Restart LocalStack
docker-compose -f docker-compose.test.yml down
docker-compose -f docker-compose.test.yml up -d

# Verify health
curl http://localhost:4566/_localstack/health
```

#### 3. Windows Path Issues

**Problem:** Path separators causing failures

**Solution:**
```python
from pathlib import Path

# Use Path for cross-platform compatibility
file_path = Path('tests') / 'fixtures' / 'sample.xdw'
```

#### 4. DocuWorks SDK Not Available

**Problem:** Tests skipped with "SDK not available"

**Solution:**
```python
# Tests will automatically skip
# Install DocuWorks SDK to run these tests

# Or mark as expected skip
@pytest.mark.skipif_no_sdk
def test_sdk_feature():
    pass
```

---

## Best Practices Checklist

### Before Committing

- [ ] All tests passing locally
- [ ] Coverage above 80%
- [ ] Code formatted with Black
- [ ] No linting errors (flake8)
- [ ] Type hints checked (mypy)
- [ ] Security scan clean (bandit)
- [ ] Performance benchmarks within limits

### Test Writing

- [ ] Use descriptive test names
- [ ] Follow AAA pattern
- [ ] One assertion per test (when possible)
- [ ] Mock external dependencies
- [ ] Clean up resources
- [ ] Document complex test logic

### CI/CD

- [ ] Tests run on every PR
- [ ] Coverage reported
- [ ] Performance regression detected
- [ ] Security vulnerabilities blocked

---

## Quick Reference Table

| Task | Command |
|------|---------|
| Run all tests | `pytest tests/ -v` |
| Unit tests only | `pytest tests/unit/ -v` |
| With coverage | `pytest --cov --cov-report=html` |
| Specific test | `pytest tests/unit/test_file.py::test_name` |
| Parallel execution | `pytest -n auto` |
| Failed tests only | `pytest --lf` |
| Benchmarks | `pytest --benchmark-only` |
| Debug mode | `pytest --pdb` |
| Verbose output | `pytest -vv --showlocals` |
| Generate report | `pytest --html=report.html` |

---

## Resources

### Documentation
- Main Strategy: `/docs/DOCUWORKS-BEDROCK-TESTING-STRATEGY.md`
- Pytest Docs: https://docs.pytest.org/
- Coverage.py: https://coverage.readthedocs.io/
- Locust: https://docs.locust.io/

### Internal Links
- Integration Guide: `/docs/deployment/DOCUWORKS-BEDROCK-INTEGRATION-GUIDE.md`
- Quick Start: `/docs/deployment/IMPLEMENTATION-QUICK-START.md`
- License Management: `/docs/deployment/LICENSE-MANAGEMENT-STRATEGY.md`

### Support
- GitHub Issues: Project repository
- Team Slack: #cis-filesearch-testing
- AWS Support: https://console.aws.amazon.com/support/

---

**Quick Reference Version:** 1.0
**Last Updated:** 2025-12-02
**Maintained By:** QA Team
