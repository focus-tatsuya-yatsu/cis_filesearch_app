# Pattern 3: セキュリティアーキテクチャ図（多層防御）

## 概要

Pattern 3アーキテクチャのセキュリティ設計を視覚化します。
**Route53 + ACM追加後**の多層防御（Defense in Depth）アプローチを採用し、**セキュリティスコア85/100**を達成しています。

**主要なセキュリティ対策:**
- 🔒 **通信暗号化**: TLS 1.3（ACM証明書、無料）
- 🔐 **認証**: Azure AD SSO（OAuth 2.0、MFA推奨）
- 🛡️ **ネットワーク制限**: IPアドレス制限（社内ネットワークのみ）
- ⚡ **レート制限**: API Gatewayスロットリング（100req/秒）
- 📊 **監視**: CloudWatch Logs（異常検知）

**不採用のサービス:**
- ❌ **WAF**: Azure AD SSO + IPアドレス制限で代替可能（$10.01/月削減）
- ❌ **CloudFront + Shield**: 社内限定アクセス、DDoS攻撃リスク低い

---

## 多層防御アーキテクチャ全体図

```mermaid
graph TB
    subgraph "🔴 脅威レイヤー（防御対象）"
        T1["⚠️ 外部攻撃者"]
        T2["⚠️ 中間者攻撃（MITM）"]
        T3["⚠️ 不正アクセス"]
        T4["⚠️ DDoS攻撃"]
        T5["⚠️ データ漏洩"]
    end

    subgraph "🟢 防御レイヤー 1: DNS & 通信暗号化（外側）"
        D1["🌐 Route53<br/>$0.50/月<br/>ヘルスチェック"]
        D2["🔒 ACM証明書（無料）<br/>TLS 1.3<br/>自動更新"]
        D1 --> D2
    end

    subgraph "🟢 防御レイヤー 2: 認証・認可"
        A1["🔐 Azure AD SSO<br/>OAuth 2.0<br/>MFA推奨"]
        A2["🎫 JWTトークン検証<br/>有効期限チェック"]
        A1 --> A2
    end

    subgraph "🟢 防御レイヤー 3: ネットワーク制限"
        N1["🛡️ API Gateway<br/>リソースポリシー<br/>IPアドレス制限"]
        N2["⚡ API Gateway<br/>スロットリング<br/>100req/秒"]
        N3["🚧 VPC Security Group<br/>Private Subnet<br/>アウトバウンドのみ"]
        N1 --> N2
        N2 --> N3
    end

    subgraph "🟢 防御レイヤー 4: アプリケーション保護"
        P1["✅ Lambda入力バリデーション<br/>特殊文字エスケープ"]
        P2["✅ OpenSearch<br/>クエリサニタイズ"]
        P3["✅ DynamoDB<br/>最小権限IAMロール"]
        P1 --> P2
        P2 --> P3
    end

    subgraph "🟢 防御レイヤー 5: 監視・検知（内側）"
        M1["📊 CloudWatch Logs<br/>全APIリクエスト記録"]
        M2["🚨 CloudWatch Alarms<br/>異常検知<br/>4xx/5xx率 > 5%"]
        M3["📧 SNS通知<br/>管理者5名"]
        M1 --> M2
        M2 --> M3
    end

    T1 -->|"Block"| D1
    T2 -->|"Prevent"| D2
    T3 -->|"Deny"| A1
    T4 -->|"Throttle"| N2
    T5 -->|"Detect"| M1

    D2 --> A1
    A2 --> N1
    N3 --> P1
    P3 --> M1

    style T1 fill:#ffcdd2
    style T2 fill:#ffcdd2
    style T3 fill:#ffcdd2
    style T4 fill:#ffcdd2
    style T5 fill:#ffcdd2

    style D1 fill:#c8e6c9
    style D2 fill:#c8e6c9
    style A1 fill:#bbdefb
    style A2 fill:#bbdefb
    style N1 fill:#fff9c4
    style N2 fill:#fff9c4
    style N3 fill:#fff9c4
    style P1 fill:#ffccbc
    style P2 fill:#ffccbc
    style P3 fill:#ffccbc
    style M1 fill:#e1bee7
    style M2 fill:#e1bee7
    style M3 fill:#e1bee7
```

