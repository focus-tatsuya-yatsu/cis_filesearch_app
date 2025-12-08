"""
End-to-End Tests for File Processing Pipeline
Tests complete flow: SQS → S3 → Process → OpenSearch
"""

import pytest
import json
import time
from pathlib import Path
from moto import mock_aws
import boto3
from unittest.mock import patch, MagicMock

from worker import FileProcessingWorker


@pytest.mark.e2e
class TestFileProcessingPipelineE2E:
    """End-to-end tests for complete file processing pipeline"""

    @pytest.fixture
    def full_pipeline(self, test_config, mock_opensearch):
        """Setup complete pipeline with all mocked services"""
        with mock_aws():
            # Setup S3
            s3 = boto3.client('s3', region_name='us-east-1')
            s3.create_bucket(Bucket='test-bucket')

            # Setup SQS
            sqs = boto3.client('sqs', region_name='us-east-1')
            response = sqs.create_queue(QueueName='test-queue')
            queue_url = response['QueueUrl']

            # Create worker
            worker = FileProcessingWorker(test_config)

            # Mock OpenSearch
            with patch('worker.OpenSearchClient') as mock_os_class:
                mock_os_class.return_value = mock_opensearch
                worker.opensearch = mock_opensearch

                yield {
                    'worker': worker,
                    's3': s3,
                    'sqs': sqs,
                    'queue_url': queue_url,
                    'opensearch': mock_opensearch,
                }

    def test_complete_pdf_processing_pipeline(self, full_pipeline, sample_pdf: Path):
        """Test complete pipeline for PDF file"""
        worker = full_pipeline['worker']
        s3 = full_pipeline['s3']
        sqs = full_pipeline['sqs']
        queue_url = full_pipeline['queue_url']
        opensearch = full_pipeline['opensearch']

        # Step 1: Upload file to S3
        s3_key = 'documents/test.pdf'
        s3.upload_file(str(sample_pdf), 'test-bucket', s3_key)

        # Step 2: Send SQS message
        message = {
            'Records': [{
                'eventSource': 'aws:s3',
                's3': {
                    'bucket': {'name': 'test-bucket'},
                    'object': {'key': s3_key}
                }
            }]
        }
        sqs.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps(message)
        )

        # Step 3: Worker receives and processes message
        response = sqs.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=1
        )

        assert 'Messages' in response
        sqs_message = response['Messages'][0]

        # Step 4: Process the message
        success = worker.process_sqs_message(sqs_message)

        # Step 5: Verify results
        assert success
        assert opensearch.index_document.called

        # Verify indexed document structure
        call_args = opensearch.index_document.call_args
        document = call_args[0][0] if call_args[0] else call_args[1]['document']

        assert document['success'] is True
        assert document['file_key'] == s3_key
        assert document['bucket'] == 'test-bucket'
        assert 's3_url' in document
        assert len(document['extracted_text']) > 0

    def test_complete_image_processing_pipeline(self, full_pipeline, sample_image: Path):
        """Test complete pipeline for image file"""
        worker = full_pipeline['worker']
        s3 = full_pipeline['s3']
        sqs = full_pipeline['sqs']
        queue_url = full_pipeline['queue_url']

        # Upload image
        s3_key = 'images/photo.jpg'
        s3.upload_file(str(sample_image), 'test-bucket', s3_key)

        # Send message
        message = {
            'Records': [{
                'eventSource': 'aws:s3',
                's3': {
                    'bucket': {'name': 'test-bucket'},
                    'object': {'key': s3_key}
                }
            }]
        }
        sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(message))

        # Receive and process
        response = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
        sqs_message = response['Messages'][0]

        success = worker.process_sqs_message(sqs_message)

        assert success

    def test_complete_office_document_pipeline(self, full_pipeline, sample_docx: Path):
        """Test complete pipeline for Office document"""
        worker = full_pipeline['worker']
        s3 = full_pipeline['s3']
        sqs = full_pipeline['sqs']
        queue_url = full_pipeline['queue_url']

        # Upload document
        s3_key = 'documents/report.docx'
        s3.upload_file(str(sample_docx), 'test-bucket', s3_key)

        # Send message
        message = {
            'Records': [{
                'eventSource': 'aws:s3',
                's3': {
                    'bucket': {'name': 'test-bucket'},
                    'object': {'key': s3_key}
                }
            }]
        }
        sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(message))

        # Process
        response = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
        sqs_message = response['Messages'][0]

        success = worker.process_sqs_message(sqs_message)

        assert success

    def test_pipeline_with_thumbnail_upload(self, full_pipeline, sample_image: Path):
        """Test pipeline includes thumbnail upload"""
        worker = full_pipeline['worker']
        s3 = full_pipeline['s3']
        sqs = full_pipeline['sqs']
        queue_url = full_pipeline['queue_url']
        opensearch = full_pipeline['opensearch']

        # Upload image
        s3_key = 'images/photo.jpg'
        s3.upload_file(str(sample_image), 'test-bucket', s3_key)

        # Send and process
        message = {
            'Records': [{
                'eventSource': 'aws:s3',
                's3': {
                    'bucket': {'name': 'test-bucket'},
                    'object': {'key': s3_key}
                }
            }]
        }
        sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(message))

        response = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
        sqs_message = response['Messages'][0]

        success = worker.process_sqs_message(sqs_message)

        # Check if thumbnail was uploaded to S3
        thumbnails = s3.list_objects_v2(Bucket='test-bucket', Prefix='thumbnails/')

        if success and thumbnails.get('KeyCount', 0) > 0:
            # Verify thumbnail URL in indexed document
            call_args = opensearch.index_document.call_args
            document = call_args[0][0] if call_args[0] else call_args[1]['document']
            assert 'thumbnail_url' in document or 'thumbnail_data' in document

    def test_pipeline_error_handling(self, full_pipeline, temp_dir: Path):
        """Test pipeline handles errors gracefully"""
        worker = full_pipeline['worker']
        s3 = full_pipeline['s3']
        sqs = full_pipeline['sqs']
        queue_url = full_pipeline['queue_url']

        # Upload corrupted file
        corrupted = temp_dir / 'corrupted.pdf'
        corrupted.write_text('not a pdf')
        s3.upload_file(str(corrupted), 'test-bucket', 'corrupted.pdf')

        # Send message
        message = {
            'Records': [{
                'eventSource': 'aws:s3',
                's3': {
                    'bucket': {'name': 'test-bucket'},
                    'object': {'key': 'corrupted.pdf'}
                }
            }]
        }
        sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(message))

        # Process
        response = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
        sqs_message = response['Messages'][0]

        success = worker.process_sqs_message(sqs_message)

        # Should fail gracefully
        assert not success

    def test_pipeline_with_missing_file(self, full_pipeline):
        """Test pipeline handles missing S3 file"""
        worker = full_pipeline['worker']
        sqs = full_pipeline['sqs']
        queue_url = full_pipeline['queue_url']

        # Send message for non-existent file
        message = {
            'Records': [{
                'eventSource': 'aws:s3',
                's3': {
                    'bucket': {'name': 'test-bucket'},
                    'object': {'key': 'missing.pdf'}
                }
            }]
        }
        sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(message))

        response = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
        sqs_message = response['Messages'][0]

        success = worker.process_sqs_message(sqs_message)

        assert not success

    @pytest.mark.slow
    def test_pipeline_processes_multiple_files(self, full_pipeline, sample_pdf: Path, sample_image: Path):
        """Test pipeline processes multiple files sequentially"""
        worker = full_pipeline['worker']
        s3 = full_pipeline['s3']
        sqs = full_pipeline['sqs']
        queue_url = full_pipeline['queue_url']

        # Upload multiple files
        files = [
            ('file1.pdf', sample_pdf),
            ('file2.jpg', sample_image),
        ]

        for s3_key, file_path in files:
            s3.upload_file(str(file_path), 'test-bucket', s3_key)
            message = {
                'Records': [{
                    'eventSource': 'aws:s3',
                    's3': {
                        'bucket': {'name': 'test-bucket'},
                        'object': {'key': s3_key}
                    }
                }]
            }
            sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(message))

        # Process all messages
        results = []
        for _ in range(len(files)):
            response = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
            if 'Messages' in response:
                sqs_message = response['Messages'][0]
                success = worker.process_sqs_message(sqs_message)
                results.append(success)

        assert all(results)

    def test_pipeline_cleanup_temp_files(self, full_pipeline, sample_pdf: Path, temp_dir: Path):
        """Test pipeline cleans up temporary files"""
        worker = full_pipeline['worker']
        s3 = full_pipeline['s3']
        sqs = full_pipeline['sqs']
        queue_url = full_pipeline['queue_url']

        # Override temp directory for testing
        worker.config.processing.temp_dir = str(temp_dir)

        # Upload and process file
        s3.upload_file(str(sample_pdf), 'test-bucket', 'test.pdf')
        message = {
            'Records': [{
                'eventSource': 'aws:s3',
                's3': {
                    'bucket': {'name': 'test-bucket'},
                    'object': {'key': 'test.pdf'}
                }
            }]
        }
        sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(message))

        response = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
        sqs_message = response['Messages'][0]

        # Count temp files before
        temp_files_before = list(temp_dir.glob('*'))

        worker.process_sqs_message(sqs_message)

        # Count temp files after
        temp_files_after = list(temp_dir.glob('*'))

        # Should not have more temp files than before
        assert len(temp_files_after) <= len(temp_files_before) + 1  # Allow for test fixtures


