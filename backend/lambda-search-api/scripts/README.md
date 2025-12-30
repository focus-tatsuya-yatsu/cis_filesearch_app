# Lambda Search API - Scripts Reference

このディレクトリには、Lambda Search APIのデプロイ、設定、トラブルシューティング用のスクリプトが含まれています。

## Scripts Overview

### Deployment Scripts

#### `deploy.sh`
基本的なデプロイスクリプト（Serverless Framework使用）

```bash
./scripts/deploy.sh
```

#### `deploy-production.sh`
本番環境向けデプロイスクリプト（AWS CLI使用）

```bash
./scripts/deploy-production.sh
```

#### `deploy-lambda-manual.sh`
手動でLambda関数をデプロイするスクリプト

```bash
./scripts/deploy-lambda-manual.sh
```

#### `deploy-with-existing-api-gateway.sh`
既存のAPI Gatewayと統合してデプロイ

```bash
./scripts/deploy-with-existing-api-gateway.sh
```

---

### VPC & Networking Scripts

#### `create-vpc-endpoint.sh` ❌ (Not Needed)
OpenSearch用のInterface VPC Endpointを作成（実行不要）

**注意**: AWS OpenSearch ServiceはVPCモードでは内部DNSを使用するため、Interface VPC Endpointは不要です。

```bash
# 実行しないでください
./scripts/create-vpc-endpoint.sh
```

#### `create-route53-private-zone.sh` ✅ (Executed)
Route 53プライベートホストゾーンを作成し、OpenSearch用のAレコードを追加

**Status**: 実行済み（Zone ID: Z00961932K6CIIM22B6VP）

```bash
./scripts/create-route53-private-zone.sh
```

**What it does**:
- Route 53プライベートホストゾーン `ap-northeast-1.es.amazonaws.com` を作成
- OpenSearch VPCエンドポイントのAレコードを追加（10.0.10.145）
- VPCに関連付け

#### `reset-lambda-vpc.sh` ✅ (Executed)
Lambda関数のVPC設定をリセットし、ENIを再作成

**Status**: 実行済み

```bash
./scripts/reset-lambda-vpc.sh
```

**What it does**:
- Lambda関数からVPC設定を削除
- ENIの削除を待機
- VPC設定を再追加
- 新しいENIの作成を待機

#### `get-vpc-info.sh`
VPC情報を取得

```bash
./scripts/get-vpc-info.sh
```

---

### OpenSearch Configuration Scripts

#### `configure-opensearch-access.sh` ⚠️ (Manual Steps Required)
OpenSearch Fine-Grained Access Control (FGAC)の設定ガイドを表示

```bash
./scripts/configure-opensearch-access.sh
```

**What it shows**:
- 現在のOpenSearch設定
- アクセスポリシー
- FGAC設定のための手動手順
- OpenSearch Dashboards URLと設定方法

#### `configure-opensearch-fgac.sh`
OpenSearch FGAC設定の代替スクリプト

```bash
./scripts/configure-opensearch-fgac.sh
```

#### `fix-opensearch-dns.sh`
OpenSearch DNS解決問題のトラブルシューティング

```bash
./scripts/fix-opensearch-dns.sh
```

**What it does**:
- OpenSearchエンドポイント情報を取得
- OpenSearchプライベートIPアドレスを確認
- VPC DNS設定を検証
- Route 53プライベートホストゾーンを確認
- Lambda関数をテスト

---

### Verification & Testing Scripts

#### `quick-test.sh` ⚡ (NEW - Recommended First)
Fast 3-step diagnostic check to identify Lambda or API Gateway issues

```bash
./scripts/quick-test.sh
```

**What it tests**:
- Lambda function direct invocation
- API Gateway endpoint
- Recent CloudWatch logs
- Provides immediate diagnosis

**Runtime**: ~10 seconds

#### `test-specific-query.sh` 🔍 (NEW - Query Testing)
Test exact failing query with multiple variations

```bash
./scripts/test-specific-query.sh
```

**What it tests**:
- Original failing query (宇都宮)
- Query with explicit searchType parameter
- POST method
- Query variations (ASCII, empty, different Japanese)
- CloudWatch logs for specific queries

**Runtime**: ~30 seconds

#### `diagnose-api-gateway-500.sh` 🔧 (NEW - Comprehensive)
Full diagnostic suite for API Gateway 500 errors

```bash
./scripts/diagnose-api-gateway-500.sh
```

**What it tests**:
1. Lambda direct invocation (text search)
2. Lambda direct invocation (image search)
3. API Gateway integration
4. Lambda logs analysis
5. Lambda configuration
6. API Gateway configuration
7. Lambda-API Gateway integration
8. OpenSearch connectivity

**Runtime**: ~60 seconds

#### `check-api-gateway-integration.sh` ⚙️ (NEW - Configuration)
Inspect API Gateway configuration and integration settings

```bash
./scripts/check-api-gateway-integration.sh
```

**What it checks**:
- API Gateway type (HTTP API v2 or REST API v1)
- API configuration
- Routes/Resources
- Integration details
- Deployments and stages
- Lambda permissions
- CloudWatch logs configuration

**Runtime**: ~30 seconds

#### `verify-vpc-endpoint.sh`
VPCエンドポイントとLambda接続を検証

```bash
./scripts/verify-vpc-endpoint.sh
```

**What it checks**:
- VPCエンドポイントのステータス
- DNSエントリ
- プライベートDNS設定
- セキュリティグループ設定
- Lambda関数の実行テスト
- CloudWatch Logs
- API Gatewayエンドポイントのテスト

#### `diagnose-deployment.sh`
デプロイメント全体の診断

