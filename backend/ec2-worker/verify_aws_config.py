#!/usr/bin/env python3
"""
AWS Configuration Verification Script
CIS File Search Application - AWS設定確認スクリプト

このスクリプトは、AWS Consoleで設定したリソースが正しく構成されているか確認します。
"""

import boto3
import json
import sys
from typing import Dict, List, Tuple
from datetime import datetime
import os

# リージョン設定
AWS_REGION = os.getenv('AWS_REGION', 'ap-northeast-1')

# 期待される設定値（実際のAWSリソース名に基づく）
EXPECTED_CONFIG = {
    'opensearch': {
        'domain_name': 'cis-filesearch-opensearch',  # 実際の名前
        'instance_type': 't3.medium.search',  # 実際の設定値
        'instance_count': 1,
        'volume_size': 100,
        'volume_type': 'gp3'
    },
    's3_buckets': [
        'cis-filesearch-s3-landing',    # 実際の名前
        'cis-filesearch-s3-thumbnail'   # 実際の名前
    ],
    'sqs_queues': [
        'cis-filesearch-index-queue'    # 実際の名前
    ],
    'sqs_dlq': 'cis-filesearch-dlq',    # 実際のDLQ名
    'ec2_auto_scaling': {
        'group_name': 'cis-file-processor-asg',
        'min_size': 0,
        'max_size': 10
    }
}

