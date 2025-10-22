# CSV → draw.io インポートガイド

## 概要

このガイドでは、**CSV形式のコンポーネントリストと接続リスト**をdraw.ioにインポートし、アーキテクチャ図を自動生成する方法を説明します。

draw.ioの**CSV Import機能**を使用すると、大量のコンポーネントを一括で配置できます。

---

## 前提条件

### 必要なCSVファイル

以下の2つのCSVファイルを準備します:

1. **pattern3-components.csv** - コンポーネント一覧
2. **pattern3-connections.csv** - 接続関係一覧

このガイドでは、これらのCSVファイルを作成する手順も含めます。

---

## ステップ1: コンポーネントCSVの作成

### 1.1 CSVファイルのフォーマット

draw.ioのCSVインポート機能では、以下の列が必要です:

| 列名 | 説明 | 必須 |
|:---|:---|:---|
| `id` | 一意のコンポーネントID | ✅ 必須 |
| `label` | 表示ラベル | ✅ 必須 |
| `type` | コンポーネントタイプ | ❌ オプション |
| `category` | カテゴリ（グループ化用） | ❌ オプション |
| `description` | 詳細説明 | ❌ オプション |
| `style` | draw.ioスタイル定義 | ❌ オプション |

### 1.2 pattern3-components.csvの内容

以下の内容で`/docs/pattern3-components.csv`を作成します:

```csv
id,label,type,category,description,style
nas,NAS Server,storage,OnPremise,"SMB/NFS\n500GB\n1,000,000 files","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
dsAgent,DataSync Agent,agent,OnPremise,"増分検出エージェント\nversion: 1.0.52","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
vpnRouter,VPN Router,network,OnPremise,"Customer Gateway\nCisco ASA 5506","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
vpg,Virtual Private Gateway,network,AWS,"Site-to-Site VPN\n月4時間のみ接続\n2:00-6:00 (月1日)","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FF9900;strokeWidth=2;"
dataSync,AWS DataSync,transfer,AWS,"増分同期: 20GB/月\n転送レート: 100Mbps\n転送時間: 約3時間","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FF9900;strokeWidth=2;"
s3,S3 Bucket,storage,AWS,"Intelligent-Tiering\n100GB\n- 抽出テキスト: 40GB\n- 画像特徴量: 10GB\n- サムネイル: 30GB\n- ログ: 20GB","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#00AA00;strokeWidth=2;"
stepFunc,Step Functions,orchestration,AWS Batch,"MonthlyBatchSyncWorkflow\n実行頻度: 月1回\n実行時間: 5-6時間","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
vpnMgr,VPNManager,lambda,AWS Batch,"Python 3.11\n512MB ARM64\n- VPN接続制御\n- 接続監視","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
fileScanner,FileScanner,lambda,AWS Batch,"Node.js 20\n1024MB ARM64\n- S3全スキャン\n- メタデータ収集","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
textExt,TextExtractor,lambda,AWS Batch,"Python 3.11\n2048MB ARM64\n- PDF解析\n月5,000実行","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
imgExt,ImageFeatureExtractor,lambda,AWS Batch,"Python 3.11\n2048MB ARM64\n- ResNet-50\n月2,000実行","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
bulkIdx,BulkIndexer,lambda,AWS Batch,"Node.js 20\n1024MB ARM64\n- Bulk API\n- DynamoDB更新","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
searchAPI,SearchAPI,lambda,AWS,"Node.js 20\n512MB ARM64\nPOST /api/search\n月10,000実行","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#00AA00;strokeWidth=2;"
opensearch,OpenSearch Service,search,AWS,"t3.small.search\nvCPU: 2, RAM: 2GB\n50GB gp3\n- kuromoji (日本語)\n- k-NN (画像類似)","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#00AA00;strokeWidth=2;"
dynamodb,DynamoDB,database,AWS,"On-Demand\n- file_metadata: 5GB\n- sync_jobs: 100MB","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#00AA00;strokeWidth=2;"
eventBridge,EventBridge,orchestration,AWS,"cron(0 2 1 * ? *)\n毎月1日 深夜2時","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
sns,SNS,notification,AWS,"BatchNotifications\n管理者メール × 5","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0066CC;strokeWidth=2;"
cloudwatch,CloudWatch,monitoring,AWS,"Logs: 2GB/月\nMetrics: 10個\nAlarms: 5個","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#00BCD4;strokeWidth=2;"
user,ユーザー,user,User,"社内50名\nAzure AD SSO","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#00AA00;strokeWidth=2;"
nextjs,Next.js Frontend,frontend,User,"ECS Fargate\nvCPU: 0.25, RAM: 0.5GB\nTypeScript + Tailwind","rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#00AA00;strokeWidth=2;"
```

