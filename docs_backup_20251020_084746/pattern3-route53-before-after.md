# Pattern 3: Route53/ACM 追加 Before/After アーキテクチャ比較図

## 概要

Pattern 3アーキテクチャに**Route53（カスタムドメイン）**と**ACM（HTTPS暗号化）**を追加しました。
この図は、更新前後のアーキテクチャとユーザー検索フローの違いを視覚的に比較します。

**主な変更点:**
- ✅ **カスタムドメイン**: `filesearch.company.com`（Route53、$0.50/月）
- ✅ **HTTPS暗号化**: ACM証明書（無料）でTLS 1.3対応
- ✅ **Azure AD SSO要件満足**: OAuth 2.0はHTTPS必須
- ✅ **コスト増**: わずか+$0.50/月（+1%）

---

## Before/After 比較図

```mermaid
graph TB
    subgraph "🔴 更新前: Pattern 3（$47.24/月）"
        subgraph "BeforeUser[ユーザー層]"
            U1["👤 ユーザー (50名)"]
        end

        subgraph "BeforeFrontend[フロントエンド層]"
            FE1["⚛️ Next.js Frontend<br/>ECS Fargate"]
        end

        subgraph "BeforeAPI[API層]"
            API1["🔓 API Gateway<br/>デフォルトドメイン<br/>xxx.execute-api...amazonaws.com"]
        end

        subgraph "BeforeBackend[バックエンド層]"
            Lambda1["λ SearchAPI<br/>512MB, ARM64"]
            OS1["🔍 OpenSearch<br/>t3.small.search"]
            DB1["🗂️ DynamoDB"]
            S31["🪣 S3"]
        end

        U1 -->|"❌ HTTP<br/>（Azure AD SSO不可）"| FE1
        FE1 -->|"POST /api/search<br/>長いURL"| API1
        API1 --> Lambda1
        Lambda1 --> OS1
        Lambda1 --> DB1
        Lambda1 --> S31

        style U1 fill:#ffcdd2
        style FE1 fill:#ffcdd2
        style API1 fill:#ffcdd2
    end

    subgraph "🟢 更新後: Pattern 3 + Route53 + ACM（$47.74/月、+1%）"
        subgraph "AfterUser[ユーザー層]"
            U2["👤 ユーザー (50名)<br/>Azure AD SSO"]
        end

        subgraph "AfterFrontend[フロントエンド層]"
            FE2["⚛️ Next.js Frontend<br/>ECS Fargate"]
        end

        subgraph "AfterDNS[DNS層（新規）]"
            R53["🌐 Route53<br/>$0.50/月<br/>filesearch.company.com"]
        end

        subgraph "AfterAPI[API層（強化）]"
            API2["🔐 API Gateway<br/>Custom Domain<br/>filesearch.company.com"]
            ACM["🔒 ACM証明書（無料）<br/>TLS 1.3<br/>自動更新"]
        end

        subgraph "AfterBackend[バックエンド層]"
            Lambda2["λ SearchAPI<br/>512MB, ARM64"]
            OS2["🔍 OpenSearch<br/>t3.small.search"]
            DB2["🗂️ DynamoDB"]
            S32["🪣 S3"]
        end

        U2 -->|"✅ HTTPS<br/>TLS 1.3"| FE2
        FE2 -->|"✅ HTTPS<br/>短縮URL"| R53
        R53 -->|"DNS解決"| API2
        API2 -.->|"証明書検証"| ACM
        API2 -->|"POST /api/search<br/>IPアドレス制限"| Lambda2
        Lambda2 --> OS2
        Lambda2 --> DB2
        Lambda2 --> S32

        style U2 fill:#c8e6c9
        style FE2 fill:#c8e6c9
        style R53 fill:#c8e6c9
        style API2 fill:#c8e6c9
        style ACM fill:#c8e6c9
    end

    %% スタイル定義
    style BeforeUser fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    style BeforeFrontend fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    style BeforeAPI fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    style BeforeBackend fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    style AfterUser fill:#e8f5e9,stroke:#43a047,stroke-width:3px
    style AfterFrontend fill:#e8f5e9,stroke:#43a047,stroke-width:3px
    style AfterDNS fill:#e8f5e9,stroke:#43a047,stroke-width:3px
    style AfterAPI fill:#e8f5e9,stroke:#43a047,stroke-width:3px
    style AfterBackend fill:#e8f5e9,stroke:#43a047,stroke-width:3px
```

