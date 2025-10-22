# 実装ロードマップ（月次バッチ最適化版）

## Executive Summary

本ロードマップは、CIS File Search Applicationの月次バッチ最適化アーキテクチャの8週間実装計画を記述します。段階的な実装により、リスクを最小化しながら確実にシステムを構築します。

### プロジェクト概要

- **実装期間**: 8週間（2ヶ月）
- **主要技術**: AWS（VPN, DataSync, Lambda, OpenSearch, S3, Step Functions）
- **開発手法**: アジャイル、週次スプリント
- **テスト戦略**: TDD、CI/CD自動化

### 主要マイルストーン

| Week | フェーズ | 主要成果物 | 完了条件 |
|------|---------|-----------|---------|
| **Week 1-2** | インフラ基盤 | VPN, DataSync, AWS基盤 | Terraformでの自動構築完了 |
| **Week 3-4** | バッチ処理 | Lambda関数, Step Functions | 初回同期成功 |
| **Week 5-6** | 検索機能 | OpenSearch, 検索API | 類似検索精度80%以上 |
| **Week 7-8** | 統合・本番化 | E2Eテスト, 本番デプロイ | ユーザー受入テスト合格 |

---

## Week 1-2: インフラ基盤構築

### 目標

AWS基盤をTerraformで構築し、NAS-AWS間のVPN接続とDataSync設定を完了する。

### タスク一覧

#### Week 1

**Day 1-2: プロジェクト環境セットアップ**

```bash
# タスク詳細
✅ AWSアカウントセットアップ
  - IAMユーザー作成（Administrator権限）
  - MFA有効化
  - アクセスキー発行

✅ Terraform環境構築
  - Terraform 1.6+ インストール
  - AWS Provider設定
  - S3バックエンド設定（tfstateファイル保存）

✅ リポジトリ構成
  terraform/
  ├── modules/
  │   ├── vpc/
  │   ├── vpn/
  │   ├── datasync/
  │   ├── lambda/
  │   ├── opensearch/
  │   └── s3/
  ├── environments/
  │   ├── dev/
  │   └── prod/
  └── main.tf

✅ CI/CD環境
  - GitHub Actions設定
  - Terraform plan/apply自動化
```

**Day 3-4: VPNとネットワーク構築**

```hcl
# terraform/modules/vpn/main.tf
resource "aws_vpn_gateway" "main" {
  vpc_id = var.vpc_id

  tags = {
    Name = "CIS-FileSearch-VGW"
  }
}

resource "aws_customer_gateway" "onprem" {
  bgp_asn    = 65000
  ip_address = var.onprem_public_ip
  type       = "ipsec.1"

  tags = {
    Name = "CIS-NAS-Customer-Gateway"
  }
}

resource "aws_vpn_connection" "main" {
  vpn_gateway_id      = aws_vpn_gateway.main.id
  customer_gateway_id = aws_customer_gateway.onprem.id
  type                = "ipsec.1"
  static_routes_only  = true

  tags = {
    Name = "CIS-NAS-VPN-Connection"
  }
}

resource "aws_vpn_connection_route" "nas_subnet" {
  destination_cidr_block = var.nas_cidr_block
  vpn_connection_id      = aws_vpn_connection.main.id
}
```

**テスト**:
```bash
# VPN接続テスト
ping <NAS-Private-IP>
```

**Day 5: S3、DynamoDB、OpenSearch構築**

```hcl
# terraform/modules/s3/main.tf
resource "aws_s3_bucket" "raw_files" {
  bucket = "cis-filesearch-raw-files-${var.environment}"

  tags = {
    Environment = var.environment
  }
}

resource "aws_s3_bucket_intelligent_tiering_configuration" "raw_files" {
  bucket = aws_s3_bucket.raw_files.id
  name   = "EntireBucket"

  tiering {
    access_tier = "DEEP_ARCHIVE_ACCESS"
    days        = 180
  }

  tiering {
    access_tier = "ARCHIVE_ACCESS"
    days        = 90
  }
}

# terraform/modules/opensearch/main.tf
resource "aws_opensearch_domain" "main" {
  domain_name    = "cis-filesearch"
  engine_version = "OpenSearch_2.11"

  cluster_config {
    instance_type          = "t3.small.search"
    instance_count         = 1
    zone_awareness_enabled = false
  }

  ebs_options {
    ebs_enabled = true
    volume_size = 50
    volume_type = "gp3"
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }
}

# terraform/modules/dynamodb/main.tf
resource "aws_dynamodb_table" "file_metadata" {
  name           = "file_metadata"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "file_id"
  range_key      = "sync_batch_id"

  attribute {
    name = "file_id"
    type = "S"
  }

  attribute {
    name = "sync_batch_id"
    type = "S"
  }

  tags = {
    Environment = var.environment
  }
}
```

