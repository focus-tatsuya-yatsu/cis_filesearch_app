# AWS DataSync セットアップガイド - 完全版

**プロジェクト**: CIS File Search Application
**作成日**: 2025-01-17
**対象者**: DevOpsエンジニア、システム管理者
**難易度**: 中級〜上級

---

## 📚 ドキュメント構成

このディレクトリには、オンプレミスNASからAWS S3へのファイル同期を実現するAWS DataSyncの完全なセットアップガイドが含まれています。

```
datasync/
├── README.md (このファイル)
├── 🆕 HYPER-V-DATASYNC-SETUP.md ⭐ Hyper-V完全セットアップガイド
├── 🆕 HYPER-V-QUICK-REFERENCE.md ⭐ Hyper-Vクイックリファレンス
├── 🆕 HYPER-V-VS-VMWARE-COMPARISON.md ⭐ Hyper-V vs VMware比較分析
├── scripts/
│   ├── 0-Complete-Setup.ps1 ⭐ 完全自動化セットアップ
│   ├── 1-Download-DataSync-Agent.ps1
│   ├── 2-Create-DataSync-VM.ps1
│   ├── 3-Start-And-Monitor.ps1
│   └── 4-Health-Check.ps1
├── PROJECT-MANAGEMENT-QUICK-START.md
├── datasync-project-management-plan.md
├── 00-datasync-overview-architecture.md
├── 01-iam-roles-setup-guide.md
├── 02-s3-bucket-setup-guide.md
├── 03-cloudwatch-logs-setup-guide.md
├── 04-datasync-agent-installation-guide.md
├── 05-datasync-location-task-configuration-guide.md
├── 06-datasync-monitoring-optimization-guide.md
├── datasync-performance-optimization-guide.md
├── nas-information-request-template.md
└── week1-completion-checklist.md
```

---

## 🆕 NEW: Hyper-V Deployment Guide (2025-12-01)

### Windows 11 Pro (64GB RAM) でHyper-Vを使用する場合

**既にHyper-Vが構成されている場合は、VMware Playerの代わりにHyper-Vを使用することを強く推奨します。**

#### クイックスタート (30分で完了)

```powershell
# PowerShellを管理者として実行
cd C:\path\to\scripts
.\0-Complete-Setup.ps1
```

このスクリプトで以下が自動実行されます:
- DataSync Agent VHDX のダウンロード
- 最適化されたVM作成 (16GB RAM, 4 CPU)
- VMの起動と接続確認
- ヘルスチェック実行
- アクティベーション手順の表示

#### なぜHyper-V?

| 項目 | Hyper-V | VMware Player |
|------|---------|---------------|
| **セットアップ時間** | 0分 (既インストール) | 15-30分 |
| **パフォーマンス** | 5-10%優位 | ベースライン |
| **24/7運用** | ✅ 本番環境グレード | ⚠️ デスクトップ用 |
| **メモリ効率** | ✅ 動的メモリ (8-32GB) | ❌ 固定割当 |
| **転送時間 (8TB)** | 10-11日 | 11-12日 |
| **コスト** | $0 (含まれる) | $0-199 |

**詳細**: [HYPER-V-VS-VMWARE-COMPARISON.md](./HYPER-V-VS-VMWARE-COMPARISON.md)

#### ドキュメント

1. **[HYPER-V-DATASYNC-SETUP.md](./HYPER-V-DATASYNC-SETUP.md)** - 完全セットアップガイド (フェーズ1-7)
2. **[HYPER-V-QUICK-REFERENCE.md](./HYPER-V-QUICK-REFERENCE.md)** - コマンドリファレンス & トラブルシューティング
3. **[HYPER-V-VS-VMWARE-COMPARISON.md](./HYPER-V-VS-VMWARE-COMPARISON.md)** - 詳細な比較分析 (93% vs 58%)

#### パフォーマンス見込み (100Mbps帯域、8TB転送)

