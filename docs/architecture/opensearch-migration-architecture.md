# OpenSearch Migration Architecture - Enterprise Design

## アーキテクチャ原則

### 1. ネットワーク境界の明確化

```
┌─────────────────────────────────────────────────────────────────┐
│                        Development Layer                        │
│  ┌──────────────┐      ┌──────────────┐                         │
│  │  Local Dev   │      │   Testing    │                         │
│  │  Machine     │      │   Scripts    │                         │
│  └──────────────┘      └──────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
                            ▼ VPN/SSM
┌─────────────────────────────────────────────────────────────────┐
│                      Execution Layer (VPC)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  EC2 Bastion │  │  Lambda VPC  │  │  CodeBuild   │          │
│  │  (SSM)       │  │  Function    │  │  VPC Project │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                  │                  │
│         └─────────────────┴──────────────────┘                  │
│                           ▼                                     │
│  ┌────────────────────────────────────────────────────┐         │
│  │         OpenSearch VPC Endpoint                    │         │
│  │         (Private Subnet)                           │         │
│  └────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 実行環境の分類と責務

| 実行環境 | 用途 | OpenSearch アクセス | マイグレーション実行 |
|---------|------|-------------------|------------------|
| **Local Machine** | 開発・テスト | ❌ 不可 | ❌ 不可 |
| **EC2 Bastion** | 運用管理・マイグレーション | ✅ 可能 | ✅ 推奨 |
| **Lambda (VPC)** | 自動化マイグレーション | ✅ 可能 | ✅ 推奨 |
| **CodeBuild (VPC)** | CI/CD パイプライン | ✅ 可能 | ✅ 推奨 |

---

## 推奨アーキテクチャパターン

### パターン 1: EC2 Bastion を使用した手動マイグレーション

**メリット:**
- シンプルで理解しやすい
- デバッグが容易
- 手動での制御が可能

**デメリット:**
- EC2 インスタンスの管理が必要
- 手動操作が必要

**実装手順:**

```bash
# 1. SSM Session Manager でEC2に接続
aws ssm start-session --target i-xxxxxxxxx

# 2. EC2上でリポジトリをクローン
git clone https://github.com/your-org/cis-filesearch-app.git
cd cis-filesearch-app/backend/lambda-search-api

# 3. 環境変数を設定
export OPENSEARCH_ENDPOINT=https://vpc-xxx.ap-northeast-1.es.amazonaws.com
export OPENSEARCH_INDEX=file-index
export OPENSEARCH_NEW_INDEX=file-index-v2
export AWS_REGION=ap-northeast-1

# 4. マイグレーション実行
npm install
npm run migrate:opensearch -- --execute
```

### パターン 2: Lambda 関数を使用した自動マイグレーション

**メリット:**
- サーバーレス (インフラ管理不要)
- 自動実行が可能
- CloudWatch Logs で監視

**デメリット:**
- 15分のタイムアウト制限
- 複雑なデバッグ

**実装構成:**

```typescript
// Lambda Function (VPC内で実行)
export const handler = async (event: any) => {
  const migration = new BlueGreenMigration(
    createOpenSearchClient(),
    process.env.CURRENT_INDEX!,
    process.env.NEW_INDEX!,
    process.env.ALIAS!
  );

  return await migration.executeMigration();
};
```

### パターン 3: AWS Step Functions を使用した段階的マイグレーション

**メリット:**
- 長時間実行が可能 (1年まで)
- 視覚的なワークフロー管理
- エラーハンドリングの柔軟性
- 各ステップの独立した監視

**推奨: エンタープライズグレード**

```json
{
  "Comment": "OpenSearch Migration Workflow",
  "StartAt": "ValidateCurrentState",
  "States": {
    "ValidateCurrentState": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:migration-validate",
      "Next": "CreateGreenIndex",
      "Catch": [{
        "ErrorEquals": ["States.ALL"],
        "Next": "MigrationFailed"
      }]
    },
    "CreateGreenIndex": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:migration-create-green",
      "Next": "ReindexData"
    },
    "ReindexData": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:migration-reindex",
      "TimeoutSeconds": 3600,
      "Next": "ValidateGreenIndex"
    },
    "ValidateGreenIndex": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:migration-validate-green",
      "Next": "SwitchAlias"
    },
    "SwitchAlias": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:migration-switch-alias",
      "Next": "MonitorPostSwitch"
    },
    "MonitorPostSwitch": {
      "Type": "Wait",
      "Seconds": 300,
      "Next": "MigrationComplete"
    },
    "MigrationComplete": {
      "Type": "Succeed"
    },
    "MigrationFailed": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:migration-rollback",
      "End": true
    }
  }
}
```

---

## 設定管理のベストプラクティス

### 1. AWS Systems Manager Parameter Store を使用

```typescript
// ✅ Good: 一元管理された設定
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export async function getOpenSearchConfig() {
  const ssm = new SSMClient({ region: 'ap-northeast-1' });

  const params = await Promise.all([
    ssm.send(new GetParameterCommand({
      Name: '/cis-filesearch/opensearch/endpoint'
    })),
    ssm.send(new GetParameterCommand({
      Name: '/cis-filesearch/opensearch/index-name'
    })),
  ]);

  return {
    endpoint: params[0].Parameter!.Value!,
    indexName: params[1].Parameter!.Value!,
  };
}
```

### 2. 設定の優先順位

```
1. AWS Parameter Store (最優先)
   ↓
