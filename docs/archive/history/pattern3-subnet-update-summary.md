# Pattern 3 アーキテクチャ図 - サブネット構造追加 サマリー

## 更新日時
2025-01-18

## 更新概要

ユーザーフィードバックに基づき、すべてのアーキテクチャ図にVPCのサブネット構造（Public SubnetとPrivate Subnet）を追加しました。これにより、ネットワーク構成がより明確になり、理解しやすくなりました。

---

## 更新されたファイル一覧

### 1. Mermaid図
**ファイル**: `/docs/pattern3-architecture.md`

**追加された要素**:
- VPC コンテナ (`VPC: 10.0.0.0/16`)
- Internet Gateway
- Virtual Private Gateway
- **Public Subnet** (`10.0.0.0/24`, AZ-a)
  - NAT Gateway (Elastic IP付き)
- **Private Subnet 1** (`10.0.1.0/24`, AZ-a)
  - Lambda Functions (バッチ処理用)
    - VPNManager, FileScanner, TextExtractor, ImageExtractor, BulkIndexer
  - OpenSearch Service
- **Private Subnet 2** (`10.0.2.0/24`, AZ-b)
  - SearchAPI Lambda (Multi-AZ冗長性)
- マネージドサービス層（VPC外）
  - DataSync, S3, DynamoDB

**視覚的な改善**:
- サブネット間の接続フローが明確化
- NAT Gatewayを経由したインターネットアクセスの表示
- Public/Privateサブネットの区別が視覚的に分かりやすい

---

### 2. draw.io 完全版テンプレート
**ファイル**: `/docs/pattern3-drawio-template.xml`

**追加された要素**:
- VPCコンテナ (`fillColor=#E8F4F8`, `strokeColor=#0277BD`)
- Internet Gateway (緑色: `fillColor=#C8E6C9`)
- Virtual Private Gateway
- **Public Subnet** (青色: `fillColor=#BBDEFB`)
  - NAT Gateway (黄色: `fillColor=#FFFDE7`)
- **Private Subnet 1** (ピンク: `fillColor=#FCE4EC`)
  - Lambda Functions × 5
  - OpenSearch Service
- **Private Subnet 2** (紫: `fillColor=#F3E5F5`)
  - SearchAPI Lambda
- マネージドサービス層（黄色: `fillColor=#FFF9C4`）
  - DataSync, S3, DynamoDB
- オーケストレーション層
  - Step Functions, EventBridge, SNS

**レイアウトの改善**:
- キャンバスサイズを拡大: `2400 x 1800`
- サブネット構成の説明ボックスを追加
- Internet Gateway → NAT Gateway → Lambda の接続フローを追加

---

### 3. draw.io 簡易版テンプレート
**ファイル**: `/docs/pattern3-drawio-simple.xml`

**追加された要素**:
- VPCコンテナ
- Internet Gateway
- Virtual Private Gateway
- **Public Subnet**
  - NAT Gateway
- **Private Subnet 1**
  - Lambda TextExtractor
  - Lambda ImageExtractor
  - OpenSearch Service
- **Private Subnet 2**
  - SearchAPI Lambda
- マネージドサービス層
  - DataSync, S3, DynamoDB
- オーケストレーション層
  - Step Functions, EventBridge

**学習用の改善**:
- サブネット構成の説明ボックスを追加
- コンポーネント番号を1-12に整理
- 主要な接続フローのみを表示（複雑さを抑える）

---

### 4. PlantUML図
**ファイル**: `/docs/pattern3-architecture.puml`

**追加された要素**:
```plantuml
rectangle "VPC: 10.0.0.0/16" <<VPC>> {
    rectangle "Internet Gateway" as igw
    VPNConnection(vpg, "Virtual Private Gateway", ...)

    rectangle "Public Subnet: 10.0.0.0/24 (AZ-a)" <<PublicSubnet>> {
        rectangle "NAT Gateway" as natGW
    }

    rectangle "Private Subnet 1: 10.0.1.0/24 (AZ-a)" <<PrivateSubnet>> {
        Lambda(vpnMgr, ...)
        Lambda(fileScanner, ...)
        Lambda(textExt, ...)
        Lambda(imgExt, ...)
        Lambda(bulkIdx, ...)
        OpenSearchService(opensearch, ...)
    }

    rectangle "Private Subnet 2: 10.0.2.0/24 (AZ-b)" <<PrivateSubnet>> {
        Lambda(searchAPI, ...)
    }
}

rectangle "マネージドサービス層（VPC外）" <<Managed>> {
    DataSync(dataSync, ...)
    SimpleStorageService(s3, ...)
    DynamoDB(dynamodb, ...)
}
```

**スキンパラメータの追加**:
```plantuml
BackgroundColor<<VPC>> #E8F4F8
BorderColor<<VPC>> #0277BD
BackgroundColor<<PublicSubnet>> #BBDEFB
BorderColor<<PublicSubnet>> #1976D2
BackgroundColor<<PrivateSubnet>> #FCE4EC
BorderColor<<PrivateSubnet>> #C2185B
BackgroundColor<<Managed>> #FFF9C4
BorderColor<<Managed>> #F57F17
```

**Noteの追加**:
- サブネット構成の詳細説明 (Note N4)

---

## サブネット構成の詳細

### VPC全体構成
- **CIDR**: `10.0.0.0/16`
- **リージョン**: `ap-northeast-1`

