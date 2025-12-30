# 画像検索機能 - クイックフィックスガイド

## 🎯 目標
サンプルデータだけでなく、**実際のファイルも画像検索結果に表示**されるようにする

## 📋 現状確認

### 問題
- 画像検索結果: サンプルデータ(sample_1.jpg ~ sample_10.jpg)のみ
- 実ファイル: OpenSearchに存在するが、`image_vector`フィールドがない

### 根本原因
EC2 Workerがファイル処理時に画像ベクトル化を実行していない

## 🚀 即座に実施する対策

### Step 1: EC2インスタンスに接続

```bash
# EC2にSSH接続
ssh -i ~/.ssh/your-key.pem ec2-user@your-ec2-ip

# または AWS Systems Manager Session Manager
aws ssm start-session --target i-xxxxxxxxxxxxx
```

### Step 2: 現在の設定を確認

```bash
# 環境変数確認
echo "=== Environment Variables ==="
env | grep -E "ENABLE_VECTOR|BEDROCK|OPENSEARCH"

# Workerプロセス確認
echo "=== Worker Status ==="
sudo systemctl status cis-worker

# 設定ファイル確認
echo "=== Config File ==="
cat /opt/cis-worker/.env 2>/dev/null || echo ".env not found"
```

**期待される出力**:
```bash
ENABLE_VECTOR_SEARCH=true
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=amazon.titan-embed-image-v1
```

### Step 3: 設定を修正（必要な場合）

#### 3-1. 環境変数ファイルを編集

```bash
# 設定ファイルを編集
sudo vi /opt/cis-worker/.env

# 以下の設定を追加/修正
ENABLE_VECTOR_SEARCH=true
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=amazon.titan-embed-image-v1
OPENSEARCH_INDEX=file-index-v2-knn
```

#### 3-2. Systemdサービスファイルを確認

```bash
# Systemdサービス設定確認
sudo cat /etc/systemd/system/cis-worker.service

# 環境変数がサービスに渡されているか確認
grep -A 10 "Environment=" /etc/systemd/system/cis-worker.service
```

もし`Environment=`セクションがない場合、追加:

```bash
sudo vi /etc/systemd/system/cis-worker.service
```

追加内容:
```ini
[Service]
Environment="ENABLE_VECTOR_SEARCH=true"
Environment="BEDROCK_REGION=us-east-1"
Environment="BEDROCK_MODEL_ID=amazon.titan-embed-image-v1"
EnvironmentFile=/opt/cis-worker/.env
```

#### 3-3. サービス再起動

```bash
# Systemd設定をリロード
sudo systemctl daemon-reload

# Workerサービスを再起動
sudo systemctl restart cis-worker

# ステータス確認
sudo systemctl status cis-worker

# ログ確認
sudo journalctl -u cis-worker -f --no-pager
```

**成功のサイン**:
```
✓ Bedrock connection test successful
✓ Vector dimension: 1024
```

### Step 4: テストファイルで検証

#### 4-1. テスト画像をS3にアップロード

```bash
# ローカル環境から実行
aws s3 cp test-image.jpg s3://your-landing-bucket/test/

# SQSメッセージを送信（手動）
aws sqs send-message \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/YOUR_ACCOUNT/file-processing-queue \
  --message-body '{
    "Records": [{
      "s3": {
        "bucket": {"name": "your-landing-bucket"},
        "object": {"key": "test/test-image.jpg"}
      }
    }]
  }'
```

#### 4-2. 処理を確認

```bash
# EC2上でログ確認
sudo journalctl -u cis-worker -f | grep -E "image_vector|Bedrock|embedding"
```

**成功のログ例**:
```
Successfully generated embedding with dimension: 1024
Successfully indexed document with image_vector
```

#### 4-3. OpenSearchで確認

```bash
# OpenSearchからドキュメント取得
curl -X GET "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_search?q=test-image.jpg" \
  -H 'Content-Type: application/json' | jq '.hits.hits[]._source | {file_name, has_vector: (.image_vector != null)}'
```

**期待される結果**:
```json
{
  "file_name": "test-image.jpg",
  "has_vector": true
}
```

## 🔧 トラブルシューティング

### 問題1: Bedrock接続エラー

**エラーメッセージ**:
```
Bedrock API error [AccessDeniedException]
```

**解決策**:
```bash
# EC2インスタンスのIAMロールにBedrock権限追加
# AWS Console → EC2 → インスタンス → セキュリティ → IAMロール → ポリシーをアタッチ

# 必要なポリシー:
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-image-v1"
    }
  ]
}
```

### 問題2: OpenSearchインデックスエラー

**エラーメッセージ**:
```
mapper_parsing_exception: failed to parse field [image_vector]
```

**原因**: インデックスに`image_vector`フィールド定義がない

**解決策**:
```bash
# EC2からインデックスマッピング確認
curl -X GET "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_mapping" | jq '.[][] | .mappings.properties.image_vector'

# もしnullなら、インデックス再作成が必要
# （既存データを別インデックスにreindex後、削除・再作成）
```

### 問題3: ベクトル次元数エラー

**エラーメッセージ**:
```
KNN vector dimension mismatch: expected 1024, got 512
```

**原因**: Lambda Image Embedding(512次元)とOpenSearch(1024次元)の不一致

**一時的な解決策**:
- 新規インデックス`file-index-v3-knn-512`を512次元で作成
- フロントエンドの環境変数を変更

**恒久的な解決策**:
- Lambda Image EmbeddingをTitan Multimodal(1024次元)に変更

## 📊 検証方法

### 1. 新規ファイルのベクトル確認

```bash
# 最近インデックスされたドキュメントを確認
curl -X POST "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_search" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {"match_all": {}},
    "sort": [{"indexed_at": "desc"}],
    "size": 5,
    "_source": ["file_name", "indexed_at", "image_vector"]
  }' | jq '.hits.hits[]._source | {
    file_name,
    indexed_at,
    has_vector: (.image_vector != null),
    vector_dimension: (.image_vector | length)
  }'
```

### 2. 画像検索テスト

```bash
# フロントエンドから画像検索実行
# → サンプルデータ以外のファイルも結果に表示されるか確認
```

### 3. 統計確認

```bash
# ベクトル付きドキュメント数を確認
curl -X POST "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_search" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {"exists": {"field": "image_vector"}},
    "size": 0
  }' | jq '.hits.total.value'
```

## 📈 次のステップ

### 即座に実施（今日中）
- [x] EC2 Worker設定確認
- [ ] 環境変数有効化
- [ ] サービス再起動
- [ ] テストファイルで検証

### 1-2日以内
- [ ] Lambda Image Embeddingを1024次元に統一
- [ ] 既存ファイルのバッチ処理スクリプト作成

### 1週間以内
- [ ] 既存画像ファイルのバッチベクトル化
- [ ] 全体的な検証

## 🎉 成功の指標

以下がすべてクリアされれば完了:

1. ✅ 新規アップロードファイルが自動的にベクトル付与
2. ✅ OpenSearchで`image_vector`フィールド確認可能
3. ✅ 画像検索結果にサンプルデータ以外も表示
4. ✅ エラーログなし

---

**重要**: 変更後は必ずログ確認とテストを実施してください。
