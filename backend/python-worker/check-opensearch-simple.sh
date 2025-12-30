#!/bin/bash
# OpenSearchデータ確認スクリプト（簡易版）

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  OpenSearchデータ確認（簡易版）  ${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# OpenSearchエンドポイント
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="file-metadata"

echo -e "${YELLOW}注意: VPC内からのアクセスが必要です${NC}"
echo ""

# 方法1: インスタンス経由でOpenSearchを確認
echo -e "${GREEN}方法1: EC2インスタンス経由でOpenSearchを確認${NC}"

# SSMコマンドでOpenSearchのステータスを確認
COMMAND_ID=$(aws ssm send-command \
    --instance-ids i-0e6ac1e4d535a4ab2 \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["curl -s -XGET \"'$OPENSEARCH_ENDPOINT'/'$INDEX_NAME'/_count\" 2>/dev/null | python3 -m json.tool"]' \
    --region $AWS_REGION \
    --output text \
    --query 'Command.CommandId' 2>/dev/null)

if [ -n "$COMMAND_ID" ]; then
    echo "コマンド実行中..."
    sleep 5

    # 結果取得
    RESULT=$(aws ssm get-command-invocation \
        --command-id $COMMAND_ID \
        --instance-id i-0e6ac1e4d535a4ab2 \
        --region $AWS_REGION \
        --output text \
        --query 'StandardOutputContent' 2>/dev/null)

    if [ -n "$RESULT" ]; then
        echo -e "${GREEN}✅ OpenSearchからの応答:${NC}"
        echo "$RESULT"

        # ドキュメント数を抽出
        DOC_COUNT=$(echo "$RESULT" | grep -o '"count":[0-9]*' | cut -d: -f2)
        if [ -n "$DOC_COUNT" ]; then
            echo ""
            echo -e "${BLUE}📊 インデックスされたドキュメント数: ${DOC_COUNT}${NC}"

            if [ "$DOC_COUNT" -gt 0 ]; then
                echo -e "${GREEN}✅ データが正常にインデックスされています！${NC}"
            else
                echo -e "${YELLOW}⚠️ まだデータがインデックスされていません${NC}"
            fi
        fi
    else
        echo -e "${RED}❌ OpenSearchからの応答を取得できませんでした${NC}"
    fi
else
    echo -e "${RED}❌ SSMコマンドの送信に失敗しました${NC}"
fi

echo ""

# 方法2: 最新のファイル一覧を取得
echo -e "${GREEN}方法2: 最新のインデックスされたファイル（上位5件）${NC}"

SEARCH_COMMAND_ID=$(aws ssm send-command \
    --instance-ids i-0e6ac1e4d535a4ab2 \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["curl -s -XPOST \"'$OPENSEARCH_ENDPOINT'/'$INDEX_NAME'/_search\" -H \"Content-Type: application/json\" -d '\''{ \"query\": { \"match_all\": {} }, \"size\": 5, \"sort\": [{ \"timestamp\": { \"order\": \"desc\", \"missing\": \"_last\" }}] }'\'' 2>/dev/null | python3 -m json.tool | grep -E \"file_name|file_type|file_path|is_docuworks\" | head -20"]' \
    --region $AWS_REGION \
    --output text \
    --query 'Command.CommandId' 2>/dev/null)

if [ -n "$SEARCH_COMMAND_ID" ]; then
    sleep 5

    SEARCH_RESULT=$(aws ssm get-command-invocation \
        --command-id $SEARCH_COMMAND_ID \
        --instance-id i-0e6ac1e4d535a4ab2 \
        --region $AWS_REGION \
        --output text \
        --query 'StandardOutputContent' 2>/dev/null)

    if [ -n "$SEARCH_RESULT" ]; then
        echo -e "${BLUE}📄 最新のファイル:${NC}"
        echo "$SEARCH_RESULT"

        # DocuWorksファイルの確認
        if echo "$SEARCH_RESULT" | grep -q "is_docuworks"; then
            echo ""
            echo -e "${GREEN}✅ DocuWorksファイルが検出されました！${NC}"
            echo "   紐付け情報も保存されています"
        fi
    fi
fi

echo ""
echo -e "${BLUE}======================================${NC}"
echo ""

# 方法3: Workerのログを確認
echo -e "${GREEN}方法3: Worker処理ログの確認${NC}"

LOG_COMMAND_ID=$(aws ssm send-command \
    --instance-ids i-0e6ac1e4d535a4ab2 \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["journalctl -u phased-worker -n 20 --no-pager | grep -E \"Indexed|DocuWorks|Processing|ERROR\""]' \
    --region $AWS_REGION \
    --output text \
    --query 'Command.CommandId' 2>/dev/null)

if [ -n "$LOG_COMMAND_ID" ]; then
    sleep 5

    LOG_RESULT=$(aws ssm get-command-invocation \
        --command-id $LOG_COMMAND_ID \
        --instance-id i-0e6ac1e4d535a4ab2 \
        --region $AWS_REGION \
        --output text \
        --query 'StandardOutputContent' 2>/dev/null)

    if [ -n "$LOG_RESULT" ]; then
        echo -e "${BLUE}📝 Worker処理ログ:${NC}"
        echo "$LOG_RESULT"
    else
        echo "ログが見つかりません"
    fi
fi

echo ""
echo -e "${YELLOW}💡 次のステップ:${NC}"
echo "1. フロントエンドから実際に検索してみる"
echo "2. DocuWorksファイル（.xdw）を検索して関連ファイルが表示されるか確認"
echo "3. 各種ファイル形式（PDF、Office、画像）で検索テスト"