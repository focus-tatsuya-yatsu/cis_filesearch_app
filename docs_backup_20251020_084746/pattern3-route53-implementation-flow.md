# Pattern 3: Route53 + ACM 実装手順フローチャート

## 概要

Pattern 3アーキテクチャに**Route53（カスタムドメイン）**と**ACM（HTTPS暗号化）**を追加する実装手順を視覚化します。

**実装期間**: 4週間（Week 1-4）
**総作業時間**: 約40時間
**必要なスキル**: AWS CLI、Terraform、DNS管理、SSL/TLS基礎知識

**重要**: 各ステップの成果物を確認してから次のステップに進んでください。

---

## 実装ロードマップ

```mermaid
gantt
    title Pattern 3 Route53 + ACM 実装ロードマップ（4週間）
    dateFormat YYYY-MM-DD
    section Week 1
    Route53 Hosted Zone作成           :w1t1, 2025-01-20, 2d
    NSレコード社内DNS登録              :w1t2, after w1t1, 2d
    Aレコード作成                      :w1t3, after w1t2, 1d
    section Week 2
    ACM証明書リクエスト                :w2t1, 2025-01-27, 1d
    DNS検証レコード作成                :w2t2, after w2t1, 1d
    証明書発行確認（待機）             :w2t3, after w2t2, 2d
    section Week 3
    API Gateway Custom Domain作成      :w3t1, 2025-02-03, 2d
    API Mapping作成                    :w3t2, after w3t1, 1d
    Route53 Aレコード更新              :w3t3, after w3t2, 1d
    DNS伝播確認                        :w3t4, after w3t3, 1d
    section Week 4
    API Gatewayリソースポリシー設定    :w4t1, 2025-02-10, 2d
    Next.jsフロントエンド更新          :w4t2, after w4t1, 1d
    統合テスト                         :w4t3, after w4t2, 2d
```

---

## 実装フローチャート（全体）

```mermaid
flowchart TD
    Start([実装開始]) --> PreCheck{前提条件確認}

    PreCheck -->|OK| Week1[Week 1: Route53設定]
    PreCheck -->|NG| FixPrereq[前提条件を満たす]
    FixPrereq --> PreCheck

    Week1 --> Week1Check{Route53動作確認}
    Week1Check -->|OK| Week2[Week 2: ACM証明書発行]
    Week1Check -->|NG| Week1Debug[Week 1トラブルシュート]
    Week1Debug --> Week1

    Week2 --> Week2Check{証明書発行確認}
    Week2Check -->|OK| Week3[Week 3: API Gateway設定]
    Week2Check -->|NG| Week2Debug[Week 2トラブルシュート]
    Week2Debug --> Week2

    Week3 --> Week3Check{Custom Domain動作確認}
    Week3Check -->|OK| Week4[Week 4: セキュリティ & テスト]
    Week3Check -->|NG| Week3Debug[Week 3トラブルシュート]
    Week3Debug --> Week3

    Week4 --> Week4Check{統合テスト合格}
    Week4Check -->|OK| Production[本番稼働]
    Week4Check -->|NG| Week4Debug[Week 4トラブルシュート]
    Week4Debug --> Week4

    Production --> End([実装完了])

    style Start fill:#4caf50,color:#fff
    style End fill:#4caf50,color:#fff
    style Production fill:#2196f3,color:#fff
    style Week1 fill:#ff9800
    style Week2 fill:#ff9800
    style Week3 fill:#ff9800
    style Week4 fill:#ff9800
    style Week1Debug fill:#f44336,color:#fff
    style Week2Debug fill:#f44336,color:#fff
    style Week3Debug fill:#f44336,color:#fff
    style Week4Debug fill:#f44336,color:#fff
```

---

## 前提条件チェックリスト

```mermaid
flowchart LR
    subgraph "前提条件確認"
        P1[AWS CLIインストール]
        P2[IAM権限確認]
        P3[ドメイン名決定]
        P4[社内DNS管理者との調整]
        P5[既存Pattern 3稼働中]
    end

    P1 --> Check{すべてOK?}
    P2 --> Check
    P3 --> Check
    P4 --> Check
    P5 --> Check

    Check -->|YES| Ready[実装開始可能]
    Check -->|NO| Fix[未完了項目を対応]

    style Ready fill:#4caf50,color:#fff
    style Fix fill:#f44336,color:#fff
```

