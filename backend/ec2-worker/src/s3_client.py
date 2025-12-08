"""
S3 Client Module for File Operations
"""

import os
import logging
from typing import Optional, BinaryIO
from pathlib import Path
import tempfile
import boto3
from botocore.exceptions import ClientError
from config import config

logger = logging.getLogger(__name__)


class S3Client:
    """S3操作用クライアント"""

    def __init__(self):
        """初期化"""
        self.s3 = boto3.client('s3', **config.get_boto3_config())
        self.landing_bucket = config.s3.landing_bucket
        self.thumbnail_bucket = config.s3.thumbnail_bucket

    def download_file(self, bucket: str, key: str, local_path: Optional[str] = None) -> str:
        """
        S3からファイルをダウンロード

        Args:
            bucket: バケット名
            key: オブジェクトキー
            local_path: ローカル保存先（指定しない場合は一時ファイル）

        Returns:
            ダウンロードしたファイルのパス
        """
        try:
            if local_path is None:
                # 一時ファイルを作成
                suffix = Path(key).suffix
                temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
                local_path = temp_file.name
                temp_file.close()

            logger.info(f"Downloading s3://{bucket}/{key} to {local_path}")
            self.s3.download_file(bucket, key, local_path)
            logger.info(f"Successfully downloaded {key}")

            return local_path

        except ClientError as e:
            logger.error(f"Failed to download {key} from {bucket}: {str(e)}")
            raise

    def upload_file(self, local_path: str, bucket: str, key: str,
                    content_type: Optional[str] = None,
                    metadata: Optional[dict] = None) -> str:
        """
        ファイルをS3にアップロード

        Args:
            local_path: ローカルファイルパス
            bucket: バケット名
            key: オブジェクトキー
            content_type: Content-Type
            metadata: メタデータ

        Returns:
            S3 URL
        """
        try:
            extra_args = {}

            if content_type:
                extra_args['ContentType'] = content_type

            if metadata:
                extra_args['Metadata'] = metadata

            logger.info(f"Uploading {local_path} to s3://{bucket}/{key}")
            self.s3.upload_file(local_path, bucket, key, ExtraArgs=extra_args if extra_args else None)
            logger.info(f"Successfully uploaded to {key}")

            # S3 URLを返す
            return f"s3://{bucket}/{key}"

        except ClientError as e:
            logger.error(f"Failed to upload {local_path} to {bucket}/{key}: {str(e)}")
            raise

    def upload_fileobj(self, file_obj: BinaryIO, bucket: str, key: str,
                      content_type: Optional[str] = None) -> str:
        """
        ファイルオブジェクトをS3にアップロード

        Args:
            file_obj: ファイルオブジェクト
            bucket: バケット名
            key: オブジェクトキー
            content_type: Content-Type

        Returns:
            S3 URL
        """
        try:
            extra_args = {}

            if content_type:
                extra_args['ContentType'] = content_type

            logger.info(f"Uploading file object to s3://{bucket}/{key}")
            self.s3.upload_fileobj(file_obj, bucket, key, ExtraArgs=extra_args if extra_args else None)
            logger.info(f"Successfully uploaded to {key}")

            return f"s3://{bucket}/{key}"

        except ClientError as e:
            logger.error(f"Failed to upload file object to {bucket}/{key}: {str(e)}")
            raise

    def delete_file(self, bucket: str, key: str) -> bool:
        """
        S3からファイルを削除

        Args:
            bucket: バケット名
            key: オブジェクトキー

        Returns:
            削除成功の場合True
        """
        try:
            logger.info(f"Deleting s3://{bucket}/{key}")
            self.s3.delete_object(Bucket=bucket, Key=key)
            logger.info(f"Successfully deleted {key}")
            return True

        except ClientError as e:
            logger.error(f"Failed to delete {key} from {bucket}: {str(e)}")
            return False

    def get_object_metadata(self, bucket: str, key: str) -> Optional[dict]:
        """
        オブジェクトのメタデータを取得

        Args:
            bucket: バケット名
            key: オブジェクトキー

        Returns:
            メタデータ辞書
        """
        try:
            response = self.s3.head_object(Bucket=bucket, Key=key)
            return {
                'ContentType': response.get('ContentType'),
                'ContentLength': response.get('ContentLength'),
                'LastModified': response.get('LastModified'),
                'Metadata': response.get('Metadata', {}),
                'ETag': response.get('ETag')
            }

        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                logger.warning(f"Object not found: s3://{bucket}/{key}")
            else:
                logger.error(f"Failed to get metadata for {key}: {str(e)}")
            return None

    def generate_presigned_url(self, bucket: str, key: str, expires_in: int = 3600) -> Optional[str]:
        """
        署名付きURLを生成

        Args:
            bucket: バケット名
            key: オブジェクトキー
            expires_in: 有効期限（秒）

        Returns:
            署名付きURL
        """
        try:
            url = self.s3.generate_presigned_url(
                'get_object',
                Params={'Bucket': bucket, 'Key': key},
                ExpiresIn=expires_in
            )
            return url

        except ClientError as e:
            logger.error(f"Failed to generate presigned URL for {key}: {str(e)}")
            return None

    def list_objects(self, bucket: str, prefix: str = '', max_keys: int = 1000) -> list:
        """
        バケット内のオブジェクトをリスト

        Args:
            bucket: バケット名
            prefix: プレフィックス
            max_keys: 最大取得数

        Returns:
            オブジェクトリスト
        """
        try:
            response = self.s3.list_objects_v2(
                Bucket=bucket,
                Prefix=prefix,
                MaxKeys=max_keys
            )

            objects = []
            if 'Contents' in response:
                for obj in response['Contents']:
                    objects.append({
                        'Key': obj['Key'],
                        'Size': obj['Size'],
                        'LastModified': obj['LastModified']
                    })

            return objects

        except ClientError as e:
            logger.error(f"Failed to list objects in {bucket}: {str(e)}")
            return []

    def cleanup_temp_file(self, file_path: str) -> None:
        """
        一時ファイルをクリーンアップ

        Args:
            file_path: ファイルパス
        """
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.debug(f"Cleaned up temp file: {file_path}")
        except Exception as e:
            logger.warning(f"Failed to clean up temp file {file_path}: {str(e)}")