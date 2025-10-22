# Pattern 3 アーキテクチャ図 - draw.io 作成ガイド

## 目次

1. [AWS公式アイコンライブラリの追加方法](#1-aws公式アイコンライブラリの追加方法)
2. [レイアウト設計](#2-レイアウト設計)
3. [コンポーネント配置リスト](#3-コンポーネント配置リスト)
4. [接続線（矢印）の定義](#4-接続線矢印の定義)
5. [スタイリングガイド](#5-スタイリングガイド)
6. [レイヤー構成](#6-レイヤー構成)

---

## 1. AWS公式アイコンライブラリの追加方法

### 方法A: draw.io組み込みライブラリを使用（推奨）

1. draw.ioを開く: https://app.diagrams.net/
2. 左サイドバーの下部にある「**More Shapes...**」をクリック
3. 検索ボックスに「**AWS**」と入力
4. 以下のライブラリにチェックを入れる:
   - ✅ **AWS Architecture Icons** (メインライブラリ)
   - ✅ **AWS 19** (最新版アイコンセット)
5. 「**Apply**」をクリック
6. 左サイドバーに「AWS」カテゴリが追加される

### 方法B: AWS公式アイコンセットを直接インポート

1. AWS公式アイコンダウンロード: https://aws.amazon.com/jp/architecture/icons/
2. 「Asset Package」をダウンロード（無料、登録不要）
3. ZIPを解凍して`/Architecture-Service-Icons_<日付>/SVG/`フォルダを開く
4. draw.ioで「**File → Import from → Device**」
5. 必要なSVGアイコンを個別にインポート

### 使用するAWSアイコンのリスト

以下のアイコンを使用します（すべてAWS Architecture Iconsライブラリから利用可能）:

| カテゴリ | アイコン名 | 用途 |
|---------|----------|------|
| **Networking & Content Delivery** | Site-to-Site VPN | VPN接続 |
| **Networking & Content Delivery** | Customer Gateway | オンプレミスVPNルーター |
| **Networking & Content Delivery** | Virtual Private Gateway | AWS側VPNゲートウェイ |
| **Networking & Content Delivery** | VPC | 仮想プライベートクラウド |
| **Migration & Transfer** | AWS DataSync | データ同期サービス |
| **Migration & Transfer** | DataSync Agent | オンプレミス側エージェント |
| **Storage** | Amazon S3 | オブジェクトストレージ |
| **Compute** | AWS Lambda | サーバーレス関数 |
| **Analytics** | Amazon OpenSearch Service | 検索エンジン |
| **Database** | Amazon DynamoDB | NoSQLデータベース |
| **Application Integration** | AWS Step Functions | ワークフローオーケストレーション |
| **Application Integration** | Amazon EventBridge | イベントスケジューラー |
| **Application Integration** | Amazon SNS | 通知サービス |
| **Management & Governance** | Amazon CloudWatch | 監視・ログ管理 |
| **Compute** | Elastic Container Service | Fargateコンテナ（Next.js用） |
| **General** | User | ユーザーアイコン |
| **General** | Internet Gateway | インターネット接続 |
| **General** | Traditional Server | NASサーバー（オンプレミス） |

---

## 2. レイアウト設計

### 全体配置構成

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CIS File Search - Pattern 3 Architecture              │
│                      月次バッチ同期アーキテクチャ（NAS-AWS ハイブリッド）         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────┐           ┌─────────────────────────────────────┐│
│  │ オンプレミス環境         │           │  AWS Cloud (ap-northeast-1)        ││
│  │ (グレー背景)            │  VPN接続  │  (オレンジVPC背景)                  ││
│  │                        │  ........>│                                    ││
│  │  ┌───────────┐        │           │  ┌──────────────────────────────┐ ││
│  │  │    NAS    │        │           │  │  ネットワーク層                │ ││
│  │  │  500GB    │        │           │  │  - Virtual Private Gateway   │ ││
│  │  └─────┬─────┘        │           │  │  - Site-to-Site VPN          │ ││
│  │        │               │           │  └──────────────────────────────┘ ││
│  │  ┌─────▼────────┐     │           │                                    ││
│  │  │ DataSync     │     │           │  ┌──────────────────────────────┐ ││
│  │  │ Agent        │     │           │  │  データ転送層                  │ ││
│  │  └─────┬────────┘     │           │  │  - AWS DataSync              │ ││
│  │        │               │           │  └──────────┬───────────────────┘ ││
│  │  ┌─────▼────────┐     │           │             │                     ││
│  │  │ VPN Router   │......................>        │                     ││
│  │  │ (Customer GW)│     │           │             │                     ││
│  │  └──────────────┘     │           │  ┌──────────▼───────────────────┐ ││
│  │                        │           │  │  ストレージ層                  │ ││
│  └────────────────────────┘           │  │  - S3 Intelligent-Tiering    │ ││
│                                        │  │    100GB (テキスト+画像)      │ ││
│  ┌───────────────────────┐            │  └──────────┬───────────────────┘ ││
│  │ ユーザー層              │            │             │                     ││
│  │                        │            │  ┌──────────▼───────────────────┐ ││
│  │  👤 → Next.js ────────────────────────→│  API層                        │ ││
│  │                        │            │  │  - SearchAPI Lambda (512MB)  │ ││
│  └────────────────────────┘            │  └──────┬───────────────────────┘ ││
│                                         │         │                         ││
│                                         │  ┌──────▼───────────────────────┐││
│                                         │  │  検索エンジン層                ││
│                                         │  │  - OpenSearch t3.small        ││
│                                         │  │  - kuromoji + k-NN           ││
│                                         │  └──────────────────────────────┘││
│                                         │                                   ││
│                                         │  ┌──────────────────────────────┐││
│                                         │  │  バッチ処理層                  ││
│                                         │  │  - Step Functions            ││
│                                         │  │  - Lambda × 5                ││
│                                         │  │    (VPNMgr, Scanner, Text,   ││
│                                         │  │     Image, BulkIndexer)      ││
│                                         │  └──────────────────────────────┘││
│                                         │                                   ││
│                                         │  ┌──────────────────────────────┐││
│                                         │  │  オーケストレーション層         ││
│                                         │  │  - EventBridge (月1回)        ││
│                                         │  │  - SNS (通知)                 ││
│                                         │  └──────────────────────────────┘││
│                                         │                                   ││
│                                         │  ┌──────────────────────────────┐││
│                                         │  │  監視層                        ││
│                                         │  │  - CloudWatch Logs/Metrics   ││
│                                         │  └──────────────────────────────┘││
│                                         └───────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

### レイアウト寸法推奨値（draw.io単位: px）

- **キャンバスサイズ**: 2000px × 1600px（A3横向き相当）
- **オンプレミス背景**: 400px × 800px（左側）
- **AWS VPC背景**: 1400px × 1400px（右側）
- **アイコンサイズ**: 60px × 60px（統一）
- **Lambda関数**: 80px × 80px（やや大きめ）
- **テキストサイズ**: タイトル 14pt、ラベル 10pt、注釈 8pt

---

## 3. コンポーネント配置リスト

### オンプレミス環境（左側、グレー背景 #F5F5F5）

#### 背景グループ
```
タイプ: Rectangle
位置: X=50, Y=150
サイズ: W=400, H=800
塗り: #F5F5F5
枠線: #CCCCCC, 2px
ラベル: "オンプレミス環境\nOn-Premise Infrastructure"
フォント: Arial 16pt Bold
```

#### NAS Server
```
アイコン: Traditional Server（または Storage/EBS）
位置: X=150, Y=220
サイズ: 100px × 100px
ラベル:
  "🗄️ NAS Server
  SMB/NFS共有
  容量: 500GB
  ファイル数: 1,000,000
  IP: 192.168.1.100"
フォント: Arial 10pt
背景色: #E3F2FD
```

#### DataSync Agent
```
アイコン: AWS DataSync Agent
位置: X=150, Y=380
サイズ: 80px × 80px
ラベル:
  "📡 DataSync Agent
  増分検出エージェント
  version: 1.0.52"
フォント: Arial 10pt
背景色: #FFF3E0
```

#### VPN Router (Customer Gateway)
```
アイコン: Customer Gateway
位置: X=150, Y=540
サイズ: 80px × 80px
ラベル:
  "🔒 VPN Router
  Customer Gateway
  Cisco ASA 5506
  Public IP: xxx.xxx.xxx.xxx"
フォント: Arial 10pt
背景色: #F3E5F5
```

---

### AWS Cloud環境（右側、VPC背景 #FFF7E6）

#### VPC背景グループ
```
タイプ: Rectangle
位置: X=520, Y=150
サイズ: W=1400, H=1400
塗り: #FFF7E6（淡いオレンジ）
枠線: #FF9800, 3px
ラベル: "AWS VPC (10.0.0.0/16)\nRegion: ap-northeast-1"
フォント: Arial 18pt Bold
```

---

#### 【ネットワーク層】（VPC内上部）

##### Virtual Private Gateway
```
アイコン: Virtual Private Gateway
位置: X=600, Y=250
サイズ: 80px × 80px
ラベル:
  "🌐 Virtual Private Gateway
  Site-to-Site VPN
  ⏰ 月4時間のみ接続
  接続時間: 2:00-6:00 (月1日)"
フォント: Arial 10pt
背景色: #E8EAF6
```

---

#### 【データ転送層】（ネットワーク層の下）

##### AWS DataSync
```
アイコン: AWS DataSync
位置: X=850, Y=250
サイズ: 80px × 80px
ラベル:
  "📦 AWS DataSync
  増分同期: 20GB/月
  転送レート: 100Mbps
  転送時間: 約3時間
  フィルター: 変更ファイルのみ"
フォント: Arial 10pt
背景色: #E0F2F1
```

---

#### 【ストレージ層】（データ転送層の右）

##### S3 Bucket
```
アイコン: Amazon S3
位置: X=1150, Y=250
サイズ: 100px × 100px
ラベル:
  "🪣 S3 Bucket
  cis-filesearch-metadata
  Intelligent-Tiering

  容量内訳:
  - 抽出テキスト: 40GB
  - 画像特徴量: 10GB
  - サムネイル: 30GB
  - ログ: 20GB
  合計: 100GB"
フォント: Arial 9pt
背景色: #FF9800（S3オレンジ）
```

---

#### 【バッチ処理層】（VPC中央部、黄色背景グループ）

##### Step Functions
```
アイコン: AWS Step Functions
位置: X=700, Y=500
サイズ: 100px × 100px
ラベル:
  "⚙️ Step Functions
  MonthlyBatchSyncWorkflow

  実行頻度: 月1回
  実行時間: 5-6時間
  ステップ数: 8"
フォント: Arial 10pt
背景色: #FFF9C4
```

##### Lambda群（横並び配置、黄色背景グループ #FFFDE7 で囲む）

**グループ背景**
```
タイプ: Rectangle
位置: X=600, Y=650
サイズ: W=1200, H=250
塗り: #FFFDE7
枠線: #FBC02D, 2px, Dashed
ラベル: "Lambda Functions (ARM64 Graviton2)"
フォント: Arial 12pt Bold
```

1. **VPNManager Lambda**
```
アイコン: AWS Lambda
位置: X=650, Y=700
サイズ: 70px × 70px
ラベル:
  "λ VPNManager
  Runtime: Python 3.11
  Memory: 512MB
  ARM64

  機能:
  - VPN接続制御
  - 接続監視
  - タイムアウト管理"
フォント: Arial 9pt
背景色: #9C27B0（紫）
```

2. **FileScanner Lambda**
```
アイコン: AWS Lambda
位置: X=800, Y=700
サイズ: 70px × 70px
ラベル:
  "λ FileScanner
  Runtime: Node.js 20
  Memory: 1024MB
  ARM64

  機能:
  - S3全スキャン
  - 新規/更新検出
  - メタデータ収集"
フォント: Arial 9pt
背景色: #9C27B0
```

3. **TextExtractor Lambda**
```
アイコン: AWS Lambda
位置: X=950, Y=700
サイズ: 70px × 70px
ラベル:
  "λ TextExtractor
  Runtime: Python 3.11
  Memory: 2048MB
  ARM64

  機能:
  - PDF解析 (pdf-parse)
  - Docuworks解析
  - 月5,000実行"
フォント: Arial 9pt
背景色: #9C27B0
```

4. **ImageFeatureExtractor Lambda**
```
アイコン: AWS Lambda
位置: X=1100, Y=700
サイズ: 70px × 70px
ラベル:
  "λ ImageFeatureExtractor
  Runtime: Python 3.11
  Memory: 2048MB
  ARM64

  機能:
  - ResNet-50推論
  - 512次元特徴量
  - 月2,000実行"
フォント: Arial 9pt
背景色: #9C27B0
```

5. **BulkIndexer Lambda**
```
アイコン: AWS Lambda
位置: X=1250, Y=700
サイズ: 70px × 70px
ラベル:
  "λ BulkIndexer
  Runtime: Node.js 20
  Memory: 1024MB
  ARM64

  機能:
  - OpenSearch Bulk API
  - DynamoDB一括更新
  - エラーハンドリング"
フォント: Arial 9pt
背景色: #9C27B0
```

---

#### 【API層】（VPC右上）

##### SearchAPI Lambda
```
アイコン: AWS Lambda
位置: X=1550, Y=250
サイズ: 80px × 80px
ラベル:
  "λ SearchAPI
  Runtime: Node.js 20
  Memory: 512MB
  ARM64

  エンドポイント:
  POST /api/search

  月10,000実行"
フォント: Arial 9pt
背景色: #9C27B0
```

---

#### 【検索エンジン層】（VPC右中央）

##### Amazon OpenSearch
```
アイコン: Amazon OpenSearch Service
位置: X=1550, Y=450
サイズ: 100px × 100px
ラベル:
  "🔍 OpenSearch Service
  Instance: t3.small.search
  vCPU: 2, RAM: 2GB
  Storage: 50GB gp3

  Plugins:
  - analysis-kuromoji (日本語)
  - k-NN (画像類似検索)

  Index:
  - files_index (1M docs)

  検索方式:
  - 全文検索 (形態素解析)
  - ベクトル検索 (HNSW)"
フォント: Arial 9pt
背景色: #4CAF50（緑）
```

---

#### 【メタデータDB層】（検索エンジンの下）

##### DynamoDB
```
アイコン: Amazon DynamoDB
位置: X=1550, Y=700
サイズ: 80px × 80px
ラベル:
  "🗂️ DynamoDB
  Pricing: On-Demand

  Tables:
  - file_metadata (5GB)
  - sync_jobs (100MB)

  Read: 100 RCU/月
  Write: 50 WCU/月"
フォント: Arial 9pt
背景色: #2196F3（青）
```

---

#### 【オーケストレーション層】（VPC左下）

##### EventBridge
```
アイコン: Amazon EventBridge
位置: X=650, Y=1000
サイズ: 80px × 80px
ラベル:
  "⏰ EventBridge
  Rule: MonthlyBatchTrigger

  Cron式:
  cron(0 2 1 * ? *)

  実行日時:
  毎月1日 深夜2時 (JST)"
フォント: Arial 9pt
背景色: #FF5722（赤オレンジ）
```

##### SNS
```
アイコン: Amazon SNS
位置: X=850, Y=1000
サイズ: 80px × 80px
ラベル:
  "📧 Amazon SNS
  Topic: BatchNotifications

  Subscribers:
  - 管理者メール × 5

  通知内容:
  - バッチ成功/失敗
  - 処理時間
  - エラー詳細"
フォント: Arial 9pt
背景色: #E91E63（ピンク）
```

---

#### 【監視層】（VPC下部）

##### CloudWatch
```
アイコン: Amazon CloudWatch
位置: X=1050, Y=1000
サイズ: 80px × 80px
ラベル:
  "📊 CloudWatch

  Logs:
  - /aws/lambda/* (6ロググループ)
  - 保存期間: 30日
  - 容量: 2GB/月

  Metrics:
  - Lambda実行時間
  - VPN接続ステータス
  - OpenSearchレイテンシ

  Alarms:
  - バッチ失敗
  - VPN接続失敗
  - ディスク使用率 > 80%"
フォント: Arial 9pt
背景色: #00BCD4（シアン）
```

---

#### 【ユーザー層】（VPC外、右上）

##### User
```
アイコン: User (General Icons)
位置: X=1700, Y=50
サイズ: 60px × 60px
ラベル:
  "👤 ユーザー
  対象: 社内50名
  アクセス: Web UI
  認証: Azure AD SSO"
フォント: Arial 10pt
```

##### Next.js Frontend
```
アイコン: Elastic Container Service (Fargate)
位置: X=1500, Y=50
サイズ: 80px × 80px
ラベル:
  "⚛️ Next.js Frontend
  ECS Fargate
  vCPU: 0.25, RAM: 0.5GB

  Framework: Next.js 15
  TypeScript + Tailwind CSS

  機能:
  - 検索UI
  - フィルター/ソート
  - プレビュー"
フォント: Arial 9pt
背景色: #03A9F4
```

---

## 4. 接続線（矢印）の定義

### 月次バッチ同期フロー（青色矢印 #0066CC、太線 3px）

#### フロー1: イベントトリガー
```
From: EventBridge
To: Step Functions
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印（終点のみ）
ラベル: "① 月1回トリガー\ncron(0 2 1 * ? *)"
ラベル位置: 矢印中央
ラベルフォント: Arial 9pt Bold
ラベル背景: 白色 #FFFFFF、パディング 5px
```

#### フロー2: VPN接続開始
```
From: Step Functions
To: VPNManager Lambda
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印
ラベル: "② VPN接続開始\nInvoke Lambda"
```

#### フロー3: VPN接続確立
```
From: VPNManager Lambda
To: Virtual Private Gateway
スタイル: 点線、青色 #0066CC、太さ 2px
矢印: 双方向矢印
ラベル: "③ VPN接続確立\nIPsec Tunnel"
```

#### フロー4: VPN接続（オンプレミス側）
```
From: VPN Router (Customer Gateway)
To: Virtual Private Gateway
スタイル: 点線、青色 #0066CC、太さ 2px
矢印: 双方向矢印
ラベル: "⏰ 月4時間のみ\n2:00-6:00 (月1日)\n暗号化通信"
補足: この線を目立たせるため、点線の間隔を広く設定
```

#### フロー5: DataSync起動
```
From: VPNManager Lambda
To: AWS DataSync
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印
ラベル: "④ DataSync起動\nStartTaskExecution"
```

#### フロー6: 増分データ転送
```
From: NAS
To: DataSync Agent
To: VPN Router
To: Virtual Private Gateway
To: AWS DataSync
To: S3
スタイル: 実線、オレンジ色 #FF9900、太さ 4px
矢印: 単一矢印
ラベル: "⑤ 増分データ転送\n20GB/月\n転送時間: 約3時間\n100Mbps"
補足: この矢印は経路全体を示すため、複数のコンポーネントを経由
```

#### フロー7: VPN切断
```
From: Step Functions
To: VPNManager Lambda
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印
ラベル: "⑥ VPN切断\n同期完了後"
```

#### フロー8: S3スキャン開始
```
From: Step Functions
To: FileScanner Lambda
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印
ラベル: "⑦ S3スキャン開始\nVPN切断後"
```

#### フロー9: メタデータ取得
```
From: FileScanner Lambda
To: S3
スタイル: 実線、緑色 #00AA00、太さ 2px
矢印: 双方向矢印
ラベル: "⑧ メタデータ取得\nListObjectsV2"
```

#### フロー10: 並列処理起動（テキスト抽出）
```
From: FileScanner Lambda
To: TextExtractor Lambda
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印
ラベル: "⑨ テキスト抽出\n5,000 PDFs\n最大100並列"
```

#### フロー11: 並列処理起動（画像特徴抽出）
```
From: FileScanner Lambda
To: ImageFeatureExtractor Lambda
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印
ラベル: "⑨ 画像特徴抽出\n2,000 Images\n最大50並列"
```

#### フロー12: テキスト抽出データ保存
```
From: TextExtractor Lambda
To: S3
スタイル: 実線、緑色 #00AA00、太さ 2px
矢印: 双方向矢印
ラベル: "⑩ 抽出テキスト保存\n/extracted-text/*.json"
```

#### フロー13: 画像特徴量保存
```
From: ImageFeatureExtractor Lambda
To: S3
スタイル: 実線、緑色 #00AA00、太さ 2px
矢印: 双方向矢印
ラベル: "⑩ 特徴ベクトル保存\n/image-features/*.npy\n512次元"
```

#### フロー14: 一括インデックス開始
```
From: TextExtractor Lambda
To: BulkIndexer Lambda
From: ImageFeatureExtractor Lambda
To: BulkIndexer Lambda
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印
ラベル: "⑪ 処理完了通知"
補足: 2つのLambdaから集約される
```

#### フロー15: データ取得（一括インデックス）
```
From: BulkIndexer Lambda
To: S3
スタイル: 実線、緑色 #00AA00、太さ 2px
矢印: 単一矢印
ラベル: "⑫ 全データ取得"
```

#### フロー16: OpenSearchインデックス登録
```
From: BulkIndexer Lambda
To: OpenSearch
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印
ラベル: "⑬ Bulk API\nkuromoji + k-NN\nバッチサイズ: 1,000"
```

#### フロー17: メタデータ更新
```
From: BulkIndexer Lambda
To: DynamoDB
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印
ラベル: "⑭ メタデータ更新\nBatchWriteItem"
```

#### フロー18: 完了通知
```
From: BulkIndexer Lambda
To: Step Functions
To: SNS
スタイル: 実線、青色 #0066CC、太さ 3px
矢印: 単一矢印
ラベル: "⑮ 完了通知\n成功/失敗ステータス"
```

---

### ユーザー検索フロー（緑色矢印 #00AA00、通常線 2px）

#### 検索フロー1: ユーザーアクセス
```
From: User
To: Next.js Frontend
スタイル: 実線、緑色 #00AA00、太さ 2px
矢印: 双方向矢印
ラベル: "HTTPS\nAzure AD認証"
```

#### 検索フロー2: 検索クエリ
```
From: Next.js Frontend
To: SearchAPI Lambda
スタイル: 実線、緑色 #00AA00、太さ 2px
矢印: 双方向矢印
ラベル: "POST /api/search\n{query: '提案書'}"
```

#### 検索フロー3: OpenSearch検索
```
From: SearchAPI Lambda
To: OpenSearch
スタイル: 実線、緑色 #00AA00、太さ 2px
矢印: 双方向矢印
ラベル: "全文検索\nkuromoji tokenizer"
```

#### 検索フロー4: メタデータ取得
```
From: SearchAPI Lambda
To: DynamoDB
スタイル: 実線、緑色 #00AA00、太さ 2px
矢印: 双方向矢印
ラベル: "GetItem\nfile_metadata"
```

#### 検索フロー5: テキストスニペット取得
```
From: SearchAPI Lambda
To: S3
スタイル: 実線、緑色 #00AA00、太さ 2px
矢印: 双方向矢印
ラベル: "GetObject\nハイライト用"
```

---

### 監視ログフロー（シアン色点線 #00BCD4、細線 1px）

すべてのLambda関数からCloudWatchへの接続:

```
From: VPNManager Lambda, FileScanner Lambda, TextExtractor Lambda,
      ImageFeatureExtractor Lambda, BulkIndexer Lambda, SearchAPI Lambda
To: CloudWatch
スタイル: 点線、シアン色 #00BCD4、太さ 1px
矢印: 単一矢印
ラベル: "Logs/Metrics"
補足: すべてのLambdaから個別に引く（計6本）
```

---

## 5. スタイリングガイド

### 背景色パレット

```
オンプレミス環境背景: #F5F5F5 (ライトグレー)
AWS VPC背景: #FFF7E6 (淡いオレンジ)
Lambda群グループ背景: #FFFDE7 (淡い黄色)
```

### コンポーネント背景色（AWSサービス別）

```
Lambda関数: #9C27B0 (紫)
S3: #FF9800 (オレンジ)
OpenSearch: #4CAF50 (緑)
DynamoDB: #2196F3 (青)
Step Functions: #FFF9C4 (淡い黄色)
EventBridge: #FF5722 (赤オレンジ)
SNS: #E91E63 (ピンク)
CloudWatch: #00BCD4 (シアン)
VPN系: #E8EAF6 (淡い紫)
DataSync: #E0F2F1 (淡い青緑)
Next.js: #03A9F4 (ライトブルー)
```

### 矢印スタイル詳細

#### バッチフロー（青色）
```
色: #0066CC
太さ: 3px
スタイル: 実線 (Solid)
矢印タイプ: Classic (終点のみ)
透明度: 100%
```

#### データ転送フロー（オレンジ）
```
色: #FF9900
太さ: 4px
スタイル: 実線 (Solid)
矢印タイプ: Block (太矢印)
透明度: 90%
```

#### 検索フロー（緑色）
```
色: #00AA00
太さ: 2px
スタイル: 実線 (Solid)
矢印タイプ: Classic
透明度: 100%
```

#### VPN接続（点線、青色）
```
色: #0066CC
太さ: 2px
スタイル: Dashed (点線、間隔 5-5)
矢印タイプ: Classic、双方向
透明度: 80%
```

#### 監視ログ（点線、シアン）
```
色: #00BCD4
太さ: 1px
スタイル: Dotted (点線、間隔 2-2)
矢印タイプ: Classic
透明度: 60%
```

### テキストスタイル

#### タイトル（ダイアグラム全体）
```
フォント: Arial
サイズ: 18pt
太さ: Bold
色: #212121 (濃いグレー)
配置: 中央揃え
```

#### コンポーネント名
```
フォント: Arial
サイズ: 10pt
太さ: Bold
色: #FFFFFF (白) ※背景が濃い色の場合
色: #212121 (黒) ※背景が薄い色の場合
配置: 中央揃え
```

#### ラベル（詳細情報）
```
フォント: Arial
サイズ: 9pt
太さ: Regular
色: #424242 (グレー)
配置: 左揃え
行間: 1.3
```

#### 注釈（補足説明）
```
フォント: Arial
サイズ: 8pt
太さ: Italic
色: #757575 (ライトグレー)
配置: 左揃え
```

#### 矢印ラベル
```
フォント: Arial
サイズ: 9pt
太さ: Bold
色: #FFFFFF (白)
背景: 矢印と同色、透明度80%
パディング: 5px
角丸: 3px
```

### シャドウ効果

重要なコンポーネントにドロップシャドウを適用:

```
対象: Lambda関数、S3、OpenSearch、Step Functions
シャドウ色: #000000
透明度: 20%
オフセット: X=2px, Y=2px
ぼかし: 4px
```

### アイコンスタイル統一

```
すべてのAWSアイコン:
- サイズ: 60px × 60px（基本）
- Lambda: 70px × 70px（やや大きめ）
- 主要サービス（S3, OpenSearch, Step Functions): 100px × 100px（大）
- パディング: 各アイコン周囲に10pxの余白
- 配置: ラベルは下部、詳細情報は右側または下部
```

---

## 6. レイヤー構成

draw.ioのレイヤー機能を使用して、要素を整理します。

### レイヤー1: 背景とグループ枠
```
名前: "Background & Containers"
内容:
- キャンバス全体の背景（白）
- オンプレミス環境の背景（グレー）
- AWS VPCの背景（オレンジ）
- Lambda群のグループ枠（黄色）
- その他のグループ枠
```
**表示順序**: 最下層
**ロック**: Yes（誤操作防止）

### レイヤー2: AWSリソースアイコン
```
名前: "AWS Resources"
内容:
- すべてのAWSサービスアイコン
- オンプレミス機器アイコン
- ユーザーアイコン
- Next.jsアイコン
```
**表示順序**: 中層
**ロック**: No

### レイヤー3: 接続線（矢印）
```
名前: "Connections & Flows"
サブレイヤー:
- "Batch Flow (Blue)" - バッチ同期フロー
- "Search Flow (Green)" - 検索フロー
- "VPN Connection (Dashed)" - VPN接続
- "Monitoring (Cyan)" - 監視ログ
```
**表示順序**: 上層
**ロック**: No

### レイヤー4: ラベルと注釈
```
名前: "Labels & Annotations"
内容:
- コンポーネント名ラベル
- 矢印ラベル
- 注釈テキスト
- 凡例
- コスト情報
- タイトル
```
**表示順序**: 最上層
**ロック**: No

### レイヤーの使い方

1. **レイヤーパネルの表示**:
   - メニュー: `View → Layers`
   - または右サイドバーの「Layers」タブ

2. **レイヤーの追加**:
   - レイヤーパネル下部の「+」ボタン
   - レイヤー名を入力

3. **要素のレイヤー移動**:
   - 要素を選択
   - 右クリック → `Move to Layer` → レイヤー選択

4. **レイヤーの表示/非表示**:
   - レイヤー名の横の「目」アイコンをクリック
   - 編集時に他のレイヤーを隠すと作業しやすい

5. **レイヤーのロック**:
   - レイヤー名の横の「鍵」アイコンをクリック
   - 背景レイヤーは必ずロックして誤操作を防ぐ

---

## 追加推奨事項

### 凡例の追加

ダイアグラム右下に凡例を配置:

```
タイトル: "凡例 (Legend)"
位置: X=1700, Y=1450
サイズ: 200px × 120px

内容:
━━━ 青色実線: バッチ同期フロー
━━━ オレンジ実線: データ転送
━━━ 緑色実線: 検索フロー
- - - 青色点線: VPN接続（月4時間）
··· シアン点線: 監視ログ

背景色: #FFFFFF
枠線: #9E9E9E, 1px
フォント: Arial 8pt
```

### コスト情報の表示

ダイアグラム左下にコストサマリーを配置:

```
タイトル: "💰 月額コスト: $47.24/月"
位置: X=50, Y=1450
サイズ: 400px × 120px

内容:
OpenSearch: $31.46 (66.7%)
DataSync: $5.00 (10.6%)
CloudWatch: $4.00 (8.5%)
S3: $2.18 (4.6%)
Lambda: $1.35 (2.9%)
その他: $3.25 (6.7%)

削減率: 96% (Pattern 2比)

背景色: #E8F5E9 (淡い緑)
枠線: #4CAF50, 2px
フォント: Arial 9pt
```

### バージョン情報

ダイアグラム右上にバージョン情報を配置:

```
内容:
Version: 1.0
Created: 2025-01-18
Author: CIS Project Team
Status: Production Ready

位置: X=1700, Y=1300
フォント: Arial 7pt
色: #9E9E9E
```

---

## 作成時のチェックリスト

作成完了前に以下を確認してください:

- [ ] すべてのコンポーネントが配置されている（26個）
- [ ] 接続線が正しく接続されている（18本のフロー）
- [ ] ラベルが読みやすく配置されている
- [ ] 色使いが統一されている
- [ ] レイヤーが適切に設定されている
- [ ] 凡例が含まれている
- [ ] コスト情報が表示されている
- [ ] タイトルとバージョン情報がある
- [ ] VPN接続の点線が目立つ
- [ ] Lambda群のグループ化が明確
- [ ] オンプレミスとAWS Cloudの境界が明確
- [ ] 矢印の向きが正しい
- [ ] テキストに誤字脱字がない
- [ ] 印刷時のレイアウトが適切（A3推奨）

---

## エクスポート推奨設定

完成後のエクスポート設定:

### PNG形式
```
解像度: 300 DPI
サイズ: 2000px × 1600px
背景: 白色
品質: 最高
用途: プレゼンテーション、ドキュメント埋め込み
```

### PDF形式
```
用紙サイズ: A3 横向き
余白: 10mm
品質: 高品質印刷
用途: 印刷、公式ドキュメント
```

### SVG形式
```
テキスト: フォント埋め込み
リンク: 保持
用途: Web表示、編集可能な共有
```

---

このガイドに従って作成すれば、Pattern 3アーキテクチャの完全なdraw.io図が約30-40分で完成します!
