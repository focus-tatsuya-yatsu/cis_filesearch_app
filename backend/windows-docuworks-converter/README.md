# DocuWorks Converter Service

Windows EC2で実行するDocuWorks→PDF変換サービスです。

## 前提条件

1. **Windows Server** (EC2 Windows AMI推奨)
2. **DocuWorks Viewer/SDK** (Fuji Xerox)
   - 商用ライセンスが必要
   - DocuWorks 9.x 以降推奨
3. **Python 3.8+**

## セットアップ

### 1. DocuWorksのインストール

1. DocuWorks Viewer または DocuWorks をインストール
2. ライセンスをアクティベート
3. COMコンポーネントが登録されていることを確認

```powershell
# DocuWorks COMオブジェクトの確認（PowerShell）
$dw = New-Object -ComObject DocuWorks.Application
$dw.Quit()
Write-Host "DocuWorks COM object is available"
```

### 2. Python環境のセットアップ

```powershell
# Python仮想環境を作成
python -m venv venv
.\venv\Scripts\activate

# 依存パッケージをインストール
pip install -r requirements.txt
```

### 3. 環境変数の設定

```powershell
# .env ファイルをコピー
copy .env.example .env

# 環境変数を編集
notepad .env
```

必須設定:
- `AWS_REGION`: AWSリージョン
- `S3_SOURCE_BUCKET`: 変換元ファイルのS3バケット
- `S3_TARGET_BUCKET`: 変換後PDFの保存先バケット
- `SQS_QUEUE_URL`: 変換リクエストキューのURL

### 4. AWS認証設定

```powershell
# AWS CLIで設定
aws configure

# または環境変数で設定
$env:AWS_ACCESS_KEY_ID = "your-key-id"
$env:AWS_SECRET_ACCESS_KEY = "your-secret-key"
```

## 実行方法

### サービスモード（推奨）

SQSキューをポーリングして変換リクエストを処理:

```powershell
python src/docuworks_converter.py --mode service
```

### 単一ファイル変換

ローカルファイルを変換:

```powershell
python src/docuworks_converter.py --mode single -i input.xdw -o output.pdf
```

S3ファイルを変換:

```powershell
python src/docuworks_converter.py --mode single --s3-key "path/to/file.xdw"
```

## SQSメッセージ形式

変換リクエストのJSON形式:

```json
{
  "s3_key": "documents/sample.xdw",
  "request_id": "uuid-1234-5678",
  "callback_queue": "https://sqs.ap-northeast-1.amazonaws.com/123456789/callback-queue"
}
```

## アーキテクチャ

```
Linux EC2 (Main Worker)
    │
    │ DocuWorksファイル検出
    ↓
SQS (変換リクエストキュー)
    │
    │ メッセージ受信
    ↓
Windows EC2 (この変換サービス)
    │
    │ DocuWorks SDK でPDF変換
    ↓
S3 (converted-pdf/ プレフィックス)
    │
    │ 変換完了通知
    ↓
Linux EC2 (Main Worker)
    │
    │ preview_generator.py でプレビュー生成
    ↓
S3 (previews/ プレフィックス)
```

## Windows Serviceとして登録

NSSM (Non-Sucking Service Manager) を使用:

```powershell
# NSSMをダウンロード
# https://nssm.cc/download

# サービスとして登録
nssm install DocuWorksConverter "C:\path\to\python.exe" "C:\path\to\docuworks_converter.py --mode service"

# サービス開始
nssm start DocuWorksConverter
```

## トラブルシューティング

### DocuWorks COMエラー

```
Error: Failed to initialize DocuWorks
```

解決策:
1. DocuWorksがインストールされていることを確認
2. ライセンスがアクティブであることを確認
3. 管理者権限でPythonを実行

### S3アクセスエラー

```
Error: S3 download/upload failed
```

解決策:
1. AWS認証情報が正しいことを確認
2. IAMロール/ポリシーでS3アクセス権限を確認
3. VPCエンドポイントが設定されていることを確認（プライベートサブネットの場合）

## ログ

ログは以下に出力されます:
- コンソール（stdout）
- `docuworks_converter.log` ファイル

## ライセンス

DocuWorks SDKの使用にはFuji Xeroxの商用ライセンスが必要です。
