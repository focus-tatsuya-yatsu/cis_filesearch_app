# DocuWorks統合準備 - クイックスタートガイド

**最終更新**: 2025-11-28
**対象**: DocuWorksライセンス到着前の2日間

---

## 🎯 目的

DocuWorks 10ライセンス到着後、**30分以内**に本番稼働開始できる状態を構築

---

## 📋 Day 1: Windows Service開発 (8時間)

### Morning (3h): 開発環境 & プロジェクト作成

#### 1. Visual Studio 2022インストール (90分)
```powershell
# Chocolatey経由でインストール
choco install visualstudio2022community -y
choco install visualstudio2022-workload-manageddesktop -y
```

#### 2. プロジェクト作成 (60分)
```powershell
cd C:\CIS-FileSearch
mkdir DocuWorksService && cd DocuWorksService

# .NET 8.0 Worker Service
dotnet new worker -n DocuWorksFileProcessor
cd DocuWorksFileProcessor

# NuGetパッケージ
dotnet add package Microsoft.Extensions.Hosting.WindowsServices
dotnet add package AWSSDK.S3
dotnet add package AWSSDK.SQS
dotnet add package Serilog
dotnet add package Serilog.Sinks.File
```

**成果物**: コンパイル可能な.NETプロジェクト

---

### Afternoon (4h): コア実装

#### 3. インターフェース定義 (60分)
```csharp
// Services/IDocuWorksProcessor.cs
public interface IDocuWorksProcessor
{
    Task<string> ExtractTextAsync(string filePath);
    Task<bool> ConvertToPdfAsync(string inputPath, string outputPath);
    Task<bool> GenerateThumbnailAsync(string filePath, string outputPath, int width, int height);
    Task<Dictionary<string, object>> GetMetadataAsync(string filePath);
    Task<bool> ValidateFileAsync(string filePath);
}
```

#### 4. モック実装 (60分)
```csharp
// Services/DocuWorksProcessorMock.cs
public class DocuWorksProcessorMock : IDocuWorksProcessor
{
    // ライセンス不要のダミー実装
    // テキスト抽出、PDF変換、サムネイル生成をシミュレート
}
```

#### 5. AWS統合 (90分)
```csharp
// Services/S3UploadService.cs - S3アップロード
// Services/SQSPublishService.cs - SQSパブリッシュ
```

#### 6. メインWorker (30分)
```csharp
// Worker.cs
// フォルダ監視 → ファイル処理 → S3アップロード → SQS通知
```

**成果物**: ローカル実行可能なWindows Service

---

### Evening (1h): テスト & ドキュメント

#### 7. 単体テスト (60分)
```powershell
dotnet new xunit -n DocuWorksFileProcessor.Tests
dotnet test
```

**成果物**: テストカバレッジ > 70%

---

## 📋 Day 2: AWS統合 & 最適化 (8時間)

### Morning (3h): EventBridge設定

#### 8. S3 EventBridge有効化 (30分)
```bash
# AWS Console または CLI
aws s3api put-bucket-notification-configuration \
  --bucket cis-filesearch-s3-landing \
  --notification-configuration '{"EventBridgeConfiguration":{}}'
```

#### 9. EventBridgeルール作成 (60分)
```bash
# ルール作成
aws events put-rule --name cis-s3-to-sqs-file-upload \
  --event-pattern '{
    "source": ["aws.s3"],
    "detail-type": ["Object Created"],
    "detail": {"bucket": {"name": ["cis-filesearch-s3-landing"]}}
  }'

# SQSターゲット追加
aws events put-targets --rule cis-s3-to-sqs-file-upload \
  --targets '[{"Id":"1","Arn":"arn:aws:sqs:..."}]'
```

#### 10. End-to-Endテスト (60分)
```bash
# テストファイルアップロード
aws s3 cp test.txt s3://cis-filesearch-s3-landing/files/test/

# SQSメッセージ確認
aws sqs receive-message --queue-url $QUEUE_URL
```

**成果物**: S3 → EventBridge → SQS 全フロー動作確認

---

### Afternoon (4h): Python Worker & EC2準備

#### 11. Python Worker最終調整 (120分)
```bash
cd backend/python-worker

# 依存関係インストール
pip install -r requirements-ocr.txt

# 設定ファイル作成
cat > config.py << 'EOF'
class Config:
    AWS_REGION = 'ap-northeast-1'
    SQS_QUEUE_URL = os.getenv('SQS_QUEUE_URL')
    # ...
EOF

# Worker更新
python worker.py
```

#### 12. EC2 User Dataスクリプト (60分)
```bash
# backend/ec2-worker/user-data.sh
#!/bin/bash
dnf update -y
dnf install -y python3.11
# Tesseractインストール
# Python Worker起動
```

#### 13. ドキュメント作成 (60分)
- [ ] 準備完了レポート
- [ ] 統合テスト計画
- [ ] ライセンス到着後の手順書

**成果物**: EC2自動起動スクリプト & 完全ドキュメント

---

### Evening (1h): 統合テスト準備

#### 14. テストシナリオ作成 (60分)
```markdown
## Scenario 1: 基本処理フロー (15分)
1. テストファイル配置
2. 処理確認
3. AWS確認

## Scenario 2: エラーハンドリング (10分)
## Scenario 3: パフォーマンステスト (20分)
```

