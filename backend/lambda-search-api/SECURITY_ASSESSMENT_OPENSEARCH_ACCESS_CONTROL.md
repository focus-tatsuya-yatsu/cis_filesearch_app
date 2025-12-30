# OpenSearch アクセス制御変更 - セキュリティ評価レポート

**評価日**: 2025-12-19
**対象**: VPC DNS設定とOpenSearch Fine-Grained Access Control (FGAC)の変更
**評価者**: Security & Compliance Expert
**重要度**: 🔴 CRITICAL

---

## Executive Summary

### 変更内容の概要

1. **Lambda環境変数の修正**
   - `OPENSEARCH_ENDPOINT` のタイポ修正
   - VPCエンドポイントURLの正規化

2. **OpenSearch FGAC設定の変更**
   - ❌ **内部ユーザーデータベース認証の無効化** (`internal_user_database_enabled: false`)
   - ✅ **IAM ARNベースの認証への切り替え**
   - Lambda実行ロール (`arn:aws:iam::770923989980:role/cis-lambda-search-api-role`) へのアクセス許可

3. **セキュリティリスク総合評価**
   - **全体リスクレベル**: 🟡 MEDIUM (適切な実装で 🟢 LOW に低減可能)
   - **Critical Finding**: 2件
   - **High Finding**: 3件
   - **Medium Finding**: 4件

---

## Critical Findings (P0 - 即座対応必須)

### 🔴 C-01: Access Policy の過度な権限許可

**現在の設定** (`terraform/opensearch.tf` Line 78-97):
```hcl
access_policies = jsonencode({
  Version = "2012-10-17"
  Statement = [
    {
      Effect = "Allow"
      Principal = {
        AWS = "*"  # ⚠️ CRITICAL: ワイルドカード許可
      }
      Action   = "es:*"  # ⚠️ CRITICAL: 全アクション許可
      Resource = "arn:aws:es:${var.aws_region}:${data.aws_caller_identity.current.account_id}:domain/${var.project_name}-opensearch-${var.environment}/*"
      Condition = {
        IpAddress = {
          "aws:SourceIp" = [
            aws_vpc.main.cidr_block  # VPC CIDRのみ制限
          ]
        }
      }
    }
  ]
})
```

**脆弱性の詳細**:
- **Principal: "*"**: VPC内の**あらゆるIAMエンティティ**がアクセス可能
- **Action: "es:*"**: **全てのElasticsearch/OpenSearch操作**が許可（削除、設定変更含む）
- **Condition**: IP制限のみ（IAM認証なし）

**攻撃シナリオ**:
1. VPC内の侵害されたEC2インスタンスから不正アクセス
2. 誤って配置されたLambda関数からのデータ削除
3. 開発環境リソースからの本番データアクセス

**CVSS 3.1 Score**: **8.8 (HIGH)**
- AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H

**Business Impact**:
- 🔥 データ漏洩リスク (全インデックスの読み取り可能)
- 🔥 データ損失リスク (インデックス削除可能)
- 🔥 サービス停止リスク (ドメイン設定変更可能)
- ⚖️ GDPR/SOC2コンプライアンス違反

**推奨される修正** (IMMEDIATE):

```hcl
# ✅ SECURE: 最小権限の原則に基づくポリシー
access_policies = jsonencode({
  Version = "2012-10-17"
  Statement = [
    {
      Effect = "Allow"
      Principal = {
        AWS = [
          # Lambda Search API Role (読み取り専用)
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/cis-lambda-search-api-role-${var.environment}",
          # EC2 Worker Role (書き込み専用)
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/cis-file-processor-role-${var.environment}",
          # Migration Role (管理操作)
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/opensearch-migration-lambda-role"
        ]
      }
      Action = [
        "es:ESHttpGet",    # 読み取り操作
        "es:ESHttpPost",   # 検索・インデックス作成
        "es:ESHttpPut",    # ドキュメント更新
        "es:ESHttpHead"    # 存在確認
        # es:ESHttpDelete は除外（削除操作を禁止）
      ]
      Resource = "arn:aws:es:${var.aws_region}:${data.aws_caller_identity.current.account_id}:domain/${var.project_name}-opensearch-${var.environment}/*"
      Condition = {
        IpAddress = {
          "aws:SourceIp" = [aws_vpc.main.cidr_block]
        }
      }
    }
  ]
})
```

