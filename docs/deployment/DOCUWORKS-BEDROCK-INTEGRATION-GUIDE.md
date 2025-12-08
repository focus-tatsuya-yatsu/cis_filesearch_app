# DocuWorks SDK + AWS Bedrock Integration Guide

## Executive Summary

本ドキュメントでは、商用DocuWorks SDKとAWS Bedrockの画像ベクトル検索機能を統合した、本番環境向けの最適なアーキテクチャを提供します。

**現状:**
- python-worker: DocuWorks dual-mode実装 (SDK + OCR fallback)
- ec2-worker: Bedrock統合済み (画像ベクトル化)
- 購入済みライセンス: DocuWorks商用ライセンス 1本

**目標:**
- DocuWorks SDK処理とBedrock画像ベクトル化の統合
- 商用ライセンスの適切な管理
- 本番環境での最適化されたアーキテクチャ

---

## Table of Contents

1. [Optimal Architecture](#optimal-architecture)
2. [DocuWorks SDK Integration Best Practices](#docuworks-sdk-integration-best-practices)
3. [Bedrock Integration Strategy](#bedrock-integration-strategy)
4. [License Management](#license-management)
5. [Implementation Plan](#implementation-plan)
6. [Configuration Strategy](#configuration-strategy)
7. [OpenSearch Vector Search Integration](#opensearch-vector-search-integration)
8. [Deployment Guide](#deployment-guide)
9. [Testing Strategy](#testing-strategy)
10. [Monitoring and Operations](#monitoring-and-operations)

---

## Optimal Architecture

### Recommended Architecture: Unified Python Worker

**推奨:** python-workerをベースにBedrock機能を統合する単一ワーカーアーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    Unified Python Worker                     │
│                  (python-worker-unified)                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌─────────────────────────────┐     │
│  │  File Processors  │  │  Enhancement Services       │     │
│  ├──────────────────┤  ├─────────────────────────────┤     │
│  │ • PDF            │  │ • Bedrock Client            │     │
│  │ • Office         │  │   - Image Vectorization     │     │
│  │ • Image          │  │   - Text Vectorization      │     │
│  │ • DocuWorks SDK  │  │   - Multimodal Embedding    │     │
│  │   (Primary)      │  │                             │     │
│  │ • DocuWorks OCR  │  │ • Thumbnail Generator       │     │
│  │   (Fallback)     │  │                             │     │
│  └──────────────────┘  └─────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │         OpenSearch Client (Vector Support)          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────┐
        │      AWS OpenSearch Service             │
        │  • Full-Text Search Index               │
        │  • k-NN Vector Index (1024-dim)        │
        │  • Hybrid Search Capability             │
        └─────────────────────────────────────────┘
```

### Architecture Benefits

1. **Single Worker Process**
   - 管理の簡素化
   - リソースの効率的利用
   - デプロイメントの簡素化

2. **Modular Design**
   - 各プロセッサーは独立して動作
   - 容易な機能追加・変更
   - テストの容易性

3. **Flexible Processing**
   - DocuWorks SDK優先、OCR fallback
   - 画像ファイルのベクトル化
   - テキストコンテンツのベクトル化

4. **Cost Optimization**
   - 単一EC2インスタンスで運用可能
   - DocuWorksライセンス1本で対応
   - Bedrockは使用量ベースの課金

---

## DocuWorks SDK Integration Best Practices

### 1. SDK Installation and Setup

#### Windows EC2 Instance Requirements

```yaml
Instance Type: t3.medium or higher
OS: Windows Server 2022
Storage: 100GB+ EBS (SSD)
Memory: 4GB+ RAM
```

#### Installation Steps

```powershell
# 1. DocuWorks Viewer Light (無料版) or 商用版のインストール
# ダウンロード: https://www.fujixerox.co.jp/product/software/docuworks/

# 2. DocuWorks Development Kit (DK) インストール
# 商用ライセンスに含まれる

# 3. Python環境のセットアップ
python -m venv venv
.\venv\Scripts\activate

# 4. pywin32のインストール (COM接続用)
pip install pywin32

# 5. その他の依存関係
pip install -r requirements.txt
```

### 2. DocuWorks SDK Implementation

#### Enhanced DocuWorks Processor

```python
"""
Enhanced DocuWorks Processor with Commercial SDK Support
Integrated with Bedrock for image vectorization
"""

import logging
import time
import win32com.client
from pathlib import Path
from typing import Optional, Tuple, Dict, List

from .base_processor import BaseProcessor, ProcessingResult

logger = logging.getLogger(__name__)


class DocuWorksSDKProcessor(BaseProcessor):
    """
    DocuWorks processor using official SDK

    Features:
    - Native .xdw/.xbd text extraction
    - Image extraction for vectorization
    - Metadata extraction
    - OCR fallback support
    """

    def __init__(self, config):
        """Initialize with SDK license validation"""
        super().__init__(config)

        self.sdk_available = False
        self.dw_app = None

        # Initialize DocuWorks COM object
        if self.config.docuworks.is_configured():
            self._initialize_sdk()

    def _initialize_sdk(self) -> bool:
        """
        Initialize DocuWorks SDK COM interface

        Returns:
            True if initialization successful
        """
        try:
            # Create DocuWorks Application COM object
            self.dw_app = win32com.client.Dispatch("DocuWorks.DeskApp")

            # Verify license
            if not self._verify_license():
                logger.error("DocuWorks license verification failed")
                return False

            self.sdk_available = True
            logger.info("DocuWorks SDK initialized successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to initialize DocuWorks SDK: {e}")
            self.sdk_available = False
            return False

    def _verify_license(self) -> bool:
        """
        Verify DocuWorks license is valid

        Returns:
            True if license is valid
        """
        try:
            # Check if SDK is properly licensed
            # This is SDK-specific verification
            # Consult DocuWorks DK documentation for exact method

            # Example verification (adjust based on actual SDK)
            version = self.dw_app.Version
            logger.info(f"DocuWorks SDK version: {version}")

            return True

        except Exception as e:
            logger.error(f"License verification failed: {e}")
            return False

    def can_process(self, file_path: str) -> bool:
        """Check if file is DocuWorks format"""
        ext = Path(file_path).suffix.lower()
        return ext in {'.xdw', '.xbd'}

    def process(self, file_path: str) -> ProcessingResult:
        """
        Process DocuWorks file with SDK or fallback

        Args:
            file_path: Path to DocuWorks file

        Returns:
            ProcessingResult with extracted data
        """
        start_time = time.time()

        try:
            file_info = self._get_file_info(file_path)

            # Try SDK first
            if self.sdk_available:
                try:
                    return self._process_with_sdk(file_path, file_info, start_time)
                except Exception as sdk_error:
                    logger.error(f"SDK processing failed: {sdk_error}")
                    if not self.config.docuworks.use_ocr_fallback:
                        raise

            # Fallback to OCR if SDK fails or unavailable
            if self.config.docuworks.use_ocr_fallback:
                logger.info("Using OCR fallback for DocuWorks processing")
                return self._process_with_ocr_fallback(file_path, file_info, start_time)
            else:
                return self._create_error_result(
                    file_path,
                    "DocuWorks SDK failed and OCR fallback disabled"
                )

        except Exception as e:
            logger.error(f"DocuWorks processing error: {e}", exc_info=True)
            return self._create_error_result(file_path, str(e))

    def _process_with_sdk(
        self,
        file_path: str,
        file_info: dict,
        start_time: float
    ) -> ProcessingResult:
        """
        Process using DocuWorks SDK

        Args:
            file_path: File path
            file_info: File metadata
            start_time: Processing start time

        Returns:
            ProcessingResult object
        """
        doc = None

        try:
            logger.info(f"Processing with DocuWorks SDK: {file_path}")

            # Open document
            doc = self.dw_app.Documents.Open(file_path)

            # Extract text from all pages
            text_parts = []
            page_count = doc.Pages.Count

            for page_idx in range(1, page_count + 1):
                page = doc.Pages.Item(page_idx)

                # Get text content
                page_text = page.GetText()
                if page_text and page_text.strip():
                    text_parts.append(page_text)

            extracted_text = '\n\n'.join(text_parts)

            # Extract metadata
            metadata = {
                'document_type': 'docuworks',
                'page_count': page_count,
                'title': doc.Title or '',
                'author': doc.Author or '',
                'subject': doc.Subject or '',
                'keywords': doc.Keywords or '',
                'created': str(doc.CreationDate) if hasattr(doc, 'CreationDate') else '',
                'modified': str(doc.LastSavedDate) if hasattr(doc, 'LastSavedDate') else '',
                'processing_method': 'sdk',
                'sdk_version': self.dw_app.Version
            }

            # Extract images for vectorization (if enabled)
            images = []
            if self.config.docuworks.extract_images:
                images = self._extract_images_from_doc(doc)

            metadata['extracted_images'] = len(images)
            metadata.update(self._extract_metadata(file_path))

            processing_time = time.time() - start_time

            result = ProcessingResult(
                success=True,
                file_path=file_info['file_path'],
                file_name=file_info['file_name'],
                file_size=file_info['file_size'],
                file_type=file_info['file_type'],
                mime_type=self.config.file_types.get_mime_type(file_info['file_type']),
                extracted_text=extracted_text,
                word_count=self._count_words(extracted_text),
                char_count=len(extracted_text),
                page_count=page_count,
                metadata=metadata,
                processing_time_seconds=processing_time,
                processor_name=f"{self.__class__.__name__} (SDK)",
            )

            # Add extracted images for later vectorization
            if images:
                result.extracted_images = images

            logger.info(
                f"SDK processing completed: {page_count} pages, "
                f"{len(extracted_text)} chars in {processing_time:.2f}s"
            )

            return result

        finally:
            # Clean up: Close document
            if doc:
                try:
                    doc.Close(SaveOption=0)  # 0 = Don't save
                except:
                    pass

    def _extract_images_from_doc(self, doc) -> List[str]:
        """
        Extract images from DocuWorks document

        Args:
            doc: DocuWorks document object

        Returns:
            List of temporary image file paths
        """
        images = []
        temp_dir = Path(self.config.processing.temp_dir)

        try:
            for page_idx in range(1, doc.Pages.Count + 1):
                page = doc.Pages.Item(page_idx)

                # Export page as image
                temp_image = temp_dir / f"page_{page_idx}.jpg"

                # Export method (adjust based on SDK documentation)
                page.ExportImage(
                    str(temp_image),
                    ImageFormat=1,  # JPEG format
                    Resolution=300  # DPI
                )

                if temp_image.exists():
                    images.append(str(temp_image))

        except Exception as e:
            logger.warning(f"Failed to extract images: {e}")

        return images

    def _process_with_ocr_fallback(
        self,
        file_path: str,
        file_info: dict,
        start_time: float
    ) -> ProcessingResult:
        """
        OCR fallback processing
        (Implementation from existing docuworks_processor.py)
        """
        # Use existing OCR fallback implementation
        # ... (code from original file)
        pass

    def cleanup(self):
        """Cleanup SDK resources"""
        if self.dw_app:
            try:
                self.dw_app.Quit()
            except:
                pass

        super().cleanup()
```

### 3. License Management Best Practices

#### License Configuration

```python
# config.py - DocuWorks License Configuration

@dataclass
class DocuWorksConfig:
    """DocuWorks SDK configuration"""

    # SDK Path
    sdk_path: str = os.environ.get('DOCUWORKS_SDK_PATH', 'C:\\Program Files\\Fuji Xerox\\DocuWorks')

    # License Information (DO NOT hardcode - use AWS Secrets Manager)
    license_key: str = os.environ.get('DOCUWORKS_LICENSE_KEY', '')
    license_type: str = os.environ.get('DOCUWORKS_LICENSE_TYPE', 'commercial')  # commercial or trial

    # Processing Options
    extract_text: bool = os.environ.get('DOCUWORKS_EXTRACT_TEXT', 'true').lower() == 'true'
    extract_images: bool = os.environ.get('DOCUWORKS_EXTRACT_IMAGES', 'true').lower() == 'true'
    convert_to_pdf: bool = os.environ.get('DOCUWORKS_TO_PDF', 'false').lower() == 'true'

    # Fallback Options
    use_ocr_fallback: bool = os.environ.get('DOCUWORKS_OCR_FALLBACK', 'true').lower() == 'true'

    # Performance Settings
    max_pages_per_document: int = int(os.environ.get('DOCUWORKS_MAX_PAGES', '1000'))
    processing_timeout: int = int(os.environ.get('DOCUWORKS_TIMEOUT', '300'))

    # Concurrent License Management
    max_concurrent_instances: int = 1  # With 1 license, only 1 concurrent instance allowed

    def is_configured(self) -> bool:
        """Check if SDK is properly configured"""
        return (
            self.sdk_path and
            Path(self.sdk_path).exists() and
            self.license_key  # Verify license key is set
        )
```

#### Storing License in AWS Secrets Manager

```bash
# Store DocuWorks license key securely
aws secretsmanager create-secret \
    --name cis-filesearch/docuworks-license \
    --description "DocuWorks Commercial License Key" \
    --secret-string '{
        "license_key": "YOUR-LICENSE-KEY-HERE",
        "license_type": "commercial",
        "purchased_date": "2024-12-01",
        "expiry_date": "2025-12-01",
        "max_concurrent": 1
    }' \
    --region ap-northeast-1
```

#### Retrieving License at Runtime

```python
# services/license_manager.py

import boto3
import json
import logging
from typing import Optional, Dict

logger = logging.getLogger(__name__)


class LicenseManager:
    """Manage DocuWorks license retrieval from AWS Secrets Manager"""

    def __init__(self, secret_name: str = 'cis-filesearch/docuworks-license'):
        """
        Initialize license manager

        Args:
            secret_name: AWS Secrets Manager secret name
        """
        self.secret_name = secret_name
        self.secrets_client = boto3.client('secretsmanager')
        self._cached_license = None

    def get_license(self) -> Optional[Dict]:
        """
        Retrieve license from Secrets Manager

        Returns:
            License information dictionary or None
        """
        if self._cached_license:
            return self._cached_license

        try:
            response = self.secrets_client.get_secret_value(
                SecretId=self.secret_name
            )

            secret_data = json.loads(response['SecretString'])

            self._cached_license = secret_data
            logger.info("DocuWorks license retrieved from Secrets Manager")

            return secret_data

        except Exception as e:
            logger.error(f"Failed to retrieve license: {e}")
            return None

    def validate_license(self) -> bool:
        """
        Validate license is current and usable

        Returns:
            True if license is valid
        """
        license_info = self.get_license()

        if not license_info:
            return False

        # Check expiry date
        from datetime import datetime
        expiry = license_info.get('expiry_date')
        if expiry:
            expiry_date = datetime.fromisoformat(expiry)
            if datetime.now() > expiry_date:
                logger.error("DocuWorks license has expired")
                return False

        return True
```

---

## Bedrock Integration Strategy

### 1. Bedrock Client Integration

#### Creating Unified Bedrock Client

```python
# services/bedrock_client.py
# Merge from ec2-worker implementation

"""
Amazon Bedrock Client for Image and Text Vectorization
Integrated into Python Worker
"""

import logging
import base64
import json
from typing import Optional, List, Dict
from pathlib import Path
import boto3
from botocore.exceptions import ClientError
from PIL import Image
import io

logger = logging.getLogger(__name__)


class BedrockClient:
    """
    Bedrock client for vector embeddings

    Supports:
    - Image vectorization (Titan Multimodal Embeddings)
    - Text vectorization
    - Multimodal embeddings
    """

    def __init__(self, config):
        """
        Initialize Bedrock client

        Args:
            config: Configuration object
        """
        self.config = config

        # Create Bedrock Runtime client
        self.bedrock_runtime = boto3.client(
            'bedrock-runtime',
            region_name=config.bedrock.region or config.aws.region
        )

        # Model configuration
        self.model_id = config.bedrock.model_id
        self.vector_dimension = 1024  # Titan Multimodal Embeddings

        logger.info(f"Initialized Bedrock client: {self.model_id}")

    def generate_image_embedding(self, image_path: str) -> Optional[List[float]]:
        """
        Generate embedding from image file

        Args:
            image_path: Path to image file

        Returns:
            1024-dimensional vector or None
        """
        try:
            logger.debug(f"Generating image embedding: {image_path}")

            # Encode image to Base64
            image_base64 = self._encode_image(image_path)
            if not image_base64:
                return None

            # Create request
            request_body = {
                "inputImage": image_base64
            }

            # Invoke Bedrock
            response = self.bedrock_runtime.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body),
                contentType='application/json',
                accept='application/json'
            )

            # Parse response
            response_body = json.loads(response['body'].read())
            embedding = response_body.get('embedding')

            if embedding and len(embedding) == self.vector_dimension:
                logger.debug(f"Generated embedding: {len(embedding)} dimensions")
                return embedding

            return None

        except ClientError as e:
            logger.error(f"Bedrock API error: {e}")
            return None
        except Exception as e:
            logger.error(f"Image embedding failed: {e}")
            return None

    def generate_text_embedding(self, text: str) -> Optional[List[float]]:
        """
        Generate embedding from text

        Args:
            text: Text content

        Returns:
            1024-dimensional vector or None
        """
        try:
            logger.debug("Generating text embedding")

            # Limit text length
            text = text[:1000]

            request_body = {
                "inputText": text
            }

            response = self.bedrock_runtime.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body),
                contentType='application/json',
                accept='application/json'
            )

            response_body = json.loads(response['body'].read())
            embedding = response_body.get('embedding')

            if embedding and len(embedding) == self.vector_dimension:
                return embedding

            return None

        except Exception as e:
            logger.error(f"Text embedding failed: {e}")
            return None

    def generate_multimodal_embedding(
        self,
        image_path: str,
        text: str
    ) -> Optional[List[float]]:
        """
        Generate multimodal embedding from image + text

        Args:
            image_path: Path to image
            text: Text content

        Returns:
            1024-dimensional vector or None
        """
        try:
            image_base64 = self._encode_image(image_path)
            if not image_base64:
                return None

            request_body = {
                "inputImage": image_base64,
                "inputText": text[:1000]
            }

            response = self.bedrock_runtime.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body),
                contentType='application/json',
                accept='application/json'
            )

            response_body = json.loads(response['body'].read())
            return response_body.get('embedding')

        except Exception as e:
            logger.error(f"Multimodal embedding failed: {e}")
            return None

    def _encode_image(self, image_path: str) -> Optional[str]:
        """
        Encode image to Base64 for Bedrock

        Args:
            image_path: Image file path

        Returns:
            Base64-encoded string or None
        """
        try:
            with Image.open(image_path) as img:
                # Resize if needed (Bedrock limit: 2048x2048)
                max_size = (2048, 2048)
                if img.width > max_size[0] or img.height > max_size[1]:
                    img.thumbnail(max_size, Image.Resampling.LANCZOS)

                # Convert to RGB
                if img.mode != 'RGB':
                    img = img.convert('RGB')

                # Convert to bytes
                img_byte_arr = io.BytesIO()
                img.save(img_byte_arr, format='JPEG', quality=95)
                img_bytes = img_byte_arr.getvalue()

                # Base64 encode
                return base64.b64encode(img_bytes).decode('utf-8')

        except Exception as e:
            logger.error(f"Image encoding failed: {e}")
            return None

    def test_connection(self) -> bool:
        """
        Test Bedrock connection

        Returns:
            True if connection successful
        """
        try:
            test_text = "Connection test"
            embedding = self.generate_text_embedding(test_text)

            return embedding is not None and len(embedding) == self.vector_dimension

        except Exception as e:
            logger.error(f"Bedrock connection test failed: {e}")
            return False
```

### 2. Configuration for Bedrock

```python
# config.py - Add Bedrock configuration

@dataclass
class BedrockConfig:
    """AWS Bedrock configuration"""

    # Model Configuration
    model_id: str = os.environ.get(
        'BEDROCK_MODEL_ID',
        'amazon.titan-embed-image-v1'
    )

    # Region (can be different from main AWS region)
    region: str = os.environ.get('BEDROCK_REGION', '')

    # Feature Flags
    enable_image_vectorization: bool = os.environ.get(
        'BEDROCK_IMAGE_VECTOR',
        'true'
    ).lower() == 'true'

    enable_text_vectorization: bool = os.environ.get(
        'BEDROCK_TEXT_VECTOR',
        'true'
    ).lower() == 'true'

    enable_multimodal: bool = os.environ.get(
        'BEDROCK_MULTIMODAL',
        'false'
    ).lower() == 'true'

    # Performance Settings
    max_retries: int = int(os.environ.get('BEDROCK_MAX_RETRIES', '3'))
    timeout: int = int(os.environ.get('BEDROCK_TIMEOUT', '30'))

    # Batch Processing
    batch_size: int = int(os.environ.get('BEDROCK_BATCH_SIZE', '10'))

    def get_region(self, default_region: str) -> str:
        """Get Bedrock region, fallback to default"""
        return self.region if self.region else default_region
```

---

## Configuration Strategy

### Environment Variables Configuration

```bash
# .env - Production Configuration

# ==========================================
# AWS Configuration
# ==========================================
AWS_REGION=ap-northeast-1
AWS_ACCOUNT_ID=123456789012

# ==========================================
# S3 Buckets
# ==========================================
S3_BUCKET=cis-filesearch-storage
S3_PROCESSED_PREFIX=processed/
S3_FAILED_PREFIX=failed/

# ==========================================
# SQS Configuration
# ==========================================
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789012/cis-file-processing
SQS_WAIT_TIME=20
SQS_VISIBILITY_TIMEOUT=300
SQS_MAX_MESSAGES=1

# ==========================================
# OpenSearch Configuration
# ==========================================
OPENSEARCH_ENDPOINT=https://search-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
OPENSEARCH_USE_SSL=true
OPENSEARCH_VERIFY_CERTS=true

# ==========================================
# DocuWorks Configuration
# ==========================================
DOCUWORKS_SDK_PATH=C:\Program Files\Fuji Xerox\DocuWorks
DOCUWORKS_LICENSE_SECRET=cis-filesearch/docuworks-license
DOCUWORKS_EXTRACT_TEXT=true
DOCUWORKS_EXTRACT_IMAGES=true
DOCUWORKS_OCR_FALLBACK=true
DOCUWORKS_MAX_PAGES=1000
DOCUWORKS_TIMEOUT=300

# ==========================================
# Bedrock Configuration
# ==========================================
BEDROCK_MODEL_ID=amazon.titan-embed-image-v1
BEDROCK_REGION=us-east-1
BEDROCK_IMAGE_VECTOR=true
BEDROCK_TEXT_VECTOR=true
BEDROCK_MULTIMODAL=false
BEDROCK_MAX_RETRIES=3

# ==========================================
# OCR Configuration
# ==========================================
TESSERACT_CMD=tesseract
TESSDATA_PREFIX=/usr/local/share/tessdata
OCR_LANGUAGE=jpn+eng
PDF_DPI=300
MIN_OCR_CONFIDENCE=50.0

# ==========================================
# Processing Configuration
# ==========================================
MAX_FILE_SIZE_MB=100
PROCESSING_TIMEOUT=300
MAX_WORKERS=4
TEMP_DIR=/tmp/file-processor

# ==========================================
# Logging Configuration
# ==========================================
LOG_LEVEL=INFO
LOG_FILE=/var/log/file-processor.log
CLOUDWATCH_LOG_GROUP=/aws/ec2/file-processor
CLOUDWATCH_LOG_STREAM=worker
```

---

## OpenSearch Vector Search Integration

### 1. Enhanced OpenSearch Mapping with k-NN

```python
# Enhanced OpenSearch index creation with vector field

def create_index_with_vectors(self, index_name: Optional[str] = None) -> bool:
    """
    Create OpenSearch index with k-NN vector support

    Args:
        index_name: Index name (defaults to config)

    Returns:
        True if successful
    """
    if not self.is_connected():
        return False

    index_name = index_name or self.config.aws.opensearch_index

    # Check if index exists
    if self.client.indices.exists(index=index_name):
        logger.info(f"Index '{index_name}' already exists")
        return True

    # Index configuration with k-NN enabled
    index_body = {
        "settings": {
            "index": {
                "number_of_shards": 2,
                "number_of_replicas": 1,
                "refresh_interval": "5s",
                # Enable k-NN for vector search
                "knn": True,
                "knn.algo_param.ef_search": 512
            },
            "analysis": {
                "analyzer": {
                    "japanese_analyzer": {
                        "type": "custom",
                        "tokenizer": "kuromoji_tokenizer",
                        "filter": ["kuromoji_baseform", "lowercase", "cjk_width"]
                    }
                }
            }
        },
        "mappings": {
            "properties": {
                # File identification
                "file_id": {"type": "keyword"},
                "file_key": {"type": "keyword"},
                "file_name": {
                    "type": "text",
                    "analyzer": "japanese_analyzer",
                    "fields": {
                        "keyword": {"type": "keyword"}
                    }
                },
                "file_path": {
                    "type": "text",
                    "analyzer": "japanese_analyzer",
                    "fields": {
                        "keyword": {"type": "keyword"}
                    }
                },
                "file_type": {"type": "keyword"},
                "mime_type": {"type": "keyword"},
                "file_size": {"type": "long"},

                # Content fields
                "extracted_text": {
                    "type": "text",
                    "analyzer": "japanese_analyzer"
                },
                "page_count": {"type": "integer"},
                "word_count": {"type": "integer"},
                "char_count": {"type": "integer"},

                # Vector field for k-NN search
                "image_vector": {
                    "type": "knn_vector",
                    "dimension": 1024,  # Titan Multimodal Embeddings dimension
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

                # Metadata
                "metadata": {
                    "type": "object",
                    "enabled": True
                },

                # Processing information
                "processor_name": {"type": "keyword"},
                "processing_method": {"type": "keyword"},
                "processing_time_seconds": {"type": "float"},
                "processed_at": {"type": "date"},
                "indexed_at": {"type": "date"},

                # OCR information
                "ocr_confidence": {"type": "float"},
                "ocr_language": {"type": "keyword"},

                # Bedrock information
                "vectorized": {"type": "boolean"},
                "vector_model": {"type": "keyword"},

                # S3 information
                "bucket": {"type": "keyword"},
                "s3_url": {"type": "keyword"},
                "thumbnail_url": {"type": "keyword"},

                # Status
                "success": {"type": "boolean"},
                "error_message": {"type": "text"}
            }
        }
    }

    try:
        response = self.client.indices.create(
            index=index_name,
            body=index_body
        )

        logger.info(f"Created index with k-NN support: {index_name}")
        return True

    except Exception as e:
        logger.error(f"Failed to create index: {e}")
        return False
```

### 2. Vector Search Methods

```python
def vector_search(
    self,
    query_vector: List[float],
    k: int = 10,
    index_name: Optional[str] = None,
    filters: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Perform k-NN vector similarity search

    Args:
        query_vector: Query embedding vector (1024-dim)
        k: Number of results to return
        index_name: Index name (defaults to config)
        filters: Additional filters to apply

    Returns:
        Search results with similarity scores
    """
    if not self.is_connected():
        return {'hits': {'total': {'value': 0}, 'hits': []}}

    index_name = index_name or self.config.aws.opensearch_index

    try:
        # Build k-NN query
        knn_query = {
            "size": k,
            "query": {
                "knn": {
                    "image_vector": {
                        "vector": query_vector,
                        "k": k
                    }
                }
            }
        }

        # Add filters if provided
        if filters:
            knn_query["query"] = {
                "bool": {
                    "must": [
                        {"knn": {"image_vector": {"vector": query_vector, "k": k}}}
                    ],
                    "filter": filters
                }
            }

        # Execute search
        response = self.client.search(
            index=index_name,
            body=knn_query
        )

        logger.info(f"Vector search returned {len(response['hits']['hits'])} results")
        return response

    except Exception as e:
        logger.error(f"Vector search failed: {e}")
        return {'hits': {'total': {'value': 0}, 'hits': []}}


def hybrid_search(
    self,
    text_query: str,
    query_vector: Optional[List[float]] = None,
    text_weight: float = 0.5,
    vector_weight: float = 0.5,
    size: int = 10,
    index_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Hybrid search combining text and vector similarity

    Args:
        text_query: Text search query
        query_vector: Optional query vector for similarity search
        text_weight: Weight for text search (0-1)
        vector_weight: Weight for vector search (0-1)
        size: Number of results
        index_name: Index name

    Returns:
        Combined search results
    """
    if not self.is_connected():
        return {'hits': {'total': {'value': 0}, 'hits': []}}

    index_name = index_name or self.config.aws.opensearch_index

    try:
        # Build hybrid query
        must_clauses = []

        # Text search component
        if text_query:
            must_clauses.append({
                "multi_match": {
                    "query": text_query,
                    "fields": ["file_name^3", "file_path^2", "extracted_text"],
                    "boost": text_weight
                }
            })

        # Vector search component
        if query_vector:
            must_clauses.append({
                "knn": {
                    "image_vector": {
                        "vector": query_vector,
                        "k": size,
                        "boost": vector_weight
                    }
                }
            })

        search_body = {
            "query": {
                "bool": {
                    "should": must_clauses
                }
            },
            "size": size,
            "highlight": {
                "fields": {
                    "extracted_text": {},
                    "file_name": {}
                }
            }
        }

        response = self.client.search(
            index=index_name,
            body=search_body
        )

        logger.info(f"Hybrid search returned {len(response['hits']['hits'])} results")
        return response

    except Exception as e:
        logger.error(f"Hybrid search failed: {e}")
        return {'hits': {'total': {'value': 0}, 'hits': []}}
```

---

## Implementation Plan

### Phase 1: Preparation (Week 1)

**Tasks:**
1. Set up Windows EC2 instance for DocuWorks
2. Install DocuWorks SDK and verify license
3. Configure AWS Secrets Manager for license storage
4. Set up development environment

**Deliverables:**
- Windows Server 2022 EC2 instance configured
- DocuWorks SDK installed and verified
- License stored in Secrets Manager
- Development environment ready

### Phase 2: Code Integration (Week 2)

**Tasks:**
1. Merge Bedrock client from ec2-worker into python-worker
2. Enhance DocuWorks processor with SDK implementation
3. Update configuration management
4. Implement license manager service

**Deliverables:**
- Unified codebase with Bedrock integration
- Enhanced DocuWorks processor
- License manager service
- Updated configuration files

### Phase 3: OpenSearch Enhancement (Week 3)

**Tasks:**
1. Update OpenSearch client with k-NN vector support
2. Implement vector search methods
3. Implement hybrid search capability
4. Update index mappings

**Deliverables:**
- OpenSearch client with vector search
- k-NN enabled index
- Vector and hybrid search methods
- Migration scripts

### Phase 4: Testing and Optimization (Week 4)

**Tasks:**
1. Unit testing for all new components
2. Integration testing with sample files
3. Performance testing and optimization
4. End-to-end testing

**Deliverables:**
- Comprehensive test suite
- Performance benchmarks
- Optimization report
- Test documentation

### Phase 5: Deployment (Week 5)

**Tasks:**
1. Deploy to production environment
2. Configure monitoring and alerts
3. Document deployment procedures
4. Train operations team

**Deliverables:**
- Production deployment
- Monitoring dashboards
- Operations runbook
- Training materials

---

## Deployment Guide

### Prerequisites

1. **AWS Resources**
   - EC2 instance (Windows Server 2022, t3.medium or larger)
   - OpenSearch domain (t3.medium.search or larger)
   - S3 buckets configured
   - SQS queue set up
   - IAM roles and policies

2. **Software Requirements**
   - DocuWorks SDK installed
   - Python 3.11+
   - Tesseract OCR
   - Required system libraries

3. **Network Configuration**
   - VPC endpoints for AWS services
   - Security groups configured
   - NAT Gateway for internet access (if needed)

### Deployment Steps

#### Step 1: Prepare EC2 Instance

```powershell
# On Windows Server EC2 instance

# 1. Install Python
$pythonUrl = "https://www.python.org/ftp/python/3.11.5/python-3.11.5-amd64.exe"
Invoke-WebRequest -Uri $pythonUrl -OutFile "python-installer.exe"
Start-Process -Wait -FilePath "python-installer.exe" -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1"

# 2. Install DocuWorks SDK
# (Manual installation required - follow vendor instructions)

# 3. Install Tesseract OCR
choco install tesseract -y

# 4. Clone repository
git clone https://github.com/your-org/cis-filesearch-app.git
cd cis-filesearch-app/backend/python-worker

# 5. Create virtual environment
python -m venv venv
.\venv\Scripts\activate

# 6. Install dependencies
pip install -r requirements.txt

# 7. Install pywin32 for COM support
pip install pywin32
python .\venv\Scripts\pywin32_postinstall.py -install
```

#### Step 2: Configure Environment

```powershell
# Create .env file
@"
AWS_REGION=ap-northeast-1
S3_BUCKET=cis-filesearch-storage
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789012/cis-file-processing
OPENSEARCH_ENDPOINT=https://search-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index

DOCUWORKS_SDK_PATH=C:\Program Files\Fuji Xerox\DocuWorks
DOCUWORKS_LICENSE_SECRET=cis-filesearch/docuworks-license
DOCUWORKS_EXTRACT_TEXT=true
DOCUWORKS_EXTRACT_IMAGES=true
DOCUWORKS_OCR_FALLBACK=true

BEDROCK_MODEL_ID=amazon.titan-embed-image-v1
BEDROCK_REGION=us-east-1
BEDROCK_IMAGE_VECTOR=true
BEDROCK_TEXT_VECTOR=true

LOG_LEVEL=INFO
"@ | Out-File -FilePath .env -Encoding UTF8
```

#### Step 3: Initialize OpenSearch Index

```powershell
# Create k-NN enabled index
python -c "
from opensearch_client import OpenSearchClient
from config import get_config

config = get_config()
client = OpenSearchClient(config)

if client.create_index_with_vectors():
    print('Index created successfully')
else:
    print('Failed to create index')
"
```

#### Step 4: Start Worker Service

```powershell
# Test run
python worker.py --validate-only

# Start worker
python worker.py

# Or install as Windows Service
# (Use NSSM or sc.exe)
```

#### Step 5: Configure as Windows Service

```powershell
# Install NSSM (Non-Sucking Service Manager)
choco install nssm -y

# Create service
nssm install CISFileWorker "C:\path\to\python-worker\venv\Scripts\python.exe"
nssm set CISFileWorker AppDirectory "C:\path\to\python-worker"
nssm set CISFileWorker AppParameters "worker.py"
nssm set CISFileWorker DisplayName "CIS File Search Worker"
nssm set CISFileWorker Description "File processing worker with DocuWorks and Bedrock support"
nssm set CISFileWorker Start SERVICE_AUTO_START

# Configure logging
nssm set CISFileWorker AppStdout "C:\logs\worker-stdout.log"
nssm set CISFileWorker AppStderr "C:\logs\worker-stderr.log"

# Start service
nssm start CISFileWorker

# Check status
nssm status CISFileWorker
```

---

## Testing Strategy

### Unit Tests

```python
# tests/unit/test_docuworks_sdk_processor.py

import pytest
from unittest.mock import Mock, patch, MagicMock
from processors.docuworks_sdk_processor import DocuWorksSDKProcessor


class TestDocuWorksSDKProcessor:
    """Test suite for DocuWorks SDK processor"""

    @pytest.fixture
    def mock_config(self):
        """Create mock configuration"""
        config = Mock()
        config.docuworks.is_configured.return_value = True
        config.docuworks.use_ocr_fallback = True
        config.docuworks.extract_images = True
        return config

    @pytest.fixture
    def processor(self, mock_config):
        """Create processor instance"""
        with patch('processors.docuworks_sdk_processor.win32com.client'):
            return DocuWorksSDKProcessor(mock_config)

    def test_can_process_xdw_file(self, processor):
        """Test XDW file detection"""
        assert processor.can_process('test.xdw')
        assert processor.can_process('test.XDW')
        assert not processor.can_process('test.pdf')

    def test_can_process_xbd_file(self, processor):
        """Test XBD file detection"""
        assert processor.can_process('test.xbd')
        assert processor.can_process('test.XBD')

    @patch('processors.docuworks_sdk_processor.win32com.client')
    def test_sdk_initialization_success(self, mock_win32, mock_config):
        """Test successful SDK initialization"""
        mock_app = MagicMock()
        mock_app.Version = "9.0"
        mock_win32.Dispatch.return_value = mock_app

        processor = DocuWorksSDKProcessor(mock_config)

        assert processor.sdk_available
        assert processor.dw_app is not None

    @patch('processors.docuworks_sdk_processor.win32com.client')
    def test_sdk_initialization_failure(self, mock_win32, mock_config):
        """Test SDK initialization failure"""
        mock_win32.Dispatch.side_effect = Exception("COM error")

        processor = DocuWorksSDKProcessor(mock_config)

        assert not processor.sdk_available
        assert processor.dw_app is None

    @patch('processors.docuworks_sdk_processor.win32com.client')
    def test_process_with_sdk_success(self, mock_win32, mock_config, tmp_path):
        """Test successful SDK processing"""
        # Create test file
        test_file = tmp_path / "test.xdw"
        test_file.touch()

        # Mock DocuWorks objects
        mock_app = MagicMock()
        mock_doc = MagicMock()
        mock_page = MagicMock()

        mock_page.GetText.return_value = "Test content"
        mock_doc.Pages.Count = 1
        mock_doc.Pages.Item.return_value = mock_page
        mock_doc.Title = "Test Document"
        mock_doc.Author = "Test Author"
        mock_app.Documents.Open.return_value = mock_doc
        mock_app.Version = "9.0"
        mock_win32.Dispatch.return_value = mock_app

        processor = DocuWorksSDKProcessor(mock_config)
        result = processor.process(str(test_file))

        assert result.success
        assert "Test content" in result.extracted_text
        assert result.page_count == 1

    def test_ocr_fallback_on_sdk_failure(self, processor, tmp_path):
        """Test OCR fallback when SDK fails"""
        test_file = tmp_path / "test.xdw"
        test_file.touch()

        processor.sdk_available = False

        with patch.object(processor, '_process_with_ocr_fallback') as mock_ocr:
            processor.process(str(test_file))
            mock_ocr.assert_called_once()
```

### Integration Tests

```python
# tests/integration/test_bedrock_integration.py

import pytest
from services.bedrock_client import BedrockClient
from processors.image_processor import ImageProcessor


class TestBedrockIntegration:
    """Integration tests for Bedrock service"""

    @pytest.fixture
    def bedrock_client(self, config):
        """Create Bedrock client"""
        return BedrockClient(config)

    @pytest.mark.integration
    def test_connection(self, bedrock_client):
        """Test Bedrock connection"""
        assert bedrock_client.test_connection()

    @pytest.mark.integration
    def test_image_vectorization(self, bedrock_client, sample_image):
        """Test image embedding generation"""
        vector = bedrock_client.generate_image_embedding(sample_image)

        assert vector is not None
        assert len(vector) == 1024
        assert all(isinstance(v, float) for v in vector)

    @pytest.mark.integration
    def test_text_vectorization(self, bedrock_client):
        """Test text embedding generation"""
        text = "これはテストテキストです。This is a test text."
        vector = bedrock_client.generate_text_embedding(text)

        assert vector is not None
        assert len(vector) == 1024

    @pytest.mark.integration
    def test_multimodal_vectorization(self, bedrock_client, sample_image):
        """Test multimodal embedding"""
        text = "画像の説明テキスト"
        vector = bedrock_client.generate_multimodal_embedding(sample_image, text)

        assert vector is not None
        assert len(vector) == 1024
```

### End-to-End Tests

```python
# tests/e2e/test_complete_pipeline.py

import pytest
from pathlib import Path
import time


class TestCompletePipeline:
    """End-to-end pipeline tests"""

    @pytest.mark.e2e
    def test_docuworks_to_opensearch(
        self,
        s3_client,
        sqs_client,
        opensearch_client,
        test_xdw_file
    ):
        """Test complete pipeline: S3 → SQS → Process → OpenSearch"""

        # 1. Upload file to S3
        bucket = 'test-bucket'
        key = 'test-files/sample.xdw'

        s3_client.upload_file(test_xdw_file, bucket, key)

        # 2. Send SQS message
        message = {
            'bucket': bucket,
            'key': key
        }
        sqs_client.send_message(
            QueueUrl='test-queue-url',
            MessageBody=json.dumps(message)
        )

        # 3. Wait for processing
        time.sleep(30)

        # 4. Verify in OpenSearch
        response = opensearch_client.search(
            query="sample",
            index_name='test-index'
        )

        assert response['hits']['total']['value'] > 0

        hit = response['hits']['hits'][0]
        assert 'image_vector' in hit['_source']
        assert len(hit['_source']['image_vector']) == 1024

    @pytest.mark.e2e
    def test_vector_search(
        self,
        opensearch_client,
        bedrock_client,
        test_query_image
    ):
        """Test vector similarity search"""

        # 1. Generate query vector
        query_vector = bedrock_client.generate_image_embedding(test_query_image)

        # 2. Perform vector search
        results = opensearch_client.vector_search(
            query_vector=query_vector,
            k=10
        )

        # 3. Verify results
        assert results['hits']['total']['value'] > 0

        for hit in results['hits']['hits']:
            assert '_score' in hit
            assert 'image_vector' in hit['_source']
```

---

## Monitoring and Operations

### CloudWatch Dashboards

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["CIS/FileProcessor", "FileProcessed"],
          [".", "ProcessingTime"],
          [".", "BedrockCalls"],
          [".", "DocuWorksProcessed"]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "ap-northeast-1",
        "title": "Processing Metrics"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Bedrock", "InvocationCount", {"stat": "Sum"}],
          [".", "InvocationLatency", {"stat": "Average"}],
          [".", "ClientErrors", {"stat": "Sum"}]
        ],
        "period": 300,
        "region": "us-east-1",
        "title": "Bedrock Metrics"
      }
    }
  ]
}
```

### CloudWatch Alarms

```bash
# High error rate alarm
aws cloudwatch put-metric-alarm \
    --alarm-name cis-worker-high-error-rate \
    --alarm-description "Alert when error rate exceeds 10%" \
    --metric-name ProcessingErrors \
    --namespace CIS/FileProcessor \
    --statistic Sum \
    --period 300 \
    --threshold 10 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 2

# Bedrock throttling alarm
aws cloudwatch put-metric-alarm \
    --alarm-name bedrock-throttling \
    --metric-name ThrottleCount \
    --namespace AWS/Bedrock \
    --statistic Sum \
    --period 60 \
    --threshold 5 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 1
```

### Performance Monitoring

```python
# services/metrics_service.py

import time
import logging
from typing import Dict, Any
from datetime import datetime
import boto3

logger = logging.getLogger(__name__)


class MetricsService:
    """CloudWatch metrics service"""

    def __init__(self, namespace: str = 'CIS/FileProcessor'):
        """
        Initialize metrics service

        Args:
            namespace: CloudWatch namespace
        """
        self.namespace = namespace
        self.cloudwatch = boto3.client('cloudwatch')

    def record_processing_time(self, processor: str, duration: float):
        """Record processing time"""
        self._put_metric(
            metric_name='ProcessingTime',
            value=duration,
            unit='Seconds',
            dimensions=[
                {'Name': 'Processor', 'Value': processor}
            ]
        )

    def record_bedrock_call(self, operation: str, success: bool, duration: float):
        """Record Bedrock API call"""
        self._put_metric(
            metric_name='BedrockCalls',
            value=1,
            unit='Count',
            dimensions=[
                {'Name': 'Operation', 'Value': operation},
                {'Name': 'Status', 'Value': 'Success' if success else 'Error'}
            ]
        )

        self._put_metric(
            metric_name='BedrockLatency',
            value=duration,
            unit='Milliseconds',
            dimensions=[
                {'Name': 'Operation', 'Value': operation}
            ]
        )

    def record_docuworks_processing(self, method: str, success: bool):
        """Record DocuWorks processing"""
        self._put_metric(
            metric_name='DocuWorksProcessed',
            value=1,
            unit='Count',
            dimensions=[
                {'Name': 'Method', 'Value': method},
                {'Name': 'Status', 'Value': 'Success' if success else 'Error'}
            ]
        )

    def _put_metric(
        self,
        metric_name: str,
        value: float,
        unit: str = 'None',
        dimensions: list = None
    ):
        """Put metric to CloudWatch"""
        try:
            self.cloudwatch.put_metric_data(
                Namespace=self.namespace,
                MetricData=[
                    {
                        'MetricName': metric_name,
                        'Value': value,
                        'Unit': unit,
                        'Timestamp': datetime.utcnow(),
                        'Dimensions': dimensions or []
                    }
                ]
            )
        except Exception as e:
            logger.warning(f"Failed to put metric: {e}")
```

---

## Summary and Next Steps

### Implementation Summary

この統合ガイドでは、以下を実現します:

1. **Unified Architecture**
   - python-workerをベースとした統合アーキテクチャ
   - DocuWorks SDK + Bedrock統合
   - 単一ワーカープロセスでの運用

2. **DocuWorks SDK Integration**
   - 商用ライセンスの適切な管理
   - SDK優先、OCR fallback
   - 画像抽出とベクトル化

3. **Bedrock Integration**
   - 画像・テキストベクトル化
   - OpenSearch k-NN検索
   - ハイブリッド検索機能

4. **Production-Ready Features**
   - 包括的なエラーハンドリング
   - メトリクス・監視
   - スケーラブルなアーキテクチャ

### Next Steps

1. **Week 1: Environment Setup**
   - Windows EC2インスタンスのセットアップ
   - DocuWorks SDKのインストール
   - ライセンスの設定

2. **Week 2: Code Integration**
   - Bedrockクライアントの統合
   - DocuWorksプロセッサーの強化
   - 設定管理の更新

3. **Week 3: OpenSearch Enhancement**
   - k-NNベクトルサーチの実装
   - インデックスマッピングの更新
   - ハイブリッド検索の実装

4. **Week 4: Testing**
   - ユニットテスト
   - 統合テスト
   - E2Eテスト

5. **Week 5: Deployment**
   - 本番環境へのデプロイ
   - 監視・アラートの設定
   - ドキュメント作成

### Resources

- [DocuWorks Development Kit Documentation](https://www.fujixerox.co.jp/product/software/docuworks/)
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [OpenSearch k-NN Plugin](https://opensearch.org/docs/latest/search-plugins/knn/)
- [Python COM Programming](https://docs.microsoft.com/en-us/windows/win32/com/)

---

**Document Version:** 1.0
**Last Updated:** 2025-12-02
**Status:** Ready for Implementation
