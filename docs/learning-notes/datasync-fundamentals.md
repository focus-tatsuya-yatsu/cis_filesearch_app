# AWS DataSync 学習ノート

**作成日**: 2025-01-12
**目的**: DataSync実装のための基礎知識習得と実践的セットアップ手順の記録

---

## 📚 学習リソース

### 公式ドキュメント
- [AWS DataSync User Guide](https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html)
- [DataSync API Reference](https://docs.aws.amazon.com/datasync/latest/userguide/API_Reference.html)
- [DataSync Pricing](https://aws.amazon.com/datasync/pricing/)

### 推奨学習順序（3時間プラン）
1. **Hour 1**: DataSyncの基本概念とアーキテクチャ理解
2. **Hour 2**: Agent、Location、Taskの詳細理解
3. **Hour 3**: ハンズオン（テスト環境構築）

---

## 🎯 DataSync基本概念

### DataSyncとは
AWS DataSyncは、オンプレミスストレージシステムとAWSストレージサービス間で、大量のデータを安全かつ高速に転送するための完全マネージド型データ転送サービスです。

### 主要コンポーネント

#### 1. DataSync Agent
- **役割**: オンプレミス側に配置するVM（Virtual Machine）
- **対応プラットフォーム**: VMware ESXi、Microsoft Hyper-V、Linux KVM、Docker
- **機能**: NAS/SANへのアクセス、AWS APIとの通信、データ転送の実行
- **通信**: Port 443（HTTPS）でAWS DataSyncサービスと通信

#### 2. Location（ロケーション）
- **Source Location**: データ転送元（例: NAS SMB/NFSシェア）
- **Destination Location**: データ転送先（例: S3バケット）
- **種類**:
  - `LocationNFS`: NFS (Network File System) サーバー
  - `LocationSmb`: SMB/CIFS (Server Message Block) サーバー
  - `LocationS3`: Amazon S3バケット
  - `LocationEFS`: Amazon Elastic File System
  - `LocationFSxWindows`: Amazon FSx for Windows File Server

#### 3. Task（タスク）
- **役割**: 転送ジョブの定義（Source → Destination）
- **設定項目**:
  - 転送モード（Changed/All）
  - 検証モード（Checksum/Point-in-time）
  - スケジュール（Cron式）
  - フィルタリング（Include/Exclude patterns）
  - 帯域幅制限
  - メタデータ保持設定

#### 4. Task Execution（タスク実行）
- **役割**: Taskの実際の実行インスタンス
- **ステータス**: LAUNCHING → PREPARING → TRANSFERRING → VERIFYING → SUCCESS/ERROR
- **ログ**: CloudWatch Logsに詳細な実行ログを出力

---

## 🏗️ CISプロジェクトでのDataSync構成

### アーキテクチャ概要
```
┌─────────────────────────────────────┐
│  オンプレミス                         │
│  ┌──────────┐      ┌─────────────┐ │
│  │   NAS    │◀────│  DataSync   │ │
│  │  (SMB/   │      │   Agent     │ │
│  │   NFS)   │      │    (VM)     │ │
│  └──────────┘      └─────────────┘ │
└────────────────────────│────────────┘
                         │ HTTPS (Port 443)
                         ▼
        ┌────────────────────────────────┐
        │         AWS Cloud              │
        │  ┌──────────────────────────┐  │
        │  │   DataSync Service       │  │
        │  │   (Managed Service)      │  │
        │  └────────────┬─────────────┘  │
        │               ▼                │
        │  ┌──────────────────────────┐  │
        │  │     S3 Bucket            │  │
        │  │  cis-filesearch-raw-     │  │
        │  │      files-prod          │  │
        │  └────────────┬─────────────┘  │
        │               │ S3 Event       │
        │               ▼                │
        │  ┌──────────────────────────┐  │
        │  │   Lambda Function        │  │
        │  │   S3EventHandler         │  │
        │  └────────────┬─────────────┘  │
        │               ▼                │
        │  ┌──────────────────────────┐  │
        │  │       SQS Queue          │  │
        │  │  (後続処理トリガー)        │  │
        │  └──────────────────────────┘  │
        └────────────────────────────────┘
```

### 転送フロー
1. **スケジュールトリガー**: Cron式（四半期ごと: `0 0 1 */3 ? *`）
2. **DataSync Agentがスキャン**: NAS上の変更ファイルを検出
3. **S3へ転送**: マルチパート転送、TLS 1.3暗号化
4. **S3イベント発行**: `s3:ObjectCreated:*`イベント
5. **Lambda起動**: メタデータ抽出、SQSメッセージ送信
6. **後続処理**: OpenSearch indexing、画像feature extraction等

---

## 🔐 セキュリティ考慮事項

### 認証
- **DataSync Agent → AWS**: IAM Role（EC2インスタンスプロファイル）またはアクティベーションキー
- **DataSync Agent → NAS**: SMB認証（Username/Password/Domain）またはNFS（IPベース認証）
- **S3アクセス**: IAM Role（最小権限原則）

### 暗号化
- **転送中**: TLS 1.3（強制）
- **保存時**: S3 AES-256またはKMS（デフォルトはAES-256）

### ネットワーク
- **推奨**: AWS Site-to-Site VPNまたはDirect Connect
- **代替**: Public Internet（VPC Endpointsでプライベート通信可）
- **ポート**: 443（HTTPS）のみ

---

## 📝 AWS Console セットアップ手順（学習用）

### Step 1: IAM Roles作成

#### 1.1 DataSync Task実行用Role

**AWS Console操作手順**:

1. **IAM Console**にアクセス: https://console.aws.amazon.com/iam/
2. 左メニュー「ロール」→「ロールを作成」
3. **信頼されたエンティティタイプ**: AWSのサービス
4. **ユースケース**: DataSync（検索: "datasync"）
5. **許可ポリシーをアタッチ**:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:GetObjectVersion",
           "s3:ListBucket",
           "s3:GetBucketLocation"
         ],
         "Resource": [
           "arn:aws:s3:::cis-filesearch-raw-files-prod",
           "arn:aws:s3:::cis-filesearch-raw-files-prod/*"
         ]
       },
       {
         "Effect": "Allow",
         "Action": [
           "logs:CreateLogGroup",
           "logs:CreateLogStream",
           "logs:PutLogEvents"
         ],
         "Resource": "arn:aws:logs:ap-northeast-1:*:log-group:/aws/datasync/*"
       }
     ]
   }
   ```
6. **ロール名**: `CIS-DataSync-Task-Execution-Role`
7. **説明**: "DataSync Task execution role for CIS File Search project"
8. 「ロールを作成」

**期待される出力**: Role ARN `arn:aws:iam::770923989980:role/CIS-DataSync-Task-Execution-Role`

---

#### 1.2 Lambda実行用Role

**AWS Console操作手順**:

1. IAM Console → ロール作成
2. **信頼されたエンティティタイプ**: AWSのサービス
3. **ユースケース**: Lambda
4. **許可ポリシーをアタッチ**:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:GetObjectVersion",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::cis-filesearch-raw-files-prod",
           "arn:aws:s3:::cis-filesearch-raw-files-prod/*"
         ]
       },
       {
         "Effect": "Allow",
         "Action": [
           "sqs:SendMessage",
           "sqs:GetQueueUrl"
         ],
         "Resource": "arn:aws:sqs:ap-northeast-1:770923989980:cis-filesearch-*"
       },
       {
         "Effect": "Allow",
         "Action": [
           "logs:CreateLogGroup",
           "logs:CreateLogStream",
           "logs:PutLogEvents"
         ],
         "Resource": "arn:aws:logs:ap-northeast-1:*:log-group:/aws/lambda/*"
       }
     ]
   }
   ```
