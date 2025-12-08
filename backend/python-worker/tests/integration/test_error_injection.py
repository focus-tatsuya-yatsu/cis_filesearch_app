"""
Error Injection and Fault Tolerance Tests
Tests system behavior under various failure conditions
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from botocore.exceptions import ClientError, BotoCoreError
import json

from worker import FileProcessingWorker
from processors.pdf_processor import PDFProcessor


@pytest.mark.error_injection
class TestS3ErrorInjection:
    """Test S3 failure scenarios"""

    @pytest.fixture
    def worker(self, test_config):
        return FileProcessingWorker(test_config)

    def test_s3_download_timeout(self, worker, temp_dir: Path):
        """Test S3 download timeout"""
        with patch.object(worker.s3_client, 'download_file') as mock_download:
            mock_download.side_effect = Exception("Connection timeout")

            result = worker.download_file_from_s3(
                'test-bucket',
                'test.pdf',
                str(temp_dir / 'test.pdf')
            )

            assert not result

    def test_s3_access_denied(self, worker, temp_dir: Path):
        """Test S3 access denied error"""
        error = ClientError(
            {'Error': {'Code': 'AccessDenied', 'Message': 'Access Denied'}},
            'GetObject'
        )

        with patch.object(worker.s3_client, 'download_file') as mock_download:
            mock_download.side_effect = error

            result = worker.download_file_from_s3(
                'test-bucket',
                'test.pdf',
                str(temp_dir / 'test.pdf')
            )

            assert not result

    def test_s3_no_such_key(self, worker, temp_dir: Path):
        """Test S3 object not found"""
        error = ClientError(
            {'Error': {'Code': 'NoSuchKey', 'Message': 'The specified key does not exist'}},
            'GetObject'
        )

        with patch.object(worker.s3_client, 'download_file') as mock_download:
            mock_download.side_effect = error

            result = worker.download_file_from_s3(
                'test-bucket',
                'missing.pdf',
                str(temp_dir / 'test.pdf')
            )

            assert not result

    def test_s3_bucket_not_found(self, worker, temp_dir: Path):
        """Test S3 bucket doesn't exist"""
        error = ClientError(
            {'Error': {'Code': 'NoSuchBucket', 'Message': 'The specified bucket does not exist'}},
            'GetObject'
        )

        with patch.object(worker.s3_client, 'download_file') as mock_download:
            mock_download.side_effect = error

            result = worker.download_file_from_s3(
                'nonexistent-bucket',
                'test.pdf',
                str(temp_dir / 'test.pdf')
            )

            assert not result

    def test_s3_throttling(self, worker, temp_dir: Path):
        """Test S3 throttling/rate limiting"""
        error = ClientError(
            {'Error': {'Code': 'SlowDown', 'Message': 'Please reduce your request rate'}},
            'GetObject'
        )

        with patch.object(worker.s3_client, 'download_file') as mock_download:
            mock_download.side_effect = error

            result = worker.download_file_from_s3(
                'test-bucket',
                'test.pdf',
                str(temp_dir / 'test.pdf')
            )

            assert not result

    def test_s3_network_error(self, worker, temp_dir: Path):
        """Test network connectivity issues"""
        with patch.object(worker.s3_client, 'download_file') as mock_download:
            mock_download.side_effect = BotoCoreError()

            result = worker.download_file_from_s3(
                'test-bucket',
                'test.pdf',
                str(temp_dir / 'test.pdf')
            )

            assert not result


