# DocuWorks + Bedrock Integration - Quick Start Guide

## Overview

このガイドでは、DocuWorks SDK と AWS Bedrock を統合した統合ワーカーの実装を、最短で実現する手順を提供します。

## Prerequisites

- AWS アカウント
- DocuWorks 商用ライセンス (1本購入済み)
- Windows Server 2022 EC2 インスタンス
- 基本的なAWSサービスの理解

---

## Quick Start (最短5ステップ)

### Step 1: EC2 Instance Setup (30分)

```powershell
# Windows Server 2022 EC2にRDP接続後

# Python 3.11のインストール
$pythonUrl = "https://www.python.org/ftp/python/3.11.5/python-3.11.5-amd64.exe"
Invoke-WebRequest -Uri $pythonUrl -OutFile "python-installer.exe"
Start-Process -Wait -FilePath "python-installer.exe" -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1"

# Chocolateyのインストール
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Tesseract OCRのインストール
choco install tesseract -y

# Gitのインストール
choco install git -y

# リポジトリのクローン
cd C:\
git clone https://github.com/your-org/cis-filesearch-app.git
cd cis-filesearch-app\backend\python-worker
```

### Step 2: DocuWorks SDK Installation (15分)

```powershell
# DocuWorks Viewer/SDKのインストール
# 1. Fuji XeroxのWebサイトからダウンロード
#    https://www.fujixerox.co.jp/product/software/docuworks/

# 2. インストーラーを実行
#    - 商用ライセンスキーを入力
#    - デフォルトパスにインストール: C:\Program Files\Fuji Xerox\DocuWorks

# 3. インストール確認
Test-Path "C:\Program Files\Fuji Xerox\DocuWorks"  # True が返ればOK
```

### Step 3: License Configuration (10分)

```bash
# AWS Secrets Managerにライセンスを保存
# (ローカルマシンまたはCloudShellから実行)

aws secretsmanager create-secret \
    --name cis-filesearch/docuworks-license \
    --description "DocuWorks Commercial License" \
    --secret-string '{
        "license_key": "YOUR-LICENSE-KEY",
        "license_type": "commercial",
        "purchased_date": "2024-12-01",
        "max_concurrent": 1
    }' \
    --region ap-northeast-1
```

### Step 4: Worker Installation (20分)

```powershell
# Python環境のセットアップ
cd C:\cis-filesearch-app\backend\python-worker

# 仮想環境作成
python -m venv venv
.\venv\Scripts\activate

# 依存関係のインストール
pip install --upgrade pip
pip install -r requirements.txt

# Windows COM サポート (DocuWorks SDK用)
pip install pywin32
python .\venv\Scripts\pywin32_postinstall.py -install

# Bedrock統合用の追加パッケージ
pip install boto3 Pillow

# 環境変数ファイルの作成
@"
AWS_REGION=ap-northeast-1
S3_BUCKET=cis-filesearch-storage
SQS_QUEUE_URL=YOUR_SQS_QUEUE_URL
OPENSEARCH_ENDPOINT=YOUR_OPENSEARCH_ENDPOINT
OPENSEARCH_INDEX=file-index

DOCUWORKS_SDK_PATH=C:\Program Files\Fuji Xerox\DocuWorks
DOCUWORKS_LICENSE_SECRET=cis-filesearch/docuworks-license
DOCUWORKS_EXTRACT_TEXT=true
DOCUWORKS_EXTRACT_IMAGES=true
DOCUWORKS_OCR_FALLBACK=true

BEDROCK_MODEL_ID=amazon.titan-embed-image-v1
BEDROCK_REGION=us-east-1
BEDROCK_IMAGE_VECTOR=true
BEDROCK_TEXT_VECTOR=true

LOG_LEVEL=INFO
"@ | Out-File -FilePath .env -Encoding UTF8
```

### Step 5: Start Worker (5分)

```powershell
# 設定の検証
python worker.py --validate-only

# OpenSearchインデックスの作成
python worker.py --create-index

# ワーカーの起動 (テスト実行)
python worker.py

# 正常に起動したら、Ctrl+C で停止
```

---

## Windows Service としてのインストール (オプション)

