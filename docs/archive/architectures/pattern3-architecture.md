# Pattern 3: 月次バッチ同期アーキテクチャ（NAS-AWS ハイブリッド）

## システム概要

Pattern 3は、過去データのみを検索対象とするコスト最適化アーキテクチャです。
ファイル実体はオンプレミスNASに保持し、メタデータと抽出テキストのみをAWSで管理します。

**主要な特徴:**
- 🔄 月1回の増分同期（VPN接続は月4時間のみ）
- 💰 月額コスト $47.74（Pattern 2比96%削減）
- 🔒 HTTPS暗号化（ACM証明書無料、Route53 $0.50/月）
- 🔍 全文検索（kuromoji）+ 画像類似検索（k-NN）対応
- 📦 100万ファイル対応
- ⚡ ARM64 (Graviton2) 全Lambda最適化

---

## アーキテクチャ図

### 全体構成図

```mermaid
graph TB
    subgraph "オンプレミス環境"
        NAS[("🗄️ NAS (500GB)<br/>SMB/NFS<br/>1,000,000 files")]
        VPNRouter["🔒 VPN Router<br/>Customer Gateway"]
        DataSyncAgent["📡 DataSync Agent<br/>増分検出"]

        NAS --> DataSyncAgent
        DataSyncAgent --> VPNRouter
    end

    subgraph "AWS Cloud (ap-northeast-1)"
        subgraph "VPC: 10.0.0.0/16"
            IGW["🌍 Internet Gateway"]
            VPG["🌐 Virtual Private Gateway<br/>Site-to-Site VPN<br/>⏰ 月4時間のみ接続"]

            subgraph "Public Subnet: 10.0.0.0/24 (AZ-a)"
                NAT["🔀 NAT Gateway<br/>Elastic IP"]
            end

            subgraph "Private Subnet 1: 10.0.1.0/24 (AZ-a)"
                subgraph "バッチ処理層 (Lambda - AZ-a)"
                    VPNMgr["λ VPNManager<br/>512MB, ARM64"]
                    FileScanner["λ FileScanner<br/>1024MB, ARM64"]
                    TextExt["λ TextExtractor<br/>2048MB, ARM64<br/>5,000実行/月"]
                    ImgExt["λ ImageExtractor<br/>2048MB, ARM64<br/>2,000実行/月"]
                    BulkIdx["λ BulkIndexer<br/>1024MB, ARM64"]
                end

                OpenSearch["🔍 OpenSearch<br/>t3.small.search<br/>50GB gp3<br/>kuromoji + k-NN"]
            end

            subgraph "Private Subnet 2: 10.0.2.0/24 (AZ-b)"
                SearchAPI["λ SearchAPI<br/>512MB, ARM64<br/>10,000実行/月"]
            end

            IGW --> NAT
            NAT -.->|"インターネット<br/>アクセス"| VPNMgr
            NAT -.->|"インターネット<br/>アクセス"| FileScanner
            NAT -.->|"インターネット<br/>アクセス"| SearchAPI
        end

        subgraph "マネージドサービス層（VPC外）"
            DataSync["📦 AWS DataSync<br/>増分同期 20GB/月<br/>転送レート: 100Mbps"]
            S3["🪣 S3 Intelligent-Tiering<br/>100GB<br/>- 抽出テキスト: 40GB<br/>- 画像特徴量: 10GB<br/>- サムネイル: 30GB<br/>- ログ: 20GB"]
            DynamoDB["🗂️ DynamoDB<br/>file_metadata: 5GB<br/>sync_jobs: 100MB<br/>On-Demand"]
        end

        subgraph "オーケストレーション層"
            StepFunc["⚙️ Step Functions<br/>MonthlyBatchWorkflow"]
            EventBridge["⏰ EventBridge<br/>cron(0 2 1 * ? *)<br/>月1日 深夜2時"]
            SNS["📧 SNS<br/>バッチ完了通知"]
        end

        subgraph "監視層"
            CloudWatch["📊 CloudWatch<br/>Logs: 2GB/月<br/>Metrics: 10個<br/>Alarms: 5個"]
        end

        VPNRouter -.->|"月4時間のみ"| VPG
        VPG --> DataSync
        DataSync --> S3

        EventBridge -->|"月1回トリガー"| StepFunc
        StepFunc --> VPNMgr
        VPNMgr -->|"1. VPN接続"| VPG
        VPNMgr -.->|"2. DataSync起動"| DataSync
        DataSync -->|"3. 同期完了"| FileScanner
        FileScanner --> S3
        FileScanner -->|"4. 並列処理開始"| TextExt
        FileScanner -->|"4. 並列処理開始"| ImgExt
        TextExt --> S3
        ImgExt --> S3
        TextExt -->|"5. 完了"| BulkIdx
        ImgExt -->|"5. 完了"| BulkIdx
        BulkIdx --> OpenSearch
        BulkIdx --> DynamoDB
        BulkIdx -->|"6. VPN切断"| VPNMgr
        VPNMgr -->|"7. 通知"| SNS

        SearchAPI --> OpenSearch
        SearchAPI --> DynamoDB
        SearchAPI --> S3

        VPNMgr -.-> CloudWatch
        FileScanner -.-> CloudWatch
        TextExt -.-> CloudWatch
        ImgExt -.-> CloudWatch
        BulkIdx -.-> CloudWatch
        SearchAPI -.-> CloudWatch
    end

    subgraph "DNS層"
        Route53["🌐 Route53<br/>filesearch.company.com<br/>$0.50/月"]
    end

    subgraph "ユーザー層"
        User["👤 ユーザー (50名)<br/>Azure AD SSO"]
        NextJS["⚛️ Next.js Frontend<br/>ECS Fargate"]
    end

    subgraph "API Gateway層"
        APIGateway["🔐 API Gateway<br/>Custom Domain<br/>ACM証明書 (無料)<br/>HTTPS (TLS 1.3)<br/>IPアドレス制限"]
    end

    User -->|"HTTPS"| NextJS
    NextJS -->|"HTTPS"| Route53
    Route53 --> APIGateway
    APIGateway --> SearchAPI

    style NAS fill:#e1f5ff
    style S3 fill:#ff9800
    style OpenSearch fill:#4caf50
    style DynamoDB fill:#2196f3
    style VPNMgr fill:#9c27b0
    style FileScanner fill:#9c27b0
    style TextExt fill:#9c27b0
    style ImgExt fill:#9c27b0
    style BulkIdx fill:#9c27b0
    style SearchAPI fill:#9c27b0
    style EventBridge fill:#ff5722
    style StepFunc fill:#ff5722
    style CloudWatch fill:#00bcd4
    style NAT fill:#ffd54f
    style IGW fill:#81c784
    style Route53 fill:#f06292
    style APIGateway fill:#ba68c8
```

