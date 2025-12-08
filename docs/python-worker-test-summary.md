# EC2 Python Worker - Testing Strategy Summary

## Executive Summary

このドキュメントは、EC2スポットインスタンス上で動作するPythonワーカーアプリケーションの包括的なテスト戦略の概要を提供します。80%以上のコードカバレッジを目標とし、TDD原則に基づいた堅牢なテストフレームワークを確立します。

## Testing Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Testing Pyramid                            │
│                                                              │
│         ┌──────────────┐                                     │
│        /   E2E Tests    \       5% - Full workflow           │
│       /──────────────────\                                   │
│      / Integration Tests  \    25% - AWS integration         │
│     /──────────────────────\                                 │
│    /    Unit Tests         \ 70% - Core logic                │
│   /────────────────────────\                                │
│                                                              │
│  Performance Tests │ Resilience Tests │ Auto Scaling Tests  │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Unit Testing (70% of tests)

**Target Coverage**: 85%+

**Testing Framework**: pytest with extensive plugins

**Key Test Areas**:
- File processor core logic
- OCR text extraction
- Bedrock API integration
- S3 file operations
- SQS message handling
- Data model validation
- Error handling paths

**Tools**:
- `pytest` - Testing framework
- `pytest-mock` - Mocking dependencies
- `pytest-cov` - Coverage reporting
- `moto` - AWS service mocking

**Example Test**:
```python
def test_process_pdf_message(processor, pdf_message):
    """Test successful PDF processing."""
    processor.s3_client.download_file.return_value = "/tmp/test.pdf"
    processor.ocr_engine.extract_text.return_value = "Contract text"

    result = processor.process_message(pdf_message)

    assert result.status == "SUCCESS"
    assert "Contract text" in result.ocr_text
```

### 2. Integration Testing (25% of tests)

**Target Coverage**: 80%+

**Test Environments**:
- LocalStack (S3, SQS, DynamoDB)
- OpenSearch local instance
- Docker Compose orchestration

**Key Test Areas**:
- SQS message end-to-end flow
- S3 file upload/download
- OpenSearch indexing validation
- DynamoDB metadata storage
- CloudWatch log validation

**Tools**:
- `moto` - AWS service mocking
- `docker-compose` - Service orchestration
- `pytest-docker` - Docker integration

**Example Test**:
```python
@mock_sqs
@mock_s3
def test_sqs_to_s3_integration(sqs_client, s3_client):
    """Test complete SQS to S3 processing flow."""
    # Create queue and bucket
    queue_url = sqs_client.create_queue(QueueName='test-queue')['QueueUrl']
    s3_client.create_bucket(Bucket='test-bucket')

    # Send message
    sqs_client.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps({"s3Key": "file.pdf"})
    )

    # Process message
    queue_manager = QueueManager(sqs_client, queue_url)
    messages = queue_manager.receive_messages()

    assert len(messages) == 1
```

### 3. Performance Testing

**Load Testing**: Locust for concurrent workload simulation

**Memory Profiling**: `memory-profiler` for leak detection

**CPU Profiling**: `cProfile` for bottleneck identification

**Key Metrics**:
- Throughput: Messages processed per second
- Latency: P50, P95, P99 response times
- Memory usage: Stable over time
- CPU utilization: Efficient processing

**Load Test Configuration**:
```python
class FileProcessingUser(User):
    wait_time = between(1, 3)

    @task(weight=3)
    def send_pdf_message(self):
        """Simulate PDF processing workload."""
        message = create_pdf_message()
        self.sqs.send_message(
            QueueUrl=self.queue_url,
            MessageBody=json.dumps(message)
        )
```

**Execution**:
```bash
# Run 10-minute load test with 50 users
locust -f tests/performance/locustfile.py \
  --users 50 \
  --spawn-rate 5 \
  --run-time 10m \
  --headless
```

### 4. Resilience Testing

**Spot Interruption Handling**:
- Graceful shutdown on 2-minute notice
- Message requeue for in-progress files
- State persistence for recovery

