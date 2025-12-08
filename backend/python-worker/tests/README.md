# Python Worker Test Suite

Comprehensive testing infrastructure for the EC2 file processing pipeline.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt
pip install -r requirements-test.txt

# Run all tests
pytest

# Run with coverage
pytest --cov

# Run specific test category
pytest -m unit              # Unit tests only
pytest -m integration       # Integration tests only
pytest -m e2e              # E2E tests only
pytest -m performance      # Performance tests only

# Use the test runner script
./run_tests.sh              # All tests
./run_tests.sh --quick      # Quick unit tests
./run_tests.sh --unit       # Unit tests with coverage
./run_tests.sh --e2e        # E2E tests only
```

## Test Structure

```
tests/
├── conftest.py                 # Shared fixtures and configuration
├── unit/                       # Unit tests (70% of tests)
│   ├── test_base_processor.py
│   ├── test_pdf_processor.py
│   ├── test_image_processor.py
│   ├── test_office_processor.py
│   ├── test_docuworks_processor.py
│   ├── test_file_router.py
│   └── test_opensearch_client.py
├── integration/                # Integration tests (20% of tests)
│   ├── test_s3_integration.py
│   ├── test_sqs_integration.py
│   ├── test_opensearch_integration.py
│   └── test_error_injection.py
├── e2e/                       # End-to-end tests (10% of tests)
│   └── test_pipeline_e2e.py
├── performance/               # Performance tests
│   └── test_load.py
├── fixtures/                  # Test data fixtures
└── utils/                     # Test utilities
```

## Test Categories

### Unit Tests

Test individual components in isolation.

```bash
# All unit tests
pytest tests/unit

# Specific processor
pytest tests/unit/test_pdf_processor.py

# Exclude slow tests
pytest -m "unit and not slow"

# Specific test
pytest tests/unit/test_pdf_processor.py::TestPDFProcessor::test_process_simple_pdf
```

### Integration Tests

Test interactions between components and AWS services.

```bash
# All integration tests
pytest tests/integration

# S3 integration only
pytest tests/integration/test_s3_integration.py

# Error injection tests
pytest -m error_injection
```

### E2E Tests

Test complete workflows end-to-end.

```bash
# All E2E tests
pytest tests/e2e

# Specific pipeline test
pytest tests/e2e/test_pipeline_e2e.py::TestFileProcessingPipelineE2E::test_complete_pdf_processing_pipeline
```

### Performance Tests

Benchmark and load testing.

```bash
# All performance tests
pytest tests/performance

# Benchmark only
pytest tests/performance --benchmark-only

# Specific benchmark
pytest tests/performance/test_load.py::test_pdf_processing_benchmark
```

## Test Markers

Tests are organized using pytest markers:

| Marker | Description | Usage |
|--------|-------------|-------|
| `unit` | Unit tests | `pytest -m unit` |
| `integration` | Integration tests | `pytest -m integration` |
| `e2e` | End-to-end tests | `pytest -m e2e` |
| `performance` | Performance tests | `pytest -m performance` |
| `slow` | Slow-running tests | `pytest -m "not slow"` |
| `requires_aws` | Needs real AWS | `pytest -m "not requires_aws"` |
| `requires_tesseract` | Needs Tesseract OCR | `pytest -m "not requires_tesseract"` |
| `requires_docuworks` | Needs DocuWorks SDK | `pytest -m "not requires_docuworks"` |
| `pdf` | PDF-related tests | `pytest -m pdf` |
| `image` | Image-related tests | `pytest -m image` |
| `office` | Office doc tests | `pytest -m office` |
| `error_injection` | Fault tolerance tests | `pytest -m error_injection` |
| `benchmark` | Benchmarking tests | `pytest -m benchmark` |
| `smoke` | Quick smoke tests | `pytest -m smoke` |

### Combining Markers

```bash
# PDF unit tests only
pytest -m "unit and pdf"

