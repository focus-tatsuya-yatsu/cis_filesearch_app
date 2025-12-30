# 画像検索機能 統合テスト計画書

## 目次

1. [テスト概要](#テスト概要)
2. [デプロイ前テスト（モックモード）](#デプロイ前テストモックモード)
3. [デプロイ後テスト（実環境）](#デプロイ後テスト実環境)
4. [エラー発生時の確認ポイント](#エラー発生時の確認ポイント)
5. [成功判定基準](#成功判定基準)
6. [テストデータ](#テストデータ)
7. [トラブルシューティング](#トラブルシューティング)

---

## テスト概要

### テスト目的

画像検索機能の完全な動作を確認し、エンドツーエンドでの品質を保証する

### テスト範囲

- **フロントエンド**: Next.js API Routes
  - `/api/image-embedding` - 画像ベクトル化API
  - `/api/search` - 検索API（POST）
- **バックエンド**: AWS Lambda Search API
  - OpenSearch画像ベクトル検索
  - レスポンス形式とCORS
- **統合フロー**: 画像アップロード → ベクトル化 → 検索実行 → 結果表示

### テスト環境

- **開発環境（モックモード）**: AWS認証情報なしで動作確認
- **本番環境（実環境）**: AWS Bedrock + OpenSearch を使用した実際の検索

---

## デプロイ前テスト（モックモード）

### 前提条件

```bash
# 現在の設定確認
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
cat src/app/api/image-embedding/route.ts | grep "USE_MOCK_MODE"
# USE_MOCK_MODE = true であることを確認
```

### Test 1: 画像ベクトル化API（モックモード）

#### 目的
AWS Bedrock未接続の状態で、モックベクトル生成が正常に動作することを確認

#### 手順

```bash
# 1. 開発サーバー起動
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
yarn dev

# 2. ブラウザで画面を開く
# http://localhost:3000

# 3. 画像をアップロードして検索ボタンをクリック
```

#### テスト用curlコマンド

```bash
# テスト画像を準備（存在しない場合は適当な画像ファイルを用意）
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@/path/to/test-image.jpg" \
  -v
```

#### 期待される結果

**ステータスコード**: 200 OK

**レスポンスボディ**:
```json
{
  "success": true,
  "data": {
    "embedding": [/* 1024次元の数値配列 */],
    "dimensions": 1024,
    "fileName": "test-image.jpg",
    "fileSize": 123456,
    "fileType": "image/jpeg"
  }
}
```

**コンソールログ**:
```
[Image Embedding API] Starting image embedding request
[Image Embedding API] Mock mode: true
[Image Embedding API] Received file: { name: 'test-image.jpg', size: 123456, type: 'image/jpeg' }
[MOCK MODE] Using mock embedding instead of AWS Bedrock
[MOCK MODE] Generated mock embedding vector (1024 dimensions)
[Image Embedding API] Embedding generated successfully, dimensions: 1024
```

#### チェックリスト

- [ ] HTTPステータス200が返る
- [ ] `success: true`が返る
- [ ] `embedding`配列が1024次元である
- [ ] `fileName`, `fileSize`, `fileType`が正しい
- [ ] コンソールに`[MOCK MODE]`ログが表示される
- [ ] エラーが発生しない

---

### Test 2: 画像検索API（モックモード）

#### 目的
モックベクトルを使用した検索リクエストが正常に送信されることを確認

#### 手順

```bash
# 1. 前のテストで取得したembedding配列をコピー
# 2. 以下のcurlコマンドを実行
```

#### テスト用curlコマンド

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "imageEmbedding": [/* モックで生成された1024次元の配列 */],
    "page": 1,
    "size": 20
  }' \
  -v
```

#### 期待される結果

**ステータスコード**: 200 OK（Lambda側でエラーが発生する可能性あり）

**Next.js API Route コンソールログ**:
```
[POST] Image search request to Lambda {
  embeddingDimensions: 1024,
  page: 1,
  limit: 20,
  apiGatewayUrl: 'https://your-api-gateway-url.amazonaws.com/...'
}
[POST] Lambda response status: { status: 200, statusText: 'OK', ok: true }
[POST] Lambda response parsed: { success: true, hasData: true, ... }
```

#### チェックリスト

- [ ] `/api/search`へのリクエストが成功する
- [ ] Lambda URLへのリクエストが正しく送信される
- [ ] CORSヘッダーが正しい
- [ ] デバッグログが詳細に出力される

---

### Test 3: UI統合テスト（モックモード）

#### 目的
UIから画像検索を実行し、フロー全体が正常に動作することを確認

#### 手順

1. **ブラウザで開く**: http://localhost:3000
2. **画像をアップロード**: ファイル選択ダイアログから画像を選択
3. **検索ボタンをクリック**
4. **開発者ツールを開く**: Console, Network タブを確認

#### チェックリスト

- [ ] ファイルアップロードUIが正常に動作
- [ ] アップロード中のローディング表示が出る
- [ ] `/api/image-embedding`が呼ばれる
- [ ] ベクトル化成功のログが出る
- [ ] `/api/search`（POST）が呼ばれる
- [ ] 検索結果が表示される（または適切なエラーメッセージ）
- [ ] UIがフリーズしない
- [ ] 連続して複数回検索できる

#### Network タブ確認項目

**リクエスト順序**:
1. `POST /api/image-embedding` → 200 OK
2. `POST /api/search` → 200 OK（または500）

**Headers確認**:
- `Content-Type: multipart/form-data` (image-embedding)
- `Content-Type: application/json` (search)

---

## デプロイ後テスト（実環境）

### 前提条件

```bash
# 1. USE_MOCK_MODEをfalseに変更
# /Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/app/api/image-embedding/route.ts
# const USE_MOCK_MODE = false;

# 2. AWS認証情報を設定（.env.local）
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_REGION=us-east-1

# 3. Lambda関数をデプロイ
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
yarn build
# AWS CLIまたはTerraformでデプロイ

# 4. API Gateway URLを確認
# NEXT_PUBLIC_API_GATEWAY_URL を .env.local に設定
```

### Test 4: AWS Bedrock画像ベクトル化（実環境）

#### 目的
実際のAWS Bedrockを使用して画像がベクトル化されることを確認

#### 手順

```bash
# 開発サーバー再起動（環境変数を反映）
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
yarn dev

# テスト用curlコマンド実行
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@/path/to/test-image.jpg" \
  -v
```

#### 期待される結果

**ステータスコード**: 200 OK

**レスポンスボディ**:
```json
{
  "success": true,
  "data": {
    "embedding": [/* AWS Bedrockで生成された1024次元配列 */],
    "dimensions": 1024,
    "fileName": "test-image.jpg",
    "fileSize": 123456,
    "fileType": "image/jpeg"
  }
}
```

**コンソールログ**:
```
[Image Embedding API] Starting image embedding request
[Image Embedding API] Mock mode: false
[Bedrock] Using region: us-east-1
[Image Embedding API] Embedding generated successfully, dimensions: 1024
```

#### チェックリスト

- [ ] HTTPステータス200が返る
- [ ] AWS Bedrockへのリクエストが成功する
- [ ] `embedding`が実際のベクトルデータである
- [ ] `[MOCK MODE]`ログが**出ない**
- [ ] `[Bedrock]`ログが出る

#### エラーケース

**401 Unauthorized**:
```json
{
  "error": "AWS credentials not configured",
  "code": "MISSING_CREDENTIALS"
}
```
→ AWS認証情報を確認

**403 Forbidden**:
```json
{
  "error": "Access denied to AWS Bedrock",
  "code": "ACCESS_DENIED"
}
```
→ IAM権限を確認（`bedrock:InvokeModel`が必要）

**503 Service Unavailable**:
```json
{
  "error": "Bedrock model not available in this region",
  "code": "MODEL_NOT_AVAILABLE"
}
```
→ リージョンを`us-east-1`に変更

---

### Test 5: OpenSearch画像ベクトル検索（実環境）

#### 目的
Lambda関数が画像ベクトルを受け取り、OpenSearchで類似画像を検索できることを確認

#### 手順

```bash
# 1. Test 4で取得したembedding配列を使用
# 2. 以下のcurlコマンドを実行
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "imageEmbedding": [/* Bedrockで生成されたベクトル */],
    "page": 1,
    "size": 20
  }' \
  -v
```

#### 期待される結果

**ステータスコード**: 200 OK

**レスポンスボディ**:
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "file-12345",
        "fileName": "similar-image.jpg",
        "filePath": "/path/to/similar-image.jpg",
        "fileType": "image",
        "fileSize": 234567,
        "modifiedAt": "2025-12-18T10:00:00Z",
        "score": 0.95
      }
      // ... 他の類似画像
    ],
    "pagination": {
      "total": 50,
      "page": 1,
      "limit": 20,
      "totalPages": 3
    },
    "query": {
      "searchType": "image",
      "searchMode": "or",
      "sortBy": "relevance",
      "sortOrder": "desc"
    },
    "took": 45
  }
}
```

**コンソールログ**:
```
[POST] Image search request to Lambda { embeddingDimensions: 1024, page: 1, limit: 20 }
[POST] Lambda response status: { status: 200, statusText: 'OK', ok: true }
[POST] Lambda response parsed: { success: true, hasData: true, resultCount: 20, total: 50 }
```

#### Lambda CloudWatch Logs確認

```
Lambda invoked { requestId: 'xxx', httpMethod: 'POST', path: '/', eventVersion: '2.0' }
POST request body parsed { hasImageEmbedding: true, embeddingLength: 1024 }
POST search query validated { searchQuery: { imageEmbedding: '[1024 dimensions]', size: 20, from: 0 } }
POST search completed successfully { resultCount: 20, total: 50, took: 45 }
```

#### チェックリスト

- [ ] Lambda関数が正常に起動する
- [ ] POSTリクエストとして処理される
- [ ] `imageEmbedding`が正しくパースされる
- [ ] OpenSearchでkNN検索が実行される
- [ ] 検索結果が返る（0件でも可）
- [ ] `pagination`情報が正確
- [ ] `took`（検索時間）が記録される
- [ ] CORSヘッダーが含まれる

---

### Test 6: エンドツーエンド統合テスト（実環境）

#### 目的
UIから実際の画像検索を実行し、完全なフローが動作することを確認

#### 手順

1. **サンプル画像を準備**
   - 既にOpenSearchに登録済みの画像ファイル
   - または類似する可能性のある画像

2. **ブラウザで検索実行**
   - http://localhost:3000 を開く
   - 画像をアップロード
   - 検索ボタンをクリック

3. **結果確認**
   - 検索結果が表示される
   - 関連性の高い画像が上位に表示される

#### チェックリスト

- [ ] 画像アップロードが成功
- [ ] ベクトル化が成功（AWS Bedrock）
- [ ] 検索が成功（Lambda + OpenSearch）
- [ ] 結果が正しくUIに表示される
- [ ] スコア順にソートされている
- [ ] ページネーションが動作する
- [ ] エラーハンドリングが適切
- [ ] ローディング表示が適切

#### パフォーマンス確認

- **ベクトル化時間**: < 3秒
- **検索時間**: < 1秒
- **合計処理時間**: < 5秒

---

## エラー発生時の確認ポイント

### 1. 画像ベクトル化API（/api/image-embedding）のエラー

#### CORS Error

**症状**:
```
Access to fetch at 'http://localhost:3000/api/image-embedding' from origin 'http://localhost:3000' has been blocked by CORS policy
```

**確認ポイント**:
- `OPTIONS`リクエストが正常に返るか
- レスポンスヘッダーに`Access-Control-Allow-Origin`があるか
- `Access-Control-Allow-Methods`に`POST`が含まれるか

**解決方法**:
- `/api/image-embedding/route.ts`の`OPTIONS`ハンドラを確認
- `createCorsResponse`関数でヘッダーが正しく設定されているか確認

---

#### 401 Unauthorized（AWS認証エラー）

**症状**:
```json
{
  "error": "AWS credentials not configured",
  "code": "MISSING_CREDENTIALS"
}
```

**確認ポイント**:
```bash
# 環境変数を確認
echo $AWS_ACCESS_KEY_ID
echo $AWS_SECRET_ACCESS_KEY
echo $AWS_REGION

# .env.localファイルを確認
cat .env.local | grep AWS
```

**解決方法**:
```bash
# .env.localに追加
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
```

---

#### 403 Forbidden（IAM権限エラー）

**症状**:
```json
{
  "error": "Access denied to AWS Bedrock",
  "code": "ACCESS_DENIED"
}
```

**確認ポイント**:
```bash
# IAMユーザーの権限を確認
aws iam get-user
aws iam list-attached-user-policies --user-name your-user-name

# Bedrock呼び出しテスト
aws bedrock-runtime invoke-model \
  --model-id amazon.titan-embed-image-v1 \
  --region us-east-1 \
  --body '{"inputImage":"base64-encoded-image"}' \
  output.json
```

**解決方法**:
IAMポリシーに以下を追加:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-image-v1"
    }
  ]
}
```

---

#### 413 Payload Too Large（ファイルサイズエラー）

**症状**:
```json
{
  "error": "Image file size must be less than 5MB",
  "code": "FILE_TOO_LARGE"
}
```

**確認ポイント**:
- アップロードした画像のファイルサイズ

**解決方法**:
- 5MB以下の画像を使用
- または`route.ts`の制限を変更（推奨しない）

---

#### 415 Unsupported Media Type（ファイル形式エラー）

**症状**:
```json
{
  "error": "Only JPEG and PNG images are supported",
  "code": "INVALID_FILE_TYPE"
}
```

**確認ポイント**:
- 画像のMIMEタイプ

**解決方法**:
- JPEG（`.jpg`, `.jpeg`）またはPNG（`.png`）形式の画像を使用

---

### 2. 検索API（/api/search POST）のエラー

#### Lambda Function Error（500）

**症状**:
```
[POST] Lambda API error: { status: 500, error: { ... } }
```

**確認ポイント**:
```bash
# Lambda CloudWatch Logsを確認
aws logs tail /aws/lambda/cis-search-api --follow

# Lambda関数の設定を確認
aws lambda get-function --function-name cis-search-api

# 環境変数を確認
aws lambda get-function-configuration --function-name cis-search-api \
  | jq '.Environment.Variables'
```

**解決方法**:
- Lambda CloudWatch Logsでスタックトレースを確認
- OpenSearchエンドポイントが正しいか確認
- Lambda IAMロールにOpenSearch権限があるか確認

---

#### OpenSearch Connection Error

**症状**:
```
[Lambda] OpenSearch connection failed: connect ECONNREFUSED
```

**確認ポイント**:
```bash
# OpenSearchエンドポイントを確認
echo $OPENSEARCH_ENDPOINT

# VPC設定を確認（LambdaがVPC内の場合）
aws ec2 describe-security-groups --group-ids sg-xxxxx
```

**解決方法**:
- OpenSearchのセキュリティグループでLambdaからのアクセスを許可
- VPC内のLambda設定が正しいか確認
- OpenSearchドメインのアクセスポリシーを確認

---

#### Invalid JSON Response from Lambda

**症状**:
```
[POST] Failed to parse success response: SyntaxError: Unexpected token < in JSON
```

**確認ポイント**:
```bash
# Lambda関数のレスポンス形式を確認
# CloudWatch Logsでレスポンスボディを確認
```

**解決方法**:
- Lambda関数が正しいJSON形式で返しているか確認
- API Gatewayのマッピングテンプレートを確認
- Lambda統合タイプを確認（Lambda Proxy Integrationが推奨）

---

#### CORS Error from Lambda

**症状**:
```
No 'Access-Control-Allow-Origin' header is present on the requested resource
```

**確認ポイント**:
- Lambda関数のレスポンスヘッダー
- API Gatewayの設定

**解決方法**:
Lambda関数で正しいCORSヘッダーを返す:
```typescript
return {
  statusCode: 200,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  },
  body: JSON.stringify(data),
};
```

---

## 成功判定基準

### 機能レベル

#### モックモード

- [ ] 画像アップロードが成功する
- [ ] モックベクトル（1024次元）が生成される
- [ ] `/api/search`にベクトルが正しく送信される
- [ ] エラーが発生しない

#### 実環境

- [ ] AWS Bedrockで画像がベクトル化される
- [ ] Lambda関数がPOSTリクエストを受け取る
- [ ] OpenSearchでkNN検索が実行される
- [ ] 検索結果が返る
- [ ] UIに結果が表示される

### パフォーマンスレベル

- [ ] 画像ベクトル化: < 3秒
- [ ] 検索実行: < 1秒
- [ ] 合計処理時間: < 5秒
- [ ] 10回連続実行で失敗なし

### 品質レベル

- [ ] CORSエラーが発生しない
- [ ] 適切なエラーメッセージが表示される
- [ ] ログが詳細に出力される
- [ ] 開発者ツールでエラーがない
- [ ] UIがフリーズしない
- [ ] メモリリークがない

---

## テストデータ

### テスト用画像ファイル

#### 小サイズ画像（正常系）
- **ファイル名**: `test-image-small.jpg`
- **サイズ**: 100KB
- **形式**: JPEG
- **用途**: 基本的な動作確認

#### 中サイズ画像（正常系）
- **ファイル名**: `test-image-medium.png`
- **サイズ**: 2MB
- **形式**: PNG
- **用途**: パフォーマンステスト

#### 大サイズ画像（境界値）
- **ファイル名**: `test-image-large.jpg`
- **サイズ**: 4.9MB
- **形式**: JPEG
- **用途**: 最大サイズテスト

#### 超過サイズ画像（異常系）
- **ファイル名**: `test-image-toolarge.jpg`
- **サイズ**: 6MB
- **形式**: JPEG
- **用途**: エラーハンドリングテスト

#### 非対応形式（異常系）
- **ファイル名**: `test-image.bmp`
- **サイズ**: 1MB
- **形式**: BMP
- **用途**: ファイル形式バリデーションテスト

---

## トラブルシューティング

### デバッグコマンド

#### フロントエンドログ確認

```bash
# 開発サーバーのコンソール出力を確認
yarn dev

# ブラウザのConsoleタブを確認
# ブラウザのNetworkタブを確認
```

#### Lambda関数ログ確認

```bash
# CloudWatch Logsをリアルタイム表示
aws logs tail /aws/lambda/cis-search-api --follow

# 最新のログを取得
aws logs tail /aws/lambda/cis-search-api --since 10m

# エラーのみをフィルタ
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '10 minutes ago' +%s)000
```

#### OpenSearch確認

```bash
# OpenSearchインデックス確認
curl -X GET "https://your-opensearch-endpoint/file-index/_search?pretty" \
  -H "Content-Type: application/json" \
  -d '{ "query": { "match_all": {} }, "size": 1 }'

