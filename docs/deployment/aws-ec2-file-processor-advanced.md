# AWS EC2 File Processor - Advanced Topics

This document continues from `aws-ec2-file-processor-guide.md` with advanced topics.

## Table of Contents
1. [Integration with File Processing Pipeline](#integration-with-file-processing-pipeline)
2. [Performance Optimization](#performance-optimization)
3. [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)
4. [Cost Optimization](#cost-optimization)
5. [Security Best Practices](#security-best-practices)
6. [Production Deployment Checklist](#production-deployment-checklist)

---

## Integration with File Processing Pipeline

### Complete Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│ 1. DataSync: NAS → S3                                        │
├──────────────────────────────────────────────────────────────┤
│   Schedule: Hourly                                           │
│   Source: /mnt/nas/documents                                 │
│   Destination: s3://cis-filesearch-landing-prod/files/      │
│   Filters: PDF, JPG, PNG, XDW files only                     │
│   Bandwidth limit: 100 Mbps                                  │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. S3 Event → EventBridge                                    │
├──────────────────────────────────────────────────────────────┤
│   Event Type: s3:ObjectCreated:*                             │
│   Filter: prefix="files/", suffix in [.pdf,.jpg,.png,.xdw]  │
│   Target: EventBridge Rule                                   │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. EventBridge → SQS                                         │
├──────────────────────────────────────────────────────────────┤
│   Input Transformation:                                      │
│   {                                                          │
│     "s3Bucket": $.detail.bucket.name,                        │
│     "s3Key": $.detail.object.key,                            │
│     "fileSize": $.detail.object.size,                        │
│     "eventTime": $.time                                      │
│   }                                                          │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. SQS Queue (Buffer)                                        │
├──────────────────────────────────────────────────────────────┤
│   Visibility Timeout: 300 seconds                            │
│   Max Retries: 3                                             │
│   DLQ: cis-filesearch-dlq-prod                               │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. EC2 Workers (Auto Scaling 1-10)                           │
├──────────────────────────────────────────────────────────────┤
│   Per Message:                                               │
│   ├─ Download file from S3                                   │
│   ├─ OCR with Tesseract (Japanese + English)                 │
│   ├─ Generate thumbnail (800px width)                        │
│   ├─ Create embeddings (Bedrock Titan)                       │
│   ├─ Index to OpenSearch                                     │
│   ├─ Upload thumbnail to S3                                  │
│   └─ Delete SQS message                                      │
└──────────────────────────────────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
┌────────────────────────┐  ┌──────────────────────┐
│ OpenSearch Index       │  │ S3 Thumbnails Bucket │
├────────────────────────┤  ├──────────────────────┤
│ - Full-text search     │  │ Thumbnail images     │
│ - Vector similarity    │  │ (JPEG, 800px max)    │
│ - Metadata filtering   │  │                      │
└────────────────────────┘  └──────────────────────┘
```

### EventBridge Rule Configuration

**Create rule to route S3 events to SQS:**

```bash
# Set variables
RULE_NAME="cis-s3-to-sqs-rule"
SQS_QUEUE_ARN="arn:aws:sqs:ap-northeast-1:${ACCOUNT_ID}:cis-filesearch-queue-prod"

# Create EventBridge rule
aws events put-rule \
  --name $RULE_NAME \
  --description "Route S3 object created events to SQS for file processing" \
  --event-pattern '{
    "source": ["aws.s3"],
    "detail-type": ["Object Created"],
    "detail": {
      "bucket": {
        "name": ["cis-filesearch-landing-prod"]
      },
      "object": {
        "key": [
          {
            "prefix": "files/"
          }
        ]
      }
    }
  }'

# Add SQS as target with input transformation
aws events put-targets \
  --rule $RULE_NAME \
  --targets '[
    {
      "Id": "1",
      "Arn": "'$SQS_QUEUE_ARN'",
      "InputTransformer": {
        "InputPathsMap": {
          "bucket": "$.detail.bucket.name",
          "key": "$.detail.object.key",
          "size": "$.detail.object.size",
          "etag": "$.detail.object.etag",
          "time": "$.time"
        },
        "InputTemplate": "{\"s3Bucket\":\"<bucket>\",\"s3Key\":\"<key>\",\"fileSize\":<size>,\"etag\":\"<etag>\",\"eventTime\":\"<time>\"}"
      }
    }
  ]'

echo "EventBridge rule created: $RULE_NAME"
```

**Grant EventBridge permission to send to SQS:**

```bash
# Add SQS queue policy
aws sqs set-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/${ACCOUNT_ID}/cis-filesearch-queue-prod \
  --attributes '{
    "Policy": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"events.amazonaws.com\"},\"Action\":\"sqs:SendMessage\",\"Resource\":\"'$SQS_QUEUE_ARN'\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\"arn:aws:events:ap-northeast-1:'$ACCOUNT_ID':rule/'$RULE_NAME'\"}}}]}"
  }'
```

### S3 Bucket Notifications (Alternative to EventBridge)

If you prefer S3 direct notifications instead of EventBridge:

```bash
# Create notification configuration
cat > s3-notification.json <<EOF
{
  "QueueConfigurations": [
    {
      "QueueArn": "$SQS_QUEUE_ARN",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "prefix",
              "Value": "files/"
            },
            {
              "Name": "suffix",
              "Value": ".pdf"
            }
          ]
        }
      }
    }
  ]
}
EOF

