# SQS Consumer セットアップガイド

このドキュメントでは、ファイルスキャンPCでSQS Consumerを常駐サービスとして設定する方法を説明します。

## 概要

SQS Consumerは、フロントエンドからの「NAS同期」リクエストをSQSキューから受信し、PowerShellスクリプト（`nas-sync-improved.ps1`）を呼び出して差分同期を実行するサービスです。

### 処理フロー（PowerShellモード）

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                             ファイルスキャンPC                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌──────────────────┐                                                          │
│  │  SQS Consumer    │ ← SQSからメッセージ受信                                    │
│  │  (Node.js)       │                                                          │
│  └────────┬─────────┘                                                          │
│           │ PowerShell呼び出し                                                  │
│           ▼                                                                     │
│  ┌──────────────────┐     ┌──────────────────────┐                             │
│  │ nas-sync-        │────▶│   incoming/ フォルダ   │                             │
│  │ improved.ps1     │     │  (XDW/XBD + .meta)   │                             │
│  └──────────────────┘     └──────────┬───────────┘                             │
│           │                          │                                          │
│           │ DynamoDB更新              ▼                                          │
│           │               ┌──────────────────────┐    ┌──────────────────────┐ │
│           │               │ DocuWorks Converter  │───▶│  converted/ フォルダ  │ │
│           │               │ (常駐サービス)        │    │  (PDF + OCRテキスト)  │ │
│           │               └──────────────────────┘    └──────────┬───────────┘ │
│           │                                                      │              │
│           ▼                                                      ▼              │
│  ┌──────────────────┐                                ┌──────────────────────┐  │
│  │    DynamoDB      │                                │  DataSync Monitor    │  │
│  │  (進捗・結果)     │                                │  (S3アップロード)     │  │
│  └──────────────────┘                                └──────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 同期ボタンを押すと起動されるサービス

| サービス | トリガー | 説明 |
|----------|---------|------|
| **SQS Consumer** | SQSメッセージ | PowerShellスクリプトを呼び出し |
| **nas-sync-improved.ps1** | SQS Consumer | NASからincoming/へファイルコピー |
| **DocuWorks Converter** | incoming/監視 | XDW/XBD → PDF + OCRテキスト変換 |
| **DataSync Monitor** | converted/監視 | S3へアップロード |

## 必要な環境変数

```bash
# AWS認証（IAMロールを使用しない場合）
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_PROFILE=cis-scanner

# SQS Consumer用（必須）
SYNC_SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/xxx/cis-filesearch-sync-trigger-queue.fifo
SYNC_DYNAMODB_TABLE=cis-filesearch-sync-progress

# 実行モード設定
# SYNC_MODE: 'auto' (デフォルト), 'powershell', 'nodejs'
# - auto: Windows環境ではPowerShell、それ以外ではNode.js
# - powershell: 強制的にPowerShell使用（DocuWorks OCR対応）
# - nodejs: 強制的にNode.js使用（直接S3アップロード、DocuWorks非対応）
SYNC_MODE=auto

# PowerShellスクリプトパス
NAS_SYNC_SCRIPT_PATH=C:\CIS-FileSearch\scripts\nas-sync-improved.ps1

# スキャナー設定（Node.jsモード用）
NAS_MOUNT_PATH=/mnt/nas
S3_BUCKET_NAME=cis-filesearch-landing
DB_PATH=./data/scanner.db
```

## セットアップ手順

### 1. 依存関係のインストール

```bash
cd backend/file-scanner
yarn install
yarn build
```

### 2. 環境変数の設定

`.env`ファイルを作成して環境変数を設定:

```bash
cp .env.example .env
# 上記の環境変数を設定
```

### 3. 動作確認

```bash
# Consumer を起動
yarn consumer

# または本番ビルドで実行
yarn consumer:prod
```

## Windows サービス化

### オプションA: PM2を使用（推奨）

```powershell
# PM2をグローバルインストール
npm install -g pm2

# Consumerをサービスとして開始
cd C:\path\to\file-scanner
pm2 start "yarn consumer:prod" --name cis-file-scanner

# 自動起動設定
pm2 save
pm2 startup

# ステータス確認
pm2 status
pm2 logs cis-file-scanner
```

### オプションB: NSSMを使用

```powershell
# NSSMをダウンロード: https://nssm.cc/

# サービスをインストール
nssm install CISFileScanner "C:\Program Files\nodejs\node.exe"
nssm set CISFileScanner AppParameters "C:\path\to\file-scanner\dist\index.js consumer"
nssm set CISFileScanner AppDirectory "C:\path\to\file-scanner"
nssm set CISFileScanner AppEnvironmentExtra "AWS_REGION=ap-northeast-1" ^
    "SYNC_SQS_QUEUE_URL=https://sqs..." ^
    "SYNC_DYNAMODB_TABLE=cis-file-sync-progress"

# サービス開始
nssm start CISFileScanner

# サービス状態確認
nssm status CISFileScanner
```

### オプションC: タスクスケジューラを使用

1. タスクスケジューラを開く
2. 「タスクの作成」をクリック
3. 全般タブ:
   - 名前: `CIS File Scanner Consumer`
   - 「ユーザーがログオンしているかどうかにかかわらず実行する」を選択
4. トリガータブ:
   - 「スタートアップ時」を選択
5. 操作タブ:
   - プログラム: `node.exe`
   - 引数: `C:\path\to\file-scanner\dist\index.js consumer`
   - 開始: `C:\path\to\file-scanner`
6. 設定タブ:
   - 「タスクが失敗した場合の再起動」にチェック

## トラブルシューティング

### Consumer が起動しない

1. 環境変数を確認:
   ```bash
   echo $SYNC_SQS_QUEUE_URL
   echo $SYNC_DYNAMODB_TABLE
   ```

2. AWS認証を確認:
   ```bash
   aws sts get-caller-identity
   ```

3. SQSキューへのアクセスを確認:
   ```bash
   aws sqs get-queue-attributes --queue-url $SYNC_SQS_QUEUE_URL
   ```

### メッセージが処理されない

1. SQSキューにメッセージがあるか確認:
   ```bash
   yarn dev diagnose-sqs
   ```

2. DynamoDBテーブルへのアクセスを確認:
   ```bash
   aws dynamodb describe-table --table-name $SYNC_DYNAMODB_TABLE
   ```

### スキャンが失敗する

1. NASマウントを確認:
   ```bash
   ls $NAS_MOUNT_PATH
   ```

2. S3バケットへのアクセスを確認:
   ```bash
   aws s3 ls s3://$S3_BUCKET_NAME
   ```

## 監視

### ログの確認

```bash
# PM2の場合
pm2 logs cis-file-scanner

# 直接実行の場合
tail -f logs/scanner.log
```

### 統計の確認

```bash
# Consumer内で1分ごとに統計が出力される
# processed=処理したメッセージ数, errors=エラー数
```

### CloudWatch メトリクス

AWS CloudWatchで以下のメトリクスを監視:
- SQS: `ApproximateNumberOfMessagesVisible`
- DynamoDB: `ConsumedReadCapacityUnits`, `ConsumedWriteCapacityUnits`

## IAMポリシー

Consumer に必要な最小限の IAM 権限:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:ap-northeast-1:*:cis-file-sync-queue.fifo"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:ap-northeast-1:*:table/cis-file-sync-progress"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-landing/*"
    }
  ]
}
```
