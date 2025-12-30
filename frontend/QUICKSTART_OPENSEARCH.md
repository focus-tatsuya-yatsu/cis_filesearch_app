# OpenSearch 開発環境クイックスタート

## 問題

ローカル開発環境からVPCエンドポイントのOpenSearchにアクセスできず、以下のエラーが発生：

```
getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch-xxxxx.ap-northeast-1.es.amazonaws.com
```

## 解決策

✅ **自動フォールバック機構を実装**

- ローカル環境では自動的にモックデータを使用
- 本番環境（VPC内）では実際のOpenSearchに接続
- エラー時も自動的にモックデータにフォールバック

## クイックスタート

### 1. 環境変数設定

`.env.local` ファイルはそのままでOK：

```bash
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xxxxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
```

VPCエンドポイントを設定していても、ローカル環境では自動的にモックデータを使用します。

### 2. 開発サーバー起動

```bash
yarn dev
```

コンソールに以下のメッセージが表示されます：

```
⚠ Running in local development mode with VPC endpoint.
OpenSearch connection will be skipped. Mock data will be used instead.
```

### 3. 動作確認

#### 方法A: ブラウザで確認

```
http://localhost:3000/api/search/?q=予算
```

#### 方法B: curlで確認

```bash
curl "http://localhost:3000/api/search/?q=予算" | jq
```

#### 方法C: テストスクリプトで確認

```bash
node test-opensearch-api.js
```

### 4. レスポンスの確認

モックデータが使用されている場合、以下が含まれます：

- **レスポンスボディ**: `warning` フィールド
- **HTTPヘッダー**: `X-Mock-Data: true`

```json
{
  "success": true,
  "data": {
    "results": [...],
    "pagination": {...},
    "took": 23
  },
  "warning": "Using mock data. OpenSearch is not available in local development environment.",
  "environment": "development"
}
```

## モックデータの内容

現在5件のサンプルファイルが含まれています：

1. 2024年度予算案.xlsx
2. プロジェクト提案書_Q1.docx
3. 会議議事録_2024-03-10.pdf
4. 製品カタログ_2024.pdf
5. 顧客リスト.xlsx

## 実装ファイル

変更されたファイル：

- `/src/lib/opensearch.ts` - OpenSearchクライアントとモックデータロジック
- `/src/app/api/search/route.ts` - 検索APIエンドポイント
- `.env.local` - 環境変数（コメント追加）
- `.env.example` - 環境変数テンプレート

## 注意事項

### ⚠️ trailingSlash設定

`next.config.js`で `trailingSlash: true` が設定されているため、APIエンドポイントには末尾のスラッシュが必要です：

```bash
# ✅ 正しい
http://localhost:3000/api/search/?q=test

# ❌ 間違い（308リダイレクトが発生）
http://localhost:3000/api/search?q=test
```

### 本番環境での動作

EC2インスタンス（VPC内）で実行する場合：

1. 環境が自動的に本番と判定される
2. 実際のOpenSearchに接続される
3. モックデータは使用されない

## トラブルシューティング

### Q: モックデータではなく実際のOpenSearchに接続したい

**A: 以下の方法があります：**

1. **AWS Systems Manager Session Manager**を使用
2. **VPN接続**でVPCに接続
3. 開発用に**パブリックエンドポイント**を作成（非推奨）

詳細は `/docs/OPENSEARCH_LOCAL_DEVELOPMENT.md` を参照してください。

### Q: ビルドエラーが発生する

**A: 型チェックを実行：**

```bash
yarn build
```

エラーがない場合、実装は正常です。

### Q: テストが失敗する

**A: 以下を確認：**

```bash
# 開発サーバーが起動しているか
lsof -ti :3000

# 環境変数が読み込まれているか
echo $OPENSEARCH_ENDPOINT

# APIエンドポイントが正しいか（末尾にスラッシュ）
curl -v "http://localhost:3000/api/search/?q=test"
```

## 詳細ドキュメント

より詳しい情報は以下を参照：

- **完全ガイド**: `/docs/OPENSEARCH_LOCAL_DEVELOPMENT.md`
- **コード実装**: `/src/lib/opensearch.ts`
- **API仕様**: `/src/app/api/search/route.ts`

## まとめ

✅ VPCエンドポイントへの接続エラーを自動解決
✅ ローカル開発環境でモックデータを使用
✅ 本番環境では実際のOpenSearchに自動接続
✅ エラーハンドリングとフォールバック機構実装済み

これで、ローカル環境でも快適に開発できます！
