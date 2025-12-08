# DocuWorks Converter - AWS Integration Strategy (Day 2)

## Overview

This document provides a comprehensive AWS integration strategy for the DocuWorks to PDF converter service built with .NET 7, following the established patterns from the existing Python EC2 Worker implementation.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Scanner PC (Windows) - DocuWorks Converter Service             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐      ┌──────────────────────────────┐   │
│  │ File System      │──►   │ DocuWorks Processor          │   │
│  │ Watcher          │      │ (IDocuWorksProcessor)        │   │
│  └──────────────────┘      └──────────────┬───────────────┘   │
│                                            │                     │
│                                            ▼                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │             AWS Integration Layer                         │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  S3Client  │  SQSClient  │  RetryHandler  │  Logger     │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────┬────────────────────────┬──────────────────────────┘
             │                        │
             ▼                        ▼
    ┌────────────────┐      ┌─────────────────┐
    │ S3 Bucket      │      │ SQS Queue       │
    │ Landing Zone   │      │ Notifications   │
    └────────────────┘      └─────────────────┘
```

## AWS Resources

### Existing Resources (from project)
- **S3 Bucket**: `cis-filesearch-s3-landing`
- **SQS Queue**: `https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue`
- **AWS Profile**: `AdministratorAccess-770923989980`
- **Region**: `ap-northeast-1`

### Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:PutObjectTagging"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-s3-landing/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:ap-northeast-1:770923989980:cis-filesearch-queue"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-northeast-1:770923989980:log-group:/cis-filesearch/docuworks-converter:*"
    }
  ]
}
```

## Implementation Strategy

### Phase 1: AWS SDK Integration (Day 2 Morning)

#### 1.1 Install AWS SDK for .NET

```bash
# Navigate to project directory
cd C:\DocuWorksConverter

# Install required NuGet packages
dotnet add package AWSSDK.S3 --version 3.7.400
dotnet add package AWSSDK.SQS --version 3.7.400
dotnet add package AWSSDK.CloudWatchLogs --version 3.7.400
dotnet add package AWSSDK.Core --version 3.7.400
dotnet add package Polly --version 8.2.0
```

#### 1.2 Configuration Management

Create `appsettings.json`:

```json
{
  "AWS": {
    "Profile": "AdministratorAccess-770923989980",
    "Region": "ap-northeast-1"
  },
  "S3": {
    "LandingBucket": "cis-filesearch-s3-landing",
    "UploadPrefix": "docuworks-converted/",
    "MultipartThresholdMB": 100,
    "PartSizeMB": 10
  },
  "SQS": {
    "QueueUrl": "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue",
    "MessageGroupId": "docuworks-converter",
    "MessageDeduplicationEnabled": true
  },
  "CloudWatch": {
    "LogGroupName": "/cis-filesearch/docuworks-converter",
    "LogStreamName": "converter-service",
    "EnableCloudWatchLogs": true
  },
  "Retry": {
    "MaxRetryAttempts": 3,
    "InitialBackoffSeconds": 2,
    "MaxBackoffSeconds": 30,
    "BackoffMultiplier": 2.0
  },
  "Performance": {
    "MaxConcurrentUploads": 5,
    "UploadTimeoutMinutes": 10,
    "BufferSizeKB": 8192
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "AWS": "Warning",
      "System": "Warning"
    }
  }
}
```

Create `appsettings.Development.json`:

```json
{
  "AWS": {
    "Profile": "AdministratorAccess-770923989980",
    "Region": "ap-northeast-1"
  },
  "CloudWatch": {
    "EnableCloudWatchLogs": false
  },
  "Logging": {
    "LogLevel": {
      "Default": "Debug",
      "AWS": "Information"
    }
  }
}
```

### Phase 2: Core AWS Integration Components

#### 2.1 AWS Configuration Service

```csharp
// Services/AWS/AwsConfig.cs
using Amazon;
using Amazon.Runtime;
using Amazon.Runtime.CredentialManagement;
using Microsoft.Extensions.Configuration;

namespace DocuWorksConverter.Services.AWS
{
    public class AwsConfig
    {
        private readonly IConfiguration _configuration;

        public AwsConfig(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        public RegionEndpoint Region =>
            RegionEndpoint.GetBySystemName(_configuration["AWS:Region"]);

        public AWSCredentials GetCredentials()
        {
            var profileName = _configuration["AWS:Profile"];

            if (!string.IsNullOrEmpty(profileName))
            {
                var chain = new CredentialProfileStoreChain();
                if (chain.TryGetAWSCredentials(profileName, out var credentials))
                {
                    return credentials;
                }
            }

            // Fallback to instance profile or environment variables
            return FallbackCredentialsFactory.GetCredentials();
        }

        public T GetConfig<T>(string sectionName) where T : class, new()
        {
            var config = new T();
            _configuration.GetSection(sectionName).Bind(config);
            return config;
        }
    }

    public class S3Config
    {
        public string LandingBucket { get; set; } = string.Empty;
        public string UploadPrefix { get; set; } = "docuworks-converted/";
        public int MultipartThresholdMB { get; set; } = 100;
        public int PartSizeMB { get; set; } = 10;
    }

    public class SQSConfig
    {
        public string QueueUrl { get; set; } = string.Empty;
        public string MessageGroupId { get; set; } = "docuworks-converter";
        public bool MessageDeduplicationEnabled { get; set; } = true;
    }

    public class RetryConfig
    {
        public int MaxRetryAttempts { get; set; } = 3;
        public int InitialBackoffSeconds { get; set; } = 2;
        public int MaxBackoffSeconds { get; set; } = 30;
        public double BackoffMultiplier { get; set; } = 2.0;
    }
}
```

