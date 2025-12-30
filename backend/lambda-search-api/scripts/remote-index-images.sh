#!/bin/bash

echo "======================================"
echo "🔄 EC2経由での画像インデックス化"
echo "======================================"

# EC2インスタンスを確認
echo "📋 利用可能なEC2インスタンス:"
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query "Reservations[].Instances[].[InstanceId,Tags[?Key=='Name'].Value|[0],PrivateIpAddress,PublicIpAddress]" \
  --output table

echo ""
echo "インスタンスIDを入力してください（例: i-0abc123def456789）:"
read INSTANCE_ID

if [ -z "$INSTANCE_ID" ]; then
    echo "❌ インスタンスIDが入力されていません"
    exit 1
fi

echo ""
echo "🚀 SSMセッションマネージャーで接続中..."
echo ""
echo "接続後、以下のコマンドを実行してください:"
echo ""
echo "# 1. Pythonスクリプトを作成"
echo "cat > /tmp/index_images.py << 'EOF'"
cat << 'SCRIPT_EOF'
#!/usr/bin/env python3
import boto3
import json
import base64
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import time

REGION = 'ap-northeast-1'
OPENSEARCH_ENDPOINT = 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
INDEX_NAME = 'file-index-v2-knn'
S3_BUCKET = 'cis-filesearch-s3-landing'
BEDROCK_MODEL = 'amazon.titan-embed-image-v1'

def main():
    # OpenSearchクライアント
    session = boto3.Session()
    credentials = session.get_credentials()
    awsauth = AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        REGION,
        'es',
        session_token=credentials.token
    )

    client = OpenSearch(
        hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection
    )

    # 1. サンプルデータ削除
    print("Deleting sample data...")
    delete_response = client.delete_by_query(
        index=INDEX_NAME,
        body={
            "query": {
                "wildcard": {
                    "fileName": "sample_*"
                }
            }
        }
    )
    print(f"Deleted {delete_response.get('deleted', 0)} samples")

    # 2. S3から実画像を10件取得
    print("\nFinding real images from S3...")
    s3 = boto3.client('s3')
    response = s3.list_objects_v2(
        Bucket=S3_BUCKET,
        Prefix='documents/',
        MaxKeys=100
    )

    images = []
    for obj in response.get('Contents', []):
        if obj['Key'].lower().endswith(('.jpg', '.jpeg', '.png')):
            images.append(obj['Key'])
            if len(images) >= 10:
                break

    print(f"Found {len(images)} images to index")

    # 3. 各画像をインデックス
    bedrock = boto3.client('bedrock-runtime', region_name=REGION)

    for i, s3_key in enumerate(images, 1):
        print(f"\n[{i}/{len(images)}] Processing {s3_key}...")

        try:
            # S3から画像取得
            obj = s3.get_object(Bucket=S3_BUCKET, Key=s3_key)
            image_bytes = obj['Body'].read()

            # Bedrock でembedding生成
            image_base64 = base64.b64encode(image_bytes).decode('utf-8')
            bedrock_response = bedrock.invoke_model(
                modelId=BEDROCK_MODEL,
                contentType='application/json',
                accept='application/json',
                body=json.dumps({"inputImage": image_base64})
            )

            result = json.loads(bedrock_response['body'].read())
            embedding = result['embedding']

            # OpenSearchにインデックス
            import os
            doc = {
                "fileName": os.path.basename(s3_key),
                "filePath": f"s3://{S3_BUCKET}/{s3_key}",
                "fileSize": len(image_bytes),
                "fileType": os.path.splitext(s3_key)[1][1:].lower(),
                "image_vector": embedding,
                "department": "実画像テスト",
                "tags": ["実画像", "本番データ"]
            }

            doc_id = f"real_img_{i:03d}"
            client.index(
                index=INDEX_NAME,
                id=doc_id,
                body=doc
            )
            print(f"  ✅ Indexed as {doc_id}")

        except Exception as e:
            print(f"  ❌ Error: {str(e)}")

        time.sleep(1)  # レート制限対策

    # 4. 最終確認
    count = client.count(index=INDEX_NAME)
    print(f"\n✅ Total documents in index: {count['count']}")

if __name__ == "__main__":
    main()
SCRIPT_EOF
echo "EOF"
echo ""
echo "# 2. 必要なパッケージインストール（既にインストール済みかも）"
echo "pip3 install opensearch-py requests-aws4auth boto3"
echo ""
echo "# 3. スクリプト実行"
echo "python3 /tmp/index_images.py"
echo ""
echo "======================================"
echo ""

# SSMセッション開始
aws ssm start-session --target $INSTANCE_ID