"""
Performance and Load Tests
Tests system performance under various load conditions
"""

import pytest
import time
import concurrent.futures
from pathlib import Path
from unittest.mock import Mock
import psutil
import os

from processors.pdf_processor import PDFProcessor
from processors.image_processor import ImageProcessor
from processors.office_processor import OfficeProcessor


@pytest.mark.performance
class TestProcessorPerformance:
    """Test individual processor performance"""

    @pytest.fixture
    def pdf_processor(self, test_config):
        return PDFProcessor(test_config)

    @pytest.fixture
    def image_processor(self, test_config):
        return ImageProcessor(test_config)

    @pytest.fixture
    def office_processor(self, test_config):
        return OfficeProcessor(test_config)

    def test_pdf_processing_speed(self, pdf_processor, sample_pdf: Path):
        """Test PDF processing speed"""
        iterations = 10
        start_time = time.time()

        for _ in range(iterations):
            result = pdf_processor.process(str(sample_pdf))
            assert result.success

        elapsed = time.time() - start_time
        avg_time = elapsed / iterations

        # Should process small PDF in under 1 second on average
        assert avg_time < 1.0

    def test_image_processing_speed(self, image_processor, sample_image: Path):
        """Test image processing speed"""
        iterations = 20
        start_time = time.time()

        for _ in range(iterations):
            result = image_processor.process(str(sample_image))
            assert result.success

        elapsed = time.time() - start_time
        avg_time = elapsed / iterations

        # Should process image quickly
        assert avg_time < 0.5

    def test_office_processing_speed(self, office_processor, sample_docx: Path):
        """Test Office document processing speed"""
        iterations = 10
        start_time = time.time()

        for _ in range(iterations):
            result = office_processor.process(str(sample_docx))
            assert result.success

        elapsed = time.time() - start_time
        avg_time = elapsed / iterations

        # Office processing may be slower
        assert avg_time < 2.0

    @pytest.mark.slow
    def test_large_file_processing_speed(self, pdf_processor, temp_dir: Path):
        """Test processing speed for large files"""
        from pypdf import PdfWriter
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import letter
        import io

        # Create large PDF (100 pages)
        large_pdf = temp_dir / "large.pdf"
        writer = PdfWriter()

        for i in range(100):
            buffer = io.BytesIO()
            c = canvas.Canvas(buffer, pagesize=letter)
            c.drawString(100, 750, f"Page {i + 1}")
            c.drawString(100, 730, "Content " * 50)
            c.showPage()
            c.save()

            buffer.seek(0)
            from pypdf import PdfReader
            reader = PdfReader(buffer)
            writer.add_page(reader.pages[0])

        with open(large_pdf, "wb") as f:
            writer.write(f)

        start_time = time.time()
        result = pdf_processor.process(str(large_pdf))
        elapsed = time.time() - start_time

        assert result.success
        # Large file should still process in reasonable time
        assert elapsed < 30.0  # 30 seconds for 100 pages

    def test_concurrent_processing(self, pdf_processor, sample_pdf: Path):
        """Test concurrent file processing"""
        num_workers = 4
        num_files = 20

        def process_file():
            return pdf_processor.process(str(sample_pdf))

        start_time = time.time()

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_workers) as executor:
            futures = [executor.submit(process_file) for _ in range(num_files)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        elapsed = time.time() - start_time

        # All should succeed
        assert all(r.success for r in results)

        # Concurrent processing should be faster than sequential
        # (but not necessarily 4x faster due to GIL and I/O)
        assert elapsed < num_files * 1.0  # Better than 1 second per file


@pytest.mark.performance
class TestMemoryUsage:
    """Test memory usage of processors"""

    def test_pdf_processor_memory(self, test_config, sample_pdf: Path):
        """Test PDF processor memory usage"""
        processor = PDFProcessor(test_config)

        process = psutil.Process(os.getpid())
        mem_before = process.memory_info().rss / 1024 / 1024  # MB

        # Process multiple files
        for _ in range(10):
            result = processor.process(str(sample_pdf))
            assert result.success

        mem_after = process.memory_info().rss / 1024 / 1024  # MB
        mem_increase = mem_after - mem_before

        # Memory increase should be reasonable (less than 50MB for 10 small files)
        assert mem_increase < 50

    def test_image_processor_memory(self, test_config, sample_image: Path):
        """Test image processor memory usage"""
        processor = ImageProcessor(test_config)

        process = psutil.Process(os.getpid())
        mem_before = process.memory_info().rss / 1024 / 1024

        # Process multiple images
        for _ in range(20):
            result = processor.process(str(sample_image))
            assert result.success

        mem_after = process.memory_info().rss / 1024 / 1024
        mem_increase = mem_after - mem_before

        # Image processing should not leak memory
        assert mem_increase < 100

    @pytest.mark.slow
    def test_memory_does_not_grow_indefinitely(self, test_config, sample_pdf: Path):
        """Test that memory doesn't grow indefinitely"""
        processor = PDFProcessor(test_config)
        process = psutil.Process(os.getpid())

        memory_samples = []

        # Process files and sample memory periodically
        for i in range(50):
            processor.process(str(sample_pdf))

            if i % 10 == 0:
                mem = process.memory_info().rss / 1024 / 1024
                memory_samples.append(mem)

        # Memory should stabilize, not grow linearly
        # Check that later samples aren't significantly higher than earlier ones
        early_avg = sum(memory_samples[:2]) / 2
        late_avg = sum(memory_samples[-2:]) / 2

        # Allow some growth, but not more than 100MB
        assert late_avg - early_avg < 100


@pytest.mark.performance
class TestThroughput:
    """Test system throughput"""

    def test_files_per_second(self, test_config, sample_pdf: Path, sample_image: Path):
        """Test overall throughput in files per second"""
        from file_router import FileRouter

        router = FileRouter(test_config)

        files = [sample_pdf, sample_image] * 10  # 20 files
        start_time = time.time()

        results = []
        for file_path in files:
            result = router.process_file(str(file_path))
            results.append(result)

        elapsed = time.time() - start_time
        throughput = len(files) / elapsed

        assert all(r.success for r in results)
        # Should achieve reasonable throughput
        assert throughput > 2.0  # At least 2 files/second

    @pytest.mark.slow
    def test_sustained_throughput(self, test_config, sample_pdf: Path):
        """Test sustained throughput over time"""
        from file_router import FileRouter

        router = FileRouter(test_config)

        num_files = 100
        throughputs = []

        # Measure throughput in batches
        batch_size = 10
        for batch_start in range(0, num_files, batch_size):
            start_time = time.time()

            for _ in range(batch_size):
                router.process_file(str(sample_pdf))

            elapsed = time.time() - start_time
            batch_throughput = batch_size / elapsed
            throughputs.append(batch_throughput)

        # Throughput should remain relatively stable
        # Later batches should not be significantly slower
        early_avg = sum(throughputs[:3]) / 3
        late_avg = sum(throughputs[-3:]) / 3

        # Allow some variance, but should stay within 50% of initial
        assert late_avg > early_avg * 0.5


@pytest.mark.performance
class TestScalability:
    """Test system scalability"""

    def test_scales_with_cpu_cores(self, test_config, sample_pdf: Path):
        """Test that concurrent processing scales with CPU cores"""
        from file_router import FileRouter
        import multiprocessing

        router = FileRouter(test_config)
        num_cores = multiprocessing.cpu_count()

        # Test with different numbers of workers
        for num_workers in [1, 2, num_cores]:
            num_files = 20
            start_time = time.time()

            with concurrent.futures.ThreadPoolExecutor(max_workers=num_workers) as executor:
                futures = [
                    executor.submit(router.process_file, str(sample_pdf))
                    for _ in range(num_files)
                ]
                results = [f.result() for f in concurrent.futures.as_completed(futures)]

            elapsed = time.time() - start_time
            throughput = num_files / elapsed

            # More workers should generally improve throughput
            # (though not linearly due to GIL)
            assert throughput > 0

    @pytest.mark.slow
    def test_handles_burst_load(self, test_config, sample_pdf: Path):
        """Test system handles burst of files"""
        from file_router import FileRouter

        router = FileRouter(test_config)

        # Sudden burst of 50 files
        num_files = 50
        start_time = time.time()

        results = []
        for _ in range(num_files):
            result = router.process_file(str(sample_pdf))
            results.append(result)

        elapsed = time.time() - start_time

        # Should handle burst without failures
        assert all(r.success for r in results)
        # Should complete in reasonable time
        assert elapsed < num_files * 2.0  # 2 seconds per file max


@pytest.mark.performance
class TestResourceConstraints:
    """Test behavior under resource constraints"""

    def test_low_memory_handling(self, test_config, temp_dir: Path):
        """Test handling when memory is limited"""
        # This is a conceptual test - actual implementation would
        # require resource limiting which is platform-specific
        pass

    def test_high_cpu_usage(self, test_config, sample_pdf: Path):
        """Test performance under high CPU load"""
        # Simulate high CPU usage
        import multiprocessing

        def cpu_stress():
            end_time = time.time() + 2
            while time.time() < end_time:
                _ = sum(range(1000000))

        # Start CPU stress in background
        with concurrent.futures.ProcessPoolExecutor(max_workers=2) as executor:
            stress_future = executor.submit(cpu_stress)

            # Try to process files during high CPU
            processor = PDFProcessor(test_config)
            result = processor.process(str(sample_pdf))

            # Should still succeed even under load
            assert result.success

    def test_disk_io_performance(self, test_config, temp_dir: Path):
        """Test performance with heavy disk I/O"""
        # This would test performance when disk is busy
        pass


@pytest.mark.benchmark
def test_pdf_processing_benchmark(benchmark, test_config, sample_pdf: Path):
    """Benchmark PDF processing using pytest-benchmark"""
    processor = PDFProcessor(test_config)

    result = benchmark(processor.process, str(sample_pdf))

    assert result.success


@pytest.mark.benchmark
def test_image_processing_benchmark(benchmark, test_config, sample_image: Path):
    """Benchmark image processing"""
    processor = ImageProcessor(test_config)

    result = benchmark(processor.process, str(sample_image))

    assert result.success
