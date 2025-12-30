# 📊 OpenSearch マイグレーション - 現在の状況と解決策

## 🎯 現在の状況

### ✅ 解決済みの問題
1. **TypeScript型安全性** - `unknown`型とtype guardsで修正済み
2. **HTTP 308リダイレクト** - APIエンドポイントに末尾スラッシュ追加済み
3. **画像ベクトル化** - 1024次元のベクトル生成が正常動作

### ❌ 未解決の問題
1. **OpenSearchインデックスマッピング**
   - `image_embedding`フィールドが`knn_vector`タイプではない
   - ローカルからVPCエンドポイントにアクセスできないため、マイグレーション未完了

## 🔑 重要な情報

### OpenSearch設定
```
エンドポイント: https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
インデックス名: cis-files (または file-index)
アクセス制限: VPC内からのみアクセス可能
```

### 失敗したマイグレーション試行
- **実行日時**: 前回のセッション
- **失敗箇所**: 「既存インデックスを削除...」で停止
- **原因**: VPCエンドポイントへのアクセス制限
- **影響**: なし（削除は実行されていない、データは安全）

## 🚀 解決方法（3つのオプション）

### オプション 1: EC2インスタンス経由（推奨）

**メリット**: 最も確実、すぐに実行可能
**デメリット**: EC2インスタンスへのアクセス権限が必要

#### 実行手順:
```bash
# 1. EC2インスタンスへ接続
aws ssm start-session --target <INSTANCE_ID>

# 2. スクリプトをEC2にコピー
# (S3経由またはcat > でファイル作成)

# 3. 実行
chmod +x ec2-opensearch-migration.sh
./ec2-opensearch-migration.sh
```

**必要なファイル**:
- `scripts/ec2-opensearch-migration.sh` - 作成済み ✅

### オプション 2: AWS Lambda関数

**メリット**: EC2不要、コンソールから実行可能
**デメリット**: Lambda関数のデプロイが必要

#### デプロイ手順:
1. AWS Lambdaコンソールで新規関数作成
2. ランタイム: Node.js 18.x
3. コード: `lambda-opensearch-migration.js`をコピー
4. VPC設定: OpenSearchと同じVPCを選択
5. タイムアウト: 15分
6. 環境変数設定後、テスト実行

**必要なファイル**:
- `lambda-opensearch-migration.js` - 作成済み ✅

### オプション 3: VPN/Direct Connect経由

**メリット**: ローカルから直接実行可能
**デメリット**: VPN設定が必要

VPN接続が確立されている場合:
```bash
./scripts/fix-opensearch-mapping.sh
```

## 📁 作成済みファイル一覧

| ファイル | 用途 | 状態 |
|---------|------|------|
| `scripts/ec2-opensearch-migration.sh` | EC2用マイグレーションスクリプト | ✅ 準備完了 |
| `lambda-opensearch-migration.js` | Lambda関数用コード | ✅ 準備完了 |
| `EC2_MIGRATION_GUIDE.md` | 実行手順詳細ガイド | ✅ 作成済み |
| `scripts/check-opensearch-local.sh` | 環境確認スクリプト | ✅ 実行可能 |
| `scripts/quick-test-image-search.sh` | 動作確認用テスト | ✅ 実行可能 |

## ⏭️ 次のステップ

### 即座に実行可能:
1. AWS認証情報を更新（必要な場合）
   ```bash
   aws sso login  # または aws configure
   ```

2. EC2インスタンスを確認
   ```bash
   aws ec2 describe-instances --filters "Name=instance-state-name,Values=running" --output table
   ```

3. EC2に接続してマイグレーション実行

### マイグレーション完了後:
1. ローカルでテストスクリプト実行
   ```bash
   ./scripts/quick-test-image-search.sh
   ```

2. 画像検索機能の動作確認

3. 既存画像の再ベクトル化（必要に応じて）

## 🔧 トラブルシューティング

### AWS認証エラー
```bash
# トークンが期限切れの場合
aws sso login

# プロファイルを指定
export AWS_PROFILE=your-profile
```

### EC2接続エラー
```bash
# SSMエージェントの状態確認
aws ssm describe-instance-information --output table

# 別のリージョンを確認
aws ec2 describe-instances --region ap-northeast-1
```

### OpenSearch接続エラー
- VPC設定を確認
- セキュリティグループでポート443を許可
- VPCエンドポイントの設定を確認

## 📝 重要な注意事項

1. **データの安全性**: 前回の失敗はVPCアクセス制限によるもので、データは削除されていません
2. **インデックス名**: `cis-files`または`file-index`を環境に応じて確認してください
3. **ベクトル次元**: 1024次元（AWS Bedrock Titan Multimodal Embeddings）
4. **既存データ**: image_embeddingフィールド以外は保持されます

## 📞 サポート

問題が発生した場合、以下の情報と共に報告してください:
- 実行したオプション（EC2/Lambda/VPN）
- エラーメッセージの全文
- 実行環境の詳細

---

**現在の推奨アクション**: EC2インスタンスへの接続を試みて、`ec2-opensearch-migration.sh`を実行してください。