**追加の推奨事項**:
1. **Resource-level permissions** を実装
   ```hcl
   Resource = [
     "${opensearch_domain.arn}/file-index/*",        # データインデックスのみ
     "${opensearch_domain.arn}/_search/*",           # 検索エンドポイント
     "${opensearch_domain.arn}/_bulk",               # バルク操作
     # _cluster, _nodes などの管理APIは除外
   ]
   ```

2. **削除操作の分離** - 専用の管理ロールのみに `es:ESHttpDelete` を許可

---

### 🔴 C-02: FGAC Master User の認証情報管理

**現在の設定** (`terraform/opensearch.tf` Line 62-69):
```hcl
advanced_security_options {
  enabled                        = true
  internal_user_database_enabled = true  # 変更予定: false
  master_user_options {
    master_user_name     = var.opensearch_master_user      # ⚠️ プレーンテキスト変数
    master_user_password = var.opensearch_master_password  # ⚠️ プレーンテキスト変数
  }
}
```

**脆弱性の詳細**:

#### 2.1 内部ユーザーデータベース無効化のリスク

**変更内容**: `internal_user_database_enabled: true → false`

**潜在的な問題**:
1. **既存のマスターユーザー認証情報が無効化される**
   - OpenSearch Dashboards へのアクセス不可
   - 緊急時の直接アクセス手段の喪失
   - 監査・トラブルシューティングの制限

2. **IAMロールへの完全依存**
   - IAMロールポリシーの誤設定でアクセス不可
   - 循環依存によるロックアウトリスク
   - クロスアカウントアクセスの複雑化

**CVSS 3.1 Score**: **7.5 (HIGH)**
- AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H

**Business Impact**:
- 🔥 運用ロックアウトリスク
- 📊 監査証跡の欠落
- ⏱️ インシデント対応の遅延

#### 2.2 認証情報の保存方法

**現在の問題**:
- `var.opensearch_master_user/password` がTerraform変数として保存
- `.tfvars` ファイルやCLI引数での平文保存リスク
- バージョン管理への誤コミットリスク

**推奨される修正** (IMMEDIATE):

**オプション A: ハイブリッドアプローチ (推奨)**
```hcl
advanced_security_options {
  enabled                        = true
  internal_user_database_enabled = true  # ✅ 維持（緊急用）
  master_user_options {
    master_user_name     = "emergency-admin"  # 緊急用のみ
    master_user_password = random_password.opensearch_master.result
  }
}

# IAMロールベースアクセスをメインに使用
resource "aws_opensearch_domain_saml_options" "main" {
  # または aws_opensearch_domain に IAM mapping を追加
}

# パスワードをAWS Secrets Managerで管理
resource "random_password" "opensearch_master" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret" "opensearch_master_password" {
  name                    = "${var.project_name}/opensearch/master-password"
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "opensearch_master_password" {
  secret_id     = aws_secretsmanager_secret.opensearch_master_password.id
  secret_string = random_password.opensearch_master.result
}
```

**オプション B: IAM完全移行 (慎重に実施)**
```hcl
advanced_security_options {
  enabled                        = true
  internal_user_database_enabled = false  # 内部DB無効化
  # IAMロールマッピングのみ使用
}

# Lambda Search API に backend role を設定
resource "aws_iam_role_policy" "lambda_opensearch_backend_role" {
  name = "opensearch-backend-role-mapping"
  role = aws_iam_role.lambda_search_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "es:ESHttpGet",
          "es:ESHttpPost",
          "es:ESHttpHead"
        ]
        Resource = "${aws_opensearch_domain.main.arn}/*"
      }
    ]
  })
}
```

**実装手順** (ゼロダウンタイム):
1. **Phase 1**: IAMロールマッピングを追加（内部DBは維持）
2. **Phase 2**: 全アプリケーションをIAM認証に移行
3. **Phase 3**: 動作確認後、`internal_user_database_enabled = false` に変更
4. **Phase 4**: 緊急用アクセス手段の文書化

---

## High Findings (P1 - 今週中対応)

### 🟠 H-01: Lambda IAM Policy の過度な権限

**現在の設定** (`backend/lambda-search-api/terraform/lambda.tf` Line 84-103):
```hcl
resource "aws_iam_role_policy" "lambda_opensearch_access" {
  policy = jsonencode({
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "es:ESHttpGet",
          "es:ESHttpPost",
          "es:ESHttpHead"
        ]
        Resource = "arn:aws:es:${var.aws_region}:${data.aws_caller_identity.current.account_id}:domain/*"
        # ⚠️ 全ドメインへのアクセス許可
      }
    ]
  })
}
```

