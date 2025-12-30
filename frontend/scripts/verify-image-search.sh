#!/bin/bash
# 画像検索機能の検証スクリプト
# すべてのコンポーネントが正しく動作しているかを確認

set -e

echo "=== Image Search Verification Script ==="
echo ""

# 色付きの出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

success_count=0
fail_count=0

# 環境変数チェック
echo "1. Checking environment variables..."
if [ -z "$OPENSEARCH_ENDPOINT" ]; then
  echo -e "${RED}✗ OPENSEARCH_ENDPOINT is not set${NC}"
  ((fail_count++))
else
  echo -e "${GREEN}✓ OPENSEARCH_ENDPOINT: $OPENSEARCH_ENDPOINT${NC}"
  ((success_count++))
fi

if [ -z "$OPENSEARCH_INDEX" ]; then
  echo -e "${RED}✗ OPENSEARCH_INDEX is not set${NC}"
  ((fail_count++))
else
  echo -e "${GREEN}✓ OPENSEARCH_INDEX: $OPENSEARCH_INDEX${NC}"
  ((success_count++))
fi

if [ -z "$AWS_REGION" ]; then
  echo -e "${RED}✗ AWS_REGION is not set${NC}"
  ((fail_count++))
else
  echo -e "${GREEN}✓ AWS_REGION: $AWS_REGION${NC}"
  ((success_count++))
fi

if [ -z "$S3_BUCKET_NAME" ]; then
  echo -e "${RED}✗ S3_BUCKET_NAME is not set${NC}"
  ((fail_count++))
else
  echo -e "${GREEN}✓ S3_BUCKET_NAME: $S3_BUCKET_NAME${NC}"
  ((success_count++))
fi

echo ""

# AWS認証情報チェック
echo "2. Checking AWS credentials..."
if aws sts get-caller-identity > /dev/null 2>&1; then
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  echo -e "${GREEN}✓ AWS credentials valid (Account: $ACCOUNT_ID)${NC}"
  ((success_count++))
else
  echo -e "${RED}✗ AWS credentials are not configured${NC}"
  ((fail_count++))
fi

echo ""

# OpenSearchインデックス確認
echo "3. Checking OpenSearch index..."
INDEX_EXISTS=$(aws opensearch describe-domain --domain-name cis-filesearch-opensearch --region $AWS_REGION --query 'DomainStatus.Endpoint' --output text 2>/dev/null || echo "not_found")

if [ "$INDEX_EXISTS" != "not_found" ]; then
  echo -e "${GREEN}✓ OpenSearch domain exists${NC}"
  ((success_count++))
else
  echo -e "${RED}✗ OpenSearch domain not found${NC}"
  ((fail_count++))
fi

echo ""

# S3バケット確認
echo "4. Checking S3 bucket..."
if aws s3 ls "s3://$S3_BUCKET_NAME" > /dev/null 2>&1; then
  OBJECT_COUNT=$(aws s3 ls "s3://$S3_BUCKET_NAME/thumbnails/" --recursive | wc -l)
  echo -e "${GREEN}✓ S3 bucket accessible ($OBJECT_COUNT objects in thumbnails/)${NC}"
  ((success_count++))
else
  echo -e "${RED}✗ S3 bucket not accessible${NC}"
  ((fail_count++))
fi

echo ""

# Lambda関数確認
echo "5. Checking Lambda function..."
LAMBDA_EXISTS=$(aws lambda get-function --function-name cis-search-api --region $AWS_REGION --query 'Configuration.FunctionName' --output text 2>/dev/null || echo "not_found")

if [ "$LAMBDA_EXISTS" != "not_found" ]; then
  LAST_MODIFIED=$(aws lambda get-function --function-name cis-search-api --region $AWS_REGION --query 'Configuration.LastModified' --output text)
  echo -e "${GREEN}✓ Lambda function exists (Last modified: $LAST_MODIFIED)${NC}"
  ((success_count++))
else
  echo -e "${RED}✗ Lambda function not found${NC}"
  ((fail_count++))