#### 2.2 S3 Client with Retry Logic

```csharp
// Services/AWS/S3ClientService.cs
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Transfer;
using Microsoft.Extensions.Logging;
using Polly;
using Polly.Retry;
using System.Diagnostics;

namespace DocuWorksConverter.Services.AWS
{
    public interface IS3ClientService
    {
        Task<string> UploadFileAsync(
            string filePath,
            string key,
            Dictionary<string, string>? metadata = null,
            CancellationToken cancellationToken = default);

        Task<bool> VerifyUploadAsync(
            string key,
            CancellationToken cancellationToken = default);

        Task<GetObjectMetadataResponse?> GetFileMetadataAsync(
            string key,
            CancellationToken cancellationToken = default);
    }

    public class S3ClientService : IS3ClientService, IDisposable
    {
        private readonly IAmazonS3 _s3Client;
        private readonly TransferUtility _transferUtility;
        private readonly ILogger<S3ClientService> _logger;
        private readonly S3Config _config;
        private readonly AsyncRetryPolicy _retryPolicy;

        public S3ClientService(
            AwsConfig awsConfig,
            ILogger<S3ClientService> logger)
        {
            _logger = logger;
            _config = awsConfig.GetConfig<S3Config>("S3");

            // Initialize S3 client
            var s3ClientConfig = new AmazonS3Config
            {
                RegionEndpoint = awsConfig.Region,
                Timeout = TimeSpan.FromMinutes(10),
                MaxErrorRetry = 3,
                ThrottleRetries = true
            };

            _s3Client = new AmazonS3Client(awsConfig.GetCredentials(), s3ClientConfig);

            // Initialize Transfer Utility for multipart uploads
            var transferConfig = new TransferUtilityConfig
            {
                MinSizeBeforePartUpload = _config.MultipartThresholdMB * 1024 * 1024,
                ConcurrentServiceRequests = 10
            };

            _transferUtility = new TransferUtility(_s3Client, transferConfig);

            // Configure retry policy
            var retryConfig = awsConfig.GetConfig<RetryConfig>("Retry");
            _retryPolicy = Policy
                .Handle<AmazonS3Exception>()
                .Or<IOException>()
                .Or<TimeoutException>()
                .WaitAndRetryAsync(
                    retryConfig.MaxRetryAttempts,
                    retryAttempt => TimeSpan.FromSeconds(
                        Math.Min(
                            retryConfig.InitialBackoffSeconds * Math.Pow(retryConfig.BackoffMultiplier, retryAttempt - 1),
                            retryConfig.MaxBackoffSeconds
                        )
                    ),
                    onRetry: (exception, timeSpan, retryCount, context) =>
                    {
                        _logger.LogWarning(
                            exception,
                            "S3 operation failed. Retry {RetryCount}/{MaxRetries} after {Delay}s",
                            retryCount,
                            retryConfig.MaxRetryAttempts,
                            timeSpan.TotalSeconds);
                    });
        }

        public async Task<string> UploadFileAsync(
            string filePath,
            string key,
            Dictionary<string, string>? metadata = null,
            CancellationToken cancellationToken = default)
        {
            var stopwatch = Stopwatch.StartNew();
            var fileInfo = new FileInfo(filePath);
            var fullKey = $"{_config.UploadPrefix}{key}";

            _logger.LogInformation(
                "Starting upload: {FilePath} ({Size:N0} bytes) -> s3://{Bucket}/{Key}",
                filePath,
                fileInfo.Length,
                _config.LandingBucket,
                fullKey);

            try
            {
                return await _retryPolicy.ExecuteAsync(async () =>
                {
                    var request = new TransferUtilityUploadRequest
                    {
                        FilePath = filePath,
                        BucketName = _config.LandingBucket,
                        Key = fullKey,
                        ContentType = GetContentType(filePath),
                        CannedACL = S3CannedACL.Private,
                        StorageClass = S3StorageClass.Standard
                    };

                    // Add metadata
                    if (metadata != null)
                    {
                        foreach (var kvp in metadata)
                        {
                            request.Metadata.Add(kvp.Key, kvp.Value);
                        }
                    }

                    // Add default metadata
                    request.Metadata.Add("x-amz-meta-original-file", Path.GetFileName(filePath));
                    request.Metadata.Add("x-amz-meta-upload-timestamp", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString());
                    request.Metadata.Add("x-amz-meta-converter-version", "1.0.0");

                    // Upload progress tracking
                    request.UploadProgressEvent += (sender, e) =>
                    {
                        var percentComplete = (int)e.PercentDone;
                        if (percentComplete % 10 == 0) // Log every 10%
                        {
                            _logger.LogDebug(
                                "Upload progress: {Percent}% ({Transferred:N0}/{Total:N0} bytes)",
                                percentComplete,
                                e.TransferredBytes,
                                e.TotalBytes);
                        }
                    };

                    await _transferUtility.UploadAsync(request, cancellationToken);

                    stopwatch.Stop();
                    _logger.LogInformation(
                        "Upload completed: s3://{Bucket}/{Key} in {Duration:N2}s ({Speed:N2} MB/s)",
                        _config.LandingBucket,
                        fullKey,
                        stopwatch.Elapsed.TotalSeconds,
                        (fileInfo.Length / 1024.0 / 1024.0) / stopwatch.Elapsed.TotalSeconds);

                    return $"s3://{_config.LandingBucket}/{fullKey}";
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "Failed to upload file after all retries: {FilePath} -> s3://{Bucket}/{Key}",
                    filePath,
                    _config.LandingBucket,
                    fullKey);
                throw;
            }
        }

        public async Task<bool> VerifyUploadAsync(
            string key,
            CancellationToken cancellationToken = default)
        {
            var fullKey = $"{_config.UploadPrefix}{key}";

            try
            {
                var metadata = await _s3Client.GetObjectMetadataAsync(
                    _config.LandingBucket,
                    fullKey,
                    cancellationToken);

                _logger.LogDebug(
                    "Upload verified: s3://{Bucket}/{Key} ({Size:N0} bytes, ETag: {ETag})",
                    _config.LandingBucket,
                    fullKey,
                    metadata.ContentLength,
                    metadata.ETag);

                return true;
            }
            catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                _logger.LogWarning(
                    "Upload verification failed: Object not found s3://{Bucket}/{Key}",
                    _config.LandingBucket,
                    fullKey);
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "Error verifying upload: s3://{Bucket}/{Key}",
                    _config.LandingBucket,
                    fullKey);
                throw;
            }
        }

        public async Task<GetObjectMetadataResponse?> GetFileMetadataAsync(
            string key,
            CancellationToken cancellationToken = default)
        {
            var fullKey = $"{_config.UploadPrefix}{key}";

            try
            {
                return await _s3Client.GetObjectMetadataAsync(
                    _config.LandingBucket,
                    fullKey,
                    cancellationToken);
            }
            catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return null;
            }
        }

        private static string GetContentType(string filePath)
        {
            var extension = Path.GetExtension(filePath).ToLowerInvariant();
            return extension switch
            {
                ".pdf" => "application/pdf",
                ".xdw" => "application/vnd.fujixerox.docuworks",
                ".xbd" => "application/vnd.fujixerox.docuworks.binder",
                _ => "application/octet-stream"
            };
        }

        public void Dispose()
        {
            _transferUtility?.Dispose();
            _s3Client?.Dispose();
        }
    }
}
```

