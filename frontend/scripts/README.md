# テスト・デバッグスクリプト集

画像検索機能のテスト・デバッグ用スクリプト

## スクリプト一覧

### 統合テストスクリプト（新規追加）

#### quick-test-image-search.sh
画像検索機能の基本動作を迅速に確認するクイックテストスクリプト（約1分）

**実行方法:**
```bash
# 自動でテスト画像を検出して実行
./scripts/quick-test-image-search.sh

# テスト画像を指定して実行
./scripts/quick-test-image-search.sh /path/to/your/test-image.jpg
```

**確認項目:**
- サーバー起動確認
- 画像ベクトル化API（`/api/image-embedding`）
- 画像検索API（`/api/search`）
- レスポンス形式とステータスコード
- ベクトル次元数（1024次元）の検証

**用途:**
- 開発中の動作確認
- コミット前の疎通確認
- CI/CDパイプライン

---

#### test-image-search.sh
包括的な統合テストスクリプト（約5分） - 正常系・異常系・エラーハンドリングを含む

**実行方法:**
```bash
# モックモードでテスト（デフォルト）
./scripts/test-image-search.sh mock

# 本番モードでテスト（AWS Bedrock使用）
./scripts/test-image-search.sh prod
```

**テスト内容:**
1. 前提条件チェック
2. 画像ベクトル化API - 正常系
3. 画像ベクトル化API - ファイルサイズエラー（6MB超過）
4. 画像ベクトル化API - ファイル形式エラー（BMP等）
5. 画像検索API - 正常系
6. 画像検索API - バリデーションエラー
7. CORSヘッダー確認

**ログファイル:**
- `/tmp/cis-image-search-test-YYYYMMDD-HHMMSS.log`

**用途:**
- リリース前の最終確認
- リグレッションテスト
- QAテスト

---

### デバッグスクリプト

### 1. diagnose-image-upload.sh
環境診断スクリプト - 画像アップロード機能の動作に必要な設定をチェック

**実行方法:**
```bash
./scripts/diagnose-image-upload.sh
```

**確認項目:**
- AWS CLI インストール状態
- AWS 認証情報の有効性
- Bedrock アクセス権限
- .env.local の設定内容
- Next.js 開発サーバーの起動状態
- 必要なnpmパッケージのインストール状態

**出力例:**
```
========================================
画像アップロード機能診断スクリプト
========================================

1. AWS CLI インストール確認
----------------------------------------
✓ AWS CLI インストール済み: aws-cli/2.13.0

2. AWS 認証情報確認
----------------------------------------
✓ AWS 認証情報が正しく設定されています
   Account ID: 123456789012
   User ID: AIDAI...

...

========================================
診断結果サマリー
========================================
成功: 8
警告: 1
失敗: 0
```

---

### 2. test-image-upload.js
APIエンドポイント直接テストスクリプト

**実行方法:**
```bash
node scripts/test-image-upload.js <画像ファイルパス>
```

**例:**
```bash
# テスト画像を使用
node scripts/test-image-upload.js test-images/test-small.jpg

# 任意の画像を使用
node scripts/test-image-upload.js /path/to/your/image.jpg
```

**出力例:**
```
========================================
画像アップロードAPIテスト
========================================

設定:
  API URL: http://localhost:3000/api/image-embedding
  画像ファイル: test-images/test-small.jpg

リクエスト送信中...

ステータスコード: 200 OK

レスポンスヘッダー:
  content-type: application/json
  access-control-allow-origin: *

レスポンスボディ:
{
  "success": true,
  "data": {
    "embedding": [...],
    "dimensions": 1024,
    "fileName": "test-small.jpg",
    "fileSize": 12345,
    "fileType": "image/jpeg"
  }
}

✓ テスト成功！

埋め込みベクトル情報:
  次元数: 1024
  ファイル名: test-small.jpg
  ファイルサイズ: 12345 bytes
  ファイルタイプ: image/jpeg
```

---

### 3. create-test-image.sh
テスト用画像生成スクリプト

**実行方法:**
```bash
./scripts/create-test-image.sh
```

**機能:**
- macOSの`sips`コマンドまたは`ImageMagick`を使用してテスト画像を生成
- 利用できない場合は、プレースホルダー画像をダウンロード
- 生成された画像は `test-images/` ディレクトリに保存