fi

echo ""

# API エンドポイント確認
echo "6. Checking API endpoints..."

# /api/image-embedding
echo "  - Checking /api/image-embedding..."
if [ -f "src/app/api/image-embedding/route.ts" ]; then
  echo -e "    ${GREEN}✓ Route file exists${NC}"
  ((success_count++))
else
  echo -e "    ${RED}✗ Route file missing${NC}"
  ((fail_count++))
fi

# /api/save-image-embedding
echo "  - Checking /api/save-image-embedding..."
if [ -f "src/app/api/save-image-embedding/route.ts" ]; then
  echo -e "    ${GREEN}✓ Route file exists${NC}"
  ((success_count++))
else
  echo -e "    ${RED}✗ Route file missing${NC}"
  ((fail_count++))
fi

# /api/batch-process-images
echo "  - Checking /api/batch-process-images..."
if [ -f "src/app/api/batch-process-images/route.ts" ]; then
  echo -e "    ${GREEN}✓ Route file exists${NC}"
  ((success_count++))
else
  echo -e "    ${RED}✗ Route file missing${NC}"
  ((fail_count++))
fi

echo ""

# サービスファイル確認
echo "7. Checking service files..."

# batch-process-images.ts
if [ -f "src/services/batch-process-images.ts" ]; then
  echo -e "  ${GREEN}✓ batch-process-images.ts exists${NC}"
  ((success_count++))
else
  echo -e "  ${RED}✗ batch-process-images.ts missing${NC}"
  ((fail_count++))
fi

echo ""

# OpenSearchライブラリ確認
echo "8. Checking OpenSearch library updates..."

if grep -q "updateDocumentImageEmbedding" src/lib/opensearch.ts; then
  echo -e "  ${GREEN}✓ updateDocumentImageEmbedding function exists${NC}"
  ((success_count++))
else
  echo -e "  ${RED}✗ updateDocumentImageEmbedding function missing${NC}"
  ((fail_count++))
fi

if grep -q "batchUpdateImageEmbeddings" src/lib/opensearch.ts; then
  echo -e "  ${GREEN}✓ batchUpdateImageEmbeddings function exists${NC}"
  ((success_count++))
else
  echo -e "  ${RED}✗ batchUpdateImageEmbeddings function missing${NC}"
  ((fail_count++))
fi

echo ""

# Lambda関数の更新確認
echo "9. Checking Lambda function implementation..."

LAMBDA_SERVICE_FILE="../backend/lambda-search-api/src/services/opensearch.service.enhanced.ts"
if [ -f "$LAMBDA_SERVICE_FILE" ]; then
  if grep -q "script_score" "$LAMBDA_SERVICE_FILE"; then
    echo -e "  ${GREEN}✓ KNN search optimization implemented${NC}"
    ((success_count++))
  else
    echo -e "  ${RED}✗ KNN search optimization not found${NC}"
    ((fail_count++))
  fi
else
  echo -e "  ${RED}✗ Lambda service file not found${NC}"
  ((fail_count++))
fi

echo ""

# 結果サマリー
echo "=== Verification Summary ==="
echo ""
echo -e "Passed: ${GREEN}$success_count${NC}"
echo -e "Failed: ${RED}$fail_count${NC}"
echo -e "Total:  $((success_count + fail_count))"
echo ""

if [ $fail_count -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed! Image search is ready to use.${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Run batch processing: npx ts-node src/services/batch-process-images.ts"
  echo "2. Deploy Lambda function: cd ../backend/lambda-search-api && ./scripts/quick-deploy.sh"
  echo "3. Test image search: See IMAGE_SEARCH_QUICKSTART.md"
  exit 0
else
  echo -e "${RED}✗ Some checks failed. Please review the errors above.${NC}"
  echo ""
  echo "Common fixes:"
  echo "1. Set environment variables: export OPENSEARCH_ENDPOINT=..."
  echo "2. Configure AWS credentials: aws configure"
  echo "3. Install dependencies: yarn install"
  exit 1
fi