# Apply notification configuration
aws s3api put-bucket-notification-configuration \
  --bucket cis-filesearch-landing-prod \
  --notification-configuration file://s3-notification.json
```

**Note**: EventBridge is recommended over direct S3 notifications for:
- Better filtering capabilities
- Message transformation
- Multiple targets
- Centralized event routing

### File Download Optimization

**Multipart download for large files:**

```python
import boto3
from botocore.config import Config

# Configure S3 client with optimized settings
s3_config = Config(
    max_pool_connections=50,
    retries={'max_attempts': 3, 'mode': 'adaptive'}
)

s3 = boto3.client('s3', config=s3_config)

def download_large_file(bucket: str, key: str, local_path: str):
    """
    Download large file with multipart and progress tracking
    """
    # Get file size
    response = s3.head_object(Bucket=bucket, Key=key)
    file_size = response['ContentLength']

    # For files > 100MB, use multipart download
    if file_size > 100 * 1024 * 1024:
        print(f"Downloading large file ({file_size / 1024 / 1024:.2f} MB) in parts...")

        # Download with transfer config
        transfer_config = boto3.s3.transfer.TransferConfig(
            multipart_threshold=10 * 1024 * 1024,  # 10MB
            max_concurrency=10,
            multipart_chunksize=10 * 1024 * 1024,
            use_threads=True
        )

        s3.download_file(
            bucket,
            key,
            local_path,
            Config=transfer_config
        )
    else:
        # Standard download for smaller files
        s3.download_file(bucket, key, local_path)
```

### Tesseract OCR Configuration for Japanese Documents

**Optimal Tesseract parameters:**

```python
# PSM (Page Segmentation Mode)
PSM_MODES = {
    1: "Automatic page segmentation with OSD (Orientation and Script Detection)",
    3: "Fully automatic page segmentation, but no OSD (Default)",
    4: "Assume a single column of text of variable sizes",
    6: "Assume a single uniform block of text",
    11: "Sparse text. Find as much text as possible in no particular order",
    12: "Sparse text with OSD",
}

# OEM (OCR Engine Mode)
OEM_MODES = {
    0: "Legacy engine only",
    1: "Neural nets LSTM engine only",
    2: "Legacy + LSTM engines",
    3: "Default, based on what is available",
}

# Recommended configuration for Japanese documents
TESSERACT_CONFIG = {
    'lang': 'jpn+eng',  # Japanese primary, English secondary
    'config': '--psm 1 --oem 3 -c preserve_interword_spaces=1',
    'dpi': 300,  # Minimum DPI for good OCR quality
}

# For specific document types
DOCUMENT_TYPE_CONFIGS = {
    'invoice': {
        'config': '--psm 6 --oem 3',  # Uniform block of text
    },
    'handwritten': {
        'config': '--psm 11 --oem 3',  # Sparse text
    },
    'mixed_layout': {
        'config': '--psm 1 --oem 3',  # Auto with OSD
    },
}