### Public Subnet (`10.0.0.0/24`, AZ-a)
**配置されるリソース**:
- NAT Gateway (Elastic IP付き)

**目的**:
- Private Subnetからインターネットへの出力ルート
- Lambda関数がパッケージダウンロード、AWS API呼び出しに使用

**接続**:
- Internet Gateway → NAT Gateway

---

### Private Subnet 1 (`10.0.1.0/24`, AZ-a)
**配置されるリソース**:
- **Lambda Functions** (バッチ処理用)
  - VPNManager (512MB, ARM64)
  - FileScanner (1024MB, ARM64)
  - TextExtractor (2048MB, ARM64)
  - ImageFeatureExtractor (2048MB, ARM64)
  - BulkIndexer (1024MB, ARM64)
- **OpenSearch Service** (t3.small.search)
  - kuromoji plugin (日本語形態素解析)
  - k-NN plugin (画像類似検索)

**インターネットアクセス**:
- NAT Gateway経由でインターネットアクセス可能

---

### Private Subnet 2 (`10.0.2.0/24`, AZ-b)
**配置されるリソース**:
- **SearchAPI Lambda** (512MB, ARM64)
  - ユーザーからの検索リクエストを処理
  - OpenSearch、DynamoDB、S3にアクセス

**Multi-AZ冗長性**:
- AZ-aとは異なるAvailability Zoneに配置
- 可用性向上のための冗長構成

---

## ネットワークフロー

### インターネット → Private Subnet
```
Internet → Internet Gateway → NAT Gateway → Private Subnet 1/2
```

### VPN → Private Subnet
```
オンプレミス VPN Router → Virtual Private Gateway → Private Subnet 1/2
```

### Private Subnet → S3/DynamoDB
```
Private Subnet → VPCエンドポイント（推奨） or NAT Gateway → S3/DynamoDB
```

---

## Terraformとの整合性

今回追加したサブネット構造は、既存の`/terraform/vpc.tf`の定義と完全に一致しています：

```hcl
# terraform/vpc.tf
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  cidr_block = "10.0.0.0/24"
  availability_zone = "ap-northeast-1a"
}

resource "aws_subnet" "private" {
  count = 2
  cidr_block = "10.0.${count.index + 1}.0/24"
  availability_zone = ["ap-northeast-1a", "ap-northeast-1b"][count.index]
}

resource "aws_nat_gateway" "main" {
  subnet_id = aws_subnet.public.id
}
```

---

## 視覚的な改善点

### Before (サブネットなし)
- VPCが単一のコンテナとして表現
- Lambda関数やOpenSearchがどのサブネットに配置されるか不明
- ネットワークフローが不明確

### After (サブネットあり)
- ✅ Public SubnetとPrivate Subnetが明確に区別される
- ✅ NAT Gatewayの役割が視覚的に理解できる
- ✅ 各リソースの配置場所が明確
- ✅ セキュリティグループの境界が分かりやすい
- ✅ Multi-AZ構成が視覚的に表現される

---

## 今後の活用方法

### 1. draw.ioでの編集
```bash
# draw.ioでXMLファイルを開く
open https://app.diagrams.net/

# ファイル → インポート → XMLファイルを選択
- pattern3-drawio-template.xml (完全版)
- pattern3-drawio-simple.xml (学習用簡易版)

# AWS公式アイコンを適用
1. 左サイドバー → More Shapes → AWS Icons を有効化
2. 各コンポーネントを対応するAWS公式アイコンに置き換え
3. エクスポート → PNG/SVG で画像保存
```

### 2. PlantUMLでの生成
```bash
# PlantUMLをインストール
brew install plantuml

# PNG画像を生成
plantuml docs/pattern3-architecture.puml

# 出力: docs/pattern3-architecture.png
```

### 3. Mermaidのプレビュー
Mermaid図は以下のツールでプレビュー可能:
- VS Code: Mermaid Preview拡張機能
- GitHub: マークダウンファイル内でレンダリング
- Mermaid Live Editor: https://mermaid.live/

---

## コスト影響

サブネット構成の追加による追加コストは**ゼロ**です。

| リソース | 月額コスト | 備考 |
|---------|----------|------|
| VPC | $0 | 無料 |
| Public Subnet | $0 | 無料 |
| Private Subnet × 2 | $0 | 無料 |
| NAT Gateway (月4時間のみ) | **$1.20** | **既に計上済み** |
| Internet Gateway | $0 | 無料 |

**総月額コスト**: **$47.24** (変更なし)

---

## まとめ

✅ **完了した作業**:
1. Mermaid図にサブネット構造を追加
2. draw.io完全版テンプレートにサブネット構造を追加
3. draw.io簡易版テンプレートにサブネット構造を追加
4. PlantUML図にサブネット構造を追加
5. Terraformコードとの整合性を確認

✅ **改善された点**:
- ネットワーク構成の可視化
- セキュリティ境界の明確化
- Multi-AZ構成の表現
- インターネットアクセス経路の明示

✅ **次のステップ**:
1. draw.ioでAWS公式アイコンを適用
2. ステークホルダーへの共有
3. インフラ実装時の参照資料として活用

---

**改訂履歴**:
- v1.1 (2025-01-18): サブネット構造を追加（本更新）
- v1.0 (2025-01-18): 初版作成
