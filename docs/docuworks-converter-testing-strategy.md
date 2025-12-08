# DocuWorks to PDF Converter - Day 2 Testing Strategy

## Executive Summary

This document provides a comprehensive testing strategy for Day 2 of the DocuWorks to PDF converter service deployment. The focus is on testing the mock implementation to prepare for Day 3 real DocuWorks license integration.

**Project Location**: `C:\DocuWorksConverter`
**Technology Stack**: .NET 7, AWS S3, AWS SQS, Windows Service
**Current Status**: Mock implementation complete
**Testing Timeline**: Day 2 (Today)
**Production Deployment**: Day 3 (Tomorrow)

---

## Table of Contents

1. [Testing Objectives](#testing-objectives)
2. [Test Environment Setup](#test-environment-setup)
3. [Unit Testing](#unit-testing)
4. [Integration Testing](#integration-testing)
5. [End-to-End Testing](#end-to-end-testing)
6. [Performance Testing](#performance-testing)
7. [Security Testing](#security-testing)
8. [Test Automation](#test-automation)
9. [Coverage Targets](#coverage-targets)
10. [Day 2 Execution Plan](#day-2-execution-plan)

---

## Testing Objectives

### Primary Goals
- ✅ Validate mock IDocuWorksProcessor interface implementation
- ✅ Test AWS S3 integration (upload/download/metadata)
- ✅ Test AWS SQS message processing (receive/process/delete)
- ✅ Verify Windows Service lifecycle management
- ✅ Ensure error handling and retry logic
- ✅ Validate logging and monitoring
- ✅ Performance benchmarking for Day 3 baseline

### Success Criteria
- 80%+ unit test coverage
- 100% AWS integration test pass rate
- Zero critical security vulnerabilities
- Windows Service starts/stops reliably
- Mock conversion completes in <5 seconds per file
- All error scenarios handled gracefully

---

## Test Environment Setup

### Prerequisites

```powershell
# Install .NET 7 SDK
winget install Microsoft.DotNet.SDK.7

# Install AWS CLI
winget install Amazon.AWSCLI

# Install LocalStack (for local AWS testing)
pip install localstack
pip install awscli-local

# Verify installations
dotnet --version
aws --version
localstack --version
```

### LocalStack Configuration

Create `docker-compose.yml` in project root:

```yaml
version: '3.8'
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
      - "4571:4571"
    environment:
      - SERVICES=s3,sqs
      - DEBUG=1
      - DATA_DIR=/tmp/localstack/data
      - DOCKER_HOST=unix:///var/run/docker.sock
    volumes:
      - "./localstack-data:/tmp/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"
```

Start LocalStack:

```powershell
docker-compose up -d
```

### AWS Test Resources Setup

```powershell
# Configure AWS CLI for LocalStack
aws configure set aws_access_key_id test
aws configure set aws_secret_access_key test
aws configure set region us-east-1

# Create test S3 bucket
awslocal s3 mb s3://docuworks-test-bucket

# Create test SQS queue
awslocal sqs create-queue --queue-name docuworks-test-queue

# Verify resources
awslocal s3 ls
awslocal sqs list-queues
```

### Test Project Setup

```powershell
cd C:\DocuWorksConverter

# Create test project
dotnet new xunit -n DocuWorksConverter.Tests
cd DocuWorksConverter.Tests

# Add required NuGet packages
dotnet add package xUnit
dotnet add package xunit.runner.visualstudio
dotnet add package Moq
dotnet add package FluentAssertions
dotnet add package AWSSDK.S3
dotnet add package AWSSDK.SQS
dotnet add package Microsoft.Extensions.Logging.Abstractions
dotnet add package Testcontainers
dotnet add package BenchmarkDotNet

# Add reference to main project
dotnet add reference ../DocuWorksConverter/DocuWorksConverter.csproj
```

---

## Unit Testing

### 1. IDocuWorksProcessor Interface Tests

**File**: `DocuWorksConverter.Tests/Services/MockDocuWorksProcessorTests.cs`

```csharp
using Xunit;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using DocuWorksConverter.Services;
using DocuWorksConverter.Interfaces;

namespace DocuWorksConverter.Tests.Services
{
    public class MockDocuWorksProcessorTests
    {
        private readonly ILogger<MockDocuWorksProcessor> _logger;
        private readonly IDocuWorksProcessor _processor;

        public MockDocuWorksProcessorTests()
        {
            _logger = Mock.Of<ILogger<MockDocuWorksProcessor>>();
            _processor = new MockDocuWorksProcessor(_logger);
        }

        [Fact]
        public async Task ConvertToPdf_WithValidXdwFile_ShouldReturnPdfPath()
        {
            // Arrange
            var testXdwPath = Path.Combine(Path.GetTempPath(), "test.xdw");
            var testXdwBytes = new byte[] { 0x58, 0x44, 0x57, 0x46 }; // Mock XDW header
            await File.WriteAllBytesAsync(testXdwPath, testXdwBytes);

            try
            {
                // Act
                var pdfPath = await _processor.ConvertToPdfAsync(testXdwPath);

                // Assert
                pdfPath.Should().NotBeNullOrEmpty();
                File.Exists(pdfPath).Should().BeTrue();
                Path.GetExtension(pdfPath).Should().Be(".pdf");

                var fileInfo = new FileInfo(pdfPath);
                fileInfo.Length.Should().BeGreaterThan(0);
            }
            finally
            {
                // Cleanup
                if (File.Exists(testXdwPath)) File.Delete(testXdwPath);
            }
        }

        [Fact]
        public async Task ConvertToPdf_WithNonExistentFile_ShouldThrowFileNotFoundException()
        {
            // Arrange
            var nonExistentPath = Path.Combine(Path.GetTempPath(), "nonexistent.xdw");

            // Act & Assert
            await Assert.ThrowsAsync<FileNotFoundException>(
                async () => await _processor.ConvertToPdfAsync(nonExistentPath)
            );
        }

        [Fact]
        public async Task ConvertToPdf_WithInvalidExtension_ShouldThrowArgumentException()
        {
            // Arrange
            var invalidPath = Path.Combine(Path.GetTempPath(), "test.txt");
            await File.WriteAllTextAsync(invalidPath, "test content");

            try
            {
                // Act & Assert
                await Assert.ThrowsAsync<ArgumentException>(
                    async () => await _processor.ConvertToPdfAsync(invalidPath)
                );
            }
            finally
            {
                if (File.Exists(invalidPath)) File.Delete(invalidPath);
            }
        }

        [Theory]
        [InlineData("test.xdw")]
        [InlineData("document.XDW")]
        [InlineData("file_name_with_underscore.xdw")]
        [InlineData("ファイル名.xdw")] // Japanese filename
        public async Task ConvertToPdf_WithVariousFilenames_ShouldSucceed(string filename)
        {
            // Arrange
            var testPath = Path.Combine(Path.GetTempPath(), filename);
            var testBytes = new byte[] { 0x58, 0x44, 0x57, 0x46 };
            await File.WriteAllBytesAsync(testPath, testBytes);

            try
            {
                // Act
                var pdfPath = await _processor.ConvertToPdfAsync(testPath);

                // Assert
                pdfPath.Should().NotBeNullOrEmpty();
                File.Exists(pdfPath).Should().BeTrue();
            }
            finally
            {
                if (File.Exists(testPath)) File.Delete(testPath);
            }
        }

        [Fact]
        public async Task ConvertToPdf_ShouldLogProgress()
        {
            // Arrange
            var mockLogger = new Mock<ILogger<MockDocuWorksProcessor>>();
            var processor = new MockDocuWorksProcessor(mockLogger.Object);

            var testPath = Path.Combine(Path.GetTempPath(), "test.xdw");
            await File.WriteAllBytesAsync(testPath, new byte[] { 0x58, 0x44, 0x57, 0x46 });

            try
            {
                // Act
                await processor.ConvertToPdfAsync(testPath);

                // Assert
                mockLogger.Verify(
                    x => x.Log(
                        LogLevel.Information,
                        It.IsAny<EventId>(),
                        It.Is<It.IsAnyType>((v, t) => v.ToString().Contains("Converting")),
                        It.IsAny<Exception>(),
                        It.IsAny<Func<It.IsAnyType, Exception, string>>()),
                    Times.AtLeastOnce);
            }
            finally
            {
                if (File.Exists(testPath)) File.Delete(testPath);
            }
        }
    }
}
```

### 2. S3 Service Tests

**File**: `DocuWorksConverter.Tests/Services/S3ServiceTests.cs`

```csharp
using Xunit;
using FluentAssertions;
using Moq;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging;
using DocuWorksConverter.Services;

namespace DocuWorksConverter.Tests.Services
{
    public class S3ServiceTests
    {
        private readonly Mock<IAmazonS3> _mockS3Client;
        private readonly Mock<ILogger<S3Service>> _mockLogger;
        private readonly S3Service _service;
        private const string TestBucket = "test-bucket";

        public S3ServiceTests()
        {
            _mockS3Client = new Mock<IAmazonS3>();
            _mockLogger = new Mock<ILogger<S3Service>>();
            _service = new S3Service(_mockS3Client.Object, _mockLogger.Object, TestBucket);
        }

        [Fact]
        public async Task UploadFileAsync_WithValidFile_ShouldReturnS3Uri()
        {
            // Arrange
            var testFilePath = Path.Combine(Path.GetTempPath(), "test.pdf");
            await File.WriteAllBytesAsync(testFilePath, new byte[] { 0x25, 0x50, 0x44, 0x46 });
            var expectedKey = $"converted/{Path.GetFileName(testFilePath)}";

            _mockS3Client
                .Setup(x => x.PutObjectAsync(It.IsAny<PutObjectRequest>(), default))
                .ReturnsAsync(new PutObjectResponse { HttpStatusCode = System.Net.HttpStatusCode.OK });

            try
            {
                // Act
                var result = await _service.UploadFileAsync(testFilePath, "converted/");

                // Assert
                result.Should().NotBeNullOrEmpty();
                result.Should().Contain(TestBucket);
                result.Should().Contain(expectedKey);

                _mockS3Client.Verify(
                    x => x.PutObjectAsync(
                        It.Is<PutObjectRequest>(req =>
                            req.BucketName == TestBucket &&
                            req.Key == expectedKey),
                        default),
                    Times.Once);
            }
            finally
            {
                if (File.Exists(testFilePath)) File.Delete(testFilePath);
            }
        }

        [Fact]
        public async Task DownloadFileAsync_WithValidKey_ShouldSaveToLocalPath()
        {
            // Arrange
            var testKey = "source/test.xdw";
            var localPath = Path.Combine(Path.GetTempPath(), "downloaded.xdw");
            var testContent = new byte[] { 0x58, 0x44, 0x57, 0x46 };

            var memoryStream = new MemoryStream(testContent);
            var getObjectResponse = new GetObjectResponse
            {
                ResponseStream = memoryStream,
                HttpStatusCode = System.Net.HttpStatusCode.OK
            };

            _mockS3Client
                .Setup(x => x.GetObjectAsync(It.IsAny<GetObjectRequest>(), default))
                .ReturnsAsync(getObjectResponse);

            try
            {
                // Act
                var result = await _service.DownloadFileAsync(testKey, localPath);

                // Assert
                result.Should().Be(localPath);
                File.Exists(localPath).Should().BeTrue();
                var downloadedContent = await File.ReadAllBytesAsync(localPath);
                downloadedContent.Should().BeEquivalentTo(testContent);

                _mockS3Client.Verify(
                    x => x.GetObjectAsync(
                        It.Is<GetObjectRequest>(req =>
                            req.BucketName == TestBucket &&
                            req.Key == testKey),
                        default),
                    Times.Once);
            }
            finally
            {
                if (File.Exists(localPath)) File.Delete(localPath);
            }
        }

        [Fact]
        public async Task DownloadFileAsync_WithNonExistentKey_ShouldThrowException()
        {
            // Arrange
            var testKey = "nonexistent/file.xdw";
            var localPath = Path.Combine(Path.GetTempPath(), "test.xdw");

            _mockS3Client
                .Setup(x => x.GetObjectAsync(It.IsAny<GetObjectRequest>(), default))
                .ThrowsAsync(new AmazonS3Exception("The specified key does not exist."));

            // Act & Assert
            await Assert.ThrowsAsync<AmazonS3Exception>(
                async () => await _service.DownloadFileAsync(testKey, localPath)
            );
        }

        [Fact]
        public async Task GetFileMetadataAsync_WithValidKey_ShouldReturnMetadata()
        {
            // Arrange
            var testKey = "source/test.xdw";
            var expectedMetadata = new Dictionary<string, string>
            {
                { "original-filename", "test.xdw" },
                { "upload-timestamp", "2025-01-28T10:00:00Z" }
            };

            var headObjectResponse = new GetObjectMetadataResponse
            {
                HttpStatusCode = System.Net.HttpStatusCode.OK,
                Metadata = new MetadataCollection()
            };

            foreach (var kvp in expectedMetadata)
            {
                headObjectResponse.Metadata[kvp.Key] = kvp.Value;
            }

            _mockS3Client
                .Setup(x => x.GetObjectMetadataAsync(It.IsAny<GetObjectMetadataRequest>(), default))
                .ReturnsAsync(headObjectResponse);

            // Act
            var result = await _service.GetFileMetadataAsync(testKey);

            // Assert
            result.Should().NotBeNull();
            result.Should().ContainKey("original-filename");
            result["original-filename"].Should().Be("test.xdw");
        }
    }
}
```

### 3. SQS Service Tests

**File**: `DocuWorksConverter.Tests/Services/SqsServiceTests.cs`

```csharp
using Xunit;
using FluentAssertions;
using Moq;
using Amazon.SQS;
using Amazon.SQS.Model;
using Microsoft.Extensions.Logging;
using DocuWorksConverter.Services;
using DocuWorksConverter.Models;

namespace DocuWorksConverter.Tests.Services
{
    public class SqsServiceTests
    {
        private readonly Mock<IAmazonSQS> _mockSqsClient;
        private readonly Mock<ILogger<SqsService>> _mockLogger;
        private readonly SqsService _service;
        private const string TestQueueUrl = "https://sqs.us-east-1.amazonaws.com/123456789/test-queue";

        public SqsServiceTests()
        {
            _mockSqsClient = new Mock<IAmazonSQS>();
            _mockLogger = new Mock<ILogger<SqsService>>();
            _service = new SqsService(_mockSqsClient.Object, _mockLogger.Object, TestQueueUrl);
        }

        [Fact]
        public async Task ReceiveMessagesAsync_WithAvailableMessages_ShouldReturnMessages()
        {
            // Arrange
            var testMessage = new Message
            {
                MessageId = "msg-123",
                ReceiptHandle = "receipt-123",
                Body = @"{
                    ""s3Key"": ""source/test.xdw"",
                    ""fileName"": ""test.xdw"",
                    ""timestamp"": ""2025-01-28T10:00:00Z""
                }"
            };

            _mockSqsClient
                .Setup(x => x.ReceiveMessageAsync(It.IsAny<ReceiveMessageRequest>(), default))
                .ReturnsAsync(new ReceiveMessageResponse
                {
                    Messages = new List<Message> { testMessage },
                    HttpStatusCode = System.Net.HttpStatusCode.OK
                });

            // Act
            var results = await _service.ReceiveMessagesAsync(maxMessages: 1);

            // Assert
            results.Should().HaveCount(1);
            results[0].MessageId.Should().Be("msg-123");
            results[0].ReceiptHandle.Should().Be("receipt-123");

            _mockSqsClient.Verify(
                x => x.ReceiveMessageAsync(
                    It.Is<ReceiveMessageRequest>(req =>
                        req.QueueUrl == TestQueueUrl &&
                        req.MaxNumberOfMessages == 1),
                    default),
                Times.Once);
        }

        [Fact]
        public async Task DeleteMessageAsync_WithValidReceiptHandle_ShouldSucceed()
        {
            // Arrange
            var receiptHandle = "valid-receipt-handle";

            _mockSqsClient
                .Setup(x => x.DeleteMessageAsync(It.IsAny<DeleteMessageRequest>(), default))
                .ReturnsAsync(new DeleteMessageResponse
                {
                    HttpStatusCode = System.Net.HttpStatusCode.OK
                });

            // Act
            await _service.DeleteMessageAsync(receiptHandle);

            // Assert
            _mockSqsClient.Verify(
                x => x.DeleteMessageAsync(
                    It.Is<DeleteMessageRequest>(req =>
                        req.QueueUrl == TestQueueUrl &&
                        req.ReceiptHandle == receiptHandle),
                    default),
                Times.Once);
        }

        [Fact]
        public async Task ParseMessageBody_WithValidJson_ShouldReturnConversionJob()
        {
            // Arrange
            var messageBody = @"{
                ""s3Key"": ""source/document.xdw"",
                ""fileName"": ""document.xdw"",
                ""timestamp"": ""2025-01-28T10:30:00Z"",
                ""metadata"": {
                    ""userId"": ""user123"",
                    ""priority"": ""high""
                }
            }";

            // Act
            var job = _service.ParseMessageBody(messageBody);

            // Assert
            job.Should().NotBeNull();
            job.S3Key.Should().Be("source/document.xdw");
            job.FileName.Should().Be("document.xdw");
            job.Metadata.Should().ContainKey("userId");
            job.Metadata["userId"].Should().Be("user123");
        }

        [Fact]
        public void ParseMessageBody_WithInvalidJson_ShouldThrowException()
        {
            // Arrange
            var invalidJson = "{ invalid json }";

            // Act & Assert
            Assert.Throws<System.Text.Json.JsonException>(
                () => _service.ParseMessageBody(invalidJson)
            );
        }
    }
}
```

---

## Integration Testing

### 1. AWS Integration Tests with LocalStack

**File**: `DocuWorksConverter.Tests/Integration/AwsIntegrationTests.cs`

```csharp
using Xunit;
using FluentAssertions;
using Amazon.S3;
using Amazon.SQS;
using Amazon.Runtime;
using Microsoft.Extensions.Logging;
using DocuWorksConverter.Services;
using System.Text.Json;

namespace DocuWorksConverter.Tests.Integration
{
    [Collection("AWS Integration")]
    public class AwsIntegrationTests : IAsyncLifetime
    {
        private IAmazonS3 _s3Client;
        private IAmazonSQS _sqsClient;
        private S3Service _s3Service;
        private SqsService _sqsService;

        private const string LocalStackEndpoint = "http://localhost:4566";
        private const string TestBucket = "docuworks-test-bucket";
        private const string TestQueueName = "docuworks-test-queue";
        private string _testQueueUrl;

        public async Task InitializeAsync()
        {
            // Configure AWS clients for LocalStack
            var config = new AmazonS3Config
            {
                ServiceURL = LocalStackEndpoint,
                ForcePathStyle = true
            };

            var sqsConfig = new AmazonSQSConfig
            {
                ServiceURL = LocalStackEndpoint
            };

            var credentials = new BasicAWSCredentials("test", "test");

            _s3Client = new AmazonS3Client(credentials, config);
            _sqsClient = new AmazonSQSClient(credentials, sqsConfig);

            // Setup test resources
            try
            {
                await _s3Client.PutBucketAsync(TestBucket);
            }
            catch (AmazonS3Exception) { } // Bucket might already exist

            var queueResponse = await _sqsClient.CreateQueueAsync(TestQueueName);
            _testQueueUrl = queueResponse.QueueUrl;

            // Initialize services
            _s3Service = new S3Service(
                _s3Client,
                Mock.Of<ILogger<S3Service>>(),
                TestBucket
            );

            _sqsService = new SqsService(
                _sqsClient,
                Mock.Of<ILogger<SqsService>>(),
                _testQueueUrl
            );
        }

        public async Task DisposeAsync()
        {
            // Cleanup
            try
            {
                var objects = await _s3Client.ListObjectsV2Async(new ListObjectsV2Request
                {
                    BucketName = TestBucket
                });

                foreach (var obj in objects.S3Objects)
                {
                    await _s3Client.DeleteObjectAsync(TestBucket, obj.Key);
                }

                await _s3Client.DeleteBucketAsync(TestBucket);
                await _sqsClient.DeleteQueueAsync(_testQueueUrl);
            }
            catch { }

            _s3Client?.Dispose();
            _sqsClient?.Dispose();
        }

        [Fact]
        public async Task EndToEnd_ConversionWorkflow_ShouldSucceed()
        {
            // Arrange - Create test XDW file
            var testXdwPath = Path.Combine(Path.GetTempPath(), "integration-test.xdw");
            await File.WriteAllBytesAsync(testXdwPath, new byte[] { 0x58, 0x44, 0x57, 0x46 });

            try
            {
                // Step 1: Upload XDW to S3
                var s3Key = await _s3Service.UploadFileAsync(testXdwPath, "source/");
                s3Key.Should().NotBeNullOrEmpty();

                // Step 2: Send message to SQS
                var message = new
                {
                    s3Key = s3Key.Split('/').Last(),
                    fileName = "integration-test.xdw",
                    timestamp = DateTime.UtcNow.ToString("o")
                };

                await _sqsClient.SendMessageAsync(_testQueueUrl, JsonSerializer.Serialize(message));

                // Step 3: Receive and process message
                var messages = await _sqsService.ReceiveMessagesAsync(1);
                messages.Should().HaveCount(1);

                var job = _sqsService.ParseMessageBody(messages[0].Body);
                job.Should().NotBeNull();
                job.FileName.Should().Be("integration-test.xdw");

                // Step 4: Download file from S3
                var downloadPath = Path.Combine(Path.GetTempPath(), "downloaded-" + job.FileName);
                await _s3Service.DownloadFileAsync(job.S3Key, downloadPath);
                File.Exists(downloadPath).Should().BeTrue();

                // Step 5: Convert (mock)
                var processor = new MockDocuWorksProcessor(Mock.Of<ILogger<MockDocuWorksProcessor>>());
                var pdfPath = await processor.ConvertToPdfAsync(downloadPath);
                File.Exists(pdfPath).Should().BeTrue();

                // Step 6: Upload PDF back to S3
                var pdfS3Key = await _s3Service.UploadFileAsync(pdfPath, "converted/");
                pdfS3Key.Should().NotBeNullOrEmpty();

                // Step 7: Delete message from queue
                await _sqsService.DeleteMessageAsync(messages[0].ReceiptHandle);

                // Verify message was deleted
                var remainingMessages = await _sqsService.ReceiveMessagesAsync(1);
                remainingMessages.Should().BeEmpty();

                // Cleanup local files
                if (File.Exists(downloadPath)) File.Delete(downloadPath);
                if (File.Exists(pdfPath)) File.Delete(pdfPath);
            }
            finally
            {
                if (File.Exists(testXdwPath)) File.Delete(testXdwPath);
            }
        }

        [Fact]
        public async Task S3_LargeFileUpload_ShouldHandleMultipartUpload()
        {
            // Arrange - Create 10MB file
            var largeFilePath = Path.Combine(Path.GetTempPath(), "large-file.xdw");
            var fileSize = 10 * 1024 * 1024; // 10MB
            var randomData = new byte[fileSize];
            new Random().NextBytes(randomData);
            await File.WriteAllBytesAsync(largeFilePath, randomData);

            try
            {
                // Act - Upload large file
                var stopwatch = System.Diagnostics.Stopwatch.StartNew();
                var s3Key = await _s3Service.UploadFileAsync(largeFilePath, "large-files/");
                stopwatch.Stop();

                // Assert
                s3Key.Should().NotBeNullOrEmpty();
                stopwatch.ElapsedMilliseconds.Should().BeLessThan(30000); // < 30 seconds

                // Verify file exists in S3
                var metadata = await _s3Service.GetFileMetadataAsync(s3Key.Split('/').Last());
                metadata.Should().NotBeNull();
            }
            finally
            {
                if (File.Exists(largeFilePath)) File.Delete(largeFilePath);
            }
        }

        [Fact]
        public async Task SQS_BatchProcessing_ShouldHandleMultipleMessages()
        {
            // Arrange - Send multiple messages
            var messageCount = 10;
            var sentMessages = new List<string>();

            for (int i = 0; i < messageCount; i++)
            {
                var message = new
                {
                    s3Key = $"source/test-{i}.xdw",
                    fileName = $"test-{i}.xdw",
                    timestamp = DateTime.UtcNow.ToString("o")
                };
                var messageBody = JsonSerializer.Serialize(message);
                await _sqsClient.SendMessageAsync(_testQueueUrl, messageBody);
                sentMessages.Add(messageBody);
            }

            // Act - Receive messages in batches
            var receivedMessages = new List<Message>();
            var maxRetries = 5;
            var retryCount = 0;

            while (receivedMessages.Count < messageCount && retryCount < maxRetries)
            {
                var batch = await _sqsService.ReceiveMessagesAsync(10);
                receivedMessages.AddRange(batch);
                retryCount++;
                await Task.Delay(100); // Small delay between retries
            }

            // Assert
            receivedMessages.Should().HaveCount(messageCount);

            // Cleanup - Delete all messages
            foreach (var msg in receivedMessages)
            {
                await _sqsService.DeleteMessageAsync(msg.ReceiptHandle);
            }
        }
    }
}
```

---

## Performance Testing

### BenchmarkDotNet Tests

**File**: `DocuWorksConverter.Tests/Performance/ConversionBenchmarks.cs`

```csharp
using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Running;
using DocuWorksConverter.Services;
using Microsoft.Extensions.Logging;
using Moq;

namespace DocuWorksConverter.Tests.Performance
{
    [MemoryDiagnoser]
    [SimpleJob(warmupCount: 3, targetCount: 10)]
    public class ConversionBenchmarks
    {
        private MockDocuWorksProcessor _processor;
        private string _testFilePath;

        [GlobalSetup]
        public void Setup()
        {
            _processor = new MockDocuWorksProcessor(Mock.Of<ILogger<MockDocuWorksProcessor>>());
            _testFilePath = Path.Combine(Path.GetTempPath(), "benchmark-test.xdw");

            // Create test file with realistic size (1MB)
            var testData = new byte[1 * 1024 * 1024];
            new Random(42).NextBytes(testData);
            File.WriteAllBytes(_testFilePath, testData);
        }

        [GlobalCleanup]
        public void Cleanup()
        {
            if (File.Exists(_testFilePath))
                File.Delete(_testFilePath);
        }

        [Benchmark]
        public async Task<string> ConvertSingleFile()
        {
            return await _processor.ConvertToPdfAsync(_testFilePath);
        }

        [Benchmark]
        public async Task ConvertMultipleFilesSequential()
        {
            for (int i = 0; i < 10; i++)
            {
                await _processor.ConvertToPdfAsync(_testFilePath);
            }
        }

        [Benchmark]
        public async Task ConvertMultipleFilesParallel()
        {
            var tasks = Enumerable.Range(0, 10)
                .Select(_ => _processor.ConvertToPdfAsync(_testFilePath));
            await Task.WhenAll(tasks);
        }
    }

    public class BenchmarkRunner
    {
        public static void Main(string[] args)
        {
            var summary = BenchmarkRunner.Run<ConversionBenchmarks>();
            Console.WriteLine(summary);
        }
    }
}
```

**Run benchmarks**:

```powershell
cd C:\DocuWorksConverter\DocuWorksConverter.Tests
dotnet run -c Release --project Performance/ConversionBenchmarks.cs
```

---

## Security Testing

### 1. Input Validation Tests

**File**: `DocuWorksConverter.Tests/Security/InputValidationTests.cs`

```csharp
using Xunit;
using FluentAssertions;
using DocuWorksConverter.Services;
using DocuWorksConverter.Validators;

namespace DocuWorksConverter.Tests.Security
{
    public class InputValidationTests
    {
        [Theory]
        [InlineData("../../etc/passwd")] // Path traversal
        [InlineData("C:\\Windows\\System32\\config\\sam")] // System file
        [InlineData("<script>alert('xss')</script>.xdw")] // XSS attempt
        [InlineData("test'; DROP TABLE Files; --.xdw")] // SQL injection
        public void ValidateFilePath_WithMaliciousInput_ShouldThrowException(string maliciousPath)
        {
            // Arrange
            var validator = new FilePathValidator();

            // Act & Assert
            Assert.Throws<SecurityException>(() => validator.ValidateFilePath(maliciousPath));
        }

        [Theory]
        [InlineData("C:\\Temp\\test.xdw")]
        [InlineData("D:\\Documents\\report_2025.xdw")]
        [InlineData("E:\\Files\\営業資料.xdw")]
        public void ValidateFilePath_WithValidInput_ShouldPass(string validPath)
        {
            // Arrange
            var validator = new FilePathValidator();

            // Act & Assert
            var exception = Record.Exception(() => validator.ValidateFilePath(validPath));
            exception.Should().BeNull();
        }

        [Fact]
        public void ValidateS3Key_WithPathTraversal_ShouldThrowException()
        {
            // Arrange
            var validator = new S3KeyValidator();
            var maliciousKey = "../../../sensitive-data/passwords.txt";

            // Act & Assert
            Assert.Throws<SecurityException>(() => validator.ValidateS3Key(maliciousKey));
        }
    }
}
```

### 2. Security Scan Script

**File**: `C:\DocuWorksConverter\scripts\security-scan.ps1`

```powershell
# Security vulnerability scanner for Day 2 testing

Write-Host "=== DocuWorks Converter Security Scan ===" -ForegroundColor Cyan

# 1. Check for hardcoded credentials
Write-Host "`nScanning for hardcoded credentials..." -ForegroundColor Yellow
$credentialPatterns = @(
    'password\s*=\s*"[^"]+"',
    'apiKey\s*=\s*"[^"]+"',
    'accessKey\s*=\s*"[^"]+"',
    'secretKey\s*=\s*"[^"]+"'
)

$foundCredentials = $false
foreach ($pattern in $credentialPatterns) {
    $results = Get-ChildItem -Path "C:\DocuWorksConverter" -Recurse -Include *.cs,*.config,*.json |
        Select-String -Pattern $pattern -CaseSensitive:$false

    if ($results) {
        Write-Host "WARNING: Potential hardcoded credentials found:" -ForegroundColor Red
        $results | ForEach-Object { Write-Host "  $($_.Path):$($_.LineNumber)" -ForegroundColor Red }
        $foundCredentials = $true
    }
}

if (-not $foundCredentials) {
    Write-Host "✓ No hardcoded credentials detected" -ForegroundColor Green
}

# 2. Check for unsafe file operations
Write-Host "`nScanning for unsafe file operations..." -ForegroundColor Yellow
$unsafePatterns = @(
    'File\.Delete\([^\)]+\)',
    'Directory\.Delete\([^\)]+\)',
    'File\.Move\([^\)]+\)'
)

$foundUnsafe = $false
foreach ($pattern in $unsafePatterns) {
    $results = Get-ChildItem -Path "C:\DocuWorksConverter" -Recurse -Include *.cs |
        Select-String -Pattern $pattern

    if ($results) {
        Write-Host "WARNING: Unsafe file operations found (review required):" -ForegroundColor Yellow
        $results | ForEach-Object { Write-Host "  $($_.Path):$($_.LineNumber)" -ForegroundColor Yellow }
        $foundUnsafe = $true
    }
}

if (-not $foundUnsafe) {
    Write-Host "✓ No obviously unsafe file operations" -ForegroundColor Green
}

# 3. Check AWS permissions
Write-Host "`nChecking AWS IAM permissions..." -ForegroundColor Yellow
try {
    $identity = aws sts get-caller-identity | ConvertFrom-Json
    Write-Host "✓ AWS identity: $($identity.Arn)" -ForegroundColor Green

    # Test S3 permissions
    $testBucket = "docuworks-test-bucket"
    aws s3 ls "s3://$testBucket" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ S3 read access verified" -ForegroundColor Green
    } else {
        Write-Host "✗ S3 access failed - check IAM policies" -ForegroundColor Red
    }

    # Test SQS permissions
    $queueUrl = aws sqs list-queues --queue-name-prefix "docuworks" --query 'QueueUrls[0]' --output text
    if ($queueUrl) {
        Write-Host "✓ SQS access verified" -ForegroundColor Green
    } else {
        Write-Host "✗ SQS access failed - check IAM policies" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ AWS CLI not configured or not authenticated" -ForegroundColor Red
}

# 4. Check for exposed ports
Write-Host "`nChecking for exposed network ports..." -ForegroundColor Yellow
$listeningPorts = Get-NetTCPConnection | Where-Object { $_.State -eq 'Listen' } |
    Select-Object LocalAddress, LocalPort, OwningProcess | Sort-Object LocalPort

if ($listeningPorts) {
    Write-Host "Listening ports detected:" -ForegroundColor Yellow
    $listeningPorts | ForEach-Object {
        $processName = (Get-Process -Id $_.OwningProcess).ProcessName
        Write-Host "  Port $($_.LocalPort): $processName" -ForegroundColor White
    }
}

# 5. Generate security report
$reportPath = "C:\DocuWorksConverter\security-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
@"
DocuWorks Converter Security Scan Report
Generated: $(Get-Date)

Hardcoded Credentials: $(if ($foundCredentials) { 'FOUND - REVIEW REQUIRED' } else { 'Not detected' })
Unsafe File Operations: $(if ($foundUnsafe) { 'Found - Review recommended' } else { 'None detected' })
AWS Access: Configured
Network Exposure: See listening ports above

Recommendations:
1. Store credentials in AWS Secrets Manager or environment variables
2. Implement input validation for all file paths
3. Use least-privilege IAM policies
4. Enable AWS CloudTrail logging
5. Implement rate limiting for SQS message processing
6. Use VPC endpoints for S3/SQS access (if in VPC)

"@ | Out-File -FilePath $reportPath

Write-Host "`n✓ Security report generated: $reportPath" -ForegroundColor Green
Write-Host "`n=== Security Scan Complete ===" -ForegroundColor Cyan
```

---

## Test Automation

### GitHub Actions Workflow

**File**: `.github/workflows/docuworks-converter-tests.yml`

```yaml
name: DocuWorks Converter Tests

on:
  push:
    branches: [ main, develop ]
    paths:
      - 'backend/DocuWorksConverter/**'
  pull_request:
    branches: [ main, develop ]

jobs:
  unit-tests:
    runs-on: windows-latest

    steps:
    - uses: actions/checkout@v3

    - name: Setup .NET 7
      uses: actions/setup-dotnet@v3
      with:
        dotnet-version: '7.0.x'

    - name: Restore dependencies
      run: dotnet restore backend/DocuWorksConverter/DocuWorksConverter.sln

    - name: Build
      run: dotnet build backend/DocuWorksConverter/DocuWorksConverter.sln --no-restore --configuration Release

    - name: Run Unit Tests
      run: dotnet test backend/DocuWorksConverter/DocuWorksConverter.Tests/DocuWorksConverter.Tests.csproj --no-build --configuration Release --logger "trx;LogFileName=test-results.trx" --collect:"XPlat Code Coverage"

    - name: Generate Coverage Report
      run: |
        dotnet tool install -g dotnet-reportgenerator-globaltool
        reportgenerator -reports:**/coverage.cobertura.xml -targetdir:coverage-report -reporttypes:Html

    - name: Upload Test Results
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: test-results
        path: "**/test-results.trx"

    - name: Upload Coverage Report
      uses: actions/upload-artifact@v3
      with:
        name: coverage-report
        path: coverage-report/

  integration-tests:
    runs-on: windows-latest
    needs: unit-tests

    services:
      localstack:
        image: localstack/localstack:latest
        ports:
          - 4566:4566
        env:
          SERVICES: s3,sqs
          DEBUG: 1

    steps:
    - uses: actions/checkout@v3

    - name: Setup .NET 7
      uses: actions/setup-dotnet@v3
      with:
        dotnet-version: '7.0.x'

    - name: Setup LocalStack
      run: |
        pip install awscli-local
        awslocal s3 mb s3://docuworks-test-bucket
        awslocal sqs create-queue --queue-name docuworks-test-queue

    - name: Run Integration Tests
      run: dotnet test backend/DocuWorksConverter/DocuWorksConverter.Tests/DocuWorksConverter.Tests.csproj --filter "Category=Integration" --logger "trx;LogFileName=integration-results.trx"
      env:
        AWS_ENDPOINT: http://localhost:4566
        AWS_ACCESS_KEY_ID: test
        AWS_SECRET_ACCESS_KEY: test

    - name: Upload Integration Test Results
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: integration-test-results
        path: "**/integration-results.trx"
```

### Local Test Runner Script

**File**: `C:\DocuWorksConverter\scripts\run-all-tests.ps1`

```powershell
# Comprehensive test runner for Day 2 testing

param(
    [switch]$Unit,
    [switch]$Integration,
    [switch]$Performance,
    [switch]$Security,
    [switch]$All,
    [switch]$Coverage
)

$ErrorActionPreference = "Stop"

Write-Host "=== DocuWorks Converter Test Runner ===" -ForegroundColor Cyan
Write-Host "Starting tests at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n" -ForegroundColor White

$projectRoot = "C:\DocuWorksConverter"
$testProject = "$projectRoot\DocuWorksConverter.Tests\DocuWorksConverter.Tests.csproj"

# Function to run tests with optional filter
function Run-Tests {
    param(
        [string]$TestCategory,
        [string]$DisplayName,
        [bool]$RunCoverage = $false
    )

    Write-Host "`n=== Running $DisplayName ===" -ForegroundColor Yellow

    $testArgs = @(
        "test",
        $testProject,
        "--configuration", "Release",
        "--logger", "trx;LogFileName=$TestCategory-results.trx",
        "--logger", "console;verbosity=detailed"
    )

    if ($TestCategory -ne "All") {
        $testArgs += @("--filter", "Category=$TestCategory")
    }

    if ($RunCoverage) {
        $testArgs += @(
            "--collect:XPlat Code Coverage",
            "--settings", "$projectRoot\coverlet.runsettings"
        )
    }

    & dotnet $testArgs

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ $DisplayName passed" -ForegroundColor Green
        return $true
    } else {
        Write-Host "✗ $DisplayName failed" -ForegroundColor Red
        return $false
    }
}

# Build project first
Write-Host "Building project..." -ForegroundColor Yellow
dotnet build "$projectRoot\DocuWorksConverter.sln" --configuration Release
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Build successful" -ForegroundColor Green

# Run selected test categories
$testResults = @{}

if ($All -or $Unit) {
    $testResults["Unit"] = Run-Tests -TestCategory "Unit" -DisplayName "Unit Tests" -RunCoverage $Coverage
}

if ($All -or $Integration) {
    Write-Host "`nStarting LocalStack for integration tests..." -ForegroundColor Yellow
    docker-compose -f "$projectRoot\docker-compose.yml" up -d
    Start-Sleep -Seconds 5

    $testResults["Integration"] = Run-Tests -TestCategory "Integration" -DisplayName "Integration Tests"

    Write-Host "`nStopping LocalStack..." -ForegroundColor Yellow
    docker-compose -f "$projectRoot\docker-compose.yml" down
}

if ($All -or $Performance) {
    $testResults["Performance"] = Run-Tests -TestCategory "Performance" -DisplayName "Performance Tests"
}

if ($All -or $Security) {
    Write-Host "`n=== Running Security Scan ===" -ForegroundColor Yellow
    & "$projectRoot\scripts\security-scan.ps1"
    $testResults["Security"] = $true
}

# Generate coverage report if requested
if ($Coverage) {
    Write-Host "`n=== Generating Coverage Report ===" -ForegroundColor Yellow

    dotnet tool install -g dotnet-reportgenerator-globaltool 2>$null

    $coverageFiles = Get-ChildItem -Path "$projectRoot" -Recurse -Filter "coverage.cobertura.xml"
    if ($coverageFiles) {
        $coveragePaths = ($coverageFiles | ForEach-Object { $_.FullName }) -join ";"
        reportgenerator `
            -reports:$coveragePaths `
            -targetdir:"$projectRoot\coverage-report" `
            -reporttypes:"Html;TextSummary"

        Write-Host "✓ Coverage report generated at: $projectRoot\coverage-report\index.html" -ForegroundColor Green

        # Display summary
        $summaryFile = "$projectRoot\coverage-report\Summary.txt"
        if (Test-Path $summaryFile) {
            Write-Host "`n=== Coverage Summary ===" -ForegroundColor Cyan
            Get-Content $summaryFile
        }

        # Open report in browser
        Start-Process "$projectRoot\coverage-report\index.html"
    } else {
        Write-Host "✗ No coverage data found" -ForegroundColor Red
    }
}

# Display summary
Write-Host "`n=== Test Summary ===" -ForegroundColor Cyan
$totalTests = $testResults.Count
$passedTests = ($testResults.Values | Where-Object { $_ -eq $true }).Count

foreach ($category in $testResults.Keys) {
    $status = if ($testResults[$category]) { "PASS" } else { "FAIL" }
    $color = if ($testResults[$category]) { "Green" } else { "Red" }
    Write-Host "$category : $status" -ForegroundColor $color
}

Write-Host "`nTotal: $passedTests/$totalTests passed" -ForegroundColor $(if ($passedTests -eq $totalTests) { "Green" } else { "Yellow" })
Write-Host "Completed at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White

# Exit with appropriate code
exit $(if ($passedTests -eq $totalTests) { 0 } else { 1 })
```

**Usage**:

```powershell
# Run all tests
.\scripts\run-all-tests.ps1 -All

# Run unit tests only
.\scripts\run-all-tests.ps1 -Unit

# Run with coverage
.\scripts\run-all-tests.ps1 -Unit -Coverage

# Run integration tests
.\scripts\run-all-tests.ps1 -Integration

# Run performance tests
.\scripts\run-all-tests.ps1 -Performance
```

---

## Coverage Targets

### Coverage Goals

| Component | Line Coverage | Branch Coverage | Priority |
|-----------|--------------|-----------------|----------|
| IDocuWorksProcessor (Mock) | 100% | 100% | Critical |
| S3Service | 85%+ | 80%+ | High |
| SqsService | 85%+ | 80%+ | High |
| Worker Service | 80%+ | 75%+ | High |
| Error Handlers | 90%+ | 85%+ | High |
| Validators | 95%+ | 90%+ | Critical |
| Utilities | 75%+ | 70%+ | Medium |

### Coverage Configuration

**File**: `C:\DocuWorksConverter\coverlet.runsettings`

```xml
<?xml version="1.0" encoding="utf-8" ?>
<RunSettings>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="XPlat code coverage">
        <Configuration>
          <Format>cobertura,opencover</Format>
          <Exclude>[*]*.Tests.*,[*]*.Generated.*</Exclude>
          <ExcludeByAttribute>Obsolete,GeneratedCodeAttribute,CompilerGeneratedAttribute</ExcludeByAttribute>
          <IncludeDirectory>../DocuWorksConverter/</IncludeDirectory>
          <SingleHit>false</SingleHit>
          <UseSourceLink>true</UseSourceLink>
          <IncludeTestAssembly>false</IncludeTestAssembly>
        </Configuration>
      </DataCollector>
    </DataCollectors>
  </DataCollectionRunSettings>
</RunSettings>
```

---

## Day 2 Execution Plan

### Morning Session (9:00 AM - 12:00 PM)

#### 1. Environment Setup (9:00 - 9:30)
```powershell
# Clone and setup test project
cd C:\DocuWorksConverter
git pull origin main

# Install dependencies
dotnet restore
dotnet build

# Start LocalStack
docker-compose up -d

# Verify LocalStack
awslocal s3 ls
awslocal sqs list-queues
```

#### 2. Unit Tests (9:30 - 11:00)
```powershell
# Run unit tests with coverage
.\scripts\run-all-tests.ps1 -Unit -Coverage

# Review coverage report
# Target: 80%+ coverage
# Fix any failing tests
```

#### 3. Integration Tests (11:00 - 12:00)
```powershell
# Run integration tests
.\scripts\run-all-tests.ps1 -Integration

# Verify AWS service integration
# Test message flow: SQS → Download → Convert → Upload
```

### Afternoon Session (1:00 PM - 5:00 PM)

#### 4. Performance Testing (1:00 - 2:00)
```powershell
# Run performance benchmarks
cd DocuWorksConverter.Tests
dotnet run -c Release --project Performance/ConversionBenchmarks.cs

# Record baseline metrics:
# - Single file conversion time
# - Memory usage
# - Throughput (files/minute)
```

**Expected Baseline (Mock Implementation)**:
- Single file: < 5 seconds
- Memory: < 100 MB
- Throughput: > 10 files/minute

#### 5. Security Testing (2:00 - 3:00)
```powershell
# Run security scan
.\scripts\security-scan.ps1

# Manual security checks:
# - No hardcoded credentials
# - Input validation active
# - AWS IAM permissions minimal
# - Logging sanitized (no PII)
```

#### 6. Windows Service Testing (3:00 - 4:00)
```powershell
# Install service (Admin PowerShell required)
sc.exe create DocuWorksConverter binPath="C:\DocuWorksConverter\bin\Release\net7.0\DocuWorksConverter.exe"

# Test service lifecycle
sc.exe start DocuWorksConverter
sc.exe query DocuWorksConverter
sc.exe stop DocuWorksConverter

# Check event logs
Get-EventLog -LogName Application -Source "DocuWorksConverter" -Newest 50

# Test service recovery
# Simulate crash and verify auto-restart
```

#### 7. End-to-End Smoke Test (4:00 - 5:00)
```powershell
# Full workflow test:

# 1. Place test XDW in source folder
cp test-files\sample.xdw C:\DocuWorksSource\

# 2. Verify file detected and uploaded to S3
awslocal s3 ls s3://docuworks-test-bucket/source/

# 3. Verify SQS message sent
awslocal sqs receive-message --queue-url <queue-url>

# 4. Wait for processing (monitor logs)
Get-EventLog -LogName Application -Source "DocuWorksConverter" -After (Get-Date).AddMinutes(-5)

# 5. Verify PDF created and uploaded
awslocal s3 ls s3://docuworks-test-bucket/converted/

# 6. Download and verify PDF
awslocal s3 cp s3://docuworks-test-bucket/converted/sample.pdf C:\Temp\
# Open PDF and verify it's valid
```

---

## Test Reporting

### Daily Test Report Template

**File**: `C:\DocuWorksConverter\test-reports\day2-test-report.md`

```markdown
# DocuWorks Converter - Day 2 Test Report

**Date**: 2025-01-28
**Tester**: [Your Name]
**Environment**: Windows Server 2022, .NET 7, LocalStack

## Summary

| Category | Tests Run | Passed | Failed | Coverage |
|----------|-----------|--------|--------|----------|
| Unit Tests | 0 | 0 | 0 | 0% |
| Integration Tests | 0 | 0 | 0 | N/A |
| Performance Tests | 0 | 0 | 0 | N/A |
| Security Tests | 0 | 0 | 0 | N/A |
| **Total** | **0** | **0** | **0** | **0%** |

## Test Results

### Unit Tests
- [x] IDocuWorksProcessor tests: PASS/FAIL
- [x] S3Service tests: PASS/FAIL
- [x] SqsService tests: PASS/FAIL
- [x] Worker Service tests: PASS/FAIL

### Integration Tests
- [x] End-to-end workflow: PASS/FAIL
- [x] AWS S3 integration: PASS/FAIL
- [x] AWS SQS integration: PASS/FAIL
- [x] Large file handling: PASS/FAIL

### Performance Benchmarks
- Single file conversion: X.XX seconds
- Memory usage: XX MB
- Throughput: XX files/minute
- CPU usage: XX%

### Security Scan
- [x] No hardcoded credentials
- [x] Input validation active
- [x] AWS IAM properly configured
- [x] Logging sanitized

## Issues Found

### Critical
1. [Issue description]
   - **Impact**: [severity]
   - **Fix**: [proposed solution]

### High
1. [Issue description]

### Medium
1. [Issue description]

### Low
1. [Issue description]

## Day 3 Readiness

### ✅ Ready for Production
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Performance meets requirements
- [ ] No critical security issues
- [ ] Windows Service stable
- [ ] Monitoring and logging working
- [ ] Error handling verified

### 🔧 Remaining Tasks
1. [Task 1]
2. [Task 2]

## Recommendations

1. [Recommendation 1]
2. [Recommendation 2]

## Sign-off

**Tested by**: _______________
**Date**: _______________
**Approved for Day 3**: YES / NO
```

---

## Quick Reference Commands

### Essential Commands for Day 2

```powershell
# === Setup ===
cd C:\DocuWorksConverter
dotnet restore
dotnet build
docker-compose up -d

# === Run All Tests ===
.\scripts\run-all-tests.ps1 -All -Coverage

# === Individual Test Categories ===
.\scripts\run-all-tests.ps1 -Unit
.\scripts\run-all-tests.ps1 -Integration
.\scripts\run-all-tests.ps1 -Performance
.\scripts\run-all-tests.ps1 -Security

# === Coverage Report ===
# Auto-opens in browser after running with -Coverage flag

# === Windows Service ===
sc.exe create DocuWorksConverter binPath="C:\DocuWorksConverter\bin\Release\net7.0\DocuWorksConverter.exe"
sc.exe start DocuWorksConverter
sc.exe query DocuWorksConverter
sc.exe stop DocuWorksConverter
sc.exe delete DocuWorksConverter

# === LocalStack Management ===
docker-compose up -d                    # Start
docker-compose logs -f localstack       # View logs
docker-compose down                      # Stop
docker-compose down -v                   # Stop and remove volumes

# === AWS LocalStack Testing ===
awslocal s3 ls
awslocal s3 cp test.xdw s3://docuworks-test-bucket/source/
awslocal sqs send-message --queue-url <url> --message-body '{"test":"data"}'
awslocal sqs receive-message --queue-url <url>

# === Event Logs ===
Get-EventLog -LogName Application -Source "DocuWorksConverter" -Newest 50
Get-EventLog -LogName Application -After (Get-Date).AddHours(-1) | Where-Object {$_.Source -eq "DocuWorksConverter"}

# === Performance Monitoring ===
Get-Process -Name DocuWorksConverter | Format-Table -Property Id,CPU,WorkingSet,Threads
```

---

## Success Metrics for Day 2

### Must Have (Go/No-Go for Day 3)
- ✅ 80%+ unit test coverage
- ✅ All integration tests passing
- ✅ No critical security vulnerabilities
- ✅ Windows Service starts/stops reliably
- ✅ End-to-end workflow completes successfully
- ✅ Logging captures all critical events

### Should Have
- ✅ 85%+ unit test coverage
- ✅ Performance baselines documented
- ✅ All error scenarios tested
- ✅ Security scan clean
- ✅ Test automation configured

### Nice to Have
- ✅ 90%+ unit test coverage
- ✅ Load testing completed
- ✅ Monitoring dashboard configured
- ✅ Documentation updated

---

## Troubleshooting Guide

### LocalStack Not Starting
```powershell
# Check Docker status
docker ps

# View LocalStack logs
docker-compose logs localstack

# Reset LocalStack
docker-compose down -v
docker-compose up -d
```

### Tests Failing
```powershell
# Run with verbose logging
dotnet test --logger "console;verbosity=detailed"

# Run single test
dotnet test --filter "FullyQualifiedName=DocuWorksConverter.Tests.Services.MockDocuWorksProcessorTests.ConvertToPdf_WithValidXdwFile_ShouldReturnPdfPath"

# Check test output folder
ls TestResults\
```

### Windows Service Issues
```powershell
# Check service status
sc.exe query DocuWorksConverter

# View service config
sc.exe qc DocuWorksConverter

# Check event logs
Get-EventLog -LogName Application -Source "DocuWorksConverter" -Newest 10

# Grant permissions (if needed)
icacls "C:\DocuWorksConverter" /grant "NT AUTHORITY\LOCAL SERVICE:(OI)(CI)F"
```

---

## Next Steps (Day 3)

1. **Replace mock implementation** with real DocuWorks API
2. **Re-run all tests** with production implementation
3. **Performance comparison**: Mock vs Real
4. **Deploy to production** Windows Server
5. **Monitor first production conversions**
6. **Adjust based on real-world performance**

---

## Additional Resources

- **LocalStack Docs**: https://docs.localstack.cloud/
- **xUnit Docs**: https://xunit.net/
- **FluentAssertions**: https://fluentassertions.com/
- **BenchmarkDotNet**: https://benchmarkdotnet.org/
- **AWS SDK .NET**: https://docs.aws.amazon.com/sdk-for-net/

---

**Document Version**: 1.0
**Last Updated**: 2025-01-28
**Owner**: Development Team
