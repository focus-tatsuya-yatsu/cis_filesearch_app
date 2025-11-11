# S3 バケットポリシー設定ガイド

## 概要

このドキュメントでは、CIS File Search Applicationで使用するS3バケットのアクセス制御ポリシーについて説明します。

**VPN削除後の代替アクセス制御**: Internet + HTTPS + IP Whitelist

---

## バケット構成

### 1. フロントエンドバケット（静的ホスティング）

- **バケット名**: `cis-filesearch-frontend-prod`
- **用途**: Next.js静的ファイルのホスティング
- **アクセス**: CloudFront OAC経由のみ

### 2. ランディングバケット（ファイル受信）

- **バケット名**: `cis-filesearch-landing-prod`
- **用途**: NASファイルの一時保存（10TB）
- **アクセス**: オンプレミスIP制限 + Lambda + EC2

### 3. 処理済みバケット（永続保存）

- **バケット名**: `cis-filesearch-processed-prod`
- **用途**: 処理済みファイルの永続保存
- **アクセス**: EC2インスタンスのみ

---

## ポリシー詳細

### Statement 1: CloudFront OAC (Origin Access Control)

```json
{
  "Sid": "AllowCloudFrontOAC",
  "Effect": "Allow",
  "Principal": {
    "Service": "cloudfront.amazonaws.com"
  },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::YOUR-FRONTEND-BUCKET-NAME/*",
  "Condition": {
    "StringEquals": {
      "AWS:SourceArn": "arn:aws:cloudfront::YOUR-AWS-ACCOUNT-ID:distribution/YOUR-DISTRIBUTION-ID"
    }
  }
}
```

**目的**: CloudFrontからのみフロントエンドファイルにアクセス可能にする

**適用バケット**: `cis-filesearch-frontend-prod`

**セキュリティポイント**:
- ✅ S3への直接アクセスをブロック
- ✅ 特定のCloudFront Distributionのみ許可
- ✅ OAIの後継として推奨されるOACを使用

**置換項目**:
- `YOUR-FRONTEND-BUCKET-NAME` → 実際のフロントエンドバケット名
- `YOUR-AWS-ACCOUNT-ID` → AWSアカウントID（12桁）
- `YOUR-DISTRIBUTION-ID` → CloudFront Distribution ID（例: E1234567890ABC）

**取得方法**:
```bash
# CloudFront Distribution ID の確認
aws cloudfront list-distributions --query "DistributionList.Items[].{Id:Id,DomainName:DomainName}" --output table

# Distribution ARN の確認
aws cloudfront get-distribution --id E1234567890ABC --query "Distribution.ARN" --output text
```

---

### Statement 2: オンプレミスIPホワイトリスト

```json
{
  "Sid": "AllowOnPremiseUpload",
  "Effect": "Allow",
  "Principal": "*",
  "Action": [
    "s3:PutObject",
    "s3:PutObjectAcl"
  ],
  "Resource": "arn:aws:s3:::YOUR-LANDING-BUCKET-NAME/uploads/*",
  "Condition": {
    "IpAddress": {
      "aws:SourceIp": [
        "203.0.113.0/24"
      ]
    }
  }
}
```

**目的**: VPN不要でオンプレミスからファイルアップロード可能にする

**適用バケット**: `cis-filesearch-landing-prod`

**VPN削除の理由**:
- ファイルスキャンは半年に1度
- 常時接続VPN ($36/月) はコスト過剰
- IP制限で十分なセキュリティ確保

**セキュリティポイント**:
- ✅ 特定のオンプレミスIPからのみアップロード可能
- ✅ HTTPS必須（後述のDenyポリシーで強制）
- ✅ アップロードパスを `/uploads/*` に制限

**置換項目**:
- `YOUR-LANDING-BUCKET-NAME` → ランディングバケット名
- `203.0.113.0/24` → 実際のオンプレミスパブリックIP範囲

