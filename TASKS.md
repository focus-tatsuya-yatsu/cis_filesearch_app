# CIS File Search Application - Task Management

**最終更新**: 2025-11-28
**プロジェクトステータス**: Phase 1 - AWS統合 & DocuWorks準備フェーズ
**全体進捗**: 50% (AWS統合準備中、DocuWorks開発環境構築計画完了)

---

## 🎯 現在のフェーズ: AWS Infrastructure Integration & Verification

### ✅ 完了済み (2025-11-28時点)
- [x] AWS認証設定完了
- [x] S3バケット作成 (landing, thumbnail)
- [x] SQSキュー作成 (main queue + DLQ)
- [x] OpenSearchドメイン作成・起動確認
- [x] IAMロール設定 (EC2 Worker用)
- [x] Auto Scalingグループ設定
- [x] Bedrock APIアクセス確認
- [x] Backend File Scanner実装 (TypeScript)
  - FileScanner, DatabaseManager, S3Uploader, SQSPublisher
  - FileSystem abstraction (Local, Mounted, SMB, Mock)
- [x] **DocuWorks統合準備計画作成** (2025-11-28)
  - 2日間の詳細作業計画完成
  - Windows Service開発ロードマップ
  - モック実装アーキテクチャ設計
  - ライセンス到着後の30分統合手順

---

## 🔥 Phase 1 - Priority 0 Tasks (即時対応必須)

**目標**: AWS統合パイプラインの完全稼働 (3-5営業日)

| # | タスク | 優先度 | ステータス | 工数 | 担当 | 完了条件 |
|---|--------|--------|----------|------|------|---------|
| **P0-1** | OpenSearch検証スクリプト修正 | 🔴 Critical | ⏸️ Blocked | 2h | DevOps | スクリプト実行成功、エラー解消 |
| **P0-2** | S3バケットEventBridge有効化 | 🔴 Critical | ❌ Not Started | 30min | DevOps | EventBridge設定確認完了 |
| **P0-3** | EventBridgeルール作成 (S3→SQS) | 🔴 Critical | ❌ Not Started | 1h | DevOps | ルール動作テスト成功 |
| **P0-4** | SQSメッセージ保持期間調整 (4→7日) | 🟡 High | ❌ Not Started | 15min | DevOps | 設定変更確認 |
| **P0-5** | End-to-Endパイプラインテスト | 🔴 Critical | ❌ Not Started | 3h | DevOps + BE | S3→EventBridge→SQS全フロー確認 |
| **P0-6** | Python Worker EC2デプロイ準備 | 🟡 High | ❌ Not Started | 4h | BE + DevOps | Workerコード準備、EC2起動テスト |

**合計工数**: 1.5営業日 (12時間)

---

## 📋 Phase 1 - Priority 1 Tasks (週内完了目標)

**目標**: Python WorkerのEC2自動デプロイ確立 (5-7営業日)

| # | タスク | 優先度 | ステータス | 工数 | 依存関係 | 完了条件 |
|---|--------|--------|----------|------|---------|---------|
| **P1-1** | Python Worker実装完成 | 🔴 Critical | 🔄 In Progress | 2日 | P0-5完了 | 基本処理フロー動作確認 |
| **P1-2** | Worker Unit Tests作成 | 🟡 High | ❌ Not Started | 1日 | P1-1完了 | カバレッジ70%以上 |
| **P1-3** | EC2 User Dataスクリプト作成 | 🟡 High | ❌ Not Started | 4h | P1-1完了 | 自動起動・Worker実行確認 |
| **P1-4** | Auto Scaling動作確認 | 🟢 Medium | ❌ Not Started | 3h | P1-3完了 | スケールアップ/ダウン動作 |
| **P1-5** | CloudWatch Logs統合 | 🟡 High | ❌ Not Started | 2h | P1-1完了 | ログ出力・検索確認 |
| **P1-6** | 負荷テスト (100ファイル) | 🟢 Medium | ❌ Not Started | 4h | P1-4完了 | 処理速度・安定性確認 |

**合計工数**: 4.5営業日 (36時間)

---

## 🎯 Phase 1 - Priority 2 Tasks (Phase 1完了前)

**目標**: セキュリティ・最適化・ドキュメント整備 (3-4営業日)