```
スループット: 8-10 MB/s
日次転送量: 700-850 GB/日
8TB転送時間: 10-12日
CPU使用率: 20-40% (通常時)
メモリ使用: 12-16GB (通常時)
```

---

## 🎯 プロジェクト概要

### ビジネス要件

- **課題**: オンプレミスNASに10TB・約500万ファイルが保存されており、全社員が効率的に検索できるシステムが必要
- **解決策**: AWSでファイル検索インデックスを構築し、月1回の自動同期でNASとS3を同期
- **目標**: 検索レスポンスタイム10秒以内、同時接続50ユーザー以上

### システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ オンプレミス環境                                               │
│                                                               │
│  ┌──────────┐         ┌───────────────────────────┐        │
│  │   NAS    │◄────────┤  DataSync Agent (VM)      │        │
│  │  10TB    │ SMB/NFS │  - VMware/Hyper-V/KVM     │        │
│  │ 500万件   │         │  - vCPU: 8, Memory: 32GB  │        │
│  └──────────┘         └───────────────────────────┘        │
│                                    │                         │
│                                    │ HTTPS (Port 443)       │
└────────────────────────────────────┼─────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│ AWS Cloud (ap-northeast-1)                                   │
│                                                               │
│  DataSync Service → S3 Landing Bucket                        │
│       ↓                                                       │
│  EventBridge → SQS → EC2 Spot Instances (Python Workers)    │
│       ↓                                                       │
│  RDS PostgreSQL / OpenSearch (検索インデックス)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 📖 ガイド一覧

### 🆕 プロジェクト管理ガイド（2025-01-17追加）

#### PROJECT-MANAGEMENT-QUICK-START.md

**ファイル**: [PROJECT-MANAGEMENT-QUICK-START.md](./PROJECT-MANAGEMENT-QUICK-START.md)

**対象者**: プロジェクトマネージャー、チームリード、ステークホルダー
**所要時間**: 5分（クイックスタート）

**内容**:
- プロジェクト管理計画の概要（エグゼクティブサマリー）
- 4フェーズロードマップ（8週間）
- Top 5 リスクと軽減策
- セクション別クイックリファレンス
- 週次アクションチェックリスト

**いつ読むべきか**:
- プロジェクト開始前（Day 1前）
- 完全版の管理計画を読む前のオリエンテーション
- ステークホルダーへの説明資料として

---

#### datasync-project-management-plan.md

**ファイル**: [datasync-project-management-plan.md](./datasync-project-management-plan.md)

**対象者**: プロジェクトマネージャー、チームリード、全チームメンバー
**所要時間**: 完全版68ページ（セクション別に読む）

**内容**:
1. **実装ロードマップ** - 4フェーズ、18マイルストーン、詳細スケジュール
2. **WBS（作業分解構造）** - 全タスクの階層構造
3. **リスク管理マトリックス** - 10リスク、軽減策、対応計画
4. **ステークホルダーコミュニケーション計画** - テンプレート、スケジュール、エスカレーション
5. **リソース配分** - チーム構成、予算、工数計画
6. **依存関係・ブロッカー追跡** - クリティカルパス、依存関係マトリックス
7. **成功基準とKPI** - 6つの必須基準、運用KPI、学習KPI
8. **変更管理プロセス** - 変更リクエストフォーム、承認プロセス
9. **ドキュメント要件** - 37の成果物、標準テンプレート
10. **実装後レビューチェックリスト** - 技術検証、運用準備、コスト検証

**いつ使うべきか**:
- プロジェクト全体を通して参照
- 毎週のステータスレポート作成時
- リスク評価・ブロッカー管理時
- ステークホルダーコミュニケーション時
- プロジェクト終了時の振り返り

---

### 00. 概要とアーキテクチャ

**ファイル**: [00-datasync-overview-architecture.md](./00-datasync-overview-architecture.md)

**内容**:
- DataSyncとは何か
- CISプロジェクトにおける役割
- システム全体像
- データフロー
- 導入メリット
- コスト概算

**対象者**: 全員（最初に必読）
**所要時間**: 30分

