# Pattern 3アーキテクチャ - Route53/CloudFront/WAF/ACM 必要性分析レポート

## エグゼクティブサマリー

Pattern 3（月次バッチ同期アーキテクチャ）において、Route53/CloudFront/WAF/ACMの必要性を包括的に評価しました。

**結論: Pattern 3では基本的に不要だが、セキュリティとプロフェッショナリズムの観点から「Route53 + ACM」の最小構成を推奨**

| サービス | 必要性 | 推奨度 | 月額コスト | 理由 |
|---------|--------|--------|----------|------|
| **Route53** | 低い | ⭐⭐⭐ | $0.50 | カスタムドメイン、プロフェッショナルな印象 |
| **CloudFront** | 極めて低い | ⭐ | $0-5 | 社内50名のみ、CDN効果限定的 |
| **WAF** | 低い | ⭐ | $5-10 | Azure AD SSOで認証済み、社内限定 |
| **ACM** | 中程度 | ⭐⭐⭐⭐ | $0（無料） | HTTPS必須（Azure AD SSO要件）、無料 |

**推奨アーキテクチャ**: Pattern 3 + Route53 + ACM（月額コスト: $47.24 → $47.74、+1%）

---

## 1. 各サービスの役割と必要性評価

### 1.1 Route53（DNS管理サービス）

#### 役割
- **DNS名前解決**: ドメイン名からIPアドレスへの変換
- **ヘルスチェック**: エンドポイントの監視とフェイルオーバー
- **トラフィックルーティング**: 地理的ルーティング、重み付けルーティング

#### Pattern 3での必要性評価

**✅ 採用すべき理由**:
1. **カスタムドメイン**: `filesearch.company.local` のようなプロフェッショナルなURL
   - 現状: `https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod/search`
   - Route53使用: `https://filesearch.company.com/search`
   - ユーザビリティ向上、覚えやすいURL

2. **SSL証明書の前提条件**: ACM証明書を使用する場合、カスタムドメインが必要
   - ACM証明書は特定のドメインに対して発行される
   - API Gatewayのデフォルトドメインでは証明書カスタマイズ不可

3. **将来拡張性**: 複数環境（dev/staging/prod）の管理が容易
   - `dev.filesearch.company.com`
   - `staging.filesearch.company.com`
   - `filesearch.company.com`

**❌ 不要と判断する理由**:
1. **社内DNS代替可**: 既存の社内DNSサーバーで対応可能
   - Active Directory DNS
   - Bind9等のオンプレDNSサーバー

2. **低トラフィック**: 月10,000検索（1日約333回）では高度なDNS機能不要

3. **複雑性増加**: Route53導入により管理対象が増える

#### コスト試算
```
Route53 料金:
- ホストゾーン: $0.50/月
- クエリ料金: 10,000クエリ × $0.40/100万クエリ = $0.004/月
- 合計: $0.50/月
```

#### 推奨度: ⭐⭐⭐ (3/5)

**推奨**: 採用推奨（カスタムドメイン + プロフェッショナルな印象）

---

### 1.2 CloudFront（CDN）

#### 役割
- **コンテンツキャッシュ**: 静的アセット、APIレスポンスのキャッシュ
- **グローバル配信**: エッジロケーションからの高速配信
- **DDoS保護**: AWS Shieldとの統合
- **レイテンシ削減**: ユーザーに近いロケーションから配信

#### Pattern 3での必要性評価

**✅ 採用すべき理由**:
1. **Next.js静的アセットのキャッシュ**:
   - JavaScript/CSS/画像のエッジキャッシュ
   - 初回ロード時間短縮

2. **検索結果のキャッシュ**:
   - 同一クエリの繰り返し検索をキャッシュ
   - OpenSearch負荷軽減

3. **SSL/TLS終端**:
   - CloudFrontでHTTPS終端、バックエンドは内部通信

**❌ Pattern 3で不要と判断する強い理由**:

1. **ユーザー数が極めて少ない（50名）**:
   - CloudFrontのキャッシュ効果が限定的
   - 同一ユーザーが同じ検索を繰り返す頻度は低い

2. **地理的分散なし（日本国内のみ）**:
   - グローバルエッジロケーションのメリットなし
   - 東京リージョンのみで十分低レイテンシ

