# OpenSearch k-NN Quick Reference for EC2

## Prerequisites

```bash
# Ensure you're on the EC2 instance
hostname  # Should show: ip-10-0-3-24 or similar

# Check AWS credentials
aws sts get-caller-identity

# Install required tools (if not already installed)
sudo yum install -y jq curl python3
```

## Quick Commands (Copy-Paste Ready)

### 1. Create k-NN Index

```bash
# Copy script to EC2
cat > /tmp/create-index.sh << 'EOF'
#!/bin/bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

curl -X PUT "${ENDPOINT}/cis-files" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d '{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 512,
      "number_of_shards": 2,
      "number_of_replicas": 1
    }
  },
  "mappings": {
    "properties": {
      "file_path": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
      "file_name": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
      "file_extension": { "type": "keyword" },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 512,
        "method": {
          "name": "hnsw",
          "space_type": "l2",
          "engine": "nmslib",
          "parameters": { "ef_construction": 512, "m": 16 }
        }
      }
    }
  }
}'
EOF

chmod +x /tmp/create-index.sh
/tmp/create-index.sh
```

### 2. Verify Index Created

```bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

# Check if index exists
curl -X GET "${ENDPOINT}/cis-files" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.'

# Check k-NN settings
curl -X GET "${ENDPOINT}/cis-files/_settings" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.["cis-files"].settings.index.knn'

# Check mapping
curl -X GET "${ENDPOINT}/cis-files/_mapping" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.["cis-files"].mappings.properties.image_embedding'
```

### 3. Index Sample Document with k-NN Vector

```bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

# Generate random 512-dimensional vector
VECTOR=$(python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')")

# Index document
curl -X POST "${ENDPOINT}/cis-files/_doc/1" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d "{
  \"file_name\": \"test_image.jpg\",
  \"file_path\": \"/home/user/images/test_image.jpg\",
  \"file_extension\": \"jpg\",
  \"image_embedding\": ${VECTOR}
}"

# Refresh index to make document searchable
curl -X POST "${ENDPOINT}/cis-files/_refresh" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"
```

### 4. Test k-NN Search

```bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

# Generate query vector
QUERY_VECTOR=$(python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')")

# Execute k-NN search
curl -X POST "${ENDPOINT}/cis-files/_search" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d "{
  \"size\": 5,
  \"query\": {
    \"knn\": {
      \"image_embedding\": {
        \"vector\": ${QUERY_VECTOR},
        \"k\": 5
      }
    }
  }
}" | jq '.hits.hits[] | {score: ._score, file: ._source.file_name}'
```

### 5. Check Document Count

```bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

curl -X GET "${ENDPOINT}/cis-files/_count" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.count'
```

### 6. Delete Index (if needed)

```bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

curl -X DELETE "${ENDPOINT}/cis-files" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"
```

## Using the Shell Scripts

```bash
# 1. Create index
bash /path/to/ec2-create-opensearch-knn-index.sh

# 2. Verify index
bash /path/to/ec2-verify-index.sh

# 3. Index sample data (10 documents)
bash /path/to/ec2-index-sample-data.sh 10

# 4. Test k-NN search
bash /path/to/ec2-test-knn-search.sh 5
```

## Troubleshooting

### Issue: "Connection refused" or timeout

```bash
# Check security group allows HTTPS (443) from EC2 instance
aws ec2 describe-security-groups --group-ids <opensearch-sg-id>

# Check VPC endpoint connectivity
curl -v https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com

# Verify EC2 is in correct VPC/subnet
aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2)
```

### Issue: "Access denied" or 403 error

```bash
# Check IAM role attached to EC2
aws sts get-caller-identity

# Verify OpenSearch access policy
aws opensearch describe-domain --domain-name cis-filesearch-opensearch
```

### Issue: k-NN search returns no results

```bash
# Check if documents have embeddings
curl -X GET "${ENDPOINT}/cis-files/_search?size=1" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  | jq '.hits.hits[0]._source.image_embedding | length'

# Should return 512 (the dimension size)
```

## Performance Optimization

```bash
# Adjust ef_search for better accuracy (higher = more accurate but slower)
curl -X PUT "${ENDPOINT}/cis-files/_settings" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d '{
  "index": {
    "knn.algo_param.ef_search": 1024
  }
}'

# Monitor index performance
curl -X GET "${ENDPOINT}/_cat/indices/cis-files?v&h=index,docs.count,store.size,search.query_time_in_millis" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"
```

## Next Steps

1. **Production Setup**: Update access policies, enable encryption, configure backup
2. **Integration**: Connect to Lambda for automated image embedding
3. **Monitoring**: Set up CloudWatch alarms for index health
4. **Scaling**: Adjust shard count based on data volume
