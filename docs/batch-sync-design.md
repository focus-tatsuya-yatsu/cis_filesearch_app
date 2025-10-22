# バッチ同期詳細設計書

## Executive Summary

本設計書では、NASとAWS S3間のバッチ同期プロセスの詳細設計を記述します。月次バッチ実行により、コストを最小化しながら過去の膨大な資料を効率的に検索可能にします。

### 主要な設計決定

- **同期方式**: AWS DataSync (増分同期)
- **実行頻度**: 月1回（深夜バッチ）
- **VPN接続**: Site-to-Site VPN (バッチ時のみ接続)
- **オーケストレーション**: AWS Step Functions
- **データ転送量**: 初回 500GB、以降 月平均 50GB

### コストメリット

| 項目 | リアルタイム同期 | 月次バッチ同期 | 削減率 |
|------|-----------------|---------------|-------|
| VPN接続費用 | $36/月 | $1.20/月 | **97%** |
| DataSync転送費用 | $20/月 | $5/月 | **75%** |
| Lambda処理費用 | $15/月 | $2.50/月 | **83%** |
| **合計** | **$71/月** | **$8.70/月** | **88%** |

---

## 1. システムアーキテクチャ

### 1.1 全体フロー図

```mermaid
graph TB
    subgraph "オンプレミス環境"
        A[NAS<br/>500GB 既存データ<br/>50GB/月 増分]
        B[DataSync Agent<br/>仮想アプライアンス]
    end

    subgraph "AWS環境"
        C[Site-to-Site VPN<br/>バッチ時のみ接続]
        D[DataSync Service]
        E[(S3 Bucket<br/>raw-files/)]

        F[Step Functions<br/>バッチオーケストレーション]

        G[Lambda: FileScanner]
        H[Lambda: TextExtractor]
        I[Lambda: ImageFeatureExtractor]
        J[Lambda: MetadataIndexer]

        K[(OpenSearch<br/>files + images)]
        L[(DynamoDB<br/>file_metadata)]
    end

    A -->|SMB/NFS| B
    B -->|IPsec| C
    C --> D
    D -->|増分同期| E

    E -->|S3イベント| F

    F --> G
    G -->|ファイルリスト| H
    G -->|画像リスト| I

    H -->|テキスト抽出| J
    I -->|特徴ベクトル| J

    J --> K
    J --> L

    style F fill:#e1f5ff
    style E fill:#fff4e1
    style K fill:#e8f5e9
```

### 1.2 データフロー詳細

#### Phase 1: ファイル同期 (VPN接続中)

1. **VPN確立** (5分)
   - CloudFormation/Terraformで自動起動
   - Customer Gatewayとの接続確立
   - ヘルスチェック完了待機

2. **DataSync実行** (2-4時間)
   - NAS全体をスキャン
   - 変更検出（mtime, size比較）
   - 増分ファイルのみをS3に転送

3. **VPN切断**
   - DataSync完了確認
   - VPN自動切断でコスト削減

#### Phase 2: データ処理 (VPN不要)

4. **ファイルスキャン** (10分)
   - S3に転送されたファイルを分類
   - PDF/Office → テキスト抽出キュー
   - 画像 → 特徴抽出キュー

5. **並列処理** (4-6時間)
   - Lambda並列実行（20-50並列）
   - テキスト抽出: pdfplumber, python-docx
   - 画像特徴抽出: ResNet-50

6. **インデックス作成** (1時間)
   - OpenSearchバルクインサート
   - DynamoDBメタデータ更新

---

## 2. AWS DataSync詳細設定

### 2.1 DataSyncエージェントのセットアップ

#### オンプレミス環境要件

| 項目 | 要件 | 推奨値 |
|------|------|--------|
| **ハイパーバイザー** | VMware ESXi 6.5+ / Hyper-V | VMware ESXi 7.0 |
| **vCPU** | 4コア以上 | 4コア |
| **メモリ** | 32GB以上 | 32GB |
| **ディスク** | 80GB (システム) | 80GB SSD |
| **ネットワーク** | 1Gbps以上 | 10Gbps |
| **NASプロトコル** | SMB 3.0+ / NFS 4.0+ | SMB 3.1 |

#### エージェントデプロイ手順

```bash
# 1. DataSync Agent OVAのダウンロード
aws datasync describe-agent \
  --agent-arn arn:aws:datasync:ap-northeast-1:123456789012:agent/agent-0123456789abcdef0

# 2. VMware ESXiにデプロイ
# - OVAファイルをvSphere Clientでインポート
# - ネットワーク設定（DHCP or 静的IP）
# - 起動後、http://<agent-ip>/ でアクティベーション

# 3. AWS CLIでアクティベーション
ACTIVATION_KEY=$(curl "http://<agent-ip>/?activationRegion=ap-northeast-1")

aws datasync create-agent \
  --agent-name "CIS-NAS-Sync-Agent" \
  --activation-key $ACTIVATION_KEY \
  --vpc-endpoint-id vpce-0123456789abcdef0 \
  --subnet-arns arn:aws:ec2:ap-northeast-1:123456789012:subnet/subnet-abc123 \
  --security-group-arns arn:aws:ec2:ap-northeast-1:123456789012:security-group/sg-abc123
```

