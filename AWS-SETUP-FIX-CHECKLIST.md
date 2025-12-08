# AWS Setup Fix Checklist

**Generated:** 2025-01-19
**Purpose:** Fix 4 verification failures and complete AWS infrastructure setup

---

## 概要

検証スクリプトで4つの問題が検出されました：

1. ✅ **OpenSearch Error** - スクリプトのバグ（修正済み）
2. ❌ **S3 EventBridge** - DISABLED（未設定）
3. ❌ **SQS Message Retention** - 4日間（推奨7日間以上）
4. ❌ **EventBridge Rule** - S3関連ルールが見つからない

---

## 修正の優先順位

### HIGH PRIORITY（システム動作に必須）

- [ ] **Task 1**: EventBridge Rule作成（S3→SQS）
- [ ] **Task 2**: S3バケットでEventBridge有効化

### MEDIUM PRIORITY（推奨設定）

- [ ] **Task 3**: SQS Message Retention期間延長（4日→7日）

### COMPLETED

- [x] **Task 0**: OpenSearch検証スクリプトのバグ修正

---

## Task 0: OpenSearch検証スクリプト修正 ✅

### 問題

```python
domain = response['DomainConfig']  # ❌ 間違い
```

### 修正

```python
domain = response['DomainStatus']  # ✅ 正しい
```

### 確認方法

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/ec2-worker
python3 verify_aws_config.py
```

**期待される結果**: OpenSearchチェックがパスする

---

## Task 1: S3バケットでEventBridge有効化

### 必要な理由

S3にファイルがアップロードされたとき、自動的にEventBridgeにイベントを送信するため。

**効果**: DataSyncでファイルがS3に到着→自動的にEventBridge→SQS→EC2処理

### AWS Console手順

#### Step 1: S3コンソールを開く

1. AWS Console → 検索バーに「S3」と入力
2. S3ダッシュボードを開く

#### Step 2: バケットを選択

1. バケット一覧から `cis-filesearch-s3-landing` をクリック
2. **Properties（プロパティ）** タブをクリック

#### Step 3: Event notificationsセクションまでスクロール

1. 下にスクロールして「**Event notifications**」セクションを探す
2. 「**Amazon EventBridge**」という小さなセクションが見つかる

#### Step 4: EventBridgeを有効化

1. Amazon EventBridgeセクションの **Edit（編集）** ボタンをクリック
2. チェックボックス: ☑️ **Send notifications to Amazon EventBridge for all events in this bucket**
3. **Save changes（変更を保存）** をクリック

#### Step 5: 確認

**成功メッセージ**: 「Successfully edited Event notifications configuration」

### CLI手順（代替方法）

```bash
# 環境変数設定
export BUCKET_NAME="cis-filesearch-s3-landing"
export AWS_REGION="ap-northeast-1"

# EventBridge通知を有効化
aws s3api put-bucket-notification-configuration \
  --bucket $BUCKET_NAME \
  --region $AWS_REGION \
  --notification-configuration '{
    "EventBridgeConfiguration": {}
  }'

# 確認
aws s3api get-bucket-notification-configuration \
  --bucket $BUCKET_NAME \
  --region $AWS_REGION
```

**期待される出力**:
```json
{
    "EventBridgeConfiguration": {}
}
```

### トラブルシューティング

**エラー: Access Denied**
```bash
# IAMユーザーに以下の権限が必要
s3:PutBucketNotificationConfiguration
s3:GetBucketNotificationConfiguration
```

**設定が表示されない**
- ページをリロード（F5）
- 別のタブで開く
- ブラウザのキャッシュをクリア

---

## Task 2: EventBridge Rule作成（S3→SQS）

### 必要な理由

S3イベントをSQSキューにルーティングするため。

**イベントフロー**:
```
S3 upload → EventBridge → ルールマッチ → SQS → EC2ワーカー
```

### 事前準備

以下の情報を確認：

```bash
# SQS Queue URLを取得
aws sqs get-queue-url --queue-name cis-filesearch-index-queue --query 'QueueUrl' --output text

# SQS Queue ARNを取得
aws sqs get-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text
```

**メモ**:
- Queue URL: `https://sqs.ap-northeast-1.amazonaws.com/<ACCOUNT_ID>/cis-filesearch-index-queue`
- Queue ARN: `arn:aws:sqs:ap-northeast-1:<ACCOUNT_ID>:cis-filesearch-index-queue`

