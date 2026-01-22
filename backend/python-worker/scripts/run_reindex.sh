#!/bin/bash
# =============================================================================
# OpenSearch Re-index Script Runner
# =============================================================================
#
# このスクリプトはEC2インスタンス上で実行し、既存のOpenSearchドキュメントに
# category, nas_server, root_folder フィールドを追加します。
#
# 使用方法:
#   1. EC2にSSH接続
#   2. このスクリプトをダウンロードして実行
#      aws s3 cp s3://cis-filesearch-worker-scripts/scripts/run_reindex.sh ./
#      chmod +x run_reindex.sh
#      ./run_reindex.sh [dry-run|execute]
#
# =============================================================================

set -e

# Configuration
OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
SOURCE_INDEX="cis-files"
DEST_INDEX="cis-files-v2"
ALIAS_NAME="cis-files-alias"
REGION="ap-northeast-1"
BATCH_SIZE=1000

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}OpenSearch Re-index Script${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Check mode
MODE="${1:-dry-run}"
if [ "$MODE" != "dry-run" ] && [ "$MODE" != "execute" ]; then
    echo -e "${RED}Usage: $0 [dry-run|execute]${NC}"
    echo "  dry-run  - Simulate reindex without making changes (default)"
    echo "  execute  - Actually perform the reindex"
    exit 1
fi

echo "Mode: $MODE"
echo "Source Index: $SOURCE_INDEX"
echo "Destination Index: $DEST_INDEX"
echo "OpenSearch: $OPENSEARCH_ENDPOINT"
echo ""

# Step 1: Download reindex script from S3
echo -e "${YELLOW}Step 1: Downloading reindex script...${NC}"
SCRIPT_DIR="/home/ec2-user/reindex"
mkdir -p "$SCRIPT_DIR"
cd "$SCRIPT_DIR"

aws s3 cp s3://cis-filesearch-worker-scripts/scripts/reindex_with_category.py ./reindex_with_category.py --region $REGION
chmod +x reindex_with_category.py
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
count = client.count(index='cis-files')
print(f"Documents in cis-files: {count['count']:,}")
EOF
echo -e "${GREEN}✓ Connection successful${NC}"
echo ""

# Step 4: Run reindex
if [ "$MODE" == "dry-run" ]; then
    echo -e "${YELLOW}Step 4: Running DRY RUN (no changes will be made)...${NC}"
    python3 reindex_with_category.py \
        --endpoint "https://${OPENSEARCH_ENDPOINT}" \
        --source-index "$SOURCE_INDEX" \
        --dest-index "$DEST_INDEX" \
        --batch-size "$BATCH_SIZE" \
        --region "$REGION" \
        --dry-run

    echo ""
    echo -e "${GREEN}======================================${NC}"
    echo -e "${GREEN}DRY RUN COMPLETE${NC}"
    echo -e "${GREEN}======================================${NC}"
    echo ""
    echo "To execute the actual reindex, run:"
    echo -e "${YELLOW}  ./run_reindex.sh execute${NC}"
else
    echo -e "${YELLOW}Step 4: Executing ACTUAL reindex...${NC}"
    echo -e "${RED}WARNING: This will create a new index and modify data!${NC}"
    echo ""
    read -p "Are you sure you want to proceed? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        echo "Aborted."
        exit 1
    fi

    # Run in screen for long-running process
    if command -v screen &> /dev/null; then
        echo "Starting reindex in screen session 'reindex'..."
        screen -dmS reindex python3 reindex_with_category.py \
            --endpoint "https://${OPENSEARCH_ENDPOINT}" \
            --source-index "$SOURCE_INDEX" \
            --dest-index "$DEST_INDEX" \
            --batch-size "$BATCH_SIZE" \
            --region "$REGION" \
            --alias "$ALIAS_NAME"

        echo ""
        echo -e "${GREEN}Reindex started in background!${NC}"
        echo ""
        echo "To monitor progress:"
        echo "  screen -r reindex"
        echo ""
        echo "To detach from screen: Ctrl+A, then D"
    else
        echo "Running reindex (this may take 30-60 minutes)..."
        python3 reindex_with_category.py \
            --endpoint "https://${OPENSEARCH_ENDPOINT}" \
            --source-index "$SOURCE_INDEX" \
            --dest-index "$DEST_INDEX" \
            --batch-size "$BATCH_SIZE" \
            --region "$REGION" \
            --alias "$ALIAS_NAME"
    fi
fi

echo ""
echo "Done!"
