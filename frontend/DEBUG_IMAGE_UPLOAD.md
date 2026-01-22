# 画像アップロード機能デバッグガイド

## 概要

画像アップロード機能で発生しているInternal Server Error (500)のデバッグ手順書

## 症状

- 画像選択後にエラー発生
- プレビューは正常に表示される
- APIコール時に500エラーが返される

## デバッグ手順

### 1. ブラウザのDeveloper Toolsでエラー確認

#### 1.1 Consoleタブを開く

```
1. ブラウザでF12キーを押す
2. Consoleタブを選択
3. 画像をアップロード
4. 赤色のエラーメッセージを確認
```

**確認ポイント:**

- エラーメッセージの内容
- スタックトレース
- 警告メッセージ

#### 1.2 Networkタブでリクエスト詳細を確認

```
1. Networkタブを選択
2. 画像をアップロード
3. "image-embedding" リクエストを選択
4. 以下の情報を確認:
   - Status Code (500であることを確認)
   - Request Headers
   - Request Payload (FormData)
   - Response Headers
   - Response Body
```

**チェックリスト:**

```
□ Status Code: 500
□ Request Method: POST
□ Content-Type: multipart/form-data
□ Response Body にエラーメッセージが含まれているか
```

### 2. サーバーログの確認

#### 2.1 Next.js開発サーバーのターミナル出力を確認

```bash
# ターミナルでNext.jsの開発サーバーログを確認
# エラー発生時のスタックトレースを探す
```

**確認すべきエラー:**

- `AWS SDK` 関連のエラー
- `Credentials` 関連のエラー
- `Bedrock` 関連のエラー
- `TypeError` や `ReferenceError`

#### 2.2 詳細なログを出力

```bash
# 開発サーバーを再起動してログレベルを上げる
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
NODE_OPTIONS='--trace-warnings' yarn dev
```

### 3. AWS認証情報の確認

#### 3.1 環境変数の確認

```bash
# .env.localファイルでAWS認証情報を確認
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
cat .env.local | grep AWS
```

**必要な環境変数:**

```env
AWS_REGION=ap-northeast-1
# 以下のいずれかが必要:
# 方法1: アクセスキーを使用
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

# 方法2: プロファイルを使用
AWS_PROFILE=default
```

#### 3.2 AWS CLIでの認証確認

```bash
# AWS CLIがインストールされているか確認
aws --version

# 認証情報が正しく設定されているか確認
aws sts get-caller-identity

# Bedrockへのアクセス権限を確認
aws bedrock list-foundation-models --region ap-northeast-1
```

### 4. APIエンドポイントのテスト

#### 4.1 curlコマンドでの直接テスト

```bash
# テスト用の画像を準備
# 任意のJPEG/PNG画像を使用

# APIエンドポイントにリクエスト
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@/path/to/test-image.jpg" \
  -v

# レスポンスを確認
# 成功: {"success":true,"data":{...}}
# エラー: {"error":"...","code":"..."}
```

#### 4.2 テストスクリプトの実行

```bash
# テストスクリプトを実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
node scripts/test-image-upload.js
```

### 5. 最小限の再現コード作成

#### 5.1 シンプルなテストページ作成

```bash
# テストページを作成済み
# /Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/app/test-upload/page.tsx
```

#### 5.2 ブラウザでテストページにアクセス

```
http://localhost:3000/test-upload
```

### 6. エラーパターンと対処方法

#### エラーパターン1: AWS認証エラー

**エラーメッセージ:**

```
Missing credentials in config
```

**対処方法:**

```bash
# .env.localにAWS認証情報を追加
echo "AWS_ACCESS_KEY_ID=your-key" >> .env.local
echo "AWS_SECRET_ACCESS_KEY=your-secret" >> .env.local

# または、AWS CLIで設定
aws configure
```

#### エラーパターン2: Bedrockアクセス権限エラー

**エラーメッセージ:**

```
User is not authorized to perform: bedrock:InvokeModel
```

**対処方法:**