### AWS Console手順

#### Step 1: EventBridgeコンソールを開く

1. AWS Console → 検索バーに「EventBridge」と入力
2. **Amazon EventBridge** をクリック
3. 左メニューから **Rules（ルール）** をクリック

#### Step 2: Create rule（ルールを作成）

1. **Create rule** ボタンをクリック

#### Step 3: Rule detailを設定

**Name（名前）**: `cis-s3-to-sqs-file-upload`

**Description（説明）**:
```
Route S3 file upload events to SQS queue for processing
```

**Event bus**: `default`

**Enable the rule on the selected event bus**: ☑️ チェック

**Rule type**: `Rule with an event pattern`

**Next（次へ）** をクリック

#### Step 4: Build event pattern（イベントパターン構築）

**Event source**: `AWS events or EventBridge partner events`

**Sample event - optional**: `AWS events`

**Sample event type**: `S3 Object Created`

**Creation method**: `Custom pattern (JSON editor)`

**Event pattern**に以下をコピペ:

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-s3-landing"]
    },
    "object": {
      "key": [{
        "prefix": "files/"
      }]
    }
  }
}
```

**パターンの説明**:
- `Object Created`: 新規ファイルアップロードのみ（削除は無視）
- `bucket.name`: `cis-filesearch-s3-landing` バケットのみ
- `key.prefix`: `files/` 配下のファイルのみ（`test/`や`temp/`は無視）

**Test pattern（パターンテスト）** - オプション:
1. **Test pattern** をクリック
2. サンプルイベントで検証可能

**Next** をクリック

#### Step 5: Select target（ターゲット選択）

**Target types**: `AWS service`

**Select a target**: `SQS queue`

**Queue**: `cis-filesearch-index-queue`

**Configure target input**: `Input transformer`

**Input Path（入力パス）**:
```json
{
  "bucket": "$.detail.bucket.name",
  "key": "$.detail.object.key",
  "size": "$.detail.object.size",
  "etag": "$.detail.object.etag",
  "time": "$.time"
}
```

**Template（テンプレート）**:
```json
{
  "eventType": "S3_OBJECT_CREATED",
  "s3Bucket": "<bucket>",
  "s3Key": "<key>",
  "fileSize": <size>,
  "etag": "<etag>",
  "eventTime": "<time>",
  "processingRequired": true
}
```

**説明**:
- EventBridgeの大きなイベントをSQS用の小さなメッセージに変換
- 必要な情報のみ抽出（bucket, key, size, etag, time）
- 処理しやすいJSON形式

**Additional settings（追加設定）**:

- **Configure target input - optional**: すでに設定済み
- **Dead-letter queue**: None（SQSにDLQがあるため不要）
- **Retry policy**: Default（185回、24時間）

**Next** をクリック

#### Step 6: Configure tags（タグ設定）

**Tags - optional**:

| Key | Value |
|-----|-------|
| `Project` | `CISFileSearch` |
| `Environment` | `Production` |
| `Component` | `EventRouter` |
| `ManagedBy` | `Manual` |

**Next** をクリック

#### Step 7: Review and create（確認と作成）

1. 設定内容を確認
2. **Create rule** をクリック

#### Step 8: SQS Policyを更新（重要！）

EventBridgeがSQSにメッセージを送信できるよう、SQSのアクセスポリシーを更新する必要があります。

**AWS Console - SQS**:

1. SQSコンソール → `cis-filesearch-index-queue` を選択
2. **Access policy** タブをクリック
3. **Edit** をクリック
4. 以下のStatementを**既存のPolicyに追加**:

```json
{
  "Sid": "AllowEventBridgeToSendMessages",
  "Effect": "Allow",
  "Principal": {
    "Service": "events.amazonaws.com"
  },
  "Action": "sqs:SendMessage",
  "Resource": "arn:aws:sqs:ap-northeast-1:<ACCOUNT_ID>:cis-filesearch-index-queue",
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:events:ap-northeast-1:<ACCOUNT_ID>:rule/cis-s3-to-sqs-file-upload"
    }
  }
}
```

**重要**: `<ACCOUNT_ID>` を実際のAWSアカウントIDに置き換えてください。

**Save** をクリック

### CLI手順（代替方法）

```bash
# 環境変数設定
export AWS_REGION="ap-northeast-1"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export QUEUE_NAME="cis-filesearch-index-queue"
export RULE_NAME="cis-s3-to-sqs-file-upload"

