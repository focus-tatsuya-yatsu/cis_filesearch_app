"""
Image Embedding Lambda Function
Generates 512-dimensional vector embeddings from images using CLIP model
"""

import json
import base64
import io
import os
import hashlib
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

import boto3
import torch
import numpy as np
from PIL import Image
from transformers import CLIPProcessor, CLIPModel

# AWS Clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Environment Variables
CACHE_TABLE_NAME = os.environ.get('EMBEDDING_CACHE_TABLE', 'cis-image-embedding-cache')
MODEL_NAME = os.environ.get('MODEL_NAME', 'openai/clip-vit-base-patch32')
VECTOR_DIMENSION = int(os.environ.get('VECTOR_DIMENSION', '512'))
MAX_IMAGE_SIZE = int(os.environ.get('MAX_IMAGE_SIZE', '2048'))

# Global model instances (reused across invocations)
model = None
processor = None
cache_table = None

class EmbeddingError(Exception):
    """Custom exception for embedding generation errors"""
    pass


def initialize_model():
    """Initialize CLIP model and processor (called once per container)"""
    global model, processor, cache_table

    if model is None:
        print(f"Loading model: {MODEL_NAME}")
        start_time = time.time()

        # Load model with optimizations
        model = CLIPModel.from_pretrained(MODEL_NAME)
        processor = CLIPProcessor.from_pretrained(MODEL_NAME)

        # Move to GPU if available (for container with GPU)
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model.to(device)

        # Set to evaluation mode
        model.eval()

        load_time = time.time() - start_time
        print(f"Model loaded in {load_time:.2f}s on device: {device}")

    if cache_table is None:
        cache_table = dynamodb.Table(CACHE_TABLE_NAME)
        print(f"Connected to cache table: {CACHE_TABLE_NAME}")


def get_image_hash(image_data: bytes) -> str:
    """Generate MD5 hash of image data for caching"""
    return hashlib.md5(image_data).hexdigest()


def check_cache(image_hash: str) -> Optional[List[float]]:
    """Check if embedding exists in DynamoDB cache"""
    try:
        response = cache_table.get_item(Key={'image_hash': image_hash})

        if 'Item' in response:
            print(f"Cache HIT for hash: {image_hash}")
            return response['Item']['embedding']

        print(f"Cache MISS for hash: {image_hash}")
        return None

    except Exception as e:
        print(f"Cache check error: {str(e)}")
        return None


def save_to_cache(image_hash: str, embedding: List[float], ttl_days: int = 30):
    """Save embedding to DynamoDB cache"""
    try:
        ttl = int(time.time()) + (ttl_days * 24 * 60 * 60)

        cache_table.put_item(
            Item={
                'image_hash': image_hash,
                'embedding': embedding,
                'dimension': VECTOR_DIMENSION,
                'model': MODEL_NAME,
                'created_at': int(time.time()),
                'ttl': ttl
            }
        )
        print(f"Saved embedding to cache: {image_hash}")

    except Exception as e:
        print(f"Cache save error: {str(e)}")


def load_image_from_s3(s3_url: str) -> bytes:
    """Load image from S3 bucket"""
    try:
        # Parse S3 URL
        parsed = urlparse(s3_url)
        bucket = parsed.netloc or parsed.path.split('/')[0]
        key = parsed.path.lstrip('/')

        print(f"Loading image from S3: s3://{bucket}/{key}")

        response = s3_client.get_object(Bucket=bucket, Key=key)
        image_data = response['Body'].read()

        print(f"Loaded {len(image_data)} bytes from S3")
        return image_data

    except Exception as e:
        raise EmbeddingError(f"Failed to load image from S3: {str(e)}")


def load_image_from_base64(base64_string: str) -> bytes:
    """Load image from base64 encoded string"""
    try:
        # Remove data URL prefix if present
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]

        image_data = base64.b64decode(base64_string)
        print(f"Decoded {len(image_data)} bytes from base64")
        return image_data

    except Exception as e:
        raise EmbeddingError(f"Failed to decode base64 image: {str(e)}")