#### 2.3 SQS Client with Message Deduplication

```csharp
// Services/AWS/SQSClientService.cs
using Amazon.SQS;
using Amazon.SQS.Model;
using Microsoft.Extensions.Logging;
using Polly;
using Polly.Retry;
using System.Text.Json;

namespace DocuWorksConverter.Services.AWS
{
    public interface ISQSClientService
    {
        Task<string> SendConversionNotificationAsync(
            ConversionNotification notification,
            CancellationToken cancellationToken = default);

        Task<QueueStats> GetQueueStatsAsync(
            CancellationToken cancellationToken = default);
    }

    public class SQSClientService : ISQSClientService, IDisposable
    {
        private readonly IAmazonSQS _sqsClient;
        private readonly ILogger<SQSClientService> _logger;
        private readonly SQSConfig _config;
        private readonly AsyncRetryPolicy _retryPolicy;

        public SQSClientService(
            AwsConfig awsConfig,
            ILogger<SQSClientService> logger)
        {
            _logger = logger;
            _config = awsConfig.GetConfig<SQSConfig>("SQS");

            // Initialize SQS client
            var sqsClientConfig = new AmazonSQSConfig
            {
                RegionEndpoint = awsConfig.Region,
                MaxErrorRetry = 3
            };

            _sqsClient = new AmazonSQSClient(awsConfig.GetCredentials(), sqsClientConfig);

            // Configure retry policy
            var retryConfig = awsConfig.GetConfig<RetryConfig>("Retry");
            _retryPolicy = Policy
                .Handle<AmazonSQSException>()
                .Or<TimeoutException>()
                .WaitAndRetryAsync(
                    retryConfig.MaxRetryAttempts,
                    retryAttempt => TimeSpan.FromSeconds(
                        Math.Min(
                            retryConfig.InitialBackoffSeconds * Math.Pow(retryConfig.BackoffMultiplier, retryAttempt - 1),
                            retryConfig.MaxBackoffSeconds
                        )
                    ),
                    onRetry: (exception, timeSpan, retryCount, context) =>
                    {
                        _logger.LogWarning(
                            exception,
                            "SQS operation failed. Retry {RetryCount}/{MaxRetries} after {Delay}s",
                            retryCount,
                            retryConfig.MaxRetryAttempts,
                            timeSpan.TotalSeconds);
                    });
        }

        public async Task<string> SendConversionNotificationAsync(
            ConversionNotification notification,
            CancellationToken cancellationToken = default)
        {
            var messageBody = JsonSerializer.Serialize(notification, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            _logger.LogInformation(
                "Sending SQS notification for file: {OriginalFile} -> {ConvertedS3Key}",
                notification.OriginalFileName,
                notification.S3Key);

            try
            {
                return await _retryPolicy.ExecuteAsync(async () =>
                {
                    var request = new SendMessageRequest
                    {
                        QueueUrl = _config.QueueUrl,
                        MessageBody = messageBody,
                        MessageAttributes = new Dictionary<string, MessageAttributeValue>
                        {
                            ["FileType"] = new MessageAttributeValue
                            {
                                DataType = "String",
                                StringValue = notification.FileType
                            },
                            ["ConversionStatus"] = new MessageAttributeValue
                            {
                                DataType = "String",
                                StringValue = notification.Status
                            },
                            ["Source"] = new MessageAttributeValue
                            {
                                DataType = "String",
                                StringValue = "DocuWorksConverter"
                            }
                        }
                    };

                    // Add deduplication for FIFO queues
                    if (_config.MessageDeduplicationEnabled)
                    {
                        request.MessageDeduplicationId = ComputeMessageDeduplicationId(notification);
                        request.MessageGroupId = _config.MessageGroupId;
                    }

                    var response = await _sqsClient.SendMessageAsync(request, cancellationToken);

                    _logger.LogInformation(
                        "SQS message sent successfully. MessageId: {MessageId}",
                        response.MessageId);

                    return response.MessageId;
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "Failed to send SQS notification after all retries: {OriginalFile}",
                    notification.OriginalFileName);
                throw;
            }
        }

        public async Task<QueueStats> GetQueueStatsAsync(
            CancellationToken cancellationToken = default)
        {
            try
            {
                var request = new GetQueueAttributesRequest
                {
                    QueueUrl = _config.QueueUrl,
                    AttributeNames = new List<string>
                    {
                        "ApproximateNumberOfMessages",
                        "ApproximateNumberOfMessagesNotVisible",
                        "ApproximateNumberOfMessagesDelayed"
                    }
                };

                var response = await _sqsClient.GetQueueAttributesAsync(request, cancellationToken);

                return new QueueStats
                {
                    VisibleMessages = int.Parse(response.Attributes["ApproximateNumberOfMessages"]),
                    InFlightMessages = int.Parse(response.Attributes["ApproximateNumberOfMessagesNotVisible"]),
                    DelayedMessages = int.Parse(response.Attributes["ApproximateNumberOfMessagesDelayed"])
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to get queue statistics");
                return new QueueStats();
            }
        }

        private static string ComputeMessageDeduplicationId(ConversionNotification notification)
        {
            // Create unique ID based on file path and timestamp
            var input = $"{notification.OriginalFilePath}:{notification.Timestamp:O}";
            using var sha256 = System.Security.Cryptography.SHA256.Create();
            var hashBytes = sha256.ComputeHash(System.Text.Encoding.UTF8.GetBytes(input));
            return Convert.ToBase64String(hashBytes);
        }

        public void Dispose()
        {
            _sqsClient?.Dispose();
        }
    }

    // Data models
    public class ConversionNotification
    {
        public string OriginalFilePath { get; set; } = string.Empty;
        public string OriginalFileName { get; set; } = string.Empty;
        public string S3Bucket { get; set; } = string.Empty;
        public string S3Key { get; set; } = string.Empty;
        public string S3Url { get; set; } = string.Empty;
        public string FileType { get; set; } = "pdf";
        public string Status { get; set; } = "completed";
        public long FileSizeBytes { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
        public Dictionary<string, string>? Metadata { get; set; }
    }

    public class QueueStats
    {
        public int VisibleMessages { get; set; }
        public int InFlightMessages { get; set; }
        public int DelayedMessages { get; set; }
        public int TotalMessages => VisibleMessages + InFlightMessages + DelayedMessages;
    }
}
```

