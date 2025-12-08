# DocuWorks Day 2 - クイックチェックリスト

**日付**: 2025-11-28
**作業時間**: 7-8時間
**完了期限**: 18:00

---

## ⏰ タイムブロック & チェックリスト

### Block 1: AWS EventBridge統合 (9:00-10:30) 90分

#### 準備 (5分)
- [ ] AWS CLIログイン確認: `aws sts get-caller-identity`
- [ ] S3バケット確認: `aws s3 ls s3://cis-filesearch-s3-landing`
- [ ] SQS Queue確認: `aws sqs list-queues`

#### S3 EventBridge有効化 (15分)
```bash
aws s3api put-bucket-notification-configuration \
  --bucket cis-filesearch-s3-landing \
  --notification-configuration '{"EventBridgeConfiguration":{}}'
```
- [ ] コマンド実行成功
- [ ] 設定確認: `aws s3api get-bucket-notification-configuration --bucket cis-filesearch-s3-landing`

#### EventBridgeルール作成 (30分)
```bash
aws events put-rule \
  --name cis-s3-to-sqs-file-upload \
  --event-pattern '{
    "source": ["aws.s3"],
    "detail-type": ["Object Created"],
    "detail": {
      "bucket": {
        "name": ["cis-filesearch-s3-landing"]
      }
    }
  }'
```
- [ ] ルール作成成功
- [ ] ターゲット追加 (SQS)
- [ ] Queue Policy更新

#### 動作確認テスト (15分)
```bash
echo "Test file" > test-$(date +%s).txt
aws s3 cp test-*.txt s3://cis-filesearch-s3-landing/test/
sleep 10
aws sqs receive-message --queue-url <QUEUE_URL>
```
- [ ] S3アップロード成功
- [ ] SQSメッセージ受信成功
- [ ] 遅延10秒以内

#### チェックポイント (10:30)
- ✅ EventBridge統合完了
- ✅ テスト成功

---

### Block 2: セキュリティ監査 (10:30-12:00) 90分

#### セキュリティスキャン実行 (20分)
```powershell
cd C:\CIS-FileSearch\DocuWorksService
.\scripts\security-scan.ps1
```
- [ ] スクリプト実行成功
- [ ] レポート生成

#### 認証情報チェック (20分)
- [ ] ハードコード認証情報: 0件
- [ ] .envファイル.gitignore登録済み
- [ ] AWS SDK デフォルト認証使用

#### 入力検証チェック (30分)
- [ ] ファイルパスにパストラバーサル対策
- [ ] S3キーに特殊文字検証
- [ ] SQSメッセージにJSON検証

#### AWS IAMポリシー確認 (20分)
- [ ] S3: GetObject, PutObject のみ
- [ ] SQS: ReceiveMessage, DeleteMessage のみ
- [ ] EC2: 必要最小限のタグベースポリシー

#### チェックポイント (12:00)
- ✅ セキュリティ重大問題: 0件
- ✅ IAMポリシー最小化完了

---

### Lunch Break (12:00-13:00)

---

### Block 3: 単体テスト作成 (13:00-15:00) 120分

#### テストプロジェクトセットアップ (30分)
```bash
cd C:\CIS-FileSearch\DocuWorksService
dotnet new xunit -n DocuWorksFileProcessor.Tests
cd DocuWorksFileProcessor.Tests
dotnet add package xUnit
dotnet add package Moq
dotnet add package FluentAssertions
dotnet add reference ..\DocuWorksFileProcessor\DocuWorksFileProcessor.csproj
```
- [ ] テストプロジェクト作成
- [ ] NuGetパッケージインストール完了

#### テストケース作成 (60分)
**優先順位順に実装**

1. **DocuWorksProcessorMock** (20分)
   - [ ] `ConvertToPdf_WithValidXdwFile_ShouldReturnPdfPath`
   - [ ] `ValidateFileAsync_WithXdwExtension_ShouldReturnTrue`
   - [ ] `GetMetadataAsync_ShouldReturnMetadata`

2. **S3UploadService** (20分)
   - [ ] `UploadFileAsync_WithValidFile_ShouldReturnS3Uri`
   - [ ] `DownloadFileAsync_WithValidKey_ShouldSaveToLocalPath`

