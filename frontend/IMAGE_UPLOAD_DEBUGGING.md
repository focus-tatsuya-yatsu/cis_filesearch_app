# 画像アップロード機能デバッグ完全ガイド

## 概要

このガイドは、画像アップロード機能で発生するInternal Server Error (500) やその他のエラーをデバッグするための包括的なリソースです。

---

## クイックスタート（3分で確認）

### 1. 診断スクリプトを実行
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
./scripts/diagnose-image-upload.sh
```

### 2. エラーが出た場合
下記の「よくあるエラーと解決方法」を参照

### 3. テストページで動作確認
```
http://localhost:3000/test-upload
```

---

## ドキュメント構成

このデバッグガイドは以下のドキュメントで構成されています:

### 1. IMAGE_UPLOAD_DEBUG_SUMMARY.md ⭐ おすすめ
**最初に読むべきドキュメント**

- エラーコード一覧と対処法
- チェックリスト形式のデバッグ手順
- モックモードの説明
- クイックリファレンス

**こんな時に:**
- とにかく早く問題を解決したい
- エラーコードから対処法を知りたい
- 手順に沿ってデバッグしたい

### 2. QUICK_DEBUG_GUIDE.md
**5分でできる完全デバッグ手順**

- 最速で動かす方法
- エラーパターン別対処法
- デバッグツール使用方法
- トラブルシューティングコマンド集

**こんな時に:**
- システマティックにデバッグしたい
- 各種ツールの使い方を知りたい
- コマンドラインから診断したい

### 3. DEBUG_IMAGE_UPLOAD.md
**包括的なデバッグガイド（詳細版）**

- デバッグ手順の詳細説明
- ブラウザDeveloper Toolsの使い方
- サーバーログの確認方法
- AWS認証情報の設定方法
- 完了チェックリスト

**こんな時に:**
- 詳細な手順を知りたい
- 初めてデバッグする
- すべてのステップを理解したい

### 4. scripts/README.md
**デバッグスクリプトの使い方**

- 診断スクリプトの説明
- テストスクリプトの使い方
- 画像生成スクリプトの使い方

**こんな時に:**
- スクリプトの使い方を知りたい
- 自動診断を実行したい
- テスト画像を生成したい

---

## デバッグツール

### 1. 診断スクリプト（自動診断）
```bash
./scripts/diagnose-image-upload.sh
```

**確認項目:**
- AWS CLI インストール
- AWS認証情報
- Bedrockアクセス権限
- .env.local設定
- 開発サーバー状態
- npmパッケージ

### 2. テストページ（ビジュアルデバッグ）
```
http://localhost:3000/test-upload
```

**機能:**
- 画像アップロードUI
- リアルタイムログ表示
- エラー詳細表示
- デバッグ情報表示

### 3. APIテストスクリプト（直接テスト）
```bash
# テスト画像を生成
./scripts/create-test-image.sh

# APIをテスト
node scripts/test-image-upload.js test-images/test-small.jpg
```

**機能:**
- APIエンドポイントへの直接リクエスト
- レスポンス詳細表示
- エラー診断

---

## よくあるエラーと解決方法

### エラー1: AWS認証情報エラー
**エラーメッセージ:**
```
AWS credentials not configured
Missing credentials in config
```

**解決方法:**
```bash
# .env.localにAWS認証情報を追加
cat >> /Users/tatsuya/focus_project/cis_filesearch_app/frontend/.env.local << 'EOF'

AWS_ACCESS_KEY_ID=your-actual-key
AWS_SECRET_ACCESS_KEY=your-actual-secret
EOF

# 開発サーバーを再起動
yarn dev
```

### エラー2: Bedrockアクセスエラー
**エラーメッセージ:**
```
Access denied to AWS Bedrock
User is not authorized to perform: bedrock:InvokeModel
```

**解決方法:**
1. AWS Console → Bedrock → Model access
2. "Manage model access" をクリック
3. "Amazon Titan Multimodal Embeddings G1" にチェック
4. "Save changes"

### エラー3: モデル未対応リージョン
**エラーメッセージ:**
```
Model not available in this region
```

**解決方法:**
```bash
# .env.localのリージョンを変更
AWS_REGION=us-east-1  # または us-west-2
```

---

## デバッグフロー

```
問題発生
  ↓
診断スクリプトを実行
  ↓
エラー内容を確認
  ↓
┌─────────────────────────────┐
│ AWS認証情報エラー           │ → .env.localに追加
├─────────────────────────────┤
│ Bedrockアクセスエラー       │ → Model accessで有効化
├─────────────────────────────┤
│ IAM権限エラー               │ → IAMポリシー追加
├─────────────────────────────┤
│ モデル未対応リージョン      │ → リージョン変更
├─────────────────────────────┤
│ その他のエラー              │ → 詳細ガイド参照
└─────────────────────────────┘
  ↓
修正実施
  ↓