| # | タスク | 優先度 | ステータス | 工数 | 完了条件 |
|---|--------|--------|----------|------|---------|
| **P2-1** | セキュリティ監査 | 🟡 High | ❌ Not Started | 1日 | セキュリティチェックリスト全項目クリア |
| **P2-2** | コスト最適化レビュー | 🟢 Medium | ❌ Not Started | 4h | 月額コスト$100以下確認 |
| **P2-3** | インフラドキュメント更新 | 🟢 Medium | ❌ Not Started | 1日 | 全AWSリソース構成図・設定書完成 |
| **P2-4** | 運用手順書作成 | 🟢 Medium | ❌ Not Started | 1日 | 障害対応・メンテナンス手順書 |
| **P2-5** | VPCエンドポイント最適化 | 🟢 Low | ❌ Not Started | 3h | NAT Gateway削減確認 |

**合計工数**: 3.5営業日 (28時間)

---

## 📅 Sprint 計画: AWS統合完成スプリント (2週間)

### Sprint Goal
**AWS基盤の完全稼働 + Python Worker自動デプロイ確立**

**期間**: 2025-11-19 〜 2025-12-03 (10営業日)

---

## 🗓️ Week 1: AWS Pipeline Integration (Day 1-5)

### Day 1 (11/19) - EventBridge & Pipeline Setup
**担当**: DevOps

**タスク**:
1. ✅ AWS検証結果レビュー (完了)
2. 🔴 **P0-1**: OpenSearch検証スクリプト修正 (2h)
   - `describe_domain`APIレスポンス構造調査
   - スクリプト修正・テスト実行
3. 🔴 **P0-2**: S3 EventBridge有効化 (30min)
   - `cis-filesearch-s3-landing` バケット設定
   - EventBridge Configuration確認
4. 🔴 **P0-3**: EventBridgeルール作成 (1h)
   - イベントパターン: `s3:ObjectCreated:*`
   - ターゲット: `cis-filesearch-index-queue`
   - SQSリソースポリシー更新

**成果物**: EventBridge S3→SQS接続確認

---

### Day 2 (11/20) - SQS Optimization & E2E Test
**担当**: DevOps + BE

**タスク**:
1. 🟡 **P0-4**: SQS設定調整 (15min)
   - メッセージ保持期間: 4日→7日
   - Visibility Timeout確認
2. 🔴 **P0-5**: E2Eパイプラインテスト (3h)
   - テストファイルS3アップロード
   - EventBridge→SQS配信確認
   - メッセージフォーマット検証
   - タイムライン計測
3. 🟡 **P0-6**: Python Worker準備開始 (2h)
   - 既存Worker コードレビュー
   - 依存関係確認 (requirements.txt)

**成果物**: S3→EventBridge→SQS全フロー動作確認書

---

### Day 3-4 (11/21-22) - Python Worker Implementation
**担当**: BE + DevOps

**タスク**:
1. 🔴 **P1-1**: Python Worker実装 (2日)
   - SQSメッセージ受信ループ
   - S3ファイルダウンロード
   - メタデータ抽出 (PDF, 画像)
   - OpenSearchインデックス登録
   - サムネイル生成・S3アップロード
   - エラーハンドリング・リトライ
2. 🟡 **P1-5**: CloudWatch Logs統合 (並行、2h)
   - ログ出力設定
   - ログフォーマット統一

**成果物**: 動作するPython Workerコード

---

### Day 5 (11/25) - Worker Testing
**担当**: BE + QA

**タスク**:
1. 🟡 **P1-2**: Worker Unit Tests (1日)
   - メッセージ処理ロジックテスト
   - S3操作モックテスト
   - OpenSearch操作モックテスト
   - カバレッジレポート生成
2. ドキュメント作成
   - Worker設計書
   - APIドキュメント

**成果物**: テストカバレッジ70%以上

---

## 🗓️ Week 2: EC2 Deployment & Auto Scaling (Day 6-10)

### Day 6 (11/26) - EC2 Deployment Setup
**担当**: DevOps + BE

**タスク**:
1. 🟡 **P1-3**: EC2 User Dataスクリプト作成 (4h)
   - Python環境セットアップ
   - 依存パッケージインストール
   - Worker自動起動設定
   - CloudWatch Agentインストール
2. Launch Template更新
   - User Data統合
   - IAMロール確認
   - Security Group確認

