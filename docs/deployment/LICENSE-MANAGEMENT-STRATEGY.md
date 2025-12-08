# DocuWorks License Management Strategy

## Executive Summary

DocuWorks 商用ライセンス1本を最適に活用するためのライセンス管理戦略を提供します。

**ライセンス情報:**
- 購入本数: 1
- 同時実行可能インスタンス: 1
- ライセンスタイプ: Commercial

---

## License Management Architecture

### 1. Centralized License Storage

```
┌──────────────────────────────────────────────────────────┐
│          AWS Secrets Manager                              │
│  (cis-filesearch/docuworks-license)                      │
├──────────────────────────────────────────────────────────┤
│  {                                                        │
│    "license_key": "XXXX-XXXX-XXXX-XXXX",                │
│    "license_type": "commercial",                         │
│    "max_concurrent": 1,                                  │
│    "purchased_date": "2024-12-01",                       │
│    "expiry_date": "2025-12-01",                         │
│    "owner": "CIS Corporation",                          │
│    "support_contact": "support@example.com"             │
│  }                                                        │
└──────────────────────────────────────────────────────────┘
                              │
                              │ Secure Access
                              ▼
┌──────────────────────────────────────────────────────────┐
│          EC2 Instance (Windows Server 2022)              │
│                                                           │
│  ┌────────────────────────────────────────────────┐     │
│  │  License Manager Service                       │     │
│  │  - Retrieves license from Secrets Manager      │     │
│  │  - Validates license status                    │     │
│  │  - Enforces concurrent usage limit             │     │
│  └────────────────────────────────────────────────┘     │
│                      │                                    │
│                      ▼                                    │
│  ┌────────────────────────────────────────────────┐     │
│  │  DocuWorks SDK Processor                       │     │
│  │  - Uses license for file processing            │     │
│  │  - Single instance enforcement                 │     │
│  └────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

---

## Implementation

### 1. License Storage in AWS Secrets Manager

#### Create Secret

```bash
#!/bin/bash
# scripts/setup-docuworks-license.sh

# DocuWorks ライセンスをSecrets Managerに保存

LICENSE_KEY="YOUR-LICENSE-KEY-HERE"
LICENSE_TYPE="commercial"
PURCHASED_DATE="2024-12-01"
EXPIRY_DATE="2025-12-01"
MAX_CONCURRENT=1
OWNER="CIS Corporation"
SUPPORT_CONTACT="support@example.com"

SECRET_VALUE=$(cat <<EOF
{
  "license_key": "${LICENSE_KEY}",
  "license_type": "${LICENSE_TYPE}",
  "max_concurrent": ${MAX_CONCURRENT},
  "purchased_date": "${PURCHASED_DATE}",
  "expiry_date": "${EXPIRY_DATE}",
  "owner": "${OWNER}",
  "support_contact": "${SUPPORT_CONTACT}"
}
EOF
)

# Create secret
aws secretsmanager create-secret \
    --name cis-filesearch/docuworks-license \
    --description "DocuWorks Commercial License Key and Configuration" \
    --secret-string "${SECRET_VALUE}" \
    --region ap-northeast-1 \
    --tags Key=Project,Value=CISFileSearch Key=Environment,Value=Production

echo "License stored successfully in AWS Secrets Manager"

# Grant EC2 instance role permission to access secret
EC2_ROLE_NAME="EC2-FileProcessor-Role"

aws iam put-role-policy \
    --role-name ${EC2_ROLE_NAME} \
    --policy-name DocuWorksLicenseAccess \
    --policy-document '{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:DescribeSecret"
                ],
                "Resource": "arn:aws:secretsmanager:ap-northeast-1:*:secret:cis-filesearch/docuworks-license-*"
            }
        ]
    }'

echo "IAM permissions configured"
```

#### Update Secret (License Renewal)

```bash
#!/bin/bash
# scripts/update-license.sh

# ライセンス更新時に実行

NEW_LICENSE_KEY="NEW-LICENSE-KEY"
NEW_EXPIRY_DATE="2026-12-01"

