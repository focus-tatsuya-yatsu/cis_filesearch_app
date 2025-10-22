# CIS ファイル検索システム アーキテクチャ設計書

## 1. システム全体構成

### 1.1 アーキテクチャ概要

本システムは、マイクロサービスアーキテクチャとサーバーレス設計を組み合わせた、スケーラブルなクラウドネイティブアプリケーションです。

```
┌─────────────────────────────────────────────────────────────┐
│                         Users (50+)                          │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    CloudFront (CDN)                          │
└─────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
        ┌─────────────────────┐   ┌─────────────────────┐
        │   Next.js App       │   │   API Gateway       │
        │   (Vercel/EC2)      │   │                     │
        └─────────────────────┘   └─────────────────────┘
                                            │
                            ┌───────────────┼───────────────┐
                            ▼               ▼               ▼
                    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                    │ Lambda       │ │ Lambda       │ │ Lambda       │
                    │ (Search)     │ │ (Index)      │ │ (File Proc)  │
                    └──────────────┘ └──────────────┘ └──────────────┘
                            │               │               │
                    ┌───────┴───────┬───────┴───────┬───────┴───────┐
                    ▼               ▼               ▼               ▼
            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
            │ OpenSearch   │ │ DynamoDB     │ │ S3           │ │ RDS          │
            └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
                    ▲               ▲               ▲
                    └───────────────┴───────────────┘
                                    │
                            ┌───────▼───────┐
                            │   NAS (4台)   │
                            └───────────────┘
```

### 1.2 レイヤーアーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│         Next.js, React, TypeScript, Tailwind CSS            │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│      API Gateway, Lambda Functions, Express.js              │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                     Domain Layer                             │
│       Business Logic, Services, Use Cases                   │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                 Infrastructure Layer                         │
│    OpenSearch, DynamoDB, S3, RDS, Cognito, CloudWatch      │
└─────────────────────────────────────────────────────────────┘
```

## 2. フロントエンドアーキテクチャ

### 2.1 ディレクトリ構造

```
src/
├── app/                     # Next.js App Router
│   ├── (auth)/             # 認証が必要なルート
│   │   ├── dashboard/
│   │   ├── search/
│   │   └── admin/
│   ├── (public)/           # パブリックルート
│   │   ├── login/
│   │   └── register/
│   ├── api/                # API Routes
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/                 # 基本UIコンポーネント
│   │   ├── Button/
│   │   ├── Input/
│   │   └── Modal/
│   ├── features/           # 機能別コンポーネント
│   │   ├── search/
│   │   ├── file-explorer/
│   │   └── preview/
│   └── layout/            # レイアウトコンポーネント
├── hooks/                  # カスタムフック
├── services/               # APIクライアント
├── store/                  # 状態管理（Zustand）
├── utils/                  # ユーティリティ
├── types/                  # TypeScript型定義
└── styles/                 # グローバルスタイル
```

### 2.2 状態管理設計

```typescript
// Store Structure
interface AppState {
  // 認証状態
  auth: {
    user: User | null;
    isAuthenticated: boolean;
    token: string | null;
  };

  // 検索状態
  search: {
    query: string;
    filters: SearchFilters;
    results: SearchResult[];
    isLoading: boolean;
    pagination: PaginationState;
  };

  // UI状態
  ui: {
    sidebarOpen: boolean;
    theme: 'light' | 'dark';
    notifications: Notification[];
  };
}
```

### 2.3 コンポーネント設計原則

- **Atomic Design**: 原子、分子、有機体、テンプレート、ページ
- **Container/Presentational**: ロジックと表示の分離
- **Composition over Inheritance**: コンポジションパターンの採用

## 3. バックエンドアーキテクチャ

### 3.1 マイクロサービス構成

```yaml
services:
  search-service:
    runtime: Lambda
    language: TypeScript
    responsibilities:
      - 検索クエリ処理
      - 結果フィルタリング
      - ランキング処理

  indexing-service:
    runtime: Lambda
    language: Python
    responsibilities:
      - ファイルクローリング
      - テキスト抽出
      - インデックス更新

  file-processing-service:
    runtime: Lambda
    language: Python
    responsibilities:
      - PDF/Docuworks処理
      - 画像処理
      - SFCファイル解析

  auth-service:
    runtime: Cognito + Lambda
    language: TypeScript
    responsibilities:
      - ユーザー認証
      - 認可管理
      - トークン管理

  notification-service:
    runtime: Lambda + SES
    language: TypeScript
    responsibilities:
      - メール通知
      - アラート管理