**Network Failure Scenarios**:
- Connection timeouts
- Service unavailability
- Retry with exponential backoff
- Circuit breaker pattern

**Service Throttling**:
- Rate limiting detection
- Adaptive rate adjustment
- Backoff strategies

**Example Resilience Test**:
```python
def test_graceful_shutdown_on_spot_interruption(spot_handler, processor):
    """Test worker handles spot interruption gracefully."""
    spot_handler.set_interrupted(True)

    processing_messages = [
        {'receipt_handle': 'msg_1', 's3Key': 'file1.pdf'},
        {'receipt_handle': 'msg_2', 's3Key': 'file2.pdf'}
    ]

    result = spot_handler.handle_graceful_shutdown(
        processor,
        processing_messages
    )

    assert result['status'] == 'GRACEFUL_SHUTDOWN'
    assert result['messages_requeued'] == 2
```

### 5. Auto Scaling Testing

**Scale-Out Validation**:
- SQS queue depth triggers
- Instance launch verification
- Capacity reservation
- Cooldown period enforcement

**Scale-In Validation**:
- Low queue depth detection
- Instance termination order
- Minimum capacity protection
- Processing completion validation

**Example Auto Scaling Test**:
```python
def test_scale_out_on_high_queue_depth(scaling_manager, queue_url):
    """Test scale-out triggers when queue exceeds threshold."""
    # Send 20 messages (threshold = 10)
    for i in range(20):
        sqs_client.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({"file": f"file_{i}.pdf"})
        )

    decision = scaling_manager.evaluate_scaling()

    assert decision['action'] == 'SCALE_OUT'
    assert decision['current_queue_depth'] == 20
    assert decision['desired_capacity'] > 2
```

## Coverage Goals by Module

| Module | Target | Priority | Status |
|--------|--------|----------|--------|
| file_processor.py | 90% | Critical | Pending |
| ocr_engine.py | 85% | High | Pending |
| bedrock_client.py | 85% | High | Pending |
| storage_handler.py | 90% | Critical | Pending |
| queue_manager.py | 90% | Critical | Pending |
| index_manager.py | 85% | High | Pending |
| spot_handler.py | 80% | Medium | Pending |
| retry_handler.py | 90% | High | Pending |
| **Overall** | **85%** | **Critical** | **Pending** |

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Python Worker Tests

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt requirements-test.txt
      - run: pytest tests/unit --cov=src --cov-report=xml
      - uses: codecov/codecov-action@v4

  integration-tests:
    runs-on: ubuntu-latest
    services:
      localstack:
        image: localstack/localstack:latest
      opensearch:
        image: opensearchproject/opensearch:2.11.0
    steps:
      - run: pytest tests/integration --cov=src

  performance-tests:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - run: pytest tests/performance --benchmark-only
```

### Pre-commit Hooks

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/psf/black
    hooks:
      - id: black
  - repo: https://github.com/PyCQA/pylint
    hooks:
      - id: pylint
  - repo: local
    hooks:
      - id: pytest-unit
        entry: pytest tests/unit --cov-fail-under=80
```

## Test Execution Commands

### Local Development

```bash
# Run all tests
pytest

# Run specific test category
pytest -m unit
pytest -m integration
pytest -m performance

# Run with coverage
pytest --cov=src --cov-report=html

# Run in parallel
pytest -n auto

# Run specific test file
pytest tests/unit/test_file_processor.py -v
```

### Docker-based Testing

```bash
# Build and run all tests
docker-compose -f docker-compose.test.yml up --build

# Run specific suite
docker-compose -f docker-compose.test.yml run worker-tests \
  pytest tests/unit -v

# Cleanup
docker-compose -f docker-compose.test.yml down -v
```

### Performance Testing

```bash
# Load test with 10 concurrent users
locust -f tests/performance/locustfile.py \
  --users 10 \
  --spawn-rate 2 \
  --run-time 10m

# Memory profiling
python -m memory_profiler tests/performance/test_memory_profiling.py

# CPU profiling
pytest tests/performance/test_cpu_profiling.py --benchmark-only
```