**脆弱性**:
- リソース指定が `domain/*` → **全OpenSearchドメインにアクセス可能**
- 他の環境（dev/staging）のデータへのアクセスリスク

**推奨される修正**:
```hcl
Resource = "arn:aws:es:${var.aws_region}:${data.aws_caller_identity.current.account_id}:domain/${var.project_name}-opensearch-${var.environment}/*"
```

**CVSS 3.1 Score**: 6.5 (MEDIUM)

---

### 🟠 H-02: VPC Security Group の広範なEgress許可

**現在の設定** (`backend/lambda-search-api/terraform/lambda.tf` Line 136-163):
```hcl
resource "aws_security_group" "lambda_search_api" {
  # Egress to internet via NAT Gateway (for AWS API calls)
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # ⚠️ 全インターネットへの送信許可
    description = "HTTPS to AWS services via NAT Gateway"
  }
}
```

**脆弱性**:
- **データ外部流出リスク**: Lambdaが侵害された場合、任意のHTTPSエンドポイントにデータ送信可能
- **最小権限の原則違反**: AWS APIアクセスに `0.0.0.0/0` は不要

**推奨される修正**:
```hcl
# Option 1: VPC Endpoints を使用（推奨）
resource "aws_vpc_endpoint" "lambda" {
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${var.aws_region}.lambda"
  vpc_endpoint_type = "Interface"
  subnet_ids        = var.private_subnet_ids
  security_group_ids = [aws_security_group.vpc_endpoints.id]
}

# Security Group - VPC Endpoints のみ許可
egress {
  from_port       = 443
  to_port         = 443
  protocol        = "tcp"
  security_groups = [aws_security_group.vpc_endpoints.id]
  description     = "HTTPS to AWS services via VPC Endpoints"
}

# Option 2: Prefix List を使用
data "aws_prefix_list" "s3" {
  filter {
    name   = "prefix-list-name"
    values = ["com.amazonaws.${var.aws_region}.s3"]
  }
}

egress {
  from_port       = 443
  to_port         = 443
  protocol        = "tcp"
  prefix_list_ids = [data.aws_prefix_list.s3.id]
  description     = "HTTPS to S3 only"
}
```

**CVSS 3.1 Score**: 6.8 (MEDIUM)

---

### 🟠 H-03: CloudWatch Logs の暗号化とログ保持期間

**現在の設定** (`backend/lambda-search-api/terraform/lambda.tf` Line 217-225):
```hcl
resource "aws_cloudwatch_log_group" "search_api" {
  name              = "/aws/lambda/${aws_lambda_function.search_api.function_name}"
  retention_in_days = 14  # ⚠️ 短すぎる保持期間
  # ⚠️ kms_key_id が未設定（デフォルト暗号化）
}
```

**コンプライアンス違反**:
- **SOC 2**: 最低90日のログ保持が推奨
- **GDPR**: セキュリティインシデント調査に十分な期間が必要
- **PCI-DSS**: 監査証跡として最低90日必要

**推奨される修正**:
```hcl
resource "aws_cloudwatch_log_group" "search_api" {
  name              = "/aws/lambda/${aws_lambda_function.search_api.function_name}"
  retention_in_days = 90  # ✅ 90日保持
  kms_key_id        = aws_kms_key.cloudwatch_logs.arn  # ✅ KMS暗号化
}

resource "aws_kms_key" "cloudwatch_logs" {
  description             = "CloudWatch Logs encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable CloudWatch Logs"
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
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:*"
          }
        }
      }
    ]
  })
}
```

**CVSS 3.1 Score**: 5.3 (MEDIUM)

---

## Medium Findings (P2 - 今スプリント対応)

### 🟡 M-01: OpenSearch 接続時の SSL 検証スキップ

**現在の実装** (`backend/lambda-search-api/src/services/opensearch.service.enhanced.ts` Line 61-97):
```typescript
const skipSSLVerify = process.env.SKIP_SSL_VERIFY !== 'false'; // ⚠️ デフォルトtrue

const httpsAgent = new https.Agent({
  rejectUnauthorized: !skipSSLVerify,  // ⚠️ SSL検証スキップ可能
  keepAlive: true,
  maxSockets: 50,
  timeout: 30000,
});
```

**脆弱性**:
- **MITM攻撃リスク**: SSL証明書検証をスキップ → 中間者攻撃が可能
- **デフォルトが unsafe**: 明示的に無効化しない限りSSL検証なし

