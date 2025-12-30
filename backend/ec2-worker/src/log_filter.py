"""
Secure Logging Filter
Prevents sensitive information from being logged
"""

import logging
import re
from typing import Any


class SensitiveDataFilter(logging.Filter):
    """
    ログから機密情報をマスキングするフィルター

    以下の情報をマスキング:
    - AWS認証情報
    - パスワード
    - トークン
    - メールアドレス
    - IPアドレス
    - クレジットカード番号
    """

    # Patterns to redact
    PATTERNS = [
        # AWS Access Keys
        (re.compile(r'AKIA[0-9A-Z]{16}'), '***AWS_ACCESS_KEY***'),
        # AWS Secret Keys
        (re.compile(r'[A-Za-z0-9/+=]{40}'), '***AWS_SECRET***'),
        # Passwords (key=value format)
        (re.compile(r'(password|passwd|pwd)["\']?\s*[:=]\s*["\']?([^"\'\s]+)', re.IGNORECASE),
         r'\1=***PASSWORD***'),
        # Authorization headers
        (re.compile(r'Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*', re.IGNORECASE),
         'Authorization: Bearer ***TOKEN***'),
        (re.compile(r'Authorization:\s*Basic\s+[A-Za-z0-9+/=]+', re.IGNORECASE),
         'Authorization: Basic ***CREDENTIALS***'),
        # Email addresses (partial masking)
        (re.compile(r'([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})'),
         r'\1***@\2'),
        # IP addresses (keep first 2 octets)
        (re.compile(r'\b(\d{1,3}\.\d{1,3})\.\d{1,3}\.\d{1,3}\b'),
         r'\1.***.**'),
        # Credit card numbers
        (re.compile(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b'),
         '****-****-****-****'),
        # API keys (generic pattern)
        (re.compile(r'api[_-]?key["\']?\s*[:=]\s*["\']?([a-zA-Z0-9\-._~+/]{20,})', re.IGNORECASE),
         'api_key=***API_KEY***'),
        # OpenSearch/Elasticsearch credentials in URLs
        (re.compile(r'https?://([^:]+):([^@]+)@'),
         r'https://***:***@'),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        """
        Filter log record to remove sensitive data

        Args:
            record: Log record to filter

        Returns:
            True (always allow log record after filtering)
        """
        # Filter message
        if hasattr(record, 'msg') and isinstance(record.msg, str):
            record.msg = self._redact_sensitive_data(record.msg)

        # Filter arguments
        if hasattr(record, 'args') and record.args:
            record.args = tuple(
                self._redact_sensitive_data(str(arg)) if isinstance(arg, str) else arg
                for arg in record.args
            )

        return True

    def _redact_sensitive_data(self, text: str) -> str:
        """
        Redact sensitive information from text

        Args:
            text: Input text

        Returns:
            Redacted text
        """
        result = text

        for pattern, replacement in self.PATTERNS:
            result = pattern.sub(replacement, result)

        return result


class PathSanitizer:
    """
    S3パスやファイルパスから個人情報を除去
    """

    @staticmethod
    def sanitize_s3_path(path: str) -> str:
        """
        S3パスをサニタイズ（個人情報を除去）

        例: s3://bucket/customers/ABC_Corp/project_secret/file.pdf
        → s3://bucket/customers/***/***/file.pdf

        Args:
            path: S3パス

        Returns:
            サニタイズされたパス
        """
        parts = path.split('/')

        # バケット名とファイル名は保持、中間パスをマスク
        if len(parts) > 4:
            bucket = parts[0:3]  # s3://bucket
            filename = [parts[-1]]  # file.pdf
            masked = ['***'] * (len(parts) - 4)
            return '/'.join(bucket + masked + filename)

        return path

    @staticmethod
    def sanitize_filename(filename: str, keep_extension: bool = True) -> str:
        """
        ファイル名をサニタイズ

        Args:
            filename: ファイル名
            keep_extension: 拡張子を保持するか

        Returns:
            サニタイズされたファイル名
        """
        if keep_extension and '.' in filename:
            name, ext = filename.rsplit('.', 1)
            # ファイル名の最初と最後の3文字のみ表示
            if len(name) > 6:
                masked_name = f"{name[:3]}***{name[-3:]}"
            else:
                masked_name = "***"
            return f"{masked_name}.{ext}"
        else:
            return "***"


# Usage in main.py
def setup_secure_logging():
    """
    セキュアなロギングを設定

    使用例:
        from log_filter import setup_secure_logging, PathSanitizer

        setup_secure_logging()
        logger.info(f"Processing: {PathSanitizer.sanitize_s3_path(s3_path)}")
    """
    # Add filter to all handlers
    sensitive_filter = SensitiveDataFilter()

    for handler in logging.getLogger().handlers:
        handler.addFilter(sensitive_filter)

    # Also add to root logger
    logging.getLogger().addFilter(sensitive_filter)
