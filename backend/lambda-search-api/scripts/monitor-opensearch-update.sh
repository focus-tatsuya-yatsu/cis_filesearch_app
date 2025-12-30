#!/bin/bash

# OpenSearchドメイン更新の監視スクリプト

DOMAIN_NAME="cis-filesearch-opensearch"
CHECK_INTERVAL=30  # 30秒ごとにチェック
MAX_WAIT_TIME=1200  # 最大20分待機

echo "======================================"
echo "OpenSearchドメイン更新監視"
echo "ドメイン: $DOMAIN_NAME"
echo "======================================"
echo ""

start_time=$(date +%s)

while true; do
    current_time=$(date +%s)
    elapsed=$((current_time - start_time))

    if [ $elapsed -gt $MAX_WAIT_TIME ]; then
        echo ""
        echo "❌ タイムアウト: ${MAX_WAIT_TIME}秒を超過しました"
        exit 1
    fi

    # ドメイン状態を取得
    processing=$(aws opensearch describe-domain \
        --domain-name "$DOMAIN_NAME" \
        --query 'DomainStatus.Processing' \
        --output text)

    if [ "$processing" = "False" ]; then
        echo ""
        echo "✅ 更新が完了しました！"
        echo ""

        # 最終状態を表示
        aws opensearch describe-domain \
            --domain-name "$DOMAIN_NAME" \
            --query 'DomainStatus.{Processing: Processing, AdvancedSecurityOptions: AdvancedSecurityOptions}' \
            --output json | jq .

        exit 0
    fi

    elapsed_minutes=$((elapsed / 60))
    elapsed_seconds=$((elapsed % 60))

    echo "⏳ 更新中... (経過時間: ${elapsed_minutes}分${elapsed_seconds}秒)"

    sleep $CHECK_INTERVAL
done
