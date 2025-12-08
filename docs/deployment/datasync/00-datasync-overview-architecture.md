# AWS DataSync 概要とアーキテクチャ

**作成日**: 2025-01-17
**対象フェーズ**: Week 2-3
**所要時間**: 読解30分
**前提知識**: AWS基礎、ネットワーク基礎、ファイル共有プロトコル（SMB/NFS）

---

## 📋 目次

1. [DataSyncとは](#datasyncとは)
2. [CISプロジェクトにおけるDataSyncの役割](#cisプロジェクトにおけるdatasyncの役割)
3. [アーキテクチャ全体像](#アーキテクチャ全体像)
4. [主要コンポーネント](#主要コンポーネント)
5. [データフロー](#データフロー)
6. [導入メリット](#導入メリット)
7. [制約事項と考慮点](#制約事項と考慮点)
8. [コスト概算](#コスト概算)

---

## DataSyncとは

### 概要

**AWS DataSync**は、オンプレミスのストレージシステムとAWS間、あるいはAWSサービス間で大量のデータを高速かつ安全に転送するためのフルマネージドサービスです。

### 主な特徴

| 特徴 | 説明 | メリット |
|------|------|---------|
| **高速転送** | ネットワーク帯域幅を最大限活用（最大10Gbps） | 数百万ファイルを数時間で転送可能 |
| **並列処理** | 複数のファイルを同時転送 | 小さなファイルも効率的に転送 |
| **データ整合性** | チェックサム検証による完全性保証 | 転送エラーの検出と自動再試行 |
| **圧縮・暗号化** | 転送中のデータを自動圧縮・暗号化（TLS 1.3） | 帯域幅削減とセキュリティ確保 |
| **増分転送** | 変更されたファイルのみを転送 | 月次同期でも帯域幅とコストを節約 |
| **スケジューリング** | 時間指定での自動実行 | 業務時間外の深夜帯で実行可能 |

### サポートプロトコル

```
オンプレミス → AWS:
  ✅ NFS (v3, v4, v4.1)
  ✅ SMB/CIFS (v2.1, v3.0, v3.1.1)
  ✅ HDFS (Hadoop Distributed File System)
  ✅ オブジェクトストレージ (S3 互換 API)

AWS → AWS:
  ✅ S3 → S3
  ✅ EFS → EFS
  ✅ FSx for Windows → FSx for Windows
  ✅ FSx for Lustre → FSx for Lustre
```

---

## CISプロジェクトにおけるDataSyncの役割

### ビジネス要件

**クライアントの課題**:
- オンプレミスNASに10TB、約500万ファイルが保存されている
- 全社員がファイルを効率的に検索できるシステムが必要
- NASはオンプレミスに残したまま、AWSで検索インデックスを構築

**DataSyncの役割**:
1. **初回フルコピー**: NAS上の全ファイルをS3に転送（一度きり）
2. **月次差分同期**: 新規・更新されたファイルのみを月1回転送
3. **メタデータ保持**: ファイルのタイムスタンプ、所有者情報を維持

### 従来の方法との比較

| 方法 | 転送速度 | 設定難易度 | コスト | 信頼性 | 備考 |
|------|---------|----------|-------|-------|------|
| **rsync over VPN** | 低（10-100Mbps） | 高 | 低 | 中 | 手動スクリプト管理が必要 |
| **AWS CLI (aws s3 sync)** | 中（100-500Mbps） | 中 | 低 | 中 | エラーハンドリングが弱い |
| **DataSync** | 高（1-10Gbps） | 低 | 中 | 高 | フルマネージド、自動再試行 |
| **AWS Storage Gateway** | 中（100-1000Mbps） | 高 | 高 | 高 | 常時接続が必要 |

**選定理由**: DataSyncは大量ファイル（500万件）の転送に最適化されており、月次バッチ実行に適している。

---

## アーキテクチャ全体像

### システム構成図

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         オンプレミス環境（クライアント社内）                        │
│                                                                           │
│  ┌─────────────────┐         ┌──────────────────────────────────┐        │
│  │   NAS Server    │         │  DataSync Agent (VM)              │        │
│  │                 │         │                                    │        │
│  │  - Synology/    │         │  - VMware ESXi / Hyper-V / KVM    │        │
│  │    QNAP/        │◄────────┤  - vCPU: 4 cores                  │        │
│  │    NetApp       │ SMB/NFS │  - Memory: 32GB                   │        │
│  │                 │         │  - Disk: 80GB                     │        │
│  │  - 10TB         │         │  - Network: 1Gbps                 │        │
│  │  - 500万ファイル  │         │                                    │        │
│  └─────────────────┘         └──────────────────────────────────┘        │
│                                        │                                  │
│                                        │ Port 443 (HTTPS)                │
└────────────────────────────────────────┼──────────────────────────────────┘
                                         │
                                         │ TLS 1.3 Encrypted
                                         │ Compressed Data Transfer
                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        AWS Cloud (ap-northeast-1)                        │
│                                                                           │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │              AWS DataSync Service                               │     │
│  │                                                                  │     │
│  │  ┌────────────┐    ┌──────────────┐    ┌──────────────┐       │     │
│  │  │  Location  │    │  DataSync    │    │  Location    │       │     │
│  │  │  (Source)  │───▶│    Task      │───▶│ (Destination)│       │     │
│  │  │            │    │              │    │              │       │     │
│  │  │ Agent ARN  │    │ - Schedule   │    │ S3 Bucket    │       │     │
│  │  │ SMB/NFS    │    │ - Filtering  │    │ ARN          │       │     │
│  │  │ Path       │    │ - Bandwidth  │    │              │       │     │
│  │  └────────────┘    └──────────────┘    └──────────────┘       │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                   │                                      │
│                                   │ s3:ObjectCreated:* Event             │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │  S3: cis-filesearch-landing (Landing Bucket)                   │     │
│  │                                                                  │     │
│  │  /documents/2025/01/report.pdf                                  │     │
│  │  /images/2024/12/photo.jpg                                      │     │
│  │  /cad/projects/design.sfc                                       │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                   │                                      │
│                                   │ Trigger                              │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │         EventBridge Rule (S3 Event Pattern)                    │     │
│  │                                                                  │     │
│  │  Event Pattern:                                                 │     │
│  │    source: aws.s3                                               │     │
│  │    detail-type: Object Created                                  │     │
│  │    detail.bucket.name: cis-filesearch-landing                   │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                   │                                      │
│                                   │ Send Message                         │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │         SQS: cis-file-processing-queue                         │     │
│  │                                                                  │     │
│  │  Message Body:                                                  │     │
│  │    - s3.bucket.name                                             │     │
│  │    - s3.object.key                                              │     │
│  │    - s3.object.size                                             │     │
│  │    - eventTime                                                  │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                   │                                      │
│                                   │ Poll (Long Polling)                  │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │      EC2 Auto Scaling Group (Spot Instances)                   │     │
│  │                                                                  │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │     │
│  │  │ Python   │  │ Python   │  │ Python   │  │ Python   │       │     │
│  │  │ Worker   │  │ Worker   │  │ Worker   │  │ Worker   │       │     │
│  │  │  #1      │  │  #2      │  │  #3      │  │  #4      │       │     │
│  │  │          │  │          │  │          │  │          │       │     │
│  │  │ - PDF    │  │ - Office │  │ - Image  │  │ - SFC    │       │     │
│  │  │ - Text   │  │ - Excel  │  │ - TIFF   │  │          │       │     │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │     │
│  │       │             │             │             │               │     │
│  │       └─────────────┴─────────────┴─────────────┘               │     │
│  │                        │                                        │     │
│  │                        │ Store Metadata                         │     │
│  │                        ▼                                        │     │
│  │  ┌────────────────────────────────────────────────────────┐    │     │
│  │  │   OpenSearch / RDS PostgreSQL                          │    │     │
│  │  │                                                          │    │     │
│  │  │   - File metadata                                       │    │     │
│  │  │   - Full-text index                                     │    │     │
│  │  │   - Vector embeddings (for AI image search)            │    │     │
│  │  └────────────────────────────────────────────────────────┘    │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### ネットワーク接続方法

#### オプション1: インターネット経由（推奨 - 簡易）

```
[NAS] ─▶ [DataSync Agent] ─▶ Internet ─▶ [AWS DataSync Endpoint]
                              (HTTPS Port 443, TLS 1.3)
```

**メリット**:
- VPN構築不要
- 初期コストが低い
- 設定が簡単

**デメリット**:
- インターネット回線の帯域幅に依存
- レイテンシが高い可能性

#### オプション2: VPN経由（高セキュリティ）

```
[NAS] ─▶ [DataSync Agent] ─▶ VPN Tunnel ─▶ [VPC Endpoint] ─▶ [DataSync]
```

**メリット**:
- 専用回線で安定した転送速度
- プライベート接続でセキュリティ向上

**デメリット**:
- VPN構築コスト（AWS Site-to-Site VPN: $0.05/時間 = 約$36/月）
- 設定が複雑

#### オプション3: AWS Direct Connect経由（大規模・本番環境）

```
[NAS] ─▶ [DataSync Agent] ─▶ Direct Connect ─▶ [VPC] ─▶ [DataSync]
```

**メリット**:
- 最高速度（10Gbps）
- 最も安定した接続

**デメリット**:
- 初期費用が高額（数十万円〜）
- リードタイム長い（数週間〜数ヶ月）

**CISプロジェクト選定**: **オプション1（インターネット経由）**
理由: 月1回のバッチ転送のため、コスト優先。セキュリティはTLS 1.3で十分。

---

## 主要コンポーネント

### 1. DataSync Agent（オンプレミス仮想マシン）

**役割**: NASとAWS DataSyncサービス間の橋渡し

**推奨スペック（CISプロジェクト）**:
```
vCPU: 4コア（推奨: 8コア）
Memory: 32GB（推奨: 64GB - 大量ファイル転送時）
Disk: 80GB（OS + メタデータキャッシュ）
Network: 1Gbps以上（推奨: 10Gbps）

対応仮想化プラットフォーム:
  - VMware ESXi 6.5以降
  - Microsoft Hyper-V 2012 R2以降
  - Linux KVM（RHEL/CentOS 7以降、Ubuntu 16.04以降）
```

**ネットワーク要件**:
```
アウトバウンド:
  - Port 443 (HTTPS) → AWS DataSync Endpoints
  - Port 443 (HTTPS) → AWS S3 (オプション、VPC Endpoint使用時は不要)

オンプレミス内:
  - Port 445 (SMB) → NAS (SMBプロトコル使用時)
  - Port 2049 (NFS) → NAS (NFSプロトコル使用時)
  - Port 80 (HTTP) → DataSync Agent Console（初期設定時のみ）
```

### 2. DataSync Location (Source)

**役割**: 転送元（NAS）の接続情報を定義

**設定項目**:
```
Location Type: SMB または NFS

【SMB Location】
  - Server Hostname: 192.168.1.100 or nas.company.local
  - Share Name: /FileShare
  - Domain: COMPANY (Optional)
  - User: datasync_user
  - Password: ********** (AWS Secrets Manager経由)
  - Agent ARNs: arn:aws:datasync:ap-northeast-1:770923989980:agent/agent-0abc123

【NFS Location】
  - Server Hostname: 192.168.1.100 or nas.company.local
  - Export Path: /volume1/shared
  - NFS Version: NFSv3 / NFSv4 / NFSv4.1
  - Mount Options: rsize=1048576,wsize=1048576,hard,timeo=600
  - Agent ARNs: arn:aws:datasync:ap-northeast-1:770923989980:agent/agent-0abc123
```

### 3. DataSync Location (Destination)

**役割**: 転送先（S3）の接続情報を定義

**設定項目**:
```
Location Type: Amazon S3

S3 Bucket: cis-filesearch-landing
S3 Storage Class: INTELLIGENT_TIERING (推奨)
Folder: / (ルート) or /datasync/ (サブフォルダ)
IAM Role: CIS-DataSync-Task-Execution-Role
```

### 4. DataSync Task

**役割**: 実際の転送処理を実行・管理

**設定項目**:
```
Source Location: (SMB/NFS Location ARN)
Destination Location: (S3 Location ARN)

Options:
  - Transfer Mode: Transfer only data that has changed
  - Bandwidth Limit: 100 Mbps (業務時間帯の影響軽減)
  - Verify Data: Verify only the data transferred (推奨)
  - Overwrite Files: Overwrite files in destination
  - Preserve Metadata: POSIX permissions, timestamps, ownership
  - Filter Rules: Include/Exclude patterns

Schedule (Optional):
  - Frequency: Monthly (毎月1日 深夜2:00)
  - Cron Expression: 0 2 1 * ? *
```

---

## データフロー

### フェーズ1: 初回フルコピー（Week 3）

```
Day 1-2: Agent Activation & Location Setup
Day 3-4: Task Configuration & Testing (100 files)
Day 5-7: Full Sync Execution (10TB, 500万ファイル)

転送速度推定:
  - 帯域幅: 500 Mbps（実効値）
  - 10TB転送時間: 約45時間（並列処理により短縮可能）
  - 実行タイミング: 金曜夜 18:00 → 日曜夜 15:00
```

### フェーズ2: 月次差分同期（運用フェーズ）

```
スケジュール:
  - 毎月1日 深夜2:00自動実行
  - 想定増分: 500GB/月
  - 転送時間: 約3時間

処理フロー:
  1. DataSync Taskが自動起動
  2. 変更検出（チェックサム比較）
  3. 差分ファイルのみ転送
  4. S3 Event Notification → EventBridge → SQS
  5. EC2 Workersが自動起動し、メタデータ抽出
  6. RDS/OpenSearchにインデックス登録
  7. EC2 Workersが自動スケールイン（0インスタンスに）
```

### ファイル転送の詳細プロセス

```
┌─────────────────────────────────────────────────────────────────────┐
│ Step 1: DataSync Taskが起動（手動 or スケジュール）                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 2: Source Location（NAS）のファイルリストを取得                      │
│                                                                       │
│   - ファイル名                                                          │
│   - ファイルサイズ                                                       │
│   - 最終更新日時                                                        │
│   - チェックサム（MD5/SHA256）                                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 3: Destination Location（S3）の既存ファイルと比較                    │
│                                                                       │
│   - 新規ファイル → 転送対象                                               │
│   - 更新ファイル（チェックサム変更） → 転送対象                              │
│   - 未変更ファイル → スキップ                                             │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 4: 並列転送実行（最大8並列 - Agentスペックに依存）                     │
│                                                                       │
│   [Thread 1] file001.pdf (10MB) ───────────▶ S3                     │
│   [Thread 2] file002.docx (2MB) ──────────▶ S3                      │
│   [Thread 3] file003.jpg (5MB) ───────────▶ S3                      │
│   [Thread 4] file004.xlsx (15MB) ─────────▶ S3                      │
│   [Thread 5] file005.sfc (100MB) ─────────▶ S3                      │
│   [Thread 6] file006.pdf (20MB) ──────────▶ S3                      │
│   [Thread 7] file007.png (8MB) ───────────▶ S3                      │
│   [Thread 8] file008.txt (1KB) ───────────▶ S3                      │
│                                                                       │
│   転送中:                                                              │
│     - TLS 1.3暗号化                                                   │
│     - データ圧縮（約30-50%削減）                                          │
│     - チェックサム検証                                                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 5: S3にファイル保存 + メタデータ保持                                  │
│                                                                       │
│   S3オブジェクト:                                                       │
│     - Key: documents/report.pdf                                      │
│     - Storage Class: INTELLIGENT_TIERING                             │
│     - Metadata:                                                      │
│         x-amz-meta-mtime: 2025-01-15T10:30:00Z (元の更新日時)          │
│         x-amz-meta-uid: 1001 (POSIX User ID)                         │
│         x-amz-meta-gid: 1001 (POSIX Group ID)                        │
│         x-amz-meta-permissions: 0644                                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 6: S3 Event Notification発火                                    │
│                                                                       │
│   Event:                                                             │
│     {                                                                │
│       "eventName": "ObjectCreated:Put",                              │
│       "s3": {                                                        │
│         "bucket": { "name": "cis-filesearch-landing" },              │
│         "object": {                                                  │
│           "key": "documents/report.pdf",                             │
│           "size": 1048576,                                           │
│           "eTag": "abc123..."                                        │
│         }                                                            │
│       }                                                              │
│     }                                                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 7: EventBridge → SQS → EC2 Workers処理                          │
│                                                                       │
│   処理内容（Pythonスクリプト）:                                           │
│     1. S3からファイルダウンロード                                          │
│     2. ファイル形式判定（拡張子 + MIME Type）                              │
│     3. メタデータ抽出:                                                   │
│          - PDFならpdf-parseでテキスト抽出                                │
│          - 画像ならEXIF情報抽出                                           │
│          - SFCなら専用パーサーで図面情報抽出                               │
│     4. RDS/OpenSearchに保存                                            │
│     5. SQSメッセージ削除                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 導入メリット

### 技術的メリット

| メリット | 詳細 | CISプロジェクトへの影響 |
|---------|------|---------------------|
| **高速転送** | 並列処理により最大10Gbps | 10TBを2日以内に転送可能 |
| **自動スケジューリング** | Cron式で柔軟なスケジュール設定 | 月次自動実行で運用負荷ゼロ |
| **データ整合性** | 転送前後でチェックサム検証 | データ破損リスク回避 |
| **増分転送** | 変更されたファイルのみ転送 | 帯域幅とコストを95%削減 |
| **メタデータ保持** | タイムスタンプ、権限情報維持 | 検索インデックスの精度向上 |
| **CloudWatch統合** | 転送状況をリアルタイム監視 | 障害検知とアラート通知 |

### ビジネスメリット

```
運用コスト削減:
  - 手動転送作業不要（月8時間削減 → 年間96時間）
  - エラー対応の自動化（月2時間削減 → 年間24時間）
  → 年間120時間の人的コスト削減（約60万円/年）

安定性向上:
  - 転送失敗時の自動リトライ
  - エラー通知による迅速な対応
  → ダウンタイム削減

スケーラビリティ:
  - NAS台数増加時も同じ手順で追加可能
  - データ量増加に自動対応
  → 将来的な拡張が容易
```

---

## 制約事項と考慮点

### 技術的制約

| 項目 | 制約内容 | 対処法 |
|------|---------|--------|
| **最大ファイル数** | 1タスクあたり5,000万ファイル | CISは500万なので問題なし |
| **最大ファイルサイズ** | 5TB/ファイル | CISは最大1GB/ファイルなので問題なし |
| **同時実行タスク数** | 同一Agentで1タスクのみ | 月次実行のため影響なし |
| **帯域幅制限** | 設定可能（推奨: 業務時間は100Mbps） | 深夜帯は無制限で高速転送 |

### セキュリティ考慮事項

```
認証情報の管理:
  ✅ AWS Secrets Managerにパスワード保存
  ❌ .envファイルや設定ファイルへの平文保存は禁止

ネットワークセキュリティ:
  ✅ TLS 1.3による暗号化通信
  ✅ DataSync Agent VMのファイアウォール設定
  ❌ 古いTLS 1.0/1.1は無効化

アクセス制御:
  ✅ IAM RoleによるS3アクセス制限
  ✅ S3バケットポリシーでDataSyncのみ許可
  ❌ パブリックアクセスは完全ブロック
```

### 運用考慮事項

```
スケジュール設定:
  - 業務時間帯を避ける（深夜2:00実行推奨）
  - 月末月初は避ける（経理処理と重複回避）
  - 連休前の実行は避ける（障害時の対応困難）

監視とアラート:
  - DataSync Task失敗時にメール通知
  - 転送時間が6時間超過時にアラート
  - S3容量が予想より大幅増加時に通知

バックアップ:
  - S3バージョニング有効化（誤削除対策）
  - 月次でS3→Glacier Deep Archiveへバックアップ
```

---

## コスト概算

### 初回フルコピー（Week 3実施）

```
データ量: 10TB
転送時間: 45時間（金曜18:00 → 日曜15:00）

DataSync料金:
  - データ転送: $0.0125/GB × 10,240GB = $128
  - ※ 初回フルコピーのみ課金

S3ストレージ料金（初月）:
  - Standard: $0.025/GB/月 × 10,240GB = $256/月

EC2処理費用（Spot Instances）:
  - t3.medium (2vCPU, 4GB) × 10台 × 45時間
  - Spotインスタンス価格: $0.0104/時間
  - 合計: 10台 × 45時間 × $0.0104 = $4.68

初回合計: $388.68
```

### 月次差分同期（運用フェーズ）

```
月次増分: 500GB
転送時間: 3時間

DataSync料金:
  - データ転送: $0.0125/GB × 512GB = $6.40/月

S3追加ストレージ:
  - Intelligent-Tiering: $0.0125/GB/月（平均） × 512GB = $6.40/月

EC2処理費用:
  - t3.medium × 4台 × 3時間 × $0.0104 = $0.12/月

月次合計: $12.92/月
年間合計: $155.04/年
```

### 年間総コスト見積もり

| 項目 | 初年度 | 2年目以降 |
|------|--------|---------|
| DataSync初回転送 | $128 | $0 |
| DataSync月次転送 | $76.80 (12ヶ月) | $76.80 |
| S3ストレージ | $256 + $76.80 = $332.80 | $400（累積） |
| EC2処理 | $56.16 (12ヶ月) | $56.16 |
| **合計** | **$593.76** | **$532.96** |

**コスト削減ポイント**:
- Intelligent-Tiering採用で年間$150削減
- Spot Instances採用で年間$200削減（On-Demand比）
- 増分転送で帯域幅コスト95%削減

---

## 次のステップ

このドキュメントでDataSyncの概要を理解したら、以下の順序で実装を進めてください:

```
Week 2 前半:
  ✅ 01-iam-roles-setup-guide.md → IAMロール作成
  ✅ 02-s3-bucket-setup-guide.md → S3バケット作成
  ✅ 03-cloudwatch-logs-setup-guide.md → ログ設定

Week 2 後半:
  ⏳ 04-datasync-agent-installation-guide.md → Agent VM構築
  ⏳ 05-datasync-location-configuration-guide.md → Location設定
  ⏳ 06-datasync-task-configuration-guide.md → Task設定

Week 3:
  ⏳ 07-datasync-initial-sync-execution-guide.md → 初回同期実行
  ⏳ 08-datasync-monitoring-troubleshooting-guide.md → 監視とトラブルシューティング
```

---

## 参考資料

### AWS公式ドキュメント

- [AWS DataSync User Guide](https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html)
- [DataSync Pricing](https://aws.amazon.com/datasync/pricing/)
- [DataSync Best Practices](https://docs.aws.amazon.com/datasync/latest/userguide/best-practices.html)
- [DataSync Performance](https://docs.aws.amazon.com/datasync/latest/userguide/performance.html)

### ブログ記事

- [Migrating millions of files to Amazon S3 with AWS DataSync](https://aws.amazon.com/blogs/storage/migrating-millions-of-files-to-amazon-s3-with-aws-datasync/)
- [Accelerating file transfers with AWS DataSync](https://aws.amazon.com/blogs/storage/accelerating-file-transfers-with-aws-datasync/)

---

## 完了確認

- [ ] DataSyncの概要を理解した
- [ ] CISプロジェクトにおける役割を把握した
- [ ] アーキテクチャ全体像を確認した
- [ ] データフローを理解した
- [ ] コスト概算を確認した
- [ ] 次のステップを確認した

**次のガイド**: [04-datasync-agent-installation-guide.md](./04-datasync-agent-installation-guide.md) - DataSync Agent VM構築
