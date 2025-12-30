# OpenSearch ローカル開発環境ガイド

## 概要

このプロジェクトでは、AWS OpenSearchを検索エンジンとして使用していますが、OpenSearchがVPCエンドポイントで構成されている場合、ローカル開発環境から直接アクセスすることはできません。

このガイドでは、ローカル開発時のOpenSearch接続エラーを回避し、モックデータを使用して開発を進める方法を説明します。

## 問題の背景

### VPCエンドポイントとは

VPCエンドポイントは、AWS VPC（Virtual Private Cloud）内にプライベートに配置されたOpenSearchクラスターです。セキュリティのため、VPC外部（ローカル開発環境など）からは直接アクセスできません。

- **VPCエンドポイントの例**: `https://vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com`
- **パブリックエンドポイントの例**: `https://search-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com`

### 接続エラー

ローカル環境からVPCエンドポイントにアクセスしようとすると、以下のエラーが発生します：

```
getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch-xxxxx.ap-northeast-1.es.amazonaws.com
```

## 解決策: 自動フォールバック機構

本プロジェクトでは、以下の自動フォールバック機構を実装しています：

### 1. 環境自動検出

システムは自動的に以下を検出します：

- ローカル開発環境かどうか（`NODE_ENV=development` または `localhost`）
- OpenSearchエンドポイントがVPC内かどうか（URLに`vpc-`が含まれる）

### 2. 接続ヘルスチェック

OpenSearchクライアント初期化時に接続テストを実行し、接続可能性を確認します。

### 3. モックデータへの自動フォールバック

以下の条件でモックデータを使用します：

1. ローカル開発環境 **かつ** VPCエンドポイント
2. OpenSearch接続が失敗した場合
3. OpenSearchエンドポイントが設定されていない場合

## ローカル開発での使用方法

### 1. 環境変数の設定

`.env.local` ファイルにOpenSearchエンドポイントを設定します：

```bash
# VPCエンドポイントを設定しても問題ありません
# 自動的にモックデータにフォールバックします
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xxxxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
```

### 2. 開発サーバーの起動

```bash
yarn dev
```

### 3. 検索APIの使用

通常通り検索APIを使用できます：

```bash
curl "http://localhost:3000/api/search?q=予算"
```

レスポンス例（モックデータ使用時）：

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "1",
        "fileName": "2024年度予算案.xlsx",
        "filePath": "/財務/予算/2024年度予算案.xlsx",
        "fileType": "xlsx",
        "fileSize": 2048000,
        "modifiedDate": "2024-03-15T10:30:00Z",
        "snippet": "この文書には2024年度の予算案が含まれています...",
        "relevanceScore": 0.95
      }
    ],
    "pagination": {
      "total": 5,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    },
    "took": 23
  },
  "warning": "Using mock data. OpenSearch is not available in local development environment.",
  "environment": "development"
}
```

### 4. モックデータの判別

モックデータが使用されている場合、以下で判別できます：

- **レスポンスボディ**: `warning` フィールドが含まれる
- **レスポンスヘッダー**: `X-Mock-Data: true` ヘッダーが含まれる
- **コンソールログ**: 開発サーバーのログに警告メッセージが表示される

```
⚠ Running in local development mode with VPC endpoint.
OpenSearch connection will be skipped. Mock data will be used instead.
```

## モックデータの内容

現在のモックデータには以下のファイルが含まれています：

1. **2024年度予算案.xlsx** - 財務関連ファイル
2. **プロジェクト提案書_Q1.docx** - 営業提案書
3. **会議議事録_2024-03-10.pdf** - 総務議事録
4. **製品カタログ_2024.pdf** - マーケティング資料
5. **顧客リスト.xlsx** - 営業顧客管理

### モックデータのカスタマイズ

モックデータは `/src/lib/opensearch.ts` の `generateMockSearchResults()` 関数で定義されています。
必要に応じて、このファイルを編集してモックデータをカスタマイズできます。

## 本番環境での動作

### EC2インスタンス（VPC内）での動作

EC2インスタンスなどVPC内で実行する場合、自動的に実際のOpenSearchに接続します：

1. 環境がローカル開発環境ではないと判定される
2. OpenSearch接続が正常に確立される
3. 実際のデータが返される

### 環境判定ロジック

```typescript
function isLocalDevelopment(): boolean {
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.NEXT_PUBLIC_APP_URL?.includes('localhost') ||
    false
  );
}
```

## VPCエンドポイントへの直接接続方法（上級者向け）

どうしてもローカル環境から実際のOpenSearchに接続したい場合、以下の方法があります：

### 方法1: AWS Systems Manager Session Manager

```bash
# EC2インスタンスへSSM経由で接続
aws ssm start-session --target i-xxxxxxxxxxxxx

# ポートフォワーディングを設定
aws ssm start-session \
  --target i-xxxxxxxxxxxxx \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com"],"portNumber":["443"],"localPortNumber":["9200"]}'
```

その後、環境変数を以下のように変更：

```bash
OPENSEARCH_ENDPOINT=https://localhost:9200
```

### 方法2: VPN接続

AWS VPN経由でVPCに接続します（企業ネットワーク管理者にお問い合わせください）。

### 方法3: パブリックアクセスの有効化（非推奨）

セキュリティ上のリスクがあるため、開発環境でのみ一時的に使用してください。

## トラブルシューティング

### 問題: モックデータが使用されない

**確認ポイント:**

1. `NODE_ENV` が `development` に設定されているか
2. OpenSearchエンドポイントにVPCプレフィックスが含まれているか
3. ブラウザのコンソールでログを確認

### 問題: 本番環境でもモックデータが使用される

**確認ポイント:**

1. 環境変数 `NODE_ENV` が `production` に設定されているか
2. EC2インスタンスがVPC内に配置されているか
3. IAMロールにOpenSearchへのアクセス権限があるか

### 問題: 接続エラーが頻繁に発生する

**確認ポイント:**

1. ヘルスチェックのタイムアウト設定（デフォルト5秒）
2. ネットワークの安定性
3. OpenSearchクラスターの状態（AWSコンソールで確認）

## コード実装の詳細

### 主要ファイル

- **`/src/lib/opensearch.ts`**: OpenSearchクライアントとモックデータロジック
- **`/src/app/api/search/route.ts`**: 検索APIエンドポイント
- **`.env.local`**: ローカル環境変数設定

### キー関数

1. **`isLocalDevelopment()`**: 環境判定
2. **`isVpcEndpoint()`**: VPCエンドポイント判定
3. **`checkOpenSearchHealth()`**: 接続ヘルスチェック
4. **`generateMockSearchResults()`**: モックデータ生成
5. **`getOpenSearchClient()`**: クライアント初期化（フォールバック含む）

## まとめ

本システムは、ローカル開発環境での作業を妨げないよう、自動的にモックデータにフォールバックします。開発者は以下を意識する必要があります：

✅ **ローカル開発**: モックデータで機能開発とUI実装に集中
✅ **本番環境**: 自動的に実際のOpenSearchに接続
✅ **テスト**: モックデータと実データの両方でテストを実施

何か問題が発生した場合は、コンソールログとレスポンスヘッダーを確認してください。
