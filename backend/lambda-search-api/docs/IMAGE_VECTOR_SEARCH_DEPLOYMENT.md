# Image Vector Search Deployment Guide

## Prerequisites

- AWS CLI configured with appropriate credentials
- Docker installed (for building Lambda container images)
- Node.js 20.x and npm/yarn installed
- Python 3.11 installed (for testing embedding function)
- awscurl installed (for OpenSearch administration)

## Deployment Steps

### Phase 1: OpenSearch Configuration

#### 1.1 Enable k-NN Plugin

**Option A: Using AWS Console**
1. Navigate to Amazon OpenSearch Service
2. Select your domain: `cis-filesearch-opensearch`
3. Go to "Packages" tab
4. Enable the k-NN plugin if not already enabled
5. Wait for the domain to update (this may take 15-30 minutes)

**Option B: Using AWS CLI**
```bash
aws opensearch update-domain-config \
  --domain-name cis-filesearch-opensearch \
  --region ap-northeast-1 \
  --advanced-options '{"indices.query.bool.max_clause_count":"10000"}'
```

#### 1.2 Install awscurl

```bash
cd backend/lambda-search-api/scripts
./install-awscurl.sh

# Add to PATH if needed
export PATH=$PATH:~/.local/bin
```

#### 1.3 Configure Index Mapping

```bash
# Set environment variables
export OPENSEARCH_ENDPOINT="https://search-cis-filesearch-opensearch-xxx.ap-northeast-1.es.amazonaws.com"
export INDEX_NAME="cis-files"
export AWS_REGION="ap-northeast-1"

# Run setup script
cd backend/lambda-search-api/scripts
./setup-opensearch-knn.sh
```

**Expected Output:**
```
======================================
OpenSearch k-NN Setup
======================================
Endpoint: https://...
Index: cis-files
Region: ap-northeast-1
======================================

[1/5] Checking k-NN plugin status...
k-NN plugin is installed:
opensearch-knn

[2/5] Checking if index exists...
Index 'cis-files' does not exist. Will create.

[3/5] Creating index with k-NN enabled...
Index created successfully with k-NN mapping

[4/5] Verifying index configuration...
{
  "knn": "true",
  "knn_algo_param_ef_search": "512"
}

[5/5] Verifying index mapping...
{
  "image_embedding": {
    "type": "knn_vector",
    "dimension": 512
  }
}

Setup completed successfully!
```

#### 1.4 Verify OpenSearch Configuration

```bash
# Check cluster health
awscurl --service es --region ap-northeast-1 \
  "$OPENSEARCH_ENDPOINT/_cluster/health"

# Check index settings
awscurl --service es --region ap-northeast-1 \
  "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_settings"

# Check index mapping
awscurl --service es --region ap-northeast-1 \
  "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_mapping"
```

---

### Phase 2: DynamoDB Cache Table

#### 2.1 Create Embedding Cache Table

```bash
aws dynamodb create-table \
  --table-name cis-image-embedding-cache \
  --attribute-definitions \
    AttributeName=image_hash,AttributeType=S \
  --key-schema \
    AttributeName=image_hash,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --time-to-live-specification \
    Enabled=true,AttributeName=ttl \
  --region ap-northeast-1 \
  --tags Key=Project,Value=CIS-FileSearch Key=Component,Value=ImageEmbedding
```

#### 2.2 Verify Table Creation

```bash
aws dynamodb describe-table \
  --table-name cis-image-embedding-cache \
  --region ap-northeast-1 \
  --query 'Table.[TableName,TableStatus,ItemCount]' \
  --output table
```

---

### Phase 3: IAM Roles and Policies

#### 3.1 Create Image Embedding Lambda Role

Create file: `iam-image-embedding-role.json`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

```bash
# Create role
aws iam create-role \
  --role-name cis-image-embedding-lambda-role \
  --assume-role-policy-document file://iam-image-embedding-role.json

# Attach basic Lambda execution policy
aws iam attach-role-policy \
  --role-name cis-image-embedding-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Attach VPC execution policy (if using VPC)
aws iam attach-role-policy \
  --role-name cis-image-embedding-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
```

#### 3.2 Create Custom Policy

Create file: `iam-image-embedding-policy.json`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3ReadAccess",
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
      "Sid": "DynamoDBCacheAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:ap-northeast-1:*:table/cis-image-embedding-cache"
    },
    {
      "Sid": "OpenSearchAccess",
      "Effect": "Allow",
      "Action": [
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpGet"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-opensearch/*"
    }
  ]
}
```

```bash
# Create policy
aws iam create-policy \
  --policy-name cis-image-embedding-lambda-policy \
  --policy-document file://iam-image-embedding-policy.json