### 前提条件詳細

| 項目 | 確認内容 | 必須度 |
|------|---------|--------|
| **AWS CLI** | v2.x以上インストール済み | 🔴 必須 |
| **IAM権限** | Route53、ACM、API Gateway管理権限 | 🔴 必須 |
| **ドメイン名** | `filesearch.company.com` 決定済み | 🔴 必須 |
| **社内DNS調整** | IT部門との調整完了 | 🔴 必須 |
| **Pattern 3稼働** | 既存アーキテクチャが正常動作 | 🔴 必須 |
| **Terraformスキル** | IaCによる管理（推奨） | 🟡 推奨 |
| **SSL/TLS知識** | 証明書の基礎理解 | 🟢 あれば良い |

---

## Week 1: Route53 Hosted Zone作成

### フローチャート

```mermaid
flowchart TD
    W1Start([Week 1開始]) --> T1[Task 1-1: Hosted Zone作成]
    T1 --> T1Check{作成成功?}
    T1Check -->|YES| T2[Task 1-2: NSレコード取得]
    T1Check -->|NO| T1Error[エラー原因調査<br/>IAM権限確認]
    T1Error --> T1

    T2 --> T3[Task 1-3: 社内DNS管理者に連絡]
    T3 --> T4[Task 1-4: NSレコード登録依頼]
    T4 --> T4Wait[社内DNS設定待機<br/>1-2営業日]
    T4Wait --> T5[Task 1-5: DNS伝播確認]

    T5 --> T5Check{nslookup成功?}
    T5Check -->|YES| T6[Task 1-6: Aレコード作成<br/>ダミーIP登録]
    T5Check -->|NO| T5Wait[DNS伝播待機<br/>最大48時間]
    T5Wait --> T5

    T6 --> T6Check{Route53動作確認}
    T6Check -->|OK| W1End([Week 1完了])
    T6Check -->|NG| T6Error[トラブルシュート]
    T6Error --> T6

    style W1Start fill:#4caf50,color:#fff
    style W1End fill:#4caf50,color:#fff
    style T1Error fill:#f44336,color:#fff
    style T6Error fill:#f44336,color:#fff
    style T4Wait fill:#ff9800
    style T5Wait fill:#ff9800
```

### 実装コマンド

#### Task 1-1: Hosted Zone作成

```bash
# Hosted Zoneの作成
aws route53 create-hosted-zone \
  --name filesearch.company.com \
  --caller-reference $(date +%s) \
  --hosted-zone-config Comment="CIS File Search App"

# 出力例:
# {
#   "HostedZone": {
#     "Id": "/hostedzone/Z1234567890ABC",
#     "Name": "filesearch.company.com.",
#     "CallerReference": "1705456789"
#   }
# }
```

#### Task 1-2: NSレコード取得

```bash
# NSレコードの確認
aws route53 get-hosted-zone \
  --id Z1234567890ABC \
  --query "DelegationSet.NameServers" \
  --output table

# 出力例:
# ns-1234.awsdns-56.org
# ns-789.awsdns-01.com
# ns-234.awsdns-89.net
# ns-567.awsdns-12.co.uk
```

#### Task 1-5: DNS伝播確認

```bash
# nslookupで確認
nslookup filesearch.company.com

# digで確認
dig filesearch.company.com NS +short
```

### 成果物

- ✅ **Route53 Hosted Zone ID**: `Z1234567890ABC`
- ✅ **NSレコード**: 4つのネームサーバー
- ✅ **社内DNS登録**: IT部門確認済み
- ✅ **DNS伝播確認**: nslookup成功

---

## Week 2: ACM証明書発行

### フローチャート

