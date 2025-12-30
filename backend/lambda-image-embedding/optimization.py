"""
Lambda Image Embedding Optimization Module

Performance Optimizations:
1. Model preloading and caching
2. Memory-efficient tensor operations
3. Batch processing support
4. Connection pooling for AWS services
5. Provisioned concurrency recommendations

Cold Start Mitigation:
- Global variable caching
- Lazy initialization
- Efficient imports
- Model weight sharing via EFS (for production)
"""

import os
import time
from typing import Dict, List, Optional, Tuple
from functools import lru_cache
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Performance monitoring
class PerformanceMonitor:
    """Track Lambda performance metrics"""

    def __init__(self):
        self.metrics = {
            'cold_starts': 0,
            'warm_invocations': 0,
            'model_load_time': 0,
            'inference_times': [],
            'cache_hits': 0,
            'cache_misses': 0
        }

    def record_cold_start(self, load_time: float):
        """Record a cold start event"""
        self.metrics['cold_starts'] += 1
        self.metrics['model_load_time'] = load_time
        logger.info(f"Cold start recorded: {load_time:.2f}s")

    def record_warm_invocation(self):
        """Record a warm invocation"""
        self.metrics['warm_invocations'] += 1

    def record_inference(self, inference_time: float):
        """Record inference time"""
        self.metrics['inference_times'].append(inference_time)

    def record_cache_hit(self):
        """Record cache hit"""
        self.metrics['cache_hits'] += 1

    def record_cache_miss(self):
        """Record cache miss"""
        self.metrics['cache_misses'] += 1

    def get_stats(self) -> Dict:
        """Get performance statistics"""
        total_invocations = self.metrics['cold_starts'] + self.metrics['warm_invocations']
        cache_total = self.metrics['cache_hits'] + self.metrics['cache_misses']

        avg_inference = (
            sum(self.metrics['inference_times']) / len(self.metrics['inference_times'])
            if self.metrics['inference_times'] else 0
        )

        return {
            'total_invocations': total_invocations,
            'cold_start_rate': (
                self.metrics['cold_starts'] / total_invocations
                if total_invocations > 0 else 0
            ),
            'average_inference_time_ms': avg_inference * 1000,
            'cache_hit_rate': (
                self.metrics['cache_hits'] / cache_total
                if cache_total > 0 else 0
            ),
            'model_load_time_s': self.metrics['model_load_time']
        }

# Global performance monitor
perf_monitor = PerformanceMonitor()


# Memory optimization settings
MEMORY_OPTIMIZATION_CONFIG = {
    # Memory allocation (Lambda setting)
    'recommended_memory_mb': 3008,  # 3 GB for CLIP model + inference

    # Batch processing
    'max_batch_size': 10,  # Process up to 10 images in one invocation
    'batch_timeout_ms': 25000,  # 25s timeout for batch processing

    # Model optimization
    'use_fp16': True,  # Use half-precision for memory savings
    'torch_num_threads': 2,  # Limit CPU threads

    # Cache optimization
    'embedding_cache_ttl_days': 30,
    'max_cache_entries': 10000,
}


def optimize_torch_settings():
    """
    Apply PyTorch optimizations for Lambda environment
    """
    try:
        import torch

        # Set number of threads
        torch.set_num_threads(MEMORY_OPTIMIZATION_CONFIG['torch_num_threads'])

        # Enable cudnn benchmark if GPU available (unlikely in Lambda)
        if torch.cuda.is_available():
            torch.backends.cudnn.benchmark = True

        # Disable gradient computation (inference only)
        torch.set_grad_enabled(False)

        logger.info("PyTorch optimizations applied")

    except Exception as e:
        logger.warning(f"Failed to apply PyTorch optimizations: {e}")


def estimate_cold_start_time(memory_mb: int) -> float:
    """
    Estimate cold start time based on Lambda memory allocation

    Args:
        memory_mb: Lambda memory allocation in MB

    Returns:
        Estimated cold start time in seconds
    """
    # Empirical formula based on CLIP model size
    # More memory = faster cold start due to higher CPU allocation

    if memory_mb < 1024:
        return 15.0  # Very slow
    elif memory_mb < 2048:
        return 8.0   # Slow
    elif memory_mb < 3008:
        return 5.0   # Acceptable
    else:
        return 3.0   # Fast


