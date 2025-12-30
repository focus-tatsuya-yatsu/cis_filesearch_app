# CIS File Search - Image Embedding Lambda

Lambda function for generating vector embeddings from images using CLIP (Contrastive Language-Image Pre-training) model.

## Overview

This Lambda function:
- Generates 512-dimensional vector embeddings from images
- Uses OpenAI's CLIP model for semantic understanding
- Caches embeddings in DynamoDB for performance
- Supports S3 URLs and base64-encoded images
- Optimized for AWS Lambda execution with container images

## Features

- **Pre-trained CLIP Model**: `openai/clip-vit-base-patch32`
- **Fast Inference**: < 2 seconds per image (after cold start)
- **Caching**: DynamoDB cache with 30-day TTL
- **Multiple Input Formats**: S3 URLs or base64-encoded images
- **Automatic Image Preprocessing**: Resize, format conversion
- **Cosine Similarity**: Normalized embeddings for similarity search

## Project Structure

```
lambda-image-embedding/
├── handler.py              # Main Lambda handler
├── requirements.txt        # Python dependencies
├── Dockerfile             # Container image definition
├── deploy.sh              # Deployment script
├── test-embedding.json    # Test payload
└── README.md
```

## Quick Start

### Prerequisites

- Docker installed
- AWS CLI configured
- ECR repository access
- Python 3.11

### Build and Deploy

```bash
# Set environment variables
export AWS_REGION="ap-northeast-1"
export AWS_ACCOUNT_ID="YOUR_ACCOUNT_ID"
export ECR_REPOSITORY="cis-image-embedding-lambda"
export FUNCTION_NAME="cis-image-embedding"

# Deploy
./deploy.sh
```

This script will:
1. Create ECR repository (if needed)
2. Build Docker image with CLIP model
3. Push to ECR
4. Update Lambda function

### Test Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Test handler
python -c "
from handler import lambda_handler
event = {'imageUrl': 's3://bucket/test.jpg'}
result = lambda_handler(event, None)
print(result)
"
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMBEDDING_CACHE_TABLE` | No | `cis-image-embedding-cache` | DynamoDB table name |
| `MODEL_NAME` | No | `openai/clip-vit-base-patch32` | HuggingFace model ID |
| `VECTOR_DIMENSION` | No | `512` | Embedding dimension |
| `MAX_IMAGE_SIZE` | No | `2048` | Max image dimension (pixels) |

### Lambda Configuration

**Recommended Settings:**
- **Memory**: 3008 MB (for model loading)
- **Timeout**: 60 seconds
- **Ephemeral Storage**: 10 GB (for model cache)
- **Architecture**: x86_64 (or arm64 for cost savings)

### IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-bucket",
        "arn:aws:s3:::cis-filesearch-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/cis-image-embedding-cache"
    }
  ]
}
```

## API Usage

### Input Format

**Option 1: S3 URL**
```json
{
  "imageUrl": "s3://cis-filesearch-bucket/images/photo.jpg",
  "useCache": true
}
```

**Option 2: Base64 Image**
```json
{
  "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "useCache": true
}
```

### Response Format

**Success:**
```json
{
  "statusCode": 200,
  "body": "{
    \"success\": true,
    \"data\": {
      \"embedding\": [0.123, -0.456, 0.789, ...],
      \"dimension\": 512,
      \"model\": \"openai/clip-vit-base-patch32\",
      \"inferenceTime\": 1.234,
      \"cached\": false,
      \"imageHash\": \"abc123def456\"
    }
  }"
}
```

**Error:**
```json
{
  "statusCode": 500,
  "body": "{
    \"success\": false,
    \"error\": {
      \"code\": \"EMBEDDING_ERROR\",
      \"message\": \"Failed to generate embedding: Image format not supported\"
    }
  }"
}
```

### Invoke from CLI

```bash
# Invoke with S3 URL
aws lambda invoke \
  --function-name cis-image-embedding \
  --payload '{"imageUrl":"s3://bucket/image.jpg"}' \
  response.json

# View response
cat response.json | jq '.body | fromjson | .data.embedding | length'
# Output: 512
```

### Invoke from Python

```python
import boto3
import json

lambda_client = boto3.client('lambda')

def generate_embedding(image_url: str) -> list:
    response = lambda_client.invoke(
        FunctionName='cis-image-embedding',
        InvocationType='RequestResponse',
        Payload=json.dumps({
            'imageUrl': image_url,
            'useCache': True
        })
    )

    payload = json.loads(response['Payload'].read())
    body = json.loads(payload['body'])

    return body['data']['embedding']

# Usage
embedding = generate_embedding('s3://bucket/photo.jpg')
print(f"Generated {len(embedding)}-dimensional embedding")
```

### Invoke from Node.js

```typescript
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: 'ap-northeast-1' });

async function generateEmbedding(imageUrl: string): Promise<number[]> {
  const command = new InvokeCommand({
    FunctionName: 'cis-image-embedding',
    Payload: Buffer.from(JSON.stringify({
      imageUrl,
      useCache: true,
    })),
  });

  const response = await lambdaClient.send(command);
  const payload = JSON.parse(Buffer.from(response.Payload!).toString());
  const body = JSON.parse(payload.body);

  return body.data.embedding;
}

// Usage
const embedding = await generateEmbedding('s3://bucket/photo.jpg');
console.log(`Generated ${embedding.length}-dimensional embedding`);
```

