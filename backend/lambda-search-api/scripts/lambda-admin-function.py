"""
Lambda関数コード: OpenSearchの管理操作用
このコードをLambda関数として登録する必要があります
"""

import json
import boto3
import base64
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

# 設定
REGION = 'ap-northeast-1'
OPENSEARCH_ENDPOINT = 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
INDEX_NAME = 'file-index-v2-knn'
S3_BUCKET = 'cis-filesearch-s3-landing'
BEDROCK_MODEL = 'amazon.titan-embed-image-v1'

def get_opensearch_client():
    """OpenSearchクライアントを取得"""
    credentials = boto3.Session().get_credentials()
    awsauth = AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        REGION,
        'es',
        session_token=credentials.token
    )

    return OpenSearch(
        hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection
    )

def lambda_handler(event, context):
    """Lambda関数のメインハンドラー"""

    action = event.get('action')

    if action == 'delete_samples':
        return delete_sample_data()
    elif action == 'index_image':
        return index_single_image(event)
    elif action == 'check_status':
        return check_index_status()
    else:
        return {
            'statusCode': 400,
            'body': json.dumps({
                'success': False,
                'error': f'Unknown action: {action}'
            })
        }

def delete_sample_data():
    """サンプルデータを削除"""
    try:
        client = get_opensearch_client()

        query = {
            "query": {
                "wildcard": {
                    "fileName": "sample_*"
                }
            }
        }

        response = client.delete_by_query(
            index=INDEX_NAME,
            body=query
        )

        return {
            'statusCode': 200,
            'body': json.dumps({
                'success': True,
                'deleted': response.get('deleted', 0),
                'message': f"{response.get('deleted', 0)} sample documents deleted"
            })
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }

def index_single_image(event):
    """単一の画像をインデックス"""
    try:
        s3_key = event.get('s3_key')
        if not s3_key:
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'success': False,
                    'error': 's3_key is required'
                })
            }

        # Bedrockでembedding生成
        bedrock = boto3.client('bedrock-runtime', region_name=REGION)
        s3 = boto3.client('s3')

        # S3から画像を取得
        response = s3.get_object(Bucket=S3_BUCKET, Key=s3_key)
        image_bytes = response['Body'].read()
        image_base64 = base64.b64encode(image_bytes).decode('utf-8')

        # Bedrock APIを呼び出し
        bedrock_response = bedrock.invoke_model(
            modelId=BEDROCK_MODEL,
            contentType='application/json',
            accept='application/json',
            body=json.dumps({
                "inputImage": image_base64
            })
        )

        result = json.loads(bedrock_response['body'].read())
        embedding = result['embedding']

        # OpenSearchにインデックス
        client = get_opensearch_client()

        import os
        doc = {
            "fileName": os.path.basename(s3_key),
            "filePath": f"s3://{S3_BUCKET}/{s3_key}",
            "fileSize": len(image_bytes),
            "fileType": os.path.splitext(s3_key)[1][1:].lower(),
            "modifiedDate": response['LastModified'].isoformat() if 'LastModified' in response else None,
            "image_vector": embedding,
            "department": "実画像",
            "tags": ["実画像", "本番データ"]
        }

        doc_id = f"real_{os.path.basename(s3_key).replace('.', '_')}"
        index_response = client.index(
            index=INDEX_NAME,
            id=doc_id,
            body=doc
        )

        return {
            'statusCode': 200,
            'body': json.dumps({
                'success': True,
                'doc_id': doc_id,
                'result': index_response['result']
            })
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }

def check_index_status():
    """インデックスの状態を確認"""
    try:
        client = get_opensearch_client()

        # 総数
        count_response = client.count(index=INDEX_NAME)
        total_docs = count_response['count']

        # サンプルデータ数
        sample_query = {
            "query": {
                "wildcard": {
                    "fileName": "sample_*"
                }
            }
        }
        sample_response = client.count(index=INDEX_NAME, body=sample_query)
        sample_count = sample_response['count']

        # 実データ数
        real_query = {
            "query": {
                "wildcard": {
                    "fileName": {
                        "value": "*",
                        "boost": 1.0
                    }
                },
                "must_not": {
                    "wildcard": {
                        "fileName": "sample_*"
                    }
                }
            }
        }

        return {
            'statusCode': 200,
            'body': json.dumps({
                'success': True,
                'total_docs': total_docs,
                'sample_count': sample_count,
                'real_count': total_docs - sample_count
            })
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }