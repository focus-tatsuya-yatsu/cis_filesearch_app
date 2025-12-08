# DocuWorks Converter - Day 2実行計画

**作成日**: 2025-11-28
**対象期間**: Day 2 (7-8時間作業可能)
**目的**: AWS統合、セキュリティ強化、テスト実施による本番準備完了

---

## エグゼクティブサマリー

### 現状
- **Day 1**: モック実装完了 (Windows Service基本動作確認済み)
- **専門家レビュー完了**: AWS統合、セキュリティ、テスト戦略の3分野
- **Day 3**: 実DocuWorksライセンス到着予定

### Day 2の目標
AWS統合完了とセキュリティ強化により、ライセンス到着後30分で本番稼働可能な状態を構築

### 成功基準
- AWS S3 + SQS統合テスト成功
- セキュリティ監査で重大問題0件
- テストカバレッジ70%以上
- 全統合フローの動作確認完了

---

## Day 2タスク優先順位マトリクス

| 優先度 | タスク | 所要時間 | 依存関係 | リスク |
|--------|--------|---------|---------|--------|
| **P0** | AWS EventBridge統合 | 90min | なし | 🔴 High |
| **P0** | End-to-End統合テスト | 120min | EventBridge完了 | 🔴 High |
| **P1** | セキュリティ監査実施 | 90min | なし | 🟡 Medium |
| **P1** | 単体テスト作成 | 120min | なし | 🟡 Medium |
| **P2** | Python Worker最適化 | 60min | なし | 🟢 Low |
| **P2** | ドキュメント作成 | 60min | テスト完了 | 🟢 Low |

**合計**: 8時間 (480分)

---

## タイムライン (7-8時間計画)

### Morning Session (9:00-12:00) - 3時間

#### Block 1: AWS EventBridge統合 (9:00-10:30) - 90分
**優先度**: 🔴 P0 Critical
**担当**: DevOps + Backend

##### 実施内容
1. **S3 EventBridge有効化** (15分)
2. **EventBridgeルール作成** (30分)
3. **SQS Queue Policy更新** (30分)
4. **動作確認テスト** (15分)

##### 成功基準
- [ ] S3バケット `cis-filesearch-s3-landing` でEventBridge有効
- [ ] EventBridgeルール `cis-s3-to-sqs-file-upload` 作成完了
- [ ] テストファイルアップロード → SQSメッセージ受信成功
- [ ] 遅延10秒以内

##### コマンド
```bash
# S3 EventBridge有効化
aws s3api put-bucket-notification-configuration \
  --bucket cis-filesearch-s3-landing \
  --notification-configuration '{"EventBridgeConfiguration":{}}'

# EventBridgeルール作成
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

# SQSターゲット追加
aws events put-targets \
  --rule cis-s3-to-sqs-file-upload \
  --targets '[{
    "Id": "1",
    "Arn": "arn:aws:sqs:ap-northeast-1:YOUR-ACCOUNT-ID:cis-filesearch-index-queue"
  }]'

# テスト
echo "Test file" > test-$(date +%s).txt
aws s3 cp test-*.txt s3://cis-filesearch-s3-landing/test/
sleep 10
aws sqs receive-message --queue-url <QUEUE_URL>
```

##### リスク & 対策
- **リスク**: Queue Policy設定ミス
- **対策**: ドキュメント通りのARN確認、テスト実施

---

#### Block 2: セキュリティ監査 (10:30-12:00) - 90分
**優先度**: 🟡 P1 High
**担当**: Security + Backend

##### 実施内容
1. **ハードコード認証情報チェック** (20分)
2. **入力検証テスト** (30分)
3. **AWS IAMポリシー最小化** (20分)
4. **脆弱性スキャン実行** (20分)

##### 成功基準
- [ ] ハードコード認証情報: 0件
- [ ] パストラバーサル攻撃対策: 実装済み
- [ ] IAMポリシー: 最小権限設定
- [ ] 重大脆弱性: 0件

##### スクリプト実行
```powershell
# セキュリティスキャン実行 (Windows)
cd C:\CIS-FileSearch\DocuWorksService
.\scripts\security-scan.ps1

# 期待される出力:
# ✓ No hardcoded credentials detected
# ✓ No obviously unsafe file operations
# ✓ AWS identity verified
# ✓ Security report generated
```

##### チェック項目
```markdown
### 認証情報管理
- [ ] AWS認証情報は環境変数またはAWS SDKデフォルト認証を使用
- [ ] appsettings.jsonに平文パスワードなし
- [ ] .envファイルが.gitignoreに登録済み

### 入力検証
- [ ] ファイルパスにパストラバーサル対策実装
- [ ] S3キーに特殊文字検証実装
- [ ] SQSメッセージにJSON検証実装

### AWS権限
- [ ] S3: GetObject, PutObject のみ許可
- [ ] SQS: ReceiveMessage, DeleteMessage のみ許可
- [ ] EC2: 必要最小限のタグベースポリシー
```

