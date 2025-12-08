# CIS File Search - セットアップ実行計画

**作成日**: 2025-12-01
**対象システム**: DataSync Agent + AWS Infrastructure Setup
**実行環境**: 自社オフィス → クライアント先

---

## 📋 概要

DataSync Agentは既にアクティベーション済み（Agent ID: agent-05e538aed6b309353）です。
このドキュメントでは、クライアント先訪問前に自社オフィスで完了できる作業と、
クライアント先でしか実施できない作業を明確に分離し、効率的なセットアップを実現します。

---

## 🎯 作業分類

```
┌─────────────────────────────────────────────────────────┐
│                   自社オフィス（今すぐ可能）              │
│  ✅ AWS設定（S3, EventBridge, SQS, CloudWatch）        │
│  ✅ スクリプト準備                                      │
│  ✅ 検証ツール実行                                      │
│  ⏱️  所要時間: 約15分                                   │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                クライアント先（NAS接続必須）              │
│  ⚠️  NAS接続設定                                        │
│  ⚠️  DataSync Location作成                             │
│  ⚠️  DataSync Task作成・実行                            │
│  ⏱️  所要時間: 約1時間 + 初回同期時間                    │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 ドキュメント構成

### クイックスタートガイド（推奨）

1. **OFFICE-SETUP-QUICKSTART.md** ⭐
   - 自社オフィスで今すぐ実行可能な手順
   - 一括実行スクリプト使用
   - 所要時間: 15分

2. **CLIENT-SITE-CHECKLIST.md** ⭐
   - クライアント先での作業チェックリスト
   - 印刷して持参推奨
   - 記入式フォーマット

### 詳細ガイド

3. **docs/deployment/PRE-CLIENT-SITE-PREPARATION.md**
   - 全体の詳細説明
   - トラブルシューティング
   - 個別スクリプト解説

---

## 🚀 今すぐ実行: 自社オフィスセットアップ

### 前提条件チェック

```bash
# AWS CLI認証確認
aws sts get-caller-identity

# jqインストール確認
which jq

# インストールされていない場合
brew install jq  # macOS
```

### 一括実行（推奨）

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app

# 一括セットアップ実行
bash scripts/office/00-run-all-office-setup.sh
```

**実行内容**:
1. ✅ 環境変数設定（AWS Account ID、S3、SQS、DataSync Agent ARN）
2. ✅ S3 EventBridge有効化（cis-filesearch-s3-landing）
3. ✅ EventBridge Rule作成（S3 → SQS）
4. ✅ SQS Message Retention延長（4日 → 7日）
5. ✅ CloudWatch Dashboard作成

### 検証実行

```bash
cd backend/ec2-worker
python3 verify_aws_config.py
```

**期待される結果**:
```
✅ S3 EventBridge: Enabled
✅ EventBridge Rule: ENABLED
✅ SQS Message Retention: 7 days
✅ All checks passed!
```

---

## 🏢 クライアント先での実行

### 準備物

- [ ] ノートPC（AWS CLI設定済み）
- [ ] 環境変数ファイル `/tmp/cis-aws-env.sh` のバックアップ
- [ ] CLIENT-SITE-CHECKLIST.md（印刷版）
- [ ] NAS接続情報（クライアント担当者から取得）

### 実行手順

#### 1. NAS接続テスト（PowerShell）

```powershell
cd C:\CIS-FileSearch\scripts\client-site

pwsh 01-test-nas-connection.ps1 `
  -NasServer "192.168.1.100" `
  -SharePath "shared-docs" `
  -Username "nas_user" `
  -Password (ConvertTo-SecureString "password" -AsPlainText -Force)
```

#### 2. DataSync Location作成

```bash
source /tmp/cis-aws-env.sh
bash scripts/client-site/02-create-datasync-nas-location.sh
```

#### 3. DataSync Task作成

```bash
bash scripts/client-site/03-create-datasync-task.sh
```

#### 4. 初回同期テスト