---

## 月次バッチ同期フロー詳細

```mermaid
sequenceDiagram
    participant EB as EventBridge<br/>(cron trigger)
    participant SF as Step Functions<br/>(MonthlyBatchWorkflow)
    participant VM as VPNManager<br/>Lambda
    participant VPN as Site-to-Site VPN
    participant DS as DataSync
    participant NAS as NAS (On-Premise)
    participant S3 as S3 Bucket
    participant FS as FileScanner<br/>Lambda
    participant TE as TextExtractor<br/>Lambda (5,000)
    participant IE as ImageExtractor<br/>Lambda (2,000)
    participant BI as BulkIndexer<br/>Lambda
    participant OS as OpenSearch
    participant DB as DynamoDB
    participant SNS as SNS

    Note over EB: 毎月1日 深夜2時
    EB->>SF: Workflow起動
    SF->>VM: VPN接続要求
    VM->>VPN: VPN接続確立
    VPN-->>VM: 接続完了
    VM->>SF: VPN接続完了通知

    Note over SF,DS: VPN接続時間: 約4時間
    SF->>DS: DataSync Task実行
    DS->>NAS: 増分ファイルスキャン
    NAS-->>DS: 変更ファイルリスト (20GB)
    DS->>S3: 増分データ転送 (3時間)
    S3-->>DS: 転送完了
    DS->>SF: DataSync完了通知

    SF->>VM: VPN切断要求
    VM->>VPN: VPN切断
    VPN-->>VM: 切断完了

    Note over SF,FS: VPN切断後の処理開始
    SF->>FS: S3スキャン開始
    FS->>S3: 新規/更新ファイルリスト取得
    S3-->>FS: ファイルメタデータ

    par 並列処理: テキスト抽出
        FS->>TE: PDF/Docuworks処理 (5,000ファイル)
        loop 各ファイル
            TE->>S3: ファイル取得
            S3-->>TE: PDFデータ
            TE->>TE: テキスト抽出 (pdf-parse)
            TE->>S3: 抽出テキスト保存
        end
        TE->>FS: テキスト抽出完了
    and 並列処理: 画像特徴量抽出
        FS->>IE: 画像処理 (2,000ファイル)
        loop 各画像
            IE->>S3: 画像取得
            S3-->>IE: 画像データ
            IE->>IE: ResNet-50特徴量抽出 (512次元)
            IE->>S3: 特徴ベクトル保存
        end
        IE->>FS: 画像処理完了
    end

    FS->>BI: 一括インデックス開始
    BI->>S3: 全メタデータ・テキスト取得
    S3-->>BI: データ
    BI->>OS: Bulk API (kuromoji + k-NN)
    OS-->>BI: インデックス完了
    BI->>DB: メタデータ更新
    DB-->>BI: 更新完了
    BI->>SF: 全処理完了

    SF->>SNS: 完了通知送信
    SNS-->>SNS: メール送信 (管理者5名)

    Note over EB,SNS: 処理時間合計: 約5-6時間<br/>VPN接続時間: 4時間<br/>Lambda処理: 1-2時間
```

