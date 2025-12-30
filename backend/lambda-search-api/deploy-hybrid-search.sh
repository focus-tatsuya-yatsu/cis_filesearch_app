#!/bin/bash
#
# デュアルインデックス・ハイブリッド検索デプロイスクリプト
#
# このスクリプトはLambda関数を更新し、ハイブリッド検索機能を有効にします
# - cis-files: テキスト検索用インデックス（10,000+ docs）
# - file-index-v2-knn: 画像ベクトル検索用インデックス（20+ docs）
#
# 実行方法:
#   bash deploy-hybrid-search.sh
#
# 前提条件:
#   - AWS CLIがインストールされている
#   - 適切なIAMクレデンシャルが設定されている
#   - Node.js 18.x以上がインストールされている
#

set -e  # エラー時に即座に終了

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 設定
FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-cis-search-api}"
REGION="${AWS_REGION:-ap-northeast-1}"
TIMEOUT="${LAMBDA_TIMEOUT:-30}"
MEMORY_SIZE="${LAMBDA_MEMORY_SIZE:-512}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  デュアルインデックス・ハイブリッド検索${NC}"
echo -e "${BLUE}  Lambda関数デプロイ${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Lambda関数名: ${GREEN}${FUNCTION_NAME}${NC}"
echo -e "リージョン: ${GREEN}${REGION}${NC}"
echo -e "タイムアウト: ${GREEN}${TIMEOUT}秒${NC}"
echo -e "メモリサイズ: ${GREEN}${MEMORY_SIZE}MB${NC}"
echo ""

# 前提条件チェック
echo -e "${YELLOW}📋 前提条件チェック...${NC}"

if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLIがインストールされていません${NC}"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.jsがインストールされていません${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npmがインストールされていません${NC}"
    exit 1
fi

# AWS認証情報チェック
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS認証情報が設定されていません${NC}"
    exit 1
fi

echo -e "${GREEN}✅ すべての前提条件が満たされています${NC}"
echo ""

# クリーンアップ
echo -e "${YELLOW}🧹 既存ビルドファイルのクリーンアップ...${NC}"
rm -rf dist/
rm -f function.zip
echo -e "${GREEN}✅ クリーンアップ完了${NC}"
echo ""

# 依存関係インストール
echo -e "${YELLOW}📦 依存関係のインストール...${NC}"
npm install --production=false
echo -e "${GREEN}✅ 依存関係インストール完了${NC}"
echo ""

# TypeScriptビルド
echo -e "${YELLOW}🔨 TypeScriptビルド...${NC}"
if [ -f "tsconfig.json" ]; then
    npm run build
else
    echo -e "${YELLOW}⚠️  tsconfig.jsonが見つかりません。tscを直接実行します${NC}"
    npx tsc
fi

if [ ! -d "dist" ]; then
    echo -e "${RED}❌ ビルドディレクトリ (dist/) が作成されませんでした${NC}"
    exit 1
fi

echo -e "${GREEN}✅ TypeScriptビルド完了${NC}"
echo ""

# 本番環境用の依存関係インストール
echo -e "${YELLOW}📦 本番環境用依存関係のインストール...${NC}"
npm install --production
echo -e "${GREEN}✅ 本番環境用依存関係インストール完了${NC}"
echo ""

# Lambda デプロイパッケージ作成
echo -e "${YELLOW}📦 Lambda デプロイパッケージ作成...${NC}"

# dist/ にnode_modulesをコピー
cp -r node_modules dist/

cd dist
zip -r -q ../function.zip .
cd ..

# パッケージサイズ確認
PACKAGE_SIZE=$(du -h function.zip | cut -f1)
echo -e "${GREEN}✅ デプロイパッケージ作成完了 (サイズ: ${PACKAGE_SIZE})${NC}"
echo ""

# Lambda関数の存在確認
echo -e "${YELLOW}🔍 Lambda関数の存在確認...${NC}"