```mermaid
flowchart TD
    W2Start([Week 2開始]) --> T1[Task 2-1: ACM証明書リクエスト]
    T1 --> T1Check{リクエスト成功?}
    T1Check -->|YES| T2[Task 2-2: DNS検証レコード確認]
    T1Check -->|NO| T1Error[エラー原因調査<br/>リージョン確認<br/>ap-northeast-1必須]
    T1Error --> T1

    T2 --> T3[Task 2-3: Route53にCNAMEレコード追加]
    T3 --> T3Auto{自動追加可能?}
    T3Auto -->|YES| T4[ACM自動検証]
    T3Auto -->|NO| T3Manual[手動でCNAMEレコード作成]
    T3Manual --> T4

    T4 --> T4Wait[証明書発行待機<br/>5-30分]
    T4Wait --> T5[Task 2-4: 証明書ステータス確認]

    T5 --> T5Check{Status: ISSUED?}
    T5Check -->|YES| T6[Task 2-5: 証明書ARN取得]
    T5Check -->|PENDING| T5Wait[検証待機<br/>最大72時間]
    T5Check -->|FAILED| T5Error[トラブルシュート<br/>DNSレコード確認]
    T5Wait --> T5
    T5Error --> T3

    T6 --> W2End([Week 2完了])

    style W2Start fill:#4caf50,color:#fff
    style W2End fill:#4caf50,color:#fff
    style T1Error fill:#f44336,color:#fff
    style T5Error fill:#f44336,color:#fff
    style T4Wait fill:#ff9800
    style T5Wait fill:#ff9800
```

### 実装コマンド

#### Task 2-1: ACM証明書リクエスト

```bash
# 証明書リクエスト（ap-northeast-1必須）
aws acm request-certificate \
  --domain-name filesearch.company.com \
  --validation-method DNS \
  --region ap-northeast-1

# 出力例:
# {
#   "CertificateArn": "arn:aws:acm:ap-northeast-1:123456789012:certificate/abcd1234-..."
# }
```

#### Task 2-2: DNS検証レコード確認

```bash
# 検証レコード確認
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:ap-northeast-1:123456789012:certificate/abcd1234-... \
  --region ap-northeast-1 \
  --query "Certificate.DomainValidationOptions[0].ResourceRecord"

# 出力例:
# {
#   "Name": "_1234abcd...filesearch.company.com.",
#   "Type": "CNAME",
#   "Value": "_5678efgh...acm-validations.aws."
# }
```

#### Task 2-3: Route53にCNAMEレコード追加（自動）

```bash
# AWS CLI v2で自動検証
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:ap-northeast-1:123456789012:certificate/abcd1234-... \
  --region ap-northeast-1 \
  --query "Certificate.DomainValidationOptions[0].ResourceRecord" \
  | jq -r '. | "Name: \(.Name)\nType: \(.Type)\nValue: \(.Value)"'

# Route53にCNAMEレコード作成（change-batch.json使用）
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch file://change-batch.json
```

**change-batch.json**:
```json
{
  "Changes": [
    {
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "_1234abcd...filesearch.company.com.",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [
          {
            "Value": "_5678efgh...acm-validations.aws."
          }
        ]
      }
    }
  ]
}
```

#### Task 2-5: 証明書ステータス確認

```bash
# 証明書ステータス確認
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:ap-northeast-1:123456789012:certificate/abcd1234-... \
  --region ap-northeast-1 \
  --query "Certificate.Status" \
  --output text

# 出力例: ISSUED
```

### 成果物

- ✅ **証明書ARN**: `arn:aws:acm:ap-northeast-1:123456789012:certificate/abcd1234-...`
- ✅ **証明書ステータス**: `ISSUED`
- ✅ **DNS検証**: 完了
- ✅ **有効期限**: 自動更新設定済み

---

## Week 3: API Gateway Custom Domain設定

### フローチャート

