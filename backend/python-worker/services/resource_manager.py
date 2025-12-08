"""
Resource Management Service
メモリ、ディスク、プロセスリソースの監視と管理
"""

import os
import psutil
import logging
import tempfile
import shutil
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from pathlib import Path
import atexit
import signal

logger = logging.getLogger(__name__)


@dataclass
class ResourceUsage:
    """リソース使用状況"""

    # CPU
    cpu_percent: float
    cpu_count: int

    # メモリ
    memory_used_mb: float
    memory_available_mb: float
    memory_percent: float

    # ディスク
    disk_used_gb: float
    disk_available_gb: float
    disk_percent: float

    # 一時ディレクトリ
    temp_dir_size_mb: float
    temp_file_count: int

    # プロセス情報
    process_memory_mb: float
    process_cpu_percent: float
    thread_count: int

    def to_dict(self) -> Dict[str, Any]:
        """辞書に変換"""
        return {
            'cpu': {
                'percent': self.cpu_percent,
                'count': self.cpu_count,
            },
            'memory': {
                'used_mb': self.memory_used_mb,
                'available_mb': self.memory_available_mb,
                'percent': self.memory_percent,
            },
            'disk': {
                'used_gb': self.disk_used_gb,
                'available_gb': self.disk_available_gb,
                'percent': self.disk_percent,
            },
            'temp_directory': {
                'size_mb': self.temp_dir_size_mb,
                'file_count': self.temp_file_count,
            },
            'process': {
                'memory_mb': self.process_memory_mb,
                'cpu_percent': self.process_cpu_percent,
                'thread_count': self.thread_count,
            }
        }

    def is_healthy(
        self,
        max_memory_percent: float = 80.0,
        max_disk_percent: float = 90.0,
        max_temp_size_mb: float = 1000.0
    ) -> bool:
        """
        リソースが健全な状態かチェック

        Args:
            max_memory_percent: メモリ使用率の上限
            max_disk_percent: ディスク使用率の上限
            max_temp_size_mb: 一時ディレクトリサイズの上限

        Returns:
            健全な場合True
        """
        if self.memory_percent > max_memory_percent:
            logger.warning(f"High memory usage: {self.memory_percent:.1f}%")
            return False

        if self.disk_percent > max_disk_percent:
            logger.warning(f"High disk usage: {self.disk_percent:.1f}%")
            return False

        if self.temp_dir_size_mb > max_temp_size_mb:
            logger.warning(f"Large temp directory: {self.temp_dir_size_mb:.1f}MB")
            return False

        return True