aws secretsmanager update-secret \
    --secret-id cis-filesearch/docuworks-license \
    --secret-string '{
        "license_key": "'"${NEW_LICENSE_KEY}"'",
        "license_type": "commercial",
        "max_concurrent": 1,
        "purchased_date": "2024-12-01",
        "expiry_date": "'"${NEW_EXPIRY_DATE}"'",
        "owner": "CIS Corporation",
        "support_contact": "support@example.com"
    }' \
    --region ap-northeast-1

echo "License updated successfully"
```

### 2. License Manager Service

```python
# services/license_manager.py

"""
DocuWorks License Manager
Manages license retrieval, validation, and concurrent usage enforcement
"""

import boto3
import json
import logging
from typing import Optional, Dict
from datetime import datetime, timedelta
from pathlib import Path
import hashlib
import threading

logger = logging.getLogger(__name__)


class LicenseManager:
    """
    DocuWorks License Manager

    Responsibilities:
    - Retrieve license from AWS Secrets Manager
    - Validate license status (expiry, type)
    - Enforce concurrent usage limits
    - Provide license information to SDK
    """

    # Singleton instance
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        """Singleton pattern to ensure only one license manager exists"""
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(
        self,
        secret_name: str = 'cis-filesearch/docuworks-license',
        region: str = 'ap-northeast-1'
    ):
        """
        Initialize License Manager

        Args:
            secret_name: AWS Secrets Manager secret name
            region: AWS region
        """
        # Initialize only once
        if hasattr(self, '_initialized'):
            return

        self.secret_name = secret_name
        self.region = region

        # AWS Secrets Manager client
        self.secrets_client = boto3.client(
            'secretsmanager',
            region_name=region
        )

        # License cache
        self._cached_license = None
        self._cache_timestamp = None
        self._cache_ttl = 3600  # 1 hour

        # Concurrent usage tracking
        self._active_instances = 0
        self._instance_lock = threading.Lock()

        self._initialized = True
        logger.info("License Manager initialized")

    def get_license(self, force_refresh: bool = False) -> Optional[Dict]:
        """
        Retrieve license from Secrets Manager

        Args:
            force_refresh: Force refresh from Secrets Manager

        Returns:
            License information dictionary or None
        """
        # Check cache
        if not force_refresh and self._is_cache_valid():
            logger.debug("Using cached license")
            return self._cached_license

        try:
            logger.info(f"Retrieving license from Secrets Manager: {self.secret_name}")

            response = self.secrets_client.get_secret_value(
                SecretId=self.secret_name
            )

            secret_data = json.loads(response['SecretString'])

            # Update cache
            self._cached_license = secret_data
            self._cache_timestamp = datetime.now()

            logger.info("License retrieved successfully")
            return secret_data

        except self.secrets_client.exceptions.ResourceNotFoundException:
            logger.error(f"License secret not found: {self.secret_name}")
            return None

        except self.secrets_client.exceptions.InvalidRequestException as e:
            logger.error(f"Invalid request to Secrets Manager: {e}")
            return None

        except Exception as e:
            logger.error(f"Failed to retrieve license: {e}")
            return None

    def _is_cache_valid(self) -> bool:
        """Check if cached license is still valid"""
        if not self._cached_license or not self._cache_timestamp:
            return False

        age = (datetime.now() - self._cache_timestamp).total_seconds()
        return age < self._cache_ttl

    def validate_license(self) -> bool:
        """
        Validate license is current and usable

        Returns:
            True if license is valid
        """
        license_info = self.get_license()

        if not license_info:
            logger.error("No license information available")
            return False

        # Check license type
        license_type = license_info.get('license_type', '').lower()
        if license_type not in ['commercial', 'enterprise']:
            logger.error(f"Invalid license type: {license_type}")
            return False

        # Check expiry date
        expiry_date_str = license_info.get('expiry_date')
        if expiry_date_str:
            try:
                expiry_date = datetime.fromisoformat(expiry_date_str)

                # Check if expired
                if datetime.now() > expiry_date:
                    logger.error(f"License has expired on {expiry_date_str}")
                    return False

                # Warn if expiring soon (within 30 days)
                days_until_expiry = (expiry_date - datetime.now()).days
                if days_until_expiry <= 30:
                    logger.warning(
                        f"License expiring in {days_until_expiry} days. "
                        f"Please renew before {expiry_date_str}"
                    )

            except ValueError as e:
                logger.error(f"Invalid expiry date format: {expiry_date_str}")
                return False

        # Check concurrent usage limit
        max_concurrent = license_info.get('max_concurrent', 1)
        if self._active_instances >= max_concurrent:
            logger.error(
                f"Maximum concurrent instances ({max_concurrent}) reached. "
                f"Current active: {self._active_instances}"
            )
            return False

        logger.info("License validation successful")
        return True

    def acquire_license(self) -> bool:
        """
        Acquire license for use (concurrent usage tracking)

        Returns:
            True if license acquired successfully
        """
        with self._instance_lock:
            license_info = self.get_license()

            if not license_info:
                return False

            max_concurrent = license_info.get('max_concurrent', 1)

            if self._active_instances >= max_concurrent:
                logger.error(
                    f"Cannot acquire license: maximum concurrent instances "
                    f"({max_concurrent}) already active"
                )
                return False

            if not self.validate_license():
                return False

            self._active_instances += 1
            logger.info(
                f"License acquired. Active instances: {self._active_instances}/{max_concurrent}"
            )
            return True

    def release_license(self):
        """Release acquired license"""
        with self._instance_lock:
            if self._active_instances > 0:
                self._active_instances -= 1
                logger.info(f"License released. Active instances: {self._active_instances}")
            else:
                logger.warning("Attempted to release license, but no active instances")

    def get_license_key(self) -> Optional[str]:
        """
        Get license key for SDK

        Returns:
            License key string or None
        """
        license_info = self.get_license()

        if not license_info:
            return None

        return license_info.get('license_key')

    def get_license_info(self) -> Dict:
        """
        Get comprehensive license information

        Returns:
            Dictionary with license details
        """
        license_info = self.get_license()

        if not license_info:
            return {
                'status': 'unavailable',
                'message': 'License not found'
            }

        # Calculate expiry status
        expiry_date_str = license_info.get('expiry_date')
        expiry_status = 'unknown'
        days_remaining = None

        if expiry_date_str:
            try:
                expiry_date = datetime.fromisoformat(expiry_date_str)
                days_remaining = (expiry_date - datetime.now()).days

                if days_remaining < 0:
                    expiry_status = 'expired'
                elif days_remaining <= 30:
                    expiry_status = 'expiring_soon'
                else:
                    expiry_status = 'valid'

            except ValueError:
                expiry_status = 'invalid_date'

        return {
            'status': 'available',
            'license_type': license_info.get('license_type'),
            'max_concurrent': license_info.get('max_concurrent'),
            'active_instances': self._active_instances,
            'expiry_date': expiry_date_str,
            'expiry_status': expiry_status,
            'days_remaining': days_remaining,
            'owner': license_info.get('owner'),
            'purchased_date': license_info.get('purchased_date')
        }

    def check_license_health(self) -> Dict:
        """
        Perform comprehensive license health check

        Returns:
            Health check results
        """
        health = {
            'healthy': True,
            'issues': [],
            'warnings': []
        }

        # Get license info
        license_info = self.get_license()

        if not license_info:
            health['healthy'] = False
            health['issues'].append('License not found in Secrets Manager')
            return health

        # Check expiry
        expiry_date_str = license_info.get('expiry_date')
        if expiry_date_str:
            try:
                expiry_date = datetime.fromisoformat(expiry_date_str)
                days_remaining = (expiry_date - datetime.now()).days

                if days_remaining < 0:
                    health['healthy'] = False
                    health['issues'].append(f'License expired {abs(days_remaining)} days ago')
                elif days_remaining <= 7:
                    health['warnings'].append(f'License expiring in {days_remaining} days')
                elif days_remaining <= 30:
                    health['warnings'].append(f'License expiring in {days_remaining} days - plan renewal')

            except ValueError:
                health['healthy'] = False
                health['issues'].append('Invalid expiry date format')

        # Check concurrent usage
        max_concurrent = license_info.get('max_concurrent', 1)
        usage_percent = (self._active_instances / max_concurrent) * 100

        if usage_percent >= 100:
            health['warnings'].append('License at maximum capacity')
        elif usage_percent >= 80:
            health['warnings'].append(f'License usage at {usage_percent:.0f}%')

        # Check license type
        license_type = license_info.get('license_type', '').lower()
        if license_type not in ['commercial', 'enterprise']:
            health['healthy'] = False
            health['issues'].append(f'Invalid license type: {license_type}')

        return health