```mermaid
flowchart TD
    W3Start([Week 3開始]) --> T1[Task 3-1: Custom Domain Name作成]
    T1 --> T1Check{作成成功?}
    T1Check -->|YES| T2[Task 3-2: API Mapping作成]
    T1Check -->|NO| T1Error[エラー原因調査<br/>証明書ARN確認<br/>TLS 1.2設定確認]
    T1Error --> T1

    T2 --> T2Check{Mapping成功?}
    T2Check -->|YES| T3[Task 3-3: CloudFront Distribution確認]
    T2Check -->|NO| T2Error[トラブルシュート<br/>API ID確認<br/>Stageパス確認]
    T2Error --> T2

    T3 --> T4[Task 3-4: Route53 Aレコード更新]
    T4 --> T5[Task 3-5: DNS伝播待機<br/>5-10分]
    T5 --> T6[Task 3-6: HTTPS接続テスト]

    T6 --> T6Check{HTTPS応答OK?}
    T6Check -->|YES| T7[Task 3-7: SSL証明書検証]
    T6Check -->|NO| T6Error[トラブルシュート<br/>DNS確認<br/>API Gateway設定確認]
    T6Error --> T6

    T7 --> T7Check{TLS 1.3確認?}
    T7Check -->|YES| W3End([Week 3完了])
    T7Check -->|NO| T7Warn[警告: TLS 1.2のみ<br/>API Gateway設定見直し]
    T7Warn --> T1

    style W3Start fill:#4caf50,color:#fff
    style W3End fill:#4caf50,color:#fff
    style T1Error fill:#f44336,color:#fff
    style T2Error fill:#f44336,color:#fff
    style T6Error fill:#f44336,color:#fff
    style T7Warn fill:#ff9800
    style T5 fill:#ff9800
```

### 実装コマンド

#### Task 3-1: Custom Domain Name作成

```bash
# Custom Domain Name作成
aws apigatewayv2 create-domain-name \
  --domain-name filesearch.company.com \
  --domain-name-configurations \
    CertificateArn=arn:aws:acm:ap-northeast-1:123456789012:certificate/abcd1234-...,\
    EndpointType=REGIONAL,\
    SecurityPolicy=TLS_1_2 \
  --region ap-northeast-1

# 出力例:
# {
#   "DomainName": "filesearch.company.com",
#   "DomainNameConfigurations": [
#     {
#       "ApiGatewayDomainName": "d-abc123xyz.execute-api.ap-northeast-1.amazonaws.com"
#     }
#   ]
# }
```

#### Task 3-2: API Mapping作成

```bash
# 既存のAPI IDとStageを確認
aws apigatewayv2 get-apis --region ap-northeast-1

# API Mapping作成
aws apigatewayv2 create-api-mapping \
  --domain-name filesearch.company.com \
  --api-id abc123xyz \
  --stage prod \
  --region ap-northeast-1
```

#### Task 3-4: Route53 Aレコード更新

```bash
# Aレコード（Alias）作成
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch file://alias-record.json
```

**alias-record.json**:
```json
{
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "filesearch.company.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z1UJRXOUMOOFQ8",
          "DNSName": "d-abc123xyz.execute-api.ap-northeast-1.amazonaws.com",
          "EvaluateTargetHealth": false
        }
      }
    }
  ]
}
```

**注意**: `HostedZoneId`は東京リージョンのAPI Gateway固定値 `Z1UJRXOUMOOFQ8`

#### Task 3-6: HTTPS接続テスト

```bash
# curlでHTTPS接続テスト
curl -I https://filesearch.company.com/health

# 期待される出力:
# HTTP/2 200
# content-type: application/json
# ...
```

#### Task 3-7: SSL証明書検証

```bash
# OpenSSLでTLS確認
openssl s_client -connect filesearch.company.com:443 -tls1_3

# 証明書情報確認
echo | openssl s_client -connect filesearch.company.com:443 2>/dev/null | openssl x509 -noout -text
```

### 成果物

- ✅ **Custom Domain Name**: `filesearch.company.com`
- ✅ **API Mapping**: `prod` stage
- ✅ **Route53 Aレコード**: API Gatewayエイリアス
- ✅ **HTTPS接続**: 正常動作確認
- ✅ **TLS 1.2/1.3**: 証明書検証完了

---

## Week 4: セキュリティ設定 & 統合テスト

### フローチャート