2. 環境変数
   ↓
3. .env ファイル
   ↓
4. デフォルト値 (最後の手段)
```

### 3. 設定検証スキーマ

```typescript
import { z } from 'zod';

const OpenSearchConfigSchema = z.object({
  endpoint: z.string()
    .url()
    .refine(url => url.includes('vpc-'), {
      message: 'OpenSearch endpoint must be a VPC endpoint'
    }),
  indexName: z.string()
    .regex(/^[a-z0-9-]+$/, 'Index name must be lowercase with hyphens'),
  region: z.string().default('ap-northeast-1'),
});

export type OpenSearchConfig = z.infer<typeof OpenSearchConfigSchema>;

export function validateConfig(config: unknown): OpenSearchConfig {
  return OpenSearchConfigSchema.parse(config);
}
```

---

## Infrastructure as Code (Terraform)

### 1. OpenSearch ドメイン定義

```hcl
# terraform/opensearch.tf
resource "aws_opensearch_domain" "main" {
  domain_name    = "cis-filesearch-opensearch"
  engine_version = "OpenSearch_2.11"

  cluster_config {
    instance_type            = "r6g.large.search"
    instance_count           = 2
    zone_awareness_enabled   = true
    dedicated_master_enabled = false
  }

  vpc_options {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_c.id]
    security_group_ids = [aws_security_group.opensearch.id]
  }

  ebs_options {
    ebs_enabled = true
    volume_size = 100
    volume_type = "gp3"
    iops        = 3000
    throughput  = 125
  }

  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = false
    master_user_options {
      master_user_arn = aws_iam_role.opensearch_admin.arn
    }
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  tags = {
    Environment = "production"
    Project     = "cis-filesearch"
  }
}
```

### 2. マイグレーション用 Lambda (VPC配置)

```hcl
# terraform/migration-lambda.tf
resource "aws_lambda_function" "migration" {
  filename         = "migration-lambda.zip"
  function_name    = "opensearch-migration"
  role             = aws_iam_role.migration_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 900  # 15分
  memory_size      = 2048

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_c.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      OPENSEARCH_ENDPOINT = aws_opensearch_domain.main.endpoint
      AWS_REGION          = "ap-northeast-1"
    }
  }

  tags = {
    Purpose = "OpenSearch Migration"
  }
}
```

### 3. EC2 Bastion (マイグレーション実行環境)

```hcl
# terraform/bastion.tf
resource "aws_instance" "bastion" {
  ami           = data.aws_ami.amazon_linux_2.id
  instance_type = "t3.medium"
  subnet_id     = aws_subnet.private_a.id

  vpc_security_group_ids = [aws_security_group.bastion.id]
  iam_instance_profile   = aws_iam_instance_profile.bastion.name

  user_data = <<-EOF
    #!/bin/bash
    yum update -y
    yum install -y git nodejs npm

    # Install AWS CLI v2
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip awscliv2.zip
    ./aws/install

    # Clone repository
    git clone https://github.com/your-org/cis-filesearch-app.git /opt/cis-app
    cd /opt/cis-app/backend/lambda-search-api
    npm install
  EOF

  tags = {
    Name    = "opensearch-migration-bastion"
    Purpose = "Migration Execution Environment"
  }
}
```

---

## テスト戦略

### 1. マイグレーション前の検証

```typescript
// tests/migration/pre-migration.test.ts
import { validateMigrationPreconditions } from '../src/migration-utils';

describe('Migration Preconditions', () => {
  test('should validate VPC access', async () => {
    const result = await validateMigrationPreconditions();
    expect(result.vpcAccess).toBe(true);
  });

  test('should validate configuration consistency', async () => {
    const config = await loadOpenSearchConfig();
    expect(config.endpoint).toContain('vpc-');
    expect(config.indexName).toMatch(/^[a-z0-9-]+$/);
  });

  test('should verify current index exists', async () => {
    const client = await getOpenSearchClient();
    const exists = await client.indices.exists({
      index: config.currentIndex
    });
    expect(exists.body).toBe(true);
  });
});
```

### 2. ドライラン実行

```bash
# ドライランモードで実行 (変更なし)
npm run migrate:opensearch -- --dry-run

