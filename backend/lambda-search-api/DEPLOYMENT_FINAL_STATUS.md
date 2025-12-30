# Lambda Search API - 最終デプロイメント状況レポート

**デプロイ完了日時**: 2025-12-17 11:14 JST
**アカウント**: 770923989980
**リージョン**: ap-northeast-1
**ステータス**: ✅ **95%完了（FGAC設定のみ保留中）**

---

## デプロイメント成功サマリー

### 完了したタスク ✅

1. **IAMロールとポリシー作成** ✅
   - Lambda実行ロール作成完了
   - VPCアクセス権限付与
   - OpenSearchアクセスポリシー作成
   - CloudWatch Logs権限付与

2. **Lambda関数デプロイ** ✅
   - 関数名: `cis-search-api-prod`
   - ランタイム: Node.js 20.x
   - メモリ: 512 MB
   - タイムアウト: 30秒
   - デプロイパッケージ: 1.4 MB

3. **VPC設定** ✅
   - 3つのプライベートサブネットに配置
   - OpenSearchセキュリティグループ適用
   - DNS設定修正（EnableDnsHostnames有効化）

4. **API Gateway統合** ✅
   - 既存API (`5xbn3ng31f`) に統合
   - `GET /search`ルート作成
   - Lambda呼び出し権限設定
   - AutoDeploy設定確認

5. **Lambda関数コード修正** ✅
   - HTTP API v2フォーマット対応
   - REST API互換性維持
   - エラーハンドリング改善

6. **OpenSearchアクセスポリシー更新** ✅
   - Lambdaロールを許可リストに追加
   - ポリシー更新完了

### 保留中のタスク ⏳

7. **OpenSearch Fine-Grained Access Control (FGAC) 設定** ⏳
   - **ステータス**: 手動設定が必要
   - **理由**: VPC内リソースのため、VPC内から設定スクリプトを実行する必要がある
   - **影響**: APIは接続できるが、検索権限がブロックされている
   - **解決方法**: `OPENSEARCH_FGAC_CONFIGURATION_GUIDE.md`参照

---

## デプロイされたリソース

### 1. Lambda関数

```yaml
関数名: cis-search-api-prod
ARN: arn:aws:lambda:ap-northeast-1:770923989980:function:cis-search-api-prod
ランタイム: nodejs20.x
ハンドラー: index.handler
メモリ: 512 MB
タイムアウト: 30秒
コードサイズ: 1.47 MB
状態: Active

VPC設定:
  VPC ID: vpc-02d08f2fa75078e67
  サブネット:
    - subnet-0ea0487400a0b3627 (cis-filesearch-subnet-private-1a)
    - subnet-01edf92f9d1500875 (cls-filesearch-subnet-private-1c)
    - subnet-0ce8ff9ce4bc429bf (cls-filesearch-subnet-private-1d)
  セキュリティグループ: sg-0c482a057b356a0c3

環境変数:
  OPENSEARCH_ENDPOINT: https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
  OPENSEARCH_INDEX: file-index
  NODE_ENV: production

ログ:
  ロググループ: /aws/lambda/cis-search-api-prod
  保持期間: デフォルト
```

### 2. IAMロール

```yaml
ロール名: cis-lambda-search-api-role
ARN: arn:aws:iam::770923989980:role/cis-lambda-search-api-role

アタッチされたポリシー:
  - AWSLambdaVPCAccessExecutionRole (AWS管理)
  - AWSLambdaBasicExecutionRole (AWS管理)
  - cis-lambda-opensearch-access (カスタム)

カスタムポリシー詳細:
  ポリシー名: cis-lambda-opensearch-access
  ARN: arn:aws:iam::770923989980:policy/cis-lambda-opensearch-access
  アクション:
    - es:ESHttpGet
    - es:ESHttpPost
    - es:ESHttpPut
    - es:ESHttpHead
  リソース:
    - arn:aws:es:ap-northeast-1:770923989980:domain/cis-filesearch-opensearch/*
```

### 3. API Gateway

```yaml
API名: cis-filesearch-image-search-API
API ID: 5xbn3ng31f
タイプ: HTTP API v2
エンドポイント: https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com

ルート:
  - GET /search
    ルートID: yl1dxcg
    統合ID: n4d11r6
    統合タイプ: AWS_PROXY
    ターゲット: arn:aws:lambda:ap-northeast-1:770923989980:function:cis-search-api-prod

ステージ:
  名前: default
  AutoDeploy: Enabled
  最終デプロイID: r8l9np
```