3. **SQSPublishService** (20分)
   - [ ] `PublishFileProcessedEventAsync_ShouldReturnMessageId`

#### テスト実行 & カバレッジ (30分)
```bash
dotnet test --logger "console;verbosity=detailed"
dotnet test --collect:"XPlat Code Coverage"
reportgenerator -reports:**/coverage.cobertura.xml -targetdir:coverage-report -reporttypes:Html
start coverage-report\index.html
```
- [ ] 全テストパス: 100%
- [ ] カバレッジ: 70%以上
- [ ] レポート確認

#### チェックポイント (15:00)
- ✅ 単体テスト完了
- ✅ カバレッジ70%以上達成

---

### Block 4: End-to-End統合テスト (15:00-17:00) 120分

#### テスト環境準備 (30分)
```bash
# フォルダ確認
ls C:\CIS-FileSearch\watch\
ls C:\CIS-FileSearch\processed\
ls C:\CIS-FileSearch\error\

# テストファイル準備
cd C:\CIS-FileSearch\test-files
echo "XDWF" > test-docuworks.xdw
```
- [ ] フォルダ構造確認
- [ ] テストファイル準備完了

#### シナリオ1: 正常系フローテスト (40分)
```bash
# Windows Service起動 (別ターミナル)
cd C:\CIS-FileSearch\DocuWorksService\DocuWorksFileProcessor
dotnet run

# テストファイル配置
cp test-docuworks.xdw C:\CIS-FileSearch\watch\

# ログ監視
Get-Content -Path "logs\worker-*.log" -Tail 50 -Wait
```

**期待される動作確認**:
- [ ] ファイル検出
- [ ] メタデータ抽出
- [ ] モックPDF変換
- [ ] S3アップロード
- [ ] SQSメッセージ送信
- [ ] 処理済みフォルダへ移動

**AWS確認**:
```bash
aws s3 ls s3://cis-filesearch-s3-landing/files/
aws s3 ls s3://cis-filesearch-s3-landing/pdf/
aws sqs receive-message --queue-url <QUEUE_URL>
```
- [ ] S3にファイル存在確認
- [ ] SQSメッセージ確認

#### シナリオ2: エラーハンドリングテスト (20分)
```bash
echo "INVALID" > broken.xdw
cp broken.xdw C:\CIS-FileSearch\watch\
```
- [ ] エラーフォルダに移動確認
- [ ] エラーログ記録確認

#### シナリオ3: パフォーマンステスト (30分)
```powershell
# 10ファイル一括処理
for ($i=1; $i -le 10; $i++) {
    echo "XDWF TEST $i" > "test-$i.xdw"
    cp "test-$i.xdw" C:\CIS-FileSearch\watch\
}

# 処理時間計測
$startTime = Get-Date
# 全ファイル処理完了まで待機
$endTime = Get-Date
$duration = ($endTime - $startTime).TotalSeconds
```
- [ ] 平均処理時間: 30秒/ファイル以下
- [ ] 全ファイル正常処理

#### チェックポイント (17:00)
- ✅ 正常系テスト成功
- ✅ エラーハンドリング確認
- ✅ パフォーマンス基準クリア

---

### Block 5: 最終確認 & レポート (17:00-18:00) 60分

#### Python Worker最適化 (30分)
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# .env.template作成
cat > .env.template << EOF
AWS_REGION=ap-northeast-1
S3_BUCKET_LANDING=cis-filesearch-s3-landing
S3_BUCKET_THUMBNAIL=cis-filesearch-s3-thumbnail
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/YOUR-ACCOUNT-ID/cis-filesearch-index-queue
OPENSEARCH_ENDPOINT=https://YOUR-OPENSEARCH-ENDPOINT.ap-northeast-1.es.amazonaws.com
TESSDATA_PREFIX=/usr/local/share/tessdata
LOG_LEVEL=INFO
MAX_CONCURRENT_FILES=3
VISIBILITY_TIMEOUT=300
WAIT_TIME_SECONDS=20
OCR_LANGUAGE=jpn+eng
OCR_DPI=300
EOF

