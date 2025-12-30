# ✅ 本番デプロイ前チェックリスト

**日付**: 2025-12-20
**デプロイ対象**: CIS File Search Application
**デプロイURL**: https://cis-filesearch.com/

---

## 🎯 チェックリストの使い方

1. 各項目を上から順番に確認
2. 完了したら `[ ]` を `[x]` に変更
3. **全項目が完了するまでデプロイを開始しない**
4. 問題があれば即座にエスカレーション

---

## 📋 Phase 1: 環境準備（Day 0 - デプロイ前日）

### AWS環境

- [ ] **AWS認証情報が正しく設定されている**
  ```bash
  aws sts get-caller-identity
  # Account ID、User ARNが正しいことを確認
  ```

- [ ] **適切なIAM権限がある**
  - Lambda: FullAccess または カスタムポリシー
  - S3: FullAccess または cis-filesearch-* バケットへのアクセス
  - CloudFront: FullAccess または Invalidation権限
  - API Gateway: FullAccess または Usage Plan作成権限
  - CloudWatch: Logs書き込み権限

- [ ] **AWS Regionが正しい（ap-northeast-1）**
  ```bash
  echo $AWS_REGION
  # ap-northeast-1 であることを確認
  ```

### インフラストラクチャ（Terraform）

- [ ] **Terraformで全リソースが作成済み**
  ```bash
  cd terraform
  terraform plan
  # No changes表示を確認（または計画通りの変更のみ）
  ```

- [ ] **VPCとサブネットが存在する**
  ```bash
  aws ec2 describe-vpcs --filters "Name=tag:Name,Values=cis-filesearch-vpc"
  ```

- [ ] **OpenSearchドメインが正常稼働**
  ```bash
  aws opensearch describe-domain --domain-name cis-filesearch-opensearch
  # Processing: false, DomainStatus: Active を確認
  ```

- [ ] **S3フロントエンドバケットが存在する**
  ```bash
  aws s3 ls | grep cis-filesearch-frontend
  ```

- [ ] **CloudFront Distributionが存在する**
  ```bash
  aws cloudfront list-distributions \
    --query "DistributionList.Items[?Comment=='CIS FileSearch Frontend Distribution'].Id"
  ```

- [ ] **Lambda関数が存在する**
  ```bash
  aws lambda get-function --function-name cis-search-api-prod
  ```

### データベース

- [ ] **OpenSearchインデックスが作成済み**
  ```bash
  curl -X GET "https://<OPENSEARCH_ENDPOINT>/file-index" -u admin:password
  # インデックス情報が返ってくることを確認
  ```

- [ ] **テストデータが投入済み（10,000件）**
  ```bash
  curl -X GET "https://<OPENSEARCH_ENDPOINT>/file-index/_count" -u admin:password
  # count: 10000 を確認
  ```

- [ ] **画像ベクトルデータが投入済み（20件）**
  ```bash
  curl -X GET "https://<OPENSEARCH_ENDPOINT>/file-index-v2-knn/_count" -u admin:password
  # count: 20 を確認
  ```

### S3ストレージ

- [ ] **実画像がS3にアップロード済み（10件）**
  ```bash
  aws s3 ls s3://cis-filesearch-storage/thumbnails/ --recursive | wc -l
  # 10以上であることを確認
  ```

---

## 📋 Phase 2: コードとビルド

### Backend（Lambda Search API）

- [ ] **最新のコードがpullされている**
  ```bash
  cd backend/lambda-search-api
  git pull origin main
  git status
  # working tree clean を確認
  ```

- [ ] **依存関係がインストール済み**
  ```bash
  npm install
  # エラーなく完了することを確認
  ```

- [ ] **TypeScriptビルドが成功する**
  ```bash
  npm run build
  # dist/ ディレクトリが生成されることを確認
  ```

- [ ] **ユニットテストが全て通る**
  ```bash
  npm test
  # All tests passed を確認
  ```