5. **ロール名**: `CIS-Lambda-S3EventHandler-Role`
6. 「ロールを作成」

**期待される出力**: Role ARN `arn:aws:iam::770923989980:role/CIS-Lambda-S3EventHandler-Role`

---

### Step 2: S3 Bucket作成

**AWS Console操作手順**:

1. **S3 Console**にアクセス: https://s3.console.aws.amazon.com/s3/
2. 「バケットを作成」
3. **バケット名**: `cis-filesearch-raw-files-prod`
4. **AWSリージョン**: アジアパシフィック（東京）`ap-northeast-1`
5. **オブジェクト所有者**: ACL無効（推奨）
6. **パブリックアクセス設定**: すべてブロック（デフォルト）
7. **バケットのバージョニング**: 有効化
8. **デフォルト暗号化**: SSE-S3（AES-256）
9. **詳細設定**:
   - オブジェクトロック: 無効
   - Intelligent-Tieringアーカイブ設定: 有効（90日後にArchive Access Tier）
10. 「バケットを作成」

**期待される出力**: バケットURI `s3://cis-filesearch-raw-files-prod`

---

#### 2.1 S3イベント通知設定

**AWS Console操作手順**:

1. S3 Console → `cis-filesearch-raw-files-prod` → プロパティタブ
2. **イベント通知**セクション → 「イベント通知を作成」
3. **イベント名**: `CIS-S3-to-Lambda-Notification`
4. **イベントタイプ**: `s3:ObjectCreated:*`（すべての作成イベント）
5. **送信先**: Lambda関数（後でLambda作成後に設定）
6. 保存（一旦スキップ、Lambda作成後に戻る）

