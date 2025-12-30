# VPC内Lambda → OpenSearch接続問題 完全分析レポート

## Executive Summary

VPC内のLambda関数からOpenSearchドメインへのDNS解決が失敗している根本原因を特定しました。

**重大な発見**: Lambda環境変数に設定されたOpenSearchエンドポイントURLにスペルミスがあります。

- **設定値**: `vpc-cis-filesearch-opensearch-xuup**cgp**tq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com`
- **正解**: `vpc-cis-filesearch-opensearch-xuup**cp**gtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com`

## 1. アーキテクチャ評価

### 現在の構成

```
Internet
   ↓
API Gateway (Regional)
   ↓
Lambda (VPC Private Subnet)
   ↓
OpenSearch (VPC内デプロイ)
```

### ベストプラクティス評価: ✅ 正しいアプローチ

この構成は**AWS推奨のベストプラクティス**に完全に準拠しています。

#### 正当性の根拠

1. **セキュリティ**: OpenSearchをVPC内に配置することで、外部からの直接アクセスを遮断
2. **コンプライアンス**: データがVPC内に留まり、インターネットに露出しない
3. **パフォーマンス**: Lambda-OpenSearch間の低レイテンシ通信
4. **コスト効率**: NAT Gatewayを経由せず、VPC内通信のみで完結

#### アーキテクチャの妥当性

| 項目 | 評価 | 備考 |
|------|------|------|
| セキュリティ | ⭐⭐⭐⭐⭐ | VPC内完結、外部露出なし |
| スケーラビリティ | ⭐⭐⭐⭐ | Lambda自動スケーリング対応 |
| 可用性 | ⭐⭐⭐⭐ | Multi-AZ配置可能 |
| コスト | ⭐⭐⭐⭐ | VPC Endpoint不要 |
| 運用性 | ⭐⭐⭐ | VPC設定の理解が必要 |

**結論**: このアーキテクチャは変更不要です。

## 2. 根本原因分析

### 2.1 DNS解決失敗の原因

#### VPC DNS設定の状態

```json
{
  "EnableDnsSupport": true,
  "EnableDnsHostnames": true,
  "VpcId": "vpc-02d08f2fa75078e67"
}
```

**✅ VPC DNS設定は正常**: 両方の設定が有効化されており、問題ありません。

#### OpenSearch VPC構成

```json
{
  "Endpoints": {
    "vpc": "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
  },
  "VPCOptions": {
    "VPCId": "vpc-02d08f2fa75078e67",
    "SubnetIds": ["subnet-0ea0487400a0b3627"],
    "AvailabilityZones": ["ap-northeast-1a"],
    "SecurityGroupIds": ["sg-0c482a057b356a0c3"]
  }
}
```

**✅ OpenSearch VPC配置は正常**: VPCエンドポイントが正しく生成されています。

#### Lambda環境変数の設定

```json
{
  "OPENSEARCH_ENDPOINT": "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com",
  "OPENSEARCH_USE_IP_DIRECT": "true",
  "OPENSEARCH_IP": "10.0.10.145"
}
```

**❌ 問題発見**: エンドポイントURLのスペルミス

### 2.2 スペルミスの詳細比較

```diff
正解: vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe
                                           ↑↑
設定: vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe
                                           ↑↑
                                           cgp (誤)
                                           cpg (正)
```

この1文字のスペルミスにより、DNS解決が以下のエラーで失敗します:

```
getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
```

### 2.3 ネットワーク構成の検証

#### Lambda VPC配置

```json
{
  "SubnetIds": [
    "subnet-0ea0487400a0b3627",  // 10.0.10.0/24 (ap-northeast-1a)
    "subnet-01edf92f9d1500875",  // 10.0.11.0/24 (ap-northeast-1c)
    "subnet-0ce8ff9ce4bc429bf"   // 10.0.12.0/24 (ap-northeast-1d)
  ],
  "SecurityGroupIds": [
    "sg-06ee622d64e67f12f",  // Lambda SG
    "sg-0c482a057b356a0c3"   // OpenSearch SG
  ]
}
```

**✅ Multi-AZ配置**: 可用性が高い構成です。

#### セキュリティグループ検証

**OpenSearch SG (sg-0c482a057b356a0c3)**:

```json
{
  "IpPermissions": [
    {
      "IpProtocol": "tcp",
      "FromPort": 443,
      "ToPort": 443,
      "UserIdGroupPairs": [
        {
          "Description": "Allow HTTPS from Lambda Search API",
          "GroupId": "sg-06ee622d64e67f12f"
        }
      ]
    }
  ]
}
```

**✅ セキュリティグループルールは正常**: Lambda SGからOpenSearch SGへのHTTPS (443) 通信が許可されています。

## 3. なぜIP直接接続でも失敗するのか

現在の実装では、環境変数 `OPENSEARCH_USE_IP_DIRECT=true` とIPアドレス `10.0.10.145` を使用していますが、これでも接続が失敗します。

### 理由: AWS Signature V4認証のHost Header問題

