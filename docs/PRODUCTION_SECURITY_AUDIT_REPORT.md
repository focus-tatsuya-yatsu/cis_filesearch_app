# 本番環境セキュリティ監査レポート

**対象システム**: CIS File Search Application
**監査実施日**: 2025-12-17
**監査対象**: Lambda API (cis-search-api-prod) + Next.jsフロントエンド + API Gateway + OpenSearch
**監査基準**: OWASP Top 10 (2021), AWS Well-Architected Framework (Security Pillar), NIST Cybersecurity Framework

---

## エグゼクティブサマリー

### 総合リスクレベル: **MEDIUM-HIGH** ⚠️

本監査では、CIS File Search Applicationの本番環境において、**16件のセキュリティ問題**を特定しました。
- **P0 (緊急)**: 4件 - 即時対応が必要
- **P1 (高優先度)**: 6件 - 1週間以内に対応が必要
- **P2 (中優先度)**: 4件 - 今スプリント内に対応推奨
- **P3 (低優先度)**: 2件 - バックログで管理

### 主要な懸念事項

1. **CORS設定がワイルドカード (`*`) を使用** - 認証トークン窃取のリスク
2. **SSL証明書検証の無効化** - 中間者攻撃 (MITM) のリスク
3. **CloudWatch Logsに機密情報が記録される可能性** - GDPR違反リスク
4. **IAMロールの権限が過剰** - 最小権限原則違反
5. **WAF未導入** - DDoS/SQLインジェクション対策不足

### 良好な点

✅ **依存関係の脆弱性ゼロ** - npm auditで脆弱性なし
✅ **Cognito認証の強力なパスワードポリシー** - 12文字以上、複雑性要求
✅ **VPC分離** - Lambda/OpenSearchがプライベートサブネットに配置
✅ **入力バリデーション** - XSS/インジェクション対策実装済み
✅ **CloudWatch監視** - エラー、スロットル、レイテンシのアラーム設定

---

## P0: 緊急対応が必要な脆弱性

### 🔴 P0-1: CORS設定がワイルドカード (`*`) を使用

**脆弱性**: A05:2021 - Security Misconfiguration
**CVSS Score**: **8.1 (High)**
**影響範囲**: Lambda関数 (`index.ts`, `error-handler.ts`)

#### 問題箇所

**ファイル**: `/backend/lambda-search-api/src/index.ts` (Lines 115-117)
```typescript
headers: {
  'Access-Control-Allow-Origin': '*',  // ⚠️ 任意のドメインからのアクセスを許可
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}
```

**ファイル**: `/backend/lambda-search-api/src/utils/error-handler.ts` (Lines 115-120)
```typescript
headers: {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',  // ⚠️ 同様の問題
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}
```

#### 攻撃シナリオ

1. 攻撃者が悪意のあるウェブサイト `https://evil.com` を作成
2. ユーザーがログイン状態でこのサイトを訪問
3. JavaScriptが `Authorization` ヘッダー付きでAPI Gatewayにリクエスト
4. **CORSが `*` のため、攻撃者がユーザーの検索結果や認証トークンを窃取**

#### ビジネスインパクト

- **機密ファイル情報の漏洩**: 社内NASファイルのパス、ファイル名、内容スニペットが外部に流出
- **GDPR違反**: 個人データの不正アクセス (Article 32: Security of processing)
- **コンプライアンス違反**: SOC 2 CC6.1 (Logical and Physical Access Controls) 違反
- **レピュテーションリスク**: データ漏洩による企業信頼性の喪失

#### 修正方法

**Lambda関数のCORS設定を特定ドメインに制限**

```typescript
// ❌ 脆弱なコード
'Access-Control-Allow-Origin': '*'

// ✅ セキュアなコード
'Access-Control-Allow-Origin': process.env.FRONTEND_DOMAIN || 'https://your-domain.com'
```

**推奨実装** (`src/index.ts` および `src/utils/error-handler.ts`):

```typescript
/**
 * セキュアなCORSヘッダーを生成
 */
function getSecureCorsHeaders(): Record<string, string> {
  const allowedOrigins = [
    process.env.FRONTEND_DOMAIN,
    // 開発環境のみ localhost を許可
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : [])
  ].filter(Boolean);

  // リクエスト元のOriginを取得
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const allowedOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0];

  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true', // Cookieを使用する場合
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', // HSTS
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
  };
}
```

**Terraform側の設定も更新** (`terraform/api_gateway_cognito.tf`):

```hcl
resource "aws_api_gateway_integration_response" "search_options" {
  # ...
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    # ✅ ワイルドカードを使わない
    "method.response.header.Access-Control-Allow-Origin"  = "'https://${var.frontend_domain}'"
  }
}
```

#### 対応期限: **即時 (24時間以内)**

---

### 🔴 P0-2: SSL証明書検証の無効化 (開発環境用設定が本番環境に流出)

**脆弱性**: A02:2021 - Cryptographic Failures
**CVSS Score**: **7.4 (High)**
**影響範囲**: OpenSearch接続 (`opensearch.service.ts`)

#### 問題箇所

**ファイル**: `/backend/lambda-search-api/src/services/opensearch.service.ts` (Lines 66-68, 81-82)