# Attach to role
aws iam attach-role-policy \
  --role-name cis-image-embedding-lambda-role \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/cis-image-embedding-lambda-policy
```

---

### Phase 4: Image Embedding Lambda Deployment

#### 4.1 Build and Push Docker Image

```bash
cd backend/lambda-image-embedding

# Set environment variables
export AWS_REGION="ap-northeast-1"
export AWS_ACCOUNT_ID="YOUR_ACCOUNT_ID"
export ECR_REPOSITORY="cis-image-embedding-lambda"
export FUNCTION_NAME="cis-image-embedding"

# Run deployment script
./deploy.sh
```

**Script will:**
1. Create ECR repository (if not exists)
2. Build Docker image with CLIP model
3. Push to ECR
4. Update Lambda function code

#### 4.2 Create Lambda Function (First Time Only)

If the function doesn't exist, create it first:

```bash
aws lambda create-function \
  --function-name cis-image-embedding \
  --package-type Image \
  --code ImageUri=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:latest \
  --role arn:aws:iam::$AWS_ACCOUNT_ID:role/cis-image-embedding-lambda-role \
  --memory-size 3008 \
  --timeout 60 \
  --environment Variables="{
    EMBEDDING_CACHE_TABLE=cis-image-embedding-cache,
    MODEL_NAME=openai/clip-vit-base-patch32,
    VECTOR_DIMENSION=512,
    MAX_IMAGE_SIZE=2048
  }" \
  --vpc-config SubnetIds=subnet-xxx,subnet-yyy,SecurityGroupIds=sg-xxx \
  --region $AWS_REGION
```

**Important VPC Configuration:**
- Use same VPC as OpenSearch domain
- Use private subnets with NAT Gateway
- Security group must allow outbound HTTPS (443)

#### 4.3 Configure Function

```bash
# Update memory and timeout
aws lambda update-function-configuration \
  --function-name cis-image-embedding \
  --memory-size 3008 \
  --timeout 60 \
  --region $AWS_REGION

# Configure reserved concurrency (optional)
aws lambda put-function-concurrency \
  --function-name cis-image-embedding \
  --reserved-concurrent-executions 10 \
  --region $AWS_REGION
```

#### 4.4 Test Image Embedding Function

Create test payload: `test-embedding.json`

```json
{
  "imageUrl": "s3://cis-filesearch-bucket/test-images/sample.jpg",
  "useCache": true
}
```

Invoke function:

```bash
aws lambda invoke \
  --function-name cis-image-embedding \
  --payload file://test-embedding.json \
  --region $AWS_REGION \
  response.json

# Check response
cat response.json | jq '.'
```

**Expected Response:**
```json
{
  "statusCode": 200,
  "body": "{\"success\":true,\"data\":{\"embedding\":[0.123,-0.456,...],\"dimension\":512,\"model\":\"openai/clip-vit-base-patch32\",\"inferenceTime\":1.234,\"cached\":false,\"imageHash\":\"abc123...\"}}"
}
```

---

### Phase 5: Update Search Lambda

#### 5.1 Update Dependencies

```bash
cd backend/lambda-search-api

# Add AWS SDK Lambda client
npm install @aws-sdk/client-lambda
```

#### 5.2 Update Environment Variables

```bash
aws lambda update-function-configuration \
  --function-name cis-search-api \
  --environment Variables="{
    OPENSEARCH_ENDPOINT=$OPENSEARCH_ENDPOINT,
    OPENSEARCH_INDEX=cis-files,
    AWS_REGION=ap-northeast-1,
    IMAGE_EMBEDDING_FUNCTION_NAME=cis-image-embedding,
    LOG_LEVEL=info
  }" \
  --region ap-northeast-1
```

#### 5.3 Update IAM Policy

Add Lambda invocation permission to search Lambda role:

```json
{
  "Sid": "InvokeEmbeddingLambda",
  "Effect": "Allow",
  "Action": [
    "lambda:InvokeFunction"
  ],
  "Resource": "arn:aws:lambda:ap-northeast-1:*:function:cis-image-embedding"
}
```

```bash
# Attach policy
aws iam put-role-policy \
  --role-name cis-search-api-lambda-role \
  --policy-name InvokeEmbeddingLambda \
  --policy-document file://lambda-invoke-policy.json
