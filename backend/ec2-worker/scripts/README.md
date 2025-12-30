# OpenSearch Connectivity Troubleshooting Scripts

このディレクトリには、EC2インスタンスからVPC内のOpenSearchドメインへの接続問題を診断・修正するためのスクリプトが含まれています。

## スクリプト一覧

### 1. test-opensearch-connection.sh
**目的**: OpenSearch接続の簡易テスト
**使用場面**: 接続が機能しているか素早く確認したい時

```bash
# 実行権限を付与
chmod +x test-opensearch-connection.sh

# 実行
./test-opensearch-connection.sh
```

**テスト内容**:
- DNS解決
- TCPコネクション (port 443)
- HTTPSリクエスト
- OpenSearch APIテスト

**終了コード**:
- `0`: すべてのテストが成功
- `1`: ネットワーク接続の問題
- `2`: 接続はOKだがIAM権限の問題

---

### 2. diagnose-opensearch.sh
**目的**: 接続問題の詳細診断
**使用場面**: 接続が失敗する原因を特定したい時

```bash
# 実行権限を付与
chmod +x diagnose-opensearch.sh

# 実行
./diagnose-opensearch.sh
```

**診断内容**:
1. EC2インスタンス情報の収集
2. VPC設定の確認
3. OpenSearchドメイン設定の確認
4. VPC一致の検証
5. DNS解決テスト
6. ネットワーク接続テスト
7. EC2セキュリティグループのアウトバウンドルール分析
8. OpenSearchセキュリティグループのインバウンドルール分析
9. HTTP接続テスト

**出力**:
- 各チェック項目の結果 (✓ 成功, ✗ 失敗, ⚠ 警告)
- 問題が見つかった場合の具体的な修正コマンド
- 総合診断サマリー

---

### 3. fix-opensearch-connectivity.sh
**目的**: 一般的な接続問題の自動修正
**使用場面**: 診断スクリプトで問題が特定され、自動修正を試したい時

```bash
# 実行権限を付与
chmod +x fix-opensearch-connectivity.sh

# 実行
./fix-opensearch-connectivity.sh
```

**修正内容**:
1. **セキュリティグループルールの追加**
   - OpenSearchセキュリティグループにEC2からのインバウンドルールを追加
   - Port 443でのアクセスを許可

2. **VPC DNS設定の有効化**
   - DNS Supportを有効化
   - DNS Hostnamesを有効化

3. **IAM権限の設定**
   - EC2インスタンスロールにOpenSearchアクセスポリシーを追加
   - OpenSearchアクセスポリシーにIAMロールを追加

4. **接続テスト**
   - 修正後の接続確認

**注意事項**:
- IAM権限が必要です (セキュリティグループ、IAM、OpenSearch設定変更権限)
- OpenSearchアクセスポリシーの変更は5-10分かかる場合があります

---

### 4. test-opensearch-with-sigv4.py
**目的**: AWS Signature V4認証を使用した完全な接続テスト
**使用場面**: Pythonコードからの接続方法を確認したい時、または最も正確なテストを実行したい時

```bash
# 必要なPythonパッケージを自動インストール
python3 test-opensearch-with-sigv4.py
```

**テスト内容**:
1. 基本的なHTTPS接続テスト
2. AWS認証情報の取得
3. OpenSearchクライアントの作成
4. クラスター健全性チェック
5. クラスター情報取得
6. インデックス操作テスト
7. 検索機能テスト (ボーナス)

**必要なパッケージ** (自動インストールされます):
- `boto3`: AWS SDK
- `opensearch-py`: OpenSearch Python クライアント
- `requests-aws4auth`: AWS Signature V4認証

**出力**:
- 各テストステップの詳細結果
- クラスター情報 (名前、バージョン、ノード数など)
- 既存インデックスのリスト
- サンプルドキュメント (存在する場合)

---

## 使用順序 (推奨)

### ステップ1: 簡易テスト
まず簡易テストで現状を確認:
```bash
./test-opensearch-connection.sh
```

### ステップ2: 詳細診断
問題がある場合、詳細診断を実行:
```bash
./diagnose-opensearch.sh
```