---

## ユーザー検索フロー

```mermaid
sequenceDiagram
    participant User as 👤 ユーザー
    participant FE as Next.js Frontend
    participant API as SearchAPI<br/>Lambda
    participant OS as OpenSearch<br/>(kuromoji + k-NN)
    participant DB as DynamoDB<br/>(file_metadata)
    participant S3 as S3<br/>(extracted text)

    User->>FE: 検索クエリ入力<br/>("プロジェクト 提案書")
    FE->>API: POST /api/search<br/>{query: "プロジェクト 提案書"}

    alt 全文検索（テキスト）
        API->>OS: 全文検索クエリ<br/>(kuromoji tokenizer)
        OS->>OS: 形態素解析<br/>("プロジェクト" + "提案書")
        OS-->>API: 検索結果 (100件)
    else 画像類似検索
        API->>OS: k-NN検索<br/>(512次元ベクトル)
        OS->>OS: Cosine Similarity<br/>(HNSW algorithm)
        OS-->>API: 類似画像 (50件)
    end

    API->>DB: メタデータ取得<br/>(file_path, size, date)
    DB-->>API: ファイル詳細情報

    API->>S3: 抽出テキスト取得<br/>(ハイライト用)
    S3-->>API: テキストスニペット

    API->>API: 結果整形・ランキング
    API-->>FE: JSON Response<br/>{results: [...], total: 100}
    FE->>FE: UIレンダリング
    FE-->>User: 検索結果表示<br/>(レスポンス: 100-200ms)

    Note over User,S3: 検索対象: 過去データのみ<br/>最新同期: 月1日<br/>データ鮮度: 最大1ヶ月遅延
```

---

## OpenSearch インデックス構造

```mermaid
classDiagram
    class FilesIndex {
        +String file_path [kuromoji]
        +String file_name [kuromoji]
        +Text file_content [kuromoji]
        +Long file_size
        +Date modified_date
        +Keyword file_type
        +knn_vector image_vector[512]
        +String department
        +String owner
        +analyzers: kuromoji
        +k-NN: HNSW (ef=512, m=16)
    }

    class KuromojiPlugin {
        +tokenizer: kuromoji_tokenizer
        +char_filter: kuromoji_iteration_mark
        +token_filter: kuromoji_baseform
        +token_filter: kuromoji_part_of_speech
        +token_filter: kuromoji_readingform
        +token_filter: kuromoji_stemmer
        +stopwords: JA_STOP
    }

    class kNNPlugin {
        +space_type: cosinesimil
        +engine: nmslib
        +method: hnsw
        +ef_construction: 512
        +m: 16
        +dimension: 512
        +model: ResNet-50
    }

    FilesIndex --> KuromojiPlugin : uses
    FilesIndex --> kNNPlugin : uses
```

---

## コスト構成円グラフ（構成比）

```mermaid
pie title Pattern 3 月額コスト構成比 ($47.74/月)
    "OpenSearch (Instance)" : 52.0
    "OpenSearch (Storage)" : 14.2
    "DataSync" : 10.5
    "CloudWatch" : 8.4
    "S3 Storage" : 4.6
    "DynamoDB" : 2.6
    "VPN (4h/月)" : 2.5
    "Lambda" : 2.8
    "Route53" : 1.0
    "その他" : 1.4
```

---

## Step Functions ワークフロー図