# kNN検索テスト
curl -X POST "https://your-opensearch-endpoint/file-index/_search?pretty" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 5,
    "query": {
      "knn": {
        "imageEmbedding": {
          "vector": [/* 1024次元のベクトル */],
          "k": 5
        }
      }
    }
  }'
```

#### Network診断

```bash
# API Gatewayへの接続確認
curl -v https://your-api-gateway-url.amazonaws.com/prod/search

# OPTIONS（CORS Preflight）確認
curl -X OPTIONS https://your-api-gateway-url.amazonaws.com/prod/search \
  -H "Origin: http://localhost:3000" \
  -v

# POST リクエスト確認
curl -X POST https://your-api-gateway-url.amazonaws.com/prod/search \
  -H "Content-Type: application/json" \
  -d '{"imageEmbedding": [0.1, 0.2, ...], "page": 1, "size": 20}' \
  -v
```

### よくある問題と解決方法

#### 問題1: "Mock mode is enabled but real data is expected"

**原因**: モックモードが有効になっている

**解決**:
```typescript
// src/app/api/image-embedding/route.ts
const USE_MOCK_MODE = false; // trueからfalseに変更
```

#### 問題2: Lambda関数が起動しない

**原因**: API Gateway設定が間違っている

**確認**:
```bash
# API Gateway設定確認
aws apigatewayv2 get-apis
aws apigatewayv2 get-routes --api-id your-api-id
```

**解決**:
- Lambda統合が正しく設定されているか確認
- メソッドマッピングを確認（GET, POST, OPTIONSすべて必要）

#### 問題3: OpenSearchにデータがない

**原因**: インデックスが空または存在しない

**確認**:
```bash
# インデックス一覧
curl -X GET "https://your-opensearch-endpoint/_cat/indices?v"