```bash
./scripts/diagnose-deployment.sh
```

#### `test-api.sh`
API Gatewayエンドポイントをテスト

```bash
./scripts/test-api.sh
```

#### `test-local.sh`
ローカル環境でLambda関数をテスト

```bash
./scripts/test-local.sh
```

---

### Configuration Scripts

#### `check-aws-config.sh`
AWS設定を確認

```bash
./scripts/check-aws-config.sh
```

**What it checks**:
- AWS CLI設定
- 認証情報
- デフォルトリージョン

---

## Common Workflows

### 1. Troubleshooting 500 Errors (NEW) ⚡

```bash
# Step 1: Quick diagnostic check (start here!)
./scripts/quick-test.sh

# Step 2: Based on results:
# If Lambda passes but API Gateway fails:
./scripts/check-api-gateway-integration.sh

# If Lambda fails:
./scripts/diagnose-api-gateway-500.sh

# If both pass but specific queries fail:
./scripts/test-specific-query.sh

# Step 3: Review detailed diagnostic guide
cat ../DIAGNOSTIC_GUIDE.md
```

### 2. Initial Deployment

```bash
# Step 1: Check AWS configuration
./scripts/check-aws-config.sh

# Step 2: Deploy Lambda function
./scripts/deploy-production.sh

# Step 3: Diagnose deployment
./scripts/diagnose-deployment.sh

# Step 4: Test API
./scripts/test-api.sh
```

### 3. Fix DNS Resolution Issues

```bash
# Step 1: Troubleshoot DNS
./scripts/fix-opensearch-dns.sh

# Step 2: Create Route 53 private zone (if needed)
./scripts/create-route53-private-zone.sh

# Step 3: Reset Lambda VPC
./scripts/reset-lambda-vpc.sh

# Step 4: Verify connection
./scripts/verify-vpc-endpoint.sh
```

### 4. Configure OpenSearch Access

```bash
# Step 1: View configuration guide
./scripts/configure-opensearch-access.sh

# Step 2: Follow manual steps in OpenSearch Dashboards
# (See OPENSEARCH_ACCESS_CONFIGURATION_GUIDE.md)

# Step 3: Test API
./scripts/test-api.sh
```

### 5. Verify Everything

```bash
# Complete verification
./scripts/verify-vpc-endpoint.sh

# Or run individual tests
./scripts/test-api.sh
```

## Environment Variables

Most scripts use these default values:

```bash
REGION="ap-northeast-1"
VPC_ID="vpc-02d08f2fa75078e67"
LAMBDA_FUNCTION="cis-search-api-prod"
OPENSEARCH_DOMAIN="cis-filesearch-opensearch"
OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
API_ENDPOINT="https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search"
```

## Troubleshooting

### API Gateway 500 Errors (NEW) 🚨

If you see `API Gateway error: 500`:

1. Run quick diagnostic: `./scripts/quick-test.sh`
2. If Lambda works but API Gateway fails:
   - Check integration: `./scripts/check-api-gateway-integration.sh`
   - Verify Lambda permissions for API Gateway
   - Check API Gateway deployment status
3. If Lambda fails:
   - Run full diagnostic: `./scripts/diagnose-api-gateway-500.sh`
   - Check CloudWatch logs
   - Verify OpenSearch connectivity
   - Check environment variables
4. If specific queries fail:
   - Test query variations: `./scripts/test-specific-query.sh`
   - Check query parameter handling
   - Verify searchType parameter
5. Review comprehensive guide: `cat ../DIAGNOSTIC_GUIDE.md`

**Common Causes:**
- Lambda timeout (increase from 3s to 30s)
- Missing Lambda permissions for API Gateway
- Integration type not set to AWS_PROXY
- OpenSearch connection issues
- IAM authentication failures

### DNS Resolution Errors

If you see `getaddrinfo ENOTFOUND` errors:

1. Run `./scripts/fix-opensearch-dns.sh`
2. Check if Route 53 private zone exists
3. Reset Lambda VPC: `./scripts/reset-lambda-vpc.sh`
4. Wait 5-10 minutes for DNS propagation
5. Verify: `./scripts/verify-vpc-endpoint.sh`

### Permission Errors

If you see `security_exception: no permissions` errors:

1. Run `./scripts/configure-opensearch-access.sh`
2. Follow the manual steps to configure FGAC
3. Test: `./scripts/test-api.sh`

### Connection Timeouts

If connections timeout:

1. Check security group allows outbound HTTPS (port 443)
2. Verify OpenSearch domain is "Active"
3. Check NAT Gateway status
4. Verify Lambda is in correct subnets

## Additional Documentation

### Diagnostic & Troubleshooting (NEW)
- **DIAGNOSTIC_GUIDE.md**: Comprehensive 500 error diagnostic guide
- Scripts for testing and diagnosing API Gateway issues

### OpenSearch & VPC
- **VPC_ENDPOINT_SOLUTION_SUMMARY.md**: Complete summary of VPC endpoint work
- **OPENSEARCH_DNS_RESOLUTION_SUMMARY.md**: DNS resolution issue analysis
- **OPENSEARCH_ACCESS_CONFIGURATION_GUIDE.md**: FGAC configuration guide

### Deployment
- **DEPLOYMENT_SUMMARY.md**: Deployment status and next steps

## Support

For issues or questions:

1. Check CloudWatch Logs:
   ```bash
   aws logs tail /aws/lambda/cis-search-api-prod --region ap-northeast-1 --follow
   ```

2. Review documentation in parent directory

3. Run diagnostic scripts:
   ```bash
   ./scripts/diagnose-deployment.sh
   ./scripts/verify-vpc-endpoint.sh
   ```