3. **アクセス頻度が低い（月10,000検索 = 1日333回）**:
   - 1日333回 ÷ 9時間営業 = 1分あたり0.6回
   - キャッシュヒット率が低い（TTL短い場合）

4. **検索結果の動的性**:
   - 検索クエリは多様（キャッシュヒット率低い）
   - 過去データ検索のため結果は月1回更新のみ
   - → しかし、クエリの組み合わせは無限大

5. **コスト vs メリット**:
   - CloudFront最小コスト: $5-10/月
   - レイテンシ改善: 推定10-50ms程度
   - **ROI（投資対効果）が低い**

#### CloudFrontなしの現状レイテンシ試算

```
現状（CloudFrontなし）:
1. ユーザー → API Gateway（東京リージョン）: 5-20ms
2. API Gateway → Lambda: 1-5ms
3. Lambda → OpenSearch検索: 100-200ms
4. Lambda → レスポンス整形: 10ms
5. API Gateway → ユーザー: 5-20ms
---
合計: 121-255ms

CloudFront使用時（キャッシュヒット時）:
1. ユーザー → CloudFrontエッジ: 5-10ms
2. エッジキャッシュから返却: 1ms
---
合計: 6-11ms

キャッシュヒット率: 推定5-10%（検索クエリの多様性により）
実質的なレイテンシ改善: 121-255ms → 115-230ms（約5%改善）
```

#### コスト試算

```
CloudFront 料金（最小構成）:
- データ転送（アウト）: 10GB × $0.114/GB = $1.14/月
- HTTPリクエスト: 10,000回 × $0.0075/10,000 = $0.008/月
- HTTPSリクエスト: 10,000回 × $0.01/10,000 = $0.01/月
---
合計: $1.16/月（キャッシュなしの場合）

キャッシュ有効化時:
- データ転送（アウト）: 5GB × $0.114/GB = $0.57/月（50%削減）
- HTTPリクエスト: 10,000回 × $0.0075/10,000 = $0.008/月
- HTTPSリクエスト: 10,000回 × $0.01/10,000 = $0.01/月
---
合計: $0.59/月（キャッシュヒット率50%想定）

実際のキャッシュヒット率: 5-10%と推定
実質コスト: $1.10/月程度
```

#### 推奨度: ⭐ (1/5)

**推奨**: 不要（コスト vs メリットが合わない）

---

### 1.3 WAF（Web Application Firewall）

#### 役割
- **攻撃防御**: SQLインジェクション、XSS、CSRF等の攻撃防止
- **レート制限**: 特定IPからの過剰なリクエスト制限
- **地理的制限**: 特定国からのアクセス制限
- **ボット対策**: 悪意のあるボットのブロック

#### Pattern 3での必要性評価

**✅ 採用すべき理由**:
1. **セキュリティベストプラクティス**: 多層防御の一環
2. **SQLインジェクション防止**: 検索クエリの不正入力対策
3. **DDoS攻撃対策**: レート制限によるサービス妨害防止

**❌ Pattern 3で不要と判断する強い理由**:

1. **既にAzure AD SSOで認証済み**:
   - 外部からの未認証アクセスは不可
   - ユーザーは50名の社内限定
   - Azure ADの多要素認証（MFA）で保護済み

2. **社内ネットワーク限定アクセス**:
   - VPN経由またはオフィスネットワークからのみアクセス
   - IPアドレス制限が既に可能（API Gatewayリソースポリシー）

3. **VPCセキュリティグループで十分な保護**:
   - Lambda、OpenSearchはPrivate Subnet内
   - インターネットからの直接アクセス不可
   - NAT Gateway経由のアウトバウンドのみ

4. **攻撃対象が限定的**:
   - SQLインジェクション: OpenSearchはNoSQL（SQL未使用）
   - XSS: Next.jsのデフォルトエスケープで保護
   - CSRF: API GatewayのCORS設定で対応

5. **コスト vs リスク**:
   - WAF最小コスト: $5-10/月
   - 攻撃リスク: 極めて低い（社内限定アクセス）

#### WAFなしのセキュリティ対策

