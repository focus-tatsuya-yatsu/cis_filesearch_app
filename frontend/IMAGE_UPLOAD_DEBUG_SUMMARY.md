# 画像アップロード機能デバッグガイド - サマリー

## 問題: Internal Server Error (500)

画像アップロード時に発生する500エラーのデバッグ手順とソリューション

---

## 即座に試すべき3つのステップ

### 1. 診断スクリプトを実行 (30秒)
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
chmod +x scripts/diagnose-image-upload.sh
./scripts/diagnose-image-upload.sh
```

### 2. サーバーログを確認 (30秒)
開発サーバーのターミナルで以下を探す:
```
[Image Embedding API] Mock mode: true/false
[Image Embedding API] Error occurred: ...
```

### 3. .env.localを確認 (30秒)
```bash
cat /Users/tatsuya/focus_project/cis_filesearch_app/frontend/.env.local | grep AWS
```

必要な設定:
```env
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=your-actual-key
AWS_SECRET_ACCESS_KEY=your-actual-secret
```

---

## 最も一般的な原因と解決方法

### 原因1: AWS認証情報が未設定（最頻出）

**症状:**
```
[Image Embedding API] Mock mode: true
[MOCK MODE] Using mock embedding instead of AWS Bedrock
```

**解決方法:**
```bash
# .env.localにAWS認証情報を追加
cd frontend
cat >> .env.local << 'EOF'

# AWS Credentials
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
EOF

# 開発サーバーを再起動
yarn dev
```

**認証情報の取得:**
```bash
# AWS CLIから取得
cat ~/.aws/credentials

# または AWS Console → IAM → Users → Security credentials → Create access key
```

---

### 原因2: Bedrockモデルアクセスが無効

**症状:**
```
Access denied to AWS Bedrock
Model not available in this region
```

**解決方法:**
1. **AWS Console → Bedrock**
2. 左メニュー → **"Model access"**
3. **"Manage model access"** ボタンをクリック
4. **"Amazon Titan Multimodal Embeddings G1"** にチェック
5. **"Save changes"** をクリック

注意: モデルアクセスのリクエストには数分かかる場合があります

---

### 原因3: IAM権限不足

**症状:**
```
User is not authorized to perform: bedrock:InvokeModel
```

**解決方法:**

IAMポリシーを追加:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream"
    ],
    "Resource": "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.titan-embed-image-v1"
  }]
}
```

適用方法:
```
AWS Console → IAM → Users → [あなたのユーザー] → Permissions
→ Add permissions → Create inline policy → JSON
```

---

## デバッグツール

### 1. 診断スクリプト
```bash
./scripts/diagnose-image-upload.sh
```
**確認項目:**
- AWS CLI インストール
- AWS認証情報
- Bedrockアクセス権限
- .env.local設定
- 開発サーバー起動状態

### 2. テストページ
```
http://localhost:3000/test-upload
```
**機能:**
- ビジュアルなデバッグUI
- リアルタイムログ表示
- エラー詳細表示

### 3. APIテストスクリプト
```bash
# テスト画像を生成
chmod +x scripts/create-test-image.sh
./scripts/create-test-image.sh

# APIをテスト
node scripts/test-image-upload.js test-images/test-small.jpg
```

---

## ブラウザでのデバッグ手順

### 1. Developer Tools を開く
- **F12**キーを押す
- または右クリック → **検証**

### 2. Consoleタブで確認
```
画像をアップロード → 赤いエラーメッセージを確認
```

### 3. Networkタブで確認
```
1. Networkタブを選択
2. 画像をアップロード
3. "image-embedding" リクエストをクリック
4. Response タブでエラー内容を確認
```

**確認ポイント:**
- Status Code (500であることを確認)
- Response Body のエラーメッセージ
- エラーコード (MISSING_CREDENTIALS, ACCESS_DENIED, etc.)

---

## エラーコード一覧と対処法

| エラーコード | 原因 | 対処法 |
|------------|------|--------|
| `MISSING_IMAGE` | 画像ファイルが選択されていない | 画像を選択して再試行 |
| `FILE_TOO_LARGE` | ファイルサイズが5MB超過 | より小さい画像を使用 |
| `INVALID_FILE_TYPE` | JPEG/PNG以外のファイル | JPEG/PNG形式の画像を使用 |
| `MISSING_CREDENTIALS` | AWS認証情報未設定 | .env.localに認証情報を追加 |
| `ACCESS_DENIED` | IAM権限不足 | IAMポリシーを追加 |
| `MODEL_NOT_AVAILABLE` | Bedrockモデル未有効化 | Model accessで有効化 |
| `BEDROCK_ERROR` | Bedrockサービスエラー | リージョン/認証情報を確認 |
| `INTERNAL_ERROR` | その他のサーバーエラー | サーバーログを確認 |

---

## チェックリスト形式のデバッグ

### 環境設定
```
□ 開発サーバーが起動している (yarn dev)
□ .env.localファイルが存在する
□ AWS_REGION=ap-northeast-1 が設定されている
□ AWS_ACCESS_KEY_ID が設定されている
□ AWS_SECRET_ACCESS_KEY が設定されている
```

### AWS設定
```
□ AWS CLIがインストールされている
□ AWS認証情報が有効 (aws sts get-caller-identity で確認)
□ Bedrockにアクセス可能 (aws bedrock list-foundation-models)
□ Titanモデルアクセスが有効化されている
□ IAMポリシーでbedrock:InvokeModel権限がある
```

### コード
```
□ node_modulesがインストールされている (yarn install)
□ @aws-sdk/client-bedrock-runtime がインストール済み
□ @aws-sdk/credential-provider-node がインストール済み
□ route.tsにエラーがない
□ ImageUpload.tsxにエラーがない
```