### 1.3 CSVファイルを保存

上記の内容を`/docs/pattern3-components.csv`として保存します。

---

## ステップ2: 接続関係CSVの作成

### 2.1 CSVファイルのフォーマット

接続関係を定義するCSVファイルには以下の列が必要です:

| 列名 | 説明 | 必須 |
|:---|:---|:---|
| `source` | 接続元のコンポーネントID | ✅ 必須 |
| `target` | 接続先のコンポーネントID | ✅ 必須 |
| `label` | 接続線のラベル | ❌ オプション |
| `flow` | フロータイプ（batch/transfer/search/vpn/monitor） | ❌ オプション |
| `style` | 接続線のスタイル | ❌ オプション |

### 2.2 pattern3-connections.csvの内容

以下の内容で`/docs/pattern3-connections.csv`を作成します:

```csv
source,target,label,flow,style
nas,dsAgent,,onprem,"endArrow=classic;html=1;strokeWidth=2;strokeColor=#0066CC;"
dsAgent,vpnRouter,,onprem,"endArrow=classic;html=1;strokeWidth=2;strokeColor=#0066CC;"
vpnRouter,vpg,VPN接続\n月4時間のみ\n暗号化通信,vpn,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;dashed=1;dashPattern=8 8;"
eventBridge,stepFunc,① 月1回トリガー,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
stepFunc,vpnMgr,② VPN接続開始,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
vpnMgr,vpg,③ VPN接続確立,batch,"endArrow=classic;html=1;strokeWidth=2;strokeColor=#0066CC;dashed=1;dashPattern=8 8;"
vpnMgr,dataSync,④ DataSync起動,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
vpg,dataSync,⑤ 増分データ転送\n20GB/月 3時間,transfer,"endArrow=classic;html=1;strokeWidth=4;strokeColor=#FF9900;"
dataSync,s3,,transfer,"endArrow=classic;html=1;strokeWidth=4;strokeColor=#FF9900;"
stepFunc,vpnMgr,⑥ VPN切断\n同期完了後,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
stepFunc,fileScanner,⑦ S3スキャン開始\nVPN切断後,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
fileScanner,s3,⑧ メタデータ取得,search,"endArrow=classic;startArrow=classic;html=1;strokeWidth=2;strokeColor=#00AA00;"
fileScanner,textExt,⑨ テキスト抽出\n5000 PDFs\n最大100並列,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
fileScanner,imgExt,⑨ 画像特徴抽出\n2000 Images\n最大50並列,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
textExt,s3,⑩ 抽出テキスト保存,search,"endArrow=classic;startArrow=classic;html=1;strokeWidth=2;strokeColor=#00AA00;"
imgExt,s3,⑩ 特徴ベクトル保存\n512次元,search,"endArrow=classic;startArrow=classic;html=1;strokeWidth=2;strokeColor=#00AA00;"
textExt,bulkIdx,⑪ 処理完了通知,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
imgExt,bulkIdx,⑪ 処理完了通知,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
bulkIdx,s3,⑫ 全データ取得,search,"endArrow=classic;html=1;strokeWidth=2;strokeColor=#00AA00;"
bulkIdx,opensearch,⑬ Bulk API\nkuromoji + k-NN\nバッチサイズ: 1000,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
bulkIdx,dynamodb,⑭ メタデータ更新\nBatchWriteItem,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
bulkIdx,sns,⑮ 完了通知\n成功/失敗ステータス,batch,"endArrow=classic;html=1;strokeWidth=3;strokeColor=#0066CC;"
user,nextjs,HTTPS\nAzure AD認証,search,"endArrow=classic;startArrow=classic;html=1;strokeWidth=2;strokeColor=#00AA00;"
nextjs,searchAPI,POST /api/search\n{query: '提案書'},search,"endArrow=classic;startArrow=classic;html=1;strokeWidth=2;strokeColor=#00AA00;"
searchAPI,opensearch,全文検索\nkuromoji tokenizer,search,"endArrow=classic;startArrow=classic;html=1;strokeWidth=2;strokeColor=#00AA00;"
searchAPI,dynamodb,GetItem\nfile_metadata,search,"endArrow=classic;startArrow=classic;html=1;strokeWidth=2;strokeColor=#00AA00;"
searchAPI,s3,GetObject\nハイライト用,search,"endArrow=classic;startArrow=classic;html=1;strokeWidth=2;strokeColor=#00AA00;"
vpnMgr,cloudwatch,Logs/Metrics,monitor,"endArrow=classic;html=1;strokeWidth=1;strokeColor=#00BCD4;dashed=1;dashPattern=2 4;"
fileScanner,cloudwatch,Logs/Metrics,monitor,"endArrow=classic;html=1;strokeWidth=1;strokeColor=#00BCD4;dashed=1;dashPattern=2 4;"
textExt,cloudwatch,Logs/Metrics,monitor,"endArrow=classic;html=1;strokeWidth=1;strokeColor=#00BCD4;dashed=1;dashPattern=2 4;"
imgExt,cloudwatch,Logs/Metrics,monitor,"endArrow=classic;html=1;strokeWidth=1;strokeColor=#00BCD4;dashed=1;dashPattern=2 4;"
bulkIdx,cloudwatch,Logs/Metrics,monitor,"endArrow=classic;html=1;strokeWidth=1;strokeColor=#00BCD4;dashed=1;dashPattern=2 4;"
searchAPI,cloudwatch,Logs/Metrics,monitor,"endArrow=classic;html=1;strokeWidth=1;strokeColor=#00BCD4;dashed=1;dashPattern=2 4;"
```

