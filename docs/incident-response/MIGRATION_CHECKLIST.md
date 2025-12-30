# OpenSearch Migration Checklist

## 事前準備 (Pre-Migration)

### 1. インフラストラクチャ準備
- [ ] **Terraform でインフラをデプロイ**
  ```bash
  cd backend/lambda-search-api/terraform
  terraform init
  terraform plan
  terraform apply
  ```

- [ ] **EC2 Bastion インスタンスが起動していることを確認**
  ```bash
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=opensearch-migration-bastion" \
    --query 'Reservations[0].Instances[0].State.Name'
  # 期待値: "running"
  ```

- [ ] **OpenSearch ドメインが正常であることを確認**
  ```bash
  aws opensearch describe-domain \
    --domain-name cis-filesearch-opensearch \
    --query 'DomainStatus.Processing'
  # 期待値: false (処理中でないこと)
  ```

### 2. バックアップ準備
- [ ] **S3 バックアップバケットの確認**
  ```bash
  aws s3 ls s3://cis-filesearch-opensearch-backups/
  ```

- [ ] **OpenSearch スナップショットリポジトリの確認**
  ```bash
  curl -XGET "https://<ENDPOINT>/_snapshot/opensearch-backups" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es"
  ```

- [ ] **手動バックアップの作成 (オプション)**
  ```bash
  curl -XPUT "https://<ENDPOINT>/_snapshot/opensearch-backups/manual-backup-$(date +%Y%m%d)" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" \
    -H "Content-Type: application/json" \
    -d '{"indices": "file-index", "include_global_state": false}'
  ```

### 3. 設定確認
- [ ] **AWS Parameter Store の値を確認**
  ```bash
  aws ssm get-parameters \
    --names \
      /cis-filesearch/opensearch/endpoint \
      /cis-filesearch/opensearch/index-name \
      /cis-filesearch/opensearch/alias-name \
    --with-decryption
  ```

- [ ] **現在のインデックス名を確認**
  ```bash
  curl -XGET "https://<ENDPOINT>/_cat/indices?v" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es"
  ```

- [ ] **エイリアス設定を確認**
  ```bash
  curl -XGET "https://<ENDPOINT>/_cat/aliases?v" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es"
  ```

### 4. ステークホルダーへの通知
- [ ] **メンテナンス通知を関係者に送信**
  - 開始時刻
  - 予想所要時間
  - 影響範囲 (検索機能の一時停止の可能性)
  - ロールバックプラン

---

## マイグレーション実行 (Execution)

### 方法 A: EC2 Bastion 経由 (推奨)

#### ステップ 1: Bastion に接続
- [ ] **SSM Session Manager で接続**
  ```bash
  # ローカルマシンで実行
  BASTION_ID=$(terraform output -raw bastion_instance_id)
  aws ssm start-session --target $BASTION_ID
  ```

#### ステップ 2: リポジトリを準備
- [ ] **migration ユーザーに切り替え**
  ```bash
  sudo su - migration
  cd /opt/cis-migration
  ```

- [ ] **クイックスタートガイドを表示**
  ```bash
  ./quick-start.sh
  ```

- [ ] **リポジトリをクローン**
  ```bash
  git clone https://github.com/your-org/cis-filesearch-app.git
  cd cis-filesearch-app/backend/lambda-search-api
  npm install
  ```

#### ステップ 3: 環境変数を設定
- [ ] **環境変数ファイルを作成**
  ```bash
  cat > .env.migration << 'EOF'
  OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xxx.ap-northeast-1.es.amazonaws.com
  OPENSEARCH_INDEX=file-index
  OPENSEARCH_NEW_INDEX=file-index-v2-$(date +%Y%m%d)
  OPENSEARCH_ALIAS=file-index
  AWS_REGION=ap-northeast-1
  OPENSEARCH_BACKUP_REPO=opensearch-backups
  EOF
  ```

- [ ] **環境変数を読み込み**
  ```bash
  export $(cat .env.migration | xargs)
  ```

#### ステップ 4: ドライラン実行
- [ ] **ドライランを実行 (変更なし)**
  ```bash
  npm run migrate:opensearch -- --dry-run
  ```

- [ ] **ドライランの結果を確認**
  - ✅ VPC access: OK
  - ✅ Index exists: file-index
  - ✅ Backup repository: opensearch-backups
  - ✅ Document count: XXX