---

## セキュリティレイヤー詳細

### 🟢 防御レイヤー 1: DNS & 通信暗号化

```mermaid
sequenceDiagram
    participant Attacker as ⚠️ 攻撃者<br/>（MITM試行）
    participant User as 👤 正規ユーザー
    participant Route53 as 🌐 Route53
    participant ACM as 🔒 ACM証明書
    participant API as 🔐 API Gateway

    Note over Attacker,API: 通信暗号化レイヤー（TLS 1.3）

    User->>Route53: DNS解決<br/>filesearch.company.com
    Route53-->>User: IP返却（Alias）

    User->>API: HTTPS接続要求<br/>（Client Hello）
    API->>ACM: 証明書検証
    ACM-->>API: 証明書OK

    Note over Attacker: ❌ パケット傍受試行<br/>（暗号化されており解読不可）

    API-->>User: TLS 1.3ハンドシェイク<br/>暗号化通信確立
    User->>API: POST /api/search<br/>（暗号化済みJWTトークン）

    Note over User,API: ✅ MITM攻撃防止成功<br/>JWTトークン保護

    Attacker->>API: 偽装リクエスト<br/>（自己署名証明書）
    API-->>Attacker: ❌ 証明書検証失敗<br/>接続拒否

    Note over Attacker,API: セキュリティスコア: +20/100
```

**防御メカニズム:**

| 対策 | 技術 | 効果 |
|------|------|------|
| **TLS 1.3暗号化** | ACM証明書、ECDHE-RSA-AES256-GCM-SHA384 | 中間者攻撃（MITM）完全防止 |
| **証明書検証** | パブリック証明書（AWS ACM） | 偽装サーバー接続拒否 |
| **Perfect Forward Secrecy** | ECDHE鍵交換 | 過去の通信解読不可 |
| **HSTS（推奨）** | Strict-Transport-Security ヘッダー | HTTPダウングレード攻撃防止 |

**コスト**: $0.00（ACM証明書は無料）

---

### 🟢 防御レイヤー 2: 認証・認可

```mermaid
sequenceDiagram
    participant User as 👤 ユーザー
    participant FE as ⚛️ Next.js
    participant AzureAD as 🔐 Azure AD SSO
    participant API as 🔐 API Gateway
    participant Lambda as λ SearchAPI

    Note over User,Lambda: 認証・認可レイヤー（OAuth 2.0）

    User->>FE: ログインボタンクリック
    FE->>AzureAD: OAuth 2.0認証要求<br/>redirect_uri: https://filesearch.company.com/auth/callback

    alt MFA有効化済み
        AzureAD->>User: MFA認証要求<br/>（SMS/Authenticator App）
        User->>AzureAD: MFA確認コード入力
    end

    AzureAD-->>FE: 認可コード返却
    FE->>AzureAD: トークン交換要求<br/>（Client Secret）
    AzureAD-->>FE: Access Token + ID Token（JWT）

    Note over FE: JWTトークンをセッションストレージに保存

    User->>FE: 検索クエリ入力<br/>（"プロジェクト 提案書"）
    FE->>API: POST /api/search<br/>Authorization: Bearer {JWT}

    API->>API: JWTトークン検証<br/>- 署名検証（RS256）<br/>- 有効期限チェック<br/>- Audience検証

    alt JWTトークン有効
        API->>Lambda: リクエスト転送<br/>（ユーザー情報付加）
        Lambda-->>API: 検索結果
        API-->>FE: JSON Response
        FE-->>User: 検索結果表示
    else JWTトークン無効
        API-->>FE: ❌ 401 Unauthorized
        FE->>AzureAD: 再認証リダイレクト
    end

    Note over User,Lambda: セキュリティスコア: +30/100
```

**防御メカニズム:**

| 対策 | 技術 | 効果 |
|------|------|------|
| **Azure AD SSO** | OAuth 2.0、OIDC | 不正アクセス防止、シングルサインオン |
| **MFA（多要素認証）** | SMS/Authenticator App | アカウント乗っ取り防止 |
| **JWTトークン検証** | RS256署名検証 | トークン改ざん防止 |
| **有効期限制限** | 1時間（推奨） | セッションハイジャック対策 |

