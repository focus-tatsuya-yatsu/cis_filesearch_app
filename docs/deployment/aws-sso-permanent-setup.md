# AWS SSO 永続的セットアップガイド

## 📋 概要

このガイドでは、ターミナルを開くたびにAWS SSOログインや環境変数設定を行う必要がないよう、永続的な設定を行う方法を説明します。

## 🎯 目標

- ✅ ターミナル起動時に自動的にAWS_PROFILEが設定される
- ✅ トークン期限切れ時に自動的に通知される
- ✅ ワンコマンドでSSO再認証できる
- ✅ プロジェクト固有の環境変数が自動ロードされる

---

## 🚀 セットアップ手順

### Step 1: シェル設定ファイルの編集

使用しているシェルに応じて設定ファイルを編集します。

**Zsh の場合 (macOS デフォルト):**

```bash
# .zshrc を編集
nano ~/.zshrc
```

**Bash の場合:**

```bash
# .bash_profile または .bashrc を編集
nano ~/.bash_profile
```

### Step 2: AWS_PROFILE の設定

以下の内容をファイルの末尾に追加:

```bash
# ==========================================
# AWS SSO Configuration for CIS FileSearch
# ==========================================

# デフォルトのAWSプロファイルを設定
export AWS_PROFILE=AdministratorAccess-770923989980

# AWSリージョンを設定 (オプション)
export AWS_DEFAULT_REGION=ap-northeast-1

# ヘルパースクリプトのパス (プロジェクトルート)
export CIS_PROJECT_ROOT="$HOME/focus_project/cis_filesearch_app"

# ヘルパー関数をロード (オプション)
# プロジェクトに入った時のみ有効にする場合はコメントアウト
# source "$CIS_PROJECT_ROOT/scripts/aws-sso-helper.sh"
```

### Step 3: 設定を反映

```bash
# Zshの場合
source ~/.zshrc

# Bashの場合
source ~/.bash_profile
```

### Step 4: 動作確認

```bash
# AWS_PROFILEが設定されているか確認
echo $AWS_PROFILE
# 期待される出力: AdministratorAccess-770923989980

# 認証状態を確認
aws sts get-caller-identity
```

---

## 🔄 プロジェクト固有の自動化 (direnv 使用)

`direnv` を使用すると、プロジェクトディレクトリに入った時のみ環境変数を自動ロードできます。

### direnv のインストール

```bash
# Homebrewを使用 (macOS)
brew install direnv

# .zshrc に追加
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
source ~/.zshrc

# Bashの場合
echo 'eval "$(direnv hook bash)"' >> ~/.bash_profile
source ~/.bash_profile
```

### .envrc の作成

プロジェクトルートに `.envrc` ファイルを作成:

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app

cat > .envrc << 'EOF'
# ==========================================
# CIS FileSearch Project Environment
# ==========================================

# AWS SSO プロファイル
export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_DEFAULT_REGION=ap-northeast-1

# プロジェクトルート
export CIS_PROJECT_ROOT=$(pwd)

# ヘルパースクリプトをロード
if [ -f "$CIS_PROJECT_ROOT/scripts/aws-sso-helper.sh" ]; then
    source "$CIS_PROJECT_ROOT/scripts/aws-sso-helper.sh"
fi

# 認証状態を確認 (静かにチェック)
if ! aws sts get-caller-identity &>/dev/null; then
    echo "⚠️  AWS SSO token expired. Run: aws-sso-login"
fi

echo "✓ CIS FileSearch environment loaded"
echo "  AWS_PROFILE: $AWS_PROFILE"
echo "  Project root: $CIS_PROJECT_ROOT"
EOF

# .envrc を許可
direnv allow
```

### 動作確認

```bash
# プロジェクトディレクトリに移動
cd /Users/tatsuya/focus_project/cis_filesearch_app

