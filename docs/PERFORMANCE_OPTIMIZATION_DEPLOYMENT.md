# パフォーマンス最適化 - デプロイメントガイド

## 概要

このガイドでは、CIS File Search Applicationのパフォーマンス最適化を段階的に実装・デプロイする手順を説明します。

## 前提条件

- Node.js 20.x以上
- AWS CLI設定済み
- Terraform v1.5以上
- 本番環境へのアクセス権限

## 最適化の実装順序

### Phase 1: クリティカル最適化 (即時実施推奨)

#### 1.1 Lambda Bundle Size削減

**影響:** Cold Start 40-50%改善、コスト削減

```bash
# 1. 最適化されたwebpack設定に切り替え
cd backend/lambda-search-api

# 既存の設定をバックアップ
cp webpack.config.js webpack.config.js.backup

# 最適化版を使用
cp webpack.config.optimized.js webpack.config.js

# 2. ビルド実行
npm run build

# 3. バンドルサイズ確認
ls -lh dist/index.js
# 期待値: 2-3MB (以前: 10MB)

# 4. オプション: Bundle Analyzerで詳細確認
ANALYZE=true npm run build
open analyze/bundle-report.html
```

**検証:**
```bash
# デプロイ前にローカルテスト
node -e "const handler = require('./dist/index.js').handler; \
  handler({ httpMethod: 'GET', queryStringParameters: { q: 'test', page: '1', limit: '20' } }, {});"
```

**デプロイ:**
```bash
# Lambda関数更新
npm run package
aws lambda update-function-code \
  --function-name cis-search-api \
  --zip-file fileb://lambda-deployment.zip \
  --region ap-northeast-1

# 関数が更新されるまで待機
aws lambda wait function-updated \
  --function-name cis-search-api \
  --region ap-northeast-1

echo "Lambda function updated successfully"
```

---

#### 1.2 Lambda Memory最適化

**影響:** 実行時間 30-40%短縮、Cold Start改善

```bash
# Terraform設定更新
cd terraform

# lambda.tf を編集
```

```hcl
# terraform/lambda.tf
resource "aws_lambda_function" "search_api" {
  function_name = "cis-search-api"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"

  # 最適化: メモリを1024MBに増加
  memory_size = 1024  # 512 → 1024

  # 最適化: タイムアウトを15秒に短縮
  timeout = 15  # 30 → 15

  filename         = "../backend/lambda-search-api/lambda-deployment.zip"
  source_code_hash = filebase64sha256("../backend/lambda-search-api/lambda-deployment.zip")

  environment {
    variables = {
      OPENSEARCH_ENDPOINT = var.opensearch_endpoint
      OPENSEARCH_INDEX    = var.opensearch_index
      AWS_REGION          = var.aws_region
      NODE_ENV            = "production"

      # Node.js最適化オプション
      NODE_OPTIONS = "--max-old-space-size=896 --max-semi-space-size=128"

      # パフォーマンスモニタリング有効化
      ENABLE_PERFORMANCE_MONITORING = "true"
    }
  }

  # VPC設定 (必要に応じて)
  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = [aws_security_group.lambda_sg.id]
  }

  # CloudWatch Logsの保持期間設定
  depends_on = [
    aws_cloudwatch_log_group.lambda_logs
  ]
}

# CloudWatch Logs設定
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/cis-search-api"
  retention_in_days = 7  # 本番環境では30日推奨
}
```

**デプロイ:**
```bash
cd terraform

# 変更内容を確認
terraform plan

# 適用
terraform apply

# 確認
aws lambda get-function-configuration \
  --function-name cis-search-api \
  --query '[MemorySize,Timeout]' \
  --output table
```

**期待出力:**
```
-----------------
|  MemorySize   |
-----------------
|    1024       |
|     15        |
-----------------
```

---

#### 1.3 フロントエンド Bundle Size削減

**影響:** 初期ロード時間 30-40%改善

```bash
cd frontend

# 1. 最適化されたNext.js設定に切り替え
cp next.config.js next.config.js.backup
cp next.config.optimized.js next.config.js

# 2. ビルド実行
yarn build

# 3. バンドルサイズ確認
ls -lh .next/static/chunks/

# 4. オプション: Bundle Analyzer実行
ANALYZE=true yarn build
# analyze/client.html と analyze/server.html が生成される
```

**検証:**
```bash
# ローカルでproductionビルドをテスト
yarn start

# 別のターミナルでLighthouse実行
npx lighthouse http://localhost:3000/search \
  --only-categories=performance \
  --output=html \
  --output-path=./lighthouse-report.html
```

