# OpenSearch Migration Recovery Guide

## 緊急状況の概要

### 発生した問題
- OpenSearchインデックスマッピング修正スクリプトが中断
- ローカルマシンからVPCエンドポイントへのアクセスを試みて失敗
- バックアップは作成済み: `file-search-dev-backup-20251218-101015`

### 現在の状態
- **データの安全性**: ✅ **安全** - ローカルからVPCエンドポイントにアクセスできないため、削除操作は実行されていない可能性が高い
- **バックアップ**: ✅ 作成済み
- **問題**: インデックス名の不一致（スクリプト: `file-search-dev` vs 環境変数: `file-index`）

---

## 1. 即時診断手順

### Step 1: VPC内のEC2インスタンスにSSH接続

```bash
# SSMセッションマネージャー経由（推奨）
aws ssm start-session --target i-xxxxxxxxx

# または通常のSSH
ssh -i your-key.pem ec2-user@<ec2-instance-ip>
```

### Step 2: 現在のOpenSearch状態を確認

```bash
# リカバリーチェックスクリプトをEC2にコピー
scp scripts/recovery-check-opensearch.sh ec2-user@<instance>:/tmp/

# EC2で実行
chmod +x /tmp/recovery-check-opensearch.sh
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com \
  /tmp/recovery-check-opensearch.sh
```

このスクリプトは以下を確認します:
- ✅ OpenSearchクラスターのヘルス状態
- ✅ 全インデックスのリスト
- ✅ 各候補インデックス（`file-index`, `file-search-dev`, `cis-files`）の存在とドキュメント数
- ✅ `image_embedding`フィールドのマッピング状態
- ✅ バックアップインデックスの存在確認

---

## 2. ダメージ評価

### シナリオA: データは無傷（最も可能性が高い）
**兆候**:
- 元のインデックスが存在し、ドキュメント数が正常
- バックアップインデックスも存在

**対処**: 正しいインデックス名でマイグレーションスクリプトを再実行

### シナリオB: インデックスが削除された
**兆候**:
- 元のインデックスが存在しない
- バックアップインデックスは存在

**対処**: バックアップから復元後、マイグレーションスクリプトを再実行

### シナリオC: 両方とも存在しない（可能性は極めて低い）
**兆候**:
- 元のインデックスもバックアップも存在しない

**対処**: 緊急復旧手順（後述）

---

## 3. 正しいインデックス名の特定

### 環境変数の確認

```bash
# フロントエンド設定
grep OPENSEARCH_INDEX frontend/.env.local
# 出力: OPENSEARCH_INDEX=file-index

# バックエンドワーカー設定
grep OPENSEARCH_INDEX backend/python-worker/.env
```

### 実際のOpenSearchで使用中のインデックス名を確認

```bash
# EC2インスタンスから実行
curl -s https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cat/indices?v | grep -E "file|cis"
```

**正しいインデックス名**: 環境変数`OPENSEARCH_INDEX`の値（デフォルト: `file-index`）

---

## 4. 安全な復旧手順

### オプションA: データが無傷の場合（推奨）

```bash
# 1. EC2インスタンスにVPC対応スクリプトをコピー
scp scripts/fix-opensearch-mapping-vpc.sh ec2-user@<instance>:/tmp/

# 2. EC2で環境変数を設定
export OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
export OPENSEARCH_INDEX=file-index  # 正しいインデックス名を指定

# 3. スクリプト実行
chmod +x /tmp/fix-opensearch-mapping-vpc.sh
/tmp/fix-opensearch-mapping-vpc.sh
```

### オプションB: インデックスが削除された場合

```bash
# 1. バックアップから元のインデックス名で復元
curl -X POST "${OPENSEARCH_ENDPOINT}/_reindex" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {
      "index": "file-search-dev-backup-20251218-101015"
    },
    "dest": {
      "index": "file-index"
    }
  }'

# 2. 復元確認
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index/_count"

# 3. オプションAの手順を実行
```

### オプションC: 緊急復旧（両方とも存在しない場合）

```bash
# 1. 新しいインデックスを作成（正しいマッピングで）
curl -X PUT "${OPENSEARCH_ENDPOINT}/file-index" \
  -H "Content-Type: application/json" \
  -d @scripts/opensearch-mapping-template.json

# 2. データソースから再インデックス
# - S3バケットのメタデータから再構築
# - または、ファイルスキャンを再実行
```

