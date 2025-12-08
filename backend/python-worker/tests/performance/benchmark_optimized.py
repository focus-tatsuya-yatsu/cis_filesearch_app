"""
Performance Benchmark Tool for Optimized Worker
Measure and compare performance improvements
"""

import os
import sys
import time
import json
import psutil
import logging
import argparse
from pathlib import Path
from typing import List, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime
import tempfile

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from config import get_config
from processors.pdf_processor import PDFProcessor
from processors.pdf_processor_optimized import PDFProcessorOptimized


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class BenchmarkResult:
    """Single benchmark result"""
    processor_name: str
    file_name: str
    file_size_mb: float
    page_count: int
    success: bool

    # Timing
    processing_time: float
    download_time: float = 0.0
    ocr_time: float = 0.0
    index_time: float = 0.0

    # Memory
    memory_before_mb: float = 0.0
    memory_after_mb: float = 0.0
    memory_peak_mb: float = 0.0
    memory_delta_mb: float = 0.0

    # Content
    extracted_chars: int = 0
    extracted_words: int = 0

    # Error
    error_message: str = ""


@dataclass
class BenchmarkSummary:
    """Summary of multiple benchmarks"""
    processor_name: str
    total_files: int
    successful_files: int
    failed_files: int

    # Timing stats
    total_time: float
    avg_time_per_file: float
    min_time: float
    max_time: float

    # Throughput
    files_per_hour: float
    mb_per_hour: float

    # Memory stats
    avg_memory_mb: float
    peak_memory_mb: float
    avg_memory_delta_mb: float

    # Content stats
    total_chars: int
    avg_chars_per_file: int

    results: List[BenchmarkResult] = field(default_factory=list)