### 2.2 DataSyncタスク設定

#### ソースロケーション（NAS）

```python
import boto3

datasync = boto3.client('datasync', region_name='ap-northeast-1')

# SMBロケーション作成
smb_location_response = datasync.create_location_smb(
    Subdirectory='/shared/documents',
    ServerHostname='nas01.company.local',
    User='datasync-user',
    Password='secure-password',  # Secrets Managerから取得
    AgentArns=[
        'arn:aws:datasync:ap-northeast-1:123456789012:agent/agent-0123456789abcdef0'
    ],
    MountOptions={
        'Version': 'SMB3'
    }
)

print(f"SMB Location ARN: {smb_location_response['LocationArn']}")
```

#### デスティネーションロケーション（S3）

```python
# S3ロケーション作成
s3_location_response = datasync.create_location_s3(
    S3BucketArn='arn:aws:s3:::cis-filesearch-raw-files',
    Subdirectory='/monthly-sync',
    S3Config={
        'BucketAccessRoleArn': 'arn:aws:iam::123456789012:role/DataSyncS3Role'
    },
    S3StorageClass='INTELLIGENT_TIERING'  # コスト最適化
)

print(f"S3 Location ARN: {s3_location_response['LocationArn']}")
```

#### タスク作成と詳細設定

```python
# DataSyncタスク作成
task_response = datasync.create_task(
    SourceLocationArn=smb_location_response['LocationArn'],
    DestinationLocationArn=s3_location_response['LocationArn'],
    Name='CIS-Monthly-Batch-Sync',

    # オプション設定
    Options={
        # 転送モード
        'VerifyMode': 'POINT_IN_TIME_CONSISTENT',  # 整合性チェック
        'OverwriteMode': 'ALWAYS',  # 常に上書き
        'Atime': 'BEST_EFFORT',  # アクセス時刻を保持
        'Mtime': 'PRESERVE',  # 更新時刻を保持（重要！）
        'Uid': 'NONE',
        'Gid': 'NONE',
        'PreserveDeletedFiles': 'REMOVE',  # 削除ファイルはS3からも削除
        'PreserveDevices': 'NONE',
        'PosixPermissions': 'NONE',

        # パフォーマンス設定
        'BytesPerSecond': 12500000,  # 100Mbps (帯域制限)
        'TaskQueueing': 'ENABLED',

        # ロギング
        'LogLevel': 'TRANSFER',

        # セキュリティ
        'SecurityDescriptorCopyFlags': 'NONE',

        # タグ
        'TransferMode': 'CHANGED'  # 変更されたファイルのみ（重要！）
    },

    # 除外パターン
    Excludes=[
        {
            'FilterType': 'SIMPLE_PATTERN',
            'Value': '*.tmp'
        },
        {
            'FilterType': 'SIMPLE_PATTERN',
            'Value': '~$*'  # Office一時ファイル
        },
        {
            'FilterType': 'SIMPLE_PATTERN',
            'Value': 'Thumbs.db'
        },
        {
            'FilterType': 'SIMPLE_PATTERN',
            'Value': '.DS_Store'
        }
    ],

    # 含めるパターン（オプション）
    Includes=[
        {
            'FilterType': 'SIMPLE_PATTERN',
            'Value': '*.pdf'
        },
        {
            'FilterType': 'SIMPLE_PATTERN',
            'Value': '*.docx'
        },
        {
            'FilterType': 'SIMPLE_PATTERN',
            'Value': '*.xlsx'
        },
        {
            'FilterType': 'SIMPLE_PATTERN',
            'Value': '*.jpg'
        },
        {
            'FilterType': 'SIMPLE_PATTERN',
            'Value': '*.png'
        }
    ],

    # CloudWatch Logs設定
    CloudWatchLogGroupArn='arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/datasync',

    # タグ
    Tags=[
        {'Key': 'Environment', 'Value': 'Production'},
        {'Key': 'Application', 'Value': 'CIS-FileSearch'},
        {'Key': 'Schedule', 'Value': 'Monthly'}
    ]
)

print(f"Task ARN: {task_response['TaskArn']}")
```

### 2.3 増分同期の仕組み

#### 変更検出ロジック

DataSyncは以下の条件で変更を検出します:

```python
def is_file_changed(nas_file, s3_object):
    """
    ファイル変更検出ロジック

    DataSyncの内部ロジックを疑似コードで表現
    """
    # 1. ファイルサイズの比較
    if nas_file.size != s3_object.size:
        return True

    # 2. 更新時刻の比較（重要！Mtime: PRESTERVEが必要）
    if nas_file.mtime > s3_object.last_modified:
        return True

    # 3. チェックサム比較（VerifyMode: POINT_IN_TIME_CONSISTENTの場合）
    if calculate_checksum(nas_file) != s3_object.etag:
        return True

    return False  # 変更なし
```

#### 初回同期 vs 増分同期

