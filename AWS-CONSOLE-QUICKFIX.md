# AWS Console Quick Fix Guide

**目的**: 4つの検証エラーを最速で修正するためのコンソール操作ガイド

---

## 🚀 Quick Start（5分で完了）

### Step 1: S3 EventBridge有効化（2分）

1. **AWS Console** → 検索: `S3`
2. バケット: `cis-filesearch-s3-landing` をクリック
3. **Properties** タブ
4. 下にスクロール → **Event notifications** セクション
5. **Amazon EventBridge** → **Edit**
6. ☑️ **Send notifications to Amazon EventBridge...**
7. **Save changes**

✅ 完了！緑のバナーが表示されます

---

### Step 2: EventBridge Rule作成（3分）

#### A. ルール作成

1. **AWS Console** → 検索: `EventBridge`
2. 左メニュー: **Rules**
3. **Create rule**

#### B. Rule detail

- **Name**: `cis-s3-to-sqs-file-upload`
- **Description**: `Route S3 file upload events to SQS for processing`
- **Event bus**: `default`
- **Rule type**: `Rule with an event pattern`
- **Next**

#### C. Event pattern

- **Creation method**: `Custom pattern (JSON editor)`
- 以下をコピペ:

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

- **Next**

#### D. Target設定

- **Select a target**: `SQS queue`
- **Queue**: `cis-filesearch-index-queue`
- **Configure target input**: `Input transformer`

**Input Path**:
```json
{
  "bucket": "$.detail.bucket.name",
  "key": "$.detail.object.key",
  "size": "$.detail.object.size",
  "etag": "$.detail.object.etag",
  "time": "$.time"
}
```

**Template**:
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

- **Next** → **Next** → **Create rule**

#### E. SQS Policy更新（重要！）

1. **AWS Console** → 検索: `SQS`
2. `cis-filesearch-index-queue` をクリック
3. **Access policy** タブ → **Edit**
4. 既存のJSONに以下を**追加**（`Statement`配列の中に）:

```json
{
  "Sid": "AllowEventBridgeToSendMessages",
  "Effect": "Allow",
  "Principal": {
    "Service": "events.amazonaws.com"
  },
  "Action": "sqs:SendMessage",
  "Resource": "arn:aws:sqs:ap-northeast-1:YOUR_ACCOUNT_ID:cis-filesearch-index-queue",
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:events:ap-northeast-1:YOUR_ACCOUNT_ID:rule/cis-s3-to-sqs-file-upload"
    }
  }
}
```

**重要**: `YOUR_ACCOUNT_ID` を実際の12桁のアカウントIDに置き換え

5. **Save**

✅ 完了！

---

### Step 3: SQS Retention延長（30秒）

1. **AWS Console** → 検索: `SQS`
2. `cis-filesearch-index-queue` をクリック
3. **Edit**
4. **Message retention period**: `345600` → `604800` に変更
5. **Save**

✅ 完了！

---

## 📋 検証方法

すべて完了したら検証：

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/ec2-worker
python3 verify_aws_config.py
```

**期待結果**: `Passed: 28 ✅` / `Failed: 0 ❌`

---

## 🧪 動作テスト

```bash
# テストファイルアップロード
echo "Test $(date)" > test.txt
aws s3 cp test.txt s3://cis-filesearch-s3-landing/files/test/

# 5秒待機
sleep 5

# SQSメッセージ確認
aws sqs receive-message \
  --queue-url $(aws sqs get-queue-url --queue-name cis-filesearch-index-queue --query 'QueueUrl' --output text) \
  --max-number-of-messages 1
```

**成功**: メッセージが表示される
**失敗**: 何も表示されない → トラブルシューティングへ

---

## ❌ トラブルシューティング

### メッセージがSQSに届かない

**チェック項目**:

1. ✅ S3 EventBridge有効？
   ```bash
   aws s3api get-bucket-notification-configuration --bucket cis-filesearch-s3-landing
   ```
   **期待**: `{"EventBridgeConfiguration": {}}`

2. ✅ EventBridgeルール有効？
   ```bash
   aws events describe-rule --name cis-s3-to-sqs-file-upload
   ```
   **期待**: `"State": "ENABLED"`

3. ✅ ターゲット設定済み？
   ```bash
   aws events list-targets-by-rule --rule cis-s3-to-sqs-file-upload
   ```
   **期待**: SQS ARNが表示される

4. ✅ SQS Policy設定済み？
   ```bash
   aws sqs get-queue-attributes \
     --queue-url $(aws sqs get-queue-url --queue-name cis-filesearch-index-queue --query 'QueueUrl' --output text) \
     --attribute-names Policy
   ```
   **期待**: `events.amazonaws.com` が含まれる

---

## 📞 サポート

問題が解決しない場合:

1. 詳細ガイド参照: `/Users/tatsuya/focus_project/cis_filesearch_app/AWS-SETUP-FIX-CHECKLIST.md`
2. EventBridgeガイド: `/Users/tatsuya/focus_project/cis_filesearch_app/docs/deployment/aws-eventbridge-s3-sqs-guide.md`
3. SQSガイド: `/Users/tatsuya/focus_project/cis_filesearch_app/docs/deployment/aws-sqs-configuration-guide.md`

---

**作成日**: 2025-01-19
**所要時間**: 約5分
