#!/bin/bash
#
# Lambda経由でDocuworksファイル分析を実行
# cis-search-api-prod Lambda関数を使用してOpenSearchにクエリを送信
#
# このスクリプトは分析用の専用Lambda関数を呼び出します
# 既存のsearch APIとは別のアプローチを使用
#

set -e

REGION="${AWS_REGION:-ap-northeast-1}"
LAMBDA_FUNCTION="cis-search-api-prod"

echo "============================================================"
echo "Lambda経由でDocuworks分析を実行"
echo "Lambda Function: $LAMBDA_FUNCTION"
echo "Region: $REGION"
echo "============================================================"

# 一時的に分析用のLambda関数を作成するか、
# 直接OpenSearchにアクセスするPythonスクリプトを使用

# 方法1: API Gateway経由で検索クエリを実行
API_ENDPOINT="https://rqntt5qbs0.execute-api.ap-northeast-1.amazonaws.com/prod"

echo ""
echo "[1/5] Docuworksファイル総数カウント"
echo "============================================================"

# .xdw ファイル検索
echo "Searching for .xdw files..."
XDW_RESULT=$(curl -s -X GET "$API_ENDPOINT/search?q=*.xdw&size=1&searchMode=filename" 2>/dev/null || echo '{"pagination":{"total":0}}')
XDW_COUNT=$(echo "$XDW_RESULT" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data.get('pagination',{}).get('total', data.get('total', 0)))" 2>/dev/null || echo "0")

echo "Searching for .xbd files..."
XBD_RESULT=$(curl -s -X GET "$API_ENDPOINT/search?q=*.xbd&size=1&searchMode=filename" 2>/dev/null || echo '{"pagination":{"total":0}}')
XBD_COUNT=$(echo "$XBD_RESULT" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data.get('pagination',{}).get('total', data.get('total', 0)))" 2>/dev/null || echo "0")

echo ""
echo ".xdw ファイル数: $XDW_COUNT"
echo ".xbd ファイル数: $XBD_COUNT"
echo "Docuworks総数: $((XDW_COUNT + XBD_COUNT))"

echo ""
echo "[2/5] サンプルレコードの取得"
echo "============================================================"

# サンプル .xdw ファイルを取得
echo "Fetching sample .xdw files..."
SAMPLE_XDW=$(curl -s -X GET "$API_ENDPOINT/search?q=.xdw&size=5&searchMode=filename" 2>/dev/null)

if [ -n "$SAMPLE_XDW" ]; then
    echo ""
    echo "サンプル .xdw ファイル:"
    echo "$SAMPLE_XDW" | python3 -c "
import sys,json
try:
    data = json.load(sys.stdin)
    results = data.get('results', [])
    for i, r in enumerate(results[:5], 1):
        print(f'  {i}. {r.get(\"file_name\", \"N/A\")}')
        print(f'     file_path: {r.get(\"file_path\", \"N/A\")}')
        print(f'     nas_path:  {r.get(\"nas_path\", \"N/A\")}')
        print(f'     s3_key:    {r.get(\"s3_key\", \"N/A\")}')
        print()
except Exception as e:
    print(f'Error parsing results: {e}')
" 2>/dev/null || echo "Error parsing sample results"
fi

echo ""
echo "[3/5] サーバー別検索"
echo "============================================================"

for SERVER in ts-server3 ts-server5 ts-server6 ts-server7; do
    echo "Searching for files in $SERVER..."
    RESULT=$(curl -s -X GET "$API_ENDPOINT/search?q=.xdw%20$SERVER&size=1&searchMode=filename" 2>/dev/null || echo '{"pagination":{"total":0}}')
    COUNT=$(echo "$RESULT" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data.get('pagination',{}).get('total', data.get('total', 0)))" 2>/dev/null || echo "0")
    echo "  $SERVER: $COUNT 件"
done

echo ""
echo "============================================================"
echo "分析完了（API Gateway経由）"
echo "============================================================"
echo ""
echo "注意: この分析はAPI Gateway経由の検索APIを使用しています。"
echo "より詳細な分析（破損パスの検出など）を行うには、"
echo "EC2インスタンスでPythonスクリプトを直接実行してください。"
echo ""
echo "EC2での実行方法:"
echo "  1. EC2にSSH接続: aws ssm start-session --target <instance-id>"
echo "  2. スクリプトをコピー: aws s3 cp s3://cis-filesearch-s3-landing/scripts/analyze-docuworks.py ."
echo "  3. 実行: python3 analyze-docuworks.py"