```typescript
const agent = new https.Agent({
  rejectUnauthorized: false, // ⚠️ SSL証明書の検証を無効化
});

clientConfig = {
  // ...
  ssl: {
    rejectUnauthorized: false, // ⚠️ MITM攻撃に脆弱
  },
  agent,
}
```

#### 攻撃シナリオ

1. 攻撃者がVPC内のネットワークトラフィックを傍受 (Man-in-the-Middle)
2. OpenSearchへの通信を偽装されたエンドポイントにリダイレクト
3. **検索クエリ、結果、認証情報が攻撃者に漏洩**
4. 攻撃者が偽のデータを返すことでアプリケーションを操作

#### ビジネスインパクト

- **機密データの傍受**: 全検索クエリと結果が攻撃者に漏洩
- **データ整合性の喪失**: 偽のデータ注入による誤情報の拡散
- **PCI-DSS違反**: Requirement 4.1 (Use strong cryptography and security protocols)

#### 修正方法

**SSL証明書検証を有効化し、環境変数で制御**

```typescript
// ❌ 脆弱なコード
ssl: {
  rejectUnauthorized: false,
}

// ✅ セキュアなコード (環境変数で制御)
ssl: {
  rejectUnauthorized: process.env.NODE_ENV === 'production', // 本番では必ずtrue
}
```

**推奨実装**:

```typescript
export async function getOpenSearchClient(): Promise<Client> {
  // ...
  const isProduction = process.env.NODE_ENV === 'production';

  // 本番環境では SSL 検証を必ず有効化
  if (useIp && !isProduction) {
    logger.warn('⚠️ SSL certificate verification is disabled (DEVELOPMENT ONLY)');

    const agent = new https.Agent({
      rejectUnauthorized: false,
    });

    clientConfig = {
      // ...
      ssl: { rejectUnauthorized: false },
      agent,
    };
  } else {
    // 本番環境または通常のドメイン接続
    clientConfig = {
      ...AwsSigv4Signer({
        region: config.region,
        service: 'es',
        getCredentials: () => defaultProvider()(),
      }),
      node: config.endpoint,
      requestTimeout: 30000,
      maxRetries: 3,
      compression: 'gzip',
      // ✅ SSL検証を有効化
      ssl: {
        rejectUnauthorized: true,
      },
    };
  }

  // 本番環境でIPベース接続は禁止
  if (useIp && isProduction) {
    throw new Error('IP-based OpenSearch connection is not allowed in production');
  }
}
```

**環境変数の削除**:

`.env.production` から以下を削除:
```bash
# ❌ 削除
OPENSEARCH_USE_IP=true
```

#### 対応期限: **即時 (24時間以内)**

---

### 🔴 P0-3: CloudWatch Logsに機密情報が記録される可能性

**脆弱性**: A09:2021 - Security Logging and Monitoring Failures
**CVSS Score**: **6.5 (Medium)**
**影響範囲**: Logger Service (`logger.service.ts`)

#### 問題箇所

**ファイル**: `/backend/lambda-search-api/src/services/opensearch.service.ts` (Lines 146-153)

```typescript
logger.info('Executing search query', {
  query,         // ⚠️ 検索クエリに個人情報が含まれる可能性
  searchMode,
  fileType,
  size,
  from,
  sortBy,
});
```

**ファイル**: `/backend/lambda-search-api/src/index.ts` (Lines 60)

```typescript
logger.info('Search query validated', { searchQuery }); // ⚠️ クエリ全体をログ出力
```

#### 攻撃シナリオ

1. ユーザーが「田中太郎の給与明細」のような個人情報を含むクエリで検索
2. **CloudWatch Logsに個人情報が平文で記録される**
3. IAMロールを持つ開発者/運用者がログを閲覧可能
4. GDPR Article 5(1)(f) (データ保護の原則) 違反

#### ビジネスインパクト

- **GDPR違反**: 個人データの不適切な処理 (Article 32: Security of processing)
- **罰金リスク**: GDPRの場合、最大で全世界年間売上高の4%または2,000万ユーロの罰金
- **監査証跡の汚染**: 不要なPII (Personally Identifiable Information) がログに混入

#### 修正方法

**ログフィルターの実装**

```typescript
/**
 * 機密情報をマスクするユーティリティ
 */
export class SecureLogger extends Logger {
  /**
   * 個人情報を含む可能性のあるフィールドをマスク
   */
  private sanitizeLogData(data: any): any {
    if (!data || typeof data !== 'object') return data;

    const sanitized = { ...data };
    const sensitiveFields = ['query', 'q', 'email', 'name', 'password', 'token'];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        // 最初の3文字のみ表示
        sanitized[field] = this.maskString(String(sanitized[field]));
      }
    }

    return sanitized;
  }

  private maskString(str: string): string {
    if (str.length <= 3) return '***';
    return str.substring(0, 3) + '*'.repeat(Math.min(str.length - 3, 10));
  }

  info(message: string, data?: any): void {
    super.info(message, this.sanitizeLogData(data));
  }

  warn(message: string, data?: any): void {
    super.warn(message, this.sanitizeLogData(data));
  }

  error(message: string, data?: any): void {
    super.error(message, this.sanitizeLogData(data));
  }
}
```

