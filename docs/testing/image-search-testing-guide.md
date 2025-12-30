# 画像検索機能 テストガイド

このガイドでは、画像検索機能の統合テストの実行方法を説明します。

## 目次

1. [テストの種類](#テストの種類)
2. [クイックテスト（推奨）](#クイックテスト推奨)
3. [完全統合テスト](#完全統合テスト)
4. [手動テスト](#手動テスト)
5. [トラブルシューティング](#トラブルシューティング)

---

## テストの種類

### 1. クイックテスト
最小限のテストで基本動作を迅速に確認します（1分程度）。

**対象**:
- サーバー起動確認
- 画像ベクトル化API
- 画像検索API
- レスポンス形式の検証

**使用場面**:
- 開発中の動作確認
- デプロイ前の疎通確認
- CI/CDパイプライン

### 2. 完全統合テスト
すべてのエッジケースとエラーハンドリングを含む包括的なテスト（5分程度）。

**対象**:
- 正常系テスト
- 異常系テスト（ファイルサイズ、形式エラーなど）
- CORSヘッダー検証
- バリデーション検証

**使用場面**:
- リリース前の最終確認
- 本番デプロイ前のQA
- リグレッションテスト

### 3. 手動テスト
ブラウザUIから実際のユーザー操作でテストします。

**対象**:
- UI/UX動作確認
- エラーメッセージ表示
- ローディング状態
- レスポンシブデザイン

**使用場面**:
- UAT（ユーザー受け入れテスト）
- UI改善の確認
- アクセシビリティチェック

---

## クイックテスト（推奨）

### 前提条件

```bash
# 開発サーバーを起動
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
yarn dev
```

### テスト実行

```bash
# テスト画像を自動検出して実行
./scripts/quick-test-image-search.sh

# または、テスト画像を指定して実行
./scripts/quick-test-image-search.sh /path/to/your/test-image.jpg
```

### 実行例

```bash
$ ./scripts/quick-test-image-search.sh
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
画像検索機能 クイックテスト
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1/4] サーバー起動確認...
✓ サーバーが起動しています

[2/4] テスト画像確認...
✓ テスト画像が存在します
  ファイル: ./test-data/images/test-small.jpg
  サイズ: 123K

[3/4] 画像ベクトル化実行...
✓ ベクトル化成功 (HTTP 200)
  ファイル名: test-small.jpg
  次元数: 1024
✓ ベクトルが正しい次元数です（1024次元）

[4/4] 画像検索実行...
✓ 検索成功 (HTTP 200)
  検索成功: true
  取得件数: 5
  総件数: 50
✓ 検索が正常に完了しました

検索結果（上位5件）:
  - similar-image-1.jpg (スコア: 0.95)
  - similar-image-2.jpg (スコア: 0.89)
  - similar-image-3.jpg (スコア: 0.85)
  - similar-image-4.jpg (スコア: 0.82)
  - similar-image-5.jpg (スコア: 0.78)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ すべてのテストが成功しました
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 期待される結果

- すべてのチェック項目が緑色の✓で表示される
- ベクトル次元数が1024である
- HTTPステータスコードがすべて200である
- 検索結果が返る（0件でも可）

---

## 完全統合テスト

### 前提条件

```bash
# 開発サーバーを起動
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
yarn dev

# テスト用画像を準備
mkdir -p test-data/images

# テスト画像を配置（または以下のコマンドでダミー画像を生成）
# ImageMagickがインストールされている場合
convert -size 100x100 xc:blue test-data/images/test-small.jpg
```

### テスト実行

```bash
# モックモードでテスト（デフォルト）
./scripts/test-image-search.sh mock

# 本番モードでテスト（AWS Bedrock使用）
./scripts/test-image-search.sh prod
```

### 実行されるテスト

1. **前提条件チェック**
   - 開発サーバーの起動確認
   - テスト画像の存在確認
   - ディレクトリ構造の確認

2. **Test 1: 画像ベクトル化API - 正常系**
   - HTTPステータスコード 200
   - レスポンス形式の検証
   - ベクトル次元数の確認（1024次元）

3. **Test 2: 画像ベクトル化API - ファイルサイズエラー**
   - 6MBのファイルで413エラーを確認
   - エラーコード `FILE_TOO_LARGE` の検証

4. **Test 3: 画像ベクトル化API - ファイル形式エラー**
   - BMPファイルで400エラーを確認
   - エラーコード `INVALID_FILE_TYPE` の検証

5. **Test 4: 画像検索API - 正常系**
   - HTTPステータスコード 200
   - 検索結果の存在確認
   - ページネーション情報の検証

6. **Test 5: 画像検索API - バリデーションエラー**
   - パラメータなしで400エラーを確認
   - エラーコード `INVALID_QUERY` の検証

7. **Test 6: CORS ヘッダー確認**
   - OPTIONSリクエストの確認
   - CORSヘッダーの存在確認

### 期待される出力

```bash
═══════════════════════════════════════════════════════════════
前提条件チェック
═══════════════════════════════════════════════════════════════
✓ 開発サーバーが起動しています
✓ テスト画像ディレクトリが存在します: ./test-data/images
✓ テスト画像（小）が存在します: ./test-data/images/test-small.jpg
ℹ テストモード: mock

═══════════════════════════════════════════════════════════════
Test 1: 画像ベクトル化API - 正常系
═══════════════════════════════════════════════════════════════
✓ HTTPステータスコード: 200 OK
✓ success フィールドが true
✓ embedding フィールドが存在します
✓ embedding が 1024次元です

...（省略）...

═══════════════════════════════════════════════════════════════
テスト結果サマリー
═══════════════════════════════════════════════════════════════
総テスト数: 18
✓ 成功: 18
✓ 失敗: 0

成功率: 100%

✓ すべてのテストが成功しました！
```

### ログファイル

テスト実行ログは `/tmp/cis-image-search-test-YYYYMMDD-HHMMSS.log` に保存されます。

```bash
# ログファイルを確認
cat /tmp/cis-image-search-test-*.log

# 最新のログファイルを確認
ls -lt /tmp/cis-image-search-test-*.log | head -1 | awk '{print $9}' | xargs cat
```

---

## 手動テスト

### 1. ブラウザでアクセス

```bash
# 開発サーバーを起動
yarn dev

# ブラウザで開く
open http://localhost:3000
```

### 2. 開発者ツールを開く

- **Chrome**: F12 または Cmd+Option+I
- **Firefox**: F12 または Cmd+Option+I
- **Safari**: Cmd+Option+I

### 3. テスト手順

#### ステップ1: 画像アップロード

1. ファイル選択ボタンをクリック
2. テスト用画像を選択
3. アップロードされることを確認

**確認項目**:
- ファイル選択ダイアログが開く
- 画像プレビューが表示される
- ファイル名が表示される

#### ステップ2: 検索実行

1. 検索ボタンをクリック
2. ローディング表示を確認
3. 検索結果が表示されることを確認

**確認項目**:
- ローディングスピナーが表示される
- 検索ボタンが無効化される
- 検索完了後に結果が表示される

#### ステップ3: コンソールログ確認

開発者ツールのConsoleタブで以下のログを確認:

```
[Image Embedding API] Starting image embedding request
[Image Embedding API] Mock mode: true
[MOCK MODE] Generated mock embedding vector (1024 dimensions)
[Image Embedding API] Embedding generated successfully, dimensions: 1024

[POST] Image search request to Lambda
[POST] Lambda response status: { status: 200, ok: true }
[POST] Lambda response parsed: { success: true, hasData: true, resultCount: 5 }
```

#### ステップ4: Networkタブ確認

開発者ツールのNetworkタブで以下のリクエストを確認:

1. **POST /api/image-embedding**
   - Status: 200 OK
   - Type: xhr
   - Size: ~5KB（ベクトルデータ）

2. **POST /api/search**
   - Status: 200 OK
   - Type: xhr
   - Size: ~10KB（検索結果）

### エラーケーステスト

#### テスト1: 大きすぎる画像ファイル

1. 5MB以上の画像を選択
2. エラーメッセージが表示されることを確認

**期待される結果**:
```
エラー: ファイルサイズは5MB以下にしてください
```

#### テスト2: 非対応ファイル形式

1. BMP、GIF、TIFFなどの画像を選択
2. エラーメッセージが表示されることを確認

**期待される結果**:
```
エラー: JPEGまたはPNG形式の画像のみサポートしています
```

#### テスト3: ファイル未選択

1. ファイルを選択せずに検索ボタンをクリック
2. エラーメッセージが表示されることを確認

**期待される結果**:
```
エラー: 画像ファイルを選択してください
```

---

## トラブルシューティング

### エラー: "開発サーバーが起動していません"

**原因**: Next.js開発サーバーが起動していない

**解決方法**:
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
yarn dev
```

---

### エラー: "テスト画像が見つかりません"

**原因**: テスト用画像ファイルが存在しない

**解決方法**:
```bash
# ディレクトリ作成
mkdir -p test-data/images

# ダミー画像生成（ImageMagickが必要）
convert -size 100x100 xc:blue test-data/images/test-small.jpg

# または、手動で画像ファイルを配置
cp /path/to/your/image.jpg test-data/images/test-small.jpg
```

---

### エラー: "HTTP 500 Internal Server Error"

**原因**: API GatewayまたはLambda関数のエラー

**確認方法**:
```bash
# Lambda CloudWatch Logsを確認
aws logs tail /aws/lambda/cis-search-api --follow

# API Gateway URLを確認
echo $NEXT_PUBLIC_API_GATEWAY_URL

# 環境変数を確認
cat .env.local
```

**解決方法**:
- Lambda関数が正しくデプロイされているか確認
- OpenSearchエンドポイントが正しいか確認
- IAM権限が正しいか確認

---

### エラー: "Access denied to AWS Bedrock"

**原因**: AWS認証情報またはIAM権限の問題

**解決方法**:
```bash
# 環境変数を設定
echo "AWS_ACCESS_KEY_ID=your-access-key" >> .env.local
echo "AWS_SECRET_ACCESS_KEY=your-secret-key" >> .env.local
echo "AWS_REGION=us-east-1" >> .env.local

# IAMユーザーにBedrock権限を追加
# bedrock:InvokeModel 権限が必要
```

---

### エラー: "CORS policy"

**原因**: CORSヘッダーが正しく設定されていない

**確認方法**:
```bash
# OPTIONSリクエストを確認
curl -X OPTIONS http://localhost:3000/api/image-embedding \
  -H "Origin: http://localhost:3000" \
  -v
```

**解決方法**:
- API Route の `OPTIONS` ハンドラを確認
- レスポンスヘッダーに `Access-Control-Allow-Origin` があるか確認

---

## 継続的インテグレーション（CI）への統合

### GitHub Actions例

```yaml
name: Image Search Integration Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: |
          cd frontend
          yarn install

      - name: Create test image
        run: |
          mkdir -p frontend/test-data/images
          convert -size 100x100 xc:blue frontend/test-data/images/test-small.jpg

      - name: Start dev server
        run: |
          cd frontend
          yarn dev &
          sleep 10

      - name: Run integration tests
        run: |
          cd frontend
          ./scripts/test-image-search.sh mock

      - name: Upload test logs
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-logs
          path: /tmp/cis-image-search-test-*.log
```

---

## まとめ

### テスト実行フロー

```
開発中
  ↓
クイックテスト（1分）
  ↓
動作確認OK？ → No → デバッグ
  ↓ Yes
機能開発継続
  ↓
リリース前
  ↓
完全統合テスト（5分）
  ↓
すべてパス？ → No → 修正
  ↓ Yes
手動テスト（UAT）
  ↓
本番デプロイ
```

### ベストプラクティス

1. **開発中はクイックテストを頻繁に実行**
   - コミット前に必ず実行
   - 修正後の疎通確認に使用

2. **リリース前は完全統合テストを実行**
   - すべてのエッジケースを確認
   - エラーハンドリングの検証

3. **本番デプロイ前は手動テストを実施**
   - 実際のユーザー操作で確認
   - UI/UXの品質確認

4. **CI/CDパイプラインに統合**
   - 自動テストで品質を保証
   - プルリクエスト時に自動実行

---

## 関連ドキュメント

- [統合テスト計画書](/Users/tatsuya/focus_project/cis_filesearch_app/docs/image-search-integration-test-plan.md)
- [画像検索機能実装ガイド](/Users/tatsuya/focus_project/cis_filesearch_app/docs/lambda-search-api-implementation-guide.md)
- [API仕様書](/Users/tatsuya/focus_project/cis_filesearch_app/docs/api-specification.md)

---

**最終更新**: 2025-12-18
**作成者**: Claude Code QA Engineer
**バージョン**: 1.0