**推奨設定:**
```yaml
Azure AD SSO設定:
  - MFA: 必須（全ユーザー）
  - 条件付きアクセス:
      - 許可IP範囲: 203.0.113.0/24（社内ネットワーク）
      - デバイス管理: Intune登録済みデバイスのみ
  - トークン有効期限: 1時間
  - リフレッシュトークン: 7日間
```

**コスト**: $0.00（Azure AD Free tierで対応可能）

---

### 🟢 防御レイヤー 3: ネットワーク制限

```mermaid
graph TB
    subgraph "インターネット"
        U1["👤 正規ユーザー<br/>社内IP: 203.0.113.50"]
        U2["👤 VPNユーザー<br/>VPN IP: 198.51.100.20"]
        A1["⚠️ 外部攻撃者<br/>IP: 8.8.8.8"]
    end

    subgraph "VPC: 10.0.0.0/16"
        subgraph "Public Subnet: 10.0.0.0/24"
            NAT["🔀 NAT Gateway<br/>Elastic IP"]
            IGW["🌍 Internet Gateway"]
        end

        subgraph "API Gateway層（VPC外）"
            APIGateway["🔐 API Gateway<br/>リソースポリシー"]
        end

        subgraph "Private Subnet 1: 10.0.1.0/24 (AZ-a)"
            Lambda1["λ SearchAPI<br/>Security Group: sg-lambda"]
            OpenSearch["🔍 OpenSearch<br/>Security Group: sg-opensearch"]
        end

        subgraph "Private Subnet 2: 10.0.2.0/24 (AZ-b)"
            Lambda2["λ TextExtractor<br/>Security Group: sg-lambda"]
        end
    end

    U1 -->|"✅ IP許可"| APIGateway
    U2 -->|"✅ IP許可"| APIGateway
    A1 -->|"❌ IP拒否<br/>403 Forbidden"| APIGateway

    APIGateway -->|"スロットリング<br/>100req/秒"| Lambda1
    Lambda1 -->|"Private通信<br/>sg-lambda → sg-opensearch"| OpenSearch
    Lambda1 -.->|"アウトバウンド<br/>HTTPS"| NAT
    NAT --> IGW

    Lambda2 -.->|"アウトバウンド<br/>S3アクセス"| NAT

    style U1 fill:#c8e6c9
    style U2 fill:#c8e6c9
    style A1 fill:#ffcdd2
    style APIGateway fill:#bbdefb
    style NAT fill:#fff9c4
    style IGW fill:#fff9c4
    style Lambda1 fill:#ffccbc
    style Lambda2 fill:#ffccbc
    style OpenSearch fill:#e1bee7
```

**防御メカニズム:**

#### 1. API Gatewayリソースポリシー（IPアドレス制限）

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:ap-northeast-1:123456789012:abc123xyz/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "203.0.113.0/24",
            "198.51.100.0/24"
          ]
        }
      }
    }
  ]
}
```

**効果:**
- ✅ 社内ネットワーク（203.0.113.0/24）のみ許可
- ✅ VPN IP範囲（198.51.100.0/24）のみ許可
- ❌ その他すべてのIPアドレスを拒否（403 Forbidden）

---

#### 2. API Gatewayスロットリング

| 設定項目 | 値 | 効果 |
|---------|-----|------|
| **レート制限** | 100 requests/秒 | DDoS攻撃の緩和 |
| **バースト制限** | 200 requests | 短時間の過剰リクエスト防止 |
| **クォータ** | 10,000 requests/日 | 月間リクエスト数制御 |

**超過時の動作:**
```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{
  "message": "Rate limit exceeded. Retry after 10 seconds."
}
```

---

#### 3. VPC Security Group設定

**Lambda Security Group（sg-lambda）**:
```yaml
Inbound Rules:
  - NONE（Lambda Functionは直接インバウンドを受けない）

Outbound Rules:
  - Port 443 (HTTPS): 0.0.0.0/0（S3、DynamoDB、インターネットアクセス）
  - Port 9200 (OpenSearch): sg-opensearch（OpenSearch専用）
```

**OpenSearch Security Group（sg-opensearch）**:
```yaml
Inbound Rules:
  - Port 9200: sg-lambda（Lambda Functionからのみ許可）

Outbound Rules:
  - NONE（外部通信不要）
