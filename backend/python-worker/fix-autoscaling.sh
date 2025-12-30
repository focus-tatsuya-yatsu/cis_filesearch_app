#!/bin/bash
# AutoScaling設定を修正してスケールアップを可能にする

set -e

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}     AutoScaling緊急修正ツール              ${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 現在の設定確認
echo -e "${BLUE}現在のAutoScaling設定:${NC}"
aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
    --region $AWS_REGION \
    --output json | jq '.AutoScalingGroups[0] | {MinSize, MaxSize, DesiredCapacity}'

echo ""
echo -e "${RED}⚠️ 問題: AutoScalingが無効化されています！${NC}"
echo ""

# 推奨設定
echo -e "${GREEN}推奨設定:${NC}"
echo "• 最小サイズ: 2（冗長性確保）"
echo "• 最大サイズ: 10（大量処理に対応）"
echo "• 希望容量: 4（現在の負荷に対応）"
echo ""

echo -e "${YELLOW}設定オプション:${NC}"
echo "1. 緊急対応（推奨） - Min:2, Max:10, Desired:4"
echo "2. 段階的拡張 - Min:1, Max:5, Desired:3"
echo "3. 最大拡張 - Min:3, Max:20, Desired:5"
echo "4. カスタム設定"
echo ""

read -p "選択してください (1-4): " -n 1 -r OPTION
echo ""
echo ""

case $OPTION in
    1)
        MIN_SIZE=2
        MAX_SIZE=10
        DESIRED=4
        ;;
    2)
        MIN_SIZE=1
        MAX_SIZE=5
        DESIRED=3
        ;;
    3)
        MIN_SIZE=3
        MAX_SIZE=20
        DESIRED=5
        ;;
    4)
        read -p "最小サイズ: " MIN_SIZE
        read -p "最大サイズ: " MAX_SIZE
        read -p "希望容量: " DESIRED
        ;;
    *)
        echo -e "${RED}無効なオプション${NC}"
        exit 1
        ;;
esac

echo -e "${BLUE}設定を適用:${NC}"
echo "• 最小: $MIN_SIZE"
echo "• 最大: $MAX_SIZE"
echo "• 希望: $DESIRED"
echo ""

read -p "この設定を適用しますか？ (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}AutoScaling設定を更新中...${NC}"

    # AutoScaling Group更新
    aws autoscaling update-auto-scaling-group \
        --auto-scaling-group-name cis-filesearch-ec2-autoscaling \
        --min-size $MIN_SIZE \
        --max-size $MAX_SIZE \
        --desired-capacity $DESIRED \
        --region $AWS_REGION

    echo -e "${GREEN}✅ 設定更新完了${NC}"
    echo ""

    # スケーリングポリシー設定
    echo -e "${BLUE}スケーリングポリシーを設定しますか？${NC}"
    echo "（SQSメッセージ数に基づく自動スケーリング）"
    read -p "設定する (y/n): " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # ターゲットトラッキングポリシー作成
        cat > /tmp/scaling-policy.json << EOF
{
    "TargetValue": 100.0,
    "CustomizedMetricSpecification": {
        "MetricName": "ApproximateNumberOfMessagesVisible",
        "Namespace": "AWS/SQS",
        "Dimensions": [
            {
                "Name": "QueueName",
                "Value": "cis-filesearch-index-queue"
            }
        ],
        "Statistic": "Average"
    },
    "ScaleInCooldown": 60,
    "ScaleOutCooldown": 60
}
EOF

        aws autoscaling put-scaling-policy \
            --auto-scaling-group-name cis-filesearch-ec2-autoscaling \
            --policy-name sqs-target-tracking \
            --policy-type TargetTrackingScaling \
            --target-tracking-configuration file:///tmp/scaling-policy.json \
            --region $AWS_REGION > /dev/null

        echo -e "${GREEN}✅ スケーリングポリシー設定完了${NC}"
    fi

    # インスタンス起動待機
    echo ""
    echo -e "${YELLOW}新しいインスタンスを起動中...${NC}"

    for i in {1..30}; do
        sleep 10

        CURRENT_INSTANCES=$(aws autoscaling describe-auto-scaling-groups \
            --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
            --region $AWS_REGION \
            --output text \
            --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService`] | length(@)')

        echo -ne "\r稼働中インスタンス: ${CURRENT_INSTANCES}/$DESIRED"

        if [ "$CURRENT_INSTANCES" -ge "$DESIRED" ]; then
            echo ""
            echo -e "${GREEN}✅ すべてのインスタンスが起動しました！${NC}"
            break
        fi
    done

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}AutoScaling設定完了！${NC}"
    echo ""

    # 最終確認
    echo -e "${BLUE}現在のインスタンス:${NC}"
    aws ec2 describe-instances \
        --filters "Name=tag:aws:autoscaling:groupName,Values=cis-filesearch-ec2-autoscaling" \
                  "Name=instance-state-name,Values=running" \
        --region $AWS_REGION \
        --output table \
        --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name,LaunchTime]'

    # SQS状態確認
    echo ""
    echo -e "${BLUE}SQSキュー状態:${NC}"

    MAIN_QUEUE=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
        --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
        --region $AWS_REGION \
        --output json)

    VISIBLE=$(echo $MAIN_QUEUE | jq -r '.Attributes.ApproximateNumberOfMessages')
    IN_FLIGHT=$(echo $MAIN_QUEUE | jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible')

    echo "• 待機中: ${VISIBLE}件"
    echo "• 処理中: ${IN_FLIGHT}件"
    echo ""

    if [ "$IN_FLIGHT" -gt "300" ]; then
        echo -e "${YELLOW}⚠️ まだ処理中メッセージが多いです${NC}"
        echo "数分待ってから再確認してください"
    else
        echo -e "${GREEN}✅ 処理が正常化しています${NC}"
    fi

else
    echo "キャンセルされました"
fi

echo ""
echo -e "${BLUE}推奨事項:${NC}"
echo "1. CloudWatchでCPU使用率を監視"
echo "2. スポット中断に備えてオンデマンド混在を検討"
echo "3. 処理完了後はスケールダウン"