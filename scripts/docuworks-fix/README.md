# DocuWorks Upload Fix - ts-server7

## 問題の概要

ts-server7のDocuWorksファイル（.xdw）がDocuWorksフィルタで検索できない問題がありました。

### 原因

旧スクリプト（v3以前）は以下の動作をしていました：
1. `.xdw`ファイルをPDFに変換
2. PDFのみを`docuworks-converted/`にアップロード
3. **元の`.xdw`ファイルを削除**（問題！）

これにより：
- ファイルはPDFとしてインデックスされる
- DocuWorksフィルタ（`.xdw`）で検索できない
- クライアント要件と異なる動作

### 修正後の動作

新スクリプト（v4）は以下の動作をします：
1. **元の`.xdw`ファイルを`documents/structure/ts-server7/...`にアップロード**
2. PDFに変換し`docuworks-converted/structure/ts-server7/...`にアップロード（プレビュー用）
3. SQS通知は**元の`.xdw`ファイル**に対して送信（正しいインデックス登録のため）

## S3構造

### 正しい構造（修正後）

```
cis-filesearch-s3-landing/
├── documents/                      # インデックス用（元ファイル）
│   └── structure/
│       └── ts-server7/
│           └── R05_JOB/
│               └── project/
│                   └── file.xdw   # DocuWorksフィルタで検索可能
│
└── docuworks-converted/            # プレビュー用（変換済みPDF）
    └── structure/
        └── ts-server7/
            └── R05_JOB/
                └── project/
                    └── file.pdf   # プレビュー表示用
```

### 問題のあった構造（修正前）

```
cis-filesearch-s3-landing/
├── documents/
│   └── structure/
│       └── ts-server7/            # 空！（問題）
│
└── docuworks-converted/
    └── structure/
        └── ts-server7/
            └── R05_JOB/
                └── project/
                    └── file.pdf   # PDFのみ（元のxdwがない）
```

## ファイル一覧

| ファイル | 説明 |
|---------|------|
| `datasync-monitor-sdk-pdf-v4.ps1` | 修正版アップロードスクリプト |
| `reupload-existing-xdw.ps1` | 既存ファイル再アップロードスクリプト |
| `README.md` | このファイル |

## 使用方法

### 1. 新スクリプトのデプロイ

既存の`datasync-monitor-sdk-pdf-v3.ps1`を停止し、v4に置き換えます：

```powershell
# 既存スクリプトを停止
Stop-Process -Name powershell -Force  # 適切なプロセスを停止

# 新スクリプトをコピー
Copy-Item datasync-monitor-sdk-pdf-v4.ps1 C:\CIS-FileSearch\scripts\

# 新スクリプトを開始
powershell -ExecutionPolicy Bypass -File C:\CIS-FileSearch\scripts\datasync-monitor-sdk-pdf-v4.ps1
```

### 2. 既存ファイルの再アップロード

ts-server7の既存DocuWorksファイルを再アップロードする必要があります：

```powershell
# 既存ファイル再アップロードスクリプトを実行
powershell -ExecutionPolicy Bypass -File reupload-existing-xdw.ps1
```

## 確認方法

修正後、以下を確認してください：

### OpenSearchでの確認

```bash
# DocuWorksファイルがインデックスされているか確認
curl -X GET "https://your-opensearch-endpoint/cis-files-v2/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "bool": {
        "filter": [
          {"term": {"nas_server": "ts-server7"}},
          {"term": {"file_extension": ".xdw"}}
        ]
      }
    },
    "size": 5
  }'
```

### S3での確認

```bash
# documents/にxdwファイルがあるか確認
aws s3 ls s3://cis-filesearch-s3-landing/documents/structure/ts-server7/ --recursive | head -20
```

### アプリでの確認

1. 検索画面でカテゴリ「構造」を選択
2. ファイルタイプ「DocuWorks」を選択
3. 任意のキーワードで検索
4. ts-server7のDocuWorksファイルが表示されることを確認

## 注意事項

- 既存のPDFファイル（`docuworks-converted/`）はそのまま残ります（プレビュー用）
- 元ファイルの再アップロードには時間がかかる場合があります
- インデックス再作成が必要な場合は、Python Workerが自動的に処理します