# Fast integration tests
pytest -m "integration and not slow"

# All tests except those requiring AWS
pytest -m "not requires_aws"

# Error injection for S3
pytest -m "error_injection and integration"
```

## Coverage

### Generating Coverage Reports

```bash
# Terminal report
pytest --cov --cov-report=term-missing

# HTML report
pytest --cov --cov-report=html
open htmlcov/index.html

# XML report (for CI)
pytest --cov --cov-report=xml

# All formats
pytest --cov --cov-report=html --cov-report=term-missing --cov-report=xml
```

### Coverage Goals

- **Overall**: ≥ 80%
- **Processors**: ≥ 90%
- **Core Worker**: ≥ 85%
- **AWS Clients**: ≥ 80%

### Checking Coverage Threshold

```bash
# Fail if coverage below 80%
pytest --cov --cov-fail-under=80
```

## Fixtures

Common fixtures are defined in `conftest.py`:

### Configuration Fixtures

```python
test_config          # Test configuration object
temp_dir            # Temporary directory
test_data_dir       # Test data directory
```

### AWS Mock Fixtures

```python
aws_credentials     # Mock AWS credentials
s3_client          # Mock S3 client
sqs_client         # Mock SQS client
mock_opensearch    # Mock OpenSearch client
```

### Test File Fixtures

```python
sample_pdf         # Sample PDF file
sample_image       # Sample image file
sample_text_image  # Image with text (for OCR)
sample_docx        # Sample Word document
sample_xlsx        # Sample Excel file
sample_pptx        # Sample PowerPoint file
```

### Helper Fixtures

```python
create_test_file   # Factory for creating test files
upload_to_s3       # Helper to upload to mock S3
send_sqs_message   # Helper to send to mock SQS
assert_processing  # Custom assertions for ProcessingResult
```

## Running Tests

### Basic Commands

```bash
# All tests
pytest

# Verbose output
pytest -v

# Stop on first failure
pytest -x

# Show print statements
pytest -s

# Parallel execution (auto-detect CPUs)
pytest -n auto

# Specific number of workers
pytest -n 4

# Run last failed tests
pytest --lf

# Failed first, then others
pytest --ff
```

### Advanced Options

```bash
# Profile slowest tests
pytest --durations=10

# With timeout (5 minutes per test)
pytest --timeout=300

# Generate JUnit XML
pytest --junit-xml=junit.xml

# Generate HTML report
pytest --html=report.html --self-contained-html

# Update snapshots (if using)
pytest --snapshot-update

# Dry run (collect tests only)
pytest --collect-only
```

### Using the Test Runner

The `run_tests.sh` script provides a convenient wrapper:

```bash
# All tests with linting and coverage
./run_tests.sh

# Quick unit tests (no lint, no coverage)
./run_tests.sh --quick

# Unit tests only
./run_tests.sh --unit

# Integration tests only
./run_tests.sh --integration

# E2E tests only
./run_tests.sh --e2e

# Performance benchmarks
./run_tests.sh --performance

# Verbose mode
./run_tests.sh --verbose

# Fail fast
./run_tests.sh --fail-fast

# Help
./run_tests.sh --help
```

## Continuous Integration

Tests run automatically on GitHub Actions for:

- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`
- Manual workflow dispatch

### CI Jobs

1. **Lint** - Code quality checks (Black, isort, Flake8, Pylint, MyPy)
2. **Unit Tests** - Python 3.11 and 3.12 matrix
3. **Integration Tests** - With mocked AWS services
4. **E2E Tests** - Complete workflow validation
5. **Performance Tests** - Benchmarking (main branch only)
6. **Security Scan** - Safety and Bandit
7. **Coverage Report** - Combined coverage from all test types

### Branch Protection

Main branch requires:
- ✅ All tests passing
- ✅ Coverage ≥ 80%
- ✅ Code review approval
- ✅ Up-to-date with main

