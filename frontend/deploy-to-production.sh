#!/bin/bash

echo "======================================"
echo "🚀 CISファイル検索 - 本番環境デプロイ"
echo "======================================"
echo ""

# 設定
BUCKET_NAME="cis-filesearch-s3-frontend"
DISTRIBUTION_ID="E3D6OBA51PGLC8"
PROFILE="AdministratorAccess-770923989980"
BUILD_DIR="out"

echo "📋 デプロイ設定:"
echo "  S3バケット: $BUCKET_NAME"
echo "  CloudFront ID: $DISTRIBUTION_ID"
echo "  ビルドディレクトリ: $BUILD_DIR"
echo ""

# ビルドディレクトリの確認
if [ ! -d "$BUILD_DIR" ]; then
    echo "❌ ビルドディレクトリが見つかりません: $BUILD_DIR"
    echo "   npm run build を実行してください"
    exit 1
fi

# ファイル数の確認
file_count=$(find "$BUILD_DIR" -type f | wc -l)
echo "📦 デプロイするファイル数: $file_count"
echo ""

echo "======================================"
echo "1️⃣ S3へのアップロード"
echo "======================================"

# HTMLファイル以外をアップロード（長期キャッシュ）
echo "📤 静的アセットをアップロード中..."
aws s3 sync "$BUILD_DIR/" "s3://$BUCKET_NAME/" \
    --profile "$PROFILE" \
    --delete \
    --cache-control "public,max-age=31536000,immutable" \
    --exclude "*.html" \
    --exclude "_next/static/chunks/pages/*" \
    --exclude "_next/static/css/*" 2>/dev/null

# HTMLファイルをアップロード（短期キャッシュ）
echo "📄 HTMLファイルをアップロード中..."
aws s3 sync "$BUILD_DIR/" "s3://$BUCKET_NAME/" \
    --profile "$PROFILE" \
    --delete \
    --cache-control "public,max-age=0,must-revalidate" \
    --exclude "*" \
    --include "*.html" 2>/dev/null

# CSSとJSチャンクファイル（中期キャッシュ）
echo "🎨 CSS/JSファイルをアップロード中..."
aws s3 sync "$BUILD_DIR/_next/static/" "s3://$BUCKET_NAME/_next/static/" \
    --profile "$PROFILE" \
    --cache-control "public,max-age=86400" 2>/dev/null

echo "✅ S3アップロード完了"
echo ""

echo "======================================"
echo "2️⃣ CloudFrontキャッシュのクリア"
echo "======================================"

echo "🔄 キャッシュ無効化を実行中..."
invalidation_id=$(aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*" \
    --profile "$PROFILE" \
    --query 'Invalidation.Id' \
    --output text)

if [ -n "$invalidation_id" ]; then
    echo "✅ 無効化リクエスト作成: $invalidation_id"

    # 無効化の進行状況を確認
    echo "⏳ 無効化の進行状況を確認中..."
    status=$(aws cloudfront get-invalidation \
        --distribution-id "$DISTRIBUTION_ID" \
        --id "$invalidation_id" \
        --profile "$PROFILE" \
        --query 'Invalidation.Status' \
        --output text)

    echo "   ステータス: $status"

    if [ "$status" == "InProgress" ]; then
        echo "   ※ キャッシュクリアには2-3分かかります"
    fi
else
    echo "⚠️ 無効化リクエストの作成に失敗しました"
fi

echo ""
echo "======================================"
echo "3️⃣ デプロイ検証"
echo "======================================"

# S3のファイル数を確認
s3_count=$(aws s3 ls "s3://$BUCKET_NAME/" --recursive --profile "$PROFILE" | wc -l)
echo "✅ S3にアップロードされたファイル数: $s3_count"

# CloudFrontのステータス確認
cf_status=$(aws cloudfront get-distribution \
    --id "$DISTRIBUTION_ID" \
    --profile "$PROFILE" \
    --query 'Distribution.Status' \
    --output text)
echo "✅ CloudFrontステータス: $cf_status"

echo ""
echo "======================================"
echo "4️⃣ アクセス確認"
echo "======================================"

echo "以下のURLでアクセス可能です:"
echo ""
echo "🌐 本番環境:"
echo "   https://cis-filesearch.com"
echo "   https://search.cis-filesearch.com"
echo ""
echo "🌐 CloudFront直接:"
echo "   https://d1xydnys7eha4b.cloudfront.net"
echo ""

# HTTPステータスの確認
echo "📡 接続テスト中..."
for url in "https://cis-filesearch.com" "https://search.cis-filesearch.com"; do
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
    if [ "$status_code" == "200" ]; then
        echo "   ✅ $url (Status: $status_code)"
    else
        echo "   ⚠️ $url (Status: $status_code)"
    fi
done

echo ""
echo "======================================"
echo "✅ デプロイ完了！"
echo "======================================"
echo ""
echo "📝 確認事項:"
echo "  1. https://cis-filesearch.com にアクセス"
echo "  2. 画像検索機能をテスト"
echo "  3. テキスト検索機能をテスト"
echo "  4. パフォーマンスを確認"
echo ""
echo "⚠️ 注意事項:"
echo "  - キャッシュクリアには2-3分かかります"
echo "  - 問題がある場合は数分待ってから再度アクセスしてください"
echo ""