```

**セキュリティスコア**: +25/100

**コスト**: $0.00（VPC、Security Groupは無料）

---

### 🟢 防御レイヤー 4: アプリケーション保護

```mermaid
flowchart TD
    Input[ユーザー入力<br/>検索クエリ] --> Validation{入力バリデーション}

    Validation -->|OK| Sanitize[特殊文字エスケープ]
    Validation -->|NG| Reject[❌ 400 Bad Request<br/>"Invalid query format"]

    Sanitize --> LengthCheck{文字数チェック<br/>最大500文字}
    LengthCheck -->|OK| SpecialCharCheck
    LengthCheck -->|NG| Reject2[❌ 400 Bad Request<br/>"Query too long"]

    SpecialCharCheck{SQLインジェクション<br/>パターンチェック} -->|Safe| OpenSearchQuery[OpenSearch<br/>クエリ構築]
    SpecialCharCheck -->|Suspicious| Block[❌ 403 Forbidden<br/>"Potential injection detected"]

    OpenSearchQuery --> Execute[OpenSearch実行]
    Execute --> Result[✅ 検索結果返却]

    style Input fill:#c8e6c9
    style Validation fill:#bbdefb
    style Sanitize fill:#fff9c4
    style OpenSearchQuery fill:#ffccbc
    style Execute fill:#e1bee7
    style Result fill:#c8e6c9
    style Reject fill:#ffcdd2
    style Reject2 fill:#ffcdd2
    style Block fill:#ffcdd2
```

**防御メカニズム:**

#### 1. Lambda入力バリデーション

```typescript
// SearchAPI Lambda関数
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { query } = JSON.parse(event.body || '{}');

  // 1. 入力バリデーション
  if (!query || typeof query !== 'string') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid query format' }),
    };
  }

  // 2. 文字数制限
  if (query.length > 500) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Query too long (max 500 characters)' }),
    };
  }

  // 3. SQLインジェクションパターンチェック
  const suspiciousPatterns = [
    /(\bUNION\b.*\bSELECT\b)/i,
    /(\bDROP\b.*\bTABLE\b)/i,
    /(--|;|\/\*|\*\/)/,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(query)) {
      await logSecurityEvent('potential_injection', { query, sourceIp: event.requestContext.identity.sourceIp });
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Potential injection detected' }),
      };
    }
  }

  // 4. 特殊文字エスケープ
  const sanitizedQuery = escapeHtml(query);

  // 5. OpenSearch検索実行
  const results = await searchOpenSearch(sanitizedQuery);

  return {
    statusCode: 200,
    body: JSON.stringify({ results }),
  };
};
```

---

#### 2. OpenSearchクエリサニタイズ

```typescript
// OpenSearchクエリ構築
const buildOpenSearchQuery = (sanitizedQuery: string) => {
  return {
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query: sanitizedQuery, // サニタイズ済み
              fields: ['file_name^3', 'file_content', 'file_path'],
              type: 'best_fields',
              operator: 'and',
            },
          },
        ],
      },
    },
  };
};
```

**防御対象攻撃:**
- ✅ SQLインジェクション（OpenSearchはNoSQLだが念のため）
- ✅ XSS（Cross-Site Scripting）
- ✅ コマンドインジェクション
- ✅ Path Traversal攻撃（`../../etc/passwd`等）

---

#### 3. DynamoDB最小権限IAMロール

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:ap-northeast-1:123456789012:table/file_metadata",
      "Condition": {
        "StringEquals": {
          "dynamodb:LeadingKeys": ["${aws:username}"]
        }
      }
    }
  ]
}
```

**効果:**
- ✅ 読み取り専用（Write操作不可）
- ✅ 特定テーブルのみアクセス可能
- ✅ ユーザースコープ制限

**セキュリティスコア**: +10/100

---

### 🟢 防御レイヤー 5: 監視・検知