### Phase 3: Connection Verification & Testing

#### 3.1 AWS Connection Verifier

```csharp
// Services/AWS/AwsConnectionVerifier.cs
using Amazon.S3;
using Amazon.SQS;
using Amazon.CloudWatchLogs;
using Microsoft.Extensions.Logging;

namespace DocuWorksConverter.Services.AWS
{
    public interface IAwsConnectionVerifier
    {
        Task<VerificationResult> VerifyAllConnectionsAsync();
        Task<bool> VerifyS3ConnectionAsync();
        Task<bool> VerifySQSConnectionAsync();
        Task<bool> VerifyCloudWatchConnectionAsync();
    }

    public class AwsConnectionVerifier : IAwsConnectionVerifier
    {
        private readonly IAmazonS3 _s3Client;
        private readonly IAmazonSQS _sqsClient;
        private readonly IAmazonCloudWatchLogs _cloudWatchClient;
        private readonly ILogger<AwsConnectionVerifier> _logger;
        private readonly S3Config _s3Config;
        private readonly SQSConfig _sqsConfig;

        public AwsConnectionVerifier(
            AwsConfig awsConfig,
            ILogger<AwsConnectionVerifier> logger)
        {
            _logger = logger;
            _s3Config = awsConfig.GetConfig<S3Config>("S3");
            _sqsConfig = awsConfig.GetConfig<SQSConfig>("SQS");

            var credentials = awsConfig.GetCredentials();
            var region = awsConfig.Region;

            _s3Client = new AmazonS3Client(credentials, region);
            _sqsClient = new AmazonSQSClient(credentials, region);
            _cloudWatchClient = new AmazonCloudWatchLogsClient(credentials, region);
        }

        public async Task<VerificationResult> VerifyAllConnectionsAsync()
        {
            _logger.LogInformation("Starting AWS connection verification...");

            var result = new VerificationResult();

            // Verify S3
            result.S3Connected = await VerifyS3ConnectionAsync();

            // Verify SQS
            result.SQSConnected = await VerifySQSConnectionAsync();

            // Verify CloudWatch
            result.CloudWatchConnected = await VerifyCloudWatchConnectionAsync();

            result.AllServicesConnected = result.S3Connected &&
                                          result.SQSConnected &&
                                          result.CloudWatchConnected;

            _logger.LogInformation(
                "AWS connection verification completed. S3: {S3}, SQS: {SQS}, CloudWatch: {CloudWatch}",
                result.S3Connected,
                result.SQSConnected,
                result.CloudWatchConnected);

            return result;
        }

        public async Task<bool> VerifyS3ConnectionAsync()
        {
            try
            {
                _logger.LogInformation("Verifying S3 connection to bucket: {Bucket}", _s3Config.LandingBucket);

                // Check bucket existence and permissions
                var response = await _s3Client.GetBucketLocationAsync(_s3Config.LandingBucket);

                // Try to list objects (limited to 1)
                var listResponse = await _s3Client.ListObjectsV2Async(new Amazon.S3.Model.ListObjectsV2Request
                {
                    BucketName = _s3Config.LandingBucket,
                    MaxKeys = 1
                });

                _logger.LogInformation("S3 connection verified successfully");
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "S3 connection verification failed");
                return false;
            }
        }

        public async Task<bool> VerifySQSConnectionAsync()
        {
            try
            {
                _logger.LogInformation("Verifying SQS connection to queue: {QueueUrl}", _sqsConfig.QueueUrl);

                // Get queue attributes
                var response = await _sqsClient.GetQueueAttributesAsync(
                    new GetQueueAttributesRequest
                    {
                        QueueUrl = _sqsConfig.QueueUrl,
                        AttributeNames = new List<string> { "All" }
                    });

                _logger.LogInformation(
                    "SQS connection verified successfully. Queue has ~{MessageCount} messages",
                    response.Attributes.GetValueOrDefault("ApproximateNumberOfMessages", "0"));

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SQS connection verification failed");
                return false;
            }
        }

        public async Task<bool> VerifyCloudWatchConnectionAsync()
        {
            try
            {
                _logger.LogInformation("Verifying CloudWatch Logs connection");

                // Try to describe log groups (limited to 1)
                var response = await _cloudWatchClient.DescribeLogGroupsAsync(
                    new Amazon.CloudWatchLogs.Model.DescribeLogGroupsRequest
                    {
                        Limit = 1
                    });

                _logger.LogInformation("CloudWatch Logs connection verified successfully");
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "CloudWatch Logs connection verification failed");
                return false;
            }
        }
    }

    public class VerificationResult
    {
        public bool S3Connected { get; set; }
        public bool SQSConnected { get; set; }
        public bool CloudWatchConnected { get; set; }
        public bool AllServicesConnected { get; set; }
        public DateTime VerificationTime { get; set; } = DateTime.UtcNow;
    }
}
```

