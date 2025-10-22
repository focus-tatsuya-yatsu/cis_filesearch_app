# Pattern 3: S3静的ホスティング + CloudFront + Cognito認証 アーキテクチャ図

## 概要

このディレクトリには、CIS File Search Application Pattern 3（月次バッチ同期アーキテクチャ）のフロントエンド最適化版（S3静的ホスティング + CloudFront + AWS Cognito認証）の詳細なPlantUMLアーキテクチャ図が含まれています。

## アーキテクチャ変更概要

### 変更前（ECS Fargate + Azure AD SSO）
- **フロントエンド**: ECS Fargate (0.25 vCPU, 0.5GB RAM)
- **認証**: Azure AD SSO (既存企業契約)
- **月額コスト**: $70.24/月

### 変更後（S3 + CloudFront + Cognito）
- **フロントエンド**: S3静的ホスティング + CloudFront CDN
- **認証**: AWS Cognito User Pool (OAuth 2.0 PKCE)
- **月額コスト**: **$51.79/月** (**26.3%削減** = -$18.45/月)

## ドキュメント構成

| ファイル名 | 説明 | 主な内容 |
|-----------|------|---------|
| **pattern3-s3-cognito-architecture.puml** | メインアーキテクチャ図 | ・全体システム構成<br>・認証フロー<br>・検索フロー<br>・バッチ同期フロー<br>・コスト内訳 |
| **pattern3-cognito-auth-sequence.puml** | 認証シーケンス詳細図 | ・OAuth 2.0 PKCE詳細<br>・JWT発行・検証<br>・トークンリフレッシュ<br>・API認可フロー |
| **pattern3-deployment-flow.puml** | デプロイフロー図 | ・GitHub Actions CI/CD<br>・S3デプロイ<br>・CloudFront Invalidation<br>・ロールバック戦略 |

## PlantUML図のレンダリング方法

### 1. PlantUML拡張機能（VS Code）

**推奨環境**: Visual Studio Code

**手順**:
```bash
# 1. VS Code拡張機能をインストール
# Extensions → "PlantUML" で検索 → インストール

# 2. Graphvizをインストール (macOS)
brew install graphviz

# 3. .pumlファイルを開く
code docs/pattern3-s3-cognito-architecture.puml

# 4. プレビュー表示
# - macOS: Option + D
# - Windows/Linux: Alt + D
```

### 2. PlantUML Web Server（オンライン）

**URL**: https://www.plantuml.com/plantuml/uml/

**手順**:
1. `.puml`ファイルの内容をコピー
2. 上記URLにアクセス
3. テキストエリアに貼り付け
4. 「Submit」をクリックしてレンダリング

### 3. コマンドライン（PNG/SVG出力）

**必要なツール**:
- Java (JRE 8以上)
- Graphviz

**インストール (macOS)**:
```bash
brew install plantuml graphviz
```

**PNG生成**:
```bash
# 単一ファイル
plantuml docs/pattern3-s3-cognito-architecture.puml

# ディレクトリ内全ファイル
plantuml docs/*.puml

# SVG形式で出力
plantuml -tsvg docs/pattern3-s3-cognito-architecture.puml
```

**出力先**: 同じディレクトリに `.png` または `.svg` ファイルが生成されます

### 4. Docker（環境構築不要）

```bash
# PlantUML Dockerコンテナを使用
docker run --rm -v $(pwd):/data plantuml/plantuml:latest \
  -tsvg /data/docs/pattern3-s3-cognito-architecture.puml

# 出力: docs/pattern3-s3-cognito-architecture.svg
```

## 各図の詳細説明

### 1. pattern3-s3-cognito-architecture.puml

**メインアーキテクチャ図**

**含まれる要素**:
- ✅ ユーザー層 (50名のブラウザアクセス)
- ✅ フロントエンド配信層
  - Route53 (DNS)
  - CloudFront (CDN)
  - ACM証明書 (TLS 1.3)
  - S3静的ホスティング (Next.js Static Export)
- ✅ 認証・認可層
  - Cognito User Pool
  - Cognito Hosted UI
  - Identity Pool (IAM Roles)
- ✅ オンプレミス環境
  - NAS Server (500GB, 1,000,000 files)
  - DataSync Agent
  - VPN Router
- ✅ AWS VPC
  - Public Subnet (NAT Gateway)
  - Private Subnet 1 (Lambda Functions, OpenSearch)
  - Private Subnet 2 (SearchAPI Lambda)
- ✅ API層
  - API Gateway (Cognito Authorizer)
  - SearchAPI Lambda
- ✅ マネージドサービス層
  - DataSync (月次バッチ同期)
  - S3 Backend Bucket (メタデータ)
  - DynamoDB (file_metadata)
