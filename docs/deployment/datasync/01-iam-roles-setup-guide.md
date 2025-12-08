# AWS IAM Roles セットアップガイド（DataSync + EC2 Spot実装用）

**作成日**: 2025-01-12（2025-01-14更新）
**対象**: Week 1 Day 1-2
**所要時間**: 40分
**前提条件**: AWSアカウント、AdministratorAccess権限

---

## 📋 作成するIAM Roles一覧

このガイドでは以下の3つのIAM Roleを作成します：

| Role名 | 用途 | 信頼エンティティ |
|--------|------|-----------------|
| `CIS-DataSync-Task-Execution-Role` | DataSync TaskがS3にアクセス | DataSync Service |
| **`CIS-EC2-FileProcessor-Role`** | **EC2 Spot InstancesがS3/SQS/Bedrock/OpenSearchにアクセス** | **EC2 Service** |
| `CIS-DataSync-Agent-Activation-Role` | DataSync Agent起動時の認証 | DataSync Service |

---

## 🔐 Role 1: DataSync Task実行用Role

### 目的
DataSync TaskがS3バケットにファイルをアップロードし、CloudWatch Logsにログを出力するために必要な権限を付与します。

### 作成手順

#### Step 1: IAM Consoleにアクセス

```
1. AWSマネジメントコンソールにログイン
2. サービス検索で「IAM」と入力
3. IAM Dashboard → 左メニュー「ロール」→「ロールを作成」ボタンをクリック
```

#### Step 2: 信頼されたエンティティを選択

```
1. 信頼されたエンティティタイプ: 「AWSのサービス」を選択
2. ユースケース欄で「DataSync」を検索
3. 「DataSync」を選択
4. 「次へ」ボタンをクリック
```

**期待される画面**: "DataSyncがこのロールを引き受けることを許可します"というメッセージが表示される

#### Step 3: 許可ポリシーを作成してアタッチ

DataSync用のカスタムポリシーを作成します。

**3.1 インラインポリシーを追加**

後ほど「ロール作成後」にインラインポリシーを追加するため、このステップでは何も選択せず「次へ」をクリック。

#### Step 4: ロール名と説明

```
ロール名: CIS-DataSync-Task-Execution-Role
説明: DataSync Task execution role for CIS File Search project. Allows DataSync to write files to S3 and logs to CloudWatch.
タグ（オプション）:
  - Key: Project, Value: CIS-FileSearch
  - Key: Component, Value: DataSync
  - Key: Environment, Value: Production
```

#### Step 5: ロール作成完了

「ロールを作成」ボタンをクリック。

#### Step 6: インラインポリシーを追加

作成されたロールに戻り、カスタムポリシーを追加します。

```
1. IAM → ロール → 「CIS-DataSync-Task-Execution-Role」を検索してクリック
2. 「許可」タブ → 「許可を追加」→「インラインポリシーを作成」
3. JSONタブをクリック
4. 以下のJSON を貼り付け:
```

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3AccessForDataSync",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:GetObjectTagging",
        "s3:PutObjectTagging",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:ListBucketVersions"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-raw-files-prod",
        "arn:aws:s3:::cis-filesearch-raw-files-prod/*"
      ]
    },
    {
      "Sid": "CloudWatchLogsAccess",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": [
        "arn:aws:logs:ap-northeast-1:770923989980:log-group:/aws/datasync/*",
        "arn:aws:logs:ap-northeast-1:770923989980:log-group:/aws/datasync/*:log-stream:*"
      ]
    }
  ]
}
```

```
5. 「次へ」
6. ポリシー名: CIS-DataSync-S3-CloudWatch-Policy
7. 「ポリシーを作成」
```

#### Step 7: 確認

```
ロール詳細画面で以下を確認:
✅ ロールARN: arn:aws:iam::770923989980:role/CIS-DataSync-Task-Execution-Role
✅ 信頼関係: datasync.amazonaws.com
✅ 許可ポリシー: CIS-DataSync-S3-CloudWatch-Policy（インライン）
```

**Role ARNをメモ**: 後でDataSync Task作成時に使用します。

---

## 🔐 Role 2: EC2 File Processor Instance Profile

### 目的
**EC2 Spot Instances上で動作するPython Workerアプリケーション**が以下の操作を実行するために必要な権限を付与します：

- **S3**: ファイルダウンロード・削除
- **SQS**: メッセージ受信・削除・可視性タイムアウト変更
- **Bedrock**: Titan Embeddingsモデル呼び出し
- **OpenSearch**: ドキュメントインデックス登録
- **CloudWatch**: メトリクス・ログ送信

### 🏗️ アーキテクチャ背景

```
S3ランディングバケット
  ↓ (EventBridge)
SQS Queue
  ↓ (SQS Depth監視)
Auto Scaling Group
  ↓
EC2 Spot Instances（複数台）
  ├─ Tesseract OCR（CPU集約型）
  ├─ サムネイル生成
  ├─ Bedrock ベクトル化
  └─ OpenSearch インデックス登録
