# QuickStart: AWS Integration for DocuWorks Converter

## 5-Minute Setup Guide

This guide will get you up and running with AWS integration in minimal time.

## Prerequisites Checklist

```powershell
# 1. Check .NET SDK
dotnet --version  # Should be 7.0 or higher

# 2. Check AWS CLI
aws --version     # Should be 2.x

# 3. Verify AWS Profile
aws sts get-caller-identity --profile AdministratorAccess-770923989980
```

## Quick Setup (Copy-Paste Commands)

### Step 1: Install Dependencies (2 minutes)

```bash
cd C:\DocuWorksConverter

# Install AWS SDK packages
dotnet add package AWSSDK.S3 --version 3.7.400
dotnet add package AWSSDK.SQS --version 3.7.400
dotnet add package AWSSDK.CloudWatchLogs --version 3.7.400
dotnet add package Polly --version 8.2.0

# Restore packages
dotnet restore
```

### Step 2: Create Configuration (1 minute)

Create `appsettings.json`:

```json
{
  "AWS": {
    "Profile": "AdministratorAccess-770923989980",
    "Region": "ap-northeast-1"
  },
  "S3": {
    "LandingBucket": "cis-filesearch-s3-landing",
    "UploadPrefix": "docuworks-converted/"
  },
  "SQS": {
    "QueueUrl": "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue"
  },
  "Retry": {
    "MaxRetryAttempts": 3,
    "InitialBackoffSeconds": 2
  }
}
```

### Step 3: Create AWS Services (1 minute)

Create `Services\AWS\AwsConfig.cs`:

```csharp
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
            var chain = new CredentialProfileStoreChain();

            if (chain.TryGetAWSCredentials(profileName, out var credentials))
            {
                return credentials;
            }

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
        public string UploadPrefix { get; set; } = string.Empty;
    }

    public class SQSConfig
    {
        public string QueueUrl { get; set; } = string.Empty;
    }
}
```

### Step 4: Verify Connection (1 minute)

Create and run `verify.ps1`:

```powershell
# Quick verification script
$Profile = "AdministratorAccess-770923989980"
$Bucket = "cis-filesearch-s3-landing"

Write-Host "Testing S3..." -ForegroundColor Cyan
aws s3 ls "s3://$Bucket" --profile $Profile --max-items 1
if ($?) { Write-Host "✓ S3 OK" -ForegroundColor Green }

Write-Host "`nTesting SQS..." -ForegroundColor Cyan
$QueueUrl = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue"
aws sqs get-queue-attributes --queue-url $QueueUrl --profile $Profile --attribute-names ApproximateNumberOfMessages | Out-Null
if ($?) { Write-Host "✓ SQS OK" -ForegroundColor Green }

Write-Host "`nAll checks passed!" -ForegroundColor Green
```

Run it:
```powershell
.\verify.ps1
```

## Minimal Working Example

### Upload a File to S3

```csharp
using Amazon.S3;
using Amazon.S3.Transfer;

// Initialize
var awsConfig = new AwsConfig(configuration);
var s3Client = new AmazonS3Client(
    awsConfig.GetCredentials(),
    awsConfig.Region
);

var transferUtility = new TransferUtility(s3Client);
var s3Config = awsConfig.GetConfig<S3Config>("S3");

// Upload
var filePath = @"C:\Test\sample.pdf";
var key = $"{s3Config.UploadPrefix}sample.pdf";

await transferUtility.UploadAsync(
    filePath,
    s3Config.LandingBucket,
    key
);

Console.WriteLine($"Uploaded to s3://{s3Config.LandingBucket}/{key}");
```

### Send SQS Notification

```csharp
using Amazon.SQS;
using System.Text.Json;

// Initialize
var sqsClient = new AmazonSQSClient(
    awsConfig.GetCredentials(),
    awsConfig.Region
);

var sqsConfig = awsConfig.GetConfig<SQSConfig>("SQS");

// Send message
var notification = new
{
    originalFile = "sample.xdw",
    s3Key = "docuworks-converted/sample.pdf",
    timestamp = DateTime.UtcNow
};

var messageBody = JsonSerializer.Serialize(notification);

await sqsClient.SendMessageAsync(
    sqsConfig.QueueUrl,
    messageBody
);

Console.WriteLine("Notification sent to SQS");
```

## Complete Working Program

Create `Program.cs`:

```csharp
using Microsoft.Extensions.Configuration;
using Amazon.S3;
using Amazon.S3.Transfer;
using Amazon.SQS;
using System.Text.Json;

var configuration = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json")
    .Build();

var awsConfig = new AwsConfig(configuration);
var s3Config = awsConfig.GetConfig<S3Config>("S3");
var sqsConfig = awsConfig.GetConfig<SQSConfig>("SQS");

// Test file
var testFile = Path.GetTempFileName();
File.WriteAllText(testFile, "Test content");

try
{
    // 1. Upload to S3
    Console.WriteLine("Uploading to S3...");
    using var s3Client = new AmazonS3Client(
        awsConfig.GetCredentials(),
        awsConfig.Region
    );

    var transferUtility = new TransferUtility(s3Client);
    var s3Key = $"{s3Config.UploadPrefix}test-{DateTime.Now:yyyyMMdd-HHmmss}.txt";

    await transferUtility.UploadAsync(
        testFile,
        s3Config.LandingBucket,
        s3Key
    );

    Console.WriteLine($"✓ Uploaded: s3://{s3Config.LandingBucket}/{s3Key}");

    // 2. Send SQS notification
    Console.WriteLine("Sending SQS notification...");
    using var sqsClient = new AmazonSQSClient(
        awsConfig.GetCredentials(),
        awsConfig.Region
    );

    var notification = new
    {
        s3Bucket = s3Config.LandingBucket,
        s3Key = s3Key,
        timestamp = DateTime.UtcNow
    };

    var response = await sqsClient.SendMessageAsync(
        sqsConfig.QueueUrl,
        JsonSerializer.Serialize(notification)
    );

    Console.WriteLine($"✓ Message sent: {response.MessageId}");
    Console.WriteLine("\nAWS Integration test completed successfully!");
}
finally
{
    File.Delete(testFile);
}

