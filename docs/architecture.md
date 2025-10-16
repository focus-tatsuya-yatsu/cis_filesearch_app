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

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-15 | 初版作成 | CIS開発チーム |