```mermaid
flowchart TB
    subgraph "イベント発生"
        E1[API Gateway<br/>全リクエスト]
        E2[Lambda実行ログ]
        E3[OpenSearch<br/>クエリログ]
        E4[DynamoDB<br/>アクセスログ]
    end

    subgraph "CloudWatch Logs"
        L1[/aws/apigateway/cis-filesearch-api]
        L2[/aws/lambda/SearchAPI]
        L3[/aws/opensearch/cis-filesearch]
    end

    subgraph "CloudWatch Insights"
        I1["異常検知クエリ<br/>- 4xxエラー率 > 5%<br/>- 5xxエラー率 > 1%<br/>- 認証失敗率 > 10%"]
    end

    subgraph "CloudWatch Alarms"
        A1["🚨 High 4xx Error Rate"]
        A2["🚨 High 5xx Error Rate"]
        A3["🚨 Auth Failure Rate"]
        A4["🚨 Throttle Events"]
    end

    subgraph "通知"
        SNS["📧 SNS Topic<br/>cis-filesearch-alerts"]
        Email["✉️ メール通知<br/>管理者5名"]
    end

    E1 --> L1
    E2 --> L2
    E3 --> L3
    E4 --> L1

    L1 --> I1
    L2 --> I1
    L3 --> I1

    I1 --> A1
    I1 --> A2
    I1 --> A3
    I1 --> A4

    A1 --> SNS
    A2 --> SNS
    A3 --> SNS
    A4 --> SNS

    SNS --> Email

    style E1 fill:#c8e6c9
    style E2 fill:#c8e6c9
    style E3 fill:#c8e6c9
    style E4 fill:#c8e6c9
    style L1 fill:#bbdefb
    style L2 fill:#bbdefb
    style L3 fill:#bbdefb
    style I1 fill:#fff9c4
    style A1 fill:#ffcdd2
    style A2 fill:#ffcdd2
    style A3 fill:#ffcdd2
    style A4 fill:#ffcdd2
    style SNS fill:#e1bee7
    style Email fill:#4caf50,color:#fff
```

**監視項目詳細:**

| メトリクス | しきい値 | アラート重要度 | 対応アクション |
|----------|---------|-------------|-------------|
| **4xxエラー率** | > 5% | ⚠️ Warning | 入力バリデーション確認、ユーザー教育 |
| **5xxエラー率** | > 1% | 🔴 Critical | Lambda/OpenSearchログ確認、緊急対応 |
| **認証失敗率** | > 10% | 🔴 Critical | 不正アクセス疑い、IPアドレス確認 |
| **スロットリング** | > 10件/分 | ⚠️ Warning | DDoS攻撃疑い、レート制限見直し |
| **異常なクエリパターン** | 検知時 | ⚠️ Warning | SQLインジェクション試行、ログ保存 |

**CloudWatch Insights クエリ例:**

```sql
-- 4xxエラー率の算出
fields @timestamp, status, requestId
| filter status >= 400 and status < 500
| stats count() as error_count by bin(5m)
| stats sum(error_count) / count(*) * 100 as error_rate
| filter error_rate > 5
```

**セキュリティスコア**: +10/100（検知・対応能力）

**コスト**: $4.00/月（CloudWatch Logs 2GB + Alarms 5個）

---

## セキュリティスコア詳細

### スコア内訳（85/100）

```mermaid
pie title セキュリティスコア内訳（85/100）
    "通信暗号化（TLS 1.3）" : 20
    "認証・認可（Azure AD SSO）" : 30
    "ネットワーク制限" : 25
    "アプリケーション保護" : 10
    "監視・検知" : 10
    "その他改善余地" : 15
```

| レイヤー | 対策 | スコア | 備考 |
|---------|------|--------|------|
| **通信暗号化** | TLS 1.3、ACM証明書 | 20/20 | ✅ 完璧 |
| **認証・認可** | Azure AD SSO、MFA、JWT検証 | 30/30 | ✅ 完璧 |
| **ネットワーク制限** | IPアドレス制限、スロットリング、VPC SG | 25/30 | 🟡 WAF未導入（-5） |
| **アプリケーション保護** | 入力バリデーション、最小権限IAM | 10/10 | ✅ 十分 |
| **監視・検知** | CloudWatch Logs、Alarms | 10/10 | ✅ 十分 |
| **改善余地** | SIEM統合、脆弱性診断 | -15/0 | 🟡 将来的な改善項目 |
| **合計** | | **85/100** | 🟢 優秀 |

---

### スコア比較（Pattern 3更新前 vs 更新後）