### 2.3 CSVファイルを保存

上記の内容を`/docs/pattern3-connections.csv`として保存します。

---

## ステップ3: draw.ioでCSVをインポート

### 3.1 draw.ioを開く

1. Webブラウザで https://app.diagrams.net/ にアクセス
2. `Device`または`Google Drive`を選択
3. `Create New Diagram`をクリック
4. `Blank Diagram`を選択して`Create`

### 3.2 CSVインポート機能にアクセス

1. メニューから`Arrange` → `Insert` → `Advanced` → `CSV...`を選択
   - または、キーボードショートカット: draw.ioには直接のショートカットはありません

### 3.3 コンポーネントCSVをインポート

1. CSVインポートダイアログが表示される
2. `/docs/pattern3-components.csv`の内容を**全てコピー**してダイアログに貼り付け
3. `Import`ボタンをクリック

#### インポート設定（重要）

draw.ioのCSVインポートダイアログでは、以下の設定を確認します:

| 設定項目 | 推奨値 |
|:---|:---|
| **Delimiter** | `,` (カンマ) |
| **First row is header** | ✅ チェック |
| **Create new page** | ❌ チェック解除 |
| **Use existing template** | ❌ チェック解除 |

### 3.4 インポート結果の確認

**期待される結果:**
- すべてのコンポーネントがキャンバスに配置される
- 各コンポーネントは四角形ボックスとして表示
- ラベルと説明が含まれる
- スタイル（色、枠線）が適用される

**注意:**
- CSVインポートでは**自動レイアウトは行われません**
- すべてのコンポーネントが重なって表示される可能性があります
- 次のステップで手動で配置します