# ドキュメント数確認
curl -X GET "https://your-opensearch-endpoint/file-index/_count"
```

**解決**:
- ファイル処理ワーカーを実行してインデックスを構築
- テストデータを手動でインサート

---

## テスト実行チェックシート

### デプロイ前（モックモード）

- [ ] Test 1: 画像ベクトル化API（モックモード）
- [ ] Test 2: 画像検索API（モックモード）
- [ ] Test 3: UI統合テスト（モックモード）

### デプロイ後（実環境）

- [ ] 環境変数設定完了（AWS認証情報）
- [ ] Lambda関数デプロイ完了
- [ ] API Gateway URL設定完了
- [ ] USE_MOCK_MODE = false に変更
- [ ] Test 4: AWS Bedrock画像ベクトル化（実環境）
- [ ] Test 5: OpenSearch画像ベクトル検索（実環境）
- [ ] Test 6: エンドツーエンド統合テスト（実環境）

### 最終確認

- [ ] すべてのテストがパスした
- [ ] パフォーマンス基準を満たした
- [ ] エラーハンドリングが適切
- [ ] ログが適切に出力される
- [ ] ドキュメントが最新

---

## 次のステップ

テストが完了したら:

1. **USE_MOCK_MODEをfalseに戻す**（本番モード）
2. **Lambda関数を本番環境にデプロイ**
3. **監視設定**（CloudWatch Alarms, X-Ray）
4. **負荷テスト実行**
5. **ユーザー受け入れテスト（UAT）**

---

## 関連ドキュメント

- [画像検索機能実装ガイド](/Users/tatsuya/focus_project/cis_filesearch_app/docs/lambda-search-api-implementation-guide.md)
- [OpenSearch設定ガイド](/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/lib/opensearch.ts)
- [API仕様書](/Users/tatsuya/focus_project/cis_filesearch_app/docs/api-specification.md)

---

**最終更新**: 2025-12-18
**作成者**: Claude Code QA Engineer
**バージョン**: 1.0
