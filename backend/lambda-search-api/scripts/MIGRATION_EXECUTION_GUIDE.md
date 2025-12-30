# OpenSearch Migration 実行ガイド

## 🚨 重要: 実行前の確認事項

マイグレーションは **EC2 インスタンス (VPC内) からのみ実行可能** です。

### なぜローカルマシンから実行できないのか?

```
OpenSearch VPC Endpoint の仕様:
- VPC 内のプライベートサブネットに配置
- パブリックインターネットからアクセス不可
- VPC ピアリング/VPN/Direct Connect が必要

あなたのローカルマシン → ❌ アクセス不可
EC2 (同じVPC内)      → ✅ アクセス可能
Lambda (VPC配置)      → ✅ アクセス可能
```

---

## 📋 実行方法: 3つの選択肢

### 方法 1: EC2 Bastion 経由 (推奨 - 最もシンプル)

#### ステップ 1: EC2 インスタンスに接続

```bash
# SSM Session Manager で接続
aws ssm start-session --target i-xxxxxxxxxxxxxxxxx

# または EC2 Instance Connect
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-xxxxxxxxxxxxxxxxx \
  --instance-os-user ec2-user \
  --ssh-public-key file://~/.ssh/id_rsa.pub

ssh ec2-user@<PRIVATE_IP>
```

#### ステップ 2: 環境セットアップ

```bash
# Node.js がインストールされていない場合
sudo yum install -y nodejs npm git

# リポジトリをクローン
cd /home/ec2-user
git clone https://github.com/your-org/cis-filesearch-app.git
cd cis-filesearch-app/backend/lambda-search-api

# 依存関係をインストール
npm install
```

#### ステップ 3: 環境変数を設定

```bash
# .env ファイルを作成
cat > .env.migration << 'EOF'
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
OPENSEARCH_NEW_INDEX=file-index-v2-$(date +%Y%m%d)
OPENSEARCH_ALIAS=file-index
AWS_REGION=ap-northeast-1
OPENSEARCH_BACKUP_REPO=opensearch-backups
EOF

# 環境変数を読み込み
export $(cat .env.migration | xargs)
```

#### ステップ 4: ドライラン実行 (変更なし)

```bash
npm run migrate:opensearch -- --dry-run
```

**期待される出力:**
```
🚀 OpenSearch Secure Migration Script v2.0.0

✅ [LOAD_CONFIG] Configuration loaded
🔍 Validating VPC network access...
✅ Network connectivity: OK
   Cluster status: green
   Detected EC2 instance: i-0123456789abcdef0
✅ [VALIDATE_VPC_ACCESS] VPC access validated

🔍 Validating index configuration...
✅ Current index exists: file-index
   Document count: 10,532
   Current aliases:
     - file-index
✅ [VALIDATE_INDEX_CONFIG] Index configuration valid

🔍 Validating backup repository...
✅ Backup repository exists: opensearch-backups
   [DRY RUN] Snapshot creation skipped
✅ [CREATE_BACKUP] Backup validation passed

✅ DRY RUN COMPLETE: All validations passed
   To execute migration, run with --execute flag
```

#### ステップ 5: 本番実行

```bash
# 最終確認
echo "About to execute OpenSearch migration. Continue? (yes/no)"
read CONFIRM

if [ "$CONFIRM" = "yes" ]; then
  npm run migrate:opensearch -- --execute 2>&1 | tee migration-$(date +%Y%m%d-%H%M%S).log
else
  echo "Migration aborted"
fi
```

---

### 方法 2: Lambda 関数として実行

#### ステップ 1: Lambda デプロイパッケージ作成

```bash
# ローカルマシンで実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# Lambda レイヤー用の依存関係をビルド
mkdir -p lambda-layer/nodejs
npm install --production --prefix lambda-layer/nodejs

# Lambda 関数コードをパッケージング
zip -r migration-lambda.zip src scripts package.json

# Lambda レイヤーをパッケージング
cd lambda-layer
zip -r ../migration-layer.zip nodejs
cd ..
```