```yaml
代替セキュリティ対策:
  認証層:
    - Azure AD SSO: 必須認証
    - MFA: オプション（推奨）
    - JWTトークン検証: API Gatewayで実施

  ネットワーク層:
    - API Gatewayリソースポリシー:
        - 許可IP範囲: 社内ネットワーク（例: 203.0.113.0/24）
        - VPN IPアドレス: 198.51.100.0/24
    - VPCセキュリティグループ:
        - Lambda: Private Subnet、アウトバウンドのみ
        - OpenSearch: Private Subnet、Lambda SGのみ許可

  アプリケーション層:
    - 入力バリデーション: Lambda関数内でサニタイズ
    - レート制限: API Gatewayのスロットリング（100req/秒）
    - CORS設定: 許可ドメインのみ（https://filesearch.company.com）

  監視層:
    - CloudWatch Logs: 全APIリクエストをロギング
    - CloudWatch Alarms:
        - 異常なリクエスト数（> 1000/時間）
        - 認証失敗率（> 10%）
```

#### コスト試算

```
AWS WAF 料金:
- WebACL: $5.00/月
- ルール: 5個 × $1.00/月 = $5.00/月
- リクエスト: 10,000回 × $0.60/100万 = $0.006/月
---
合計: $10.01/月
```

#### 推奨度: ⭐ (1/5)

**推奨**: 不要（Azure AD SSO + API Gatewayリソースポリシーで十分）

---

### 1.4 ACM（AWS Certificate Manager）

#### 役割
- **SSL/TLS証明書発行**: ドメイン検証済み証明書の自動発行
- **証明書管理**: 自動更新、有効期限管理
- **統合**: CloudFront、ALB、API Gatewayとの統合

#### Pattern 3での必要性評価

**✅ 採用すべき強い理由**:

1. **Azure AD SSOの要件**:
   - Azure ADはHTTPS接続を推奨（ベストプラクティス）
   - OAuth 2.0/OIDC認証フローではHTTPS必須
   - リダイレクトURIがHTTPSでない場合、セキュリティ警告

2. **セキュリティベストプラクティス**:
   - データ転送の暗号化（TLS 1.3）
   - 中間者攻撃（MITM）の防止
   - ブラウザのHTTPS強制（HSTS）

3. **コストゼロ**:
   - ACM証明書は**完全無料**（CloudFront/ALB/API Gateway使用時）
   - 自動更新により管理コストも低い

4. **プロフェッショナルな印象**:
   - ブラウザの「保護された通信」表示
   - ユーザーの信頼性向上

**❌ 不要と判断する理由**:
1. **社内アプリケーション**: 外部公開しない場合、HTTP許容の可能性
2. **自己署名証明書**: 社内限定ならコスト削減可能

#### HTTPSなしのリスク

```
HTTPのリスク:
1. 認証トークンの平文送信
   - JWTトークンがネットワーク上で傍受可能
   - セッションハイジャックのリスク

2. 検索クエリの漏洩
   - 検索キーワードが傍受可能
   - 機密情報検索時のリスク

3. Azure AD SSO動作不可
   - OAuthリダイレクトがHTTPSを要求
   - 認証フロー自体が失敗

4. ブラウザセキュリティ警告
   - Chrome/Edgeが「安全でない接続」と警告
   - ユーザー体験の悪化
```

#### ACM証明書の実装パターン

**パターンA: API Gateway + ACM証明書**
```
ユーザー → [HTTPS] → API Gateway (Custom Domain)
                        ↓
                     ACM証明書（無料）
                        ↓
                     Lambda（内部通信）
```

**パターンB: CloudFront + ACM証明書**
```
ユーザー → [HTTPS] → CloudFront (ACM証明書)
                        ↓
                     API Gateway（内部通信、HTTP可）
                        ↓
                     Lambda
```

**推奨**: パターンA（CloudFront不要のため）

#### コスト試算

```
ACM 料金:
- 証明書発行: $0.00（無料）
- 証明書更新: $0.00（自動、無料）
- 証明書管理: $0.00（AWS管理）
---
合計: $0.00/月
```

#### 推奨度: ⭐⭐⭐⭐ (4/5)

**推奨**: 強く推奨（Azure AD SSO要件、無料、セキュリティベストプラクティス）

---

## 2. シナリオ別推奨アーキテクチャ

### シナリオA: Route53/CloudFront/WAF/ACM すべて追加

