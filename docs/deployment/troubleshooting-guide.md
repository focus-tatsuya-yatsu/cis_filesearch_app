# CIS File Search Application - トラブルシューティングガイド

**バージョン**: 1.0.0
**最終更新日**: 2025-01-07

このガイドでは、デプロイおよび運用中に発生する可能性のある問題の診断と解決方法を説明します。

---

## 📋 目次

1. [ビルドエラー](#1-ビルドエラー)
2. [S3アップロードエラー](#2-s3アップロードエラー)
3. [CloudFrontアクセスエラー](#3-cloudfrontアクセスエラー)
4. [Cognito認証エラー](#4-cognito認証エラー)
5. [パフォーマンス問題](#5-パフォーマンス問題)
6. [セキュリティヘッダー問題](#6-セキュリティヘッダー問題)
7. [ロールバック手順](#7-ロールバック手順)
8. [よくある質問](#8-よくある質問)

---

## 1. ビルドエラー

### 問題1.1: TypeScriptコンパイルエラー

**症状**:
```
Type error: Property 'xxx' does not exist on type 'yyy'
Error: Command failed with exit code 1
```

**CVSS Score**: 0.0 (開発環境のみ影響)

**原因**:
- TypeScriptの型定義エラー
- props または state の型不一致
- インポートされたモジュールの型が解決できない

**診断手順**:
```bash
# 型チェックのみ実行
yarn tsc --noEmit

# 特定ファイルの型チェック
yarn tsc --noEmit --watch src/components/Auth/LoginForm.tsx
```

**解決策**:

1. **型定義の確認**:
   ```typescript
   // エラー例:
   // Property 'loginWithHostedUI' does not exist on type 'AuthContextType'

   // 解決策: AuthContextType に loginWithHostedUI を追加
   interface AuthContextType {
     loginWithHostedUI: () => Promise<void>;
     // ...
   }
   ```

2. **依存関係の型定義インストール**:
   ```bash
   # @types パッケージのインストール
   yarn add -D @types/node @types/react @types/react-dom
   ```

3. **tsconfig.json の確認**:
   ```json
   {
     "compilerOptions": {
       "strict": true,
       "skipLibCheck": true,
       "moduleResolution": "bundler"
     }
   }
   ```

---

### 問題1.2: ESLintエラー

**症状**:
```
Error: 'xxx' is not defined  (no-undef)
Error: 'xxx' is assigned a value but never used  (no-unused-vars)
```

**CVSS Score**: 0.0 (コード品質の問題)

**原因**:
- ESLintルール違反
- 未使用のimport文
- 未定義の変数

**診断手順**:
```bash
# ESLint実行
yarn lint

# 特定ファイルのみチェック
yarn lint src/components/Auth/LoginForm.tsx

# 詳細な出力
yarn lint --debug
```

**解決策**:

1. **自動修正**:
   ```bash
   # 自動修正可能なエラーを修正
   yarn lint --fix
   ```

2. **未使用変数の削除**:
   ```typescript
   // エラー例:
   import { useState, useEffect } from 'react'; // useEffect is defined but never used

   // 解決策: 未使用のimportを削除
   import { useState } from 'react';
   ```

3. **ESLintルールの一時的な無効化**（最終手段）:
   ```typescript
   // eslint-disable-next-line @typescript-eslint/no-explicit-any
   const data: any = await fetchData();
   ```

---

### 問題1.3: 環境変数エラー

**症状**:
```
Error: Missing required environment variables: NEXT_PUBLIC_COGNITO_USER_POOL_ID
```

**CVSS Score**: 5.0 (Medium) - 認証システムが動作しない

**原因**:
- `.env.local` ファイルが存在しない
- 環境変数が正しく設定されていない
- 環境変数名のタイプミス

**診断手順**:
```bash
# .env.local ファイルの存在確認
ls -la .env.local

# 環境変数の内容確認
cat .env.local

# 環境変数の数を確認
cat .env.local | grep -v "^#" | grep -v "^$" | wc -l
# 期待される出力: 5
```

**解決策**:

1. **環境変数ファイルの作成**:
   ```bash
   cp .env.local.example .env.local
   nano .env.local
   ```

2. **必要な環境変数の設定**:
   ```bash
   NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_XXXXXXXXX
   NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=abcd1234efgh5678
   NEXT_PUBLIC_COGNITO_DOMAIN=filesearch.auth.ap-northeast-1.amazoncognito.com
   NEXT_PUBLIC_APP_URL=https://d1234567890abc.cloudfront.net
   NEXT_PUBLIC_API_GATEWAY_URL=https://api.example.com/v1
   ```

3. **環境変数のバリデーション**:
   ```bash
   # バリデーションスクリプトを実行
   node -e "
   require('dotenv').config({ path: '.env.local' });
   const required = ['NEXT_PUBLIC_COGNITO_USER_POOL_ID', 'NEXT_PUBLIC_COGNITO_APP_CLIENT_ID'];
   const missing = required.filter(key => !process.env[key]);
   if (missing.length > 0) {
     console.error('Missing:', missing.join(', '));
     process.exit(1);
   }
   console.log('✅ All required variables are set');
   "
   ```

---

## 2. S3アップロードエラー

### 問題2.1: アクセス拒否エラー

**症状**:
```
upload failed: ./out/index.html to s3://bucket-name/index.html
An error occurred (AccessDenied) when calling the PutObject operation: Access Denied
```

**CVSS Score**: 6.0 (Medium) - デプロイが完了しない

**原因**:
- AWSの認証情報が設定されていない
- IAMユーザーのS3権限不足
- S3バケットポリシーによるアクセス制限

**診断手順**:
```bash
# AWS認証情報の確認
aws sts get-caller-identity

# S3バケットへのアクセステスト
aws s3 ls s3://cis-filesearch-frontend-prod/

# IAMユーザーの権限確認
aws iam get-user-policy --user-name your-username --policy-name S3AccessPolicy
```

**解決策**:

1. **AWS認証情報の設定**:
   ```bash
   # AWS CLIの設定
   aws configure

   # 入力内容:
   # AWS Access Key ID: AKIAIOSFODNN7EXAMPLE
   # AWS Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   # Default region name: ap-northeast-1
   # Default output format: json
   ```

2. **IAMポリシーの追加**:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:DeleteObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::cis-filesearch-frontend-prod",
           "arn:aws:s3:::cis-filesearch-frontend-prod/*"
         ]
       }
     ]
   }
   ```

3. **S3バケットポリシーの確認**:
   ```bash
   aws s3api get-bucket-policy \
     --bucket cis-filesearch-frontend-prod \
     --query Policy \
     --output text | jq .
   ```

---

### 問題2.2: ファイルサイズエラー

**症状**:
```
upload failed: file size exceeds maximum allowed size
```

**CVSS Score**: 3.0 (Low) - 一部ファイルがアップロードされない

**原因**:
- ファイルサイズが5GBを超えている
- マルチパートアップロードが必要

**診断手順**:
```bash
# 大きいファイルを検索
find out -type f -size +100M

# ファイルサイズの確認
du -sh out/*
```

**解決策**:

1. **マルチパートアップロードの使用**:
   ```bash
   # 5GB以上のファイルは自動的にマルチパートアップロードされる
   aws s3 cp ./large-file.zip s3://bucket-name/ \
     --storage-class STANDARD
   ```

2. **ファイルの圧縮**:
   ```bash
   # 画像ファイルの最適化
   find out -name "*.png" -exec pngquant --quality=70-80 {} \;

   # JavaScriptファイルの圧縮（Next.jsビルド時に自動実行）
   ```

---

## 3. CloudFrontアクセスエラー

### 問題3.1: 403 Forbiddenエラー

**症状**:
ブラウザで `https://d1234567890abc.cloudfront.net` にアクセスすると `403 Forbidden` エラー

**CVSS Score**: 7.0 (High) - アプリケーションにアクセスできない

**原因**:
- S3バケットポリシーが正しく設定されていない
- CloudFront OAC設定が不完全
- Default Root Objectが設定されていない

**診断手順**:
```bash
# CloudFront Distribution設定を確認
aws cloudfront get-distribution \
  --id E1234567890ABC \
  --query "Distribution.DistributionConfig.DefaultRootObject" \
  --output text

# 期待される出力: index.html

# S3バケットポリシーを確認
aws s3api get-bucket-policy \
  --bucket cis-filesearch-frontend-prod
```

**解決策**:

1. **Default Root Objectの設定**:
   ```bash
   # CloudFront Distribution設定を取得
   aws cloudfront get-distribution-config --id E1234567890ABC > dist-config.json

   # DefaultRootObjectを設定（JSONを編集）
   # "DefaultRootObject": "index.html"

   # 設定を更新
   ETAG=$(aws cloudfront get-distribution-config --id E1234567890ABC --query "ETag" --output text)
   aws cloudfront update-distribution \
     --id E1234567890ABC \
     --distribution-config file://dist-config.json \
     --if-match "$ETAG"
   ```

2. **S3バケットポリシーの修正**:
   ```bash
   # バケットポリシーファイルを編集
   nano s3-bucket-policy.json

   # CloudFront OAC用のステートメントを追加
   {
     "Sid": "AllowCloudFrontOAC",
     "Effect": "Allow",
     "Principal": {
       "Service": "cloudfront.amazonaws.com"
     },
     "Action": "s3:GetObject",
     "Resource": "arn:aws:s3:::cis-filesearch-frontend-prod/*",
     "Condition": {
       "StringEquals": {
         "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/E1234567890ABC"
       }
     }
   }

   # ポリシーを適用
   aws s3api put-bucket-policy \
     --bucket cis-filesearch-frontend-prod \
     --policy file://s3-bucket-policy.json
   ```

3. **Invalidationの実行**:
   ```bash
   aws cloudfront create-invalidation \
     --distribution-id E1234567890ABC \
     --paths "/*"
   ```

---

### 問題3.2: 404 Not Foundエラー

**症状**:
特定のページにアクセスすると `404 Not Found` エラー

**CVSS Score**: 5.0 (Medium) - 一部ページにアクセスできない

**原因**:
- ファイルがS3にアップロードされていない
- ファイル名の大文字小文字が一致していない
- CloudFront Invalidationが完了していない

**診断手順**:
```bash
# S3バケット内のファイルを確認
aws s3 ls s3://cis-filesearch-frontend-prod/ --recursive | grep "search.html"

# 期待される出力:
# 2025-01-07 11:00:00      12345 search.html

# Invalidation状態を確認
aws cloudfront list-invalidations --distribution-id E1234567890ABC
```

**解決策**:

1. **ファイルの再アップロード**:
   ```bash
   # 特定ファイルをアップロード
   aws s3 cp out/search.html s3://cis-filesearch-frontend-prod/search.html

   # すべてのファイルを同期
   aws s3 sync ./out/ s3://cis-filesearch-frontend-prod/
   ```

2. **Error Pagesの設定**:
   CloudFront Console → Distribution → Error pages → Create custom error response
   - HTTP Error Code: `404`
   - Error Caching Minimum TTL: `10` (seconds)
   - Customize Error Response: Yes
   - Response Page Path: `/404.html`
   - HTTP Response Code: `404`

---

## 4. Cognito認証エラー

### 問題4.1: ログインボタンが反応しない

**症状**:
ログインボタンをクリックしても何も起こらない、またはコンソールにエラーが表示される

**CVSS Score**: 8.0 (High) - 認証機能が動作しない

**原因**:
- Cognito Callback URLが正しく設定されていない
- 環境変数が正しく設定されていない
- CSPがCognitoドメインをブロックしている

**診断手順**:
```bash
# ブラウザ開発者ツールのConsoleタブを開く

# エラーメッセージの例:
# Refused to connect to 'https://cis-filesearch.auth.ap-northeast-1.amazoncognito.com' because it violates the following Content Security Policy directive

# Cognito App Client設定を確認
aws cognito-idp describe-user-pool-client \
  --user-pool-id ap-northeast-1_abcDEF123 \
  --client-id 1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p \
  --query "UserPoolClient.CallbackURLs"

# 期待される出力:
# [
#     "https://d1234567890abc.cloudfront.net/auth/callback"
# ]
```

**解決策**:

1. **Callback URLの設定**:
   - Cognito Console → User pools → CIS-FileSearch-UserPool
   - App integration → App clients → CIS-FileSearch-WebClient
   - Hosted UI → Allowed callback URLs に追加:
     ```
     https://d1234567890abc.cloudfront.net/auth/callback
     ```

2. **CSPの修正**:
   ```
   connect-src 'self' https://cognito-idp.ap-northeast-1.amazonaws.com https://*.amazoncognito.com https://*.execute-api.ap-northeast-1.amazonaws.com;
   ```

   CloudFront Response Headers Policyを更新してください。

3. **環境変数の確認**:
   ```bash
   # ブラウザ開発者ツールで確認
   # Console タブで実行:
   console.log('COGNITO_DOMAIN:', process.env.NEXT_PUBLIC_COGNITO_DOMAIN);
   console.log('APP_URL:', process.env.NEXT_PUBLIC_APP_URL);
   ```

---

### 問題4.2: ログイン後に無限リダイレクト

**症状**:
ログイン成功後、ページが無限にリダイレクトを繰り返す

**CVSS Score**: 7.0 (High) - ログイン完了できない

**原因**:
- OAuth callbackページの実装ミス
- トークンがLocal Storageに保存されていない
- Protected Routeの認証チェックが正しくない

**診断手順**:
```bash
# ブラウザ開発者ツール → Application タブ
# Local Storage → CloudFront URL を確認

# 期待されるキー:
# CognitoIdentityServiceProvider.{client_id}.{user}.idToken
# CognitoIdentityServiceProvider.{client_id}.{user}.accessToken
# CognitoIdentityServiceProvider.{client_id}.{user}.refreshToken
```

**解決策**:

1. **OAuth callbackページの確認**:
   ```typescript
   // src/app/auth/callback/page.tsx
   useEffect(() => {
     if (!isLoading) {
       if (isAuthenticated) {
         router.push('/search'); // ✅ 正しい
       } else {
         router.push('/'); // ✅ 正しい
       }
     }
   }, [isAuthenticated, isLoading, router]);
   ```

2. **AuthContextの確認**:
   ```typescript
   // src/contexts/AuthContext.tsx
   useEffect(() => {
     checkUser(); // ✅ 初回マウント時にセッションチェック
   }, [checkUser]);
   ```

3. **ブラウザキャッシュのクリア**:
   - Chrome: Cmd+Shift+Delete → Cookies and other site data → Clear data
   - Firefox: Cmd+Shift+Delete → Cookies → Clear
   - Safari: Cmd+Opt+E → Empty Caches

---

### 問題4.3: トークンの有効期限切れ

**症状**:
しばらく使用後、突然ログアウトされる、または `401 Unauthorized` エラー

**CVSS Score**: 5.0 (Medium) - ユーザー体験の低下

**原因**:
- ID Tokenの有効期限切れ（デフォルト60分）
- Refresh Tokenの有効期限切れ（デフォルト30日）
- トークン更新ロジックの欠如

**診断手順**:
```bash
# Cognito Token設定を確認
aws cognito-idp describe-user-pool-client \
  --user-pool-id ap-northeast-1_abcDEF123 \
  --client-id 1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p \
  --query "UserPoolClient.TokenValidityUnits"

# 期待される出力:
# {
#     "AccessToken": "hours",
#     "IdToken": "hours",
#     "RefreshToken": "days"
# }
```

**解決策**:

1. **トークン有効期限の延長**:
   - Cognito Console → User pools → App clients → CIS-FileSearch-WebClient
   - Token expiration → 設定を変更:
     - ID Token: `60 minutes`
     - Access Token: `60 minutes`
     - Refresh Token: `7 days` (推奨: 30日から短縮)

2. **自動トークン更新の実装**:
   ```typescript
   // src/contexts/AuthContext.tsx
   useEffect(() => {
     const interval = setInterval(async () => {
       try {
         await fetchAuthSession({ forceRefresh: true });
       } catch (error) {
         console.error('Token refresh failed:', error);
         // ログアウト処理
         await signOut();
       }
     }, 50 * 60 * 1000); // 50分ごとに更新

     return () => clearInterval(interval);
   }, []);
   ```

---

## 5. パフォーマンス問題

### 問題5.1: ページ読み込みが遅い

**症状**:
First Contentful Paint > 3秒、Lighthouse Performance Score < 80

**CVSS Score**: 3.0 (Low) - ユーザー体験の低下

**原因**:
- バンドルサイズが大きすぎる
- 画像が最適化されていない
- CloudFront キャッシュが効いていない

**診断手順**:
```bash
# Lighthouseを実行
lighthouse https://d1234567890abc.cloudfront.net \
  --output html \
  --output-path ./lighthouse-report.html

# バンドルサイズを分析
npx next build
npx source-map-explorer .next/static/chunks/*.js
```

**解決策**:

1. **画像の最適化**:
   ```typescript
   // Next.js Image コンポーネントを使用
   import Image from 'next/image';

   <Image
     src="/logo.png"
     alt="Logo"
     width={200}
     height={100}
     priority // LCPに含まれる画像
   />
   ```

2. **コード分割**:
   ```typescript
   // Dynamic import for heavy components
   import dynamic from 'next/dynamic';

   const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
     loading: () => <Spinner />,
     ssr: false,
   });
   ```

3. **Cache-Controlの最適化**:
   ```bash
   # 静的アセット（JS/CSS）
   aws s3 cp s3://.../abc123.js s3://.../abc123.js \
     --metadata-directive REPLACE \
     --cache-control "public, max-age=31536000, immutable"

   # HTMLファイル
   aws s3 cp s3://.../index.html s3://.../index.html \
     --metadata-directive REPLACE \
     --cache-control "public, max-age=0, must-revalidate"
   ```

---

## 6. セキュリティヘッダー問題

### 問題6.1: CSPエラー

**症状**:
ブラウザConsoleに `Refused to execute inline script because it violates the following Content Security Policy directive`

**CVSS Score**: 6.0 (Medium) - 機能が動作しない

**原因**:
- CSPの `script-src` が厳しすぎる
- インラインスクリプトが許可されていない

**診断手順**:
```bash
# ブラウザ開発者ツール → Network タブ
# Response Headers を確認

# content-security-policy: default-src 'self'; script-src 'self';
```

**解決策**:

1. **CSPの緩和**:
   ```
   script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cognito-idp.ap-northeast-1.amazonaws.com https://*.amazoncognito.com;
   ```

   `'unsafe-inline'` と `'unsafe-eval'` はNext.jsに必要です。

2. **nonce/hash ベースのCSP（将来の改善）**:
   ```typescript
   // next.config.js
   async headers() {
     return [
       {
         source: '/(.*)',
         headers: [
           {
             key: 'Content-Security-Policy',
             value: `script-src 'self' 'nonce-${nonce}';`,
           },
         ],
       },
     ];
   }
   ```

---

## 7. ロールバック手順

### 緊急ロールバック（15分以内）

**状況**: 本番環境で重大な問題が発生し、即座にロールバックが必要

**手順**:

1. **バックアップからS3バケットを復元**:
   ```bash
   # バックアップディレクトリを確認
   ls -la ~/backups/cis-filesearch-frontend/

   # 最新のバックアップを選択
   BACKUP_DIR=~/backups/cis-filesearch-frontend/backup_20250107_100000

   # S3バケットを上書き
   aws s3 sync "$BACKUP_DIR/" s3://cis-filesearch-frontend-prod/ --delete
   ```

2. **CloudFront Invalidationを実行**:
   ```bash
   aws cloudfront create-invalidation \
     --distribution-id E1234567890ABC \
     --paths "/*"

   # Invalidation IDをメモ
   # I2EXAMPLE123456
   ```

3. **Invalidation完了を監視**:
   ```bash
   # ステータス確認ループ
   while true; do
     STATUS=$(aws cloudfront get-invalidation \
       --distribution-id E1234567890ABC \
       --id I2EXAMPLE123456 \
       --query "Invalidation.Status" \
       --output text)
     echo "Status: $STATUS"
     if [ "$STATUS" = "Completed" ]; then
       echo "✅ Rollback completed!"
       break
     fi
     sleep 30
   done
   ```

4. **動作確認**:
   ```bash
   # アクセステスト
   curl -I https://d1234567890abc.cloudfront.net

   # 期待される出力: HTTP/2 200
   ```

---

## 8. よくある質問

### Q1: デプロイ後、変更が反映されない

**A**: CloudFront のキャッシュが原因です。以下を試してください:
1. Invalidation を実行: `aws cloudfront create-invalidation --distribution-id E123... --paths "/*"`
2. ブラウザキャッシュをクリア: Cmd+Shift+R (ハードリロード)
3. Cache-Control ヘッダーを確認: `aws s3api head-object --bucket ... --key index.html --query "CacheControl"`

---

### Q2: 本番環境と開発環境で動作が異なる

**A**: 環境変数の違いが原因です:
1. `.env.local` と `.env.production` を比較
2. `NEXT_PUBLIC_` プレフィックスがあることを確認
3. 環境変数が正しくビルドに含まれているか確認: `yarn build` 時のログを確認

---

### Q3: S3アップロードが途中で止まる

**A**: ネットワーク接続または大きいファイルが原因です:
1. ネットワーク接続を確認
2. `--storage-class STANDARD_IA` を試す（マルチパートアップロード）
3. タイムアウト時間を延長: `aws configure set cli_read_timeout 300`

---

## 📞 サポート連絡先

**技術サポート**: tech-support@example.com
**緊急連絡先**: +81-XX-XXXX-XXXX
**営業時間**: 平日 9:00〜18:00 (JST)

---

## 📚 参考資料

- [AWS CloudFront トラブルシューティング](https://docs.aws.amazon.com/cloudfront/latest/DeveloperGuide/troubleshooting-distributions.html)
- [AWS Cognito トラブルシューティング](https://docs.aws.amazon.com/cognito/latest/developerguide/troubleshooting.html)
- [Next.js Static Export トラブルシューティング](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)
- [Mozilla CSP ガイド](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)

---

**トラブルシューティングガイド終了**