#### ステップ 2: Lambda 関数をデプロイ

```bash
# Lambda 関数を作成
aws lambda create-function \
  --function-name opensearch-migration \
  --runtime nodejs20.x \
  --role arn:aws:iam::ACCOUNT_ID:role/lambda-opensearch-migration \
  --handler src/migration-handler.handler \
  --zip-file fileb://migration-lambda.zip \
  --timeout 900 \
  --memory-size 2048 \
  --vpc-config SubnetIds=subnet-xxx,subnet-yyy,SecurityGroupIds=sg-zzz \
  --environment Variables="{
    OPENSEARCH_ENDPOINT=https://vpc-xxx.ap-northeast-1.es.amazonaws.com,
    OPENSEARCH_INDEX=file-index,
    OPENSEARCH_NEW_INDEX=file-index-v2,
    AWS_REGION=ap-northeast-1
  }"

# Lambda レイヤーを公開
aws lambda publish-layer-version \
  --layer-name opensearch-migration-dependencies \
  --zip-file fileb://migration-layer.zip \
  --compatible-runtimes nodejs20.x

# レイヤーを関数にアタッチ
aws lambda update-function-configuration \
  --function-name opensearch-migration \
  --layers arn:aws:lambda:REGION:ACCOUNT:layer:opensearch-migration-dependencies:1
```

#### ステップ 3: Lambda を実行

```bash
# ドライラン
aws lambda invoke \
  --function-name opensearch-migration \
  --payload '{"dryRun": true}' \
  --log-type Tail \
  response.json

# 本番実行
aws lambda invoke \
  --function-name opensearch-migration \
  --payload '{"execute": true}' \
  --log-type Tail \
  response.json

# 結果を確認
cat response.json | jq .
```

---

### 方法 3: AWS Systems Manager Run Command

#### ステップ 1: SSM ドキュメント作成

```yaml
# migration-document.yaml
schemaVersion: '2.2'
description: Execute OpenSearch Migration
parameters:
  dryRun:
    type: String
    default: 'true'
    description: Execute in dry-run mode
mainSteps:
  - action: aws:runShellScript
    name: executeMigration
    inputs:
      runCommand:
        - |
          #!/bin/bash
          set -e

          cd /opt/cis-filesearch-app/backend/lambda-search-api

          export OPENSEARCH_ENDPOINT={{ssm:/cis-filesearch/opensearch/endpoint}}
          export OPENSEARCH_INDEX={{ssm:/cis-filesearch/opensearch/index}}
          export AWS_REGION=ap-northeast-1

          if [ "{{dryRun}}" = "true" ]; then
            npm run migrate:opensearch -- --dry-run
          else
            npm run migrate:opensearch -- --execute
          fi
```

#### ステップ 2: ドキュメント登録と実行

```bash
# SSM ドキュメントを作成
aws ssm create-document \
  --name "OpenSearchMigration" \
  --document-type "Command" \
  --content file://migration-document.yaml

# EC2 インスタンスで実行
aws ssm send-command \
  --document-name "OpenSearchMigration" \
  --parameters "dryRun=true" \
  --targets "Key=tag:Role,Values=migration-bastion" \
  --comment "OpenSearch migration dry run"

# 実行状態を確認
aws ssm list-command-invocations \
  --command-id <COMMAND_ID> \
  --details
```

---

## 🔧 トラブルシューティング

### エラー 1: VPC アクセス失敗

```
❌ NETWORK ERROR: Cannot reach OpenSearch endpoint
```

**原因:**
- ローカルマシンから実行している
- Security Group が正しく設定されていない