**期待値:**
- Performance Score: > 90
- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Total Blocking Time: < 200ms

**デプロイ:**
```bash
# Vercelデプロイ (該当する場合)
vercel --prod

# または手動デプロイ
yarn build
yarn export  # 静的エクスポートの場合
```

---

### Phase 2: API最適化 (Week 2)

#### 2.1 API Gateway キャッシュ有効化

```bash
cd terraform
```

```hcl
# terraform/api_gateway.tf

# API Gateway Stage with caching
resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.prod.id
  rest_api_id   = aws_api_gateway_rest_api.search_api.id
  stage_name    = "prod"

  # キャッシュ有効化
  cache_cluster_enabled = true
  cache_cluster_size    = "0.5"  # 500MB cache

  # CloudWatch Logs
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      resourcePath   = "$context.resourcePath"
      status         = "$context.status"
      responseLength = "$context.responseLength"
      latency        = "$context.responseLatency"
    })
  }

  # X-Ray tracing
  xray_tracing_enabled = true
}

# Method settings for caching
resource "aws_api_gateway_method_settings" "search" {
  rest_api_id = aws_api_gateway_rest_api.search_api.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  method_path = "*/GET"

  settings {
    # キャッシュ設定
    caching_enabled      = true
    cache_ttl_in_seconds = 300  # 5分
    cache_data_encrypted = true

    # キャッシュキーパラメータ
    cache_key_parameters = [
      "method.request.querystring.q",
      "method.request.querystring.fileType",
      "method.request.querystring.searchMode",
      "method.request.querystring.page",
      "method.request.querystring.limit",
    ]

    # メトリクス有効化
    metrics_enabled = true
    logging_level   = "INFO"

    # スロットリング
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

# CloudWatch Logs for API Gateway
resource "aws_cloudwatch_log_group" "api_gateway_logs" {
  name              = "/aws/apigateway/cis-search-api"
  retention_in_days = 7
}
```

**デプロイ:**
```bash
cd terraform

terraform plan
terraform apply

# キャッシュ動作確認
curl -i https://your-api-id.execute-api.ap-northeast-1.amazonaws.com/prod/search?q=test

# 2回目のリクエストでキャッシュヒット確認
# レスポンスヘッダーに X-Cache: Hit が含まれることを確認
```

---

#### 2.2 OpenSearch Service最適化版デプロイ

```bash
cd backend/lambda-search-api

# 1. 最適化版サービスに切り替え
cp src/services/opensearch.service.ts src/services/opensearch.service.ts.backup
cp src/services/opensearch.service.optimized.ts src/services/opensearch.service.ts

# 2. パフォーマンスモニタリング統合
# src/index.ts を更新
```