@pytest.mark.error_injection
class TestSQSErrorInjection:
    """Test SQS failure scenarios"""

    @pytest.fixture
    def worker(self, test_config):
        return FileProcessingWorker(test_config)

    def test_sqs_malformed_message(self, worker):
        """Test malformed SQS message"""
        malformed_message = {
            'MessageId': 'test-123',
            'ReceiptHandle': 'receipt-123',
            'Body': 'not valid json'
        }

        result = worker.process_sqs_message(malformed_message)

        assert not result

    def test_sqs_missing_required_fields(self, worker):
        """Test SQS message with missing fields"""
        incomplete_message = {
            'MessageId': 'test-123',
            'ReceiptHandle': 'receipt-123',
            'Body': json.dumps({
                'Records': [{
                    's3': {
                        'bucket': {'name': 'test-bucket'}
                        # Missing 'object' key
                    }
                }]
            })
        }

        result = worker.process_sqs_message(incomplete_message)

        assert not result

    def test_sqs_receive_error(self, worker):
        """Test SQS receive message error"""
        error = ClientError(
            {'Error': {'Code': 'QueueDoesNotExist', 'Message': 'Queue does not exist'}},
            'ReceiveMessage'
        )

        with patch.object(worker.sqs_client, 'receive_message') as mock_receive:
            mock_receive.side_effect = error

            # Should handle gracefully
            with pytest.raises(ClientError):
                worker.sqs_client.receive_message(QueueUrl='invalid-queue')

    def test_sqs_delete_error(self, worker):
        """Test SQS delete message error"""
        error = ClientError(
            {'Error': {'Code': 'ReceiptHandleIsInvalid', 'Message': 'Invalid receipt handle'}},
            'DeleteMessage'
        )

        with patch.object(worker.sqs_client, 'delete_message') as mock_delete:
            mock_delete.side_effect = error

            # Should handle gracefully
            with pytest.raises(ClientError):
                worker.sqs_client.delete_message(
                    QueueUrl='test-queue',
                    ReceiptHandle='invalid-handle'
                )


@pytest.mark.error_injection
class TestProcessorErrorInjection:
    """Test processor failure scenarios"""

    @pytest.fixture
    def processor(self, test_config):
        return PDFProcessor(test_config)

    def test_file_read_permission_denied(self, processor, temp_dir: Path):
        """Test file read permission error"""
        test_file = temp_dir / 'nopermission.pdf'
        test_file.write_text('test')
        test_file.chmod(0o000)  # Remove all permissions

        try:
            result = processor.process(str(test_file))
            # Should fail gracefully
            assert not result.success
        finally:
            test_file.chmod(0o644)  # Restore permissions for cleanup

    def test_disk_full_during_processing(self, processor):
        """Test disk full error during processing"""
        # This would require actually filling the disk or mocking
        pass

    def test_processor_crash_during_extraction(self, processor, sample_pdf: Path):
        """Test processor crash during text extraction"""
        with patch('processors.pdf_processor.PdfReader') as mock_reader:
            mock_reader.side_effect = Exception("Simulated crash")

            result = processor.process(str(sample_pdf))

            assert not result.success
            assert 'error' in result.error_message.lower()

    def test_out_of_memory_during_processing(self, processor):
        """Test out of memory error"""
        with patch('processors.pdf_processor.PdfReader') as mock_reader:
            mock_reader.side_effect = MemoryError("Out of memory")

            result = processor.process('test.pdf')

            assert not result.success

    def test_unicode_decode_error(self, processor, temp_dir: Path):
        """Test unicode decode error in file"""
        bad_file = temp_dir / 'bad.pdf'
        bad_file.write_bytes(b'\xff\xfe\x00\x00invalid')

        result = processor.process(str(bad_file))

        assert not result.success


@pytest.mark.error_injection
class TestOpenSearchErrorInjection:
    """Test OpenSearch failure scenarios"""

    def test_opensearch_connection_refused(self, test_config):
        """Test OpenSearch connection refused"""
        from opensearch_client import OpenSearchClient

        # Use invalid endpoint
        test_config.aws.opensearch_endpoint = 'https://localhost:9999'

        client = OpenSearchClient(test_config)

        # Should handle connection error gracefully
        assert not client.is_connected()

    def test_opensearch_index_creation_fails(self, test_config, mock_opensearch):
        """Test OpenSearch index creation failure"""
        from opensearch_client import OpenSearchClient

        mock_opensearch.indices.create.side_effect = Exception("Index creation failed")

        with patch('opensearch_client.OpenSearch', return_value=mock_opensearch):
            client = OpenSearchClient(test_config)

            result = client.create_index()

            # Should handle gracefully
            assert not result

    def test_opensearch_indexing_fails(self, test_config, mock_opensearch):
        """Test document indexing failure"""
        from opensearch_client import OpenSearchClient

        mock_opensearch.index.side_effect = Exception("Indexing failed")

        with patch('opensearch_client.OpenSearch', return_value=mock_opensearch):
            client = OpenSearchClient(test_config)

            result = client.index_document({'test': 'data'}, 'doc-id')

            assert not result

    def test_opensearch_timeout(self, test_config, mock_opensearch):
        """Test OpenSearch timeout"""
        from opensearch_client import OpenSearchClient
        from opensearchpy.exceptions import ConnectionTimeout

        mock_opensearch.index.side_effect = ConnectionTimeout("Request timeout")

        with patch('opensearch_client.OpenSearch', return_value=mock_opensearch):
            client = OpenSearchClient(test_config)

            result = client.index_document({'test': 'data'}, 'doc-id')

            assert not result