#### ステップ 5: 本番実行
- [ ] **最終確認プロンプト**
  ```bash
  echo "About to execute migration. Type 'MIGRATE' to confirm:"
  read CONFIRM
  if [ "$CONFIRM" != "MIGRATE" ]; then
    echo "Aborted"
    exit 1
  fi
  ```

- [ ] **マイグレーション実行**
  ```bash
  npm run migrate:opensearch -- --execute 2>&1 | tee migration-$(date +%Y%m%d-%H%M%S).log
  ```

### 方法 B: Lambda 関数経由

- [ ] **Lambda 関数を手動実行**
  ```bash
  aws lambda invoke \
    --function-name opensearch-migration \
    --payload '{"execute": true}' \
    --log-type Tail \
    response.json

  cat response.json | jq .
  ```

- [ ] **CloudWatch Logs でモニタリング**
  ```bash
  aws logs tail /aws/lambda/opensearch-migration --follow
  ```

---

## モニタリング (Monitoring)

### リアルタイム進捗確認

- [ ] **reindex タスクの進捗を確認**
  ```bash
  # 別のターミナルで実行
  watch -n 5 'curl -s -XGET "https://<ENDPOINT>/_tasks?detailed=true&actions=*reindex" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq .'
  ```

- [ ] **新インデックスのドキュメント数を確認**
  ```bash
  watch -n 10 'curl -s -XGET "https://<ENDPOINT>/file-index-v2/_count" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq .'
  ```

### CloudWatch メトリクス

- [ ] **Lambda 実行状況を確認**
  ```bash
  aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Duration \
    --dimensions Name=FunctionName,Value=opensearch-migration \
    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 300 \
    --statistics Maximum
  ```

---

## 検証 (Validation)

### 1. マイグレーション完了確認
- [ ] **エイリアスが新インデックスを指していることを確認**
  ```bash
  curl -XGET "https://<ENDPOINT>/_cat/aliases/file-index?v" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es"

  # 期待される出力:
  # alias      index          filter routing.index routing.search is_write_index
  # file-index file-index-v2  -      -             -              -
  ```

### 2. ドキュメント数の比較
- [ ] **Blue と Green のドキュメント数を比較**
  ```bash
  BLUE_COUNT=$(curl -s -XGET "https://<ENDPOINT>/file-index/_count" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq -r '.count')

  GREEN_COUNT=$(curl -s -XGET "https://<ENDPOINT>/file-index-v2/_count" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq -r '.count')

  echo "Blue: $BLUE_COUNT"
  echo "Green: $GREEN_COUNT"
  echo "Diff: $((BLUE_COUNT - GREEN_COUNT))"

  # 差分が 0.1% 以内であることを確認
  ```

### 3. 機能テスト
- [ ] **テキスト検索のテスト**
  ```bash
  curl -XPOST "https://<ENDPOINT>/file-index/_search" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" \
    -H "Content-Type: application/json" \
    -d '{
      "query": {
        "multi_match": {
          "query": "テスト",
          "fields": ["file_name", "extracted_text"]
        }
      },
      "size": 5
    }' | jq '.hits.total.value'
  ```

- [ ] **k-NN ベクトル検索のテスト (新機能)**
  ```bash
  # 画像埋め込みベクトルでの検索
  curl -XPOST "https://<ENDPOINT>/file-index/_search" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" \
    -H "Content-Type: application/json" \
    -d '{
      "query": {
        "script_score": {
          "query": {"match_all": {}},
          "script": {
            "source": "knn_score",
            "lang": "knn",
            "params": {
              "field": "image_embedding",
              "query_value": [0.1, 0.2, ...],  # 1024次元
              "space_type": "innerproduct"
            }
          }
        }
      },
      "size": 10
    }' | jq '.hits.hits[] | {file_name: ._source.file_name, score: ._score}'
  ```

### 4. パフォーマンステスト
- [ ] **検索レイテンシーを測定**
  ```bash
  for i in {1..10}; do
    time curl -s -XPOST "https://<ENDPOINT>/file-index/_search" \
      --aws-sigv4 "aws:amz:ap-northeast-1:es" \
      -H "Content-Type: application/json" \
      -d '{"query": {"match_all": {}}, "size": 20}' > /dev/null
  done

  # 平均レイテンシーが 1 秒未満であることを確認
  ```

---

## 事後処理 (Post-Migration)

