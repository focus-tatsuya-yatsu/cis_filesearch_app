# 画像検索 緊急修正ガイド

**作成日**: 2025-12-18
**対象**: 本番環境の画像検索0件問題
**所要時間**: 即座の診断（30分）+ 修正実施（1-2週間）

---

## 問題の概要

画像検索機能で**すべての検索が0件を返す**問題が発生しています。

### 主な原因（推定）

1. OpenSearchインデックスに`image_embedding`フィールドが存在しない
2. ドキュメントに画像ベクトルデータが保存されていない
3. k-NN（ベクトル検索）の設定が不完全

---

## クイックスタート: 即座の診断

### Step 1: AWS認証情報を更新

```bash
# ローカル環境から
aws sso login --profile cis-production

# または
aws configure
```

### Step 2: VPC内から診断スクリプトを実行

```bash
# EC2インスタンスに接続
ssh -i ~/.ssh/your-key.pem ec2-user@<ec2-instance-ip>

# スクリプトをダウンロード
cd /tmp
wget https://raw.githubusercontent.com/your-org/cis-filesearch/main/backend/scripts/diagnose-opensearch-from-vpc.sh

# 環境変数を設定
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="file-index"
export AWS_REGION="ap-northeast-1"

# 実行
bash diagnose-opensearch-from-vpc.sh > diagnosis-result.txt

# 結果を確認
cat diagnosis-result.txt
```

### Step 3: 診断結果を解釈

診断スクリプトは以下を確認します：

| 項目 | 正常 | 異常 |
|------|------|------|
| **接続** | ✅ 接続成功 | ❌ 接続失敗 |
| **クラスター** | ✅ green | ⚠️ yellow / ❌ red |
| **インデックス存在** | ✅ 存在 | ❌ 存在しない |
| **k-NN設定** | ✅ knn: true | ❌ knn: false/null |
| **image_embeddingフィールド** | ✅ knn_vector, 1024次元 | ❌ 存在しない |
| **ドキュメント数** | ✅ > 0 | ⚠️ = 0 |
| **画像ベクトル保有率** | ✅ > 50% | ❌ = 0% |
| **k-NN検索テスト** | ✅ 結果あり | ❌ 0件 |

---

## 修正計画（シナリオ別）

### シナリオ A: `image_embedding`フィールドが存在しない

**診断結果**:
```
❌ image_embedding: 存在しません
❌ k-NN設定: 無効または未設定
```

**対処**: OpenSearchインデックスの再作成が必要

