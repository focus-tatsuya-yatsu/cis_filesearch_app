using Xunit;
using FluentAssertions;
using Amazon.S3;
using Amazon.SQS;
using Amazon.S3.Model;
using Amazon.SQS.Model;
using Amazon.Runtime;
using Microsoft.Extensions.Logging;
using DocuWorksConverter.Services;
using DocuWorksConverter.Interfaces;
using System.Text.Json;
using System.Net;

namespace DocuWorksConverter.Tests.Integration
{
    /// <summary>
    /// Integration tests for AWS services using LocalStack
    /// These tests verify the actual AWS SDK integration with local AWS simulation
    ///
    /// Prerequisites:
    /// 1. LocalStack running on localhost:4566
    /// 2. AWS CLI configured with test credentials
    ///
    /// Run LocalStack:
    /// docker-compose up -d
    ///
    /// Coverage Target: 100% of AWS integration scenarios
    /// </summary>
    [Collection("AWS Integration")]
    [Trait("Category", "Integration")]
    public class AwsIntegrationTests : IAsyncLifetime
    {
        private IAmazonS3 _s3Client = null!;
        private IAmazonSQS _sqsClient = null!;
        private S3Service _s3Service = null!;
        private SqsService _sqsService = null!;
        private IDocuWorksProcessor _processor = null!;

        private const string LocalStackEndpoint = "http://localhost:4566";
        private const string TestBucket = "docuworks-integration-test-bucket";
        private const string TestQueueName = "docuworks-integration-test-queue";
        private string _testQueueUrl = string.Empty;

        private readonly List<string> _testFilesToCleanup = new();

        public async Task InitializeAsync()
        {
            // Configure AWS clients for LocalStack
            var s3Config = new AmazonS3Config
            {
                ServiceURL = LocalStackEndpoint,
                ForcePathStyle = true,
                UseHttp = true
            };

            var sqsConfig = new AmazonSQSConfig
            {
                ServiceURL = LocalStackEndpoint,
                UseHttp = true
            };

            var credentials = new BasicAWSCredentials("test", "test");

            _s3Client = new AmazonS3Client(credentials, s3Config);
            _sqsClient = new AmazonSQSClient(credentials, sqsConfig);

            // Setup test S3 bucket
            try
            {
                await _s3Client.PutBucketAsync(new PutBucketRequest
                {
                    BucketName = TestBucket,
                    UseClientRegion = true
                });
            }
            catch (AmazonS3Exception ex) when (ex.ErrorCode == "BucketAlreadyOwnedByYou")
            {
                // Bucket already exists, that's fine
            }

            // Setup test SQS queue
            var queueResponse = await _sqsClient.CreateQueueAsync(new CreateQueueRequest
            {
                QueueName = TestQueueName
            });
            _testQueueUrl = queueResponse.QueueUrl;

            // Initialize services
            var s3Logger = new LoggerFactory().CreateLogger<S3Service>();
            var sqsLogger = new LoggerFactory().CreateLogger<SqsService>();
            var processorLogger = new LoggerFactory().CreateLogger<MockDocuWorksProcessor>();

            _s3Service = new S3Service(_s3Client, s3Logger, TestBucket);
            _sqsService = new SqsService(_sqsClient, sqsLogger, _testQueueUrl);
            _processor = new MockDocuWorksProcessor(processorLogger);
        }

        public async Task DisposeAsync()
        {
            // Cleanup local test files
            foreach (var file in _testFilesToCleanup)
            {
                if (File.Exists(file))
                {
                    try { File.Delete(file); } catch { }
                }
            }

            // Cleanup S3 bucket
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
            }
            catch { }

            // Cleanup SQS queue
            try
            {
                await _sqsClient.DeleteQueueAsync(_testQueueUrl);
            }
            catch { }

            _s3Client?.Dispose();
            _sqsClient?.Dispose();
        }

        #region End-to-End Conversion Workflow

