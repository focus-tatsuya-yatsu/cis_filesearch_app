# Lambda Search API 移行ガイド

## 概要

このガイドでは、現在のNext.js API Routes (`/api/search`) からLambda関数ベースの検索APIへの移行手順を説明します。

## 移行の理由

### 現在の構成（Next.js API Routes）
- **問題点**:
  - Next.jsアプリケーションサーバーに検索負荷が集中
  - スケーラビリティの制約（サーバー数に依存）
  - アーキテクチャ図との不一致

### 目標構成（Lambda + API Gateway）
- **メリット**:
  - サーバーレスによる自動スケーリング
  - 検索処理とフロントエンドの分離
  - コスト効率の向上（使用した分だけ課金）
  - アーキテクチャ図との一致

---

## Phase 1: Lambda関数の実装とデプロイ (1週間)

### ステップ 1.1: プロジェクトセットアップ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 依存関係インストール
npm install

# TypeScriptビルド
npm run build

# テスト実行
npm test
```

### ステップ 1.2: 環境変数の設定

`.env.local` ファイルを作成:

```bash
OPENSEARCH_ENDPOINT=https://search-xxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
AWS_REGION=ap-northeast-1
LOG_LEVEL=info
NODE_ENV=development
```

### ステップ 1.3: ローカルテスト

```bash
# ローカル環境でLambda関数をテスト
npm run test:local

# または手動でテスト
./scripts/test-local.sh
```

### ステップ 1.4: AWS環境へのデプロイ

#### 手動デプロイ

```bash
# デプロイスクリプトを実行
./scripts/deploy.sh
```

#### Terraformデプロイ（推奨）

```bash
cd terraform

# Terraform初期化
terraform init

# プランの確認
terraform plan \
  -var="opensearch_domain_endpoint=$OPENSEARCH_ENDPOINT" \
  -var="cognito_user_pool_id=$COGNITO_USER_POOL_ID" \
  -var="cognito_user_pool_arn=$COGNITO_USER_POOL_ARN" \
  -var="vpc_id=$VPC_ID" \
  -var="private_subnet_ids=[\"$SUBNET_1\",\"$SUBNET_2\"]" \
  -var="opensearch_security_group_id=$SG_ID"

# デプロイ
terraform apply
```

### ステップ 1.5: 動作確認

```bash
# API GatewayのURLを取得
API_URL=$(terraform output -raw api_gateway_url)

# Cognitoトークンを取得（AWS Amplifyを使用）
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id $COGNITO_CLIENT_ID \
  --auth-parameters USERNAME=$USERNAME,PASSWORD=$PASSWORD \
  --query 'AuthenticationResult.IdToken' \
  --output text)

# APIテスト
curl -X GET "$API_URL?q=報告書&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

---

## Phase 2: API Gateway設定 (3日)

### ステップ 2.1: Cognitoオーソライザーの設定

Terraformで自動的に設定されますが、手動で確認する場合:

```bash
# AWSコンソール → API Gateway → Authorizers
# または AWS CLI
aws apigateway get-authorizers \
  --rest-api-id $API_ID \
  --region ap-northeast-1
```

### ステップ 2.2: CORS設定の確認

OPTIONSメソッドが正しく設定されているか確認:

```bash
curl -X OPTIONS "$API_URL" \
  -H "Origin: https://yourdomain.com" \
  -H "Access-Control-Request-Method: GET" \
  -v
```

期待されるレスポンスヘッダー:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

### ステップ 2.3: レート制限の設定

```bash
# API Gatewayのステージ設定でスロットリングを設定
aws apigateway update-stage \
  --rest-api-id $API_ID \
  --stage-name prod \
  --patch-operations \
    op=replace,path=/throttle/rateLimit,value=100 \
    op=replace,path=/throttle/burstLimit,value=200
```

---

## Phase 3: フロントエンド統合 (5日)

### ステップ 3.1: 環境変数の追加

`frontend/.env.local`:

```bash
NEXT_PUBLIC_API_GATEWAY_URL=https://xxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod
```

### ステップ 3.2: 新しいAPIサービスの実装

`frontend/src/services/search-api.service.ts` を作成:

```typescript
import { Auth } from 'aws-amplify';

interface SearchParams {
  query?: string;
  searchMode?: 'and' | 'or';
  fileType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: 'relevance' | 'date' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export async function searchFiles(params: SearchParams) {
  try {
    // Cognito JWTトークンを取得
    const session = await Auth.currentSession();
    const idToken = session.getIdToken().getJwtToken();

    // クエリパラメータを構築
    const queryString = new URLSearchParams(
      Object.entries(params).filter(([_, v]) => v != null) as [string, string][]
    ).toString();

    // API Gateway経由でLambda呼び出し
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_GATEWAY_URL}/search?${queryString}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error.message);
    }

    return await response.json();
  } catch (error) {
    console.error('Search API error:', error);
    throw error;
  }
}
```

### ステップ 3.3: 既存コンポーネントの更新

既存の検索コンポーネントで、新しいAPIサービスを使用するように更新:

```typescript
// Before (Next.js API Routes)
const response = await fetch(`/api/search?q=${query}`);

// After (Lambda API)
import { searchFiles } from '@/services/search-api.service';
const response = await searchFiles({ query });
```

### ステップ 3.4: エラーハンドリングの実装