👉 **詳細**: [診断レポート Phase 2](/Users/tatsuya/focus_project/cis_filesearch_app/docs/incident-response/OPENSEARCH_IMAGE_SEARCH_DIAGNOSTIC_REPORT.md#phase-2-opensearch%E3%82%A4%E3%83%B3%E3%83%87%E3%83%83%E3%82%AF%E3%82%B9%E4%BF%AE%E6%AD%A3)

**クイックコマンド**:
```bash
# 新インデックス作成（VPC内のEC2から実行）
curl -X PUT "https://<opensearch-endpoint>/file-index-v2" \
  -H "Content-Type: application/json" \
  -d @/path/to/index-mapping.json \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# データReindex
curl -X POST "https://<opensearch-endpoint>/_reindex" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {"index": "file-index"},
    "dest": {"index": "file-index-v2"}
  }' \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"

# エイリアス切り替え
curl -X POST "https://<opensearch-endpoint>/_aliases" \
  -H "Content-Type: application/json" \
  -d '{
    "actions": [
      {"remove": {"index": "file-index", "alias": "file-index-alias"}},
      {"add": {"index": "file-index-v2", "alias": "file-index-alias"}}
    ]
  }' \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

---

### シナリオ B: フィールドは存在するが、ドキュメントにデータがない

**診断結果**:
```
✅ image_embedding: knn_vector
❌ 画像ベクトルを持つドキュメント: 0件
```

**対処**: Python Workerの改修 + 既存ファイル再処理

👉 **詳細**: [診断レポート Phase 3-4](/Users/tatsuya/focus_project/cis_filesearch_app/docs/incident-response/OPENSEARCH_IMAGE_SEARCH_DIAGNOSTIC_REPORT.md#phase-3-python-worker%E7%94%BB%E5%83%8F%E5%87%A6%E7%90%86%E7%B5%B1%E5%90%88)

**クイックコマンド**:
```bash
# EC2インスタンスに接続
ssh ec2-user@<instance-ip>

# Python Workerコードを更新（Gitから）
cd /opt/file-processor
sudo git pull origin main

# 改修内容を確認
# - processors/image_processor.py にBedrock統合
# - IAM権限追加

# サービス再起動
sudo systemctl restart file-processor.service

# ログ監視
sudo journalctl -u file-processor.service -f
```

---

### シナリオ C: すべて正常だが検索結果が0件

**診断結果**:
```
✅ image_embedding: knn_vector, 1024次元
✅ 画像ベクトルを持つドキュメント: 1000件
⚠️  k-NN検索テスト: 0件
```

**対処**: Lambda検索APIのクエリ構造を確認

👉 **詳細**: [診断レポート Phase 5](/Users/tatsuya/focus_project/cis_filesearch_app/docs/incident-response/OPENSEARCH_IMAGE_SEARCH_DIAGNOSTIC_REPORT.md#phase-5-lambda%E6%A4%9C%E7%B4%A2api%E6%94%B9%E5%96%84%E3%81%A8%E3%83%86%E3%82%B9%E3%83%88)

**クイックコマンド**:
```bash
# Lambda関数のCloudWatchログを確認
aws logs tail /aws/lambda/cis-search-api --follow --since 1h

# エラーメッセージを探す
aws logs filter-pattern /aws/lambda/cis-search-api \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '1 hour ago' +%s)000
```

---

## 各フェーズの詳細手順

完全な修正計画は以下のドキュメントを参照してください：

📄 **[OpenSearch画像検索 診断レポート](/Users/tatsuya/focus_project/cis_filesearch_app/docs/incident-response/OPENSEARCH_IMAGE_SEARCH_DIAGNOSTIC_REPORT.md)**

### 主要フェーズ

| Phase | タスク | 所要時間 | 詳細リンク |
|-------|-------|---------|-----------|
| **Phase 1** | 緊急診断と状況確認 | 1日 | [詳細](#phase-1-%E7%B7%8A%E6%80%A5%E8%A8%BA%E6%96%AD%E3%81%A8%E7%8A%B6%E6%B3%81%E7%A2%BA%E8%AA%8D) |
| **Phase 2** | OpenSearchインデックス修正 | 2-3日 | [詳細](#phase-2-opensearch%E3%82%A4%E3%83%B3%E3%83%87%E3%83%83%E3%82%AF%E3%82%B9%E4%BF%AE%E6%AD%A3) |
| **Phase 3** | Python Worker画像処理統合 | 3-5日 | [詳細](#phase-3-python-worker%E7%94%BB%E5%83%8F%E5%87%A6%E7%90%86%E7%B5%B1%E5%90%88) |
| **Phase 4** | 既存ファイル再処理バッチ | 2-3日 | [詳細](#phase-4-%E6%97%A2%E5%AD%98%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB%E3%81%AE%E5%86%8D%E5%87%A6%E7%90%86%E3%83%90%E3%83%83%E3%83%81) |
| **Phase 5** | Lambda検索API改善とテスト | 2日 | [詳細](#phase-5-lambda%E6%A4%9C%E7%B4%A2api%E6%94%B9%E5%96%84%E3%81%A8%E3%83%86%E3%82%B9%E3%83%88) |
| **Phase 6** | E2Eテストと本番検証 | 1-2日 | [詳細](#phase-6-e2e%E3%83%86%E3%82%B9%E3%83%88%E3%81%A8%E6%9C%AC%E7%95%AA%E6%A4%9C%E8%A8%BC) |

---

## 即座に実行できるコマンド集

### AWS環境確認

```bash
# OpenSearchドメイン情報
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch \
  --region ap-northeast-1 \
  --query 'DomainStatus.{Endpoint:Endpoint,EngineVersion:EngineVersion,Status:Processing}'

# Lambda関数確認
aws lambda list-functions \
  --region ap-northeast-1 \
  --query 'Functions[?contains(FunctionName, `search`)].{Name:FunctionName,Runtime:Runtime}'

# EC2インスタンス確認
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*file-processor*" \
  --region ap-northeast-1 \
  --query 'Reservations[].Instances[].[InstanceId,State.Name,PrivateIpAddress]' \
  --output table
