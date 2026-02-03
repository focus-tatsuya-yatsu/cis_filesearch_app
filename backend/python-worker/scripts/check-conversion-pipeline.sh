#!/bin/bash
# 変換パイプライン状態確認スクリプト
# Docuworks → PDF 変換パイプラインの状態を確認します

set -e

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 設定
REGION="ap-northeast-1"
S3_LANDING_BUCKET="cis-filesearch-s3-landing"
S3_THUMBNAIL_BUCKET="cis-filesearch-s3-thumbnails"
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
OPENSEARCH_INDEX="cis-files"

log_section() { echo -e "\n${CYAN}========================================${NC}"; echo -e "${CYAN}$1${NC}"; echo -e "${CYAN}========================================${NC}\n"; }
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# メニュー表示
show_menu() {
    echo ""
    echo "変換パイプライン確認メニュー"
    echo "==============================="
    echo "1) S3 converted-pdf フォルダの状況確認"
    echo "2) CloudWatch ログでエラー確認"
    echo "3) OpenSearch インデックスの整合性確認"
    echo "4) すべて実行"
    echo "0) 終了"
    echo ""
    echo -n "選択してください: "
}

# 1. S3 converted-pdf フォルダの状況確認
check_s3_converted_pdf() {
    log_section "1. S3 converted-pdf フォルダの状況確認"

    log_info "Landing Bucket: ${S3_LANDING_BUCKET}"

    # converted-pdf フォルダ内のファイル数をカウント
    log_info "converted-pdf/ 内のファイル数を確認中..."

    PDF_COUNT=$(aws s3 ls "s3://${S3_LANDING_BUCKET}/converted-pdf/" --recursive --region ${REGION} 2>/dev/null | wc -l || echo "0")
    echo -e "  変換済みPDFファイル数: ${GREEN}${PDF_COUNT}${NC}"

    # 最近の変換ファイル（直近10件）
    log_info "最近の変換済みファイル（直近10件）:"
    aws s3 ls "s3://${S3_LANDING_BUCKET}/converted-pdf/" --recursive --region ${REGION} 2>/dev/null | sort -k1,2 -r | head -10 | while read line; do
        echo "  ${line}"
    done

    # Docuworks元ファイルの確認（サーバーごと）
    log_info "元のDocuworksファイル数（サーバー別）:"
    for server in ts-server3 ts-server5 ts-server6 ts-server7; do
        for category in road structure; do
            XDW_COUNT=$(aws s3 ls "s3://${S3_LANDING_BUCKET}/documents/${category}/${server}/" --recursive --region ${REGION} 2>/dev/null | grep -E '\.(xdw|xbd)$' | wc -l || echo "0")
            if [ "${XDW_COUNT}" -gt "0" ]; then
                echo "  ${category}/${server}: ${XDW_COUNT} files"
            fi
        done
    done

    # ファイルスキャナー経由のDocuworksファイル
    log_info "files/ プレフィックス内のDocuworksファイル数:"
    FILES_XDW_COUNT=$(aws s3 ls "s3://${S3_LANDING_BUCKET}/files/" --recursive --region ${REGION} 2>/dev/null | grep -E '\.(xdw|xbd)$' | wc -l || echo "0")
    echo "  files/: ${FILES_XDW_COUNT} files"

    # 変換待ち推定
    log_info "変換待ちファイル数（推定）:"
    TOTAL_XDW=0
    for prefix in "documents" "files"; do
        COUNT=$(aws s3 ls "s3://${S3_LANDING_BUCKET}/${prefix}/" --recursive --region ${REGION} 2>/dev/null | grep -E '\.(xdw|xbd)$' | wc -l || echo "0")
        TOTAL_XDW=$((TOTAL_XDW + COUNT))
    done
    PENDING=$((TOTAL_XDW - PDF_COUNT))
    if [ "${PENDING}" -lt "0" ]; then
        PENDING=0
    fi
    echo -e "  総Docuworksファイル: ${TOTAL_XDW}"
    echo -e "  変換済み: ${PDF_COUNT}"
    echo -e "  変換待ち（推定）: ${YELLOW}${PENDING}${NC}"
}

