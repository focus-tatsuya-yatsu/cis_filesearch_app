#!/bin/bash

# OpenSearch状態確認スクリプト（ローカル実行用）
# VPCエンドポイントへの接続はできませんが、環境設定を確認します

echo "================================================"
echo "OpenSearch 環境設定チェック"
echo "================================================"
echo ""

# 環境変数の確認
echo "1. 環境変数の確認:"
echo "-------------------"
echo "OPENSEARCH_ENDPOINT: ${OPENSEARCH_ENDPOINT:-未設定}"
echo "INDEX_NAME: ${INDEX_NAME:-未設定}"
echo "AWS_REGION: ${AWS_REGION:-未設定}"
echo ""

# 設定ファイルの確認
echo "2. 設定ファイルから抽出:"
echo "-------------------------"

# .envファイルから
if [ -f ".env" ]; then
    echo "📄 .env ファイル:"
    grep -E "OPENSEARCH|INDEX" .env 2>/dev/null | head -5
fi

# .env.localから
if [ -f ".env.local" ]; then
    echo ""
    echo "📄 .env.local ファイル:"
    grep -E "OPENSEARCH|INDEX" .env.local 2>/dev/null | head -5
fi

# プロジェクト全体から
echo ""
echo "3. プロジェクト全体の設定:"
echo "--------------------------"
echo "インデックス名候補:"
grep -r "cis-files\|file-index\|file_index" . \
  --include="*.env*" --include="*.ts" --include="*.js" 2>/dev/null | \
  grep -v node_modules | \
  cut -d: -f2 | sort -u | head -10

echo ""
echo "4. VPCエンドポイント接続テスト:"
echo "--------------------------------"
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

# タイムアウトを短くして接続テスト
if timeout 2 curl -s "$ENDPOINT" > /dev/null 2>&1; then
    echo "✅ 接続成功（おそらくVPC内から実行中）"
else
    echo "❌ 接続失敗（期待通り - VPC外からはアクセスできません）"
    echo ""
    echo "📝 解決方法:"
    echo "  1. EC2インスタンスから実行する"
    echo "  2. AWS Systems Manager Session Managerを使用する"
    echo "  3. VPNまたはDirect Connect経由で接続する"
fi

echo ""
echo "5. EC2インスタンス一覧（利用可能な接続先）:"
echo "-------------------------------------------"
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].[InstanceId,Tags[?Key==`Name`].Value|[0],State.Name,PrivateIpAddress]' \
  --output table 2>/dev/null || echo "AWS CLIが設定されていないか、権限がありません"

echo ""
echo "================================================"
echo "次のステップ:"
echo "================================================"
echo ""
echo "1. EC2インスタンスに接続:"
echo "   aws ssm start-session --target <INSTANCE_ID>"
echo ""
echo "2. EC2内でマイグレーション実行:"
echo "   export OPENSEARCH_ENDPOINT=\"$ENDPOINT\""
echo "   export OPENSEARCH_INDEX=\"file-index\"  # または正しいインデックス名"
echo "   curl -s \$OPENSEARCH_ENDPOINT/_cat/indices?v"
echo ""
echo "3. 修正スクリプトを実行"
echo ""