---

### 01. IAMロール作成

**ファイル**: [01-iam-roles-setup-guide.md](./01-iam-roles-setup-guide.md)

**内容**:
- DataSync Task Execution Role作成
- Lambda S3 Event Handler Role作成
- 必要な権限ポリシー設定
- Trust Relationship設定

**対象者**: DevOpsエンジニア
**所要時間**: 30分
**前提条件**: AWS AdministratorAccess権限

**主要ロール**:
```
CIS-DataSync-Task-Execution-Role:
  - S3バケットへのアクセス権限
  - CloudWatch Logsへの書き込み権限

CIS-Lambda-S3EventHandler-Role:
  - S3からのファイル読み取り権限
  - SQSへのメッセージ送信権限
```

---

### 02. S3バケット作成

**ファイル**: [02-s3-bucket-setup-guide.md](./02-s3-bucket-setup-guide.md)

**内容**:
- Landing Bucket作成（cis-filesearch-landing）
- バージョニング設定
- 暗号化設定（SSE-S3）
- バケットポリシー設定
- Intelligent-Tiering設定
- ライフサイクルポリシー設定

**対象者**: DevOpsエンジニア
**所要時間**: 20分
**前提条件**: IAMロール作成完了

**バケット設定**:
```
名前: cis-filesearch-landing
リージョン: ap-northeast-1
ストレージクラス: Intelligent-Tiering
バージョニング: 有効
暗号化: SSE-S3 (AES-256)
```

---

### 03. CloudWatch Logs設定

**ファイル**: [03-cloudwatch-logs-setup-guide.md](./03-cloudwatch-logs-setup-guide.md)

**内容**:
- Log Group作成（/aws/datasync）
- ログ保持期間設定
- メトリクスフィルター設定
- ログのエクスポート設定

**対象者**: DevOpsエンジニア
**所要時間**: 15分
**前提条件**: なし

**Log Group設定**:
```
名前: /aws/datasync
保持期間: 90日
暗号化: AES-256
```

---

### 04. DataSync Agent インストール

**ファイル**: [04-datasync-agent-installation-guide.md](./04-datasync-agent-installation-guide.md)

**内容**:
- Agent OVAダウンロード
- VMware ESXiへのデプロイ
- Hyper-Vへのデプロイ
- Linux KVMへのデプロイ
- ネットワーク設定
- Agent Activation（AWSへの登録）
- 接続テスト

**対象者**: インフラエンジニア、VMware/Hyper-V/KVM管理者
**所要時間**: 2-3時間
**前提条件**: 仮想化基盤（VMware/Hyper-V/KVM）、NAS接続情報

**推奨スペック**:
```
vCPU: 8コア
Memory: 32GB
Disk: 100GB
Network: 1Gbps以上
IP: 192.168.1.50 (固定IP推奨)
```

**重要ステップ**:
1. Agent VM構築
2. ネットワーク設定（固定IP）
3. AWS DataSync Endpointへの接続確認（Port 443）
4. NASへの接続確認（SMB: Port 445 / NFS: Port 2049）
5. Activation Key取得
6. AWS ConsoleでAgent登録

---

### 05. Location & Task設定

**ファイル**: [05-datasync-location-task-configuration-guide.md](./05-datasync-location-task-configuration-guide.md)

**内容**:
- Source Location作成（SMB/NFS）
- Destination Location作成（S3）
- DataSync Task作成
- Transfer Mode設定（増分転送）
- フィルタリングルール設定
- スケジュール設定（月次自動実行）
- 小規模テスト実行

**対象者**: DevOpsエンジニア
**所要時間**: 2-3時間
**前提条件**: Agent Activation完了、S3バケット作成完了

**主要設定**:

#### Source Location（SMB例）
```
Server Hostname: 192.168.1.100
Share Name: FileShare
User: datasync_user
Domain: COMPANY
Password: AWS Secrets Manager経由
Agent: CIS-DataSync-Agent-NAS01
```

