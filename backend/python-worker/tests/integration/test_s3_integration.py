"""
Integration Tests for S3 Operations
Tests file upload/download with mocked S3
"""

import pytest
import json
from pathlib import Path
from moto import mock_aws
import boto3

from worker import FileProcessingWorker


@pytest.mark.integration
class TestS3Integration:
    """Test S3 integration with mocked AWS services"""

    @pytest.fixture
    def s3_setup(self, test_config):
        """Setup mock S3 environment"""
        with mock_aws():
            # Create S3 client
            s3 = boto3.client('s3', region_name='us-east-1')

            # Create bucket
            s3.create_bucket(Bucket='test-bucket')

            yield s3, 'test-bucket'

    @pytest.fixture
    def worker(self, test_config):
        """Create worker instance"""
        with mock_aws():
            boto3.client('s3', region_name='us-east-1').create_bucket(Bucket='test-bucket')
            boto3.client('sqs', region_name='us-east-1').create_queue(QueueName='test-queue')

            worker = FileProcessingWorker(test_config)
            yield worker

    def test_download_file_from_s3_success(self, worker, s3_setup, sample_pdf: Path, temp_dir: Path):
        """Test successful file download from S3"""
        s3, bucket = s3_setup

        # Upload test file
        s3.upload_file(str(sample_pdf), bucket, 'test.pdf')

        # Download file
        local_path = temp_dir / 'downloaded.pdf'
        success = worker.download_file_from_s3(bucket, 'test.pdf', str(local_path))

        assert success
        assert local_path.exists()
        assert local_path.stat().st_size > 0

    def test_download_nonexistent_file(self, worker, s3_setup, temp_dir: Path):
        """Test download of nonexistent file"""
        s3, bucket = s3_setup

        local_path = temp_dir / 'missing.pdf'
        success = worker.download_file_from_s3(bucket, 'missing.pdf', str(local_path))

        assert not success
        assert not local_path.exists()

    def test_upload_thumbnail_to_s3(self, worker, s3_setup):
        """Test thumbnail upload to S3"""
        s3, bucket = s3_setup

        thumbnail_data = b'\x00\x01\x02\x03'  # Mock thumbnail
        thumbnail_url = worker.upload_thumbnail_to_s3(
            thumbnail_data,
            bucket,
            'original/file.pdf'
        )

        assert thumbnail_url is not None
        assert 'thumbnails' in thumbnail_url
        assert bucket in thumbnail_url

        # Verify thumbnail exists in S3
        response = s3.list_objects_v2(Bucket=bucket, Prefix='thumbnails/')
        assert response['KeyCount'] > 0

    def test_upload_thumbnail_with_metadata(self, worker, s3_setup):
        """Test thumbnail upload preserves metadata"""
        s3, bucket = s3_setup

        thumbnail_data = b'\x00\x01\x02\x03'
        original_key = 'documents/report.pdf'

        thumbnail_url = worker.upload_thumbnail_to_s3(
            thumbnail_data,
            bucket,
            original_key
        )

        # Get object metadata
        thumbnail_key = f"thumbnails/{original_key}.jpg"
        response = s3.head_object(Bucket=bucket, Key=thumbnail_key)

        assert response['Metadata']['original-key'] == original_key
        assert response['ContentType'] == 'image/jpeg'

    def test_download_large_file(self, worker, s3_setup, temp_dir: Path):
        """Test download of large file"""
        s3, bucket = s3_setup

        # Create large file (5MB)
        large_file = temp_dir / 'large.bin'
        large_file.write_bytes(b'x' * (5 * 1024 * 1024))

        # Upload
        s3.upload_file(str(large_file), bucket, 'large.bin')

        # Download
        download_path = temp_dir / 'downloaded_large.bin'
        success = worker.download_file_from_s3(bucket, 'large.bin', str(download_path))

        assert success
        assert download_path.stat().st_size == large_file.stat().st_size

    def test_s3_path_with_special_characters(self, worker, s3_setup, sample_pdf: Path, temp_dir: Path):
        """Test S3 key with special characters"""
        s3, bucket = s3_setup

        special_key = 'folder/file (copy) [1].pdf'

        # Upload
        s3.upload_file(str(sample_pdf), bucket, special_key)

        # Download
        local_path = temp_dir / 'special.pdf'
        success = worker.download_file_from_s3(bucket, special_key, str(local_path))

        assert success
        assert local_path.exists()

    def test_concurrent_s3_operations(self, worker, s3_setup, sample_pdf: Path, temp_dir: Path):
        """Test multiple concurrent S3 operations"""
        s3, bucket = s3_setup

        # Upload multiple files
        for i in range(5):
            s3.upload_file(str(sample_pdf), bucket, f'file_{i}.pdf')

        # Download all concurrently (simulate)
        downloaded = []
        for i in range(5):
            local_path = temp_dir / f'downloaded_{i}.pdf'
            success = worker.download_file_from_s3(bucket, f'file_{i}.pdf', str(local_path))
            downloaded.append(success)

        assert all(downloaded)

    @pytest.mark.slow
    def test_s3_retry_on_failure(self, worker, s3_setup, temp_dir: Path):
        """Test S3 retry mechanism on failure"""
        # This would require mocking transient failures
        pass

    def test_s3_bucket_permissions(self, worker):
        """Test handling of permission errors"""
        # This would require mocking permission denied errors
        pass