## Writing Tests

### Test Structure (AAA Pattern)

```python
def test_example():
    # Arrange - Set up test data and conditions
    processor = PDFProcessor(config)
    sample_file = create_test_pdf()

    # Act - Execute the code being tested
    result = processor.process(sample_file)

    # Assert - Verify the results
    assert result.success
    assert len(result.extracted_text) > 0
```

### Naming Conventions

```python
# ✅ Good - Descriptive, follows pattern
def test_pdf_processor_extracts_text_from_multipage_document():
    pass

def test_s3_download_handles_missing_file_gracefully():
    pass

# ❌ Bad - Vague, not descriptive
def test_pdf():
    pass

def test_download():
    pass
```

### Using Fixtures

```python
def test_with_fixtures(test_config, sample_pdf, temp_dir):
    """Fixtures are injected automatically"""
    processor = PDFProcessor(test_config)
    result = processor.process(str(sample_pdf))

    assert result.success
    assert result.file_type == ".pdf"
```

### Parameterized Tests

```python
@pytest.mark.parametrize("file_ext,expected", [
    (".pdf", True),
    (".jpg", False),
    (".docx", False),
])
def test_can_process_file_types(processor, file_ext, expected):
    result = processor.can_process(f"file{file_ext}")
    assert result == expected
```

### Testing Exceptions

```python
def test_raises_exception():
    with pytest.raises(ValueError, match="Invalid input"):
        process_invalid_data()
```

### Mocking

```python
from unittest.mock import Mock, patch

def test_with_mock():
    with patch('module.function') as mock_func:
        mock_func.return_value = "mocked value"

        result = call_function_that_uses_module_function()

        assert result == "expected"
        mock_func.assert_called_once()
```

## Troubleshooting

### Tests Fail with Import Errors

```bash
# Ensure you're in the correct directory
cd backend/python-worker

# Install test dependencies
pip install -r requirements-test.txt
```

### Coverage Too Low

```bash
# Find uncovered lines
pytest --cov --cov-report=term-missing

# Generate detailed HTML report
pytest --cov --cov-report=html
open htmlcov/index.html

# Look for red (uncovered) lines
```

### Slow Tests

```bash
# Find slowest tests
pytest --durations=10

# Run only fast tests
pytest -m "not slow"

# Mark slow tests
@pytest.mark.slow
def test_large_file():
    pass
```

### Flaky Tests

```bash
# Run test multiple times
pytest --count=10 path/to/test.py

# If flaky, investigate:
# - Race conditions
# - Timing issues
# - Shared state
# - External dependencies
```

### Permission Issues

```bash
# Ensure temp directory is writable
chmod 755 /tmp/test_worker

# Check file permissions
ls -la tests/data/
```

## Best Practices

1. **Write tests first** (TDD approach)
2. **One assertion per test** (when possible)
3. **Use descriptive names** for tests and variables
4. **Test behavior, not implementation**
5. **Isolate tests** - No dependencies between tests
6. **Use fixtures** for common setup
7. **Mock external dependencies** (AWS, network, etc.)
8. **Test edge cases** and error conditions
9. **Keep tests fast** - Mock slow operations
10. **Maintain high coverage** - Aim for 80%+

## Resources

### Documentation

- [Pytest Documentation](https://docs.pytest.org/)
- [pytest-cov](https://pytest-cov.readthedocs.io/)
- [Moto (AWS Mocking)](https://docs.getmoto.org/)
- [pytest-benchmark](https://pytest-benchmark.readthedocs.io/)

### Project Documentation

- [Test Strategy](../TEST_STRATEGY.md) - Comprehensive test strategy
- [Project README](../README.md) - Project overview
- [Contributing Guide](../CONTRIBUTING.md) - How to contribute

### Support

- Create an issue on GitHub
- Check existing test examples
- Review test documentation

---

**Happy Testing!** 🧪
