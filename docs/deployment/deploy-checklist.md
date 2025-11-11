# CIS File Search Application - デプロイチェックリスト

**デプロイ日時**: _______________
**実施者**: _______________
**環境**: 本番 / ステージング / 開発

---

## 📋 デプロイ前チェック

### 前提条件
- [ ] AWSアカウントにログイン済み
- [ ] 必要な権限（S3, CloudFront, Cognito）を確認済み
- [ ] Node.js v18.x以上インストール済み
- [ ] Yarn v1.22以上インストール済み
- [ ] AWS CLI v2.x以上インストール済み

### バックアップ
- [ ] S3バケットの現在の内容をバックアップ済み
  - バックアップ先: `~/backups/cis-filesearch-frontend/backup_YYYYMMDD_HHMMSS/`
- [ ] CloudFront Distribution設定をバックアップ済み
  - ファイル名: `distribution-config-backup_YYYYMMDD.json`
- [ ] Cognito設定のスクリーンショット取得済み

### プロジェクト準備
- [ ] Gitリポジトリをクローン済み
- [ ] 正しいブランチ（`main`）をチェックアウト済み
- [ ] 最新の変更を取得済み (`git pull`)
- [ ] `frontend` ディレクトリに移動済み
- [ ] 依存関係をインストール済み (`yarn install`)

---

## 🔧 環境変数設定

### 環境変数ファイル作成
- [ ] `.env.local.example` を `.env.local` にコピー済み
- [ ] `.env.local` ファイルを開いて編集開始

### Cognito設定
- [ ] `NEXT_PUBLIC_COGNITO_USER_POOL_ID` を設定済み
  - 例: `ap-northeast-1_abcDEF123`
- [ ] `NEXT_PUBLIC_COGNITO_APP_CLIENT_ID` を設定済み
  - 例: `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`
- [ ] `NEXT_PUBLIC_COGNITO_DOMAIN` を設定済み
  - 例: `cis-filesearch.auth.ap-northeast-1.amazoncognito.com`
  - ⚠️ `https://` は不要

### CloudFront/API設定
- [ ] `NEXT_PUBLIC_APP_URL` を設定済み
  - 例: `https://d1234567890abc.cloudfront.net`
  - ⚠️ 必ず `https://` を含める
- [ ] `NEXT_PUBLIC_API_GATEWAY_URL` を設定済み
  - 例: `https://xyz...execute-api.ap-northeast-1.amazonaws.com/v1`

### 環境変数の確認
- [ ] すべての環境変数が設定されていることを確認
  ```bash
  cat .env.local | grep -v "^#" | grep -v "^$" | wc -l
  # 期待される出力: 5
  ```

---

## 🏗️ ビルド

### ビルド実行
- [ ] ビルドコマンドを実行 (`yarn build`)
- [ ] ビルドが成功（エラーなし）
- [ ] TypeScriptコンパイルが成功
- [ ] ESLintチェックが通過

### ビルド成果物確認
- [ ] `out` ディレクトリが生成された
- [ ] `out/index.html` が存在する
- [ ] `out/_next/` ディレクトリが存在する
- [ ] ファイル総数を確認
  ```bash
  find out -type f | wc -l
  # 期待される数: 200〜300ファイル
  ```
- [ ] 合計サイズを確認
  ```bash
  du -sh out/
  # 期待されるサイズ: 30M〜50M
  ```

---

## ☁️ S3バケット準備

### バケット確認
- [ ] S3バケット `cis-filesearch-frontend-prod` が存在することを確認
  ```bash
  aws s3 ls | grep cis-filesearch-frontend-prod
  ```

### バケットポリシー設定
- [ ] バケットポリシーファイルを編集済み
  - ファイル: `docs/security/s3-bucket-policy.json`
- [ ] プレースホルダーを実際の値に置換済み
  - `YOUR-FRONTEND-BUCKET-NAME`
  - `YOUR-AWS-ACCOUNT-ID`
  - `YOUR-DISTRIBUTION-ID`