# Global singleton instance
_license_manager = None


def get_license_manager() -> LicenseManager:
    """
    Get global License Manager instance

    Returns:
        LicenseManager singleton
    """
    global _license_manager

    if _license_manager is None:
        _license_manager = LicenseManager()

    return _license_manager
```

### 3. Integration with DocuWorks Processor

```python
# processors/docuworks_sdk_processor.py - Integration with License Manager

from services.license_manager import get_license_manager

class DocuWorksSDKProcessor(BaseProcessor):
    """DocuWorks processor with license management"""

    def __init__(self, config):
        """Initialize with license manager"""
        super().__init__(config)

        self.license_manager = get_license_manager()
        self.sdk_available = False
        self.dw_app = None

        # Initialize SDK if license is available
        if self.config.docuworks.is_configured():
            if self.license_manager.validate_license():
                self._initialize_sdk()
            else:
                logger.error("License validation failed - SDK not initialized")

    def process(self, file_path: str) -> ProcessingResult:
        """Process file with license acquisition"""
        start_time = time.time()

        try:
            file_info = self._get_file_info(file_path)

            # Acquire license before processing
            if self.sdk_available:
                if not self.license_manager.acquire_license():
                    logger.warning("Failed to acquire license - using OCR fallback")
                    return self._process_with_ocr_fallback(file_path, file_info, start_time)

                try:
                    result = self._process_with_sdk(file_path, file_info, start_time)
                    return result

                finally:
                    # Always release license after processing
                    self.license_manager.release_license()

            # Fallback to OCR if SDK unavailable
            if self.config.docuworks.use_ocr_fallback:
                return self._process_with_ocr_fallback(file_path, file_info, start_time)
            else:
                return self._create_error_result(
                    file_path,
                    "DocuWorks SDK unavailable and OCR fallback disabled"
                )

        except Exception as e:
            logger.error(f"Processing error: {e}", exc_info=True)

            # Ensure license is released on error
            if self.sdk_available:
                self.license_manager.release_license()

            return self._create_error_result(file_path, str(e))
