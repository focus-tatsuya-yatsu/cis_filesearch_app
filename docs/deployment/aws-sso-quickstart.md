# AWS SSO クイックスタートガイド

## 📋 概要

このガイドでは、AWS SSO (Single Sign-On) を使用したCIS FileSearchアプリケーションの開発・デプロイ環境のセットアップ方法を説明します。

## 🎯 対象者

- AWS SSO認証を使用する開発者
- CLI操作でAWSリソースにアクセスする必要がある運用担当者
- トークン期限切れエラーに対処する必要がある方

## ⚠️ よくある問題と解決方法

### 問題: `ExpiredToken` エラー

**エラーメッセージ:**
```
An error occurred (ExpiredToken) when calling the GetCallerIdentity operation:
The security token included in the request is expired
```

**原因:**
- AWS SSOトークンは通常8-12時間で自動的に期限切れになります
- 長時間作業していない場合、セッションが終了します

**解決方法:** 👇 この下のセクションを参照

---

## 🚀 AWS SSO 認証セットアップ

### Step 1: AWS SSO ログイン

```bash
# 基本的なログインコマンド
aws sso login --profile AdministratorAccess-770923989980

# ブラウザが自動的に開き、認証画面が表示されます
# 表示されない場合は、ターミナルに表示されるURLにアクセスしてください
```

**ログイン成功時の出力例:**
```
Attempting to automatically open the SSO authorization page in your default browser.
If the browser does not open or you wish to use a different device to authorize this request,
open the following URL:

https://d-9067d44198.awsapps.com/start/#/device

Then enter the code:

ABCD-EFGH

Successfully logged into Start URL: https://d-9067d44198.awsapps.com/start
```

### Step 2: 環境変数の設定

```bash
# AWS_PROFILE環境変数をエクスポート
export AWS_PROFILE=AdministratorAccess-770923989980
```

**永続化する場合 (オプション):**

```bash
# ~/.zshrc または ~/.bashrc に追加
echo 'export AWS_PROFILE=AdministratorAccess-770923989980' >> ~/.zshrc

# 設定を再読み込み
source ~/.zshrc
```

### Step 3: 認証確認

```bash
# 認証情報を確認
aws sts get-caller-identity

# 期待される出力:
# {
#     "UserId": "AROA3G7VGRPOKB4GW767O:yatsu@focus88.co.jp",
#     "Account": "770923989980",
#     "Arn": "arn:aws:sts::770923989980:assumed-role/AWSReservedSSO_AdministratorAccess_bd0afcbe376c777a/yatsu@focus88.co.jp"
# }
```

---

## 🛠️ AWS SSO ヘルパースクリプトの使用

より簡単に認証管理を行うために、専用のヘルパースクリプトを用意しています。

### スクリプトの読み込み

```bash
# プロジェクトルートから
source scripts/aws-sso-helper.sh
```

### 利用可能なコマンド

| コマンド | 説明 |
|---------|------|
| `aws-sso-login [profile]` | AWS SSOにログイン (デフォルトプロファイルを使用) |
| `aws-check` | 現在の認証状態を確認 |
| `aws-token-expiry` | SSOトークンの有効期限を表示 |
| `aws-sso-logout` | AWS SSOからログアウト |
| `aws-list-resources` | CIS FileSearchのAWSリソース一覧を表示 |
| `aws-sso-help` | ヘルプメッセージを表示 |

### 使用例

```bash
# 1. ヘルパースクリプトを読み込む
source scripts/aws-sso-helper.sh

# 2. SSOにログイン
aws-sso-login

# 3. 認証を確認
aws-check

# 4. AWSリソースを確認
aws-list-resources

# 5. トークン有効期限を確認
aws-token-expiry
```

---

## 📦 検証スクリプトの実行

セットアップが正しく完了しているか確認するために、検証スクリプトを実行します。

```bash
# file-scannerディレクトリに移動
cd frontend/backend/file-scanner

# 検証スクリプトを実行
./verify-setup.sh
```

**検証内容:**
- ✅ Node.js バージョン確認 (v18以上)
- ✅ Yarn インストール確認
- ✅ 環境変数ファイル (.env) 存在確認
- ✅ NAS マウント確認
- ✅ **AWS 認証情報確認** ← SSOトークンが有効かチェック
- ✅ 依存関係インストール確認
- ✅ ビルド確認
- ✅ ドライラン実行

---

## 🔄 定期的な再認証が必要な場合

開発作業中、以下のような場合に再認証が必要になります:

### 自動再認証スクリプト (推奨)

```bash
#!/bin/bash
# ~/.local/bin/aws-auth-check (例)

# 認証チェック
if ! aws sts get-caller-identity &>/dev/null; then
    echo "⚠️  AWS token expired. Re-authenticating..."
    aws sso login --profile AdministratorAccess-770923989980
    export AWS_PROFILE=AdministratorAccess-770923989980
else
    echo "✓ AWS authentication is valid"
fi
```

### cron/launchd での自動化 (オプション)

macOSの場合、定期的にトークンの有効性をチェックすることもできます:

```bash
# 毎朝9時に自動チェック (例)
0 9 * * * /path/to/aws-auth-check
```

---

## 🔐 セキュリティベストプラクティス