### 4. OpenSearch設定

```yaml
ドメイン名: cis-filesearch-opensearch
VPCエンドポイント: vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
インデックス: file-index

アクセスポリシー:
  許可されたプリンシパル:
    - arn:aws:iam::770923989980:root
    - arn:aws:iam::770923989980:role/cis-filesearch-worker-role
    - arn:aws:iam::770923989980:role/CIS-Lambda-S3EventHandler-Role
    - arn:aws:iam::770923989980:role/cis-lambda-search-api-role ✅ 追加済み

Fine-Grained Access Control:
  有効: Yes
  内部ユーザーDB: Disabled
  匿名アクセス: Disabled
  ロールマッピング: 設定保留中 ⏳
```

---

## API エンドポイント情報

### ベースURL
```
https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
```

### サポートされているパラメータ

| パラメータ | タイプ | 必須 | デフォルト | 説明 |
|----------|--------|------|-----------|------|
| `q` | string | Yes | - | 検索クエリ |
| `page` | number | No | 1 | ページ番号 |
| `limit` | number | No | 20 | 1ページあたりの件数 (最大100) |
| `searchMode` | string | No | 'or' | 検索モード ('and' または 'or') |
| `fileType` | string | No | - | ファイルタイプフィルタ (例: 'pdf', 'docx') |
| `dateFrom` | string | No | - | 日付範囲開始 (YYYY-MM-DD) |
| `dateTo` | string | No | - | 日付範囲終了 (YYYY-MM-DD) |
| `sortBy` | string | No | 'relevance' | ソート基準 ('relevance', 'date', 'name', 'size') |
| `sortOrder` | string | No | 'desc' | ソート順序 ('asc', 'desc') |

### レスポンス形式

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "string",
        "fileName": "string",
        "filePath": "string",
        "fileType": "string",
        "fileSize": 0,
        "modifiedDate": "string",
        "snippet": "string",
        "relevanceScore": 0,
        "highlights": {
          "fileName": ["string"],
          "filePath": ["string"],
          "extractedText": ["string"]
        }
      }
    ],
    "pagination": {
      "total": 0,
      "page": 1,
      "limit": 20,
      "totalPages": 0
    },
    "query": {
      "q": "string",
      "searchMode": "or",
      ...
    },
    "took": 0
  }
}
```

### 使用例

```bash
# 基本検索
curl -X GET 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=document&page=1&limit=10'

# フィルタ付き検索
curl -X GET 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=report&fileType=pdf&sortBy=date'

# AND検索
curl -X GET 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=project%20report&searchMode=and'

# 日付範囲検索
curl -X GET 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=invoice&dateFrom=2024-01-01&dateTo=2024-12-31'
```

---

## 技術的課題と解決策

### 課題1: API Gateway HTTP API v2との互換性

**問題**: Lambda関数がREST API形式のイベントのみをサポート

**解決策**: イベント正規化ロジックを実装

```typescript
const httpMethod = event.httpMethod || event.requestContext?.http?.method || 'UNKNOWN';
const path = event.path || event.requestContext?.http?.path || event.rawPath || '/';
```

**結果**: ✅ REST APIとHTTP API v2の両方をサポート

---

### 課題2: VPC内DNS解決の失敗

**問題**: `getaddrinfo ENOTFOUND` エラー

**原因**: VPCの`EnableDnsHostnames`が無効

**解決策**:
```bash
aws ec2 modify-vpc-attribute --vpc-id vpc-02d08f2fa75078e67 --enable-dns-hostnames
```

**結果**: ✅ OpenSearchエンドポイントのDNS解決が成功

---

### 課題3: OpenSearchエンドポイントURL誤字

**問題**: 環境変数に誤ったエンドポイントURL

**誤**: `xuupcgptq6a4opklfeh65x3uqe`
**正**: `xuupcpgtq6a4opklfeh65x3uqe`

**解決策**: Lambda環境変数を修正

**結果**: ✅ 正しいエンドポイントに接続

---

### 課題4: OpenSearchアクセスポリシー未設定

**問題**: LambdaロールがOpenSearchアクセスポリシーに含まれていない

**解決策**: ドメインアクセスポリシーを更新

**結果**: ✅ IAMレベルのアクセス許可完了

---

### 課題5: OpenSearch FGAC権限不足 ⏳

**問題**: `security_exception: no permissions for [indices:data/read/search]`

**原因**: Fine-Grained Access Controlのロールマッピングが未設定

**解決策**: VPC内からロールマッピングAPIを呼び出して設定

**ステータス**: ⏳ 手動設定が必要（ガイド作成済み）

**次のステップ**: `OPENSEARCH_FGAC_CONFIGURATION_GUIDE.md`を参照して設定

---

## 監視とトラブルシューティング

### CloudWatch Logs

```bash
# リアルタイムログの確認
aws logs tail /aws/lambda/cis-search-api-prod --follow