# Queue URLとARNを取得
export QUEUE_URL=$(aws sqs get-queue-url --queue-name $QUEUE_NAME --query 'QueueUrl' --output text)
export QUEUE_ARN=$(aws sqs get-queue-attributes --queue-url $QUEUE_URL --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

# イベントパターンファイル作成
cat > s3-event-pattern.json <<'EOF'
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-s3-landing"]
    },
    "object": {
      "key": [{
        "prefix": "files/"
      }]
    }
  }
}
EOF

# Input Transformerファイル作成
cat > input-transformer.json <<'EOF'
{
  "InputPathsMap": {
    "bucket": "$.detail.bucket.name",
    "key": "$.detail.object.key",
    "size": "$.detail.object.size",
    "etag": "$.detail.object.etag",
    "time": "$.time"
  },
  "InputTemplate": "{\"eventType\":\"S3_OBJECT_CREATED\",\"s3Bucket\":\"<bucket>\",\"s3Key\":\"<key>\",\"fileSize\":<size>,\"etag\":\"<etag>\",\"eventTime\":\"<time>\",\"processingRequired\":true}"
}
EOF

# EventBridgeルール作成
aws events put-rule \
  --name $RULE_NAME \
  --description "Route S3 file upload events to SQS for processing" \
  --event-pattern file://s3-event-pattern.json \
  --state ENABLED \
  --region $AWS_REGION

# SQSをターゲットに追加
aws events put-targets \
  --rule $RULE_NAME \
  --targets "Id=1,Arn=$QUEUE_ARN,InputTransformer=$(cat input-transformer.json | jq -c .)" \
  --region $AWS_REGION

# SQS Policy更新（EventBridge許可）
cat > sqs-eventbridge-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEventBridgeToSendMessages",
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "$QUEUE_ARN",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:events:$AWS_REGION:$ACCOUNT_ID:rule/$RULE_NAME"
        }
      }
    }
  ]
}
EOF

# 既存のポリシーを取得
EXISTING_POLICY=$(aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names Policy \
  --query 'Attributes.Policy' \
  --output text)

# 既存ポリシーに新しいStatementを追加（手動で行う必要があります）
echo "既存のSQS Policy:"
echo "$EXISTING_POLICY" | jq .

echo ""
echo "追加するStatement:"
cat sqs-eventbridge-policy.json | jq .

# ポリシーの適用（既存のStatementと統合する必要があります）
# 以下は既存ポリシーを上書きするため注意
aws sqs set-queue-attributes \
  --queue-url $QUEUE_URL \
  --attributes "Policy=$(cat sqs-eventbridge-policy.json | jq -c .)"

echo "EventBridge rule created successfully!"
```

### テスト方法

#### 1. テストファイルをアップロード

```bash
# テストファイル作成
echo "EventBridge Test - $(date)" > eventbridge-test.txt

# S3にアップロード
aws s3 cp eventbridge-test.txt s3://cis-filesearch-s3-landing/files/test/

# 5秒待機（イベント伝播）
sleep 5
```

#### 2. SQSメッセージを確認

```bash
# SQSからメッセージ受信
aws sqs receive-message \
  --queue-url $QUEUE_URL \
  --max-number-of-messages 1 \
  --wait-time-seconds 10 \
  --region $AWS_REGION
```

**期待される出力**:
```json
{
  "Messages": [
    {
      "MessageId": "abc123...",
      "ReceiptHandle": "def456...",
      "Body": "{\"eventType\":\"S3_OBJECT_CREATED\",\"s3Bucket\":\"cis-filesearch-s3-landing\",\"s3Key\":\"files/test/eventbridge-test.txt\",\"fileSize\":45,\"etag\":\"...\",\"eventTime\":\"2025-01-19T...\",\"processingRequired\":true}"
    }
  ]
}
```

#### 3. メトリクスを確認

```bash
# EventBridge呼び出し回数
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=cis-s3-to-sqs-file-upload \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum \
  --region $AWS_REGION
```

### トラブルシューティング

**問題**: メッセージがSQSに届かない

**診断**:
```bash
# 1. EventBridgeルールが有効か確認
aws events describe-rule --name cis-s3-to-sqs-file-upload --region $AWS_REGION

