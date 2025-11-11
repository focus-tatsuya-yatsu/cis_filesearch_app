# AWS Cognito セキュリティベストプラクティス

## 概要

このドキュメントでは、AWS Cognitoを使用したアプリケーションのセキュリティを最大化するための設定とベストプラクティスを提供します。

## 1. User Pool 基本設定

### 🔐 パスワードポリシー

**最小セキュリティ要件（必須）**:

```json
{
  "PasswordPolicy": {
    "MinimumLength": 12,
    "RequireUppercase": true,
    "RequireLowercase": true,
    "RequireNumbers": true,
    "RequireSymbols": true,
    "TemporaryPasswordValidityDays": 1
  }
}
```

**推奨設定**:

| 項目 | 推奨値 | 理由 |
|------|--------|------|
| **最小文字数** | 14文字以上 | NIST SP 800-63B推奨 |
| **大文字必須** | ✅ Yes | 複雑性向上 |
| **小文字必須** | ✅ Yes | 複雑性向上 |
| **数字必須** | ✅ Yes | 複雑性向上 |
| **記号必須** | ✅ Yes | ブルートフォース攻撃対策 |
| **仮パスワード有効期限** | 1日 | リスク最小化 |

### Terraform実装例

```hcl
# cognito-user-pool.tf

resource "aws_cognito_user_pool" "main" {
  name = "cis-filesearch-user-pool"

  # パスワードポリシー
  password_policy {
    minimum_length    = 14
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
    temporary_password_validity_days = 1
  }

  # アカウントロックアウト設定
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # MFA設定
  mfa_configuration = "OPTIONAL" # または "ON" で強制

  # ユーザー属性
  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true

    string_attribute_constraints {
      min_length = 5
      max_length = 255
    }
  }

  # メール検証必須
  auto_verified_attributes = ["email"]

  # セキュリティアラート
  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }

  # デバイス追跡
  device_configuration {
    challenge_required_on_new_device      = true
    device_only_remembered_on_user_prompt = true
  }

  tags = {
    Environment = "production"
    Project     = "cis-filesearch"
    Security    = "high"
  }
}
```

## 2. Multi-Factor Authentication (MFA)

### 🛡️ MFA設定

**推奨**: 本番環境では**必ず有効化**

```hcl
resource "aws_cognito_user_pool" "main" {
  # ... other settings ...

  mfa_configuration = "ON"  # 強制MFA

  software_token_mfa_configuration {
    enabled = true
  }

  # SMS MFAも有効化（バックアップ用）
  sms_configuration {
    external_id    = "cis-filesearch-mfa"
    sns_caller_arn = aws_iam_role.cognito_sns.arn
  }
}
```

### フロントエンドでのMFA実装

```typescript
// lib/auth/mfa.ts

import { fetchAuthSession, confirmSignIn } from 'aws-amplify/auth';

export const setupMFA = async () => {
  try {
    // TOTP QRコードを取得
    const totpSetup = await fetchAuthSession();

    return {
      qrCode: totpSetup.getSharedSecret(),
      secretKey: totpSetup.getSharedSecret(),
    };
  } catch (error) {
    console.error('MFA setup failed:', error);
    throw error;
  }
};

export const verifyMFACode = async (code: string) => {
  try {
    await confirmSignIn({ challengeResponse: code });
    return { success: true };
  } catch (error) {
    console.error('MFA verification failed:', error);
    return { success: false, error };
  }
};
```

## 3. Advanced Security Features

### 🔍 異常検知とリスクベース認証

**AWS Cognitoの高度なセキュリティ機能**:

```hcl
resource "aws_cognito_user_pool" "main" {
  # ... other settings ...

  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }
}
```

**機能**:
- ✅ 異常なログイン試行の検出
- ✅ IPレピュテーション分析
- ✅ デバイスフィンガープリント
- ✅ リスクスコアベースの追加認証要求

### リスクベース認証のカスタマイズ

```typescript
// lib/auth/risk-based-auth.ts

interface RiskLevel {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresMFA: boolean;
  requiresEmailVerification: boolean;
  maxLoginAttempts: number;
}

const getRiskLevel = (riskScore: number): RiskLevel => {
  if (riskScore >= 0.7) {
    return {
      level: 'HIGH',
      requiresMFA: true,
      requiresEmailVerification: true,
      maxLoginAttempts: 3,
    };
  } else if (riskScore >= 0.4) {
    return {
      level: 'MEDIUM',
      requiresMFA: true,
      requiresEmailVerification: false,
      maxLoginAttempts: 5,
    };
  } else {
    return {
      level: 'LOW',
      requiresMFA: false,
      requiresEmailVerification: false,
      maxLoginAttempts: 10,
    };
  }
};
```

## 4. OAuth 2.0 PKCE 設定

### ✅ セキュアなApp Client設定

