# CIS File Search Application - Pattern 3: EC2 Auto Scaling + Bedrock Architecture

## 📋 アーキテクチャ概要

このドキュメントは、CISファイル検索アプリケーションの**Pattern 3: EC2 Auto Scaling + Amazon Bedrock構成**の詳細なアーキテクチャ設計を記述します。

### 🎯 アーキテクチャの特徴

- **処理方式**: EventBridge Scheduler + SQS + EC2 Auto Scaling (Spot Instances)
- **データ同期**: ファイルスキャナーPC → S3直接アップロード
- **画像ベクトル化**: Amazon Bedrock Titan Multimodal Embeddings
- **OCR処理**: Tesseract OCR (EC2インスタンス上)
- **同期頻度**: 四半期ごと (3ヶ月) + 手動トリガー
- **月額コスト**: **$120-150/月** (従来の$47/月から増加)

### 🔄 従来アーキテクチャからの主な変更点

| コンポーネント | 従来 (Step Functions) | 新規 (EC2 Auto Scaling) |
|--------------|---------------------|---------------------|
| オーケストレーション | Step Functions | EventBridge + SQS |
| データ処理 | Lambda関数 | EC2 Auto Scaling (Spot) |
| データ同期 | DataSync + VPN | File Scanner PC → S3 |
| 画像ベクトル化 | Lambda + ResNet-50 | EC2 + Bedrock Titan |
| OCR処理 | なし | Tesseract (EC2) |
| 同期頻度 | 月次 | 四半期 (3ヶ月) |
| VPN接続 | Site-to-Site VPN (月4時間) | 不要 |

---

## 🏗️ システムアーキテクチャ

### レイヤー構成

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Layer                            │
│  S3 Static Hosting + CloudFront + Cognito + API Gateway     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     API Layer                                │
│     API Gateway REST API + Cognito Authorizer (JWT)         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Search & Processing Layer                   │
│  Lambda (Search API) + EC2 Auto Scaling (File Processing)   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Data & Index Layer                        │
│    OpenSearch (検索インデックス) + DynamoDB (メタデータ)      │
│    S3 (Raw Files 10TB + Thumbnails 5GB)                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   Monitoring Layer                           │
│          CloudWatch Logs & Alarms (7日保持)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 コンポーネント詳細

### 1. データ取り込み層

#### 1.1 ファイルスキャナーPC

**役割**: オンプレミスNASからAWS S3へファイルをアップロード

**仕様** (要確認):
- OS: Windows/Linux
- スキャン対象: NAS共有フォルダ
- アップロード先: S3 Raw Files Bucket
- 処理内容:
  - ファイルスキャン (新規・更新ファイル検出)
  - メタデータ取得 (ファイル名、サイズ、更新日時)
  - S3マルチパートアップロード
  - SQSへメッセージ送信

**実装技術候補**:
- Python + boto3
- Node.js + AWS SDK
- AWS CLI + シェルスクリプト

#### 1.2 Amazon S3 - Raw Files Bucket

**バケット名**: `cis-filesearch-raw-files-prod`

**容量**: 10TB (Intelligent-Tiering)

**ライフサイクルポリシー**:
```json
{
  "Rules": [
    {
      "Id": "MoveToInfrequentAccess",
      "Status": "Enabled",
      "Transitions": [
        {
          "Days": 90,
          "StorageClass": "INTELLIGENT_TIERING"
        }
      ]
    }
  ]
}
```

**バージョニング**: 有効化

**暗号化**: AES-256 (SSE-S3)

---

### 2. オーケストレーション層

#### 2.1 Amazon EventBridge Scheduler

**スケジュール**: 四半期ごと (3ヶ月に1回)

**Cron式**: `cron(0 0 1 */3 ? *)` (毎3ヶ月の1日 00:00 UTC)

**アクション**: SQSキューへメッセージ送信 (バッチ開始トリガー)

**手動トリガー**: AWS Consoleまたはイベント送信で可能

#### 2.2 Amazon SQS - File Processing Queue

**キュー名**: `cis-filesearch-file-processing-queue`

**タイプ**: Standard Queue

**設定**:
- Visibility Timeout: 900秒 (15分)
- Message Retention Period: 4日間
- Receive Message Wait Time: 20秒 (Long Polling)
- Dead Letter Queue: 有効 (最大3回リトライ後)