class PerformanceBenchmark:
    """Performance benchmark tool"""

    def __init__(self, config):
        """Initialize benchmark"""
        self.config = config
        self.process = psutil.Process()

    def benchmark_file(
        self,
        file_path: str,
        processor,
        processor_name: str
    ) -> BenchmarkResult:
        """
        Benchmark processing a single file

        Args:
            file_path: Path to test file
            processor: Processor instance
            processor_name: Name of processor

        Returns:
            BenchmarkResult
        """
        logger.info(f"Benchmarking: {Path(file_path).name} with {processor_name}")

        # Get file info
        file_size_mb = Path(file_path).stat().st_size / (1024 * 1024)

        # Get page count (for PDFs)
        page_count = 0
        if Path(file_path).suffix.lower() == '.pdf':
            try:
                import PyPDF2
                with open(file_path, 'rb') as f:
                    reader = PyPDF2.PdfReader(f)
                    page_count = len(reader.pages)
            except:
                pass

        # Initial memory
        memory_before_mb = self.process.memory_info().rss / (1024 * 1024)
        peak_memory_mb = memory_before_mb

        result = BenchmarkResult(
            processor_name=processor_name,
            file_name=Path(file_path).name,
            file_size_mb=file_size_mb,
            page_count=page_count,
            success=False,
            processing_time=0.0,
            memory_before_mb=memory_before_mb,
        )

        try:
            # Process file
            start_time = time.time()

            processing_result = processor.process(file_path)

            end_time = time.time()
            result.processing_time = end_time - start_time

            # Memory after
            memory_after_mb = self.process.memory_info().rss / (1024 * 1024)
            result.memory_after_mb = memory_after_mb
            result.memory_delta_mb = memory_after_mb - memory_before_mb
            result.memory_peak_mb = peak_memory_mb

            # Check success
            result.success = processing_result.success

            if processing_result.success:
                result.extracted_chars = len(processing_result.extracted_text)
                result.extracted_words = processing_result.word_count
            else:
                result.error_message = processing_result.error_message or "Unknown error"

            logger.info(
                f"  Result: {result.processing_time:.2f}s, "
                f"{result.memory_delta_mb:.1f}MB delta, "
                f"{result.extracted_chars:,} chars"
            )

        except Exception as e:
            logger.error(f"  Error: {e}")
            result.error_message = str(e)

            # Memory after (even on error)
            memory_after_mb = self.process.memory_info().rss / (1024 * 1024)
            result.memory_after_mb = memory_after_mb
            result.memory_delta_mb = memory_after_mb - memory_before_mb

        return result

    def benchmark_files(
        self,
        file_paths: List[str],
        processor,
        processor_name: str
    ) -> BenchmarkSummary:
        """
        Benchmark multiple files

        Args:
            file_paths: List of file paths
            processor: Processor instance
            processor_name: Name of processor

        Returns:
            BenchmarkSummary
        """
        logger.info(f"Starting benchmark: {len(file_paths)} files with {processor_name}")

        results = []
        total_time = 0.0
        total_size_mb = 0.0

        for file_path in file_paths:
            result = self.benchmark_file(file_path, processor, processor_name)
            results.append(result)

            if result.success:
                total_time += result.processing_time
                total_size_mb += result.file_size_mb

        # Calculate statistics
        successful_results = [r for r in results if r.success]
        failed_results = [r for r in results if not r.success]

        if not successful_results:
            logger.error("No successful results!")
            return BenchmarkSummary(
                processor_name=processor_name,
                total_files=len(results),
                successful_files=0,
                failed_files=len(failed_results),
                total_time=0.0,
                avg_time_per_file=0.0,
                min_time=0.0,
                max_time=0.0,
                files_per_hour=0.0,
                mb_per_hour=0.0,
                avg_memory_mb=0.0,
                peak_memory_mb=0.0,
                avg_memory_delta_mb=0.0,
                total_chars=0,
                avg_chars_per_file=0,
                results=results
            )

        processing_times = [r.processing_time for r in successful_results]
        memory_deltas = [r.memory_delta_mb for r in successful_results]

        avg_time = sum(processing_times) / len(processing_times)
        min_time = min(processing_times)
        max_time = max(processing_times)

        # Throughput
        total_time_hours = total_time / 3600
        files_per_hour = len(successful_results) / total_time_hours if total_time_hours > 0 else 0
        mb_per_hour = total_size_mb / total_time_hours if total_time_hours > 0 else 0

        # Memory
        avg_memory_delta = sum(memory_deltas) / len(memory_deltas)
        peak_memory = max(r.memory_peak_mb for r in successful_results)
        avg_memory = sum(r.memory_after_mb for r in successful_results) / len(successful_results)

        # Content
        total_chars = sum(r.extracted_chars for r in successful_results)
        avg_chars = total_chars // len(successful_results) if successful_results else 0

        summary = BenchmarkSummary(
            processor_name=processor_name,
            total_files=len(results),
            successful_files=len(successful_results),
            failed_files=len(failed_results),
            total_time=total_time,
            avg_time_per_file=avg_time,
            min_time=min_time,
            max_time=max_time,
            files_per_hour=files_per_hour,
            mb_per_hour=mb_per_hour,
            avg_memory_mb=avg_memory,
            peak_memory_mb=peak_memory,
            avg_memory_delta_mb=avg_memory_delta,
            total_chars=total_chars,
            avg_chars_per_file=avg_chars,
            results=results
        )

        return summary

    def compare_processors(
        self,
        file_paths: List[str],
        processors: List[tuple]
    ) -> Dict[str, BenchmarkSummary]:
        """
        Compare multiple processors

        Args:
            file_paths: List of test files
            processors: List of (processor_instance, name) tuples

        Returns:
            Dict of processor_name -> BenchmarkSummary
        """
        logger.info(f"Comparing {len(processors)} processors on {len(file_paths)} files")

        summaries = {}

        for processor, name in processors:
            summary = self.benchmark_files(file_paths, processor, name)
            summaries[name] = summary

            # Force GC between processors
            import gc
            gc.collect()

            # Wait a bit to stabilize
            time.sleep(2)

        return summaries

    def print_summary(self, summary: BenchmarkSummary):
        """Print benchmark summary"""
        print("\n" + "=" * 70)
        print(f"Benchmark Summary: {summary.processor_name}")
        print("=" * 70)
        print(f"Files Processed:     {summary.successful_files}/{summary.total_files}")
        print(f"Success Rate:        {summary.successful_files/summary.total_files*100:.1f}%")
        print()
        print("Timing:")
        print(f"  Total Time:        {summary.total_time:.2f}s")
        print(f"  Average Time:      {summary.avg_time_per_file:.2f}s per file")
        print(f"  Min/Max Time:      {summary.min_time:.2f}s / {summary.max_time:.2f}s")
        print()
        print("Throughput:")
        print(f"  Files/Hour:        {summary.files_per_hour:.1f}")
        print(f"  MB/Hour:           {summary.mb_per_hour:.1f}")
        print()
        print("Memory:")
        print(f"  Average Memory:    {summary.avg_memory_mb:.1f} MB")
        print(f"  Peak Memory:       {summary.peak_memory_mb:.1f} MB")
        print(f"  Avg Delta:         {summary.avg_memory_delta_mb:.1f} MB")
        print()
        print("Content:")
        print(f"  Total Characters:  {summary.total_chars:,}")
        print(f"  Avg per File:      {summary.avg_chars_per_file:,}")
        print("=" * 70)

    def print_comparison(self, summaries: Dict[str, BenchmarkSummary]):
        """Print comparison table"""
        print("\n" + "=" * 100)
        print("Performance Comparison")
        print("=" * 100)

        # Header
        print(f"{'Processor':<30} {'Time/File':<15} {'Files/Hour':<15} {'Memory MB':<15} {'Improvement':<15}")
        print("-" * 100)

        # Get baseline (first processor)
        baseline_name = list(summaries.keys())[0]
        baseline = summaries[baseline_name]

        for name, summary in summaries.items():
            # Calculate improvement
            if name == baseline_name:
                improvement = "Baseline"
            else:
                time_improvement = (1 - summary.avg_time_per_file / baseline.avg_time_per_file) * 100
                throughput_improvement = (summary.files_per_hour / baseline.files_per_hour - 1) * 100
                improvement = f"{time_improvement:+.1f}% time, {throughput_improvement:+.1f}% throughput"

            print(
                f"{name:<30} "
                f"{summary.avg_time_per_file:<15.2f} "
                f"{summary.files_per_hour:<15.1f} "
                f"{summary.peak_memory_mb:<15.1f} "
                f"{improvement:<15}"
            )

        print("=" * 100)

    def save_results(self, summaries: Dict[str, BenchmarkSummary], output_path: str):
        """Save benchmark results to JSON"""
        results = {
            'timestamp': datetime.now().isoformat(),
            'summaries': {}
        }

        for name, summary in summaries.items():
            results['summaries'][name] = {
                'processor_name': summary.processor_name,
                'total_files': summary.total_files,
                'successful_files': summary.successful_files,
                'failed_files': summary.failed_files,
                'total_time': summary.total_time,
                'avg_time_per_file': summary.avg_time_per_file,
                'min_time': summary.min_time,
                'max_time': summary.max_time,
                'files_per_hour': summary.files_per_hour,
                'mb_per_hour': summary.mb_per_hour,
                'avg_memory_mb': summary.avg_memory_mb,
                'peak_memory_mb': summary.peak_memory_mb,
                'avg_memory_delta_mb': summary.avg_memory_delta_mb,
                'total_chars': summary.total_chars,
                'avg_chars_per_file': summary.avg_chars_per_file,
            }

        with open(output_path, 'w') as f:
            json.dump(results, f, indent=2)

        logger.info(f"Results saved to: {output_path}")


