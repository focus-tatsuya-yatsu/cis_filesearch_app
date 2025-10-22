# PlantUML → draw.io 変換ガイド

## 概要

このガイドでは、`pattern3-architecture.puml`ファイルをdraw.ioで使用可能な形式に変換する複数の方法を説明します。

---

## 方法1: draw.io PlantUMLインポート機能（推奨）

draw.ioには**PlantUMLインポート機能**が組み込まれています。この機能を使用すると、PlantUMLファイルを自動的にdraw.io図に変換できます。

### ステップ1: PlantUMLファイルの内容をコピー

1. `/docs/pattern3-architecture.puml`ファイルを開く
2. **全ての内容**をコピー (Ctrl+A → Ctrl+C / Cmd+A → Cmd+C)

### ステップ2: draw.ioを開く

1. Webブラウザで https://app.diagrams.net/ にアクセス
2. `Device`（ローカルストレージ）または`Google Drive`を選択
3. `Create New Diagram`をクリック

### ステップ3: PlantUMLインポート

1. メニューから`Arrange` → `Insert` → `Advanced` → `PlantUML...`を選択
   - または、メニューから`File` → `Import from` → `PlantUML...`を選択

2. ダイアログボックスが表示されたら、コピーしたPlantUMLコードを貼り付け

3. `Insert`または`Import`ボタンをクリック

### ステップ4: 自動生成された図の確認

**生成される要素:**
- ✅ すべてのコンポーネントが四角形ボックスとして生成
- ✅ ボックス内にラベル（コンポーネント名と説明）が含まれる
- ✅ 接続線が自動的に生成される
- ✅ グループ化（VPC、オンプレミスなど）が矩形で表現される

**生成されない要素:**
- ❌ AWS公式アイコン（手動で置き換える必要があります）
- ❌ 複雑な色分け（手動調整が必要）
- ❌ 凡例や注釈の詳細なスタイリング

### ステップ5: AWS公式アイコンへの置き換え

#### 5.1 AWS公式アイコンライブラリを追加

1. 左サイドバーの下部にある`More Shapes...`をクリック
2. `Networking`セクションで`AWS Architecture Icons`をチェック
3. または、検索ボックスに「AWS」と入力して`AWS Architecture Icons`を選択
4. `Apply`をクリック

#### 5.2 アイコンの配置

左サイドバーに**AWSカテゴリ**が追加されます。以下のカテゴリを使用します：

| PlantUMLコンポーネント | draw.io AWS アイコン | カテゴリ |
|:---|:---|:---|
| Lambda | AWS Lambda | Compute |
| S3 | Amazon S3 | Storage |
| DynamoDB | Amazon DynamoDB | Database |
| OpenSearch | Amazon OpenSearch Service | Analytics |
| Step Functions | AWS Step Functions | Application Integration |
| EventBridge | Amazon EventBridge | Application Integration |
| SNS | Amazon SNS | Application Integration |
| CloudWatch | Amazon CloudWatch | Management & Governance |
| DataSync | AWS DataSync | Migration & Transfer |
| VPN Connection | AWS Site-to-Site VPN | Networking & Content Delivery |
| VPC | Amazon VPC | Networking & Content Delivery |
| ECS | Amazon ECS | Containers |

#### 5.3 ボックスをアイコンに置き換える手順

1. 置き換えたいボックスをクリックして選択
2. 左サイドバーから対応するAWSアイコンを探す
3. アイコンをドラッグ&ドロップしてボックスの上に配置
4. 古いボックスを削除
5. アイコンの下にテキストボックスを追加してラベルを記入

**一括置き換えのコツ:**
- 同じ種類のコンポーネント（例: すべてのLambda関数）を先にまとめて置き換える
- アイコンのサイズを統一する（例: 幅80px、高さ80px）

### ステップ6: レイアウトとスタイリングの調整

#### 6.1 グループの背景色を設定

| グループ名 | 背景色 | 枠線色 |
|:---|:---|:---|
| オンプレミス環境 | #F5F5F5 (薄いグレー) | #666666 (濃いグレー) |
| AWS Cloud | #FFF7E6 (薄いオレンジ) | #FF9900 (オレンジ) |
| バッチ処理層 | #FFFDE7 (薄い黄色) | #FBC02D (ゴールド) |

**設定方法:**
1. グループの矩形を選択
2. 右サイドバーの`Fill`で背景色を設定
3. `Line`で枠線色を設定
4. `Line Width`を`2pt`または`3pt`に設定