### 1. モニタリング期間
- [ ] **5分間のポストスイッチモニタリング**
  - エラー率が正常範囲内
  - 検索レイテンシーが許容範囲内
  - スループットが正常

### 2. 監査ログの保存
- [ ] **監査ログを S3 にアップロード**
  ```bash
  aws s3 cp migration-audit-*.json \
    s3://cis-filesearch-opensearch-backups/audit-logs/
  ```

### 3. ドキュメント更新
- [ ] **マイグレーション完了レポートを作成**
  - 開始時刻/終了時刻
  - ドキュメント数
  - 発生した問題と解決策
  - パフォーマンスメトリクス

### 4. ステークホルダーへの通知
- [ ] **完了通知を送信**
  - マイグレーション成功
  - 検証結果
  - 新機能の利用可能性 (k-NN検索)

---

## ロールバック手順 (Rollback)

**マイグレーション失敗時のみ実行**

### 緊急ロールバック
- [ ] **エイリアスを Blue インデックスに戻す**
  ```bash
  curl -XPOST "https://<ENDPOINT>/_aliases" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" \
    -H "Content-Type: application/json" \
    -d '{
      "actions": [
        {"remove": {"index": "file-index-v2", "alias": "file-index"}},
        {"add": {"index": "file-index", "alias": "file-index"}}
      ]
    }'
  ```

- [ ] **ロールバック確認**
  ```bash
  curl -XGET "https://<ENDPOINT>/_cat/aliases/file-index?v" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es"
  ```

- [ ] **インシデントレポートを作成**
  - ロールバック理由
  - 発生した問題
  - 影響範囲
  - 次回の対策

---

## クリーンアップ (Cleanup)

**マイグレーション成功後 7 日以降に実行**

### 1. 旧インデックスの削除
- [ ] **7日間の安定稼働を確認**
  - エラーなし
  - パフォーマンス問題なし
  - ユーザーからのクレームなし

- [ ] **旧インデックスを削除**
  ```bash
  # 最終確認
  echo "Delete old index 'file-index'? Type 'DELETE' to confirm:"
  read CONFIRM

  if [ "$CONFIRM" = "DELETE" ]; then
    curl -XDELETE "https://<ENDPOINT>/file-index" \
      --aws-sigv4 "aws:amz:ap-northeast-1:es"
    echo "Old index deleted"
  fi
  ```

### 2. バックアップの整理
- [ ] **古いスナップショットを削除 (90日以上経過したもの)**
  ```bash
  aws s3 ls s3://cis-filesearch-opensearch-backups/ | \
    awk '{if ($1 < "'$(date -d '90 days ago' +%Y-%m-%d)'") print $4}' | \
    xargs -I {} aws s3 rm s3://cis-filesearch-opensearch-backups/{}
  ```

### 3. インフラのクリーンアップ
- [ ] **Migration Bastion の停止 (必要に応じて)**
  ```bash
  aws ec2 stop-instances --instance-ids $BASTION_ID
  ```

- [ ] **Lambda 関数の削除 (一時的なものであれば)**
  ```bash
  aws lambda delete-function --function-name opensearch-migration
  ```

---

## トラブルシューティング

### 問題 1: VPC アクセス失敗
**症状:** `NETWORK ERROR: Cannot reach OpenSearch endpoint`

**解決策:**
1. EC2 インスタンスから実行しているか確認
2. Security Group の設定を確認
3. VPC エンドポイントの DNS 解決を確認

### 問題 2: インデックス名の不一致
**症状:** `Current index 'file_index' does not exist`

**解決策:**
1. 実際のインデックス名を確認: `curl -XGET "https://<ENDPOINT>/_cat/indices?v"`
2. 環境変数を修正: `export OPENSEARCH_INDEX=file-index`

### 問題 3: スナップショット作成失敗
**症状:** `Backup repository not found`

**解決策:**
1. スナップショットリポジトリを作成
2. S3 バケットへのアクセス権限を確認
3. IAM ロールに s3:PutObject 権限があるか確認

---

## 連絡先

### 緊急連絡先
- **DevOps Team:** devops@example.com
- **On-Call:** +81-XX-XXXX-XXXX
- **Slack Channel:** #cis-filesearch-alerts

### エスカレーション
1. **Level 1:** DevOps Engineer (即座)
2. **Level 2:** SRE Lead (15分以内)
3. **Level 3:** CTO (30分以内)