# Usage in worker
def ocr_with_optimal_config(image_path: str, doc_type: str = 'mixed_layout') -> str:
    """OCR image with optimal configuration"""

    config = DOCUMENT_TYPE_CONFIGS.get(doc_type, TESSERACT_CONFIG)

    # Pre-processing for better OCR quality
    img = Image.open(image_path)

    # Convert to grayscale
    img = img.convert('L')

    # Increase contrast
    from PIL import ImageEnhance
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(1.5)

    # OCR
    text = pytesseract.image_to_string(
        img,
        lang=config.get('lang', 'jpn+eng'),
        config=config.get('config', '--psm 1 --oem 3')
    )

    return text
```

### Bedrock Titan Embeddings Integration

**Optimized embedding creation:**

```python
import json
import boto3
from typing import List, Dict

bedrock = boto3.client('bedrock-runtime', region_name='us-east-1')

def create_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """
    Create embeddings for multiple texts efficiently

    Args:
        texts: List of text strings to embed

    Returns:
        List of embedding vectors
    """
    embeddings = []

    for text in texts:
        # Titan embedding v2 parameters
        request_body = {
            "inputText": text[:30000],  # Max 8K tokens ≈ 32K chars
            "dimensions": 512,  # 256, 512, or 1024
            "normalize": True,  # Unit vector for cosine similarity
        }

        try:
            response = bedrock.invoke_model(
                modelId='amazon.titan-embed-text-v2:0',
                body=json.dumps(request_body)
            )

            result = json.loads(response['body'].read())
            embeddings.append(result['embedding'])

        except Exception as e:
            print(f"Embedding failed: {e}")
            embeddings.append([0.0] * 512)  # Zero vector as fallback

    return embeddings

def chunk_text_for_embedding(text: str, max_chars: int = 30000) -> List[str]:
    """
    Split long text into chunks for embedding

    For very long documents, create embeddings for each chunk
    and combine them (average or concatenate)
    """
    chunks = []

    # Split by sentences/paragraphs
    paragraphs = text.split('\n\n')

    current_chunk = ""
    for para in paragraphs:
        if len(current_chunk) + len(para) < max_chars:
            current_chunk += para + "\n\n"
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = para + "\n\n"

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks if chunks else [text[:max_chars]]
```

### OpenSearch Bulk Indexing Patterns

**Bulk indexing for better performance:**

```python
from opensearchpy import OpenSearch, helpers
from typing import List, Dict, Generator

def bulk_index_documents(
    opensearch_client: OpenSearch,
    index_name: str,
    documents: List[Dict]
) -> Dict:
    """
    Bulk index documents to OpenSearch

    Args:
        opensearch_client: OpenSearch client instance
        index_name: Target index name
        documents: List of documents to index

    Returns:
        Bulk operation statistics
    """

    def generate_actions() -> Generator:
        """Generate actions for bulk indexing"""
        for doc in documents:
            yield {
                '_index': index_name,
                '_id': doc.get('file_id'),
                '_source': doc
            }

    # Perform bulk indexing
    success, errors = helpers.bulk(
        opensearch_client,
        generate_actions(),
        chunk_size=100,  # Index 100 docs per request
        max_retries=3,
        initial_backoff=2,
        max_backoff=60,
        raise_on_error=False,
        raise_on_exception=False
    )

    return {
        'success': success,
        'failed': len(errors),
        'errors': errors[:5]  # First 5 errors for debugging
    }

