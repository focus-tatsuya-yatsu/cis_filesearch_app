# 🚀 AWS Console 完全初心者マニュアル

## はじめに - これがあなたの最初のガイドです！

AWS Consoleを初めて使う方のための完全マニュアルです。このドキュメントを順番に進めれば、CIS File Search Applicationの環境が構築できます。

---

## 📋 必要なもの

### 開始前に準備するもの
- ✅ メールアドレス（AWS アカウント用）
- ✅ クレジットカード（AWS 料金支払い用）
- ✅ 電話番号（SMS認証用）
- ✅ パソコン（Chrome/Firefox推奨）
- ✅ 2-3時間の作業時間

---

## 🎯 STEP 1: AWS アカウント作成（30分）

### 1.1 AWSサインアップ

1. **ブラウザで開く**
   ```
   https://aws.amazon.com/jp/
   ```

2. **「無料アカウントを作成」をクリック**
   - オレンジ色のボタンです

3. **アカウント情報を入力**
   ```
   メールアドレス: your-email@example.com
   パスワード: 12文字以上（大文字、小文字、数字、記号を含む）
   AWSアカウント名: cis-filesearch-prod
   ```

4. **連絡先情報**
   ```
   用途: ビジネス
   会社名: あなたの会社名
   電話番号: +81-90-xxxx-xxxx
   国: 日本
   住所: 会社の住所
   ```

5. **支払い情報**
   - クレジットカード情報を入力
   - 初期費用: $1（確認用、返金されます）

6. **本人確認**
   - SMSまたは音声通話で確認コード受信
   - 4桁のコードを入力

7. **サポートプラン選択**
   - 「ベーシックサポート - 無料」を選択

### 1.2 初期セキュリティ設定（必須！）

1. **ルートユーザーでサインイン**
   ```
   https://console.aws.amazon.com/
   ```

2. **MFA（多要素認証）を有効化**
   - 右上のアカウント名 → 「セキュリティ認証情報」
   - 「多要素認証（MFA）」→「MFAデバイスの割り当て」
   - スマホアプリ（Google Authenticator推奨）でQRコード読み取り

3. **予算アラート設定**
   - 「請求ダッシュボード」を開く
   - 「予算」→「予算を作成」
   - 月額予算: $100
   - アラート: 80%で通知

---

## 🔧 STEP 2: IAM ロール作成（30分）

### 2.1 IAMコンソールを開く

1. **AWS Console上部の検索バーに「IAM」と入力**
2. **「IAM」をクリック**

### 2.2 EC2用ロール作成

1. **左メニューから「ロール」をクリック**

2. **「ロールを作成」ボタンをクリック**

3. **設定値を入力**
   ```
   信頼されたエンティティタイプ: AWS のサービス
   ユースケース: EC2
   ```
   「次へ」をクリック

4. **ポリシーを検索して追加**
   以下を検索して✓を付ける：
   - AmazonS3FullAccess
   - AmazonSQSFullAccess
   - AmazonOpenSearchServiceFullAccess
   - AmazonBedrockFullAccess
   - CloudWatchLogsFullAccess

5. **ロール名を設定**
   ```
   ロール名: CIS-EC2-FileProcessor-Role
   説明: Role for CIS File Processor EC2 instances
   ```

6. **「ロールを作成」をクリック**

### 2.3 DataSync用ロール作成（同様の手順）

```
ロール名: CIS-DataSync-Task-Role
信頼されたエンティティ: DataSync
ポリシー: AmazonS3FullAccess
```

---

## 📦 STEP 3: S3 バケット作成（20分）

### 3.1 S3コンソールを開く

1. **検索バーに「S3」と入力**
2. **「S3」をクリック**

### 3.2 Landing バケット作成

1. **「バケットを作成」をクリック**

2. **基本設定**
   ```
   バケット名: cis-landing-bucket-[あなたのアカウントID]
   リージョン: アジアパシフィック（東京）ap-northeast-1
   ```

3. **パブリックアクセス設定**
   ```
   ✅ パブリックアクセスをすべてブロック
   ```
   **重要**: これは必ずONにしてください！

4. **暗号化**
   ```
   暗号化タイプ: SSE-S3
   バケットキー: 有効化
   ```

5. **「バケットを作成」をクリック**

### 3.3 Thumbnail バケット作成

同じ手順で作成：
```
バケット名: cis-thumbnail-bucket-[あなたのアカウントID]
その他の設定: Landing バケットと同じ
```