- [ ] **環境変数ファイルが存在する（.env.production）**
  ```bash
  ls -la .env.production
  # ファイルが存在し、必須変数が全て設定されていることを確認
  ```

- [ ] **CORS設定が正しい**
  ```bash
  grep -r "Access-Control-Allow-Origin" src/utils/error-handler.ts
  # cis-filesearch.com が含まれていることを確認
  ```

### Frontend（Next.js）

- [ ] **最新のコードがpullされている**
  ```bash
  cd frontend
  git pull origin main
  git status
  # working tree clean を確認
  ```

- [ ] **依存関係がインストール済み**
  ```bash
  yarn install --frozen-lockfile
  # エラーなく完了することを確認
  ```

- [ ] **環境変数ファイルが存在する（.env.production）**
  ```bash
  ls -la .env.production
  # ファイルが存在することを確認
  ```

- [ ] **環境変数が正しく設定されている**
  ```bash
  cat .env.production | grep NEXT_PUBLIC_API_GATEWAY_URL
  # 正しいAPI Gateway URLが設定されていることを確認
  ```

- [ ] **Next.js設定がStatic Exportモード**
  ```bash
  grep "output.*export" next.config.js
  # output: 'export' が設定されていることを確認
  ```

- [ ] **ローカルでビルドが成功する**
  ```bash
  yarn build
  # エラーなく完了することを確認
  # out/ ディレクトリが生成されることを確認
  ```

- [ ] **ビルドサイズが適切（< 50MB）**
  ```bash
  du -sh out/
  # 50MB以下であることを確認
  ```

- [ ] **TypeScriptエラーがゼロ**
  ```bash
  yarn lint
  # No errors を確認
  ```

- [ ] **ユニットテストが全て通る**
  ```bash
  yarn test:unit
  # All tests passed を確認
  ```

---

## 📋 Phase 3: セキュリティ

### セキュリティ設定

- [ ] **シークレットがハードコードされていない**
  ```bash
  grep -r "AWS_SECRET_ACCESS_KEY" . --exclude-dir=node_modules
  # 結果がゼロであることを確認
  ```

- [ ] **APIキーがコードに含まれていない**
  ```bash
  grep -r "AKIA" . --exclude-dir=node_modules
  # 結果がゼロであることを確認
  ```

- [ ] **HTTPS強制が有効**
  - CloudFront: viewer_protocol_policy = "redirect-to-https"
  - API Gateway: HTTPS only

- [ ] **CORS設定が適切**
  - 許可オリジン: https://cis-filesearch.com のみ
  - 許可メソッド: GET, POST, OPTIONS
  - 許可ヘッダー: Content-Type, Authorization

- [ ] **レート制限が設定済み**
  - API Gateway Usage Plan: 10 req/秒、burst 20

- [ ] **IAMロールが最小権限**
  - Lambda: OpenSearch、S3、CloudWatch Logsのみ
  - 不要な権限が付与されていないことを確認

### SSL/TLS証明書

- [ ] **ACM証明書が有効**
  ```bash
  aws acm list-certificates --region us-east-1
  # cis-filesearch.com の証明書が ISSUED 状態であることを確認
  ```

- [ ] **証明書の有効期限が十分（> 30日）**
  ```bash
  aws acm describe-certificate \
    --certificate-arn <CERT_ARN> \
    --region us-east-1 \
    --query 'Certificate.NotAfter'
  ```

- [ ] **TLSバージョンが適切（TLS 1.2以上）**
  - CloudFront: minimum_protocol_version = "TLSv1.2_2021" または "TLSv1.3_2021"

---

## 📋 Phase 4: DNS設定

### Route53

- [ ] **Hosted Zoneが存在する**
  ```bash
  aws route53 list-hosted-zones \
    --query "HostedZones[?Name=='cis-filesearch.com.'].Id"
  ```

