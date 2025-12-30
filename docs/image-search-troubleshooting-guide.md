# 画像検索Internal Server Error - トラブルシューティングガイド

## 概要

このガイドは、画像検索機能で発生するInternal Server Errorの診断と解決方法を提供します。

## 問題の分類

### 1. AWS認証情報エラー (401 MISSING_CREDENTIALS)

**症状**:
```json
{
  "error": "AWS credentials not configured",
  "code": "MISSING_CREDENTIALS",
  "message": "Please configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.local"
}
```

**原因**:
- `.env.local`ファイルにAWS認証情報が未設定
- 環境変数がコメントアウトされている

**解決策**:

```bash
# /frontend/.env.localを編集
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

変更後、開発サーバーを再起動:
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
yarn dev
```

### 2. IAMアクセス権限エラー (403 ACCESS_DENIED)

**症状**:
```json
{
  "error": "Access denied to AWS Bedrock",
  "code": "ACCESS_DENIED",
  "message": "IAM user/role needs bedrock:InvokeModel permission"
}
```

**原因**:
- IAMユーザー/ロールにBedrockアクセス権限がない

**解決策**:

IAMコンソールで以下のポリシーをアタッチ:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*:*:foundation-model/amazon.titan-embed-image-v1"
    }
  ]
}
```

### 3. リージョンエラー (503 MODEL_NOT_AVAILABLE)

**症状**:
```json
{
  "error": "Bedrock model not available in this region",
  "code": "MODEL_NOT_AVAILABLE",
  "message": "amazon.titan-embed-image-v1 is not available in ap-northeast-1"
}
```

**原因**:
- 指定したリージョンでTitan Image Embeddingsが利用できない

**利用可能なリージョン**:
- `us-east-1` (バージニア北部)
- `us-west-2` (オレゴン)
- `ap-southeast-1` (シンガポール)
- `eu-central-1` (フランクフルト)

**解決策**:

`.env.local`のリージョンを変更:

```bash
# 東京リージョンから変更
AWS_REGION=us-west-2
```

### 4. CORSエラー

**症状**:
```
Access to fetch at 'http://localhost:3000/api/image-embedding' from origin 'http://localhost:3000' has been blocked by CORS policy
```

**原因**:
- レスポンスヘッダーにCORSヘッダーが不足
- Preflightリクエスト(OPTIONS)が正しく処理されていない

**解決策**:

この問題は既に修正されています(`createCorsResponse`関数の実装により)。最新コードを使用してください:

```typescript
function createCorsResponse(data: any, status: number): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
```

### 5. ファイルサイズエラー (400 FILE_TOO_LARGE)

**症状**:
```json
{
  "error": "Image file size must be less than 5MB",
  "code": "FILE_TOO_LARGE"
}
```

**原因**:
- アップロードした画像ファイルが5MBを超えている

**解決策**:
1. 画像を圧縮して5MB以下にする
2. または制限値を変更する(推奨しない):

```typescript
// /frontend/src/app/api/image-embedding/route.ts
if (imageFile.size > 10 * 1024 * 1024) { // 10MBに変更
  // ...
}
```

### 6. 不正なファイル形式エラー (400 INVALID_FILE_TYPE)

**症状**:
```json
{
  "error": "Only JPEG and PNG images are supported",
  "code": "INVALID_FILE_TYPE"
}
```

**原因**:
- JPEG/PNG以外のファイルをアップロードしている

**サポートされる形式**:
- `image/jpeg`
- `image/jpg`
- `image/png`

**解決策**:
画像をJPEGまたはPNG形式に変換してアップロード。

## モックモードでのテスト

AWS認証情報なしでテストしたい場合、モックモードを使用できます。

**モックモードの有効化**:

`.env.local`からAWS認証情報を削除またはコメントアウト:

```bash
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
```

**確認方法**:

開発サーバーのログに以下が表示されます:

```
[Image Embedding API] Mock mode: true
[MOCK MODE] Using mock embedding instead of AWS Bedrock
[MOCK MODE] Generated mock embedding vector (1024 dimensions)
```

モックモードでは、実際のBedrockを呼び出さずにランダムな1024次元ベクトルを返します。

## 診断スクリプト

画像検索APIの動作を診断するスクリプトを作成します:

```bash
#!/bin/bash
# /frontend/scripts/diagnose-image-search.sh