#### Destination Location（S3）
```
Bucket: cis-filesearch-landing
Folder: /
Storage Class: Intelligent-Tiering
IAM Role: CIS-DataSync-Task-Execution-Role
```

#### Task設定
```
名前: CIS-NAS01-to-S3-Monthly-Sync
Transfer Mode: Transfer only data that has changed
Verify Data: Verify only the data transferred
Overwrite Files: Always
Keep Deleted Files: Remove files in destination
Preserve Permissions: Yes
Bandwidth Limit: 100 Mbps（業務時間帯）
```

#### フィルタリング例
```
Exclude:
  - /.Trash/*          (ゴミ箱)
  - /**/~$*            (一時ファイル)
  - /Backup/*          (バックアップフォルダ)
  - /**/*.mp4          (動画ファイル - コスト削減)

Include:
  - /**/*.pdf          (PDFドキュメント)
  - /**/*.docx         (Wordドキュメント)
  - /**/*.xlsx         (Excelドキュメント)
  - /**/*.jpg          (画像ファイル)
  - /**/*.sfc          (SFCファイル)
```

#### スケジュール
```
頻度: 月次
日時: 毎月1日 深夜2:00
Cron式: 0 2 1 * ? *
タイムゾーン: Asia/Tokyo (UTC+9)
```

---

### 06. 監視・最適化・トラブルシューティング

**ファイル**: [06-datasync-monitoring-optimization-guide.md](./06-datasync-monitoring-optimization-guide.md)

**内容**:
- CloudWatch Metrics監視
- CloudWatch Alarms設定
- SNS通知設定（メール/Slack）
- パフォーマンス最適化
- コスト最適化
- トラブルシューティング
- 運用手順書

**対象者**: DevOpsエンジニア、運用担当者
**所要時間**: 継続的な運用タスク
**前提条件**: DataSync Task設定完了

**主要アラート**:
```
1. Agent OFFLINE検知（15分以上）
2. Task実行失敗
3. Task実行時間超過（6時間以上）
4. S3バケット容量急増（150%超過）
```

**パフォーマンス最適化**:
```
Agent VM:
  - vCPU: 8 → 16コア（大量ファイル時）
  - Memory: 32 → 64GB（大量ファイル時）
  - MTU: 1500 → 9000 Bytes (Jumbo Frame)
  - NIC: 1Gbps → 10Gbps

Task Options:
  - 並列転送数: 自動調整（最大32並列）
  - Buffer size: 1MB → 4MB（大容量ファイル時）
```

**コスト最適化**:
```
DataSync料金:
  - 初回: 10TB × $0.0125/GB = $128
  - 月次: 500GB × $0.0125/GB = $6.40/月
  - 年間: $128 + ($6.40 × 11) = $198.40

削減戦略:
  ✅ 増分転送（年間$1,337削減）
  ✅ 不要ファイル除外（年間$307削減）
  ✅ S3 Intelligent-Tiering（年間$1,572削減）

年間総削減: 約$3,200
```

---

## 🚀 セットアップ手順（全体フロー）

### Week 1: 準備・設計（5営業日）

**Day 1-2: AWS基盤設定**
```
✅ 01-iam-roles-setup-guide.md
✅ 02-s3-bucket-setup-guide.md
✅ 03-cloudwatch-logs-setup-guide.md
```

**Day 3: NAS情報収集**
```
✅ nas-information-request-template.md
   → クライアントにメール送信
   → NAS接続情報（IP、共有名、認証情報）を取得
```

**Day 4-5: Agent環境準備**
```
⏳ 仮想化基盤確認（VMware/Hyper-V/KVM）
⏳ リソース確保（vCPU: 8, Memory: 32GB）
⏳ ネットワーク設定（固定IP、DNS、ゲートウェイ）
```

### Week 2: Agent & Location設定（5営業日）

**Day 6-7: Agent インストール**
```
⏳ 04-datasync-agent-installation-guide.md
   → OVAダウンロード
   → VMデプロイ
   → ネットワーク設定
   → Agent Activation
   → 接続テスト
```