- [ ] **Aレコード（Alias）が設定済み**
  ```bash
  aws route53 list-resource-record-sets \
    --hosted-zone-id <ZONE_ID> \
    --query "ResourceRecordSets[?Name=='cis-filesearch.com.']"
  # CloudFront Distributionを指していることを確認
  ```

- [ ] **DNS解決が正常**
  ```bash
  dig cis-filesearch.com
  # CloudFront Distribution のIPアドレスが返ってくることを確認
  ```

- [ ] **TTLが適切（初回デプロイ: 300秒）**
  - デプロイ後は3600秒に変更予定

---

## 📋 Phase 5: 監視とロギング

### CloudWatch

- [ ] **Lambda関数のログが有効**
  ```bash
  aws logs describe-log-groups \
    --log-group-name-prefix /aws/lambda/cis-search-api-prod
  ```

- [ ] **ログ保持期間が設定済み（30日）**
  ```bash
  aws logs describe-log-groups \
    --log-group-name-prefix /aws/lambda/cis-search-api-prod \
    --query "logGroups[0].retentionInDays"
  # 30 を確認
  ```

- [ ] **メトリクスフィルタが設定済み（エラー検知）**
  ```bash
  aws logs describe-metric-filters \
    --log-group-name /aws/lambda/cis-search-api-prod
  ```

- [ ] **CloudWatch Alarmsが設定済み**
  ```bash
  aws cloudwatch describe-alarms \
    --alarm-name-prefix cis-filesearch
  # エラー率、レイテンシ、スロットリングのアラームが存在することを確認
  ```

### SNS通知

- [ ] **SNSトピックが作成済み**
  ```bash
  aws sns list-topics | grep cis-filesearch-alerts
  ```

- [ ] **メール通知が設定済み**
  ```bash
  aws sns list-subscriptions-by-topic \
    --topic-arn <TOPIC_ARN> \
    --query "Subscriptions[?Protocol=='email']"
  # 管理者メールアドレスが登録されていることを確認
  ```

- [ ] **SNS通知テストが成功**
  ```bash
  aws sns publish \
    --topic-arn <TOPIC_ARN> \
    --message "Test notification from CIS File Search deployment"
  # メールが届くことを確認
  ```

---

## 📋 Phase 6: バックアップとロールバック準備

### バックアップ

- [ ] **現在のフロントエンドバックアップ作成**
  ```bash
  aws s3 sync s3://cis-filesearch-frontend-prod/ \
    s3://cis-filesearch-frontend-prod-backup/$(date +%Y%m%d)/
  ```

- [ ] **Lambda関数の現在バージョン確認**
  ```bash
  aws lambda publish-version --function-name cis-search-api-prod
  # バージョン番号を記録
  ```

- [ ] **OpenSearchスナップショット作成**
  - 手動スナップショットまたは自動スナップショット確認

### ロールバック準備

- [ ] **ロールバックスクリプトが準備済み**
  ```bash
  ls -la rollback-production.sh
  # ファイルが存在し、実行権限があることを確認
  ```

- [ ] **前回のデプロイバージョンを記録**
  - Lambda: バージョン番号
  - Frontend: S3バックアップパス
  - 記録先: `/tmp/deployment-versions.txt`

---

## 📋 Phase 7: ドキュメント

### デプロイドキュメント

- [ ] **デプロイ計画書が最新**
  ```bash
  cat PRODUCTION_DEPLOYMENT_PLAN.md
  # 最終更新日が本日であることを確認
  ```

- [ ] **運用手順書が準備済み**
  - トラブルシューティングガイド
  - エスカレーションフロー
  - 緊急連絡先リスト

- [ ] **ロールバック手順が文書化**
  - 各コンポーネントのロールバック手順
  - 所要時間の見積もり

---

## 📋 Phase 8: チーム準備

### コミュニケーション

- [ ] **全チームメンバーがデプロイ日時を認識**
  - デプロイ日: 2025-12-20 〜 2025-12-22
  - デプロイ時間帯: 各日9:00 〜 18:00

