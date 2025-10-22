# PlantUML → draw.io 変換ツールガイド

## 概要

このガイドでは、PlantUMLファイルをdraw.io形式に変換するための**オンライン変換ツール**と**デスクトップツール**の使用方法を説明します。

---

## 目次

1. [PlantUML公式オンラインサーバー](#1-plantuml公式オンラインサーバー)
2. [PlantText - オンラインPlantUMLエディタ](#2-planttext---オンラインplantumlエディタ)
3. [VS Code拡張機能](#3-vs-code拡張機能)
4. [Atomエディタプラグイン](#4-atomエディタプラグイン)
5. [IntelliJ IDEA / PyCharmプラグイン](#5-intellij-idea--pycharmプラグイン)
6. [draw.io Desktop版でのPlantUMLサポート](#6-drawio-desktop版でのplantumlサポート)
7. [コマンドライン変換ツール](#7-コマンドライン変換ツール)

---

## 1. PlantUML公式オンラインサーバー

### 概要

PlantUML公式が提供するオンラインレンダリングサービスです。最もシンプルで、インストール不要で使用できます。

### URL

- **公式サーバー**: http://www.plantuml.com/plantuml/uml/
- **代替サーバー（高速）**: https://plantuml-server.kkeisuke.dev/

### 使用方法

#### ステップ1: PlantUMLコードを貼り付け

1. http://www.plantuml.com/plantuml/uml/ にアクセス
2. テキストエリアに`/docs/pattern3-architecture.puml`の内容を**全てコピー**して貼り付け
3. `Submit`ボタンをクリック

#### ステップ2: 画像を生成

**生成される画像フォーマット:**
- PNG（デフォルト）
- SVG（ベクター形式、推奨）
- ASCII Art（テキスト形式）
- LaTeX（文書埋め込み用）

#### ステップ3: 画像をダウンロード

1. 生成された画像を右クリック
2. `名前を付けて画像を保存...`を選択
3. ファイル名: `pattern3-architecture.png`または`pattern3-architecture.svg`

#### ステップ4: draw.ioに挿入

1. draw.ioで新しい図を作成
2. `File` → `Import from` → `Image...`を選択
3. ダウンロードした画像を選択
4. `Import`をクリック

**使用シナリオ:**
- 画像を**背景として**使用し、その上にAWS公式アイコンを配置
- または、参考資料として別ウィンドウで開きながらdraw.ioで再作成

### メリット・デメリット

| メリット | デメリット |
|:---|:---|
| ✅ インストール不要 | ❌ 編集可能な形式ではない（画像のみ） |
| ✅ 高速 | ❌ AWS公式アイコンは含まれない |
| ✅ SVG形式に対応 | ❌ draw.ioで直接編集不可 |
| ✅ 無料 | ❌ オンライン環境が必要 |

---

## 2. PlantText - オンラインPlantUMLエディタ

### 概要

PlantTextは、**リアルタイムプレビュー**機能を持つオンラインPlantUMLエディタです。

### URL

- https://www.planttext.com/

### 使用方法

#### ステップ1: PlantTextを開く

1. https://www.planttext.com/ にアクセス
2. 左側のテキストエディタに`/docs/pattern3-architecture.puml`の内容を貼り付け

#### ステップ2: リアルタイムプレビュー

- 右側にリアルタイムでPlantUML図が表示されます
- エラーがある場合は赤色で表示されます

#### ステップ3: エクスポート

1. 右上の`Export`ボタンをクリック
2. 以下のフォーマットを選択:
   - **PNG**: ラスター画像
   - **SVG**: ベクター画像（推奨）
   - **LaTeX**: 文書埋め込み用
   - **ASCII**: テキスト形式

#### ステップ4: draw.ioに挿入

PlantUML公式サーバーと同じ手順で、画像をdraw.ioにインポートします。

### メリット・デメリット

| メリット | デメリット |
|:---|:---|
| ✅ リアルタイムプレビュー | ❌ 編集可能な形式ではない |
| ✅ エラー検出機能 | ❌ AWS公式アイコンは含まれない |
| ✅ 複数のエクスポート形式 | ❌ draw.ioで直接編集不可 |
| ✅ 無料 | ❌ オンライン環境が必要 |

---

## 3. VS Code拡張機能

### 概要

Visual Studio Codeには、**PlantUML拡張機能**があります。ローカル環境でPlantUMLを編集・プレビュー・エクスポートできます。

### インストール

#### ステップ1: VS Codeを開く

1. Visual Studio Codeを起動
2. 拡張機能マーケットプレイスを開く（`Ctrl+Shift+X` / `Cmd+Shift+X`）

#### ステップ2: PlantUML拡張機能をインストール

1. 検索ボックスに「PlantUML」と入力
2. `PlantUML`（作者: jebbs）を選択
3. `Install`ボタンをクリック

#### ステップ3: Graphvizのインストール（必須）

PlantUML拡張機能は、**Graphviz**を必要とします。

**macOS:**
```bash
brew install graphviz
```

**Windows:**
1. https://graphviz.org/download/ からインストーラーをダウンロード
2. インストール後、環境変数`PATH`に追加

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install graphviz
```

### 使用方法

#### ステップ1: PlantUMLファイルを開く

1. VS Codeで`/docs/pattern3-architecture.puml`を開く

#### ステップ2: プレビュー表示

1. `Alt+D`（Windows/Linux）または`Option+D`（Mac）を押す
2. または、コマンドパレット（`Ctrl+Shift+P` / `Cmd+Shift+P`）から`PlantUML: Preview Current Diagram`を実行
3. 右側にプレビューウィンドウが表示される

#### ステップ3: エクスポート

1. コマンドパレットを開く（`Ctrl+Shift+P` / `Cmd+Shift+P`）
2. `PlantUML: Export Current Diagram`を実行
3. 出力形式を選択:
   - **PNG**: ラスター画像
   - **SVG**: ベクター画像（推奨）
   - **PDF**: 文書用
   - **EPS**: 印刷用
4. 保存先を指定

#### ステップ4: draw.ioに挿入

エクスポートした画像をdraw.ioにインポートします。

### メリット・デメリット

| メリット | デメリット |
|:---|:---|
| ✅ ローカル環境で動作 | ❌ Graphvizのインストールが必要 |
| ✅ リアルタイムプレビュー | ❌ 編集可能な形式ではない |
| ✅ 複数のエクスポート形式 | ❌ AWS公式アイコンは含まれない |
| ✅ シンタックスハイライト | ❌ draw.ioで直接編集不可 |
| ✅ 無料 | |

---

## 4. Atomエディタプラグイン

### 概要

Atomエディタには、**PlantUMLプレビュー**プラグインがあります。

### インストール

1. Atomを開く
2. `Settings` → `Install`
3. 検索ボックスに「plantuml-preview」と入力
4. `plantuml-preview`パッケージをインストール

### 使用方法

1. Atomで`/docs/pattern3-architecture.puml`を開く
2. `Ctrl+Alt+P`（Windows/Linux）または`Cmd+Alt+P`（Mac）でプレビュー表示
3. 右クリック → `Export as PNG/SVG`

### メリット・デメリット

VS Code拡張機能と同様です。

---

## 5. IntelliJ IDEA / PyCharmプラグイン

### 概要

JetBrains IDEには、**PlantUMLプラグイン**があります。

### インストール

1. IntelliJ IDEAまたはPyCharmを開く
2. `Settings` → `Plugins`
3. 検索ボックスに「PlantUML integration」と入力
4. `PlantUML integration`をインストール
5. IDEを再起動

### 使用方法

1. IDEで`/docs/pattern3-architecture.puml`を開く
2. 右側にプレビューウィンドウが自動表示
3. プレビューウィンドウ上で右クリック → `Export...`
4. 出力形式を選択（PNG、SVG、PDF、EPS）

### メリット・デメリット

VS Code拡張機能と同様です。

---

## 6. draw.io Desktop版でのPlantUMLサポート

### 概要

draw.io Desktop版（旧diagrams.net Desktop）には、**PlantUMLインポート機能**が組み込まれています。

### インストール

1. https://github.com/jgraph/drawio-desktop/releases から最新版をダウンロード
2. インストーラーを実行

### 使用方法

#### ステップ1: draw.io Desktopを開く

1. draw.io Desktopを起動
2. `Create New Diagram`をクリック

#### ステップ2: PlantUMLインポート

1. メニューから`Arrange` → `Insert` → `Advanced` → `PlantUML...`を選択
2. `/docs/pattern3-architecture.puml`の内容を貼り付け
3. `Insert`をクリック

#### ステップ3: 自動生成された図の編集

- draw.io Desktop版では、PlantUMLを**draw.io図として**インポートします
- 各コンポーネントが編集可能なオブジェクトとして生成されます
- AWS公式アイコンへの置き換えが可能

### メリット・デメリット

| メリット | デメリット |
|:---|:---|
| ✅ draw.io図として編集可能 | ❌ デスクトップアプリのインストールが必要 |
| ✅ AWS公式アイコンへの置き換えが容易 | ❌ 一部の複雑な構文に対応していない |
| ✅ オフラインで動作 | ❌ PlantUMLの高度な機能は制限される |
| ✅ 無料 | |

**推奨度: ★★★★★**（最も実用的）

---

## 7. コマンドライン変換ツール

### 概要

PlantUML公式は、**Java製のコマンドラインツール**を提供しています。バッチ処理に適しています。

### インストール

#### 前提条件

- Java Runtime Environment (JRE) 8以降
- Graphviz（ダイアグラムによっては必要）

#### PlantUML JARのダウンロード

```bash
# 最新版をダウンロード
curl -L -o plantuml.jar https://github.com/plantuml/plantuml/releases/download/v1.2024.8/plantuml-1.2024.8.jar
```

または、公式サイトから手動ダウンロード:
- https://plantuml.com/download

### 使用方法

#### ステップ1: PNG形式で出力

```bash
java -jar plantuml.jar /path/to/pattern3-architecture.puml
```

出力: `/path/to/pattern3-architecture.png`

#### ステップ2: SVG形式で出力

```bash
java -jar plantuml.jar -tsvg /path/to/pattern3-architecture.puml
```

出力: `/path/to/pattern3-architecture.svg`

#### ステップ3: 複数ファイルを一括変換

```bash
java -jar plantuml.jar /path/to/docs/*.puml
```

#### ステップ4: 高解像度PNG出力

```bash
java -jar plantuml.jar -Sdpi=300 /path/to/pattern3-architecture.puml
```

### メリット・デメリット

| メリット | デメリット |
|:---|:---|
| ✅ バッチ処理に最適 | ❌ Javaのインストールが必要 |
| ✅ CI/CDパイプラインに統合可能 | ❌ 編集可能な形式ではない |
| ✅ スクリプト化可能 | ❌ GUIがない |
| ✅ 高速 | ❌ draw.ioで直接編集不可 |
| ✅ 無料 | |

### 実用例: CIパイプラインでの自動生成

#### GitHub Actions

```yaml
name: Generate Architecture Diagrams

on:
  push:
    paths:
      - 'docs/*.puml'

jobs:
  generate-diagrams:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Java
        uses: actions/setup-java@v3
        with:
          java-version: '11'
          distribution: 'temurin'

      - name: Install Graphviz
        run: sudo apt-get install -y graphviz

      - name: Download PlantUML
        run: |
          curl -L -o plantuml.jar https://github.com/plantuml/plantuml/releases/download/v1.2024.8/plantuml-1.2024.8.jar

      - name: Generate diagrams
        run: |
          java -jar plantuml.jar -tsvg docs/*.puml
          java -jar plantuml.jar -tpng docs/*.puml

      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: architecture-diagrams
          path: |
            docs/*.svg
            docs/*.png
```

---

## 比較表: どのツールを選ぶべきか?

| ツール | 難易度 | 速度 | 編集可能 | オフライン | 推奨度 |
|:---|:---|:---|:---|:---|:---|
| PlantUML公式サーバー | ★☆☆☆☆ | ★★★★★ | ❌ | ❌ | ★★★☆☆ |
| PlantText | ★☆☆☆☆ | ★★★★☆ | ❌ | ❌ | ★★☆☆☆ |
| VS Code拡張機能 | ★★☆☆☆ | ★★★★☆ | ❌ | ✅ | ★★★★☆ |
| Atom | ★★☆☆☆ | ★★★☆☆ | ❌ | ✅ | ★★☆☆☆ |
| IntelliJ/PyCharm | ★★☆☆☆ | ★★★★☆ | ❌ | ✅ | ★★★☆☆ |
| draw.io Desktop | ★★★☆☆ | ★★★☆☆ | ✅ | ✅ | ★★★★★ |
| コマンドライン | ★★★★☆ | ★★★★★ | ❌ | ✅ | ★★★☆☆ |

---

## 推奨ワークフロー

### 初心者向け

1. **PlantUML公式サーバー**でPNG/SVG生成（5分）
2. draw.ioに画像をインポート（2分）
3. AWS公式アイコンへ置き換え（60分）
4. 凡例と注釈を追加（30分）

**合計: 約2時間**

### 中級者向け

1. **VS Code拡張機能**でSVG生成（10分）
2. draw.ioに画像をインポート（2分）
3. AWS公式アイコンへ置き換え（45分）
4. 凡例と注釈を追加（30分）

**合計: 約1.5時間**

### 上級者向け

1. **draw.io Desktop**でPlantUMLを直接インポート（5分）
2. 自動生成された図をレイアウト調整（30分）
3. AWS公式アイコンへ置き換え（45分）
4. 凡例と注釈を追加（30分）

**合計: 約2時間**

**最も推奨: draw.io Desktop + PlantUMLインポート**

---

## まとめ

このガイドでは、PlantUMLをdraw.ioで使用するための7つのツールを紹介しました。

**最も実用的なアプローチ:**
1. **draw.io Desktop版のPlantUMLインポート機能**（編集可能な形式で生成）
2. **VS Code拡張機能**（ローカル環境で高品質なSVG生成）
3. **PlantUML公式サーバー**（最もシンプル）

いずれの方法でも、**AWS公式アイコンへの置き換えは手動**で行う必要がありますが、基本構造を自動生成できるため、ゼロから作成するよりも大幅に時間を節約できます。

ご不明な点があれば、お気軽にお問い合わせください。