### ブラウザ
```
□ Developer Tools (F12) でエラーを確認
□ Console タブにエラーメッセージがある
□ Network タブで /api/image-embedding のステータス確認
□ Response の詳細を確認
```

---

## クイックリファレンス: コマンド集

```bash
# 1. 診断スクリプト実行
cd frontend && ./scripts/diagnose-image-upload.sh

# 2. AWS認証確認
aws sts get-caller-identity

# 3. Bedrockモデル確認
aws bedrock list-foundation-models --region ap-northeast-1 | grep titan

# 4. 環境変数確認
cat .env.local | grep AWS

# 5. 開発サーバー再起動
pkill -f "next dev" && yarn dev

# 6. node_modules再インストール
rm -rf node_modules yarn.lock && yarn install

# 7. Next.jsキャッシュクリア
rm -rf .next && yarn dev

# 8. ポート確認
lsof -i:3000

# 9. テストリクエスト
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@test.jpg" -v

# 10. テスト実行
yarn test src/app/api/image-embedding/route.test.ts
```

---

## モックモードについて

### モックモードとは？
AWS認証情報が設定されていない開発環境で、ダミーのベクトルデータを返すモード

### モックモードの判定条件
```typescript
// 以下の条件がすべて真の場合にモックモードになる
NODE_ENV === 'development' &&
!AWS_ACCESS_KEY_ID &&
!AWS_SECRET_ACCESS_KEY
```

### モックモードの確認方法
サーバーログで以下を確認:
```
[Image Embedding API] Mock mode: true  // モックモード
[Image Embedding API] Mock mode: false // 実際のBedrock使用
```

### モックモードでの動作
- 実際のBedrockは呼び出されない
- 1024次元のランダムベクトルを返す
- 1秒の遅延を入れて実際のAPI呼び出しをシミュレート

### モックモードを無効化するには
.env.localにAWS認証情報を設定:
```env
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

---

## 成功の確認方法

### サーバーログで確認
```
[Image Embedding API] Starting image embedding request
[Image Embedding API] Mock mode: false
[Image Embedding API] Received file: { name: 'test.jpg', size: 12345, type: 'image/jpeg' }
[Image Embedding API] File converted to buffer, size: 12345
[Image Embedding API] File encoded to base64, length: 16460
[Image Embedding API] Generating embedding...
[Image Embedding API] Embedding generated successfully, dimensions: 1024
```

### ブラウザで確認
**Console:**
```
✓ アップロード成功
```

**Network Response:**
```json
{
  "success": true,
  "data": {
    "embedding": [0.123, 0.456, ...],
    "dimensions": 1024,
    "fileName": "test.jpg",
    "fileSize": 12345,
    "fileType": "image/jpeg"
  }
}
```

---

## トラブルシューティングフロー

```
1. サーバーログを確認
   ├─ Mock mode: true
   │  └→ .env.localにAWS認証情報を追加
   │
   ├─ MISSING_CREDENTIALS エラー
   │  └→ AWS認証情報を設定
   │
   ├─ ACCESS_DENIED エラー
   │  └→ IAMポリシーを確認・追加
   │
   ├─ MODEL_NOT_AVAILABLE エラー
   │  └→ Bedrockでモデルアクセスを有効化
   │
   └─ その他のエラー
      └→ エラーメッセージをもとに詳細デバッグ

2. ブラウザで確認
   └─ Developer Tools → Console/Network タブ

3. 診断スクリプトを実行
   └─ ./scripts/diagnose-image-upload.sh

4. テストページで確認
   └─ http://localhost:3000/test-upload

5. それでも解決しない
   └─ DEBUG_IMAGE_UPLOAD.md の詳細ガイドを参照
```

---

## 詳細ドキュメント

より詳しい情報は以下を参照:

1. **QUICK_DEBUG_GUIDE.md** - 5分でできる完全デバッグ手順
2. **DEBUG_IMAGE_UPLOAD.md** - 包括的なデバッグガイド
3. **scripts/diagnose-image-upload.sh** - 環境診断スクリプト
4. **scripts/test-image-upload.js** - APIテストスクリプト
5. **test-upload/page.tsx** - ビジュアルデバッグページ

---

## よくある質問

### Q: モックモードでも動作確認できますか？
A: はい。開発環境では、AWS認証情報がなくてもモックモードで動作します。ただし、ダミーデータが返されます。

### Q: 本番環境でもモックモードになりますか？
A: いいえ。`NODE_ENV=production`の場合、AWS認証情報がなければエラーになります。

### Q: どのリージョンでTitanモデルが使えますか？
A: us-east-1, us-west-2, ap-northeast-1など。AWS Console → Bedrockで確認してください。

### Q: エラーが解決しない場合は？
A: 以下の情報を収集してサポートに連絡:
- 診断スクリプトの出力
- サーバーログ全体
- ブラウザのConsole/Networkのスクリーンショット
- .env.localの内容（秘密情報を除く）

---

## 緊急時のクイックフィックス

### とにかく動かしたい（開発環境）

**オプション1: モックモードで動作確認**
```bash
# .env.localのAWS認証情報をコメントアウト
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...

yarn dev
# → ダミーデータが返される
```

**オプション2: 実際のBedrockを使用**
```bash
# AWS認証情報を設定
echo "AWS_ACCESS_KEY_ID=your-key" >> .env.local
echo "AWS_SECRET_ACCESS_KEY=your-secret" >> .env.local

# Bedrockモデルアクセスを有効化
# AWS Console → Bedrock → Model access

yarn dev
```

---

## サポートリソース

- **AWS Bedrock Documentation**: https://docs.aws.amazon.com/bedrock/
- **Titan Embeddings Model**: https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html
- **AWS SDK for JavaScript**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/

---

作成日: 2025-12-17
最終更新: 2025-12-17