- [ ] **デプロイ中の連絡体制確立**
  - Slack/Teams チャンネル準備
  - 緊急連絡先共有

- [ ] **ロールアサイン確認**
  - Project Manager: 全体管理
  - Backend Engineer: Lambda、API
  - Frontend Engineer: Next.js、UI
  - DevOps Engineer: インフラ、デプロイ
  - QA Engineer: テスト、検証
  - Security Engineer: セキュリティ監査

### スケジュール

- [ ] **デプロイスケジュールが承認済み**
  - Day 1（12/20）: セキュリティ修正とインフラ確認
  - Day 2（12/21）: フロントエンドビルドとデプロイ
  - Day 3（12/22）: 統合テストと本番検証

- [ ] **各メンバーの稼働可能時間確認**
  - Day 1-3の全日、9:00-18:00に対応可能

---

## 📋 Phase 9: リスク確認

### 既知の問題

- [ ] **Lambda OpenSearch接続問題の対策準備**
  - NAT Gateway経由の設定確認
  - VPCエンドポイント作成手順準備（Plan B）

- [ ] **フロントエンドビルドエラーの対策準備**
  - ローカルビルドテスト完了
  - TypeScriptエラーゼロ確認

- [ ] **CloudFrontキャッシュ問題の対策準備**
  - Invalidation手順確認
  - TTL短縮設定準備

### 緊急時対応

- [ ] **AWS Support契約確認**
  - サポートプラン: Business以上推奨
  - ケース作成方法の確認

- [ ] **エスカレーションフロー確認**
  - Level 1: チーム内対応（30分）
  - Level 2: PM エスカレーション（1時間）
  - Level 3: AWS Support（2時間）
  - Level 4: 経営層報告（Critical障害のみ）

---

## 📋 Phase 10: 最終確認

### デプロイスクリプト

- [ ] **デプロイスクリプトの存在確認**
  ```bash
  ls -la deploy-production.sh
  # 実行権限があることを確認
  ```

- [ ] **デプロイスクリプトのドライラン**
  ```bash
  bash -n deploy-production.sh
  # 構文エラーがないことを確認
  ```

### 最終チェック

- [ ] **全ての変更がGitにコミット済み**
  ```bash
  git status
  # nothing to commit, working tree clean を確認
  ```

- [ ] **mainブランチが最新**
  ```bash
  git pull origin main
  # Already up to date を確認
  ```

- [ ] **タグ作成準備**
  ```bash
  git tag -a v1.0.0-prod -m "Production deployment 2025-12-20"
  # デプロイ成功後にpush予定
  ```

---

## ✅ 最終確認事項

### 必須条件（全てチェック必須）

- [ ] **上記の全項目が完了している**
- [ ] **PM承認を取得済み**
- [ ] **全チームメンバーがスタンバイ状態**
- [ ] **緊急時の連絡体制が確立**
- [ ] **ロールバック手順が準備済み**

### デプロイ開始許可

**デプロイ開始許可サイン**:

- PM承認: [ ] ________________________ (署名/日付)
- Backend Lead: [ ] ________________________ (署名/日付)
- Frontend Lead: [ ] ________________________ (署名/日付)
- DevOps Lead: [ ] ________________________ (署名/日付)
- Security Lead: [ ] ________________________ (署名/日付)

---

## 🚀 デプロイ開始

全ての項目がチェックされたら、以下のコマンドでデプロイを開始:

```bash
./deploy-production.sh all
```

または、段階的にデプロイ:

```bash
# Day 1のみ
./deploy-production.sh day1

# Day 2のみ
./deploy-production.sh day2

# Day 3のみ
./deploy-production.sh day3
```

---

**チェックリスト完了日**: _______________
**デプロイ開始日時**: _______________
**デプロイ完了予定**: 2025-12-22 18:00
