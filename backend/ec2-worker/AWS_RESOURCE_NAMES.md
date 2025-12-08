# AWS Resource Names - Quick Reference

## 実際のリソース名一覧

このドキュメントは、AWS Consoleで作成された実際のリソース名を記録しています。

### Region
```
ap-northeast-1 (東京リージョン)
```

### OpenSearch
| リソース種別 | 名前 |
|------------|------|
| Domain | `cis-filesearch-opensearch` |
| Instance Type | `t3.small.search` |
| Volume Size | 100 GB |
| Volume Type | gp3 |

### S3 Buckets
| 用途 | バケット名 |
|-----|----------|
| Landing Zone (アップロード先) | `cis-filesearch-s3-landing` |
| Thumbnails (サムネイル) | `cis-filesearch-s3-thumbnail` |

### SQS Queues
| 用途 | キュー名 |
|-----|---------|
| File Processing Queue | `cis-filesearch-index-queue` |
| Dead Letter Queue (DLQ) | `cis-filesearch-dlq` |

### IAM Roles
| 用途 | ロール名 |
|-----|---------|
| EC2 Worker Role | `cis-filesearch-worker-role` |

### Auto Scaling Group
| リソース | 名前 |
|---------|------|
| ASG Name | `cis-file-processor-asg` |
| Min Size | 0 |
| Max Size | 10 |

### EventBridge
| リソース | 説明 |
|---------|------|
| Rules | S3イベントをSQSにルーティング |
| Target | `cis-filesearch-index-queue` |

## 命名規則

プロジェクトでは以下の命名規則を使用しています:

```
cis-filesearch-{service}-{purpose}
```

### 例:
- `cis-filesearch-opensearch` (OpenSearchドメイン)
- `cis-filesearch-s3-landing` (S3ランディングバケット)
- `cis-filesearch-index-queue` (SQSインデックスキュー)
- `cis-filesearch-worker-role` (IAMワーカーロール)

## 環境変数設定

検証スクリプトを実行する際に必要な環境変数:

```bash
# リージョン設定
export AWS_REGION=ap-northeast-1

# プロファイル設定 (オプション)
export AWS_PROFILE=your-profile-name

# または、AWS CLIの認証情報を設定
aws configure
```

## 関連スクリプト

- `/backend/ec2-worker/verify_aws_config.py` - AWS設定検証スクリプト
- 実行方法: `python3 verify_aws_config.py`

## 更新履歴

- 2025-01-18: 初版作成 - 実際のAWSリソース名を記録
