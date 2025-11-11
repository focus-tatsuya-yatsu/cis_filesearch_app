# 本番環境デプロイ前セキュリティチェックリスト

## 🔴 P0 - Critical (デプロイ前に必須)

### 認証・認可

- [ ] **Lambda@Edge認証チェックが有効**
  - Viewer Requestイベントで認証チェック実装済み
  - `/search` パスへのアクセスをブロック
  - 401 Unauthorizedレスポンスが正しく返される

- [ ] **Cognito JWT検証が正常に機能**
  - `aws-jwt-verify` を使用した検証実装
  - ユーザープールIDとクライアントIDが正しく設定
  - トークンの署名検証が成功

- [ ] **トークンの有効期限チェック**
  - 期限切れトークンが拒否される
  - 自動リフレッシュ機能が動作

- [ ] **セッション管理**
  - セッションタイムアウト設定（推奨: 30分）
  - アイドルタイムアウト実装
  - ログアウト時のトークン無効化

### データ保護

- [ ] **HTTPSのみ許可**
  - CloudFront設定で `viewer_protocol_policy = "redirect-to-https"`
  - TLS 1.2以上のみ許可
  - 自己署名証明書を使用していない

- [ ] **トークンのセキュアな保存**
  - HttpOnly Cookie使用（推奨）
  - Secure フラグ有効
  - SameSite=Strict 設定

- [ ] **機密情報の暗号化**
  - 環境変数に機密情報（秘密鍵など）を保存していない
  - AWS Secrets Manager または Parameter Store 使用

### セキュリティヘッダー

- [ ] **Content-Security-Policy (CSP)**
  ```
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.amazonaws.com;
  connect-src 'self' https://*.amazonaws.com https://cognito-idp.*.amazonaws.com;
  ```

- [ ] **Strict-Transport-Security (HSTS)**
  ```
  max-age=31536000; includeSubDomains; preload
  ```

- [ ] **X-Frame-Options**
  ```
  DENY
  ```

- [ ] **X-Content-Type-Options**
  ```
  nosniff
  ```

- [ ] **Referrer-Policy**
  ```
  strict-origin-when-cross-origin
  ```

### アクセス制御

- [ ] **S3バケットが非公開**
  - パブリックアクセスブロック有効
  - CloudFront OAI経由のみアクセス可能

- [ ] **IAM権限の最小化**
  - 必要最小限の権限のみ付与
  - ワイルドカード (`*`) の使用を最小限に

- [ ] **CORS設定の検証**
  - 許可するオリジンを明示的に指定
  - ワイルドカード (`*`) を使用していない

---

## 🟡 P1 - High (デプロイ後1週間以内)

### ログとモニタリング

- [ ] **CloudWatch Logs設定**
  - Lambda@Edge関数のログ記録有効
  - エラーログの保持期間設定（推奨: 30日）

- [ ] **セキュリティイベントのログ記録**
  - 認証失敗の記録
  - 異常なアクセスパターンの検出
  - トークン検証エラーの記録

- [ ] **アラート設定**
  - 認証失敗率が閾値を超えた場合のアラート
  - 403/401エラー急増のアラート
  - Lambda@Edgeエラー率のアラート

### 脆弱性スキャン

- [ ] **依存関係の脆弱性チェック**
  ```bash
  npm audit
  yarn audit
  ```

- [ ] **Snyk または Dependabot 有効化**
  - 自動的な脆弱性検出
  - PRの自動作成

- [ ] **SASToolの実行**
  - ESLint セキュリティプラグイン
  - SonarQube またはCodeQL

### テスト

- [ ] **セキュリティテスト実施**
  - 認証バイパステスト
  - トークン検証テスト
  - CSRF攻撃テスト
  - XSS攻撃テスト

- [ ] **ペネトレーションテスト**
  - OWASP ZAPまたはBurp Suiteでスキャン
  - 主要な脆弱性の確認

---

## 🟢 P2 - Medium (デプロイ後1ヶ月以内)

### コンプライアンス

- [ ] **GDPR対応**
  - データ処理の法的根拠を文書化
  - プライバシーポリシーの掲載
  - Cookie同意バナーの実装

- [ ] **データ保持ポリシー**
  - ログの保持期間を定義
  - 不要データの定期削除

- [ ] **インシデント対応計画**
  - セキュリティインシデント発生時の手順を文書化
  - 責任者の明確化

### パフォーマンスとコスト

- [ ] **Lambda@Edgeのコスト最適化**
  - 実行時間の最小化
  - メモリ使用量の最適化
  - 不要な検証処理の削除

- [ ] **CloudFrontキャッシュ戦略**
  - 認証不要なパスのキャッシュ最大化
  - 認証必要なパスのキャッシュ無効化

---

## 🔧 検証方法

### 1. 認証チェックの検証

```bash
# 認証なしでアクセス（401 Unauthorizedが返るべき）
curl -I https://search.cis-filesearch.com/search

# 期待される結果:
# HTTP/2 401
# content-type: text/html
```

### 2. セキュリティヘッダーの検証

```bash
# セキュリティヘッダーをチェック
curl -I https://search.cis-filesearch.com/

# 期待されるヘッダー:
# strict-transport-security: max-age=31536000; includeSubDomains; preload
# x-frame-options: DENY
# x-content-type-options: nosniff
# content-security-policy: ...
```

### 3. トークン検証の確認

```javascript
// ブラウザコンソールで実行
// 無効なトークンでアクセス
document.cookie = 'CognitoIdToken=invalid_token';
location.reload();

// 期待される結果: ログインページにリダイレクト
```

### 4. JavaScript無効化テスト

```
1. ブラウザのJavaScriptを無効化
2. https://search.cis-filesearch.com/search にアクセス
3. 期待される結果: Lambda@Edgeで401 Unauthorizedが返される
```

---

## 📊 セキュリティ監査ツール

### オンラインツール

- [Mozilla Observatory](https://observatory.mozilla.org/)
  - セキュリティヘッダーのスコアリング

- [Security Headers](https://securityheaders.com/)
  - HTTPセキュリティヘッダーの検証

- [SSL Labs](https://www.ssllabs.com/ssltest/)
  - SSL/TLS設定の評価

### CLIツール

```bash
# OWASP ZAP (ペネトレーションテスト)
docker run -t owasp/zap2docker-stable zap-baseline.py -t https://search.cis-filesearch.com

# Nmap (ポートスキャン)
nmap -sV -p 443 search.cis-filesearch.com

# testssl.sh (SSL/TLS検証)
./testssl.sh https://search.cis-filesearch.com
```

---

## 🚨 レッドフラグ（即時対応が必要な問題）

- ❌ 静的HTMLファイル（`/search.html`）が認証なしでアクセス可能
- ❌ Local StorageにCognitoトークンが平文保存されている
- ❌ セキュリティヘッダーが設定されていない
- ❌ HTTP接続が許可されている
- ❌ S3バケットがパブリックアクセス可能
- ❌ 環境変数に機密情報がハードコード
- ❌ CORS設定で `*` を許可

これらの問題が1つでも存在する場合、**本番環境へのデプロイを中止**してください。

---

## ✅ デプロイ承認

すべてのP0項目が完了し、以下の担当者が承認した場合のみデプロイ可能:

- [ ] セキュリティ責任者: ________________ 日付: ________
- [ ] プロジェクトマネージャー: ________________ 日付: ________
- [ ] インフラ担当: ________________ 日付: ________

**署名:**

____________________________
セキュリティ責任者

____________________________
プロジェクトマネージャー