#### 6.2 接続線のスタイリング

PlantUMLでは色分けされた接続線が定義されています:

| フロー種類 | 線の色 | 線の太さ | 線のスタイル |
|:---|:---|:---|:---|
| バッチ同期フロー | #0066CC (青) | 3pt | 実線 |
| データ転送フロー | #FF9900 (オレンジ) | 4pt | 実線 |
| 検索フロー | #00AA00 (緑) | 2pt | 実線 |
| VPN接続 | #0066CC (青) | 2pt | 破線 |
| 監視ログ | #00BCD4 (シアン) | 1pt | 点線 |

**接続線の編集方法:**
1. 接続線をクリック
2. 右サイドバーの`Line`で色を設定
3. `Line Width`で太さを設定
4. `Dashed`や`Dotted`でスタイルを設定

#### 6.3 ラベルの追加

接続線にラベルを追加する方法:
1. 接続線をダブルクリック
2. ラベルテキストを入力（例: "① 月1回トリガー"）
3. ラベルの位置を調整（ドラッグで移動可能）

### ステップ7: 凡例と注釈の追加

PlantUMLの`legend`と`note`をdraw.ioで再現する方法:

#### 7.1 凡例の作成

1. 右サイドバーから`Rectangle`を選択
2. キャンバスの右下に配置
3. 以下の内容を記入:

```
凡例
━━━━━━━━━━━━━━━━
━━━ バッチ同期フロー (月1回) [青]
━━━ データ転送 (増分20GB) [オレンジ]
━━━ 検索フロー (リアルタイム) [緑]
- - - VPN接続 (月4時間のみ) [青破線]
· · · 監視ログ [シアン点線]

コスト構成 ($47.24/月)
* OpenSearch: $31.46 (66.7%)
* DataSync: $5.00 (10.6%)
* CloudWatch: $4.00 (8.5%)
* S3: $2.18 (4.6%)
* Lambda: $1.35 (2.9%)
* その他: $3.25 (6.7%)

削減率: 96% (Pattern 2比)
```

4. スタイル設定:
   - 背景色: `#FFFFFF` (白)
   - 枠線色: `#666666` (グレー)
   - フォントサイズ: `11pt`

#### 7.2 主要な特徴の注釈

別の矩形を作成し、以下の内容を記入:

```
主要な特徴
━━━━━━━━━━━━━━━━
・月1回の増分同期 (VPN接続: 月4時間のみ)
・ファイル実体はNASに保持
・メタデータ+テキストのみAWSで管理
・全文検索 (kuromoji) + 画像類似検索 (k-NN)
・100万ファイル対応
・ARM64 (Graviton2) 最適化
```

スタイル:
- 背景色: `#FFF3E0` (薄いオレンジ)
- 枠線色: `#FF9800` (オレンジ)

### ステップ8: エクスポート

完成した図をエクスポートする方法:

#### 8.1 PNG形式（プレゼンテーション用）

1. `File` → `Export as` → `PNG...`
2. 設定:
   - `Zoom`: `100%`
   - `Border Width`: `10px`
   - `Transparent Background`: オフ（白背景）
3. `Export`をクリック

#### 8.2 PDF形式（ドキュメント用）

1. `File` → `Export as` → `PDF...`
2. 設定:
   - `Page View`: オン
   - `Fit to`: `1 page`
3. `Export`をクリック

#### 8.3 SVG形式（高品質）

1. `File` → `Export as` → `SVG...`
2. 設定:
   - `Embedded Fonts`: オン
   - `Include a copy of my diagram`: オン
3. `Export`をクリック

#### 8.4 draw.io XML形式（編集可能）

1. `File` → `Save as...`
2. ファイル名: `pattern3-architecture.drawio`
3. `Save`をクリック

---

## 方法2: PlantUML公式サーバーを使用

この方法では、PlantUMLを画像に変換してからdraw.ioに挿入します。

### ステップ1: PlantUML公式サーバーでPNG生成

1. http://www.plantuml.com/plantuml/uml/ にアクセス
2. `/docs/pattern3-architecture.puml`の内容を貼り付け
3. `Submit`をクリック
4. 生成されたPNG画像を右クリックして保存

### ステップ2: draw.ioに背景として挿入

1. draw.ioで新しい図を作成
2. `File` → `Import from` → `Image...`
3. 保存したPNG画像を選択
4. `Import`をクリック

### ステップ3: 画像を背景にロック