**使用例**:

```typescript
// ❌ 脆弱なコード
logger.info('Search query validated', { searchQuery });

// ✅ セキュアなコード
logger.info('Search query validated', {
  queryLength: searchQuery.query?.length || 0,  // 長さのみ記録
  searchMode: searchQuery.searchMode,
  fileType: searchQuery.fileType,
  // query 自体は記録しない
});
```

**CloudWatch Logs Insights クエリ例** (機密情報の検出):

```sql
fields @timestamp, @message
| filter @message like /password|email|社員番号|給与/
| sort @timestamp desc
| limit 100
```

#### 対応期限: **即時 (48時間以内)**

---

### 🔴 P0-4: API Gateway のレート制限が緩い

**脆弱性**: A04:2021 - Insecure Design
**CVSS Score**: **6.5 (Medium)**
**影響範囲**: API Gateway (`api_gateway_cognito.tf`)

#### 問題箇所

**ファイル**: `/terraform/api_gateway_cognito.tf` (Lines 296-297)

```hcl
settings {
  throttling_burst_limit = 100  # ⚠️ バーストリミットが緩い
  throttling_rate_limit  = 50   # ⚠️ 1秒あたり50リクエストは過剰
}
```

#### 攻撃シナリオ

1. 攻撃者が認証トークンを窃取（または自分のアカウントで実行）
2. スクリプトで1秒間に50リクエストを連続送信
3. **OpenSearchに過負荷がかかり、正規ユーザーのサービスが停止**
4. CloudWatch Logsが大量のログで肥大化し、コストが増加

#### ビジネスインパクト

- **サービス停止 (DoS)**: 正規ユーザーがアクセスできなくなる
- **コスト増加**: Lambda実行回数、OpenSearchクエリ、CloudWatch Logsストレージの増加
- **データベース負荷**: OpenSearchのインデックスが過負荷で性能劣化

#### 修正方法

**レート制限の厳格化**

```hcl
resource "aws_api_gateway_method_settings" "all" {
  # ...
  settings {
    # ✅ より厳格なレート制限
    throttling_burst_limit = 20   # バースト時は最大20リクエスト
    throttling_rate_limit  = 10   # 1秒あたり10リクエスト

    # ✅ キャッシング有効化
    caching_enabled = true
    cache_ttl_in_seconds = 300  # 5分間キャッシュ
    cache_data_encrypted = true

    logging_level          = "INFO"
    data_trace_enabled     = true
    metrics_enabled        = true
  }
}
```

**ユーザーごとのレート制限 (Usage Plan)**:

```hcl
resource "aws_api_gateway_usage_plan" "standard" {
  name = "${var.project_name}-standard-usage-plan"

  api_stages {
    api_id = aws_api_gateway_rest_api.main.id
    stage  = aws_api_gateway_stage.prod.stage_name
  }

  # ユーザーごとの制限
  quota_settings {
    limit  = 1000  # 1日あたり1000リクエスト
    period = "DAY"
  }

  throttle_settings {
    burst_limit = 10   # バースト時最大10
    rate_limit  = 5    # 1秒あたり5リクエスト
  }
}
```

#### 対応期限: **即時 (72時間以内)**

---

## P1: 高優先度の脆弱性 (1週間以内に対応)

### 🟠 P1-1: IAMロールの権限が過剰 (最小権限原則違反)

**脆弱性**: A01:2021 - Broken Access Control
**CVSS Score**: **5.4 (Medium)**
**影響範囲**: Lambda IAM Role (`lambda_search_api.tf`)

#### 問題箇所

**ファイル**: `/terraform/lambda_search_api.tf` (Lines 44-48)

```hcl
Action = [
  "es:ESHttpGet",
  "es:ESHttpPost",
  "es:ESHttpHead"  # ⚠️ HEAD リクエストは不要
]
Resource = "${aws_opensearch_domain.main.arn}/*"  # ⚠️ 全リソースにアクセス可能
```

#### 問題点

1. **リソース範囲が広すぎる**: `/*` により全インデックス・全操作にアクセス可能
2. **不要な権限**: `ESHttpHead` は検索APIで使用していない
3. **書き込み権限のリスク**: `ESHttpPost` で誤ってデータを更新する可能性

#### 修正方法

**IAM権限の最小化**

```hcl
resource "aws_iam_role_policy" "lambda_opensearch_access" {
  name = "opensearch-access"
  role = aws_iam_role.lambda_search_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "OpenSearchReadOnlyAccess"
        Effect = "Allow"
        Action = [
          "es:ESHttpGet",   # 検索クエリ
          "es:ESHttpPost",  # 検索リクエスト (POST /_search)
        ]
        # ✅ 特定のインデックスのみに制限
        Resource = [
          "${aws_opensearch_domain.main.arn}/file-index",
          "${aws_opensearch_domain.main.arn}/file-index/_search",
        ]
      },
      {
        Sid    = "OpenSearchHealthCheck"
        Effect = "Allow"
        Action = [
          "es:ESHttpHead",  # Ping/ヘルスチェックのみ
        ]
        Resource = "${aws_opensearch_domain.main.arn}/"
      }
    ]
  })
}
```