**メッセージフォーマット**:
```json
{
  "eventType": "FILE_UPLOADED",
  "s3Bucket": "cis-filesearch-raw-files-prod",
  "s3Key": "documents/2025/contract_001.pdf",
  "fileSize": 2048576,
  "uploadedAt": "2025-01-30T12:34:56Z",
  "metadata": {
    "originalPath": "/NAS/contracts/2025/contract_001.pdf",
    "mimeType": "application/pdf"
  }
}
```

---

### 3. 処理層 (EC2 Auto Scaling)

#### 3.1 EC2 Auto Scaling Group

**インスタンスタイプ**: `t3.medium` または `c6i.large` (要検証)

**購入オプション**: Spot Instances (最大70%コスト削減)

**スケーリング設定**:
- **最小**: 0インスタンス (アイドル時)
- **希望**: 2インスタンス (処理時)
- **最大**: 10インスタンス (ピーク時)

**Auto Scaling Policy**:
- **スケールアウト**: SQS ApproximateNumberOfMessages > 10
- **スケールイン**: SQS ApproximateNumberOfMessages < 2 (5分間)

**AMI**: Amazon Linux 2023

**User Data (起動スクリプト)**:
```bash
#!/bin/bash
yum update -y
yum install -y python3 python3-pip tesseract tesseract-langpack-jpn

# Processing script deployment
aws s3 cp s3://cis-filesearch-deployment/scripts/file_processor.py /opt/
chmod +x /opt/file_processor.py

# Start processing daemon
nohup python3 /opt/file_processor.py &
```

#### 3.2 EC2インスタンス処理フロー

```python
# file_processor.py (概要)

import boto3
import tesseract
from bedrock_client import BedrockClient

sqs = boto3.client('sqs')
s3 = boto3.client('s3')
bedrock = BedrockClient()

while True:
    # 1. SQSからメッセージ取得
    messages = sqs.receive_message(
        QueueUrl=QUEUE_URL,
        MaxNumberOfMessages=10,
        WaitTimeSeconds=20
    )

    for message in messages:
        file_info = json.loads(message['Body'])

        # 2. S3からファイルダウンロード
        s3.download_file(file_info['s3Bucket'], file_info['s3Key'], '/tmp/file')

        # 3. OCR処理 (画像・PDFのみ)
        if is_image_or_pdf(file_info):
            ocr_text = tesseract.image_to_string('/tmp/file', lang='jpn')

        # 4. Bedrock Titan - 画像ベクトル化
        if is_image(file_info):
            image_vector = bedrock.get_embeddings('/tmp/file')

        # 5. サムネイル生成
        thumbnail = generate_thumbnail('/tmp/file')
        s3.upload_file(thumbnail, THUMBNAIL_BUCKET, thumbnail_key)

        # 6. OpenSearchインデックス作成
        opensearch.index(document={
            'file_path': file_info['s3Key'],
            'ocr_text': ocr_text,
            'image_vector': image_vector,
            'thumbnail_url': thumbnail_url
        })

        # 7. DynamoDBメタデータ保存
        dynamodb.put_item(metadata)

        # 8. SQSメッセージ削除
        sqs.delete_message(ReceiptHandle=message['ReceiptHandle'])
```

---

### 4. AI・機械学習層

#### 4.1 Amazon Bedrock - Titan Multimodal Embeddings

**モデル**: `amazon.titan-embed-image-v1`

**用途**: 画像の類似検索用ベクトル化

**入力**: 画像ファイル (JPEG, PNG, GIF)

**出力**: 1024次元ベクトル

**API呼び出し例**:
```python
import boto3
import base64

bedrock_runtime = boto3.client('bedrock-runtime', region_name='us-east-1')

with open('image.jpg', 'rb') as f:
    image_bytes = f.read()

response = bedrock_runtime.invoke_model(
    modelId='amazon.titan-embed-image-v1',
    body=json.dumps({
        'inputImage': base64.b64encode(image_bytes).decode('utf-8')
    })
)

embeddings = json.loads(response['body'].read())['embedding']
# => [0.123, -0.456, 0.789, ...] (1024 dimensions)
```

**コスト**: $0.00006 / 画像 (2025年1月時点)

