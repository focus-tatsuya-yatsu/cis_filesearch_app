#!/bin/bash
# S3アクセス権限修正スクリプト
set -e

echo "🔐 S3アクセス権限を修正中..."

# 1. EC2インスタンスのIAMロール取得
echo "📊 EC2インスタンスのIAMロール確認中..."
INSTANCE_PROFILE=$(aws ec2 describe-instances \
  --instance-ids i-04b4dce2b7309666c \
  --region ap-northeast-1 \
  --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' \
  --output text)

if [ "$INSTANCE_PROFILE" = "None" ] || [ -z "$INSTANCE_PROFILE" ]; then
  echo "❌ EC2インスタンスにIAMロールが設定されていません"
  echo "新しいIAMロールを作成する必要があります"

  # IAMロール作成
  echo "📝 新しいIAMロールを作成中..."

  cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

  ROLE_NAME="cis-filesearch-worker-role"

  # ロール作成
  aws iam create-role \
    --role-name $ROLE_NAME \
    --assume-role-policy-document file:///tmp/trust-policy.json \
    --region ap-northeast-1 2>/dev/null || echo "ロールが既に存在"

  # S3読み取りポリシー作成
  cat > /tmp/s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-worker-scripts/*",
        "arn:aws:s3:::cis-filesearch-worker-scripts"
      ]
    }
  ]
}
EOF

  # ポリシーアタッチ
  aws iam put-role-policy \
    --role-name $ROLE_NAME \
    --policy-name S3ReadPolicy \
    --policy-document file:///tmp/s3-policy.json \
    --region ap-northeast-1

  # SQSポリシー追加
  cat > /tmp/sqs-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:SendMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ],
      "Resource": [
        "arn:aws:sqs:ap-northeast-1:770923989980:cis-filesearch-index-queue",
        "arn:aws:sqs:ap-northeast-1:770923989980:cis-filesearch-dlq"
      ]
    }
  ]
}
EOF

  aws iam put-role-policy \
    --role-name $ROLE_NAME \
    --policy-name SQSPolicy \
    --policy-document file:///tmp/sqs-policy.json \
    --region ap-northeast-1

  # インスタンスプロファイル作成
  aws iam create-instance-profile \
    --instance-profile-name $ROLE_NAME \
    --region ap-northeast-1 2>/dev/null || echo "プロファイルが既に存在"

  # ロールをプロファイルに追加
  aws iam add-role-to-instance-profile \
    --instance-profile-name $ROLE_NAME \
    --role-name $ROLE_NAME \
    --region ap-northeast-1 2>/dev/null || echo "既に追加済み"

  echo "✅ IAMロール作成完了: $ROLE_NAME"

else
  echo "既存のIAMロール: $INSTANCE_PROFILE"
  ROLE_NAME=$(echo $INSTANCE_PROFILE | awk -F'/' '{print $NF}')

  # 既存ロールにS3権限追加
  echo "📝 既存のIAMロールにS3権限を追加中..."

  cat > /tmp/s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-worker-scripts/*",
        "arn:aws:s3:::cis-filesearch-worker-scripts"
      ]
    }
  ]
}
EOF

  aws iam put-role-policy \
    --role-name $ROLE_NAME \
    --policy-name S3ReadPolicy \
    --policy-document file:///tmp/s3-policy.json \
    --region ap-northeast-1

  echo "✅ S3権限追加完了"
fi

# 2. Launch Templateを更新（IAMロール設定付き）
echo ""
echo "📝 Launch Templateを更新中..."

# 現在のLaunch Template情報取得
CURRENT_LT=$(aws ec2 describe-launch-template-versions \
  --launch-template-name cis-filesearch-worker-template \
  --versions '$Latest' \
  --region ap-northeast-1 \
  --query 'LaunchTemplateVersions[0].LaunchTemplateData' \
  --output json)

# IAMインスタンスプロファイルを追加
NEW_LT_DATA=$(echo "$CURRENT_LT" | jq ". + {\"IamInstanceProfile\": {\"Name\": \"$ROLE_NAME\"}}")

# 新バージョン作成
NEW_VERSION=$(aws ec2 create-launch-template-version \
  --launch-template-name cis-filesearch-worker-template \
  --launch-template-data "$NEW_LT_DATA" \
  --region ap-northeast-1 \
  --query 'LaunchTemplateVersion.VersionNumber' \
  --output text)

echo "✅ 新バージョン作成: $NEW_VERSION"

# デフォルトバージョン更新
aws ec2 modify-launch-template \
  --launch-template-name cis-filesearch-worker-template \
  --default-version $NEW_VERSION \
  --region ap-northeast-1 > /dev/null

echo "✅ デフォルトバージョン更新完了"

# 3. インスタンス再起動
echo ""
echo "🔄 インスタンスを再起動中..."

aws autoscaling terminate-instance-in-auto-scaling-group \
  --instance-id i-04b4dce2b7309666c \
  --no-should-decrement-desired-capacity \
  --region ap-northeast-1 > /dev/null

echo "✅ インスタンス終了リクエスト送信"

# 新インスタンス起動監視
echo "⏳ 新インスタンスの起動を監視中..."

for i in {1..10}; do
  sleep 30

  NEW_INSTANCE=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
    --region ap-northeast-1 \
    --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService`].InstanceId' \
    --output text)

  if [ -n "$NEW_INSTANCE" ]; then
    echo "✅ 新インスタンス起動完了: $NEW_INSTANCE"
    break
  fi

  echo "待機中... ($i/10)"
done

# 待機
echo "⏳ User Dataスクリプト実行を待機中（60秒）..."
sleep 60

# SQS確認
echo ""
echo "📊 SQSメッセージ数確認"
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --region ap-northeast-1 \
  --query 'Attributes' \
  --output table

echo ""
echo "🎉 S3権限修正完了！"
echo ""
echo "次のステップ:"
echo "1. コンソール出力を確認:"
echo "   aws ec2 get-console-output --instance-id $NEW_INSTANCE --region ap-northeast-1 --output text | grep -i 'download\|worker\|error'"
echo ""