**推奨される修正**:
```typescript
// ✅ PRODUCTION: SSL検証を常に有効化
const skipSSLVerify = process.env.NODE_ENV === 'development' &&
                      process.env.SKIP_SSL_VERIFY === 'true'; // 開発環境のみ許可

// 本番環境では強制的に検証
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : !skipSSLVerify,
  keepAlive: true,
  maxSockets: 50,
  timeout: 30000,
  minVersion: 'TLSv1.2',  // ✅ 最低TLSバージョンを指定
});

// 本番環境でスキップが試行された場合はエラー
if (process.env.NODE_ENV === 'production' && process.env.SKIP_SSL_VERIFY === 'true') {
  throw new Error('SECURITY ERROR: SSL verification cannot be disabled in production');
}
```

**CVSS 3.1 Score**: 5.9 (MEDIUM)

---

### 🟡 M-02: 認証情報のログ出力

**現在の実装** (`backend/lambda-search-api/src/services/opensearch.service.enhanced.ts` Line 73-78):
```typescript
if (debugMode) {
  logger.info('AWS Credentials loaded', {
    accessKeyId: credentials.accessKeyId?.substring(0, 8) + '...',  // ⚠️ 部分的に露出
    hasSessionToken: !!credentials.sessionToken,
  });
}
```

**脆弱性**:
- Access Key IDの先頭8文字を露出 → ブルートフォース攻撃の糸口
- CloudWatch Logsに記録 → ログアクセス権限を持つ者が閲覧可能

**推奨される修正**:
```typescript
// ✅ SECURE: 認証情報は一切ログに出力しない
if (debugMode) {
  logger.info('AWS Credentials loaded', {
    credentialType: credentials.sessionToken ? 'temporary' : 'long-term',
    expirationTime: credentials.expiration?.toISOString(),
    // accessKeyId は削除
  });
}
```

---

### 🟡 M-03: Rate Limiting の欠如

**現在の設定** (`backend/lambda-search-api/terraform/lambda.tf` Line 208):
```hcl
reserved_concurrent_executions = 10  # 同時実行数制限のみ
```

**脆弱性**:
- **APIレート制限なし** → DDoS攻撃に脆弱
- **Lambda throttling のみ** → コスト爆発リスク
- **OpenSearchへの過負荷** → クラスターダウンリスク

**推奨される修正**:
```hcl
# API Gateway Usage Plan でレート制限
resource "aws_api_gateway_usage_plan" "search_api" {
  name = "cis-search-api-usage-plan-${var.environment}"

  throttle_settings {
    burst_limit = 50    # ✅ バースト時最大50リクエスト/秒
    rate_limit  = 100   # ✅ 平均100リクエスト/秒
  }

  quota_settings {
    limit  = 10000  # ✅ 1日あたり10,000リクエスト
    period = "DAY"
  }

  api_stages {
    api_id = aws_api_gateway_rest_api.search_api.id
    stage  = aws_api_gateway_deployment.search_api.stage_name
  }
}

# WAF Rate-Based Rule
resource "aws_wafv2_web_acl" "api_gateway" {
  count = var.enable_waf ? 1 : 0

  rule {
    name     = "RateLimitRule"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000  # ✅ IP毎に5分間で2000リクエスト
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitRule"
    }
  }
}
```

**CVSS 3.1 Score**: 5.3 (MEDIUM)

---

### 🟡 M-04: インデックス存在確認の非効率性

**現在の実装** (`backend/lambda-search-api/src/services/opensearch.service.enhanced.ts` Line 389-401):
```typescript
// インデックスの存在確認（初回のみ）
try {
  const indexExists = await client.indices.exists({ index: config.index });
  if (!indexExists.body) {
    throw new OpenSearchIndexNotFoundError(`Index '${config.index}' does not exist`);
  }
} catch (error: any) {
  // ⚠️ 全検索クエリで毎回実行される
}
```

**パフォーマンスとセキュリティの問題**:
- 追加のネットワークラウンドトリップ
- OpenSearchへの不要な負荷
- エラーハンドリングによる情報漏洩リスク