```

---

## License Monitoring

### CloudWatch Custom Metrics

```python
# services/license_metrics.py

import boto3
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class LicenseMetrics:
    """Send license usage metrics to CloudWatch"""

    def __init__(self, namespace: str = 'CIS/FileProcessor'):
        """Initialize metrics service"""
        self.namespace = namespace
        self.cloudwatch = boto3.client('cloudwatch')

    def record_license_usage(self, active_instances: int, max_concurrent: int):
        """Record license usage"""
        usage_percent = (active_instances / max_concurrent) * 100

        self._put_metrics([
            {
                'MetricName': 'LicenseActiveInstances',
                'Value': active_instances,
                'Unit': 'Count'
            },
            {
                'MetricName': 'LicenseUsagePercent',
                'Value': usage_percent,
                'Unit': 'Percent'
            }
        ])

    def record_license_acquisition(self, success: bool):
        """Record license acquisition attempt"""
        self._put_metrics([
            {
                'MetricName': 'LicenseAcquisition',
                'Value': 1,
                'Unit': 'Count',
                'Dimensions': [
                    {'Name': 'Status', 'Value': 'Success' if success else 'Failed'}
                ]
            }
        ])

    def record_license_health(self, is_healthy: bool, days_until_expiry: int = None):
        """Record license health status"""
        metrics = [
            {
                'MetricName': 'LicenseHealth',
                'Value': 1 if is_healthy else 0,
                'Unit': 'None'
            }
        ]

        if days_until_expiry is not None:
            metrics.append({
                'MetricName': 'LicenseDaysUntilExpiry',
                'Value': days_until_expiry,
                'Unit': 'Count'
            })

        self._put_metrics(metrics)

    def _put_metrics(self, metric_data: list):
        """Put metrics to CloudWatch"""
        try:
            self.cloudwatch.put_metric_data(
                Namespace=self.namespace,
                MetricData=[
                    {**metric, 'Timestamp': datetime.utcnow()}
                    for metric in metric_data
                ]
            )
        except Exception as e:
            logger.warning(f"Failed to put metrics: {e}")