**出力:**
```
テスト用画像を生成しています...
sips を使用して画像を生成します
✓ ./test-images/test-small.jpg を作成しました

生成された画像:
  ファイル: ./test-images/test-small.jpg
  サイズ: 123KB (126976 bytes)

この画像を使用してAPIテストを実行できます:
  node scripts/test-image-upload.js ./test-images/test-small.jpg
```

---

## 使用フロー

### 初回セットアップ時
```bash
# 1. 環境診断
./scripts/diagnose-image-upload.sh

# 2. 問題があれば修正（.env.localの設定など）

# 3. テスト画像を生成
./scripts/create-test-image.sh

# 4. APIテスト
node scripts/test-image-upload.js test-images/test-small.jpg
```

### 問題発生時
```bash
# 1. まず診断スクリプトを実行
./scripts/diagnose-image-upload.sh

# 2. 出力された警告/エラーを確認

# 3. 修正後、APIテストで確認
node scripts/test-image-upload.js test-images/test-small.jpg
```

---

## トラブルシューティング

### "permission denied" エラーが出る場合
```bash
chmod +x scripts/diagnose-image-upload.sh
chmod +x scripts/create-test-image.sh
```

### Node.js のバージョンエラーが出る場合
```bash
# Node.js 18以降が必要
node --version

# バージョンアップが必要な場合
# nvm を使用している場合:
nvm install 18
nvm use 18
```

### テスト画像が生成できない場合
手動でテスト用の画像を以下に配置:
```
frontend/test-images/test-small.jpg
```

---

## 環境変数の設定

スクリプトは以下の環境変数を参照します:

```env
# .env.local に設定
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
```

---

## 関連ドキュメント

- **IMAGE_UPLOAD_DEBUG_SUMMARY.md** - デバッグ手順のサマリー
- **QUICK_DEBUG_GUIDE.md** - 5分でできる完全デバッグ手順
- **DEBUG_IMAGE_UPLOAD.md** - 包括的なデバッグガイド

---

## 追加のテストコマンド

### curlを使用した直接テスト
```bash
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@test-images/test-small.jpg" \
  -v
```

### OPTIONS リクエスト（CORS確認）
```bash
curl -X OPTIONS http://localhost:3000/api/image-embedding \
  -H "Access-Control-Request-Method: POST" \
  -v
```

### Jest テストの実行
```bash
# 単体テストを実行
yarn test src/app/api/image-embedding/route.test.ts

# カバレッジ付きで実行
yarn test --coverage src/app/api/image-embedding/route.test.ts
```

---

## 統合テスト実行フロー

### 開発フロー（推奨）
```bash
# 1. サーバー起動
yarn dev

# 2. クイックテスト実行（開発中に頻繁に）
./scripts/quick-test-image-search.sh

# 3. コミット前に再度確認
./scripts/quick-test-image-search.sh

# 4. コミット
git add .
git commit -m "feat: implement image search feature"
```

### リリースフロー
```bash
# 1. 完全統合テスト（モックモード）
./scripts/test-image-search.sh mock

# 2. 結果確認（すべてパス必須）
# 総テスト数: 18
# 成功: 18
# 失敗: 0

# 3. 本番モードテスト（AWS Bedrock使用）
# .env.localにAWS認証情報を設定
./scripts/test-image-search.sh prod

# 4. 手動テスト（ブラウザ）
# http://localhost:3000 で実際の操作を確認

# 5. デプロイ
```

---

## テストデータ準備

### テスト用画像の配置
```bash
# ディレクトリ作成
mkdir -p test-data/images

# 既存画像をコピー
cp /path/to/your/image.jpg test-data/images/test-small.jpg

# または、ImageMagickでダミー画像を生成
convert -size 100x100 xc:blue test-data/images/test-small.jpg
```

---

## 関連ドキュメント

### 統合テスト関連
- **[image-search-testing-guide.md](/Users/tatsuya/focus_project/cis_filesearch_app/docs/testing/image-search-testing-guide.md)** - 画像検索機能テストガイド
- **[image-search-integration-test-plan.md](/Users/tatsuya/focus_project/cis_filesearch_app/docs/image-search-integration-test-plan.md)** - 統合テスト計画書

### デバッグ関連
- **IMAGE_UPLOAD_DEBUG_SUMMARY.md** - デバッグ手順のサマリー
- **QUICK_DEBUG_GUIDE.md** - 5分でできる完全デバッグ手順
- **DEBUG_IMAGE_UPLOAD.md** - 包括的なデバッグガイド

---

作成日: 2025-12-17
更新日: 2025-12-18