- ✅ オーケストレーション層
  - Step Functions (バッチワークフロー)
  - EventBridge (スケジューラ)
  - SNS (通知)
- ✅ 監視層
  - CloudWatch (Logs, Metrics, Alarms)

**フロー表示**:
- 🟣 **紫色（太線）**: 認証フロー (OAuth 2.0 PKCE)
- 🟢 **緑色（太線）**: 検索フロー (Cognito JWT認証済み)
- 🔵 **青色（太線）**: バッチ同期フロー (月1回)
- 🟠 **オレンジ色（極太線）**: データ転送 (増分20GB)
- 🔵 **青色（点線）**: VPN接続 (月4時間のみ)
- 🔷 **シアン色（点線）**: 監視ログ

**コスト内訳**:
- OpenSearch: $31.57 (61.0%)
- DataSync: $5.00 (9.7%)
- CloudWatch: $4.00 (7.7%)
- Cognito: $2.50 (4.8%)
- S3 (backend): $2.13 (4.1%)
- CloudFront: $2.05 (4.0%)
- Lambda: $1.35 (2.6%)
- DynamoDB: $0.99 (1.9%)
- Route53: $0.50 (1.0%)
- API Gateway: $0.20 (0.4%)
- S3 (frontend): $0.01 (0.0%)
- ACM: $0.00 (無料)
- その他: $1.50 (2.9%)
- **合計**: **$51.79/月**

### 2. pattern3-cognito-auth-sequence.puml

**認証シーケンス詳細図**

**含まれる要素**:
- 👤 ユーザー
- 🌐 Browser (Next.js SPA)
- ☁️ CloudFront
- 🪣 S3 Bucket (Static)
- 🎨 Cognito Hosted UI
- 🔐 Cognito User Pool
- 🔌 API Gateway (Cognito Authorizer)
- λ SearchAPI Lambda
- 🔍 OpenSearch
- 🗂️ DynamoDB

**フローステップ**:
1. **初回アクセス（未認証）**
   - CloudFront経由でNext.js SPAアクセス
   - localStorage確認（トークンなし）
   - PKCE Code Verifier生成 (43-128文字)
   - Code Challenge生成 (SHA-256ハッシュ)
   - Cognito Hosted UIにリダイレクト

2. **ユーザー認証**
   - ログイン画面表示
   - username/password入力
   - パスワード検証 (12+文字、複雑性要件)
   - MFAチャレンジ (TOTP/SMS - Optional)
   - Authorization Code発行 (有効期限: 5分)

3. **トークン交換**
   - Authorization Code → JWT Tokens
   - PKCE Code Verifier検証
   - JWT発行 (RS256署名)
     - ID Token (ユーザー情報、60分有効)
     - Access Token (API認可、60分有効)
     - Refresh Token (トークン更新、30日有効)
   - localStorageに保存

4. **検索API呼び出し（認証済み）**
   - Access Token有効期限チェック
   - API Gatewayに`Authorization: Bearer {token}`付与
   - Cognito AuthorizerがJWT検証
     - JWKS取得 (/.well-known/jwks.json)
     - RS256署名検証
     - exp, iss, aud検証
   - 認可コンテキスト生成 (sub, email)
   - SearchAPI Lambda実行
   - OpenSearch検索 + DynamoDBメタデータ取得
   - 検索結果返却

5. **トークンリフレッシュ（1時間後）**
   - Access Token期限切れ検出
   - Refresh Tokenで新しいAccess Token取得
   - localStorage更新
   - 検索リクエスト再送

**セキュリティポイント**:
- ✅ PKCE (Proof Key for Code Exchange) によるAuthorization Code Interception Attack対策
- ✅ RS256署名によるJWT検証 (公開鍵暗号)
- ✅ MFA (Multi-Factor Authentication) オプション
- ✅ Advanced Security Features (不正アクセス検知)

### 3. pattern3-deployment-flow.puml

**デプロイフロー図**

**含まれる要素**:
- 👨‍💻 開発者
- 📁 ローカルリポジトリ (src/, next.config.js)
- 🔄 GitHub Actions (CI/CDパイプライン)
- 🪣 S3 Bucket (cis-filesearch-frontend-prod)
- ☁️ CloudFront Distribution
- 🌐 Route53
- 📊 CloudWatch

**CI/CDステップ**:
1. **Trigger** (git push to main)
2. **Checkout** (actions/checkout@v4)
3. **Setup Node.js** (Node.js 20, cache: yarn)
4. **Install Dependencies** (yarn install --frozen-lockfile)
5. **Lint & Test** (yarn lint, yarn test, yarn type-check)
6. **Build Next.js** (yarn build)
   - 環境変数埋め込み:
     - NEXT_PUBLIC_COGNITO_USER_POOL_ID
     - NEXT_PUBLIC_COGNITO_CLIENT_ID
     - NEXT_PUBLIC_API_ENDPOINT