---

## 🚀 ライセンス到着後の作業 (30分)

### Step 1: インストール (15分)
```powershell
# DocuWorks 10実行ファイル実行
.\DocuWorks10_Setup.exe

# ライセンス認証
# アクティベーションコード入力
```

### Step 2: SDK統合 & 実装切り替え (10分)
```csharp
// 新規作成: Services/DocuWorksProcessorReal.cs
using DocuWorks; // DocuWorks 10 SDK

public class DocuWorksProcessorReal : IDocuWorksProcessor
{
    public async Task<string> ExtractTextAsync(string filePath)
    {
        // 実装: DocuWorks SDK使用
        var doc = DocuWorks.Document.Open(filePath);
        return doc.ExtractText();
    }
    // その他メソッド実装
}

// Program.cs 変更
- builder.Services.AddSingleton<IDocuWorksProcessor, DocuWorksProcessorMock>();
+ builder.Services.AddSingleton<IDocuWorksProcessor, DocuWorksProcessorReal>();
```

### Step 3: 統合テスト (5分)
```powershell
# Windows Service起動
sc.exe start "CISDocuWorksProcessor"

# テストファイル配置
cp test.xdw C:\CIS-FileSearch\watch\

# ログ確認
Get-Content logs\worker-*.log -Tail 50 -Wait
```

---

## ✅ 完了チェックリスト

### Day 1完了確認
- [ ] Visual Studio 2022インストール済み
- [ ] .NETプロジェクトコンパイル成功
- [ ] モック実装動作確認
- [ ] ローカル実行テスト成功
- [ ] 単体テストパス

### Day 2完了確認
- [ ] EventBridge設定完了
- [ ] S3 → SQS フロー動作確認
- [ ] Python Worker動作確認
- [ ] EC2 User Dataスクリプト作成
- [ ] ドキュメント完成

### ライセンス到着後
- [ ] DocuWorks 10インストール
- [ ] SDK統合完了
- [ ] 統合テスト成功
- [ ] 本番稼働開始

---

## 🔍 トラブルシューティング

### Visual Studio起動しない
```powershell
# 再インストール
choco uninstall visualstudio2022community -y
choco install visualstudio2022community -y
```

### .NETコンパイルエラー
```powershell
# SDK確認
dotnet --version  # 8.0.x以上

# クリーンビルド
dotnet clean
dotnet restore
dotnet build
```

### AWS接続エラー
```powershell
# 認証情報確認
aws sts get-caller-identity

# リージョン確認
echo $env:AWS_REGION
```

### EventBridgeメッセージ届かない
```bash
# S3設定確認
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-s3-landing

# EventBridgeルール確認
aws events list-rules --name-prefix cis-s3

# SQS Queue Policy確認
aws sqs get-queue-attributes --queue-url $QUEUE_URL \
  --attribute-names Policy
```

---

## 📊 進捗状況確認

### Day 1 End of Day
```powershell
# ビルド確認
cd C:\CIS-FileSearch\DocuWorksService\DocuWorksFileProcessor
dotnet build

# テスト実行
cd ..\DocuWorksFileProcessor.Tests
dotnet test

# 実行確認
cd ..\DocuWorksFileProcessor
dotnet run
```

**期待結果**: ビルド成功、テストパス、実行開始

### Day 2 End of Day
```bash
# AWS検証
python backend/ec2-worker/verify_aws_config.py

# Python Worker確認
cd backend/python-worker
python worker.py
```

**期待結果**: AWS検証全項目パス、Worker起動成功

---

## 📞 サポート情報

### ログ確認コマンド
```powershell
# Windows Service ログ
Get-Content C:\CIS-FileSearch\DocuWorksService\DocuWorksFileProcessor\logs\worker-*.log -Tail 100

# Python Worker ログ
tail -f backend/python-worker/logs/worker.log

# AWS CloudWatch Logs
aws logs tail /aws/ec2/file-processor --follow
```

### 緊急ロールバック
```csharp
// Program.cs を元に戻す
- builder.Services.AddSingleton<IDocuWorksProcessor, DocuWorksProcessorReal>();
+ builder.Services.AddSingleton<IDocuWorksProcessor, DocuWorksProcessorMock>();
```

### 参考ドキュメント
- **詳細計画**: `docs/deployment/DOCUWORKS-PRE-INSTALLATION-PLAN.md`
- **統合テスト**: `docs/deployment/DOCUWORKS-INTEGRATION-TEST-PLAN.md`
- **AWS設定**: `docs/deployment/AWS-COMPLETE-SETUP-GUIDE.md`

---

## 🎯 成功の定義

### Day 1成功
- モック実装でファイル処理フロー動作
- AWS S3/SQS連携テスト成功
- 単体テスト70%以上カバレッジ

### Day 2成功
- EventBridge全フロー動作
- Python Worker自動起動確認
- End-to-Endテスト成功

### ライセンス到着後
- 30分以内に実装切り替え完了
- 実ファイルで統合テスト成功
- 本番稼働開始

---

**作成者**: CIS Development Team
**作成日**: 2025-11-28
**想定読者**: 開発者・DevOpsエンジニア
**所要時間**: Day 1 (8h) + Day 2 (8h) + ライセンス到着後 (30min)