```

**重要**: Tesseract OCRの処理時間がLambdaの15分制限を超える可能性があるため、EC2 Spot Instancesを使用します（70-90%コスト削減）。

### 作成手順

#### Step 1: 新しいロールを作成

```
IAM Console → ロール → 「ロールを作成」
```

#### Step 2: 信頼されたエンティティを選択

```
1. 信頼されたエンティティタイプ: 「AWSのサービス」
2. ユースケース: 「EC2」を選択
3. 「次へ」
```

**重要**: 「Lambda」ではなく「EC2」を選択してください！

#### Step 3: 許可ポリシーをスキップ

ここではAWS管理ポリシーを選択せず、後でカスタムポリシーを追加するため「次へ」。

#### Step 4: ロール名と説明

```
ロール名: CIS-EC2-FileProcessor-Role
説明: EC2 Instance Profile for file processing workers in CIS File Search project. Allows EC2 instances to access S3, SQS, Bedrock, OpenSearch, and CloudWatch.
タグ:
  - Key: Project, Value: CIS-FileSearch
  - Key: Component, Value: EC2-FileProcessor
  - Key: Environment, Value: Production
```

「ロールを作成」

#### Step 5: インラインポリシーを追加

```
1. ロール「CIS-EC2-FileProcessor-Role」を開く
2. 許可タブ → 「許可を追加」→「インラインポリシーを作成」
3. JSONタブ → 以下を貼り付け:
```

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3FileAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:GetObjectAttributes",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-raw-files-prod/*"
      ]
    },
    {
      "Sid": "S3BucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-raw-files-prod"
      ]
    },
    {
      "Sid": "S3ThumbnailUpload",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-thumbnails-prod/*"
      ]
    },
    {
      "Sid": "SQSQueueAccess",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueUrl",
        "sqs:GetQueueAttributes"
      ],
      "Resource": [
        "arn:aws:sqs:ap-northeast-1:770923989980:cis-filesearch-processing-queue",
        "arn:aws:sqs:ap-northeast-1:770923989980:cis-filesearch-processing-dlq"
      ]
    },
    {
      "Sid": "BedrockModelAccess",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-image-v1"
      ]
    },
    {
      "Sid": "OpenSearchAccess",
      "Effect": "Allow",
      "Action": [
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpGet"
      ],
      "Resource": [
        "arn:aws:es:ap-northeast-1:770923989980:domain/cis-filesearch-index/*"
      ]
    },
    {
      "Sid": "CloudWatchMetricsAndLogs",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": [
        "arn:aws:logs:ap-northeast-1:770923989980:log-group:/aws/ec2/cis-filesearch-processor/*",
        "*"
      ]
    },
    {
      "Sid": "EC2SpotInterruptionHandling",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeSpotInstanceRequests"
      ],
      "Resource": "*"
    }
  ]
}
```

```
4. ポリシー名: CIS-EC2-FileProcessor-Policy
5. 「ポリシーを作成」
```

#### Step 6: 確認

```
✅ ロールARN: arn:aws:iam::770923989980:role/CIS-EC2-FileProcessor-Role
✅ 信頼関係: ec2.amazonaws.com
✅ 許可ポリシー: CIS-EC2-FileProcessor-Policy（インライン）
```

**Role ARNをメモ**: EC2 Launch Template作成時にInstance Profileとして使用します。

---

## 🔐 Role 3: DataSync Agent起動用Role

### 目的
DataSync AgentをオンプレミスVMで起動する際、AWS APIと通信するための一時認証情報を取得するために使用します。

### 作成手順

#### Step 1: 新しいロールを作成

```
IAM Console → ロール → 「ロールを作成」
```

#### Step 2: 信頼されたエンティティを選択

```
1. 信頼されたエンティティタイプ: 「AWSのサービス」
2. ユースケース: 「DataSync」を選択
3. 「次へ」
```

#### Step 3: AWS管理ポリシーをアタッチ

```
検索ボックスで「DataSync」と入力
✅ 「AWSDataSyncReadOnlyAccess」にチェック（Agent登録時の読み取り専用アクセス）
「次へ」
```

#### Step 4: ロール名と説明

```
ロール名: CIS-DataSync-Agent-Activation-Role
説明: DataSync Agent activation role for CIS File Search project. Used during Agent registration process.
タグ:
  - Key: Project, Value: CIS-FileSearch
  - Key: Component, Value: DataSync-Agent
  - Key: Environment, Value: Production
```

「ロールを作成」

#### Step 5: 確認

```
✅ ロールARN: arn:aws:iam::770923989980:role/CIS-DataSync-Agent-Activation-Role
✅ 信頼関係: datasync.amazonaws.com
✅ 許可ポリシー: AWSDataSyncReadOnlyAccess（AWS管理）
```

**Role ARNをメモ**: DataSync Agent起動時に使用します。

---

## ✅ 作成完了チェックリスト

### IAM Roles確認

以下のコマンドで3つのRoleが作成されているか確認できます：