7. **Static Export** (yarn export → out/)
8. **Configure AWS** (AWS Credentials設定)
9. **S3 Sync**
   - 静的アセット (JS/CSS): `Cache-Control: public, max-age=31536000, immutable`
   - HTMLファイル: `Cache-Control: public, max-age=300, must-revalidate`
   - `--delete` オプション (古いファイル削除)
10. **CloudFront Invalidation** (パス: `/*`, 完了時間: 30-60秒)
11. **Deployment Summary** (通知、メトリクス記録)

**デプロイ時間**:
- 合計: **約3分25秒**
- CloudFront配信開始: Invalidation完了後30-60秒
- **実質ダウンタイム**: **0秒** (Blue/Green自動切替)

**ロールバック戦略**:
- **方法1**: S3バージョニング復元 (1-2分)
  ```bash
  aws s3api copy-object \
    --copy-source bucket/index.html?versionId=xxx \
    --bucket bucket \
    --key index.html
  ```
- **方法2**: GitHub Actions Revert
  ```bash
  git revert HEAD
  git push origin main
  ```

**キャッシュ戦略**:
- 静的アセット (JS/CSS/Images): 1年間キャッシュ、ファイル名にハッシュ含む
- HTMLファイル: 5分間キャッシュ、デプロイ時にInvalidation
- APIレスポンス: キャッシュしない
- **キャッシュヒット率目標**: 90%以上

## 技術仕様

### フロントエンド
- **Framework**: Next.js 15 (Static Export)
- **Build Output**: 50MB (gzip圧縮前)
- **Storage**: S3 Intelligent-Tiering
- **CDN**: CloudFront (TLS 1.3, Brotli/Gzip圧縮)
- **Domain**: filesearch.company.com

### 認証
- **サービス**: AWS Cognito User Pool
- **プロトコル**: OAuth 2.0 Authorization Code Grant with PKCE
- **Token Type**: JWT (RS256署名)
- **MFA**: TOTP/SMS (Optional)
- **Advanced Security**: 不正アクセス検知、リスクベース認証

### API
- **Service**: API Gateway (REST API)
- **Authorizer**: Cognito User Pools Authorizer
- **Custom Domain**: api.filesearch.company.com
- **Rate Limiting**: 100 req/秒

### インフラ
- **Region**: ap-northeast-1 (東京)
- **VPC**: 10.0.0.0/16
- **Subnets**:
  - Public Subnet: 10.0.0.0/24 (AZ-a)
  - Private Subnet 1: 10.0.1.0/24 (AZ-a) - Lambda Functions, OpenSearch
  - Private Subnet 2: 10.0.2.0/24 (AZ-b) - SearchAPI Lambda (Multi-AZ)

### コスト最適化
- **ECS Fargate削減**: -$18.45/月 (26.3%削減)
- **S3 Intelligent-Tiering**: アクセスパターンに応じた自動階層化
- **CloudFront Cache**: 静的アセット1年間キャッシュ
- **Lambda ARM64**: Graviton2による20%コスト削減
- **Cognito無料枠**: 50,000 MAU/月まで無料 (現在50 MAU)

## パフォーマンス指標

| メトリクス | ECS Fargate | S3 + CloudFront | 改善率 |
|-----------|------------|-----------------|--------|
| **TTFB** | 200-500ms | 50-150ms | **3-5倍高速** |
| **ページロード** | 1-2秒 | 0.5-1秒 | **2倍高速** |
| **可用性 SLA** | 99.9% | 99.99% (S3) | **0.09%向上** |
| **同時接続数** | 50-100 | 無制限 | **制限なし** |
| **グローバル配信** | 東京のみ | 200+エッジロケーション | **グローバル** |

## セキュリティ設計

### 認証・認可
- ✅ OAuth 2.0 PKCE (Authorization Code Interception Attack対策)
- ✅ JWT RS256署名検証
- ✅ MFA (TOTP/SMS) オプション
- ✅ パスワードポリシー: 12+文字、複雑性要件
- ✅ アカウントロックアウト (5回失敗で30分ロック)
- ✅ Advanced Security Features (不正アクセス検知)

### ネットワーク
- ✅ HTTPS必須 (TLS 1.3)
- ✅ CloudFront Origin Access Control (OAC)
- ✅ API Gateway IPアドレス制限
- ✅ VPC Security Groups
- ✅ NACLs (Network ACLs)

### データ保護
- ✅ S3サーバーサイド暗号化 (AES-256)
- ✅ S3バージョニング (誤削除防止)
- ✅ CloudWatch監視・アラート
- ✅ CloudTrail監査ログ