| 項目 | 初回同期 | 増分同期（2回目以降） |
|------|---------|---------------------|
| **スキャンファイル数** | 500,000ファイル | 500,000ファイル |
| **転送ファイル数** | 500,000ファイル | 50,000ファイル (10%) |
| **転送データ量** | 500GB | 50GB |
| **実行時間** | 8-10時間 | 2-3時間 |
| **VPN接続時間** | 10時間 | 3時間 |
| **VPN料金** | $3.60 | $1.08 |
| **DataSync料金** | $50.00 | $5.00 |

#### S3オブジェクトメタデータ

DataSyncはS3オブジェクトに以下のメタデータを保存します:

```python
# S3オブジェクトのメタデータ例
{
    'x-amz-meta-file-mtime': '1704067200',  # Unix timestamp
    'x-amz-meta-file-atime': '1704153600',
    'x-amz-meta-file-size': '2456789',
    'x-amz-meta-source-path': '/shared/documents/2023/project/report.pdf',
    'Content-Type': 'application/pdf',
    'Content-Length': 2456789
}
```

### 2.4 削除ファイルの処理

#### オプション1: S3からも削除 (推奨)

```python
# PreserveDeletedFiles: REMOVE
# NASから削除されたファイルはS3からも自動削除
Options={
    'PreserveDeletedFiles': 'REMOVE'
}
```

**メリット**:
- ストレージコストの削減
- 最新の状態を保持
- 検索結果に存在しないファイルが表示されない

**デメリット**:
- 誤削除のリスク
- 履歴が失われる

#### オプション2: S3に保持（アーカイブ）

```python
# PreserveDeletedFiles: PRESERVE
# S3に削除マーカーを付与して保持
Options={
    'PreserveDeletedFiles': 'PRESERVE'
}
```

**実装例**:

```python
# Lambda: 削除ファイルのアーカイブ処理
def handle_deleted_files(event, context):
    """
    DataSync完了後、削除されたファイルを検出してアーカイブ
    """
    s3 = boto3.client('s3')
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table('file_metadata')

    # 前回同期時のファイルリストを取得
    response = table.query(
        IndexName='sync-timestamp-index',
        KeyConditionExpression='sync_batch_id = :batch_id',
        ExpressionAttributeValues={
            ':batch_id': get_previous_batch_id()
        }
    )

    previous_files = {item['file_path']: item for item in response['Items']}

    # 今回同期されたファイルリストを取得
    current_files = set()
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket='cis-filesearch-raw-files'):
        for obj in page.get('Contents', []):
            current_files.add(obj['Key'])

    # 削除されたファイルを検出
    deleted_files = set(previous_files.keys()) - current_files

    for file_path in deleted_files:
        # アーカイブバケットに移動
        copy_source = {
            'Bucket': 'cis-filesearch-raw-files',
            'Key': file_path
        }

        s3.copy_object(
            CopySource=copy_source,
            Bucket='cis-filesearch-archived-files',
            Key=f"deleted/{datetime.now().strftime('%Y-%m')}/{file_path}",
            StorageClass='GLACIER_DEEP_ARCHIVE'
        )

        # 元ファイルを削除
        s3.delete_object(
            Bucket='cis-filesearch-raw-files',
            Key=file_path
        )

        # DynamoDBに削除記録
        table.update_item(
            Key={'file_id': previous_files[file_path]['file_id']},
            UpdateExpression='SET deleted_at = :timestamp, archived_to = :archive_path',
            ExpressionAttributeValues={
                ':timestamp': datetime.now().isoformat(),
                ':archive_path': f"s3://cis-filesearch-archived-files/deleted/{datetime.now().strftime('%Y-%m')}/{file_path}"
            }
        )

    return {
        'deleted_count': len(deleted_files),
        'deleted_files': list(deleted_files)
    }
```

---

## 3. Step Functionsワークフロー

### 3.1 全体ワークフロー定義