```typescript
// src/index.ts
import { APIGatewayProxyResult, Context } from 'aws-lambda';
import { searchDocuments } from './services/opensearch.service';
import { validateSearchQuery } from './utils/validator';
import { handleError, createSuccessResponse } from './utils/error-handler';
import { Logger } from './services/logger.service';
import { withPerformanceTracking, PerformanceMonitor } from './utils/performance-monitor';
import { SearchQuery } from './types';

const logger = new Logger('LambdaHandler');

async function handlerImpl(
  event: any,
  context: Context
): Promise<APIGatewayProxyResult> {
  const monitor = new PerformanceMonitor();

  // メモリ使用量トラッキング開始
  monitor.trackMemoryUsage('request_start');

  const httpMethod = event.httpMethod || event.requestContext?.http?.method || 'UNKNOWN';
  const path = event.path || event.requestContext?.http?.path || event.rawPath || '/';
  const queryParams = event.queryStringParameters || {};

  logger.info('Lambda invoked', {
    requestId: context.awsRequestId,
    httpMethod,
    path,
    eventVersion: event.version || '1.0',
  });

  try {
    if (httpMethod === 'OPTIONS') {
      return handleOptionsRequest();
    }

    if (httpMethod !== 'GET') {
      logger.warn('Method not allowed', { httpMethod, path });
      return createSuccessResponse({
        error: 'Method not allowed',
        code: 'METHOD_NOT_ALLOWED',
      });
    }

    // バリデーション
    const endValidation = monitor.startTimer('validation');
    const searchQuery: SearchQuery = validateSearchQuery(queryParams);
    endValidation();

    logger.info('Search query validated', { searchQuery });

    // OpenSearch検索 (パフォーマンス計測付き)
    const endSearch = monitor.startTimer('opensearch_search');
    const searchResult = await searchDocuments(searchQuery);
    endSearch();

    // 結果数記録
    monitor.recordMetric('search_results_count', searchResult.results.length);

    // ページネーション情報構築
    const endPagination = monitor.startTimer('pagination_build');
    const page = searchQuery.from! / searchQuery.size! + 1;
    const limit = searchQuery.size!;
    const totalPages = Math.ceil(searchResult.total / limit);
    endPagination();

    const responseData = {
      results: searchResult.results,
      pagination: {
        total: searchResult.total,
        page,
        limit,
        totalPages,
      },
      query: {
        q: searchQuery.query,
        searchMode: searchQuery.searchMode,
        fileType: searchQuery.fileType,
        dateFrom: searchQuery.dateFrom,
        dateTo: searchQuery.dateTo,
        sortBy: searchQuery.sortBy,
        sortOrder: searchQuery.sortOrder,
      },
      took: searchResult.took,

      // パフォーマンスメトリクス (開発環境のみ)
      ...(process.env.NODE_ENV === 'development' && {
        performance: monitor.getSummary(),
      }),
    };

    logger.info('Search completed successfully', {
      resultCount: searchResult.results.length,
      total: searchResult.total,
      took: searchResult.took,
    });

    // メモリ使用量トラッキング終了
    monitor.trackMemoryUsage('request_end');

    return createSuccessResponse(responseData);
  } catch (error: any) {
    monitor.recordMetric('errors', 1);
    logger.error('Lambda execution failed', {
      error: error.message,
      stack: error.stack,
    });

    return handleError(error);
  }
}

function handleOptionsRequest(): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '3600',
    },
    body: '',
  };
}

// パフォーマンストラッキング付きでexport
export const handler = withPerformanceTracking(handlerImpl, 'search_api_handler');
```

**ビルド & デプロイ:**
```bash
cd backend/lambda-search-api

# ビルド
npm run build

# デプロイ
npm run package
aws lambda update-function-code \
  --function-name cis-search-api \
  --zip-file fileb://lambda-deployment.zip \
  --region ap-northeast-1
```

---

### Phase 3: 監視とロードテスト

#### 3.1 CloudWatch Dashboard作成

```bash
cd terraform
```

```hcl
# terraform/cloudwatch_dashboard.tf

resource "aws_cloudwatch_dashboard" "search_api_performance" {
  dashboard_name = "CIS-Search-API-Performance"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Lambda", "Duration", { stat = "Average" }],
            ["...", { stat = "p50" }],
            ["...", { stat = "p95" }],
            ["...", { stat = "p99" }],
          ]
          period = 300
          stat   = "Average"
          region = "ap-northeast-1"
          title  = "Lambda Duration"
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Lambda", "ConcurrentExecutions"],
            [".", "Invocations"],
            [".", "Errors"],
            [".", "Throttles"],
          ]
          period = 300
          stat   = "Sum"
          region = "ap-northeast-1"
          title  = "Lambda Invocations"
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["CIS/SearchAPI", "opensearch_search", { stat = "Average" }],
            ["...", { stat = "p95" }],
          ]
          period = 300
          stat   = "Average"
          region = "ap-northeast-1"
          title  = "OpenSearch Query Time"
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ApiGateway", "CacheHitCount"],
            [".", "CacheMissCount"],
          ]
          period = 300
          stat   = "Sum"
          region = "ap-northeast-1"
          title  = "API Gateway Cache Performance"
        }
      },
    ]
  })
}
```

**デプロイ:**
```bash
terraform apply
```

**ダッシュボード確認:**
```bash
# CloudWatch Dashboardを開く
aws cloudwatch get-dashboard \
  --dashboard-name CIS-Search-API-Performance \
  --region ap-northeast-1

# ブラウザで確認
# https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#dashboards:name=CIS-Search-API-Performance
```

---

#### 3.2 ロードテスト実行