# worker.py構文チェック
python3.11 -m py_compile worker.py
```
- [ ] .env.template作成完了
- [ ] worker.py構文エラー0件

#### Day 2完了レポート作成 (30分)
**ファイル**: `docs/deployment/DOCUWORKS-DAY2-COMPLETION-REPORT.md`

```markdown
# Day 2完了レポート

## 完了タスク
- [x] AWS EventBridge統合
- [x] セキュリティ監査 (重大問題: 0件)
- [x] 単体テスト (カバレッジ: XX%)
- [x] End-to-End統合テスト

## テスト結果
| テスト種類 | 実施数 | 成功 | 失敗 | カバレッジ |
|-----------|-------|------|------|----------|
| 単体テスト | XX | XX | 0 | XX% |
| 統合テスト | 3 | 3 | 0 | N/A |
| セキュリティ | XX | XX | 0 | N/A |

## パフォーマンス
- 単一ファイル処理: XX秒
- 10ファイル処理: XX秒
- 平均: XX秒/ファイル

## Day 3準備
- [x] AWS統合100%動作
- [x] セキュリティ問題0件
- [x] テストカバレッジ70%以上
- [x] ドキュメント完備
```
- [ ] レポート作成完了
- [ ] 全チェックリスト確認

#### 最終チェックポイント (18:00)
- ✅ Day 2全タスク完了
- ✅ Day 3準備完了

---

## 📊 進捗トラッキング

### 時間配分実績

| 時間帯 | 計画 | 実績 | 差分 | 備考 |
|--------|------|------|------|------|
| 9:00-10:30 | EventBridge統合 | | | |
| 10:30-12:00 | セキュリティ監査 | | | |
| 13:00-15:00 | 単体テスト | | | |
| 15:00-17:00 | 統合テスト | | | |
| 17:00-18:00 | 最終確認 | | | |

### 完了率
- [ ] Block 1完了 (20%)
- [ ] Block 2完了 (40%)
- [ ] Block 3完了 (60%)
- [ ] Block 4完了 (80%)
- [ ] Block 5完了 (100%)

---

## 🚨 トラブルシューティング

### EventBridge設定失敗時
```bash
# ロールバック
aws events remove-targets --rule cis-s3-to-sqs-file-upload --ids 1
aws events delete-rule --name cis-s3-to-sqs-file-upload

# 再実行
# Block 1の手順を最初から実行
```

### テスト失敗時
```bash
# 詳細ログ確認
dotnet test --logger "console;verbosity=detailed"

# 単一テスト実行
dotnet test --filter "FullyQualifiedName=DocuWorksConverter.Tests.Services.MockDocuWorksProcessorTests.ConvertToPdf_WithValidXdwFile_ShouldReturnPdfPath"
```

### Windows Service起動失敗時
```powershell
# ログ確認
Get-Content -Path "logs\worker-*.log" -Tail 50

# 権限確認
icacls "C:\CIS-FileSearch"

# 再起動
dotnet run
```

---

## 成功基準最終確認

### Must Have (必須)
- [ ] AWS EventBridge → SQS統合成功
- [ ] セキュリティ重大問題0件
- [ ] テストカバレッジ70%以上
- [ ] End-to-Endテスト全シナリオパス
- [ ] Day 2完了レポート作成

### Should Have (推奨)
- [ ] パフォーマンステスト実施
- [ ] エラーハンドリング検証
- [ ] Python Worker最適化完了

### Nice to Have (オプション)
- [ ] テストカバレッジ85%以上
- [ ] 負荷テスト実施

---

## Day 3準備確認

- [ ] AWS統合フロー100%動作
- [ ] セキュリティ重大問題0件
- [ ] テストカバレッジ70%以上
- [ ] ドキュメント完備
- [ ] ライセンス統合手順準備完了

**Day 3作業内容 (30分)**:
1. DocuWorks 10インストール (15分)
2. 実装切り替え (10分)
3. 統合テスト (5分)

---

**作成日**: 2025-11-28
**完了期限**: 18:00
**担当者**: _______________
**承認者**: _______________