---

## 検索フロー詳細比較

### 🔴 更新前のフロー

```mermaid
sequenceDiagram
    participant U as 👤 ユーザー
    participant FE as Next.js Frontend
    participant API as API Gateway<br/>(デフォルトドメイン)
    participant Lambda as SearchAPI Lambda
    participant OS as OpenSearch

    Note over U,OS: ❌ セキュリティ問題あり

    U->>FE: 検索クエリ入力<br/>（HTTP接続）
    Note right of U: ⚠️ Azure AD SSO動作不可<br/>（HTTPではOAuth 2.0失敗）

    FE->>API: POST /api/search<br/>https://xxx.execute-api...amazonaws.com/prod/search
    Note right of FE: ⚠️ 長いURL<br/>（ユーザビリティ低）

    API->>Lambda: リクエスト転送<br/>（暗号化なし）
    Note right of API: ⚠️ JWTトークン平文送信<br/>（MITM攻撃リスク）

    Lambda->>OS: 全文検索クエリ
    OS-->>Lambda: 検索結果
    Lambda-->>API: JSON Response
    API-->>FE: 検索結果
    FE-->>U: 表示

    Note over U,OS: 🔴 セキュリティスコア: 50/100<br/>Azure AD SSO不可、HTTPS未対応
```

---

### 🟢 更新後のフロー

```mermaid
sequenceDiagram
    participant U as 👤 ユーザー<br/>(Azure AD SSO)
    participant FE as Next.js Frontend
    participant R53 as Route53
    participant API as API Gateway<br/>(Custom Domain)
    participant ACM as ACM証明書
    participant Lambda as SearchAPI Lambda
    participant OS as OpenSearch

    Note over U,OS: ✅ セキュリティ強化

    U->>FE: 検索クエリ入力<br/>（HTTPS接続 - TLS 1.3）
    Note right of U: ✅ Azure AD SSO正常動作<br/>（OAuth 2.0対応）

    FE->>R53: POST /api/search<br/>https://filesearch.company.com/search
    Note right of FE: ✅ 短縮URL<br/>（プロフェッショナル）

    R53->>API: DNS解決<br/>（カスタムドメイン）
    API->>ACM: TLS 1.3ハンドシェイク<br/>証明書検証
    ACM-->>API: 証明書OK

    Note right of API: ✅ IPアドレス制限チェック<br/>（社内ネットワークのみ）

    API->>Lambda: リクエスト転送<br/>（暗号化通信）
    Note right of API: ✅ JWTトークン保護<br/>（MITM攻撃防止）

    Lambda->>OS: 全文検索クエリ
    OS-->>Lambda: 検索結果
    Lambda-->>API: JSON Response
    API-->>R53: HTTPS応答
    R53-->>FE: 検索結果
    FE-->>U: 表示

    Note over U,OS: 🟢 セキュリティスコア: 85/100<br/>Azure AD SSO対応、HTTPS完全対応
```

---

## 主要な改善ポイント

### 1. Azure AD SSO対応

| 項目 | 更新前（❌） | 更新後（✅） |
|------|------------|------------|
| **通信プロトコル** | HTTP | **HTTPS (TLS 1.3)** |
| **OAuth 2.0対応** | ❌ 動作不可 | ✅ 正常動作 |
| **リダイレクトURI** | `http://...` | `https://filesearch.company.com` |
| **ブラウザ警告** | 「安全でない接続」 | 「保護された通信」 |

---

### 2. URL改善

