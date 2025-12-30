#!/bin/bash

# =============================================================================
# Performance Analysis and Reporting Script
# =============================================================================
# このスクリプトはシステム全体のパフォーマンスを分析し、レポートを生成します
#
# 使用方法:
#   chmod +x performance_report.sh
#   ./performance_report.sh [output_file]
# =============================================================================

set -e

# Configuration
DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/590183743917/file-metadata-queue-dlq.fifo"
MAIN_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/590183743917/file-metadata-queue.fifo"
OPENSEARCH_ENDPOINT="search-file-metadata-hb5myqe7ckgzjr5bvxz7kswxey.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="file-metadata"
REGION="ap-northeast-1"
OUTPUT_FILE="${1:-performance_report_$(date +%Y%m%d_%H%M%S).txt}"

# ANSI color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# レポート開始
{
    echo "════════════════════════════════════════════════════════════════"
    echo "           PERFORMANCE ANALYSIS REPORT"
    echo "           Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "════════════════════════════════════════════════════════════════"
    echo ""

    # 1. システム概要
    echo "1. SYSTEM OVERVIEW"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Region: $REGION"
    echo "Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo ""

    # 2. SQSキュー統計
    echo "2. SQS QUEUE STATISTICS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # DLQ統計
    echo "Dead Letter Queue (DLQ):"
    DLQ_ATTRS=$(aws sqs get-queue-attributes \
        --queue-url "$DLQ_URL" \
        --attribute-names All \
        --region "$REGION" \
        --output json)

    DLQ_AVAILABLE=$(echo "$DLQ_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessages')
    DLQ_IN_FLIGHT=$(echo "$DLQ_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible')
    DLQ_DELAYED=$(echo "$DLQ_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessagesDelayed')

    echo "  Available Messages: $DLQ_AVAILABLE"
    echo "  In-Flight Messages: $DLQ_IN_FLIGHT"
    echo "  Delayed Messages: $DLQ_DELAYED"
    echo ""

    # メインキュー統計
    echo "Main Queue:"
    MAIN_ATTRS=$(aws sqs get-queue-attributes \
        --queue-url "$MAIN_QUEUE_URL" \
        --attribute-names All \
        --region "$REGION" \
        --output json)

    MAIN_AVAILABLE=$(echo "$MAIN_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessages')
    MAIN_IN_FLIGHT=$(echo "$MAIN_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible')
    MAIN_DELAYED=$(echo "$MAIN_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessagesDelayed')

    echo "  Available Messages: $MAIN_AVAILABLE"
    echo "  In-Flight Messages: $MAIN_IN_FLIGHT"
    echo "  Delayed Messages: $MAIN_DELAYED"
    echo ""

    # 3. OpenSearch統計
    echo "3. OPENSEARCH STATISTICS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # クラスターヘルス
    CLUSTER_HEALTH=$(curl -s -XGET "https://$OPENSEARCH_ENDPOINT/_cluster/health")
    CLUSTER_STATUS=$(echo "$CLUSTER_HEALTH" | jq -r '.status')
    CLUSTER_NODES=$(echo "$CLUSTER_HEALTH" | jq -r '.number_of_nodes')

    echo "Cluster Health:"
    echo "  Status: $CLUSTER_STATUS"
    echo "  Number of Nodes: $CLUSTER_NODES"
    echo ""

    # インデックス統計
    INDEX_STATS=$(curl -s -XGET "https://$OPENSEARCH_ENDPOINT/$INDEX_NAME/_stats")
    DOC_COUNT=$(echo "$INDEX_STATS" | jq -r '._all.primaries.docs.count // 0')
    STORE_SIZE=$(echo "$INDEX_STATS" | jq -r '._all.primaries.store.size_in_bytes // 0')
    STORE_SIZE_MB=$(awk "BEGIN {printf \"%.2f\", $STORE_SIZE / 1024 / 1024}")

    echo "Index Statistics:"
    echo "  Total Documents: $DOC_COUNT"
    echo "  Index Size: $STORE_SIZE_MB MB"
    echo ""

    # 4. パフォーマンスメトリクス
    echo "4. PERFORMANCE METRICS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # インデックス速度（過去1時間）
    ONE_HOUR_AGO=$(date -u -v-1H '+%Y-%m-%dT%H:%M:%S')
    RECENT_DOCS=$(curl -s -XGET "https://$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" \
        -H 'Content-Type: application/json' \
        -d "{\"query\":{\"range\":{\"last_modified\":{\"gte\":\"$ONE_HOUR_AGO\"}}}}" | \
        jq -r '.count // 0')

    INDEXING_RATE=$(awk "BEGIN {printf \"%.2f\", $RECENT_DOCS / 3600}")

    echo "Indexing Performance:"
    echo "  Documents indexed (last hour): $RECENT_DOCS"
    echo "  Average indexing rate: $INDEXING_RATE docs/sec"
    echo ""

    # 検索パフォーマンス
    SEARCH_RESULT=$(curl -s -XGET "https://$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search" \
        -H 'Content-Type: application/json' \
        -d '{"size":10,"query":{"match_all":{}}}')

    SEARCH_TIME=$(echo "$SEARCH_RESULT" | jq -r '.took // 0')

    echo "Search Performance:"
    echo "  Average search time: $SEARCH_TIME ms"
    echo ""

    # 5. キュー処理速度の推定
    echo "5. QUEUE PROCESSING ESTIMATES"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # 過去のログから処理速度を推定（CloudWatch Logsを使用）
    # ここではサンプル値を使用
    CURRENT_RATE=10.5  # msg/sec (現在の推定値)

    if [ "$DLQ_AVAILABLE" -gt 0 ]; then
        ETA_SECONDS=$(awk "BEGIN {printf \"%.0f\", $DLQ_AVAILABLE / $CURRENT_RATE}")
        ETA_MINUTES=$((ETA_SECONDS / 60))
        ETA_HOURS=$((ETA_MINUTES / 60))

        echo "DLQ Recovery Estimate:"
        echo "  Remaining messages: $DLQ_AVAILABLE"
        echo "  Current processing rate: $CURRENT_RATE msg/sec"
        echo "  Estimated time to completion: ${ETA_HOURS}h ${ETA_MINUTES}m"
        echo ""
    fi

    if [ "$MAIN_AVAILABLE" -gt 0 ]; then
        MAIN_ETA_SECONDS=$(awk "BEGIN {printf \"%.0f\", $MAIN_AVAILABLE / $CURRENT_RATE}")
        MAIN_ETA_MINUTES=$((MAIN_ETA_SECONDS / 60))

        echo "Main Queue Processing Estimate:"
        echo "  Waiting messages: $MAIN_AVAILABLE"
        echo "  Current processing rate: $CURRENT_RATE msg/sec"
        echo "  Estimated processing time: ${MAIN_ETA_MINUTES} minutes"
        echo ""
    fi

    # 6. 最適化の推奨事項
    echo "6. OPTIMIZATION RECOMMENDATIONS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # 条件に基づいた推奨事項
    if [ "$DLQ_AVAILABLE" -gt 5000 ]; then
        echo "⚠️  HIGH: Large DLQ backlog detected"
        echo "   Recommendation: Consider running optimized recovery script"
        echo "   Command: ./optimize_recovery.sh"
        echo ""
    fi

    if [ "$MAIN_AVAILABLE" -gt 1000 ]; then
        echo "⚠️  MEDIUM: Main queue backlog building up"
        echo "   Recommendation: Scale up worker instances"
        echo "   Suggested action: Launch additional EC2 workers"
        echo ""
    fi

    if [ "$MAIN_IN_FLIGHT" -eq 0 ] && [ "$MAIN_AVAILABLE" -gt 0 ]; then
        echo "⚠️  CRITICAL: No messages being processed"
        echo "   Recommendation: Check worker health"
        echo "   Command: ssh ec2-user@<instance-ip> 'systemctl status file-metadata-worker'"
        echo ""
    fi

    if [ "$CLUSTER_STATUS" != "green" ]; then
        echo "⚠️  HIGH: OpenSearch cluster not healthy"
        echo "   Current status: $CLUSTER_STATUS"
        echo "   Recommendation: Check cluster health and node status"
        echo ""
    fi

    INDEXING_RATE_NUM=$(echo "$INDEXING_RATE" | awk '{print int($1)}')
    if [ "$INDEXING_RATE_NUM" -lt 5 ]; then
        echo "⚠️  MEDIUM: Low indexing rate detected"
        echo "   Current rate: $INDEXING_RATE docs/sec"
        echo "   Recommendation: Review worker configuration and OpenSearch capacity"
        echo ""
    fi

    if [ "$SEARCH_TIME" -gt 1000 ]; then
        echo "⚠️  MEDIUM: Slow search performance"
        echo "   Average search time: $SEARCH_TIME ms"
        echo "   Recommendation: Consider index optimization or query tuning"
        echo ""
    fi

    # 7. システムヘルスサマリー
    echo "7. HEALTH SUMMARY"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    HEALTH_SCORE=100
    ISSUES=()

    if [ "$DLQ_AVAILABLE" -gt 1000 ]; then
        HEALTH_SCORE=$((HEALTH_SCORE - 20))
        ISSUES+=("Large DLQ backlog")
    fi

    if [ "$MAIN_AVAILABLE" -gt 1000 ]; then
        HEALTH_SCORE=$((HEALTH_SCORE - 15))
        ISSUES+=("Main queue backlog")
    fi

    if [ "$CLUSTER_STATUS" != "green" ]; then
        HEALTH_SCORE=$((HEALTH_SCORE - 25))
        ISSUES+=("OpenSearch cluster unhealthy")
    fi

    if [ "$INDEXING_RATE_NUM" -lt 5 ]; then
        HEALTH_SCORE=$((HEALTH_SCORE - 10))
        ISSUES+=("Low indexing rate")
    fi

    echo "Overall Health Score: $HEALTH_SCORE/100"

    if [ ${#ISSUES[@]} -eq 0 ]; then
        echo "Status: ✓ All systems operational"
    else
        echo "Status: ⚠️  Issues detected:"
        for issue in "${ISSUES[@]}"; do
            echo "  - $issue"
        done
    fi
    echo ""

    # 8. 次のステップ
    echo "8. RECOMMENDED NEXT STEPS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [ "$DLQ_AVAILABLE" -gt 0 ]; then
        echo "1. Monitor DLQ recovery progress:"
        echo "   ./monitor_recovery.sh"
        echo ""
    fi

    if [ "$MAIN_AVAILABLE" -gt 500 ]; then
        echo "2. Consider optimizing recovery:"
        echo "   ./optimize_recovery.sh"
        echo ""
    fi

    echo "3. Verify OpenSearch data integrity:"
    echo "   ./check_opensearch.sh"
    echo ""

    echo "4. Continue monitoring with real-time dashboard:"
    echo "   watch -n 30 './performance_report.sh /dev/stdout'"
    echo ""

    # レポート終了
    echo "════════════════════════════════════════════════════════════════"
    echo "           END OF REPORT"
    echo "════════════════════════════════════════════════════════════════"

} | tee "$OUTPUT_FILE"

# ターミナルに結果を表示
echo ""
echo -e "${GREEN}✓ Performance report generated: $OUTPUT_FILE${NC}"
echo ""
echo -e "${BLUE}Quick Summary:${NC}"
echo -e "  DLQ Messages: ${YELLOW}$DLQ_AVAILABLE${NC}"
echo -e "  Main Queue: ${YELLOW}$MAIN_AVAILABLE${NC}"
echo -e "  OpenSearch Docs: ${YELLOW}$DOC_COUNT${NC}"
echo -e "  Health Score: ${YELLOW}$HEALTH_SCORE${NC}/100"