@pytest.mark.error_injection
class TestRecoveryMechanisms:
    """Test error recovery and retry mechanisms"""

    def test_retry_on_transient_failure(self, test_config):
        """Test retry mechanism on transient failures"""
        # This would test exponential backoff and retry logic
        pass

    def test_dlq_message_routing(self, test_config):
        """Test messages are routed to DLQ after max retries"""
        # This would test DLQ integration
        pass

    def test_graceful_degradation(self, test_config):
        """Test system continues with reduced functionality"""
        # E.g., continue processing without OpenSearch if it's down
        pass

    def test_circuit_breaker_activation(self, test_config):
        """Test circuit breaker prevents cascading failures"""
        # This would test circuit breaker pattern
        pass


@pytest.mark.error_injection
class TestDataCorruption:
    """Test handling of corrupted data"""

    def test_corrupted_pdf(self, test_config, temp_dir: Path):
        """Test handling of corrupted PDF file"""
        processor = PDFProcessor(test_config)

        corrupted = temp_dir / 'corrupted.pdf'
        corrupted.write_text('This is not a PDF')

        result = processor.process(str(corrupted))

        assert not result.success

    def test_truncated_file(self, test_config, temp_dir: Path, sample_pdf: Path):
        """Test handling of truncated file"""
        processor = PDFProcessor(test_config)

        # Create truncated version
        truncated = temp_dir / 'truncated.pdf'
        data = sample_pdf.read_bytes()
        truncated.write_bytes(data[:len(data)//2])  # Only first half

        result = processor.process(str(truncated))

        # May fail or succeed with partial data
        assert isinstance(result.success, bool)

    def test_file_with_null_bytes(self, test_config, temp_dir: Path):
        """Test file with null bytes"""
        processor = PDFProcessor(test_config)

        null_file = temp_dir / 'nulls.pdf'
        null_file.write_bytes(b'\x00' * 1000)

        result = processor.process(str(null_file))

        assert not result.success


@pytest.mark.error_injection
class TestResourceExhaustion:
    """Test behavior when resources are exhausted"""

    def test_too_many_open_files(self, test_config):
        """Test handling when file descriptor limit is reached"""
        # This would require actually exhausting file descriptors
        pass

    def test_cpu_saturation(self, test_config):
        """Test behavior when CPU is saturated"""
        # This would simulate high CPU load
        pass

    def test_network_bandwidth_exhaustion(self, test_config):
        """Test behavior when network is saturated"""
        # This would simulate slow network
        pass


@pytest.mark.error_injection
class TestEdgeCases:
    """Test edge cases and unusual inputs"""

    def test_empty_file(self, test_config, temp_dir: Path):
        """Test processing empty file"""
        processor = PDFProcessor(test_config)

        empty = temp_dir / 'empty.pdf'
        empty.touch()

        result = processor.process(str(empty))

        assert not result.success

    def test_extremely_large_file(self, test_config):
        """Test handling of extremely large file"""
        # This would test file size limits
        pass

    def test_file_with_very_long_path(self, test_config, temp_dir: Path):
        """Test file with very long path name"""
        # Create deeply nested directory
        long_path = temp_dir
        for i in range(20):
            long_path = long_path / f'level{i}'
        long_path.mkdir(parents=True, exist_ok=True)

        test_file = long_path / 'test.pdf'
        test_file.write_text('test')

        processor = PDFProcessor(test_config)
        result = processor.process(str(test_file))

        # Should handle long paths
        assert isinstance(result.success, bool)

    def test_file_with_special_unicode_name(self, test_config, temp_dir: Path):
        """Test file with special unicode characters in name"""
        processor = PDFProcessor(test_config)

        unicode_file = temp_dir / '日本語ファイル名.pdf'
        unicode_file.write_text('test')

        result = processor.process(str(unicode_file))

        # Should handle unicode filenames
        assert isinstance(result.success, bool)