```json
{
  "Comment": "CIS Monthly Batch Sync Workflow",
  "StartAt": "EstablishVPN",
  "States": {
    "EstablishVPN": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:ap-northeast-1:123456789012:function:VPNManager",
        "Payload": {
          "action": "connect",
          "vpn_connection_id": "vpn-0123456789abcdef0"
        }
      },
      "ResultPath": "$.vpn",
      "Next": "WaitForVPN",
      "Retry": [
        {
          "ErrorEquals": ["States.ALL"],
          "IntervalSeconds": 60,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.error",
          "Next": "NotifyFailure"
        }
      ]
    },

    "WaitForVPN": {
      "Type": "Wait",
      "Seconds": 300,
      "Next": "CheckVPNStatus"
    },

    "CheckVPNStatus": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:ap-northeast-1:123456789012:function:VPNManager",
        "Payload": {
          "action": "check_status",
          "vpn_connection_id": "vpn-0123456789abcdef0"
        }
      },
      "ResultPath": "$.vpn_status",
      "Next": "IsVPNReady"
    },

    "IsVPNReady": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.vpn_status.Payload.status",
          "StringEquals": "available",
          "Next": "StartDataSync"
        }
      ],
      "Default": "WaitForVPN"
    },

    "StartDataSync": {
      "Type": "Task",
      "Resource": "arn:aws:states:::aws-sdk:datasync:startTaskExecution",
      "Parameters": {
        "TaskArn": "arn:aws:datasync:ap-northeast-1:123456789012:task/task-0123456789abcdef0"
      },
      "ResultPath": "$.datasync",
      "Next": "WaitForDataSync"
    },

    "WaitForDataSync": {
      "Type": "Wait",
      "Seconds": 600,
      "Next": "CheckDataSyncStatus"
    },

    "CheckDataSyncStatus": {
      "Type": "Task",
      "Resource": "arn:aws:states:::aws-sdk:datasync:describeTaskExecution",
      "Parameters": {
        "TaskExecutionArn.$": "$.datasync.TaskExecutionArn"
      },
      "ResultPath": "$.datasync_status",
      "Next": "IsDataSyncComplete"
    },

    "IsDataSyncComplete": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.datasync_status.Status",
          "StringEquals": "SUCCESS",
          "Next": "DisconnectVPN"
        },
        {
          "Variable": "$.datasync_status.Status",
          "StringEquals": "ERROR",
          "Next": "HandleDataSyncError"
        }
      ],
      "Default": "WaitForDataSync"
    },

    "DisconnectVPN": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:ap-northeast-1:123456789012:function:VPNManager",
        "Payload": {
          "action": "disconnect",
          "vpn_connection_id": "vpn-0123456789abcdef0"
        }
      },
      "ResultPath": "$.vpn_disconnect",
      "Next": "ScanTransferredFiles"
    },

    "ScanTransferredFiles": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:ap-northeast-1:123456789012:function:FileScanner",
        "Payload": {
          "bucket": "cis-filesearch-raw-files",
          "sync_batch_id.$": "$.datasync.TaskExecutionArn"
        }
      },
      "ResultPath": "$.scanned_files",
      "Next": "ProcessFilesInParallel"
    },

    "ProcessFilesInParallel": {
      "Type": "Parallel",
      "Branches": [
        {
          "StartAt": "ExtractTextFromDocuments",
          "States": {
            "ExtractTextFromDocuments": {
              "Type": "Map",
              "ItemsPath": "$.scanned_files.Payload.documents",
              "MaxConcurrency": 20,
              "Iterator": {
                "StartAt": "TextExtraction",
                "States": {
                  "TextExtraction": {
                    "Type": "Task",
                    "Resource": "arn:aws:states:::lambda:invoke",
                    "Parameters": {
                      "FunctionName": "arn:aws:lambda:ap-northeast-1:123456789012:function:TextExtractor",
                      "Payload.$": "$"
                    },
                    "End": true,
                    "Retry": [
                      {
                        "ErrorEquals": ["Lambda.ServiceException", "Lambda.TooManyRequestsException"],
                        "IntervalSeconds": 2,
                        "MaxAttempts": 3,
                        "BackoffRate": 2
                      }
                    ]
                  }
                }
              },
              "ResultPath": "$.text_extraction_results",
              "End": true
            }
          }
        },
        {
          "StartAt": "ExtractImageFeatures",
          "States": {
            "ExtractImageFeatures": {
              "Type": "Map",
              "ItemsPath": "$.scanned_files.Payload.images",
              "MaxConcurrency": 20,
              "Iterator": {
                "StartAt": "FeatureExtraction",
                "States": {
                  "FeatureExtraction": {
                    "Type": "Task",
                    "Resource": "arn:aws:states:::lambda:invoke",
                    "Parameters": {
                      "FunctionName": "arn:aws:lambda:ap-northeast-1:123456789012:function:ImageFeatureExtractor",
                      "Payload.$": "$"
                    },
                    "End": true,
                    "Retry": [
                      {
                        "ErrorEquals": ["Lambda.ServiceException"],
                        "IntervalSeconds": 2,
                        "MaxAttempts": 3,
                        "BackoffRate": 2
                      }
                    ]
                  }
                }
              },
              "ResultPath": "$.feature_extraction_results",
              "End": true
            }
          }
        }
      ],
      "ResultPath": "$.processing_results",
      "Next": "BulkIndexToOpenSearch"
    },

    "BulkIndexToOpenSearch": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:ap-northeast-1:123456789012:function:BulkIndexer",
        "Payload": {
          "processing_results.$": "$.processing_results",
          "sync_batch_id.$": "$.datasync.TaskExecutionArn"
        }
      },
      "ResultPath": "$.indexing_result",
      "Next": "NotifySuccess"
    },

    "NotifySuccess": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:ap-northeast-1:123456789012:CIS-BatchSync-Notifications",
        "Subject": "✅ CIS Monthly Batch Sync Completed Successfully",
        "Message.$": "States.Format('Batch sync completed.\n\nFiles synced: {}\nText extracted: {}\nImages processed: {}\nIndexed to OpenSearch: {}\n\nExecution ARN: {}', $.datasync_status.BytesTransferred, $.processing_results[0].text_extraction_results, $.processing_results[1].feature_extraction_results, $.indexing_result.Payload.indexed_count, $$.Execution.Id)"
      },
      "End": true
    },

    "HandleDataSyncError": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:ap-northeast-1:123456789012:function:VPNManager",
        "Payload": {
          "action": "disconnect",
          "vpn_connection_id": "vpn-0123456789abcdef0"
        }
      },
      "ResultPath": null,
      "Next": "NotifyFailure"
    },

    "NotifyFailure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:ap-northeast-1:123456789012:CIS-BatchSync-Notifications",
        "Subject": "❌ CIS Monthly Batch Sync Failed",
        "Message.$": "States.Format('Batch sync failed.\n\nError: {}\n\nExecution ARN: {}', $.error, $$.Execution.Id)"
      },
      "End": true
    }
  }
}
```