#### Week 2

**Day 1-2: DataSyncエージェントデプロイ**

```bash
# オンプレミス環境での作業

1. VMware ESXiにDataSync Agent OVAをデプロイ
   - OVAファイルダウンロード: https://aws.amazon.com/datasync/
   - vSphere Clientでインポート
   - ネットワーク設定（静的IP推奨）

2. エージェントアクティベーション
   curl -i "http://<agent-ip>/?activationRegion=ap-northeast-1"

3. AWS CLIでエージェント登録
   aws datasync create-agent \
     --agent-name "CIS-NAS-Agent" \
     --activation-key <ACTIVATION_KEY> \
     --region ap-northeast-1
```

**Day 3-4: DataSyncタスク作成とテスト**

```python
# scripts/create_datasync_task.py
import boto3

datasync = boto3.client('datasync', region_name='ap-northeast-1')

# SMBロケーション作成
smb_location = datasync.create_location_smb(
    Subdirectory='/shared/documents',
    ServerHostname='nas01.company.local',
    User='datasync-user',
    Password='<password>',
    AgentArns=[
        'arn:aws:datasync:ap-northeast-1:123456789012:agent/agent-xxx'
    ],
    MountOptions={'Version': 'SMB3'}
)

# S3ロケーション作成
s3_location = datasync.create_location_s3(
    S3BucketArn='arn:aws:s3:::cis-filesearch-raw-files',
    Subdirectory='/monthly-sync',
    S3Config={
        'BucketAccessRoleArn': 'arn:aws:iam::123456789012:role/DataSyncS3Role'
    },
    S3StorageClass='INTELLIGENT_TIERING'
)

# タスク作成
task = datasync.create_task(
    SourceLocationArn=smb_location['LocationArn'],
    DestinationLocationArn=s3_location['LocationArn'],
    Name='CIS-Monthly-Batch-Sync',
    Options={
        'VerifyMode': 'POINT_IN_TIME_CONSISTENT',
        'TransferMode': 'CHANGED',
        'BytesPerSecond': 12500000,  # 100Mbps
    },
    CloudWatchLogGroupArn='arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/datasync'
)

print(f"Task ARN: {task['TaskArn']}")
```

**Day 5: Week 1-2完了確認とレビュー**

**完了条件チェックリスト**:
- [ ] Terraformでの全リソース作成成功
- [ ] VPN接続確立（ping疎通確認）
- [ ] DataSync Agent稼働中
- [ ] DataSyncタスク作成完了
- [ ] S3、DynamoDB、OpenSearchアクセス可能
- [ ] IAMロール・ポリシー適切に設定

**Week 2成果物**:
- `terraform/` ディレクトリ（完全なIaCコード）
- DataSync Task ARN
- 環境変数ファイル（`.env.production`）

---

## Week 3-4: バッチ処理実装

### 目標

Lambda関数を実装し、Step Functionsでバッチ処理を自動化する。初回同期を成功させる。

### タスク一覧

#### Week 3

**Day 1-2: Lambda関数の基本実装**

```python
# lambda/text_extractor/handler.py
import json
import io
import boto3
import pdfplumber
from docx import Document

s3 = boto3.client('s3')

def lambda_handler(event, context):
    """
    PDF/Office文書からテキストを抽出
    """
    bucket = event['s3_bucket']
    key = event['s3_key']

    # S3からファイルダウンロード
    response = s3.get_object(Bucket=bucket, Key=key)
    file_content = response['Body'].read()
    file_type = key.split('.')[-1].lower()

    # テキスト抽出
    if file_type == 'pdf':
        text = extract_pdf_text(file_content)
    elif file_type in ['docx', 'doc']:
        text = extract_docx_text(file_content)
    else:
        text = ''

    return {
        'statusCode': 200,
        'file_id': event.get('file_id'),
        'file_name': key.split('/')[-1],
        'extracted_text': text[:50000],  # 最大50KB
        'text_length': len(text)
    }

def extract_pdf_text(file_content):
    with pdfplumber.open(io.BytesIO(file_content)) as pdf:
        text = ''
        for page in pdf.pages:
            text += page.extract_text() or ''
    return text

def extract_docx_text(file_content):
    doc = Document(io.BytesIO(file_content))
    return '\n'.join([para.text for para in doc.paragraphs])
```