```

### 3.2 API設計

```
/api/v1/
├── /auth
│   ├── POST   /login
│   ├── POST   /logout
│   ├── POST   /refresh
│   └── GET    /me
├── /search
│   ├── GET    /
│   ├── GET    /suggestions
│   └── POST   /advanced
├── /files
│   ├── GET    /{id}
│   ├── GET    /{id}/preview
│   └── GET    /{id}/download
├── /admin
│   ├── POST   /index/trigger
│   ├── GET    /index/status
│   └── GET    /logs
└── /users
    ├── GET    /
    ├── POST   /
    ├── PUT    /{id}
    └── DELETE /{id}
```

### 3.3 データフロー

```
1. 検索フロー:
   Client → API Gateway → Lambda → OpenSearch → Lambda → Client

2. インデックス更新フロー:
   EventBridge → Lambda → NAS → S3 → Lambda → OpenSearch

3. ファイルプレビューフロー:
   Client → CloudFront → S3 (キャッシュ) → Lambda → NAS
```

## 4. データアーキテクチャ

### 4.1 データストア選定

| データストア | 用途 | 選定理由 |
|------------|------|----------|
| OpenSearch | 全文検索インデックス | 高速な全文検索、日本語対応 |
| DynamoDB | メタデータ、セッション | 高速KVS、スケーラブル |
| RDS (PostgreSQL) | ユーザー情報、権限 | ACID特性、複雑なクエリ |
| S3 | ファイルキャッシュ、ログ | 大容量、低コスト |

### 4.2 データ同期戦略

```
┌──────────┐     定期同期      ┌──────────┐
│   NAS    │ ───────────────> │    S3    │
└──────────┘   (月1回/差分)    └──────────┘
     │                              │
     │                              ▼
     │                        ┌──────────┐
     └──────────────────────> │OpenSearch│
          インデックス作成      └──────────┘
```

### 4.3 キャッシング戦略

- **CloudFront**: 静的アセット（1週間）
- **S3**: ファイルプレビュー（1日）
- **ElastiCache**: セッション、頻繁にアクセスされるメタデータ（1時間）
- **ブラウザ**: 検索結果（5分）

## 5. セキュリティアーキテクチャ

### 5.1 多層防御

```
Internet → WAF → CloudFront → ALB → VPC
                                       │
                              ┌────────┴────────┐
                              │                 │
                        Private Subnet    Public Subnet
                              │                 │
                        Lambda/RDS         NAT Gateway
```

### 5.2 認証・認可フロー

```
1. ユーザーログイン
2. Cognito認証
3. JWTトークン発行
4. API Gatewayでトークン検証
5. Lambda内で権限チェック
6. リソースアクセス許可
```

### 5.3 データ暗号化

- **転送中**: TLS 1.3
- **保存時**: AES-256
- **キー管理**: AWS KMS

## 6. パフォーマンス最適化

### 6.1 フロントエンド最適化

- **Code Splitting**: ルートベースの動的インポート
- **Image Optimization**: Next.js Image Component
- **Bundle Size**: Tree Shaking、圧縮
- **Virtual Scrolling**: 大量データの仮想スクロール

### 6.2 バックエンド最適化

- **Lambda Cold Start**: Provisioned Concurrency
- **Database Connection**: RDS Proxy
- **Batch Processing**: SQS + Lambda
- **Caching**: ElastiCache Redis

### 6.3 検索最適化

- **インデックス設計**: 適切なアナライザー設定
- **クエリ最適化**: フィルタキャッシュ活用
- **レプリケーション**: 読み取り負荷分散

## 7. スケーラビリティ設計

### 7.1 水平スケーリング

- **Auto Scaling**: EC2、Lambda同時実行数
- **Database Sharding**: DynamoDB パーティション
- **Load Balancing**: ALB、API Gateway

### 7.2 垂直スケーリング

- **Instance Types**: 必要に応じてアップグレード
- **Memory Allocation**: Lambda メモリ調整

## 8. 監視・運用

### 8.1 監視項目

```yaml
metrics:
  business:
    - 検索レスポンスタイム
    - 検索成功率
    - ユーザーアクティビティ

  technical:
    - API レイテンシ
    - エラー率
    - リソース使用率

  security:
    - 不正アクセス試行
    - 認証失敗回数