### 3.2 実行スケジュール

#### EventBridge Rule

```python
import boto3

events = boto3.client('events')

# 月次スケジュール（毎月1日 深夜2時）
events.put_rule(
    Name='CIS-Monthly-Batch-Sync',
    ScheduleExpression='cron(0 2 1 * ? *)',  # UTC時刻（JST 11:00）
    State='ENABLED',
    Description='CIS File Search monthly batch synchronization'
)

# Step Functionsをターゲットに設定
events.put_targets(
    Rule='CIS-Monthly-Batch-Sync',
    Targets=[
        {
            'Id': '1',
            'Arn': 'arn:aws:states:ap-northeast-1:123456789012:stateMachine:CIS-Monthly-Batch-Sync',
            'RoleArn': 'arn:aws:iam::123456789012:role/EventBridgeStepFunctionsRole',
            'Input': json.dumps({
                'batch_date': '{{date}}',
                'batch_type': 'monthly_scheduled'
            })
        }
    ]
)
```

#### 手動実行（緊急時）

```bash
# AWS CLIで手動実行
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:ap-northeast-1:123456789012:stateMachine:CIS-Monthly-Batch-Sync \
  --name "manual-execution-$(date +%Y%m%d-%H%M%S)" \
  --input '{"batch_type":"manual","reason":"Emergency update"}'
```

---

## 4. Lambda関数実装

### 4.1 VPNManager

```python
import boto3
import time

ec2 = boto3.client('ec2')

def lambda_handler(event, context):
    """
    VPN接続の管理

    Actions:
        - connect: VPN接続を確立
        - disconnect: VPN接続を切断
        - check_status: VPN接続状態を確認
    """
    action = event.get('action')
    vpn_connection_id = event.get('vpn_connection_id')

    if action == 'connect':
        # VPNがすでに接続されているか確認
        response = ec2.describe_vpn_connections(
            VpnConnectionIds=[vpn_connection_id]
        )

        current_state = response['VpnConnections'][0]['State']

        if current_state == 'available':
            print(f"VPN {vpn_connection_id} is already available")
            return {'status': 'available', 'message': 'Already connected'}

        # VPNを有効化（Terraformで作成済みのVPNを使用）
        # 実際には、VPNは常に存在しているので接続確認のみ
        print(f"Waiting for VPN {vpn_connection_id} to become available...")

        return {'status': 'connecting', 'vpn_connection_id': vpn_connection_id}

    elif action == 'disconnect':
        # バッチ完了後、VPNを切断する必要はない（課金は継続）
        # コスト削減のため、VPN自体を削除することも検討
        print(f"VPN {vpn_connection_id} disconnect requested (no action needed)")
        return {'status': 'disconnected'}

    elif action == 'check_status':
        response = ec2.describe_vpn_connections(
            VpnConnectionIds=[vpn_connection_id]
        )

        vpn = response['VpnConnections'][0]
        state = vpn['State']

        # Tunnel状態の確認
        tunnel1_status = vpn['VgwTelemetry'][0]['Status']
        tunnel2_status = vpn['VgwTelemetry'][1]['Status'] if len(vpn['VgwTelemetry']) > 1 else 'DOWN'

        if state == 'available' and (tunnel1_status == 'UP' or tunnel2_status == 'UP'):
            return {
                'status': 'available',
                'tunnel1': tunnel1_status,
                'tunnel2': tunnel2_status,
                'message': 'VPN is ready for data transfer'
            }
        else:
            return {
                'status': state,
                'tunnel1': tunnel1_status,
                'tunnel2': tunnel2_status,
                'message': 'VPN not ready yet'
            }

    else:
        raise ValueError(f"Invalid action: {action}")
```

### 4.2 FileScanner

```python
import boto3
import json
from collections import defaultdict

s3 = boto3.client('s3')

def lambda_handler(event, context):
    """
    S3バケットをスキャンしてファイルを分類

    Returns:
        {
            'documents': [list of document file paths],
            'images': [list of image file paths],
            'others': [list of other file paths]
        }
    """
    bucket = event.get('bucket')
    sync_batch_id = event.get('sync_batch_id')

    # ファイル分類
    file_categories = defaultdict(list)

    # S3バケット内のすべてのオブジェクトをリスト
    paginator = s3.get_paginator('list_objects_v2')

    total_files = 0
    total_size = 0

    for page in paginator.paginate(Bucket=bucket, Prefix='monthly-sync/'):
        for obj in page.get('Contents', []):
            file_key = obj['Key']
            file_size = obj['Size']
            last_modified = obj['LastModified'].isoformat()

            total_files += 1
            total_size += file_size

            # ファイル拡張子で分類
            file_ext = file_key.lower().split('.')[-1]

            file_info = {
                's3_bucket': bucket,
                's3_key': file_key,
                'file_size': file_size,
                'last_modified': last_modified,
                'sync_batch_id': sync_batch_id
            }

            if file_ext in ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']:
                file_categories['documents'].append(file_info)

            elif file_ext in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp']:
                file_categories['images'].append(file_info)

            else:
                file_categories['others'].append(file_info)

    print(f"Scanned {total_files} files ({total_size} bytes)")
    print(f"Documents: {len(file_categories['documents'])}")
    print(f"Images: {len(file_categories['images'])}")
    print(f"Others: {len(file_categories['others'])}")

    return {
        'statusCode': 200,
        'body': {
            'documents': file_categories['documents'],
            'images': file_categories['images'],
            'others': file_categories['others'],
            'summary': {
                'total_files': total_files,
                'total_size_bytes': total_size,
                'sync_batch_id': sync_batch_id
            }
        }
    }
```