```mermaid
flowchart TD
    W4Start([Week 4開始]) --> T1[Task 4-1: リソースポリシー設定]
    T1 --> T1Check{ポリシー適用成功?}
    T1Check -->|YES| T2[Task 4-2: IPアドレス制限テスト]
    T1Check -->|NO| T1Error[エラー原因調査<br/>JSON構文確認<br/>IAM権限確認]
    T1Error --> T1

    T2 --> T2Check{制限動作確認?}
    T2Check -->|YES| T3[Task 4-3: Next.jsフロントエンド更新]
    T2Check -->|NO| T2Error[トラブルシュート<br/>社内IPアドレス確認<br/>VPN IP確認]
    T2Error --> T2

    T3 --> T3Check{ビルド成功?}
    T3Check -->|YES| T4[Task 4-4: 統合テスト実施]
    T3Check -->|NO| T3Error[ビルドエラー解決]
    T3Error --> T3

    T4 --> T5{Azure AD SSOテスト}
    T5 -->|PASS| T6{検索機能テスト}
    T5 -->|FAIL| T5Error[Azure AD設定確認<br/>リダイレクトURI更新]
    T5Error --> T5

    T6 -->|PASS| T7{パフォーマンステスト}
    T6 -->|FAIL| T6Error[API接続確認<br/>CORS設定確認]
    T6Error --> T6

    T7 -->|PASS| T8{セキュリティテスト}
    T7 -->|FAIL| T7Warn[警告: レイテンシ高<br/>OpenSearch調査]
    T7Warn --> T8

    T8 -->|PASS| T9[Task 4-5: 本番デプロイ準備]
    T8 -->|FAIL| T8Error[セキュリティ問題解決]
    T8Error --> T8

    T9 --> T9Check{デプロイ承認?}
    T9Check -->|YES| W4End([Week 4完了<br/>本番稼働])
    T9Check -->|NO| T9Wait[承認待機]
    T9Wait --> T9

    style W4Start fill:#4caf50,color:#fff
    style W4End fill:#2196f3,color:#fff
    style T1Error fill:#f44336,color:#fff
    style T2Error fill:#f44336,color:#fff
    style T3Error fill:#f44336,color:#fff
    style T5Error fill:#f44336,color:#fff
    style T6Error fill:#f44336,color:#fff
    style T8Error fill:#f44336,color:#fff
    style T7Warn fill:#ff9800
    style T9Wait fill:#ff9800
```

### 実装コマンド

#### Task 4-1: API Gatewayリソースポリシー設定

```bash
# リソースポリシー適用
aws apigatewayv2 update-api \
  --api-id abc123xyz \
  --policy file://resource-policy.json \
  --region ap-northeast-1
```

**resource-policy.json**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:ap-northeast-1:123456789012:abc123xyz/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "203.0.113.0/24",
            "198.51.100.0/24"
          ]
        }
      }
    }
  ]
}
```

#### Task 4-2: IPアドレス制限テスト

```bash
# 社内ネットワークからのテスト（成功するべき）
curl -I https://filesearch.company.com/health

# 外部ネットワークからのテスト（失敗するべき）
# AWS Cloud9等で実行
curl -I https://filesearch.company.com/health
# 期待される出力: 403 Forbidden
```

#### Task 4-3: Next.jsフロントエンド更新

**環境変数更新** (`next.config.js` または `.env.production`):
```javascript
// 更新前
NEXT_PUBLIC_API_BASE_URL=https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod

// 更新後
NEXT_PUBLIC_API_BASE_URL=https://filesearch.company.com
```

**ビルド & デプロイ**:
```bash
# Next.jsビルド
cd frontend
yarn build

# ECS Fargateデプロイ
docker build -t cis-filesearch-frontend:latest .
docker tag cis-filesearch-frontend:latest 123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/cis-filesearch-frontend:latest
docker push 123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/cis-filesearch-frontend:latest

# ECS Serviceアップデート
aws ecs update-service \
  --cluster cis-filesearch-cluster \
  --service frontend-service \
  --force-new-deployment