#### 構成図
```
ユーザー (50名)
    ↓ [HTTPS]
Route53 (DNS)
    ↓
CloudFront (CDN + WAF)
    ↓ [ACM証明書]
API Gateway
    ↓
Lambda → OpenSearch
```

#### メリット
- ✅ エンタープライズグレードのセキュリティ
- ✅ グローバル展開の準備完了
- ✅ 将来的な外部公開に対応

#### デメリット
- ❌ コスト増加: $47.24 → $59.40（+26%）
- ❌ 管理対象サービス増加（複雑性）
- ❌ オーバースペック（社内50名には過剰）

#### コスト試算
```
Pattern 3ベース: $47.24/月
+ Route53: $0.50/月
+ CloudFront: $1.16/月
+ WAF: $10.01/月
+ ACM: $0.00/月
---
合計: $58.91/月（+$11.67、+25%）
```

#### 適用ケース
- 将来的にグローバル展開予定
- 外部パートナー企業への公開予定
- セキュリティ要件が極めて厳しい業界（金融、医療）

---

### シナリオB: Route53 + ACM のみ追加（推奨）

#### 構成図
```
ユーザー (50名)
    ↓ [HTTPS]
Route53 (DNS) → filesearch.company.com
    ↓
API Gateway (Custom Domain + ACM証明書)
    ↓
Lambda → OpenSearch
```

#### メリット
- ✅ カスタムドメイン（プロフェッショナル）
- ✅ HTTPS暗号化（Azure AD SSO要件満たす）
- ✅ 最小コスト増加（+1%）
- ✅ シンプル（管理対象少ない）

#### デメリット
- ❌ CDNなし（レイテンシやや高い → 実際は121-255msで十分）
- ❌ WAFなし（Azure AD SSO + API Gatewayリソースポリシーで代替）

#### コスト試算
```
Pattern 3ベース: $47.24/月
+ Route53: $0.50/月
+ ACM: $0.00/月
---
合計: $47.74/月（+$0.50、+1%）
```

#### 適用ケース（Pattern 3に最適）
- ✅ 社内アプリケーション（50名）
- ✅ 過去データ検索のみ
- ✅ コスト最小化優先
- ✅ Azure AD SSO認証必須

#### セキュリティ対策（WAFなしでも十分）
```yaml
API Gatewayリソースポリシー:
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": "*",
        "Action": "execute-api:Invoke",
        "Resource": "arn:aws:execute-api:*:*:*",
        "Condition": {
          "IpAddress": {
            "aws:SourceIp": [
              "203.0.113.0/24",  # 社内ネットワーク
              "198.51.100.0/24"  # VPN
            ]
          }
        }
      }
    ]
  }

API Gatewayスロットリング:
  - レート制限: 100 requests/秒
  - バースト制限: 200 requests

Azure AD SSO:
  - 必須認証（未認証アクセス不可）
  - MFA推奨
```

---

### シナリオC: すべて不要（現状のPattern 3維持）

#### 構成図
```
ユーザー (50名)
    ↓ [HTTP]
API Gateway (デフォルトドメイン)
    ↓
Lambda → OpenSearch
```

#### メリット
- ✅ 最小コスト（$47.24/月）
- ✅ 最もシンプル

#### デメリット
- ❌ カスタムドメインなし（長いURL）
- ❌ HTTP通信（**Azure AD SSO動作不可の可能性**）
- ❌ プロフェッショナリズム欠如

#### コスト試算
```
Pattern 3ベース: $47.24/月
追加コスト: $0.00
---
合計: $47.24/月
```

#### 適用ケース
- ❌ Azure AD SSOなし（Basic認証等の代替手段）
- ❌ 完全社内限定（HTTPでも許容される環境）
- ❌ セキュリティ要件が極めて低い

#### 重大なリスク
1. **Azure AD SSO動作不可**: HTTPではOAuth 2.0リダイレクトが失敗
2. **セキュリティ警告**: ブラウザが「安全でない接続」と警告
3. **認証トークン漏洩**: JWT等が平文送信

---

## 3. コスト影響分析

### 3.1 月額コスト比較