**IPアドレス確認方法**:
```bash
# クライアント側で確認
curl https://ifconfig.me

# CIDR範囲の指定例
# 単一IP: 203.0.113.5/32
# /24範囲: 203.0.113.0/24 (203.0.113.0 〜 203.0.113.255)
# 複数範囲: ["203.0.113.0/24", "198.51.100.0/24"]
```

**コスト比較**:
| 方式 | 月額コスト | セキュリティ | 複雑度 |
|---|---|---|---|
| VPN常時接続 | $36/月 | ⭐⭐⭐⭐⭐ | 高 |
| IP制限 + HTTPS | $0/月 | ⭐⭐⭐⭐ | 低 |

---

### Statement 3: Lambda実行ロール

```json
{
  "Sid": "AllowLambdaReadWrite",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::YOUR-AWS-ACCOUNT-ID:role/YOUR-LAMBDA-EXECUTION-ROLE"
  },
  "Action": [
    "s3:GetObject",
    "s3:PutObject",
    "s3:DeleteObject",
    "s3:ListBucket"
  ],
  "Resource": [
    "arn:aws:s3:::YOUR-LANDING-BUCKET-NAME",
    "arn:aws:s3:::YOUR-LANDING-BUCKET-NAME/*"
  ]
}
```

**目的**: Lambda関数がランディングバケットを操作可能にする

**適用バケット**: `cis-filesearch-landing-prod`

**Lambda関数の役割**:
- 手動トリガーボタンの処理
- SQSへのメッセージ送信
- ファイルメタデータの読み取り

**セキュリティポイント**:
- ✅ 特定のIAMロールのみ許可
- ✅ 最小権限の原則（必要な操作のみ）
- ✅ バケット全体とオブジェクトの両方にアクセス可能

**置換項目**:
- `YOUR-AWS-ACCOUNT-ID` → AWSアカウントID
- `YOUR-LAMBDA-EXECUTION-ROLE` → Lambda実行ロール名（例: `CISFileSearchLambdaRole`）

**ロール確認方法**:
```bash
# Lambda関数のロールを確認
aws lambda get-function --function-name your-function-name --query "Configuration.Role" --output text
```

---

### Statement 4: EC2インスタンスロール

```json
{
  "Sid": "AllowEC2ProcessingReadWrite",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::YOUR-AWS-ACCOUNT-ID:role/YOUR-EC2-INSTANCE-ROLE"
  },
  "Action": [
    "s3:GetObject",
    "s3:PutObject",
    "s3:DeleteObject"
  ],
  "Resource": [
    "arn:aws:s3:::YOUR-LANDING-BUCKET-NAME/*",
    "arn:aws:s3:::YOUR-PROCESSED-BUCKET-NAME/*"
  ]
}
```

**目的**: Auto Scalingで起動するEC2インスタンスがファイル処理可能にする

**適用バケット**:
- `cis-filesearch-landing-prod` (読み取り元)
- `cis-filesearch-processed-prod` (書き込み先)

**EC2の役割**:
- SQSからメッセージ受信
- ランディングバケットからファイル取得
- Tesseract OCR実行
- Bedrock Titan Multimodal でベクトル化
- 処理済みバケットに保存
- OpenSearchにインデックス登録

**セキュリティポイント**:
- ✅ EC2インスタンスプロファイルのロールのみ許可
- ✅ ListBucket権限は不要（個別ファイルのみ処理）
- ✅ 読み取りと書き込みを異なるバケットに分離

**置換項目**:
- `YOUR-EC2-INSTANCE-ROLE` → EC2インスタンスロール名（例: `CISFileSearchEC2Role`）

**ロール確認方法**:
```bash
# Auto Scaling Launch Templateのロールを確認
aws autoscaling describe-launch-configurations \
  --launch-configuration-names your-launch-config \
  --query "LaunchConfigurations[0].IamInstanceProfile" --output text
```

---

### Statement 5: HTTPS通信の強制

```json
{
  "Sid": "DenyInsecureTransport",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::YOUR-FRONTEND-BUCKET-NAME",
    "arn:aws:s3:::YOUR-FRONTEND-BUCKET-NAME/*",
    "arn:aws:s3:::YOUR-LANDING-BUCKET-NAME",
    "arn:aws:s3:::YOUR-LANDING-BUCKET-NAME/*"
  ],
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "false"
    }
  }
}
```