```python
# lambda/image_feature_extractor/handler.py
import json
import io
import boto3
import torch
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image
import numpy as np

s3 = boto3.client('s3')

# グローバル変数（Lambda再利用時に高速化）
model = None

def initialize_model():
    global model
    if model is None:
        resnet = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
        model = torch.nn.Sequential(*list(resnet.children())[:-1])
        model.eval()

def lambda_handler(event, context):
    """
    画像から特徴ベクトルを抽出
    """
    initialize_model()

    bucket = event['s3_bucket']
    key = event['s3_key']

    # S3から画像ダウンロード
    response = s3.get_object(Bucket=bucket, Key=key)
    image_bytes = response['Body'].read()

    # 特徴抽出
    feature_vector = extract_features(image_bytes)

    return {
        'statusCode': 200,
        'file_id': event.get('file_id'),
        'file_name': key.split('/')[-1],
        'feature_vector': feature_vector,
        'dimension': len(feature_vector)
    }

def extract_features(image_bytes):
    transform = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225]
        ),
    ])

    image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    input_tensor = transform(image).unsqueeze(0)

    with torch.no_grad():
        features = model(input_tensor)

    feature_vector = features.squeeze().numpy()[:512]

    # 正規化
    norm = np.linalg.norm(feature_vector)
    if norm > 0:
        feature_vector = feature_vector / norm

    return feature_vector.tolist()
```

**Lambda Deployment**:

```bash
# Docker build for Lambda layer (PyTorch)
cd lambda/layers/pytorch
docker build -t lambda-pytorch-layer .
docker run --rm -v $(pwd):/out lambda-pytorch-layer cp /opt/layer.zip /out/

# Upload to S3
aws s3 cp layer.zip s3://cis-lambda-layers/pytorch-layer.zip

# Create Lambda layer
aws lambda publish-layer-version \
  --layer-name pytorch-cpu \
  --content S3Bucket=cis-lambda-layers,S3Key=pytorch-layer.zip \
  --compatible-runtimes python3.12 \
  --compatible-architectures arm64

# Deploy Lambda functions
cd lambda/text_extractor
zip function.zip handler.py requirements.txt
aws lambda create-function \
  --function-name TextExtractor \
  --runtime python3.12 \
  --role arn:aws:iam::123456789012:role/LambdaExecutionRole \
  --handler handler.lambda_handler \
  --zip-file fileb://function.zip \
  --timeout 60 \
  --memory-size 2048 \
  --architectures arm64
```

**Day 3-4: Step Functions実装**

