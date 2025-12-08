# CIS File Processor Worker - EC2 Python Application

## 概要

CIS File Search Application用のEC2ワーカーアプリケーションです。S3にアップロードされたファイルを処理し、OCR、サムネイル生成、ベクトル化を行い、OpenSearchにインデックスします。

## 🏗️ アーキテクチャ

```
SQS → EC2 Worker → OpenSearch
        ↓
    - OCR (Tesseract)
    - Thumbnail Generation
    - Vector Embedding (Bedrock)
```

## 📦 主要コンポーネント

### 1. **SQS Handler** (`sqs_handler.py`)
- SQSキューからメッセージをLong Polling
- 並列処理（ThreadPoolExecutor）
- Spot中断対応（グレースフルシャットダウン）

### 2. **S3 Client** (`s3_client.py`)
- ファイルのダウンロード/アップロード
- サムネイルの保存
- 処理済みファイルの削除

### 3. **OCR Processor** (`ocr_processor.py`)
- Tesseract OCRでテキスト抽出
- 対応形式: 画像、PDF、テキストファイル
- 日本語・英語対応

### 4. **Thumbnail Generator** (`thumbnail_generator.py`)
- 画像・PDFのサムネイル生成
- 300x300px、JPEG形式
- S3に自動保存

### 5. **Bedrock Client** (`bedrock_client.py`)
- Amazon Bedrock Titan Multimodal Embeddings
- 1024次元のベクトル生成
- 画像・テキストの類似検索用

### 6. **OpenSearch Client** (`opensearch_client.py`)
- 全文検索インデックス
- k-NNベクトル検索
- 日本語アナライザー（kuromoji）

## 🚀 クイックスタート

### 1. AWS設定確認

```bash
# 設定確認スクリプトを実行
python verify_aws_config.py
```

### 2. 環境変数設定

```bash
# .envファイルを作成
cp .env.example .env

# 必要な値を設定
vim .env
```

### 3. ローカルでテスト実行

```bash
# 仮想環境作成
python3 -m venv venv
source venv/bin/activate

# 依存関係インストール
pip install -r requirements.txt

# Tesseractインストール（Mac）
brew install tesseract
brew install tesseract-lang

# Tesseractインストール（Ubuntu）
sudo apt-get install tesseract-ocr tesseract-ocr-jpn

# 実行
python src/main.py
```

## 🖥️ EC2へのデプロイ

### 1. EC2インスタンス起動

Launch Templateで以下を設定:
- AMI: Amazon Linux 2 or Ubuntu 22.04
- Instance Type: t3.medium以上
- IAM Role: CIS-EC2-FileProcessor-Role
- User Data: `deploy/install.sh`

### 2. 手動インストール

```bash
# EC2にSSH接続
ssh ec2-user@your-instance-ip

# インストールスクリプト実行
sudo bash install.sh

# 環境変数設定
sudo vim /opt/cis-file-processor/.env

# サービス開始
sudo systemctl start cis-worker.service

# ステータス確認
sudo systemctl status cis-worker.service

# ログ確認
tail -f /var/log/cis-worker/worker.log
```

## 📊 モニタリング

### CloudWatchメトリクス
- `CIS/FileProcessor/FileProcessed`: 処理済みファイル数
- `CIS/FileProcessor/ProcessingTime`: 処理時間
- CPU/メモリ使用率

### CloudWatch Logs
- `/aws/ec2/cis-file-processor/worker`: アプリケーションログ
- `/aws/ec2/cis-file-processor/error`: エラーログ

## 🔧 設定項目

### 必須環境変数

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `SQS_QUEUE_URL` | SQSキューURL | `https://sqs.ap-northeast-1.amazonaws.com/.../cis-file-processing-queue` |
| `OPENSEARCH_ENDPOINT` | OpenSearchエンドポイント | `search-cis-xxx.ap-northeast-1.es.amazonaws.com` |
| `S3_LANDING_BUCKET` | ランディングバケット | `cis-landing-bucket` |
| `S3_THUMBNAIL_BUCKET` | サムネイルバケット | `cis-thumbnail-bucket` |

### オプション設定

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `WORKER_THREADS` | 4 | 並列処理スレッド数 |
| `SQS_MAX_MESSAGES` | 10 | 一度に取得するメッセージ数 |
| `ENABLE_OCR` | true | OCR有効化 |
| `ENABLE_THUMBNAIL` | true | サムネイル生成有効化 |
| `ENABLE_VECTOR_SEARCH` | true | ベクトル検索有効化 |

## 🐛 トラブルシューティング

### OCRが動作しない
```bash
# Tesseractインストール確認
tesseract --version

# 日本語データ確認
tesseract --list-langs | grep jpn
```

### OpenSearch接続エラー
```bash
# エンドポイント確認
curl https://your-opensearch-endpoint.es.amazonaws.com/

# IAMロール確認
aws sts get-caller-identity
```

### Bedrock権限エラー
```bash
# Bedrockモデルアクセス確認
aws bedrock list-foundation-models --region ap-northeast-1
```

## 📈 パフォーマンス

### 処理速度目安
- 画像ファイル: 2-3秒/ファイル
- PDFファイル: 5-10秒/ファイル（ページ数による）
- テキストファイル: 0.5-1秒/ファイル

### スケーリング
- Auto Scaling: SQSメッセージ数に基づく
- Min: 0, Max: 10インスタンス
- TargetValue: 100メッセージ/インスタンス

## 🔒 セキュリティ

- IAMロールベース認証
- VPC内での処理
- CloudWatch Logsへの安全なログ送信
- Secrets Manager対応（オプション）

## 📝 ライセンス

MIT

## 🤝 コントリビューション

Issue、Pull Requestは歓迎します。

## 📧 サポート

DevOpsチーム: devops@company.com