```bash
bash scripts/client-site/04-test-initial-sync.sh
```

---

## 📂 スクリプト一覧

### 自社オフィス用スクリプト

```
scripts/office/
├── 00-run-all-office-setup.sh       # 一括実行（推奨）
├── 01-setup-env.sh                  # 環境変数設定
├── 02-enable-s3-eventbridge.sh      # S3 EventBridge有効化
├── 03-create-eventbridge-rule.sh    # EventBridge Rule作成
├── 04-extend-sqs-retention.sh       # SQS Retention延長
└── 05-create-cloudwatch-dashboard.sh # CloudWatch Dashboard作成
```

### クライアント先用スクリプト

```
scripts/client-site/
├── 01-test-nas-connection.ps1       # NAS接続テスト（PowerShell）
├── 02-create-datasync-nas-location.sh # NAS Location作成
├── 03-create-datasync-task.sh       # DataSync Task作成
└── 04-test-initial-sync.sh          # 初回同期テスト
```

---

## ⏱️ タイムライン

### 自社オフィス（2025-12-01）

| 時間 | 作業 | 所要時間 |
|------|------|----------|
| 09:00 | 前提条件確認 | 5分 |
| 09:05 | 一括セットアップ実行 | 10分 |
| 09:15 | 検証スクリプト実行 | 5分 |
| 09:20 | エンドツーエンドテスト | 5分 |
| **09:25** | **自社作業完了** | **計25分** |

### クライアント先（訪問日: _______）

| 時間 | 作業 | 所要時間 |
|------|------|----------|
| 14:00 | NAS接続情報収集 | 15分 |
| 14:15 | ネットワーク疎通確認 | 10分 |
| 14:25 | NAS接続テスト | 10分 |
| 14:35 | DataSync Location作成 | 10分 |
| 14:45 | DataSync Task作成 | 10分 |
| 14:55 | 初回同期開始 | 5分 |
| 15:00 | **同期実行中** | **30分〜数時間** |
| XX:XX | エンドツーエンド検証 | 15分 |
| XX:XX | **クライアント先作業完了** | **計1時間 + 同期時間** |

---

## ✅ 完了基準

### 自社オフィス

- [ ] 環境変数設定完了（/tmp/cis-aws-env.sh）
- [ ] S3 EventBridge有効化
- [ ] EventBridge Rule作成（cis-s3-to-sqs-file-upload）
- [ ] SQS Message Retention 7日間
- [ ] CloudWatch Dashboard作成
- [ ] 検証スクリプト全チェックパス
- [ ] エンドツーエンドテスト成功

### クライアント先

- [ ] NAS接続情報取得
- [ ] NAS接続テスト成功
- [ ] DataSync NAS Location作成
- [ ] DataSync Task作成
- [ ] 初回同期実行・完了
- [ ] S3バケットファイル確認
- [ ] EventBridge → SQS連携確認

---

## 🔍 主要確認コマンド

### 環境変数確認

```bash
source /tmp/cis-aws-env.sh
echo "AWS Account: $AWS_ACCOUNT_ID"
echo "S3 Bucket: $S3_LANDING_BUCKET"
echo "SQS Queue: $SQS_QUEUE_NAME"
echo "DataSync Agent: $DATASYNC_AGENT_ARN"
```

### S3 EventBridge状態

```bash
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-s3-landing \
  --region ap-northeast-1
```

### EventBridge Rule状態

```bash
aws events describe-rule \
  --name cis-s3-to-sqs-file-upload \
  --region ap-northeast-1
```

### SQS Message Retention

```bash
aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names MessageRetentionPeriod \
  --region ap-northeast-1
```

### DataSync Agent状態

```bash
aws datasync describe-agent \
  --agent-arn $DATASYNC_AGENT_ARN \
  --region ap-northeast-1
```

**期待される状態**: `ONLINE`

---

## 🚨 トラブルシューティング

### 自社オフィス