---

## ステップ4: コンポーネントのレイアウト調整

### 4.1 自動レイアウトを試す

1. すべてのコンポーネントを選択（`Ctrl+A` / `Cmd+A`）
2. メニューから`Arrange` → `Layout` → `Horizontal Flow`または`Vertical Flow`を選択
3. レイアウトアルゴリズムが適用される

**推奨レイアウト:**
- `Hierarchical`: 階層構造に適している
- `Organic`: 自然な配置

### 4.2 手動レイアウト（推奨）

自動レイアウトでは理想的な配置にならない場合が多いため、手動で調整することを推奨します。

#### レイアウトガイド

| カテゴリ | 配置位置 | コンポーネント |
|:---|:---|:---|
| オンプレミス | 左側 (X: 50-450) | nas, dsAgent, vpnRouter |
| AWS Network | 中央上部 (X: 500-900, Y: 180-600) | vpg, dataSync, eventBridge |
| AWS Storage | 中央 (X: 500-900, Y: 700-1000) | s3, dynamodb |
| AWS Batch | 右側上部 (X: 900-1400, Y: 180-900) | stepFunc, vpnMgr, fileScanner, textExt, imgExt, bulkIdx |
| AWS API | 右側中央 (X: 1100-1400, Y: 600-900) | searchAPI, opensearch |
| AWS Monitoring | 右端 (X: 1450-1700, Y: 180-600) | sns, cloudwatch |
| User Layer | 左下 (X: 50-450, Y: 1100-1500) | user, nextjs |

#### グリッドスナップを有効化

1. メニューから`View` → `Grid`をチェック
2. `View` → `Snap to Grid`をチェック
3. グリッドサイズ: `10px`（デフォルト）

### 4.3 グループの作成

各カテゴリごとにグループ化します。

#### オンプレミス環境グループ

1. 左サイドバーから`Rectangle`を選択
2. オンプレミスコンポーネントを囲むようにドラッグ
3. 右クリック → `To Back`（背面に移動）
4. スタイル設定:
   - Fill: `#F5F5F5`
   - Stroke: `#666666`
   - Stroke Width: `3pt`
5. ラベルを追加: `オンプレミス環境`

#### AWS Cloudグループ

1. 同様にRectangleを作成
2. AWSコンポーネント全体を囲む
3. スタイル設定:
   - Fill: `#FFF7E6`
   - Stroke: `#FF9900`
   - Stroke Width: `3pt`
4. ラベルを追加: `AWS Cloud (ap-northeast-1)`

#### バッチ処理層グループ

1. Rectangleを作成
2. Lambda関数とStep Functionsを囲む
3. スタイル設定:
   - Fill: `#FFFDE7`
   - Stroke: `#FBC02D`
   - Stroke Width: `2pt`
4. ラベルを追加: `バッチ処理層`

---

## ステップ5: 接続線の追加

draw.ioのCSVインポート機能では、**接続線を直接インポートすることはできません**。そのため、以下の2つの方法があります:

### 方法A: 手動で接続線を追加（推奨）

1. 左サイドバーから`Connector`ツールを選択
2. `/docs/pattern3-connections.csv`を参照しながら、各コンポーネントを接続
3. 接続線のスタイルを設定:
   - 右サイドバーの`Line`で色を設定
   - `Line Width`で太さを設定
   - `Dashed`や`Dotted`でスタイルを設定
4. 接続線をダブルクリックしてラベルを追加

### 方法B: draw.ioのスクリプト機能を使用（上級者向け）

draw.ioには、JavaScriptを使って自動的に接続線を追加する機能があります。

#### スクリプト例

1. メニューから`Extras` → `Edit Diagram...`を選択
2. XMLエディタが表示される
3. 以下のスクリプトを追加（高度な操作のため省略）

---

## ステップ6: AWS公式アイコンへの置き換え

### 6.1 AWS公式アイコンライブラリを追加