---

### Step 3: CloudWatch Logs設定

**AWS Console操作手順**:

1. **CloudWatch Console**にアクセス: https://console.aws.amazon.com/cloudwatch/
2. 左メニュー「ロググループ」→「ロググループを作成」
3. **ロググループ名**: `/aws/datasync/cis-filesearch-sync`
4. **保持期間**: 30日
5. **KMS暗号化**: なし（コスト最適化）
6. 「ロググループを作成」

**期待される出力**: ロググループARN

---

## 🧪 DataSync テスト環境構築

### ローカルテストデータ準備

**手順**:
```bash
# テストディレクトリ作成
mkdir -p ~/datasync-test/{source,destination}

# テストファイル生成（100ファイル、合計10MB）
for i in {1..100}; do
  dd if=/dev/urandom of=~/datasync-test/source/test-file-$i.bin bs=100K count=1 2>/dev/null
done

# メタデータ確認
ls -lh ~/datasync-test/source/ | head -10
```

### LocalStack（代替案）
※DataSyncはLocalStackで完全にサポートされていないため、実AWS環境でのテストを推奨

---

## 📊 学習チェックリスト

### Day 1（3時間）
- [ ] DataSync公式ドキュメント 基本概念 読了
- [ ] Agent、Location、Taskの役割理解
- [ ] IAM Roles作成完了
- [ ] S3 Bucket作成完了
- [ ] CloudWatch Logs設定完了

### Day 2（4時間）
- [ ] DataSync Agent仮想マシン要件確認
- [ ] テストLocation作成（ローカル→S3）
- [ ] テストTask実行
- [ ] CloudWatch Logsでログ確認

### Day 3（2時間）
- [ ] フィルタリングルール設定
- [ ] スケジュール設定
- [ ] エラーハンドリング確認

---

## 🐛 トラブルシューティング

### よくあるエラー

#### Error 1: "Agent cannot reach DataSync endpoints"
**原因**: ファイアウォールでPort 443がブロックされている
**対処法**:
```bash
# エンドポイント疎通確認
curl -v https://datasync.ap-northeast-1.amazonaws.com
```

#### Error 2: "Access Denied" (S3)
**原因**: IAM Role権限不足
**対処法**: IAM Policyで `s3:PutObject` 権限を確認

---

## 📚 参考資料

- [DataSync Quotas](https://docs.aws.amazon.com/datasync/latest/userguide/datasync-limits.html)
- [DataSync Best Practices](https://docs.aws.amazon.com/datasync/latest/userguide/best-practices.html)
- [AWS re:Invent DataSync Session](https://www.youtube.com/results?search_query=aws+reinvent+datasync)

---

**次のステップ**: Lambda関数実装とS3イベントハンドラー作成
