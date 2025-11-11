# CloudFront セキュリティヘッダー設定

## 概要

CloudFrontを通じて配信されるアプリケーションに対して、セキュリティヘッダーを適切に設定することで、XSS、クリックジャッキング、MITMなどの攻撃を防ぎます。

## 推奨セキュリティヘッダー

### 1. Content Security Policy (CSP)

**目的**: XSS攻撃を防止

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cognito-idp.ap-northeast-1.amazonaws.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self' data:;
  connect-src 'self'
    https://*.auth.ap-northeast-1.amazoncognito.com
    https://*.execute-api.ap-northeast-1.amazonaws.com
    https://cognito-idp.ap-northeast-1.amazonaws.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self'
```

**注意**: Next.js 15では`unsafe-inline`と`unsafe-eval`が必要な場合があります。

### 2. Strict-Transport-Security (HSTS)

**目的**: HTTPS接続を強制

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### 3. X-Content-Type-Options

**目的**: MIMEタイプスニッフィングを防止

```http
X-Content-Type-Options: nosniff
```

### 4. X-Frame-Options

**目的**: クリックジャッキング攻撃を防止

```http
X-Frame-Options: DENY
```

### 5. X-XSS-Protection

**目的**: ブラウザのXSSフィルターを有効化（レガシーブラウザ用）

```http
X-XSS-Protection: 1; mode=block
```

### 6. Referrer-Policy

**目的**: リファラー情報の漏洩を防止

```http
Referrer-Policy: strict-origin-when-cross-origin
```

### 7. Permissions-Policy

**目的**: ブラウザ機能へのアクセスを制限

```http
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

## CloudFront での実装方法

### オプション1: Lambda@Edge

```typescript
// cloudfront-security-headers.ts
export const handler = async (event: any) => {
  const response = event.Records[0].cf.response;
  const headers = response.headers;

  // Security Headers
  headers['strict-transport-security'] = [{
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload'
  }];

  headers['content-security-policy'] = [{
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cognito-idp.ap-northeast-1.amazonaws.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.auth.ap-northeast-1.amazoncognito.com https://*.execute-api.ap-northeast-1.amazonaws.com https://cognito-idp.ap-northeast-1.amazonaws.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  }];

  headers['x-content-type-options'] = [{
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  }];

  headers['x-frame-options'] = [{
    key: 'X-Frame-Options',
    value: 'DENY'
  }];

  headers['x-xss-protection'] = [{
    key: 'X-XSS-Protection',
    value: '1; mode=block'
  }];

  headers['referrer-policy'] = [{
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  }];

  headers['permissions-policy'] = [{
    key: 'Permissions-Policy',
    value: 'geolocation=(), microphone=(), camera=()'
  }];

  return response;
};
```

### オプション2: CloudFront Response Headers Policy

```json
{
  "ResponseHeadersPolicyConfig": {
    "Name": "cis-filesearch-security-headers",
    "SecurityHeadersConfig": {
      "StrictTransportSecurity": {
        "AccessControlMaxAgeSec": 31536000,
        "IncludeSubdomains": true,
        "Preload": true,
        "Override": true
      },
      "ContentTypeOptions": {
        "Override": true
      },
      "FrameOptions": {
        "FrameOption": "DENY",
        "Override": true
      },
      "XSSProtection": {
        "ModeBlock": true,
        "Protection": true,
        "Override": true
      },
      "ReferrerPolicy": {
        "ReferrerPolicy": "strict-origin-when-cross-origin",
        "Override": true
      },
      "ContentSecurityPolicy": {
        "ContentSecurityPolicy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cognito-idp.ap-northeast-1.amazonaws.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.auth.ap-northeast-1.amazoncognito.com https://*.execute-api.ap-northeast-1.amazonaws.com https://cognito-idp.ap-northeast-1.amazonaws.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        "Override": true
      }
    },
    "CustomHeadersConfig": {
      "Items": [
        {
          "Header": "Permissions-Policy",
          "Value": "geolocation=(), microphone=(), camera=()",
          "Override": true
        }
      ]
    }
  }
}
```

## Terraform実装例

```hcl
# cloudfront-security-headers.tf

resource "aws_cloudfront_response_headers_policy" "security_headers" {
  name    = "cis-filesearch-security-headers"
  comment = "Security headers for CIS File Search Application"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    content_security_policy {
      content_security_policy = join("; ", [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cognito-idp.ap-northeast-1.amazonaws.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https://*.auth.ap-northeast-1.amazoncognito.com https://*.execute-api.ap-northeast-1.amazonaws.com https://cognito-idp.ap-northeast-1.amazonaws.com",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ])
      override = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "geolocation=(), microphone=(), camera=()"
      override = true
    }
  }
}

# CloudFront Distributionに適用
resource "aws_cloudfront_distribution" "main" {
  # ... other configuration ...

  default_cache_behavior {
    # ... other settings ...

    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id
  }
}
```

## 検証方法

### オンラインツール

1. **Security Headers**: https://securityheaders.com/
2. **Mozilla Observatory**: https://observatory.mozilla.org/

### curl コマンドでの確認

```bash
curl -I https://your-cloudfront-domain.cloudfront.net | grep -E "^(Strict-Transport-Security|Content-Security-Policy|X-Content-Type-Options|X-Frame-Options|X-XSS-Protection|Referrer-Policy|Permissions-Policy)"
```

### 期待される出力

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' ...
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

## トラブルシューティング

### CSP違反エラー

**問題**: ブラウザコンソールに`Refused to execute inline script`エラー

**解決策**:
1. Next.js 15の場合、`unsafe-inline`と`unsafe-eval`を許可
2. または、nonce/hash ベースのCSPに移行（より安全）

### CORS エラー

**問題**: Cognito認証時にCORSエラー

**解決策**:
- `connect-src`に正しいCognitoドメインを追加
- Cognito App Client設定でAllowed originsを確認

### HSTS Preload 失敗

**問題**: hstspreload.orgでエラー

**解決策**:
- `max-age`を最低31536000秒に設定
- `includeSubDomains`を有効化
- `preload`ディレクティブを追加

## セキュリティ監査チェックリスト

- [ ] すべてのセキュリティヘッダーが正しく設定されている
- [ ] CSPポリシーが適切に動作し、不要な`unsafe-*`がない
- [ ] HSTSが有効で、preload リストに登録されている
- [ ] X-Frame-OptionsまたはCSP frame-ancestorsでクリックジャッキング対策
- [ ] Security Headers スコアが A+ 評価
- [ ] 本番環境とステージング環境で同じヘッダー設定

## 参考リソース

- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)
- [MDN Security Headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers#security)
- [AWS CloudFront Response Headers Policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-response-headers-policies.html)