**成果物**: 自動起動するEC2 Worker

---

### Day 7 (11/27) - Auto Scaling Configuration
**担当**: DevOps

**タスク**:
1. 🟢 **P1-4**: Auto Scaling動作確認 (3h)
   - スケーリングポリシー設定
   - SQSメトリクス連動確認
   - スケールアップテスト
   - スケールダウンテスト
2. CloudWatch Alarms設定
   - Queue Depth Alarm
   - Worker Health Alarm

**成果物**: Auto Scaling動作確認レポート

---

### Day 8 (11/28) - Load Testing
**担当**: BE + QA

**タスク**:
1. 🟢 **P1-6**: 負荷テスト (4h)
   - 100ファイル一括アップロード
   - 処理時間計測
   - スケーリング挙動確認
   - エラー率確認
   - コスト試算

**成果物**: 負荷テストレポート

---

### Day 9 (11/29) - Security & Optimization
**担当**: 全員

**タスク**:
1. 🟡 **P2-1**: セキュリティ監査 (1日)
   - IAMポリシー最小権限確認
   - S3暗号化確認
   - OpenSearchアクセス制御確認
   - CloudTrail監査ログ確認
   - 脆弱性スキャン
2. 🟢 **P2-2**: コスト最適化 (4h)
   - リソース稼働率確認
   - 不要リソース削除
   - Spot Instance設定最適化

**成果物**: セキュリティチェックリスト、コストレポート

---

### Day 10 (12/2) - Documentation & Handover
**担当**: 全員

**タスク**:
1. 🟢 **P2-3**: インフラドキュメント更新 (1日)
   - AWSリソース構成図
   - 各サービス設定書
   - ネットワーク図
2. 🟢 **P2-4**: 運用手順書作成
   - デプロイ手順
   - トラブルシューティング
   - 障害対応フロー
   - メンテナンス手順

**成果物**: 完全なドキュメントセット

---

## 🎯 Sprint Success Criteria (完了条件)

### 必須条件 (Must Have)
- ✅ S3→EventBridge→SQS→Worker→OpenSearch 全フロー動作
- ✅ Auto Scaling によるWorker自動スケール確認
- ✅ 100ファイル処理の負荷テスト成功
- ✅ セキュリティチェックリスト全項目クリア
- ✅ CloudWatchでの監視・ログ確認可能

### 推奨条件 (Should Have)
- ✅ Workerテストカバレッジ70%以上
- ✅ 平均処理時間: 1ファイルあたり5秒以下
- ✅ エラー率: 1%以下
- ✅ 月額コスト試算: $100以下

### オプション (Nice to Have)
- VPCエンドポイント最適化
- マルチリージョン展開計画
- Disaster Recovery手順

---

## 🚧 ブロッカー & リスク管理

### 現在のブロッカー

| ID | ブロッカー | 影響タスク | 重大度 | 対応策 | 担当 | 期限 |
|----|-----------|-----------|--------|--------|------|------|
| **B-1** | OpenSearch検証スクリプトエラー | P0-1 | 🟡 Medium | APIドキュメント確認、構造修正 | DevOps | 11/19 |
| **B-2** | EventBridge未設定 | P0-2, P0-3, P0-5 | 🔴 High | AWS Console設定 | DevOps | 11/19 |

### 潜在リスク

| リスク | 発生確率 | 影響度 | 対策 | 担当 |
|--------|---------|--------|------|------|
| Python Workerバグによる処理遅延 | 🟡 Medium | 🔴 High | 十分なテスト実施、モニタリング強化 | BE |
| Auto Scaling設定ミスによるコスト増 | 🟢 Low | 🔴 High | 上限設定、アラーム設定 | DevOps |
| OpenSearch容量不足 | 🟢 Low | 🟡 Medium | ストレージアラーム設定 | DevOps |
| セキュリティ脆弱性 | 🟢 Low | 🔴 High | セキュリティ監査実施 | 全員 |

---

## 📊 進捗ダッシュボード

### 全体進捗: 45% → 目標 95% (Sprint終了時)