**目的**: すべての通信をHTTPS（TLS）で暗号化

**セキュリティポイント**:
- ✅ HTTPアクセスを完全にブロック
- ✅ 中間者攻撃（MITM）を防止
- ✅ VPN不要でも安全な通信を保証

**CVSS Score**: 7.5 (High) - HTTPS強制なしの場合

**暗号化レベル**:
- TLS 1.2以上
- AES-256-GCM暗号化
- Perfect Forward Secrecy (PFS)

---

### Statement 6: サーバーサイド暗号化の強制

```json
{
  "Sid": "DenyUnencryptedObjectUploads",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:PutObject",
  "Resource": [
    "arn:aws:s3:::YOUR-LANDING-BUCKET-NAME/*"
  ],
  "Condition": {
    "StringNotEquals": {
      "s3:x-amz-server-side-encryption": "AES256"
    }
  }
}
```

**目的**: 保存時の暗号化を強制（Encryption at Rest）

**セキュリティポイント**:
- ✅ 暗号化なしのアップロードを拒否
- ✅ S3マネージドキー（SSE-S3）でAES-256暗号化
- ✅ データ漏洩リスクを最小化

**暗号化方式の選択**:
| 方式 | ヘッダー値 | 管理 | コスト |
|---|---|---|---|
| SSE-S3 | `AES256` | AWS管理 | 無料 |
| SSE-KMS | `aws:kms` | カスタムキー | 有料 |
| SSE-C | 顧客提供 | 顧客管理 | 無料 |

**推奨**: SSE-S3（コスト効率と管理の容易さ）

---

## AWS Console での設定手順

### ステップ1: S3バケットの作成

```bash
# フロントエンドバケット
aws s3 mb s3://cis-filesearch-frontend-prod --region ap-northeast-1

# ランディングバケット
aws s3 mb s3://cis-filesearch-landing-prod --region ap-northeast-1

# 処理済みバケット
aws s3 mb s3://cis-filesearch-processed-prod --region ap-northeast-1
```

### ステップ2: ポリシーファイルの編集

1. `s3-bucket-policy.json` をコピー
2. 以下の項目を実際の値に置換:
   - `YOUR-FRONTEND-BUCKET-NAME`
   - `YOUR-LANDING-BUCKET-NAME`
   - `YOUR-PROCESSED-BUCKET-NAME`
   - `YOUR-AWS-ACCOUNT-ID`
   - `YOUR-DISTRIBUTION-ID`
   - `YOUR-LAMBDA-EXECUTION-ROLE`
   - `YOUR-EC2-INSTANCE-ROLE`
   - `203.0.113.0/24` (オンプレミスIP)

### ステップ3: ポリシーの適用

**AWS CLI での適用**:
```bash
# フロントエンドバケット
aws s3api put-bucket-policy \
  --bucket cis-filesearch-frontend-prod \
  --policy file://s3-bucket-policy-frontend.json

# ランディングバケット
aws s3api put-bucket-policy \
  --bucket cis-filesearch-landing-prod \
  --policy file://s3-bucket-policy-landing.json
```

**AWS Console での適用**:
1. **S3** → **Buckets** → バケット選択
2. **Permissions** タブ
3. **Bucket policy** セクション → **Edit**
4. JSONポリシーを貼り付け
5. **Save changes**

### ステップ4: パブリックアクセスブロック設定

```bash
# すべてのパブリックアクセスをブロック
aws s3api put-public-access-block \
  --bucket cis-filesearch-frontend-prod \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

**注意**: CloudFront OACを使用する場合、パブリックアクセスブロックを有効にしても問題ありません。

---

## セキュリティベストプラクティス

### 1. バケットバージョニングの有効化

```bash
aws s3api put-bucket-versioning \
  --bucket cis-filesearch-landing-prod \
  --versioning-configuration Status=Enabled