```

### CloudWatch Dashboard

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["CIS/FileProcessor", "LicenseActiveInstances"],
          [".", "LicenseUsagePercent"]
        ],
        "period": 300,
        "stat": "Average",
        "region": "ap-northeast-1",
        "title": "DocuWorks License Usage",
        "yAxis": {
          "left": {"min": 0}
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["CIS/FileProcessor", "LicenseDaysUntilExpiry"]
        ],
        "period": 86400,
        "stat": "Average",
        "region": "ap-northeast-1",
        "title": "License Expiry Status"
      }
    }
  ]
}
```

### CloudWatch Alarms

```bash
# License expiry warning (30 days)
aws cloudwatch put-metric-alarm \
    --alarm-name docuworks-license-expiring-soon \
    --alarm-description "DocuWorks license expiring within 30 days" \
    --metric-name LicenseDaysUntilExpiry \
    --namespace CIS/FileProcessor \
    --statistic Average \
    --period 86400 \
    --threshold 30 \
    --comparison-operator LessThanThreshold \
    --evaluation-periods 1 \
    --alarm-actions arn:aws:sns:ap-northeast-1:123456789012:license-alerts

# License capacity warning
aws cloudwatch put-metric-alarm \
    --alarm-name docuworks-license-at-capacity \
    --alarm-description "DocuWorks license at maximum capacity" \
    --metric-name LicenseUsagePercent \
    --namespace CIS/FileProcessor \
    --statistic Average \
    --period 300 \
    --threshold 90 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 2 \
    --alarm-actions arn:aws:sns:ap-northeast-1:123456789012:license-alerts
```

---

## Scaling Considerations

### Current Setup (1 License)

```
┌─────────────────────────────────────┐
│  Single EC2 Instance                │
│  - 1 DocuWorks license              │
│  - 1 concurrent processing thread   │
│  - Sequential file processing       │
└─────────────────────────────────────┘

Throughput: ~50-100 DocuWorks files/hour
(Depends on file size and complexity)
```

### Future Scaling (Multiple Licenses)

購入ライセンスを増やす場合の戦略:

#### Option 1: Vertical Scaling (2-4 Licenses)

```
┌─────────────────────────────────────┐
│  Single EC2 Instance (Larger)       │
│  - 4 DocuWorks licenses             │
│  - 4 concurrent processing threads  │
│  - Parallel file processing         │
└─────────────────────────────────────┘

Throughput: ~200-400 DocuWorks files/hour

Configuration:
- EC2: t3.xlarge or c5.2xlarge
- Licenses: 4 commercial licenses
- MAX_WORKERS=4
```

#### Option 2: Horizontal Scaling (5+ Licenses)

```
┌────────────────────┐  ┌────────────────────┐
│  EC2 Instance #1   │  │  EC2 Instance #2   │
│  - 2 licenses      │  │  - 2 licenses      │
└────────────────────┘  └────────────────────┘
         │                       │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Shared SQS Queue    │
         └───────────────────────┘

Throughput: ~400-800 DocuWorks files/hour

Requires:
- Distributed license management (DynamoDB)
- Auto Scaling configuration
- Load balancing
```

---

## License Renewal Process

### 30 Days Before Expiry

```bash
# 1. ライセンス情報の確認
aws secretsmanager get-secret-value \
    --secret-id cis-filesearch/docuworks-license \
    --query SecretString \
    --output text | jq .

# 2. Fuji Xeroxに更新依頼
# - サポート窓口に連絡
# - 更新ライセンスキーを取得

# 3. 新しいライセンスキーでSecrets Managerを更新
./scripts/update-license.sh

# 4. ワーカーの再起動 (ライセンスキャッシュをクリア)
nssm restart CISFileWorker

# 5. 動作確認
# ログで新しいライセンスが認識されているか確認
```

### Automated Renewal Reminder