```bash
# Artillery インストール
npm install -g artillery

# ロードテストシナリオ作成
cat > load-test.yml <<EOF
config:
  target: "https://your-api-id.execute-api.ap-northeast-1.amazonaws.com/prod"
  phases:
    - duration: 60
      arrivalRate: 5
      name: "Warm up"
    - duration: 300
      arrivalRate: 20
      name: "Sustained load"
    - duration: 120
      arrivalRate: 50
      name: "Spike test"

scenarios:
  - name: "Search API - Various queries"
    flow:
      - get:
          url: "/search"
          qs:
            q: "{{ \$randomString() }}"
            page: "1"
            limit: "20"
          capture:
            - json: "$.took"
              as: "queryTime"
      - think: 2
      - get:
          url: "/search"
          qs:
            q: "test"
            fileType: "pdf"
            page: "{{ \$randomNumber(1, 10) }}"
            limit: "20"
EOF

# ロードテスト実行
artillery run load-test.yml \
  --output load-test-results.json

# レポート生成
artillery report load-test-results.json \
  --output load-test-report.html

# レポート確認
open load-test-report.html
```

**期待値:**
- P50 レスポンス: < 200ms
- P95 レスポンス: < 500ms
- P99 レスポンス: < 1000ms
- エラー率: < 0.1%
- スループット: > 50 req/s

---

## パフォーマンス検証チェックリスト

### Lambda関数

- [ ] Bundle Size: < 3MB
- [ ] Cold Start: < 600ms
- [ ] Warm Start: < 150ms
- [ ] Memory使用率: < 70%
- [ ] エラー率: < 0.1%

### API Gateway

- [ ] キャッシュヒット率: > 60%
- [ ] P95レスポンス: < 500ms
- [ ] スロットリングなし

### フロントエンド

- [ ] First Contentful Paint: < 1.5s
- [ ] Largest Contentful Paint: < 2.5s
- [ ] Total Bundle Size: < 200KB (gzipped)
- [ ] Lighthouse Score: > 90

### OpenSearch

- [ ] クエリ時間 P95: < 200ms
- [ ] インデックスサイズ: 適切
- [ ] シャード健全性: Green

---

## トラブルシューティング

### Lambda Cold Start が遅い

```bash
# 1. Bundle Sizeを確認
ls -lh backend/lambda-search-api/dist/

# 2. webpack設定を確認
grep -A 5 "externals" backend/lambda-search-api/webpack.config.js

# 3. メモリサイズを確認
aws lambda get-function-configuration \
  --function-name cis-search-api \
  --query 'MemorySize'
```

### API Gateway キャッシュが効かない

```bash
# キャッシュ設定確認
aws apigateway get-stage \
  --rest-api-id <API_ID> \
  --stage-name prod \
  --query 'cacheClusterEnabled'

# Method Settingsを確認
aws apigateway get-method-settings \
  --rest-api-id <API_ID> \
  --stage-name prod
```

### フロントエンド Bundle が大きい

```bash
# Bundle Analyzer実行
cd frontend
ANALYZE=true yarn build

# 不要なパッケージを確認
npx depcheck

# 未使用のimportを削除
npx unimported
```

---

## ロールバック手順

### Lambda関数

```bash
# 前のバージョンに戻す
aws lambda update-function-code \
  --function-name cis-search-api \
  --zip-file fileb://lambda-deployment.zip.backup \
  --region ap-northeast-1
```

### Terraform

```bash
cd terraform

# 変更を元に戻す
git checkout HEAD -- lambda.tf api_gateway.tf

# 適用
terraform apply
```

### Next.js

```bash
cd frontend

# 設定を元に戻す
cp next.config.js.backup next.config.js

# 再ビルド
yarn build
```

---

## まとめ

このガイドに従って最適化を実装することで、以下の改善が期待できます:

### パフォーマンス改善

- **P50レスポンス**: 300ms → **120ms** (60%改善)
- **P95レスポンス**: 800ms → **350ms** (56%改善) ✅ 目標達成
- **Cold Start**: 1000ms → **500ms** (50%改善)
- **Bundle Size**:
  - Frontend: 1.2MB → **180KB** (85%削減)
  - Lambda: 10.4MB → **2.5MB** (76%削減)

### コスト削減

- **Lambda実行時間**: -40%
- **API Gateway呼び出し**: -70% (キャッシュ効果)
- **総コスト**: -30%削減

### 次のステップ

1. 継続的なモニタリング
2. パフォーマンスバジェット設定
3. 自動化されたパフォーマンステスト (CI/CD)
4. ユーザーフィードバック収集

---

## 参考資料

- [AWS Lambda Performance Optimization](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [Next.js Production Optimization](https://nextjs.org/docs/pages/building-your-application/optimizing)
- [OpenSearch Performance Tuning](https://opensearch.org/docs/latest/tuning-your-cluster/)
- [API Gateway Caching](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-caching.html)