echo "====== 画像検索API診断スクリプト ======"
echo ""

# 1. 環境変数チェック
echo "[1] 環境変数チェック"
if [ -f .env.local ]; then
    echo "✓ .env.localファイルが存在します"

    if grep -q "AWS_ACCESS_KEY_ID=" .env.local && ! grep -q "^#.*AWS_ACCESS_KEY_ID=" .env.local; then
        echo "✓ AWS_ACCESS_KEY_IDが設定されています"
    else
        echo "✗ AWS_ACCESS_KEY_IDが未設定またはコメントアウトされています"
        echo "  → モックモードで動作します"
    fi

    if grep -q "AWS_SECRET_ACCESS_KEY=" .env.local && ! grep -q "^#.*AWS_SECRET_ACCESS_KEY=" .env.local; then
        echo "✓ AWS_SECRET_ACCESS_KEYが設定されています"
    else
        echo "✗ AWS_SECRET_ACCESS_KEYが未設定またはコメントアウトされています"
        echo "  → モックモードで動作します"
    fi

    REGION=$(grep "^AWS_REGION=" .env.local | cut -d'=' -f2)
    echo "  リージョン: ${REGION:-ap-northeast-1}"
else
    echo "✗ .env.localファイルが見つかりません"
fi

echo ""

# 2. Next.jsプロセスチェック
echo "[2] Next.jsサーバー状態"
if pgrep -f "next dev" > /dev/null; then
    echo "✓ Next.js開発サーバーが実行中です"
else
    echo "✗ Next.js開発サーバーが起動していません"
    echo "  → yarn dev を実行してください"
fi

echo ""

# 3. APIエンドポイントテスト
echo "[3] APIエンドポイントテスト"
if command -v curl &> /dev/null; then
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/image-embedding -X OPTIONS)

    if [ "$HTTP_STATUS" = "200" ]; then
        echo "✓ APIエンドポイントにアクセス可能です (OPTIONS: $HTTP_STATUS)"
    else
        echo "✗ APIエンドポイントにアクセスできません (STATUS: $HTTP_STATUS)"
        echo "  → サーバーが起動しているか確認してください"
    fi
else
    echo "⚠ curlコマンドが見つかりません"
fi

echo ""

# 4. 依存パッケージチェック
echo "[4] 依存パッケージチェック"
if [ -d "node_modules/@aws-sdk/client-bedrock-runtime" ]; then
    echo "✓ @aws-sdk/client-bedrock-runtimeがインストールされています"
else
    echo "✗ @aws-sdk/client-bedrock-runtimeが見つかりません"
    echo "  → yarn install を実行してください"
fi

if [ -d "node_modules/@aws-sdk/credential-provider-node" ]; then
    echo "✓ @aws-sdk/credential-provider-nodeがインストールされています"
else
    echo "✗ @aws-sdk/credential-provider-nodeが見つかりません"
    echo "  → yarn install を実行してください"
fi

echo ""
echo "====== 診断完了 ======"
```

実行方法:

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
chmod +x scripts/diagnose-image-search.sh
./scripts/diagnose-image-search.sh
```

## 手動テスト方法

### curlでテスト

```bash
# テスト用の小さい画像をダウンロード
curl -o /tmp/test-image.jpg "https://via.placeholder.com/300.jpg"

# 画像検索APIにリクエスト
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@/tmp/test-image.jpg" \
  -v

# 期待されるレスポンス (成功時)
# {
#   "success": true,
#   "data": {
#     "embedding": [0.123, -0.456, ...],
#     "dimensions": 1024,
#     "fileName": "test-image.jpg",
#     "fileSize": 12345,
#     "fileType": "image/jpeg"
#   }
# }
```