**制約**:
- リージョン: `us-east-1` (バージニア北部) のみ利用可能 (要確認)
- 画像サイズ: 最大5MB
- サポート形式: JPEG, PNG

#### 4.2 Tesseract OCR

**バージョン**: 5.x

**言語パック**:
- 日本語 (`jpn`)
- 英語 (`eng`)

**インストール** (Amazon Linux 2023):
```bash
sudo yum install -y tesseract tesseract-langpack-jpn
```

**Python API使用例**:
```python
import pytesseract
from PIL import Image

# PDFから画像抽出
images = convert_from_path('document.pdf')

# OCR実行
text = ''
for img in images:
    text += pytesseract.image_to_string(img, lang='jpn')

print(text)
```

**精度向上のための前処理**:
- グレースケール変換
- ノイズ除去
- コントラスト調整
- 解像度向上 (300 DPI推奨)

---

### 5. データストア層

#### 5.1 Amazon OpenSearch Service

**ドメイン名**: `cis-filesearch-opensearch-prod`

**バージョン**: OpenSearch 2.11

**インスタンス**:
- タイプ: `t3.small.search`
- ノード数: 2 (マルチAZ)
- EBSストレージ: 50GB (gp3)

**インデックス設計**:

##### 5.1.1 Files Index

```json
{
  "settings": {
    "index": {
      "number_of_shards": 2,
      "number_of_replicas": 1,
      "analysis": {
        "analyzer": {
          "kuromoji_analyzer": {
            "type": "custom",
            "tokenizer": "kuromoji_tokenizer",
            "filter": ["kuromoji_baseform", "kuromoji_part_of_speech", "cjk_width", "lowercase"]
          }
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "file_id": { "type": "keyword" },
      "file_name": { "type": "text", "analyzer": "kuromoji_analyzer" },
      "file_path": { "type": "keyword" },
      "file_size": { "type": "long" },
      "file_type": { "type": "keyword" },
      "mime_type": { "type": "keyword" },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" },
      "ocr_text": { "type": "text", "analyzer": "kuromoji_analyzer" },
      "thumbnail_url": { "type": "keyword" },
      "indexed_at": { "type": "date" }
    }
  }
}
```

##### 5.1.2 Images Index (k-NN)

```json
{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 100
    }
  },
  "mappings": {
    "properties": {
      "image_id": { "type": "keyword" },
      "file_path": { "type": "keyword" },
      "image_vector": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "space_type": "cosinesimil",
          "engine": "nmslib",
          "parameters": {
            "ef_construction": 128,
            "m": 24
          }
        }
      },
      "thumbnail_url": { "type": "keyword" },
      "indexed_at": { "type": "date" }
    }
  }
}
```

**画像類似検索クエリ例**:
```json
{
  "size": 10,
  "query": {
    "knn": {
      "image_vector": {
        "vector": [0.123, -0.456, ...],
        "k": 10
      }
    }
  }
}
```

#### 5.2 Amazon DynamoDB

**テーブル名**: `cis-filesearch-metadata-prod`

**キー設計**:
- Partition Key: `file_id` (String)
- Sort Key: なし

**属性**:
```json
{
  "file_id": "f_20250130_abc123",
  "file_name": "contract_001.pdf",
  "s3_bucket": "cis-filesearch-raw-files-prod",
  "s3_key": "documents/2025/contract_001.pdf",
  "file_size": 2048576,
  "mime_type": "application/pdf",
  "created_at": "2025-01-30T12:34:56Z",
  "updated_at": "2025-01-30T12:34:56Z",
  "processing_status": "COMPLETED",
  "ocr_status": "SUCCESS",
  "thumbnail_url": "https://thumbnails.example.com/abc123.jpg",
  "opensearch_indexed": true,
  "indexed_at": "2025-01-30T12:40:00Z"
}
```

**GSI (Global Secondary Index)**:
- Index Name: `s3-key-index`
- Partition Key: `s3_key`
- 用途: S3キーからメタデータ検索

**課金モード**: On-Demand (Pay-per-request)

---

### 6. フロントエンド層

#### 6.1 Amazon S3 - Frontend Bucket

**バケット名**: `cis-filesearch-frontend-prod`

**用途**: Next.js静的エクスポート (.html, .js, .css, 画像)