## Test Data Management

### Fixtures and Factories

```python
# tests/fixtures/messages.py
@pytest.fixture
def pdf_message():
    """Standard PDF file message."""
    return FileMessage(
        event_type="FILE_UPLOADED",
        s3_bucket="test-bucket",
        s3_key="documents/contract.pdf",
        file_size=2048576,
        uploaded_at=datetime.now(),
        metadata={"mimeType": "application/pdf"}
    )

@pytest.fixture
def image_message():
    """Standard image file message."""
    return FileMessage(
        event_type="FILE_UPLOADED",
        s3_bucket="test-bucket",
        s3_key="images/photo.jpg",
        file_size=1024000,
        uploaded_at=datetime.now(),
        metadata={"mimeType": "image/jpeg"}
    )
```

### Mock Data Generation

```python
from faker import Faker

def create_random_message():
    """Generate random test message."""
    fake = Faker()
    return FileMessage(
        event_type="FILE_UPLOADED",
        s3_bucket="test-bucket",
        s3_key=f"files/{fake.file_name()}",
        file_size=fake.random_int(1000, 5000000),
        uploaded_at=fake.date_time_this_month(),
        metadata={"mimeType": fake.mime_type()}
    )
```

## Quality Gates

### Pre-merge Requirements

- [ ] All tests pass (unit, integration)
- [ ] Code coverage >= 80%
- [ ] No critical security vulnerabilities (Bandit)
- [ ] Code style compliant (Black, Pylint)
- [ ] Type checking passes (MyPy)
- [ ] Performance benchmarks within acceptable range

### Post-merge Validation

- [ ] E2E tests pass
- [ ] Load tests complete successfully
- [ ] Memory usage stable over 1-hour run
- [ ] No error logs in CloudWatch

## Monitoring and Reporting

### Test Metrics Dashboard

Key metrics to track:

1. **Test Execution Time**
   - Total duration
   - Per-test timing
   - Trend over time

2. **Code Coverage**
   - Line coverage
   - Branch coverage
   - Function coverage
   - Coverage trend

3. **Test Flakiness**
   - Flaky test rate
   - Failure patterns
   - Root cause analysis

4. **Performance Benchmarks**
   - CPU usage trends
   - Memory consumption
   - Throughput metrics

### Alerting Rules

```yaml
alerts:
  - name: Coverage Drop
    condition: coverage < 80%
    action: create_github_issue

  - name: High Flakiness
    condition: flaky_rate > 5%
    action: notify_slack

  - name: Performance Regression
    condition: duration_increase > 20%
    action: notify_team
```

## Best Practices

### 1. Test Naming Convention

```python
# Good
def test_process_pdf_message_success():
    """Test successful PDF processing with OCR."""

def test_process_pdf_message_fails_on_invalid_file():
    """Test processing fails with proper error on invalid PDF."""

# Bad
def test1():
def test_pdf():
```

### 2. Arrange-Act-Assert Pattern

```python
def test_download_file_from_s3():
    # Arrange - Set up test data
    s3_client = Mock()
    handler = StorageHandler(s3_client)

    # Act - Execute the operation
    result = handler.download_file("bucket", "key", "/tmp/file")

    # Assert - Verify the outcome
    assert result == "/tmp/file"
    s3_client.download_file.assert_called_once()
```

### 3. Test Isolation

```python
@pytest.fixture(autouse=True)
def cleanup():
    """Cleanup resources after each test."""
    yield
    # Cleanup code
    shutil.rmtree('/tmp/test_files', ignore_errors=True)
```

### 4. Parameterized Testing

```python
@pytest.mark.parametrize("file_type,expected_mime", [
    ("pdf", "application/pdf"),
    ("jpg", "image/jpeg"),
    ("png", "image/png"),
])
def test_file_type_detection(file_type, expected_mime):
    processor = FileProcessor()
    mime = processor.detect_file_type(f"file.{file_type}")
    assert mime == expected_mime
```

## Common Issues and Solutions