class ResourceManager:
    """
    リソース管理マネージャー
    メモリ、ディスク、一時ファイルの管理と監視
    """

    def __init__(self, config):
        """
        初期化

        Args:
            config: アプリケーション設定
        """
        self.config = config
        self.temp_dir = Path(config.processing.temp_dir)
        self.cleanup_enabled = config.processing.cleanup_temp_files

        # 一時ファイルの追跡
        self.temp_files: List[Path] = []

        # プロセス情報
        self.process = psutil.Process()

        # クリーンアップ登録
        atexit.register(self.cleanup_all)
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

        logger.info(f"ResourceManager initialized (temp_dir: {self.temp_dir})")

    def _signal_handler(self, signum, frame):
        """シグナルハンドラー"""
        logger.info(f"Received signal {signum}, cleaning up resources...")
        self.cleanup_all()

    def get_resource_usage(self) -> ResourceUsage:
        """
        現在のリソース使用状況を取得

        Returns:
            ResourceUsage
        """
        # CPU情報
        cpu_percent = psutil.cpu_percent(interval=1)
        cpu_count = psutil.cpu_count()

        # メモリ情報
        memory = psutil.virtual_memory()
        memory_used_mb = memory.used / (1024 * 1024)
        memory_available_mb = memory.available / (1024 * 1024)
        memory_percent = memory.percent

        # ディスク情報
        disk = psutil.disk_usage(self.temp_dir)
        disk_used_gb = disk.used / (1024 * 1024 * 1024)
        disk_available_gb = disk.free / (1024 * 1024 * 1024)
        disk_percent = disk.percent

        # 一時ディレクトリの情報
        temp_dir_size_mb = self._get_directory_size(self.temp_dir) / (1024 * 1024)
        temp_file_count = sum(1 for _ in self.temp_dir.rglob('*') if _.is_file())

        # プロセス情報
        process_memory_mb = self.process.memory_info().rss / (1024 * 1024)
        process_cpu_percent = self.process.cpu_percent(interval=0.1)
        thread_count = self.process.num_threads()

        return ResourceUsage(
            cpu_percent=cpu_percent,
            cpu_count=cpu_count,
            memory_used_mb=memory_used_mb,
            memory_available_mb=memory_available_mb,
            memory_percent=memory_percent,
            disk_used_gb=disk_used_gb,
            disk_available_gb=disk_available_gb,
            disk_percent=disk_percent,
            temp_dir_size_mb=temp_dir_size_mb,
            temp_file_count=temp_file_count,
            process_memory_mb=process_memory_mb,
            process_cpu_percent=process_cpu_percent,
            thread_count=thread_count,
        )

    def _get_directory_size(self, directory: Path) -> int:
        """
        ディレクトリのサイズを取得

        Args:
            directory: ディレクトリパス

        Returns:
            サイズ（バイト）
        """
        try:
            total_size = 0
            for file_path in directory.rglob('*'):
                if file_path.is_file():
                    total_size += file_path.stat().st_size
            return total_size
        except Exception as e:
            logger.warning(f"Failed to get directory size: {e}")
            return 0

    def create_temp_file(
        self,
        suffix: str = '',
        prefix: str = 'worker_',
        track: bool = True
    ) -> Path:
        """
        一時ファイルを作成

        Args:
            suffix: ファイル拡張子
            prefix: ファイル名プレフィックス
            track: ファイルを追跡リストに追加するか

        Returns:
            作成されたファイルのパス
        """
        try:
            # 一時ファイルを作成
            temp_file = tempfile.NamedTemporaryFile(
                suffix=suffix,
                prefix=prefix,
                dir=self.temp_dir,
                delete=False
            )
            temp_path = Path(temp_file.name)
            temp_file.close()

            # 追跡リストに追加
            if track:
                self.temp_files.append(temp_path)

            logger.debug(f"Created temp file: {temp_path.name}")

            return temp_path

        except Exception as e:
            logger.error(f"Failed to create temp file: {e}")
            raise

    def delete_temp_file(self, file_path: Path) -> bool:
        """
        一時ファイルを削除

        Args:
            file_path: 削除するファイルパス

        Returns:
            成功した場合True
        """
        try:
            if file_path.exists():
                file_path.unlink()
                logger.debug(f"Deleted temp file: {file_path.name}")

            # 追跡リストから削除
            if file_path in self.temp_files:
                self.temp_files.remove(file_path)

            return True

        except Exception as e:
            logger.warning(f"Failed to delete temp file {file_path}: {e}")
            return False

    def cleanup_all(self):
        """すべての追跡ファイルをクリーンアップ"""
        if not self.cleanup_enabled:
            logger.info("Cleanup disabled - skipping")
            return

        logger.info(f"Cleaning up {len(self.temp_files)} temporary files...")

        deleted_count = 0
        for file_path in self.temp_files[:]:  # コピーを作成してイテレート
            if self.delete_temp_file(file_path):
                deleted_count += 1

        logger.info(f"Cleanup completed: {deleted_count}/{len(self.temp_files)} files deleted")

        # リストをクリア
        self.temp_files.clear()

    def cleanup_old_files(self, max_age_hours: int = 24):
        """
        古い一時ファイルを削除

        Args:
            max_age_hours: 削除対象とする経過時間（時間）
        """
        import time

        if not self.cleanup_enabled:
            return

        logger.info(f"Cleaning up files older than {max_age_hours} hours...")

        current_time = time.time()
        max_age_seconds = max_age_hours * 3600
        deleted_count = 0

        try:
            for file_path in self.temp_dir.rglob('*'):
                if not file_path.is_file():
                    continue

                # ファイルの最終更新時刻を取得
                file_age = current_time - file_path.stat().st_mtime

                if file_age > max_age_seconds:
                    try:
                        file_path.unlink()
                        deleted_count += 1
                        logger.debug(f"Deleted old file: {file_path.name}")
                    except Exception as e:
                        logger.warning(f"Failed to delete old file {file_path}: {e}")

            logger.info(f"Old file cleanup completed: {deleted_count} files deleted")

        except Exception as e:
            logger.error(f"Error during old file cleanup: {e}")

    def check_disk_space(self, min_free_gb: float = 5.0) -> bool:
        """
        ディスク空き容量をチェック

        Args:
            min_free_gb: 必要な最小空き容量（GB）

        Returns:
            十分な空き容量がある場合True
        """
        try:
            disk = psutil.disk_usage(self.temp_dir)
            free_gb = disk.free / (1024 * 1024 * 1024)

            if free_gb < min_free_gb:
                logger.warning(
                    f"Low disk space: {free_gb:.2f}GB free "
                    f"(minimum: {min_free_gb}GB)"
                )
                return False

            return True

        except Exception as e:
            logger.error(f"Failed to check disk space: {e}")
            return False

    def check_memory_available(self, min_free_mb: float = 500.0) -> bool:
        """
        メモリ空き容量をチェック

        Args:
            min_free_mb: 必要な最小空きメモリ（MB）

        Returns:
            十分な空きメモリがある場合True
        """
        try:
            memory = psutil.virtual_memory()
            available_mb = memory.available / (1024 * 1024)

            if available_mb < min_free_mb:
                logger.warning(
                    f"Low memory: {available_mb:.2f}MB available "
                    f"(minimum: {min_free_mb}MB)"
                )
                return False

            return True

        except Exception as e:
            logger.error(f"Failed to check memory: {e}")
            return False

    def force_garbage_collection(self):
        """強制的にガベージコレクションを実行"""
        import gc

        before = self.process.memory_info().rss / (1024 * 1024)
        collected = gc.collect()
        after = self.process.memory_info().rss / (1024 * 1024)

        freed_mb = before - after

        logger.info(
            f"Garbage collection: {collected} objects collected, "
            f"{freed_mb:.2f}MB freed"
        )

    def log_resource_usage(self):
        """リソース使用状況をログに記録"""
        usage = self.get_resource_usage()

        logger.info("=== Resource Usage ===")
        logger.info(f"CPU: {usage.cpu_percent:.1f}% ({usage.cpu_count} cores)")
        logger.info(
            f"Memory: {usage.memory_used_mb:.0f}MB used / "
            f"{usage.memory_available_mb:.0f}MB available "
            f"({usage.memory_percent:.1f}%)"
        )
        logger.info(
            f"Disk: {usage.disk_used_gb:.1f}GB used / "
            f"{usage.disk_available_gb:.1f}GB available "
            f"({usage.disk_percent:.1f}%)"
        )
        logger.info(
            f"Temp Directory: {usage.temp_dir_size_mb:.1f}MB "
            f"({usage.temp_file_count} files)"
        )
        logger.info(
            f"Process: {usage.process_memory_mb:.0f}MB memory, "
            f"{usage.process_cpu_percent:.1f}% CPU, "
            f"{usage.thread_count} threads"
        )
        logger.info("=====================")

    def get_metrics_for_cloudwatch(self) -> List[Dict[str, Any]]:
        """
        CloudWatch用のメトリクスデータを取得

        Returns:
            CloudWatch PutMetricData用のメトリクスリスト
        """
        usage = self.get_resource_usage()

        from datetime import datetime

        timestamp = datetime.utcnow()

        return [
            {
                'MetricName': 'CPUUtilization',
                'Value': usage.cpu_percent,
                'Unit': 'Percent',
                'Timestamp': timestamp,
            },
            {
                'MetricName': 'MemoryUtilization',
                'Value': usage.memory_percent,
                'Unit': 'Percent',
                'Timestamp': timestamp,
            },
            {
                'MetricName': 'DiskUtilization',
                'Value': usage.disk_percent,
                'Unit': 'Percent',
                'Timestamp': timestamp,
            },
            {
                'MetricName': 'TempDirectorySize',
                'Value': usage.temp_dir_size_mb,
                'Unit': 'Megabytes',
                'Timestamp': timestamp,
            },
            {
                'MetricName': 'ProcessMemory',
                'Value': usage.process_memory_mb,
                'Unit': 'Megabytes',
                'Timestamp': timestamp,
            },
        ]