```

### 統合テストチェックリスト

```mermaid
flowchart LR
    subgraph "統合テスト項目"
        T1[✅ Azure AD SSOログイン]
        T2[✅ 検索機能動作]
        T3[✅ ファイルプレビュー]
        T4[✅ パフォーマンス<br/>レスポンス < 200ms]
        T5[✅ セキュリティ<br/>IPアドレス制限]
        T6[✅ HTTPS暗号化<br/>TLS 1.3]
        T7[✅ エラーハンドリング]
        T8[✅ ログ出力確認]
    end

    T1 --> Result{すべて<br/>PASS?}
    T2 --> Result
    T3 --> Result
    T4 --> Result
    T5 --> Result
    T6 --> Result
    T7 --> Result
    T8 --> Result

    Result -->|YES| Production[本番デプロイ承認]
    Result -->|NO| Debug[デバッグ & 修正]

    style Production fill:#4caf50,color:#fff
    style Debug fill:#f44336,color:#fff
```

### 成果物

- ✅ **リソースポリシー**: IPアドレス制限設定完了
- ✅ **Next.jsフロントエンド**: API Base URL更新
- ✅ **統合テスト**: すべてPASS
- ✅ **本番デプロイ**: 承認済み
- ✅ **ドキュメント**: 運用手順書更新

---

## トラブルシューティングガイド

### 問題1: DNS伝播が遅い（Week 1）

```mermaid
flowchart TD
    Problem[DNS伝播が48時間経過しても未完了] --> Check1{nslookup<br/>結果は?}
    Check1 -->|NXDOMAIN| Solution1[NSレコード設定ミス<br/>社内DNS管理者に確認]
    Check1 -->|SERVFAIL| Solution2[社内DNSサーバー障害<br/>IT部門にエスカレーション]
    Check1 -->|タイムアウト| Solution3[ネットワーク問題<br/>ファイアウォール確認]

    Solution1 --> Retry[NSレコード再設定]
    Solution2 --> Retry
    Solution3 --> Retry

    style Problem fill:#f44336,color:#fff
    style Solution1 fill:#ff9800
    style Solution2 fill:#ff9800
    style Solution3 fill:#ff9800
```

**対処法**:
1. NSレコードの正確性を確認（4つすべて）
2. 社内DNSサーバーの設定ログを確認
3. `dig` コマンドで詳細なDNS応答を確認
4. TTL設定を確認（300秒推奨）

---

### 問題2: ACM証明書がPENDINGのまま（Week 2）

```mermaid
flowchart TD
    Problem[証明書ステータスが<br/>PENDINGのまま72時間以上] --> Check1{DNS検証<br/>レコード存在?}
    Check1 -->|NO| Solution1[Route53に<br/>CNAMEレコード追加]
    Check1 -->|YES| Check2{CNAMEレコード<br/>値が正確?}
    Check2 -->|NO| Solution2[CNAMEレコード値修正]
    Check2 -->|YES| Check3{DNSクエリ<br/>応答確認}
    Check3 -->|NO| Solution3[DNS伝播待機<br/>またはTTL確認]
    Check3 -->|YES| Solution4[AWS Supportに問い合わせ]

    Solution1 --> Retry[証明書再リクエスト]
    Solution2 --> Retry
    Solution3 --> Retry
    Solution4 --> Retry

    style Problem fill:#f44336,color:#fff
    style Solution1 fill:#ff9800
    style Solution2 fill:#ff9800
    style Solution3 fill:#ff9800
    style Solution4 fill:#ff9800
```

**対処法**:
```bash
# DNS検証レコード確認
dig _1234abcd...filesearch.company.com CNAME +short

# 期待される出力:
# _5678efgh...acm-validations.aws.