#### 対応期限: **1週間以内**

---

### 🟠 P1-2: Cognito JWT トークンの検証不足

**脆弱性**: A07:2021 - Identification and Authentication Failures
**CVSS Score**: **6.8 (Medium)**
**影響範囲**: Lambda関数 (認証処理なし)

#### 問題箇所

**ファイル**: `/backend/lambda-search-api/src/index.ts`

現在、Lambda関数内でCognito JWTトークンの検証が行われていません。API Gatewayのオーソライザーに依存していますが、**Lambda関数が直接呼び出された場合**に認証バイパスのリスクがあります。

#### 攻撃シナリオ

1. 攻撃者がAPI Gateway以外のルート（例: EventBridgeトリガー、誤った設定）でLambda関数を直接実行
2. **認証なしで検索機能にアクセス**
3. 機密ファイル情報を窃取

#### 修正方法

**Lambda関数内でJWTトークンを検証**

```typescript
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

/**
 * Cognito JWT トークンを検証
 */
async function verifyCognitoToken(token: string): Promise<any> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const region = process.env.AWS_REGION || 'ap-northeast-1';
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

  const client = jwksClient({
    jwksUri: `${issuer}/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 86400000, // 24時間
  });

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      (header, callback) => {
        client.getSigningKey(header.kid, (err, key) => {
          if (err) {
            callback(err);
          } else {
            callback(null, key.getPublicKey());
          }
        });
      },
      {
        issuer,
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      }
    );
  });
}

/**
 * Lambda Handler
 */
export async function handler(
  event: any,
  context: Context
): Promise<APIGatewayProxyResult> {
  // ✅ JWT トークンの検証
  const authHeader = event.headers?.Authorization || event.headers?.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return createErrorResponse(401, ErrorCode.UNAUTHORIZED, 'Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);

  try {
    const decodedToken = await verifyCognitoToken(token);
    logger.info('User authenticated', {
      sub: decodedToken.sub,
      email: decodedToken.email,
    });
  } catch (error) {
    logger.warn('JWT verification failed', { error: error.message });
    return createErrorResponse(401, ErrorCode.UNAUTHORIZED, 'Invalid or expired token');
  }

  // ... 既存の処理
}
```

**依存関係の追加**:

```bash
npm install jsonwebtoken jwks-rsa
npm install --save-dev @types/jsonwebtoken @types/jwks-rsa
```

#### 対応期限: **1週間以内**

---

### 🟠 P1-3: XSS対策のサニタイゼーションが不十分

**脆弱性**: A03:2021 - Injection
**CVSS Score**: **5.4 (Medium)**
**影響範囲**: Validator (`validator.ts`)

#### 問題箇所

**ファイル**: `/backend/lambda-search-api/src/utils/validator.ts` (Lines 141-145)

```typescript
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>\"']/g, '') // ⚠️ 不十分: スクリプトタグの一部のみ削除
    .trim();
}
```

#### 問題点

1. **不完全なサニタイゼーション**: `<script>` は削除されるが、`<img onerror="...">` などは通過
2. **Unicode攻撃**: `\u003cscript\u003e` などのエンコード攻撃に脆弱
3. **HTMLエンティティ**: `&lt;script&gt;` などはデコードされない

#### 修正方法

**より厳格なサニタイゼーション**

```typescript
import DOMPurify from 'isomorphic-dompurify';

/**
 * 入力文字列を厳格にサニタイゼーション
 */
export function sanitizeInput(input: string): string {
  // 1. Unicode正規化
  const normalized = input.normalize('NFKC');

  // 2. HTMLエンティティをデコード
  const decoded = decodeHTMLEntities(normalized);

  // 3. DOMPurifyで完全なサニタイゼーション
  const sanitized = DOMPurify.sanitize(decoded, {
    ALLOWED_TAGS: [],      // HTMLタグを一切許可しない
    ALLOWED_ATTR: [],      // 属性も許可しない
    KEEP_CONTENT: true,    // コンテンツは保持
  });

  // 4. 制御文字の削除
  return sanitized
    .replace(/[\x00-\x1F\x7F]/g, '')  // 制御文字削除
    .trim();
}

function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&amp;': '&',
  };

  return text.replace(/&[a-z]+;|&#\d+;/gi, (entity) => entities[entity] || entity);
}
```

**依存関係の追加**:

```bash
npm install isomorphic-dompurify
```

#### 対応期限: **1週間以内**

---

### 🟠 P1-4: セキュリティヘッダーの不足

**脆弱性**: A05:2021 - Security Misconfiguration
**CVSS Score**: **5.3 (Medium)**
**影響範囲**: Lambda Response Headers

#### 問題箇所

現在、レスポンスに以下のセキュリティヘッダーが欠落しています:
- `Strict-Transport-Security` (HSTS)
- `Content-Security-Policy` (CSP)
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Referrer-Policy`

#### 修正方法

**セキュリティヘッダーの追加**