| 項目 | 更新前（❌） | 更新後（✅） |
|------|------------|------------|
| **ドメイン** | `xxx.execute-api.ap-northeast-1.amazonaws.com` | `filesearch.company.com` |
| **パス** | `/prod/search` | `/search` |
| **文字数** | 65文字以上 | 33文字 |
| **覚えやすさ** | ⭐ | ⭐⭐⭐⭐⭐ |

---

### 3. セキュリティ強化

| セキュリティ項目 | 更新前（❌） | 更新後（✅） |
|--------------|------------|------------|
| **通信暗号化** | ❌ HTTPのみ | ✅ HTTPS (TLS 1.3) |
| **中間者攻撃（MITM）** | 🔴 リスク高 | 🟢 防御済み |
| **認証トークン保護** | ❌ 平文送信 | ✅ 暗号化送信 |
| **IPアドレス制限** | ❌ なし | ✅ 社内ネットワークのみ |
| **レート制限** | ✅ API Gateway (100req/秒) | ✅ API Gateway (100req/秒) |
| **総合スコア** | 🔴 50/100 | 🟢 85/100 |

---

### 4. コスト影響

```mermaid
pie title コスト構成比較（更新前 vs 更新後）
    "OpenSearch (66.2%)" : 66.2
    "その他AWSサービス (32.8%)" : 32.8
    "Route53（新規、1.0%）" : 1.0
    "ACM（無料、0%）" : 0.0
```

| 項目 | 更新前 | 更新後 | 差分 |
|------|-------|-------|------|
| **月額コスト** | $47.24 | $47.74 | **+$0.50 (+1.1%)** |
| **年額コスト** | $566.88 | $572.88 | +$6.00 |
| **3年間TCO** | $1,810.38 | $1,828.38 | +$18.00 |

**コスト増加率**: わずか**+1%**で、以下の大幅な改善を実現:
- ✅ Azure AD SSO対応
- ✅ プロフェッショナルなURL
- ✅ TLS 1.3暗号化
- ✅ セキュリティスコア +35ポイント向上（50 → 85）

---

## 不採用となったサービス

### CloudFront（CDN）

```mermaid
graph LR
    A[CloudFront<br/>$1.16/月] --> B{ROI分析}
    B --> C1[✅ メリット<br/>レイテンシ5%改善<br/>121ms → 115ms]
    B --> C2[❌ デメリット<br/>コスト+25%<br/>50名のみ]
    C1 --> D[評価: ⭐ 低い]
    C2 --> D
    D --> E[結論: 不採用]

    style A fill:#ffcdd2
    style B fill:#fff9c4
    style C1 fill:#c8e6c9
    style C2 fill:#ffcdd2
    style E fill:#f44336,color:#fff
```

**不採用理由**:
1. ユーザー数が少ない（50名のみ）
2. 地理的分散なし（日本国内のみ）
3. キャッシュヒット率低（5-10%）
4. レイテンシ改善が体感できない（5%改善）
5. **ROI低い**: $1.16/月のコスト vs 小さなメリット

---

### WAF（Web Application Firewall）

```mermaid
graph LR
    A[WAF<br/>$10.01/月] --> B{セキュリティ分析}
    B --> C1[✅ 既存対策<br/>Azure AD SSO<br/>IPアドレス制限<br/>VPC SG]
    B --> C2[❌ 追加コスト<br/>+21%増加]
    C1 --> D[評価: ⭐ 低い]
    C2 --> D
    D --> E[結論: 不採用]

    style A fill:#ffcdd2
    style B fill:#fff9c4
    style C1 fill:#c8e6c9
    style C2 fill:#ffcdd2
    style E fill:#f44336,color:#fff
```

**不採用理由**:
1. Azure AD SSOで既に認証済み
2. API GatewayリソースポリシーでIPアドレス制限
3. 社内ネットワーク限定アクセス
4. **代替策で十分**: セキュリティスコア85/100達成

