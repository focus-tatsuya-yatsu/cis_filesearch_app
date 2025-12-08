# AWS SSO セットアップ完全ガイド 🚀

## 📋 はじめに

このドキュメントは、CIS FileSearchアプリケーションでAWS SSO (Single Sign-On) 認証を使用するための完全ガイドです。

**対象読者:**
- 初めてAWS SSOを使用する開発者
- ExpiredToken エラーで困っている方
- CLI環境でのAWS操作を自動化したい方

---

## 🎯 何を達成できるか

このガイドを完了すると:

- ✅ AWS CLI経由でAWSリソースにアクセスできる
- ✅ トークン期限切れエラーを自分で解決できる
- ✅ ターミナル起動時に自動的に環境が設定される
- ✅ ワンコマンドでSSO再認証できる
- ✅ セキュアな開発環境が構築できる

---

## 📚 ドキュメント構成

このディレクトリには3つのガイドがあります:

### 1. [aws-sso-quickstart.md](./aws-sso-quickstart.md)
**最初に読むべきガイド** ⭐

- AWS SSOの基本概念
- 初回ログイン手順
- トラブルシューティング
- ヘルパースクリプトの使い方

**こんな人におすすめ:**
- 今すぐExpiredTokenエラーを解決したい
- AWS SSOが初めて
- 基本的な使い方を知りたい

### 2. [aws-sso-permanent-setup.md](./aws-sso-permanent-setup.md)
**継続的な開発のための設定** 🔧

- シェル設定ファイル (.zshrc) のカスタマイズ
- direnvを使ったプロジェクト固有の環境変数
- エイリアス設定
- 自動トークンチェック

**こんな人におすすめ:**
- 毎回ログインするのが面倒
- 複数のAWSプロジェクトを扱っている
- 開発環境を効率化したい

### 3. このファイル (README-AWS-SSO.md)
**全体像と推奨フロー** 📖

---

## 🚀 推奨セットアップフロー

### Phase 1: 緊急対応 (5分)

**今すぐExpiredTokenエラーを解決する:**

```bash
# Step 1: SSOログイン
aws sso login --profile AdministratorAccess-770923989980

# Step 2: 環境変数設定
export AWS_PROFILE=AdministratorAccess-770923989980

# Step 3: 確認
aws sts get-caller-identity
```

✅ これだけで今日の作業は継続できます!