# 2. CloudWatch ログでエラー確認
check_cloudwatch_logs() {
    log_section "2. CloudWatch ログでエラー確認"

    # 変換関連のログストリーム確認
    LOG_GROUPS=(
        "/aws/ec2/file-processor"
        "/aws/lambda/cis-filesearch-docuworks-converter"
        "/aws/ec2/docuworks-converter"
    )

    for LOG_GROUP in "${LOG_GROUPS[@]}"; do
        log_info "ログ確認: ${LOG_GROUP}"

        # ログストリームが存在するか確認
        EXISTS=$(aws logs describe-log-groups --log-group-name-prefix "${LOG_GROUP}" --region ${REGION} --query 'logGroups[0].logGroupName' --output text 2>/dev/null || echo "None")

        if [ "${EXISTS}" = "None" ] || [ -z "${EXISTS}" ]; then
            log_warning "  ログストリームが見つかりません"
            continue
        fi

        # 直近24時間のエラー数
        START_TIME=$(($(date +%s) - 86400))000
        END_TIME=$(date +%s)000

        ERROR_COUNT=$(aws logs filter-log-events \
            --log-group-name "${LOG_GROUP}" \
            --start-time ${START_TIME} \
            --end-time ${END_TIME} \
            --filter-pattern "ERROR" \
            --region ${REGION} \
            --query 'events | length(@)' \
            --output text 2>/dev/null || echo "0")

        if [ "${ERROR_COUNT}" = "0" ] || [ -z "${ERROR_COUNT}" ]; then
            log_success "  直近24時間のエラー: 0件"
        else
            log_warning "  直近24時間のエラー: ${ERROR_COUNT}件"

            # 最新のエラー5件を表示
            log_info "  最新のエラー（5件）:"
            aws logs filter-log-events \
                --log-group-name "${LOG_GROUP}" \
                --start-time ${START_TIME} \
                --end-time ${END_TIME} \
                --filter-pattern "ERROR" \
                --region ${REGION} \
                --query 'events[-5:].message' \
                --output text 2>/dev/null | head -20 | while read line; do
                echo "    ${line:0:100}..."
            done
        fi

        # 変換成功件数
        SUCCESS_COUNT=$(aws logs filter-log-events \
            --log-group-name "${LOG_GROUP}" \
            --start-time ${START_TIME} \
            --end-time ${END_TIME} \
            --filter-pattern "converted" \
            --region ${REGION} \
            --query 'events | length(@)' \
            --output text 2>/dev/null || echo "0")

        if [ -n "${SUCCESS_COUNT}" ] && [ "${SUCCESS_COUNT}" != "0" ]; then
            log_success "  直近24時間の変換成功（推定）: ${SUCCESS_COUNT}件"
        fi

        echo ""
    done
}

# 3. OpenSearch インデックスの整合性確認
check_opensearch_index() {
    log_section "3. OpenSearch インデックスの整合性確認"

    log_info "OpenSearch Endpoint: ${OPENSEARCH_ENDPOINT}"
    log_info "Index: ${OPENSEARCH_INDEX}"

    log_warning "注意: OpenSearchはVPC内にあるため、EC2インスタンス経由でアクセスする必要があります"
    log_info "SSM経由で確認するには: ./ssm-connect.sh を使用してください"
    echo ""

    # SSM経由でクエリを実行するコマンドを生成
    cat << 'EOF'
以下のクエリをSSMセッション内で実行してください:

# 1. 総ドキュメント数
curl -s "${OPENSEARCH_ENDPOINT}/${OPENSEARCH_INDEX}/_count" | jq '.count'

# 2. Docuworksファイル数
curl -s -X POST "${OPENSEARCH_ENDPOINT}/${OPENSEARCH_INDEX}/_count" \
  -H "Content-Type: application/json" \
  -d '{"query":{"bool":{"should":[{"term":{"file_extension":".xdw"}},{"term":{"file_extension":".xbd"}}]}}}' | jq '.count'

# 3. nas_pathが設定されているDocuworksファイル数
curl -s -X POST "${OPENSEARCH_ENDPOINT}/${OPENSEARCH_INDEX}/_count" \
  -H "Content-Type: application/json" \
  -d '{"query":{"bool":{"must":[{"bool":{"should":[{"term":{"file_extension":".xdw"}},{"term":{"file_extension":".xbd"}}]}},{"exists":{"field":"nas_path"}}]}}}' | jq '.count'

# 4. nas_pathが空のドキュメント数
curl -s -X POST "${OPENSEARCH_ENDPOINT}/${OPENSEARCH_INDEX}/_count" \
  -H "Content-Type: application/json" \
  -d '{"query":{"bool":{"must_not":[{"exists":{"field":"nas_path"}}]}}}' | jq '.count'

# 5. preview_imagesが設定されているDocuworksファイル数
curl -s -X POST "${OPENSEARCH_ENDPOINT}/${OPENSEARCH_INDEX}/_count" \
  -H "Content-Type: application/json" \
  -d '{"query":{"bool":{"must":[{"bool":{"should":[{"term":{"file_extension":".xdw"}},{"term":{"file_extension":".xbd"}}]}},{"exists":{"field":"preview_images"}}]}}}' | jq '.count'
EOF

    echo ""
    log_info "または、以下のPythonスクリプトを使用:"
    log_info "  python scripts/check_opensearch_stats.py"
}

# すべて実行
run_all() {
    check_s3_converted_pdf
    check_cloudwatch_logs
    check_opensearch_index

    log_section "サマリー"
    log_info "変換パイプラインの状態確認が完了しました"
    log_info "問題がある場合は以下を確認してください:"
    echo "  1. Windows EC2 (Docuworks変換サービス) が稼働しているか"
    echo "  2. SQS変換キューにメッセージが滞留していないか"
    echo "  3. IAMロールの権限が正しいか"
}

# メイン処理
echo ""
echo "================================================"
echo "  Docuworks → PDF 変換パイプライン状態確認"
echo "================================================"

# AWS認証確認
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    log_error "AWS認証が無効です"
    exit 1
fi
log_success "AWS認証OK"

# 引数がある場合は直接実行
if [ $# -gt 0 ]; then
    case "$1" in
        1) check_s3_converted_pdf ;;
        2) check_cloudwatch_logs ;;
        3) check_opensearch_index ;;
        4|all) run_all ;;
        *) echo "Usage: $0 [1|2|3|4|all]"; exit 1 ;;
    esac
    exit 0
fi

# メニューモード
while true; do
    show_menu
    read choice

    case $choice in
        1) check_s3_converted_pdf ;;
        2) check_cloudwatch_logs ;;
        3) check_opensearch_index ;;
        4) run_all ;;
        0) echo "終了します"; exit 0 ;;
        *) log_error "無効な選択です" ;;
    esac

    echo ""
    read -p "Press Enter to continue..."
done