**設定**:
- 静的ウェブサイトホスティング: 無効 (CloudFront経由)
- パブリックアクセス: ブロック
- 暗号化: AES-256

#### 6.2 Amazon CloudFront

**Distribution ID**: (Terraformで自動生成)

**Origin**: S3 Frontend Bucket (OAI経由)

**キャッシュ動作**:
- デフォルトTTL: 86400秒 (24時間)
- 最大TTL: 31536000秒 (1年)
- 圧縮: 有効 (Gzip, Brotli)

**カスタムドメイン**: `filesearch.company.com` (要設定)

**SSL証明書**: ACM (us-east-1で発行)

#### 6.3 Amazon Cognito

**User Pool ID**: (Terraformで自動生成)

**認証フロー**:
- Username & Password
- MFA: オプション (SMS/TOTPアプリ)

**アプリクライアント**:
- クライアントID: (自動生成)
- トークン有効期限:
  - ID Token: 60分
  - Access Token: 60分
  - Refresh Token: 30日

**Hosted UI**: 有効

---

### 7. API層

#### 7.1 API Gateway REST API

**API名**: `cis-filesearch-api-prod`

**エンドポイント**: Regional

**認証**: Cognito Authorizer (JWT検証)

**APIリソース**:

```
GET  /search                    # ファイル検索
GET  /search/similar-images     # 類似画像検索
GET  /files/{file_id}           # ファイル詳細取得
GET  /files/{file_id}/download  # ファイルダウンロード (S3 Presigned URL)
POST /sync/trigger              # 手動同期トリガー (管理者のみ)
GET  /sync/status               # 同期ステータス取得
```

**Lambda統合**: 各エンドポイントに対応するLambda関数

---

### 8. 監視・ログ層

#### 8.1 Amazon CloudWatch

**ログ保持期間**: 7日間

**ロググループ**:
- `/aws/ec2/cis-filesearch-processing` (EC2処理ログ)
- `/aws/lambda/cis-filesearch-search-api` (Lambda検索API)
- `/aws/sqs/cis-filesearch-file-processing-queue` (SQSメトリクス)

**カスタムメトリクス**:
- `FilesProcessed` (処理済みファイル数)
- `OCRSuccessRate` (OCR成功率)
- `BedrockAPILatency` (Bedrock API応答時間)
- `OpenSearchIndexingLatency` (OpenSearchインデックス作成時間)

**アラーム設定**:
- EC2 CPU使用率 > 80% (5分間)
- SQS Dead Letter Queue メッセージ数 > 10
- Lambda エラー率 > 5%
- OpenSearch クラスター状態が Red

---

## 💰 コスト見積もり

### 月額コスト内訳 ($120-150/月)

| サービス | 項目 | 月額コスト |
|---------|-----|----------|
| **EC2** | t3.medium Spot (平均2台 × 730h) | $30-40 |
| **S3** | Raw Files (10TB Intelligent-Tiering) | $25 |
| **S3** | Thumbnails (5GB Standard) | $0.12 |
| **OpenSearch** | t3.small.search × 2 (730h) | $50 |
| **DynamoDB** | On-Demand (10万リクエスト/月) | $1.25 |
| **Bedrock** | Titan Embeddings (10,000画像/月) | $0.60 |
| **CloudFront** | 転送量 (100GB/月) | $8.50 |
| **CloudWatch** | ログ保存 (10GB/月, 7日) | $0.50 |
| **SQS** | Standard Queue (100万リクエスト) | $0.40 |
| **その他** | NAT Gateway, データ転送など | $3-10 |
| **合計** | | **$119.37 - $145.77** |

### コスト削減施策

1. **Spot Instances**: 最大70%削減 (オンデマンドと比較)
2. **S3 Intelligent-Tiering**: アクセス頻度に応じて自動的に最適化
3. **CloudWatch Logs 7日保持**: ストレージ費用削減
4. **OpenSearch Reserved Instances**: 3ヶ月後に検討 ($10/月削減)

---

## 🔐 セキュリティ

### 認証・認可

- **ユーザー認証**: Cognito User Pool (JWT)
- **APIアクセス制御**: Cognito Authorizer
- **ファイルアクセス**: S3 Presigned URL (有効期限15分)

### データ暗号化