```hcl
resource "aws_cognito_user_pool_client" "app_client" {
  name         = "cis-filesearch-app-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # 🚨 CRITICAL: Client Secretを生成しない
  generate_secret = false

  # OAuth設定
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  # Callback URLs（本番環境のみ）
  callback_urls = [
    "https://your-cloudfront-domain.cloudfront.net/auth/callback"
  ]

  # Logout URLs
  logout_urls = [
    "https://your-cloudfront-domain.cloudfront.net"
  ]

  # トークン有効期限
  refresh_token_validity = 30  # 30日
  access_token_validity  = 60  # 60分
  id_token_validity      = 60  # 60分

  token_validity_units {
    refresh_token = "days"
    access_token  = "minutes"
    id_token      = "minutes"
  }

  # 認証フロー
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH"  # Secure Remote Password
  ]

  # 読み取り属性
  read_attributes = [
    "email",
    "email_verified",
    "name",
    "preferred_username"
  ]

  # 書き込み属性（最小限に）
  write_attributes = [
    "name",
    "preferred_username"
  ]

  # セキュリティ設定
  prevent_user_existence_errors = "ENABLED"
}
```

### トークン有効期限の推奨設定

| トークンタイプ | 推奨値 | 理由 |
|--------------|--------|------|
| **Access Token** | 60分 | セッションハイジャック対策 |
| **ID Token** | 60分 | 同上 |
| **Refresh Token** | 30日 | ユーザビリティとセキュリティのバランス |

## 5. アカウント保護

### 🚫 ブルートフォース攻撃対策

```hcl
resource "aws_cognito_user_pool" "main" {
  # ... other settings ...

  # Lambda Trigger for rate limiting
  lambda_config {
    pre_authentication = aws_lambda_function.pre_auth_rate_limit.arn
  }
}
```

### Lambda Rate Limiting

```typescript
// lambda/pre-auth-rate-limit.ts

import { DynamoDB } from 'aws-sdk';

const dynamodb = new DynamoDB.DocumentClient();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15分

export const handler = async (event: any) => {
  const { userPoolId, userName, request } = event;
  const ipAddress = request.userContextData.sourceIp[0];

  // 試行回数をDynamoDBで管理
  const key = `${userPoolId}:${userName}:${ipAddress}`;

  try {
    const attempts = await getLoginAttempts(key);

    if (attempts.count >= MAX_ATTEMPTS) {
      const timeSinceFirstAttempt = Date.now() - attempts.firstAttemptAt;

      if (timeSinceFirstAttempt < LOCKOUT_DURATION) {
        throw new Error('Account temporarily locked due to too many failed login attempts');
      } else {
        // ロックアウト期間終了、カウンターリセット
        await resetLoginAttempts(key);
      }
    }

    return event;
  } catch (error) {
    console.error('Rate limiting error:', error);
    throw error;
  }
};

const getLoginAttempts = async (key: string) => {
  const result = await dynamodb.get({
    TableName: 'LoginAttempts',
    Key: { id: key },
  }).promise();

  return result.Item || { count: 0, firstAttemptAt: Date.now() };
};

const resetLoginAttempts = async (key: string) => {
  await dynamodb.delete({
    TableName: 'LoginAttempts',
    Key: { id: key },
  }).promise();
};
```

### DynamoDB Table

```hcl
resource "aws_dynamodb_table" "login_attempts" {
  name           = "LoginAttempts"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = {
    Name    = "LoginAttemptsTracking"
    Project = "cis-filesearch"
  }
}
```

## 6. セッション管理

### 🕐 セッションタイムアウト設定

```typescript
// lib/auth/session-manager.ts

const SESSION_TIMEOUT = 60 * 60 * 1000; // 1時間
const WARNING_BEFORE_TIMEOUT = 5 * 60 * 1000; // 5分前

export class SessionManager {
  private timeoutId: NodeJS.Timeout | null = null;
  private warningTimeoutId: NodeJS.Timeout | null = null;

  startSessionTimer() {
    this.resetTimer();

    // 警告タイマー
    this.warningTimeoutId = setTimeout(() => {
      this.showTimeoutWarning();
    }, SESSION_TIMEOUT - WARNING_BEFORE_TIMEOUT);

    // セッションタイムアウト
    this.timeoutId = setTimeout(() => {
      this.handleSessionTimeout();
    }, SESSION_TIMEOUT);
  }

  resetTimer() {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.warningTimeoutId) clearTimeout(this.warningTimeoutId);
  }

  private showTimeoutWarning() {
    // ユーザーに警告を表示
    const extendSession = confirm('セッションがまもなく期限切れになります。延長しますか?');

    if (extendSession) {
      this.refreshSession();
    }
  }

  private async refreshSession() {
    try {
      await fetchAuthSession({ forceRefresh: true });
      this.startSessionTimer(); // タイマーリセット
    } catch (error) {
      console.error('Session refresh failed:', error);
      this.handleSessionTimeout();
    }
  }

  private handleSessionTimeout() {
    // 強制ログアウト
    signOut();
    window.location.href = '/login?reason=session-timeout';
  }
}
```

