#!/bin/bash
# 画像検索API診断スクリプト
# Usage: ./scripts/diagnose-image-search.sh

set -e

echo "====== 画像検索API診断スクリプト ======"
echo ""

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# 1. 環境変数チェック
echo "[1] 環境変数チェック"
if [ -f .env.local ]; then
    echo "✓ .env.localファイルが存在します"

    # AWS_ACCESS_KEY_IDチェック
    if grep -q "^AWS_ACCESS_KEY_ID=" .env.local; then
        AWS_KEY=$(grep "^AWS_ACCESS_KEY_ID=" .env.local | cut -d'=' -f2)
        if [ -n "$AWS_KEY" ]; then
            echo "✓ AWS_ACCESS_KEY_IDが設定されています (${AWS_KEY:0:10}...)"
        else
            echo "✗ AWS_ACCESS_KEY_IDが空です"
        fi
    else
        echo "✗ AWS_ACCESS_KEY_IDが未設定またはコメントアウトされています"
        echo "  → モックモードで動作します"
    fi

    # AWS_SECRET_ACCESS_KEYチェック
    if grep -q "^AWS_SECRET_ACCESS_KEY=" .env.local; then
        echo "✓ AWS_SECRET_ACCESS_KEYが設定されています"
    else
        echo "✗ AWS_SECRET_ACCESS_KEYが未設定またはコメントアウトされています"
        echo "  → モックモードで動作します"
    fi

    # AWSリージョンチェック
    if grep -q "^AWS_REGION=" .env.local; then
        REGION=$(grep "^AWS_REGION=" .env.local | cut -d'=' -f2)
        echo "  リージョン: $REGION"

        # Bedrock利用可能リージョンチェック
        case "$REGION" in
            us-east-1|us-west-2|ap-southeast-1|eu-central-1)
                echo "  ✓ Bedrock Titan Image Embeddingsが利用可能なリージョンです"
                ;;
            *)
                echo "  ⚠ このリージョンではBedrock Titan Image Embeddingsが利用できない可能性があります"
                echo "    推奨リージョン: us-east-1, us-west-2, ap-southeast-1, eu-central-1"
                ;;
        esac
    else
        echo "  リージョン: ap-northeast-1 (デフォルト)"
        echo "  ⚠ ap-northeast-1ではBedrock Titan Image Embeddingsが利用できない可能性があります"
    fi
else
    echo "✗ .env.localファイルが見つかりません"
    echo "  → .env.exampleをコピーして.env.localを作成してください"
fi

echo ""

# 2. Next.jsプロセスチェック
echo "[2] Next.jsサーバー状態"
if pgrep -f "next dev" > /dev/null; then
    echo "✓ Next.js開発サーバーが実行中です"

    # ポート3000の確認
    if lsof -i :3000 > /dev/null 2>&1; then
        echo "✓ ポート3000でリッスンしています"
    else
        echo "⚠ ポート3000でリッスンしていない可能性があります"
    fi
else
    echo "✗ Next.js開発サーバーが起動していません"
    echo "  → 'yarn dev' を実行してください"
fi

echo ""

# 3. APIエンドポイントテスト
echo "[3] APIエンドポイントテスト"
if command -v curl &> /dev/null; then
    # OPTIONSリクエスト(CORS Preflight)
    echo "  OPTIONSリクエストをテスト中..."
    OPTIONS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/image-embedding -X OPTIONS)

    if [ "$OPTIONS_STATUS" = "200" ]; then
        echo "  ✓ OPTIONS: $OPTIONS_STATUS (CORS Preflightが正常)"
    else
        echo "  ✗ OPTIONS: $OPTIONS_STATUS (CORSエラーの可能性)"
    fi

    # POSTリクエスト(画像なし)
    echo "  POSTリクエストをテスト中..."
    POST_RESPONSE=$(curl -s -X POST http://localhost:3000/api/image-embedding)

    if echo "$POST_RESPONSE" | grep -q "MISSING_IMAGE"; then
        echo "  ✓ POSTエンドポイントが応答しています (バリデーションが動作中)"
    else
        echo "  ⚠ 予期しないレスポンス: ${POST_RESPONSE:0:100}..."
    fi
else
    echo "⚠ curlコマンドが見つかりません"
fi

echo ""

# 4. 依存パッケージチェック
echo "[4] 依存パッケージチェック"
PACKAGES_OK=true

if [ -d "node_modules/@aws-sdk/client-bedrock-runtime" ]; then
    BEDROCK_VERSION=$(grep '"version"' node_modules/@aws-sdk/client-bedrock-runtime/package.json | head -1 | cut -d'"' -f4)
    echo "✓ @aws-sdk/client-bedrock-runtime@$BEDROCK_VERSION がインストールされています"
else
    echo "✗ @aws-sdk/client-bedrock-runtimeが見つかりません"
    PACKAGES_OK=false
fi

if [ -d "node_modules/@aws-sdk/credential-provider-node" ]; then
    CRED_VERSION=$(grep '"version"' node_modules/@aws-sdk/credential-provider-node/package.json | head -1 | cut -d'"' -f4)
    echo "✓ @aws-sdk/credential-provider-node@$CRED_VERSION がインストールされています"
else
    echo "✗ @aws-sdk/credential-provider-nodeが見つかりません"
    PACKAGES_OK=false
fi

if [ "$PACKAGES_OK" = false ]; then
    echo ""
    echo "  → 'yarn install' を実行してください"
fi

echo ""

# 5. ファイル構造チェック
echo "[5] APIルートファイルチェック"
if [ -f "src/app/api/image-embedding/route.ts" ]; then
    echo "✓ APIルートファイルが存在します"

    # モックモード機能の確認
    if grep -q "USE_MOCK_MODE" src/app/api/image-embedding/route.ts; then
        echo "  ✓ モックモード機能が実装されています"
    else
        echo "  ⚠ モックモード機能が見つかりません (古いバージョンの可能性)"
    fi

    # CORSヘッダー機能の確認
    if grep -q "createCorsResponse" src/app/api/image-embedding/route.ts; then
        echo "  ✓ CORSヘッダー関数が実装されています"
    else
        echo "  ⚠ CORSヘッダー関数が見つかりません"
    fi
else
    echo "✗ APIルートファイルが見つかりません"
    echo "  期待されるパス: src/app/api/image-embedding/route.ts"
fi

echo ""

# 6. 推奨事項
echo "[6] 推奨事項とトラブルシューティング"
echo ""

if [ ! -f .env.local ]; then
    echo "⚠ アクション必要:"
    echo "  1. .env.exampleを.env.localにコピー"
    echo "  2. AWS認証情報を設定(または モックモードで利用)"
elif ! grep -q "^AWS_ACCESS_KEY_ID=" .env.local; then
    echo "ℹ モックモードで動作中:"
    echo "  - AWS Bedrock呼び出しなし"
    echo "  - ランダムな1024次元ベクトルを生成"
    echo "  - 開発・テスト用途に適しています"
    echo ""
    echo "  本番モードを使用する場合:"
    echo "  1. .env.localにAWS_ACCESS_KEY_IDを設定"
    echo "  2. AWS_SECRET_ACCESS_KEYを設定"
    echo "  3. 利用可能なリージョンに変更 (us-west-2推奨)"
else
    echo "✓ 本番モードで設定されています"
    echo "  - AWS Bedrockを呼び出します"
    echo "  - IAMポリシーでbedrock:InvokeModel権限が必要です"
fi

echo ""
echo "詳細なトラブルシューティング:"
echo "  → /docs/image-search-troubleshooting-guide.md を参照"

echo ""
echo "====== 診断完了 ======"