if aws lambda get-function --function-name "${FUNCTION_NAME}" --region "${REGION}" &> /dev/null; then
    echo -e "${GREEN}✅ Lambda関数が見つかりました: ${FUNCTION_NAME}${NC}"
    FUNCTION_EXISTS=true
else
    echo -e "${YELLOW}⚠️  Lambda関数が見つかりません: ${FUNCTION_NAME}${NC}"
    echo -e "${YELLOW}   新規作成が必要です${NC}"
    FUNCTION_EXISTS=false
fi
echo ""

# Lambda関数の更新または作成
if [ "$FUNCTION_EXISTS" = true ]; then
    echo -e "${YELLOW}☁️  Lambda関数コード更新中...${NC}"

    aws lambda update-function-code \
      --function-name "${FUNCTION_NAME}" \
      --zip-file fileb://function.zip \
      --region "${REGION}" \
      > /dev/null

    echo -e "${GREEN}✅ Lambda関数コード更新完了${NC}"
    echo ""

    # 設定更新
    echo -e "${YELLOW}⚙️  Lambda関数設定更新中...${NC}"

    aws lambda update-function-configuration \
      --function-name "${FUNCTION_NAME}" \
      --timeout "${TIMEOUT}" \
      --memory-size "${MEMORY_SIZE}" \
      --region "${REGION}" \
      > /dev/null

    echo -e "${GREEN}✅ Lambda関数設定更新完了${NC}"
    echo ""
else
    echo -e "${RED}❌ Lambda関数が存在しません${NC}"
    echo -e "${YELLOW}   Terraformまたは手動で関数を作成してください${NC}"
    exit 1
fi

# デプロイ完了待機
echo -e "${YELLOW}⏳ デプロイ完了待機...${NC}"

aws lambda wait function-updated \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}"

echo -e "${GREEN}✅ デプロイ完了待機終了${NC}"
echo ""

# 関数情報表示
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  デプロイ完了！${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Lambda関数の最新情報取得
FUNCTION_INFO=$(aws lambda get-function --function-name "${FUNCTION_NAME}" --region "${REGION}")

FUNCTION_ARN=$(echo "${FUNCTION_INFO}" | jq -r '.Configuration.FunctionArn')
LAST_MODIFIED=$(echo "${FUNCTION_INFO}" | jq -r '.Configuration.LastModified')
RUNTIME=$(echo "${FUNCTION_INFO}" | jq -r '.Configuration.Runtime')
CODE_SIZE=$(echo "${FUNCTION_INFO}" | jq -r '.Configuration.CodeSize')

echo -e "関数ARN: ${GREEN}${FUNCTION_ARN}${NC}"
echo -e "ランタイム: ${GREEN}${RUNTIME}${NC}"
echo -e "最終更新: ${GREEN}${LAST_MODIFIED}${NC}"
echo -e "コードサイズ: ${GREEN}$((CODE_SIZE / 1024)) KB${NC}"
echo ""

# 検証コマンド表示
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  検証手順${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}1. ヘルスチェック:${NC}"
echo -e "   ${GREEN}bash verify-hybrid-search.sh health${NC}"
echo ""
echo -e "${YELLOW}2. テキスト検索テスト:${NC}"
echo -e "   ${GREEN}bash verify-hybrid-search.sh text${NC}"
echo ""
echo -e "${YELLOW}3. 画像検索テスト:${NC}"
echo -e "   ${GREEN}bash verify-hybrid-search.sh image${NC}"
echo ""
echo -e "${YELLOW}4. ハイブリッド検索テスト:${NC}"
echo -e "   ${GREEN}bash verify-hybrid-search.sh hybrid${NC}"
echo ""

# クリーンアップ
echo -e "${YELLOW}🧹 一時ファイルのクリーンアップ...${NC}"
rm -f function.zip
echo -e "${GREEN}✅ クリーンアップ完了${NC}"
echo ""

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  🎉 デプロイが正常に完了しました！${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