# OpenSearch index mapping for file search
INDEX_MAPPING = {
    "settings": {
        "number_of_shards": 3,
        "number_of_replicas": 1,
        "analysis": {
            "analyzer": {
                "japanese_analyzer": {
                    "type": "custom",
                    "tokenizer": "kuromoji_tokenizer",
                    "filter": ["kuromoji_baseform", "kuromoji_part_of_speech", "cjk_width"]
                }
            }
        }
    },
    "mappings": {
        "properties": {
            "file_id": {"type": "keyword"},
            "s3_key": {"type": "keyword"},
            "file_name": {
                "type": "text",
                "analyzer": "japanese_analyzer",
                "fields": {
                    "keyword": {"type": "keyword"}
                }
            },
            "file_path": {"type": "keyword"},
            "file_ext": {"type": "keyword"},
            "content": {
                "type": "text",
                "analyzer": "japanese_analyzer"
            },
            "content_length": {"type": "integer"},
            "embedding": {
                "type": "knn_vector",
                "dimension": 512,
                "method": {
                    "name": "hnsw",
                    "space_type": "cosinesimil",
                    "engine": "nmslib",
                    "parameters": {
                        "ef_construction": 128,
                        "m": 16
                    }
                }
            },
            "thumbnail_url": {"type": "keyword"},
            "indexed_at": {"type": "date"},
            "department": {"type": "keyword"},
            "project": {"type": "keyword"},
            "tags": {"type": "keyword"}
        }
    }
}

# Create index with mapping
def create_opensearch_index(client: OpenSearch, index_name: str):
    """Create index with Japanese text analysis"""

    if not client.indices.exists(index=index_name):
        client.indices.create(
            index=index_name,
            body=INDEX_MAPPING
        )
        print(f"Index created: {index_name}")
    else:
        print(f"Index already exists: {index_name}")
```

### File Cleanup After Processing

**Automatic cleanup strategies:**

```python
import os
import time
from pathlib import Path

class FileCleanupManager:
    """Manage temporary file cleanup"""

    def __init__(self, temp_dir: str, max_age_seconds: int = 3600):
        self.temp_dir = Path(temp_dir)
        self.max_age_seconds = max_age_seconds

    def cleanup_old_files(self):
        """Remove files older than max_age_seconds"""

        current_time = time.time()
        removed_count = 0

        for file_path in self.temp_dir.glob('*'):
            if not file_path.is_file():
                continue

            # Check file age
            file_age = current_time - file_path.stat().st_mtime

            if file_age > self.max_age_seconds:
                try:
                    file_path.unlink()
                    removed_count += 1
                except Exception as e:
                    print(f"Failed to remove {file_path}: {e}")

        print(f"Cleaned up {removed_count} old files")

    def cleanup_by_pattern(self, pattern: str):
        """Remove files matching pattern"""

        for file_path in self.temp_dir.glob(pattern):
            try:
                file_path.unlink()
            except Exception as e:
                print(f"Failed to remove {file_path}: {e}")

# Usage in worker application
cleanup_manager = FileCleanupManager('/opt/cis-file-processor/temp', max_age_seconds=3600)

# Schedule cleanup every 30 minutes
import threading

def periodic_cleanup():
    """Run cleanup periodically"""
    while True:
        time.sleep(1800)  # 30 minutes
        cleanup_manager.cleanup_old_files()

# Start cleanup thread
cleanup_thread = threading.Thread(target=periodic_cleanup, daemon=True)
cleanup_thread.start()
```

---

## Performance Optimization

### Multiprocessing Strategy

**Optimal process pool sizing:**

```python
import multiprocessing
import os