### ブラウザでテスト

1. `http://localhost:3000`にアクセス
2. 開発者ツール(F12)を開く
3. Consoleタブで以下を実行:

```javascript
// FormDataを使用して画像をアップロード
const input = document.createElement('input');
input.type = 'file';
input.accept = 'image/*';

input.onchange = async (e) => {
  const file = e.target.files[0];
  const formData = new FormData();
  formData.append('image', file);

  try {
    const response = await fetch('/api/image-embedding', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    console.log('Response:', data);
  } catch (error) {
    console.error('Error:', error);
  }
};

input.click();
```

## ログの確認

Next.js開発サーバーのログを確認:

```bash
# ターミナルでyarn devを実行している場合、そのターミナルにログが表示されます

# 正常な場合のログ例:
[Image Embedding API] Starting image embedding request
[Image Embedding API] Mock mode: false
[Image Embedding API] Received file: { name: 'test.jpg', size: 204800, type: 'image/jpeg' }
[Image Embedding API] File converted to buffer, size: 204800
[Image Embedding API] File encoded to base64, length: 273068
[Image Embedding API] Generating embedding...
[Image Embedding API] Embedding generated successfully, dimensions: 1024

# エラー時のログ例:
[Image Embedding API] Error occurred: CredentialsProviderError: Could not load credentials
[Image Embedding API] Error name: CredentialsProviderError
[Image Embedding API] Error code: undefined
[Image Embedding API] AWS credentials error
```

## トラブルシューティングフローチャート

```
画像検索でエラーが発生
         ↓
    エラーコードは?
         ↓
  ┌──────┴──────┐
  │              │
MISSING_      ACCESS_
CREDENTIALS   DENIED
  │              │
  ↓              ↓
.env.local    IAMポリシー
を設定        をアタッチ
  │              │
  └──────┬───────┘
         ↓
   サーバー再起動
         ↓
      解決?
      ↙  ↘
    YES   NO
     │     │
  完了    ↓
       診断スクリプト
       を実行
         ↓
       ログ確認
```

## よくある質問

### Q1: モックモードと本番モードの違いは?

**モックモード**:
- AWS認証情報不要
- ランダムな1024次元ベクトルを生成
- 開発・テスト用

**本番モード**:
- AWS認証情報必須
- 実際のBedrockを呼び出し
- 本番環境用

### Q2: リージョンを変更するとデータは消える?

いいえ、リージョン変更はAPIエンドポイントの変更のみです。OpenSearch内のデータには影響しません。

### Q3: 本番環境でもAWS認証情報が必要?

EC2/ECS環境ではIAMロールを使用するため、環境変数での認証情報設定は不要です。

### Q4: 画像検索の精度が低い場合は?

Titan Image Embeddingsモデルは固定されているため、精度向上には:
1. より高品質な画像を使用
2. 画像の前処理(リサイズ、正規化)を実施
3. 別のBedrockモデル(Amazon Titan Multimodal Embeddings G1など)を検討

## サポート情報

問題が解決しない場合:

1. `/frontend/src/app/api/image-embedding/route.ts`の最新版を確認
2. `yarn install`で依存パッケージを再インストール
3. `.env.local`ファイルの設定を確認
4. 診断スクリプトを実行してログを取得
5. AWS Bedrock Service Healthページを確認: https://status.aws.amazon.com/

## まとめ

画像検索のInternal Server Errorは主に以下の原因で発生します:

1. **認証情報の未設定** → `.env.local`に設定
2. **IAM権限の不足** → `bedrock:InvokeModel`権限を付与
3. **リージョンの非対応** → 利用可能なリージョンに変更
4. **CORSエラー** → 最新コードを使用(既に修正済み)

モックモード機能により、AWS認証情報なしでも開発・テストが可能です。