| シナリオ | Route53 | CloudFront | WAF | ACM | 合計 | vs Pattern 3 |
|---------|---------|-----------|-----|-----|------|-------------|
| **Pattern 3（現状）** | - | - | - | - | $47.24 | - |
| **シナリオA（全追加）** | $0.50 | $1.16 | $10.01 | $0.00 | $58.91 | +$11.67 (+25%) |
| **シナリオB（Route53+ACM）** | $0.50 | - | - | $0.00 | $47.74 | +$0.50 (+1%) |
| **シナリオC（不要）** | - | - | - | - | $47.24 | $0.00 (0%) |

### 3.2 年間コスト比較

| シナリオ | 月額 | 年額 | 3年間TCO |
|---------|------|------|---------|
| **Pattern 3（現状）** | $47.24 | $566.88 | $1,810.38 |
| **シナリオA（全追加）** | $58.91 | $706.92 | $2,230.26 |
| **シナリオB（Route53+ACM）** | $47.74 | $572.88 | $1,828.38 |
| **シナリオC（不要）** | $47.24 | $566.88 | $1,810.38 |

### 3.3 コスト vs メリット分析

| サービス | 月額コスト | 主なメリット | Pattern 3での価値 | ROI |
|---------|----------|------------|-----------------|-----|
| **Route53** | $0.50 | カスタムドメイン | プロフェッショナルなURL | ⭐⭐⭐ 高い |
| **CloudFront** | $1.16 | レイテンシ削減 | 5%改善（121ms→115ms） | ⭐ 低い |
| **WAF** | $10.01 | 攻撃防御 | Azure AD SSO + IPアドレス制限で代替可 | ⭐ 低い |
| **ACM** | $0.00 | HTTPS暗号化 | Azure AD SSO要件、無料 | ⭐⭐⭐⭐⭐ 極めて高い |

---

## 4. セキュリティ評価

### 4.1 シナリオ別セキュリティスコア

| セキュリティ項目 | Pattern 3現状 | シナリオA | シナリオB | シナリオC |
|--------------|-------------|----------|----------|----------|
| **認証** | Azure AD SSO | Azure AD SSO | Azure AD SSO | Azure AD SSO |
| **通信暗号化** | HTTP | HTTPS (ACM) | HTTPS (ACM) | HTTP |
| **DDoS保護** | API Gateway基本 | CloudFront + Shield | API Gateway基本 | API Gateway基本 |
| **アプリケーション保護** | API Gatewayスロットリング | WAF | API Gatewayスロットリング | API Gatewayスロットリング |
| **ネットワーク制限** | VPC SG | VPC SG + WAF | VPC SG + IPアドレス制限 | VPC SG |
| **総合スコア** | 70/100 | 95/100 | 85/100 | 50/100 |

### 4.2 脅威モデル分析

#### 脅威1: 外部からの不正アクセス

| 対策 | Pattern 3現状 | シナリオB（推奨） | シナリオA（全追加） |
|------|-------------|-----------------|-----------------|
| Azure AD SSO | ✅ 有効 | ✅ 有効 | ✅ 有効 |
| IPアドレス制限 | ❌ なし | ✅ API Gatewayポリシー | ✅ WAF + API Gateway |
| レート制限 | ✅ API Gateway | ✅ API Gateway | ✅ WAF + API Gateway |
| **リスクレベル** | 🟡 中 | 🟢 低 | 🟢 極めて低 |

#### 脅威2: 中間者攻撃（MITM）

| 対策 | Pattern 3現状 | シナリオB（推奨） | シナリオA（全追加） |
|------|-------------|-----------------|-----------------|
| HTTPS暗号化 | ❌ HTTPのみ | ✅ ACM証明書 | ✅ ACM証明書 |
| TLSバージョン | - | TLS 1.2/1.3 | TLS 1.2/1.3 |
| **リスクレベル** | 🔴 高 | 🟢 低 | 🟢 低 |

#### 脅威3: DDoS攻撃

| 対策 | Pattern 3現状 | シナリオB（推奨） | シナリオA（全追加） |
|------|-------------|-----------------|-----------------|
| API Gatewayスロットリング | ✅ 100req/秒 | ✅ 100req/秒 | ✅ 100req/秒 |
| CloudFront | ❌ なし | ❌ なし | ✅ Shield Standard |
| WAF | ❌ なし | ❌ なし | ✅ レート制限ルール |
| **リスクレベル** | 🟡 中 | 🟡 中 | 🟢 低 |