- **転送中**: TLS 1.2以上 (CloudFront, API Gateway)
- **保存時**:
  - S3: AES-256 (SSE-S3)
  - DynamoDB: AWS KMS
  - OpenSearch: Node-to-node暗号化

### ネットワークセキュリティ

- **VPC**: プライベートサブネットにEC2配置
- **Security Group**: 最小権限の原則
- **IAM Role**: EC2インスタンスに最小権限ロール付与

---

## 🚀 デプロイフロー

### 1. Terraformインフラストラクチャ構築

```bash
cd terraform
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

### 2. EC2処理スクリプトのデプロイ

```bash
# S3にスクリプトアップロード
aws s3 cp scripts/file_processor.py s3://cis-filesearch-deployment/scripts/
```

### 3. ファイルスキャナーPCセットアップ

(詳細は別途ドキュメント作成予定)

### 4. OpenSearchインデックス作成

```bash
curl -X PUT "https://opensearch-endpoint/files" \
  -H 'Content-Type: application/json' \
  -d @opensearch_files_index.json

curl -X PUT "https://opensearch-endpoint/images" \
  -H 'Content-Type: application/json' \
  -d @opensearch_images_index.json
```

### 5. フロントエンドデプロイ

```bash
cd frontend
yarn build
aws s3 sync out/ s3://cis-filesearch-frontend-prod/
aws cloudfront create-invalidation --distribution-id XXXXXX --paths "/*"
```

---

## 📊 運用・監視

### 手動同期トリガー

```bash
# EventBridge経由
aws events put-events --entries file://manual_sync_event.json
```

### ログ確認

```bash
# EC2処理ログ
aws logs tail /aws/ec2/cis-filesearch-processing --follow

# SQSメトリクス
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=cis-filesearch-file-processing-queue \
  --start-time 2025-01-30T00:00:00Z \
  --end-time 2025-01-30T23:59:59Z \
  --period 3600 \
  --statistics Average
```

---

## 🔄 マイグレーションパス

### 従来アーキテクチャ (Step Functions) からの移行手順

1. **Phase 1**: 新規リソース作成 (EC2, SQS, EventBridge)
2. **Phase 2**: 並行運用期間 (両システム稼働)
3. **Phase 3**: データ移行とカットオーバー
4. **Phase 4**: 旧リソース削除 (DataSync, VPN, Step Functions)

詳細は `/docs/migration-plan.md` 参照 (作成予定)

---

## 📚 関連ドキュメント

- [Requirement Specification](/docs/requirement.md)
- [Implementation Roadmap](/docs/implementation-roadmap-optimized.md)
- [Cost Optimization Analysis](/docs/cost-optimization-analysis.md)
- [Terraform Infrastructure Guide](/terraform/README.md)

---

## ❓ 未確認事項・要ヒアリング

以下の項目は、実装前にユーザーへのヒアリングが必要です:

1. **ファイルスキャナーPCの詳細仕様**
   - OS (Windows/Linux)
   - 実装言語 (Python/Node.js/その他)
   - スキャン間隔・トリガー方式

2. **EC2インスタンスの詳細設定**
   - 最適なインスタンスタイプ (t3.medium/c6i.large/その他)
   - Spot Instancesの中断リスク許容度
   - Auto Scalingポリシーの調整

3. **Bedrock利用リージョン**
   - Titan Multimodal Embeddingsの利用可能リージョン確認
   - レイテンシとコストのトレードオフ

4. **DataSyncとVPNの廃止確認**
   - 完全に削除するか、一時的に無効化するか
   - 既存データのバックアップ・移行方法

5. **同期頻度の変更理由**
   - 月次 → 四半期変更の背景
   - 新規ファイルへのアクセス要件

6. **OCR対象ファイルの範囲**
   - 画像のみか、PDFも含むか
   - 言語パック (日本語のみか、多言語対応か)

7. **サムネイル生成の詳細**
   - サイズ・形式 (JPEG/PNG/WebP)
   - 対象ファイルタイプ

8. **CloudWatch監視の詳細要件**
   - アラート通知先 (Email/Slack/SNS)
   - 7日保持で十分か、延長が必要か

---

**最終更新**: 2025-01-30
**作成者**: Claude Code
**ステータス**: 🟡 レビュー待ち (ヒアリング事項多数)