### ステップ3: 自動修正
診断結果を基に自動修正を試行:
```bash
./fix-opensearch-connectivity.sh
```

### ステップ4: Python接続テスト
修正後、Pythonからの接続を確認:
```bash
python3 test-opensearch-with-sigv4.py
```

---

## 一般的な問題と解決方法

### 問題1: DNS解決に失敗する

**症状**:
```
✗ DNS resolution failed
```

**原因**:
- VPCでDNS解決が無効
- VPCでDNSホスト名が無効

**解決方法**:
```bash
# VPC IDを取得
VPC_ID=$(aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) \
  --query 'Reservations[0].Instances[0].VpcId' --output text)

# DNS設定を有効化
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames
```

---

### 問題2: Port 443に接続できない

**症状**:
```
✗ Cannot connect to port 443
```

**原因**:
- セキュリティグループルールが不足
- ネットワークACLがトラフィックをブロック

**解決方法**:
```bash
# 自動修正スクリプトを実行
./fix-opensearch-connectivity.sh
```

または手動で:
```bash
# OpenSearchのセキュリティグループIDを取得
OPENSEARCH_SG=$(aws opensearch describe-domain --domain-name cis-filesearch-opensearch \
  --query 'DomainStatus.VPCOptions.SecurityGroupIds[0]' --output text)

# EC2のセキュリティグループIDを取得
EC2_SG=$(aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)

# インバウンドルールを追加
aws ec2 authorize-security-group-ingress \
  --group-id $OPENSEARCH_SG \
  --protocol tcp \
  --port 443 \
  --source-group $EC2_SG \
  --region ap-northeast-1
```

---

### 問題3: HTTP 403 Forbidden

**症状**:
```
HTTP Response Code: 403
⚠ WARNING: Connection successful but access denied
```

**原因**:
- IAMロールにOpenSearch権限がない
- OpenSearchアクセスポリシーがIAMロールを許可していない

**解決方法**:
```bash
# 自動修正スクリプトを実行
./fix-opensearch-connectivity.sh
```

または手動で:

**1. IAMロールにポリシーを追加**:
```bash
# IAMロール名を取得
IAM_ROLE=$(aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) \
  --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' --output text | awk -F'/' '{print $2}')

# ポリシードキュメントを作成
cat > /tmp/opensearch-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPut",
        "es:ESHttpPost",
        "es:ESHttpHead",
        "es:ESHttpDelete",
        "es:DescribeDomain"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-opensearch/*"
    }
  ]
}
EOF

# ポリシーをロールに追加
aws iam put-role-policy \
  --role-name $IAM_ROLE \
  --policy-name OpenSearchAccess \
  --policy-document file:///tmp/opensearch-policy.json
```

**2. OpenSearchアクセスポリシーを更新**:
```bash
# IAMロールARNを取得
ROLE_ARN=$(aws iam get-role --role-name $IAM_ROLE --query 'Role.Arn' --output text)

# アクセスポリシーを作成
cat > /tmp/opensearch-access-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "$ROLE_ARN"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-opensearch/*"
    }
  ]
}
EOF

# OpenSearchドメインのアクセスポリシーを更新
aws opensearch update-domain-config \
  --domain-name cis-filesearch-opensearch \
  --access-policies file:///tmp/opensearch-access-policy.json \
  --region ap-northeast-1
```

**注意**: アクセスポリシーの変更は5-10分かかる場合があります。

---

### 問題4: EC2とOpenSearchが異なるVPCにある

**症状**:
```
✗ ERROR: EC2 and OpenSearch are in DIFFERENT VPCs!
```

**原因**:
- リソースが異なるVPCに配置されている

**解決方法**:

**オプション1: VPCピアリング (推奨)**
1. VPCピアリング接続を作成
2. ルートテーブルを更新
3. セキュリティグループを更新

**オプション2: リソースを同じVPCに移動**
- OpenSearchドメインを再作成 (ダウンタイムあり)
- または EC2インスタンスを移動

---

## 環境変数

