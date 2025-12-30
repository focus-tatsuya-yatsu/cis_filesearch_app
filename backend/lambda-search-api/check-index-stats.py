import json
import boto3

lambda_client = boto3.client('lambda', region_name='ap-northeast-1')

# Create a test event to trigger the Lambda
test_event = {
    "httpMethod": "POST",
    "body": json.dumps({
        "imageVector": [0.1] * 512,  # 512 dimensions as per CLIP
        "searchType": "image",
        "page": 1,
        "limit": 10
    }),
    "headers": {
        "Content-Type": "application/json"
    }
}

# Invoke the Lambda function
response = lambda_client.invoke(
    FunctionName='cis-search-api-prod',
    Payload=json.dumps(test_event)
)

# Parse the response
result = json.loads(response['Payload'].read().decode('utf-8'))
if result.get('statusCode') == 200:
    body = json.loads(result.get('body', '{}'))
    print("Index:", body.get('data', {}).get('index'))
    print("Total results:", body.get('data', {}).get('total'))
    print("\nSample results:")
    for i, item in enumerate(body.get('data', {}).get('results', [])[:5]):
        print(f"{i+1}. {item.get('fileName')} - Score: {item.get('relevanceScore'):.2f}")
        print(f"   Path: {item.get('filePath')}")
else:
    print("Error:", result)