```typescript
export function createSuccessResponse(data: any): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_DOMAIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'private, max-age=60, must-revalidate',

      // ✅ セキュリティヘッダー
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    },
    body: JSON.stringify({
      success: true,
      data,
    }),
  };
}
```

#### 対応期限: **1週間以内**

---

### 🟠 P1-5: WAF (Web Application Firewall) 未導入

**脆弱性**: A05:2021 - Security Misconfiguration
**CVSS Score**: **6.1 (Medium)**
**影響範囲**: API Gateway

#### 問題箇所

**ファイル**: `/terraform/variables.tf` (Line 148-152)

```hcl
variable "enable_waf" {
  description = "Enable WAF for CloudFront"
  type        = bool
  default     = false  # ⚠️ WAF が無効
}
```

#### リスク

1. **SQLインジェクション**: WAFなしでは悪意のあるSQLクエリを防げない
2. **XSS攻撃**: スクリプト注入攻撃を検出できない
3. **DDoS攻撃**: レート制限以外の防御策がない
4. **OWASP Top 10攻撃**: 一般的な攻撃パターンをブロックできない

#### 修正方法

**AWS WAF v2 の導入**

```hcl
# WAF Web ACL
resource "aws_wafv2_web_acl" "api_gateway" {
  count = var.enable_waf ? 1 : 0

  name  = "${var.project_name}-api-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # ✅ AWS Managed Rules - Core Rule Set
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # ✅ SQL Injection 対策
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesSQLiRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # ✅ レート制限
  rule {
    name     = "RateLimitRule"
    priority = 3

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000  # 5分間で2000リクエスト
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitRuleMetric"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}APIGatewayWAF"
    sampled_requests_enabled   = true
  }

  tags = {
    Name        = "CIS FileSearch API WAF"
    Environment = var.environment
  }
}

# WAF Association
resource "aws_wafv2_web_acl_association" "api_gateway" {
  count        = var.enable_waf ? 1 : 0
  resource_arn = aws_api_gateway_stage.prod.arn
  web_acl_arn  = aws_wafv2_web_acl.api_gateway[0].arn
}
```

**variables.tf の更新**:

```hcl
variable "enable_waf" {
  description = "Enable WAF for API Gateway"
  type        = bool
  default     = true  # ✅ デフォルトで有効化
}
```

**コスト見積もり**:
- WAF Web ACL: $5/月
- ルールあたり: $1/月 × 3 = $3/月
- リクエスト処理: $0.60 per million requests
- **合計**: 約$10-20/月 (想定10M requests/月)

#### 対応期限: **1週間以内**

---

### 🟠 P1-6: Lambda並行実行数の制限が緩い

**脆弱性**: A04:2021 - Insecure Design
**CVSS Score**: **5.3 (Medium)**
**影響範囲**: Lambda Function (`lambda_search_api.tf`)

#### 問題箇所

**ファイル**: `/terraform/lambda_search_api.tf` (Line 141)

```hcl
reserved_concurrent_executions = 10  # ⚠️ 10並行は過剰
```

#### リスク

1. **コスト増加**: 同時に10個のLambda実行 → OpenSearchに過負荷
2. **リソース枯渇**: 他のLambda関数のクォータを消費
3. **DDoS増幅**: 攻撃者が10並行実行を悪用

#### 修正方法

```hcl
resource "aws_lambda_function" "search_api_prod" {
  # ...
  # ✅ 並行実行数を削減
  reserved_concurrent_executions = 5  # 5並行に制限

  # ✅ プロビジョニング済み同時実行数（オプション）
  # reserved_concurrent_executions の一部をウォームスタンバイ
}

# プロビジョニング済み同時実行数の設定（レイテンシ改善）
resource "aws_lambda_provisioned_concurrency_config" "search_api" {
  function_name                     = aws_lambda_function.search_api_prod.function_name
  provisioned_concurrent_executions = 2  # 常時2インスタンスを待機
  qualifier                         = aws_lambda_alias.search_api_prod.name
}

resource "aws_lambda_alias" "search_api_prod" {
  name             = "prod"
  function_name    = aws_lambda_function.search_api_prod.function_name
  function_version = aws_lambda_function.search_api_prod.version
}
```

#### 対応期限: **1週間以内**

---

## P2: 中優先度の脆弱性 (今スプリント内に対応)

### 🟡 P2-1: 環境変数にハードコードされたHostヘッダー

**脆弱性**: A05:2021 - Security Misconfiguration
**CVSS Score**: **4.3 (Medium)**
**影響範囲**: OpenSearch Service (`opensearch.service.ts`)

#### 問題箇所

**ファイル**: `/backend/lambda-search-api/src/services/opensearch.service.ts` (Line 88)

```typescript
headers: {
  'Host': 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com',  // ⚠️ ハードコード
}
```

#### 問題点

1. **保守性の低下**: OpenSearchドメインを変更するとコードも変更が必要
2. **環境間の不整合**: dev/staging/prodで異なるドメインを使用する場合に問題

#### 修正方法

```typescript
headers: {
  'Host': new URL(config.endpoint).hostname,  // ✅ 環境変数から動的に取得
}
```

#### 対応期限: **今スプリント内**

---

### 🟡 P2-2: CloudWatch Logs の保持期間が短い