```

#### 5.4 Deploy Updated Search Lambda

```bash
cd backend/lambda-search-api

# Build TypeScript
npm run build

# Package and deploy
npm run deploy
```

#### 5.5 Test Vector Search

Create test request:

```bash
# Generate embedding first
EMBEDDING=$(aws lambda invoke \
  --function-name cis-image-embedding \
  --payload '{"imageUrl":"s3://cis-filesearch-bucket/test.jpg"}' \
  --region ap-northeast-1 \
  /dev/stdout | jq -r '.body | fromjson | .data.embedding')

# Search with embedding
curl -X GET "https://your-api-gateway-url/search?imageEmbedding=${EMBEDDING}&limit=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### Phase 6: Update EC2 Worker

#### 6.1 Install Python Dependencies on Worker

```bash
# SSH to EC2 worker instance
ssh ec2-user@ec2-worker-instance

# Install boto3 for Lambda invocation
pip3 install boto3
```

#### 6.2 Update Worker Script

Edit `/opt/cis-worker/worker.py`:

```python
import boto3

lambda_client = boto3.client('lambda', region_name='ap-northeast-1')

def process_image_file(s3_url, file_info):
    """
    Process image file and generate embedding
    """
    # Invoke image embedding Lambda
    response = lambda_client.invoke(
        FunctionName='cis-image-embedding',
        InvocationType='RequestResponse',
        Payload=json.dumps({
            'imageUrl': s3_url,
            'useCache': True
        })
    )

    payload = json.loads(response['Payload'].read())
    body = json.loads(payload['body'])

    if body['success']:
        embedding = body['data']['embedding']

        # Update OpenSearch document with embedding
        opensearch_client.update(
            index='cis-files',
            id=file_info['id'],
            body={
                'doc': {
                    'image_embedding': embedding,
                    'has_image_embedding': True
                }
            }
        )
```

#### 6.3 Update Worker IAM Role

Add Lambda invocation permission to EC2 worker role:

```bash
aws iam put-role-policy \
  --role-name cis-ec2-worker-role \
  --policy-name InvokeEmbeddingLambda \
  --policy-document file://lambda-invoke-policy.json
```

#### 6.4 Restart Worker Service

```bash
# On EC2 instance
sudo systemctl restart cis-worker
sudo systemctl status cis-worker
```

---

### Phase 7: Backfill Existing Images

#### 7.1 Create Backfill Script

Create `scripts/backfill-embeddings.py`:

```python
import boto3
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

opensearch_client = boto3.client('opensearchserverless')
lambda_client = boto3.client('lambda')

def get_all_image_documents():
    """Query OpenSearch for all image documents without embeddings"""
    # Implementation
    pass

def generate_and_update_embedding(doc):
    """Generate embedding and update document"""
    try:
        # Invoke Lambda
        response = lambda_client.invoke(
            FunctionName='cis-image-embedding',
            Payload=json.dumps({
                'imageUrl': doc['s3_url'],
                'useCache': True
            })
        )

        # Parse and update
        # ...

        return True
    except Exception as e:
        print(f"Error processing {doc['id']}: {e}")
        return False

def main():
    docs = get_all_image_documents()
    print(f"Found {len(docs)} images to process")

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(generate_and_update_embedding, doc) for doc in docs]

        completed = 0
        for future in as_completed(futures):
            completed += 1
            if completed % 100 == 0:
                print(f"Processed {completed}/{len(docs)}")

if __name__ == '__main__':
    main()
```

#### 7.2 Run Backfill

```bash
python3 scripts/backfill-embeddings.py
```

---

### Phase 8: Monitoring and Alerting

#### 8.1 Create CloudWatch Dashboard

```bash
aws cloudwatch put-dashboard \
  --dashboard-name cis-image-vector-search \
  --dashboard-body file://cloudwatch-dashboard.json
```

#### 8.2 Create CloudWatch Alarms

```bash
# High error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name cis-image-embedding-high-error-rate \
  --alarm-description "Image embedding Lambda error rate > 1%" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=cis-image-embedding

# High duration alarm
aws cloudwatch put-metric-alarm \
  --alarm-name cis-image-embedding-high-duration \
  --alarm-description "Image embedding Lambda duration > 5s" \
  --metric-name Duration \
  --namespace AWS/Lambda \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5000 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=cis-image-embedding
```

---

## Verification Checklist

### OpenSearch Verification