# 自動的に環境変数がロードされる
# 出力例:
# direnv: loading ~/focus_project/cis_filesearch_app/.envrc
# ✓ AWS SSO Helper loaded!
# ✓ CIS FileSearch environment loaded
#   AWS_PROFILE: AdministratorAccess-770923989980
#   Project root: /Users/tatsuya/focus_project/cis_filesearch_app
```

---

## 🛠️ エイリアス設定 (便利コマンド)

よく使うコマンドをエイリアスとして登録すると便利です。

### .zshrc または .bash_profile に追加

```bash
# ==========================================
# CIS FileSearch Aliases
# ==========================================

# プロジェクトディレクトリへ移動
alias cis='cd ~/focus_project/cis_filesearch_app'

# AWS SSO ログイン
alias sso-login='aws sso login --profile AdministratorAccess-770923989980'

# AWS 認証確認
alias aws-check='aws sts get-caller-identity'

# CIS リソース確認
alias cis-resources='aws s3 ls | grep cis-filesearch && aws sqs list-queues | grep cis && aws opensearch list-domain-names'

# File Scanner ディレクトリへ移動
alias cis-scanner='cd ~/focus_project/cis_filesearch_app/frontend/backend/file-scanner'

# 検証スクリプト実行
alias cis-verify='cd ~/focus_project/cis_filesearch_app/frontend/backend/file-scanner && ./verify-setup.sh'
```

### 使用例

```bash
# プロジェクトへ移動
cis

# SSOログイン
sso-login

# 認証確認
aws-check

# リソース確認
cis-resources

# スキャナーディレクトリへ移動
cis-scanner

# セットアップ検証
cis-verify
```

---

## 🔔 自動トークン期限チェック

ターミナル起動時やプロジェクトディレクトリに入った時に、トークン期限を自動チェックする方法。

### .zshrc に追加する関数

```bash
# ==========================================
# AWS SSO Token Expiry Check Function
# ==========================================

aws_sso_check_on_startup() {
    # AWS_PROFILEが設定されている場合のみチェック
    if [ -n "$AWS_PROFILE" ]; then
        # 認証状態を確認 (エラーを抑制)
        if ! aws sts get-caller-identity &>/dev/null; then
            echo ""
            echo "⚠️  AWS SSO Token Expired!"
            echo "   Run: aws sso login --profile $AWS_PROFILE"
            echo ""
        else
            # トークン有効
            local ACCOUNT=$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null)
            if [ -n "$ACCOUNT" ]; then
                echo "✓ AWS authenticated (Account: $ACCOUNT)"
            fi
        fi
    fi
}

# プロンプト表示前にチェック (オプション - 毎回表示されるのが煩わしい場合はコメントアウト)
# precmd() { aws_sso_check_on_startup }

# ターミナル起動時に1回だけチェック
aws_sso_check_on_startup
```

---

## 📊 完全な .zshrc 設定例

以下は、すべての設定を含む完全な `.zshrc` の例です:

```bash
# ==========================================
# AWS SSO Configuration for CIS FileSearch
# ==========================================

# デフォルトのAWSプロファイル
export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_DEFAULT_REGION=ap-northeast-1

# プロジェクトルート
export CIS_PROJECT_ROOT="$HOME/focus_project/cis_filesearch_app"

# ==========================================
# CIS FileSearch Aliases
# ==========================================

alias cis='cd ~/focus_project/cis_filesearch_app'
alias sso-login='aws sso login --profile AdministratorAccess-770923989980'
alias aws-check='aws sts get-caller-identity'
alias cis-resources='aws s3 ls | grep cis-filesearch && aws sqs list-queues | grep cis'
alias cis-scanner='cd ~/focus_project/cis_filesearch_app/frontend/backend/file-scanner'
alias cis-verify='cd ~/focus_project/cis_filesearch_app/frontend/backend/file-scanner && ./verify-setup.sh'

# ==========================================
# AWS SSO Helper Functions
# ==========================================

# トークン期限チェック関数
aws_sso_check_on_startup() {
    if [ -n "$AWS_PROFILE" ]; then
        if ! aws sts get-caller-identity &>/dev/null; then
            echo ""
            echo "⚠️  AWS SSO Token Expired!"
            echo "   Run: sso-login"
            echo ""
        fi
    fi
}

# ターミナル起動時にチェック
aws_sso_check_on_startup

# ==========================================
# direnv (プロジェクト固有の環境変数)
# ==========================================