---

### Lunch Break (12:00-13:00) - 1時間

---

### Afternoon Session (13:00-17:00) - 4時間

#### Block 3: 単体テスト作成 (13:00-15:00) - 120分
**優先度**: 🟡 P1 High
**担当**: Backend + QA

##### 実施内容
1. **モックプロセッサーテスト** (30分)
2. **S3サービステスト** (30分)
3. **SQSサービステスト** (30分)
4. **カバレッジ計測** (30分)

##### 成功基準
- [ ] テストカバレッジ: 70%以上
- [ ] 全テストパス: 100%
- [ ] 重要モジュール: 85%以上

##### テストプロジェクト作成
```bash
cd C:\CIS-FileSearch\DocuWorksService
dotnet new xunit -n DocuWorksFileProcessor.Tests
cd DocuWorksFileProcessor.Tests

# NuGetパッケージ追加
dotnet add package xUnit
dotnet add package Moq
dotnet add package FluentAssertions
dotnet add package Microsoft.Extensions.Logging.Abstractions

# プロジェクト参照
dotnet add reference ..\DocuWorksFileProcessor\DocuWorksFileProcessor.csproj
```

##### テスト実行
```bash
# テスト実行
dotnet test --logger "console;verbosity=detailed"

# カバレッジ計測
dotnet test --collect:"XPlat Code Coverage"

# カバレッジレポート生成
dotnet tool install -g dotnet-reportgenerator-globaltool
reportgenerator -reports:**/coverage.cobertura.xml -targetdir:coverage-report -reporttypes:Html

# レポート確認
start coverage-report\index.html
```

##### 必須テストケース
1. **DocuWorksProcessorMock**
   - `ConvertToPdf_WithValidXdwFile_ShouldReturnPdfPath`
   - `ValidateFileAsync_WithXdwExtension_ShouldReturnTrue`
   - `GetMetadataAsync_ShouldReturnMetadata`

2. **S3UploadService**
   - `UploadFileAsync_WithValidFile_ShouldReturnS3Uri`
   - `DownloadFileAsync_WithValidKey_ShouldSaveToLocalPath`

3. **SQSPublishService**
   - `PublishFileProcessedEventAsync_ShouldReturnMessageId`

---

#### Block 4: End-to-End統合テスト (15:00-17:00) - 120分
**優先度**: 🔴 P0 Critical
**担当**: Backend + DevOps + QA

##### 実施内容
1. **テスト環境準備** (30分)
2. **フル統合フローテスト** (60分)
3. **エラーシナリオテスト** (30分)

##### 成功基準
- [ ] S3 → EventBridge → SQS → Worker → S3 全フロー成功
- [ ] 処理時間: 1ファイルあたり30秒以内
- [ ] エラーハンドリング: DLQへの移動確認
- [ ] ログ出力: 全ステップで正常ログ確認

##### テストシナリオ

**シナリオ1: 正常系フローテスト**
```bash
# 1. テストファイル準備
cd C:\CIS-FileSearch\test-files
echo "XDWF" > test-docuworks.xdw

# 2. Watchフォルダに配置
cp test-docuworks.xdw C:\CIS-FileSearch\watch\

# 3. Windows Service起動 (別ターミナル)
cd C:\CIS-FileSearch\DocuWorksService\DocuWorksFileProcessor
dotnet run

# 4. ログ監視
Get-Content -Path "logs\worker-*.log" -Tail 50 -Wait

# 5. 期待される動作
# - ファイル検出
# - メタデータ抽出
# - モックPDF変換
# - S3アップロード
# - SQSメッセージ送信
# - 処理済みフォルダへ移動

# 6. 確認
aws s3 ls s3://cis-filesearch-s3-landing/files/
aws s3 ls s3://cis-filesearch-s3-landing/pdf/
aws sqs receive-message --queue-url <QUEUE_URL>
```

**シナリオ2: エラーハンドリングテスト**
```bash
# 破損ファイルテスト
echo "INVALID" > broken.xdw
cp broken.xdw C:\CIS-FileSearch\watch\

# エラーフォルダ確認
ls C:\CIS-FileSearch\error\
cat C:\CIS-FileSearch\error\broken.xdw.error.txt
```

**シナリオ3: パフォーマンステスト**
```bash
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

Write-Host "処理時間: $duration 秒 (平均 $($duration/10) 秒/ファイル)"
```

---

### Evening Session (17:00-18:00) - 1時間

#### Block 5: Python Worker最適化 + ドキュメント作成 (17:00-18:00) - 60分
**優先度**: 🟢 P2 Medium
**担当**: Backend + DevOps

##### 実施内容
1. **Python Worker設定最適化** (30分)
2. **Day 2完了レポート作成** (30分)

##### Python Worker最適化
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# config.py確認
cat config.py

# 環境変数テンプレート作成
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