---

## 5. マイグレーション完了後の確認

### Step 1: マッピング検証

```bash
# image_embeddingフィールドの確認
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index/_mapping" | jq '.["file-index"].mappings.properties.image_embedding'

# 期待される出力:
# {
#   "type": "knn_vector",
#   "dimension": 1024,
#   "method": {
#     "name": "hnsw",
#     "space_type": "innerproduct",
#     "engine": "faiss",
#     ...
#   }
# }
```

### Step 2: ドキュメント数確認

```bash
# 復元前のドキュメント数と比較
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index/_count"
```

### Step 3: 検索テスト

```bash
# テキスト検索
curl -X POST "${OPENSEARCH_ENDPOINT}/file-index/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "match": {
        "file_name": "test"
      }
    },
    "size": 5
  }'
```

---

## 6. 今後の予防策

### 1. スクリプト修正（完了済み）
- ✅ 環境変数からインデックス名を取得: `INDEX_NAME="${OPENSEARCH_INDEX:-file-index}"`
- ✅ VPC接続チェックを追加
- ✅ 詳細なエラーハンドリング

### 2. 実行環境の明確化
- ✅ VPC内のEC2インスタンスからのみ実行可能であることを明記
- ✅ ローカル実行時のフォールバック処理

### 3. バックアップポリシー
- 自動バックアップスケジュール設定（推奨: 日次）
- スナップショットリポジトリの設定

```bash
# OpenSearchスナップショットリポジトリ設定例
PUT _snapshot/my_backup
{
  "type": "s3",
  "settings": {
    "bucket": "cis-filesearch-opensearch-backups",
    "region": "ap-northeast-1"
  }
}

# 日次スナップショット
PUT _snapshot/my_backup/snapshot_$(date +%Y%m%d)
```

### 4. インデックス名の統一
すべての設定ファイルで同じインデックス名を使用:
- `frontend/.env.local`: `OPENSEARCH_INDEX=file-index`
- `backend/python-worker/.env`: `OPENSEARCH_INDEX=file-index`
- `backend/ec2-worker/.env`: `OPENSEARCH_INDEX=file-index`
- すべてのスクリプト: 環境変数から取得

---

## 7. クイックリファレンス

### 重要なエンドポイント
```bash
# OpenSearch VPCエンドポイント（VPC内からのみアクセス可）
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com

# インデックス名（標準）
INDEX_NAME=file-index
```

### 緊急時のコマンド

```bash
# クラスターヘルス確認
curl -X GET "${OPENSEARCH_ENDPOINT}/_cluster/health"

# インデックス一覧
curl -X GET "${OPENSEARCH_ENDPOINT}/_cat/indices?v"

# 特定インデックスの情報
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index"

# ドキュメント数
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index/_count"

# バックアップから復元
curl -X POST "${OPENSEARCH_ENDPOINT}/_reindex" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {"index": "backup-index-name"},
    "dest": {"index": "file-index"}
  }'
```

---

## 8. サポート連絡先

### AWS サポート
- OpenSearchドメイン: `cis-filesearch-opensearch`
- リージョン: `ap-northeast-1`
- アカウントID: `770923989980`

### 関連ドキュメント
- `/docs/database-design.md` - OpenSearchスキーマ設計
- `/docs/deployment-guide.md` - デプロイメント手順
- `backend/lambda-search-api/README_503_SOLUTION.md` - トラブルシューティング

---

## まとめ

### 現在の状況
✅ **データは安全** - VPCアクセス制限により、誤削除は発生していない可能性が高い

✅ **バックアップ存在** - `file-search-dev-backup-20251218-101015`で復元可能

✅ **復旧スクリプト準備完了** - VPC対応版で安全に実行可能

### 次のアクション
1. EC2インスタンスからリカバリーチェックスクリプトを実行
2. 現在の状態を確認
3. 必要に応じて復旧手順を実行
4. マッピング修正を完了

### 予想所要時間
- 状態確認: 5分
- データ無傷の場合: 10-15分で完了
- 復元が必要な場合: 20-30分で完了