**代替セキュリティ対策**:
- ✅ Azure AD SSO（MFA推奨）
- ✅ IPアドレス制限（API Gatewayリソースポリシー）
- ✅ レート制限（100req/秒）
- ✅ VPCセキュリティグループ（Private Subnet）
- ✅ CloudWatch監視（異常検知）

---

## 将来的な拡張シナリオ

### シナリオ1: ユーザー数増加（200名以上）

```mermaid
graph TD
    A[現状: 50名] --> B{ユーザー数増加}
    B -->|200名以上| C[CloudFront追加検討]
    C --> D[コスト: +$1.16/月<br/>メリット: レイテンシ改善]

    B -->|50-199名| E[現状維持]
    E --> F[Pattern 3 + Route53 + ACM]
```

---

### シナリオ2: グローバル展開

```mermaid
graph TD
    A[現状: 日本のみ] --> B{展開エリア拡大}
    B -->|海外拠点追加| C[CloudFront必須]
    C --> D[エッジロケーション<br/>レイテンシ大幅改善]

    B -->|日本のみ| E[現状維持]
    E --> F[Pattern 3 + Route53 + ACM]
```

---

### シナリオ3: 外部公開

```mermaid
graph TD
    A[現状: 社内限定] --> B{アクセス範囲拡大}
    B -->|外部パートナー| C[WAF追加必須]
    C --> D[コスト: +$10.01/月<br/>攻撃防御強化]

    B -->|社内のみ| E[現状維持]
    E --> F[Pattern 3 + Route53 + ACM]
```

---

## まとめ

### ✅ 更新により達成された成果

| 項目 | 成果 |
|------|------|
| **Azure AD SSO対応** | ✅ HTTPS必須要件を満たす |
| **カスタムドメイン** | ✅ `filesearch.company.com`（プロフェッショナル） |
| **TLS 1.3暗号化** | ✅ 中間者攻撃（MITM）防止 |
| **セキュリティ向上** | ✅ スコア +35ポイント（50 → 85） |
| **コスト増** | ✅ わずか+$0.50/月（+1%） |
| **削減率維持** | ✅ Pattern 2比96%削減を維持 |

---

### 📊 Before/After 総合比較

```mermaid
graph TB
    subgraph "Before（❌）"
        B1[月額コスト: $47.24]
        B2[セキュリティスコア: 50/100]
        B3[Azure AD SSO: 動作不可]
        B4[URL: 長い65文字]
        B5[HTTPS: 未対応]
    end

    subgraph "After（✅）"
        A1[月額コスト: $47.74 +1%]
        A2[セキュリティスコア: 85/100 +70%]
        A3[Azure AD SSO: 正常動作]
        A4[URL: 短い33文字]
        A5[HTTPS: TLS 1.3対応]
    end

    B1 -.->|"+$0.50"| A1
    B2 -.->|"+35ポイント"| A2
    B3 -.->|"要件満足"| A3
    B4 -.->|"約50%短縮"| A4
    B5 -.->|"完全対応"| A5

    style B1 fill:#ffcdd2
    style B2 fill:#ffcdd2
    style B3 fill:#ffcdd2
    style B4 fill:#ffcdd2
    style B5 fill:#ffcdd2

    style A1 fill:#c8e6c9
    style A2 fill:#c8e6c9
    style A3 fill:#c8e6c9
    style A4 fill:#c8e6c9
    style A5 fill:#c8e6c9
```

---

## 関連ドキュメント

- `/docs/pattern3-architecture.md` - Pattern 3詳細設計（Mermaid図）
- `/docs/pattern3-cloudfront-analysis.md` - Route53/CloudFront/WAF/ACM必要性分析レポート
- `/docs/pattern3-route53-acm-update-summary.md` - 更新サマリー
- `/docs/pattern3-route53-implementation-flow.md` - 実装手順フローチャート（次のドキュメント）
- `/docs/pattern3-security-architecture.md` - セキュリティアーキテクチャ図（次のドキュメント）

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-18 | Pattern 3 Route53/ACM Before/After比較図初版作成 | Business & Data Analyst |
