#!/usr/bin/env python3
"""
CloudTrail AccessDenied Event Analyzer

Analyzes CloudTrail logs to identify AccessDenied events that indicate IAM permission issues.
This helps diagnose exactly which permissions are missing from the IAM role.

Key Analysis:
- AccessDenied events by service
- Denied actions (API calls)
- Resource ARNs that were denied
- Temporal patterns of access denials
- User/Role identity analysis

Usage:
    python3 analyze_cloudtrail_access_denied.py
    python3 analyze_cloudtrail_access_denied.py --hours 24
    python3 analyze_cloudtrail_access_denied.py --output report.json
    python3 analyze_cloudtrail_access_denied.py --identity-arn <ARN>

Security Considerations:
- Read-only CloudTrail analysis
- May require cloudtrail:LookupEvents permission
- Does not modify any resources
"""

import os
import sys
import json
import logging
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict, field

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


@dataclass
class AccessDeniedEvent:
    """Represents a single AccessDenied event from CloudTrail"""
    event_id: str
    event_time: str
    event_name: str
    event_source: str
    user_identity: Dict[str, Any]
    error_code: str
    error_message: str
    requested_region: str
    source_ip: str
    user_agent: str
    resources: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def service(self) -> str:
        """Extract service name from event source"""
        # e.g., 's3.amazonaws.com' -> 'S3'
        return self.event_source.split('.')[0].upper()

    @property
    def principal_arn(self) -> str:
        """Extract principal ARN from user identity"""
        identity = self.user_identity
        if 'arn' in identity:
            return identity['arn']
        elif 'principalId' in identity:
            return identity['principalId']
        return 'Unknown'

    @property
    def principal_type(self) -> str:
        """Get principal type (IAMUser, AssumedRole, etc.)"""
        return self.user_identity.get('type', 'Unknown')


@dataclass
class CloudTrailAnalysisReport:
    """Analysis report for CloudTrail AccessDenied events"""
    timestamp: str
    analysis_period_hours: int
    total_events: int

    # Event classification
    events_by_service: Dict[str, int] = field(default_factory=dict)
    events_by_action: Dict[str, int] = field(default_factory=dict)
    events_by_principal: Dict[str, int] = field(default_factory=dict)
    events_by_hour: Dict[int, int] = field(default_factory=dict)

    # Top denials
    top_denied_actions: List[Dict[str, Any]] = field(default_factory=list)
    top_affected_resources: List[Dict[str, Any]] = field(default_factory=list)

    # Missing permissions
    required_permissions: List[str] = field(default_factory=list)

    # Sample events
    sample_events: List[Dict[str, Any]] = field(default_factory=list)

    # Recommendations
    recommendations: List[str] = field(default_factory=list)