# 直近5分のログ
aws logs tail /aws/lambda/cis-search-api-prod --since 5m

# エラーログのみ
aws logs tail /aws/lambda/cis-search-api-prod --since 10m --filter-pattern "ERROR"
```

### Lambda関数の状態確認

```bash
# 関数設定の確認
aws lambda get-function-configuration --function-name cis-search-api-prod

# VPC設定の確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'VpcConfig'
```

### OpenSearchドメイン状態確認

```bash
# ドメイン処理状態
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch \
  --query 'DomainStatus.Processing'

# アクセスポリシー確認
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch \
  --query 'DomainStatus.AccessPolicies' \
  --output text | jq '.'
```

---

## 次のステップ（優先度順）

### 🔴 高優先度 - OpenSearch FGAC設定

**タスク**: Lambda Search APIにOpenSearch検索権限を付与

**手順**:
1. `OPENSEARCH_FGAC_CONFIGURATION_GUIDE.md`を参照
2. VPC内のリソース（EC2/Lambda）から設定スクリプトを実行
3. APIエンドポイントをテストして動作確認

**所要時間**: 10-15分

**完了条件**:
```bash
curl 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=test'
# → success: true のレスポンスが返る
```

---

### 🟡 中優先度 - 監視とアラート設定

**CloudWatchアラーム**:
- Lambda実行エラー率 > 5%
- Lambda実行時間 > 25秒（タイムアウト前警告）
- API Gateway 5xxエラー > 10/分
- OpenSearch接続失敗 > 3回連続

**メトリクス設定**:
- カスタムメトリクス: 検索クエリ数、平均レスポンス時間
- X-Ray トレーシング有効化

---

### 🟢 低優先度 - 最適化と拡張

**パフォーマンス最適化**:
- Lambda予約同時実行数の設定
- メモリサイズの最適化（現在512MB）
- CloudWatch Logsの保持期間設定

**セキュリティ強化**:
- Cognito Authorizer追加
- API Gatewayレート制限設定
- CORS設定の最適化

**機能拡張**:
- 画像埋め込み検索のサポート
- 検索クエリ分析とログ保存
- キャッシング層の追加（ElastiCache）

---

## プロジェクトファイル構造

```
backend/lambda-search-api/
├── src/
│   ├── index.ts                      # メインハンドラー（HTTP API v2対応）✅
│   ├── services/
│   │   ├── opensearch.service.ts     # OpenSearch接続とクエリ
│   │   └── logger.service.ts         # ロギング
│   ├── utils/
│   │   ├── validator.ts              # 入力バリデーション
│   │   └── error-handler.ts          # エラーハンドリング
│   └── types/
│       └── index.ts                  # TypeScript型定義
├── dist/                             # コンパイル済みJavaScript
│   └── *.js                          # Webpack bundled output
├── scripts/
│   ├── deploy-lambda-manual.sh       # デプロイスクリプト✅
│   ├── configure-opensearch-fgac.sh  # FGAC設定スクリプト
│   └── test-api.sh                   # APIテストスクリプト
├── lambda-deployment.zip             # デプロイメントパッケージ (1.4MB)✅
├── DEPLOYMENT_SUCCESS_REPORT.md      # 詳細デプロイレポート
├── OPENSEARCH_FGAC_CONFIGURATION_GUIDE.md  # FGAC設定ガイド
├── DEPLOYMENT_FINAL_STATUS.md        # このファイル
├── package.json
├── tsconfig.json
└── webpack.config.js
```

---

## コスト見積もり

### Lambda

```
- リクエスト数: 100,000/月
- 平均実行時間: 500ms
- メモリ: 512MB

計算:
  リクエスト料金: $0.02
  実行時間料金: $0.42
  月額合計: $0.44
