# 画像検索API CORS修正ガイド

## 問題の診断結果

画像検索APIで発生していたエラーの根本原因を特定しました。

### 発生していた問題

#### コンソールログ
```
Error Name: Unknown
Error Message: (空)
Stack Trace: undefined
```

#### データフロー
```
[IMAGE SEARCH DEBUG] 🚀 Starting Flow: Image Search Flow
[IMAGE SEARCH DEBUG] 🔢 Sending to /api/search
[IMAGE SEARCH DEBUG] 🔵 Request to /api/search
Method: POST
Data: {imageEmbedding: [Vector: 1024 dimensions], searchType: 'image'}
```

### 根本原因

#### 1. CORSヘッダーの不整合

**Lambda側の問題:**
```typescript
// 修正前 - POSTメソッドが許可されていない
headers: {
  'Access-Control-Allow-Methods': 'GET, OPTIONS'  // ❌ POSTがない
}
```

**実際のリクエスト:**
- テキスト検索: GET メソッド
- 画像検索: POST メソッド（1024次元のベクトルをボディで送信）

**結果:**
POSTリクエストがCORSプリフライトチェックで拒否され、ブラウザがエラーを発生させる。

#### 2. レスポンス形式の確認が必要

**Lambda:**
```typescript
{
  success: true,
  data: {
    results: [...],
    pagination: {...},
    query: {...},
    took: number
  }
}
```

**フロントエンド:**
```typescript
// search.tsのhandleSearchResponse関数
const data: SearchResponse = await response.json();
return data;  // { success: true, data: {...} } を期待
```

## 修正内容

### 1. Lambda - CORS ヘッダー修正

**ファイル:** `src/utils/error-handler.ts`

#### 成功レスポンス
```typescript
export function createSuccessResponse(data: any): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',  // ✅ POST追加
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'private, max-age=60',
    },
    body: JSON.stringify({
      success: true,
      data,
    }),
  };
}
```

#### エラーレスポンス
```typescript
export function createErrorResponse(...): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',  // ✅ POST追加
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: JSON.stringify(errorResponse),
  };
}
```

### 2. フロントエンド - デバッグログ強化

**ファイル:** `frontend/src/app/api/search/route.ts`

画像検索のPOSTリクエスト処理に詳細なログを追加：

```typescript
// レスポンスステータスの詳細ログ
console.log('[POST] Lambda response status:', {
  status: apiResponse.status,
  statusText: apiResponse.statusText,
  ok: apiResponse.ok,
  headers: Object.fromEntries(apiResponse.headers.entries())
});

// レスポンステキストを先に取得（デバッグ用）
const responseText = await apiResponse.text();
console.log('[POST] Lambda raw response:', responseText.substring(0, 500));

// パースエラーの詳細ログ
try {
  response = JSON.parse(responseText);
} catch (e) {
  console.error('[POST] Failed to parse success response:', e);
  throw new Error('Invalid JSON response from Lambda');
}
```

## デプロイ手順

### 1. Lambda関数の更新

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# デプロイスクリプトを実行
./scripts/deploy-cors-fix.sh
```

#### スクリプトの実行内容

1. **前提条件チェック**
   - Node.js インストール確認
   - AWS CLI インストール確認

2. **依存関係のインストール**
   - `npm install --production=false`

3. **TypeScriptビルド**
   - `npm run build`
   - dist/ ディレクトリ生成

4. **デプロイパッケージ作成**
   - dist/ と node_modules をzip圧縮
   - lambda-deployment.zip 生成

5. **AWS Lambdaへデプロイ**
   ```bash
   aws lambda update-function-code \
     --function-name cis-search-api \
     --zip-file fileb://lambda-deployment.zip \
     --region ap-northeast-1
   ```

6. **更新完了待機**
   - Lambda関数の更新が完了するまで待機

### 2. フロントエンドの再起動

Next.jsの開発サーバーを再起動して、修正されたコードを反映：

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# 開発サーバーを再起動
yarn dev
```

## 検証手順

### 1. ブラウザコンソールでの確認

画像検索を実行し、以下のログが表示されることを確認：

```
[POST] Image search request to Lambda
  embeddingDimensions: 1024
  page: 1
  limit: 20
  apiGatewayUrl: https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search

[POST] Lambda response status:
  status: 200
  statusText: "OK"
  ok: true
  headers: {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": "*",
    ...
  }

[POST] Lambda raw response: {"success":true,"data":{"results":[...],...}}

[POST] Lambda response parsed:
  success: true
  hasData: true
  resultCount: 5
  total: 5
```

### 2. ネットワークタブでの確認

#### リクエスト
- Method: `POST`
- URL: `/api/search`
- Body: `{ imageEmbedding: [1024 dimensions], searchType: 'image', ... }`