### Content Security Policy (CSP)
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cognito...;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://api.filesearch.company.com https://cognito...;
  frame-ancestors 'none';
```

## 運用設計

### 監視項目
- ✅ CloudFront 5xx Error Rate
- ✅ Cognito認証失敗率
- ✅ API Gateway 4xx/5xxエラー
- ✅ Lambda Duration/Errors
- ✅ OpenSearch CPU/Memory使用率
- ✅ DynamoDB Read/Write Throttles

### アラート設定
- ❗ CloudFront 5xx Error Rate > 5% (5分間)
- ❗ Cognito認証失敗 > 10回 (5分間)
- ❗ API Gateway 5xxエラー > 5回 (10分間)
- ❗ Lambda Errors > 3回 (1分間)

### ログ保持期間
- CloudWatch Logs: 30日間
- CloudFront Access Logs (S3): 90日間 → Glacier
- VPC Flow Logs: 7日間

### バックアップ
- S3バージョニング: 有効 (90日間保持)
- DynamoDB: Point-in-Time Recovery (35日間)
- Cognito ユーザー: 月次バックアップ (S3)

## 実装ガイド

### Phase 1: インフラ構築 (Week 1)
```bash
cd terraform
terraform init
terraform plan
terraform apply
```

### Phase 2: フロントエンド実装 (Week 2-3)
```bash
# 認証パッケージインストール
yarn add amazon-cognito-identity-js aws-jwt-verify jwt-decode

# 開発サーバー起動
yarn dev
```

### Phase 3: デプロイ設定 (Week 4)
```bash
# GitHub Actionsシークレット設定
gh secret set AWS_ACCESS_KEY_ID
gh secret set AWS_SECRET_ACCESS_KEY
gh secret set COGNITO_USER_POOL_ID
gh secret set COGNITO_CLIENT_ID
gh secret set CLOUDFRONT_DISTRIBUTION_ID

# 初回デプロイ
yarn build
yarn export
aws s3 sync out/ s3://cis-filesearch-frontend-prod/
aws cloudfront create-invalidation --distribution-id E1XXXXXXXXX --paths "/*"
```

### Phase 4: 本番移行 (Week 5)
1. Cognito管理画面から50名のユーザー作成
2. MFA有効化（オプション）
3. CloudWatchアラーム設定
4. 動作確認・負荷テスト

## トラブルシューティング

### 問題1: CloudFront 403エラー
**原因**: S3バケットポリシーが正しく設定されていない

**解決策**:
```bash
# S3バケットポリシー確認
aws s3api get-bucket-policy --bucket cis-filesearch-frontend-prod

# CloudFront OAC確認
aws cloudfront get-distribution-config --id E1XXXXXXXXX
```

### 問題2: Cognito認証後にリダイレクトされない
**原因**: コールバックURLが正しく設定されていない

**解決策**:
```bash
# Cognitoアプリクライアント設定確認
aws cognito-idp describe-user-pool-client \
  --user-pool-id ap-northeast-1_xxxxxxxxx \
  --client-id xxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 問題3: API Gateway 401エラー
**原因**: JWT検証失敗

**解決策**:
```javascript
// ブラウザのコンソールでトークン確認
const token = localStorage.getItem('access_token');
const decoded = jwtDecode(token);
console.log('Token exp:', new Date(decoded.exp * 1000));
console.log('Current time:', new Date());

// トークンリフレッシュ
await refreshAccessToken();
```

## 参考資料

### AWS公式ドキュメント
- [AWS CloudFront Developer Guide](https://docs.aws.amazon.com/cloudfront/)
- [AWS Cognito Developer Guide](https://docs.aws.amazon.com/cognito/)
- [Amazon S3 Static Website Hosting](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html)
- [API Gateway Cognito Authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html)

### Next.js
- [Next.js Static Exports](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)

### OAuth 2.0 / PKCE
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
- [OAuth 2.0 for Browser-Based Apps (Best Practices)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)

### プロジェクト内ドキュメント
- [pattern3-s3-cognito-cost-analysis.md](./pattern3-s3-cognito-cost-analysis.md) - コスト分析詳細
- [pattern3-s3-cloudfront-cognito-architecture.md](./pattern3-s3-cloudfront-cognito-architecture.md) - インフラ設計詳細
- [pattern3-cognito-security-assessment.md](./pattern3-cognito-security-assessment.md) - セキュリティ評価

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|-----|------|----------|--------|
| 1.0 | 2025-01-19 | PlantUMLアーキテクチャ図初版作成 | CIS開発チーム |

## ライセンス

本ドキュメントはCIS File Search Applicationプロジェクトの一部です。