```

### API Gateway HTTP API

```
- リクエスト数: 100,000/月

計算:
  リクエスト料金: $0.10
  月額合計: $0.10
```

### VPC ENI (Elastic Network Interface)

```
- ENI数: 3個（3つのサブネット）
- 料金: 無料（Lambda VPC接続）
```

### CloudWatch Logs

```
- ログデータ量: 1GB/月
- 保存期間: デフォルト（永続）

計算:
  取り込み料金: $0.50
  保存料金: $0.03
  月額合計: $0.53
```

### 合計月額コスト

```
Lambda:          $0.44
API Gateway:     $0.10
CloudWatch:      $0.53
----------------
合計:           $1.07/月 (約150円/月)
```

---

## テスト結果

### ✅ 成功したテスト

- [x] Lambda関数作成
- [x] VPC設定（3サブネット、セキュリティグループ）
- [x] IAMロール作成と権限付与
- [x] API Gateway統合
- [x] Lambda呼び出し権限設定
- [x] DNS設定修正
- [x] OpenSearchアクセスポリシー更新
- [x] HTTP API v2イベント処理
- [x] Lambda → OpenSearch接続確立

### ⏳ 保留中のテスト

- [ ] OpenSearch FGAC権限（手動設定後にテスト）
- [ ] 実際の検索クエリ実行
- [ ] ページネーション動作確認
- [ ] フィルタ機能テスト
- [ ] ソート機能テスト
- [ ] エラーハンドリング検証
- [ ] パフォーマンステスト（大量データ）

---

## デプロイメントチェックリスト

### インフラストラクチャ
- [x] Lambda関数デプロイ
- [x] VPC設定（サブネット、セキュリティグループ）
- [x] IAMロールとポリシー
- [x] API Gateway統合
- [x] CloudWatch Logsグループ
- [x] DNS設定（EnableDnsHostnames）
- [x] OpenSearchアクセスポリシー
- [ ] OpenSearch FGAC ロールマッピング ⏳

### セキュリティ
- [x] Lambda IAM ロール最小権限
- [x] VPC内配置（インターネット直接アクセス不可）
- [x] OpenSearch VPCエンドポイント使用
- [ ] Cognito Authorizer追加（推奨）
- [ ] API Gatewayレート制限（推奨）
- [ ] CloudWatch アラーム設定（推奨）

### 監視・運用
- [x] CloudWatch Logsグループ自動作成
- [ ] カスタムメトリクス設定
- [ ] CloudWatchアラーム設定
- [ ] X-Ray トレーシング有効化
- [ ] ログ保持期間設定

### ドキュメント
- [x] デプロイメント手順書
- [x] API仕様書
- [x] FGAC設定ガイド
- [x] トラブルシューティングガイド
- [ ] フロントエンド統合ガイド
- [ ] 運用マニュアル

---

## まとめ

### 達成されたこと ✅

Lambda Search APIのデプロイは**95%完了**しています：

1. **完全なインフラストラクチャ構築** - Lambda、IAM、VPC、API Gateway
2. **OpenSearch接続確立** - VPC、DNS、アクセスポリシーすべて設定完了
3. **HTTP API v2対応** - 最新のAPI Gateway形式をサポート
4. **包括的なドキュメント作成** - デプロイ、設定、トラブルシューティングガイド

### 残りのタスク ⏳

最後の5%は**OpenSearch Fine-Grained Access Control (FGAC) のロールマッピング設定**のみです。

これは技術的な制約（VPC内リソースのため）により、VPC内のリソースから手動で設定する必要があります。

### 次の実施事項

1. **即時**: `OPENSEARCH_FGAC_CONFIGURATION_GUIDE.md`に従ってFGACを設定
2. **短期**: APIのテストと検証
3. **中期**: 監視・アラート設定
4. **長期**: パフォーマンス最適化とセキュリティ強化

### サポートリソース

- デプロイスクリプト: `/backend/lambda-search-api/scripts/deploy-lambda-manual.sh`
- FGAC設定ガイド: `/backend/lambda-search-api/OPENSEARCH_FGAC_CONFIGURATION_GUIDE.md`
- 詳細レポート: `/backend/lambda-search-api/DEPLOYMENT_SUCCESS_REPORT.md`

---

**デプロイ実行者**: Claude Code
**レポート作成日時**: 2025-12-17 11:14 JST
**ドキュメントバージョン**: 1.0
