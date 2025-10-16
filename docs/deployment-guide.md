# CIS ファイル検索システム デプロイメントガイド

## 1. デプロイメント概要

### 1.1 環境構成

| 環境 | 用途 | URL |
|------|------|-----|
| Development | 開発環境 | https://dev.cis-filesearch.com |
| Staging | ステージング環境 | https://staging.cis-filesearch.com |
| Production | 本番環境 | https://cis-filesearch.com |

## 2. AWS インフラストラクチャ

### 2.1 VPC設定 (Terraform)

```hcl
# terraform/network.tf
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"

  name = "cis-filesearch-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["ap-northeast-1a", "ap-northeast-1c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]

  enable_nat_gateway = true
  enable_dns_hostnames = true
}
```

### 2.2 ECS/Fargate設定

```hcl
# terraform/ecs.tf
resource "aws_ecs_cluster" "main" {
  name = "cis-filesearch-cluster"
}

resource "aws_ecs_task_definition" "app" {
  family                   = "cis-filesearch-app"
  network_mode            = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                     = "1024"
  memory                  = "2048"

  container_definitions = jsonencode([{
    name  = "app"
    image = "${aws_ecr_repository.app.repository_url}:latest"
    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" }
    ]
  }])
}
```

### 2.3 RDS設定

```hcl
# terraform/rds.tf
resource "aws_db_instance" "postgres" {
  identifier     = "cis-filesearch-db"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.t3.medium"

  allocated_storage = 100
  storage_encrypted = true

  backup_retention_period = 30
  deletion_protection     = true
}
```

## 3. CI/CDパイプライン

### 3.1 GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to AWS

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-northeast-1

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1

      - name: Build and push Docker image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/cis-filesearch:$IMAGE_TAG .
          docker push $ECR_REGISTRY/cis-filesearch:$IMAGE_TAG

      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster cis-prod-cluster \
            --service cis-prod-app \
            --force-new-deployment
```

## 4. Dockerコンテナ

### 4.1 Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/package.json ./
RUN yarn install --production
USER nextjs
EXPOSE 3000
CMD ["yarn", "start"]
```

## 5. デプロイメント手順

### 5.1 初回デプロイメント

```bash
# 1. Terraformでインフラ構築
cd terraform
terraform init
terraform apply -var-file="production.tfvars"

# 2. データベースマイグレーション
yarn db:migrate:prod

# 3. シークレット設定
aws secretsmanager create-secret \
  --name cis-prod-secrets \
  --secret-string file://secrets.json

# 4. 初回デプロイ
./scripts/deploy.sh production
```

### 5.2 更新デプロイメント

```bash
#!/bin/bash
# scripts/deploy.sh

ENVIRONMENT=$1
VERSION=${2:-latest}

# ビルドとプッシュ
docker build -t cis-filesearch:$VERSION .
docker tag cis-filesearch:$VERSION $ECR_REGISTRY:$VERSION
docker push $ECR_REGISTRY:$VERSION

# ECSサービス更新
aws ecs update-service \
  --cluster cis-$ENVIRONMENT-cluster \
  --service cis-$ENVIRONMENT-app \
  --force-new-deployment

# デプロイ完了待機
aws ecs wait services-stable \
  --cluster cis-$ENVIRONMENT-cluster \
  --services cis-$ENVIRONMENT-app
```

## 6. 監視とロギング

### 6.1 CloudWatch設定

```typescript
// CloudWatch アラーム設定
const alarms = [
  {
    AlarmName: "CIS-HighErrorRate",
    MetricName: "4XXError",
    Threshold: 0.1,
    ComparisonOperator: "GreaterThanThreshold",
  },
  {
    AlarmName: "CIS-HighLatency",
    MetricName: "Latency",
    Threshold: 10000,
    ComparisonOperator: "GreaterThanThreshold",
  }
];
```

### 6.2 ログ収集

```yaml
# CloudWatch Logs設定
logConfiguration:
  logDriver: awslogs
  options:
    awslogs-group: /ecs/cis-filesearch
    awslogs-region: ap-northeast-1
    awslogs-stream-prefix: app
```

## 7. ロールバック手順

### 7.1 手動ロールバック

```bash
#!/bin/bash
# scripts/rollback.sh

ENVIRONMENT=$1
PREVIOUS_VERSION=$2

# 以前のバージョンにロールバック
aws ecs update-service \
  --cluster cis-$ENVIRONMENT-cluster \
  --service cis-$ENVIRONMENT-app \
  --task-definition cis-$ENVIRONMENT-app:$PREVIOUS_VERSION

aws ecs wait services-stable \
  --cluster cis-$ENVIRONMENT-cluster \
  --services cis-$ENVIRONMENT-app

echo "Rollback completed to version $PREVIOUS_VERSION"
```

## 8. ヘルスチェック

```typescript
// src/api/health.ts
export const healthCheck = async (req, res) => {
  const checks = {
    app: "healthy",
    database: "unknown",
    redis: "unknown",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "healthy";
  } catch {
    checks.database = "unhealthy";
  }

  const isHealthy = Object.values(checks)
    .every(s => s === "healthy");

  res.status(isHealthy ? 200 : 503).json(checks);
};
```

## 9. 災害復旧

### 9.1 バックアップ

```bash
# RDSスナップショット作成
aws rds create-db-snapshot \
  --db-instance-identifier cis-prod-db \
  --db-snapshot-identifier cis-prod-db-$(date +%Y%m%d)

# S3バックアップ
aws s3 sync s3://cis-prod-bucket s3://cis-backup-bucket/$(date +%Y%m%d)/
```

### 9.2 復旧手順

```bash
# RDS復元
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier cis-prod-db-restored \
  --db-snapshot-identifier cis-prod-db-20250115
```

## 10. セキュリティ設定

### 10.1 IAMロール

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage"
    ],
    "Resource": "*"
  }]
}
```

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-15 | 初版作成 | CIS開発チーム |