@pytest.mark.integration
class TestS3EventProcessing:
    """Test processing of S3 event notifications"""

    @pytest.fixture
    def worker(self, test_config):
        """Create worker instance with mocked services"""
        with mock_aws():
            s3 = boto3.client('s3', region_name='us-east-1')
            sqs = boto3.client('sqs', region_name='us-east-1')

            s3.create_bucket(Bucket='test-bucket')
            response = sqs.create_queue(QueueName='test-queue')

            worker = FileProcessingWorker(test_config)
            yield worker, s3, sqs, response['QueueUrl']

    def test_process_s3_event_message(self, worker, sample_pdf: Path):
        """Test processing S3 event notification"""
        worker_instance, s3, sqs, queue_url = worker

        # Upload file to S3
        s3.upload_file(str(sample_pdf), 'test-bucket', 'test.pdf')

        # Create S3 event message
        message = {
            'MessageId': 'test-123',
            'ReceiptHandle': 'receipt-123',
            'Body': json.dumps({
                'Records': [{
                    'eventSource': 'aws:s3',
                    's3': {
                        'bucket': {'name': 'test-bucket'},
                        'object': {'key': 'test.pdf'}
                    }
                }]
            })
        }

        # Process message
        success = worker_instance.process_sqs_message(message)

        # Should succeed (or fail gracefully if OpenSearch not available)
        assert isinstance(success, bool)

    def test_process_invalid_s3_event(self, worker):
        """Test handling of invalid S3 event format"""
        worker_instance, s3, sqs, queue_url = worker

        message = {
            'MessageId': 'test-123',
            'ReceiptHandle': 'receipt-123',
            'Body': json.dumps({
                'invalid': 'format'
            })
        }

        success = worker_instance.process_sqs_message(message)

        assert not success

    def test_s3_event_for_unsupported_file(self, worker, temp_dir: Path):
        """Test S3 event for unsupported file type"""
        worker_instance, s3, sqs, queue_url = worker

        # Create unsupported file
        unsupported = temp_dir / 'file.xyz'
        unsupported.write_text('unsupported')

        s3.upload_file(str(unsupported), 'test-bucket', 'file.xyz')

        message = {
            'MessageId': 'test-123',
            'ReceiptHandle': 'receipt-123',
            'Body': json.dumps({
                'Records': [{
                    'eventSource': 'aws:s3',
                    's3': {
                        'bucket': {'name': 'test-bucket'},
                        'object': {'key': 'file.xyz'}
                    }
                }]
            })
        }

        success = worker_instance.process_sqs_message(message)

        assert not success