**脆弱性**: A09:2021 - Security Logging and Monitoring Failures
**CVSS Score**: **3.1 (Low)**
**影響範囲**: CloudWatch Log Groups

#### 問題箇所

**ファイル**: `/terraform/lambda_search_api.tf` (Line 155)

```hcl
retention_in_days = 30  # ⚠️ 30日は短い
```

#### リスク

1. **インシデント調査不能**: 31日以前のログが自動削除される
2. **コンプライアンス違反**: SOC 2では90日以上のログ保持が推奨
3. **監査証跡の欠落**: GDPR違反調査時にログが残っていない

#### 修正方法

```hcl
resource "aws_cloudwatch_log_group" "search_api" {
  name              = "/aws/lambda/${aws_lambda_function.search_api_prod.function_name}"
  retention_in_days = 90  # ✅ 90日に延長

  # ✅ ログの暗号化
  kms_key_id = aws_kms_key.cloudwatch_logs.arn

  tags = {
    Name        = "CIS Search API Logs"
    Environment = var.environment
  }
}

# KMS キーの作成
resource "aws_kms_key" "cloudwatch_logs" {
  description             = "KMS key for CloudWatch Logs encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "Allow CloudWatch Logs"
        Effect = "Allow"
        Principal = {
          Service = "logs.${var.aws_region}.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:CreateGrant",
          "kms:DescribeKey"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_kms_alias" "cloudwatch_logs" {
  name          = "alias/${var.project_name}-cloudwatch-logs"
  target_key_id = aws_kms_key.cloudwatch_logs.key_id
}
```

#### 対応期限: **今スプリント内**

---

### 🟡 P2-3: エラーメッセージに詳細情報が含まれる

**脆弱性**: A05:2021 - Security Misconfiguration
**CVSS Score**: **4.3 (Medium)**
**影響範囲**: Error Handler (`error-handler.ts`)

#### 問題箇所

**ファイル**: `/backend/lambda-search-api/src/utils/error-handler.ts` (Lines 86-92)

```typescript
const isDevelopment = process.env.NODE_ENV === 'development';
return createErrorResponse(
  500,
  ErrorCode.INTERNAL_ERROR,
  'Internal server error',
  isDevelopment ? { originalError: error.message } : undefined  // ⚠️ スタックトレースが漏洩
);
```

#### リスク

1. **情報漏洩**: エラーメッセージにファイルパス、バージョン情報が含まれる
2. **攻撃者への情報提供**: システム構成が推測される

#### 修正方法

```typescript
// ❌ 脆弱なコード
isDevelopment ? { originalError: error.message } : undefined

// ✅ セキュアなコード
process.env.NODE_ENV === 'development' ? {
  errorId: generateErrorId(),  // エラーIDのみを返す
  // originalError は CloudWatch Logs にのみ記録
} : undefined

/**
 * エラーIDを生成（CloudWatch Logsと紐付け）
 */
function generateErrorId(): string {
  return `ERR-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
}
```

**エラーハンドリングの改善**:

```typescript
export function handleError(error: any): APIGatewayProxyResult {
  const errorId = generateErrorId();

  // ✅ 詳細はCloudWatch Logsにのみ記録
  logger.error('Error occurred', {
    errorId,
    error: error.message,
    stack: error.stack,
    type: error.constructor.name,
  });

  // ユーザーにはエラーIDのみを返す
  const isDevelopment = process.env.NODE_ENV === 'development';
  return createErrorResponse(
    500,
    ErrorCode.INTERNAL_ERROR,
    'Internal server error. Please contact support with error ID.',
    { errorId }  // エラーIDのみ
  );
}
```

#### 対応期限: **今スプリント内**

---

### 🟡 P2-4: X-Ray トレーシングが有効だがサンプリングレートが高すぎる

**脆弱性**: A09:2021 - Security Logging and Monitoring Failures
**CVSS Score**: **3.1 (Low)**
**影響範囲**: API Gateway

#### 問題箇所

**ファイル**: `/terraform/api_gateway_cognito.tf` (Line 268)

```hcl
xray_tracing_enabled = true  # ⚠️ サンプリングレートが設定されていない
```

#### リスク

1. **コスト増加**: 全リクエストがトレースされるとX-Ray料金が高額化
2. **パフォーマンス低下**: トレーシングオーバーヘッドが発生

#### 修正方法

**X-Ray サンプリングルールの設定**:

```hcl
resource "aws_xray_sampling_rule" "api_gateway" {
  rule_name      = "${var.project_name}-api-sampling-rule"
  priority       = 1000
  version        = 1
  reservoir_size = 1    # 最低1リクエスト/秒はトレース
  fixed_rate     = 0.05 # 5%のリクエストをサンプリング
  url_path       = "/search"
  host           = "*"
  http_method    = "*"
  service_type   = "AWS::ApiGateway::Stage"
  service_name   = "*"
  resource_arn   = "*"

  attributes = {
    Environment = var.environment
  }
}
```

**Lambda関数でもX-Ray有効化**:

```hcl
resource "aws_lambda_function" "search_api_prod" {
  # ...
  tracing_config {
    mode = "Active"  # X-Rayトレーシング有効化
  }
}
```

#### 対応期限: **今スプリント内**

---

## P3: 低優先度の改善提案 (バックログで管理)

### 🟢 P3-1: Secrets Manager の導入

**推奨事項**: 環境変数で管理されている機密情報をAWS Secrets Managerに移行

#### 現状

環境変数で以下を管理:
- `OPENSEARCH_ENDPOINT`
- Cognito関連の設定

#### 推奨実装

```hcl
resource "aws_secretsmanager_secret" "opensearch_credentials" {
  name                    = "${var.project_name}/opensearch/credentials"
  recovery_window_in_days = 30

  tags = {
    Name        = "CIS OpenSearch Credentials"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "opensearch_credentials" {
  secret_id = aws_secretsmanager_secret.opensearch_credentials.id
  secret_string = jsonencode({
    endpoint = aws_opensearch_domain.main.endpoint
    index    = "file-index"
  })
}

# Lambda IAM権限追加
resource "aws_iam_role_policy" "lambda_secrets_manager" {
  name = "secrets-manager-access"
  role = aws_iam_role.lambda_search_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = aws_secretsmanager_secret.opensearch_credentials.arn
      }
    ]
  })
}
```

**Lambda関数での使用**:

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function getOpenSearchConfig(): Promise<OpenSearchConfig> {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });

  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: `${process.env.PROJECT_NAME}/opensearch/credentials`,
    })
  );

  const secret = JSON.parse(response.SecretString!);

  return {
    endpoint: secret.endpoint,
    index: secret.index,
    region: process.env.AWS_REGION || 'ap-northeast-1',
  };
}
```