```json
// step_functions/batch_sync_workflow.json
{
  "Comment": "CIS Monthly Batch Sync Workflow",
  "StartAt": "EstablishVPN",
  "States": {
    "EstablishVPN": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "VPNManager",
        "Payload": {"action": "connect"}
      },
      "Next": "WaitForVPN"
    },
    "WaitForVPN": {
      "Type": "Wait",
      "Seconds": 300,
      "Next": "StartDataSync"
    },
    "StartDataSync": {
      "Type": "Task",
      "Resource": "arn:aws:states:::aws-sdk:datasync:startTaskExecution",
      "Parameters": {
        "TaskArn": "arn:aws:datasync:ap-northeast-1:123456789012:task/task-xxx"
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
      "Next": "IsDataSyncComplete"
    },
    "IsDataSyncComplete": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.Status",
          "StringEquals": "SUCCESS",
          "Next": "DisconnectVPN"
        }
      ],
      "Default": "WaitForDataSync"
    },
    "DisconnectVPN": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "VPNManager",
        "Payload": {"action": "disconnect"}
      },
      "Next": "ProcessFiles"
    },
    "ProcessFiles": {
      "Type": "Parallel",
      "Branches": [
        {
          "StartAt": "ExtractText",
          "States": {
            "ExtractText": {
              "Type": "Map",
              "ItemsPath": "$.documents",
              "MaxConcurrency": 20,
              "Iterator": {
                "StartAt": "TextExtraction",
                "States": {
                  "TextExtraction": {
                    "Type": "Task",
                    "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:TextExtractor",
                    "End": true
                  }
                }
              },
              "End": true
            }
          }
        },
        {
          "StartAt": "ExtractFeatures",
          "States": {
            "ExtractFeatures": {
              "Type": "Map",
              "ItemsPath": "$.images",
              "MaxConcurrency": 20,
              "Iterator": {
                "StartAt": "FeatureExtraction",
                "States": {
                  "FeatureExtraction": {
                    "Type": "Task",
                    "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:ImageFeatureExtractor",
                    "End": true
                  }
                }
              },
              "End": true
            }
          }
        }
      ],
      "Next": "IndexToOpenSearch"
    },
    "IndexToOpenSearch": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:123456789012:function:BulkIndexer",
      "End": true
    }
  }
}
```

**Day 5: ユニットテスト実装**

```python
# tests/test_text_extractor.py
import pytest
import json
from lambda.text_extractor.handler import lambda_handler, extract_pdf_text

def test_extract_pdf_text():
    with open('tests/fixtures/sample.pdf', 'rb') as f:
        pdf_content = f.read()

    text = extract_pdf_text(pdf_content)

    assert len(text) > 0
    assert 'expected text' in text.lower()

def test_lambda_handler(mocker):
    # S3 mock
    mocker.patch('boto3.client')
    s3_mock = mocker.MagicMock()
    s3_mock.get_object.return_value = {
        'Body': mocker.MagicMock(read=lambda: open('tests/fixtures/sample.pdf', 'rb').read())
    }

    event = {
        's3_bucket': 'test-bucket',
        's3_key': 'test.pdf',
        'file_id': 'file_123'
    }

    result = lambda_handler(event, None)

    assert result['statusCode'] == 200
    assert result['file_id'] == 'file_123'
    assert len(result['extracted_text']) > 0
```

#### Week 4

**Day 1-2: 初回同期実行とデバッグ**

```bash
# Step Functions手動実行
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:ap-northeast-1:123456789012:stateMachine:CIS-Batch-Sync \
  --name "initial-sync-$(date +%Y%m%d)" \
  --input '{"batch_type":"initial","full_sync":true}'

# 実行状況モニタリング
aws stepfunctions describe-execution \
  --execution-arn <execution-arn>

# CloudWatch Logsでデバッグ
aws logs tail /aws/lambda/TextExtractor --follow
aws logs tail /aws/lambda/ImageFeatureExtractor --follow
```

**Day 3-4: エラーハンドリングとリトライ実装**

```python
# lambda/common/retry_decorator.py
import time
from functools import wraps

def retry_with_backoff(max_attempts=3, base_delay=1):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts - 1:
                        raise
                    delay = base_delay * (2 ** attempt)
                    print(f"Attempt {attempt + 1} failed: {e}. Retrying in {delay}s...")
                    time.sleep(delay)
        return wrapper
    return decorator
```

**Day 5: Week 3-4完了確認**

**完了条件チェックリスト**:
- [ ] 全Lambda関数デプロイ完了
- [ ] Step Functions実行成功
- [ ] 初回同期完了（500GB転送）
- [ ] OpenSearchにインデックス作成確認
- [ ] ユニットテスト全通過（カバレッジ80%以上）
- [ ] エラーハンドリング実装完了

**Week 4成果物**:
- Lambda関数（TextExtractor, ImageFeatureExtractor, BulkIndexer）
- Step Functions定義
- ユニットテストスイート

---

## Week 5-6: 検索機能実装

### 目標

OpenSearchの設定を完了し、全文検索と画像類似検索APIを実装する。

#### Week 5

**Day 1-2: OpenSearchインデックス設計と作成**