- [ ] バケットポリシーを適用済み
  ```bash
  aws s3api put-bucket-policy --bucket cis-filesearch-frontend-prod --policy file://...
  ```

### パブリックアクセスブロック
- [ ] パブリックアクセスブロックが有効
  ```bash
  aws s3api get-public-access-block --bucket cis-filesearch-frontend-prod
  ```

### バージョニング（オプション）
- [ ] バケットバージョニングを有効化
  ```bash
  aws s3api put-bucket-versioning --bucket ... --versioning-configuration Status=Enabled
  ```

---

## 📤 ファイルアップロード

### アップロード実行
- [ ] `aws s3 sync` コマンドを実行
  ```bash
  aws s3 sync ./out/ s3://cis-filesearch-frontend-prod/ --delete
  ```
- [ ] アップロードが成功（エラーなし）
- [ ] アップロード済みファイル数を確認
  ```bash
  aws s3 ls s3://cis-filesearch-frontend-prod/ --recursive --summarize
  ```

### Cache-Control設定
- [ ] HTMLファイルのCache-Controlを設定
  ```bash
  aws s3 cp s3://...../index.html s3://...../index.html --metadata-directive REPLACE --cache-control "public, max-age=0, must-revalidate"
  ```
- [ ] その他のHTMLファイルも同様に設定
  - `search.html`
  - `404.html`
  - `test-dark-mode.html`

### アップロード確認
- [ ] 主要ファイルが存在することを確認
  - `index.html`
  - `_next/static/chunks/framework.*.js`
  - `_next/static/chunks/main.*.js`

---

## ☁️ CloudFront設定

### Invalidation実行
- [ ] Distribution IDを確認
  ```bash
  aws cloudfront list-distributions
  ```
- [ ] Invalidationを作成
  ```bash
  aws cloudfront create-invalidation --distribution-id E123... --paths "/*"
  ```
- [ ] Invalidation IDをメモ: `_______________`

### Invalidation完了待ち
- [ ] Invalidationステータスを確認
  ```bash
  aws cloudfront get-invalidation --distribution-id E123... --id I123...
  ```
- [ ] ステータスが `Completed` になるまで待機（5〜15分）

### セキュリティヘッダーポリシー
- [ ] Response Headers Policyが存在することを確認
  ```bash
  aws cloudfront list-response-headers-policies
  ```
- [ ] ポリシーが存在しない場合は作成
  ```bash
  aws cloudfront create-response-headers-policy --response-headers-policy-config file://docs/security/cloudfront-security-headers.json
  ```
- [ ] DistributionにポリシーをアタッチHere's the completion:

```bash
  aws cloudfront update-distribution ...
  ```

---

## 🔐 Cognito設定

### Callback URL設定
- [ ] Cognito User Poolコンソールを開く
- [ ] 対象のUser Pool (`CIS-FileSearch-UserPool`) を選択
- [ ] **App integration** タブ → **App clients** を開く
- [ ] **CIS-FileSearch-WebClient** を選択
- [ ] **Allowed callback URLs** に以下を追加:
  - `https://d1234567890abc.cloudfront.net/auth/callback`
- [ ] **Save changes** をクリック

### Sign out URL設定
- [ ] **Allowed sign-out URLs** に以下を追加:
  - `https://d1234567890abc.cloudfront.net`
- [ ] **Save changes** をクリック

### OAuth設定確認
- [ ] **OAuth 2.0 grant types** で以下が有効:
  - Authorization code grant
- [ ] **OpenID Connect scopes** で以下が選択済み:
  - openid
  - email
  - profile

### テストユーザー作成
- [ ] テスト用ユーザーを作成（未作成の場合）
  ```bash
  aws cognito-idp admin-create-user --user-pool-id ... --username test-user@example.com
  ```
- [ ] パスワードを永続化
  ```bash
  aws cognito-idp admin-set-user-password --user-pool-id ... --username test-user@example.com --password "SecurePassword123!" --permanent
  ```

---

## ✅ 動作確認