# 2. ターゲットが設定されているか確認
aws events list-targets-by-rule --rule cis-s3-to-sqs-file-upload --region $AWS_REGION

# 3. S3のEventBridge設定確認
aws s3api get-bucket-notification-configuration --bucket cis-filesearch-s3-landing --region $AWS_REGION

# 4. SQS Policyを確認
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names Policy \
  --query 'Attributes.Policy'
```

**解決策**:
1. Task 1が完了していることを確認（S3 EventBridge有効化）
2. SQS Policyにevents.amazonaws.comの権限があることを確認
3. EventBridgeルールのEvent Patternが正しいか確認

---

## Task 3: SQS Message Retention期間延長

### 現在の設定

- **現在**: 4日間（345,600秒）
- **推奨**: 7日間（604,800秒）以上

### 必要な理由

1. **週末カバー**: 金曜日のメッセージが月曜日まで残る
2. **祝日対応**: 3連休でも消えない
3. **トラブルシューティング**: 問題調査に十分な時間

### AWS Console手順

#### Step 1: SQSコンソールを開く

1. AWS Console → 検索バーに「SQS」と入力
2. SQS ダッシュボードを開く

#### Step 2: キューを選択

1. `cis-filesearch-index-queue` をクリック
2. **Edit（編集）** ボタンをクリック

#### Step 3: Message retention periodを変更

1. **Configuration** セクションまでスクロール
2. **Message retention period** を見つける
3. 値を変更:
   - **From**: `345600` seconds（4日）
   - **To**: `604800` seconds（7日）
4. **Save（保存）** をクリック

### CLI手順（代替方法）

```bash
# 環境変数設定
export QUEUE_NAME="cis-filesearch-index-queue"
export QUEUE_URL=$(aws sqs get-queue-url --queue-name $QUEUE_NAME --query 'QueueUrl' --output text)

# Message Retention Periodを7日間に設定
aws sqs set-queue-attributes \
  --queue-url $QUEUE_URL \
  --attributes MessageRetentionPeriod=604800

# 確認
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names MessageRetentionPeriod
```

**期待される出力**:
```json
{
  "Attributes": {
    "MessageRetentionPeriod": "604800"
  }
}
```

### 14日間に設定する場合（最大値）

```bash
# 14日間 = 1,209,600秒
aws sqs set-queue-attributes \
  --queue-url $QUEUE_URL \
  --attributes MessageRetentionPeriod=1209600
```

### トラブルシューティング

**エラー: InvalidAttributeValue**
- 範囲: 60秒 ～ 1,209,600秒（14日間）
- 正しい値を確認

---

## 最終確認手順

すべてのタスク完了後、検証スクリプトを再実行：

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/ec2-worker

# 検証スクリプト実行
python3 verify_aws_config.py
```

### 期待される結果

```
========================================
AWS Configuration Verification for CIS File Search
Region: ap-northeast-1
Time: 2025-01-19 XX:XX:XX
========================================

🔍 Checking OpenSearch Domain...
   ✅ Instance Type: t3.small.search
   ✅ Instance Count: 1
   ✅ Volume Size: 100 GB
   ✅ Volume Type: gp3
   ✅ k-NN Plugin: Enabled
   Endpoint: https://cis-filesearch-opensearch-xxx.ap-northeast-1.es.amazonaws.com

🪣 Checking S3 Buckets...
   ✅ cis-filesearch-s3-landing: Exists
   ✅ cis-filesearch-s3-landing: Enabled  # 🎯 修正確認
   ✅ cis-filesearch-s3-thumbnail: Exists

📨 Checking SQS Queues...
   ✅ cis-filesearch-index-queue: Exists
   ✅ Visibility Timeout: 300s
   ✅ Message Retention: 7 days  # 🎯 修正確認
   ✅ Dead Letter Queue: Configured

🌉 Checking EventBridge Rules...
   ✅ cis-s3-to-sqs-file-upload: ENABLED  # 🎯 修正確認
   ✅ → SQS: cis-filesearch-index-queue

========================================
VERIFICATION SUMMARY
========================================
Total Checks: 28
Passed: 28 ✅
Failed: 0 ❌

🎉 All checks passed! Your AWS environment is ready.
========================================
```

---

## エンドツーエンドテスト

すべての設定が完了したら、実際のファイルフローをテストします。

### Test 1: S3 → EventBridge → SQS