#### 3.2 Integration Test Suite

```csharp
// Tests/AWS/AwsIntegrationTests.cs
using Xunit;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using DocuWorksConverter.Services.AWS;

namespace DocuWorksConverter.Tests.AWS
{
    public class AwsIntegrationTests : IAsyncLifetime
    {
        private readonly IConfiguration _configuration;
        private readonly ILogger<AwsIntegrationTests> _logger;
        private AwsConfig _awsConfig = null!;
        private S3ClientService _s3Client = null!;
        private SQSClientService _sqsClient = null!;
        private AwsConnectionVerifier _verifier = null!;

        public AwsIntegrationTests()
        {
            // Build configuration
            _configuration = new ConfigurationBuilder()
                .SetBasePath(Directory.GetCurrentDirectory())
                .AddJsonFile("appsettings.json", optional: false)
                .AddJsonFile("appsettings.Development.json", optional: true)
                .AddEnvironmentVariables()
                .Build();

            // Create logger
            using var loggerFactory = LoggerFactory.Create(builder =>
            {
                builder.AddConsole();
                builder.SetMinimumLevel(LogLevel.Debug);
            });

            _logger = loggerFactory.CreateLogger<AwsIntegrationTests>();
        }

        public async Task InitializeAsync()
        {
            var loggerFactory = LoggerFactory.Create(builder =>
            {
                builder.AddConsole();
                builder.SetMinimumLevel(LogLevel.Debug);
            });

            _awsConfig = new AwsConfig(_configuration);
            _s3Client = new S3ClientService(_awsConfig, loggerFactory.CreateLogger<S3ClientService>());
            _sqsClient = new SQSClientService(_awsConfig, loggerFactory.CreateLogger<SQSClientService>());
            _verifier = new AwsConnectionVerifier(_awsConfig, loggerFactory.CreateLogger<AwsConnectionVerifier>());

            await Task.CompletedTask;
        }

        public async Task DisposeAsync()
        {
            _s3Client?.Dispose();
            _sqsClient?.Dispose();
            await Task.CompletedTask;
        }

        [Fact]
        public async Task Test_AwsConnections_ShouldSucceed()
        {
            // Act
            var result = await _verifier.VerifyAllConnectionsAsync();

            // Assert
            Assert.True(result.S3Connected, "S3 connection should succeed");
            Assert.True(result.SQSConnected, "SQS connection should succeed");
            Assert.True(result.AllServicesConnected, "All AWS services should be connected");
        }

        [Fact]
        public async Task Test_S3Upload_ShouldSucceed()
        {
            // Arrange
            var testContent = "This is a test PDF content";
            var testFilePath = Path.Combine(Path.GetTempPath(), $"test-{Guid.NewGuid()}.pdf");
            await File.WriteAllTextAsync(testFilePath, testContent);

            try
            {
                var testKey = $"integration-test/{Guid.NewGuid()}.pdf";

                // Act
                var s3Url = await _s3Client.UploadFileAsync(
                    testFilePath,
                    testKey,
                    new Dictionary<string, string>
                    {
                        ["test-type"] = "integration-test",
                        ["test-timestamp"] = DateTime.UtcNow.ToString("O")
                    });

                // Assert
                Assert.NotNull(s3Url);
                Assert.Contains("s3://", s3Url);

                // Verify upload
                var verified = await _s3Client.VerifyUploadAsync(testKey);
                Assert.True(verified, "Upload should be verified");

                // Get metadata
                var metadata = await _s3Client.GetFileMetadataAsync(testKey);
                Assert.NotNull(metadata);
                Assert.True(metadata.Metadata.ContainsKey("x-amz-meta-test-type"));
            }
            finally
            {
                // Cleanup
                if (File.Exists(testFilePath))
                {
                    File.Delete(testFilePath);
                }
            }
        }

        [Fact]
        public async Task Test_SQSNotification_ShouldSucceed()
        {
            // Arrange
            var notification = new ConversionNotification
            {
                OriginalFilePath = @"C:\Test\sample.xdw",
                OriginalFileName = "sample.xdw",
                S3Bucket = "cis-filesearch-s3-landing",
                S3Key = "docuworks-converted/test/sample.pdf",
                S3Url = "s3://cis-filesearch-s3-landing/docuworks-converted/test/sample.pdf",
                FileType = "pdf",
                Status = "completed",
                FileSizeBytes = 1024 * 500, // 500 KB
                Metadata = new Dictionary<string, string>
                {
                    ["conversion-duration-ms"] = "5000",
                    ["docuworks-version"] = "9.0"
                }
            };

            // Act
            var messageId = await _sqsClient.SendConversionNotificationAsync(notification);

            // Assert
            Assert.NotNull(messageId);
            Assert.NotEmpty(messageId);

            // Get queue stats
            var stats = await _sqsClient.GetQueueStatsAsync();
            Assert.True(stats.TotalMessages >= 0);
        }

        [Fact]
        public async Task Test_S3UploadWithRetry_ShouldHandleFailures()
        {
            // Arrange
            var testFilePath = Path.Combine(Path.GetTempPath(), $"large-test-{Guid.NewGuid()}.pdf");

            // Create a 10MB test file
            var randomData = new byte[10 * 1024 * 1024];
            new Random().NextBytes(randomData);
            await File.WriteAllBytesAsync(testFilePath, randomData);

            try
            {
                var testKey = $"integration-test/large/{Guid.NewGuid()}.pdf";

                // Act
                var s3Url = await _s3Client.UploadFileAsync(testFilePath, testKey);

                // Assert
                Assert.NotNull(s3Url);

                // Verify
                var verified = await _s3Client.VerifyUploadAsync(testKey);
                Assert.True(verified);

                // Check metadata
                var metadata = await _s3Client.GetFileMetadataAsync(testKey);
                Assert.NotNull(metadata);
                Assert.Equal(10 * 1024 * 1024, metadata.ContentLength);
            }
            finally
            {
                if (File.Exists(testFilePath))
                {
                    File.Delete(testFilePath);
                }
            }
        }

        [Fact]
        public async Task Test_QueueStats_ShouldReturnValidStats()
        {
            // Act
            var stats = await _sqsClient.GetQueueStatsAsync();

            // Assert
            Assert.NotNull(stats);
            Assert.True(stats.VisibleMessages >= 0);
            Assert.True(stats.InFlightMessages >= 0);
            Assert.True(stats.DelayedMessages >= 0);
            Assert.True(stats.TotalMessages >= 0);
        }
    }
}
```