```typescript
try {
  const response = await searchFiles({ query });
  setResults(response.data.results);
} catch (error: any) {
  if (error.message.includes('OPENSEARCH_UNAVAILABLE')) {
    // OpenSearchが利用不可の場合
    showErrorNotification('検索サービスが一時的に利用できません');
  } else if (error.message.includes('INVALID_QUERY')) {
    // クエリが無効な場合
    showErrorNotification('検索キーワードを入力してください');
  } else {
    // その他のエラー
    showErrorNotification('検索に失敗しました');
  }
}
```

### ステップ 3.5: 既存Next.js API Routesの削除

新しいLambda APIが正常に動作することを確認したら、既存のAPI Routesを削除:

```bash
# バックアップを取る
mv frontend/src/app/api/search frontend/src/app/api/search.backup

# 削除
rm -rf frontend/src/app/api/search.backup
```

---

## Phase 4: デプロイと検証 (2日)

### ステップ 4.1: ステージング環境でのテスト

```bash
# ステージング環境にデプロイ
terraform workspace select staging
terraform apply

# E2Eテスト実行
npm run test:e2e
```

### ステップ 4.2: パフォーマンステスト

Locustを使用した負荷テスト:

```python
# locustfile.py
from locust import HttpUser, task, between

class SearchUser(HttpUser):
    wait_time = between(1, 3)

    @task
    def search_files(self):
        self.client.get(
            "/search?q=報告書&page=1&limit=20",
            headers={"Authorization": f"Bearer {self.token}"}
        )

# 実行
locust -f locustfile.py --host https://api.example.com
```

### ステップ 4.3: 本番デプロイ

```bash
# 本番環境にデプロイ
terraform workspace select prod
terraform apply

# デプロイ後の動作確認
./scripts/verify-deployment.sh
```

### ステップ 4.4: モニタリング設定の確認

CloudWatchダッシュボードで以下を確認:

- Lambda実行時間
- エラー率
- スロットル発生
- OpenSearchレイテンシ

---

## ロールバック手順

問題が発生した場合のロールバック:

### 方法1: フロントエンドのみロールバック

```typescript
// 一時的に古いAPI Routesに戻す
const response = await fetch(`/api/search?q=${query}`);
```

### 方法2: Lambda関数のバージョンロールバック

```bash
# 以前のバージョンに戻す
aws lambda update-alias \
  --function-name cis-search-api \
  --name prod \
  --function-version $PREVIOUS_VERSION
```

### 方法3: Terraform完全ロールバック

```bash
terraform destroy -target=aws_lambda_function.search_api
terraform destroy -target=aws_api_gateway_rest_api.search_api
```

---

## トラブルシューティング

### 問題1: Lambda Cold Start が遅い

**解決策**: Provisioned Concurrencyを有効化

```bash
aws lambda put-provisioned-concurrency-config \
  --function-name cis-search-api \
  --provisioned-concurrent-executions 5 \
  --qualifier prod
```

### 問題2: OpenSearchへの接続エラー

**原因**: VPCセキュリティグループの設定ミス

**解決策**:
```bash
# Lambdaセキュリティグループに、OpenSearchへのアウトバウンド通信を許可
aws ec2 authorize-security-group-egress \
  --group-id $LAMBDA_SG_ID \
  --protocol tcp \
  --port 443 \
  --source-group $OPENSEARCH_SG_ID
```

### 問題3: Cognito認証エラー

**原因**: JWTトークンの期限切れ

**解決策**:
```typescript
// トークンのリフレッシュ処理を追加
try {
  const session = await Auth.currentSession();
} catch (error) {
  // トークンをリフレッシュ
  await Auth.currentAuthenticatedUser({ bypassCache: true });
  const session = await Auth.currentSession();
}
```

---

## チェックリスト

### デプロイ前
- [ ] ユニットテストが全て通過
- [ ] TypeScriptビルドエラーなし
- [ ] 環境変数が正しく設定されている
- [ ] IAMロールに必要な権限が付与されている
- [ ] VPC設定が正しい

### デプロイ後
- [ ] Lambda関数が正常に起動
- [ ] API Gatewayエンドポイントにアクセス可能
- [ ] Cognito認証が機能している
- [ ] OpenSearchへの接続が成功
- [ ] 検索結果が正しく返される

### フロントエンド統合後
- [ ] 既存の検索機能が全て動作
- [ ] エラーハンドリングが適切
- [ ] パフォーマンスが改善
- [ ] ユーザー体験が向上

---

## サポート

問題が発生した場合は、以下を確認してください:

1. CloudWatch Logsでエラーログを確認
2. API GatewayのCloudWatch Metricsを確認
3. OpenSearchのクラスター状態を確認

ログの確認方法:

```bash
# Lambda関数のログ
aws logs tail /aws/lambda/cis-search-api --follow

# API Gatewayのアクセスログ
aws logs tail /aws/api-gateway/cis-search-api --follow
```

---

## 次のステップ

移行が完了したら、以下の最適化を検討してください:

1. **キャッシング**: CloudFront + API Gateway Cachingを有効化
2. **コスト最適化**: Lambda MemoryとTimeoutの調整
3. **モニタリング強化**: X-Rayによる分散トレーシング
4. **CI/CDパイプライン**: GitHub Actions / CodePipelineの構築