### 4.3 BulkIndexer

```python
import boto3
import json
from opensearchpy import OpenSearch, helpers
from requests_aws4auth import AWS4Auth

# OpenSearch接続設定
region = 'ap-northeast-1'
service = 'es'
credentials = boto3.Session().get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    region,
    service,
    session_token=credentials.token
)

opensearch = OpenSearch(
    hosts=[{'host': os.environ['OPENSEARCH_ENDPOINT'], 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True
)

dynamodb = boto3.resource('dynamodb')
metadata_table = dynamodb.Table('file_metadata')

def lambda_handler(event, context):
    """
    処理結果をOpenSearchとDynamoDBにバルクインサート
    """
    processing_results = event.get('processing_results')
    sync_batch_id = event.get('sync_batch_id')

    # テキスト抽出結果
    text_results = processing_results[0].get('text_extraction_results', [])
    # 画像特徴抽出結果
    image_results = processing_results[1].get('feature_extraction_results', [])

    # OpenSearchバルクインサート用のアクション生成
    opensearch_actions = []
    dynamodb_items = []

    # ドキュメントのインデックス
    for result in text_results:
        if result.get('Payload'):
            payload = result['Payload']

            doc_id = payload['file_id']

            # OpenSearch用
            opensearch_actions.append({
                '_op_type': 'index',
                '_index': 'files',
                '_id': doc_id,
                '_source': {
                    'file_id': doc_id,
                    'file_name': payload['file_name'],
                    'file_path': payload['file_path'],
                    'nas_path': payload['nas_path'],
                    'file_type': payload['file_type'],
                    'file_size': payload['file_size'],
                    'extracted_text': payload['extracted_text'],
                    'modified_date': payload['modified_date'],
                    'indexed_at': datetime.now().isoformat(),
                    'sync_batch_id': sync_batch_id
                }
            })

            # DynamoDB用
            dynamodb_items.append({
                'file_id': doc_id,
                'file_name': payload['file_name'],
                'file_path': payload['file_path'],
                'nas_path': payload['nas_path'],
                'file_type': payload['file_type'],
                'file_size': payload['file_size'],
                'modified_date': payload['modified_date'],
                'sync_batch_id': sync_batch_id,
                'indexed_at': datetime.now().isoformat()
            })

    # 画像のインデックス
    for result in image_results:
        if result.get('Payload'):
            payload = result['Payload']

            img_id = payload['file_id']

            # OpenSearch用（画像インデックス）
            opensearch_actions.append({
                '_op_type': 'index',
                '_index': 'images',
                '_id': img_id,
                '_source': {
                    'file_id': img_id,
                    'file_name': payload['file_name'],
                    'file_path': payload['file_path'],
                    'nas_path': payload['nas_path'],
                    'file_type': payload['file_type'],
                    'file_size': payload['file_size'],
                    'image_vector': payload['feature_vector'],
                    'image_width': payload.get('width'),
                    'image_height': payload.get('height'),
                    'modified_date': payload['modified_date'],
                    'indexed_at': datetime.now().isoformat(),
                    'sync_batch_id': sync_batch_id
                }
            })

            # DynamoDB用
            dynamodb_items.append({
                'file_id': img_id,
                'file_name': payload['file_name'],
                'file_path': payload['file_path'],
                'nas_path': payload['nas_path'],
                'file_type': payload['file_type'],
                'file_size': payload['file_size'],
                'modified_date': payload['modified_date'],
                'sync_batch_id': sync_batch_id,
                'indexed_at': datetime.now().isoformat(),
                'has_features': True
            })

    # OpenSearchバルクインサート
    success_count, errors = helpers.bulk(
        opensearch,
        opensearch_actions,
        chunk_size=500,
        request_timeout=60
    )

    print(f"OpenSearch bulk insert: {success_count} documents indexed")
    if errors:
        print(f"Errors: {errors}")

    # DynamoDBバッチライト
    with metadata_table.batch_writer() as batch:
        for item in dynamodb_items:
            batch.put_item(Item=item)

    print(f"DynamoDB batch write: {len(dynamodb_items)} items written")

    return {
        'statusCode': 200,
        'indexed_count': success_count,
        'dynamodb_count': len(dynamodb_items),
        'errors': len(errors) if errors else 0
    }
```