# direnvがインストールされている場合は有効化
if command -v direnv &> /dev/null; then
    eval "$(direnv hook zsh)"
fi

# ==========================================
# その他の設定
# ==========================================

# (既存の .zshrc の内容はここに残す)
```

---

## 🔄 設定の適用

### 新しいターミナルセッションで確認

```bash
# 新しいターミナルウィンドウを開く
# または現在のセッションで再読み込み
source ~/.zshrc

# 自動的にトークン状態がチェックされる
# 出力例:
# ✓ AWS authenticated (Account: 770923989980)
```

---

## 🐛 トラブルシューティング

### 問題1: 設定が反映されない

**解決方法:**
```bash
# シェルを確認
echo $SHELL

# Zshの場合
cat ~/.zshrc | grep AWS_PROFILE

# Bashの場合
cat ~/.bash_profile | grep AWS_PROFILE

# 再読み込み
source ~/.zshrc  # または source ~/.bash_profile
```

### 問題2: direnv が動作しない

**解決方法:**
```bash
# direnvのフックが設定されているか確認
cat ~/.zshrc | grep direnv

# 手動で .envrc を許可
cd /Users/tatsuya/focus_project/cis_filesearch_app
direnv allow
```

### 問題3: エイリアスが機能しない

**解決方法:**
```bash
# エイリアス一覧を確認
alias | grep cis

# 個別にテスト
which cis
type cis

# 再読み込み
source ~/.zshrc
```

---

## ✅ セットアップ完了チェックリスト

以下を確認してセットアップが完了していることを確認してください:

- [ ] `.zshrc` (または `.bash_profile`) にAWS_PROFILEを追加
- [ ] `source ~/.zshrc` で設定を反映
- [ ] `echo $AWS_PROFILE` でプロファイルが表示される
- [ ] `aws sts get-caller-identity` で認証が確認できる
- [ ] エイリアスが機能する (`cis`, `sso-login`, etc.)
- [ ] (オプション) direnvが動作する
- [ ] (オプション) トークン期限チェック関数が動作する
- [ ] 新しいターミナルウィンドウでも設定が有効

---

## 🎓 ベストプラクティス

### 1. グローバル vs プロジェクト固有

| 設定方法 | メリット | デメリット | 推奨ケース |
|---------|---------|-----------|-----------|
| `.zshrc` でグローバル設定 | すべてのターミナルで有効 | 他のプロジェクトにも影響 | 1つのAWSアカウントのみ使用 |
| `direnv` でプロジェクト固有 | プロジェクトごとに分離 | ディレクトリ外では無効 | 複数のAWSアカウント/プロジェクト |

**推奨:** 両方を併用
- `.zshrc`: デフォルトプロファイルとエイリアス
- `direnv`: プロジェクト固有の環境変数

### 2. セキュリティ考慮事項

- ✅ `.envrc` は `.gitignore` に追加 (個人設定を含む場合)
- ✅ トークンは自動管理 (`~/.aws/sso/cache/`)
- ✅ パスワードや秘密鍵は **絶対に** `.zshrc` に書かない

### 3. チーム開発での共有

**.envrc.example を作成:**
```bash
# プロジェクトルート
cat > .envrc.example << 'EOF'
# CIS FileSearch Environment Template
# Copy this file to .envrc and customize

export AWS_PROFILE=<YOUR_PROFILE_NAME>
export AWS_DEFAULT_REGION=ap-northeast-1
export CIS_PROJECT_ROOT=$(pwd)

# Load helper scripts
source "$CIS_PROJECT_ROOT/scripts/aws-sso-helper.sh"
EOF
```

チームメンバーは:
```bash
cp .envrc.example .envrc
# .envrc を編集して自分のプロファイル名を設定
direnv allow
```

---

## 📚 関連ドキュメント

- [AWS SSO クイックスタートガイド](./aws-sso-quickstart.md)
- [セキュリティベストプラクティス](./security-best-practices-guide.md)
- [direnv 公式ドキュメント](https://direnv.net/)

---

**最終更新:** 2025-11-19
**作成者:** CIS FileSearch開発チーム
