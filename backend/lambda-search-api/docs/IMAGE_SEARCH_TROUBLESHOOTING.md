# 画像検索機能 - トラブルシューティングガイド

## 問題: "Internal server error"が発生する

### 発生状況

- ファイル: `01377.jpg` (0.01MB)
- 症状: 画像プレビューは表示されるが、アップロード時にエラー
- エラーメッセージ: "Internal server error"

### 根本原因

#### 1. AWS認証情報の欠如

開発環境（`localhost:3000`）でAWS Bedrockにアクセスするには、以下の環境変数が必要:

```bash
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_REGION=ap-northeast-1
```

これらが設定されていない場合、AWS SDKの`defaultProvider()`が認証情報を取得できず、エラーが発生します。

#### 2. OpenSearchのVPCエンドポイント問題と同様

OpenSearchと同様に、AWS Bedrockへのアクセスがローカル開発環境から制限されています。

### 修正内容

以下の修正を実施しました:

#### 1. モックモードの実装

`/frontend/src/app/api/image-embedding/route.ts` に以下を追加:

```typescript
/**
 * モックモードの判定（開発環境かつAWS認証情報がない場合）
 */
const USE_MOCK_MODE =
  process.env.NODE_ENV === 'development' &&
  !process.env.AWS_ACCESS_KEY_ID &&
  !process.env.AWS_SECRET_ACCESS_KEY;

/**
 * モック用の画像埋め込みベクトル生成
 */
function generateMockEmbedding(): number[] {
  // 1024次元のランダムベクトルを生成
  const embedding = Array.from({ length: 1024 }, () => Math.random() * 2 - 1);
  console.log('[MOCK MODE] Generated mock embedding vector (1024 dimensions)');
  return embedding;
}
```

#### 2. 詳細なエラーログの追加

サーバーサイドで以下のログを追加:

```typescript
console.log('[Image Embedding API] Starting image embedding request');
console.log('[Image Embedding API] Mock mode:', USE_MOCK_MODE);
console.log('[Image Embedding API] Received file:', {
  name: imageFile.name,
  size: imageFile.size,
  type: imageFile.type,
});
```

#### 3. クライアント側のエラー表示改善

`/frontend/src/lib/api/imageSearch.ts` にデバッグログを追加:

```typescript
console.log('[Image Search API] Uploading image:', {
  name: imageFile.name,
  size: imageFile.size,
  type: imageFile.type,
});

console.log('[Image Search API] Response status:', response.status);
console.log('[Image Search API] Response data:', data);
```

#### 4. きめ細かいエラーハンドリング

以下のエラーケースを個別に処理:

- `MISSING_CREDENTIALS`: AWS認証情報が設定されていない
- `ACCESS_DENIED`: IAM権限不足
- `MODEL_NOT_AVAILABLE`: Bedrockモデルがリージョンで利用不可
- `BEDROCK_ERROR`: その他のBedrockサービスエラー

#### 5. CORSヘッダーの追加

すべてのレスポンスにCORSヘッダーを含めるヘルパー関数を実装:

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

### 動作確認方法

#### 開発環境（モックモード）

1. AWS認証情報を設定せずに開発サーバーを起動:

```bash
cd frontend
yarn dev
```

2. ブラウザで画像検索を試す:
   - 画像をアップロード
   - 以下のログが表示されることを確認:

**サーバーログ:**
```
[Image Embedding API] Mock mode: true
[MOCK MODE] Using mock embedding instead of AWS Bedrock
[MOCK MODE] Generated mock embedding vector (1024 dimensions)
```

**ブラウザコンソール:**
```
[Image Search API] Response status: 200
[Image Search API] Upload successful, embedding dimensions: 1024
```

#### 本番環境（実運用モード）

1. `.env.local` にAWS認証情報を追加:

```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-northeast-1
```

2. 開発サーバーを再起動:

```bash
yarn dev
```

3. 画像をアップロード:
   - 実際のAWS Bedrockが呼び出される
   - 以下のログが表示される:

```
[Image Embedding API] Mock mode: false
[Bedrock] Sending request to Bedrock...
[Image Embedding API] Embedding generated successfully, dimensions: 1024
```

### トラブルシューティングチェックリスト

#### エラー: "Internal server error"

- [ ] サーバーログでエラーの詳細を確認
- [ ] ブラウザのNetworkタブでAPIレスポンスを確認
- [ ] モックモードが有効になっているか確認
- [ ] 画像ファイルが5MB以下か確認
- [ ] ファイル形式がJPEG/PNGか確認

#### エラー: "AWS Bedrock service error"

- [ ] `.env.local` にAWS認証情報が設定されているか
- [ ] IAMユーザーに `bedrock:InvokeModel` 権限があるか
- [ ] AWS_REGIONが正しく設定されているか（`ap-northeast-1`）
- [ ] Bedrock Titan Embeddingsがリージョンで利用可能か

#### エラー: "Access denied to AWS Bedrock"

- [ ] IAMユーザー/ロールに以下の権限を追加:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-image-v1"
    }
  ]
}
```

#### エラー: "Bedrock model not available in this region"

- [ ] Bedrock Titan Embeddingsが `ap-northeast-1` で利用可能か確認
- [ ] 別のリージョン（`us-east-1`, `us-west-2`など）を試す

### 既知の制限事項

1. **画像検索の実装が未完了**
   - 画像のベクトル化は動作するが、実際の検索機能は未実装
   - Lambda ベクトル検索APIの実装が必要

2. **OpenSearchマッピングの未設定**
   - `image_embedding` フィールド（dense_vector）がまだ作成されていない
   - インデックスの再作成が必要

3. **モックモードの制限**
   - ダミーベクトルなので実際の画像内容とは無関係
   - 検索結果はランダムになる

### 次のステップ

1. **Lambda ベクトル検索API実装** (Phase 2)
   - OpenSearchでコサイン類似度検索
   - 信頼度90%以上のフィルタリング

2. **OpenSearchマッピング設定** (Phase 1)
   - `image_embedding` フィールド追加
   - インデックス再作成スクリプト

3. **フロントエンド統合** (Phase 3)
   - `SearchInterface.tsx` の `handleImageSearch` 実装
   - API呼び出しとエラーハンドリング

### 関連ドキュメント

- [Lambda Search API README](/backend/lambda-search-api/README.md#13-画像検索機能の実装)
- [画像検索実装ガイド](/docs/requirement.md)
- [API仕様書](/docs/api-specification.md)

---

**作成日**: 2025-12-17
**最終更新**: 2025-12-17
**作成者**: Claude Code