class CloudTrailAnalyzer:
    """
    Analyzes CloudTrail events for AccessDenied errors
    """

    def __init__(self, region: str = 'ap-northeast-1'):
        """
        Initialize CloudTrail analyzer

        Args:
            region: AWS region
        """
        self.region = region

        try:
            self.cloudtrail_client = boto3.client('cloudtrail', region_name=region)
            self.sts_client = boto3.client('sts', region_name=region)
        except (NoCredentialsError, Exception) as e:
            logger.error(f"Failed to initialize AWS clients: {e}")
            sys.exit(1)

        # Get caller identity
        try:
            identity = self.sts_client.get_caller_identity()
            self.caller_arn = identity['Arn']
            logger.info(f"Running as: {self.caller_arn}")
        except Exception as e:
            logger.error(f"Failed to get caller identity: {e}")
            sys.exit(1)

        self.events: List[AccessDeniedEvent] = []

    def fetch_access_denied_events(
        self,
        hours: int = 24,
        identity_arn: Optional[str] = None,
        max_events: int = 1000
    ) -> int:
        """
        Fetch AccessDenied events from CloudTrail

        Args:
            hours: Number of hours to look back
            identity_arn: Optional filter by specific IAM identity ARN
            max_events: Maximum number of events to fetch

        Returns:
            Number of events fetched
        """
        logger.info(f"Fetching AccessDenied events from last {hours} hours...")

        start_time = datetime.utcnow() - timedelta(hours=hours)
        end_time = datetime.utcnow()

        lookup_attributes = [
            {
                'AttributeKey': 'EventName',
                'AttributeValue': 'AccessDenied'
            }
        ]

        # Add identity filter if specified
        if identity_arn:
            lookup_attributes.append({
                'AttributeKey': 'Username',
                'AttributeValue': identity_arn
            })

        try:
            paginator = self.cloudtrail_client.get_paginator('lookup_events')

            page_iterator = paginator.paginate(
                LookupAttributes=lookup_attributes,
                StartTime=start_time,
                EndTime=end_time,
                MaxResults=50  # CloudTrail max per page
            )

            fetched = 0

            for page in page_iterator:
                for event in page.get('Events', []):
                    if fetched >= max_events:
                        break

                    # Parse CloudTrail event
                    event_dict = json.loads(event.get('CloudTrailEvent', '{}'))

                    # Check if this is actually an AccessDenied error
                    error_code = event_dict.get('errorCode')
                    if error_code not in ['AccessDenied', 'UnauthorizedOperation', 'AccessDeniedException']:
                        continue

                    access_denied_event = AccessDeniedEvent(
                        event_id=event.get('EventId', ''),
                        event_time=event.get('EventTime', '').isoformat() if event.get('EventTime') else '',
                        event_name=event.get('EventName', ''),
                        event_source=event_dict.get('eventSource', ''),
                        user_identity=event_dict.get('userIdentity', {}),
                        error_code=error_code,
                        error_message=event_dict.get('errorMessage', ''),
                        requested_region=event_dict.get('awsRegion', ''),
                        source_ip=event_dict.get('sourceIPAddress', ''),
                        user_agent=event_dict.get('userAgent', ''),
                        resources=event_dict.get('resources', [])
                    )

                    self.events.append(access_denied_event)
                    fetched += 1

                if fetched >= max_events:
                    break

            logger.info(f"Fetched {fetched} AccessDenied events")
            return fetched

        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'AccessDeniedException':
                logger.error("AccessDenied when querying CloudTrail. Need cloudtrail:LookupEvents permission.")
            else:
                logger.error(f"Error fetching CloudTrail events: {e}")
            return 0
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            return 0

    def analyze(self) -> CloudTrailAnalysisReport:
        """
        Analyze fetched AccessDenied events

        Returns:
            Analysis report
        """
        logger.info("Analyzing AccessDenied events...")

        report = CloudTrailAnalysisReport(
            timestamp=datetime.utcnow().isoformat(),
            analysis_period_hours=24,  # Will be updated by caller
            total_events=len(self.events)
        )

        if not self.events:
            logger.warning("No AccessDenied events found")
            return report

        # Counters
        events_by_service = Counter()
        events_by_action = Counter()
        events_by_principal = Counter()
        events_by_hour = Counter()
        resource_arns = Counter()
        required_permissions = set()

        for event in self.events:
            # Service distribution
            events_by_service[event.service] += 1

            # Action distribution
            action = f"{event.service}:{event.event_name}"
            events_by_action[action] += 1

            # Add to required permissions
            permission = self._event_to_permission(event.service, event.event_name)
            if permission:
                required_permissions.add(permission)

            # Principal distribution
            events_by_principal[event.principal_arn] += 1

            # Temporal analysis
            if event.event_time:
                try:
                    dt = datetime.fromisoformat(event.event_time.replace('Z', '+00:00'))
                    events_by_hour[dt.hour] += 1
                except Exception:
                    pass

            # Resource ARNs
            for resource in event.resources:
                arn = resource.get('ARN', resource.get('arn', ''))
                if arn:
                    resource_arns[arn] += 1

        # Populate report
        report.events_by_service = dict(events_by_service)
        report.events_by_action = dict(events_by_action)
        report.events_by_principal = dict(events_by_principal)
        report.events_by_hour = dict(events_by_hour)

        # Top denied actions
        report.top_denied_actions = [
            {'action': action, 'count': count}
            for action, count in events_by_action.most_common(20)
        ]

        # Top affected resources
        report.top_affected_resources = [
            {'resource_arn': arn, 'denial_count': count}
            for arn, count in resource_arns.most_common(10)
        ]

        # Required permissions
        report.required_permissions = sorted(required_permissions)

        # Sample events (first 5)
        report.sample_events = [
            {
                'event_id': event.event_id,
                'event_time': event.event_time,
                'service': event.service,
                'action': event.event_name,
                'principal': event.principal_arn,
                'error_message': event.error_message,
                'resources': event.resources
            }
            for event in self.events[:5]
        ]

        # Generate recommendations
        report.recommendations = self._generate_recommendations(report)

        return report

    def _event_to_permission(self, service: str, action: str) -> Optional[str]:
        """
        Convert CloudTrail event to IAM permission

        Args:
            service: Service name (e.g., 'S3', 'SQS')
            action: Action name (e.g., 'GetObject', 'ReceiveMessage')

        Returns:
            IAM permission string (e.g., 's3:GetObject')
        """
        service_lower = service.lower()

        # Special cases
        if service_lower == 'es':
            # OpenSearch/Elasticsearch uses special HTTP permissions
            if action.startswith('ESHttp'):
                return f"es:{action}"
            return f"es:{action}"

        return f"{service_lower}:{action}"

    def _generate_recommendations(self, report: CloudTrailAnalysisReport) -> List[str]:
        """
        Generate recommendations based on analysis

        Args:
            report: Analysis report

        Returns:
            List of recommendations
        """
        recommendations = []

        if not report.total_events:
            recommendations.append("✅ No AccessDenied events found. IAM permissions appear to be correct.")
            return recommendations

        # Missing permissions
        if report.required_permissions:
            recommendations.append(
                f"🔐 Add the following {len(report.required_permissions)} permissions to IAM policy:\n" +
                "\n".join([f"   - {perm}" for perm in report.required_permissions[:10]])
            )

        # Service-specific recommendations
        for service, count in sorted(report.events_by_service.items(), key=lambda x: x[1], reverse=True):
            if service == 'S3' and count > 5:
                recommendations.append(
                    f"📦 {count} S3 access denials. Ensure IAM role has s3:GetObject, s3:PutObject, "
                    f"s3:DeleteObject on bucket ARN and objects."
                )
            elif service == 'SQS' and count > 5:
                recommendations.append(
                    f"📨 {count} SQS access denials. Ensure sqs:ReceiveMessage, sqs:DeleteMessage, "
                    f"sqs:ChangeMessageVisibility permissions are granted."
                )
            elif service == 'ES' and count > 5:
                recommendations.append(
                    f"🔍 {count} OpenSearch access denials. Check es:ESHttpPost, es:ESHttpPut, es:ESHttpGet "
                    f"permissions and VPC endpoint security groups."
                )
            elif service == 'BEDROCK' and count > 5:
                recommendations.append(
                    f"🤖 {count} Bedrock access denials. Verify bedrock:InvokeModel permission and model availability."
                )

        # Resource-based policies
        if report.top_affected_resources:
            recommendations.append(
                "🔒 Check resource-based policies (S3 bucket policies, SQS queue policies) "
                "to ensure they allow access from worker IAM role."
            )

        # Temporal patterns
        if report.events_by_hour:
            peak_hour = max(report.events_by_hour.items(), key=lambda x: x[1])
            if peak_hour[1] > report.total_events * 0.3:
                recommendations.append(
                    f"⏰ Access denials peak at {peak_hour[0]:02d}:00 UTC ({peak_hour[1]} events). "
                    f"Investigate if this correlates with batch processing or specific workflows."
                )

        return recommendations

    def print_report(self, report: CloudTrailAnalysisReport):
        """
        Print human-readable report

        Args:
            report: Analysis report
        """
        print("\n" + "=" * 80)
        print("CLOUDTRAIL ACCESSDENIED ANALYSIS REPORT")
        print("=" * 80)

        print(f"\nAnalysis Time: {report.timestamp}")
        print(f"Period: Last {report.analysis_period_hours} hours")
        print(f"Total AccessDenied Events: {report.total_events}")

        if report.total_events == 0:
            print("\n✅ No AccessDenied events found. IAM permissions appear to be correct.")
            return

        # Events by service
        if report.events_by_service:
            print("\n" + "=" * 80)
            print("ACCESS DENIALS BY SERVICE")
            print("=" * 80)
            for service, count in sorted(report.events_by_service.items(), key=lambda x: x[1], reverse=True):
                percentage = (count / report.total_events) * 100
                print(f"  {service:20} {count:5} ({percentage:5.1f}%)")

        # Top denied actions
        if report.top_denied_actions:
            print("\n" + "=" * 80)
            print("TOP DENIED ACTIONS")
            print("=" * 80)
            for i, action_info in enumerate(report.top_denied_actions[:15], 1):
                print(f"  {i:2}. {action_info['action']:50} {action_info['count']:5}")

        # Required permissions
        if report.required_permissions:
            print("\n" + "=" * 80)
            print(f"REQUIRED PERMISSIONS ({len(report.required_permissions)})")
            print("=" * 80)
            print("\nAdd these to IAM policy:\n")
            print("```json")
            print("{")
            print('  "Version": "2012-10-17",')
            print('  "Statement": [')
            print('    {')
            print('      "Effect": "Allow",')
            print('      "Action": [')
            for i, perm in enumerate(report.required_permissions):
                comma = "," if i < len(report.required_permissions) - 1 else ""
                print(f'        "{perm}"{comma}')
            print('      ],')
            print('      "Resource": "*"  # Replace with specific resource ARNs')
            print('    }')
            print('  ]')
            print('}')
            print("```")

        # Events by principal
        if report.events_by_principal:
            print("\n" + "=" * 80)
            print("ACCESS DENIALS BY PRINCIPAL")
            print("=" * 80)
            for principal, count in sorted(report.events_by_principal.items(), key=lambda x: x[1], reverse=True)[:5]:
                print(f"  {principal}")
                print(f"    Denials: {count}")

        # Temporal analysis
        if report.events_by_hour:
            print("\n" + "=" * 80)
            print("ACCESS DENIALS BY HOUR (UTC)")
            print("=" * 80)
            max_count = max(report.events_by_hour.values())
            for hour in sorted(report.events_by_hour.keys()):
                count = report.events_by_hour[hour]
                bar = "█" * (count * 50 // max(1, max_count))
                print(f"  {hour:02d}:00 {count:5} {bar}")

        # Top affected resources
        if report.top_affected_resources:
            print("\n" + "=" * 80)
            print("TOP AFFECTED RESOURCES")
            print("=" * 80)
            for i, resource in enumerate(report.top_affected_resources, 1):
                print(f"\n{i}. {resource['resource_arn']}")
                print(f"   Denials: {resource['denial_count']}")

        # Sample events
        if report.sample_events:
            print("\n" + "=" * 80)
            print("SAMPLE EVENTS (First 3)")
            print("=" * 80)
            for i, event in enumerate(report.sample_events[:3], 1):
                print(f"\n{i}. Event ID: {event['event_id']}")
                print(f"   Time: {event['event_time']}")
                print(f"   Service: {event['service']}")
                print(f"   Action: {event['action']}")
                print(f"   Principal: {event['principal']}")
                print(f"   Error: {event['error_message']}")

        # Recommendations
        if report.recommendations:
            print("\n" + "=" * 80)
            print("RECOMMENDATIONS")
            print("=" * 80)
            for i, rec in enumerate(report.recommendations, 1):
                print(f"\n{i}. {rec}")

        print("\n" + "=" * 80)


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Analyze CloudTrail AccessDenied events',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        '--region',
        default=os.environ.get('AWS_REGION', 'ap-northeast-1'),
        help='AWS region'
    )

    parser.add_argument(
        '--hours',
        type=int,
        default=24,
        help='Hours to look back (default: 24)'
    )

    parser.add_argument(
        '--identity-arn',
        help='Filter by specific IAM identity ARN'
    )

    parser.add_argument(
        '--max-events',
        type=int,
        default=1000,
        help='Maximum events to fetch (default: 1000)'
    )

    parser.add_argument(
        '--output-json',
        metavar='FILE',
        help='Save report to JSON file'
    )

    args = parser.parse_args()

    # Create analyzer
    analyzer = CloudTrailAnalyzer(region=args.region)

    # Fetch events
    count = analyzer.fetch_access_denied_events(
        hours=args.hours,
        identity_arn=args.identity_arn,
        max_events=args.max_events
    )

    # Analyze events
    report = analyzer.analyze()
    report.analysis_period_hours = args.hours

    # Save JSON report if requested
    if args.output_json:
        with open(args.output_json, 'w') as f:
            json.dump(asdict(report), f, indent=2)
        logger.info(f"Report saved to: {args.output_json}")

    # Print report
    analyzer.print_report(report)

    # Exit with appropriate code
    if report.total_events > 0:
        sys.exit(1)  # Exit with error if AccessDenied events found
    else:
        sys.exit(0)


if __name__ == '__main__':
    main()