### 1. トークンの安全な管理

- ❌ **絶対にしないこと:**
  - SSOトークンをGitリポジトリにコミット
  - トークンを平文でログファイルに記録
  - トークンを他の開発者と共有

- ✅ **推奨される方法:**
  - `~/.aws/sso/cache/` は自動的に管理される
  - パーミッションは `600` (所有者のみ読み書き可能)
  - トークンは一時的なもので、定期的に更新される

### 2. プロファイルの管理

複数のAWSアカウントを使用する場合:

```bash
# ~/.aws/config の例
[profile AdministratorAccess-770923989980]
sso_start_url = https://d-9067d44198.awsapps.com/start
sso_region = us-east-1
sso_account_id = 770923989980
sso_role_name = AdministratorAccess
region = ap-northeast-1

[profile DeveloperAccess-123456789012]
sso_start_url = https://d-9067d44198.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = DeveloperAccess
region = ap-northeast-1
```

プロファイルを切り替える:
```bash
export AWS_PROFILE=DeveloperAccess-123456789012
aws-check  # 新しいプロファイルで認証確認
```

### 3. トークン有効期限の監視

```bash
# jqをインストールしている場合、有効期限を確認できます
brew install jq  # macOS

# その後、ヘルパースクリプトで有効期限が表示されます
aws-token-expiry
# 出力例: Token expires in: 7h 23m
```

---

## 🐛 トラブルシューティング

### 問題1: ブラウザが自動的に開かない

**解決方法:**
1. ターミナルに表示されたURLを手動でコピー
2. ブラウザで開く
3. 表示されたコードを入力

### 問題2: `Profile not found` エラー

**原因:** プロファイル名が間違っている、または設定されていない

**解決方法:**
```bash
# 利用可能なプロファイルを確認
aws configure list-profiles

# 正しいプロファイル名でログイン
aws sso login --profile <正しいプロファイル名>
```

### 問題3: `AccessDenied` エラー

**原因:** ロールに必要な権限がない

**解決方法:**
1. AWS Identity Center (SSO) の管理者に連絡
2. 必要な権限を持つロールへのアクセスを要求

### 問題4: 複数のターミナルセッションでの認証

**問題:** ターミナルウィンドウごとにAWS_PROFILEを設定する必要がある

**解決方法1:** シェル設定ファイルに追加 (推奨)
```bash
# ~/.zshrc に追加
export AWS_PROFILE=AdministratorAccess-770923989980
```

**解決方法2:** direnv を使用
```bash
# プロジェクトルートに .envrc を作成
echo 'export AWS_PROFILE=AdministratorAccess-770923989980' > .envrc
direnv allow
```

---

## 📊 認証状態の確認コマンド一覧

| コマンド | 用途 |
|---------|------|
| `aws sts get-caller-identity` | 現在の認証情報を表示 |
| `aws configure list` | AWS設定を一覧表示 |
| `aws sso login --profile <name>` | SSOにログイン |
| `aws s3 ls` | S3バケット一覧 (認証テスト) |
| `env \| grep AWS` | AWS関連の環境変数を表示 |

---

## 🔄 代替認証方法

SSO以外の認証方法を使用する場合:

### 1. IAM ユーザーのアクセスキー (非推奨)

```bash
aws configure
# AWS Access Key ID: <YOUR_ACCESS_KEY>
# AWS Secret Access Key: <YOUR_SECRET_KEY>
# Default region: ap-northeast-1
# Default output format: json
```

⚠️ **セキュリティリスク:**
- 長期的な認証情報
- ローテーションが手動
- SSOよりセキュリティレベルが低い

### 2. AWS IAM Identity Center (推奨)

現在使用している方法です。SSO認証が最もセキュアで推奨されます。

---

## 📚 関連ドキュメント

- [AWS CLI SSO Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
- [AWS IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)
- [CIS FileSearch セキュリティベストプラクティス](./security-best-practices-guide.md)
- [AWS IAM ロールとポリシー](./iam-roles-policies-guide.md)

---

## ✅ チェックリスト

セットアップが完了したら、以下を確認してください:

- [ ] AWS CLI がインストールされている (`aws --version`)
- [ ] SSO設定が完了している (`~/.aws/config`)
- [ ] SSOログインが成功する (`aws sso login`)
- [ ] AWS_PROFILE が設定されている (`echo $AWS_PROFILE`)
- [ ] 認証が有効である (`aws sts get-caller-identity`)
- [ ] S3バケットにアクセスできる (`aws s3 ls`)
- [ ] ヘルパースクリプトが読み込まれている (`aws-sso-help`)
- [ ] 検証スクリプトがパスする (`./verify-setup.sh`)

---

## 🆘 サポート

問題が解決しない場合:

1. **ログを確認:**
   ```bash
   # AWS CLI デバッグモード
   aws s3 ls --debug
   ```

2. **SSO設定を確認:**
   ```bash
   cat ~/.aws/config
   ls -la ~/.aws/sso/cache/
   ```

3. **プロジェクトのIssueを作成:**
   - エラーメッセージ全文
   - 実行したコマンド
   - 環境情報 (`aws --version`, `node --version`)

---

**最終更新:** 2025-11-19
**作成者:** CIS FileSearch開発チーム
