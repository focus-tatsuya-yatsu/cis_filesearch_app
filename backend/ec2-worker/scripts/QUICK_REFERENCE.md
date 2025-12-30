# OpenSearch接続トラブルシューティング - クイックリファレンス

## 1行コマンド集

### 即座に接続をテスト
```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cluster/health"
```

期待される結果:
- `200`: 接続成功
- `403`: 接続成功、IAM権限不足
- `000`: 接続失敗 (ネットワーク問題)

---

### セキュリティグループのインバウンドルールを即座に追加
```bash
# EC2のセキュリティグループIDを取得
EC2_SG=$(aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)

# OpenSearchのセキュリティグループIDを取得
OS_SG=$(aws opensearch describe-domain --domain-name cis-filesearch-opensearch --query 'DomainStatus.VPCOptions.SecurityGroupIds[0]' --output text --region ap-northeast-1)

# ルールを追加
aws ec2 authorize-security-group-ingress --group-id $OS_SG --protocol tcp --port 443 --source-group $EC2_SG --region ap-northeast-1
```

---

### VPC DNS設定を即座に有効化
```bash
VPC_ID=$(aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) --query 'Reservations[0].Instances[0].VpcId' --output text)
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames
```

---

### DNS解決を確認
```bash
nslookup vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
```

---

### Port 443への接続を確認
```bash
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/443' && echo "Port 443 is open" || echo "Port 443 is closed"
```

---

## 問題診断フローチャート

```
接続テスト実行
    │
    ├─ HTTP 200 → ✓ 成功！何もする必要なし
    │
    ├─ HTTP 403 → ネットワークOK、IAM権限の問題
    │             └→ コマンド: ./fix-opensearch-connectivity.sh
    │                └→ 5-10分待機
    │
    └─ HTTP 000 → ネットワーク接続の問題
                  │
                  ├─ DNS解決失敗
                  │   └→ VPC DNS設定を有効化
                  │
                  ├─ Port 443接続失敗
                  │   └→ セキュリティグループルール追加
                  │
                  └─ その他
                      └→ ./diagnose-opensearch.sh で詳細確認
```

---

## EC2インスタンスでの実行手順

### ステップ1: スクリプトをダウンロード

```bash
# SSMまたはSSHでEC2に接続

# スクリプトディレクトリを作成
mkdir -p ~/opensearch-scripts
cd ~/opensearch-scripts

# Gitリポジトリからスクリプトを取得（既存の場合）
# または以下のコマンドで個別にダウンロード
```

### ステップ2: クイックテスト

```bash
# 簡易テストを実行
./test-opensearch-connection.sh
```

### ステップ3A: 成功した場合

```bash
# Pythonからの接続を確認
python3 test-opensearch-with-sigv4.py
```

### ステップ3B: 失敗した場合

```bash
# 詳細診断を実行
./diagnose-opensearch.sh | tee diagnostic-report.txt

# 問題を確認し、修正スクリプトを実行
./fix-opensearch-connectivity.sh

# 5-10分待機してから再テスト
sleep 300
./test-opensearch-connection.sh
```

---

## 各種確認コマンド

### 現在のEC2インスタンス情報
```bash
# インスタンスID
ec2-metadata --instance-id

# VPC ID
aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) \
  --query 'Reservations[0].Instances[0].VpcId' --output text

# セキュリティグループ
aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) \
  --query 'Reservations[0].Instances[0].SecurityGroups[*].[GroupId,GroupName]' --output table

# IAMロール
aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) \
  --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' --output text
```

### OpenSearchドメイン情報
```bash
# ドメイン概要
aws opensearch describe-domain --domain-name cis-filesearch-opensearch --region ap-northeast-1

# エンドポイント
aws opensearch describe-domain --domain-name cis-filesearch-opensearch \
  --query 'DomainStatus.Endpoints.vpc' --output text --region ap-northeast-1

# VPC設定
aws opensearch describe-domain --domain-name cis-filesearch-opensearch \
  --query 'DomainStatus.VPCOptions' --output json --region ap-northeast-1

# セキュリティグループ
aws opensearch describe-domain --domain-name cis-filesearch-opensearch \
  --query 'DomainStatus.VPCOptions.SecurityGroupIds' --output json --region ap-northeast-1
```

### セキュリティグループルール
```bash
# EC2のアウトバウンドルール
EC2_SG=$(aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)
aws ec2 describe-security-groups --group-ids $EC2_SG \
  --query 'SecurityGroups[0].IpPermissionsEgress' --output table

# OpenSearchのインバウンドルール
OS_SG=$(aws opensearch describe-domain --domain-name cis-filesearch-opensearch \
  --query 'DomainStatus.VPCOptions.SecurityGroupIds[0]' --output text --region ap-northeast-1)
aws ec2 describe-security-groups --group-ids $OS_SG \
  --query 'SecurityGroups[0].IpPermissions' --output table
```