```mermaid
stateDiagram-v2
    [*] --> VPNConnect: EventBridge Trigger<br/>(月1回)
    VPNConnect --> CheckVPN: VPNManager Lambda
    CheckVPN --> DataSyncTask: VPN接続成功
    CheckVPN --> NotifyFailure: VPN接続失敗

    DataSyncTask --> WaitSync: DataSync実行
    WaitSync --> CheckSync: 同期完了待機 (3時間)
    CheckSync --> VPNDisconnect: 同期成功
    CheckSync --> NotifyFailure: 同期失敗

    VPNDisconnect --> FileScan: VPN切断
    FileScan --> ParallelProcess: FileScanner Lambda

    state ParallelProcess {
        [*] --> TextExtraction
        [*] --> ImageExtraction

        state TextExtraction {
            [*] --> ProcessPDF: 5,000 PDFs
            ProcessPDF --> ExtractText: pdf-parse
            ExtractText --> SaveText: S3保存
            SaveText --> [*]
        }

        state ImageExtraction {
            [*] --> ProcessImage: 2,000 Images
            ProcessImage --> ExtractFeature: ResNet-50
            ExtractFeature --> SaveVector: S3保存
            SaveVector --> [*]
        }

        TextExtraction --> [*]
        ImageExtraction --> [*]
    }

    ParallelProcess --> BulkIndexing: 並列処理完了
    BulkIndexing --> IndexToOpenSearch: BulkIndexer Lambda
    IndexToOpenSearch --> UpdateDynamoDB: OpenSearch Bulk API
    UpdateDynamoDB --> NotifySuccess: DynamoDB更新

    NotifySuccess --> [*]: SNS通知 (成功)
    NotifyFailure --> [*]: SNS通知 (失敗)

    note right of VPNConnect
        VPN接続時間: 4時間
        - DataSync: 3時間
        - バッファ: 1時間
    end note

    note right of ParallelProcess
        Lambda並列実行:
        - TextExtractor: 最大100並列
        - ImageExtractor: 最大50並列
        処理時間: 約1-2時間
    end note

    note right of BulkIndexing
        OpenSearch Bulk API:
        - バッチサイズ: 1,000ドキュメント
        - kuromoji + k-NN同時登録
        処理時間: 約30分
    end note
```

---

## 主要コスト削減施策

```mermaid
graph LR
    A[通常構成<br/>$1,105.50/月] --> B{コスト削減施策}

    B --> C1[VPN間欠接続<br/>730h → 4h]
    B --> C2[DataSync増分同期<br/>100GB → 20GB]
    B --> C3[Lambda ARM64<br/>x86 → Graviton2]
    B --> C4[S3 Intelligent-Tiering<br/>自動階層化]
    B --> C5[Single-AZ構成<br/>Multi-AZ → Single]
    B --> C6[バッチ処理化<br/>リアルタイム → 月次]

    C1 --> D1[-97%<br/>$34.80削減]
    C2 --> D2[-75%<br/>$15.00削減]
    C3 --> D3[-20%<br/>$0.27削減]
    C4 --> D4[-36%<br/>$1.20削減]
    C5 --> D5[-50%<br/>$450削減]
    C6 --> D6[-93%<br/>$13.94削減]

    D1 --> E[Pattern 3<br/>$47.24/月]
    D2 --> E
    D3 --> E
    D4 --> E
    D5 --> E
    D6 --> E

    E --> F[削減率<br/>96%]

    style A fill:#ffcdd2
    style B fill:#fff9c4
    style E fill:#c8e6c9
    style F fill:#4caf50,color:#fff
```

---

## 技術スタック

### Lambda Runtime
- **Architecture**: ARM64 (Graviton2)
- **Runtime**: Node.js 20.x / Python 3.11
- **Cost Benefit**: 20%削減 + 高性能

### OpenSearch Plugins
1. **analysis-kuromoji**
   - 日本語形態素解析
   - 辞書: mecab-ipadic
   - トークナイザー: kuromoji_tokenizer

2. **k-NN plugin**
   - Algorithm: HNSW (Hierarchical Navigable Small World)
   - Distance: Cosine Similarity
   - Vector Dimension: 512
   - Index Parameters: ef_construction=512, m=16

### ML Model
- **画像特徴抽出**: ResNet-50 (PyTorch)
- **テキスト抽出**: pdf-parse, pdfplumber

---

## スケーリングシナリオ

| ユーザー数 | ファイル数 | OpenSearch | Lambda | 月額コスト | 増加率 |
|----------|----------|-----------|--------|----------|-------|
| 50 | 1,000,000 | t3.small | 512-2048MB | $47.24 | - |
| 100 | 1,000,000 | t3.small | 512-2048MB | $48.29 | +2% |
| 200 | 2,000,000 | t3.medium | 1024-2048MB | $73.70 | +56% |
| 500 | 5,000,000 | r6g.large | 2048-3008MB | $123.17 | +161% |

---

## 運用考慮事項

### バッチ実行タイミング
- **推奨**: 毎月1日 深夜2時（業務時間外）
- **VPN接続時間**: 4時間（2:00-6:00）
- **Lambda処理**: VPN切断後1-2時間

### 監視項目
1. VPN接続成功率
2. DataSync転送完了時間
3. Lambda並列実行数
4. OpenSearchインデックス成功率
5. 検索レスポンスタイム

### アラート設定
1. バッチ失敗 → SNS即時通知
2. VPN接続失敗 → 再試行 + 通知
3. OpenSearchディスク使用率 > 80%
4. 検索エラー率 > 5%

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 |
|-----|------|---------|
| 1.0 | 2025-01-18 | Pattern 3アーキテクチャ図初版作成 |