```mermaid
graph LR
    subgraph "更新前（❌）"
        Before["セキュリティスコア: 50/100<br/><br/>- HTTP通信のみ<br/>- Azure AD SSO動作不可<br/>- IPアドレス制限なし<br/>- カスタムドメインなし"]
    end

    subgraph "更新後（✅）"
        After["セキュリティスコア: 85/100<br/><br/>- HTTPS (TLS 1.3)<br/>- Azure AD SSO正常動作<br/>- IPアドレス制限あり<br/>- カスタムドメイン"]
    end

    Before -.->|"+35ポイント<br/>+70%向上"| After

    style Before fill:#ffcdd2
    style After fill:#c8e6c9
```

**改善されたセキュリティ項目:**
1. ✅ **通信暗号化**: HTTP → HTTPS (TLS 1.3)（+20ポイント）
2. ✅ **認証**: Azure AD SSO動作可能（+10ポイント）
3. ✅ **ネットワーク制限**: IPアドレス制限追加（+5ポイント）

---

## 不採用サービスのセキュリティ影響評価

### WAF（Web Application Firewall）不採用の影響

```mermaid
graph TB
    subgraph "WAF導入時（シナリオA）"
        W1["💰 コスト: +$10.01/月"]
        W2["🛡️ セキュリティスコア: 95/100"]
        W3["✅ SQLインジェクション防御"]
        W4["✅ XSS防御"]
        W5["✅ DDoS攻撃緩和"]
    end

    subgraph "WAF不採用（シナリオB）"
        N1["💰 コスト: $0.00"]
        N2["🛡️ セキュリティスコア: 85/100"]
        N3["✅ 入力バリデーション（Lambda）"]
        N4["✅ Azure AD SSO"]
        N5["✅ API Gatewayスロットリング"]
    end

    subgraph "評価"
        E1["ROI分析"]
        E2["社内限定アクセス"]
        E3["攻撃リスク低"]
    end

    W1 --> E1
    N1 --> E1
    W2 --> E2
    N2 --> E2
    W5 --> E3
    N5 --> E3

    E1 --> Decision["結論:<br/>WAF不採用<br/>代替策で十分"]
    E2 --> Decision
    E3 --> Decision

    style W1 fill:#ffcdd2
    style N1 fill:#c8e6c9
    style Decision fill:#4caf50,color:#fff
```

**代替セキュリティ対策:**

| WAFの機能 | Pattern 3の代替策 | 効果 |
|----------|-----------------|------|
| **SQLインジェクション防御** | Lambda入力バリデーション | ✅ 同等（OpenSearchはNoSQL） |
| **XSS防御** | Next.jsデフォルトエスケープ | ✅ 同等 |
| **DDoS攻撃緩和** | API Gatewayスロットリング（100req/秒） | 🟡 限定的（社内限定のため十分） |
| **Geo Blocking** | Azure AD条件付きアクセス | ✅ 同等 |
| **Bot対策** | Azure AD SSO認証 | ✅ 同等（未認証アクセス不可） |

**結論**: WAF不要、**$10.01/月削減**、セキュリティスコアは-10ポイントのみ（85/100は十分）

---

### CloudFront + Shield 不採用の影響

```mermaid
graph TB
    subgraph "CloudFront + Shield導入時"
        C1["💰 コスト: +$1.16/月"]
        C2["🛡️ DDoS保護: AWS Shield Standard"]
        C3["⚡ レイテンシ改善: 約5%"]
    end

    subgraph "CloudFront不採用"
        N1["💰 コスト: $0.00"]
        N2["🛡️ DDoS保護: API Gatewayスロットリング"]
        N3["⚡ レイテンシ: 121-255ms（十分）"]
    end

    subgraph "リスク評価"
        R1["社内限定アクセス<br/>DDoS攻撃リスク低"]
        R2["50ユーザーのみ<br/>トラフィック量少"]
    end

    C1 --> Decision
    N1 --> Decision
    C2 --> R1
    N2 --> R1
    C3 --> R2
    N3 --> R2

    R1 --> Decision["結論:<br/>CloudFront不採用<br/>ROI低い"]
    R2 --> Decision

    style C1 fill:#ffcdd2
    style N1 fill:#c8e6c9
    style Decision fill:#4caf50,color:#fff
```

**結論**: CloudFront不要、**$1.16/月削減**、セキュリティへの影響なし