**推奨される修正**:
```typescript
// ✅ キャッシング + 起動時チェック
let indexExistsCache: Map<string, boolean> = new Map();

async function checkIndexExists(client: Client, index: string): Promise<boolean> {
  // キャッシュチェック
  if (indexExistsCache.has(index)) {
    return indexExistsCache.get(index)!;
  }

  try {
    const exists = await client.indices.exists({ index });
    indexExistsCache.set(index, exists.body);

    // 5分後にキャッシュクリア
    setTimeout(() => indexExistsCache.delete(index), 5 * 60 * 1000);

    return exists.body;
  } catch (error: any) {
    logger.error('Failed to check index existence', {
      error: error.message,
      index,
    });
    // ⚠️ インデックス名を外部に露出しない
    throw new OpenSearchError('Search service configuration error', 500);
  }
}

// Lambda Cold Start時に実行
export async function warmupOpenSearch(): Promise<void> {
  const client = await getOpenSearchClient();
  const config = getOpenSearchConfig();
  await checkIndexExists(client, config.index);
  logger.info('OpenSearch warmed up successfully');
}
```

---

## 推奨されるセキュリティ強化策

### 1. Defense in Depth - 多層防御の実装

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Network Security                                   │
│  ✅ VPC Isolation                                           │
│  ✅ Security Groups (最小限のポート開放)                    │
│  ✅ NACLs (ネットワークレベルフィルタリング)                │
│  ✅ VPC Endpoints (インターネット経由を回避)                │
└─────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: IAM & Authentication                               │
│  ✅ IAM Role-based Access (最小権限)                        │
│  ✅ FGAC (Fine-Grained Access Control)                      │
│  ✅ MFA for Admin Access                                    │
│  ✅ Service Control Policies (SCP)                          │
└─────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Application Security                               │
│  ✅ Input Validation                                        │
│  ✅ Rate Limiting                                           │
│  ✅ WAF Rules                                               │
│  ✅ SSL/TLS Enforcement                                     │
└─────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Data Security                                      │
│  ✅ Encryption at Rest (KMS)                                │
│  ✅ Encryption in Transit (TLS 1.2+)                        │
│  ✅ Node-to-Node Encryption                                 │
│  ✅ Data Classification & DLP                               │
└─────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 5: Monitoring & Incident Response                     │
│  ✅ CloudWatch Logs (KMS encrypted)                         │
│  ✅ CloudTrail (API監査)                                    │
│  ✅ GuardDuty (脅威検知)                                    │
│  ✅ Security Hub (統合ダッシュボード)                       │
└─────────────────────────────────────────────────────────────┘
```

### 2. IAM Role Separation - 役割分離

```hcl
# ✅ Read-Only Role (Lambda Search API)
resource "aws_iam_role" "lambda_search_readonly" {
  name = "cis-lambda-search-readonly-${var.environment}"

  # 検索とGETのみ許可
  inline_policy {
    policy = jsonencode({
      Statement = [{
        Effect = "Allow"
        Action = [
          "es:ESHttpGet",
          "es:ESHttpPost",  # 検索クエリのみ
          "es:ESHttpHead"
        ]
        Resource = "${aws_opensearch_domain.main.arn}/file-index/_search"
      }]
    })
  }
}

# ✅ Write Role (EC2 File Processor)
resource "aws_iam_role" "ec2_file_processor_writeonly" {
  name = "cis-ec2-processor-writeonly-${var.environment}"

  # インデックス作成・更新のみ許可
  inline_policy {
    policy = jsonencode({
      Statement = [{
        Effect = "Allow"
        Action = [
          "es:ESHttpPost",  # ドキュメント作成
          "es:ESHttpPut"    # ドキュメント更新
        ]
        Resource = "${aws_opensearch_domain.main.arn}/file-index/_doc/*"
      }]
    })
  }
}

# ✅ Admin Role (Migration & Maintenance)
resource "aws_iam_role" "opensearch_admin" {
  name = "cis-opensearch-admin-${var.environment}"

  # MFA必須
  assume_role_policy = jsonencode({
    Statement = [{
      Effect = "Allow"
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action = "sts:AssumeRole"
      Condition = {
        Bool = { "aws:MultiFactorAuthPresent" = "true" }
      }
    }]
  })

  # フル管理権限（緊急時のみ使用）
  inline_policy {
    policy = jsonencode({
      Statement = [{
        Effect   = "Allow"
        Action   = "es:*"
        Resource = "${aws_opensearch_domain.main.arn}/*"
      }]
    })
  }
}
```

### 3. Encryption - 暗号化の徹底

```hcl
# ✅ Customer-Managed KMS Key
resource "aws_kms_key" "opensearch" {
  description             = "OpenSearch encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "Allow OpenSearch to use the key"
        Effect = "Allow"
        Principal = { Service = "es.amazonaws.com" }
        Action = [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:CreateGrant",
          "kms:DescribeKey"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "es.${var.aws_region}.amazonaws.com"
          }
        }
      }
    ]
  })
}