```typescript
// opensearch.service.ts (Line 88)
headers: {
  'Host': 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com',
}
```

**問題点**:

1. IPアドレスで接続しても、AWS Sigv4認証のために**正しいホスト名**をHostヘッダーに含める必要がある
2. Hostヘッダーに**誤ったホスト名**（スペルミス）が設定されている
3. AWS Sigv4署名検証で署名ミスマッチが発生

## 4. 解決策

### Solution 1: 環境変数の修正（推奨）

最もシンプルで確実な解決策です。

#### Step 1: Lambda環境変数を更新

```bash
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --region ap-northeast-1 \
  --environment Variables='{
    "OPENSEARCH_ENDPOINT": "https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com",
    "OPENSEARCH_INDEX": "file-index",
    "NODE_ENV": "production",
    "DEBUG": "false"
  }'
```

**重要**: `OPENSEARCH_USE_IP_DIRECT` と `OPENSEARCH_IP` を削除します（不要）。

#### Step 2: Terraform変数ファイルを修正

Terraformで管理している場合、正しいエンドポイントを取得するように修正:

```hcl
# terraform/lambda_search_api.tf (Line 132)
environment {
  variables = {
    OPENSEARCH_ENDPOINT = "https://${aws_opensearch_domain.main.endpoint}"
    OPENSEARCH_INDEX    = "file-index"
    AWS_REGION          = var.aws_region
    LOG_LEVEL           = "info"
    NODE_ENV            = var.environment
    FRONTEND_DOMAIN     = "https://${var.frontend_domain}"
  }
}
```

**注意**: `aws_opensearch_domain.main.endpoint` は自動的に正しいVPCエンドポイントを返します。

#### Step 3: ソースコードの簡素化

IP直接接続の複雑な処理を削除:

```typescript
// src/services/opensearch.service.ts
export async function getOpenSearchClient(): Promise<Client> {
  if (opensearchClient) {
    logger.debug('Reusing existing OpenSearch client');
    return opensearchClient;
  }

  const config = getOpenSearchConfig();
  logger.info('Initializing OpenSearch client', {
    endpoint: config.endpoint,
    region: config.region,
  });

  try {
    const clientConfig = {
      ...AwsSigv4Signer({
        region: config.region,
        service: 'es',
        getCredentials: () => {
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        },
      }),
      node: config.endpoint,
      requestTimeout: 30000,
      maxRetries: 3,
      compression: 'gzip',
    };

    opensearchClient = new Client(clientConfig);

    // 接続テスト
    await opensearchClient.ping();
    logger.info('OpenSearch client initialized successfully');

    return opensearchClient;
  } catch (error: any) {
    logger.error('Failed to initialize OpenSearch client', {
      error: error.message,
    });
    throw new OpenSearchUnavailableError('Failed to connect to OpenSearch');
  }
}
```

### Solution 2: Terraform再デプロイ（最も確実）

もしTerraformで管理している場合、以下の手順で完全に再構築:

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/terraform

# OpenSearchエンドポイントを取得
OPENSEARCH_ENDPOINT=$(aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch \
  --region ap-northeast-1 \
  --query 'DomainStatus.Endpoints.vpc' \
  --output text)

echo "Correct OpenSearch Endpoint: https://${OPENSEARCH_ENDPOINT}"

# Terraformで再適用
terraform plan -var="opensearch_endpoint=https://${OPENSEARCH_ENDPOINT}"
terraform apply -var="opensearch_endpoint=https://${OPENSEARCH_ENDPOINT}"
```

### Solution 3: VPCエンドポイントの利用（過剰最適化、不要）

**注意**: この解決策は現在の問題には**不要**です。

VPC内のOpenSearchは既にプライベートIPアドレスでアクセス可能なため、追加のVPCエンドポイントは必要ありません。

## 5. 検証手順

### Step 1: 正しいエンドポイントの確認

```bash
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch \
  --region ap-northeast-1 \
  --query 'DomainStatus.Endpoints.vpc' \
  --output text
```

**期待される出力**:

```
vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
```

### Step 2: DNS解決テスト

Lambda実行環境内でDNS解決をテスト（EC2インスタンスを同じVPCに起動して確認）:

```bash
# VPC内のEC2インスタンスから実行
nslookup vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com

# 期待される出力
Server:         10.0.0.2
Address:        10.0.0.2#53

Name:   vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
Address: 10.0.10.XXX
```

### Step 3: Lambda関数の接続テスト

環境変数更新後、Lambda関数をテスト実行:

```bash
aws lambda invoke \
  --function-name cis-search-api-prod \
  --region ap-northeast-1 \
  --payload '{"httpMethod":"GET","path":"/search","queryStringParameters":{"q":"test"}}' \
  /tmp/response.json

cat /tmp/response.json | jq
```

### Step 4: CloudWatch Logsの確認

```bash
aws logs tail /aws/lambda/cis-search-api-prod \
  --region ap-northeast-1 \
  --follow