// Helper class (same as above)
public class AwsConfig { /* ... */ }
public class S3Config { /* ... */ }
public class SQSConfig { /* ... */ }
```

Run it:
```bash
dotnet run
```

Expected output:
```
Uploading to S3...
✓ Uploaded: s3://cis-filesearch-s3-landing/docuworks-converted/test-20250128-143022.txt
Sending SQS notification...
✓ Message sent: abc123-def456-ghi789
AWS Integration test completed successfully!
```

## Common Quick Fixes

### Fix 1: "CredentialsNotFound"

```bash
aws configure --profile AdministratorAccess-770923989980
# Enter your credentials when prompted
```

### Fix 2: "Access Denied"

```bash
# Verify permissions
aws iam get-user --profile AdministratorAccess-770923989980
```

### Fix 3: "Queue does not exist"

```bash
# Check queue URL
aws sqs list-queues --profile AdministratorAccess-770923989980
```

### Fix 4: Slow Performance

```csharp
// Increase concurrent uploads
var transferConfig = new TransferUtilityConfig
{
    ConcurrentServiceRequests = 10
};

var transferUtility = new TransferUtility(s3Client, transferConfig);
```

## Testing Commands

```bash
# Run all tests
dotnet test

# Run with verbose output
dotnet test --logger:console;verbosity=detailed

# Run specific test
dotnet test --filter FullyQualifiedName~Test_S3Upload
```

## Verification Checklist

Quick checks before proceeding:

```powershell
# ✓ AWS CLI configured
aws --version

# ✓ Profile works
aws sts get-caller-identity --profile AdministratorAccess-770923989980

# ✓ S3 accessible
aws s3 ls s3://cis-filesearch-s3-landing --profile AdministratorAccess-770923989980

# ✓ SQS accessible
aws sqs get-queue-url --queue-name cis-filesearch-queue --profile AdministratorAccess-770923989980

# ✓ Project builds
dotnet build

# ✓ Tests pass
dotnet test
```

## Next Steps

After this quickstart:

1. **Review Full Documentation**
   - Read `AWS-INTEGRATION-STRATEGY.md` for complete implementation
   - Read `AWS-CONNECTION-VERIFICATION-SCRIPTS.md` for comprehensive testing

2. **Implement Production Features**
   - Error handling and retry logic
   - Logging and monitoring
   - Performance optimization
   - Security hardening

3. **Follow Day 2 Checklist**
   - Complete `DAY2-IMPLEMENTATION-CHECKLIST.md`
   - Run all integration tests
   - Document performance benchmarks

## Quick Reference

### Essential AWS CLI Commands

```bash
# S3
aws s3 ls s3://BUCKET --profile PROFILE
aws s3 cp FILE s3://BUCKET/KEY --profile PROFILE
aws s3 rm s3://BUCKET/KEY --profile PROFILE

# SQS
aws sqs send-message --queue-url URL --message-body "MESSAGE" --profile PROFILE
aws sqs receive-message --queue-url URL --profile PROFILE
aws sqs get-queue-attributes --queue-url URL --attribute-names All --profile PROFILE

# CloudWatch Logs
aws logs describe-log-groups --profile PROFILE
aws logs tail LOG_GROUP --follow --profile PROFILE
```

### Essential Code Patterns

```csharp
// Upload with progress
request.UploadProgressEvent += (sender, e) =>
{
    Console.WriteLine($"Progress: {e.PercentDone}%");
};

// Upload with metadata
request.Metadata.Add("key", "value");

// Upload with retry
var retryPolicy = Policy
    .Handle<AmazonS3Exception>()
    .WaitAndRetryAsync(3, retryAttempt => TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)));

await retryPolicy.ExecuteAsync(async () =>
{
    await transferUtility.UploadAsync(request);
});

// Send SQS with attributes
var request = new SendMessageRequest
{
    QueueUrl = queueUrl,
    MessageBody = body,
    MessageAttributes = new Dictionary<string, MessageAttributeValue>
    {
        ["Type"] = new MessageAttributeValue { DataType = "String", StringValue = "conversion" }
    }
};
```

## Troubleshooting Quick Reference

| Error | Quick Fix |
|-------|-----------|
| CredentialsNotFound | `aws configure --profile PROFILE` |
| AccessDenied | Check IAM permissions |
| BucketNotFound | Verify bucket name in config |
| QueueDoesNotExist | Verify queue URL in config |
| NetworkError | Check internet connection |
| SlowUpload | Increase ConcurrentServiceRequests |

## Support Resources

- **AWS Documentation**: https://docs.aws.amazon.com/
- **AWS SDK for .NET**: https://docs.aws.amazon.com/sdk-for-net/
- **Polly Documentation**: https://github.com/App-vNext/Polly

## Summary

You should now have:
- ✅ AWS SDK packages installed
- ✅ Configuration files created
- ✅ Basic AWS services working
- ✅ Connection verified
- ✅ Sample code running

**Total setup time: ~5 minutes**

Ready to proceed with full integration? Continue with `DAY2-IMPLEMENTATION-CHECKLIST.md`.