スクリプトで使用する環境変数をカスタマイズできます:

```bash
# OpenSearchエンドポイント
export OPENSEARCH_ENDPOINT="https://your-opensearch-endpoint.es.amazonaws.com"

# リージョン
export AWS_REGION="ap-northeast-1"

# ドメイン名
export OPENSEARCH_DOMAIN="your-domain-name"
```

---

## トラブルシューティングフロー

```
┌─────────────────────────────────────┐
│ 接続テスト実行                       │
│ ./test-opensearch-connection.sh     │
└─────────────┬───────────────────────┘
              │
              ├─ 成功 (HTTP 200) → 完了!
              │
              ├─ HTTP 403
              │   └→ ./fix-opensearch-connectivity.sh
              │       └→ IAM権限修正
              │           └→ 5-10分待機
              │               └→ 再テスト
              │
              └─ 接続失敗 (HTTP 000)
                  └→ ./diagnose-opensearch.sh
                      └→ 診断結果確認
                          ├→ セキュリティグループ問題
                          │   └→ ./fix-opensearch-connectivity.sh
                          │
                          ├→ DNS解決問題
                          │   └→ VPC DNS設定修正
                          │
                          ├→ VPC不一致
                          │   └→ VPCピアリング or リソース移動
                          │
                          └→ その他
                              └→ AWSサポートに連絡
```

---

## 必要なIAM権限

スクリプトを実行するEC2インスタンスロールには、以下の権限が必要です:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeVpcs",
        "ec2:DescribeVpcAttribute",
        "ec2:DescribeRouteTables",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:ModifyVpcAttribute",
        "es:DescribeDomain",
        "es:UpdateDomainConfig",
        "es:ESHttpGet",
        "es:ESHttpHead",
        "iam:GetRole",
        "iam:GetInstanceProfile",
        "iam:PutRolePolicy",
        "iam:ListRolePolicies"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## サポートとログ

### ログの確認

診断スクリプトの出力を保存:
```bash
./diagnose-opensearch.sh 2>&1 | tee diagnostic-report.txt
```

### CloudWatchログの確認

OpenSearchのログを確認:
```bash
# ログストリームを取得
aws logs describe-log-streams \
  --log-group-name /aws/opensearch/cis-filesearch-opensearch \
  --region ap-northeast-1

# ログを表示
aws logs tail /aws/opensearch/cis-filesearch-opensearch --follow
```

### VPCフローログの有効化

ネットワークトラフィックを分析:
```bash
# VPCフローログを有効化
aws ec2 create-flow-logs \
  --resource-type VPC \
  --resource-ids $VPC_ID \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /aws/vpc/flowlogs
```

---

## よくある質問 (FAQ)

### Q: スクリプトの実行に時間がかかる
**A**: 診断スクリプトは包括的なチェックを行うため、1-2分かかる場合があります。タイムアウトエラーが発生する場合は、ネットワーク接続に問題がある可能性が高いです。

### Q: 修正スクリプト実行後も接続できない
**A**: IAMポリシーやOpenSearchアクセスポリシーの変更は、反映に5-10分かかる場合があります。少し待ってから再度テストしてください。

### Q: 複数のEC2インスタンスから接続したい
**A**: セキュリティグループベースのルールを使用している場合、同じセキュリティグループのすべてのインスタンスがアクセス可能になります。個別のインスタンスに制限する場合は、IAMロールベースのアクセス制御を使用してください。

### Q: スクリプトがAWS CLIエラーを表示する
**A**: EC2インスタンスにIAMロールが適切にアタッチされているか確認してください。また、AWS CLIが最新バージョンか確認してください: `aws --version`

---

## 追加リソース

- [OpenSearch Service VPC Troubleshooting](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/vpc.html)
- [VPC Security Groups](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_SecurityGroups.html)
- [OpenSearch Service Access Control](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/ac.html)
- [AWS Signature Version 4](https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html)

---

## 変更履歴

- **2025-01-XX**: 初版作成
  - 診断スクリプト
  - 修正スクリプト
  - テストスクリプト (Bash, Python)
  - ドキュメント