```

### CloudWatchログ確認

```bash
# Lambda検索APIログ（最新100行）
aws logs tail /aws/lambda/cis-search-api --since 1h

# Lambda検索APIログ（エラーのみ）
aws logs filter-pattern /aws/lambda/cis-search-api \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '1 hour ago' +%s)000

# EC2 Python Workerログ（Systems Manager経由）
aws ssm start-session --target <instance-id>
# セッション内で:
sudo journalctl -u file-processor.service -n 1000 --no-pager
```

### OpenSearch直接クエリ（VPC内から）

```bash
# ドキュメント数確認
curl -s "$OPENSEARCH_ENDPOINT/file-index/_count" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" | jq

# image_embeddingを持つドキュメント数
curl -s "$OPENSEARCH_ENDPOINT/file-index/_count" \
  -H "Content-Type: application/json" \
  -d '{"query": {"exists": {"field": "image_embedding"}}}' \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" | jq

# サンプルドキュメント取得
curl -s "$OPENSEARCH_ENDPOINT/file-index/_search?size=3" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" | jq

# k-NN検索テスト
# （ランダムベクトルで検索）
python3 -c "import random; import json; print(json.dumps([random.random() for _ in range(1024)]))" > test-vector.json
curl -s "$OPENSEARCH_ENDPOINT/file-index/_search" \
  -H "Content-Type: application/json" \
  -d "{\"size\": 5, \"query\": {\"knn\": {\"image_embedding\": {\"vector\": $(cat test-vector.json), \"k\": 5}}}}" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq
```

---

## トラブルシューティング

### Q1: 診断スクリプトで"Connection refused"エラー

**原因**: VPCエンドポイントはローカル環境からアクセス不可

**対処**:
- EC2インスタンスまたはLambda関数から実行
- AWS Systems Managerセッションマネージャーを使用

```bash
# EC2に接続
aws ssm start-session --target <instance-id>

# または
ssh -i ~/.ssh/key.pem ec2-user@<instance-private-ip>
```

---

### Q2: 診断スクリプトで"Access denied"エラー

**原因**: IAM権限不足

**対処**: EC2インスタンスロールに以下の権限を追加

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpHead"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-opensearch/*"
    }
  ]
}
```

---

### Q3: AWS CLIで"ExpiredTokenException"エラー

**原因**: 認証トークンの有効期限切れ

**対処**:
```bash
# SSOログイン
aws sso login --profile cis-production

# または認証情報を再設定
aws configure
```

---

## 次のアクション

### ✅ 即座に実行（今すぐ）

1. **診断スクリプトを実行**
   ```bash
   bash backend/scripts/diagnose-opensearch-from-vpc.sh
   ```

2. **診断結果を確認**
   - 結果を`diagnosis-result.txt`に保存
   - 問題のシナリオを特定

3. **詳細レポートを参照**
   - [OPENSEARCH_IMAGE_SEARCH_DIAGNOSTIC_REPORT.md](/Users/tatsuya/focus_project/cis_filesearch_app/docs/incident-response/OPENSEARCH_IMAGE_SEARCH_DIAGNOSTIC_REPORT.md)

### 📅 短期（1週間以内）

4. **Phase 2を実行**: OpenSearchインデックス修正
5. **Phase 3を実行**: Python Worker改修

### 📅 中期（2週間以内）

6. **Phase 4を実行**: 既存ファイル再処理
7. **Phase 5-6を実行**: テストと検証

---

## 関連ドキュメント

- 📄 [診断レポート（完全版）](/Users/tatsuya/focus_project/cis_filesearch_app/docs/incident-response/OPENSEARCH_IMAGE_SEARCH_DIAGNOSTIC_REPORT.md)
- 📄 [Lambda Search API実装](/Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/README.md)
- 📄 [OpenSearch k-NN設定ガイド](https://opensearch.org/docs/latest/search-plugins/knn/index/)
- 📄 [AWS Bedrock Titan Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html)

---

## サポート

- **技術質問**: [GitHub Issues](https://github.com/your-org/cis-filesearch/issues)
- **緊急対応**: tech-support@example.com

---

**最終更新**: 2025-12-18
**ステータス**: 診断準備完了