#### レスポンス
- Status: `200 OK`
- Headers:
  ```
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Allow-Origin: *
  Content-Type: application/json
  ```
- Body:
  ```json
  {
    "success": true,
    "data": {
      "results": [...],
      "pagination": {...},
      "query": {...},
      "took": 123
    }
  }
  ```

### 3. 画像検索の動作確認

1. **画像を選択**
   - 検索バーの画像アイコンをクリック
   - 画像ファイルを選択

2. **ベクトル生成確認**
   ```
   [IMAGE SEARCH DEBUG] 🔢 Image Vector
   📐 Dimensions: 1024
   ```

3. **検索実行**
   - 自動的に検索が実行される
   - ローディング表示

4. **結果表示**
   - 信頼度90%以上の結果のみ表示
   - 関連度スコアが高い順にソート

## エラーパターンと対処法

### パターン1: CORS Preflightエラー

**症状:**
```
Access to fetch at '...' from origin '...' has been blocked by CORS policy:
Method POST is not allowed by Access-Control-Allow-Methods in preflight response.
```

**原因:**
Lambda関数が更新されていない、またはデプロイが失敗している

**対処法:**
```bash
# Lambda関数の現在の設定を確認
aws lambda get-function-configuration \
  --function-name cis-search-api \
  --region ap-northeast-1

# 再デプロイ
./scripts/deploy-cors-fix.sh
```

### パターン2: JSON Parse エラー

**症状:**
```
[POST] Failed to parse success response: SyntaxError: Unexpected token
```

**原因:**
Lambda関数がエラーレスポンスを返しているが、ステータスコードは200

**対処法:**
1. CloudWatch Logsを確認
   ```bash
   aws logs tail /aws/lambda/cis-search-api --follow
   ```

2. Lambda関数内のエラーを修正

### パターン3: OpenSearch接続エラー

**症状:**
```json
{
  "success": false,
  "error": {
    "code": "OPENSEARCH_UNAVAILABLE",
    "message": "OpenSearch service is temporarily unavailable"
  }
}
```

**原因:**
Lambda関数がOpenSearchに接続できない（VPC設定、セキュリティグループ、IAMロール）

**対処法:**
1. VPC設定確認
2. セキュリティグループ確認
3. IAMロール権限確認
4. 詳細は [VPC_OPENSEARCH_DNS_ANALYSIS.md](./VPC_OPENSEARCH_DNS_ANALYSIS.md) を参照

## 技術的詳細

### CORS (Cross-Origin Resource Sharing)

#### CORSヘッダーの役割

```typescript
'Access-Control-Allow-Origin': '*'
// どのオリジンからのリクエストも許可

'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
// GET, POST, OPTIONSメソッドを許可

'Access-Control-Allow-Headers': 'Content-Type, Authorization'
// Content-Type, Authorizationヘッダーを許可
```

#### プリフライトリクエスト

POSTリクエストの前に、ブラウザが自動的にOPTIONSリクエストを送信：

```
OPTIONS /api/search HTTP/1.1
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type
```

Lambdaのレスポンス（修正後）：

```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

### 画像検索のデータフロー

```
1. ユーザーが画像を選択
   ↓
2. フロントエンド: uploadImageForEmbedding()
   POST /api/image-embedding
   ↓
3. Bedrock: Titan Embed Image V1
   画像 → 1024次元ベクトル
   ↓
4. フロントエンド: searchFiles()
   POST /api/search
   Body: { imageEmbedding: [1024 dimensions] }
   ↓
5. Next.js API Route: /api/search
   POST → Lambda API Gateway
   ↓
6. Lambda: cis-search-api
   POST → OpenSearch k-NN検索
   ↓
7. OpenSearch: ベクトル類似度検索
   コサイン類似度でランキング
   ↓
8. Lambda → Next.js → フロントエンド
   { success: true, data: { results: [...] } }
```

## まとめ

### 修正のポイント

1. **CORS対応**
   - Lambda関数のCORSヘッダーにPOSTメソッドを追加
   - 成功・エラー両方のレスポンスで統一

2. **デバッグ強化**
   - Next.js API Routeに詳細ログを追加
   - レスポンスパース前にテキストを確認

3. **デプロイの自動化**
   - ワンコマンドでビルド・デプロイ
   - 依存関係の自動管理

### 期待される効果

- 画像検索APIが正常に動作
- CORSエラーの解消
- エラー発生時の詳細ログ出力
- デバッグの効率化

### 次のステップ

修正が完了したら、以下を確認：

1. [ ] Lambda関数のデプロイ完了
2. [ ] フロントエンド開発サーバー再起動
3. [ ] 画像検索の動作確認
4. [ ] エラーログの確認
5. [ ] CloudWatch Logsでの検証

問題が解決しない場合は、このドキュメントの「エラーパターンと対処法」を参照してください。