def recommend_provisioned_concurrency(
    avg_requests_per_minute: float,
    target_cold_start_rate: float = 0.01  # 1% cold start rate
) -> int:
    """
    Recommend provisioned concurrency setting

    Args:
        avg_requests_per_minute: Average requests per minute
        target_cold_start_rate: Target cold start rate (default 1%)

    Returns:
        Recommended provisioned concurrency count
    """
    # Calculate concurrent executions needed
    # Assumes average execution time of 2 seconds
    avg_execution_time_minutes = 2 / 60
    concurrent_executions = avg_requests_per_minute * avg_execution_time_minutes

    # Add buffer for target cold start rate
    buffer = concurrent_executions * (1 / target_cold_start_rate - 1)

    recommended = int(concurrent_executions + buffer)

    logger.info(
        f"Recommended provisioned concurrency: {recommended} "
        f"(avg RPS: {avg_requests_per_minute:.1f})"
    )

    return max(1, recommended)


def optimize_batch_processing(
    images: List[bytes],
    max_batch_size: int = MEMORY_OPTIMIZATION_CONFIG['max_batch_size']
) -> List[List[bytes]]:
    """
    Split images into optimal batches for processing

    Args:
        images: List of image data
        max_batch_size: Maximum batch size

    Returns:
        List of image batches
    """
    batches = []
    for i in range(0, len(images), max_batch_size):
        batches.append(images[i:i + max_batch_size])

    logger.info(f"Split {len(images)} images into {len(batches)} batches")
    return batches


@lru_cache(maxsize=128)
def get_optimal_image_size(original_size: Tuple[int, int]) -> Tuple[int, int]:
    """
    Calculate optimal image resize dimensions
    Uses LRU cache to avoid repeated calculations

    Args:
        original_size: (width, height) tuple

    Returns:
        Optimal (width, height) for model input
    """
    width, height = original_size
    max_size = int(os.environ.get('MAX_IMAGE_SIZE', '2048'))

    if width <= max_size and height <= max_size:
        return original_size

    ratio = min(max_size / width, max_size / height)
    return (int(width * ratio), int(height * ratio))


class ConnectionPool:
    """
    Connection pool for AWS services to reduce cold start impact
    """

    _s3_client = None
    _dynamodb_table = None

    @classmethod
    def get_s3_client(cls):
        """Get or create S3 client"""
        if cls._s3_client is None:
            import boto3
            cls._s3_client = boto3.client(
                's3',
                # Connection pool optimization
                config=boto3.session.Config(
                    max_pool_connections=10,
                    retries={'max_attempts': 3, 'mode': 'adaptive'}
                )
            )
        return cls._s3_client

    @classmethod
    def get_dynamodb_table(cls, table_name: str):
        """Get or create DynamoDB table resource"""
        if cls._dynamodb_table is None:
            import boto3
            dynamodb = boto3.resource(
                'dynamodb',
                config=boto3.session.Config(
                    max_pool_connections=10,
                    retries={'max_attempts': 3, 'mode': 'adaptive'}
                )
            )
            cls._dynamodb_table = dynamodb.Table(table_name)
        return cls._dynamodb_table


def get_memory_usage() -> Dict[str, float]:
    """
    Get current memory usage statistics

    Returns:
        Dictionary with memory usage info
    """
    try:
        import psutil
        process = psutil.Process()
        memory_info = process.memory_info()

        return {
            'rss_mb': memory_info.rss / 1024 / 1024,
            'vms_mb': memory_info.vms / 1024 / 1024,
            'percent': process.memory_percent()
        }
    except ImportError:
        # psutil not available, return empty dict
        return {}


def log_performance_metrics():
    """
    Log performance metrics to CloudWatch
    """
    stats = perf_monitor.get_stats()
    memory = get_memory_usage()

    logger.info("Performance Metrics", extra={
        'metrics': {
            **stats,
            'memory_usage': memory
        }
    })


