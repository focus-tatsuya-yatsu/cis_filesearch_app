# 画像アップロード機能 クイックデバッグガイド

## 最も一般的な問題と即座の解決方法

### 問題1: AWS認証情報エラー
**エラーメッセージ:**
```
AWS Bedrock service error
Missing credentials in config
```

**即座の解決方法:**
```bash
# .env.localにAWS認証情報を追加
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# 以下を.env.localに追加
cat >> .env.local << 'EOF'

# AWS Credentials (for Bedrock access)
AWS_ACCESS_KEY_ID=your-actual-access-key-id
AWS_SECRET_ACCESS_KEY=your-actual-secret-access-key
EOF

# 開発サーバーを再起動
yarn dev
```

**認証情報の取得方法:**
```bash
# AWS CLIの設定から取得
cat ~/.aws/credentials

# または新しいアクセスキーを作成
# AWS Console → IAM → Users → Security credentials → Create access key
```

---

### 問題2: モックモードで動作している
**確認方法:**
```
開発サーバーのログに以下が表示される:
[Image Embedding API] Mock mode: true
[MOCK MODE] Using mock embedding instead of AWS Bedrock
```

**原因:**
- .env.localにAWS_ACCESS_KEY_IDまたはAWS_SECRET_ACCESS_KEYが設定されていない

**解決方法:**
問題1の解決方法を参照

---

### 問題3: Bedrockモデルアクセスエラー
**エラーメッセージ:**
```
User is not authorized to perform: bedrock:InvokeModel
Model not found or not available in this region
```

**即座の解決方法:**

**ステップ1: Bedrockコンソールでモデルアクセスを有効化**
```
1. AWS Console → Amazon Bedrock
2. 左メニュー → "Model access"
3. "Manage model access" ボタンをクリック
4. "Amazon Titan Multimodal Embeddings G1" にチェック
5. "Save changes" をクリック
```

**ステップ2: IAMポリシーを追加**
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
      "Resource": "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.titan-embed-image-v1"
    }
  ]
}
```

適用方法:
```
AWS Console → IAM → Users → [あなたのユーザー] → Permissions → Add permissions
→ Create inline policy → JSON タブに上記をペースト
```

---

## 5分でできる完全デバッグ手順

### ステップ1: 環境診断スクリプトを実行 (1分)
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
chmod +x scripts/diagnose-image-upload.sh
./scripts/diagnose-image-upload.sh
```

### ステップ2: ブラウザでエラー内容を確認 (1分)
```
1. http://localhost:3000/test-upload にアクセス
2. F12キーでDeveloper Toolsを開く
3. Consoleタブを開く
4. 画像をアップロード
5. 赤いエラーメッセージを確認
```

### ステップ3: サーバーログを確認 (1分)
```
開発サーバーが起動しているターミナルで以下を確認:
- [Image Embedding API] で始まるログ
- エラースタックトレース
- Mock mode の表示
```

### ステップ4: 問題を特定して修正 (2分)
下記の「エラーパターン別対処法」を参照

---

## エラーパターン別対処法

### パターンA: "Mock mode: true" が表示される
**対処法:**
```bash
# .env.localを編集
vi .env.local

# 以下を追加（実際の値に置き換え）
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# 保存後、開発サーバーを再起動
```

### パターンB: "Missing credentials in config"
**対処法:**
```bash
# AWS CLIで認証情報を設定
aws configure

# または環境変数を設定
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret

# 開発サーバーを再起動
yarn dev
```

### パターンC: "User is not authorized"
**対処法:**
```
AWS Console → IAM → Users → Permissions
必要なポリシー: BedrockFullAccess
または上記の「問題3」のカスタムポリシーを追加
```

### パターンD: "Model not found"
**対処法:**
```
AWS Console → Bedrock → Model access
→ Manage model access
→ "Amazon Titan Multimodal Embeddings G1" をチェック
→ Save changes

注意: モデルアクセスのリクエストには数分かかる場合があります
```

### パターンE: "CORS policy" エラー
**対処法:**
```bash
# 開発サーバーを再起動
yarn dev

# それでも解決しない場合、ブラウザのキャッシュをクリア
```

### パターンF: "File too large"
**対処法:**
```
より小さいサイズの画像を使用（5MB以下）

または、制限を変更:
frontend/src/app/api/image-embedding/route.ts
117行目: if (imageFile.size > 5 * 1024 * 1024)
→ 数値を大きくする
```

---

## デバッグツール使用方法

### ツール1: 診断スクリプト
```bash
cd frontend
./scripts/diagnose-image-upload.sh
```
**出力:** AWS設定、認証情報、Bedrockアクセス権限をチェック

### ツール2: テストスクリプト
```bash
cd frontend
node scripts/test-image-upload.js test-image.jpg
```
**出力:** APIの直接テスト、詳細なレスポンス表示

### ツール3: テストページ
```
ブラウザで http://localhost:3000/test-upload にアクセス
```
**機能:** ビジュアルなデバッグUI、リアルタイムログ表示

---

## チェックリスト形式のデバッグフロー

### 開始前の確認
```
□ 開発サーバーが起動している (yarn dev)
□ ブラウザでアプリにアクセスできる
□ .env.localファイルが存在する
```