```

### 8.2 ログ収集

```
Application Logs → CloudWatch Logs → S3 → Athena
                         │
                         ▼
                   CloudWatch Insights
```

### 8.3 アラート設定

- **Critical**: レスポンスタイム > 10秒、システムダウン
- **Warning**: エラー率 > 1%、CPU使用率 > 80%
- **Info**: 定期メンテナンス、デプロイ完了

## 9. 災害復旧計画

### 9.1 バックアップ戦略

- **RDS**: 自動バックアップ（7日保持）
- **DynamoDB**: Point-in-Time Recovery
- **S3**: Cross-Region Replication

### 9.2 復旧手順

1. 障害検知（CloudWatch Alarm）
2. 影響範囲特定
3. フェイルオーバー実行
4. データ整合性確認
5. サービス復旧確認

## 10. 技術選定理由

### 10.1 Next.js 15

- **選定理由**:
  - Server Components によるパフォーマンス向上
  - App Router の柔軟なルーティング
  - 画像最適化、ISR対応
  - TypeScript完全サポート

### 10.2 AWS OpenSearch

- **選定理由**:
  - 日本語形態素解析（kuromoji）対応
  - スケーラブル
  - マネージドサービス
  - Kibanaダッシュボード

### 10.3 Tailwind CSS

- **選定理由**:
  - ユーティリティファースト
  - バンドルサイズ最適化
  - レスポンシブデザイン容易
  - カスタマイズ性高い

## 11. 今後の拡張性

### 11.1 機能拡張

- **AI/ML統合**: SageMaker連携
- **リアルタイム同期**: Kinesis Data Streams
- **多言語対応**: i18n実装

### 11.2 インフラ拡張

- **マルチリージョン**: グローバル展開対応
- **エッジコンピューティング**: Lambda@Edge
- **コンテナ化**: EKS移行オプション

## 12. 月次バッチ最適化アーキテクチャ（推奨）

### 12.1 概要

ユースケース分析の結果、「古いデータの検索」が主要な目的であることが判明したため、リアルタイム同期ではなく**月次バッチ同期アーキテクチャ**を推奨します。これにより、**年間$840（約52%）のコスト削減**を実現します。

### 12.2 アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────┐
│                    オンプレミス環境                            │
│                                                              │
│  ┌────────────┐         ┌────────────────┐                 │
│  │    NAS     │ ◄────── │ DataSync Agent │                 │
│  │  (500GB)   │         │  (仮想マシン)   │                 │
│  └────────────┘         └────────────────┘                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ VPN (月1回, 4時間接続)
                           │ IPsec Site-to-Site
┌──────────────────────────▼──────────────────────────────────┐
│                       AWS環境                                 │
│                                                              │
│  ┌──────────────────┐      ┌───────────────────┐           │
│  │   DataSync       │─────>│   S3 Bucket       │           │
│  │   (増分転送)      │      │  (Intelligent-    │           │
│  │   20GB/月         │      │   Tiering)        │           │
│  └──────────────────┘      └────────┬──────────┘           │
│                                     │                        │
│         ┌───────────────────────────┼────────────┐          │
│         │                           │            │          │
│  ┌──────▼──────┐           ┌───────▼───────┐   │          │
│  │  Lambda     │           │   Lambda      │   │          │
│  │ TextExtract │           │ ImageFeature  │   │          │
│  │  (PDF/Doc)  │           │  (ResNet-50)  │   │          │
│  └──────┬──────┘           └───────┬───────┘   │          │
│         │                           │           │          │
│         └───────────┬───────────────┘           │          │
│                     ▼                           │          │
│              ┌─────────────┐                    │          │
│              │Step Functions│                    │          │
│              │ (Orchestrate) │                   │          │
│              └──────┬────────┘                   │          │
│                     │                            │          │
│         ┌───────────┴────────────┐               │          │
│         ▼                        ▼               ▼          │
│  ┌────────────┐          ┌────────────┐  ┌────────────┐   │
│  │ OpenSearch │          │ DynamoDB   │  │ CloudWatch │   │
│  │ (全文検索・ │          │ (メタデータ)│  │   (Logs)   │   │
│  │  画像k-NN)  │          └────────────┘  └────────────┘   │
│  └────────────┘                                            │
└──────────────────────────────────────────────────────────────┘
```

