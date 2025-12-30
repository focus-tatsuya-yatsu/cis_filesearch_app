#!/bin/bash

# AWS認証設定チェックスクリプト

echo "================================================"
echo "AWS認証設定チェック"
echo "================================================"

# 1. AWS CLIがインストールされているか確認
echo ""
echo "1. AWS CLIバージョン:"
aws --version

# 2. 設定ファイルの存在確認
echo ""
echo "2. 設定ファイルの確認:"
if [ -f ~/.aws/credentials ]; then
    echo "✅ ~/.aws/credentials が存在します"
else
    echo "❌ ~/.aws/credentials が存在しません"
fi

if [ -f ~/.aws/config ]; then
    echo "✅ ~/.aws/config が存在します"
else
    echo "❌ ~/.aws/config が存在しません"
fi

# 3. 現在の設定を確認（秘密情報はマスク）
echo ""
echo "3. 現在の設定:"
echo "Region: $(aws configure get region)"
echo "Output: $(aws configure get output)"
echo "Access Key ID: $(aws configure get aws_access_key_id | sed 's/\(.....\).*/\1***/')"

# 4. 認証テスト
echo ""
echo "4. AWS認証テスト:"
if aws sts get-caller-identity > /dev/null 2>&1; then
    echo "✅ 認証成功！"
    echo ""
    echo "アカウント情報:"
    aws sts get-caller-identity --output table
else
    echo "❌ 認証失敗"
    echo ""
    echo "エラー内容:"
    aws sts get-caller-identity
fi

echo ""
echo "================================================"
echo "次のステップ:"
echo "================================================"
if aws sts get-caller-identity > /dev/null 2>&1; then
    echo "✅ AWS認証が成功しています！"
    echo ""
    echo "Lambda関数をデプロイできます:"
    echo "  cd $(dirname $0)/.."
    echo "  ./scripts/deploy-with-existing-api-gateway.sh"
else
    echo "❌ AWS認証設定を完了してください:"
    echo ""
    echo "方法1: aws configure コマンドを実行"
    echo "方法2: ~/.aws/credentials ファイルを作成"
    echo ""
    echo "詳細は aws-configure-template.txt を参照してください"
fi
echo "================================================"