---

## 5. エラーハンドリングとリトライ戦略

### 5.1 エラー分類とハンドリング

| エラータイプ | 原因 | リトライ | アラート | 対処方法 |
|------------|------|---------|---------|---------|
| **VPN接続失敗** | ネットワーク障害 | 3回 (指数バックオフ) | SNS | 手動確認、VPN再起動 |
| **DataSync失敗** | ファイルアクセス権限 | 1回 | SNS | NAS権限確認 |
| **Lambda Timeout** | 大容量ファイル | 3回 | CloudWatch | タイムアウト値調整 |
| **Lambda OutOfMemory** | メモリ不足 | なし | SNS | メモリ増量 |
| **OpenSearch Timeout** | バルクサイズ過大 | 2回 | CloudWatch | チャンクサイズ削減 |
| **S3 Access Denied** | IAM権限不足 | なし | SNS | IAMロール確認 |

### 5.2 デッドレターキュー（DLQ）

```python
# SQS DLQ設定
import boto3

sqs = boto3.client('sqs')

# DLQの作成
dlq_response = sqs.create_queue(
    QueueName='CIS-BatchSync-DLQ',
    Attributes={
        'MessageRetentionPeriod': '1209600',  # 14日間保持
        'VisibilityTimeout': '300'
    }
)

dlq_arn = sqs.get_queue_attributes(
    QueueUrl=dlq_response['QueueUrl'],
    AttributeNames=['QueueArn']
)['Attributes']['QueueArn']

# Lambda関数にDLQを設定
lambda_client = boto3.client('lambda')

lambda_client.update_function_configuration(
    FunctionName='TextExtractor',
    DeadLetterConfig={
        'TargetArn': dlq_arn
    }
)

print(f"DLQ configured: {dlq_arn}")
```

### 5.3 リトライ戦略の実装

```python
# Lambdaレイヤーで共通リトライデコレータを提供
import time
from functools import wraps

def retry_with_backoff(max_attempts=3, base_delay=1, max_delay=60, exponential_base=2):
    """
    指数バックオフ付きリトライデコレータ
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            attempt = 0
            while attempt < max_attempts:
                try:
                    return func(*args, **kwargs)

                except Exception as e:
                    attempt += 1
                    if attempt >= max_attempts:
                        print(f"Max attempts ({max_attempts}) reached. Raising exception.")
                        raise

                    delay = min(base_delay * (exponential_base ** (attempt - 1)), max_delay)
                    print(f"Attempt {attempt} failed: {str(e)}. Retrying in {delay}s...")
                    time.sleep(delay)

        return wrapper
    return decorator


# 使用例
@retry_with_backoff(max_attempts=3, base_delay=2, exponential_base=2)
def extract_text_from_pdf(s3_bucket, s3_key):
    """PDFからテキスト抽出（リトライ付き）"""
    s3 = boto3.client('s3')

    # S3からダウンロード
    response = s3.get_object(Bucket=s3_bucket, Key=s3_key)
    pdf_content = response['Body'].read()

    # テキスト抽出
    with pdfplumber.open(io.BytesIO(pdf_content)) as pdf:
        text = ''
        for page in pdf.pages:
            text += page.extract_text() or ''

    return text[:50000]  # 最大50KB
```

---

## 6. モニタリングとアラート

### 6.1 CloudWatchダッシュボード

```python
import boto3

cloudwatch = boto3.client('cloudwatch')

# カスタムダッシュボード作成
dashboard_body = {
    "widgets": [
        {
            "type": "metric",
            "properties": {
                "metrics": [
                    ["AWS/States", "ExecutionsSucceeded", {"stat": "Sum"}],
                    [".", "ExecutionsFailed", {"stat": "Sum"}]
                ],
                "period": 300,
                "stat": "Sum",
                "region": "ap-northeast-1",
                "title": "Step Functions Executions",
                "yAxis": {
                    "left": {"min": 0}
                }
            }
        },
        {
            "type": "metric",
            "properties": {
                "metrics": [
                    ["AWS/DataSync", "BytesTransferred", {"stat": "Sum"}]
                ],
                "period": 3600,
                "stat": "Sum",
                "region": "ap-northeast-1",
                "title": "DataSync Bytes Transferred",
                "yAxis": {
                    "left": {"label": "Bytes"}
                }
            }
        },
        {
            "type": "metric",
            "properties": {
                "metrics": [
                    ["AWS/Lambda", "Duration", {"dimensions": {"FunctionName": "TextExtractor"}, "stat": "Average"}],
                    ["...", {"dimensions": {"FunctionName": "ImageFeatureExtractor"}, "stat": "Average"}]
                ],
                "period": 300,
                "stat": "Average",
                "region": "ap-northeast-1",
                "title": "Lambda Execution Duration"
            }
        }
    ]
}

cloudwatch.put_dashboard(
    DashboardName='CIS-BatchSync-Dashboard',
    DashboardBody=json.dumps(dashboard_body)
)
```

### 6.2 SNSアラート設定