**解決策:**
```bash
# Security Group を確認
aws ec2 describe-security-groups --group-ids sg-xxxxx

# OpenSearch への接続を許可するルールがあるか確認
# Source: Lambda/EC2 の Security Group
# Destination: OpenSearch Security Group
# Port: 443 (HTTPS)
```

### エラー 2: インデックス名の不一致

```
❌ Current index 'file_index' does not exist
```

**原因:**
- 環境変数のインデックス名が間違っている
- ハイフン vs アンダースコア

**解決策:**
```bash
# 実際のインデックス名を確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch \
  | jq -r '.DomainStatus.Endpoint'

# cURL でインデックス一覧を取得
curl -XGET "https://<ENDPOINT>/_cat/indices?v" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# 正しいインデックス名を .env に設定
```

### エラー 3: スナップショットリポジトリが存在しない

```
❌ Backup repository 'opensearch-backups' not found
```

**解決策:**
```bash
# S3 バケットを作成
aws s3 mb s3://cis-filesearch-opensearch-backups

# スナップショットリポジトリを作成
curl -XPUT "https://<ENDPOINT>/_snapshot/opensearch-backups" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "s3",
    "settings": {
      "bucket": "cis-filesearch-opensearch-backups",
      "region": "ap-northeast-1",
      "role_arn": "arn:aws:iam::ACCOUNT:role/OpensearchSnapshotRole"
    }
  }'
```

---

## 📊 マイグレーション進捗モニタリング

### リアルタイム監視

```bash
# 別のターミナルで実行
watch -n 5 'curl -s -XGET "https://<ENDPOINT>/_tasks?detailed=true&actions=*reindex" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq .'

# ドキュメント数を確認
watch -n 10 'curl -s -XGET "https://<ENDPOINT>/file-index-v2/_count" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq .'
```

### CloudWatch Logs

```bash
# Lambda 実行ログ
aws logs tail /aws/lambda/opensearch-migration --follow

# EC2 インスタンスログ (CloudWatch Agent がインストールされている場合)
aws logs tail /cis-filesearch/migration --follow
```

---

## ✅ マイグレーション完了後の検証

### 1. エイリアス確認

```bash
curl -XGET "https://<ENDPOINT>/_cat/aliases/file-index?v" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"

# 期待される出力:
# alias      index          filter routing.index routing.search is_write_index
# file-index file-index-v2  -      -             -              -
```

### 2. ドキュメント数比較

```bash
# Blue index
BLUE_COUNT=$(curl -s -XGET "https://<ENDPOINT>/file-index/_count" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq -r '.count')

# Green index
GREEN_COUNT=$(curl -s -XGET "https://<ENDPOINT>/file-index-v2/_count" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq -r '.count')

echo "Blue: $BLUE_COUNT, Green: $GREEN_COUNT, Diff: $((BLUE_COUNT - GREEN_COUNT))"
```

### 3. サンプルクエリテスト

```bash
# テキスト検索
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
  }' | jq -r '.hits.total.value'
```

---

## 🔄 ロールバック手順

マイグレーション後に問題が発生した場合:

```bash
#!/bin/bash
# rollback.sh

BLUE_INDEX="file-index"
GREEN_INDEX="file-index-v2"
ALIAS="file-index"

echo "🚨 Rolling back to blue index"

curl -XPOST "https://<ENDPOINT>/_aliases" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H "Content-Type: application/json" \
  -d "{
    \"actions\": [
      {\"remove\": {\"index\": \"$GREEN_INDEX\", \"alias\": \"$ALIAS\"}},
      {\"add\": {\"index\": \"$BLUE_INDEX\", \"alias\": \"$ALIAS\"}}
    ]
  }"

echo "✅ Rollback completed"
```

---

## 📚 参考リンク

- [OpenSearch Reindex API](https://opensearch.org/docs/latest/api-reference/document-apis/reindex/)
- [AWS VPC Endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints.html)
- [Blue-Green Deployment Pattern](https://martinfowler.com/bliki/BlueGreenDeployment.html)