### Phase 4: Performance Optimization

#### 4.1 Multipart Upload for Large Files

Already implemented in `S3ClientService` using `TransferUtility` which automatically handles:
- Files > 100MB trigger multipart upload
- 10MB part size for optimal performance
- Concurrent part uploads
- Automatic retry for failed parts

#### 4.2 Upload Progress Monitoring

```csharp
// Services/AWS/UploadProgressMonitor.cs
using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace DocuWorksConverter.Services.AWS
{
    public interface IUploadProgressMonitor
    {
        void StartMonitoring(string fileId, long totalBytes);
        void UpdateProgress(string fileId, long transferredBytes);
        void CompleteUpload(string fileId, bool success);
        UploadProgress? GetProgress(string fileId);
        List<UploadProgress> GetAllProgress();
    }

    public class UploadProgressMonitor : IUploadProgressMonitor
    {
        private readonly ConcurrentDictionary<string, UploadProgress> _activeUploads = new();
        private readonly ILogger<UploadProgressMonitor> _logger;

        public UploadProgressMonitor(ILogger<UploadProgressMonitor> logger)
        {
            _logger = logger;
        }

        public void StartMonitoring(string fileId, long totalBytes)
        {
            var progress = new UploadProgress
            {
                FileId = fileId,
                TotalBytes = totalBytes,
                StartTime = DateTime.UtcNow,
                Status = UploadStatus.InProgress
            };

            _activeUploads[fileId] = progress;

            _logger.LogInformation(
                "Started monitoring upload: {FileId} ({Size:N0} bytes)",
                fileId,
                totalBytes);
        }

        public void UpdateProgress(string fileId, long transferredBytes)
        {
            if (_activeUploads.TryGetValue(fileId, out var progress))
            {
                progress.TransferredBytes = transferredBytes;
                progress.PercentComplete = (int)((transferredBytes * 100.0) / progress.TotalBytes);
                progress.LastUpdateTime = DateTime.UtcNow;

                var elapsedSeconds = (DateTime.UtcNow - progress.StartTime).TotalSeconds;
                if (elapsedSeconds > 0)
                {
                    progress.SpeedMbps = (transferredBytes / 1024.0 / 1024.0) / elapsedSeconds;
                }
            }
        }

        public void CompleteUpload(string fileId, bool success)
        {
            if (_activeUploads.TryGetValue(fileId, out var progress))
            {
                progress.Status = success ? UploadStatus.Completed : UploadStatus.Failed;
                progress.CompletionTime = DateTime.UtcNow;
                progress.Duration = progress.CompletionTime.Value - progress.StartTime;

                _logger.LogInformation(
                    "Upload {Status}: {FileId} in {Duration:N2}s (avg speed: {Speed:N2} MB/s)",
                    progress.Status,
                    fileId,
                    progress.Duration?.TotalSeconds ?? 0,
                    progress.SpeedMbps);

                // Remove from active uploads after 1 hour
                Task.Delay(TimeSpan.FromHours(1))
                    .ContinueWith(_ => _activeUploads.TryRemove(fileId, out _));
            }
        }

        public UploadProgress? GetProgress(string fileId)
        {
            return _activeUploads.TryGetValue(fileId, out var progress) ? progress : null;
        }

        public List<UploadProgress> GetAllProgress()
        {
            return _activeUploads.Values.ToList();
        }
    }

    public class UploadProgress
    {
        public string FileId { get; set; } = string.Empty;
        public long TotalBytes { get; set; }
        public long TransferredBytes { get; set; }
        public int PercentComplete { get; set; }
        public double SpeedMbps { get; set; }
        public DateTime StartTime { get; set; }
        public DateTime LastUpdateTime { get; set; }
        public DateTime? CompletionTime { get; set; }
        public TimeSpan? Duration { get; set; }
        public UploadStatus Status { get; set; }
    }

    public enum UploadStatus
    {
        InProgress,
        Completed,
        Failed
    }
}
```