**結論**: シナリオB（Route53 + ACM）で脅威2（MITM）を完全に防御可能。社内限定アクセスのため、脅威1・3のリスクは限定的。

---

## 5. 実装優先度とフェーズ計画

### 5.1 Phase 1（初期実装、Week 1-4）

**実装対象**: Pattern 3 + Route53 + ACM（シナリオB）

#### Week 1: Route53設定
```bash
# 1. Hosted Zoneの作成
aws route53 create-hosted-zone \
  --name filesearch.company.com \
  --caller-reference $(date +%s)

# 2. NSレコードを社内DNSに登録
# 3. Aレコード作成（API Gateway向け）
```

#### Week 2: ACM証明書発行
```bash
# 1. 証明書リクエスト
aws acm request-certificate \
  --domain-name filesearch.company.com \
  --validation-method DNS \
  --region ap-northeast-1

# 2. DNS検証レコード作成（Route53）
# 3. 証明書発行確認
```

#### Week 3: API Gatewayカスタムドメイン設定
```bash
# 1. Custom Domain Name作成
aws apigatewayv2 create-domain-name \
  --domain-name filesearch.company.com \
  --domain-name-configurations CertificateArn=arn:aws:acm:...

# 2. API Mapping作成
aws apigatewayv2 create-api-mapping \
  --domain-name filesearch.company.com \
  --api-id xxx \
  --stage prod
```

#### Week 4: リソースポリシー設定（IPアドレス制限）
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": "*",
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

**コスト**: $47.24 → $47.74/月（+$0.50）

---

### 5.2 Phase 2（オプション、Week 5-8）

**実装対象**: CloudFront追加（必要と判断された場合のみ）

#### 条件
- ユーザー数が200名以上に増加
- グローバル展開（海外拠点）が決定
- レイテンシ要件が50ms以下に厳格化

#### 実装内容
```bash
# CloudFrontディストリビューション作成
aws cloudfront create-distribution \
  --origin-domain-name xxx.execute-api.ap-northeast-1.amazonaws.com \
  --default-cache-behavior '{"ViewerProtocolPolicy":"redirect-to-https"}'
```

**コスト**: $47.74 → $48.90/月（+$1.16）

---

### 5.3 Phase 3（条件付き、Week 9-12）

**実装対象**: WAF追加（外部公開が決定された場合のみ）

#### 条件
- 外部パートナー企業へのアクセス許可
- インターネット公開が決定
- セキュリティ監査で要求された場合

#### 実装内容
```bash
# WAF WebACL作成
aws wafv2 create-web-acl \
  --name filesearch-waf \
  --scope REGIONAL \
  --default-action Allow={} \
  --rules file://waf-rules.json
```

**コスト**: $48.90 → $58.91/月（+$10.01）

---

## 6. 推奨アーキテクチャと実装計画

### 6.1 最終推奨

**推奨アーキテクチャ**: **シナリオB（Route53 + ACM）**

#### 推奨理由
1. ✅ **Azure AD SSO要件を満たす**: HTTPS必須
2. ✅ **最小コスト増加**: +$0.50/月（+1%）
3. ✅ **プロフェッショナルなURL**: `filesearch.company.com`
4. ✅ **セキュリティベストプラクティス**: TLS 1.3暗号化
5. ✅ **無料のACM証明書**: コストゼロ
6. ✅ **シンプル**: 管理対象が少ない

#### 不採用の理由
- **CloudFront**: ROI低い（月10,000検索、50名のみ）
- **WAF**: Azure AD SSO + IPアドレス制限で代替可能

---