### 12.3 主要な設計決定

| 項目 | リアルタイム同期 | 月次バッチ同期（推奨） |
|------|-----------------|---------------------|
| **VPN接続** | 常時接続（730h/月） | 月1回、4時間のみ |
| **VPN料金** | $36/月 | $1.20/月 (**97%削減**) |
| **DataSync** | リアルタイム転送 | 増分同期（20GB/月） |
| **DataSync料金** | $20/月 | $5/月 (**75%削減**) |
| **Lambda処理** | 常時実行 | 月1回バッチ実行 |
| **Lambda料金** | $15/月 | $2.50/月 (**83%削減**) |
| **月額合計** | $120/月 | **$58/月** (**52%削減**) |
| **3年間TCO** | $4,320 | **$2,088** (**$2,232削減**) |

### 12.4 バッチ処理フロー

```
Step 1: VPN確立 (5分)
  └─> AWS VPN Gateway ⟷ Customer Gateway

Step 2: DataSync実行 (2-4時間)
  └─> NAS → S3 (変更ファイルのみ)
  └─> 増分検出: mtime, size比較

Step 3: VPN切断
  └─> コスト削減

Step 4: ファイルスキャン (10分)
  └─> Lambda: FileScanner
  └─> ファイル分類（PDF/Office/画像）

Step 5: 並列処理 (4-6時間)
  ├─> Lambda: TextExtractor (5,000ファイル)
  │   └─> PDF → pdfplumber → 全文テキスト
  └─> Lambda: ImageFeatureExtractor (2,000画像)
      └─> ResNet-50 → 512次元ベクトル

Step 6: インデックス作成 (1時間)
  └─> Lambda: BulkIndexer
  └─> OpenSearch Bulk API
      ├─> files インデックス (全文検索)
      └─> images インデックス (k-NN検索)
```

### 12.5 技術スタック詳細

#### VPN構成
- **タイプ**: AWS Site-to-Site VPN
- **接続方式**: IPsec
- **接続頻度**: 月1回（EventBridge Schedulerで自動起動）
- **接続時間**: 約4時間（DataSync完了後に自動切断）
- **冗長性**: Dual Tunnel（Active-Passive）

#### DataSync設定
- **エージェント**: VMware ESXi仮想マシン（4vCPU, 32GB RAM）
- **プロトコル**: SMB 3.1
- **転送モード**: `CHANGED`（変更ファイルのみ）
- **検証モード**: `POINT_IN_TIME_CONSISTENT`
- **帯域制限**: 100Mbps（VPN料金抑制）
- **除外パターン**: `*.tmp`, `~$*`, `.DS_Store`