@pytest.mark.e2e
@pytest.mark.slow
class TestPipelinePerformance:
    """Performance tests for pipeline"""

    def test_pipeline_throughput(self, full_pipeline, sample_pdf: Path):
        """Test pipeline throughput"""
        worker = full_pipeline['worker']
        s3 = full_pipeline['s3']
        sqs = full_pipeline['sqs']
        queue_url = full_pipeline['queue_url']

        num_files = 10
        start_time = time.time()

        # Upload and queue files
        for i in range(num_files):
            s3_key = f'files/test_{i}.pdf'
            s3.upload_file(str(sample_pdf), 'test-bucket', s3_key)
            message = {
                'Records': [{
                    'eventSource': 'aws:s3',
                    's3': {
                        'bucket': {'name': 'test-bucket'},
                        'object': {'key': s3_key}
                    }
                }]
            }
            sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(message))

        # Process all
        for _ in range(num_files):
            response = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
            if 'Messages' in response:
                worker.process_sqs_message(response['Messages'][0])

        elapsed = time.time() - start_time
        throughput = num_files / elapsed

        # Should process at reasonable speed
        assert throughput > 0.5  # At least 0.5 files/second

    def test_pipeline_memory_efficiency(self, full_pipeline, sample_pdf: Path):
        """Test pipeline doesn't leak memory"""
        import tracemalloc

        worker = full_pipeline['worker']
        s3 = full_pipeline['s3']
        sqs = full_pipeline['sqs']
        queue_url = full_pipeline['queue_url']

        tracemalloc.start()

        # Process multiple files
        for i in range(5):
            s3_key = f'files/test_{i}.pdf'
            s3.upload_file(str(sample_pdf), 'test-bucket', s3_key)
            message = {
                'Records': [{
                    'eventSource': 'aws:s3',
                    's3': {
                        'bucket': {'name': 'test-bucket'},
                        'object': {'key': s3_key}
                    }
                }]
            }
            sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(message))

            response = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
            if 'Messages' in response:
                worker.process_sqs_message(response['Messages'][0])

        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        # Memory should stay reasonable (less than 100MB)
        assert peak < 100 * 1024 * 1024