### Issue 1: Slow Test Execution

**Problem**: Tests take too long to run

**Solutions**:
- Use `pytest -n auto` for parallel execution
- Mock external services instead of real API calls
- Use in-memory databases for testing
- Implement test categorization (unit vs integration)

### Issue 2: Flaky Tests

**Problem**: Tests pass/fail randomly

**Solutions**:
- Avoid time-dependent assertions
- Use proper wait conditions for async operations
- Mock randomness and external dependencies
- Increase timeout values for slow operations

### Issue 3: Low Coverage

**Problem**: Cannot reach 80% coverage

**Solutions**:
- Identify uncovered code with `--cov-report=html`
- Add tests for error handling paths
- Test edge cases and boundary conditions
- Use mutation testing to find weak tests

## Implementation Timeline

### Week 1: Foundation
- [ ] Set up test directory structure
- [ ] Configure pytest and coverage tools
- [ ] Implement core unit tests (file_processor, models)
- [ ] Achieve 60% coverage

### Week 2: Expansion
- [ ] Add OCR engine tests
- [ ] Add Bedrock client tests
- [ ] Implement integration tests (S3, SQS)
- [ ] Achieve 75% coverage

### Week 3: Advanced Testing
- [ ] Add performance tests
- [ ] Add resilience tests
- [ ] Implement auto scaling tests
- [ ] Achieve 85% coverage

### Week 4: CI/CD Integration
- [ ] Set up GitHub Actions workflow
- [ ] Configure pre-commit hooks
- [ ] Implement quality gates
- [ ] Document testing procedures

## Resources

### Documentation
- [Comprehensive Testing Strategy](/Users/tatsuya/focus_project/cis_filesearch_app/docs/python-worker-test-strategy.md)
- [Quick Start Guide](/Users/tatsuya/focus_project/cis_filesearch_app/docs/python-worker-testing-quickstart.md)
- [pytest Documentation](https://docs.pytest.org/)
- [moto (AWS Mocking)](https://docs.getmoto.org/)

### Tools
- **pytest**: Core testing framework
- **moto**: AWS service mocking
- **locust**: Load testing
- **coverage**: Code coverage analysis
- **black**: Code formatting
- **pylint**: Code linting
- **mypy**: Static type checking

### Example Repositories
- [pytest-examples](https://github.com/pytest-dev/pytest/tree/main/testing/example_scripts)
- [aws-lambda-powertools-python](https://github.com/aws-powertools/powertools-lambda-python)

## Success Metrics

### Quantitative Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Code Coverage | 85% | TBD | Pending |
| Test Execution Time | <5 min | TBD | Pending |
| Test Flakiness Rate | <2% | TBD | Pending |
| Performance Regression | 0% | TBD | Pending |
| Security Vulnerabilities | 0 | TBD | Pending |

### Qualitative Metrics

- Developer confidence in deployments
- Reduced production incidents
- Faster bug detection and resolution
- Improved code maintainability
- Team productivity increase

## Conclusion

この包括的なテスト戦略により、EC2 Pythonワーカーアプリケーションの品質、信頼性、パフォーマンスを保証します。TDD原則に基づき、80%以上のコードカバレッジを達成し、堅牢なCI/CDパイプラインを確立することで、本番環境での安定稼働を実現します。

---

## Quick Reference

### Essential Commands

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific category
pytest -m unit

# Run in Docker
docker-compose -f docker-compose.test.yml up

# Load test
locust -f tests/performance/locustfile.py --users 10
```

### Key Files

- **Test Strategy**: `/docs/python-worker-test-strategy.md`
- **Quick Start**: `/docs/python-worker-testing-quickstart.md`
- **Config**: `backend/worker/pytest.ini`
- **Coverage**: `backend/worker/.coveragerc`
- **CI/CD**: `.github/workflows/python-worker-tests.yml`

---

**Document Version**: 1.0
**Created**: 2025-01-17
**Status**: Ready for Implementation
**Target Coverage**: 85%+
**Priority**: Critical
