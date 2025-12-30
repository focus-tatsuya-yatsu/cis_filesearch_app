# Lambda Search API - VPC Deployment Quick Start

## 現在の状態

✅ Lambda関数がVPC内プライベートサブネットに正常にデプロイされました

❌ OpenSearch Fine-Grained Access Control (FGAC) の設定が未完了

## すぐに実施すべきこと

### OpenSearch IAMロールマッピング設定

Lambda関数がOpenSearchに接続できるようにするため、以下のいずれかの方法でIAMロールマッピングを設定してください。

#### 最も簡単な方法: OpenSearch Dashboards

1. **OpenSearch Dashboardsにアクセス**
   ```
   URL: https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_dashboards/

   ※VPC内からのアクセスが必要です
   ```

2. **Security → Role Mappings → all_access**

3. **Backend rolesに以下を追加**:
   ```
   arn:aws:iam::770923989980:role/cis-lambda-search-api-role
   ```

4. **保存**

### 設定確認

```bash
# Lambda関数をテスト
aws lambda invoke \
  --function-name cis-search-api-prod \
  --region ap-northeast-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"GET","path":"/search","queryStringParameters":{"q":"test"}}' \
  /tmp/test-response.json

# 結果確認
cat /tmp/test-response.json | jq .
```

**成功時**: `statusCode: 200`
**失敗時**: `statusCode: 503` → FGAC設定を再確認

## デプロイ済みリソース

### Lambda関数
- **Name**: `cis-search-api-prod`
- **Runtime**: Node.js 20.x
- **VPC**: `vpc-02d08f2fa75078e67`
- **Subnets**: 3 private subnets (1a, 1c, 1d)
- **Security Groups**:
  - `sg-06ee622d64e67f12f` (Lambda SG)
  - `sg-0c482a057b356a0c3` (OpenSearch SG)

### OpenSearch接続
- **Endpoint**: `https://10.0.10.145` (VPC内部IP)
- **Index**: `file-index`
- **Authentication**: AWS SigV4 (IAM)

### ネットワーク
- **NAT Gateway**: `nat-04c18741881490c45` (AWS API呼び出し用)
- **Route 53 Private Zone**: `ap-northeast-1.es.amazonaws.com`
- **VPC DNS**: 有効化済み

## 詳細ドキュメント

- **完全デプロイメントガイド**: `VPC_DEPLOYMENT_COMPLETE.md`
- **FGAC設定詳細**: `OPENSEARCH_FGAC_SETUP.md`
- **Terraform設定**: `terraform/terraform.tfvars`

## トラブルシューティング

### Lambda関数が503エラーを返す

**原因**: OpenSearch FGAC未設定

**解決**: 上記「OpenSearch IAMロールマッピング設定」を実施

### DNS解決エラー

**現在の対応**: IPアドレス直接指定で回避済み (`OPENSEARCH_USE_IP=true`)

### ログ確認

```bash
# リアルタイムログ
aws logs tail /aws/lambda/cis-search-api-prod --region ap-northeast-1 --follow

# 過去5分
aws logs tail /aws/lambda/cis-search-api-prod --region ap-northeast-1 --since 5m
```

## 次のステップ

1. ✅ **FGAC設定** (最優先)
2. ⏳ **API Gateway統合** (Terraform デプロイ)
3. ⏳ **フロントエンド統合** (Next.js)
4. ⏳ **Cognito認証** (オプション)

## サポート

問題が発生した場合:
1. `VPC_DEPLOYMENT_COMPLETE.md` のトラブルシューティングセクションを確認
2. CloudWatch Logsでエラーメッセージを確認
3. セキュリティグループ設定を確認

---

**重要**: OpenSearch FGACの設定が完了するまで、Lambda関数はOpenSearchに接続できません。上記の手順を実施してください。