def determine_optimal_workers() -> int:
    """
    Determine optimal number of worker processes

    For CPU-bound tasks (OCR):
    - Use number of CPU cores
    - c5.xlarge has 4 vCPUs

    For I/O-bound tasks (S3 download):
    - Can use more workers (2x CPU cores)
    """

    cpu_count = multiprocessing.cpu_count()

    # Check if running in container with CPU limits
    if os.path.exists('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'):
        with open('/sys/fs/cgroup/cpu/cpu.cfs_quota_us') as f:
            quota = int(f.read())
        with open('/sys/fs/cgroup/cpu/cpu.cfs_period_us') as f:
            period = int(f.read())

        if quota > 0:
            cpu_count = max(1, quota // period)

    # For OCR workload (CPU-intensive)
    return cpu_count

# Configure process pool
WORKER_PROCESSES = determine_optimal_workers()
print(f"Configured {WORKER_PROCESSES} worker processes")
```

### Memory Management for Large Files

**Handle large PDFs without OOM:**

```python
import gc
from typing import Optional

class MemoryEfficientPDFProcessor:
    """Process large PDFs with memory management"""

    def __init__(self, max_memory_mb: int = 4096):
        self.max_memory_mb = max_memory_mb

    def process_pdf_pages_streaming(self, pdf_path: str) -> str:
        """
        Process PDF pages one at a time to avoid memory issues

        Args:
            pdf_path: Path to PDF file

        Returns:
            Combined OCR text from all pages
        """
        import PyPDF2
        from pdf2image import convert_from_path
        import pytesseract

        full_text = ""

        try:
            with open(pdf_path, 'rb') as pdf_file:
                pdf_reader = PyPDF2.PdfReader(pdf_file)
                total_pages = len(pdf_reader.pages)

                print(f"Processing {total_pages} pages...")

                # Process pages in batches
                batch_size = 5
                for start_page in range(1, total_pages + 1, batch_size):
                    end_page = min(start_page + batch_size - 1, total_pages)

                    print(f"Processing pages {start_page}-{end_page}/{total_pages}")

                    # Convert batch to images
                    images = convert_from_path(
                        pdf_path,
                        dpi=300,
                        first_page=start_page,
                        last_page=end_page,
                        thread_count=2
                    )

                    # OCR each image
                    for i, image in enumerate(images):
                        page_num = start_page + i
                        page_text = pytesseract.image_to_string(
                            image,
                            lang='jpn+eng',
                            config='--psm 1 --oem 3'
                        )

                        full_text += f"\n=== Page {page_num} ===\n{page_text}"

                        # Free memory
                        del image

                    # Force garbage collection
                    del images
                    gc.collect()

        except Exception as e:
            print(f"Error processing PDF: {e}")

        return full_text

# Usage
processor = MemoryEfficientPDFProcessor(max_memory_mb=4096)
text = processor.process_pdf_pages_streaming('/tmp/large.pdf')
```

### Connection Pooling for AWS Services

**Reuse connections for better performance:**

```python
import boto3
from botocore.config import Config
from functools import lru_cache

# Configure boto3 with connection pooling
AWS_CONFIG = Config(
    region_name='ap-northeast-1',
    retries={
        'max_attempts': 3,
        'mode': 'adaptive'
    },
    max_pool_connections=50,  # Increase from default 10
    connect_timeout=5,
    read_timeout=60
)

@lru_cache(maxsize=1)
def get_s3_client():
    """Get cached S3 client with connection pooling"""
    return boto3.client('s3', config=AWS_CONFIG)

@lru_cache(maxsize=1)
def get_sqs_client():
    """Get cached SQS client"""
    return boto3.client('sqs', config=AWS_CONFIG)

@lru_cache(maxsize=1)
def get_opensearch_client():
    """Get cached OpenSearch client"""
    from opensearchpy import OpenSearch, RequestsHttpConnection
    from requests_aws4auth import AWS4Auth

    credentials = boto3.Session().get_credentials()
    awsauth = AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        'ap-northeast-1',
        'es',
        session_token=credentials.token
    )

    return OpenSearch(
        hosts=[{'host': os.getenv('OPENSEARCH_ENDPOINT'), 'port': 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        pool_maxsize=20  # Connection pool size
    )

# Usage: Clients are created once and reused
s3 = get_s3_client()
sqs = get_sqs_client()
opensearch = get_opensearch_client()
```

### Caching Strategies

**Cache frequently accessed data:**

```python
from functools import lru_cache
import hashlib
import pickle
from pathlib import Path

class DiskCache:
    """Simple disk-based cache for OCR results"""

    def __init__(self, cache_dir: str = '/opt/cis-file-processor/cache'):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _get_cache_key(self, s3_key: str, file_hash: str) -> str:
        """Generate cache key from file identifiers"""
        return hashlib.sha256(f"{s3_key}:{file_hash}".encode()).hexdigest()

    def get(self, s3_key: str, file_hash: str):
        """Retrieve cached OCR result"""
        cache_key = self._get_cache_key(s3_key, file_hash)
        cache_file = self.cache_dir / f"{cache_key}.pkl"

        if cache_file.exists():
            try:
                with open(cache_file, 'rb') as f:
                    return pickle.load(f)
            except Exception as e:
                print(f"Cache read error: {e}")
                return None

        return None

    def set(self, s3_key: str, file_hash: str, data):
        """Store OCR result in cache"""
        cache_key = self._get_cache_key(s3_key, file_hash)
        cache_file = self.cache_dir / f"{cache_key}.pkl"

        try:
            with open(cache_file, 'wb') as f:
                pickle.dump(data, f)
        except Exception as e:
            print(f"Cache write error: {e}")

# Usage in file processor
cache = DiskCache()

def process_with_cache(s3_key: str, file_hash: str):
    """Process file with caching"""

    # Check cache first
    cached_result = cache.get(s3_key, file_hash)
    if cached_result:
        print("Cache hit! Using cached OCR result")
        return cached_result

    # Process file
    result = perform_ocr(s3_key)

    # Cache result
    cache.set(s3_key, file_hash, result)

    return result
```

### Parallel Processing Patterns

**Process multiple files concurrently:**

```python
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
from typing import List, Dict

def parallel_s3_download(files: List[Dict]) -> List[str]:
    """
    Download multiple files from S3 in parallel

    Args:
        files: List of {bucket, key} dicts

    Returns:
        List of local file paths
    """
    def download_one(file_info: Dict) -> str:
        bucket = file_info['bucket']
        key = file_info['key']
        local_path = f"/tmp/{Path(key).name}"

        s3.download_file(bucket, key, local_path)
        return local_path

    local_paths = []

    # Use ThreadPoolExecutor for I/O-bound downloads
    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_file = {
            executor.submit(download_one, file_info): file_info
            for file_info in files
        }

        for future in as_completed(future_to_file):
            try:
                local_path = future.result()
                local_paths.append(local_path)
            except Exception as e:
                print(f"Download failed: {e}")

    return local_paths

def parallel_ocr_processing(image_paths: List[str]) -> List[str]:
    """
    OCR multiple images in parallel

    Args:
        image_paths: List of local image paths

    Returns:
        List of extracted texts
    """
    def ocr_one(image_path: str) -> str:
        image = Image.open(image_path)
        text = pytesseract.image_to_string(
            image,
            lang='jpn+eng',
            config='--psm 1 --oem 3'
        )
        return text

    results = []

    # Use ProcessPoolExecutor for CPU-bound OCR
    with ProcessPoolExecutor(max_workers=4) as executor:
        future_to_path = {
            executor.submit(ocr_one, path): path
            for path in image_paths
        }

        for future in as_completed(future_to_path):
            try:
                text = future.result()
                results.append(text)
            except Exception as e:
                print(f"OCR failed: {e}")
                results.append("")

    return results
```

---

## Monitoring and Troubleshooting

### CloudWatch Metrics Dashboard

**Create comprehensive operations dashboard:**

```bash
# Create CloudWatch dashboard
cat > dashboard-config.json <<'EOF'
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "title": "Files Processed (Success vs Failed)",
        "region": "ap-northeast-1",
        "metrics": [
          ["CISFileProcessor", "FilesProcessed", {"stat": "Sum", "label": "Success"}],
          [".", ".", {"stat": "Sum", "label": "Failed"}]
        ],
        "period": 300,
        "view": "timeSeries",
        "yAxis": {"left": {"label": "Count"}}
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Processing Time (p50, p95, p99)",
        "region": "ap-northeast-1",
        "metrics": [
          ["CISFileProcessor", "ProcessingTime", {"stat": "p50"}],
          [".", ".", {"stat": "p95"}],
          [".", ".", {"stat": "p99"}]
        ],
        "period": 300,
        "view": "timeSeries",
        "yAxis": {"left": {"label": "Seconds"}}
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "SQS Queue Depth",
        "region": "ap-northeast-1",
        "metrics": [
          ["AWS/SQS", "ApproximateNumberOfMessagesVisible", {"stat": "Average"}],
          [".", "ApproximateNumberOfMessagesNotVisible", {"stat": "Average"}]
        ],
        "period": 60,
        "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Auto Scaling Group Size",
        "region": "ap-northeast-1",
        "metrics": [
          ["AWS/AutoScaling", "GroupDesiredCapacity"],
          [".", "GroupInServiceInstances"],
          [".", "GroupMinSize"],
          [".", "GroupMaxSize"]
        ],
        "period": 60,
        "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "EC2 CPU Utilization",
        "region": "ap-northeast-1",
        "metrics": [
          ["CISFileProcessor", "CPU_IDLE", {"stat": "Average"}],
          [".", "CPU_IOWAIT", {"stat": "Average"}]
        ],
        "period": 60,
        "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "EC2 Memory Utilization",
        "region": "ap-northeast-1",
        "metrics": [
          ["CISFileProcessor", "MEM_USED", {"stat": "Average"}]
        ],
        "period": 60,
        "view": "timeSeries"
      }
    },
    {
      "type": "log",
      "properties": {
        "title": "Recent Errors",
        "region": "ap-northeast-1",
        "query": "SOURCE '/aws/cis-file-processor/prod/errors' | fields @timestamp, @message | sort @timestamp desc | limit 20"
      }
    }
  ]
}
EOF