# 出力がない場合、CNAMEレコード未登録または伝播未完了
```

---

### 問題3: API Gateway Custom Domainが動作しない（Week 3）

```mermaid
flowchart TD
    Problem[HTTPS接続が<br/>エラー（503/504）] --> Check1{CloudFront<br/>Distribution URL確認}
    Check1 -->|応答なし| Solution1[API Mapping設定ミス<br/>Stage確認]
    Check1 -->|403 Forbidden| Solution2[証明書設定ミス<br/>ACM ARN確認]
    Check1 -->|正常| Check2{Route53<br/>Aレコード確認}
    Check2 -->|NO| Solution3[Aレコード（Alias）作成]
    Check2 -->|YES| Check3{DNS伝播<br/>確認}
    Check3 -->|NO| Solution4[DNS伝播待機<br/>5-10分]
    Check3 -->|YES| Solution5[API Gateway設定見直し<br/>ログ確認]

    Solution1 --> Retry[設定修正]
    Solution2 --> Retry
    Solution3 --> Retry
    Solution4 --> Retry
    Solution5 --> Retry

    style Problem fill:#f44336,color:#fff
    style Solution1 fill:#ff9800
    style Solution2 fill:#ff9800
    style Solution3 fill:#ff9800
    style Solution4 fill:#ff9800
    style Solution5 fill:#ff9800
```

**対処法**:
```bash
# CloudFront Distribution URL直接アクセス
curl -I https://d-abc123xyz.execute-api.ap-northeast-1.amazonaws.com/prod/health

# Route53 Aレコード確認
dig filesearch.company.com A +short

# API Gateway CloudWatch Logsで詳細エラー確認
aws logs tail /aws/apigateway/cis-filesearch-api --follow
```

---

### 問題4: Azure AD SSOがHTTPSで動作しない（Week 4）

```mermaid
flowchart TD
    Problem[Azure AD<br/>ログインエラー] --> Check1{リダイレクトURI確認}
    Check1 -->|HTTP| Solution1[Azure ADポータルで<br/>HTTPS URIに更新]
    Check1 -->|HTTPS| Check2{証明書信頼確認}
    Check2 -->|自己署名証明書| Solution2[ACM証明書使用<br/>パブリック証明書必須]
    Check2 -->|信頼済み| Check3{CORS設定確認}
    Check3 -->|設定ミス| Solution3[API Gateway<br/>CORS設定更新]
    Check3 -->|正常| Solution4[Azure ADアプリ登録<br/>再確認]

    Solution1 --> Retry[再テスト]
    Solution2 --> Retry
    Solution3 --> Retry
    Solution4 --> Retry

    style Problem fill:#f44336,color:#fff
    style Solution1 fill:#ff9800
    style Solution2 fill:#ff9800
    style Solution3 fill:#ff9800
    style Solution4 fill:#ff9800
```

**対処法**:
1. Azure ADポータルのリダイレクトURIを確認
   - `https://filesearch.company.com/auth/callback`
2. ブラウザ開発者ツールでエラー詳細確認
3. CloudWatch Logsで認証エラー確認

---

## 監視設定

### CloudWatch Alarms設定

```mermaid
flowchart LR
    subgraph "監視項目"
        M1[Route53 Queries]
        M2[ACM証明書有効期限]
        M3[API Gateway 4xx]
        M4[API Gateway 5xx]
        M5[API Gatewayスロットリング]
    end

    M1 --> Alarm1{> 100,000/月}
    M2 --> Alarm2{< 30日}
    M3 --> Alarm3{> 5%}
    M4 --> Alarm4{> 1%}
    M5 --> Alarm5{> 10/分}

    Alarm1 -->|YES| SNS[SNS通知]
    Alarm2 -->|YES| SNS
    Alarm3 -->|YES| SNS
    Alarm4 -->|YES| SNS
    Alarm5 -->|YES| SNS

    SNS --> Email[メール通知<br/>管理者5名]

    style Alarm1 fill:#ff9800
    style Alarm2 fill:#f44336,color:#fff
    style Alarm3 fill:#ff9800
    style Alarm4 fill:#f44336,color:#fff
    style Alarm5 fill:#ff9800
    style SNS fill:#2196f3,color:#fff
```

### アラーム設定コマンド