def preprocess_image(image_data: bytes) -> Image.Image:
    """
    Preprocess image for model input
    - Resize if too large
    - Convert to RGB
    - Validate format
    """
    try:
        # Load image
        image = Image.open(io.BytesIO(image_data))

        print(f"Original image: {image.size}, mode: {image.mode}, format: {image.format}")

        # Convert to RGB if needed
        if image.mode != 'RGB':
            image = image.convert('RGB')
            print(f"Converted to RGB mode")

        # Resize if too large (maintain aspect ratio)
        width, height = image.size
        if width > MAX_IMAGE_SIZE or height > MAX_IMAGE_SIZE:
            ratio = min(MAX_IMAGE_SIZE / width, MAX_IMAGE_SIZE / height)
            new_size = (int(width * ratio), int(height * ratio))
            image = image.resize(new_size, Image.Resampling.LANCZOS)
            print(f"Resized to {new_size}")

        return image

    except Exception as e:
        raise EmbeddingError(f"Failed to preprocess image: {str(e)}")


def generate_embedding(image: Image.Image) -> Tuple[List[float], float]:
    """
    Generate embedding vector from image using CLIP model
    Returns: (embedding vector, inference time in seconds)
    """
    try:
        start_time = time.time()

        # Preprocess image
        inputs = processor(images=image, return_tensors="pt", padding=True)

        # Move to same device as model
        device = next(model.parameters()).device
        inputs = {k: v.to(device) for k, v in inputs.items()}

        # Generate embedding (no gradient computation for inference)
        with torch.no_grad():
            image_features = model.get_image_features(**inputs)

            # Normalize embedding (for cosine similarity)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)

        # Convert to numpy and then to list
        embedding = image_features.cpu().numpy()[0].tolist()

        inference_time = time.time() - start_time

        print(f"Generated embedding: dimension={len(embedding)}, time={inference_time:.3f}s")

        # Verify dimension
        if len(embedding) != VECTOR_DIMENSION:
            raise EmbeddingError(
                f"Unexpected embedding dimension: {len(embedding)} (expected {VECTOR_DIMENSION})"
            )

        return embedding, inference_time

    except Exception as e:
        raise EmbeddingError(f"Failed to generate embedding: {str(e)}")


def lambda_handler(event, context):
    """
    Lambda handler for image embedding generation

    Event structure:
    {
        "imageUrl": "s3://bucket/path/to/image.jpg",  // S3 URL
        "imageBase64": "data:image/jpeg;base64,...",  // Base64 encoded image
        "useCache": true,                             // Use DynamoDB cache (default: true)
        "operation": "generate"                       // Operation type
    }
    """
    print(f"Event: {json.dumps(event, default=str)}")

    try:
        # Initialize model (once per container)
        initialize_model()

        # Parse input
        image_url = event.get('imageUrl')
        image_base64 = event.get('imageBase64')
        use_cache = event.get('useCache', True)

        if not image_url and not image_base64:
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'success': False,
                    'error': {
                        'code': 'INVALID_INPUT',
                        'message': 'Either imageUrl or imageBase64 is required'
                    }
                })
            }

        # Load image data
        if image_url:
            image_data = load_image_from_s3(image_url)
        else:
            image_data = load_image_from_base64(image_base64)

        # Check cache
        image_hash = get_image_hash(image_data)

        if use_cache:
            cached_embedding = check_cache(image_hash)
            if cached_embedding:
                return {
                    'statusCode': 200,
                    'body': json.dumps({
                        'success': True,
                        'data': {
                            'embedding': cached_embedding,
                            'dimension': len(cached_embedding),
                            'model': MODEL_NAME,
                            'cached': True,
                            'imageHash': image_hash
                        }
                    })
                }

        # Preprocess and generate embedding
        image = preprocess_image(image_data)
        embedding, inference_time = generate_embedding(image)

        # Save to cache
        if use_cache:
            save_to_cache(image_hash, embedding)

        # Return response
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'success': True,
                'data': {
                    'embedding': embedding,
                    'dimension': len(embedding),
                    'model': MODEL_NAME,
                    'inferenceTime': round(inference_time, 3),
                    'cached': False,
                    'imageHash': image_hash
                }
            })
        }

    except EmbeddingError as e:
        print(f"Embedding error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'success': False,
                'error': {
                    'code': 'EMBEDDING_ERROR',
                    'message': str(e)
                }
            })
        }

    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        import traceback
        traceback.print_exc()

        return {
            'statusCode': 500,
            'body': json.dumps({
                'success': False,
                'error': {
                    'code': 'INTERNAL_ERROR',
                    'message': 'An unexpected error occurred',
                    'details': str(e)
                }
            })
        }