| 問題 | 解決策 |
|------|--------|
| AWS CLI認証エラー | `aws sso login --profile default` |
| jqコマンドなし | `brew install jq` |
| EventBridge Rule作成失敗 | IAM権限確認（events:PutRule, events:PutTargets） |
| SQSメッセージ届かない | S3 EventBridge有効化、SQS Policy確認 |

### クライアント先

| 問題 | 解決策 |
|------|--------|
| NAS Ping失敗 | ネットワーク設定、ファイアウォール確認 |
| SMB接続失敗 | ユーザー名/パスワード、ドメイン名確認 |
| Location作成失敗 | DataSync Agent状態確認（ONLINE） |
| Task実行エラー | CloudWatch Logsで詳細確認 |

詳細は各ドキュメントのトラブルシューティングセクションを参照してください。

---

## 📊 成果物

セットアップ完了後、以下が利用可能になります：

### AWS Resources

| リソース | 名前/ID | 用途 |
|----------|---------|------|
| S3 Bucket | cis-filesearch-s3-landing | ファイル保存 |
| EventBridge Rule | cis-s3-to-sqs-file-upload | イベントルーティング |
| SQS Queue | cis-filesearch-index-queue | メッセージキュー |
| DataSync Agent | agent-05e538aed6b309353 | NAS接続 |
| DataSync Location (NAS) | （クライアント先で作成） | ソースロケーション |
| DataSync Location (S3) | （自動作成） | デスティネーション |
| DataSync Task | （クライアント先で作成） | 同期タスク |
| CloudWatch Dashboard | CIS-FileSearch-Monitoring | 監視ダッシュボード |

### CloudWatch Dashboard URL

```
https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#dashboards:name=CIS-FileSearch-Monitoring
```

### 定期同期スケジュール

- **頻度**: 毎月1日 02:00 AM（JST）
- **転送モード**: CHANGED（差分のみ）
- **帯域制限**: 100 Mbps
- **ログ**: CloudWatch Logs `/aws/datasync/cis-filesearch`

---

## 📞 サポート

### 質問・問題発生時

1. まず該当するドキュメントのトラブルシューティングを確認
2. エラーメッセージと実行コマンドをメモ
3. CloudWatch Logsで詳細確認
4. チームメンバーに連絡

### 緊急連絡先

- プロジェクトリーダー: _________________
- バックエンドエンジニア: _________________
- AWSアーキテクト: _________________

---

## 🔄 次のステップ

セットアップ完了後:

1. **月次同期の自動実行確認**
   - 翌月1日 02:00以降にCloudWatch Logsで確認

2. **EC2 File Processorの起動**
   - SQSメッセージを処理するEC2ワーカー起動

3. **OpenSearchインデックス作成**
   - 転送されたファイルのメタデータインデックス作成

4. **フロントエンド統合**
   - Next.jsアプリケーションから検索機能利用開始

---

## 📚 関連ドキュメント

| ドキュメント | 内容 | 対象 |
|-------------|------|------|
| OFFICE-SETUP-QUICKSTART.md | 自社オフィスクイックスタート | ⭐必読 |
| CLIENT-SITE-CHECKLIST.md | クライアント先チェックリスト | ⭐必読 |
| docs/deployment/PRE-CLIENT-SITE-PREPARATION.md | 詳細セットアップガイド | 参考 |
| docs/deployment/datasync/ | DataSync詳細ドキュメント | 参考 |
| docs/deployment/aws-eventbridge-s3-sqs-guide.md | EventBridge設定ガイド | 参考 |

---

**Document Version**: 1.0
**Last Updated**: 2025-12-01
**Author**: CIS Development Team

---

## 🎉 まとめ

このセットアップ計画により：

✅ **自社オフィスで15分で準備完了**
✅ **クライアント先で効率的に作業実行**
✅ **明確なチェックリストで作業漏れ防止**
✅ **トラブルシューティングガイドで迅速な問題解決**

今すぐ自社オフィスのセットアップを開始してください！

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app
bash scripts/office/00-run-all-office-setup.sh
```