## CLIP Model

### Model Details

- **Name**: CLIP ViT-B/32
- **Architecture**: Vision Transformer (ViT)
- **Input**: Images (any size, auto-resized to 224x224)
- **Output**: 512-dimensional vector
- **Training**: Trained on 400M image-text pairs
- **License**: MIT

### Model Performance

| Metric | Value |
|--------|-------|
| Model Size | ~600 MB |
| Inference Time (CPU) | 1-2 seconds |
| Inference Time (GPU) | 0.1-0.2 seconds |
| Embedding Dimension | 512 |
| Image Resolution | 224x224 |

### Supported Image Formats

- JPEG / JPG
- PNG
- GIF
- BMP
- TIFF
- WebP

## Caching

### DynamoDB Cache Structure

```python
{
  'image_hash': 'abc123...',       # MD5 hash of image data (Partition Key)
  'embedding': [0.1, 0.2, ...],    # 512-dimensional vector
  'dimension': 512,
  'model': 'openai/clip-vit-base-patch32',
  'created_at': 1705315200,        # Unix timestamp
  'ttl': 1707907200                # TTL for auto-deletion (30 days)
}
```

### Cache Benefits

- **Performance**: < 100ms for cache hits vs 2s for cache misses
- **Cost Savings**: Reduce Lambda invocations by ~80%
- **Consistency**: Same embedding for same image

### Cache Invalidation

Cache entries automatically expire after 30 days. To manually clear cache:

```bash
aws dynamodb delete-item \
  --table-name cis-image-embedding-cache \
  --key '{"image_hash": {"S": "abc123..."}}'
```

## Performance Optimization

### Cold Start Optimization

1. **Pre-load Model in Docker Image** (done in Dockerfile)
2. **Use Provisioned Concurrency** (for consistent latency)
3. **Increase Memory** (more memory = more CPU)

```bash
# Enable provisioned concurrency
aws lambda put-provisioned-concurrency-config \
  --function-name cis-image-embedding \
  --provisioned-concurrent-executions 2
```

### Inference Optimization

1. **Use GPU** (if available via Lambda container)
2. **Batch Processing** (for multiple images)
3. **Model Quantization** (reduce model size)

### Cost Optimization

1. **Use ARM64 Architecture** (20% cost savings)
```bash
# In Dockerfile, change to:
FROM public.ecr.aws/lambda/python:3.11-arm64
```

2. **Adjust Memory** (balance cost vs performance)
```bash
# Test different memory settings
aws lambda update-function-configuration \
  --function-name cis-image-embedding \
  --memory-size 2048  # Try 1024, 2048, 3008
```

3. **Optimize Cache Hit Rate** (longer TTL)

## Monitoring

### CloudWatch Metrics

Key metrics:
- **Invocations**: Total requests
- **Duration**: Execution time (target: < 2s p95)
- **Errors**: Failed invocations
- **Throttles**: Rate limit hits
- **ConcurrentExecutions**: Concurrent requests

### Custom Logs

Structured JSON logs:

```json
{
  "level": "INFO",
  "message": "Generated embedding",
  "dimension": 512,
  "inference_time": 1.234,
  "cached": false,
  "image_hash": "abc123"
}
```

### CloudWatch Alarms

```bash
# High error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name cis-image-embedding-errors \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=cis-image-embedding

# High duration alarm
aws cloudwatch put-metric-alarm \
  --alarm-name cis-image-embedding-duration \
  --metric-name Duration \
  --namespace AWS/Lambda \
  --statistic Average \
  --period 300 \
  --threshold 5000 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=cis-image-embedding
```

## Troubleshooting

### Common Issues

**Issue:** Lambda timeout after 60 seconds
**Solution:**
- Check image size (max 10 MB)
- Verify S3 permissions
- Increase Lambda timeout to 90s

**Issue:** Out of memory error
**Solution:**
- Increase memory to 5120 MB
- Reduce MAX_IMAGE_SIZE
- Clear /tmp directory

**Issue:** Model loading failed
**Solution:**
- Check internet connectivity (NAT Gateway)
- Verify model name
- Use pre-built Docker image with cached model

**Issue:** Low cache hit rate
**Solution:**
- Verify DynamoDB permissions
- Check cache table exists
- Increase TTL for longer caching

### Debug Mode

```python
# Add to handler.py for debugging
import logging
logging.basicConfig(level=logging.DEBUG)
```

## Development

### Local Testing

```bash
# Install dependencies
pip install -r requirements.txt

# Test handler
python test_handler.py
```

### Docker Testing

```bash
# Build image
docker build -t cis-image-embedding .

# Run locally
docker run -p 9000:8080 cis-image-embedding

# Test with curl
curl -X POST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -d '{"imageUrl":"s3://bucket/test.jpg"}'
```

## Alternative Models

### ResNet50

- Dimension: 2048
- Faster inference
- Better for visual similarity

### DINO

- Dimension: 768
- Self-supervised learning
- Better for object detection

### Custom Fine-tuned Model

Train on domain-specific data for better accuracy.

## References

- [CLIP Paper](https://arxiv.org/abs/2103.00020)
- [HuggingFace CLIP](https://huggingface.co/openai/clip-vit-base-patch32)
- [AWS Lambda Container Images](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)

## License

MIT

## Support

- Issues: GitHub Issues
- Email: ml-team@cis-filesearch.com
- Slack: #ml-support