# Create dashboard
aws cloudwatch put-dashboard \
  --dashboard-name "CISFileProcessorOperations" \
  --dashboard-body file://dashboard-config.json
```

### CloudWatch Alarms

**Set up critical alarms:**

```bash
# 1. High error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "cis-file-processor-high-error-rate" \
  --alarm-description "Alert when file processing error rate > 10%" \
  --metric-name FilesProcessed \
  --namespace CISFileProcessor \
  --statistic Sum \
  --period 300 \
  --threshold 0.1 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=Status,Value=Failed

# 2. Processing time SLA violation
aws cloudwatch put-metric-alarm \
  --alarm-name "cis-file-processor-slow-processing" \
  --alarm-description "Alert when p95 processing time > 5 minutes" \
  --metric-name ProcessingTime \
  --namespace CISFileProcessor \
  --statistic p95 \
  --period 300 \
  --threshold 300 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2

# 3. Queue backlog alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "cis-file-processor-queue-backlog" \
  --alarm-description "Alert when queue has >100 messages for 15 minutes" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Average \
  --period 300 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 \
  --dimensions Name=QueueName,Value=cis-filesearch-queue-prod

# 4. No instances running
aws cloudwatch put-metric-alarm \
  --alarm-name "cis-file-processor-no-instances" \
  --alarm-description "Alert when no EC2 instances are running" \
  --metric-name GroupInServiceInstances \
  --namespace AWS/AutoScaling \
  --statistic Minimum \
  --period 60 \
  --threshold 1 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 5

