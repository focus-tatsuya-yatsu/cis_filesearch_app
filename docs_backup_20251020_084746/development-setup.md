# CIS ファイル検索システム 開発環境セットアップガイド

## 1. 前提条件

### 1.1 必要なツール

| ツール | 必要バージョン | 用途 |
|--------|--------------|------|
| Node.js | 20.x以上 | JavaScript実行環境 |
| Yarn | 1.22.x以上 | パッケージ管理 |
| Docker | 24.x以上 | コンテナ環境 |
| Docker Compose | 2.x以上 | マルチコンテナ管理 |
| AWS CLI | 2.x以上 | AWS操作 |
| Git | 2.x以上 | バージョン管理 |
| VS Code | 最新版 | 推奨エディタ |

### 1.2 推奨スペック

- **OS**: macOS 12以上 / Windows 11 / Ubuntu 22.04 LTS
- **CPU**: 4コア以上
- **メモリ**: 16GB以上
- **ストレージ**: 50GB以上の空き容量

## 2. 環境構築手順

### 2.1 リポジトリのクローン

```bash
# リポジトリをクローン
git clone https://github.com/your-org/cis-filesearch-app.git
cd cis-filesearch-app

# 開発ブランチに切り替え
git checkout develop
```

### 2.2 Node.js環境のセットアップ

```bash
# Node.jsバージョン確認
node --version  # v20.x.x

# Yarnのインストール（未インストールの場合）
npm install -g yarn

# 依存パッケージのインストール
yarn install
```

### 2.3 環境変数の設定

```bash
# 環境変数ファイルをコピー
cp .env.example .env.local

# 環境変数を編集
nano .env.local
```

`.env.local`の設定例：

```env
# アプリケーション設定
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
NODE_ENV=development

# データベース設定
DATABASE_URL=postgresql://user:password@localhost:5432/cis_filesearch
REDIS_URL=redis://localhost:6379

# AWS設定（LocalStack使用）
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_ENDPOINT=http://localhost:4566
S3_BUCKET=cis-filesearch-dev
DYNAMODB_ENDPOINT=http://localhost:8000

# OpenSearch設定
OPENSEARCH_URL=http://localhost:9200
OPENSEARCH_USERNAME=admin
OPENSEARCH_PASSWORD=admin

# 認証設定
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=3600
REFRESH_TOKEN_EXPIRES_IN=604800

# その他
LOG_LEVEL=debug
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100
```

### 2.4 Dockerコンテナの起動

```bash
# Docker Composeで開発環境を起動
docker-compose up -d

# 起動状況の確認
docker-compose ps

# ログの確認
docker-compose logs -f
```

`docker-compose.yml`の内容：

```yaml
version: '3.8'

services:
  # PostgreSQL
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: cis_filesearch
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # Redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  # OpenSearch
  opensearch:
    image: opensearchproject/opensearch:2.11.0
    environment:
      - discovery.type=single-node
      - OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m
      - DISABLE_SECURITY_PLUGIN=true
    ports:
      - "9200:9200"
      - "9600:9600"
    volumes:
      - opensearch_data:/usr/share/opensearch/data

  # OpenSearch Dashboards
  opensearch-dashboards:
    image: opensearchproject/opensearch-dashboards:2.11.0
    environment:
      - OPENSEARCH_HOSTS=http://opensearch:9200
      - DISABLE_SECURITY_DASHBOARDS_PLUGIN=true
    ports:
      - "5601:5601"

  # LocalStack (AWS services)
  localstack:
    image: localstack/localstack:3.0
    environment:
      - SERVICES=s3,dynamodb,lambda,sqs,ses
      - DEBUG=1
      - LAMBDA_EXECUTOR=docker
      - DOCKER_HOST=unix:///var/run/docker.sock
    ports:
      - "4566:4566"
    volumes:
      - localstack_data:/var/lib/localstack
      - /var/run/docker.sock:/var/run/docker.sock

  # DynamoDB Admin
  dynamodb-admin:
    image: aaronshaf/dynamodb-admin
    environment:
      DYNAMO_ENDPOINT: http://localstack:4566
    ports:
      - "8001:8001"

volumes:
  postgres_data:
  redis_data:
  opensearch_data:
  localstack_data:
```

### 2.5 データベースのセットアップ

```bash
# マイグレーションの実行
yarn db:migrate

# シードデータの投入
yarn db:seed

# データベースの確認
yarn db:studio  # Prisma Studio起動
```

### 2.6 LocalStack（AWS）のセットアップ

```bash
# S3バケットの作成
aws --endpoint-url=http://localhost:4566 \
    s3 mb s3://cis-filesearch-dev

# DynamoDBテーブルの作成
aws --endpoint-url=http://localhost:4566 \
    dynamodb create-table \
    --table-name file_metadata \
    --attribute-definitions \
        AttributeName=file_id,AttributeType=S \
        AttributeName=version,AttributeType=N \
    --key-schema \
        AttributeName=file_id,KeyType=HASH \
        AttributeName=version,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST

# 確認
aws --endpoint-url=http://localhost:4566 s3 ls
aws --endpoint-url=http://localhost:4566 dynamodb list-tables
```

## 3. 開発サーバーの起動

### 3.1 フロントエンドの起動

```bash
# Next.js開発サーバーの起動
yarn dev

# 別ターミナルで確認
curl http://localhost:3000
```

### 3.2 バックエンドAPIの起動

```bash
# Express サーバーの起動
yarn api:dev

# 別ターミナルで確認
curl http://localhost:4000/api/health
```

### 3.3 ワーカープロセスの起動

```bash
# インデックス処理ワーカー
yarn worker:index

# ファイル処理ワーカー
yarn worker:file
```

