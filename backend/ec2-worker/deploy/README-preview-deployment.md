# Office/DocuWorks Preview Deployment Guide

## 概要

Office系ファイル（Word, Excel, PowerPoint）とDocuWorksファイルの全ページプレビュー機能をEC2ワーカーにデプロイする手順です。

## 前提条件

- EC2インスタンス（Amazon Linux 2/2023、Ubuntu、またはCentOS）
- 既存のcis-file-processorがインストール済み
- sudo権限

## デプロイ手順

### Step 1: ソースファイルをEC2へ転送

```bash
# ローカルから転送
scp -r backend/ec2-worker/src/*.py ec2-user@<EC2_IP>:/opt/cis-file-processor/src/
scp backend/ec2-worker/deploy/*.sh ec2-user@<EC2_IP>:/tmp/
```

### Step 2: LibreOfficeインストール

```bash
# EC2にSSH接続
ssh ec2-user@<EC2_IP>

# スクリプト実行
cd /tmp
sudo bash update-preview-support.sh
```

### Step 3: テスト実行

```bash
# テストスクリプト実行
bash test-office-preview.sh
```

### Step 4: ワーカー再起動

```bash
sudo systemctl restart cis-worker.service
```

### Step 5: 動作確認

1. S3 landingバケットにOfficeファイルをアップロード
2. ワーカーログを確認:
   ```bash
   journalctl -u cis-worker -f
   ```
3. S3 thumbnailバケットの`previews/`フォルダを確認

## トラブルシューティング

### LibreOfficeが見つからない

```bash
# パスを確認
which soffice
ls -la /usr/bin/soffice* /usr/lib/libreoffice* 2>/dev/null
```

### 日本語フォントが文字化け

```bash
# フォントインストール
sudo dnf install -y google-noto-sans-cjk-jp-fonts ipa-gothic-fonts

# フォントキャッシュ更新
fc-cache -fv
```

### PDF変換がタイムアウト

```bash
# タイムアウト値を調整（office_converter.py）
# timeout パラメータを 120 → 180 に変更
```

## 新規追加ファイル

| ファイル | 説明 |
|---------|------|
| `office_converter.py` | LibreOfficeでOffice→PDF変換 |
| `docuworks_request.py` | DocuWorks変換リクエスト送信 |

## 更新ファイル

| ファイル | 変更内容 |
|---------|---------|
| `preview_generator.py` | `_generate_from_office()`, `_generate_from_docuworks()` 追加 |
| `main.py` | プレビュー生成時にS3クライアント渡し |

## 対応ファイル形式

### Office系（LibreOffice変換）
- Word: `.doc`, `.docx`
- Excel: `.xls`, `.xlsx`
- PowerPoint: `.ppt`, `.pptx`
- OpenDocument: `.odt`, `.ods`, `.odp`

### DocuWorks（Windows EC2連携）
- DocuWorks文書: `.xdw`
- DocuWorksバインダー: `.xbd`

## プレビュー仕様

| 項目 | 値 |
|------|-----|
| 解像度 | 150 DPI |
| 最大サイズ | 1240x1754px (A4相当) |
| フォーマット | JPEG |
| 品質 | 85% |
| 最大ページ数 | 50ページ |