# 5. High memory usage
aws cloudwatch put-metric-alarm \
  --alarm-name "cis-file-processor-high-memory" \
  --alarm-description "Alert when memory usage > 85%" \
  --metric-name MEM_USED \
  --namespace CISFileProcessor \
  --statistic Average \
  --period 60 \
  --threshold 85 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3
```

### Logging Best Practices

**Structured logging for better debugging:**

```python
import logging
import json
from pythonjsonlogger import jsonlogger

# Configure structured logging
logger = logging.getLogger('cis-file-processor')
logger.setLevel(logging.INFO)

# JSON formatter
formatter = jsonlogger.JsonFormatter(
    '%(timestamp)s %(level)s %(name)s %(funcName)s %(message)s',
    timestamp=True
)

# Add context to all log messages
class ContextFilter(logging.Filter):
    """Add context to log records"""

    def filter(self, record):
        record.instance_id = get_instance_id()
        record.worker_process = multiprocessing.current_process().name
        return True

logger.addFilter(ContextFilter())

# Usage with extra fields
logger.info(
    'Processing file',
    extra={
        'file_id': 'abc123',
        's3_key': 'files/2025/document.pdf',
        'file_size_mb': 5.2,
        'processing_step': 'ocr',
        'elapsed_seconds': 45.3
    }
)
```

### Common Issues and Solutions

#### Issue 1: Tesseract OOM (Out of Memory)

**Symptoms:**
- Process killed with exit code 137
- CloudWatch shows memory usage at 100%

**Solution:**

```python
# Process large PDFs in smaller batches
def process_pdf_memory_safe(pdf_path: str, max_memory_mb: int = 3072):
    """Process PDF with memory limits"""

    import psutil
    import gc

    def check_memory():
        """Check if we're approaching memory limit"""
        process = psutil.Process()
        memory_mb = process.memory_info().rss / 1024 / 1024
        return memory_mb < max_memory_mb

    text = ""
    page_batch = []

    for page_num in range(total_pages):
        if check_memory():
            page_batch.append(page_num)
        else:
            # Process current batch
            text += process_batch(page_batch)
            page_batch = [page_num]
            gc.collect()

    return text