```

**メリット**:
- 誤削除からの復旧
- ランサムウェア攻撃への対策
- 変更履歴の追跡

### 2. ライフサイクルポリシーの設定

```json
{
  "Rules": [
    {
      "Id": "DeleteLandingFilesAfter30Days",
      "Status": "Enabled",
      "Prefix": "uploads/",
      "Expiration": {
        "Days": 30
      }
    }
  ]
}
```

**適用**:
```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket cis-filesearch-landing-prod \
  --lifecycle-configuration file://lifecycle.json
```

**コスト削減**: ランディングバケットのファイルは処理後30日で自動削除

### 3. アクセスログの有効化

```bash
# ログバケットの作成
aws s3 mb s3://cis-filesearch-access-logs

# ログ有効化
aws s3api put-bucket-logging \
  --bucket cis-filesearch-landing-prod \
  --bucket-logging-status \
    LoggingEnabled={TargetBucket=cis-filesearch-access-logs,TargetPrefix=landing/}
```

**監視対象**:
- 不正アクセス試行
- IP制限外からのアクセス
- 異常なアップロード量

### 4. S3イベント通知の設定

```json
{
  "LambdaFunctionConfigurations": [
    {
      "LambdaFunctionArn": "arn:aws:lambda:ap-northeast-1:123456789012:function:SecurityAlert",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "prefix",
              "Value": "uploads/"
            }
          ]
        }
      }
    }
  ]
}
```

**用途**: ファイルアップロード時にLambdaで自動スキャン

---

## トラブルシューティング

### 問題1: CloudFrontからアクセスできない

**症状**: `403 Forbidden` エラー

**原因**: OAC設定が不完全

**解決策**:
1. CloudFront Behavior設定でOACを選択
2. S3バケットポリシーでDistribution ARNを確認
3. CloudFrontのInvalidationを実行

```bash
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

---

### 問題2: オンプレミスからアップロードできない

**症状**: `Access Denied` エラー

**原因**: IP制限またはHTTPS強制

**解決策**:
1. 現在のパブリックIPを確認:
   ```bash
   curl https://ifconfig.me
   ```

2. S3バケットポリシーのIPアドレス範囲を確認

3. HTTPSでアップロードしているか確認:
   ```bash
   aws s3 cp file.txt s3://bucket/uploads/ --endpoint-url https://s3.ap-northeast-1.amazonaws.com
   ```

---

### 問題3: Lambda関数がS3にアクセスできない

**症状**: `Access Denied` エラー

**原因**: IAMロールの権限不足

**解決策**:
1. Lambda実行ロールを確認
2. S3バケットポリシーのロールARNを確認
3. 以下のIAMポリシーをLambdaロールにアタッチ:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-landing-prod",
        "arn:aws:s3:::cis-filesearch-landing-prod/*"
      ]
    }
  ]
}
```

---

## コスト最適化

### ストレージクラスの使い分け

| バケット | ストレージクラス | 理由 |
|---|---|---|
| フロントエンド | Standard | 頻繁なアクセス |
| ランディング | Standard | 短期間（30日）のみ保存 |
| 処理済み | Intelligent-Tiering | アクセス頻度に応じて自動移動 |

### コスト見積もり

```
フロントエンドバケット: 100MB × $0.025/GB = $0.0025/月
ランディングバケット: 10TB × $0.025/GB × 30日/365日 = $20.55/月
処理済みバケット: 5TB × $0.025/GB = $125/月

合計: 約 $145.55/月
```

---

## まとめ

このS3バケットポリシーにより、以下のセキュリティを確保:

- ✅ **VPN不要** でオンプレミスから安全にアップロード（IP制限 + HTTPS）
- ✅ **CloudFront OAC** でフロントエンドファイルを保護
- ✅ **最小権限の原則** でLambda/EC2のアクセスを制限
- ✅ **HTTPS強制** で通信を暗号化
- ✅ **サーバーサイド暗号化** でデータ保存を保護

**コスト削減**: VPN常時接続 $36/月 → IP制限 $0/月

**セキュリティレベル**: VPN使用時と同等（HTTPS + IP制限 + IAMロール）
