# Pattern 3 Architecture - draw.io 総合ガイド

## 概要

このガイドは、`pattern3-architecture.puml`（PlantUMLファイル)をdraw.ioで使用可能な形式に変換するための**総合的な実用ガイド**です。

5つの異なるアプローチを提供し、あなたのスキルレベルや環境に応じて最適な方法を選択できます。

---

## 📋 目次

1. [成果物一覧](#成果物一覧)
2. [推奨アプローチの選び方](#推奨アプローチの選び方)
3. [アプローチ1: 基本テンプレートXMLの使用](#アプローチ1-基本テンプレートxmlの使用)
4. [アプローチ2: PlantUMLインポート機能の活用](#アプローチ2-plantumlインポート機能の活用)
5. [アプローチ3: CSVインポートによる一括配置](#アプローチ3-csvインポートによる一括配置)
6. [アプローチ4: オンライン変換ツールの活用](#アプローチ4-オンライン変換ツールの活用)
7. [アプローチ5: 簡易版XMLテンプレートの使用](#アプローチ5-簡易版xmlテンプレートの使用)
8. [AWS公式アイコンへの置き換え手順](#aws公式アイコンへの置き換え手順)
9. [トラブルシューティング](#トラブルシューティング)
10. [FAQ](#faq)

---

## 成果物一覧

このガイドでは、以下のファイルが提供されています:

### ✅ draw.io XMLファイル

| ファイル名 | 説明 | 用途 |
|:---|:---|:---|
| **pattern3-drawio-template.xml** | 完全な基本テンプレート（20+コンポーネント） | そのまま開いて編集可能 |
| **pattern3-drawio-simple.xml** | 簡易版テンプレート（主要10コンポーネント） | 初心者向け、学習用 |

### 📄 ガイドドキュメント

| ファイル名 | 説明 |
|:---|:---|
| **pattern3-plantuml-to-drawio-guide.md** | PlantUML → draw.io 変換手順（詳細版） |
| **pattern3-csv-to-drawio-guide.md** | CSV → draw.io インポート手順 |
| **pattern3-conversion-tools-guide.md** | オンラインツール・デスクトップツール活用ガイド |
| **pattern3-drawio-comprehensive-guide.md** | **このファイル（総合ガイド）** |

### 📊 CSVデータファイル（既存）

| ファイル名 | 説明 |
|:---|:---|
| **pattern3-components.csv** | 全コンポーネント一覧（座標、スタイル含む） |
| **pattern3-connections.csv** | 接続関係一覧（全32接続） |

### 🎨 元ファイル

| ファイル名 | 説明 |
|:---|:---|
| **pattern3-architecture.puml** | PlantUML原本ファイル |

---

## 推奨アプローチの選び方

### 🆕 初心者の方（draw.io初体験）

**推奨: アプローチ5（簡易版XMLテンプレート）**

- 所要時間: 約2時間
- スキル要件: なし
- 主要10コンポーネントのみで学習しやすい
- ステップバイステップの説明付き

### 🔰 中級者の方（draw.io経験あり）

**推奨: アプローチ1（基本テンプレートXML）**

- 所要時間: 約3時間
- スキル要件: draw.io基本操作
- 全コンポーネントが既に配置済み
- レイアウト調整が最小限

### 👨‍💻 上級者の方（開発環境を持っている）

**推奨: アプローチ2（PlantUMLインポート）**

- 所要時間: 約2時間
- スキル要件: draw.io Desktop版のインストール
- PlantUMLを直接インポート可能
- 最も柔軟なカスタマイズが可能

### 🏢 チームで作業する場合

**推奨: アプローチ3（CSVインポート）**

- 所要時間: 約3.5時間
- スキル要件: CSV編集
- データベースから自動生成可能
- バージョン管理が容易

### 🚀 最速で図を作成したい場合

**推奨: アプローチ4（オンライン変換ツール）**

- 所要時間: 約1.5時間
- スキル要件: なし
- PlantUML公式サーバーでPNG/SVG生成
- draw.ioに背景として挿入して手動配置

---

## アプローチ1: 基本テンプレートXMLの使用

### 概要

**pattern3-drawio-template.xml**は、全てのコンポーネントが既に配置された完全なdraw.io XMLファイルです。

このファイルを開くだけで、すぐに編集を開始できます。

### ステップ1: XMLファイルをダウンロード

以下のファイルを確認します:
- `/docs/pattern3-drawio-template.xml`

### ステップ2: draw.ioで開く

#### 方法A: Webブラウザ版

1. https://app.diagrams.net/ にアクセス
2. `Open Existing Diagram`をクリック
3. `Device`を選択
4. `pattern3-drawio-template.xml`を選択
5. `Open`をクリック

#### 方法B: Desktop版

1. draw.io Desktopアプリを起動
2. `File` → `Open from` → `Device`
3. `pattern3-drawio-template.xml`を選択

### ステップ3: 図の確認

**表示される要素:**
- ✅ オンプレミス環境グループ（グレー背景）
- ✅ AWS Cloudグループ（オレンジ背景）
- ✅ バッチ処理層グループ（黄色背景）
- ✅ 全20コンポーネント（四角形ボックス）
- ✅ 主要な接続線
- ✅ 凡例、コスト構成、注釈

### ステップ4: AWS公式アイコンへの置き換え

詳細は[AWS公式アイコンへの置き換え手順](#aws公式アイコンへの置き換え手順)を参照してください。

### ステップ5: 保存とエクスポート

1. `File` → `Save as...`
2. ファイル名: `pattern3-architecture-final.drawio`
3. エクスポート: `File` → `Export as` → `PNG/PDF/SVG`

### メリット・デメリット

| メリット | デメリット |
|:---|:---|
| ✅ すぐに使える | ❌ XMLの直接編集が必要な場合は複雑 |
| ✅ レイアウト済み | ❌ AWSアイコンは手動置き換え |
| ✅ 編集可能 | |
| ✅ 完全なコンポーネントセット | |

**推奨度: ★★★★★**

---

## アプローチ2: PlantUMLインポート機能の活用

### 概要

draw.ioには**PlantUMLインポート機能**があります。PlantUMLファイルを直接インポートし、draw.io図として編集できます。

### 詳細ガイド

📘 **pattern3-plantuml-to-drawio-guide.md** を参照してください。

このガイドでは以下の内容を詳しく説明しています:

1. **PlantUMLインポートの基本手順**
   - draw.io Web版でのインポート
   - draw.io Desktop版でのインポート
   - VS Code拡張機能の使用

2. **PlantUML → PNG/SVG変換**
   - PlantUML公式サーバーの使用
   - PlantTextオンラインエディタ
   - コマンドラインツール

3. **自動生成された図の編集**
   - レイアウト調整
   - AWS公式アイコンへの置き換え
   - スタイリング

4. **トラブルシューティング**

### クイックスタート

1. https://app.diagrams.net/ を開く
2. `Arrange` → `Insert` → `Advanced` → `PlantUML...`
3. `/docs/pattern3-architecture.puml`の内容を貼り付け
4. `Insert`をクリック

### メリット・デメリット

| メリット | デメリット |
|:---|:---|
| ✅ 元ファイルから自動生成 | ❌ 複雑な構文は対応していない場合がある |
| ✅ 編集可能な形式 | ❌ AWSアイコンは手動置き換え |
| ✅ 最新のPlantUMLに追従可能 | ❌ レイアウト調整が必要 |

**推奨度: ★★★★☆**

---

## アプローチ3: CSVインポートによる一括配置

### 概要

CSVファイルを使用して、コンポーネント情報を一括でdraw.ioにインポートできます。

### 詳細ガイド

📘 **pattern3-csv-to-drawio-guide.md** を参照してください。

このガイドでは以下の内容を詳しく説明しています:

1. **CSVファイルの準備**
   - pattern3-components.csv
   - pattern3-connections.csv

2. **draw.ioでのCSVインポート**
   - `Arrange` → `Insert` → `Advanced` → `CSV...`
   - マッピング設定

3. **レイアウト調整**
   - 自動レイアウトの適用
   - 手動調整のコツ

4. **接続線の追加**
   - 手動での接続線追加
   - CSVデータの活用

### 既存のCSVファイル

以下のCSVファイルが既に用意されています:

- **pattern3-components.csv**: 全27コンポーネント（座標、スタイル含む）
- **pattern3-connections.csv**: 全32接続（色、太さ、スタイル含む）

### クイックスタート

1. https://app.diagrams.net/ を開く
2. `Arrange` → `Insert` → `Advanced` → `CSV...`
3. `/docs/pattern3-components.csv`の内容を貼り付け
4. `Import`をクリック

### メリット・デメリット

| メリット | デメリット |
|:---|:---|
| ✅ 大量のコンポーネントを一括配置 | ❌ 接続線は手動追加が必要 |
| ✅ データベースから自動生成可能 | ❌ レイアウト調整が必要 |
| ✅ バージョン管理が容易 | ❌ CSVフォーマットの理解が必要 |

**推奨度: ★★★☆☆**（チーム作業に最適）

---

## アプローチ4: オンライン変換ツールの活用

### 概要

PlantUMLをPNG/SVG画像に変換し、draw.ioに背景として挿入する方法です。

### 詳細ガイド

📘 **pattern3-conversion-tools-guide.md** を参照してください。

このガイドでは以下の7つのツールを紹介しています:

1. **PlantUML公式オンラインサーバー**（最もシンプル）
2. **PlantTextオンラインエディタ**（リアルタイムプレビュー）
3. **VS Code拡張機能**（ローカル環境）
4. **Atomエディタプラグイン**
5. **IntelliJ IDEA / PyCharmプラグイン**
6. **draw.io Desktop版のPlantUMLサポート**（最も推奨）
7. **コマンドライン変換ツール**（バッチ処理）

### クイックスタート（最速）

1. http://www.plantuml.com/plantuml/uml/ にアクセス
2. `/docs/pattern3-architecture.puml`の内容を貼り付け
3. `Submit`をクリック
4. 生成されたPNG/SVG画像を保存
5. draw.ioで`File` → `Import from` → `Image...`
6. 画像を背景としてロック
7. AWS公式アイコンを配置

### メリット・デメリット

| メリット | デメリット |
|:---|:---|
| ✅ 最速（1.5時間） | ❌ 画像は編集不可 |
| ✅ インストール不要 | ❌ AWS公式アイコンは含まれない |
| ✅ 高品質なSVG出力 | ❌ 背景として使用するのみ |

**推奨度: ★★★☆☆**（速度重視）

---

## アプローチ5: 簡易版XMLテンプレートの使用

### 概要

**pattern3-drawio-simple.xml**は、主要10コンポーネントのみを含む簡易版テンプレートです。

初心者の学習や、シンプルな図を素早く作成したい場合に最適です。

### ステップ1: XMLファイルを開く

1. https://app.diagrams.net/ にアクセス
2. `Open Existing Diagram`をクリック
3. `pattern3-drawio-simple.xml`を選択

### ステップ2: 表示される主要コンポーネント

以下の10個のコンポーネントが配置されています:

| # | コンポーネント名 | 説明 |
|:---|:---|:---|
| 1 | NAS Server | オンプレミスストレージ |
| 2 | VPN Connection | Site-to-Site VPN |
| 3 | AWS DataSync | データ同期サービス |
| 4 | Lambda: TextExtractor | テキスト抽出 |
| 5 | OpenSearch Service | 全文検索エンジン |
| 6 | DynamoDB | NoSQLデータベース |
| 7 | S3 Bucket | オブジェクトストレージ |
| 8 | Step Functions | ワークフローオーケストレーション |
| 9 | EventBridge | イベントスケジューラー |
| 10 | CloudWatch | 監視・ログ管理 |

### ステップ3: 学習用として活用

この簡易版は、以下の学習に最適です:

- draw.ioの基本操作
- AWS公式アイコンへの置き換え方法
- 接続線の追加方法
- スタイリングの基礎

### ステップ4: 完全版への拡張

簡易版で学習した後、**pattern3-drawio-template.xml**（完全版）に移行してください。

### メリット・デメリット

| メリット | デメリット |
|:---|:---|
| ✅ シンプルで理解しやすい | ❌ 全体像は含まれない |
| ✅ 学習に最適 | ❌ 詳細なコンポーネントは手動追加が必要 |
| ✅ 短時間で完成 | |

**推奨度: ★★★★☆**（初心者向け）

---

## AWS公式アイコンへの置き換え手順

### ステップ1: AWS公式アイコンライブラリを追加

1. draw.ioを開く
2. 左サイドバーの下部にある`More Shapes...`をクリック
3. `Networking`セクションで**AWS Architecture Icons**をチェック
4. `Apply`をクリック

### ステップ2: アイコンカテゴリの確認

左サイドバーに以下のAWSカテゴリが追加されます:

- **Compute** (Lambda, ECS, EC2など)
- **Storage** (S3, EBS, EFSなど)
- **Database** (DynamoDB, RDS, OpenSearchなど)
- **Networking & Content Delivery** (VPC, VPN, CloudFrontなど)
- **Application Integration** (Step Functions, EventBridge, SNSなど)
- **Management & Governance** (CloudWatch, CloudFormationなど)
- **Migration & Transfer** (DataSyncなど)

### ステップ3: コンポーネントとAWSアイコンの対応表

| コンポーネント名 | AWS公式アイコン | カテゴリ |
|:---|:---|:---|
| NAS Server | Traditional Server | General |
| VPN Router | Customer Gateway | Networking |
| Virtual Private Gateway | AWS Site-to-Site VPN | Networking |
| AWS DataSync | AWS DataSync | Migration & Transfer |
| S3 Bucket | Amazon S3 | Storage |
| Step Functions | AWS Step Functions | Application Integration |
| VPNManager (Lambda) | AWS Lambda | Compute |
| FileScanner (Lambda) | AWS Lambda | Compute |
| TextExtractor (Lambda) | AWS Lambda | Compute |
| ImageFeatureExtractor (Lambda) | AWS Lambda | Compute |
| BulkIndexer (Lambda) | AWS Lambda | Compute |
| SearchAPI (Lambda) | AWS Lambda | Compute |
| OpenSearch Service | Amazon OpenSearch Service | Analytics |
| DynamoDB | Amazon DynamoDB | Database |
| EventBridge | Amazon EventBridge | Application Integration |
| SNS | Amazon SNS | Application Integration |
| CloudWatch | Amazon CloudWatch | Management & Governance |
| Next.js Frontend | Amazon ECS | Containers |
| User | User | General |

### ステップ4: 四角形ボックスをアイコンに置き換える

1. 置き換えたい四角形ボックスをクリック
2. 左サイドバーから対応するAWSアイコンを探す
3. アイコンを**ドラッグ&ドロップ**してボックスの上に配置
4. 古いボックスを削除
5. アイコンの下に**テキストボックス**を追加してラベルを記入

### ステップ5: アイコンのサイズ統一

1. アイコンを選択
2. 右サイドバーで`Width`と`Height`を設定
   - 推奨サイズ: `80px × 80px`（標準）
   - Lambda: `70px × 70px`（やや小さめ）
   - グループヘッダー: `100px × 100px`（大きめ）

### ステップ6: テキストラベルの追加

1. 左サイドバーから`Text`を選択
2. アイコンの下に配置
3. コンポーネント名と説明を記入
   - 例: "VPNManager\nPython 3.11, 512MB ARM64"

### ステップ7: 全体の確認とバランス調整

1. 全てのアイコン置き換えが完了したか確認
2. グリッドスナップを使用して整列
3. 接続線の位置を調整

---

## トラブルシューティング

### Q1: draw.ioでXMLファイルが開けない

**原因:** XMLファイルの文字コードまたはフォーマットが正しくない可能性があります。

**解決策:**
1. XMLファイルをテキストエディタで開く
2. 文字コードが`UTF-8`であることを確認
3. `<mxfile>`タグから始まっているか確認
4. 構文エラーがないか確認

### Q2: AWS公式アイコンが見つからない

**原因:** AWSアイコンライブラリが追加されていません。

**解決策:**
1. 左サイドバーの`More Shapes...`をクリック
2. 検索ボックスに「AWS」と入力
3. `AWS Architecture Icons`をチェック
4. `Apply`をクリック

### Q3: PlantUMLインポートがうまくいかない

**原因:** draw.ioのPlantUMLパーサーは一部の高度な構文に対応していません。

**解決策:**
1. PlantUMLファイルを簡略化
2. AWS公式アイコンの`!include`ディレクティブを削除
3. 基本的な構造のみをインポート
4. アイコンは手動で追加

### Q4: 接続線が正しく表示されない

**原因:** 接続線のスタイル設定が正しくありません。

**解決策:**
1. 接続線を選択
2. 右サイドバーで以下を設定:
   - `Line`: 色を設定（例: `#0066CC`）
   - `Line Width`: 太さを設定（例: `3pt`）
   - `Dashed`: 破線スタイル（必要に応じて）

### Q5: レイアウトが崩れる

**原因:** コンポーネントの位置がずれています。

**解決策:**
1. `View` → `Grid`をオン
2. `View` → `Snap to Grid`をオン
3. グリッドにスナップさせながら再配置
4. または、`Arrange` → `Layout` → `Hierarchical`で自動レイアウト

---

## FAQ

### Q1: どのアプローチが一番簡単ですか?

**A:** 初心者の方には**アプローチ5（簡易版XMLテンプレート）**が最もおすすめです。主要10コンポーネントのみで学習しやすく、約2時間で完成します。

### Q2: 最速で完成させる方法は?

**A:** **アプローチ4（オンライン変換ツール）**を使用してください。PlantUML公式サーバーでPNG/SVGを生成し、draw.ioに背景として挿入します。約1.5時間で完成します。

### Q3: チームで共同編集する場合は?

**A:** **アプローチ3（CSVインポート）**を推奨します。CSVファイルはバージョン管理が容易で、データベースやスプレッドシートから自動生成できます。

### Q4: AWS公式アイコンは自動で配置できますか?

**A:** 残念ながら、**AWS公式アイコンへの置き換えは手動**で行う必要があります。ただし、基本構造を自動生成できるため、ゼロから作成するよりも大幅に時間を節約できます。

### Q5: draw.io DesktopとWeb版の違いは?

**A:** 主な違いは以下の通りです:

| 機能 | Web版 | Desktop版 |
|:---|:---|:---|
| PlantUMLインポート | ✅ 対応 | ✅ 対応（より高度） |
| オフライン動作 | ❌ | ✅ |
| プラグイン | 一部のみ | ✅ 全て |
| ファイル保存先 | ブラウザ/クラウド | ローカル |
| 推奨度 | ★★★★☆ | ★★★★★ |

Desktop版の方が高機能ですが、Web版でも十分に使用できます。

### Q6: 完成した図をPowerPointに挿入できますか?

**A:** はい、以下の方法があります:

1. **PNG形式でエクスポート**（最もシンプル）
   - `File` → `Export as` → `PNG...`
   - PowerPointに`Insert` → `Picture`

2. **SVG形式でエクスポート**（高品質）
   - `File` → `Export as` → `SVG...`
   - PowerPointに挿入（Office 2016以降）

3. **EMF形式でエクスポート**（ベクター、最高品質）
   - draw.io Desktop版で`File` → `Export as` → `EMF...`
   - PowerPointに挿入して編集可能

### Q7: 図の一部だけを更新したい場合は?

**A:** draw.io XMLファイル（`.drawio`形式）で保存しておけば、いつでも編集可能です。

1. `File` → `Save as...`
2. ファイル名: `pattern3-architecture.drawio`
3. 必要に応じて編集
4. 再度エクスポート

---

## まとめ

このガイドでは、PlantUMLからdraw.ioへの変換方法を5つのアプローチで説明しました。

### 推奨アプローチまとめ

| 対象 | 推奨アプローチ | 所要時間 | 難易度 |
|:---|:---|:---|:---|
| 初心者 | アプローチ5（簡易版XML） | 2時間 | ★☆☆☆☆ |
| 中級者 | アプローチ1（基本テンプレートXML） | 3時間 | ★★☆☆☆ |
| 上級者 | アプローチ2（PlantUMLインポート） | 2時間 | ★★★☆☆ |
| チーム | アプローチ3（CSVインポート） | 3.5時間 | ★★★☆☆ |
| 速度重視 | アプローチ4（オンライン変換） | 1.5時間 | ★☆☆☆☆ |

### 次のステップ

1. **アプローチを選択**: 上記の推奨から自分に合った方法を選ぶ
2. **XMLまたはPlantUMLファイルを準備**: `/docs/`ディレクトリ内のファイルを使用
3. **draw.ioで開く**: Web版またはDesktop版
4. **AWS公式アイコンに置き換え**: [置き換え手順](#aws公式アイコンへの置き換え手順)を参照
5. **保存とエクスポート**: `.drawio`形式で保存し、PNG/PDF/SVGでエクスポート

### サポートが必要な場合

ご不明な点があれば、以下のガイドも参照してください:

- 📘 **pattern3-plantuml-to-drawio-guide.md**: PlantUMLインポートの詳細
- 📘 **pattern3-csv-to-drawio-guide.md**: CSVインポートの詳細
- 📘 **pattern3-conversion-tools-guide.md**: オンラインツールの詳細

---

**Happy Diagramming! 🎨**
