# 🔧 本番環境トラブルシューティングガイド

**作成日**: 2025-12-20
**対象環境**: Production (https://cis-filesearch.com/)

---

## 📋 目次

1. [一般的なトラブルシューティングフロー](#一般的なトラブルシューティングフロー)
2. [Lambda関数の問題](#lambda関数の問題)
3. [フロントエンド（CloudFront/S3）の問題](#フロントエンドcloudfronts3の問題)
4. [OpenSearchの問題](#opensearchの問題)
5. [CORS/セキュリティの問題](#corsセキュリティの問題)
6. [パフォーマンスの問題](#パフォーマンスの問題)
7. [緊急時の対応](#緊急時の対応)

---

## 🔍 一般的なトラブルシューティングフロー

### Step 1: 問題の特定

```bash
# 1. CloudWatch Logsでエラー確認
aws logs tail /aws/lambda/cis-search-api-prod --since 10m --follow

# 2. Lambda関数の最近のエラー確認
aws lambda get-function --function-name cis-search-api-prod

# 3. API Gatewayのメトリクス確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name 5XXError \
  --dimensions Name=ApiName,Value=cis-search-api \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# 4. CloudFrontのエラー確認
aws cloudfront get-distribution --id <DISTRIBUTION_ID>
```

### Step 2: 問題の分類

| 症状 | 分類 | セクション |
|------|------|-----------|
| 500エラー | Lambda関数エラー | [Lambda関数の問題](#lambda関数の問題) |
| 404エラー | CloudFront/S3エラー | [フロントエンドの問題](#フロントエンドcloudfronts3の問題) |
| CORSエラー | セキュリティエラー | [CORS/セキュリティの問題](#corsセキュリティの問題) |
| 遅いレスポンス | パフォーマンス問題 | [パフォーマンスの問題](#パフォーマンスの問題) |
| 検索結果ゼロ | OpenSearchエラー | [OpenSearchの問題](#opensearchの問題) |

### Step 3: 原因の特定と対応

各セクションの手順に従って対応

---

## 🔥 Lambda関数の問題

### 問題1: Lambda関数が500エラーを返す

#### 症状
- API Gatewayが500 Internal Server Errorを返す
- CloudWatch Logsにエラーログがある

#### 原因候補
1. OpenSearch接続エラー
2. 環境変数の設定ミス
3. コードのバグ
4. メモリ不足
5. タイムアウト

#### 診断手順

```bash
# 1. CloudWatch Logsでエラー詳細確認
aws logs tail /aws/lambda/cis-search-api-prod --since 10m --filter "ERROR"

# 2. Lambda関数の設定確認
aws lambda get-function-configuration --function-name cis-search-api-prod

# 3. 環境変数確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'Environment.Variables'

# 4. 最近のエラー統計
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=cis-search-api-prod \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

#### 対処方法

**ケース1: OpenSearch接続エラー**

```
エラーメッセージ: getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch-*.ap-northeast-1.es.amazonaws.com
```

**対策**:
```bash
# NAT Gatewayのサブネット確認
aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=vpc-02d08f2fa75078e67"

# Lambda関数のVPC設定更新（NAT Gatewayがあるサブネット）
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --vpc-config SubnetIds=subnet-XXXXXXXX,SecurityGroupIds=sg-0c482a057b356a0c3

# または、VPCエンドポイント作成
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-02d08f2fa75078e67 \
  --service-name com.amazonaws.ap-northeast-1.es \
  --route-table-ids rtb-XXXXXXXX \
  --subnet-ids subnet-XXXXXXXX \
  --security-group-ids sg-0c482a057b356a0c3
```

**ケース2: 環境変数の設定ミス**

```bash
# 環境変数更新
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --environment "Variables={
    OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-*.ap-northeast-1.es.amazonaws.com,
    OPENSEARCH_INDEX=file-index,
    AWS_REGION=ap-northeast-1
  }"
```

**ケース3: メモリ不足**

```bash
# メモリ使用量確認
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --filter-pattern "Memory Size" \
  --max-items 10

# メモリ増量（512MB → 1024MB）
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --memory-size 1024
```

**ケース4: タイムアウト**

```bash
# タイムアウト延長（30秒 → 60秒）
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --timeout 60
```

---

### 問題2: Lambda関数がOpenSearchに接続できない

#### 症状
- DNS解決エラー
- Connection timeoutエラー

#### 診断手順

```bash
# 1. Lambda関数のVPC設定確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'VpcConfig'

# 2. セキュリティグループ確認
aws ec2 describe-security-groups \
  --group-ids sg-0c482a057b356a0c3

# 3. OpenSearchドメインのVPC設定確認
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch \
  --query 'DomainStatus.VPCOptions'
```

#### 対処方法

```bash
# セキュリティグループにOpenSearch用インバウンドルール追加
aws ec2 authorize-security-group-ingress \
  --group-id sg-0c482a057b356a0c3 \
  --protocol tcp \
  --port 443 \
  --source-group sg-0c482a057b356a0c3
```

---

## 🌐 フロントエンド（CloudFront/S3）の問題

### 問題1: 404 Not Found エラー

#### 症状
- https://cis-filesearch.com/ が404エラー
- 特定のパスで404エラー

#### 診断手順

```bash
# 1. S3バケットの内容確認
aws s3 ls s3://cis-filesearch-frontend-prod/ --recursive

# 2. index.htmlの存在確認
aws s3 ls s3://cis-filesearch-frontend-prod/index.html

# 3. CloudFront Distribution設定確認
aws cloudfront get-distribution --id <DISTRIBUTION_ID>
```

#### 対処方法

**ケース1: index.htmlが存在しない**

```bash
# フロントエンド再ビルド&デプロイ
cd frontend
yarn build
aws s3 sync out/ s3://cis-filesearch-frontend-prod/ --delete
```

**ケース2: CloudFrontのデフォルトルートオブジェクト未設定**

```bash
# CloudFront設定更新（Terraformで対応推奨）
# default_root_object = "index.html" を確認
```

**ケース3: SPA routingエラー**

```bash
# CloudFrontのカスタムエラーレスポンス設定確認
# 403/404 → 200 /index.html にリダイレクト
```

---

### 問題2: キャッシュが更新されない

#### 症状
- 最新のコードが反映されない
- 古い画面が表示される

#### 対処方法

```bash
# 1. CloudFront Invalidation実行
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='CIS FileSearch Frontend Distribution'].Id" \
  --output text)

aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*"

# 2. Invalidation完了確認（5-10分かかる）
aws cloudfront get-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --id <INVALIDATION_ID>

# 3. ブラウザキャッシュクリア
# Chrome: Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows)
```

---

## 🔍 OpenSearchの問題

### 問題1: 検索結果がゼロ

#### 症状
- 検索しても結果が0件
- インデックスが空

#### 診断手順

```bash
# 1. インデックスのドキュメント数確認
curl -X GET "https://<OPENSEARCH_ENDPOINT>/file-index/_count" \
  -u admin:password

# 2. インデックスマッピング確認
curl -X GET "https://<OPENSEARCH_ENDPOINT>/file-index/_mapping" \
  -u admin:password

# 3. サンプル検索実行
curl -X POST "https://<OPENSEARCH_ENDPOINT>/file-index/_search" \
  -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "match_all": {}
    },
    "size": 1
  }'
```

#### 対処方法

**ケース1: インデックスが空**

```bash
# データ再投入（バッチ処理スクリプト実行）
cd backend/lambda-search-api
npm run batch-process
```

**ケース2: マッピングエラー**

```bash
# インデックス再作成
curl -X DELETE "https://<OPENSEARCH_ENDPOINT>/file-index" -u admin:password

curl -X PUT "https://<OPENSEARCH_ENDPOINT>/file-index" \
  -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{
    "mappings": {
      "properties": {
        "path": { "type": "text" },
        "name": { "type": "text" },
        "size": { "type": "long" },
        "modified": { "type": "date" }
      }
    }
  }'
```

---

### 問題2: KNN検索が失敗する

#### 症状
- 画像検索が動作しない
- ベクトル検索エラー

#### 診断手順

```bash
# 1. KNNインデックス確認
curl -X GET "https://<OPENSEARCH_ENDPOINT>/file-index-v2-knn/_count" \
  -u admin:password

# 2. ベクトルフィールド確認
curl -X GET "https://<OPENSEARCH_ENDPOINT>/file-index-v2-knn/_mapping" \
  -u admin:password

# 3. サンプルKNN検索
curl -X POST "https://<OPENSEARCH_ENDPOINT>/file-index-v2-knn/_search" \
  -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{
    "size": 5,
    "query": {
      "knn": {
        "image_vector": {
          "vector": [0.1, 0.2, 0.3, ...],
          "k": 5
        }
      }
    }
  }'
```

#### 対処方法

```bash
# KNNインデックス設定確認（HNSWアルゴリズム）
curl -X PUT "https://<OPENSEARCH_ENDPOINT>/file-index-v2-knn" \
  -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{
    "settings": {
      "index.knn": true
    },
    "mappings": {
      "properties": {
        "image_vector": {
          "type": "knn_vector",
          "dimension": 1024,
          "method": {
            "name": "hnsw",
            "space_type": "l2",
            "engine": "nmslib"
          }
        }
      }
    }
  }'
```

---

## 🔐 CORS/セキュリティの問題

### 問題1: CORSエラー

#### 症状
```
Access to fetch at 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search'
from origin 'https://cis-filesearch.com' has been blocked by CORS policy
```

#### 診断手順

```bash
# 1. Lambda関数のCORS設定確認
cd backend/lambda-search-api
grep -r "Access-Control-Allow-Origin" src/

# 2. API GatewayのCORS設定確認
aws apigateway get-integration-response \
  --rest-api-id <API_ID> \
  --resource-id <RESOURCE_ID> \
  --http-method GET \
  --status-code 200

# 3. OPTIONS メソッド確認
aws apigateway get-method \
  --rest-api-id <API_ID> \
  --resource-id <RESOURCE_ID> \
  --http-method OPTIONS
```

#### 対処方法

**Lambda関数のCORS修正**

```typescript
// src/utils/error-handler.ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://cis-filesearch.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// src/index.ts
export const handler = async (event: APIGatewayProxyEvent) => {
  // OPTIONS プリフライトリクエスト対応
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  // 全てのレスポンスにCORSヘッダーを含める
  try {
    const result = await searchService.search(query);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(result),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};
```

**再デプロイ**

```bash
cd backend/lambda-search-api
npm run build
bash deploy.sh
```

---

### 問題2: レート制限でブロックされる

#### 症状
```
429 Too Many Requests
```

#### 診断手順

```bash
# Usage Planの設定確認
aws apigateway get-usage-plan --usage-plan-id <USAGE_PLAN_ID>

# 現在の使用量確認
aws apigateway get-usage \
  --usage-plan-id <USAGE_PLAN_ID> \
  --start-date 2025-12-20 \
  --end-date 2025-12-21
```

#### 対処方法

```bash
# レート制限緩和
aws apigateway update-usage-plan \
  --usage-plan-id <USAGE_PLAN_ID> \
  --patch-operations \
    op=replace,path=/throttle/rateLimit,value=50 \
    op=replace,path=/throttle/burstLimit,value=100
```

---

## ⚡ パフォーマンスの問題

### 問題1: レスポンスが遅い（> 3秒）

#### 診断手順

```bash
# 1. Lambda関数のDuration確認
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --filter-pattern "Duration" \
  --max-items 20

# 2. OpenSearch検索時間確認
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --filter-pattern "OpenSearch query time" \
  --max-items 20

# 3. Lambda Cold Start確認
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --filter-pattern "Init Duration" \
  --max-items 20
```

#### 対処方法

**ケース1: Lambda Cold Start**

```bash
# Provisioned Concurrency設定（常時ウォームアップ）
aws lambda put-provisioned-concurrency-config \
  --function-name cis-search-api-prod \
  --provisioned-concurrent-executions 2 \
  --qualifier prod
```

**ケース2: OpenSearch検索遅延**

```bash
# OpenSearch HNSW最適化
curl -X PUT "https://<OPENSEARCH_ENDPOINT>/file-index-v2-knn/_settings" \
  -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 100
    }
  }'
```

**ケース3: Lambda関数最適化**

```bash
# メモリ増量でCPU性能向上
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --memory-size 1024
```

---

## 🚨 緊急時の対応

### Critical: 全機能停止

#### 即座のアクション（5分以内）

1. **ロールバック開始**
   ```bash
   cd /Users/tatsuya/focus_project/cis_filesearch_app
   ./rollback-production.sh
   ```

2. **関係者通知**
   - Slack/Teams: 緊急アラート投稿
   - SNS通知: 管理者メールアドレス
   - エスカレーション: PM、CTO

3. **ステータスページ更新**
   - メンテナンス中の表示
   - 復旧予定時刻の通知

#### ロールバック手順（10分以内）

```bash
#!/bin/bash
# rollback-production.sh

# Frontend ロールバック
aws s3 sync s3://cis-filesearch-frontend-prod-backup/latest/ \
  s3://cis-filesearch-frontend-prod/ --delete

aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/*"

# Lambda ロールバック
PREVIOUS_VERSION=$(cat /tmp/deployment-versions.txt | grep "lambda_version" | cut -d= -f2)

aws lambda update-alias \
  --function-name cis-search-api-prod \
  --name prod \
  --function-version $PREVIOUS_VERSION

echo "Rollback completed!"
```

### High: 部分的な機能停止

#### 診断と対応（30分以内）

1. **影響範囲特定**
   - テキスト検索のみ？
   - 画像検索のみ？
   - 特定のユーザーのみ？

2. **ワークアラウンド検討**
   - 一時的な機能無効化
   - 代替UI表示

3. **根本対応**
   - 原因特定
   - 修正パッチ作成
   - 再デプロイ

---

## 📞 エスカレーションフロー

### Level 1: チーム内対応（0-30分）

- Backend/Frontend/DevOps チームで対応
- CloudWatch Logs、メトリクス確認
- 既知の問題を確認、対処

### Level 2: PM エスカレーション（30分-1時間）

- PM に状況報告
- リソース追加要請
- ロールバック判断

### Level 3: AWS Support（1-2時間）

- AWS Supportケース作成
- Priority: Critical（全機能停止）、High（部分機能停止）
- AWS TAM（Technical Account Manager）への連絡

### Level 4: 経営層報告（2時間以上）

- CTO、経営層に報告
- 広報対応検討
- 復旧計画の承認

---

## 📝 インシデント報告テンプレート

### インシデント報告書

```markdown
# インシデント報告書

## 基本情報
- **発生日時**: YYYY-MM-DD HH:MM:SS
- **検知日時**: YYYY-MM-DD HH:MM:SS
- **復旧日時**: YYYY-MM-DD HH:MM:SS
- **影響範囲**: 全機能停止 / 部分機能停止 / パフォーマンス劣化
- **影響ユーザー数**: XX名

## 症状
-

## 根本原因
-

## 対応内容
1.
2.
3.

## 再発防止策
1.
2.
3.

## 学んだこと
-

## 担当者
- 報告者:
- 対応者:
- 承認者:
```

---

## 🔗 便利なコマンド集

### CloudWatch Logs

```bash
# 最近のログ確認（リアルタイム）
aws logs tail /aws/lambda/cis-search-api-prod --follow

# エラーログのみ
aws logs tail /aws/lambda/cis-search-api-prod --filter-pattern "ERROR"

# 特定期間のログ
aws logs tail /aws/lambda/cis-search-api-prod \
  --since 1h \
  --until 10m
```

### Lambda関数

```bash
# 関数情報取得
aws lambda get-function --function-name cis-search-api-prod

# 設定確認
aws lambda get-function-configuration --function-name cis-search-api-prod

# テスト実行
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test"}}' \
  /tmp/response.json
```

### CloudFront

```bash
# Distribution一覧
aws cloudfront list-distributions

# Invalidation実行
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/*"

# Invalidation状態確認
aws cloudfront get-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --id <INVALIDATION_ID>
```

### OpenSearch

```bash
# クラスター状態確認
curl -X GET "https://<OPENSEARCH_ENDPOINT>/_cluster/health" -u admin:password

# インデックス一覧
curl -X GET "https://<OPENSEARCH_ENDPOINT>/_cat/indices?v" -u admin:password

# ドキュメント数確認
curl -X GET "https://<OPENSEARCH_ENDPOINT>/file-index/_count" -u admin:password
```

---

## 📚 参考リンク

- [AWS Lambda トラブルシューティング](https://docs.aws.amazon.com/lambda/latest/dg/troubleshooting.html)
- [CloudFront トラブルシューティング](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/troubleshooting.html)
- [OpenSearch トラブルシューティング](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/handling-errors.html)
- [API Gateway CORS設定](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html)

---

**最終更新**: 2025-12-20
**次回更新**: インシデント発生時に随時更新
