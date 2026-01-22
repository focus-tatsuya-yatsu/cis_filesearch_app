"""
Image Embedding Generator Module
Generates image embeddings for images via Lambda function
Uses Amazon Bedrock Titan Embed Image model (1024 dimensions)
"""

import json
import logging
from typing import Optional, List, Dict, Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class ImageEmbeddingGenerator:
    """
    Generates image embeddings using AWS Lambda + Bedrock Titan
    1024-dimensional vectors for image similarity search
    """

    # Supported image extensions
    SUPPORTED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}

    def __init__(
        self,
        lambda_function_name: str = 'cis-filesearch-image-search',
        aws_region: str = 'ap-northeast-1',
        timeout: int = 30,
        enabled: bool = True
    ):
        """
        Initialize embedding generator

        Args:
            lambda_function_name: Lambda function name for embedding generation
            aws_region: AWS region
            timeout: Lambda invocation timeout in seconds
            enabled: Whether embedding generation is enabled
        """
        self.lambda_function_name = lambda_function_name
        self.aws_region = aws_region
        self.timeout = timeout
        self.enabled = enabled

        if enabled:
            try:
                self.lambda_client = boto3.client('lambda', region_name=aws_region)
                logger.info(f"ImageEmbeddingGenerator initialized (Lambda: {lambda_function_name})")
            except Exception as e:
                logger.error(f"Failed to initialize Lambda client: {e}")
                self.enabled = False
        else:
            self.lambda_client = None
            logger.info("ImageEmbeddingGenerator disabled")

    def is_supported(self, file_extension: str) -> bool:
        """
        Check if file extension is supported for embedding

        Args:
            file_extension: File extension (with dot, e.g., '.jpg')

        Returns:
            True if supported
        """
        return file_extension.lower() in self.SUPPORTED_EXTENSIONS

    def generate_embedding(
        self,
        s3_url: str,
        use_cache: bool = True
    ) -> Optional[Dict[str, Any]]:
        """
        Generate image embedding via Lambda

        Args:
            s3_url: S3 URL of the image (s3://bucket/key)
            use_cache: Whether to use DynamoDB cache

        Returns:
            Dictionary with 'embedding' (List[float]) and 'dimension' (int),
            or None on failure
        """
        if not self.enabled:
            logger.debug("Embedding generation is disabled")
            return None

        if not s3_url:
            logger.warning("No S3 URL provided for embedding generation")
            return None

        try:
            # Prepare Lambda payload
            payload = {
                'imageUrl': s3_url,
                'useCache': use_cache,
                'operation': 'generate'
            }

            logger.debug(f"Invoking Lambda for embedding: {s3_url}")

            # Invoke Lambda
            response = self.lambda_client.invoke(
                FunctionName=self.lambda_function_name,
                InvocationType='RequestResponse',
                Payload=json.dumps(payload)
            )

            # Check for function error
            if response.get('FunctionError'):
                logger.error(f"Lambda function error: {response.get('FunctionError')}")
                return None

            # Parse response
            result = json.loads(response['Payload'].read())

            # Handle both direct Lambda response and API Gateway response formats
            if 'statusCode' in result:
                # API Gateway format: {statusCode: 200, body: "..."}
                if result.get('statusCode') != 200:
                    error_body = result.get('body', '{}')
                    if isinstance(error_body, str):
                        error_body = json.loads(error_body)
                    logger.error(f"Lambda returned error: {error_body}")
                    return None

                body = result.get('body', '{}')
                if isinstance(body, str):
                    body = json.loads(body)
            else:
                # Direct Lambda response format: {success: true, data: {...}}
                body = result

            if not body.get('success'):
                logger.error(f"Embedding generation failed: {body.get('error')}")
                return None

            data = body.get('data', {})
            embedding = data.get('embedding')
            dimension = data.get('dimension', 1024)

            if not embedding:
                logger.error("No embedding returned from Lambda")
                return None

            logger.info(
                f"Generated {dimension}D embedding for {s3_url} "
                f"(cached={data.get('cached', False)})"
            )

            return {
                'embedding': embedding,
                'dimension': dimension,
                'cached': data.get('cached', False),
                'inference_time': data.get('inferenceTime', 0)
            }

        except ClientError as e:
            logger.error(f"Lambda invocation failed: {e}")
            return None
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Lambda response: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error generating embedding: {e}", exc_info=True)
            return None

    def generate_embedding_safe(
        self,
        s3_url: str,
        file_extension: str,
        use_cache: bool = True
    ) -> tuple[Optional[List[float]], Optional[int]]:
        """
        Safely generate embedding with extension check

        Args:
            s3_url: S3 URL of the image
            file_extension: File extension (with dot)
            use_cache: Whether to use cache

        Returns:
            Tuple of (embedding list, dimension) or (None, None) on failure/skip
        """
        # Skip if not supported
        if not self.is_supported(file_extension):
            logger.debug(f"Skipping embedding for unsupported extension: {file_extension}")
            return None, None

        # Generate embedding
        result = self.generate_embedding(s3_url, use_cache)

        if result:
            return result['embedding'], result['dimension']

        return None, None
