# Lambda 503エラー - 解決策サマリー

## 問題
Lambda関数 `cis-search-api-prod` がOpenSearchへの接続に失敗し、503エラーを返す。

## 即座の解決方法

### 最速: ワンコマンド実行（推奨）

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
./scripts/quick-fix-503.sh
```

**所要時間**: 2-3分
**内容**: 環境変数、IAM、セキュリティグループ、アクセスポリシーを自動修正

---

## 提供されたファイル

### 1. 拡張版OpenSearchサービス
**ファイル**: `src/services/opensearch.service.enhanced.ts`

**改善点**:
- 詳細なエラーログとデバッグ情報
- SSL証明書検証のスキップオプション
- 複数の接続方式サポート
- エラー種類別の診断メッセージ

### 2. 自動修正スクリプト
**ファイル**: `scripts/quick-fix-503.sh`

**機能**:
- OpenSearchエンドポイント自動取得
- Lambda環境変数の設定
- IAMポリシーの追加・更新
- セキュリティグループルールの追加
- OpenSearchアクセスポリシーの更新
- 自動テスト実行

### 3. 診断スクリプト
**ファイル**: `scripts/diagnose-503-error.sh`

**確認項目**:
- Lambda設定（環境変数、VPC）
- IAMロールと権限
- OpenSearchドメイン状態
- セキュリティグループ設定
- CloudWatchログ
- アクセスポリシー

### 4. デプロイスクリプト
**ファイル**: `scripts/deploy-fixed-lambda.sh`

**実行内容**:
- 依存関係のインストール
- TypeScriptビルド
- デプロイパッケージ作成
- Lambda関数の更新
- 動作確認テスト

---

## 実行手順

### ステップ1: 自動修正実行

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 修正スクリプト実行
./scripts/quick-fix-503.sh
```

プロンプトに従って進めてください。完了後、自動テストが実行されます。

### ステップ2: コードのデプロイ

```bash
# 拡張版サービスを含むコードをデプロイ
./scripts/deploy-fixed-lambda.sh
```

### ステップ3: 動作確認

```bash
# Lambdaテスト
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test"}}' \
  response.json

# 結果確認
cat response.json | jq .
```

**期待される結果**:
```json
{
  "statusCode": 200,
  "body": {
    "results": [...],
    "pagination": {...},
    "took": 45
  }
}
```

---

## 根本原因と対策

### 原因1: SSL証明書の不一致
**問題**: VPCエンドポイントのSSL証明書がドメイン名と一致しない
**対策**: 環境変数 `SKIP_SSL_VERIFY=true` でスキップ

### 原因2: IAM権限不足
**問題**: Lambda IAMロールにOpenSearchアクセス権限がない
**対策**: `es:ESHttpGet/Post/Head` 権限を追加

### 原因3: セキュリティグループ
**問題**: Lambda → OpenSearch間の443ポート通信が許可されていない
**対策**: OpenSearch SGにLambda SGからのインバウンドルールを追加

### 原因4: OpenSearchアクセスポリシー
**問題**: FGACが有効でIAMロールがマッピングされていない
**対策**: アクセスポリシーにLambda IAMロールを追加

---

## トラブルシューティング

### 503エラーが継続する場合

1. **診断スクリプトを実行**
   ```bash
   ./scripts/diagnose-503-error.sh
   ```

2. **CloudWatchログを確認**
   ```bash
   aws logs tail /aws/lambda/cis-search-api-prod --follow
   ```

3. **OpenSearchクラスター状態を確認**
   ```bash
   aws opensearch describe-domain --domain-name cis-filesearch-opensearch
   ```

### デバッグモードの有効化

Lambda環境変数に追加:
```
DEBUG_MODE=true
```

これにより詳細なログが出力されます。

---

## 設定済み環境変数

| 変数名 | 値 | 説明 |
|--------|-----|------|
| OPENSEARCH_ENDPOINT | https://vpc-cis-... | OpenSearchエンドポイント |
| OPENSEARCH_INDEX | file-index | 検索対象インデックス |
| AWS_REGION | ap-northeast-1 | AWSリージョン |
| SKIP_SSL_VERIFY | true | SSL検証スキップ |
| DEBUG_MODE | true | デバッグログ有効化 |
| NODE_ENV | production | 実行環境 |

---

## 追加ドキュメント

- **詳細な修正手順**: `EMERGENCY_FIX_503.md`
- **クイックスタート**: `QUICKSTART_503_FIX.md`

---

## 次のアクション

1. ✅ `./scripts/quick-fix-503.sh` を実行
2. ✅ `./scripts/deploy-fixed-lambda.sh` を実行
3. ✅ 動作確認テストを実施
4. ⬜ 本番環境での総合テスト
5. ⬜ モニタリング設定の確認
6. ⬜ 恒久対策の検討（SSL証明書の適切な設定）

---

## 想定結果

修正完了後、以下のような正常なレスポンスが返ります:

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  "body": {
    "results": [
      {
        "id": "abc123",
        "fileName": "example.pdf",
        "filePath": "/path/to/example.pdf",
        "fileType": "pdf",
        "fileSize": 1024000,
        "modifiedDate": "2025-12-17T10:00:00Z",
        "snippet": "検索結果のハイライト...",
        "relevanceScore": 0.95
      }
    ],
    "pagination": {
      "total": 1234,
      "page": 1,
      "limit": 20,
      "totalPages": 62
    },
    "query": {
      "q": "test",
      "searchMode": "or"
    },
    "took": 45
  }
}
```

---

## サポート

問題が解決しない場合は、以下のコマンドで診断情報を収集してください:

```bash
# 診断レポート作成
./scripts/diagnose-503-error.sh > diagnosis-report.txt

# CloudWatchログ取得
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --limit 20 > cloudwatch-logs.txt

# Lambda設定取得
aws lambda get-function-configuration \
  --function-name cis-search-api-prod > lambda-config.json
```

これらのファイルを添えて報告してください。