```bash
# IAMポリシーを確認・追加
# AWS Console → IAM → Users → Policies
# 必要なポリシー: BedrockFullAccess または以下のカスタムポリシー:
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

#### エラーパターン3: Bedrockモデルがリージョンで利用不可

**エラーメッセージ:**

```
Model not found or not available in this region
```

**対処方法:**

```bash
# Bedrockでモデルアクセスを有効化
# AWS Console → Bedrock → Model access → Manage model access
# "Amazon Titan Multimodal Embeddings" にチェックを入れて保存

# または、リージョンを変更
# .env.localのAWS_REGIONを "us-east-1" に変更
```

#### エラーパターン4: ファイルサイズ制限

**エラーメッセージ:**

```
Image file size must be less than 5MB
```

**対処方法:**

```
より小さいサイズの画像を使用
または、route.tsのファイルサイズ制限を調整
```

#### エラーパターン5: CORS エラー

**エラーメッセージ:**

```
CORS policy: No 'Access-Control-Allow-Origin' header
```

**対処方法:**

```
開発サーバーを再起動
next.config.jsでCORS設定を確認
```

### 7. ログ収集用のデバッグモード

#### 7.1 詳細ログを有効化

```typescript
// /api/image-embedding/route.ts の先頭に追加
console.log('=== Image Embedding API Debug ===')
console.log('Environment:', process.env.NODE_ENV)
console.log('AWS Region:', process.env.AWS_REGION)
console.log('Has AWS Credentials:', !!process.env.AWS_ACCESS_KEY_ID)
```

#### 7.2 リクエスト/レスポンスのログ

```typescript
// uploadFile関数内に追加
console.log('Request URL:', '/api/image-embedding')
console.log('File name:', file.name)
console.log('File size:', file.size)
console.log('File type:', file.type)

// レスポンス受信後
console.log('Response status:', response.status)
console.log('Response data:', data)
```

### 8. 簡易診断スクリプト

以下のコマンドで環境を自動診断:

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
chmod +x scripts/diagnose-image-upload.sh
./scripts/diagnose-image-upload.sh
```

診断内容:

- AWS CLI インストール確認
- AWS認証情報確認
- Bedrockアクセス権限確認
- Next.js開発サーバーの起動状態
- .env.localの設定確認

### 9. 次のステップ

1. **まず最初に確認すべきこと:**
   - ターミナルのサーバーログ
   - ブラウザのNetworkタブのResponse
   - .env.localのAWS認証情報

2. **問題の切り分け:**
   - ローカル環境の問題 vs AWS接続の問題
   - 認証の問題 vs コードの問題
   - フロントエンドの問題 vs バックエンドの問題

3. **修正後の確認:**
   - 開発サーバーを再起動
   - ブラウザのキャッシュをクリア
   - 別の画像ファイルで再テスト

## トラブルシューティングチートシート

### クイック診断コマンド

```bash
# 1. AWS認証確認
aws sts get-caller-identity

# 2. Bedrockモデル一覧取得
aws bedrock list-foundation-models --region ap-northeast-1 | grep titan-embed

# 3. 環境変数確認
cd frontend && cat .env.local | grep -E "(AWS|BEDROCK)"

# 4. Next.js開発サーバーログ確認
# ターミナルで開発サーバーが起動しているタブを確認

# 5. テストリクエスト送信
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@test.jpg" \
  -H "Content-Type: multipart/form-data"
```

### よくある原因トップ5

1. AWS認証情報が未設定または無効
2. Bedrockモデルアクセスが有効化されていない
3. IAMポリシーでInvokeModel権限がない
4. AWS_REGIONが誤っている
5. ファイルサイズが大きすぎる

### 問題解決の優先順位

1. サーバーログのエラーメッセージを確認
2. AWS認証情報を確認・設定
3. Bedrockのモデルアクセスを確認
4. IAMポリシーを確認・追加
5. コードのデバッグログを追加

## 完了チェックリスト

デバッグ完了時に以下を確認:

```
□ エラーの原因を特定した
□ 修正を実施した
□ 開発サーバーを再起動した
□ 画像アップロードが成功する
□ ベクトルデータが正しく返される
□ エラーハンドリングが適切に動作する
□ ログにエラーが出ていない
□ 本番環境でも動作することを確認した
```

## 追加リソース

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [Next.js API Routes](https://nextjs.org/docs/api-routes/introduction)
