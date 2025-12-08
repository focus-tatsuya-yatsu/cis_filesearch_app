# ========================================
# CIS File Scanner Docker Image
# ========================================

# ビルドステージ
FROM node:18-alpine AS builder

# 作業ディレクトリを設定
WORKDIR /app

# パッケージファイルをコピー
COPY package.json yarn.lock ./

# 依存関係をインストール
RUN yarn install --frozen-lockfile

# ソースコードをコピー
COPY tsconfig.json ./
COPY src ./src

# TypeScriptをビルド
RUN yarn build

# ========================================
# 本番ステージ
FROM node:18-alpine

# 必要なパッケージをインストール
RUN apk add --no-cache \
    bash \
    ca-certificates \
    tzdata \
    && rm -rf /var/cache/apk/*

# タイムゾーンを設定（日本時間）
ENV TZ=Asia/Tokyo

# 非rootユーザーを作成
RUN addgroup -g 1000 scanner && \
    adduser -D -u 1000 -G scanner scanner

# 作業ディレクトリを設定
WORKDIR /app

# パッケージファイルをコピー
COPY package.json yarn.lock ./

# 本番用の依存関係のみインストール
RUN yarn install --production --frozen-lockfile && \
    yarn cache clean

# ビルド済みのコードをコピー
COPY --from=builder /app/dist ./dist

# データとログディレクトリを作成
RUN mkdir -p /app/data /app/logs && \
    chown -R scanner:scanner /app

# NASマウントポイントを作成
RUN mkdir -p /mnt/nas && \
    chown scanner:scanner /mnt/nas

# ユーザーを切り替え
USER scanner

# ヘルスチェック用のスクリプト
COPY --chown=scanner:scanner docker/healthcheck.sh /app/
RUN chmod +x /app/healthcheck.sh

# ボリューム設定
VOLUME ["/app/data", "/app/logs", "/mnt/nas"]

# 環境変数のデフォルト値
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    DB_PATH=/app/data/scanner.db \
    LOG_DIR=/app/logs

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /app/healthcheck.sh || exit 1

# エントリーポイント
ENTRYPOINT ["node", "dist/index.js"]

# デフォルトコマンド（ヘルプ表示）
CMD ["--help"]