```bash
# 1. テストファイル作成
echo "End-to-end test - $(date)" > e2e-test.txt

# 2. S3にアップロード（files/プレフィックス）
aws s3 cp e2e-test.txt s3://cis-filesearch-s3-landing/files/e2e/

# 3. 待機（イベント伝播）
sleep 5

# 4. SQSメッセージ確認
aws sqs receive-message \
  --queue-url $QUEUE_URL \
  --max-number-of-messages 1 \
  --wait-time-seconds 10

# 期待: メッセージが受信できる
```

### Test 2: フィルタリング動作確認

```bash
# test/プレフィックスにアップロード（無視されるべき）
aws s3 cp e2e-test.txt s3://cis-filesearch-s3-landing/test/should-be-ignored.txt

# 待機
sleep 5

# SQS確認（メッセージがないことを確認）
aws sqs receive-message \
  --queue-url $QUEUE_URL \
  --max-number-of-messages 1 \
  --wait-time-seconds 5

# 期待: メッセージなし（フィルタが動作）
```

### Test 3: バルクアップロード

```bash
# 100ファイルアップロード
for i in {1..100}; do
  echo "Bulk test file $i" > "bulk-$i.txt"
  aws s3 cp "bulk-$i.txt" s3://cis-filesearch-s3-landing/files/bulk-test/ &
done
wait

# 待機
sleep 10

# SQS深度確認
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages

# 期待: 約100メッセージ
```

---

## トラブルシューティングガイド

### 問題: S3 EventBridgeが有効にならない

**症状**: EventBridgeチェックボックスがグレーアウト

**解決策**:
1. S3バケットポリシーを確認（権限不足の可能性）
2. 別のリージョンで開いていないか確認
3. IAMユーザーに`s3:PutBucketNotificationConfiguration`権限があるか確認

### 問題: EventBridgeルールが作成できない

**症状**: "Access Denied" エラー

**解決策**:
```bash
# 必要な権限
events:PutRule
events:PutTargets
sqs:SetQueueAttributes
```

IAMポリシーに上記権限を追加

### 問題: SQSにメッセージが届かない

**診断コマンド**:
```bash
# 1. S3 EventBridge設定確認
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-s3-landing

# 2. EventBridgeルール確認
aws events describe-rule --name cis-s3-to-sqs-file-upload

# 3. EventBridgeターゲット確認
aws events list-targets-by-rule --rule cis-s3-to-sqs-file-upload

# 4. SQS Policy確認
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names Policy
```

**チェックリスト**:
- [ ] S3でEventBridge有効化済み
- [ ] EventBridgeルールが`ENABLED`状態
- [ ] Event Patternがバケット名と一致
- [ ] SQS PolicyでEventBridgeを許可
- [ ] SQS ARNが正しい

---

## 完了確認

すべてのタスクが完了したら、以下をチェック：

- [ ] OpenSearch検証スクリプトのバグ修正完了
- [ ] S3バケット`cis-filesearch-s3-landing`でEventBridge有効化
- [ ] EventBridgeルール`cis-s3-to-sqs-file-upload`作成完了
- [ ] SQS Queue PolicyでEventBridge許可設定完了
- [ ] SQS Message Retention 7日間に延長
- [ ] 検証スクリプトで全チェックパス（28/28）
- [ ] エンドツーエンドテスト成功（S3→EventBridge→SQS）
- [ ] フィルタリングテスト成功（test/プレフィックス無視）

---

## 次のステップ

AWS設定完了後：

1. **DataSyncタスク設定**: Windows Scanner PC → S3自動同期
2. **EC2 Auto Scaling設定**: ファイル処理ワーカー起動
3. **CloudWatch Dashboard作成**: メトリクス可視化
4. **アラート設定**: 異常検知通知

---

## 参考ドキュメント

- [AWS EventBridge S3 Integration Guide](/Users/tatsuya/focus_project/cis_filesearch_app/docs/deployment/aws-eventbridge-s3-sqs-guide.md)
- [AWS SQS Configuration Guide](/Users/tatsuya/focus_project/cis_filesearch_app/docs/deployment/aws-sqs-configuration-guide.md)
- [AWS S3 Configuration Guide](/Users/tatsuya/focus_project/cis_filesearch_app/docs/deployment/aws-s3-configuration-guide.md)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-19
**Author**: CIS Development Team