### AWS設定の確認
```
□ AWS CLIがインストールされている (aws --version)
□ AWS認証情報が設定されている (aws sts get-caller-identity)
□ Bedrockにアクセスできる (aws bedrock list-foundation-models)
□ .env.localにAWS_ACCESS_KEY_IDがある
□ .env.localにAWS_SECRET_ACCESS_KEYがある
□ .env.localにAWS_REGION=ap-northeast-1がある
```

### Bedrockの確認
```
□ AWS Console → Bedrock → Model accessでTitanモデルが有効
□ IAMポリシーでbedrock:InvokeModel権限がある
□ リージョンがap-northeast-1に設定されている
```

### コードの確認
```
□ route.tsにエラーが表示されていない
□ ImageUpload.tsxにエラーが表示されていない
□ npm パッケージがインストールされている (yarn install)
```

### ブラウザの確認
```
□ Developer Tools (F12) でエラーを確認
□ Console タブにエラーメッセージがある → 内容を確認
□ Network タブで /api/image-embedding のステータスコードを確認
□ Response タブでエラー詳細を確認
```

### サーバーログの確認
```
□ ターミナルで開発サーバーのログを確認
□ [Image Embedding API] で始まるログを探す
□ Mock mode の値を確認（falseであるべき）
□ エラースタックトレースを確認
```

---

## 最速で動かす方法（開発環境）

### オプション1: モックモードで動作確認
```bash
# AWS認証情報を設定せずに動作
# 自動的にモックモードになる
# ダミーのベクトルデータが返される

# .env.localのAWS認証情報をコメントアウト
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...

yarn dev
```

### オプション2: 実際のBedrockを使用
```bash
# AWS認証情報を設定
echo "AWS_ACCESS_KEY_ID=your-key" >> .env.local
echo "AWS_SECRET_ACCESS_KEY=your-secret" >> .env.local

# Bedrockモデルアクセスを有効化
# AWS Console → Bedrock → Model access

# 開発サーバー起動
yarn dev
```

---

## トラブルシューティングコマンド集

```bash
# 1. AWS認証確認
aws sts get-caller-identity

# 2. Bedrockモデル確認
aws bedrock list-foundation-models --region ap-northeast-1 | grep titan

# 3. 環境変数確認
cd frontend && cat .env.local | grep AWS

# 4. 開発サーバー再起動
pkill -f "next dev" && yarn dev

# 5. node_modules再インストール
rm -rf node_modules yarn.lock && yarn install

# 6. Next.jsキャッシュクリア
rm -rf .next && yarn dev

# 7. ポート3000を使用しているプロセスを確認
lsof -i:3000

# 8. テストリクエスト送信
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@test.jpg"
```

---

## よくある質問（FAQ）

### Q1: モックモードとは何ですか？
A: AWS認証情報が設定されていない開発環境で、ダミーデータを返すモードです。実際のBedrockは呼び出されません。

### Q2: 本番環境でもモックモードになりますか？
A: いいえ。NODE_ENV=productionの場合、AWS認証情報がなければエラーになります。

### Q3: どのAWS認証方法が推奨ですか？
A:
- ローカル開発: .env.localにアクセスキーを設定
- EC2/ECS: IAMロールを使用（推奨）
- CI/CD: 環境変数またはシークレット管理サービス

### Q4: Titanモデルが利用できるリージョンは？
A: us-east-1, us-west-2, ap-northeast-1など。AWS Console → Bedrockで確認してください。

### Q5: エラーが解決しない場合は？
A:
1. DEBUG_IMAGE_UPLOAD.md の詳細ガイドを参照
2. サーバーログをすべてコピー
3. ブラウザのConsole/Networkタブのスクリーンショットを取る
4. 診断スクリプトの出力を保存

---

## 成功の確認方法

以下がすべて表示されれば成功です:

### サーバーログ:
```
[Image Embedding API] Starting image embedding request
[Image Embedding API] Mock mode: false
[Image Embedding API] Received file: { name: 'test.jpg', size: 12345, type: 'image/jpeg' }
[Image Embedding API] File converted to buffer, size: 12345
[Image Embedding API] File encoded to base64, length: 16460
[Image Embedding API] Generating embedding...
[Image Embedding API] Embedding generated successfully, dimensions: 1024
```

### ブラウザ Console:
```
✓ アップロード成功
```

### Network タブ:
```
Status: 200 OK
Response: { "success": true, "data": { "embedding": [...], "dimensions": 1024, ... } }
```

---

## 緊急連絡先・リソース

- **AWS Bedrock Documentation**: https://docs.aws.amazon.com/bedrock/
- **AWS SDK for JavaScript v3**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/
- **Titan Embeddings Model Card**: https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html

---

## このガイドで解決しない場合

以下の情報を収集してください:

1. **診断スクリプトの出力:**
   ```bash
   ./scripts/diagnose-image-upload.sh > diagnosis.txt
   ```

2. **サーバーログ:**
   開発サーバーのターミナル出力をすべてコピー

3. **ブラウザのエラー:**
   - Console タブのスクリーンショット
   - Network タブの /api/image-embedding レスポンス

4. **環境情報:**
   ```bash
   node --version
   yarn --version
   aws --version
   cat .env.local
   ```

5. **詳細デバッグガイド:**
   DEBUG_IMAGE_UPLOAD.md を参照してください