```bash
# ACM証明書有効期限アラーム
aws cloudwatch put-metric-alarm \
  --alarm-name acm-certificate-expiry \
  --alarm-description "ACM certificate expiring in 30 days" \
  --metric-name DaysToExpiry \
  --namespace AWS/CertificateManager \
  --statistic Minimum \
  --period 86400 \
  --evaluation-periods 1 \
  --threshold 30 \
  --comparison-operator LessThanThreshold \
  --alarm-actions arn:aws:sns:ap-northeast-1:123456789012:cis-filesearch-alerts

# API Gateway 4xxエラーアラーム
aws cloudwatch put-metric-alarm \
  --alarm-name apigateway-4xx-error-rate \
  --alarm-description "API Gateway 4xx error rate > 5%" \
  --metric-name 4XXError \
  --namespace AWS/ApiGateway \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:ap-northeast-1:123456789012:cis-filesearch-alerts
```

---

## ロールバック手順

```mermaid
flowchart TD
    Problem[本番稼働後に<br/>重大な問題発生] --> Decision{ロールバック<br/>必要?}
    Decision -->|YES| R1[Step 1: Route53 Aレコード削除]
    Decision -->|NO| Monitor[監視継続]

    R1 --> R2[Step 2: Next.js環境変数復元]
    R2 --> R3[Step 3: ECS Fargateロールバック]
    R3 --> R4[Step 4: API Gateway Custom Domain削除]
    R4 --> R5[Step 5: 動作確認]

    R5 --> R5Check{旧環境<br/>正常動作?}
    R5Check -->|YES| PostRollback[ロールバック完了<br/>原因調査開始]
    R5Check -->|NO| Emergency[緊急対応<br/>AWS Supportエスカレーション]

    style Problem fill:#f44336,color:#fff
    style R1 fill:#ff9800
    style R2 fill:#ff9800
    style R3 fill:#ff9800
    style R4 fill:#ff9800
    style Emergency fill:#f44336,color:#fff
    style PostRollback fill:#4caf50,color:#fff
```

### ロールバックコマンド

```bash
# Step 1: Route53 Aレコード削除
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch file://delete-alias-record.json

# Step 2: Next.js環境変数復元
# .env.production を旧URLに戻す

# Step 3: ECS Fargateロールバック
aws ecs update-service \
  --cluster cis-filesearch-cluster \
  --service frontend-service \
  --task-definition cis-filesearch-frontend:PREVIOUS_VERSION

# Step 4: API Gateway Custom Domain削除（オプション）
aws apigatewayv2 delete-domain-name \
  --domain-name filesearch.company.com
```

---

## まとめ

### ✅ 実装完了後の成果

| 項目 | 成果 |
|------|------|
| **カスタムドメイン** | ✅ `filesearch.company.com` |
| **HTTPS暗号化** | ✅ TLS 1.3、ACM証明書（無料） |
| **Azure AD SSO** | ✅ OAuth 2.0正常動作 |
| **IPアドレス制限** | ✅ 社内ネットワークのみ |
| **セキュリティスコア** | ✅ 85/100 |
| **コスト増** | ✅ +$0.50/月（+1%） |

---

### 📊 実装工数サマリー

| Week | 作業内容 | 工数 | 難易度 |
|------|---------|------|--------|
| **Week 1** | Route53 Hosted Zone作成 | 8時間 | ⭐⭐ |
| **Week 2** | ACM証明書発行 | 8時間 | ⭐⭐⭐ |
| **Week 3** | API Gateway Custom Domain | 12時間 | ⭐⭐⭐⭐ |
| **Week 4** | セキュリティ & テスト | 12時間 | ⭐⭐⭐⭐ |
| **合計** | | **40時間** | - |

---

## 関連ドキュメント

- `/docs/pattern3-architecture.md` - Pattern 3詳細設計
- `/docs/pattern3-route53-before-after.md` - Before/After比較図
- `/docs/pattern3-security-architecture.md` - セキュリティアーキテクチャ図（次のドキュメント）
- `/docs/pattern3-cloudfront-analysis.md` - Route53/CloudFront/WAF/ACM必要性分析

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-18 | Pattern 3 Route53 + ACM実装手順フローチャート初版作成 | Business & Data Analyst |