## 7. 監視とアラート

### 📊 CloudWatch メトリクス

```hcl
# cloudwatch-alarms.tf

resource "aws_cloudwatch_metric_alarm" "cognito_failed_logins" {
  alarm_name          = "cognito-high-failed-logins"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "UserAuthenticationFailure"
  namespace           = "AWS/Cognito"
  period              = "300"  # 5分
  statistic           = "Sum"
  threshold           = "10"   # 5分間で10回以上の失敗
  alarm_description   = "High number of failed login attempts"
  alarm_actions       = [aws_sns_topic.security_alerts.arn]

  dimensions = {
    UserPoolId = aws_cognito_user_pool.main.id
  }
}

resource "aws_cloudwatch_metric_alarm" "cognito_compromised_credentials" {
  alarm_name          = "cognito-compromised-credentials-detected"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "CompromisedCredentialsRisk"
  namespace           = "AWS/Cognito"
  period              = "60"
  statistic           = "Sum"
  threshold           = "1"
  alarm_description   = "Compromised credentials detected"
  alarm_actions       = [aws_sns_topic.security_alerts.arn]

  dimensions = {
    UserPoolId = aws_cognito_user_pool.main.id
  }
}
```

### ログ分析

```typescript
// monitoring/auth-logger.ts

import { CloudWatchLogs } from 'aws-sdk';

const cloudwatch = new CloudWatchLogs();

interface AuthEvent {
  eventType: 'login' | 'logout' | 'mfa_challenge' | 'failed_login';
  userId?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export const logAuthEvent = async (event: AuthEvent) => {
  const logEvent = {
    logGroupName: '/aws/cognito/cis-filesearch',
    logStreamName: `auth-events-${new Date().toISOString().split('T')[0]}`,
    logEvents: [
      {
        timestamp: Date.now(),
        message: JSON.stringify(event),
      },
    ],
  };

  try {
    await cloudwatch.putLogEvents(logEvent).promise();
  } catch (error) {
    console.error('Failed to log auth event:', error);
  }
};
```

## 8. セキュリティチェックリスト

### 本番環境展開前の必須確認項目

#### User Pool設定

- [ ] パスワード最小文字数が14文字以上
- [ ] すべてのパスワード複雑性要件が有効
- [ ] MFAが有効（OPTIONALまたはON）
- [ ] Advanced Security Modeが"ENFORCED"
- [ ] メール検証が必須
- [ ] デバイストラッキングが有効

#### App Client設定

- [ ] Client Secretが生成されていない（PKCEの場合）
- [ ] OAuth FlowがAuthorizaton Code (PKCE)
- [ ] Callback URLsが正しく設定
- [ ] Access Token有効期限が60分以下
- [ ] Refresh Token有効期限が30日以下
- [ ] 不要な認証フローが無効

#### セキュリティ機能

- [ ] Lambda Rate Limitingが実装されている
- [ ] セッションタイムアウトが設定されている
- [ ] CloudWatchアラームが設定されている
- [ ] ログ記録が有効
- [ ] IPホワイトリスト/ブラックリストが設定（必要な場合）

#### コンプライアンス

- [ ] GDPR要件を満たしている
- [ ] データ保持ポリシーが設定されている
- [ ] 監査ログが保存されている
- [ ] インシデント対応計画が準備されている

## 9. 定期的なセキュリティレビュー

### 四半期ごとのレビュー項目

```markdown
## Q1 2025 セキュリティレビュー

### User Pool設定確認
- [ ] パスワードポリシーは最新のベストプラクティスに準拠しているか
- [ ] 不要なApp Clientが存在しないか
- [ ] MFA採用率は何%か（目標: 80%以上）

### セキュリティイベント分析
- [ ] 過去3ヶ月の失敗したログイン試行数: _____
- [ ] アカウントロックアウト発生数: _____
- [ ] 異常なアクセスパターン検出数: _____

### 脆弱性評価
- [ ] 最新のOWASP Top 10に対する評価
- [ ] ペネトレーションテストの実施（年1回）
- [ ] 第三者セキュリティ監査の実施（年1回）

### コンプライアンス
- [ ] GDPRデータ処理記録の更新
- [ ] セキュリティポリシーの見直し
- [ ] スタッフへのセキュリティトレーニング実施

### アクションアイテム
1.
2.
3.
```

## 参考リソース

- [AWS Cognito Security Best Practices](https://docs.aws.amazon.com/cognito/latest/developerguide/security-best-practices.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [NIST Digital Identity Guidelines (SP 800-63B)](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