開発サーバー再起動
  ↓
テストページで動作確認
  ↓
APIテストスクリプトで確認
  ↓
完了
```

---

## チェックリスト

### 初回セットアップ
```
□ Node.js 18以降がインストールされている
□ yarn install が完了している
□ .env.localファイルを作成した
□ AWS認証情報を設定した
□ 開発サーバーが起動している
```

### エラー発生時
```
□ 診断スクリプトを実行した
□ サーバーログを確認した
□ ブラウザのDeveloper Toolsで確認した
□ .env.localの内容を確認した
□ AWS認証情報が有効か確認した
```

### 修正後
```
□ 開発サーバーを再起動した
□ ブラウザのキャッシュをクリアした
□ テストページで動作確認した
□ APIテストスクリプトで確認した
```

---

## ファイル構成

```
frontend/
├── IMAGE_UPLOAD_DEBUGGING.md          # このファイル（メインガイド）
├── IMAGE_UPLOAD_DEBUG_SUMMARY.md      # サマリー版（おすすめ）
├── QUICK_DEBUG_GUIDE.md               # 5分デバッグガイド
├── DEBUG_IMAGE_UPLOAD.md              # 詳細版
│
├── scripts/
│   ├── README.md                      # スクリプト使用方法
│   ├── diagnose-image-upload.sh       # 診断スクリプト ⭐
│   ├── test-image-upload.js           # APIテストスクリプト
│   └── create-test-image.sh           # テスト画像生成
│
├── src/app/
│   ├── test-upload/
│   │   └── page.tsx                   # テストページ ⭐
│   │
│   └── api/image-embedding/
│       ├── route.ts                   # APIルート実装
│       └── route.test.ts              # 単体テスト
│
└── test-images/                       # テスト用画像（生成される）
    └── test-small.jpg
```

---

## 推奨デバッグ順序

### レベル1: 基本確認（3分）
1. 診断スクリプトを実行
2. エラー内容を確認
3. IMAGE_UPLOAD_DEBUG_SUMMARY.md で対処法を確認

### レベル2: 詳細確認（10分）
1. QUICK_DEBUG_GUIDE.md の手順に従う
2. テストページで動作確認
3. ブラウザのDeveloper Toolsで確認

### レベル3: 徹底診断（30分）
1. DEBUG_IMAGE_UPLOAD.md の全手順を実施
2. サーバーログを詳細に確認
3. AWS設定を一つずつ確認
4. APIテストスクリプトで確認

---

## トラブルシューティングコマンド

```bash
# 1. 環境診断
./scripts/diagnose-image-upload.sh

# 2. AWS認証確認
aws sts get-caller-identity

# 3. Bedrockモデル確認
aws bedrock list-foundation-models --region ap-northeast-1

# 4. 環境変数確認
cat .env.local | grep AWS

# 5. 開発サーバー再起動
pkill -f "next dev" && yarn dev

# 6. キャッシュクリア
rm -rf .next && yarn dev

# 7. APIテスト
node scripts/test-image-upload.js test-images/test-small.jpg

# 8. 単体テスト
yarn test src/app/api/image-embedding/route.test.ts
```

---

## FAQ

### Q1: どのドキュメントから読めばいいですか？
A: **IMAGE_UPLOAD_DEBUG_SUMMARY.md** から始めることをおすすめします。

### Q2: モックモードとは何ですか？
A: AWS認証情報が設定されていない開発環境で、ダミーデータを返すモードです。

### Q3: 本番環境ではどうすればいいですか？
A: IAMロールを使用することを推奨します。環境変数でアクセスキーを設定する方法もあります。

### Q4: エラーが解決しない場合は？
A: 以下の情報を収集してサポートに連絡してください:
- 診断スクリプトの出力
- サーバーログ全体
- ブラウザのConsole/Networkのスクリーンショット
- .env.localの内容（秘密情報を除く）

---

## 緊急時のクイックフィックス

### 開発環境で今すぐ動かしたい

**方法1: モックモードで動作確認**
```bash
# .env.localのAWS認証情報をコメントアウト
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...

yarn dev
```
→ ダミーデータが返されますが、機能確認は可能

**方法2: 実際のBedrockを使用**
```bash
# AWS認証情報を設定
echo "AWS_ACCESS_KEY_ID=your-key" >> .env.local
echo "AWS_SECRET_ACCESS_KEY=your-secret" >> .env.local

# Bedrockモデルアクセスを有効化（AWS Console）

yarn dev
```

---

## サポートリソース

- **AWS Bedrock Documentation**: https://docs.aws.amazon.com/bedrock/
- **Titan Embeddings**: https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html
- **AWS SDK for JavaScript**: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/

---

## 更新履歴

- 2025-12-17: 初版作成
  - 診断スクリプト追加
  - テストページ追加
  - 包括的なドキュメント整備

---

作成日: 2025-12-17
バージョン: 1.0.0
