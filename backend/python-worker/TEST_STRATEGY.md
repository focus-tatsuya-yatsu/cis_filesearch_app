# EC2 File Processing Pipeline - Test Strategy

## Overview

This document outlines the comprehensive testing strategy for the EC2 file processing pipeline. Our goal is to achieve **80%+ code coverage** while ensuring robust, production-ready code through systematic testing at all levels.

## Table of Contents

1. [Testing Pyramid](#testing-pyramid)
2. [Test Categories](#test-categories)
3. [Coverage Goals](#coverage-goals)
4. [Test Infrastructure](#test-infrastructure)
5. [Running Tests](#running-tests)
6. [CI/CD Integration](#cicd-integration)
7. [Best Practices](#best-practices)

---

## Testing Pyramid

We follow the testing pyramid approach for optimal test distribution:

```
        /\
       /  \     10% E2E Tests (Critical user flows)
      /    \
     /------\
    /        \   20% Integration Tests (AWS services, components)
   /          \
  /------------\
 /              \ 70% Unit Tests (Individual functions, classes)
/________________\
```

### Distribution Rationale

- **Unit Tests (70%)**: Fast, isolated, numerous tests for individual components
- **Integration Tests (20%)**: Test interactions between services (S3, SQS, OpenSearch)
- **E2E Tests (10%)**: Validate complete workflows end-to-end

---

## Test Categories

### 1. Unit Tests (`tests/unit/`)

Test individual components in isolation.

**Coverage:**
- ✅ Base Processor (`test_base_processor.py`)
- ✅ PDF Processor (`test_pdf_processor.py`)
- ✅ Image Processor (`test_image_processor.py`)
- ✅ Office Processor (`test_office_processor.py`)
- ✅ DocuWorks Processor (`test_docuworks_processor.py`)
- ✅ File Router (`test_file_router.py`)
- ✅ OpenSearch Client (`test_opensearch_client.py`)
- ✅ Configuration (`test_config.py`)

**Markers:**
```bash
pytest -m unit                    # All unit tests
pytest -m "unit and pdf"          # PDF-specific unit tests
pytest -m "unit and not slow"     # Fast unit tests only
```

### 2. Integration Tests (`tests/integration/`)

Test interactions between components and AWS services.

**Coverage:**
- ✅ S3 Integration (`test_s3_integration.py`)
- ✅ SQS Integration (`test_sqs_integration.py`)
- ✅ OpenSearch Integration (`test_opensearch_integration.py`)
- ✅ Complete Service Chain (`test_service_chain.py`)

**Markers:**
```bash
pytest -m integration             # All integration tests
pytest -m "integration and not requires_aws"  # Mock-only tests
```

### 3. End-to-End Tests (`tests/e2e/`)

Validate complete file processing workflows.

**Coverage:**
- ✅ Complete Pipeline (`test_pipeline_e2e.py`)
  - PDF processing flow
  - Image processing flow
  - Office document flow
  - Error handling
  - Multi-file processing

**Markers:**
```bash
pytest -m e2e                     # All E2E tests
pytest -m "e2e and not slow"      # Fast E2E tests
```

### 4. Performance Tests (`tests/performance/`)

Measure and benchmark system performance.

**Coverage:**
- ✅ Processing Speed (`test_load.py`)
- ✅ Memory Usage
- ✅ Throughput
- ✅ Scalability
- ✅ Resource Constraints

**Markers:**
```bash
pytest -m performance             # All performance tests
pytest -m benchmark              # Benchmark tests only
pytest --benchmark-only          # Run benchmarks
```

### 5. Error Injection Tests (`tests/integration/test_error_injection.py`)

Test fault tolerance and error recovery.

**Coverage:**
- ✅ S3 failures (timeouts, access denied, missing files)
- ✅ SQS failures (malformed messages, connection errors)
- ✅ Processor failures (crashes, OOM, corruption)
- ✅ OpenSearch failures (connection, indexing errors)
- ✅ Data corruption scenarios
- ✅ Resource exhaustion

**Markers:**
```bash
pytest -m error_injection         # All error injection tests
```

---

## Coverage Goals

### Overall Targets

| Metric | Target | Current |
|--------|--------|---------|
| Line Coverage | ≥ 80% | TBD |
| Branch Coverage | ≥ 75% | TBD |
| Function Coverage | ≥ 85% | TBD |

### Component-Specific Targets

| Component | Target Coverage |
|-----------|----------------|
| Processors (PDF, Image, Office) | 90%+ |
| Worker Core | 85%+ |
| AWS Clients | 80%+ |
| Utilities | 75%+ |

### Excluded from Coverage

- Third-party libraries
- Configuration files
- Test files themselves
- Development scripts

---

## Test Infrastructure

### Frameworks and Tools

**Core Testing:**
- `pytest` - Test framework
- `pytest-cov` - Coverage reporting
- `pytest-xdist` - Parallel test execution
- `pytest-mock` - Enhanced mocking

**AWS Mocking:**
- `moto` - Mock AWS services (S3, SQS, DynamoDB)
- `boto3-stubs` - Type hints for AWS SDK

**Test Data:**
- `faker` - Generate realistic test data
- `factory-boy` - Test fixture factories
- `hypothesis` - Property-based testing

**Performance:**
- `pytest-benchmark` - Performance benchmarking
- `locust` - Load testing

**Code Quality:**
- `pylint` - Static analysis
- `black` - Code formatting
- `isort` - Import sorting
- `mypy` - Type checking
- `flake8` - Style guide enforcement

### Test Configuration

**pytest.ini** - Main configuration
- Test discovery patterns
- Coverage settings
- Markers definition
- Parallel execution
- Logging configuration

**conftest.py** - Shared fixtures
- Configuration fixtures
- AWS mock fixtures
- Test file generators
- Helper functions

---

## Running Tests

### Quick Start

```bash
# Install dependencies
cd backend/python-worker
pip install -r requirements.txt
pip install -r requirements-test.txt

# Run all tests
pytest

# Run with coverage
pytest --cov

# Run specific category
pytest tests/unit
pytest tests/integration
pytest tests/e2e
pytest tests/performance
```

### Common Test Commands

```bash
# Unit tests only (fast)
pytest -m unit

# Integration tests with AWS mocks
pytest -m integration

# E2E tests
pytest -m e2e

# Performance benchmarks
pytest -m benchmark --benchmark-only

# Exclude slow tests
pytest -m "not slow"

# Run specific file
pytest tests/unit/test_pdf_processor.py

# Run specific test
pytest tests/unit/test_pdf_processor.py::TestPDFProcessor::test_process_simple_pdf

# Verbose output
pytest -v

# Show print statements
pytest -s

# Stop on first failure
pytest -x

# Run in parallel (auto-detect CPUs)
pytest -n auto

# Generate HTML coverage report
pytest --cov --cov-report=html
open htmlcov/index.html
```

### Advanced Commands

```bash
# Only failed tests from last run
pytest --lf

# Failed tests first, then others
pytest --ff

# Profile test execution time
pytest --durations=10

# Update snapshots (if using snapshot testing)
pytest --snapshot-update

# Generate JUnit XML report
pytest --junit-xml=junit.xml

# Generate Allure report
pytest --alluredir=allure-results
allure serve allure-results
```

---

## CI/CD Integration

### GitHub Actions Workflow

Location: `.github/workflows/python-worker-tests.yml`

**Jobs:**

1. **Lint** - Code quality checks
   - Black (formatting)
   - isort (imports)
   - Flake8 (style)
   - Pylint (static analysis)
   - MyPy (type checking)

2. **Unit Tests** - Fast, isolated tests
   - Matrix: Python 3.11, 3.12
   - Coverage reporting
   - Upload to Codecov

3. **Integration Tests** - Service integration
   - Mock AWS services
   - Coverage reporting

4. **E2E Tests** - End-to-end validation
   - Complete workflow tests
   - Coverage reporting

5. **Performance Tests** - Benchmarking
   - Only on main branch
   - Store benchmark history

6. **Security Scan**
   - Safety (dependency vulnerabilities)
   - Bandit (security issues)

7. **Coverage Report** - Combined coverage
   - Merge all coverage data
   - Fail if below 80%

### Branch Protection

**Main branch requires:**
- ✅ All tests passing
- ✅ Coverage ≥ 80%
- ✅ Code review approval
- ✅ Up-to-date with main

### Continuous Deployment

```yaml
# On successful tests in main branch:
- Build Docker image
- Push to ECR
- Deploy to staging
- Run smoke tests
- Deploy to production (manual approval)
```

---

## Best Practices

### Writing Tests

**1. Follow AAA Pattern (Arrange-Act-Assert)**

```python
def test_pdf_processing():
    # Arrange
    processor = PDFProcessor(config)
    sample_file = create_test_pdf()

    # Act
    result = processor.process(sample_file)

    # Assert
    assert result.success
    assert len(result.extracted_text) > 0
```

**2. Use Descriptive Test Names**

```python
# ✅ Good
def test_pdf_processor_extracts_text_from_multipage_document():
    pass

# ❌ Bad
def test_pdf():
    pass
```

**3. One Assertion per Test (when possible)**

```python
# ✅ Good - Focused test
def test_result_has_file_name():
    result = processor.process(file)
    assert result.file_name == "test.pdf"

def test_result_has_extracted_text():
    result = processor.process(file)
    assert len(result.extracted_text) > 0

# ⚠️ Acceptable - Related assertions
def test_successful_processing_result():
    result = processor.process(file)
    assert result.success
    assert result.error_message is None
```

**4. Use Fixtures for Setup**

```python
@pytest.fixture
def sample_pdf(temp_dir):
    pdf_path = temp_dir / "sample.pdf"
    create_pdf(pdf_path)
    return pdf_path

def test_process_pdf(sample_pdf):
    result = processor.process(sample_pdf)
    assert result.success
```

**5. Test Behavior, Not Implementation**

```python
# ✅ Good - Tests behavior
def test_pdf_text_extraction():
    result = processor.process("document.pdf")
    assert "expected text" in result.extracted_text

# ❌ Bad - Tests implementation
def test_pdf_uses_pypdf2():
    processor.process("document.pdf")
    assert processor._reader.__class__.__name__ == "PdfReader"
```

**6. Use Markers for Organization**

```python
@pytest.mark.unit
@pytest.mark.pdf
def test_pdf_processor():
    pass

@pytest.mark.integration
@pytest.mark.requires_aws
def test_s3_integration():
    pass

@pytest.mark.slow
def test_large_file_processing():
    pass
```

**7. Mock External Dependencies**

```python
@patch('worker.boto3.client')
def test_s3_download(mock_boto3):
    mock_s3 = Mock()
    mock_boto3.return_value = mock_s3

    worker.download_file_from_s3('bucket', 'key', 'local')

    mock_s3.download_file.assert_called_once()
```

### Test Data Management

**1. Use Fixtures for Test Data**

```python
@pytest.fixture(scope="session")
def test_data_dir():
    return Path(__file__).parent / "data"

@pytest.fixture
def sample_files(test_data_dir):
    return {
        'pdf': test_data_dir / "sample.pdf",
        'image': test_data_dir / "sample.jpg",
        'docx': test_data_dir / "sample.docx"
    }
```

**2. Generate Test Files Programmatically**

```python
@pytest.fixture
def sample_pdf(temp_dir):
    # Generate PDF on the fly
    from reportlab.pdfgen import canvas

    pdf_path = temp_dir / "generated.pdf"
    c = canvas.Canvas(str(pdf_path))
    c.drawString(100, 750, "Test Content")
    c.save()

    return pdf_path
```

**3. Clean Up After Tests**

```python
@pytest.fixture
def temp_file(temp_dir):
    file_path = temp_dir / "temp.pdf"
    file_path.write_text("temp")

    yield file_path

    # Cleanup (automatic with temp_dir)
    if file_path.exists():
        file_path.unlink()
```

### Performance Testing

**1. Set Reasonable Thresholds**

```python
def test_pdf_processing_speed(benchmark):
    result = benchmark(processor.process, "test.pdf")

    assert result.success
    # Benchmark will automatically measure and compare
```

**2. Test Under Load**

```python
def test_concurrent_processing():
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(process_file, f) for f in files]
        results = [f.result() for f in as_completed(futures)]

    assert all(r.success for r in results)
```

**3. Monitor Memory**

```python
def test_memory_usage():
    import psutil

    process = psutil.Process()
    mem_before = process.memory_info().rss

    # Process many files
    for file in files:
        processor.process(file)

    mem_after = process.memory_info().rss
    mem_increase = (mem_after - mem_before) / 1024 / 1024  # MB

    assert mem_increase < 100  # Less than 100MB increase
```

### Error Testing

**1. Test All Error Paths**

```python
def test_handles_missing_file():
    result = processor.process("/nonexistent/file.pdf")
    assert not result.success
    assert "not found" in result.error_message.lower()

def test_handles_corrupted_file():
    result = processor.process("corrupted.pdf")
    assert not result.success
    assert "error" in result.error_message.lower()
```

**2. Test Edge Cases**

```python
def test_empty_file():
    result = processor.process("empty.pdf")
    assert not result.success

def test_extremely_large_file():
    result = processor.process("10gb.pdf")
    # Should fail gracefully or handle with streaming
    assert isinstance(result, ProcessingResult)
```

**3. Inject Realistic Failures**

```python
def test_s3_timeout():
    with patch.object(s3_client, 'download_file') as mock:
        mock.side_effect = ClientError(
            {'Error': {'Code': 'RequestTimeout'}},
            'GetObject'
        )

        result = worker.download_file(...)
        assert not result
```

---

## Troubleshooting

### Common Issues

**1. Tests Fail Locally but Pass in CI**

- Check Python version matches CI
- Verify all dependencies installed
- Check for environment-specific paths

**2. Coverage Below Target**

```bash
# Find uncovered lines
pytest --cov --cov-report=term-missing

# Generate HTML report for detailed view
pytest --cov --cov-report=html
open htmlcov/index.html
```

**3. Slow Tests**

```bash
# Find slowest tests
pytest --durations=10

# Mark slow tests
@pytest.mark.slow
def test_large_file():
    pass

# Skip slow tests during development
pytest -m "not slow"
```

**4. Flaky Tests**

- Use `pytest-repeat` to identify
- Add proper wait conditions
- Fix race conditions
- Increase timeouts if needed

```bash
# Run test multiple times to check for flakiness
pytest --count=10 tests/test_flaky.py
```

---

## Metrics and Reporting

### Coverage Reports

**Terminal:**
```bash
pytest --cov --cov-report=term-missing
```

**HTML:**
```bash
pytest --cov --cov-report=html
```

**XML (for CI):**
```bash
pytest --cov --cov-report=xml
```

### Test Reports

**JUnit XML:**
```bash
pytest --junit-xml=junit.xml
```

**HTML Report:**
```bash
pytest --html=report.html --self-contained-html
```

**Allure Report:**
```bash
pytest --alluredir=allure-results
allure serve allure-results
```

---

## Continuous Improvement

### Regular Reviews

- **Weekly**: Review test failures and flaky tests
- **Monthly**: Analyze coverage gaps and add tests
- **Quarterly**: Review test strategy and update as needed

### Metrics to Track

- Test execution time trends
- Coverage percentage over time
- Flaky test rate
- Bug escape rate (bugs found in production)

### Goals

- Maintain 80%+ coverage
- Zero flaky tests
- All tests complete in < 10 minutes
- No critical bugs escape to production

---

## Resources

### Documentation

- [Pytest Documentation](https://docs.pytest.org/)
- [Moto Documentation](https://docs.getmoto.org/)
- [Coverage.py](https://coverage.readthedocs.io/)

### Internal Docs

- `/docs/test-strategy.md` - This document
- `/tests/README.md` - Test-specific README
- `/tests/conftest.py` - Shared fixtures

### Contact

For questions about testing:
- Create issue in GitHub
- Reach out to QA team
- Refer to this document

---

**Last Updated:** 2024-12-01
**Version:** 1.0.0