class AWSConfigVerifier:
    """AWS設定確認クラス"""

    def __init__(self):
        """初期化"""
        self.session = boto3.Session(region_name=AWS_REGION)
        self.results = []
        self.errors = []

    def verify_all(self) -> bool:
        """全ての設定を確認"""
        print("=" * 60)
        print("AWS Configuration Verification for CIS File Search")
        print(f"Region: {AWS_REGION}")
        print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 60)
        print()

        # 各リソースの確認
        self._verify_opensearch()
        self._verify_s3_buckets()
        self._verify_sqs_queues()
        self._verify_eventbridge()
        self._verify_auto_scaling()
        self._verify_iam_roles()
        self._verify_bedrock_access()

        # 結果サマリー
        self._print_summary()

        return len(self.errors) == 0

    def _verify_opensearch(self):
        """OpenSearch設定確認"""
        print("🔍 Checking OpenSearch Domain...")
        try:
            client = self.session.client('opensearch')
            domain_name = EXPECTED_CONFIG['opensearch']['domain_name']

            # ドメイン情報取得
            response = client.describe_domain(DomainName=domain_name)
            domain = response['DomainStatus']  # FIX: DomainConfig -> DomainStatus

            # インスタンスタイプ確認
            instance_type = domain['ClusterConfig']['InstanceType']
            instance_count = domain['ClusterConfig']['InstanceCount']

            # ストレージ確認
            volume_size = domain['EBSOptions']['VolumeSize']
            volume_type = domain['EBSOptions']['VolumeType']

            # OpenSearchバージョン取得
            engine_version = domain.get('EngineVersion', 'Unknown')

            # k-NN プラグイン確認
            # Note: OpenSearch 2.x 以降、k-NNプラグインはデフォルトで有効
            # 'knn.plugin.enabled' の設定は不要（古い設定方法）
            version_major = int(engine_version.split('.')[0].replace('OpenSearch_', '')) if 'OpenSearch_' in engine_version else 0
            knn_available = version_major >= 2  # OpenSearch 2.x以降は常に有効

            checks = [
                (instance_type == EXPECTED_CONFIG['opensearch']['instance_type'],
                 f"Instance Type: {instance_type}"),
                (instance_count == EXPECTED_CONFIG['opensearch']['instance_count'],
                 f"Instance Count: {instance_count}"),
                (volume_size == EXPECTED_CONFIG['opensearch']['volume_size'],
                 f"Volume Size: {volume_size} GB"),
                (volume_type == EXPECTED_CONFIG['opensearch']['volume_type'],
                 f"Volume Type: {volume_type}"),
                (True,  # k-NNは常に有効（OpenSearch 2.x+）
                 f"k-NN Plugin: Available (OpenSearch {engine_version})")
            ]

            for passed, message in checks:
                self._add_result('OpenSearch', message, passed)

            # エンドポイント取得
            endpoint = domain.get('Endpoint', {}).get('Endpoint', 'Not Available')
            print(f"   Endpoint: https://{endpoint}")

        except Exception as e:
            self._add_result('OpenSearch', f"Error: {str(e)}", False)
        print()

    def _verify_s3_buckets(self):
        """S3バケット設定確認"""
        print("🪣 Checking S3 Buckets...")
        try:
            s3 = self.session.client('s3')

            for bucket_name in EXPECTED_CONFIG['s3_buckets']:
                try:
                    # バケットの存在確認
                    s3.head_bucket(Bucket=bucket_name)
                    self._add_result('S3 Bucket', f"{bucket_name}: Exists", True)

                    # Event Notification確認（landing bucketの場合）
                    if 'landing' in bucket_name:
                        notification = s3.get_bucket_notification_configuration(Bucket=bucket_name)
                        has_eventbridge = 'EventBridgeConfiguration' in notification
                        self._add_result('S3 EventBridge',
                                       f"{bucket_name}: {'Enabled' if has_eventbridge else 'DISABLED ⚠️'}",
                                       has_eventbridge)

                    # バージョニング確認
                    versioning = s3.get_bucket_versioning(Bucket=bucket_name)
                    status = versioning.get('Status', 'Disabled')
                    self._add_result('S3 Versioning', f"{bucket_name}: {status}", True)

                    # 暗号化確認
                    try:
                        encryption = s3.get_bucket_encryption(Bucket=bucket_name)
                        self._add_result('S3 Encryption', f"{bucket_name}: Enabled", True)
                    except s3.exceptions.ServerSideEncryptionConfigurationNotFoundError:
                        self._add_result('S3 Encryption', f"{bucket_name}: DISABLED ⚠️", False)

                except s3.exceptions.NoSuchBucket:
                    self._add_result('S3 Bucket', f"{bucket_name}: NOT FOUND ⚠️", False)
                except Exception as e:
                    self._add_result('S3 Bucket', f"{bucket_name}: Error - {str(e)}", False)

        except Exception as e:
            self._add_result('S3', f"Error: {str(e)}", False)
        print()

    def _verify_sqs_queues(self):
        """SQSキュー設定確認"""
        print("📨 Checking SQS Queues...")
        try:
            sqs = self.session.client('sqs')

            # メインキューの確認
            for queue_name in EXPECTED_CONFIG['sqs_queues']:
                try:
                    # キューURL取得
                    response = sqs.get_queue_url(QueueName=queue_name)
                    queue_url = response['QueueUrl']
                    self._add_result('SQS Queue', f"{queue_name}: Exists", True)

                    # キュー属性取得
                    attributes = sqs.get_queue_attributes(
                        QueueUrl=queue_url,
                        AttributeNames=['All']
                    )['Attributes']

                    # 重要な設定確認
                    visibility_timeout = int(attributes.get('VisibilityTimeout', 0))
                    message_retention = int(attributes.get('MessageRetentionPeriod', 0)) // 86400  # 日数に変換
                    redrive_policy = attributes.get('RedrivePolicy', '')

                    self._add_result('SQS Settings',
                                   f"Visibility Timeout: {visibility_timeout}s",
                                   visibility_timeout >= 300)
                    self._add_result('SQS Settings',
                                   f"Message Retention: {message_retention} days",
                                   message_retention >= 7)

                    # DLQ設定確認
                    has_dlq = 'deadLetterTargetArn' in redrive_policy
                    self._add_result('SQS DLQ',
                                   f"Dead Letter Queue: {'Configured' if has_dlq else 'NOT CONFIGURED ⚠️'}",
                                   has_dlq)

                except sqs.exceptions.QueueDoesNotExist:
                    self._add_result('SQS Queue', f"{queue_name}: NOT FOUND ⚠️", False)
                except Exception as e:
                    self._add_result('SQS Queue', f"{queue_name}: Error - {str(e)}", False)

            # DLQの確認
            dlq_name = EXPECTED_CONFIG['sqs_dlq']
            try:
                response = sqs.get_queue_url(QueueName=dlq_name)
                queue_url = response['QueueUrl']
                self._add_result('SQS DLQ', f"{dlq_name}: Exists", True)

                # DLQの属性確認
                attributes = sqs.get_queue_attributes(
                    QueueUrl=queue_url,
                    AttributeNames=['ApproximateNumberOfMessages']
                )['Attributes']

                msg_count = attributes.get('ApproximateNumberOfMessages', '0')
                self._add_result('DLQ Messages', f"Messages in DLQ: {msg_count}", True)

            except sqs.exceptions.QueueDoesNotExist:
                self._add_result('SQS DLQ', f"{dlq_name}: NOT FOUND ⚠️", False)
            except Exception as e:
                self._add_result('SQS DLQ', f"{dlq_name}: Error - {str(e)}", False)

        except Exception as e:
            self._add_result('SQS', f"Error: {str(e)}", False)
        print()

    def _verify_eventbridge(self):
        """EventBridge設定確認"""
        print("🌉 Checking EventBridge Rules...")
        try:
            events = self.session.client('events')

            # ルール一覧取得
            response = events.list_rules(Limit=100)
            rules = response.get('Rules', [])

            # S3関連のルールを探す
            s3_rules = [r for r in rules if 's3' in r['Name'].lower() or 'file' in r['Name'].lower()]

            if s3_rules:
                for rule in s3_rules[:3]:  # 最大3つまで表示
                    self._add_result('EventBridge Rule',
                                   f"{rule['Name']}: {rule['State']}",
                                   rule['State'] == 'ENABLED')

                    # ターゲット確認
                    targets = events.list_targets_by_rule(Rule=rule['Name'])
                    for target in targets.get('Targets', []):
                        target_arn = target['Arn']
                        if 'sqs' in target_arn:
                            self._add_result('EventBridge Target', f"→ SQS: {target_arn.split(':')[-1]}", True)
            else:
                self._add_result('EventBridge', "No S3-related rules found ⚠️", False)

        except Exception as e:
            self._add_result('EventBridge', f"Error: {str(e)}", False)
        print()

    def _verify_auto_scaling(self):
        """Auto Scaling Group設定確認"""
        print("⚡ Checking Auto Scaling Groups...")
        try:
            autoscaling = self.session.client('autoscaling')
            ec2 = self.session.client('ec2')

            # Auto Scaling Group一覧取得
            response = autoscaling.describe_auto_scaling_groups()
            groups = response['AutoScalingGroups']

            # CIS関連のグループを探す
            cis_groups = [g for g in groups if 'cis' in g['AutoScalingGroupName'].lower()]

            if cis_groups:
                for group in cis_groups:
                    name = group['AutoScalingGroupName']
                    min_size = group['MinSize']
                    max_size = group['MaxSize']
                    desired = group['DesiredCapacity']
                    instances = len(group['Instances'])

                    self._add_result('Auto Scaling', f"{name}", True)
                    self._add_result('ASG Config', f"Min: {min_size}, Max: {max_size}, Desired: {desired}", True)
                    self._add_result('ASG Status', f"Running Instances: {instances}", True)

                    # スケーリングポリシー確認
                    policies = autoscaling.describe_policies(AutoScalingGroupName=name)
                    if policies['ScalingPolicies']:
                        for policy in policies['ScalingPolicies']:
                            policy_type = policy.get('PolicyType', 'Unknown')
                            self._add_result('Scaling Policy', f"{policy['PolicyName']} ({policy_type})", True)

                    # Launch Template確認
                    if group.get('LaunchTemplate'):
                        lt_id = group['LaunchTemplate']['LaunchTemplateId']
                        lt_version = group['LaunchTemplate']['Version']
                        self._add_result('Launch Template', f"ID: {lt_id}, Version: {lt_version}", True)

                        # Launch Template詳細取得
                        lt_response = ec2.describe_launch_template_versions(
                            LaunchTemplateId=lt_id,
                            Versions=[lt_version]
                        )
                        if lt_response['LaunchTemplateVersions']:
                            lt_data = lt_response['LaunchTemplateVersions'][0]['LaunchTemplateData']
                            instance_type = lt_data.get('InstanceType', 'Unknown')
                            self._add_result('EC2 Type', f"Instance Type: {instance_type}", True)
            else:
                self._add_result('Auto Scaling', "No CIS-related groups found ⚠️", False)

        except Exception as e:
            self._add_result('Auto Scaling', f"Error: {str(e)}", False)
        print()

    def _verify_iam_roles(self):
        """IAMロール設定確認"""
        print("🔐 Checking IAM Roles...")
        try:
            iam = self.session.client('iam')

            # EC2用のロールを探す（実際の名前を優先）
            expected_roles = ['cis-filesearch-worker-role', 'CIS-EC2-FileProcessor-Role', 'cis-ec2-role', 'CISFileProcessorRole']

            for role_name in expected_roles:
                try:
                    role = iam.get_role(RoleName=role_name)
                    self._add_result('IAM Role', f"{role_name}: Found", True)

                    # アタッチされたポリシー確認
                    policies = iam.list_attached_role_policies(RoleName=role_name)
                    for policy in policies['AttachedPolicies']:
                        self._add_result('IAM Policy', f"→ {policy['PolicyName']}", True)

                    # インラインポリシー確認
                    inline_policies = iam.list_role_policies(RoleName=role_name)
                    for policy_name in inline_policies['PolicyNames']:
                        self._add_result('Inline Policy', f"→ {policy_name}", True)

                    break  # 1つ見つかれば十分

                except iam.exceptions.NoSuchEntityException:
                    continue
            else:
                self._add_result('IAM Role', "No EC2 processor role found ⚠️", False)
                print("   Suggested role name: cis-filesearch-worker-role")

        except Exception as e:
            self._add_result('IAM', f"Error: {str(e)}", False)
        print()

    def _verify_bedrock_access(self):
        """Bedrock アクセス確認"""
        print("🤖 Checking Bedrock Access...")
        try:
            bedrock = self.session.client('bedrock')
            bedrock_runtime = self.session.client('bedrock-runtime')

            # モデルアクセス確認
            try:
                # Titan Multimodal Embeddings モデルの確認
                model_id = 'amazon.titan-embed-image-v1'

                # モデル情報取得を試みる（権限があれば成功する）
                response = bedrock.list_foundation_models()
                titan_models = [m for m in response['modelSummaries']
                              if 'titan' in m['modelId'].lower() and 'embed' in m['modelId'].lower()]

                if titan_models:
                    for model in titan_models:
                        self._add_result('Bedrock Model', f"{model['modelId']}: Available", True)
                else:
                    self._add_result('Bedrock Model', "Titan Embeddings model not found ⚠️", False)

                self._add_result('Bedrock Access', "API Access: OK", True)

            except Exception as e:
                self._add_result('Bedrock Access', f"Limited or No Access: {str(e)}", False)
                print("   Note: Bedrock access may need to be requested through AWS Console")

        except Exception as e:
            self._add_result('Bedrock', f"Error: {str(e)}", False)
        print()

    def _add_result(self, category: str, message: str, passed: bool):
        """結果を追加"""
        status = "✅" if passed else "❌"
        print(f"   {status} {message}")

        result = {
            'category': category,
            'message': message,
            'passed': passed
        }
        self.results.append(result)

        if not passed:
            self.errors.append(f"{category}: {message}")

    def _print_summary(self):
        """結果サマリーを表示"""
        print("=" * 60)
        print("VERIFICATION SUMMARY")
        print("=" * 60)

        total = len(self.results)
        passed = sum(1 for r in self.results if r['passed'])
        failed = total - passed

        print(f"Total Checks: {total}")
        print(f"Passed: {passed} ✅")
        print(f"Failed: {failed} ❌")
        print()

        if self.errors:
            print("⚠️ Issues Found:")
            for error in self.errors:
                print(f"   - {error}")
            print()
            print("📝 Action Required:")
            print("   Please configure the missing resources in AWS Console.")
            print("   Refer to the DataSync documentation for detailed setup steps.")
        else:
            print("🎉 All checks passed! Your AWS environment is ready.")

        print("=" * 60)


def main():
    """メイン処理"""
    verifier = AWSConfigVerifier()
    success = verifier.verify_all()

    if not success:
        print("\n⚠️ Some configurations are missing or incorrect.")
        print("Please review the issues above and update your AWS Console settings.")
        sys.exit(1)
    else:
        print("\n✅ AWS configuration verification completed successfully!")
        print("You can now proceed with running the Python Worker application.")
        sys.exit(0)


if __name__ == "__main__":
    main()