```python
# scripts/license-expiry-checker.py

import boto3
import json
from datetime import datetime, timedelta

def check_license_expiry():
    """Check license expiry and send SNS notification if expiring soon"""

    secrets = boto3.client('secretsmanager')
    sns = boto3.client('sns')

    # Get license
    response = secrets.get_secret_value(
        SecretId='cis-filesearch/docuworks-license'
    )

    license_info = json.loads(response['SecretString'])
    expiry_date = datetime.fromisoformat(license_info['expiry_date'])

    days_remaining = (expiry_date - datetime.now()).days

    # Send notification if expiring within 60 days
    if days_remaining <= 60 and days_remaining > 0:
        message = f"""
DocuWorks License Renewal Required

License expires in {days_remaining} days on {expiry_date.date()}

Action Required:
1. Contact Fuji Xerox support for license renewal
2. Update license key in AWS Secrets Manager
3. Restart file processing worker

License Details:
- Owner: {license_info.get('owner')}
- Type: {license_info.get('license_type')}
- Support Contact: {license_info.get('support_contact')}
        """

        sns.publish(
            TopicArn='arn:aws:sns:ap-northeast-1:123456789012:license-alerts',
            Subject=f'DocuWorks License Expiring in {days_remaining} Days',
            Message=message
        )

        print(f"Notification sent: {days_remaining} days until expiry")

    elif days_remaining <= 0:
        print(f"WARNING: License expired {abs(days_remaining)} days ago!")

    else:
        print(f"License is valid for {days_remaining} days")


if __name__ == '__main__':
    check_license_expiry()
```

```bash
# Schedule daily check with cron (Linux) or Task Scheduler (Windows)

# Linux cron:
0 9 * * * /usr/bin/python3 /path/to/license-expiry-checker.py

# Windows Task Scheduler:
schtasks /create /tn "DocuWorks License Check" /tr "python C:\scripts\license-expiry-checker.py" /sc daily /st 09:00
```

---

## Compliance and Audit

### License Usage Audit Report

```python
# scripts/license-usage-report.py

import boto3
from datetime import datetime, timedelta
import csv

def generate_license_usage_report(days: int = 30):
    """Generate license usage report for the last N days"""

    cloudwatch = boto3.client('cloudwatch')
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(days=days)

    # Get metrics
    response = cloudwatch.get_metric_statistics(
        Namespace='CIS/FileProcessor',
        MetricName='LicenseActiveInstances',
        StartTime=start_time,
        EndTime=end_time,
        Period=3600,  # 1 hour
        Statistics=['Average', 'Maximum']
    )

    # Write report
    report_file = f'license-usage-report-{datetime.now().strftime("%Y%m%d")}.csv'

    with open(report_file, 'w', newline='') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(['Timestamp', 'Average Usage', 'Peak Usage'])

        for datapoint in sorted(response['Datapoints'], key=lambda x: x['Timestamp']):
            writer.writerow([
                datapoint['Timestamp'].isoformat(),
                datapoint['Average'],
                datapoint['Maximum']
            ])

    print(f"Report generated: {report_file}")

if __name__ == '__main__':
    generate_license_usage_report()
```

---

## Summary

### Best Practices

1. **Secure Storage**
   - ライセンスキーはAWS Secrets Managerで管理
   - IAMロールベースのアクセス制御
   - 暗号化された保存

2. **Usage Enforcement**
   - License Managerでの同時実行制限
   - Singleton パターンでの一元管理
   - Graceful degradation (OCR fallback)

3. **Monitoring**
   - CloudWatch metrics での使用状況追跡
   - 有効期限アラート
   - 容量アラート

4. **Renewal Process**
   - 自動リマインダー
   - 簡単な更新プロセス
   - ダウンタイムなしの更新

### Cost Optimization

**Current Configuration (1 License):**
- License Cost: ~¥30,000-50,000/year (vendor pricing)
- Infrastructure: Minimal (single EC2 instance)
- Total Annual Cost: ~¥50,000-70,000

**Scaling Considerations:**
- Additional licenses: ~¥30,000-50,000/license/year
- Evaluate ROI based on throughput requirements
- Consider hybrid approach (SDK + OCR) for cost optimization

---

**Document Version:** 1.0
**Last Updated:** 2025-12-02