---

### 🟢 P3-2: GuardDuty の導入

**推奨事項**: AWS GuardDutyで異常なAPIアクティビティを検出

```hcl
resource "aws_guardduty_detector" "main" {
  enable = true

  datasources {
    s3_logs {
      enable = true
    }
    kubernetes {
      audit_logs {
        enable = false  # EKS未使用
      }
    }
  }

  tags = {
    Name        = "CIS FileSearch GuardDuty"
    Environment = var.environment
  }
}

# GuardDuty Findings を SNS に送信
resource "aws_cloudwatch_event_rule" "guardduty_findings" {
  name        = "${var.project_name}-guardduty-findings"
  description = "Capture GuardDuty findings"

  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Finding"]
  })
}

resource "aws_cloudwatch_event_target" "guardduty_sns" {
  rule      = aws_cloudwatch_event_rule.guardduty_findings.name
  target_id = "SendToSNS"
  arn       = aws_sns_topic.alerts.arn
}
```

---

## コンプライアンスギャップ分析

### GDPR (General Data Protection Regulation)

| 要件 | 対応状況 | ギャップ | 推奨対策 |
|------|---------|---------|---------|
| **Article 32: Security of processing** | ⚠️ 部分対応 | - CORS設定が `*`<br>- CloudWatch Logsに個人情報 | P0-1, P0-3の修正 |
| **Article 5(1)(f): Integrity and confidentiality** | ⚠️ 部分対応 | SSL証明書検証無効化 | P0-2の修正 |
| **Article 33: Notification of breach** | ✅ 対応済み | - | GuardDuty導入で強化 (P3-2) |
| **Article 15: Right of access** | ✅ 対応済み | - | 監査ログで対応可能 |

### SOC 2 (Service Organization Control 2)

| 信頼サービス基準 | 対応状況 | ギャップ | 推奨対策 |
|------------------|---------|---------|---------|
| **CC6.1: Logical Access Controls** | ⚠️ 部分対応 | IAMロール権限過剰 | P1-1の修正 |
| **CC6.6: Encryption** | ⚠️ 部分対応 | CloudWatch Logs暗号化なし | P2-2の修正 |
| **CC6.7: Transmission Encryption** | ⚠️ 部分対応 | SSL証明書検証無効化 | P0-2の修正 |
| **CC7.2: Monitoring** | ✅ 対応済み | - | X-Rayで強化 (P2-4) |

### PCI-DSS (Payment Card Industry Data Security Standard)

| 要件 | 対応状況 | ギャップ | 推奨対策 |
|------|---------|---------|---------|
| **Requirement 4.1: Strong cryptography** | ⚠️ 部分対応 | SSL証明書検証無効化 | P0-2の修正 |
| **Requirement 6.5.7: XSS Prevention** | ⚠️ 部分対応 | サニタイゼーション不十分 | P1-3の修正 |
| **Requirement 10.1: Audit logs** | ✅ 対応済み | - | ログ保持期間延長 (P2-2) |

---

## 優先度別アクションプラン

### 即時対応 (24-72時間以内)

| 優先度 | 脆弱性 | 担当 | 工数 | 期限 |
|-------|-------|------|------|------|
| **P0-1** | CORS設定修正 | Backend Dev | 2時間 | 24時間以内 |
| **P0-2** | SSL証明書検証有効化 | Backend Dev | 1時間 | 24時間以内 |
| **P0-3** | ログサニタイゼーション | Backend Dev | 3時間 | 48時間以内 |
| **P0-4** | レート制限厳格化 | DevOps | 2時間 | 72時間以内 |