#### Lambda関数
| 関数名 | Runtime | Memory | Timeout | 並列度 | 月次実行回数 |
|--------|---------|--------|---------|--------|-------------|
| TextExtractor | Python 3.12 (ARM64) | 2048MB | 60秒 | 20 | 5,000回 |
| ImageFeatureExtractor | Python 3.12 (ARM64) | 2048MB | 60秒 | 20 | 2,000回 |
| BulkIndexer | Python 3.12 (ARM64) | 1024MB | 300秒 | 1 | 1回 |
| SearchAPI | Python 3.12 (ARM64) | 512MB | 30秒 | 10 | 10,000回/月 |

#### OpenSearch設定
- **インスタンス**: t3.small.search × 1
- **ストレージ**: EBS gp3 50GB
- **インデックス**:
  - `files`: kuromoji analyzer（日本語全文検索）
  - `images`: dense_vector 512次元（k-NN類似検索）
- **HNSW パラメータ**:
  - `m`: 16
  - `ef_construction`: 512
  - `ef_search`: 512

### 12.6 コスト内訳（月次バッチ同期）

| サービス | 詳細 | 月額 |
|---------|------|------|
| VPN | 4時間接続 + データ転送20GB | $1.20 |
| DataSync | 20GB増分転送 | $5.00 |
| Lambda (処理) | Text + Image + Index | $2.50 |
| Lambda (検索) | 10K検索/月 | $0.50 |
| OpenSearch | t3.small.search | $25.00 |
| OpenSearch Storage | 50GB EBS gp3 | $6.75 |
| S3 Intelligent-Tiering | 100GB | $1.78 |
| S3 Requests | 100K PUT/GET | $0.50 |
| DynamoDB | 5GB + 10K RCU/WCU | $1.50 |
| Step Functions | 1実行 × 20ステップ | $0.05 |
| CloudWatch Logs | 2GB | $1.00 |
| SNS | 10通知 | $0.01 |
| **合計** | | **$45.79/月** |

### 12.7 画像類似検索実装

#### 特徴抽出
```python
# ResNet-50モデル（最終FC層を除去）
model = models.resnet50(weights=ResNet50_Weights.IMAGENET1K_V2)
model = torch.nn.Sequential(*list(model.children())[:-1])

# 2048次元 → 512次元に削減（PCA）
feature_vector = model(image_tensor)  # (2048,)
reduced_vector = pca.transform(feature_vector)  # (512,)
```

#### OpenSearch k-NN検索
```json
{
  "query": {
    "script_score": {
      "query": {"match_all": {}},
      "script": {
        "source": "cosineSimilarity(params.query_vector, 'image_vector') + 1.0",
        "params": {"query_vector": [0.123, 0.456, ...]}
      }
    }
  }
}
```

### 12.8 運用スケジュール

| タイミング | イベント | 実行内容 |
|-----------|---------|---------|
| **毎月1日 深夜2時** | EventBridge Scheduler | Step Functions実行開始 |
| 2:00 - 2:05 | VPN確立 | Site-to-Site VPN接続 |
| 2:05 - 6:00 | DataSync | 増分ファイル同期 |
| 6:00 | VPN切断 | コスト削減 |
| 6:00 - 6:10 | ファイルスキャン | S3オブジェクトの分類 |
| 6:10 - 12:00 | 並列処理 | テキスト抽出・画像特徴抽出 |
| 12:00 - 13:00 | インデックス作成 | OpenSearchへBulk Insert |
| 13:00 | SNS通知 | 成功・失敗の通知 |

### 12.9 詳細設計ドキュメント

本アーキテクチャの詳細は、以下のドキュメントを参照してください:

- **月次バッチアーキテクチャ設計書**: `/docs/architecture-batch-optimized.md`
- **画像類似検索設計書**: `/docs/image-similarity-search.md`
- **バッチ同期詳細設計書**: `/docs/batch-sync-design.md`
- **コスト最適化分析書**: `/docs/cost-optimization-analysis.md`
- **実装ロードマップ**: `/docs/implementation-roadmap-optimized.md`

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-15 | 初版作成 | CIS開発チーム |
| 1.1 | 2025-01-18 | 月次バッチ最適化アーキテクチャ追加 | CIS開発チーム |