**Day 8-10: Location & Task設定**
```
⏳ 05-datasync-location-task-configuration-guide.md
   → Source Location作成（SMB/NFS）
   → Destination Location作成（S3）
   → DataSync Task作成
   → フィルタリングルール設定
   → 小規模テスト（100ファイル）
```

### Week 3: 初回同期実行（5営業日）

**Day 11: 最終確認**
```
⏳ 全設定の再確認
⏳ バックアップ計画の策定
⏳ 実行スケジュールの調整（金曜18:00開始推奨）
```

**Day 12-14: 初回フルコピー実行**
```
⏳ Task手動実行（Transfer Mode: Transfer all data）
⏳ 進捗監視（CloudWatch Logs）
⏳ 想定実行時間: 45時間（10TB、500万ファイル）
```

**Day 15: 検証・切り替え**
```
⏳ S3バケット検証（ファイル数、データ量）
⏳ メタデータ確認
⏳ EC2 Workers処理確認
⏳ 月次スケジュール有効化
```

### Week 4以降: 運用フェーズ

**月次タスク**
```
✅ 毎月1日 深夜2:00: DataSync自動実行
✅ 翌営業日午前中: 実行結果確認
✅ CloudWatch Logs確認
✅ コスト確認
```

**継続的改善**
```
✅ 06-datasync-monitoring-optimization-guide.md
   → パフォーマンス監視
   → コスト最適化
   → アラート対応
```

---

## ✅ チェックリスト

### 事前準備

```
AWS環境:
  ✅ AWSアカウント準備（770923989980）
  ✅ AdministratorAccess権限取得
  ✅ AWS CLI設定（ap-northeast-1）
  ✅ リージョン: Asia Pacific (Tokyo)

オンプレミス環境:
  ✅ 仮想化基盤（VMware/Hyper-V/KVM）確認
  ✅ リソース確保（vCPU: 8, Memory: 32GB, Disk: 100GB）
  ✅ ネットワーク確認（Port 443 アウトバウンド可能）
  ✅ NAS接続情報取得（IP、共有名、認証情報）

クライアント調整:
  ✅ NAS管理者との連携
  ✅ 実行スケジュール調整（業務時間外）
  ✅ 通知先メールアドレス確認
```

### Week 1完了チェック

```
AWS基盤:
  ✅ IAM Role作成完了
  ✅ S3バケット作成完了（cis-filesearch-landing）
  ✅ CloudWatch Logs設定完了

NAS情報:
  ✅ NAS接続情報取得完了
  ✅ 認証情報をAWS Secrets Managerに保存
  ✅ 同期対象フォルダパス確定
  ✅ 除外フォルダリスト確定
```

### Week 2完了チェック

```
DataSync Agent:
  ✅ Agent VM構築完了
  ✅ Agent Status: ONLINE
  ✅ NAS接続テスト成功
  ✅ AWS接続テスト成功

Location & Task:
  ✅ Source Location作成完了
  ✅ Destination Location作成完了
  ✅ DataSync Task作成完了
  ✅ 小規模テスト（100ファイル）成功
```

### Week 3完了チェック

```
初回同期:
  ✅ 初回フルコピー実行完了
  ✅ S3バケット検証完了（ファイル数、データ量一致）
  ✅ メタデータ保持確認
  ✅ EC2 Workers処理完了

運用準備:
  ✅ 月次スケジュール有効化
  ✅ CloudWatch Alarms設定完了
  ✅ SNS通知設定完了（メール/Slack）
  ✅ 運用手順書作成完了
```

---

## 📊 想定コスト

### 初期費用（Week 1-3）

| 項目 | 内容 | 費用 |
|------|------|------|
| DataSync初回転送 | 10TB × $0.0125/GB | $128 |
| S3ストレージ（初月） | 10TB × $0.025/GB | $256 |
| EC2処理（Spot） | 10台 × 45時間 × $0.0104/h | $4.68 |
| **合計** | | **$388.68** |

### 月次運用費用