### 今週中 (1週間以内)

| 優先度 | 脆弱性 | 担当 | 工数 | 期限 |
|-------|-------|------|------|------|
| **P1-1** | IAM権限最小化 | DevOps | 4時間 | 1週間 |
| **P1-2** | JWT検証実装 | Backend Dev | 8時間 | 1週間 |
| **P1-3** | XSSサニタイゼーション強化 | Backend Dev | 4時間 | 1週間 |
| **P1-4** | セキュリティヘッダー追加 | Backend Dev | 2時間 | 1週間 |
| **P1-5** | WAF導入 | DevOps | 6時間 | 1週間 |
| **P1-6** | Lambda並行実行制限 | DevOps | 2時間 | 1週間 |

### 今スプリント (2週間以内)

| 優先度 | 脆弱性 | 担当 | 工数 | 期限 |
|-------|-------|------|------|------|
| **P2-1** | Hostヘッダー動的化 | Backend Dev | 1時間 | 2週間 |
| **P2-2** | ログ保持期間延長 | DevOps | 2時間 | 2週間 |
| **P2-3** | エラーメッセージ改善 | Backend Dev | 3時間 | 2週間 |
| **P2-4** | X-Rayサンプリング設定 | DevOps | 2時間 | 2週間 |

### バックログ (次スプリント以降)

- **P3-1**: Secrets Manager導入 (工数: 8時間)
- **P3-2**: GuardDuty導入 (工数: 4時間)

---

## 検証チェックリスト

### デプロイ前の必須確認事項

- [ ] CORS設定が特定ドメインに制限されているか (`Access-Control-Allow-Origin: https://your-domain.com`)
- [ ] SSL証明書検証が有効化されているか (`rejectUnauthorized: true`)
- [ ] CloudWatch Logsに個人情報が記録されていないか (ログフィルター実装済み)
- [ ] レート制限が適切に設定されているか (10 req/sec以下)
- [ ] IAM権限が最小権限原則に従っているか
- [ ] JWT検証が実装されているか
- [ ] セキュリティヘッダーが全レスポンスに含まれているか
- [ ] WAFが有効化されているか
- [ ] 依存関係の脆弱性がゼロか (`npm audit`)

### 定期監査項目 (月次)

- [ ] CloudWatch Logsで異常なAPIアクティビティがないか確認
- [ ] IAMロール権限の定期レビュー
- [ ] 依存関係の脆弱性スキャン (`npm audit`)
- [ ] WAFブロックログの分析
- [ ] X-Rayトレースで異常なレイテンシがないか確認
- [ ] Cognito認証失敗ログの確認

---

## コスト影響分析

| 対策 | 月額コスト増加 | 理由 |
|------|---------------|------|
| **WAF導入** | +$10-20 | Web ACL + ルール料金 |
| **CloudWatch Logs保持期間延長** | +$2-5 | ストレージ増加 (30日→90日) |
| **X-Rayサンプリング** | ±$0 | サンプリングレート5%で実質コスト変化なし |
| **Secrets Manager** | +$0.40 | シークレット1つあたり |
| **GuardDuty** | +$5-10 | ログ分析料金 |
| **合計** | **+$17-35/月** | - |

**ROI分析**: データ漏洩1件の平均コストは約$4.35M (IBM調査) であり、月額$35のセキュリティ投資は十分に正当化されます。

---

## まとめ

### 即時対応が必要な項目

1. ✅ **CORS設定をワイルドカードから特定ドメインに変更** (P0-1)
2. ✅ **SSL証明書検証を有効化** (P0-2)
3. ✅ **CloudWatch Logsのサニタイゼーション** (P0-3)
4. ✅ **レート制限の厳格化** (P0-4)

### セキュリティ成熟度の向上

現在の成熟度: **Level 2 (Managed) → Level 3 (Defined) へ移行中**

| レベル | 状態 | 説明 |
|-------|------|------|
| Level 1 | Initial | アドホックなセキュリティ対策 |
| **Level 2** | **Managed** | **基本的なセキュリティ対策が実装されている (現在)** |
| **Level 3** | **Defined** | **標準化されたセキュリティプロセスが確立 (目標)** |
| Level 4 | Quantitatively Managed | セキュリティメトリクスで管理 |
| Level 5 | Optimizing | 継続的な改善サイクル |

### 次のステップ

1. **P0項目の即時修正** (24-72時間以内)
2. **P1項目の実装** (1週間以内)
3. **セキュリティテストの実施** (ペネトレーションテスト)
4. **定期監査プロセスの確立** (月次)
5. **インシデント対応計画の策定**

---

**監査実施者**: Claude (Security & Compliance Expert)
**次回監査予定**: 2025-01-17 (1ヶ月後)
**連絡先**: セキュリティチーム

---

## 参考資料

- [OWASP Top 10 (2021)](https://owasp.org/Top10/)
- [AWS Well-Architected Framework - Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [GDPR Official Text](https://gdpr-info.eu/)
- [SOC 2 Trust Services Criteria](https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/trustservices.html)
- [PCI-DSS v4.0](https://www.pcisecuritystandards.org/)