## 4. 開発用スクリプト

### 4.1 package.jsonのスクリプト

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint && eslint .",
    "format": "prettier --write .",
    "type-check": "tsc --noEmit",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "e2e": "playwright test",
    "api:dev": "nodemon src/api/server.ts",
    "worker:index": "ts-node src/workers/indexWorker.ts",
    "worker:file": "ts-node src/workers/fileWorker.ts",
    "db:migrate": "prisma migrate dev",
    "db:seed": "prisma db seed",
    "db:studio": "prisma studio",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "docker:logs": "docker-compose logs -f",
    "docker:clean": "docker-compose down -v",
    "setup": "yarn install && yarn docker:up && yarn db:migrate && yarn db:seed"
  }
}
```

### 4.2 便利なコマンド

```bash
# プロジェクトの初期セットアップ
yarn setup

# コードの品質チェック
yarn lint
yarn type-check
yarn format

# テストの実行
yarn test
yarn test:coverage
yarn e2e

# Dockerの操作
yarn docker:up      # コンテナ起動
yarn docker:down    # コンテナ停止
yarn docker:logs    # ログ表示
yarn docker:clean   # クリーンアップ

# データベース操作
yarn db:migrate     # マイグレーション
yarn db:seed        # シードデータ投入
yarn db:studio      # GUI起動
```

## 5. VS Code設定

### 5.1 推奨拡張機能

`.vscode/extensions.json`:

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "prisma.prisma",
    "bradlc.vscode-tailwindcss",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense",
    "mikestead.dotenv",
    "eamodio.gitlens",
    "github.copilot",
    "ms-vscode.vscode-typescript-next"
  ]
}
```

### 5.2 ワークスペース設定

`.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "tailwindCSS.includeLanguages": {
    "typescript": "javascript",
    "typescriptreact": "javascript"
  },
  "files.exclude": {
    "**/.git": true,
    "**/.DS_Store": true,
    "**/node_modules": true,
    "**/.next": true,
    "**/dist": true
  }
}
```

### 5.3 デバッグ設定

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Next.js: debug server-side",
      "type": "node-terminal",
      "request": "launch",
      "command": "yarn dev"
    },
    {
      "name": "Next.js: debug client-side",
      "type": "chrome",
      "request": "launch",
      "url": "http://localhost:3000"
    },
    {
      "name": "API: debug",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "yarn",
      "runtimeArgs": ["api:dev"],
      "console": "integratedTerminal"
    }
  ]
}
```

## 6. トラブルシューティング

### 6.1 よくある問題と解決方法

#### ポート競合

```bash
# 使用中のポートを確認
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# プロセスを終了
kill -9 [PID]  # macOS/Linux
taskkill /PID [PID] /F  # Windows
```

#### Dockerメモリ不足

```bash
# Docker Desktopの設定変更
# Settings > Resources > Memory を 8GB以上に設定
```

#### 依存関係のエラー

```bash
# node_modulesをクリーンアップ
rm -rf node_modules yarn.lock
yarn install
```

#### データベース接続エラー

```bash
# PostgreSQLの状態確認
docker-compose ps postgres
docker-compose logs postgres

# 接続テスト
psql postgresql://user:password@localhost:5432/cis_filesearch
```

### 6.2 ログの確認方法

```bash
# アプリケーションログ
tail -f logs/app.log

# Dockerログ
docker-compose logs -f [service_name]

# Next.jsログ
yarn dev --verbose

# APIログ
DEBUG=* yarn api:dev
```

## 7. 開発フロー

### 7.1 ブランチ戦略

```bash
main          # プロダクション
├── develop   # 開発統合
│   ├── feature/search-optimization
│   ├── feature/ui-improvement
│   ├── bugfix/login-error
│   └── hotfix/critical-bug
```

### 7.2 コミットメッセージ規約

```bash
# 形式: <type>: <subject>

feat: 新機能追加
fix: バグ修正
docs: ドキュメント更新
style: フォーマット修正
refactor: リファクタリング
test: テスト追加・修正
chore: ビルド・補助ツール変更
```

### 7.3 プルリクエストテンプレート

`.github/pull_request_template.md`:

```markdown
## 概要
<!-- 変更の概要を記載 -->

## 変更内容
- [ ] 機能追加
- [ ] バグ修正
- [ ] リファクタリング
- [ ] ドキュメント更新

## テスト
- [ ] ユニットテスト追加/更新
- [ ] 統合テスト実行
- [ ] 手動テスト完了

## チェックリスト
- [ ] コードレビュー依頼
- [ ] ドキュメント更新
- [ ] マイグレーション確認
```

## 8. 開発用ダミーデータ

### 8.1 テストユーザー

| メール | パスワード | 役割 |
|--------|-----------|------|
| admin@example.com | Admin123! | 管理者 |
| user1@example.com | User123! | 一般ユーザー |
| user2@example.com | User123! | 一般ユーザー |

### 8.2 サンプルNASマウント

```bash
# ローカルNASディレクトリの作成
mkdir -p ~/nas-mock/documents
mkdir -p ~/nas-mock/images
mkdir -p ~/nas-mock/archives

# サンプルファイルの配置
cp -r sample-data/* ~/nas-mock/

# Docker内からアクセス可能にする
docker run -v ~/nas-mock:/nas ...
```

## 9. パフォーマンス測定

### 9.1 Lighthouse

```bash
# Lighthouse実行
yarn lighthouse http://localhost:3000 \
  --output html \
  --view
```

### 9.2 Bundle分析

```bash
# Bundle分析ツールの実行
yarn analyze
```

### 9.3 負荷テスト

```bash
# k6による負荷テスト
k6 run tests/load/search.js
```

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-15 | 初版作成 | CIS開発チーム |