### 6.2 更新されたPattern 3アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────┐
│                    ユーザー層 (50名)                          │
└───────────────────────┬─────────────────────────────────────┘
                        │ [HTTPS]
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Route53 (DNS)                             │
│               filesearch.company.com                         │
│                   Hosted Zone                                │
│                    $0.50/月                                  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              API Gateway (Custom Domain)                     │
│                                                              │
│  🔒 ACM証明書（無料）- TLS 1.3                                │
│  🛡️ リソースポリシー（IPアドレス制限）                          │
│  ⏱️ スロットリング（100req/秒）                                │
│                                                              │
│  ドメイン: filesearch.company.com                            │
│  証明書: *.company.com（ワイルドカード）                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   ┌─────────┐    ┌─────────┐    ┌─────────┐
   │ Lambda  │    │ Lambda  │    │ Lambda  │
   │ Search  │    │ Index   │    │FileProc │
   └────┬────┘    └────┬────┘    └────┬────┘
        │              │              │
        └──────────────┼──────────────┘
                       ▼
              ┌──────────────┐
              │  OpenSearch  │
              │   DynamoDB   │
              │      S3      │
              └──────────────┘
```

---

### 6.3 実装チェックリスト

#### Phase 1: Route53 + ACM（Week 1-4）

- [ ] Route53 Hosted Zone作成
  - [ ] ドメイン名: `filesearch.company.com`
  - [ ] NSレコードを社内DNSに登録

- [ ] ACM証明書リクエスト
  - [ ] ドメイン名: `filesearch.company.com`
  - [ ] 検証方法: DNS検証（Route53自動）
  - [ ] 証明書発行確認

- [ ] API Gatewayカスタムドメイン設定
  - [ ] Custom Domain Name作成
  - [ ] ACM証明書アタッチ
  - [ ] API Mapping作成（prod stage）

- [ ] API Gatewayリソースポリシー設定
  - [ ] IPアドレス制限（社内ネットワーク、VPN）
  - [ ] スロットリング設定（100req/秒）

- [ ] Next.jsフロントエンド更新
  - [ ] API_BASE_URL変更: `https://filesearch.company.com`
  - [ ] CORS設定確認

- [ ] テスト
  - [ ] HTTPS接続テスト
  - [ ] Azure AD SSOログインテスト
  - [ ] 検索機能テスト
  - [ ] IPアドレス制限テスト

---

## 7. コスト最適化の追加提案

### 7.1 CloudFrontを使わない場合の代替キャッシング

**Next.js Static Export + S3 + CloudFront代替**:

現状のPattern 3では、Next.jsをECS Fargateで動的レンダリングしていますが、以下のようにコスト削減可能:

```
Option 1: Next.js Static Export + S3
- Next.js SSG（Static Site Generation）
- S3静的ホスティング（$1/月）
- API Gateway（検索APIのみ）

メリット:
- ECS Fargate不要（$20-30/月削減）
- レイテンシ改善（S3は高速）
- 運用シンプル

デメリット:
- 動的レンダリング不可
- サーバーサイド処理制限
```

**推奨**: Pattern 3の検索は動的でないため、Static Exportが適している可能性あり。

---

### 7.2 API Gatewayレスポンスキャッシング

CloudFrontの代わりに、API Gateway組み込みキャッシュを使用:

```bash
# API Gatewayキャッシュ設定
aws apigateway update-stage \
  --rest-api-id xxx \
  --stage-name prod \
  --patch-operations \
    op=replace,path=/cacheClusterEnabled,value=true \
    op=replace,path=/cacheClusterSize,value=0.5  # 0.5GB
```

**コスト**: $0.02/時間 × 730時間 = $14.60/月

**評価**: CloudFront（$1.16/月）より高い → 不採用

---

### 7.3 Lambda@Edge代替（不要）

CloudFrontなしでは使用不可のため、検討対象外。

---

## 8. 結論と次のステップ

### 8.1 最終結論

**Pattern 3アーキテクチャには、Route53 + ACMの最小構成を追加推奨**

| 項目 | 推奨 | 理由 |
|------|------|------|
| **Route53** | ✅ 推奨 | カスタムドメイン、プロフェッショナル |
| **ACM** | ✅ 強く推奨 | Azure AD SSO要件、無料 |
| **CloudFront** | ❌ 不要 | ROI低い（50名、月10,000検索） |
| **WAF** | ❌ 不要 | Azure AD SSO + IPアドレス制限で代替 |

**月額コスト**: $47.24 → $47.74（+$0.50、+1%）

---

### 8.2 実装タイムライン