def create_test_pdf(output_path: str, pages: int = 10) -> str:
    """
    Create a test PDF for benchmarking

    Args:
        output_path: Output file path
        pages: Number of pages

    Returns:
        Path to created PDF
    """
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter

    c = canvas.Canvas(output_path, pagesize=letter)

    for page_num in range(1, pages + 1):
        c.drawString(100, 750, f"Test PDF - Page {page_num}")
        c.drawString(100, 700, "This is a test document for performance benchmarking.")
        c.drawString(100, 680, "Lorem ipsum dolor sit amet, consectetur adipiscing elit.")

        # Add more content
        y = 650
        for i in range(20):
            c.drawString(100, y, f"Line {i+1}: Some sample text for OCR processing.")
            y -= 20

        c.showPage()

    c.save()

    logger.info(f"Created test PDF: {output_path} ({pages} pages)")

    return output_path


def main():
    """Main benchmark execution"""
    parser = argparse.ArgumentParser(description='Performance Benchmark Tool')

    parser.add_argument(
        '--test-files',
        nargs='+',
        help='List of test PDF files'
    )

    parser.add_argument(
        '--create-test-pdf',
        type=int,
        metavar='PAGES',
        help='Create a test PDF with specified number of pages'
    )

    parser.add_argument(
        '--output',
        default='benchmark_results.json',
        help='Output JSON file for results'
    )

    args = parser.parse_args()

    # Load config
    config = get_config()

    # Prepare test files
    test_files = []

    if args.create_test_pdf:
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            test_pdf = create_test_pdf(tmp.name, pages=args.create_test_pdf)
            test_files.append(test_pdf)

    if args.test_files:
        test_files.extend(args.test_files)

    if not test_files:
        logger.error("No test files specified. Use --test-files or --create-test-pdf")
        return

    # Initialize processors
    processors = [
        (PDFProcessor(config), "PDFProcessor (Original)"),
        (PDFProcessorOptimized(config), "PDFProcessor (Optimized)"),
    ]

    # Run benchmark
    benchmark = PerformanceBenchmark(config)

    logger.info(f"Running benchmark on {len(test_files)} files...")

    summaries = benchmark.compare_processors(test_files, processors)

    # Print results
    for name, summary in summaries.items():
        benchmark.print_summary(summary)

    benchmark.print_comparison(summaries)

    # Save results
    benchmark.save_results(summaries, args.output)

    # Cleanup test files
    if args.create_test_pdf:
        try:
            os.remove(test_pdf)
        except:
            pass


if __name__ == '__main__':
    main()
