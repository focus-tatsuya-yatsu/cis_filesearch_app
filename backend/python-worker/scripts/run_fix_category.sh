#!/bin/bash
# =============================================================================
# OpenSearch Missing Category Fix Script Runner
# =============================================================================
#
# このスクリプトはEC2インスタンス上で実行し、categoryが欠落しているドキュメントに
# category, nas_server, root_folder フィールドを追加します。
#
# 使用方法:
#   1. EC2にSSH接続（SSM Session Manager推奨）
#   2. このスクリプトをダウンロードして実行
#      aws s3 cp s3://cis-filesearch-worker-scripts/scripts/run_fix_category.sh ./
#      chmod +x run_fix_category.sh
#      ./run_fix_category.sh [count|dry-run|execute]
#
# =============================================================================

set -e

# Configuration
OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX="cis-files-v2"
REGION="ap-northeast-1"
BATCH_SIZE=500

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}OpenSearch Missing Category Fix${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Check mode
MODE="${1:-count}"
if [ "$MODE" != "count" ] && [ "$MODE" != "dry-run" ] && [ "$MODE" != "execute" ]; then
    echo -e "${RED}Usage: $0 [count|dry-run|execute]${NC}"
    echo "  count    - Only count documents needing fix (default)"
    echo "  dry-run  - Simulate fix without making changes"
    echo "  execute  - Actually fix the documents"
    exit 1
fi

echo "Mode: $MODE"
echo "Index: $INDEX"
echo "OpenSearch: $OPENSEARCH_ENDPOINT"
echo ""

# Step 1: Download fix script from S3
echo -e "${YELLOW}Step 1: Downloading fix script...${NC}"
SCRIPT_DIR="/home/ec2-user/fix_category"
mkdir -p "$SCRIPT_DIR"
cd "$SCRIPT_DIR"

aws s3 cp s3://cis-filesearch-worker-scripts/scripts/fix_missing_category.py ./fix_missing_category.py --region $REGION
chmod +x fix_missing_category.py
echo -e "${GREEN}✓ Script downloaded${NC}"
echo ""

# Step 2: Check Python dependencies
echo -e "${YELLOW}Step 2: Checking Python dependencies...${NC}"
python3 -c "import opensearchpy; import requests_aws4auth; import boto3" 2>/dev/null || {
    echo "Installing dependencies..."
    pip3 install opensearch-py requests-aws4auth boto3 --quiet
}
echo -e "${GREEN}✓ Dependencies ready${NC}"
echo ""

# Step 3: Test OpenSearch connection
echo -e "${YELLOW}Step 3: Testing OpenSearch connection...${NC}"
python3 << 'EOF'
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import os

endpoint = os.environ.get('OPENSEARCH_ENDPOINT', 'vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com')
region = 'ap-northeast-1'

credentials = boto3.Session().get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    region,
    'es',
    session_token=credentials.token
)

client = OpenSearch(
    hosts=[{'host': endpoint, 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    timeout=30
)

info = client.info()
print(f"Connected to cluster: {info['cluster_name']}")

# Get document count
count = client.count(index='cis-files-v2')
print(f"Total documents in cis-files-v2: {count['count']:,}")

# Count without category
without_cat = client.count(
    index='cis-files-v2',
    body={"query": {"bool": {"must_not": [{"exists": {"field": "category"}}]}}}
)
print(f"Documents WITHOUT category: {without_cat['count']:,}")
EOF
echo -e "${GREEN}✓ Connection successful${NC}"
echo ""

# Step 4: Run fix based on mode
if [ "$MODE" == "count" ]; then
    echo -e "${YELLOW}Step 4: Counting documents...${NC}"
    python3 fix_missing_category.py \
        --endpoint "https://${OPENSEARCH_ENDPOINT}" \
        --index "$INDEX" \
        --region "$REGION" \
        --count-only

elif [ "$MODE" == "dry-run" ]; then
    echo -e "${YELLOW}Step 4: Running DRY RUN (no changes will be made)...${NC}"
    python3 fix_missing_category.py \
        --endpoint "https://${OPENSEARCH_ENDPOINT}" \
        --index "$INDEX" \
        --batch-size "$BATCH_SIZE" \
        --region "$REGION" \
        --dry-run

    echo ""
    echo -e "${GREEN}======================================${NC}"
    echo -e "${GREEN}DRY RUN COMPLETE${NC}"
    echo -e "${GREEN}======================================${NC}"
    echo ""
    echo "To execute the actual fix, run:"
    echo -e "${YELLOW}  ./run_fix_category.sh execute${NC}"

else
    echo -e "${YELLOW}Step 4: Executing ACTUAL fix...${NC}"
    echo -e "${RED}WARNING: This will modify documents in the index!${NC}"
    echo ""
    read -p "Are you sure you want to proceed? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        echo "Aborted."
        exit 1
    fi

    # Run in screen for long-running process
    if command -v screen &> /dev/null; then
        echo "Starting fix in screen session 'fix_category'..."
        screen -dmS fix_category python3 fix_missing_category.py \
            --endpoint "https://${OPENSEARCH_ENDPOINT}" \
            --index "$INDEX" \
            --batch-size "$BATCH_SIZE" \
            --region "$REGION"

        echo ""
        echo -e "${GREEN}Fix started in background!${NC}"
        echo ""
        echo "To monitor progress:"
        echo "  screen -r fix_category"
        echo ""
        echo "To detach from screen: Ctrl+A, then D"
    else
        echo "Running fix (this may take several minutes)..."
        python3 fix_missing_category.py \
            --endpoint "https://${OPENSEARCH_ENDPOINT}" \
            --index "$INDEX" \
            --batch-size "$BATCH_SIZE" \
            --region "$REGION"
    fi
fi

echo ""
echo "Done!"