```bash
# AWS CLIで確認
aws iam list-roles --profile AdministratorAccess-770923989980 \
  --query 'Roles[?starts_with(RoleName, `CIS-DataSync`) || starts_with(RoleName, `CIS-EC2`)].{Name:RoleName,ARN:Arn}' \
  --output table
```

**期待される出力**:
```
-------------------------------------------------------------------------------------------------------
|                                              ListRoles                                              |
+------------------------------------+-----------------------------------------------------------------+
|               Name                 |                               ARN                                |
+------------------------------------+-----------------------------------------------------------------+
|  CIS-DataSync-Agent-Activation-Role|  arn:aws:iam::770923989980:role/CIS-DataSync-Agent-Activation-Role |
|  CIS-DataSync-Task-Execution-Role  |  arn:aws:iam::770923989980:role/CIS-DataSync-Task-Execution-Role   |
|  CIS-EC2-FileProcessor-Role        |  arn:aws:iam::770923989980:role/CIS-EC2-FileProcessor-Role         |
+------------------------------------+-----------------------------------------------------------------+
```

### 手動確認（AWS Console）

```
1. IAM Console → ロール
2. 検索ボックスで「CIS-」と入力
3. 以下3つのRoleが表示されることを確認:
   ✅ CIS-DataSync-Agent-Activation-Role
   ✅ CIS-DataSync-Task-Execution-Role
   ✅ CIS-EC2-FileProcessor-Role （Lambda用ではない！）
```

---

## 📝 Role ARNリスト（保存推奨）

作成したRole ARNを`.env`ファイルや設定ファイルに記録しておきましょう：

```bash
# /frontend/backend/file-scanner/.env に追加
DATASYNC_TASK_EXECUTION_ROLE_ARN=arn:aws:iam::770923989980:role/CIS-DataSync-Task-Execution-Role
EC2_INSTANCE_PROFILE_ARN=arn:aws:iam::770923989980:role/CIS-EC2-FileProcessor-Role
DATASYNC_AGENT_ACTIVATION_ROLE_ARN=arn:aws:iam::770923989980:role/CIS-DataSync-Agent-Activation-Role
```

---

## 🔒 セキュリティベストプラクティス

### ✅ 実施済み
- [x] 最小権限の原則（Least Privilege）適用
- [x] リソースベースのARN制限（S3バケット、SQS Queue、OpenSearch Domain、CloudWatch Logs）
- [x] 信頼関係の明示的な定義（DataSync、EC2専用）
- [x] タグによるリソース管理
- [x] EC2 Spot Instance中断処理用権限（DescribeInstances）

### 🔍 今後の改善項目
- [ ] CloudTrailでRole使用状況の監査ログ記録
- [ ] IAM Access Analyzerでポリシー検証
- [ ] 四半期ごとのRole権限レビュー
- [ ] VPC Endpoint経由のOpenSearch/Bedrock接続（PrivateLink）

---

## 🐛 トラブルシューティング

### Issue 1: "Role already exists"エラー

**原因**: 同名のRoleが既に存在
**対処法**:
```bash
# 既存Roleを削除（注意: 本番環境では慎重に）
aws iam delete-role --role-name CIS-EC2-FileProcessor-Role --profile AdministratorAccess-770923989980

# または別の名前で作成
# 例: CIS-EC2-FileProcessor-Role-v2
```

### Issue 2: "Access Denied" during inline policy creation

**原因**: IAM権限不足
**対処法**:
- AdministratorAccess または IAMFullAccess 権限が必要
- AWSアカウント管理者に権限付与を依頼

### Issue 3: Policy JSON validation error

**原因**: JSONフォーマットエラー
**対処法**:
```bash
# JSONバリデーション
cat policy.json | jq .

# オンラインバリデーター使用
# https://jsonlint.com/
```

### Issue 4: EC2インスタンスがBedrockにアクセスできない

**原因**: Bedrock Titan Embeddingsモデルはus-east-1リージョンのみ利用可能
**対処法**:
- EC2からus-east-1のBedrockエンドポイントへHTTPS通信を許可
- VPC Security Groupのegressルールを確認
- IAM Policyのリソースリージョンを確認

---

## 📚 参考資料

- [IAM Roles for DataSync](https://docs.aws.amazon.com/datasync/latest/userguide/using-identity-based-policies.html)
- [IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [EC2 Instance Profiles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html)
- [Amazon Bedrock Security](https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html)
- [OpenSearch Service Access Control](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/ac.html)

---

## ✅ 完了確認

- [ ] CIS-DataSync-Task-Execution-Role 作成完了
- [ ] CIS-EC2-FileProcessor-Role 作成完了（Lambda用ではない！）
- [ ] CIS-DataSync-Agent-Activation-Role 作成完了
- [ ] Role ARNを `.env` に記録完了
- [ ] AWS CLIでRole一覧確認完了

**次のステップ**: [02-s3-bucket-setup-guide.md](./02-s3-bucket-setup-guide.md) - S3バケット作成