```
Phase 1 Progress: ████████████░░░░░░░░ 45%

Infrastructure Setup:   ██████████████░░░░░░ 70%
Pipeline Integration:   ████░░░░░░░░░░░░░░░░ 20%
Worker Development:     ██████░░░░░░░░░░░░░░ 30%
Testing & QA:           ██░░░░░░░░░░░░░░░░░░ 10%
Documentation:          ████░░░░░░░░░░░░░░░░ 20%
```

### タスク完了状況

- **P0タスク**: 1/6 完了 (17%)
- **P1タスク**: 0/6 完了 (0%)
- **P2タスク**: 0/5 完了 (0%)

**合計**: 1/17 タスク完了 (6%)

---

## 💰 コスト見積もり & 予算管理

### 月額コスト見積もり (本番稼働想定)

| サービス | 設定 | 月額 | 備考 |
|---------|------|------|------|
| **S3** | 500GB (Intelligent-Tiering) | $12 | ストレージ + リクエスト |
| **SQS** | 100万リクエスト | $0.40 | 無料枠超過分 |
| **OpenSearch** | t3.small.search × 1 | $48 | 24/7稼働 |
| **EC2 (Spot)** | t3.medium × 平均1台 | $9 | 70% Spot割引適用 |
| **EC2 (On-Demand)** | t3.medium × バックアップ | $3 | 必要時のみ |
| **EBS** | 30GB × 2台 | $6 | EC2ボリューム |
| **CloudWatch Logs** | 5GB | $2.50 | ログ保持 |
| **Data Transfer** | 50GB/月 | $4.50 | S3 → EC2 |
| **EventBridge** | 100万イベント | $1 | S3イベント処理 |
| **VPC Endpoints** | 未設定 | $0 | Phase 2で検討 |
| **合計** | - | **$86.40** | **予算内** |

**予算上限**: $100/月
**安全マージン**: $13.60 (13.6%)

### コスト最適化施策
- ✅ Spot Instanceで70%削減
- ✅ Auto Scalingで必要時のみEC2起動
- ✅ S3 Intelligent-Tieringで自動最適化
- 🔄 VPCエンドポイント追加でData Transfer削減可能 (Phase 2)

---

## 📈 品質メトリクス目標

### テストカバレッジ目標
- **Python Worker**: 70%以上
- **重要モジュール**: 85%以上
- **統合テスト**: 主要フロー100%カバー

### パフォーマンス目標
- **ファイル処理速度**: 平均5秒/ファイル以下
- **スループット**: 720ファイル/時間 (Auto Scaling時)
- **エラー率**: 1%以下
- **SQS→Worker処理遅延**: 10秒以内

### 可用性目標
- **Worker稼働率**: 99%以上
- **OpenSearch稼働率**: 99.5%以上 (AWS SLA)
- **データ損失**: 0件 (DLQ + S3保持)

---

## 🔄 次のフェーズ (Phase 2) プレビュー

### Phase 2: Frontend開発 (12月開始予定)

**期間**: 2025-12-03 〜 2026-01-31 (2ヶ月)

**主要タスク**:
1. Next.js プロジェクト初期化
2. AWS Cognito認証実装
3. 検索UI実装 (OpenSearch統合)
4. ファイルプレビュー機能
5. 管理画面 (ダッシュボード)

**前提条件** (Phase 1完了):
- ✅ AWSインフラ完全稼働
- ✅ Python Worker自動デプロイ
- ✅ OpenSearch検索API動作確認
- ✅ セキュリティ監査完了

---

## 📝 意思決定ログ

### 2025-11-28: DocuWorks統合準備フェーズ開始

**決定事項**:
- DocuWorks 10ライセンス到着前の2日間、最大限の準備作業を実施
- Windows Service (.NET 8.0) でのファイル処理実装
- モック実装によるライセンス不要の開発・テスト環境構築
- インターフェース駆動設計でライセンス到着後30分以内の統合を実現

**作成ドキュメント**:
1. **詳細計画**: `docs/deployment/DOCUWORKS-PRE-INSTALLATION-PLAN.md`
   - Day 1-2の16時間作業計画
   - タスクごとの所要時間・優先度・成果物
2. **クイックガイド**: `docs/deployment/DOCUWORKS-QUICKSTART-GUIDE.md`
   - 開発者向け即座実行可能な手順書
   - トラブルシューティング完備