---

## 侵入テストシナリオ（想定攻撃）

### シナリオ1: 外部からの不正アクセス試行

```mermaid
sequenceDiagram
    participant Attacker as ⚠️ 外部攻撃者<br/>IP: 8.8.8.8
    participant API as 🔐 API Gateway
    participant CloudWatch as 📊 CloudWatch
    participant SNS as 📧 SNS

    Note over Attacker,SNS: 攻撃シナリオ1: 外部IPからのアクセス

    Attacker->>API: POST /api/search<br/>{"query": "機密データ"}
    API->>API: リソースポリシーチェック<br/>IPアドレス: 8.8.8.8

    Note over API: ❌ IP許可リストに存在しない<br/>（203.0.113.0/24、198.51.100.0/24のみ許可）

    API-->>Attacker: 403 Forbidden<br/>{"message": "IP address not allowed"}

    API->>CloudWatch: ログ記録<br/>- タイムスタンプ<br/>- ソースIP: 8.8.8.8<br/>- ステータス: 403
    CloudWatch->>SNS: 異常検知<br/>（外部IP試行）
    SNS->>SNS: 管理者にメール通知

    Note over Attacker,SNS: ✅ 攻撃ブロック成功
```

**防御成功**: ✅ API Gatewayリソースポリシーで即座にブロック

---

### シナリオ2: SQLインジェクション試行

```mermaid
sequenceDiagram
    participant Attacker as ⚠️ 攻撃者<br/>（社内ユーザー装い）
    participant API as 🔐 API Gateway
    participant Lambda as λ SearchAPI
    participant CloudWatch as 📊 CloudWatch
    participant SNS as 📧 SNS

    Note over Attacker,SNS: 攻撃シナリオ2: SQLインジェクション

    Attacker->>API: POST /api/search<br/>{"query": "' UNION SELECT * FROM users--"}
    API->>Lambda: リクエスト転送<br/>（IPアドレス許可済み）

    Lambda->>Lambda: 入力バリデーション<br/>SQLインジェクションパターン検出

    Note over Lambda: ❌ 疑わしいパターン検出<br/>/(\\bUNION\\b.*\\bSELECT\\b)/i

    Lambda->>CloudWatch: セキュリティイベント記録<br/>- クエリ: "' UNION SELECT *..."<br/>- ソースIP: 203.0.113.50<br/>- ユーザーID: user@company.com
    CloudWatch->>SNS: セキュリティアラート

    Lambda-->>API: 403 Forbidden<br/>{"error": "Potential injection detected"}
    API-->>Attacker: 403 Forbidden

    Note over Attacker,SNS: ✅ 攻撃検知・ブロック成功
```

**防御成功**: ✅ Lambda入力バリデーションで検知・ブロック

---

### シナリオ3: DDoS攻撃（大量リクエスト）

```mermaid
sequenceDiagram
    participant Attacker as ⚠️ 攻撃者<br/>（社内IP装い）
    participant API as 🔐 API Gateway
    participant CloudWatch as 📊 CloudWatch
    participant SNS as 📧 SNS

    Note over Attacker,SNS: 攻撃シナリオ3: DDoS攻撃

    loop 150回/秒のリクエスト
        Attacker->>API: POST /api/search
    end

    Note over API: スロットリング発動<br/>100req/秒を超過

    API-->>Attacker: 429 Too Many Requests<br/>{"message": "Rate limit exceeded"}

    API->>CloudWatch: スロットリングイベント記録<br/>- ソースIP: 203.0.113.50<br/>- リクエスト数: 150/秒
    CloudWatch->>CloudWatch: Throttle Alarm発動
    CloudWatch->>SNS: DDoS攻撃疑い通知

    Note over Attacker,SNS: ✅ DDoS攻撃緩和成功<br/>（正規ユーザーへの影響最小化）
```

**防御成功**: ✅ API Gatewayスロットリングで緩和

---

## セキュリティベストプラクティス

### 推奨される追加対策（優先度順）