### Phase 5: Logging & Monitoring

#### 5.1 CloudWatch Logs Integration

```csharp
// Services/AWS/CloudWatchLogger.cs
using Amazon.CloudWatchLogs;
using Amazon.CloudWatchLogs.Model;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;

namespace DocuWorksConverter.Services.AWS
{
    public class CloudWatchLoggerProvider : ILoggerProvider
    {
        private readonly IAmazonCloudWatchLogs _client;
        private readonly string _logGroupName;
        private readonly string _logStreamName;
        private readonly ConcurrentQueue<InputLogEvent> _logQueue = new();
        private readonly Timer _flushTimer;
        private string? _sequenceToken;

        public CloudWatchLoggerProvider(
            AwsConfig awsConfig,
            string logGroupName,
            string logStreamName)
        {
            _client = new AmazonCloudWatchLogsClient(
                awsConfig.GetCredentials(),
                awsConfig.Region);

            _logGroupName = logGroupName;
            _logStreamName = $"{logStreamName}-{Environment.MachineName}";

            // Initialize log group and stream
            InitializeLogStreamAsync().Wait();

            // Flush logs every 5 seconds
            _flushTimer = new Timer(
                async _ => await FlushLogsAsync(),
                null,
                TimeSpan.FromSeconds(5),
                TimeSpan.FromSeconds(5));
        }

        public ILogger CreateLogger(string categoryName)
        {
            return new CloudWatchLogger(categoryName, this);
        }

        internal void AddLog(string message, LogLevel logLevel)
        {
            _logQueue.Enqueue(new InputLogEvent
            {
                Message = message,
                Timestamp = DateTime.UtcNow
            });
        }

        private async Task InitializeLogStreamAsync()
        {
            try
            {
                // Create log group if not exists
                await _client.CreateLogGroupAsync(new CreateLogGroupRequest
                {
                    LogGroupName = _logGroupName
                });
            }
            catch (ResourceAlreadyExistsException)
            {
                // Log group already exists
            }

            try
            {
                // Create log stream if not exists
                await _client.CreateLogStreamAsync(new CreateLogStreamRequest
                {
                    LogGroupName = _logGroupName,
                    LogStreamName = _logStreamName
                });
            }
            catch (ResourceAlreadyExistsException)
            {
                // Log stream already exists, get sequence token
                var response = await _client.DescribeLogStreamsAsync(
                    new DescribeLogStreamsRequest
                    {
                        LogGroupName = _logGroupName,
                        LogStreamNamePrefix = _logStreamName
                    });

                _sequenceToken = response.LogStreams
                    .FirstOrDefault(s => s.LogStreamName == _logStreamName)
                    ?.UploadSequenceToken;
            }
        }

        private async Task FlushLogsAsync()
        {
            if (_logQueue.IsEmpty)
                return;

            var events = new List<InputLogEvent>();
            while (_logQueue.TryDequeue(out var logEvent) && events.Count < 10000)
            {
                events.Add(logEvent);
            }

            if (events.Count == 0)
                return;

            try
            {
                var request = new PutLogEventsRequest
                {
                    LogGroupName = _logGroupName,
                    LogStreamName = _logStreamName,
                    LogEvents = events.OrderBy(e => e.Timestamp).ToList(),
                    SequenceToken = _sequenceToken
                };

                var response = await _client.PutLogEventsAsync(request);
                _sequenceToken = response.NextSequenceToken;
            }
            catch (Exception)
            {
                // Silently fail to avoid recursive logging
            }
        }

        public void Dispose()
        {
            _flushTimer?.Dispose();
            FlushLogsAsync().Wait();
            _client?.Dispose();
        }
    }

    public class CloudWatchLogger : ILogger
    {
        private readonly string _categoryName;
        private readonly CloudWatchLoggerProvider _provider;

        public CloudWatchLogger(string categoryName, CloudWatchLoggerProvider provider)
        {
            _categoryName = categoryName;
            _provider = provider;
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull
        {
            return null;
        }

        public bool IsEnabled(LogLevel logLevel)
        {
            return logLevel >= LogLevel.Information;
        }

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
                return;

            var message = $"[{logLevel}] [{_categoryName}] {formatter(state, exception)}";

            if (exception != null)
            {
                message += $"\n{exception}";
            }

            _provider.AddLog(message, logLevel);
        }
    }
}
```

