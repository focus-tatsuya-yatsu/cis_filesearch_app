# 📦 インストールガイド - 依存関係の解決

## エラーの原因

`urllib3`のバージョン競合が発生していました：
- `botocore 1.34.25` → urllib3 < 1.27 を要求
- `opensearch-py 2.4.2` → urllib3 >= 1.26.18 を要求
- `types-requests` → urllib3 >= 2 を要求

## ✅ 解決方法

### 方法1: 必須パッケージのみインストール（推奨）

```bash
# 仮想環境をクリーンアップ
deactivate  # 仮想環境を抜ける
rm -rf venv  # 既存の仮想環境を削除

# 新しい仮想環境を作成
python3 -m venv venv
source venv/bin/activate

# pipをアップグレード
pip install --upgrade pip

# コア依存関係のみインストール
pip install -r requirements-core.txt
```

### 方法2: 段階的インストール

```bash
# 基本パッケージをインストール
pip install boto3 opensearch-py requests-aws4auth

# 画像処理関連
pip install Pillow pytesseract pdf2image PyPDF2

# その他のツール
pip install python-dotenv python-json-logger psutil numpy
```

### 方法3: 競合パッケージを除外

```bash
# types-requestsを除外してインストール
pip install boto3 botocore opensearch-py requests-aws4auth
pip install Pillow pytesseract pdf2image PyPDF2
pip install python-dotenv python-json-logger psutil numpy

# 開発ツールは別途インストール（オプション）
pip install pytest pytest-asyncio pytest-mock
pip install black flake8 isort
```

## 🔍 インストール確認

インストール後、以下のコマンドで確認：

```bash
# Pythonで依存関係を確認
python -c "
import boto3
import opensearchpy
import pytesseract
from PIL import Image
print('✅ All core packages imported successfully!')
"

# バージョン確認
pip list | grep -E "boto3|opensearch|Pillow|pytesseract"
```

## 🚀 アプリケーション実行

### 1. 環境変数設定

```bash
cp .env.example .env
vim .env

# 必須項目を設定:
# - SQS_QUEUE_URL
# - OPENSEARCH_ENDPOINT
# - S3_LANDING_BUCKET
# - S3_THUMBNAIL_BUCKET
```

### 2. AWS設定確認

```bash
# AWS認証設定
aws configure
# または環境変数
export AWS_REGION=ap-northeast-1
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret

# 設定確認スクリプト実行
python verify_aws_config.py
```

### 3. Worker実行

```bash
# 実行
python src/main.py
```

## 🐛 トラブルシューティング

### Tesseractエラー

```bash
# Mac
brew install tesseract
brew install tesseract-lang  # 日本語データ

# Ubuntu/Debian
sudo apt-get install tesseract-ocr tesseract-ocr-jpn

# Amazon Linux/CentOS
sudo yum install tesseract tesseract-langpack-jpn
```

### OpenSearchエラー

```python
# 接続テスト
from opensearchpy import OpenSearch

client = OpenSearch(
    hosts=['https://your-domain.es.amazonaws.com:443'],
    use_ssl=True,
    verify_certs=True
)
print(client.info())
```

### メモリ不足エラー

```bash
# Swap追加（EC2インスタンスの場合）
sudo dd if=/dev/zero of=/swapfile bs=1G count=2
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## 📝 EC2デプロイ用の簡易版

EC2インスタンスでは、システムパッケージマネージャーを使用：

```bash
#!/bin/bash
# EC2 User Data スクリプト

# システム更新
sudo yum update -y

# Python3とpipインストール
sudo yum install -y python3 python3-pip

# Tesseractインストール
sudo yum install -y tesseract tesseract-langpack-jpn

# 画像処理ライブラリ
sudo yum install -y poppler-utils

# アプリケーションディレクトリ作成
sudo mkdir -p /opt/cis-worker
cd /opt/cis-worker

# 必須パッケージのみインストール
pip3 install boto3 opensearch-py requests-aws4auth
pip3 install Pillow pytesseract pdf2image PyPDF2
pip3 install python-dotenv psutil numpy

# アプリケーションコードをコピー（S3から取得など）
aws s3 cp s3://your-bucket/cis-worker.tar.gz .
tar -xzf cis-worker.tar.gz

# 実行
python3 src/main.py
```

## 📊 パッケージバージョン情報

### 動作確認済みバージョン

| パッケージ | バージョン | 備考 |
|-----------|-----------|------|
| Python | 3.8+ | 3.9推奨 |
| boto3 | 1.34.x | AWS SDK |
| opensearch-py | 2.4.x | OpenSearchクライアント |
| Pillow | 10.x | 画像処理 |
| pytesseract | 0.3.x | OCR |
| numpy | 1.24.x | ベクトル計算 |

### urllib3互換性

| パッケージ | urllib3要求 | 解決バージョン |
|-----------|------------|---------------|
| botocore | < 1.27 | 1.26.18 |
| opensearch-py | >= 1.26.18 | 1.26.18 |
| requests | 1.21+ | 1.26.18 |

## ✅ 完了！

これでインストール問題は解決されるはずです。問題が続く場合は：

1. Python バージョンを確認（3.8以上推奨）
2. 仮想環境を完全にクリーンアップ
3. `requirements-core.txt`から必須パッケージのみインストール

頑張ってください！🚀