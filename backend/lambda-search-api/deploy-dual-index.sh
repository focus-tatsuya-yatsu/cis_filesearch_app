#!/bin/bash

# デュアルインデックス対応Lambda関数のデプロイスクリプト

echo "==================================="
echo "デュアルインデックス Lambda デプロイ"
echo "==================================="

# カラー出力
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 1. 現在のLambda関数のバックアップ
echo ""
echo "📦 現在のLambda関数をバックアップ中..."
aws lambda get-function --function-name cis-search-api-prod \
  --query 'Configuration.CodeSha256' \
  --output text > backup-code-sha.txt

echo "バックアップSHA: $(cat backup-code-sha.txt)"

# 2. package.jsonの確認
echo ""
echo "📋 依存関係を確認中..."
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: package.json が見つかりません${NC}"
  exit 1
fi

# 3. node_modulesのインストール
echo ""
echo "📥 依存関係をインストール中..."
npm install --production

# 4. デプロイパッケージの作成
echo ""
echo "📦 デプロイパッケージを作成中..."
rm -f lambda-dual-index.zip

# index-dual.jsをindex.jsとしてコピー
cp index-dual.js index.js

# ZIPファイル作成
zip -r lambda-dual-index.zip . \
  -x "*.git*" \
  -x "*.md" \
  -x "test/*" \
  -x "*.test.js" \
  -x "index-dual.js" \
  -x "*.sh" \
  -x "backup-*"

# 元のindex.jsを復元（もし存在した場合）
if [ -f "index.original.js" ]; then
  mv index.original.js index.js
fi

# 5. Lambda関数の更新
echo ""
echo "🚀 Lambda関数を更新中..."
UPDATE_RESULT=$(aws lambda update-function-code \
  --function-name cis-search-api-prod \
  --zip-file fileb://lambda-dual-index.zip \
  --output json 2>&1)

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Lambda関数のコード更新成功${NC}"

  # 更新ステータスの確認
  echo ""
  echo "⏳ 更新ステータスを確認中..."
  sleep 5

  STATUS=$(aws lambda get-function \
    --function-name cis-search-api-prod \
    --query 'Configuration.LastUpdateStatus' \
    --output text)

  echo "更新ステータス: $STATUS"

  # 6. 環境変数の確認
  echo ""
  echo "🔍 環境変数を確認中..."
  aws lambda get-function-configuration \
    --function-name cis-search-api-prod \
    --query 'Environment.Variables' \
    --output json | jq '.'

  echo ""
  echo -e "${GREEN}==================================="
  echo "デプロイ完了！"
  echo "===================================${NC}"
  echo ""
  echo "📝 次のステップ:"
  echo "1. http://localhost:3000 でテキスト検索をテスト"
  echo "2. 画像をアップロードして画像検索をテスト"
  echo ""
  echo "🔄 ロールバックが必要な場合:"
  echo "aws lambda update-function-code \\"
  echo "  --function-name cis-search-api-prod \\"
  echo "  --s3-bucket <backup-bucket> \\"
  echo "  --s3-key <backup-key>"

else
  echo -e "${RED}❌ Lambda関数の更新に失敗しました${NC}"
  echo "$UPDATE_RESULT"
  exit 1
fi

# 7. テスト実行（オプション）
echo ""
read -p "テスト実行しますか？ (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "🧪 テキスト検索のテスト..."
  aws lambda invoke \
    --function-name cis-search-api-prod \
    --payload "$(echo '{"body":"{\"query\":\"test\",\"searchType\":\"text\"}"}' | base64)" \
    test-result.json

  echo "テスト結果:"
  cat test-result.json | jq '.body' | jq -r '.' | jq '.'

  echo ""
  echo "🧪 画像検索のテスト（モックベクター使用）..."
  MOCK_VECTOR=$(python3 -c "import json; import random; print(json.dumps([random.random() for _ in range(1024)]))")

  aws lambda invoke \
    --function-name cis-search-api-prod \
    --payload "$(echo "{\"body\":\"{\\\"searchType\\\":\\\"image\\\",\\\"imageVector\\\":$MOCK_VECTOR}\"}" | base64)" \
    test-image-result.json

  echo "画像検索テスト結果:"
  cat test-image-result.json | jq '.body' | jq -r '.' | jq '.data.searchType'
fi