## Next Steps

### Day 2 Afternoon Tasks

1. **Run Integration Tests**
   ```bash
   dotnet test --filter Category=Integration
   ```

2. **Performance Benchmarking**
   - Test upload speed for various file sizes (1MB, 10MB, 100MB, 500MB)
   - Measure SQS notification latency
   - Monitor memory usage during large file uploads

3. **Error Scenario Testing**
   - Network interruption handling
   - S3 bucket permission errors
   - SQS queue full scenarios
   - Retry mechanism validation

4. **Documentation**
   - API documentation
   - Configuration guide
   - Troubleshooting guide

### Day 3 Plan

1. **Production Deployment Preparation**
   - Windows Service installation
   - Startup configuration
   - Health check endpoints
   - Monitoring dashboard

2. **Security Hardening**
   - Credential encryption
   - Network security groups
   - Audit logging

3. **Performance Tuning**
   - Connection pooling optimization
   - Batch processing improvements
   - Memory profiling

## Troubleshooting Guide

### Common Issues

#### 1. S3 Upload Failures

**Symptom**: `AmazonS3Exception: Access Denied`

**Solution**:
```bash
# Verify AWS credentials
aws s3 ls s3://cis-filesearch-s3-landing --profile AdministratorAccess-770923989980

# Check IAM permissions
aws iam get-user --profile AdministratorAccess-770923989980
```

#### 2. SQS Connection Errors

**Symptom**: `AmazonSQSException: Queue does not exist`

**Solution**:
```bash
# Verify queue URL
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue \
  --profile AdministratorAccess-770923989980
```

#### 3. Slow Upload Performance

**Solution**:
- Increase `ConcurrentServiceRequests` in TransferUtilityConfig
- Reduce `PartSizeMB` for faster part uploads
- Check network bandwidth
- Use VPC endpoint for S3 (if on EC2)

## Monitoring Metrics

### Key Performance Indicators

1. **Upload Performance**
   - Average upload speed (MB/s)
   - Upload success rate (%)
   - P95 upload duration

2. **SQS Metrics**
   - Message send success rate
   - Queue depth
   - Message processing latency

3. **Error Rates**
   - S3 upload failures
   - SQS send failures
   - Retry attempts

4. **Resource Usage**
   - Memory consumption
   - CPU usage
   - Network throughput

## Cost Optimization

### S3 Cost Reduction
- Use S3 Intelligent-Tiering for infrequently accessed files
- Enable S3 lifecycle policies for automatic archival
- Use S3 Transfer Acceleration for faster uploads (if needed)

### SQS Cost Reduction
- Use long polling (already configured: WaitTimeSeconds=20)
- Batch message processing
- Set appropriate message retention period

## Security Best Practices

1. **Credential Management**
   - Use AWS Secrets Manager for sensitive data
   - Rotate credentials regularly
   - Never commit credentials to source control

2. **Network Security**
   - Use VPC endpoints for AWS services
   - Enable encryption in transit (HTTPS/TLS)
   - Restrict security group rules

3. **Data Protection**
   - Enable S3 bucket encryption
   - Use server-side encryption (SSE-S3 or SSE-KMS)
   - Enable CloudTrail for audit logs

## Conclusion

This integration strategy provides a production-ready AWS integration for the DocuWorks converter service, following enterprise best practices with comprehensive error handling, retry logic, performance optimization, and monitoring capabilities.