```

#### Issue 2: Spot Instance Interruptions

**Symptoms:**
- Instances terminated mid-processing
- Messages returned to queue

**Solution:**

```python
import requests
import signal
import sys

def check_spot_interruption():
    """Check for 2-minute Spot interruption warning"""
    try:
        response = requests.get(
            'http://169.254.169.254/latest/meta-data/spot/instance-action',
            timeout=0.1
        )
        if response.status_code == 200:
            return True
    except:
        pass
    return False

def graceful_shutdown_handler(signum, frame):
    """Handle Spot interruption gracefully"""
    logger.warning('Spot interruption detected, shutting down gracefully')

    # Stop accepting new messages
    global RUNNING
    RUNNING = False

    # Wait for current processing to complete (max 2 minutes)
    # or increase SQS visibility timeout

    sys.exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown_handler)

# Periodic check (every 5 seconds)
import threading

def spot_interruption_monitor():
    while RUNNING:
        if check_spot_interruption():
            graceful_shutdown_handler(None, None)
        time.sleep(5)

monitor_thread = threading.Thread(target=spot_interruption_monitor, daemon=True)
monitor_thread.start()
```

#### Issue 3: DLQ Filling Up

**Symptoms:**
- Messages in Dead Letter Queue
- Processing failures

**Diagnosis script:**

```bash
#!/bin/bash
# diagnose-dlq.sh

DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/${ACCOUNT_ID}/cis-filesearch-dlq-prod"

# Get message count
MSG_COUNT=$(aws sqs get-queue-attributes \
  --queue-url $DLQ_URL \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages' \
  --output text)

echo "Messages in DLQ: $MSG_COUNT"

# Sample first 10 messages
echo "Sampling DLQ messages..."

for i in {1..10}; do
  MSG=$(aws sqs receive-message \
    --queue-url $DLQ_URL \
    --max-number-of-messages 1 \
    --message-attribute-names All \
    --query 'Messages[0]')

  if [ "$MSG" != "null" ]; then
    echo "Message $i:"
    echo "$MSG" | jq '.Body | fromjson | {s3Key, fileSize, error}'
  fi
done
```

**Reprocess DLQ messages after fix:**

```bash
#!/bin/bash
# reprocess-dlq.sh

MAIN_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/${ACCOUNT_ID}/cis-filesearch-queue-prod"
DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/${ACCOUNT_ID}/cis-filesearch-dlq-prod"

echo "Reprocessing messages from DLQ..."

while true; do
  # Receive from DLQ
  MSG=$(aws sqs receive-message \
    --queue-url $DLQ_URL \
    --max-number-of-messages 1 \
    --query 'Messages[0]')

  if [ "$MSG" == "null" ]; then
    echo "All messages reprocessed"
    break
  fi

  BODY=$(echo "$MSG" | jq -r '.Body')
  RECEIPT=$(echo "$MSG" | jq -r '.ReceiptHandle')

  # Send to main queue
  aws sqs send-message \
    --queue-url $MAIN_QUEUE_URL \
    --message-body "$BODY"

  # Delete from DLQ
  aws sqs delete-message \
    --queue-url $DLQ_URL \
    --receipt-handle "$RECEIPT"

  echo "Reprocessed 1 message"
done
```

---

*(Continue in next message...)*