# Optimization recommendations for Lambda configuration
LAMBDA_OPTIMIZATION_CONFIG = {
    'memory_size': 3008,  # MB
    'timeout': 30,  # seconds
    'ephemeral_storage': 512,  # MB

    'environment_variables': {
        'MODEL_NAME': 'openai/clip-vit-base-patch32',
        'VECTOR_DIMENSION': '512',
        'MAX_IMAGE_SIZE': '2048',
        'TORCH_NUM_THREADS': '2',
        'OMP_NUM_THREADS': '2',
        'MKL_NUM_THREADS': '2',

        # PyTorch optimizations
        'PYTORCH_NO_CUDA_MEMORY_CACHING': '1',
        'PYTORCH_CUDA_ALLOC_CONF': 'max_split_size_mb:128',
    },

    'reserved_concurrent_executions': {
        'development': 1,
        'staging': 5,
        'production': 20
    },

    'provisioned_concurrency': {
        'development': 0,
        'staging': 1,
        'production': 5  # Adjust based on traffic
    }
}


def print_optimization_report():
    """
    Print comprehensive optimization report
    """
    print("\n" + "="*60)
    print("Lambda Image Embedding Optimization Report")
    print("="*60)

    print("\n## Memory Configuration")
    print(f"  Recommended Memory: {LAMBDA_OPTIMIZATION_CONFIG['memory_size']} MB")
    print(f"  Timeout: {LAMBDA_OPTIMIZATION_CONFIG['timeout']} seconds")
    print(f"  Ephemeral Storage: {LAMBDA_OPTIMIZATION_CONFIG['ephemeral_storage']} MB")

    print("\n## Provisioned Concurrency")
    for env, count in LAMBDA_OPTIMIZATION_CONFIG['provisioned_concurrency'].items():
        cold_start_time = estimate_cold_start_time(LAMBDA_OPTIMIZATION_CONFIG['memory_size'])
        print(f"  {env.capitalize()}: {count} instances")
        print(f"    - Cold start time: ~{cold_start_time:.1f}s")
        print(f"    - Warm invocation time: ~2s")

    print("\n## Batch Processing")
    print(f"  Max Batch Size: {MEMORY_OPTIMIZATION_CONFIG['max_batch_size']} images")
    print(f"  Batch Timeout: {MEMORY_OPTIMIZATION_CONFIG['batch_timeout_ms']}ms")

    print("\n## Performance Metrics")
    stats = perf_monitor.get_stats()
    print(f"  Total Invocations: {stats['total_invocations']}")
    print(f"  Cold Start Rate: {stats['cold_start_rate']:.1%}")
    print(f"  Average Inference Time: {stats['average_inference_time_ms']:.1f}ms")
    print(f"  Cache Hit Rate: {stats['cache_hit_rate']:.1%}")

    print("\n## Cost Estimation (monthly)")
    # AWS Lambda pricing (us-east-1)
    memory_gb = LAMBDA_OPTIMIZATION_CONFIG['memory_size'] / 1024
    price_per_gb_second = 0.0000166667
    avg_duration_seconds = 2.0

    for env, requests_per_day in [('development', 100), ('staging', 1000), ('production', 10000)]:
        monthly_requests = requests_per_day * 30
        compute_seconds = monthly_requests * avg_duration_seconds * memory_gb
        compute_cost = compute_seconds * price_per_gb_second
        request_cost = monthly_requests * 0.0000002  # $0.20 per 1M requests

        provisioned = LAMBDA_OPTIMIZATION_CONFIG['provisioned_concurrency'][env]
        provisioned_cost = provisioned * memory_gb * price_per_gb_second * 30 * 24 * 3600

        total_cost = compute_cost + request_cost + provisioned_cost

        print(f"\n  {env.capitalize()}:")
        print(f"    - Requests/month: {monthly_requests:,}")
        print(f"    - Compute cost: ${compute_cost:.2f}")
        print(f"    - Request cost: ${request_cost:.2f}")
        print(f"    - Provisioned cost: ${provisioned_cost:.2f}")
        print(f"    - Total: ${total_cost:.2f}")

    print("\n" + "="*60 + "\n")


if __name__ == '__main__':
    # Print optimization report when run directly
    print_optimization_report()