1. 左サイドバーの`More Shapes...`をクリック
2. `AWS Architecture Icons`をチェック
3. `Apply`をクリック

### 6.2 四角形ボックスをAWS公式アイコンに置き換え

| コンポーネントID | AWS公式アイコン | カテゴリ |
|:---|:---|:---|
| vpg | AWS Site-to-Site VPN | Networking & Content Delivery |
| dataSync | AWS DataSync | Migration & Transfer |
| s3 | Amazon S3 | Storage |
| stepFunc | AWS Step Functions | Application Integration |
| vpnMgr | AWS Lambda | Compute |
| fileScanner | AWS Lambda | Compute |
| textExt | AWS Lambda | Compute |
| imgExt | AWS Lambda | Compute |
| bulkIdx | AWS Lambda | Compute |
| searchAPI | AWS Lambda | Compute |
| opensearch | Amazon OpenSearch Service | Analytics |
| dynamodb | Amazon DynamoDB | Database |
| eventBridge | Amazon EventBridge | Application Integration |
| sns | Amazon SNS | Application Integration |
| cloudwatch | Amazon CloudWatch | Management & Governance |
| nextjs | Amazon ECS | Containers |

#### 置き換え手順

1. 置き換えたい四角形ボックスをクリック
2. 左サイドバーからAWS公式アイコンを探す
3. アイコンをドラッグ&ドロップしてボックスの位置に配置
4. 古いボックスを削除
5. アイコンの下にテキストボックスを追加してラベルを記入

---

## ステップ7: 凡例と注釈の追加

### 7.1 凡例ボックスの作成

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
```

4. スタイル設定:
   - Fill: `#FFFFFF`
   - Stroke: `#666666`
   - Font Size: `11pt`

---

## ステップ8: エクスポート

完成した図をエクスポートします。

### PNG形式

1. `File` → `Export as` → `PNG...`
2. 設定:
   - Zoom: `100%`
   - Border Width: `10px`
   - Transparent Background: オフ
3. `Export`をクリック

### PDF形式

1. `File` → `Export as` → `PDF...`
2. 設定:
   - Page View: オン
   - Fit to: `1 page`
3. `Export`をクリック

### draw.io XML形式（編集可能）

1. `File` → `Save as...`
2. ファイル名: `pattern3-architecture.drawio`
3. `Save`をクリック

---

## トラブルシューティング

### CSVインポートができない

**原因:** CSVファイルのフォーマットが正しくない可能性があります。

**解決策:**
1. CSVファイルの文字コードを`UTF-8`に変更
2. 区切り文字が`,`（カンマ）であることを確認
3. 各行が正しくクォートされているか確認

### コンポーネントが重なって表示される

**原因:** CSVインポートでは座標情報がないため、デフォルト位置に配置されます。

**解決策:**
1. 自動レイアウト機能を使用
2. または、手動で各コンポーネントを移動

### スタイルが適用されない

**原因:** `style`列の記述が正しくない可能性があります。

**解決策:**
1. draw.ioのスタイル記法を確認
2. セミコロン`;`で区切られているか確認
3. 色コードが正しいか確認（例: `#0066CC`）

---

## まとめ

このガイドでは、CSVファイルを使用してdraw.ioにアーキテクチャ図をインポートする方法を説明しました。

**主なメリット:**
- 大量のコンポーネントを一括で配置できる
- データベースや他のツールから自動生成したCSVを使用できる
- バージョン管理が容易（CSVはテキストファイル）

**主なデメリット:**
- 接続線は手動で追加する必要がある
- レイアウトは手動調整が必要
- AWS公式アイコンへの置き換えは手動

**推奨ワークフロー:**
1. CSVでコンポーネントを一括インポート（10分）
2. レイアウトを手動調整（30分）
3. 接続線を手動で追加（45分）
4. AWS公式アイコンに置き換え（60分）
5. 凡例と注釈を追加（30分）

**合計所要時間: 約3時間**

ご不明な点があれば、お気軽にお問い合わせください。