```python
# scripts/create_opensearch_indices.py
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import boto3

# OpenSearch接続
region = 'ap-northeast-1'
credentials = boto3.Session().get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    region,
    'es',
    session_token=credentials.token
)

client = OpenSearch(
    hosts=[{'host': 'search-xxx.ap-northeast-1.es.amazonaws.com', 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection
)

# ファイルインデックス
files_index = {
    "settings": {
        "index": {
            "number_of_shards": 2,
            "number_of_replicas": 1
        },
        "analysis": {
            "analyzer": {
                "japanese_analyzer": {
                    "type": "custom",
                    "tokenizer": "kuromoji_tokenizer",
                    "filter": ["kuromoji_baseform", "kuromoji_part_of_speech", "cjk_width", "lowercase"]
                }
            }
        }
    },
    "mappings": {
        "properties": {
            "file_id": {"type": "keyword"},
            "file_name": {
                "type": "text",
                "analyzer": "japanese_analyzer",
                "fields": {"keyword": {"type": "keyword"}}
            },
            "file_path": {"type": "keyword"},
            "extracted_text": {
                "type": "text",
                "analyzer": "japanese_analyzer"
            },
            "file_type": {"type": "keyword"},
            "file_size": {"type": "long"},
            "modified_date": {"type": "date"}
        }
    }
}

client.indices.create(index='files', body=files_index)

# 画像インデックス
images_index = {
    "settings": {
        "index": {
            "number_of_shards": 2,
            "number_of_replicas": 1,
            "knn": True,
            "knn.algo_param.ef_search": 512
        }
    },
    "mappings": {
        "properties": {
            "file_id": {"type": "keyword"},
            "file_name": {"type": "text"},
            "file_path": {"type": "keyword"},
            "image_vector": {
                "type": "knn_vector",
                "dimension": 512,
                "method": {
                    "name": "hnsw",
                    "space_type": "cosinesimil",
                    "engine": "nmslib",
                    "parameters": {
                        "ef_construction": 512,
                        "m": 16
                    }
                }
            },
            "modified_date": {"type": "date"}
        }
    }
}

client.indices.create(index='images', body=images_index)
```

**Day 3-4: 検索API実装**

```python
# lambda/search_api/handler.py
import json
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

# OpenSearch接続（グローバル変数）
region = 'ap-northeast-1'
credentials = boto3.Session().get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    region,
    'es',
    session_token=credentials.token
)

opensearch = OpenSearch(
    hosts=[{'host': os.environ['OPENSEARCH_ENDPOINT'], 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection
)

def lambda_handler(event, context):
    """
    全文検索API
    """
    body = json.loads(event.get('body', '{}'))

    query = body.get('query', '')
    filters = body.get('filters', {})
    page = body.get('page', 1)
    size = body.get('size', 20)

    # OpenSearch検索クエリ
    search_body = {
        "from": (page - 1) * size,
        "size": size,
        "query": {
            "bool": {
                "must": [
                    {
                        "multi_match": {
                            "query": query,
                            "fields": ["file_name^2", "extracted_text"],
                            "type": "best_fields",
                            "operator": "and"
                        }
                    }
                ],
                "filter": build_filters(filters)
            }
        },
        "highlight": {
            "fields": {
                "extracted_text": {
                    "fragment_size": 150,
                    "number_of_fragments": 3
                }
            }
        },
        "sort": [
            {"_score": {"order": "desc"}},
            {"modified_date": {"order": "desc"}}
        ]
    }

    response = opensearch.search(index='files', body=search_body)

    results = []
    for hit in response['hits']['hits']:
        results.append({
            'file_id': hit['_source']['file_id'],
            'file_name': hit['_source']['file_name'],
            'file_path': hit['_source']['file_path'],
            'file_type': hit['_source']['file_type'],
            'score': hit['_score'],
            'highlights': hit.get('highlight', {}).get('extracted_text', []),
            'modified_date': hit['_source']['modified_date']
        })

    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps({
            'total': response['hits']['total']['value'],
            'results': results,
            'page': page,
            'size': size
        })
    }

def build_filters(filters):
    filter_clauses = []

    if 'file_type' in filters and filters['file_type']:
        filter_clauses.append({
            'terms': {'file_type': filters['file_type']}
        })

    if 'date_range' in filters:
        filter_clauses.append({
            'range': {
                'modified_date': {
                    'gte': filters['date_range'].get('from'),
                    'lte': filters['date_range'].get('to')
                }
            }
        })

    return filter_clauses
```