        [Fact]
        public async Task EndToEnd_CompleteConversionWorkflow_ShouldSucceed()
        {
            // ========================================
            // STEP 1: Create test XDW file
            // ========================================
            var testXdwPath = CreateTestFile("e2e-test.xdw", new byte[] { 0x58, 0x44, 0x57, 0x46 });

            // ========================================
            // STEP 2: Upload XDW to S3 (source folder)
            // ========================================
            var s3Key = await _s3Service.UploadFileAsync(testXdwPath, "source/", new Dictionary<string, string>
            {
                { "original-filename", "e2e-test.xdw" },
                { "upload-timestamp", DateTime.UtcNow.ToString("o") }
            });

            s3Key.Should().NotBeNullOrEmpty("S3 upload should return key");
            s3Key.Should().Contain("source/");

            // ========================================
            // STEP 3: Send conversion message to SQS
            // ========================================
            var conversionJob = new
            {
                s3Key = s3Key.Split('/').Last(),
                fileName = "e2e-test.xdw",
                timestamp = DateTime.UtcNow.ToString("o"),
                metadata = new Dictionary<string, string>
                {
                    { "userId", "integration-test-user" },
                    { "priority", "high" }
                }
            };

            var sendResponse = await _sqsClient.SendMessageAsync(new SendMessageRequest
            {
                QueueUrl = _testQueueUrl,
                MessageBody = JsonSerializer.Serialize(conversionJob)
            });

            sendResponse.HttpStatusCode.Should().Be(HttpStatusCode.OK);
            sendResponse.MessageId.Should().NotBeNullOrEmpty();

            // ========================================
            // STEP 4: Receive message from SQS
            // ========================================
            var messages = await _sqsService.ReceiveMessagesAsync(1);
            messages.Should().HaveCount(1, "Should receive the message we just sent");

            var receivedMessage = messages[0];
            receivedMessage.Body.Should().Contain("e2e-test.xdw");

            // ========================================
            // STEP 5: Parse message body
            // ========================================
            var job = _sqsService.ParseMessageBody(receivedMessage.Body);
            job.Should().NotBeNull();
            job.FileName.Should().Be("e2e-test.xdw");
            job.Metadata.Should().ContainKey("userId");
            job.Metadata["userId"].Should().Be("integration-test-user");

            // ========================================
            // STEP 6: Download XDW from S3
            // ========================================
            var downloadPath = CreateTempFilePath("downloaded-e2e-test.xdw");
            await _s3Service.DownloadFileAsync("source/" + job.FileName, downloadPath);

            File.Exists(downloadPath).Should().BeTrue("Downloaded file should exist");
            var downloadedContent = await File.ReadAllBytesAsync(downloadPath);
            downloadedContent.Should().NotBeEmpty();

            // ========================================
            // STEP 7: Convert XDW to PDF (mock)
            // ========================================
            var pdfPath = await _processor.ConvertToPdfAsync(downloadPath);
            File.Exists(pdfPath).Should().BeTrue("Converted PDF should exist");
            Path.GetExtension(pdfPath).Should().Be(".pdf");

            // ========================================
            // STEP 8: Upload PDF back to S3 (converted folder)
            // ========================================
            var pdfFileName = Path.GetFileName(pdfPath);
            var pdfS3Key = await _s3Service.UploadFileAsync(pdfPath, "converted/", new Dictionary<string, string>
            {
                { "original-xdw-filename", job.FileName },
                { "conversion-timestamp", DateTime.UtcNow.ToString("o") },
                { "converter-version", "1.0.0-mock" }
            });

            pdfS3Key.Should().NotBeNullOrEmpty();
            pdfS3Key.Should().Contain("converted/");

            // ========================================
            // STEP 9: Verify PDF metadata in S3
            // ========================================
            var pdfMetadata = await _s3Service.GetFileMetadataAsync("converted/" + pdfFileName);
            pdfMetadata.Should().ContainKey("original-xdw-filename");
            pdfMetadata["original-xdw-filename"].Should().Be("e2e-test.xdw");

            // ========================================
            // STEP 10: Delete processed message from SQS
            // ========================================
            await _sqsService.DeleteMessageAsync(receivedMessage.ReceiptHandle);

            // ========================================
            // STEP 11: Verify message was deleted
            // ========================================
            var remainingMessages = await _sqsService.ReceiveMessagesAsync(1);
            remainingMessages.Should().BeEmpty("Message should be deleted from queue");

            // ========================================
            // STEP 12: Cleanup source XDW from S3
            // ========================================
            await _s3Service.DeleteFileAsync("source/" + job.FileName);

            // ========================================
            // STEP 13: Verify complete workflow
            // ========================================
            var allObjects = await _s3Client.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = TestBucket
            });

            allObjects.S3Objects.Should().Contain(obj => obj.Key.StartsWith("converted/"),
                "Converted PDF should remain in S3");
            allObjects.S3Objects.Should().NotContain(obj => obj.Key.StartsWith("source/"),
                "Source XDW should be deleted");
        }

        #endregion

        #region S3 Integration Tests

        [Fact]
        public async Task S3_UploadAndDownload_ShouldPreserveContent()
        {
            // Arrange
            var originalContent = new byte[1024];
            new Random(42).NextBytes(originalContent);
            var testFilePath = CreateTestFile("upload-download-test.xdw", originalContent);

            // Act - Upload
            var s3Key = await _s3Service.UploadFileAsync(testFilePath, "test/");

            // Act - Download
            var downloadPath = CreateTempFilePath("downloaded-test.xdw");
            await _s3Service.DownloadFileAsync(s3Key.Split('/').Last(), downloadPath);

            // Assert
            var downloadedContent = await File.ReadAllBytesAsync(downloadPath);
            downloadedContent.Should().BeEquivalentTo(originalContent,
                "Downloaded content should match original");
        }

        [Fact]
        public async Task S3_LargeFileUpload_ShouldHandleMultipartUpload()
        {
            // Arrange - Create 10MB file
            var largeFilePath = CreateTestFile("large-file.xdw", new byte[10 * 1024 * 1024]);

            // Act
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            var s3Key = await _s3Service.UploadFileAsync(largeFilePath, "large-files/");
            stopwatch.Stop();

            // Assert
            s3Key.Should().NotBeNullOrEmpty();
            stopwatch.ElapsedMilliseconds.Should().BeLessThan(30000,
                "Large file upload should complete within 30 seconds");

            // Verify file exists
            var metadata = await _s3Service.GetFileMetadataAsync(s3Key.Split('/').Last());
            metadata.Should().NotBeNull();
        }

        [Fact]
        public async Task S3_ListFiles_ShouldReturnFilesWithPrefix()
        {
            // Arrange - Upload multiple files
            var file1 = CreateTestFile("list-test-1.xdw", new byte[] { 0x01 });
            var file2 = CreateTestFile("list-test-2.xdw", new byte[] { 0x02 });
            var file3 = CreateTestFile("list-test-3.xdw", new byte[] { 0x03 });

            await _s3Service.UploadFileAsync(file1, "list-test/");
            await _s3Service.UploadFileAsync(file2, "list-test/");
            await _s3Service.UploadFileAsync(file3, "other/");

            // Act
            var files = await _s3Service.ListFilesAsync("list-test/");

            // Assert
            files.Should().HaveCount(2, "Should return only files with matching prefix");
            files.Should().OnlyContain(key => key.StartsWith("list-test/"));
        }

        #endregion

        #region SQS Integration Tests

        [Fact]
        public async Task SQS_SendAndReceive_ShouldWorkCorrectly()
        {
            // Arrange
            var testMessage = new
            {
                s3Key = "source/sqs-test.xdw",
                fileName = "sqs-test.xdw",
                timestamp = DateTime.UtcNow.ToString("o")
            };

            // Act - Send
            var sendResponse = await _sqsClient.SendMessageAsync(new SendMessageRequest
            {
                QueueUrl = _testQueueUrl,
                MessageBody = JsonSerializer.Serialize(testMessage)
            });

            sendResponse.HttpStatusCode.Should().Be(HttpStatusCode.OK);

            // Act - Receive
            var messages = await _sqsService.ReceiveMessagesAsync(1);

            // Assert
            messages.Should().HaveCount(1);
            messages[0].Body.Should().Contain("sqs-test.xdw");

            // Cleanup
            await _sqsService.DeleteMessageAsync(messages[0].ReceiptHandle);
        }

        [Fact]
        public async Task SQS_BatchProcessing_ShouldHandleMultipleMessages()
        {
            // Arrange - Send 10 messages
            var messageCount = 10;
            var sentMessageIds = new List<string>();

            for (int i = 0; i < messageCount; i++)
            {
                var message = new
                {
                    s3Key = $"source/batch-test-{i}.xdw",
                    fileName = $"batch-test-{i}.xdw",
                    timestamp = DateTime.UtcNow.ToString("o")
                };

                var response = await _sqsClient.SendMessageAsync(new SendMessageRequest
                {
                    QueueUrl = _testQueueUrl,
                    MessageBody = JsonSerializer.Serialize(message)
                });

                sentMessageIds.Add(response.MessageId);
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

                if (batch.Count == 0)
                {
                    await Task.Delay(500); // Wait for messages to be available
                }
            }

            // Assert
            receivedMessages.Should().HaveCount(messageCount,
                "Should receive all sent messages");

            // Cleanup - Batch delete
            var receiptHandles = receivedMessages.Select(m => m.ReceiptHandle).ToList();
            await _sqsService.DeleteMessageBatchAsync(receiptHandles);

            // Verify cleanup
            var remaining = await _sqsService.ReceiveMessagesAsync(10);
            remaining.Should().BeEmpty("All messages should be deleted");
        }

        [Fact]
        public async Task SQS_VisibilityTimeout_ShouldPreventDuplicateProcessing()
        {
            // Arrange
            var message = new
            {
                s3Key = "source/visibility-test.xdw",
                fileName = "visibility-test.xdw",
                timestamp = DateTime.UtcNow.ToString("o")
            };

            await _sqsClient.SendMessageAsync(new SendMessageRequest
            {
                QueueUrl = _testQueueUrl,
                MessageBody = JsonSerializer.Serialize(message)
            });

            // Act - First receive
            var firstReceive = await _sqsService.ReceiveMessagesAsync(1);
            firstReceive.Should().HaveCount(1);

            // Act - Second receive immediately (should be empty due to visibility timeout)
            var secondReceive = await _sqsService.ReceiveMessagesAsync(1);
            secondReceive.Should().BeEmpty(
                "Message should be invisible during processing");

            // Cleanup
            await _sqsService.DeleteMessageAsync(firstReceive[0].ReceiptHandle);
        }

        #endregion

        #region Error Handling Tests

        [Fact]
        public async Task S3_DownloadNonExistentFile_ShouldThrowException()
        {
            // Arrange
            var nonExistentKey = "nonexistent/file.xdw";
            var localPath = CreateTempFilePath("should-not-exist.xdw");

            // Act & Assert
            await Assert.ThrowsAsync<AmazonS3Exception>(
                async () => await _s3Service.DownloadFileAsync(nonExistentKey, localPath)
            );
        }

        [Fact]
        public async Task SQS_DeleteInvalidReceiptHandle_ShouldThrowException()
        {
            // Arrange
            var invalidHandle = "invalid-receipt-handle";

            // Act & Assert
            await Assert.ThrowsAsync<ReceiptHandleIsInvalidException>(
                async () => await _sqsService.DeleteMessageAsync(invalidHandle)
            );
        }

        #endregion

        #region Performance Tests

        [Fact]
        public async Task Performance_ConcurrentUploads_ShouldHandleParallelOperations()
        {
            // Arrange
            var fileCount = 5;
            var testFiles = Enumerable.Range(1, fileCount)
                .Select(i => CreateTestFile($"concurrent-{i}.xdw", new byte[] { (byte)i }))
                .ToList();

            // Act
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            var uploadTasks = testFiles.Select(file => _s3Service.UploadFileAsync(file, "concurrent/"));
            var results = await Task.WhenAll(uploadTasks);
            stopwatch.Stop();

            // Assert
            results.Should().HaveCount(fileCount);
            results.Should().OnlyHaveUniqueItems("All uploads should have unique keys");
            stopwatch.ElapsedMilliseconds.Should().BeLessThan(10000,
                "Concurrent uploads should be faster than sequential");
        }

        #endregion

        #region Helper Methods

        private string CreateTestFile(string filename, byte[] content)
        {
            var testPath = Path.Combine(Path.GetTempPath(), $"integration-{Guid.NewGuid()}-{filename}");
            File.WriteAllBytes(testPath, content);
            _testFilesToCleanup.Add(testPath);
            return testPath;
        }

        private string CreateTempFilePath(string filename)
        {
            var path = Path.Combine(Path.GetTempPath(), $"integration-{Guid.NewGuid()}-{filename}");
            _testFilesToCleanup.Add(path);
            return path;
        }

        #endregion
    }

    /// <summary>
    /// Collection definition for AWS integration tests
    /// Ensures tests run sequentially to avoid resource conflicts
    /// </summary>
    [CollectionDefinition("AWS Integration", DisableParallelization = true)]
    public class AwsIntegrationCollection
    {
    }
}
