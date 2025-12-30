#!/bin/bash

# OpenSearch k-NN Index Creation Script
# 画像検索用のk-NNインデックスを作成します

set -e

# 色付きログ出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# 環境変数の読み込み
if [ -f .env.local ]; then
    export $(grep -E '^OPENSEARCH_|^AWS_' .env.local | xargs)
fi

# OpenSearchエンドポイント設定
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com}"
OPENSEARCH_INDEX="${OPENSEARCH_INDEX:-file-index-v2}"
NEW_INDEX="${OPENSEARCH_INDEX}-knn"
MAPPING_FILE="${1:-./opensearch-mapping-template.json}"

log_info "OpenSearch k-NN インデックス作成を開始します"
log_info "エンドポイント: $OPENSEARCH_ENDPOINT"
log_info "インデックス名: $NEW_INDEX"

# ローカル環境からVPCエンドポイントにアクセスできない場合の警告
if [[ $OPENSEARCH_ENDPOINT == *"vpc-"* ]]; then
    log_warning "VPCエンドポイントが検出されました。ローカル環境から直接アクセスできない場合があります。"
    log_warning "EC2インスタンス経由での実行を推奨します。"

    # SSHトンネル経由でアクセスする場合のオプション
    read -p "SSHトンネル経由でアクセスしますか？ (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "SSHトンネルを設定してください:"
        log_info "ssh -L 9200:$OPENSEARCH_ENDPOINT:443 ec2-user@your-ec2-instance"
        log_info "その後、OPENSEARCH_ENDPOINT=https://localhost:9200 として再実行してください"
        exit 0
    fi
fi

# 既存インデックスの確認
log_info "既存インデックスを確認しています..."
if curl -s -o /dev/null -w "%{http_code}" "$OPENSEARCH_ENDPOINT/$NEW_INDEX" | grep -q "200"; then
    log_warning "インデックス '$NEW_INDEX' は既に存在します"
    read -p "既存のインデックスを削除して再作成しますか？ (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "既存インデックスを削除しています..."
        curl -X DELETE "$OPENSEARCH_ENDPOINT/$NEW_INDEX" 2>/dev/null | jq '.'
        sleep 2
    else
        log_info "既存インデックスを使用します"
        exit 0
    fi
fi

# マッピングテンプレートの確認
if [ ! -f "$MAPPING_FILE" ]; then
    log_error "マッピングテンプレートファイルが見つかりません: $MAPPING_FILE"
    exit 1
fi

# k-NN インデックスの作成
log_info "k-NNインデックスを作成しています..."
RESPONSE=$(curl -X PUT "$OPENSEARCH_ENDPOINT/$NEW_INDEX" \
    -H 'Content-Type: application/json' \
    -d @"$MAPPING_FILE" 2>/dev/null)

if echo "$RESPONSE" | grep -q '"acknowledged":true'; then
    log_info "✅ インデックス '$NEW_INDEX' が正常に作成されました"
else
    log_error "インデックス作成に失敗しました:"
    echo "$RESPONSE" | jq '.'
    exit 1
fi

# インデックスの状態確認
log_info "インデックスの状態を確認しています..."
curl -X GET "$OPENSEARCH_ENDPOINT/_cat/indices/$NEW_INDEX?v" 2>/dev/null

# マッピングの確認
log_info "マッピングを確認しています..."
curl -X GET "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_mapping" 2>/dev/null | jq '.["'$NEW_INDEX'"].mappings.properties.image_embedding'

log_info "✅ OpenSearch k-NNインデックスの作成が完了しました"
log_info "次のステップ: ./index-sample-images.sh を実行してサンプルデータをインデックスに登録してください"