using Xunit;
using FluentAssertions;
using Moq;
using Amazon.SQS;
using Amazon.SQS.Model;
using Microsoft.Extensions.Logging;
using DocuWorksConverter.Services;
using DocuWorksConverter.Models;
using System.Text.Json;
using System.Net;

namespace DocuWorksConverter.Tests.Services
{
    /// <summary>
    /// Unit tests for SqsService
    /// Tests AWS SQS integration with mock AWS SDK
    /// Coverage Target: 85%+
    /// </summary>
    public class SqsServiceTests
    {
        private readonly Mock<IAmazonSQS> _mockSqsClient;
        private readonly Mock<ILogger<SqsService>> _mockLogger;
        private readonly SqsService _service;

        private const string TestQueueUrl = "https://sqs.us-east-1.amazonaws.com/123456789/docuworks-test-queue";

        public SqsServiceTests()
        {
            _mockSqsClient = new Mock<IAmazonSQS>();
            _mockLogger = new Mock<ILogger<SqsService>>();
            _service = new SqsService(_mockSqsClient.Object, _mockLogger.Object, TestQueueUrl);
        }

        #region Receive Message Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ReceiveMessagesAsync_WithAvailableMessages_ShouldReturnMessages()
        {
            // Arrange
            var testMessages = new List<Message>
            {
                new Message
                {
                    MessageId = "msg-123",
                    ReceiptHandle = "receipt-123",
                    Body = CreateMessageBody("source/test1.xdw", "test1.xdw")
                },
                new Message
                {
                    MessageId = "msg-456",
                    ReceiptHandle = "receipt-456",
                    Body = CreateMessageBody("source/test2.xdw", "test2.xdw")
                }
            };

            _mockSqsClient
                .Setup(x => x.ReceiveMessageAsync(It.IsAny<ReceiveMessageRequest>(), default))
                .ReturnsAsync(new ReceiveMessageResponse
                {
                    Messages = testMessages,
                    HttpStatusCode = HttpStatusCode.OK
                });

            // Act
            var results = await _service.ReceiveMessagesAsync(maxMessages: 2);

            // Assert
            results.Should().HaveCount(2, "Should return requested number of messages");
            results[0].MessageId.Should().Be("msg-123");
            results[0].ReceiptHandle.Should().Be("receipt-123");
            results[1].MessageId.Should().Be("msg-456");

            _mockSqsClient.Verify(
                x => x.ReceiveMessageAsync(
                    It.Is<ReceiveMessageRequest>(req =>
                        req.QueueUrl == TestQueueUrl &&
                        req.MaxNumberOfMessages == 2 &&
                        req.WaitTimeSeconds > 0), // Long polling
                    default),
                Times.Once);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ReceiveMessagesAsync_WithNoMessages_ShouldReturnEmptyList()
        {
            // Arrange
            _mockSqsClient
                .Setup(x => x.ReceiveMessageAsync(It.IsAny<ReceiveMessageRequest>(), default))
                .ReturnsAsync(new ReceiveMessageResponse
                {
                    Messages = new List<Message>(),
                    HttpStatusCode = HttpStatusCode.OK
                });

            // Act
            var results = await _service.ReceiveMessagesAsync(maxMessages: 10);

            // Assert
            results.Should().BeEmpty("Should return empty list when no messages available");
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ReceiveMessagesAsync_WithDefaultMaxMessages_ShouldUse10()
        {
            // Arrange
            _mockSqsClient
                .Setup(x => x.ReceiveMessageAsync(It.IsAny<ReceiveMessageRequest>(), default))
                .ReturnsAsync(new ReceiveMessageResponse
                {
                    Messages = new List<Message>(),
                    HttpStatusCode = HttpStatusCode.OK
                });

            // Act
            await _service.ReceiveMessagesAsync();

            // Assert
            _mockSqsClient.Verify(
                x => x.ReceiveMessageAsync(
                    It.Is<ReceiveMessageRequest>(req => req.MaxNumberOfMessages == 10),
                    default),
                Times.Once,
                "Default max messages should be 10");
        }

        [Theory]
        [Trait("Category", "Unit")]
        [InlineData(1)]
        [InlineData(5)]
        [InlineData(10)]
        public async Task ReceiveMessagesAsync_WithVariousMaxMessages_ShouldUseCorrectValue(int maxMessages)
        {
            // Arrange
            _mockSqsClient
                .Setup(x => x.ReceiveMessageAsync(It.IsAny<ReceiveMessageRequest>(), default))
                .ReturnsAsync(new ReceiveMessageResponse
                {
                    Messages = new List<Message>(),
                    HttpStatusCode = HttpStatusCode.OK
                });

            // Act
            await _service.ReceiveMessagesAsync(maxMessages);

            // Assert
            _mockSqsClient.Verify(
                x => x.ReceiveMessageAsync(
                    It.Is<ReceiveMessageRequest>(req => req.MaxNumberOfMessages == maxMessages),
                    default),
                Times.Once);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ReceiveMessagesAsync_ShouldUseLongPolling()
        {
            // Arrange
            _mockSqsClient
                .Setup(x => x.ReceiveMessageAsync(It.IsAny<ReceiveMessageRequest>(), default))
                .ReturnsAsync(new ReceiveMessageResponse
                {
                    Messages = new List<Message>(),
                    HttpStatusCode = HttpStatusCode.OK
                });

            // Act
            await _service.ReceiveMessagesAsync();

            // Assert
            _mockSqsClient.Verify(
                x => x.ReceiveMessageAsync(
                    It.Is<ReceiveMessageRequest>(req => req.WaitTimeSeconds == 20),
                    default),
                Times.Once,
                "Should use long polling (20 seconds) to reduce costs");
        }

        #endregion

        #region Delete Message Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DeleteMessageAsync_WithValidReceiptHandle_ShouldSucceed()
        {
            // Arrange
            var receiptHandle = "valid-receipt-handle-123";

            _mockSqsClient
                .Setup(x => x.DeleteMessageAsync(It.IsAny<DeleteMessageRequest>(), default))
                .ReturnsAsync(new DeleteMessageResponse
                {
                    HttpStatusCode = HttpStatusCode.OK
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
        [Trait("Category", "Unit")]
        public async Task DeleteMessageAsync_WithInvalidReceiptHandle_ShouldThrowException()
        {
            // Arrange
            var invalidHandle = "invalid-handle";

            _mockSqsClient
                .Setup(x => x.DeleteMessageAsync(It.IsAny<DeleteMessageRequest>(), default))
                .ThrowsAsync(new ReceiptHandleIsInvalidException("Invalid receipt handle"));

            // Act & Assert
            await Assert.ThrowsAsync<ReceiptHandleIsInvalidException>(
                async () => await _service.DeleteMessageAsync(invalidHandle)
            );
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DeleteMessageAsync_WithNullReceiptHandle_ShouldThrowArgumentNullException()
        {
            // Act & Assert
            await Assert.ThrowsAsync<ArgumentNullException>(
                async () => await _service.DeleteMessageAsync(null!)
            );
        }

        #endregion

        #region Batch Delete Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DeleteMessageBatchAsync_WithMultipleHandles_ShouldSucceed()
        {
            // Arrange
            var receiptHandles = new List<string>
            {
                "handle-1",
                "handle-2",
                "handle-3"
            };

            _mockSqsClient
                .Setup(x => x.DeleteMessageBatchAsync(It.IsAny<DeleteMessageBatchRequest>(), default))
                .ReturnsAsync(new DeleteMessageBatchResponse
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    Successful = receiptHandles.Select((h, i) => new DeleteMessageBatchResultEntry
                    {
                        Id = i.ToString()
                    }).ToList()
                });

            // Act
            await _service.DeleteMessageBatchAsync(receiptHandles);

            // Assert
            _mockSqsClient.Verify(
                x => x.DeleteMessageBatchAsync(
                    It.Is<DeleteMessageBatchRequest>(req =>
                        req.QueueUrl == TestQueueUrl &&
                        req.Entries.Count == 3),
                    default),
                Times.Once);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DeleteMessageBatchAsync_WithMoreThan10Messages_ShouldBatchInGroups()
        {
            // Arrange
            var receiptHandles = Enumerable.Range(1, 25).Select(i => $"handle-{i}").ToList();

            _mockSqsClient
                .Setup(x => x.DeleteMessageBatchAsync(It.IsAny<DeleteMessageBatchRequest>(), default))
                .ReturnsAsync(new DeleteMessageBatchResponse
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    Successful = new List<DeleteMessageBatchResultEntry>()
                });

            // Act
            await _service.DeleteMessageBatchAsync(receiptHandles);

            // Assert
            _mockSqsClient.Verify(
                x => x.DeleteMessageBatchAsync(It.IsAny<DeleteMessageBatchRequest>(), default),
                Times.Exactly(3),
                "Should call DeleteMessageBatch 3 times (10 + 10 + 5)");
        }

        #endregion

        #region Parse Message Body Tests

        [Fact]
        [Trait("Category", "Unit")]
        public void ParseMessageBody_WithValidJson_ShouldReturnConversionJob()
        {
            // Arrange
            var messageBody = CreateMessageBody("source/document.xdw", "document.xdw");

            // Act
            var job = _service.ParseMessageBody(messageBody);

            // Assert
            job.Should().NotBeNull();
            job.S3Key.Should().Be("source/document.xdw");
            job.FileName.Should().Be("document.xdw");
            job.Timestamp.Should().NotBeNullOrEmpty();
        }

        [Fact]
        [Trait("Category", "Unit")]
        public void ParseMessageBody_WithMetadata_ShouldIncludeMetadata()
        {
            // Arrange
            var messageBody = @"{
                ""s3Key"": ""source/test.xdw"",
                ""fileName"": ""test.xdw"",
                ""timestamp"": ""2025-01-28T10:00:00Z"",
                ""metadata"": {
                    ""userId"": ""user123"",
                    ""priority"": ""high"",
                    ""department"": ""sales""
                }
            }";

            // Act
            var job = _service.ParseMessageBody(messageBody);

            // Assert
            job.Metadata.Should().NotBeNull();
            job.Metadata.Should().HaveCount(3);
            job.Metadata["userId"].Should().Be("user123");
            job.Metadata["priority"].Should().Be("high");
            job.Metadata["department"].Should().Be("sales");
        }

        [Fact]
        [Trait("Category", "Unit")]
        public void ParseMessageBody_WithInvalidJson_ShouldThrowJsonException()
        {
            // Arrange
            var invalidJson = "{ invalid json }";

            // Act & Assert
            Assert.Throws<JsonException>(
                () => _service.ParseMessageBody(invalidJson)
            );
        }

        [Fact]
        [Trait("Category", "Unit")]
        public void ParseMessageBody_WithMissingRequiredFields_ShouldThrowException()
        {
            // Arrange
            var incompleteJson = @"{
                ""s3Key"": ""source/test.xdw""
            }";

            // Act & Assert
            var exception = Assert.Throws<ArgumentException>(
                () => _service.ParseMessageBody(incompleteJson)
            );

            exception.Message.Should().Contain("fileName", "Should indicate missing required field");
        }

        [Theory]
        [Trait("Category", "Unit")]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        public void ParseMessageBody_WithNullOrEmptyBody_ShouldThrowArgumentException(string? invalidBody)
        {
            // Act & Assert
            Assert.Throws<ArgumentException>(
                () => _service.ParseMessageBody(invalidBody!)
            );
        }

        #endregion

        #region Send Message Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task SendMessageAsync_WithValidJob_ShouldSucceed()
        {
            // Arrange
            var job = new ConversionJob
            {
                S3Key = "source/test.xdw",
                FileName = "test.xdw",
                Timestamp = DateTime.UtcNow.ToString("o"),
                Metadata = new Dictionary<string, string>
                {
                    { "userId", "user123" }
                }
            };

            _mockSqsClient
                .Setup(x => x.SendMessageAsync(It.IsAny<SendMessageRequest>(), default))
                .ReturnsAsync(new SendMessageResponse
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    MessageId = "sent-msg-123"
                });

            // Act
            var messageId = await _service.SendMessageAsync(job);

            // Assert
            messageId.Should().Be("sent-msg-123");

            _mockSqsClient.Verify(
                x => x.SendMessageAsync(
                    It.Is<SendMessageRequest>(req =>
                        req.QueueUrl == TestQueueUrl &&
                        req.MessageBody.Contains("source/test.xdw") &&
                        req.MessageBody.Contains("test.xdw")),
                    default),
                Times.Once);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task SendMessageAsync_WithDelaySeconds_ShouldSetDelay()
        {
            // Arrange
            var job = new ConversionJob
            {
                S3Key = "source/test.xdw",
                FileName = "test.xdw",
                Timestamp = DateTime.UtcNow.ToString("o")
            };

            var delaySeconds = 30;

            _mockSqsClient
                .Setup(x => x.SendMessageAsync(It.IsAny<SendMessageRequest>(), default))
                .ReturnsAsync(new SendMessageResponse
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    MessageId = "delayed-msg-123"
                });

            // Act
            await _service.SendMessageAsync(job, delaySeconds);

            // Assert
            _mockSqsClient.Verify(
                x => x.SendMessageAsync(
                    It.Is<SendMessageRequest>(req => req.DelaySeconds == delaySeconds),
                    default),
                Times.Once);
        }

        #endregion

        #region Visibility Timeout Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ChangeMessageVisibilityAsync_WithValidParameters_ShouldSucceed()
        {
            // Arrange
            var receiptHandle = "valid-handle";
            var visibilityTimeout = 60;

            _mockSqsClient
                .Setup(x => x.ChangeMessageVisibilityAsync(It.IsAny<ChangeMessageVisibilityRequest>(), default))
                .ReturnsAsync(new ChangeMessageVisibilityResponse
                {
                    HttpStatusCode = HttpStatusCode.OK
                });

            // Act
            await _service.ChangeMessageVisibilityAsync(receiptHandle, visibilityTimeout);

            // Assert
            _mockSqsClient.Verify(
                x => x.ChangeMessageVisibilityAsync(
                    It.Is<ChangeMessageVisibilityRequest>(req =>
                        req.QueueUrl == TestQueueUrl &&
                        req.ReceiptHandle == receiptHandle &&
                        req.VisibilityTimeout == visibilityTimeout),
                    default),
                Times.Once);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ChangeMessageVisibilityAsync_ToExtendProcessingTime_ShouldSucceed()
        {
            // Arrange
            var receiptHandle = "processing-handle";
            var extendedTimeout = 300; // 5 minutes

            _mockSqsClient
                .Setup(x => x.ChangeMessageVisibilityAsync(It.IsAny<ChangeMessageVisibilityRequest>(), default))
                .ReturnsAsync(new ChangeMessageVisibilityResponse { HttpStatusCode = HttpStatusCode.OK });

            // Act
            await _service.ChangeMessageVisibilityAsync(receiptHandle, extendedTimeout);

            // Assert - Verify we can extend processing time if needed
            _mockSqsClient.Verify(
                x => x.ChangeMessageVisibilityAsync(
                    It.Is<ChangeMessageVisibilityRequest>(req => req.VisibilityTimeout == extendedTimeout),
                    default),
                Times.Once);
        }

        #endregion

        #region Get Queue Attributes Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task GetQueueAttributesAsync_ShouldReturnAttributes()
        {
            // Arrange
            var attributes = new Dictionary<string, string>
            {
                { "ApproximateNumberOfMessages", "42" },
                { "ApproximateNumberOfMessagesNotVisible", "5" },
                { "ApproximateNumberOfMessagesDelayed", "0" }
            };

            _mockSqsClient
                .Setup(x => x.GetQueueAttributesAsync(It.IsAny<GetQueueAttributesRequest>(), default))
                .ReturnsAsync(new GetQueueAttributesResponse
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    Attributes = attributes
                });

            // Act
            var result = await _service.GetQueueAttributesAsync();

            // Assert
            result.Should().HaveCount(3);
            result["ApproximateNumberOfMessages"].Should().Be("42");
            result["ApproximateNumberOfMessagesNotVisible"].Should().Be("5");
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task GetApproximateMessageCountAsync_ShouldReturnCount()
        {
            // Arrange
            _mockSqsClient
                .Setup(x => x.GetQueueAttributesAsync(It.IsAny<GetQueueAttributesRequest>(), default))
                .ReturnsAsync(new GetQueueAttributesResponse
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    Attributes = new Dictionary<string, string>
                    {
                        { "ApproximateNumberOfMessages", "15" }
                    }
                });

            // Act
            var count = await _service.GetApproximateMessageCountAsync();

            // Assert
            count.Should().Be(15);
        }

        #endregion

        #region Error Handling Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ReceiveMessagesAsync_WhenSqsUnavailable_ShouldThrowException()
        {
            // Arrange
            _mockSqsClient
                .Setup(x => x.ReceiveMessageAsync(It.IsAny<ReceiveMessageRequest>(), default))
                .ThrowsAsync(new AmazonSQSException("Service unavailable"));

            // Act & Assert
            await Assert.ThrowsAsync<AmazonSQSException>(
                async () => await _service.ReceiveMessagesAsync()
            );
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DeleteMessageAsync_WhenMessageAlreadyDeleted_ShouldNotThrow()
        {
            // Arrange
            var receiptHandle = "already-deleted-handle";

            _mockSqsClient
                .Setup(x => x.DeleteMessageAsync(It.IsAny<DeleteMessageRequest>(), default))
                .ReturnsAsync(new DeleteMessageResponse
                {
                    HttpStatusCode = HttpStatusCode.OK
                });

            // Act & Assert
            var exception = await Record.ExceptionAsync(
                async () => await _service.DeleteMessageAsync(receiptHandle)
            );

            exception.Should().BeNull("Delete is idempotent - should not throw");
        }

        #endregion

        #region Helper Methods

        private string CreateMessageBody(string s3Key, string fileName)
        {
            var job = new
            {
                s3Key,
                fileName,
                timestamp = DateTime.UtcNow.ToString("o"),
                metadata = new Dictionary<string, string>()
            };

            return JsonSerializer.Serialize(job);
        }

        #endregion
    }

    /// <summary>
    /// Model class for conversion job (should match your actual implementation)
    /// </summary>
    public class ConversionJob
    {
        public string S3Key { get; set; } = string.Empty;
        public string FileName { get; set; } = string.Empty;
        public string Timestamp { get; set; } = string.Empty;
        public Dictionary<string, string> Metadata { get; set; } = new();
    }
}
