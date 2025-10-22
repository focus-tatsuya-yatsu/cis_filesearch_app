# Pattern 3 アーキテクチャ図 - draw.io ステップバイステップ作成手順書

このガイドに従えば、初心者でも**30-40分**でPattern 3アーキテクチャ図を完成させることができます。

---

## 📋 事前準備

### 必要なもの
- ✅ Webブラウザ (Chrome, Firefox, Edge推奨)
- ✅ インターネット接続
- ✅ `/docs/pattern3-components.csv` (コンポーネントリスト)
- ✅ `/docs/pattern3-connections.csv` (接続リスト)
- ✅ `/docs/pattern3-drawio-guide.md` (詳細ガイド)

### 推奨環境
- 画面解像度: 1920×1080以上
- 作業時間: 30-40分
- マウスまたはトラックパッド

---

## ステップ1: draw.ioを開く（2分）

### 1-1. draw.ioにアクセス

1. ブラウザで https://app.diagrams.net/ にアクセス
2. 「**Create New Diagram**」ボタンをクリック

![draw.io トップページ](https://via.placeholder.com/800x450/FFFFFF/000000?text=draw.io+Top+Page)

### 1-2. 新規ダイアグラム作成

1. 「**Blank Diagram**」を選択
2. ファイル名を入力: `CIS_Pattern3_Architecture`
3. 「**Create**」をクリック

![新規ダイアグラム作成](https://via.placeholder.com/600x400/FFFFFF/000000?text=Create+New+Diagram)

### 1-3. キャンバス設定

1. メニューバーから「**File → Page Setup**」を選択
2. 以下を設定:
   - **Paper Size**: A3
   - **Orientation**: Landscape (横向き)
   - **Width**: 2000 px
   - **Height**: 1600 px
3. 「**Apply**」をクリック

---

## ステップ2: AWS公式アイコンライブラリを追加（3分）

### 2-1. ライブラリパネルを開く

1. 左サイドバーの最下部にある「**More Shapes...**」をクリック

![More Shapes](https://via.placeholder.com/300x500/F5F5F5/000000?text=More+Shapes+Button)

### 2-2. AWSライブラリを検索

1. 検索ボックスに「**AWS**」と入力
2. 以下のライブラリにチェック:
   - ✅ **AWS Architecture Icons**
   - ✅ **AWS 19** (最新版)
3. 「**Apply**」をクリック

![AWS Library Selection](https://via.placeholder.com/600x400/FFFFFF/000000?text=AWS+Library+Selection)

### 2-3. アイコンの確認

左サイドバーに「**AWS**」カテゴリが追加されたことを確認:
- Compute (Lambda等)
- Storage (S3等)
- Database (DynamoDB等)
- Analytics (OpenSearch等)
- Networking & Content Delivery (VPN等)
- など

---

## ステップ3: レイヤーを設定（5分）

### 3-1. レイヤーパネルを表示

1. メニューバーから「**View → Layers**」を選択
2. または、右サイドバーの「**Layers**」タブをクリック

### 3-2. レイヤーを追加

レイヤーパネル下部の「**+**」ボタンをクリックして、以下の4つのレイヤーを作成:

1. **Background & Containers**
   - 用途: 背景とVPC枠
   - ロック: Yes（作成後）

2. **AWS Resources**
   - 用途: AWSサービスアイコン
   - ロック: No

3. **Connections & Flows**
   - 用途: 接続線（矢印）
   - ロック: No

4. **Labels & Annotations**
   - 用途: ラベル、凡例、注釈
   - ロック: No

![Layers Panel](https://via.placeholder.com/300x400/FFFFFF/000000?text=Layers+Panel)

### 3-3. 現在のレイヤーを設定

「**Background & Containers**」レイヤーをアクティブにする（太字表示）

---

## ステップ4: 背景とVPC枠を作成（8分）

### 4-1. オンプレミス環境の背景を作成

1. 左サイドバーから「**General**」→「**Rectangle**」を選択
2. キャンバス左側にドラッグ&ドロップ
3. 右クリック → 「**Edit Style**」で以下を設定:

```
fillColor=#F5F5F5;
strokeColor=#CCCCCC;
strokeWidth=2;
fontSize=16;
fontStyle=1;
```

4. サイズと位置を設定（右サイドバーのプロパティパネル）:
   - **Position**: X=50, Y=150
   - **Size**: W=400, H=800

5. ダブルクリックしてラベルを入力:
```
オンプレミス環境
On-Premise Infrastructure
```

![オンプレミス背景](https://via.placeholder.com/400x800/F5F5F5/000000?text=On-Premise+Background)

### 4-2. AWS VPCの背景を作成

1. 再度「**Rectangle**」を選択
2. キャンバス右側にドラッグ&ドロップ
3. 右クリック → 「**Edit Style**」で以下を設定:

```
fillColor=#FFF7E6;
strokeColor=#FF9800;
strokeWidth=3;
fontSize=18;
fontStyle=1;
```

4. サイズと位置を設定:
   - **Position**: X=520, Y=150
   - **Size**: W=1400, H=1400

5. ラベルを入力:
```
AWS VPC (10.0.0.0/16)
Region: ap-northeast-1
```

![AWS VPC背景](https://via.placeholder.com/1400x1400/FFF7E6/000000?text=AWS+VPC+Background)

### 4-3. Lambda群のグループ枠を作成

1. VPC背景内に小さな「**Rectangle**」を追加
2. スタイル設定:

```
fillColor=#FFFDE7;
strokeColor=#FBC02D;
strokeWidth=2;
dashed=1;
dashPattern=5 5;
fontSize=12;
fontStyle=1;
```

3. サイズと位置:
   - **Position**: X=600, Y=650
   - **Size**: W=1200, H=250

4. ラベル:
```
Lambda Functions (ARM64 Graviton2)
```

### 4-4. 背景レイヤーをロック

1. レイヤーパネルで「**Background & Containers**」の横の🔒アイコンをクリック
2. 誤操作を防止するためロック状態にする

---

## ステップ5: AWSコンポーネントを配置（12分）

### 現在のレイヤーを変更

レイヤーパネルで「**AWS Resources**」をアクティブにする

### 5-1. オンプレミスコンポーネント

#### NAS Server

1. 左サイドバー → 「**AWS**」→「**General**」→「**Traditional Server**」を選択
2. オンプレミス背景内にドラッグ (X=150, Y=220)
3. サイズ: 100px × 100px
4. ダブルクリックしてラベル入力:

```
🗄️ NAS Server
SMB/NFS共有
容量: 500GB
ファイル数: 1,000,000
IP: 192.168.1.100
```

5. 右クリック → 「**Edit Style**」:
```
fillColor=#E3F2FD;
strokeColor=#1976D2;
strokeWidth=2;
fontSize=10;
```

#### DataSync Agent

1. 「**AWS**」→「**Migration & Transfer**」→「**DataSync Agent**」を選択
2. 配置: X=150, Y=380
3. サイズ: 80px × 80px
4. ラベル:

```
📡 DataSync Agent
増分検出エージェント
version: 1.0.52
```

5. スタイル:
```
fillColor=#FFF3E0;
strokeColor=#F57C00;
fontSize=10;
```

#### VPN Router (Customer Gateway)

1. 「**AWS**」→「**Networking & Content Delivery**」→「**Customer Gateway**」を選択
2. 配置: X=150, Y=540
3. サイズ: 80px × 80px
4. ラベル:

```
🔒 VPN Router
Customer Gateway
Cisco ASA 5506
Public IP: xxx.xxx.xxx.xxx
```

5. スタイル:
```
fillColor=#F3E5F5;
strokeColor=#7B1FA2;
fontSize=10;
```

---

### 5-2. AWSネットワーク層

#### Virtual Private Gateway

1. 「**AWS**」→「**Networking & Content Delivery**」→「**Virtual Private Gateway**」を選択
2. VPC背景内に配置: X=600, Y=250
3. サイズ: 80px × 80px
4. ラベル:

```
🌐 Virtual Private Gateway
Site-to-Site VPN
⏰ 月4時間のみ接続
接続時間: 2:00-6:00 (月1日)
```

5. スタイル:
```
fillColor=#E8EAF6;
strokeColor=#3F51B5;
fontSize=10;
```

---

### 5-3. データ転送層

#### AWS DataSync

1. 「**AWS**」→「**Migration & Transfer**」→「**DataSync**」を選択
2. 配置: X=850, Y=250
3. サイズ: 80px × 80px
4. ラベル:

```
📦 AWS DataSync
増分同期: 20GB/月
転送レート: 100Mbps
転送時間: 約3時間
フィルター: 変更ファイルのみ
```

5. スタイル:
```
fillColor=#E0F2F1;
strokeColor=#00897B;
fontSize=10;
```

---

### 5-4. ストレージ層

#### S3 Bucket

1. 「**AWS**」→「**Storage**」→「**Simple Storage Service (S3)**」を選択
2. 配置: X=1150, Y=250
3. サイズ: 100px × 100px（やや大きめ）
4. ラベル:

```
🪣 S3 Bucket
cis-filesearch-metadata
Intelligent-Tiering

容量内訳:
- 抽出テキスト: 40GB
- 画像特徴量: 10GB
- サムネイル: 30GB
- ログ: 20GB
合計: 100GB
```

5. スタイル:
```
fillColor=#FF9800;
strokeColor=#E65100;
strokeWidth=2;
fontSize=9;
fontColor=#FFFFFF;
fontStyle=1;
```

---

### 5-5. バッチ処理層

#### Step Functions

1. 「**AWS**」→「**Application Integration**」→「**Step Functions**」を選択
2. 配置: X=700, Y=500
3. サイズ: 100px × 100px
4. ラベル:

```
⚙️ Step Functions
MonthlyBatchSyncWorkflow

実行頻度: 月1回
実行時間: 5-6時間
ステップ数: 8
```

5. スタイル:
```
fillColor=#FFF9C4;
strokeColor=#F9A825;
fontSize=10;
fontStyle=1;
```

#### Lambda関数（5つ）

すべてのLambda関数に共通スタイル:
```
fillColor=#9C27B0;
strokeColor=#4A148C;
fontSize=9;
fontColor=#FFFFFF;
fontStyle=1;
```

**1. VPNManager Lambda**
- アイコン: 「**AWS**」→「**Compute**」→「**Lambda**」
- 配置: X=650, Y=700
- サイズ: 70px × 70px
- ラベル:
```
λ VPNManager
Runtime: Python 3.11
Memory: 512MB
ARM64

機能:
- VPN接続制御
- 接続監視
- タイムアウト管理
```

**2. FileScanner Lambda**
- 配置: X=800, Y=700
- サイズ: 70px × 70px
- ラベル:
```
λ FileScanner
Runtime: Node.js 20
Memory: 1024MB
ARM64

機能:
- S3全スキャン
- 新規/更新検出
- メタデータ収集
```

**3. TextExtractor Lambda**
- 配置: X=950, Y=700
- サイズ: 70px × 70px
- ラベル:
```
λ TextExtractor
Runtime: Python 3.11
Memory: 2048MB
ARM64

機能:
- PDF解析 (pdf-parse)
- Docuworks解析
- 月5,000実行
```

**4. ImageFeatureExtractor Lambda**
- 配置: X=1100, Y=700
- サイズ: 70px × 70px
- ラベル:
```
λ ImageFeatureExtractor
Runtime: Python 3.11
Memory: 2048MB
ARM64

機能:
- ResNet-50推論
- 512次元特徴量
- 月2,000実行
```

**5. BulkIndexer Lambda**
- 配置: X=1250, Y=700
- サイズ: 70px × 70px
- ラベル:
```
λ BulkIndexer
Runtime: Node.js 20
Memory: 1024MB
ARM64

機能:
- OpenSearch Bulk API
- DynamoDB一括更新
- エラーハンドリング
```

---

### 5-6. API層

#### SearchAPI Lambda

1. 「**Lambda**」を選択
2. 配置: X=1550, Y=250
3. サイズ: 80px × 80px
4. ラベル:

```
λ SearchAPI
Runtime: Node.js 20
Memory: 512MB
ARM64

エンドポイント:
POST /api/search

月10,000実行
```

5. スタイル:
```
fillColor=#9C27B0;
strokeColor=#4A148C;
fontSize=9;
fontColor=#FFFFFF;
```

---

### 5-7. 検索エンジン層

#### OpenSearch Service

1. 「**AWS**」→「**Analytics**」→「**OpenSearch Service**」を選択
2. 配置: X=1550, Y=450
3. サイズ: 100px × 100px
4. ラベル:

```
🔍 OpenSearch Service
Instance: t3.small.search
vCPU: 2, RAM: 2GB
Storage: 50GB gp3

Plugins:
- analysis-kuromoji (日本語)
- k-NN (画像類似検索)

Index:
- files_index (1M docs)

検索方式:
- 全文検索 (形態素解析)
- ベクトル検索 (HNSW)
```

5. スタイル:
```
fillColor=#4CAF50;
strokeColor=#1B5E20;
fontSize=9;
fontColor=#FFFFFF;
fontStyle=1;
```

---

### 5-8. メタデータDB層

#### DynamoDB

1. 「**AWS**」→「**Database**」→「**DynamoDB**」を選択
2. 配置: X=1550, Y=700
3. サイズ: 80px × 80px
4. ラベル:

```
🗂️ DynamoDB
Pricing: On-Demand

Tables:
- file_metadata (5GB)
- sync_jobs (100MB)

Read: 100 RCU/月
Write: 50 WCU/月
```

5. スタイル:
```
fillColor=#2196F3;
strokeColor=#0D47A1;
fontSize=9;
fontColor=#FFFFFF;
```

---

### 5-9. オーケストレーション層

#### EventBridge

1. 「**AWS**」→「**Application Integration**」→「**EventBridge**」を選択
2. 配置: X=650, Y=1000
3. サイズ: 80px × 80px
4. ラベル:

```
⏰ EventBridge
Rule: MonthlyBatchTrigger

Cron式:
cron(0 2 1 * ? *)

実行日時:
毎月1日 深夜2時 (JST)
```

5. スタイル:
```
fillColor=#FF5722;
strokeColor=#BF360C;
fontSize=9;
fontColor=#FFFFFF;
```

#### SNS

1. 「**AWS**」→「**Application Integration**」→「**Simple Notification Service**」を選択
2. 配置: X=850, Y=1000
3. サイズ: 80px × 80px
4. ラベル:

```
📧 Amazon SNS
Topic: BatchNotifications

Subscribers:
- 管理者メール × 5

通知内容:
- バッチ成功/失敗
- 処理時間
- エラー詳細
```

5. スタイル:
```
fillColor=#E91E63;
strokeColor=#880E4F;
fontSize=9;
fontColor=#FFFFFF;
```

---

### 5-10. 監視層

#### CloudWatch

1. 「**AWS**」→「**Management & Governance**」→「**CloudWatch**」を選択
2. 配置: X=1050, Y=1000
3. サイズ: 80px × 80px
4. ラベル:

```
📊 CloudWatch

Logs:
- /aws/lambda/* (6ロググループ)
- 保存期間: 30日
- 容量: 2GB/月

Metrics:
- Lambda実行時間
- VPN接続ステータス
- OpenSearchレイテンシ

Alarms:
- バッチ失敗
- VPN接続失敗
- ディスク使用率 > 80%
```

5. スタイル:
```
fillColor=#00BCD4;
strokeColor=#006064;
fontSize=9;
fontColor=#FFFFFF;
```

---

### 5-11. ユーザー層

#### User

1. 「**AWS**」→「**General**」→「**Users**」を選択
2. 配置: X=1700, Y=50
3. サイズ: 60px × 60px
4. ラベル:

```
👤 ユーザー
対象: 社内50名
アクセス: Web UI
認証: Azure AD SSO
```

5. スタイル:
```
fillColor=#FFFFFF;
strokeColor=#424242;
fontSize=10;
```

#### Next.js Frontend

1. 「**AWS**」→「**Containers**」→「**Elastic Container Service**」を選択
2. 配置: X=1500, Y=50
3. サイズ: 80px × 80px
4. ラベル:

```
⚛️ Next.js Frontend
ECS Fargate
vCPU: 0.25, RAM: 0.5GB

Framework: Next.js 15
TypeScript + Tailwind CSS

機能:
- 検索UI
- フィルター/ソート
- プレビュー
```

5. スタイル:
```
fillColor=#03A9F4;
strokeColor=#01579B;
fontSize=9;
fontColor=#FFFFFF;
```

---

## ステップ6: 接続線（矢印）を追加（10分）

### 現在のレイヤーを変更

レイヤーパネルで「**Connections & Flows**」をアクティブにする

### 矢印の基本的な引き方

1. ツールバーから「**Connector**」アイコンを選択（または左サイドバーの「**Arrow**」）
2. 始点コンポーネントをクリック
3. 終点コンポーネントまでドラッグ
4. 矢印を右クリック → 「**Edit Style**」で色・太さ・スタイルを変更

### 6-1. バッチ同期フロー（青色実線）

以下の設定を共通で使用:
```
strokeColor=#0066CC;
strokeWidth=3;
dashed=0;
endArrow=classic;
```

#### ① EventBridge → Step Functions

1. EventBridgeからStep Functionsへ矢印を引く
2. 矢印をダブルクリックしてラベル追加:
```
① 月1回トリガー
cron(0 2 1 * ? *)
```
3. ラベルの背景色を設定（右クリック → Edit Style）:
```
labelBackgroundColor=#FFFFFF;
labelBorderColor=#0066CC;
fontSize=9;
fontStyle=1;
```

#### ② Step Functions → VPNManager Lambda

矢印 + ラベル:
```
② VPN接続開始
Invoke Lambda
```

#### ③ VPNManager Lambda → Virtual Private Gateway

**点線**に変更:
```
strokeColor=#0066CC;
strokeWidth=2;
dashed=1;
dashPattern=5 5;
endArrow=classic;
startArrow=classic;  (双方向)
```

ラベル:
```
③ VPN接続確立
IPsec Tunnel
```

#### ④ VPNManager Lambda → AWS DataSync

実線に戻す、ラベル:
```
④ DataSync起動
StartTaskExecution
```

#### ⑤ NAS → S3（データ転送フロー、オレンジ色）

**特別なスタイル**:
```
strokeColor=#FF9900;
strokeWidth=4;
dashed=0;
endArrow=block;  (太矢印)
```

**経路**: NAS → DataSync Agent → VPN Router → Virtual Private Gateway → AWS DataSync → S3

複数のコンポーネントを経由する場合、途中にウェイポイント（中継点）を追加:
1. 矢印を選択
2. 経路上で右クリック → 「**Add Waypoint**」
3. ウェイポイントをドラッグして経路を調整

ラベル:
```
⑤ 増分データ転送
20GB/月
転送時間: 約3時間
100Mbps
```

#### ⑥ Step Functions → VPNManager Lambda

ラベル:
```
⑥ VPN切断
同期完了後
```

#### ⑦ Step Functions → FileScanner Lambda

ラベル:
```
⑦ S3スキャン開始
VPN切断後
```

#### ⑧ FileScanner Lambda ↔ S3

**双方向矢印**:
```
strokeColor=#00AA00;  (緑色)
strokeWidth=2;
startArrow=classic;
endArrow=classic;
```

ラベル:
```
⑧ メタデータ取得
ListObjectsV2
```

#### ⑨ FileScanner → TextExtractor / ImageExtractor

2本の矢印を引く（並列処理を表現）

TextExtractor:
```
⑨ テキスト抽出
5,000 PDFs
最大100並列
```

ImageExtractor:
```
⑨ 画像特徴抽出
2,000 Images
最大50並列
```

#### ⑩ TextExtractor / ImageExtractor → S3

それぞれ双方向矢印（緑色）

TextExtractor:
```
⑩ 抽出テキスト保存
/extracted-text/*.json
```

ImageExtractor:
```
⑩ 特徴ベクトル保存
/image-features/*.npy
512次元
```

#### ⑪ TextExtractor / ImageExtractor → BulkIndexer

2本の矢印がBulkIndexerに集約

ラベル:
```
⑪ 処理完了通知
```

#### ⑫ BulkIndexer → S3

緑色矢印、ラベル:
```
⑫ 全データ取得
```

#### ⑬ BulkIndexer → OpenSearch

青色矢印、ラベル:
```
⑬ Bulk API
kuromoji + k-NN
バッチサイズ: 1,000
```

#### ⑭ BulkIndexer → DynamoDB

青色矢印、ラベル:
```
⑭ メタデータ更新
BatchWriteItem
```

#### ⑮ BulkIndexer → SNS

青色矢印、ラベル:
```
⑮ 完了通知
成功/失敗ステータス
```

---

### 6-2. VPN接続（点線、青色）

#### VPN Router ↔ Virtual Private Gateway

**目立つ点線**:
```
strokeColor=#0066CC;
strokeWidth=2;
dashed=1;
dashPattern=8 8;  (間隔を広く)
startArrow=classic;
endArrow=classic;
```

ラベル（大きめのフォント）:
```
⏰ 月4時間のみ
2:00-6:00 (月1日)
暗号化通信
```

ラベルスタイル:
```
fontSize=11;
fontStyle=1;
fontColor=#0066CC;
labelBackgroundColor=#FFFFFF;
```

---

### 6-3. ユーザー検索フロー（緑色実線）

共通スタイル:
```
strokeColor=#00AA00;
strokeWidth=2;
dashed=0;
startArrow=classic;
endArrow=classic;
```

#### User ↔ Next.js Frontend

ラベル:
```
HTTPS
Azure AD認証
```

#### Next.js Frontend ↔ SearchAPI Lambda

ラベル:
```
POST /api/search
{query: '提案書'}
```

#### SearchAPI Lambda ↔ OpenSearch

ラベル:
```
全文検索
kuromoji tokenizer
```

#### SearchAPI Lambda ↔ DynamoDB

ラベル:
```
GetItem
file_metadata
```

#### SearchAPI Lambda ↔ S3

ラベル:
```
GetObject
ハイライト用
```

---

### 6-4. 監視ログフロー（シアン色点線）

共通スタイル:
```
strokeColor=#00BCD4;
strokeWidth=1;
dashed=1;
dashPattern=2 2;
endArrow=classic;
opacity=60;  (半透明)
```

すべてのLambda関数（6個）からCloudWatchへ矢印を引く:
- VPNManager → CloudWatch
- FileScanner → CloudWatch
- TextExtractor → CloudWatch
- ImageExtractor → CloudWatch
- BulkIndexer → CloudWatch
- SearchAPI → CloudWatch

すべて同じラベル:
```
Logs/Metrics
```

---

## ステップ7: ラベルと注釈を追加（5分）

### 現在のレイヤーを変更

レイヤーパネルで「**Labels & Annotations**」をアクティブにする

### 7-1. タイトルを追加

1. ツールバーから「**Text**」を選択
2. キャンバス上部中央に配置
3. テキスト入力:

```
CIS File Search - Pattern 3 Architecture
月次バッチ同期アーキテクチャ（NAS-AWS ハイブリッド）
```

4. スタイル:
```
fontSize=18;
fontStyle=1;
fontColor=#212121;
align=center;
```

---

### 7-2. 凡例を追加

1. キャンバス右下（X=1700, Y=1450）に「**Rectangle**」を配置
2. サイズ: 200px × 120px
3. スタイル:
```
fillColor=#FFFFFF;
strokeColor=#9E9E9E;
strokeWidth=1;
fontSize=8;
```

4. ダブルクリックしてテキスト入力:

```
凡例 (Legend)

━━━ 青色実線: バッチ同期フロー
━━━ オレンジ実線: データ転送
━━━ 緑色実線: 検索フロー
- - - 青色点線: VPN接続（月4時間）
··· シアン点線: 監視ログ
```

---

### 7-3. コスト情報を追加

1. キャンバス左下（X=50, Y=1450）に「**Rectangle**」を配置
2. サイズ: 400px × 120px
3. スタイル:
```
fillColor=#E8F5E9;
strokeColor=#4CAF50;
strokeWidth=2;
fontSize=9;
```

4. テキスト:

```
💰 月額コスト: $47.24/月

OpenSearch: $31.46 (66.7%)
DataSync: $5.00 (10.6%)
CloudWatch: $4.00 (8.5%)
S3: $2.18 (4.6%)
Lambda: $1.35 (2.9%)
その他: $3.25 (6.7%)

削減率: 96% (Pattern 2比)
```

---

### 7-4. バージョン情報を追加

1. キャンバス右上（X=1700, Y=1300）に「**Text**」を配置
2. スタイル:
```
fontSize=7;
fontColor=#9E9E9E;
align=left;
```

3. テキスト:

```
Version: 1.0
Created: 2025-01-18
Author: CIS Project Team
Status: Production Ready
```

---

## ステップ8: 仕上げと調整（5分）

### 8-1. 全体のバランスを確認

1. メニューバーから「**View → Fit**」を選択（全体を表示）
2. コンポーネントの配置を微調整
3. 矢印の経路を調整（ウェイポイントを追加/削除）

### 8-2. シャドウ効果を追加

重要なコンポーネント（Lambda、S3、OpenSearch、Step Functions）にドロップシャドウを追加:

1. コンポーネントを選択
2. 右クリック → 「**Edit Style**」
3. 以下を追加:
```
shadow=1;
```

### 8-3. 整列とグループ化

複数のコンポーネントを選択して整列:

1. Lambda関数5つを選択（Shiftキーを押しながらクリック）
2. 右クリック → 「**Arrange → Align → Top**」（上端揃え）
3. 右クリック → 「**Arrange → Distribute → Horizontally**」（等間隔配置）

### 8-4. 最終チェック

チェックリストを確認:

- [ ] すべてのコンポーネントが配置されている（26個）
- [ ] 接続線が正しく接続されている（30本）
- [ ] ラベルが読みやすい
- [ ] 色使いが統一されている
- [ ] VPN接続の点線が目立つ
- [ ] Lambda群がグループ化されている
- [ ] オンプレミスとAWS Cloudの境界が明確
- [ ] 凡例とコスト情報が表示されている
- [ ] タイトルとバージョン情報がある

---

## ステップ9: 保存とエクスポート（3分）

### 9-1. ファイルを保存

1. メニューバーから「**File → Save As**」を選択
2. 保存先を選択:
   - **Device**: ローカルに保存
   - **Google Drive**: Google Driveに保存
   - **OneDrive**: OneDriveに保存
3. ファイル名: `CIS_Pattern3_Architecture.drawio`
4. 「**Save**」をクリック

### 9-2. PNG形式でエクスポート

1. メニューバーから「**File → Export as → PNG**」を選択
2. 設定:
   - **Zoom**: 100%
   - **Width**: 2000px
   - **Border Width**: 10px
   - **Transparent Background**: Off（白背景）
3. 「**Export**」をクリック
4. ファイル名: `CIS_Pattern3_Architecture.png`
5. 保存

### 9-3. PDF形式でエクスポート（印刷用）

1. メニューバーから「**File → Export as → PDF**」を選択
2. 設定:
   - **Page View**: All Pages
   - **Page Size**: A3
   - **Fit to**: One page
3. 「**Export**」をクリック
4. ファイル名: `CIS_Pattern3_Architecture.pdf`
5. 保存

### 9-4. SVG形式でエクスポート（編集可能）

1. メニューバーから「**File → Export as → SVG**」を選択
2. 設定:
   - **Embed Fonts**: Yes
   - **Include a copy of my diagram**: Yes
3. 「**Export**」をクリック
4. ファイル名: `CIS_Pattern3_Architecture.svg`
5. 保存

---

## 🎉 完成!

お疲れ様でした!Pattern 3アーキテクチャ図が完成しました。

### 完成イメージ

- オンプレミス環境とAWS Cloudが明確に区分されている
- VPN接続が点線で目立つ
- バッチ同期フローが青色で分かりやすい
- 検索フローが緑色で区別されている
- Lambda関数がグループ化されている
- コスト情報と凡例が表示されている

### 次のステップ

作成した図を以下で活用してください:

1. **プレゼンテーション**: PNG形式をPowerPointに埋め込み
2. **ドキュメント**: PDF形式を印刷して配布
3. **Webサイト**: SVG形式をWebページに埋め込み
4. **共有**: draw.ioファイルをチームメンバーと共有して編集

---

## トラブルシューティング

### よくある問題と解決方法

#### 問題1: AWSアイコンが見つからない

**解決方法**:
1. 左サイドバーの「More Shapes...」で「AWS」を再検索
2. 「AWS 19」ライブラリにチェックが入っているか確認
3. それでも見つからない場合、代替として「General」カテゴリのアイコンを使用

#### 問題2: 矢印が綺麗に引けない

**解決方法**:
1. 「Connector」モードを使用（ツールバーのコネクタアイコン）
2. コンポーネントの接続ポイント（青い×マーク）にスナップさせる
3. ウェイポイントを追加して経路を調整

#### 問題3: ラベルが重なって読めない

**解決方法**:
1. ラベルを選択してドラッグで位置調整
2. フォントサイズを小さくする（8pt-9pt）
3. ラベルの背景色を白に設定して読みやすくする

#### 問題4: 印刷時にレイアウトが崩れる

**解決方法**:
1. 「File → Page Setup」でA3横向きに設定
2. 「File → Print Preview」で事前確認
3. PDF形式でエクスポートしてから印刷

#### 問題5: ファイルサイズが大きすぎる

**解決方法**:
1. PNG形式の解像度を下げる（150 DPI）
2. 不要なレイヤーを削除
3. SVG形式を使用（ファイルサイズが小さい）

---

## 追加リソース

### 参考ドキュメント

- `/docs/pattern3-drawio-guide.md` - 詳細ガイド
- `/docs/pattern3-components.csv` - コンポーネントリスト
- `/docs/pattern3-connections.csv` - 接続リスト
- `/docs/pattern3-architecture.md` - Mermaid形式の元図
- `/docs/pattern3-architecture.puml` - PlantUML形式

### 外部リンク

- [draw.io 公式ドキュメント](https://www.diagrams.net/doc/)
- [AWS Architecture Icons](https://aws.amazon.com/jp/architecture/icons/)
- [draw.io チュートリアル動画](https://www.youtube.com/c/drawioapp)

---

**Happy Diagramming! 🎨**