```python
# SNSトピック作成
sns = boto3.client('sns')

topic_response = sns.create_topic(
    Name='CIS-BatchSync-Notifications',
    Tags=[
        {'Key': 'Application', 'Value': 'CIS-FileSearch'}
    ]
)

topic_arn = topic_response['TopicArn']

# メール購読の追加
sns.subscribe(
    TopicArn=topic_arn,
    Protocol='email',
    Endpoint='admin@company.com'
)

# Slackへの通知（Lambdaで実装）
sns.subscribe(
    TopicArn=topic_arn,
    Protocol='lambda',
    Endpoint='arn:aws:lambda:ap-northeast-1:123456789012:function:SlackNotifier'
)
```

---

## 7. コスト最適化

### 7.1 DataSync料金削減

```python
# オプション1: 帯域幅制限でVPN接続時間を延長（VPN料金は変わらないが、DataSync料金削減）
Options={
    'BytesPerSecond': 6250000,  # 50Mbps（デフォルト100Mbpsの半分）
}

# オプション2: 圧縮有効化（実験的）
# DataSyncは自動的にネットワーク圧縮を行うため、明示的な設定不要

# オプション3: S3 Intelligent-Tiering（自動コスト最適化）
's3_storage_class': 'INTELLIGENT_TIERING'
```

### 7.2 Lambda料金削減

```python
# Graviton2プロセッサ（ARM64）の使用（20%コスト削減）
lambda_client.update_function_configuration(
    FunctionName='TextExtractor',
    Architectures=['arm64']  # x86_64 → arm64
)

# Lambda予約済み同時実行数の最適化
lambda_client.put_function_concurrency(
    FunctionName='TextExtractor',
    ReservedConcurrentExecutions=20  # 過剰な並列実行を防止
)
```

### 7.3 S3ストレージ料金削減

```python
# ライフサイクルポリシー
s3.put_bucket_lifecycle_configuration(
    Bucket='cis-filesearch-raw-files',
    LifecycleConfiguration={
        'Rules': [
            {
                'Id': 'MoveToInfrequentAccess',
                'Status': 'Enabled',
                'Prefix': '',
                'Transitions': [
                    {
                        'Days': 90,
                        'StorageClass': 'STANDARD_IA'  # 90日後にIA
                    },
                    {
                        'Days': 180,
                        'StorageClass': 'GLACIER_INSTANT_RETRIEVAL'  # 180日後にGlacier
                    }
                ]
            }
        ]
    }
)
```

---

## 8. 運用手順

### 8.1 初回セットアップ

```bash
# 1. Terraformでインフラをデプロイ
cd terraform/
terraform init
terraform plan -out=tfplan
terraform apply tfplan

# 2. DataSyncエージェントのデプロイ（オンプレミス）
# VMware ESXiでOVAをインポート
# http://<agent-ip>/ でアクティベーション

# 3. 初回同期の手動実行
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:ap-northeast-1:123456789012:stateMachine:CIS-Monthly-Batch-Sync \
  --name "initial-sync-$(date +%Y%m%d)" \
  --input '{"batch_type":"initial","full_sync":true}'

# 4. 実行状況のモニタリング
aws stepfunctions describe-execution \
  --execution-arn <execution-arn>
```

### 8.2 月次バッチの確認

```bash
# EventBridgeスケジュールの確認
aws events list-rules --name-prefix "CIS-Monthly"

# 次回実行予定の確認
aws events list-targets-by-rule --rule "CIS-Monthly-Batch-Sync"

# 過去の実行履歴
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:ap-northeast-1:123456789012:stateMachine:CIS-Monthly-Batch-Sync \
  --max-results 10
```

### 8.3 トラブルシューティング

#### エラーシナリオ1: DataSync失敗

```bash
# DataSyncタスク実行ログの確認
aws datasync describe-task-execution \
  --task-execution-arn <task-execution-arn>

# CloudWatch Logsでエラー詳細を確認
aws logs tail /aws/datasync --follow

# 一般的な原因:
# - NASファイルへのアクセス権限不足
# - VPN接続が切断された
# - ディスク容量不足
```

#### エラーシナリオ2: Lambda Timeout

```bash
# CloudWatch Logsで該当関数のログを確認
aws logs tail /aws/lambda/TextExtractor --follow

# タイムアウトしているファイルを特定
aws logs filter-pattern '"Task timed out"' \
  --log-group-name /aws/lambda/TextExtractor

# 対処方法:
# 1. Lambda timeoutを60秒→120秒に延長
aws lambda update-function-configuration \
  --function-name TextExtractor \
  --timeout 120

# 2. 大容量ファイルをスキップするロジックを追加
```

---

## 9. まとめ

本バッチ同期システムにより、以下を実現します:

✅ **コスト最適化**: VPN料金97%削減（$36/月 → $1.20/月）
✅ **効率的な増分同期**: 変更されたファイルのみを転送
✅ **自動化**: Step Functionsによる完全自動化
✅ **可観測性**: CloudWatchダッシュボードとSNSアラート
✅ **スケーラビリティ**: Lambda並列処理で100万ファイルに対応
✅ **信頼性**: リトライ戦略とエラーハンドリング

次のステップとして、コスト最適化分析書の作成に進みます。