```powershell
# NSSMのインストール
choco install nssm -y

# ログディレクトリの作成
New-Item -ItemType Directory -Path C:\logs -Force

# サービスの作成
$pythonPath = "C:\cis-filesearch-app\backend\python-worker\venv\Scripts\python.exe"
$workerPath = "C:\cis-filesearch-app\backend\python-worker"
$scriptPath = "worker.py"

nssm install CISFileWorker $pythonPath
nssm set CISFileWorker AppDirectory $workerPath
nssm set CISFileWorker AppParameters $scriptPath
nssm set CISFileWorker DisplayName "CIS File Search Worker"
nssm set CISFileWorker Description "File processing worker with DocuWorks SDK and Bedrock integration"
nssm set CISFileWorker Start SERVICE_AUTO_START

# ログ設定
nssm set CISFileWorker AppStdout "C:\logs\worker-stdout.log"
nssm set CISFileWorker AppStderr "C:\logs\worker-stderr.log"
nssm set CISFileWorker AppStdoutCreationDisposition 4  # Append
nssm set CISFileWorker AppStderrCreationDisposition 4  # Append

# 環境変数の設定
nssm set CISFileWorker AppEnvironmentExtra PYTHONUNBUFFERED=1

# サービスの起動
nssm start CISFileWorker

# ステータス確認
nssm status CISFileWorker

# ログの確認
Get-Content C:\logs\worker-stdout.log -Tail 50 -Wait
```

---

## Verification Steps (動作確認)

### 1. テストファイルのアップロード

```powershell
# PowerShell から S3 にテストファイルをアップロード
aws s3 cp test-files/sample.xdw s3://cis-filesearch-storage/test/sample.xdw

# または、AWS Console から手動アップロード
```

### 2. 処理状況の確認

```powershell
# ログの確認
Get-Content C:\logs\worker-stdout.log -Tail 100

# 期待されるログ出力:
# - "Processing file: s3://..."
# - "Processing with DocuWorks SDK: ..."
# - "Generating image embedding: ..."
# - "Indexed document: ..."
```

### 3. OpenSearch での検索確認

```bash
# ローカルマシンから OpenSearch に接続して確認

# ドキュメント数の確認
curl -XGET "https://YOUR_OPENSEARCH_ENDPOINT/file-index/_count"

# 検索テスト
curl -XPOST "https://YOUR_OPENSEARCH_ENDPOINT/file-index/_search" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "match_all": {}
    },
    "size": 1
  }'

# ベクトルフィールドの確認
curl -XGET "https://YOUR_OPENSEARCH_ENDPOINT/file-index/_mapping"
# 期待: "image_vector" フィールドが "knn_vector" タイプで存在
```

---

## Troubleshooting

### Issue 1: DocuWorks SDK が初期化されない

**症状:**
```
ERROR - Failed to initialize DocuWorks SDK: ...
```

**解決策:**
```powershell
# 1. DocuWorksが正しくインストールされているか確認
Test-Path "C:\Program Files\Fuji Xerox\DocuWorks\DwDesk.exe"

# 2. ライセンスが有効か確認
# DocuWorks Desk を起動して、ライセンス情報を確認

# 3. COM登録の確認
regsvr32 "C:\Program Files\Fuji Xerox\DocuWorks\DwDocVw.dll"

# 4. pywin32の再インストール
pip uninstall pywin32 -y
pip install pywin32
python .\venv\Scripts\pywin32_postinstall.py -install
```

### Issue 2: Bedrock API エラー

**症状:**
```
ERROR - Bedrock API error: AccessDeniedException
```

**解決策:**
```bash
# IAM ロールに Bedrock 権限を追加

aws iam attach-role-policy \
    --role-name EC2-FileProcessor-Role \
    --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess

# または、カスタムポリシーを作成
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*:*:model/*"
    }
  ]
}
```

### Issue 3: OpenSearch 接続エラー

**症状:**
```
ERROR - Failed to initialize OpenSearch client: ...
```

**解決策:**
```bash
# 1. VPC セキュリティグループの確認
# OpenSearch domain のセキュリティグループで、EC2 からの接続を許可

# 2. VPC エンドポイントの確認 (プライベートアクセスの場合)
aws ec2 describe-vpc-endpoints --filters "Name=service-name,Values=com.amazonaws.ap-northeast-1.es"

# 3. IAM ロールの確認
aws iam get-role-policy \
    --role-name EC2-FileProcessor-Role \
    --policy-name OpenSearchAccess
```

### Issue 4: メモリ不足エラー