- [ ] k-NN plugin enabled and active
- [ ] Index mapping includes `image_embedding` field
- [ ] Index settings show `"knn": true`
- [ ] Test k-NN query returns results

### Lambda Verification

- [ ] Image embedding function deployed successfully
- [ ] Test invocation with sample image works
- [ ] Cache hit ratio > 0% after first run
- [ ] Average duration < 2 seconds
- [ ] No cold start issues (model pre-loaded)

### Search API Verification

- [ ] Text search still works (backward compatibility)
- [ ] Vector search returns relevant results
- [ ] Hybrid search (text + vector) works
- [ ] API response includes relevance scores
- [ ] Pagination works with vector search

### Worker Verification

- [ ] New image files automatically get embeddings
- [ ] Embeddings stored in OpenSearch
- [ ] Worker logs show successful embedding generation
- [ ] No worker errors or crashes

### Performance Verification

- [ ] Search latency < 500ms (p95)
- [ ] Embedding generation < 2s (p95)
- [ ] Cache hit ratio > 50% after initial period
- [ ] No OpenSearch CPU spikes

---

## Rollback Procedure

If issues occur, follow this rollback procedure:

### 1. Disable Vector Search in Frontend

```typescript
// Temporarily disable vector search UI
const ENABLE_VECTOR_SEARCH = false;
```

### 2. Revert Search Lambda

```bash
# Deploy previous version
aws lambda update-function-code \
  --function-name cis-search-api \
  --s3-bucket cis-lambda-deployments \
  --s3-key search-api/previous-version.zip
```

### 3. Revert OpenSearch Mapping (if needed)

```bash
# Note: Cannot remove fields from mapping
# But can stop indexing to them
```

### 4. Stop Worker Embedding Generation

```bash
# SSH to worker
sudo systemctl stop cis-worker

# Comment out embedding generation code
# Restart worker
sudo systemctl start cis-worker
```

---

## Troubleshooting

### Issue: Lambda Timeout

**Symptoms:**
- Lambda execution time > 60s
- Timeout errors in logs

**Solution:**
```bash
# Increase memory (more memory = more CPU)
aws lambda update-function-configuration \
  --function-name cis-image-embedding \
  --memory-size 5120 \
  --timeout 90
```

### Issue: High Costs

**Symptoms:**
- Lambda invocations too frequent
- High compute costs

**Solution:**
- Increase cache TTL in DynamoDB
- Implement request deduplication
- Use Lambda reserved concurrency

### Issue: Slow Search

**Symptoms:**
- k-NN search > 1s latency
- OpenSearch CPU high

**Solution:**
```bash
# Increase ef_search parameter
awscurl --service es --region ap-northeast-1 \
  -X PUT "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_settings" \
  -d '{"index.knn.algo_param.ef_search": 1024}'
```

### Issue: Low Accuracy

**Symptoms:**
- Irrelevant search results
- Low similarity scores

**Solution:**
- Adjust similarity threshold
- Try different embedding models
- Combine with text search (hybrid)

---

## Cost Optimization

### Lambda Optimization

1. **Provisioned Concurrency** (for consistent latency):
```bash
aws lambda put-provisioned-concurrency-config \
  --function-name cis-image-embedding \
  --provisioned-concurrent-executions 2
```

2. **ARM64 Architecture** (20% cost reduction):
```dockerfile
# In Dockerfile
FROM public.ecr.aws/lambda/python:3.11-arm64
```

### OpenSearch Optimization

1. Use Reserved Instances for predictable workloads
2. Enable UltraWarm for cold data
3. Adjust shard count based on data volume

### Caching Strategy

1. Increase DynamoDB cache TTL to 90 days
2. Implement CloudFront caching for search results
3. Use ElastiCache Redis for frequent queries

---

## Next Steps

1. **A/B Testing**: Compare search quality with/without vector search
2. **User Feedback**: Collect user ratings on search relevance
3. **Model Improvement**: Fine-tune CLIP model on domain-specific data
4. **Multi-Modal Search**: Combine text, image, and metadata
5. **Recommendation System**: Use embeddings for "similar files" feature

---

## Support Contacts

- **Infrastructure Issues**: ops-team@company.com
- **Search Quality Issues**: search-team@company.com
- **Billing Questions**: finance@company.com

## References

- [OpenSearch k-NN Plugin](https://opensearch.org/docs/latest/search-plugins/knn/)
- [AWS Lambda Container Images](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- [CLIP Model Documentation](https://github.com/openai/CLIP)