**Day 5: 画像類似検索API実装**

```python
# lambda/image_search_api/handler.py
import json
import base64
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

lambda_client = boto3.client('lambda')

def lambda_handler(event, context):
    """
    画像類似検索API
    """
    body = json.loads(event.get('body', '{}'))

    image_base64 = body.get('image')
    top_k = body.get('top_k', 20)
    min_score = body.get('min_score', 0.7)

    # 1. 画像から特徴ベクトル抽出
    feature_response = lambda_client.invoke(
        FunctionName=os.environ['FEATURE_EXTRACTOR_FUNCTION'],
        InvocationType='RequestResponse',
        Payload=json.dumps({'body': json.dumps({'image': image_base64})})
    )

    feature_result = json.loads(feature_response['Payload'].read())
    query_vector = json.loads(feature_result['body'])['feature_vector']

    # 2. OpenSearch k-NN検索
    search_body = {
        "size": top_k,
        "query": {
            "script_score": {
                "query": {"match_all": {}},
                "script": {
                    "source": "cosineSimilarity(params.query_vector, 'image_vector') + 1.0",
                    "params": {"query_vector": query_vector}
                }
            }
        }
    }

    response = opensearch.search(index='images', body=search_body)

    # 3. 結果フィルタリング
    results = []
    for hit in response['hits']['hits']:
        score = hit['_score'] - 1.0  # Cosine類似度に戻す

        if score >= min_score:
            results.append({
                'file_id': hit['_source']['file_id'],
                'file_name': hit['_source']['file_name'],
                'file_path': hit['_source']['file_path'],
                'similarity_score': round(score, 4),
                'modified_date': hit['_source']['modified_date']
            })

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({
            'total': len(results),
            'results': results
        })
    }
```

#### Week 6

**Day 1-2: API Gateway設定**

```yaml
# serverless.yml (Serverless Frameworkを使用する場合)
service: cis-filesearch-api

provider:
  name: aws
  runtime: python3.12
  region: ap-northeast-1
  stage: ${opt:stage, 'dev'}

functions:
  search:
    handler: lambda/search_api/handler.lambda_handler
    events:
      - http:
          path: /api/v1/search
          method: post
          cors: true

  imageSearch:
    handler: lambda/image_search_api/handler.lambda_handler
    events:
      - http:
          path: /api/v1/images/search
          method: post
          cors: true
```

**Day 3-4: 統合テスト**

```python
# tests/integration/test_search_api.py
import pytest
import requests
import json

BASE_URL = 'https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod'

def test_full_text_search():
    response = requests.post(
        f'{BASE_URL}/api/v1/search',
        json={
            'query': '契約書',
            'page': 1,
            'size': 20
        }
    )

    assert response.status_code == 200
    data = response.json()
    assert 'results' in data
    assert data['total'] > 0

def test_image_similarity_search():
    with open('tests/fixtures/test_image.jpg', 'rb') as f:
        image_base64 = base64.b64encode(f.read()).decode()

    response = requests.post(
        f'{BASE_URL}/api/v1/images/search',
        json={
            'image': image_base64,
            'top_k': 10,
            'min_score': 0.7
        }
    )

    assert response.status_code == 200
    data = response.json()
    assert 'results' in data
```

**Day 5: パフォーマンステスト**

```python
# tests/performance/load_test.py
from locust import HttpUser, task, between

class SearchUser(HttpUser):
    wait_time = between(1, 3)

    @task(3)
    def search_files(self):
        self.client.post('/api/v1/search', json={
            'query': 'test query',
            'page': 1,
            'size': 20
        })

    @task(1)
    def search_images(self):
        self.client.post('/api/v1/images/search', json={
            'image': 'base64-encoded-image',
            'top_k': 10
        })

# 実行: locust -f tests/performance/load_test.py --host https://xxx.execute-api.ap-northeast-1.amazonaws.com
```

**完了条件チェックリスト**:
- [ ] OpenSearchインデックス作成完了
- [ ] 全文検索API実装・テスト合格
- [ ] 画像類似検索API実装・テスト合格
- [ ] API Gateway設定完了
- [ ] 負荷テスト実施（100req/s耐性確認）
- [ ] レスポンスタイム < 200ms（p99）