# 実行前のチェックリスト出力
✅ VPC access: OK
✅ Index exists: file-index (10,000 docs)
✅ Backup created: snapshot-2025-12-18
✅ New index name: file-index-v2-2025-12-18
⚠️  Estimated duration: 15 minutes
```

### 3. 段階的テスト

```typescript
// tests/migration/integration.test.ts
describe('Blue-Green Migration', () => {
  let migration: BlueGreenMigration;

  beforeAll(async () => {
    // テスト用の小規模インデックスを作成
    await createTestIndex('test-blue', 100);
  });

  test('Phase 1: Validate current state', async () => {
    await expect(migration.validateCurrentState()).resolves.not.toThrow();
  });

  test('Phase 2: Create green index', async () => {
    await migration.createGreenIndex();
    const exists = await client.indices.exists({ index: 'test-green' });
    expect(exists.body).toBe(true);
  });

  test('Phase 3: Reindex data', async () => {
    await migration.reindexData();
    const count = await client.count({ index: 'test-green' });
    expect(count.body.count).toBe(100);
  });

  test('Phase 4: Validate green index', async () => {
    await expect(migration.validateGreenIndex()).resolves.not.toThrow();
  });

  test('Phase 5: Switch alias', async () => {
    await migration.switchAlias();
    const aliases = await client.indices.getAlias({ name: 'test-alias' });
    expect(aliases.body['test-green']).toBeDefined();
  });

  afterAll(async () => {
    await cleanupTestIndices();
  });
});
```

---

## モニタリングとアラート

### 1. CloudWatch メトリクス

```typescript
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

export async function trackMigrationProgress(progress: MigrationProgress) {
  const cloudwatch = new CloudWatchClient({ region: 'ap-northeast-1' });

  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: 'CISFileSearch/Migration',
    MetricData: [
      {
        MetricName: 'DocumentsProcessed',
        Value: progress.processedDocuments,
        Unit: 'Count',
      },
      {
        MetricName: 'ProcessingRate',
        Value: progress.currentRate,
        Unit: 'Count/Second',
      },
      {
        MetricName: 'FailedDocuments',
        Value: progress.failedDocuments,
        Unit: 'Count',
      },
    ],
  }));
}
```

### 2. SNS 通知

```typescript
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

export async function notifyMigrationStatus(
  status: 'STARTED' | 'COMPLETED' | 'FAILED',
  details: any
) {
  const sns = new SNSClient({ region: 'ap-northeast-1' });

  const message = {
    status,
    timestamp: new Date().toISOString(),
    details,
  };

  await sns.send(new PublishCommand({
    TopicArn: 'arn:aws:sns:ap-northeast-1:ACCOUNT:opensearch-migration-alerts',
    Subject: `OpenSearch Migration: ${status}`,
    Message: JSON.stringify(message, null, 2),
  }));
}
```

---

## ロールバック戦略

### 1. 自動ロールバック条件

```typescript
export class AutoRollbackDetector {
  private readonly thresholds = {
    errorRate: 0.05,        // 5% error rate
    latencyP99: 2000,       // 2秒
    documentCountDiff: 0.01, // 1% difference
  };

  async shouldRollback(
    greenIndex: string,
    blueIndex: string
  ): Promise<boolean> {
    const metrics = await this.collectMetrics(greenIndex);

    return (
      metrics.errorRate > this.thresholds.errorRate ||
      metrics.latencyP99 > this.thresholds.latencyP99 ||
      metrics.documentCountDiff > this.thresholds.documentCountDiff
    );
  }
}
```

### 2. 手動ロールバック手順

```bash
# 緊急ロールバックスクリプト
#!/bin/bash
set -e

BLUE_INDEX="file-index"
GREEN_INDEX="file-index-v2"
ALIAS="file-index"

echo "🚨 Rolling back to blue index: $BLUE_INDEX"

# エイリアスを青に戻す
aws opensearch update-alias \
  --domain-name cis-filesearch-opensearch \
  --actions '
    [
      {"remove": {"index": "'$GREEN_INDEX'", "alias": "'$ALIAS'"}},
      {"add": {"index": "'$BLUE_INDEX'", "alias": "'$ALIAS'"}}
    ]
  '

echo "✅ Rollback completed"
echo "📊 Verifying alias configuration..."
aws opensearch get-alias --domain-name cis-filesearch-opensearch --alias $ALIAS
```

---

## まとめ: 次のステップ

### 即座に実施すべき対策

1. **EC2 Bastion 経由でのマイグレーション実行** (推奨)
   ```bash
   aws ssm start-session --target <INSTANCE_ID>
   ```

2. **設定の一元管理**
   - AWS Parameter Store への移行
   - 設定検証スキーマの実装

3. **ドライランの実行**
   ```bash
   npm run migrate:opensearch -- --dry-run
   ```

### 中長期的な改善

1. **Infrastructure as Code**
   - Terraform でのリソース管理
   - マイグレーションスクリプトの自動デプロイ

2. **自動化パイプライン**
   - AWS Step Functions による段階的マイグレーション
   - CloudWatch による監視とアラート

3. **継続的なテスト**
   - 統合テストの自動実行
   - カナリアデプロイメント