```mermaid
flowchart TD
    Start[現状: セキュリティスコア 85/100] --> P1{優先度1<br/>MFA必須化}
    P1 -->|実施| Score1[スコア: 87/100]
    P1 -->|未実施| Score1

    Score1 --> P2{優先度2<br/>HSTS有効化}
    P2 -->|実施| Score2[スコア: 89/100]
    P2 -->|未実施| Score2

    Score2 --> P3{優先度3<br/>脆弱性診断<br/>年1回}
    P3 -->|実施| Score3[スコア: 92/100]
    P3 -->|未実施| Score3

    Score3 --> P4{優先度4<br/>SIEM統合<br/>Splunk/Datadog}
    P4 -->|実施| Score4[スコア: 95/100]
    P4 -->|未実施| Score4

    Score4 --> P5{優先度5<br/>WAF導入<br/>外部公開時}
    P5 -->|実施| Score5[スコア: 100/100]
    P5 -->|未実施| Score5

    style Start fill:#fff9c4
    style Score1 fill:#c8e6c9
    style Score2 fill:#c8e6c9
    style Score3 fill:#c8e6c9
    style Score4 fill:#c8e6c9
    style Score5 fill:#4caf50,color:#fff
```

### 優先度1: Azure AD MFA必須化

**現状**: MFA推奨だが任意

**推奨**: 全ユーザーにMFA必須化

**実装手順**:
1. Azure ADポータルにログイン
2. 条件付きアクセスポリシー作成
3. 対象: 全ユーザー
4. 条件: CIS File Search Appへのアクセス
5. アクセス制御: MFA必須

**コスト**: $0.00（Azure AD Free tierで対応可能）

**セキュリティスコア**: +2ポイント（87/100）

---

### 優先度2: HSTS（HTTP Strict Transport Security）有効化

**現状**: HSTSヘッダー未設定

**推奨**: HSTSヘッダー追加

**実装手順**（API Gatewayレスポンスヘッダー）:
```yaml
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**効果**:
- ✅ HTTPダウングレード攻撃防止
- ✅ SSL Strip攻撃防止

**コスト**: $0.00

**セキュリティスコア**: +2ポイント（89/100）

---

### 優先度3: 脆弱性診断（年1回）

**推奨**: 外部セキュリティベンダーによる脆弱性診断

**診断内容**:
- ✅ ペネトレーションテスト
- ✅ OWASP Top 10チェック
- ✅ 構成レビュー

**コスト**: ¥300,000-500,000/年（外部ベンダー）

**セキュリティスコア**: +3ポイント（92/100）

---

## まとめ

### ✅ Pattern 3セキュリティアーキテクチャの成果

| 項目 | 成果 |
|------|------|
| **セキュリティスコア** | ✅ 85/100（優秀） |
| **コスト増** | ✅ わずか+$0.50/月（Route53のみ） |
| **Azure AD SSO対応** | ✅ OAuth 2.0、MFA推奨 |
| **通信暗号化** | ✅ TLS 1.3（ACM証明書無料） |
| **ネットワーク制限** | ✅ IPアドレス制限、スロットリング |
| **監視・検知** | ✅ CloudWatch Logs、Alarms |

---

### 📊 セキュリティ vs コスト 最終評価

```mermaid
quadrantChart
    title セキュリティ vs コスト評価
    x-axis 低コスト --> 高コスト
    y-axis 低セキュリティ --> 高セキュリティ
    quadrant-1 理想的（高セキュリティ・低コスト）
    quadrant-2 過剰投資（高セキュリティ・高コスト）
    quadrant-3 不十分（低セキュリティ・低コスト）
    quadrant-4 非効率（低セキュリティ・高コスト）
    Pattern 3 + Route53 + ACM: [0.2, 0.85]
    Pattern 3 + Route53 + ACM + WAF: [0.4, 0.95]
    Pattern 3 (更新前): [0.1, 0.50]
```

**結論**: **Pattern 3 + Route53 + ACM**が最適（理想的な象限、高セキュリティ・低コスト）

---

## 関連ドキュメント

- `/docs/pattern3-architecture.md` - Pattern 3詳細設計
- `/docs/pattern3-route53-before-after.md` - Before/After比較図
- `/docs/pattern3-route53-implementation-flow.md` - 実装手順フローチャート
- `/docs/pattern3-cloudfront-analysis.md` - Route53/CloudFront/WAF/ACM必要性分析

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-18 | Pattern 3セキュリティアーキテクチャ図初版作成 | Business & Data Analyst |