---

## Week 7-8: 統合テスト・本番デプロイ

### 目標

E2Eテストを実施し、本番環境へデプロイ。ユーザートレーニングを実施する。

#### Week 7

**Day 1-2: E2Eテスト**

```python
# tests/e2e/test_end_to_end.py
import pytest
import time

def test_monthly_batch_workflow():
    """
    月次バッチワークフロー全体のE2Eテスト
    """
    # 1. Step Functions実行
    execution_arn = start_step_functions_execution()

    # 2. 完了待機（最大2時間）
    status = wait_for_completion(execution_arn, timeout=7200)
    assert status == 'SUCCEEDED'

    # 3. OpenSearchインデックス確認
    file_count = get_opensearch_document_count('files')
    image_count = get_opensearch_document_count('images')

    assert file_count > 0
    assert image_count > 0

    # 4. 検索機能確認
    search_result = search_files('test query')
    assert search_result['total'] > 0

    image_search_result = search_images('test_image.jpg')
    assert image_search_result['total'] > 0
```

**Day 3-4: セキュリティテスト**

```bash
# OWASP ZAP でセキュリティスキャン
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod \
  -r zap_report.html

# IAMポリシー検証
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:role/LambdaExecutionRole \
  --action-names s3:GetObject s3:PutObject \
  --resource-arns arn:aws:s3:::cis-filesearch-raw-files/*
```

**Day 5: ドキュメント整備**

- ユーザーマニュアル作成
- 運用手順書作成
- トラブルシューティングガイド作成

#### Week 8

**Day 1-2: 本番デプロイ**

```bash
# 本番環境デプロイ
terraform workspace select prod
terraform plan -out=prod.tfplan
terraform apply prod.tfplan

# Lambda関数デプロイ
cd lambda/
./deploy.sh --env prod

# Step Functions更新
aws stepfunctions update-state-machine \
  --state-machine-arn arn:aws:states:ap-northeast-1:123456789012:stateMachine:CIS-Batch-Sync-Prod \
  --definition file://step_functions/batch_sync_workflow.json
```

**Day 3: ユーザートレーニング**

- 検索機能のデモ
- 管理画面の操作説明
- Q&Aセッション

**Day 4: 本番運用開始**

```bash
# 初回バッチ実行
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:ap-northeast-1:123456789012:stateMachine:CIS-Batch-Sync-Prod \
  --name "production-initial-sync-$(date +%Y%m%d)"

# モニタリング開始
aws cloudwatch put-dashboard \
  --dashboard-name CIS-FileSearch-Production \
  --dashboard-body file://cloudwatch/dashboard.json
```

**Day 5: プロジェクト完了レビュー**

**最終チェックリスト**:
- [ ] 全機能テスト合格
- [ ] セキュリティ監査合格
- [ ] パフォーマンス要件達成
- [ ] ユーザートレーニング完了
- [ ] 運用ドキュメント完備
- [ ] 本番デプロイ成功
- [ ] モニタリング設定完了

---

## リスク管理

### 主要リスクと対策

| リスク | 影響度 | 発生確率 | 対策 | 担当 |
|--------|--------|---------|------|------|
| **DataSync初回同期失敗** | 高 | 中 | 段階的同期、詳細ログ | インフラ担当 |
| **Lambda Timeout** | 中 | 高 | メモリ増強、タイムアウト値調整 | バックエンド担当 |
| **OpenSearch性能不足** | 中 | 低 | インスタンスサイズアップ、キャッシング | バックエンド担当 |
| **VPN接続不安定** | 高 | 中 | リトライ実装、アラート設定 | インフラ担当 |
| **コスト超過** | 中 | 低 | CloudWatch Billing Alarm設定 | PM |

---

## まとめ

8週間の実装ロードマップにより、月次バッチ最適化アーキテクチャを確実に構築します。各週の完了条件を満たすことで、リスクを最小化しながらプロジェクトを成功に導きます。

**次のアクション**:
1. 既存ドキュメント（architecture.md, roadmap.md）の更新
2. コスト見積もりExcelの更新（月次バッチパターン追加）

これにより、プロジェクト全体のドキュメントが最新化され、実装準備が完了します。
