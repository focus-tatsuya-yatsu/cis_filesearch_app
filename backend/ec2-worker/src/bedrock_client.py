"""
Amazon Bedrock Client for Image Vectorization
Using Titan Multimodal Embeddings Model
"""

import logging
import base64
import json
from typing import Optional, List, Dict, Union
from pathlib import Path
import boto3
from botocore.exceptions import ClientError
from PIL import Image
import io
from config import config

logger = logging.getLogger(__name__)


class BedrockClient:
    """Bedrockクライアント - 画像ベクトル化"""

    def __init__(self):
        """初期化"""
        # Bedrock Runtime クライアントを作成
        # Bedrockリージョンを使用する設定を作成
        bedrock_config = config.get_boto3_config().copy()
        bedrock_config['region_name'] = config.bedrock.region

        self.bedrock_runtime = boto3.client(
            'bedrock-runtime',
            **bedrock_config
        )

        self.model_id = config.bedrock.model_id

        # ベクトル次元数（Titan Multimodal Embeddings）
        self.vector_dimension = 1024

        logger.info(f"Initialized Bedrock client with model: {self.model_id}")

    def generate_image_embedding(self, image_path: str) -> Optional[List[float]]:
        """
        画像からベクトル埋め込みを生成

        Args:
            image_path: 画像ファイルパス

        Returns:
            1024次元のベクトル（リスト）
        """
        try:
            logger.info(f"Generating embedding for image: {image_path}")

            # 画像をBase64エンコード
            image_base64 = self._encode_image(image_path)

            if not image_base64:
                logger.error(f"Failed to encode image: {image_path}")
                return None

            # リクエストボディを構築
            request_body = {
                "inputImage": image_base64
            }

            # Bedrock APIを呼び出し
            response = self.bedrock_runtime.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body),
                contentType='application/json',
                accept='application/json'
            )

            # レスポンスを解析
            response_body = json.loads(response['body'].read())

            # 埋め込みベクトルを取得
            embedding = response_body.get('embedding')

            if embedding:
                logger.info(f"Successfully generated embedding with dimension: {len(embedding)}")
                return embedding
            else:
                logger.error("No embedding found in response")
                return None

        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Bedrock API error [{error_code}]: {error_message}")
            return None

        except Exception as e:
            logger.error(f"Failed to generate image embedding: {str(e)}")
            return None

    def generate_text_embedding(self, text: str) -> Optional[List[float]]:
        """
        テキストからベクトル埋め込みを生成

        Args:
            text: テキスト

        Returns:
            1024次元のベクトル（リスト）
        """
        try:
            logger.info("Generating embedding for text")

            # リクエストボディを構築
            request_body = {
                "inputText": text[:1000]  # 最大文字数制限
            }

            # Bedrock APIを呼び出し
            response = self.bedrock_runtime.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body),
                contentType='application/json',
                accept='application/json'
            )

            # レスポンスを解析
            response_body = json.loads(response['body'].read())

            # 埋め込みベクトルを取得
            embedding = response_body.get('embedding')

            if embedding:
                logger.info(f"Successfully generated text embedding with dimension: {len(embedding)}")
                return embedding
            else:
                logger.error("No embedding found in response")
                return None

        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Bedrock API error [{error_code}]: {error_message}")
            return None

        except Exception as e:
            logger.error(f"Failed to generate text embedding: {str(e)}")
            return None

    def generate_multimodal_embedding(self, image_path: str, text: str) -> Optional[List[float]]:
        """
        画像とテキストを組み合わせたマルチモーダル埋め込みを生成

        Args:
            image_path: 画像ファイルパス
            text: テキスト

        Returns:
            1024次元のベクトル（リスト）
        """
        try:
            logger.info("Generating multimodal embedding")

            # 画像をBase64エンコード
            image_base64 = self._encode_image(image_path)

            if not image_base64:
                logger.error(f"Failed to encode image: {image_path}")
                return None

            # リクエストボディを構築
            request_body = {
                "inputImage": image_base64,
                "inputText": text[:1000]  # 最大文字数制限
            }

            # Bedrock APIを呼び出し
            response = self.bedrock_runtime.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body),
                contentType='application/json',
                accept='application/json'
            )

            # レスポンスを解析
            response_body = json.loads(response['body'].read())

            # 埋め込みベクトルを取得
            embedding = response_body.get('embedding')

            if embedding:
                logger.info(f"Successfully generated multimodal embedding with dimension: {len(embedding)}")
                return embedding
            else:
                logger.error("No embedding found in response")
                return None

        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Bedrock API error [{error_code}]: {error_message}")
            return None

        except Exception as e:
            logger.error(f"Failed to generate multimodal embedding: {str(e)}")
            return None

    def _encode_image(self, image_path: str) -> Optional[str]:
        """
        画像をBase64エンコード

        Args:
            image_path: 画像ファイルパス

        Returns:
            Base64エンコードされた文字列
        """
        try:
            # 画像を開いて処理
            with Image.open(image_path) as img:
                # 画像サイズを確認（Bedrockの制限に合わせる）
                max_size = (2048, 2048)  # Titan Multimodal Embeddingsの推奨サイズ

                # 必要に応じてリサイズ
                if img.width > max_size[0] or img.height > max_size[1]:
                    img.thumbnail(max_size, Image.Resampling.LANCZOS)
                    logger.debug(f"Resized image to {img.size}")

                # RGBに変換（必要な場合）
                if img.mode != 'RGB':
                    img = img.convert('RGB')

                # バイトデータに変換
                img_byte_arr = io.BytesIO()
                img.save(img_byte_arr, format='JPEG', quality=95)
                img_byte_arr = img_byte_arr.getvalue()

                # Base64エンコード
                encoded = base64.b64encode(img_byte_arr).decode('utf-8')

                return encoded

        except Exception as e:
            logger.error(f"Failed to encode image {image_path}: {str(e)}")
            return None

    def calculate_similarity(self, vector1: List[float], vector2: List[float]) -> float:
        """
        2つのベクトル間のコサイン類似度を計算

        Args:
            vector1: ベクトル1
            vector2: ベクトル2

        Returns:
            コサイン類似度（-1から1の値）
        """
        try:
            import numpy as np

            # NumPy配列に変換
            v1 = np.array(vector1)
            v2 = np.array(vector2)

            # コサイン類似度を計算
            dot_product = np.dot(v1, v2)
            norm_v1 = np.linalg.norm(v1)
            norm_v2 = np.linalg.norm(v2)

            if norm_v1 == 0 or norm_v2 == 0:
                return 0.0

            similarity = dot_product / (norm_v1 * norm_v2)

            return float(similarity)

        except Exception as e:
            logger.error(f"Failed to calculate similarity: {str(e)}")
            return 0.0

    def batch_generate_embeddings(self, items: List[Dict]) -> List[Dict]:
        """
        バッチで埋め込みを生成

        Args:
            items: 処理項目のリスト
                   [{'type': 'image', 'path': '...'},
                    {'type': 'text', 'content': '...'},
                    {'type': 'multimodal', 'path': '...', 'text': '...'}]

        Returns:
            埋め込み結果のリスト
        """
        results = []

        for item in items:
            try:
                item_type = item.get('type')
                result = {
                    'item': item,
                    'embedding': None,
                    'success': False,
                    'error': None
                }

                if item_type == 'image':
                    embedding = self.generate_image_embedding(item['path'])
                    result['embedding'] = embedding
                    result['success'] = embedding is not None

                elif item_type == 'text':
                    embedding = self.generate_text_embedding(item['content'])
                    result['embedding'] = embedding
                    result['success'] = embedding is not None

                elif item_type == 'multimodal':
                    embedding = self.generate_multimodal_embedding(item['path'], item['text'])
                    result['embedding'] = embedding
                    result['success'] = embedding is not None

                else:
                    result['error'] = f"Unknown item type: {item_type}"

                results.append(result)

            except Exception as e:
                logger.error(f"Failed to process item: {str(e)}")
                results.append({
                    'item': item,
                    'embedding': None,
                    'success': False,
                    'error': str(e)
                })

        return results

    def test_connection(self) -> bool:
        """
        Bedrock接続テスト

        Returns:
            接続成功の場合True
        """
        try:
            # 小さなテキストで埋め込み生成をテスト
            test_text = "Connection test"
            embedding = self.generate_text_embedding(test_text)

            if embedding and len(embedding) == self.vector_dimension:
                logger.info("Bedrock connection test successful")
                return True
            else:
                logger.error("Bedrock connection test failed: Invalid response")
                return False

        except Exception as e:
            logger.error(f"Bedrock connection test failed: {str(e)}")
            return False