**症状:**
```
ERROR - MemoryError: Unable to allocate array
```

**解決策:**
```powershell
# 1. EC2 インスタンスタイプの確認
# 推奨: t3.medium 以上 (4GB RAM)

# 2. 並列処理数の削減
# .env ファイルで調整
MAX_WORKERS=2  # デフォルト4から2に削減

# 3. ページ制限の設定
DOCUWORKS_MAX_PAGES=500  # 大きなファイルの処理制限
```

---

## Performance Optimization

### 推奨 EC2 インスタンス構成

```yaml
Instance Type: t3.medium (minimum) or t3.large (recommended)
vCPU: 2-4
RAM: 4-8 GB
Storage: 100 GB gp3 SSD
Network: Enhanced Networking enabled
```

### 最適化設定

```bash
# .env の最適化設定

# 並列処理 (CPU コア数に基づく)
MAX_WORKERS=4

# メモリ制限
MAX_FILE_SIZE_MB=100
DOCUWORKS_MAX_PAGES=1000

# タイムアウト設定
PROCESSING_TIMEOUT=300
DOCUWORKS_TIMEOUT=180
BEDROCK_TIMEOUT=30

# バッチ処理
SQS_MAX_MESSAGES=1  # 1つずつ処理 (安定性重視)
# または
SQS_MAX_MESSAGES=10  # バッチ処理 (スループット重視)

# Bedrock レート制限対策
BEDROCK_MAX_RETRIES=3
```

---

## Monitoring Setup

### CloudWatch Logs の確認

```bash
# ログストリームの確認
aws logs describe-log-streams \
    --log-group-name /aws/ec2/file-processor \
    --order-by LastEventTime \
    --descending

# 最新ログの取得
aws logs tail /aws/ec2/file-processor --follow
```

### CloudWatch Metrics の確認

```bash
# 処理済みファイル数
aws cloudwatch get-metric-statistics \
    --namespace CIS/FileProcessor \
    --metric-name FileProcessed \
    --start-time 2024-12-02T00:00:00Z \
    --end-time 2024-12-02T23:59:59Z \
    --period 3600 \
    --statistics Sum

# Bedrock API 呼び出し数
aws cloudwatch get-metric-statistics \
    --namespace CIS/FileProcessor \
    --metric-name BedrockCalls \
    --start-time 2024-12-02T00:00:00Z \
    --end-time 2024-12-02T23:59:59Z \
    --period 3600 \
    --statistics Sum
```

---

## Cost Estimation

### 月間コスト見積もり (東京リージョン)

```
EC2 (t3.medium, 24/7):           ~$30/month
EBS (100GB gp3):                 ~$8/month
OpenSearch (t3.medium.search):   ~$70/month
Bedrock (画像ベクトル化):
  - 1,000 images/day:            ~$15/month
  - 10,000 images/day:           ~$150/month
S3 Storage:                      ~$5/month
SQS:                             ~$1/month
CloudWatch Logs:                 ~$5/month

合計 (低負荷):                   ~$134/month
合計 (高負荷):                   ~$269/month
```

### コスト最適化のヒント

1. **Bedrock の使用を最適化**
   - 重複画像の検出とスキップ
   - バッチ処理の活用
   - 必要な場合のみベクトル化

2. **EC2 の最適化**
   - Spot Instances の利用 (最大70%削減)
   - Auto Scaling の設定
   - 夜間停止 (開発環境)

3. **OpenSearch の最適化**
   - UltraWarm ストレージの活用
   - レプリカ数の調整
   - インデックスライフサイクル管理

---

## Next Steps

1. **本番環境への移行**
   - Auto Scaling の設定
   - Multi-AZ 構成
   - バックアップ戦略

2. **機能拡張**
   - 他のファイルタイプのサポート
   - 高度な検索機能
   - UI/API の開発

3. **運用改善**
   - モニタリングダッシュボード
   - アラート設定
   - ログ分析

---

## Support and Resources

- **ドキュメント:** `/docs/deployment/DOCUWORKS-BEDROCK-INTEGRATION-GUIDE.md`
- **AWS サポート:** https://console.aws.amazon.com/support/
- **DocuWorks サポート:** https://www.fujixerox.co.jp/support/
- **プロジェクト Issue:** GitHub Issues

---

**Document Version:** 1.0
**Last Updated:** 2025-12-02