📖 **詳細:** [aws-sso-quickstart.md の Step 1-3](./aws-sso-quickstart.md#-aws-sso-認証セットアップ)

---

### Phase 2: ヘルパースクリプト導入 (10分)

**より便利に使うための準備:**

```bash
# プロジェクトルートに移動
cd /Users/tatsuya/focus_project/cis_filesearch_app

# ヘルパースクリプトを読み込む
source scripts/aws-sso-helper.sh

# 使ってみる
aws-sso-help      # 利用可能なコマンドを確認
aws-check         # 認証状態を確認
aws-list-resources # AWSリソースを確認
```

📖 **詳細:** [aws-sso-quickstart.md のヘルパースクリプトセクション](./aws-sso-quickstart.md#-aws-sso-ヘルパースクリプトの使用)

---

### Phase 3: 永続的設定 (15分)

**ターミナル起動時に自動設定:**

```bash
# .zshrc に追加
cat >> ~/.zshrc << 'EOF'

# AWS SSO for CIS FileSearch
export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_DEFAULT_REGION=ap-northeast-1

# Aliases
alias cis='cd ~/focus_project/cis_filesearch_app'
alias sso-login='aws sso login --profile AdministratorAccess-770923989980'
alias aws-check='aws sts get-caller-identity'
EOF

# 設定を反映
source ~/.zshrc

# 確認
echo $AWS_PROFILE  # AdministratorAccess-770923989980 と表示されるはず
```

📖 **詳細:** [aws-sso-permanent-setup.md](./aws-sso-permanent-setup.md)

---

### Phase 4: 高度な自動化 (オプション)

**direnvを使ったプロジェクト固有の環境:**

```bash
# direnvをインストール (macOS)
brew install direnv

# .zshrc に追加
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
source ~/.zshrc

# プロジェクトルートに .envrc を作成
cd /Users/tatsuya/focus_project/cis_filesearch_app
cat > .envrc << 'EOF'
export AWS_PROFILE=AdministratorAccess-770923989980
export CIS_PROJECT_ROOT=$(pwd)
source "$CIS_PROJECT_ROOT/scripts/aws-sso-helper.sh"
EOF

# 許可
direnv allow
```

📖 **詳細:** [aws-sso-permanent-setup.md の direnv セクション](./aws-sso-permanent-setup.md#-プロジェクト固有の自動化-direnv-使用)

---

## 🔄 日常的な使い方

### 毎日の作業開始時

```bash
# 1. プロジェクトに移動 (direnv使用時は自動ロード)
cd /Users/tatsuya/focus_project/cis_filesearch_app

# 2. 認証確認 (ヘルパースクリプト使用)
aws-check

# トークンが期限切れの場合:
# ⚠️  AWS SSO Token Expired!
# → この場合のみログイン
aws-sso-login

# 3. AWSリソースを確認
aws-list-resources
```

### 作業中にトークンが切れた場合

```bash
# エラー: ExpiredToken
# → 再ログイン (ワンコマンド)
aws-sso-login

# または (エイリアス設定済みの場合)
sso-login
```

---

## 📊 状態確認コマンド一覧

### 基本コマンド

| コマンド | 説明 | 期待される結果 |
|---------|------|--------------|
| `echo $AWS_PROFILE` | 現在のプロファイル確認 | `AdministratorAccess-770923989980` |
| `aws sts get-caller-identity` | 認証状態確認 | アカウント情報が表示される |
| `aws s3 ls \| grep cis` | S3バケット一覧 | 3つのバケットが表示される |

### ヘルパースクリプトのコマンド

| コマンド | 説明 |
|---------|------|
| `aws-sso-login` | SSOにログイン |
| `aws-check` | 詳細な認証状態を確認 |
| `aws-token-expiry` | トークン有効期限を表示 |
| `aws-list-resources` | CIS FileSearchリソース一覧 |
| `aws-sso-logout` | ログアウト |

### エイリアス (設定済みの場合)

| エイリアス | 実行されるコマンド |
|-----------|------------------|
| `cis` | プロジェクトルートに移動 |
| `sso-login` | AWS SSOログイン |
| `aws-check` | 認証確認 |
| `cis-resources` | リソース一覧 |
| `cis-verify` | セットアップ検証スクリプト実行 |

---

## 🐛 よくあるエラーと解決方法

### エラー1: ExpiredToken

```
An error occurred (ExpiredToken) when calling the GetCallerIdentity operation:
The security token included in the request is expired
```

**原因:** SSOトークンの有効期限切れ (8-12時間)

**解決方法:**
```bash
aws sso login --profile AdministratorAccess-770923989980
```

📖 **詳細:** [aws-sso-quickstart.md のトラブルシューティング](./aws-sso-quickstart.md#-よくある問題と解決方法)

---

### エラー2: Profile not found

```
Profile AdministratorAccess-770923989980 could not be found
```

**原因:** プロファイル名の誤り、または未設定

**解決方法:**
```bash
# 利用可能なプロファイルを確認
aws configure list-profiles

# 正しいプロファイル名を使用
export AWS_PROFILE=<正しいプロファイル名>
```

---

### エラー3: AccessDenied

```
An error occurred (AccessDenied) when calling the ListBuckets operation
```

**原因:** 必要な権限がない

**解決方法:**
1. AWS管理者に連絡
2. 必要な権限 (AdministratorAccess) があるか確認
3. 正しいアカウント/ロールを使用しているか確認

---

## 🔐 セキュリティのベストプラクティス

### ✅ やるべきこと

- SSOトークンを使用する (長期的な認証情報より安全)
- トークンを定期的に更新する
- `~/.aws/sso/cache/` のパーミッションを確認 (600)
- AWS_PROFILEを適切に設定する

### ❌ やってはいけないこと

- トークンをGitリポジトリにコミット
- 長期的なアクセスキーを使用 (IAMユーザー)
- トークンを他の開発者と共有
- 平文でクレデンシャルを保存

📖 **詳細:** [aws-sso-quickstart.md のセキュリティセクション](./aws-sso-quickstart.md#-セキュリティベストプラクティス)

---

## 🎓 学習リソース

### AWS公式ドキュメント

- [AWS CLI SSO Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
- [AWS IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)

### プロジェクト内ドキュメント

- [セキュリティベストプラクティス](../security/security-best-practices-guide.md)
- [IAMロールとポリシー](../security/iam-roles-policies-guide.md)
- [AWS Secrets Manager](../security/aws-secrets-manager-guide.md)

---

## ✅ セットアップ完了チェックリスト

### 基本セットアップ (必須)

- [ ] AWS CLIがインストールされている
- [ ] SSO設定が完了 (`~/.aws/config`)
- [ ] `aws sso login` でログインできる
- [ ] `aws sts get-caller-identity` で認証確認できる
- [ ] S3バケットにアクセスできる
- [ ] `AWS_PROFILE` 環境変数が設定されている

### ヘルパースクリプト (推奨)

- [ ] `scripts/aws-sso-helper.sh` が実行可能
- [ ] `source scripts/aws-sso-helper.sh` で読み込める
- [ ] `aws-sso-help` でコマンド一覧が表示される
- [ ] `aws-check` で認証状態が確認できる

### 永続的設定 (推奨)

- [ ] `.zshrc` (または `.bash_profile`) にAWS_PROFILEを追加
- [ ] エイリアスが設定されている
- [ ] 新しいターミナルでも設定が有効
- [ ] `echo $AWS_PROFILE` でプロファイル名が表示される

### 高度な設定 (オプション)

- [ ] direnvがインストールされている
- [ ] `.envrc` が作成されている
- [ ] `direnv allow` で許可されている
- [ ] プロジェクトディレクトリで自動的に環境が読み込まれる

---

## 🆘 サポート

### 問題が解決しない場合

1. **ログを確認:**
   ```bash
   aws s3 ls --debug 2>&1 | less
   ```

2. **設定を確認:**
   ```bash
   cat ~/.aws/config
   cat ~/.aws/credentials
   env | grep AWS
   ```

3. **GitHub Issueを作成:**
   以下の情報を含めてください:
   - エラーメッセージ全文
   - 実行したコマンド
   - 環境情報:
     ```bash
     aws --version
     node --version
     echo $SHELL
     ```

---

## 🎯 次のステップ

AWS SSO認証が正常に動作したら:

1. **検証スクリプトを実行:**
   ```bash
   cd frontend/backend/file-scanner
   ./verify-setup.sh
   ```

2. **File Scannerのセットアップ:**
   - 📖 [Scanner PC セットアップガイド](./scanner-pc-quickstart.md)
   - 📖 [Windows Scanner PC セットアップ](./windows-scanner-pc-setup-guide.md)

3. **本番デプロイ準備:**
   - 📖 [AWS手動セットアップ概要](./aws-manual-setup-overview.md)
   - 📖 [セキュリティチェックリスト](./scanner-pc-security-checklist.md)

---

## 📝 フィードバック

このドキュメントは継続的に改善しています。

- わかりにくい箇所があれば教えてください
- 追加してほしい情報があれば提案してください
- 誤りを見つけた場合は報告してください

---

**最終更新:** 2025-11-19
**作成者:** CIS FileSearch開発チーム
**バージョン:** 1.0

---

## 📌 クイックリファレンス

### 緊急時のコマンド

```bash
# トークン期限切れの場合
aws sso login --profile AdministratorAccess-770923989980

# 環境変数を再設定
export AWS_PROFILE=AdministratorAccess-770923989980

# 認証を確認
aws sts get-caller-identity

# ヘルパースクリプトを読み込み
source scripts/aws-sso-helper.sh

# リソースを確認
aws-list-resources
```

**これで作業を継続できます!** 🎉