| Week | 実装内容 | 担当 | 成果物 |
|------|---------|------|-------|
| **Week 1** | Route53 Hosted Zone作成 | DevOps | DNS設定完了 |
| **Week 2** | ACM証明書発行 | DevOps | 証明書発行完了 |
| **Week 3** | API Gatewayカスタムドメイン設定 | Backend | HTTPS接続有効化 |
| **Week 4** | IPアドレス制限、テスト | Backend, QA | 本番稼働 |

**総所要時間**: 4週間

---

### 8.3 次のステップ

#### 即座に実施
1. ✅ Route53 Hosted Zone作成（ドメイン決定が必要）
2. ✅ ACM証明書リクエスト
3. ✅ API Gatewayカスタムドメイン設定

#### 条件付き検討
- CloudFront: ユーザー数200名超、グローバル展開時のみ
- WAF: 外部公開、セキュリティ監査要求時のみ

#### 継続監視
- 検索レスポンスタイム（目標: 200ms以下）
- API Gatewayスロットリング頻度
- セキュリティインシデント

---

## 9. FAQ（よくある質問）

### Q1: なぜCloudFrontが不要なのか?

**A**: Pattern 3の特性上、以下の理由で不要:
- ユーザー数: 50名（CDNの効果が限定的）
- 地理的分散: 日本国内のみ（エッジロケーション不要）
- 検索クエリの多様性: キャッシュヒット率5-10%と推定
- レイテンシ改善: 約5%（121ms → 115ms）、体感差なし
- コスト: $1.16/月 vs メリット → ROI低い

---

### Q2: WAFなしでセキュリティは大丈夫か?

**A**: 以下の多層防御で十分:
1. **認証層**: Azure AD SSO（MFA推奨）
2. **ネットワーク層**: API Gatewayリソースポリシー（IPアドレス制限）
3. **アプリケーション層**: 入力バリデーション、レート制限
4. **監視層**: CloudWatch Logsで異常検知

外部公開しない限り、WAFは過剰投資。

---

### Q3: HTTPSは本当に必須か?

**A**: 以下の理由でHTTPS必須:
1. **Azure AD SSO要件**: OAuth 2.0リダイレクトがHTTPS必須
2. **セキュリティ**: JWTトークンの平文送信防止
3. **ブラウザ警告**: Chrome/Edgeが「安全でない接続」と警告
4. **コスト**: ACM証明書は無料

→ HTTPS以外の選択肢はない。

---

### Q4: Route53の代わりに社内DNSサーバーは使えるか?

**A**: 技術的には可能だが、以下の理由でRoute53推奨:
- **ACM証明書の前提**: カスタムドメインが必要
- **管理の簡素化**: AWS統合管理
- **コスト**: $0.50/月（極めて安価）

社内DNSサーバーでも対応可能だが、ACM証明書のドメイン検証が煩雑。

---

### Q5: 将来的にCloudFront/WAFを追加できるか?

**A**: 可能。以下のタイミングで追加推奨:
- **CloudFront**: ユーザー数200名超、グローバル展開時
- **WAF**: 外部パートナー企業へのアクセス許可、インターネット公開時

段階的に追加可能（ダウンタイムなし）。

---

## 10. 参考資料

### 10.1 AWS公式ドキュメント

- [Route53料金](https://aws.amazon.com/route53/pricing/)
- [CloudFront料金](https://aws.amazon.com/cloudfront/pricing/)
- [AWS WAF料金](https://aws.amazon.com/waf/pricing/)
- [ACM証明書管理](https://aws.amazon.com/certificate-manager/)
- [API Gatewayカスタムドメイン](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html)

### 10.2 セキュリティベストプラクティス

- [AWS Well-Architected Framework - Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Azure AD OAuth 2.0 HTTPS Requirements](https://learn.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)

### 10.3 内部ドキュメント

- `/docs/requirement.md` - システム要件定義
- `/docs/architecture.md` - 全体アーキテクチャ
- `/docs/aws-resource-sizing.md` - AWSリソースサイジング
- `/docs/pattern3-architecture.md` - Pattern 3詳細設計

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-18 | Pattern 3 Route53/CloudFront/WAF/ACM必要性分析レポート初版作成 | CIS開発チーム |

---

**承認**

| 役割 | 氏名 | 承認日 | 署名 |
|------|------|--------|------|
| プロジェクトオーナー | | | |
| IT部門責任者 | | | |
| 開発責任者 | | | |