### 3.4 Event Notification設定

1. **Landing バケットを開く**
2. **「プロパティ」タブ**
3. **「イベント通知」セクション**
4. **「Amazon EventBridge」→「編集」**
5. **「このバケットのすべてのイベントをEventBridgeに送信」をON**

---

## 📨 STEP 4: SQS キュー作成（20分）

### 4.1 SQSコンソールを開く

1. **検索バーに「SQS」と入力**
2. **「SQS」をクリック**

### 4.2 キュー作成

1. **「キューを作成」をクリック**

2. **基本設定**
   ```
   タイプ: 標準
   名前: cis-file-processing-queue
   ```

3. **設定**
   ```
   可視性タイムアウト: 300秒（5分）
   メッセージ保持期間: 14日
   最大メッセージサイズ: 256 KB
   ```

4. **デッドレターキュー**
   ```
   ✅ 有効化
   最大受信数: 3
   ```
   「新しいDLQを作成」→名前: `cis-file-processing-dlq`

5. **アクセスポリシー**
   後でEventBridgeから更新するので、デフォルトのまま

6. **「キューを作成」をクリック**

---

## 🔍 STEP 5: OpenSearch ドメイン作成（45分）

### 5.1 OpenSearchコンソールを開く

1. **検索バーに「OpenSearch」と入力**
2. **「OpenSearch Service」をクリック**

### 5.2 ドメイン作成

1. **「ドメインの作成」をクリック**

2. **ドメイン名とデプロイタイプ**
   ```
   ドメイン名: cis-filesearch
   デプロイタイプ: 本番稼働用
   バージョン: OpenSearch 2.11（最新の2.x）
   ```

3. **コンピューティングとストレージ**
   ```
   インスタンスタイプ: t3.small.search
   インスタンス数: 1
   ストレージタイプ: EBS (gp3)
   EBSボリュームサイズ: 100 GB
   ```

4. **ネットワーク**
   ```
   ネットワーク: パブリックアクセス（開発用）
   ```
   **注意**: 本番環境ではVPCを使用してください

5. **きめ細かなアクセスコントロール**
   ```
   ✅ きめ細かなアクセスコントロールを有効化
   マスターユーザー: マスターユーザーを作成
   ユーザー名: admin
   パスワード: 強力なパスワードを設定
   ```