resource "aws_kms_alias" "opensearch" {
  name          = "alias/${var.project_name}/opensearch"
  target_key_id = aws_kms_key.opensearch.key_id
}

# OpenSearch Domain with KMS
resource "aws_opensearch_domain" "main" {
  # ...existing config...

  encrypt_at_rest {
    enabled    = true
    kms_key_id = aws_kms_key.opensearch.arn  # ✅ CMK使用
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"  # ✅ TLS 1.2以上
  }
}
```

### 4. Monitoring & Alerting - 監視とアラート

```hcl
# ✅ CloudTrail Data Events
resource "aws_cloudtrail" "opensearch_audit" {
  name                          = "cis-opensearch-audit-${var.environment}"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  include_global_service_events = false
  is_multi_region_trail         = false
  enable_log_file_validation    = true
  kms_key_id                    = aws_kms_key.cloudtrail.arn

  event_selector {
    read_write_type           = "All"
    include_management_events = true

    data_resource {
      type   = "AWS::ES::Domain"
      values = [aws_opensearch_domain.main.arn]
    }
  }
}

# ✅ GuardDuty Findings for OpenSearch
resource "aws_cloudwatch_event_rule" "guardduty_opensearch" {
  name        = "guardduty-opensearch-findings"
  description = "Alert on GuardDuty findings related to OpenSearch"

  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Finding"]
    detail = {
      resource = {
        resourceType = ["AccessKey"]
      }
      service = {
        action = {
          awsApiCallAction = {
            serviceName = ["es.amazonaws.com"]
          }
        }
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "guardduty_sns" {
  rule      = aws_cloudwatch_event_rule.guardduty_opensearch.name
  target_id = "SendToSNS"
  arn       = aws_sns_topic.security_alerts.arn
}

# ✅ Anomaly Detection for OpenSearch Metrics
resource "aws_cloudwatch_metric_alarm" "opensearch_cpu_anomaly" {
  alarm_name          = "opensearch-cpu-anomaly-${var.environment}"
  comparison_operator = "GreaterThanUpperThreshold"
  evaluation_periods  = 2
  threshold_metric_id = "ad1"
  alarm_description   = "Anomaly detected in OpenSearch CPU usage"
  alarm_actions       = [aws_sns_topic.security_alerts.arn]

  metric_query {
    id          = "m1"
    return_data = true
    metric {
      metric_name = "CPUUtilization"
      namespace   = "AWS/ES"
      period      = 300
      stat        = "Average"
      dimensions = {
        DomainName = aws_opensearch_domain.main.domain_name
        ClientId   = data.aws_caller_identity.current.account_id
      }
    }
  }

  metric_query {
    id          = "ad1"
    expression  = "ANOMALY_DETECTION_BAND(m1, 2)"
    label       = "CPUUtilization (Expected)"
    return_data = true
  }
}

# ✅ Access Denied Alarms
resource "aws_cloudwatch_log_metric_filter" "opensearch_access_denied" {
  name           = "opensearch-access-denied"
  log_group_name = aws_cloudwatch_log_group.opensearch_application_logs.name
  pattern        = "{ $.errorCode = \"*UnauthorizedException\" || $.errorCode = \"AccessDenied*\" }"

  metric_transformation {
    name      = "OpenSearchAccessDenied"
    namespace = "CIS/Security"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "access_denied_spike" {
  alarm_name          = "opensearch-access-denied-spike"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "OpenSearchAccessDenied"
  namespace           = "CIS/Security"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Spike in OpenSearch access denied errors"
  alarm_actions       = [aws_sns_topic.security_alerts.arn]
}
```

---

## 本番環境への影響評価

### 変更のリスク分析

| 変更内容 | リスクレベル | ダウンタイム | ロールバック難易度 |
|---------|-------------|-------------|------------------|
| **FGAC内部DB無効化** | 🔴 HIGH | あり（5-10分） | 🔴 困難 |
| **Access Policy変更** | 🟡 MEDIUM | なし | 🟢 容易 |
| **Lambda IAM修正** | 🟡 MEDIUM | なし | 🟢 容易 |
| **SG Egress制限** | 🟠 MEDIUM-HIGH | なし | 🟡 中程度 |
| **SSL検証強制** | 🟢 LOW | なし | 🟢 容易 |

### 推奨される展開戦略

#### Phase 1: 準備（1-2日）

```bash
# 1. 現在の設定をバックアップ
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch-prod \
  --output json > opensearch-backup-$(date +%Y%m%d).json

# 2. IAMロールマッピングの確認
aws opensearch describe-domain-config \
  --domain-name cis-filesearch-opensearch-prod \
  --query 'DomainConfig.AdvancedSecurityOptions'

# 3. 現在のアクセスログを収集
aws logs tail /aws/opensearch/cis-filesearch-prod/application-logs \
  --since 7d > opensearch-access-logs-7days.txt
```

#### Phase 2: 段階的展開（3-5日）

**Step 1: IAMロールマッピング追加** (ダウンタイムなし)
```hcl
# internal_user_database_enabled は true のまま
# IAMロールを追加で設定
advanced_security_options {
  enabled                        = true
  internal_user_database_enabled = true  # ✅ 維持
  master_user_options {
    master_user_name     = var.opensearch_master_user
    master_user_password = var.opensearch_master_password
  }
}

# Lambda に backend_role を追加
resource "null_resource" "add_backend_role" {
  provisioner "local-exec" {
    command = <<-EOT
      curl -XPUT "https://${aws_opensearch_domain.main.endpoint}/_plugins/_security/api/rolesmapping/all_access" \
        -u "${var.opensearch_master_user}:${var.opensearch_master_password}" \
        -H "Content-Type: application/json" \
        -d '{
          "backend_roles": ["arn:aws:iam::770923989980:role/cis-lambda-search-api-role"]
        }'
    EOT
  }
}
```

**Step 2: Access Policy の段階的制限** (ダウンタイムなし)
```hcl
# 現在の Principal: "*" から特定ARNへ段階的移行
access_policies = jsonencode({
  Statement = [
    {
      Effect = "Allow"
      Principal = {
        AWS = [
          "arn:aws:iam::770923989980:role/cis-lambda-search-api-role",
          "*"  # 一時的に維持
        ]
      }
      # ...rest of policy
    }
  ]
})

# 24時間監視後、"*" を削除
```

**Step 3: 動作確認** (1-2日)
```bash
# Lambda検索テスト
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"queryStringParameters":{"q":"test"}}' \
  response.json

# エラーログ確認
aws logs tail /aws/lambda/cis-search-api-prod --follow
```

**Step 4: 内部DB無効化** (ダウンタイム: 5-10分)
```hcl
# ⚠️ 動作確認完了後のみ実行
advanced_security_options {
  enabled                        = true
  internal_user_database_enabled = false  # ✅ 無効化
  # master_user_options は削除
}
```

#### Phase 3: 検証とロールバックプラン（1日）

**検証チェックリスト**:
- [ ] Lambda Search APIの検索機能が正常動作
- [ ] EC2 File Processorのインデックス作成が正常動作
- [ ] CloudWatch Logsにエラーがない
- [ ] OpenSearch Dashboardsへのアクセス方法を文書化
- [ ] 緊急時の直接アクセス手順を確認

**ロールバックプラン**:
```bash
# 1. Terraformで以前の状態に戻す
terraform apply -var-file=opensearch-rollback.tfvars

# 2. OpenSearchドメイン設定を手動で復元
aws opensearch update-domain-config \
  --domain-name cis-filesearch-opensearch-prod \
  --advanced-security-options file://original-fgac-config.json
```

---

## コンプライアンスチェックリスト

### GDPR（一般データ保護規則）

| 要件 | 現状 | 必要な対応 |
|-----|------|----------|
| **データ暗号化** (Article 32) | ✅ 実装済み | - |
| **アクセス制御** (Article 32) | ⚠️ 過度な権限 | C-01の修正必須 |
| **監査ログ** (Article 30) | ⚠️ 保持期間不足 | H-03の修正推奨 |
| **データ削除権** (Article 17) | ❌ 未実装 | APIエンドポイント追加 |
| **インシデント通知** (Article 33) | ⚠️ 部分的 | 72時間以内通知の自動化 |

### SOC 2 (Type II)

| Trust Services Criteria | 現状 | 必要な対応 |
|------------------------|------|----------|
| **CC6.1 - Logical Access** | ⚠️ 過度な権限 | C-01, H-01の修正 |
| **CC6.6 - Encryption** | ✅ 実装済み | M-01の修正推奨 |
| **CC7.2 - System Monitoring** | ⚠️ 不十分 | 推奨策4の実装 |
| **CC7.4 - Incident Response** | ⚠️ 部分的 | プレイブック作成 |
| **CC8.1 - Change Management** | ❌ 未実装 | 変更管理プロセス確立 |

### PCI-DSS (Payment Card Industry)

| 要件 | 現状 | 必要な対応 |
|-----|------|----------|
| **3.4 - Encryption** | ✅ 実装済み | - |
| **7.1 - Access Control** | ⚠️ 過度な権限 | C-01の修正必須 |
| **10.2 - Audit Trails** | ⚠️ 保持期間不足 | H-03の修正 + 1年保持 |
| **11.4 - IDS/IPS** | ❌ 未実装 | GuardDuty有効化 |

---

## 推奨される実装タイムライン

### Week 1: Critical Fixes (P0)

**Day 1-2**:
- [ ] **C-01**: Access Policyの修正とデプロイ
- [ ] **C-02**: Secrets Managerへのパスワード移行

**Day 3-4**:
- [ ] IAMロールマッピングの追加
- [ ] 動作確認とログ監視

**Day 5**:
- [ ] 緊急時アクセス手順の文書化
- [ ] 内部DB無効化の最終判断

### Week 2: High Priority (P1)

**Day 1-2**:
- [ ] **H-01**: Lambda IAM Policyの修正
- [ ] **H-02**: Security Group Egressの制限（VPC Endpoints追加）

**Day 3-5**:
- [ ] **H-03**: CloudWatch Logs の暗号化と保持期間延長
- [ ] 包括的な動作確認

### Week 3-4: Medium Priority (P2)

- [ ] **M-01**: SSL検証の強制化
- [ ] **M-02**: 認証情報ログ出力の削除
- [ ] **M-03**: Rate Limitingの実装
- [ ] **M-04**: インデックスキャッシングの実装

### Week 5-6: Proactive Security

- [ ] GuardDutyの有効化と設定
- [ ] Security Hubの統合
- [ ] Anomaly Detection Alarmsの設定
- [ ] セキュリティプレイブックの作成

---

## まとめと次のステップ

### 最優先アクション（今週実施）

1. **🔴 IMMEDIATE**: OpenSearch Access Policyの修正
   ```bash
   # 現在の過度な権限を特定ARNに制限
   terraform plan -var-file=prod.tfvars -out=security-fix.tfplan
   terraform apply security-fix.tfplan
   ```

2. **🔴 IMMEDIATE**: FGAC移行戦略の確定
   - ハイブリッドアプローチ vs 完全IAM移行の意思決定
   - ステークホルダー承認の取得

3. **🟠 THIS WEEK**: Lambda IAM Policyの修正
   - リソースARNを特定ドメインに限定

### セキュリティ成熟度ロードマップ

```
Current State (Level 2/5)
  ↓
  CRITICAL FIXES (Week 1-2)
  - Access Control強化
  - 認証情報の安全な管理
  ↓
Target State (Level 4/5)
  ↓
  PROACTIVE SECURITY (Week 3-6)
  - 監視・検知の自動化
  - インシデント対応の標準化
  ↓
Future State (Level 5/5)
  - Zero Trust Architecture
  - Continuous Compliance Monitoring
```

### リスク受容基準

以下のリスクは **受容不可** - 必ず修正が必要:
- ❌ C-01: `Principal: "*"` の過度な権限
- ❌ C-02: 平文での認証情報管理
- ❌ H-01: 全ドメインへのアクセス許可

以下のリスクは **条件付き受容可能** - ビジネス判断が必要:
- 🟡 M-03: Rate Limiting（低トラフィック環境の場合）
- 🟡 M-04: インデックスキャッシング（パフォーマンスが十分な場合）

### 質問と次のアクション

**即座に回答が必要な質問**:
1. FGAC内部DB無効化の実施タイミング（今週 vs 来週 vs 延期）
2. ダウンタイム（5-10分）の許容可能な時間帯
3. 緊急時のOpenSearchアクセス方法の優先度（MFA必須 vs パスワード認証許可）

**推奨される次のステップ**:
```bash
# 1. セキュリティ修正ブランチの作成
git checkout -b security/opensearch-access-control-hardening

# 2. Critical Fixesの実装
# terraform/opensearch.tf を修正

# 3. テスト環境での検証
terraform plan -var-file=dev.tfvars

# 4. 本番環境へのデプロイ（承認後）
terraform apply -var-file=prod.tfvars
```

---

**評価完了**: 本レポートは、提案されたVPC DNS設定とOpenSearchアクセス制御の変更に関する包括的なセキュリティ評価を提供しています。Critical Findingsを優先的に修正し、推奨されるタイムラインに従って段階的に実装することで、セキュリティリスクを最小化しながら本番環境への影響を抑えることができます。