**アーキテクチャ決定**:
- `IDocuWorksProcessor` インターフェースによる抽象化
- `DocuWorksProcessorMock` でライセンス不要の開発継続
- `DocuWorksProcessorReal` はライセンス到着後に実装
- DI (Dependency Injection) による実装切り替え

**期待される効果**:
- ライセンス到着後30分で本番稼働可能
- AWS統合とWindows Service開発の並行作業
- リスク最小化 (モック→実装の段階的移行)

**次のアクション**:
- [x] Day 1: Windows開発環境セットアップ & モック実装 (8h) - **完了**
- [ ] Day 2: AWS統合、セキュリティ強化、テスト実施 (7-8h) - **本日実施**
- [ ] ライセンス到着: 実装切り替え & 統合テスト (30min)

---

## 🎯 DocuWorks Day 2実行計画 (2025-11-28)

**ドキュメント**: `/DOCUWORKS-DAY2-EXECUTION-PLAN.md`
**作業時間**: 7-8時間
**目標**: AWS統合完了とセキュリティ強化による本番準備完了

### Morning Session (9:00-12:00) - 3時間

| 時間 | タスク | 優先度 | 成果物 |
|------|--------|--------|--------|
| **9:00-10:30** | AWS EventBridge統合 | 🔴 P0 | S3→SQS統合確認 |
| **10:30-12:00** | セキュリティ監査 | 🟡 P1 | 重大問題0件確認 |

### Afternoon Session (13:00-17:00) - 4時間

| 時間 | タスク | 優先度 | 成果物 |
|------|--------|--------|--------|
| **13:00-15:00** | 単体テスト作成 | 🟡 P1 | カバレッジ70%以上 |
| **15:00-17:00** | End-to-End統合テスト | 🔴 P0 | 全フロー動作確認 |

### Evening Session (17:00-18:00) - 1時間

| 時間 | タスク | 優先度 | 成果物 |
|------|--------|--------|--------|
| **17:00-18:00** | Python Worker最適化 + レポート | 🟢 P2 | Day 2完了レポート |

### Day 2完了条件
- [ ] AWS EventBridge → SQS統合成功
- [ ] セキュリティ重大問題0件
- [ ] テストカバレッジ70%以上
- [ ] End-to-Endテスト全シナリオパス
- [ ] Day 2完了レポート作成

### リスク管理
- **リスク1**: EventBridge設定失敗 (影響: 🔴 Critical)
  - 対策: ドキュメント厳守、即座テスト実施
- **リスク2**: テストカバレッジ不足 (影響: 🟡 High)
  - 対策: 重要モジュール優先、P2タスク削減可
- **リスク3**: セキュリティ脆弱性発見 (影響: 🔴 Critical)
  - 対策: security-scan.ps1実行、即座修正

---

### 2025-11-19: AWS Infrastructure Integration Sprint開始

**決定事項**:
- AWS検証結果に基づき、統合フェーズを最優先
- Python Worker実装とEC2自動デプロイに集中
- Frontend開発は Phase 2 (12月) から本格開始

**理由**:
- AWSインフラ70%完成、残り30%の統合が最重要
- Backend基盤確立後のFrontend開発が効率的
- File Scannerは既存実装を活用、Python Workerに注力

**影響**:
- Phase 1完了予定: 2025-12-03 (当初より1ヶ月前倒し)
- Backend品質・安定性向上により、Phase 2の加速が期待

**リスク対応**:
- EventBridge未設定 → 即日対応
- OpenSearch検証スクリプトエラー → APIドキュメント確認・修正

### 2025-01-15: Backend File Scanner先行実装完了

**決定事項**:
- File Scannerの基本実装完了を確認
- TypeScript実装からPython Workerへの移行決定

**理由**:
- AWSインフラ中心アーキテクチャへの方針転換
- EC2 + Python環境での運用が最適と判断

---

## 📞 コミュニケーション計画

### Daily Standup (毎日 10:00)
- 昨日の進捗
- 今日の予定
- ブロッカー報告

### Sprint Review (金曜日 16:00)
- 週次進捗レビュー
- 成果物デモ
- 次週計画確認

### Sprint Retrospective (12/3 最終日)
- 良かった点
- 改善点
- 次Sprintへの提言

---

**次回レビュー**: 2025-11-22 (金曜日)
**担当PM**: Claude Code Product Manager
**最終更新**: 2025-11-19 15:00