# worker.py更新確認
python3.11 -m py_compile worker.py
```

##### Day 2完了レポート作成
```markdown
# DocuWorks Converter - Day 2完了レポート

**日付**: 2025-11-28
**作業時間**: 8時間

## 完了タスク

### P0 (Critical)
- [x] AWS EventBridge統合完了
- [x] End-to-End統合テスト成功

### P1 (High)
- [x] セキュリティ監査実施 (重大問題: 0件)
- [x] 単体テスト作成 (カバレッジ: XX%)

### P2 (Medium)
- [x] Python Worker最適化完了
- [x] ドキュメント作成完了

## テスト結果

| テスト種類 | 実施数 | 成功 | 失敗 | カバレッジ |
|-----------|-------|------|------|----------|
| 単体テスト | XX | XX | 0 | XX% |
| 統合テスト | XX | XX | 0 | N/A |
| セキュリティ | XX | XX | 0 | N/A |

## パフォーマンス指標

- 単一ファイル処理時間: XX秒
- 10ファイル処理時間: XX秒
- 平均処理時間: XX秒/ファイル
- メモリ使用量: XX MB

## Day 3準備完了確認

- [ ] AWS統合フロー100%動作
- [ ] セキュリティ重大問題0件
- [ ] テストカバレッジ70%以上
- [ ] ドキュメント完備
- [ ] ライセンス統合手順準備完了

## 次のアクション

1. DocuWorksライセンス到着待ち
2. 実装切り替え準備 (30分で完了予定)
3. 本番稼働開始

**作成者**: [担当者名]
**承認**: [承認者名]
```

---

## リスク管理 & 対策

### リスク1: AWS EventBridge設定失敗
**影響度**: 🔴 Critical
**発生確率**: 🟡 Medium

**対策**:
- ドキュメント通りの手順厳守
- AWS Console + CLIの両方で確認
- テストファイルで即座に動作確認

**ロールバック**:
```bash
# EventBridgeルール削除
aws events remove-targets --rule cis-s3-to-sqs-file-upload --ids 1
aws events delete-rule --name cis-s3-to-sqs-file-upload
```

---

### リスク2: テストカバレッジ不足
**影響度**: 🟡 High
**発生確率**: 🟡 Medium

**対策**:
- 重要モジュールを優先的にテスト
- カバレッジレポートで未テスト箇所を特定
- 時間不足の場合はP2タスクを削減

**最小要件**:
- モックプロセッサー: 100%
- S3/SQSサービス: 70%以上
- 全体: 70%以上

---

### リスク3: セキュリティ脆弱性発見
**影響度**: 🔴 Critical
**発生確率**: 🟢 Low

**対策**:
- security-scan.ps1の実行
- 専門家レビューの指摘事項を全て対応
- 重大問題発見時は即座にエスカレーション

**エスカレーション基準**:
- ハードコード認証情報: 即座修正
- パストラバーサル脆弱性: 即座修正
- IAM過剰権限: Day 2中に修正

---

## チェックポイント

### Morning Session終了時 (12:00)
- [ ] EventBridge統合完了
- [ ] セキュリティスキャン完了

### Afternoon Session中間 (15:00)
- [ ] 単体テスト70%以上
- [ ] カバレッジレポート確認

### Day 2完了時 (18:00)
- [ ] End-to-Endテスト成功
- [ ] Day 2完了レポート作成
- [ ] 全P0/P1タスク完了

---

## Day 3への準備

### ライセンス到着後の30分作業
1. **DocuWorks 10インストール** (15分)
2. **実装切り替え** (10分)
   - `DocuWorksProcessorReal.cs` 作成
   - `Program.cs` のDI設定変更
3. **統合テスト** (5分)

### 準備完了確認
```bash
# Windows Service動作確認
sc.exe query CISDocuWorksProcessor

# AWS統合確認
python3 verify_aws_config.py

# ログ確認
Get-EventLog -LogName Application -Source "CISDocuWorksProcessor" -Newest 10
```

---

## 成功基準サマリー

### Must Have (必須)
- ✅ AWS EventBridge → SQS統合成功
- ✅ End-to-End統合テスト全シナリオパス
- ✅ セキュリティ重大問題0件
- ✅ テストカバレッジ70%以上

### Should Have (推奨)
- ✅ パフォーマンステスト実施
- ✅ エラーハンドリング検証
- ✅ ドキュメント完備

### Nice to Have (オプション)
- ✅ テストカバレッジ85%以上
- ✅ Python Worker自動デプロイスクリプト
- ✅ 負荷テスト実施

---

## 連絡先 & エスカレーション

### 通常サポート
- **Backend担当**: [連絡先]
- **DevOps担当**: [連絡先]
- **QA担当**: [連絡先]

### 緊急時
- **プロジェクトマネージャー**: [連絡先]
- **セキュリティ担当**: [連絡先]

---

**作成者**: Product Manager (Claude Code)
**作成日**: 2025-11-28
**承認**: [承認者名]
**バージョン**: 1.0