```

成功時のログ:

```
2025-12-17T12:00:00.000Z INFO OpenSearch client initialized successfully
2025-12-17T12:00:00.000Z INFO Search query completed {"took":120,"hits":{"value":42}}
```

## 6. 予防策と推奨事項

### 6.1 Infrastructure as Code (IaC) の徹底

**問題**: 手動でLambda環境変数を設定するとタイプミスが発生しやすい

**解決策**:

```hcl
# terraform/lambda_search_api.tf
resource "aws_lambda_function" "search_api_prod" {
  # ...

  environment {
    variables = {
      # Terraformのリソース参照を使用（手動入力を排除）
      OPENSEARCH_ENDPOINT = "https://${aws_opensearch_domain.main.endpoint}"
      OPENSEARCH_INDEX    = var.opensearch_index_name
      AWS_REGION          = data.aws_region.current.name
      LOG_LEVEL           = var.log_level
      NODE_ENV            = var.environment
    }
  }

  depends_on = [aws_opensearch_domain.main]
}
```

### 6.2 統合テストの自動化

Lambda deploymentパイプラインにヘルスチェックを追加:

```typescript
// tests/integration/opensearch-connectivity.test.ts
describe('OpenSearch Connectivity', () => {
  it('should resolve OpenSearch VPC endpoint', async () => {
    const endpoint = process.env.OPENSEARCH_ENDPOINT;
    const hostname = new URL(endpoint).hostname;

    // DNS解決テスト
    await expect(dns.promises.lookup(hostname)).resolves.toBeDefined();
  });

  it('should connect to OpenSearch cluster', async () => {
    const client = await getOpenSearchClient();
    const health = await client.cluster.health();

    expect(health.body.status).toMatch(/green|yellow/);
  });
});
```

### 6.3 モニタリングとアラート

CloudWatch Alarmを追加して接続エラーを早期検出:

```hcl
resource "aws_cloudwatch_metric_alarm" "search_api_connection_errors" {
  alarm_name          = "cis-search-api-opensearch-connection-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  alarm_description   = "OpenSearch connection errors detected"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.search_api_prod.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}
```

### 6.4 VPC設計のベストプラクティス

現在の構成は良好ですが、さらなる改善案:

#### Multi-AZ OpenSearch配置

```hcl
resource "aws_opensearch_domain" "main" {
  # ...

  vpc_options {
    subnet_ids = [
      aws_subnet.private[0].id,  # AZ-a
      aws_subnet.private[1].id,  # AZ-c
      aws_subnet.private[2].id,  # AZ-d (現在は1つのサブネットのみ)
    ]
    security_group_ids = [aws_security_group.opensearch.id]
  }

  cluster_config {
    instance_count         = 3  # Multi-AZ対応
    zone_awareness_enabled = true
    zone_awareness_config {
      availability_zone_count = 3
    }
  }
}
```

#### VPCフローログの有効化（トラブルシューティング用）

```hcl
resource "aws_flow_log" "vpc_flow_log" {
  vpc_id          = aws_vpc.main.id
  traffic_type    = "ALL"
  iam_role_arn    = aws_iam_role.flow_log.arn
  log_destination = aws_cloudwatch_log_group.vpc_flow_log.arn

  tags = {
    Name = "${var.project_name}-vpc-flow-log"
  }
}
```

## 7. まとめ

### 問題の本質

1. **主原因**: Lambda環境変数のOpenSearchエンドポイントURLにスペルミス（`cgp` → `cpg`）
2. **副次的問題**: IP直接接続の試みも、誤ったHostヘッダーのため失敗

### アーキテクチャの評価

✅ **現在のアーキテクチャは正しい**

- API Gateway → VPC Lambda → VPC OpenSearch の構成は AWS ベストプラクティス
- VPC DNS設定も正常
- セキュリティグループルールも適切

### 即座に実行すべきアクション

1. **緊急対応**: Lambda環境変数の修正（5分で完了）

```bash
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --region ap-northeast-1 \
  --environment Variables='{
    "OPENSEARCH_ENDPOINT": "https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com",
    "OPENSEARCH_INDEX": "file-index",
    "NODE_ENV": "production"
  }'
```

2. **検証**: Lambda関数のテスト実行

```bash
aws lambda invoke \
  --function-name cis-search-api-prod \
  --region ap-northeast-1 \
  --payload '{"httpMethod":"GET","path":"/search","queryStringParameters":{"q":"test"}}' \
  /tmp/response.json
```

3. **長期対策**: Terraform管理への移行と自動テストの導入

### 期待される結果

環境変数修正後、以下のログが表示されるはずです:

```
INFO OpenSearch client initialized successfully
INFO Executing search query
INFO Search query completed {"took":120,"hits":42}
```

## 参考資料

- [AWS OpenSearch Service VPC Support](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/vpc.html)
- [AWS Lambda VPC Networking](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [VPC DNS Resolution](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-dns.html)
- [AWS Signature Version 4](https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html)

---

**作成日**: 2025-12-17
**分析者**: Claude Code (Backend Infrastructure Specialist)
**ステータス**: 即座に対応可能