6. **アクセスポリシー**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "AWS": "arn:aws:iam::YOUR_ACCOUNT_ID:role/CIS-EC2-FileProcessor-Role"
         },
         "Action": "es:*",
         "Resource": "arn:aws:es:ap-northeast-1:YOUR_ACCOUNT_ID:domain/cis-filesearch/*"
       }
     ]
   }
   ```

7. **「作成」をクリック**（作成に15-20分かかります）

---

## 🌉 STEP 6: EventBridge ルール作成（20分）

### 6.1 EventBridgeコンソールを開く

1. **検索バーに「EventBridge」と入力**
2. **「EventBridge」をクリック**

### 6.2 ルール作成

1. **左メニュー「ルール」→「ルールを作成」**

2. **基本情報**
   ```
   名前: cis-s3-to-sqs-rule
   イベントバス: default
   ルールタイプ: イベントパターンを持つルール
   ```

3. **イベントパターン**
   ```
   イベントソース: AWS のサービス
   AWS サービス: S3
   イベントタイプ: Amazon S3 イベント通知
   特定のバケット名: cis-landing-bucket-[あなたのアカウントID]
   ```

4. **ターゲット**
   ```
   ターゲットタイプ: AWS のサービス
   ターゲット: SQS キュー
   キュー: cis-file-processing-queue
   ```

5. **「ルールを作成」をクリック**

---

## ⚙️ STEP 7: EC2 Auto Scaling設定（40分）

### 7.1 EC2コンソールを開く

1. **検索バーに「EC2」と入力**
2. **「EC2」をクリック**

### 7.2 起動テンプレート作成

1. **左メニュー「起動テンプレート」→「起動テンプレートを作成」**

2. **基本設定**
   ```
   テンプレート名: cis-worker-template
   説明: Template for CIS file processor workers
   ```

3. **AMI選択**
   ```
   Amazon Linux 2023 AMI（無料利用枠）
   ```

4. **インスタンスタイプ**
   ```
   t3.medium
   ```

5. **キーペア**
   - 新しいキーペアを作成（後でSSH接続用）
   - 名前: cis-worker-key
   - ダウンロードして安全に保管

6. **ネットワーク設定**
   ```
   サブネット: 設定しない（Auto Scalingで指定）
   セキュリティグループ: 新規作成
   名前: cis-worker-sg
   インバウンドルール:
   - SSH (22) - あなたのIPから
   - HTTPS (443) - 0.0.0.0/0（アウトバウンド用）
   ```

7. **ストレージ**
   ```
   ボリュームタイプ: gp3
   サイズ: 30 GB
   暗号化: 有効
   ```

8. **高度な詳細**
   - IAMインスタンスプロファイル: CIS-EC2-FileProcessor-Role
   - ユーザーデータ:
   ```bash
   #!/bin/bash
   yum update -y
   yum install -y python3 python3-pip git
   pip3 install boto3 opensearch-py pillow pytesseract

   # Workerアプリケーションのセットアップ
   cd /opt
   git clone https://github.com/your-repo/cis-worker.git
   cd cis-worker
   pip3 install -r requirements.txt

   # サービス開始
   python3 src/main.py
   ```

### 7.3 Auto Scalingグループ作成

1. **左メニュー「Auto Scaling グループ」→「作成」**

2. **基本設定**
   ```
   グループ名: cis-worker-asg
   起動テンプレート: cis-worker-template
   ```

3. **インスタンスの起動オプション**
   ```
   VPC: デフォルトVPC
   サブネット: すべてのアベイラビリティーゾーン選択
   ```

4. **高度なオプション**
   ```
   購入オプション: ✅ Spot と On-Demand の組み合わせ
   On-Demand ベース: 0
   On-Demand 割合: 30%
   Spot 割合: 70%
   ```

5. **グループサイズとスケーリング**
   ```
   希望する容量: 0
   最小容量: 0
   最大容量: 3
   ```

6. **スケーリングポリシー**
   ```
   ポリシータイプ: Target tracking scaling
   メトリクスタイプ: SQS Queue メトリクス
   ターゲット値: 100（メッセージ/インスタンス）
   キュー: cis-file-processing-queue
   ```

7. **「作成」をクリック**

---

## ✅ STEP 8: 動作確認（30分）

### 8.1 設定確認スクリプト実行

1. **ローカルPCでターミナルを開く**

2. **スクリプトをダウンロード**
   ```bash
   cd ~/Desktop
   curl -O https://your-repo/verify_aws_config.py
   ```

3. **AWS CLIを設定**
   ```bash
   aws configure
   # アクセスキーとシークレットキーを入力
   # リージョン: ap-northeast-1
   ```

4. **確認スクリプト実行**
   ```bash
   python3 verify_aws_config.py
   ```

### 8.2 テストファイルアップロード

1. **S3コンソールでLanding バケットを開く**
2. **「アップロード」をクリック**
3. **テスト用の画像ファイルをアップロード**

### 8.3 処理確認

1. **SQSコンソールでキューを確認**
   - メッセージが届いているか確認

2. **EC2コンソールでインスタンス確認**
   - Auto Scalingによりインスタンスが起動するか確認

3. **OpenSearchで検索テスト**
   - ダッシュボードURLを開く
   - インデックスにドキュメントが作成されているか確認

---

## 🎉 完了！

お疲れ様でした！これでAWS環境の基本設定が完了しました。

### 次のステップ
1. Python Workerアプリケーションのデプロイ
2. DataSync設定（Windows Scanner PC）
3. 本番データでのテスト
4. 監視設定（CloudWatch）

### トラブルシューティング
問題が発生した場合は、[06-TROUBLESHOOTING-DECISION-TREE.md](./06-TROUBLESHOOTING-DECISION-TREE.md)を参照してください。

---

## 💰 コスト管理

### 月額費用（目安）
- OpenSearch: $48
- S3: $15
- EC2 Spot: $8.78
- その他: $15
- **合計: 約$87/月**

### コスト削減のヒント
- EC2インスタンスは使わない時は停止
- OpenSearchの開発環境は夜間停止
- S3のライフサイクルポリシー設定
- 予算アラートの活用

---

## 📚 参考資料

- [AWS公式ドキュメント](https://docs.aws.amazon.com/ja_jp/)
- [OpenSearch日本語ガイド](https://opensearch.org/ja/)
- [EC2 Spot インスタンスベストプラクティス](https://aws.amazon.com/jp/ec2/spot/getting-started/)

---

**バージョン**: 1.0.0
**最終更新**: 2024年1月
**作成者**: CIS DevOpsチーム

ご質問があれば、お気軽にお問い合わせください！