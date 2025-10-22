# Pattern 3 アーキテクチャ図 - AWS公式アイコン適用ガイド

## 目次
1. [概要](#概要)
2. [アプローチA: 自動適用版の使用方法](#アプローチa-自動適用版の使用方法)
3. [アプローチB: 手動でアイコンを適用する方法](#アプローチb-手動でアイコンを適用する方法)
4. [AWS公式アイコン対応表](#aws公式アイコン対応表)
5. [トラブルシューティング](#トラブルシューティング)

---

## 概要

このガイドでは、Pattern 3アーキテクチャ図にAWS公式アイコンを適用する2つの方法を説明します。

### ファイル一覧
- **`pattern3-drawio-aws-icons.xml`** - AWS公式アイコン適用済み（自動生成版）
- **`pattern3-drawio-template.xml`** - 完全版テンプレート（20+コンポーネント）
- **`pattern3-drawio-simple.xml`** - 簡易版テンプレート（12コンポーネント）

---

## アプローチA: 自動適用版の使用方法

### ステップ1: ファイルを開く

1. **draw.ioを開く**: https://app.diagrams.net/ にアクセス
2. **ファイルを開く**: `File` > `Open from...` > `Device`
3. **XMLファイルを選択**: `pattern3-drawio-aws-icons.xml` を選択

### ステップ2: 確認事項

自動適用版には以下のAWS公式アイコンが既に組み込まれています:

✅ **ネットワーク層**
- Internet Gateway
- Virtual Private Gateway
- NAT Gateway
- Customer Gateway

✅ **コンピューティング層**
- AWS Lambda (5つの関数)
- ECS Fargate

✅ **ストレージ・データベース層**
- Amazon S3
- Amazon DynamoDB
- Amazon OpenSearch Service

✅ **オーケストレーション層**
- AWS Step Functions
- Amazon EventBridge
- Amazon SNS
- Amazon CloudWatch

✅ **データ転送層**
- AWS DataSync

✅ **オンプレミス**
- Traditional Server (NAS)
- User

### ステップ3: カスタマイズ（オプション）

1. **アイコンのサイズ調整**:
   - アイコンを選択
   - 右側のプロパティパネルで `Width` と `Height` を調整
   - 推奨サイズ: 60x60px または 78x78px

2. **ラベルの編集**:
   - ラベルテキストをダブルクリック
   - テキストを編集
   - フォントサイズやスタイルを変更

3. **配置の調整**:
   - アイコンをドラッグして移動
   - `Arrange` > `Align` で整列

### ステップ4: エクスポート

1. **PNG形式**: `File` > `Export as` > `PNG...`
   - 推奨設定: 300 DPI, Transparent Background
2. **PDF形式**: `File` > `Export as` > `PDF...`
3. **SVG形式**: `File` > `Export as` > `SVG...`

---

## アプローチB: 手動でアイコンを適用する方法

既存のテンプレートファイル（`pattern3-drawio-template.xml` または `pattern3-drawio-simple.xml`）に手動でAWS公式アイコンを適用する方法です。

### ステップ1: AWS公式アイコンライブラリのインポート

#### 方法1: draw.io組み込みライブラリを使用

1. **draw.ioを開く**: https://app.diagrams.net/
2. **既存ファイルを開く**: `pattern3-drawio-template.xml` または `pattern3-drawio-simple.xml`
3. **シェイプパネルを開く**: 左サイドバーの `More Shapes...` をクリック
4. **AWS 19を有効化**:
   - `Networking` カテゴリの中から `AWS 19` を探してチェック
   - または検索ボックスに「AWS 19」と入力
   - `Apply` をクリック

#### 方法2: AWS公式サイトからダウンロード

1. **AWS Architecture Iconsをダウンロード**:
   - URL: https://aws.amazon.com/architecture/icons/
   - 「Download the AWS Architecture Icons」をクリック
   - ZIP形式でダウンロード

2. **draw.ioにインポート**:
   - draw.ioで `File` > `Open Library from...` > `Device`
   - ダウンロードしたZIPファイルを解凍
   - `AWS-Architecture-Icons_SVG` フォルダ内の任意のSVGファイルをドラッグ&ドロップ

### ステップ2: アイコンの置き換え

#### 基本手順

1. **既存の四角形を選択**: 置き換えたいコンポーネント（例: NAS Server）を選択
2. **位置を記録**: 選択した四角形の位置（X, Y座標）をメモ
3. **AWS公式アイコンを配置**:
   - 左サイドバーから対応するAWS公式アイコンを探す
   - キャンバスにドラッグ&ドロップ
   - 記録した位置に移動
4. **ラベルを追加**:
   - `Insert` > `Text` でテキストボックスを追加
   - アイコンの下に配置
   - サービス名とスペックを記入
5. **古い四角形を削除**: 元の四角形を選択して `Delete` キー

#### 効率的な置き換え方法

**方法A: 直接置き換え**
1. 古い四角形を選択
2. 対応するAWS公式アイコンをドラッグして上に重ねる
3. 古い四角形を選択して削除
4. アイコンの位置を微調整

**方法B: コピー&ペースト**
1. AWS公式アイコンをキャンバスに配置
2. `Ctrl+C` (Windows) または `Cmd+C` (Mac) でコピー
3. 複数の同じアイコンが必要な場合、`Ctrl+V` で貼り付け
4. 各アイコンの位置を調整

### ステップ3: コンポーネント別の詳細手順

#### 1. NAS Server → Traditional Server

- **アイコン名**: `Traditional Server` または `On-Premises Server`
- **場所**: AWS 19 > General > Traditional Server
- **配置位置**: (211, 180)
- **ラベル**:
  ```
  NAS Server
  SMB/NFS
  500GB
  1,000,000 files
  ```

#### 2. VPN Connection → AWS Site-to-Site VPN

- **アイコン名**: `VPN Gateway` または `Site-to-Site VPN`
- **場所**: AWS 19 > Networking & Content Delivery > VPN Gateway
- **配置位置**: (640, 370)
- **ラベル**:
  ```
  Virtual Private Gateway
  Site-to-Site VPN
  月4時間のみ接続
  2:00-6:00 (月1日)
  ```

#### 3. NAT Gateway

- **アイコン名**: `NAT Gateway`
- **場所**: AWS 19 > Networking & Content Delivery > NAT Gateway
- **配置位置**: (960, 260) - Public Subnet内
- **ラベル**:
  ```
  NAT Gateway
  Elastic IP
  インターネット経由
  アクセス制御
  ```

#### 4. Lambda Functions (5つ)

- **アイコン名**: `AWS Lambda`
- **場所**: AWS 19 > Compute > Lambda
- **配置位置**:
  - VPNManager: (860, 500)
  - FileScanner: (1100, 500)
  - TextExtractor: (860, 710)
  - ImageFeatureExtractor: (1100, 710)
  - BulkIndexer: (860, 920)
- **ラベル例（TextExtractor）**:
  ```
  TextExtractor
  Python 3.11
  2048MB ARM64
  - PDF解析
  月5,000実行
  ```

#### 5. OpenSearch Service

- **アイコン名**: `Amazon OpenSearch Service`
- **場所**: AWS 19 > Analytics > OpenSearch Service
- **配置位置**: (1100, 920)
- **ラベル**:
  ```
  OpenSearch Service
  t3.small.search
  vCPU: 2, RAM: 2GB
  50GB gp3
  - kuromoji (日本語)
  - k-NN (画像類似)
  ```

#### 6. SearchAPI Lambda

- **アイコン名**: `AWS Lambda`
- **場所**: AWS 19 > Compute > Lambda
- **配置位置**: (1560, 520) - Private Subnet 2内
- **ラベル**:
  ```
  SearchAPI
  Node.js 20
  512MB ARM64
  POST /api/search
  月10,000実行
  Multi-AZ冗長性
  ```

#### 7. AWS DataSync

- **アイコン名**: `AWS DataSync`
- **場所**: AWS 19 > Migration & Transfer > DataSync
- **配置位置**: (691, 1170)
- **ラベル**:
  ```
  AWS DataSync
  増分同期: 20GB/月
  転送レート: 100Mbps
  転送時間: 約3時間
  ```

#### 8. Amazon S3

- **アイコン名**: `Amazon S3`
- **場所**: AWS 19 > Storage > S3
- **配置位置**: (691, 1350)
- **ラベル**:
  ```
  S3 Bucket
  Intelligent-Tiering
  100GB
  - 抽出テキスト: 40GB
  - 画像特徴量: 10GB
  - サムネイル: 30GB
  - ログ: 20GB
  ```

#### 9. Amazon DynamoDB

- **アイコン名**: `Amazon DynamoDB`
- **場所**: AWS 19 > Database > DynamoDB
- **配置位置**: (991, 1170)
- **ラベル**:
  ```
  DynamoDB
  On-Demand
  - file_metadata: 5GB
  - sync_jobs: 100MB
  ```

#### 10. AWS Step Functions

- **アイコン名**: `AWS Step Functions`
- **場所**: AWS 19 > Application Integration > Step Functions
- **配置位置**: (1551, 1170)
- **ラベル**:
  ```
  Step Functions
  MonthlyBatchSyncWorkflow
  実行頻度: 月1回
  実行時間: 5-6時間
  ```

#### 11. Amazon EventBridge

- **アイコン名**: `Amazon EventBridge`
- **場所**: AWS 19 > Application Integration > EventBridge
- **配置位置**: (1431, 1350)
- **ラベル**:
  ```
  EventBridge
  cron(0 2 1 * ? *)
  毎月1日 深夜2時
  ```

#### 12. Amazon SNS

- **アイコン名**: `Amazon SNS`
- **場所**: AWS 19 > Application Integration > SNS
- **配置位置**: (1671, 1350)
- **ラベル**:
  ```
  SNS
  BatchNotifications
  管理者メール × 5
  ```

#### 13. Amazon CloudWatch

- **アイコン名**: `Amazon CloudWatch`
- **場所**: AWS 19 > Management & Governance > CloudWatch
- **配置位置**: (991, 1350)
- **ラベル**:
  ```
  CloudWatch
  Logs: 2GB/月
  Metrics: 10個
  Alarms: 5個
  ```

#### 14. Internet Gateway

- **アイコン名**: `Internet Gateway`
- **場所**: AWS 19 > Networking & Content Delivery > Internet Gateway
- **配置位置**: (640, 220)
- **ラベル**:
  ```
  Internet Gateway
  インターネット接続
  ```

#### 15. User

- **アイコン名**: `User` または `Users`
- **場所**: AWS 19 > General > User
- **配置位置**: (211, 1150)
- **ラベル**:
  ```
  ユーザー
  社内50名
  Azure AD SSO
  ```

#### 16. ECS Fargate (Next.js Frontend)

- **アイコン名**: `AWS Fargate`
- **場所**: AWS 19 > Compute > Fargate
- **配置位置**: (211, 1350)
- **ラベル**:
  ```
  Next.js Frontend
  ECS Fargate
  vCPU: 0.25, RAM: 0.5GB
  TypeScript + Tailwind
  ```

### ステップ4: 接続線の調整

アイコンを置き換えた後、接続線の位置がずれる場合があります。

1. **接続線を選択**: 調整したい線をクリック
2. **接続点を移動**: 線の端点をドラッグしてアイコンの適切な位置に接続
3. **線のスタイル確認**:
   - バッチ同期フロー: 青、太さ3pt、実線
   - データ転送: オレンジ、太さ4pt、実線
   - 検索フロー: 緑、太さ2pt、実線
   - VPN接続: 青、太さ3pt、破線 (dashPattern: 8 8)
   - インターネットアクセス: 黄、太さ1pt、点線 (dashPattern: 4 4)

### ステップ5: レイアウトの最終調整

1. **アイコンのサイズ統一**:
   - すべてのAWSアイコンを選択 (`Shift` + クリック)
   - 右側プロパティパネルで `Width: 78px`, `Height: 78px` に統一

2. **ラベルの位置揃え**:
   - 各アイコンのラベルを選択
   - `Arrange` > `Align` > `Center Horizontally` でアイコンの中央に配置

3. **グループ化**:
   - アイコンとラベルを選択 (`Shift` + クリック)
   - 右クリック > `Group`
   - これにより、アイコンとラベルを一緒に移動できます

### ステップ6: 保存とエクスポート

1. **XMLファイルとして保存**:
   - `File` > `Save as...`
   - ファイル名: `pattern3-drawio-aws-icons-manual.xml`

2. **エクスポート**:
   - **PNG**: `File` > `Export as` > `PNG...` (300 DPI推奨)
   - **PDF**: `File` > `Export as` > `PDF...`
   - **SVG**: `File` > `Export as` > `SVG...`

---

## AWS公式アイコン対応表

| # | コンポーネント名 | AWS公式アイコン名 | カテゴリ | アイコンの色 |
|---|-----------------|-------------------|---------|------------|
| 1 | NAS Server | Traditional Server | General | グレー |
| 2 | VPN Connection | VPN Gateway | Networking | 紫 |
| 3 | NAT Gateway | NAT Gateway | Networking | 紫 |
| 4 | Lambda (VPNManager) | AWS Lambda | Compute | オレンジ |
| 5 | Lambda (FileScanner) | AWS Lambda | Compute | オレンジ |
| 6 | Lambda (TextExtractor) | AWS Lambda | Compute | オレンジ |
| 7 | Lambda (ImageExtractor) | AWS Lambda | Compute | オレンジ |
| 8 | Lambda (BulkIndexer) | AWS Lambda | Compute | オレンジ |
| 9 | OpenSearch Service | Amazon OpenSearch Service | Analytics | 緑 |
| 10 | SearchAPI Lambda | AWS Lambda | Compute | オレンジ |
| 11 | AWS DataSync | AWS DataSync | Migration & Transfer | 緑 |
| 12 | S3 Bucket | Amazon S3 | Storage | 緑 |
| 13 | DynamoDB | Amazon DynamoDB | Database | 青 |
| 14 | Step Functions | AWS Step Functions | Application Integration | ピンク |
| 15 | EventBridge | Amazon EventBridge | Application Integration | ピンク |
| 16 | SNS | Amazon SNS | Application Integration | ピンク |
| 17 | CloudWatch | Amazon CloudWatch | Management & Governance | ピンク |
| 18 | Internet Gateway | Internet Gateway | Networking | 紫 |
| 19 | Virtual Private Gateway | VPN Gateway | Networking | 紫 |
| 20 | Customer Gateway | Customer Gateway | Networking | 紫 |
| 21 | User | User | General | グレー |
| 22 | ECS Fargate | AWS Fargate | Compute | オレンジ |

### アイコンの色の意味

- **オレンジ**: コンピューティングサービス (Lambda, Fargate)
- **緑**: ストレージ・データサービス (S3, DataSync, OpenSearch)
- **青**: データベースサービス (DynamoDB)
- **ピンク**: アプリケーション統合・監視サービス (Step Functions, EventBridge, SNS, CloudWatch)
- **紫**: ネットワークサービス (VPN, NAT, IGW)
- **グレー**: 汎用アイコン (Server, User)

---

## トラブルシューティング

### 問題1: AWS公式アイコンが見つからない

**原因**: draw.ioのAWS 19ライブラリが有効化されていない

**解決策**:
1. 左サイドバーの `More Shapes...` をクリック
2. 検索ボックスに「AWS 19」と入力
3. `AWS 19` をチェックして `Apply` をクリック
4. 左サイドバーに「AWS 19」カテゴリが表示されます

### 問題2: アイコンが小さすぎる/大きすぎる

**原因**: アイコンのサイズが適切でない

**解決策**:
1. アイコンを選択
2. 右側プロパティパネルで `Width` と `Height` を調整
3. 推奨サイズ: 60x60px、78x78px、または 80x80px
4. `Maintain aspect ratio` (縦横比を維持) がチェックされていることを確認

### 問題3: 接続線がアイコンに接続されない

**原因**: アイコンの接続点が見つからない

**解決策**:
1. 接続線の端点をアイコンの中心付近にドラッグ
2. 青い円 (接続点) が表示されたらドロップ
3. または、`View` > `Connection Points` を有効化して接続点を表示

### 問題4: ラベルがアイコンと重なる

**原因**: ラベルの配置位置が適切でない

**解決策**:
1. ラベルテキストを選択
2. アイコンの下または右側に移動
3. または、アイコンの `verticalLabelPosition` を `bottom` に設定

### 問題5: エクスポートした画像が低解像度

**原因**: エクスポート設定のDPIが低い

**解決策**:
1. `File` > `Export as` > `PNG...`
2. `Zoom` を `300%` または `400%` に設定
3. または `DPI` を `300` に設定
4. `Transparent Background` をチェック (背景透過が必要な場合)

### 問題6: アイコンの色が異なる

**原因**: 古いバージョンのAWS公式アイコンを使用している

**解決策**:
1. 最新のAWS Architecture Icons (2023年版) をダウンロード
2. URL: https://aws.amazon.com/architecture/icons/
3. draw.ioで `File` > `Open Library from...` > `Device`
4. 新しいアイコンライブラリをインポート

### 問題7: XMLファイルが開けない

**原因**: ファイルが破損しているか、draw.ioが対応していない形式

**解決策**:
1. ファイルをテキストエディタで開いて、XMLの構造を確認
2. `<mxfile>` タグで始まり、`</mxfile>` タグで終わっていることを確認
3. 破損している場合は、バックアップファイルから復元

### 問題8: アイコンが正しい位置に配置されない

**原因**: サブネットやグループの境界が考慮されていない

**解決策**:
1. サブネット (Public Subnet, Private Subnet 1, Private Subnet 2) の境界を確認
2. アイコンをサブネット内にドラッグ&ドロップ
3. `Arrange` > `Send to Back` でサブネットを背面に送る
4. アイコンがサブネットの前面に表示されることを確認

---

## 参考リンク

- **AWS Architecture Icons 公式ページ**: https://aws.amazon.com/architecture/icons/
- **draw.io 公式サイト**: https://app.diagrams.net/
- **draw.io ドキュメント**: https://www.drawio.com/doc/
- **AWS Well-Architected Framework**: https://aws.amazon.com/architecture/well-architected/

---

## 変更履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2025-01-18 | 1.0 | 初版作成 - AWS公式アイコン適用ガイド |

---

## ライセンス

このガイドで使用されているAWS公式アイコンは、AWS Architecture Icons (2023年版) に準拠しています。
AWS Architecture IconsはAmazon Web Services, Inc.の商標です。

使用に際しては、AWSの商標ガイドラインに従ってください:
https://aws.amazon.com/trademark-guidelines/