### IAM権限確認
```bash
# インスタンスロール名を取得
PROFILE_ARN=$(aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) \
  --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' --output text)
PROFILE_NAME=$(echo $PROFILE_ARN | awk -F'/' '{print $NF}')

# ロールに付与されているポリシーを確認
aws iam list-role-policies --role-name $(aws iam get-instance-profile --instance-profile-name $PROFILE_NAME \
  --query 'InstanceProfile.Roles[0].RoleName' --output text)

# アタッチされているマネージドポリシー
aws iam list-attached-role-policies --role-name $(aws iam get-instance-profile --instance-profile-name $PROFILE_NAME \
  --query 'InstanceProfile.Roles[0].RoleName' --output text)
```

---

## よく使うcurlコマンド

### クラスター健全性チェック
```bash
curl -s "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cluster/health" | jq '.'
```

### クラスター情報取得
```bash
curl -s "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/" | jq '.'
```

### インデックス一覧
```bash
curl -s "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cat/indices?format=json" | jq '.'
```

### 特定インデックスの情報
```bash
curl -s "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/files" | jq '.'
```

### ドキュメント検索
```bash
curl -s -X POST "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/files/_search" \
  -H 'Content-Type: application/json' \
  -d '{"query": {"match_all": {}}, "size": 5}' | jq '.'
```

---

## トラブルシューティングチェックリスト

### ネットワーク層
- [ ] EC2とOpenSearchが同じVPCにある
- [ ] VPC DNS supportが有効
- [ ] VPC DNS hostnamesが有効
- [ ] DNS解決が成功する
- [ ] Port 443への接続が成功する

### セキュリティグループ層
- [ ] EC2セキュリティグループがHTTPS (443) アウトバウンドを許可
- [ ] OpenSearchセキュリティグループがEC2からのインバウンドを許可 (443)
- [ ] ルールが正しいプロトコル (TCP) とポートを指定している

### IAM層
- [ ] EC2インスタンスにIAMロールがアタッチされている
- [ ] IAMロールにOpenSearchアクセス権限がある
- [ ] OpenSearchアクセスポリシーがIAMロールを許可している
- [ ] ポリシー変更後、5-10分待機した

### アプリケーション層
- [ ] 正しいエンドポイントURLを使用している
- [ ] AWS Signature V4認証を使用している (Pythonの場合)
- [ ] 適切なリージョンを指定している
- [ ] タイムアウト設定が十分 (30秒以上推奨)

---

## 緊急時の対応

### 接続が完全に失敗している場合

1. **即座にセキュリティグループを修正**:
   ```bash
   ./fix-opensearch-connectivity.sh
   ```

2. **それでも失敗する場合、手動で確認**:
   ```bash
   # VPC一致を確認
   ./diagnose-opensearch.sh | grep "VPC Match"

   # 異なるVPCの場合は即座にサポートに連絡
   ```

3. **一時的な回避策**:
   - SSH/SSMで接続可能な別のEC2インスタンス (同じVPC内) で試す
   - VPCピアリングまたは新しいOpenSearchドメインの作成を検討

---

## パフォーマンスチューニング

### 接続タイムアウトの設定

```bash
# curlでタイムアウトを設定
curl --max-time 30 "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cluster/health"
```

### Pythonでのタイムアウト設定

```python
from opensearchpy import OpenSearch

client = OpenSearch(
    hosts=[{'host': 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com', 'port': 443}],
    timeout=30,           # 全体のタイムアウト
    retry_on_timeout=True # タイムアウト時にリトライ
)
```

---

## ログとモニタリング

### CloudWatchログの確認

```bash
# OpenSearchのログストリームを確認
aws logs describe-log-streams \
  --log-group-name /aws/opensearch/cis-filesearch-opensearch \
  --region ap-northeast-1 \
  --order-by LastEventTime \
  --descending \
  --max-items 5

# 最新のログを表示
aws logs tail /aws/opensearch/cis-filesearch-opensearch --follow --region ap-northeast-1
```

### VPCフローログの確認

```bash
# VPCフローログを表示 (有効な場合)
aws logs tail /aws/vpc/flowlogs --follow --region ap-northeast-1
```

---

## 定期的なヘルスチェック

### cronで定期チェック

```bash
# crontabに追加
crontab -e

# 5分ごとにヘルスチェック
*/5 * * * * /path/to/test-opensearch-connection.sh >> /var/log/opensearch-health.log 2>&1
```

### CloudWatchメトリクスの設定

```bash
# OpenSearchのメトリクスを確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/ES \
  --metric-name ClusterStatus.green \
  --dimensions Name=DomainName,Value=cis-filesearch-opensearch \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average \
  --region ap-northeast-1
```

---

## サポート連絡時に提供する情報

問題が解決しない場合、以下の情報を収集してサポートに連絡:

```bash
# 診断レポートを生成
./diagnose-opensearch.sh > diagnostic-report-$(date +%Y%m%d-%H%M%S).txt 2>&1

# 以下の情報も含める:
# 1. EC2インスタンスID
# 2. OpenSearchドメイン名
# 3. VPC ID
# 4. セキュリティグループID (EC2とOpenSearch)
# 5. エラーメッセージの全文
# 6. 実行したコマンドと結果
```

---

## まとめ

**最も重要な3つのコマンド**:

1. **テスト**: `./test-opensearch-connection.sh`
2. **診断**: `./diagnose-opensearch.sh`
3. **修正**: `./fix-opensearch-connectivity.sh`

この順番で実行すれば、ほとんどの接続問題は解決できます。
