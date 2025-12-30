# OpenSearch接続ステータスレポート

## 📊 現在の状況

### 問題
Lambda関数からOpenSearchへの接続時に **403 Forbidden** エラーが発生

### 進捗状況
✅ **完了した修正**:
1. Lambda環境変数のエンドポイントURLタイポ修正 (gptq → pgtq)
2. Fine-Grained Access Control (FGAC) の内部ユーザーデータベース認証を無効化
3. OpenSearchアクセスポリシーでLambda実行ロールを明示的に許可
4. VPC DNS設定の確認（既に有効）

❌ **未解決の問題**:
- OpenSearch Fine-Grained Access Controlの**内部ロールマッピング**が未設定
- Lambda実行ロール (`cis-lambda-search-api-role`) が `all_access` ロールにマッピングされていない

## 🔍 詳細分析

### エラーの変遷
1. **最初**: `getaddrinfo ENOTFOUND` (DNS解決失敗)
   - 原因: エンドポイントURLのタイポ
   - 解決: ✅ 環境変数を修正

2. **次**: `401 Unauthorized` (認証失敗)
   - 原因: FGACの内部ユーザーデータベース認証が有効
   - 解決: ✅ IAM ARNベースの認証に切り替え

3. **現在**: `403 Forbidden` (権限不足)
   - 原因: FGACの内部ロールマッピングが未設定
   - 状態: ⏳ 対応中

### 現在の設定

#### Lambda関数
```
Function Name: cis-search-api-prod
Role: arn:aws:iam::770923989980:role/cis-lambda-search-api-role
VPC: vpc-02d08f2fa75078e67
Subnets: subnet-0ea0487400a0b3627, subnet-01edf92f9d1500875, subnet-0ce8ff9ce4bc429bf
Security Groups: sg-06ee622d64e67f12f, sg-0c482a057b356a0c3
Environment:
  OPENSEARCH_ENDPOINT: https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
  OPENSEARCH_INDEX: cis-files
```

#### OpenSearch ドメイン
```
Domain: cis-filesearch-opensearch
Endpoint: vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
VPC: vpc-02d08f2fa75078e67
Subnet: subnet-0ea0487400a0b3627
Security Group: sg-0c482a057b356a0c3

Fine-Grained Access Control:
  Enabled: true
  InternalUserDatabaseEnabled: false (✅ 修正済み)
  AnonymousAuthEnabled: false
```

#### アクセスポリシー
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:ap-northeast-1:770923989980:domain/cis-filesearch-opensearch/*"
    }
  ]
}
```

#### IAM権限
Lambda実行ロールに以下がアタッチ済み:
- `AWSLambdaVPCAccessExecutionRole`
- `AWSLambdaBasicExecutionRole`
- `cis-lambda-opensearch-access`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpHead"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:770923989980:domain/cis-filesearch-opensearch/*"
    }
  ]
}
```

## 🛠️ 解決方法（推奨順）

### オプション1: EC2経由でロールマッピングを設定 ⭐ 推奨

VPC内のEC2インスタンス (`i-083047855b68fe1c1`) を使用してOpenSearchにアクセスし、ロールマッピングを設定します。

**手順**:

1. **EC2にSSM接続**:
```bash
aws ssm start-session --target i-083047855b68fe1c1
```

2. **OpenSearch Dashboardsにポートフォワーディング**:
```bash
ssh -i <key.pem> -L 5601:vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com:443 ec2-user@<ec2-ip>
```

3. **OpenSearch Dashboards にアクセス**:
   - ブラウザで `https://localhost:5601/_dashboards` を開く
   - Security → Roles → all_access → Mapped users
   - Backend roles に `arn:aws:iam::770923989980:role/cis-lambda-search-api-role` を追加

4. **curlコマンドで直接設定** (EC2内から):
```bash
curl -X PUT \
  "https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_plugins/_security/api/rolesmapping/all_access" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -d '{
    "backend_roles": ["arn:aws:iam::770923989980:role/cis-lambda-search-api-role"],
    "hosts": [],
    "users": []
  }'
```

### オプション2: AWS CLIでマスターユーザーを再設定

OpenSearchドメインのマスターユーザーをLambda実行ロールに明示的に設定：

```bash
aws opensearch update-domain-config \
  --domain-name cis-filesearch-opensearch \
  --advanced-security-options '{
    "Enabled": true,
    "InternalUserDatabaseEnabled": false,
    "MasterUserOptions": {
      "MasterUserARN": "arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
    }
  }'
```

**注意**: この方法は既に試みましたが、`MasterUserOptions` がAPIレスポンスに反映されませんでした。OpenSearchの内部設定に時間がかかる可能性があります。

### オプション3: Fine-Grained Access Controlを無効化（非推奨）

セキュリティ要件が緩い場合、FGACを無効化することも可能ですが、**一度無効化すると再有効化できないため推奨しません**。

## 📝 次のステップ

### 即時対応
1. ✅ EC2インスタンス (`i-083047855b68fe1c1`) にSSM接続
2. ✅ OpenSearchにcurlコマンドでロールマッピングを設定
3. ✅ Lambda関数を再テスト

### 検証
1. `./scripts/test-lambda-connection.sh` を実行
2. 両インデックス (`cis-files`, `file-index-v2-knn`) への接続を確認
3. 実際の検索クエリをテスト

### ドキュメント更新
1. 成功した手順をREADMEに追記
2. トラブルシューティングガイドを更新

## 🔗 関連リソース

- **Lambda関数**: `cis-search-api-prod`
- **OpenSearchドメイン**: `cis-filesearch-opensearch`
- **VPC**: `vpc-02d08f2fa75078e67`
- **EC2インスタンス**: `i-083047855b68fe1c1`
- **IAMロール**: `cis-lambda-search-api-role`

## 📚 参考資料

- [OpenSearch Fine-Grained Access Control](https://opensearch.org/docs/latest/security/access-control/index/)
- [AWS Signature Version 4 signing process](https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html)
- [OpenSearch Security Plugin API](https://opensearch.org/docs/latest/security/access-control/api/)

---

**更新日時**: 2025-12-19 15:15 JST
**ステータス**: ⏳ ロールマッピング設定待ち