### 基本アクセス確認
- [ ] CloudFront URLにアクセス
  - URL: `https://d1234567890abc.cloudfront.net`
- [ ] ステータスコードが `200 OK`
- [ ] トップページが正しく表示される
- [ ] レイアウトが崩れていない

### ログイン機能確認
- [ ] **ログイン** ボタンをクリック
- [ ] Cognito Hosted UIにリダイレクトされる
- [ ] テストユーザーでログイン
  - Username: `test-user@example.com`
  - Password: `SecurePassword123!`
- [ ] `/auth/callback` にリダイレクトされる
- [ ] その後 `/search` ページにリダイレクトされる
- [ ] ログイン状態が維持される

### セキュリティヘッダー確認
- [ ] ブラウザ開発者ツールでヘッダーを確認
  - `strict-transport-security`
  - `content-security-policy`
  - `x-frame-options`
  - `x-content-type-options`
  - `referrer-policy`
  - `x-xss-protection`
  - `permissions-policy`

### Mozilla Observatory確認
- [ ] https://observatory.mozilla.org/ でスキャン
- [ ] スコアが **A+ (95/100)** 以上

### パフォーマンス確認
- [ ] Lighthouse実行（Chrome開発者ツール）
  - Performance: **90+**
  - Accessibility: **95+**
  - Best Practices: **95+**
  - SEO: **100**

### エラーページ確認
- [ ] 404ページが正しく表示される
  - URL: `https://d1234567890abc.cloudfront.net/nonexistent-page`

---

## 📝 デプロイ完了後タスク

### ドキュメント更新
- [ ] デプロイ日時を記録
- [ ] 変更内容をREADMEに記載
- [ ] 既知の問題があれば記録

### モニタリング設定
- [ ] CloudWatch Logsを確認
- [ ] エラーログがないことを確認
- [ ] アクセスログが正常に記録されていることを確認

### チーム通知
- [ ] デプロイ完了をチームに通知
- [ ] CloudFront URLを共有
- [ ] テストユーザー情報を共有（必要に応じて）

---

## 🔄 トラブル発生時

### ロールバック判断基準
- [ ] 以下のいずれかに該当する場合はロールバック:
  - ログイン機能が動作しない
  - ページが表示されない（5XX エラー）
  - セキュリティヘッダーが欠落している
  - パフォーマンススコアが著しく低下（80未満）

### ロールバック手順
- [ ] バックアップからS3バケットを復元
  ```bash
  aws s3 sync ~/backups/.../backup_YYYYMMDD_HHMMSS/ s3://cis-filesearch-frontend-prod/ --delete
  ```
- [ ] CloudFront Invalidationを実行
  ```bash
  aws cloudfront create-invalidation --distribution-id E123... --paths "/*"
  ```
- [ ] Invalidation完了を待機（5〜15分）
- [ ] 動作確認を再実行

---

## 📊 デプロイ記録

**デプロイ開始時刻**: _______________
**デプロイ完了時刻**: _______________
**所要時間**: _______________

**デプロイ結果**: ✅ 成功 / ❌ 失敗

**備考**:
- _________________________________________________
- _________________________________________________
- _________________________________________________

**次回の改善点**:
- _________________________________________________
- _________________________________________________
- _________________________________________________

---

## ✅ 最終確認

すべてのチェック項目が完了したことを確認してください:

- [ ] **デプロイ前チェック** (13項目) - すべて完了
- [ ] **環境変数設定** (7項目) - すべて完了
- [ ] **ビルド** (6項目) - すべて完了
- [ ] **S3バケット準備** (7項目) - すべて完了
- [ ] **ファイルアップロード** (6項目) - すべて完了
- [ ] **CloudFront設定** (6項目) - すべて完了
- [ ] **Cognito設定** (9項目) - すべて完了
- [ ] **動作確認** (9項目) - すべて完了
- [ ] **デプロイ完了後タスク** (5項目) - すべて完了

**合計**: 68項目

---

**デプロイ完了 - お疲れ様でした！ 🎉**

**実施者サイン**: _______________
**確認者サイン**: _______________
