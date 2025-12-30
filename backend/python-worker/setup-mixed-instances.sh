#!/bin/bash
# スポットとオンデマンドインスタンスの混在設定

set -e

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}   スポット/オンデマンド混在設定ツール       ${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}現在の問題:${NC}"
echo "• スポットインスタンスが価格変動で終了"
echo "• 処理の中断リスク"
echo "• サービス継続性の課題"
echo ""

echo -e "${GREEN}推奨構成:${NC}"
echo "• オンデマンド: 2台（最小保証）"
echo "• スポット: 最大8台（コスト削減）"
echo "• 合計: 最大10台"
echo ""

# 混在設定JSONを作成
cat > /tmp/mixed-instances-policy.json << 'EOF'
{
  "LaunchTemplate": {
    "LaunchTemplateSpecification": {
      "LaunchTemplateName": "cis-filesearch-worker-template",
      "Version": "$Latest"
    },
    "Overrides": [
      {
        "InstanceType": "t3.medium",
        "WeightedCapacity": 1
      },
      {
        "InstanceType": "t3a.medium",
        "WeightedCapacity": 1
      },
      {
        "InstanceType": "t2.medium",
        "WeightedCapacity": 1
      }
    ]
  },
  "InstancesDistribution": {
    "OnDemandAllocationStrategy": "prioritized",
    "OnDemandBaseCapacity": 2,
    "OnDemandPercentageAboveBaseCapacity": 20,
    "SpotAllocationStrategy": "lowest-price",
    "SpotInstancePools": 3,
    "SpotMaxPrice": ""
  }
}
EOF

echo -e "${BLUE}混在ポリシー設定:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "オンデマンド基本容量: 2台"
echo "追加容量のオンデマンド比率: 20%"
echo "スポット戦略: 最低価格"
echo "スポットプール数: 3"
echo "インスタンスタイプ: t3.medium, t3a.medium, t2.medium"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

read -p "この設定を適用しますか？ (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}混在ポリシーを適用中...${NC}"

    # 現在のASGを更新
    aws autoscaling update-auto-scaling-group \
        --auto-scaling-group-name cis-filesearch-ec2-autoscaling \
        --mixed-instances-policy file:///tmp/mixed-instances-policy.json \
        --region $AWS_REGION

    echo -e "${GREEN}✅ 混在ポリシー適用完了${NC}"
    echo ""

    # 容量プロバイダー設定
    echo -e "${BLUE}ECS容量プロバイダー互換性設定...${NC}"

    # キャパシティリバランシング有効化
    aws autoscaling update-auto-scaling-group \
        --auto-scaling-group-name cis-filesearch-ec2-autoscaling \
        --capacity-rebalance \
        --region $AWS_REGION

    echo -e "${GREEN}✅ キャパシティリバランシング有効化${NC}"
    echo ""

    # スポット中断通知の処理設定
    echo -e "${BLUE}スポット中断通知ハンドラー設定...${NC}"

    cat > /tmp/spot-interruption-handler.sh << 'HANDLER'
#!/bin/bash
# スポット中断通知を検知して graceful shutdown

INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)

check_spot_interruption() {
    TERMINATION_TIME=$(curl -s http://169.254.169.254/latest/meta-data/spot/termination-time 2>/dev/null)

    if [ ! -z "$TERMINATION_TIME" ]; then
        echo "スポット中断通知検出: $TERMINATION_TIME"

        # Workerを graceful shutdown
        systemctl stop phased-worker.service
        systemctl stop fixed-worker.service

        # AutoScalingに通知
        aws autoscaling complete-lifecycle-action \
            --lifecycle-action-result CONTINUE \
            --instance-id $INSTANCE_ID \
            --lifecycle-hook-name spot-interruption-hook \
            --auto-scaling-group-name cis-filesearch-ec2-autoscaling \
            --region ap-northeast-1

        exit 0
    fi
}

# 2秒ごとにチェック
while true; do
    check_spot_interruption
    sleep 2
done
HANDLER

    echo -e "${GREEN}✅ スポット中断ハンドラー作成${NC}"
    echo ""

    # 現在の状態確認
    echo -e "${BLUE}現在のインスタンス構成:${NC}"

    INSTANCES=$(aws ec2 describe-instances \
        --filters "Name=tag:aws:autoscaling:groupName,Values=cis-filesearch-ec2-autoscaling" \
                  "Name=instance-state-name,Values=running" \
        --region $AWS_REGION \
        --output json)

    echo "$INSTANCES" | jq -r '.Reservations[].Instances[] |
        "\(.InstanceId) | \(.InstanceType) | \(.InstanceLifecycle // "on-demand") | \(.State.Name)"' | \
        column -t -s '|' -N "Instance ID,Type,Lifecycle,State"

    echo ""
    echo -e "${GREEN}推奨アクション:${NC}"
    echo "1. ./fix-autoscaling.sh を実行（オプション1選択）"
    echo "   → Min:2, Max:10, Desired:4 に設定"
    echo ""
    echo "2. インスタンス起動を確認"
    echo "   → オンデマンド2台が最初に起動"
    echo "   → 追加の2台（80%スポット）が起動"
    echo ""
    echo "3. 処理状況を監視"
    echo "   → ./monitor-recovery.sh で進捗確認"

else
    echo "キャンセルされました"
fi

echo ""
echo -e "${YELLOW}💡 コスト削減のヒント:${NC}"
echo "• ピーク時: Max 10台まで自動拡張"
echo "• 通常時: Min 2台（オンデマンド）で安定運用"
echo "• 夜間: Min 1台に縮小も可能"
echo ""

# コスト比較
echo -e "${BLUE}月額コスト試算（t3.medium, 東京リージョン）:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "従来（スポット10台）: 約$150-200/月"
echo "混在（オンデマンド2+スポット8）: 約$220-250/月"
echo "差額: 約$50-70/月で安定性向上"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"