| 項目 | 内容 | 月額 |
|------|------|------|
| DataSync月次転送 | 500GB × $0.0125/GB | $6.40 |
| S3追加ストレージ | 500GB × $0.0125/GB（平均） | $6.40 |
| EC2処理（Spot） | 4台 × 3時間 × $0.0104/h | $0.12 |
| **月次合計** | | **$12.92** |
| **年間合計** | | **$155.04** |

### 年間総コスト

```
初期費用: $388.68
年間運用費用: $155.04
合計: $543.72/年

コスト削減後（最適化適用）:
  - 増分転送: -$1,337/年
  - 不要ファイル除外: -$307/年
  - Intelligent-Tiering: -$1,572/年
実質削減: 約$3,200/年
```

---

## 🐛 よくある問題と対処法

### Agent Status: OFFLINE

**原因**:
- Agent VMがシャットダウンしている
- ネットワーク接続エラー
- AWS DataSync Endpointへの接続失敗

**対処法**:
```bash
# 1. VM起動確認
VMware/Hyper-V/KVMコンソールでVM起動確認

# 2. ネットワーク接続確認
ping 8.8.8.8
ping datasync.ap-northeast-1.amazonaws.com

# 3. Agent Status確認
aws datasync describe-agent \
  --agent-arn arn:aws:datasync:ap-northeast-1:770923989980:agent/agent-0abc12345def67890
```

### Task実行失敗

**原因**:
- NAS接続エラー
- S3バケットアクセス権限不足
- ネットワークタイムアウト

**対処法**:
```bash
# 1. CloudWatch Logsで詳細確認
CloudWatch → Log groups → /aws/datasync

# 2. NAS接続テスト
Agent VMからSMB/NFS接続テスト

# 3. IAM Role権限確認
aws iam get-role-policy \
  --role-name CIS-DataSync-Task-Execution-Role \
  --policy-name DataSyncS3Access
```

### 転送速度が遅い

**原因**:
- Agent VMリソース不足
- ネットワーク帯域幅制限
- 小ファイルが大量

**対処法**:
```
1. Agent VMリソース増強
   vCPU: 4 → 8 or 16
   Memory: 16GB → 32GB or 64GB

2. ネットワーク最適化
   MTU: 1500 → 9000
   NIC: 1Gbps → 10Gbps

3. 帯域幅制限解除
   Task Options → Bandwidth Limit: Unlimited
```

---

## 📞 サポート・問い合わせ

### AWS公式サポート

- [AWS DataSync Documentation](https://docs.aws.amazon.com/datasync/)
- [AWS Support](https://console.aws.amazon.com/support/)

### プロジェクト内部

```
DevOpsチーム:
  Email: devops@company.com
  Slack: #cis-filesearch-devops

運用担当:
  Email: operations@company.com
  Slack: #cis-filesearch-ops

緊急連絡先:
  担当: DevOps Manager
  電話: 03-XXXX-XXXX（24時間対応）
```

---

## 📝 更新履歴

| 版数 | 日付 | 変更内容 | 作成者 |
|------|------|---------|--------|
| 1.0 | 2025-01-17 | 初版作成 | CIS DevOps Team |

---

## 🎓 推奨学習リソース

### AWS公式トレーニング

- [AWS DataSync Getting Started](https://aws.amazon.com/datasync/getting-started/)
- [AWS re:Invent Videos on DataSync](https://www.youtube.com/results?search_query=aws+datasync+reinvent)

### ブログ記事

- [Migrating millions of files to S3 with DataSync](https://aws.amazon.com/blogs/storage/migrating-millions-of-files-to-amazon-s3-with-aws-datasync/)
- [DataSync Performance Best Practices](https://aws.amazon.com/blogs/storage/accelerating-file-transfers-with-aws-datasync/)

---

**次のステップ**: [00-datasync-overview-architecture.md](./00-datasync-overview-architecture.md) から読み始めてください。

**作成者**: CIS DevOps Team
**最終更新**: 2025-01-17