1. 挿入された画像を選択
2. 右クリック → `To Back`（最背面に移動）
3. 右クリック → `Edit Style...`
4. `locked=1`を追加して`Apply`

### ステップ4: AWS公式アイコンを配置

1. 画像の上にAWS公式アイコンをドラッグ&ドロップ
2. 各コンポーネントの位置に合わせて配置
3. 背景画像は参考用として使用

### ステップ5: 背景画像を削除（オプション）

1. すべてのアイコン配置が完了したら背景画像を削除
2. 最終的にはAWS公式アイコンのみの図が完成

---

## 方法3: VS Code拡張機能を使用

### ステップ1: VS Codeに拡張機能をインストール

1. VS Codeを開く
2. 拡張機能マーケットプレイスで「PlantUML」を検索
3. `PlantUML` (作者: jebbs) をインストール

### ステップ2: PlantUMLプレビュー

1. `/docs/pattern3-architecture.puml`を開く
2. `Alt+D`（Windows/Linux）または`Option+D`（Mac）でプレビュー表示
3. プレビューウィンドウが表示される

### ステップ3: PNGまたはSVGにエクスポート

1. コマンドパレットを開く（`Ctrl+Shift+P` / `Cmd+Shift+P`）
2. `PlantUML: Export Current Diagram`を選択
3. 出力形式を選択（PNG、SVG、PDFなど）
4. 保存先を指定

### ステップ4: draw.ioにインポート

1. エクスポートした画像をdraw.ioにインポート
2. 方法2と同様に背景として使用するか、参考にしてAWS公式アイコンを配置

---

## トラブルシューティング

### PlantUMLインポートがうまくいかない場合

**原因:** draw.ioのPlantUMLパーサーは、一部の複雑な構文に対応していない可能性があります。

**解決策:**
1. PlantUMLファイルを簡略化する
2. AWS公式アイコンの`!include`ディレクティブを削除
3. 基本的な構造のみをインポート
4. アイコンは手動で追加

### AWS公式アイコンが見つからない場合

**原因:** draw.ioのAWSアイコンライブラリのバージョンが古い可能性があります。

**解決策:**
1. `More Shapes...` → `AWS Architecture Icons`を再度追加
2. または、AWS公式サイトから最新のアイコンセット（PNG/SVG）をダウンロード
3. カスタムライブラリとしてdraw.ioに追加

### レイアウトが崩れる場合

**原因:** PlantUMLの自動レイアウトとdraw.ioのレイアウトは異なります。

**解決策:**
1. draw.ioの`Arrange` → `Layout` → `Hierarchical`を試す
2. または、手動で各コンポーネントを再配置
3. グリッドスナップ機能を有効化して整列を簡単に

---

## 推奨ワークフロー

初心者の方には以下のワークフローを推奨します:

### フェーズ1: 基本構造の作成（30分）
1. draw.io PlantUMLインポート機能を使用
2. 自動生成された四角形ボックスを確認
3. レイアウトを大まかに調整

### フェーズ2: AWS公式アイコンへの置き換え（60分）
1. AWS Architecture Iconsライブラリを追加
2. 主要コンポーネント（Lambda、S3、DynamoDB、OpenSearchなど）を優先的に置き換え
3. サイズと配置を統一

### フェーズ3: スタイリングと詳細調整（45分）
1. グループの背景色を設定
2. 接続線の色と太さを調整
3. ラベルとテキストを追加

### フェーズ4: 凡例と注釈の追加（30分）
1. 凡例ボックスを作成
2. コスト構成を記入
3. 主要な特徴と注釈を追加

### フェーズ5: 最終確認とエクスポート（15分）
1. 全体のバランスを確認
2. PNG、PDF、SVG形式でエクスポート
3. draw.io XML形式で保存（編集可能な形式）

**合計所要時間: 約3時間**

---

## まとめ

このガイドでは、PlantUMLからdraw.ioへの変換方法を3つ紹介しました:

1. **draw.io PlantUMLインポート機能**（最も簡単、推奨）
2. **PlantUML公式サーバー → PNG → draw.io**（中級者向け）
3. **VS Code拡張機能 → エクスポート → draw.io**（開発者向け）

いずれの方法でも、**AWS公式アイコンへの置き換えは手動**で行う必要がありますが、基本構造を自動生成できるため、ゼロから作成するよりも大幅に時間を節約できます。

ご不明な点があれば、お気軽にお問い合わせください。
