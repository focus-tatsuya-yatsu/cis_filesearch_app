# AMI構成ベストプラクティス - Python Worker

## 概要

このドキュメントは、python-workerをEC2 Auto Scalingで運用するためのAMI構成ベストプラクティスを提供します。

## 目次

1. [AMI構成戦略](#ami構成戦略)
2. [AMI作成チェックリスト](#ami作成チェックリスト)
3. [AMI作成スクリプト](#ami作成スクリプト)
4. [Launch Template設計](#launch-template設計)
5. [Auto Scaling Policy](#auto-scaling-policy)
6. [デプロイパイプライン](#デプロイパイプライン)
7. [トラブルシューティング](#トラブルシューティング)

---

## AMI構成戦略

### 設計原則

**イミュータブル・インフラストラクチャ**を採用：
- AMIには**アプリケーションコードと依存関係を含める**
- **環境変数や動的設定はUser Dataで注入**
- AMI更新時は新しいバージョンを作成（ローリングアップデート）

### レイヤー分離

```
┌─────────────────────────────────────┐
│  Layer 4: Runtime Configuration     │  ← User Data (起動時)
│  - 環境変数                          │
│  - SQS_QUEUE_URL                     │
│  - OpenSearch接続情報                │
├─────────────────────────────────────┤
│  Layer 3: Application Code          │  ← AMI
│  - python-workerコード                │
│  - 設定ファイル(テンプレート)          │
├─────────────────────────────────────┤
│  Layer 2: Dependencies              │  ← AMI
│  - Python 3.11                       │
│  - pip packages (requirements.txt)   │
│  - Tesseract, Poppler, ImageMagick   │
├─────────────────────────────────────┤
│  Layer 1: Base OS                   │  ← AMI
│  - Amazon Linux 2023                 │
│  - CloudWatch Agent                  │
│  - 基本セキュリティ設定               │
└─────────────────────────────────────┘
```

---

## AMI作成チェックリスト

### ✅ AMIに含めるべきもの

#### 1. オペレーティングシステム
- [ ] Amazon Linux 2023 (最新パッチ適用済み)
- [ ] SSM Agent (プリインストール)
- [ ] CloudWatch Agent (設定済み)

#### 2. Python環境
- [ ] Python 3.11 (固定バージョン)
- [ ] pip (最新版)
- [ ] virtualenv (任意)

#### 3. システム依存関係
- [ ] Tesseract OCR (4.1.1+)
  - [ ] 日本語言語パック (jpn.traineddata)
  - [ ] 英語言語パック (eng.traineddata)
- [ ] Poppler-utils (pdf2image用)
- [ ] ImageMagick (画像処理用)
- [ ] libmagic (ファイルタイプ検出用)

#### 4. Python依存関係
- [ ] requirements.txt からすべてインストール済み
- [ ] バージョン固定 (pip freeze で確認)

#### 5. アプリケーションコード
- [ ] `/app/` ディレクトリに全ファイルコピー済み
- [ ] ファイル所有権: `appuser:appuser`
- [ ] 実行権限: `worker.py` に実行権限付与

#### 6. 設定ファイル (テンプレート)
- [ ] `config.py` (環境変数読み取り可能)
- [ ] ログ設定 (CloudWatch連携)
- [ ] systemdサービスファイル

#### 7. ディレクトリ構造
- [ ] `/app/` - アプリケーションディレクトリ
- [ ] `/tmp/file-processor/` - 一時ファイルディレクトリ (自動作成)
- [ ] `/var/log/file-processor/` - ログディレクトリ
- [ ] `/usr/local/share/tessdata/` - Tesseractデータ

#### 8. 監視・ログ
- [ ] CloudWatch Agentインストール済み
- [ ] CloudWatch Logs設定 (`/opt/aws/amazon-cloudwatch-agent/etc/`)
- [ ] メトリクス収集設定

#### 9. セキュリティ設定
- [ ] 非rootユーザー (`appuser`) 作成済み
- [ ] SSH強化設定 (PasswordAuthentication: no)
- [ ] 不要なサービス無効化

#### 10. 起動スクリプト
- [ ] `/usr/local/bin/start-worker.sh` (起動スクリプト)
- [ ] systemdサービス定義 (`file-processor-worker.service`)

### ❌ AMIに含めるべきでないもの

#### 1. セキュリティ情報
- [ ] AWSクレデンシャル (IAMロール使用)
- [ ] 環境変数の実際の値 (SQS_QUEUE_URL等)
- [ ] OpenSearchパスワード
- [ ] プライベートキー

#### 2. 一時データ
- [ ] `/tmp/` 配下の一時ファイル
- [ ] ログファイル (`/var/log/`)
- [ ] キャッシュファイル
- [ ] `.pyc` ファイル (削除推奨)

#### 3. インスタンス固有データ
- [ ] ホスト名
- [ ] IPアドレス
- [ ] SSH Host Keys (起動時に再生成)

#### 4. 開発ツール
- [ ] git
- [ ] テストツール (pytest等)
- [ ] 開発用エディタ

### 🚀 User Dataで設定すべきもの

#### 1. 環境変数
```bash
export AWS_REGION="ap-northeast-1"
export S3_BUCKET="cis-filesearch-storage"
export SQS_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/123456789012/file-processing-queue"
export OPENSEARCH_ENDPOINT="https://search-xxx.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="file-index"
export LOG_LEVEL="INFO"
```

#### 2. 動的設定
- Auto Scalingグループ名
- インスタンスID
- Availability Zone

#### 3. 起動時処理
- CloudWatch Agentの起動
- ヘルスチェックエンドポイントの有効化
- Worker起動

---

## AMI作成スクリプト

### 1. AMIビルドスクリプト

```bash
#!/bin/bash
# scripts/build-ami.sh
# AMI作成前の準備スクリプト

set -euo pipefail

echo "==================================="
echo "AMI Build Preparation Script"
echo "==================================="

# 変数定義
APP_DIR="/app"
APP_USER="appuser"
PYTHON_VERSION="3.11"

# 1. OSアップデート
echo "[1/10] Updating OS packages..."
sudo dnf update -y

# 2. システム依存関係のインストール
echo "[2/10] Installing system dependencies..."
sudo dnf install -y \
    python${PYTHON_VERSION} \
    python${PYTHON_VERSION}-pip \
    poppler-utils \
    ImageMagick \
    ImageMagick-devel \
    file-devel \
    wget \
    tar \
    htop \
    jq

# 3. Tesseract OCRのインストール
echo "[3/10] Installing Tesseract OCR..."
bash scripts/install-tesseract-al2023.sh

# 4. CloudWatch Agentのインストール
echo "[4/10] Installing CloudWatch Agent..."
wget -q https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
sudo rpm -U ./amazon-cloudwatch-agent.rpm
rm amazon-cloudwatch-agent.rpm

# 5. アプリケーションユーザーの作成
echo "[5/10] Creating application user..."
if ! id -u $APP_USER > /dev/null 2>&1; then
    sudo useradd -m -u 1000 -s /bin/bash $APP_USER
fi

# 6. ディレクトリ構造の作成
echo "[6/10] Creating directory structure..."
sudo mkdir -p $APP_DIR
sudo mkdir -p /var/log/file-processor
sudo mkdir -p /tmp/file-processor
sudo chown -R $APP_USER:$APP_USER $APP_DIR /var/log/file-processor /tmp/file-processor

# 7. Python依存関係のインストール
echo "[7/10] Installing Python dependencies..."
sudo pip${PYTHON_VERSION} install --upgrade pip
sudo pip${PYTHON_VERSION} install --no-cache-dir -r requirements.txt

# 8. アプリケーションコードのコピー
echo "[8/10] Copying application code..."
sudo cp -r . $APP_DIR/
sudo chown -R $APP_USER:$APP_USER $APP_DIR
sudo chmod +x $APP_DIR/worker.py

# 9. systemdサービスの設定
echo "[9/10] Configuring systemd service..."
sudo cp scripts/file-processor-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable file-processor-worker.service

# 10. CloudWatch Agent設定
echo "[10/10] Configuring CloudWatch Agent..."
sudo cp scripts/cloudwatch-agent-config.json /opt/aws/amazon-cloudwatch-agent/etc/
sudo systemctl enable amazon-cloudwatch-agent

echo "==================================="
echo "AMI Build Preparation Complete!"
echo "==================================="
echo ""
echo "Next steps:"
echo "1. Review configuration"
echo "2. Run: sudo bash scripts/ami-cleanup.sh"
echo "3. Create AMI from EC2 console or AWS CLI"
```

### 2. AMIクリーンアップスクリプト

```bash
#!/bin/bash
# scripts/ami-cleanup.sh
# AMI作成前のクリーンアップスクリプト

set -euo pipefail

echo "==================================="
echo "AMI Cleanup Script"
echo "==================================="

# 1. 一時ファイルの削除
echo "[1/8] Removing temporary files..."
sudo rm -rf /tmp/*
sudo rm -rf /var/tmp/*
sudo rm -rf /tmp/file-processor/*

# 2. ログファイルの削除
echo "[2/8] Clearing log files..."
sudo find /var/log -type f -name "*.log" -exec truncate -s 0 {} \;
sudo rm -rf /var/log/file-processor/*

# 3. Pythonキャッシュの削除
echo "[3/8] Removing Python cache..."
sudo find /app -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
sudo find /app -type f -name "*.pyc" -delete 2>/dev/null || true
sudo find /app -type f -name "*.pyo" -delete 2>/dev/null || true

# 4. コマンド履歴の削除
echo "[4/8] Clearing command history..."
sudo rm -f /root/.bash_history
rm -f /home/ec2-user/.bash_history
rm -f /home/appuser/.bash_history

# 5. SSH Host Keysの削除 (起動時に再生成)
echo "[5/8] Removing SSH host keys..."
sudo rm -f /etc/ssh/ssh_host_*

# 6. クラウドinitログの削除
echo "[6/8] Clearing cloud-init logs..."
sudo rm -rf /var/lib/cloud/instances/*
sudo rm -rf /var/log/cloud-init*.log

# 7. パッケージキャッシュの削除
echo "[7/8] Cleaning package cache..."
sudo dnf clean all

# 8. 環境変数の削除確認
echo "[8/8] Checking for sensitive environment variables..."
if env | grep -E "(SQS_QUEUE_URL|OPENSEARCH|AWS_ACCESS_KEY)" > /dev/null; then
    echo "⚠️  WARNING: Sensitive environment variables detected!"
    env | grep -E "(SQS_QUEUE_URL|OPENSEARCH|AWS_ACCESS_KEY)"
    echo "Please unset these variables before creating AMI."
    exit 1
fi

echo "==================================="
echo "AMI Cleanup Complete!"
echo "==================================="
echo ""
echo "✅ Ready to create AMI"
echo ""
echo "Create AMI using AWS CLI:"
echo "aws ec2 create-image \\"
echo "  --instance-id i-xxxxxxxxx \\"
echo "  --name \"python-worker-v$(date +%Y%m%d-%H%M%S)\" \\"
echo "  --description \"Python Worker for File Processing\" \\"
echo "  --no-reboot"
```

### 3. User Data起動スクリプト

```bash
#!/bin/bash
# scripts/user-data.sh
# EC2起動時に実行されるUser Dataスクリプト

set -euo pipefail

# ログファイル
exec > >(tee -a /var/log/user-data.log)
exec 2>&1

echo "==================================="
echo "User Data Execution Started"
echo "Date: $(date)"
echo "==================================="

# 1. 環境変数の設定
echo "[1/6] Setting environment variables..."
cat << 'EOF' > /etc/profile.d/file-processor.sh
export AWS_REGION="ap-northeast-1"
export S3_BUCKET="cis-filesearch-storage"
export SQS_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/123456789012/file-processing-queue"
export OPENSEARCH_ENDPOINT="https://search-xxx.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="file-index"
export LOG_LEVEL="INFO"
export TEMP_DIR="/tmp/file-processor"
export MAX_FILE_SIZE_MB="100"
export MAX_WORKERS="4"
export PROCESSING_TIMEOUT="300"
EOF

chmod +x /etc/profile.d/file-processor.sh
source /etc/profile.d/file-processor.sh

# 2. インスタンスメタデータの取得
echo "[2/6] Retrieving instance metadata..."
INSTANCE_ID=$(ec2-metadata --instance-id | cut -d " " -f 2)
AZ=$(ec2-metadata --availability-zone | cut -d " " -f 2)
REGION=$(ec2-metadata --availability-zone | cut -d " " -f 2 | sed 's/[a-z]$//')

echo "Instance ID: $INSTANCE_ID"
echo "Availability Zone: $AZ"
echo "Region: $REGION"

# 3. CloudWatch Agentの起動
echo "[3/6] Starting CloudWatch Agent..."
# CloudWatch Agent設定を動的に生成
cat << EOF > /opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/file-processor.log",
            "log_group_name": "/aws/ec2/file-processor",
            "log_stream_name": "${INSTANCE_ID}",
            "timezone": "Local"
          },
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "/aws/ec2/file-processor",
            "log_stream_name": "${INSTANCE_ID}-userdata",
            "timezone": "Local"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "FileProcessor",
    "metrics_collected": {
      "cpu": {
        "measurement": [{"name": "cpu_usage_idle", "rename": "CPU_IDLE", "unit": "Percent"}],
        "totalcpu": false
      },
      "disk": {
        "measurement": [{"name": "used_percent", "rename": "DISK_USED", "unit": "Percent"}],
        "resources": ["/"]
      },
      "mem": {
        "measurement": [{"name": "mem_used_percent", "rename": "MEM_USED", "unit": "Percent"}]
      }
    },
    "append_dimensions": {
      "InstanceId": "${INSTANCE_ID}",
      "InstanceType": "\${aws:InstanceType}",
      "AutoScalingGroupName": "\${aws:AutoScalingGroupName}"
    }
  }
}
EOF

sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json

# 4. ヘルスチェック確認
echo "[4/6] Verifying health..."
python3.11 /app/worker.py --validate-only
if [ $? -ne 0 ]; then
    echo "❌ Configuration validation failed!"
    exit 1
fi

# 5. Worker起動
echo "[5/6] Starting File Processor Worker..."
sudo systemctl start file-processor-worker.service
sudo systemctl status file-processor-worker.service

# 6. 起動確認
echo "[6/6] Verifying worker startup..."
sleep 10
if sudo systemctl is-active --quiet file-processor-worker.service; then
    echo "✅ Worker started successfully"
else
    echo "❌ Worker failed to start"
    sudo journalctl -u file-processor-worker.service -n 50
    exit 1
fi

echo "==================================="
echo "User Data Execution Completed"
echo "Date: $(date)"
echo "==================================="
```

---

## Launch Template設計

### 完全版 Launch Template (JSON)

```json
{
  "LaunchTemplateName": "python-worker-template-v1",
  "VersionDescription": "Production-ready Python Worker for File Processing",
  "LaunchTemplateData": {
    "ImageId": "ami-xxxxxxxxxxxxxxxxx",
    "InstanceType": "c5.xlarge",
    "IamInstanceProfile": {
      "Name": "FileProcessorWorkerRole"
    },
    "SecurityGroupIds": [
      "sg-xxxxxxxxxxxxxxxxx"
    ],
    "KeyName": "your-key-pair",
    "Monitoring": {
      "Enabled": true
    },
    "EbsOptimized": true,
    "BlockDeviceMappings": [
      {
        "DeviceName": "/dev/xvda",
        "Ebs": {
          "VolumeSize": 30,
          "VolumeType": "gp3",
          "Iops": 3000,
          "Throughput": 125,
          "DeleteOnTermination": true,
          "Encrypted": true
        }
      }
    ],
    "MetadataOptions": {
      "HttpTokens": "required",
      "HttpPutResponseHopLimit": 1,
      "InstanceMetadataTags": "enabled"
    },
    "TagSpecifications": [
      {
        "ResourceType": "instance",
        "Tags": [
          {
            "Key": "Name",
            "Value": "python-worker"
          },
          {
            "Key": "Environment",
            "Value": "production"
          },
          {
            "Key": "Application",
            "Value": "file-processor"
          },
          {
            "Key": "ManagedBy",
            "Value": "AutoScaling"
          }
        ]
      },
      {
        "ResourceType": "volume",
        "Tags": [
          {
            "Key": "Name",
            "Value": "python-worker-volume"
          }
        ]
      }
    ],
    "UserData": "IyEvYmluL2Jhc2gKIyBCYXNlNjQgZW5jb2RlZCB1c2VyLWRhdGEuc2ggc2NyaXB0"
  }
}
```

### Launch Template (Terraform HCL)

```hcl
# terraform/launch_template.tf

resource "aws_launch_template" "python_worker" {
  name_prefix   = "python-worker-"
  description   = "Launch template for Python Worker Auto Scaling"
  image_id      = var.ami_id
  instance_type = "c5.xlarge"

  iam_instance_profile {
    name = aws_iam_instance_profile.worker_profile.name
  }

  vpc_security_group_ids = [aws_security_group.worker_sg.id]

  key_name = var.key_pair_name

  monitoring {
    enabled = true
  }

  ebs_optimized = true

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size           = 30
      volume_type           = "gp3"
      iops                  = 3000
      throughput            = 125
      delete_on_termination = true
      encrypted             = true
      kms_key_id            = aws_kms_key.ebs_key.arn
    }
  }

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "enabled"
  }

  tag_specifications {
    resource_type = "instance"

    tags = merge(
      var.common_tags,
      {
        Name        = "python-worker"
        Environment = var.environment
        Application = "file-processor"
        ManagedBy   = "AutoScaling"
      }
    )
  }

  tag_specifications {
    resource_type = "volume"

    tags = merge(
      var.common_tags,
      {
        Name = "python-worker-volume"
      }
    )
  }

  user_data = base64encode(templatefile("${path.module}/user-data.sh.tpl", {
    aws_region            = var.aws_region
    s3_bucket             = var.s3_bucket
    sqs_queue_url         = aws_sqs_queue.file_processing.url
    opensearch_endpoint   = aws_opensearch_domain.files.endpoint
    opensearch_index      = var.opensearch_index
    log_level             = var.log_level
    cloudwatch_log_group  = aws_cloudwatch_log_group.worker.name
  }))

  lifecycle {
    create_before_destroy = true
  }
}

# IAM Instance Profile
resource "aws_iam_instance_profile" "worker_profile" {
  name = "file-processor-worker-profile"
  role = aws_iam_role.worker_role.name
}

# IAM Role
resource "aws_iam_role" "worker_role" {
  name = "file-processor-worker-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

# IAM Policy
resource "aws_iam_role_policy" "worker_policy" {
  name = "file-processor-worker-policy"
  role = aws_iam_role.worker_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.storage.arn,
          "${aws_s3_bucket.storage.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = aws_sqs_queue.file_processing.arn
      },
      {
        Effect = "Allow"
        Action = [
          "es:ESHttpPost",
          "es:ESHttpPut",
          "es:ESHttpGet"
        ]
        Resource = "${aws_opensearch_domain.files.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:*:*:log-group:/aws/ec2/file-processor*"
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
      }
    ]
  })
}
```

### インスタンスタイプ選定ガイド

| インスタンスタイプ | vCPU | メモリ | 推奨用途 | コスト |
|-------------------|------|--------|---------|--------|
| `t3.large` | 2 | 8 GB | 開発・テスト | $ |
| `c5.xlarge` | 4 | 8 GB | 本番 (推奨) | $$ |
| `c5.2xlarge` | 8 | 16 GB | 高負荷 (大量処理) | $$$ |
| `c6i.xlarge` | 4 | 8 GB | 本番 (最新世代) | $$ |

**推奨**: `c5.xlarge` (コンピュート最適化、4 vCPU、8 GB RAM)
- OCR処理はCPU集約的
- MAX_WORKERS=4に最適
- コスト効率良好

---

## Auto Scaling Policy

### SQSベースのTarget Tracking Scaling

```hcl
# terraform/autoscaling.tf

resource "aws_autoscaling_group" "python_worker" {
  name                = "python-worker-asg"
  vpc_zone_identifier = var.private_subnet_ids
  target_group_arns   = []  # ALB不使用

  min_size         = 1
  max_size         = 10
  desired_capacity = 2

  health_check_type         = "EC2"
  health_check_grace_period = 300
  default_cooldown          = 300

  launch_template {
    id      = aws_launch_template.python_worker.id
    version = "$Latest"
  }

  enabled_metrics = [
    "GroupMinSize",
    "GroupMaxSize",
    "GroupDesiredCapacity",
    "GroupInServiceInstances",
    "GroupTotalInstances"
  ]

  tag {
    key                 = "Name"
    value               = "python-worker"
    propagate_at_launch = true
  }

  tag {
    key                 = "Environment"
    value               = var.environment
    propagate_at_launch = true
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Target Tracking Scaling Policy - SQSメッセージ数ベース
resource "aws_autoscaling_policy" "sqs_target_tracking" {
  name                   = "sqs-message-based-scaling"
  autoscaling_group_name = aws_autoscaling_group.python_worker.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    customized_metric_specification {
      metric_dimension {
        name  = "QueueName"
        value = aws_sqs_queue.file_processing.name
      }

      metric_name = "ApproximateNumberOfMessagesVisible"
      namespace   = "AWS/SQS"
      statistic   = "Average"
    }

    target_value     = 100.0  # インスタンスあたり100メッセージ
    scale_in_cooldown  = 300  # 5分
    scale_out_cooldown = 60   # 1分
  }
}

# Step Scaling Policy - 高負荷時の緊急スケールアウト
resource "aws_autoscaling_policy" "scale_out_emergency" {
  name                   = "emergency-scale-out"
  autoscaling_group_name = aws_autoscaling_group.python_worker.name
  policy_type            = "StepScaling"
  adjustment_type        = "PercentChangeInCapacity"

  step_adjustment {
    scaling_adjustment          = 50   # 50%増加
    metric_interval_lower_bound = 0
    metric_interval_upper_bound = 500
  }

  step_adjustment {
    scaling_adjustment          = 100  # 100%増加 (倍増)
    metric_interval_lower_bound = 500
  }
}

# CloudWatch Alarm - 緊急スケールアウト用
resource "aws_cloudwatch_metric_alarm" "sqs_high_messages" {
  alarm_name          = "sqs-high-message-count"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Average"
  threshold           = 500
  alarm_description   = "Trigger emergency scale-out when SQS messages exceed 500"

  dimensions = {
    QueueName = aws_sqs_queue.file_processing.name
  }

  alarm_actions = [aws_autoscaling_policy.scale_out_emergency.arn]
}

# Scheduled Scaling - 予測可能なトラフィックパターン
resource "aws_autoscaling_schedule" "scale_up_morning" {
  scheduled_action_name  = "scale-up-morning"
  autoscaling_group_name = aws_autoscaling_group.python_worker.name
  min_size               = 3
  max_size               = 10
  desired_capacity       = 5
  recurrence             = "0 8 * * MON-FRI"  # 平日8:00
}

resource "aws_autoscaling_schedule" "scale_down_evening" {
  scheduled_action_name  = "scale-down-evening"
  autoscaling_group_name = aws_autoscaling_group.python_worker.name
  min_size               = 1
  max_size               = 10
  desired_capacity       = 2
  recurrence             = "0 20 * * *"  # 毎日20:00
}
```

### スケーリングパラメータ推奨値

| パラメータ | 推奨値 | 説明 |
|-----------|--------|------|
| **min_size** | 1 | 最小インスタンス数 (コスト削減) |
| **max_size** | 10 | 最大インスタンス数 (負荷制限) |
| **desired_capacity** | 2 | 通常時のインスタンス数 |
| **target_value** | 100 | インスタンスあたりのSQSメッセージ数 |
| **scale_in_cooldown** | 300 | スケールイン待機時間 (5分) |
| **scale_out_cooldown** | 60 | スケールアウト待機時間 (1分) |
| **health_check_grace_period** | 300 | ヘルスチェック猶予期間 (5分) |

---

## デプロイパイプライン

### AMI更新時のゼロダウンタイムデプロイ

#### 戦略1: ローリングアップデート (推奨)

```bash
#!/bin/bash
# scripts/deploy-new-ami.sh
# ローリングアップデートによるAMI更新

set -euo pipefail

NEW_AMI_ID=$1
LAUNCH_TEMPLATE_NAME="python-worker-template-v1"
ASG_NAME="python-worker-asg"

echo "==================================="
echo "Rolling Update Deployment"
echo "New AMI: $NEW_AMI_ID"
echo "==================================="

# 1. 新しいLaunch Templateバージョンの作成
echo "[1/5] Creating new Launch Template version..."
aws ec2 create-launch-template-version \
    --launch-template-name $LAUNCH_TEMPLATE_NAME \
    --source-version '$Latest' \
    --launch-template-data "{\"ImageId\":\"$NEW_AMI_ID\"}" \
    --version-description "AMI Update: $NEW_AMI_ID"

# 最新バージョンを取得
LATEST_VERSION=$(aws ec2 describe-launch-templates \
    --launch-template-names $LAUNCH_TEMPLATE_NAME \
    --query 'LaunchTemplates[0].LatestVersionNumber' \
    --output text)

echo "Created version: $LATEST_VERSION"

# 2. Launch Templateのデフォルトバージョンを更新
echo "[2/5] Setting default version..."
aws ec2 modify-launch-template \
    --launch-template-name $LAUNCH_TEMPLATE_NAME \
    --default-version $LATEST_VERSION

# 3. Auto Scaling Groupの更新
echo "[3/5] Updating Auto Scaling Group..."
aws autoscaling update-auto-scaling-group \
    --auto-scaling-group-name $ASG_NAME \
    --launch-template LaunchTemplateName=$LAUNCH_TEMPLATE_NAME,Version='$Latest'

# 4. インスタンスリフレッシュの開始
echo "[4/5] Starting instance refresh..."
REFRESH_ID=$(aws autoscaling start-instance-refresh \
    --auto-scaling-group-name $ASG_NAME \
    --preferences '{
        "MinHealthyPercentage": 90,
        "InstanceWarmup": 300,
        "CheckpointPercentages": [50, 100],
        "CheckpointDelay": 300
    }' \
    --query 'InstanceRefreshId' \
    --output text)

echo "Instance Refresh ID: $REFRESH_ID"

# 5. リフレッシュの進捗監視
echo "[5/5] Monitoring instance refresh progress..."
while true; do
    STATUS=$(aws autoscaling describe-instance-refreshes \
        --auto-scaling-group-name $ASG_NAME \
        --instance-refresh-ids $REFRESH_ID \
        --query 'InstanceRefreshes[0].Status' \
        --output text)

    PERCENTAGE=$(aws autoscaling describe-instance-refreshes \
        --auto-scaling-group-name $ASG_NAME \
        --instance-refresh-ids $REFRESH_ID \
        --query 'InstanceRefreshes[0].PercentageComplete' \
        --output text)

    echo "Status: $STATUS - Progress: ${PERCENTAGE}%"

    if [[ "$STATUS" == "Successful" ]]; then
        echo "✅ Instance refresh completed successfully!"
        break
    elif [[ "$STATUS" == "Failed" ]] || [[ "$STATUS" == "Cancelled" ]]; then
        echo "❌ Instance refresh failed: $STATUS"
        exit 1
    fi

    sleep 30
done

echo "==================================="
echo "Deployment Complete!"
echo "==================================="
```

#### 戦略2: Blue/Green Deployment

```bash
#!/bin/bash
# scripts/blue-green-deploy.sh
# Blue/Green DeploymentによるAMI更新

set -euo pipefail

NEW_AMI_ID=$1
ENVIRONMENT="production"

echo "==================================="
echo "Blue/Green Deployment"
echo "New AMI: $NEW_AMI_ID"
echo "==================================="

# 1. Green環境のLaunch Template作成
echo "[1/6] Creating Green Launch Template..."
GREEN_LT_NAME="python-worker-template-green-$(date +%Y%m%d%H%M%S)"

aws ec2 create-launch-template \
    --launch-template-name $GREEN_LT_NAME \
    --version-description "Green environment - AMI: $NEW_AMI_ID" \
    --launch-template-data file://green-launch-template.json

# 2. Green Auto Scaling Groupの作成
echo "[2/6] Creating Green Auto Scaling Group..."
GREEN_ASG_NAME="python-worker-asg-green"

aws autoscaling create-auto-scaling-group \
    --auto-scaling-group-name $GREEN_ASG_NAME \
    --launch-template LaunchTemplateName=$GREEN_LT_NAME,Version='$Latest' \
    --min-size 1 \
    --max-size 10 \
    --desired-capacity 2 \
    --vpc-zone-identifier "subnet-xxx,subnet-yyy" \
    --health-check-type EC2 \
    --health-check-grace-period 300 \
    --tags Key=Name,Value=python-worker-green Key=Environment,Value=$ENVIRONMENT

# 3. Green環境のヘルスチェック
echo "[3/6] Waiting for Green instances to become healthy..."
sleep 300

HEALTHY_COUNT=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names $GREEN_ASG_NAME \
    --query 'AutoScalingGroups[0].Instances[?HealthStatus==`Healthy`] | length(@)' \
    --output text)

if [[ $HEALTHY_COUNT -lt 2 ]]; then
    echo "❌ Green environment unhealthy. Aborting deployment."
    exit 1
fi

echo "✅ Green environment healthy ($HEALTHY_COUNT instances)"

# 4. トラフィックの切り替え (SQS接続)
echo "[4/6] Switching traffic to Green environment..."
# SQSベースなので特別な切り替え不要
# BlueとGreenが両方SQSからメッセージを処理開始

# 5. Blue環境のスケールダウン
echo "[5/6] Scaling down Blue environment..."
BLUE_ASG_NAME="python-worker-asg"

aws autoscaling update-auto-scaling-group \
    --auto-scaling-group-name $BLUE_ASG_NAME \
    --min-size 0 \
    --max-size 0 \
    --desired-capacity 0

# Blueインスタンスの終了待機
sleep 180

# 6. Green環境をBlueにプロモーション
echo "[6/6] Promoting Green to Blue..."
# Green ASGの名前を変更 (またはタグ更新)
aws autoscaling update-auto-scaling-group \
    --auto-scaling-group-name $GREEN_ASG_NAME \
    --tags Key=Color,Value=Blue Key=Active,Value=true

echo "==================================="
echo "Blue/Green Deployment Complete!"
echo "==================================="
echo "New Blue ASG: $GREEN_ASG_NAME"
echo "Old Blue ASG: $BLUE_ASG_NAME (scaled to 0)"
```

### CI/CD パイプライン (GitHub Actions)

```yaml
# .github/workflows/build-and-deploy-ami.yml

name: Build and Deploy AMI

on:
  push:
    branches:
      - main
    paths:
      - 'backend/python-worker/**'
  workflow_dispatch:
    inputs:
      deployment_strategy:
        description: 'Deployment strategy'
        required: true
        default: 'rolling'
        type: choice
        options:
          - rolling
          - blue-green

env:
  AWS_REGION: ap-northeast-1
  BASE_AMI_ID: ami-0d52744d6551d851e  # Amazon Linux 2023

jobs:
  build-ami:
    name: Build AMI
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    outputs:
      ami_id: ${{ steps.create_ami.outputs.ami_id }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Launch temporary EC2 instance
        id: launch_instance
        run: |
          INSTANCE_ID=$(aws ec2 run-instances \
            --image-id ${{ env.BASE_AMI_ID }} \
            --instance-type t3.large \
            --key-name ${{ secrets.EC2_KEY_NAME }} \
            --subnet-id ${{ secrets.SUBNET_ID }} \
            --security-group-ids ${{ secrets.SG_ID }} \
            --iam-instance-profile Name=FileProcessorBuilderRole \
            --block-device-mappings DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3} \
            --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ami-builder}]' \
            --query 'Instances[0].InstanceId' \
            --output text)

          echo "instance_id=$INSTANCE_ID" >> $GITHUB_OUTPUT

          # インスタンスの起動待機
          aws ec2 wait instance-running --instance-ids $INSTANCE_ID
          sleep 60

      - name: Copy files to instance
        run: |
          INSTANCE_IP=$(aws ec2 describe-instances \
            --instance-ids ${{ steps.launch_instance.outputs.instance_id }} \
            --query 'Reservations[0].Instances[0].PublicIpAddress' \
            --output text)

          scp -r -o StrictHostKeyChecking=no \
            backend/python-worker/* ec2-user@$INSTANCE_IP:/home/ec2-user/

      - name: Build AMI
        run: |
          INSTANCE_IP=$(aws ec2 describe-instances \
            --instance-ids ${{ steps.launch_instance.outputs.instance_id }} \
            --query 'Reservations[0].Instances[0].PublicIpAddress' \
            --output text)

          ssh -o StrictHostKeyChecking=no ec2-user@$INSTANCE_IP << 'EOF'
            cd /home/ec2-user
            sudo bash scripts/build-ami.sh
            sudo bash scripts/ami-cleanup.sh
EOF

      - name: Create AMI
        id: create_ami
        run: |
          AMI_ID=$(aws ec2 create-image \
            --instance-id ${{ steps.launch_instance.outputs.instance_id }} \
            --name "python-worker-$(date +%Y%m%d-%H%M%S)" \
            --description "Python Worker for File Processing - Built by GitHub Actions" \
            --no-reboot \
            --tag-specifications 'ResourceType=image,Tags=[{Key=Environment,Value=production},{Key=Application,Value=file-processor},{Key=GitCommit,Value=${{ github.sha }}}]' \
            --query 'ImageId' \
            --output text)

          echo "ami_id=$AMI_ID" >> $GITHUB_OUTPUT

          # AMI作成完了待機
          aws ec2 wait image-available --image-ids $AMI_ID

      - name: Terminate builder instance
        if: always()
        run: |
          aws ec2 terminate-instances \
            --instance-ids ${{ steps.launch_instance.outputs.instance_id }}

  deploy-ami:
    name: Deploy AMI
    needs: build-ami
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Deploy with Rolling Update
        if: ${{ github.event.inputs.deployment_strategy == 'rolling' || github.event.inputs.deployment_strategy == '' }}
        run: |
          bash scripts/deploy-new-ami.sh ${{ needs.build-ami.outputs.ami_id }}

      - name: Deploy with Blue/Green
        if: ${{ github.event.inputs.deployment_strategy == 'blue-green' }}
        run: |
          bash scripts/blue-green-deploy.sh ${{ needs.build-ami.outputs.ami_id }}

      - name: Smoke tests
        run: |
          # SQSキューにテストメッセージを送信
          aws sqs send-message \
            --queue-url ${{ secrets.SQS_QUEUE_URL }} \
            --message-body '{"test": true, "bucket": "test-bucket", "key": "test.pdf"}'

          # 処理完了を待機
          sleep 120

          # CloudWatch Logsでエラー確認
          ERROR_COUNT=$(aws logs filter-log-events \
            --log-group-name /aws/ec2/file-processor \
            --start-time $(($(date +%s) * 1000 - 300000)) \
            --filter-pattern "ERROR" \
            --query 'events | length(@)' \
            --output text)

          if [[ $ERROR_COUNT -gt 0 ]]; then
            echo "❌ Deployment validation failed: $ERROR_COUNT errors found"
            exit 1
          fi

          echo "✅ Deployment validation passed"
```

---

## トラブルシューティング

### 問題1: インスタンスが起動しない

#### 症状
- Auto Scalingで起動したインスタンスがすぐに終了
- ヘルスチェック失敗

#### 原因と対策

**1. User Dataスクリプトエラー**

```bash
# User Dataログの確認
sudo cat /var/log/user-data.log

# CloudWatch Logsで確認
aws logs tail /aws/ec2/file-processor --follow
```

**2. IAMロール権限不足**

```bash
# インスタンスメタデータでIAMロール確認
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/

# 必要な権限の確認
aws iam get-role-policy \
  --role-name FileProcessorWorkerRole \
  --policy-name FileProcessorWorkerPolicy
```

**3. セキュリティグループ設定ミス**

```bash
# アウトバウンドルール確認
aws ec2 describe-security-groups \
  --group-ids sg-xxxxxxxxx \
  --query 'SecurityGroups[0].IpPermissionsEgress'
```

### 問題2: Workerが起動するがメッセージを処理しない

#### 症状
- インスタンスは正常起動
- SQSメッセージが処理されない

#### デバッグ手順

```bash
# 1. Workerプロセス確認
sudo systemctl status file-processor-worker.service
sudo journalctl -u file-processor-worker.service -f

# 2. 環境変数確認
sudo -u appuser env | grep -E "(SQS|OPENSEARCH|S3)"

# 3. SQS接続テスト
python3.11 << EOF
import boto3
sqs = boto3.client('sqs', region_name='ap-northeast-1')
response = sqs.receive_message(
    QueueUrl='https://sqs.ap-northeast-1.amazonaws.com/xxx/queue',
    MaxNumberOfMessages=1
)
print(response)
EOF

# 4. OpenSearch接続テスト
curl -X GET "https://your-opensearch-endpoint/_cluster/health?pretty"

# 5. S3アクセステスト
aws s3 ls s3://cis-filesearch-storage/ --region ap-northeast-1
```

### 問題3: DLQにメッセージが蓄積

#### 原因分析

```bash
# DLQのメッセージ詳細取得
aws sqs receive-message \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/xxx/dlq \
  --attribute-names All \
  --message-attribute-names All \
  --max-number-of-messages 10

# エラーパターン分析
aws logs filter-log-events \
  --log-group-name /aws/ec2/file-processor \
  --start-time $(($(date +%s) * 1000 - 3600000)) \
  --filter-pattern "ERROR" \
  | jq -r '.events[].message'
```

#### 対策

**1. 処理タイムアウト延長**

```bash
# config.pyで設定変更
export PROCESSING_TIMEOUT="600"
export SQS_VISIBILITY_TIMEOUT="900"
```

**2. リトライロジック追加**

```python
# worker.py に追加
def process_with_retry(self, message, max_retries=3):
    for attempt in range(max_retries):
        try:
            return self.process_sqs_message(message)
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)  # Exponential backoff
```

### 問題4: メモリ不足エラー

#### 症状
- OOM Killer発動
- インスタンス予期せぬ終了

#### 対策

```bash
# 1. メモリ使用状況監視
free -h
top -o %MEM

# 2. スワップ領域の追加
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 3. MAX_WORKERS削減
export MAX_WORKERS="2"  # デフォルト4から削減

# 4. 大容量ファイルの制限
export MAX_FILE_SIZE_MB="50"  # デフォルト100から削減
```

### 問題5: AMI更新後に旧バージョンが残る

#### 症状
- ローリングアップデート完了後も旧インスタンスが稼働

#### 対策

```bash
# 古いインスタンスを手動終了
aws autoscaling terminate-instance-in-auto-scaling-group \
  --instance-id i-xxxxxxxxx \
  --should-decrement-desired-capacity

# または、強制的にインスタンスリフレッシュ
aws autoscaling cancel-instance-refresh \
  --auto-scaling-group-name python-worker-asg

aws autoscaling start-instance-refresh \
  --auto-scaling-group-name python-worker-asg \
  --preferences '{
      "MinHealthyPercentage": 0,
      "InstanceWarmup": 300
  }'
```

### デバッグ用スクリプト

```bash
#!/bin/bash
# scripts/debug-worker.sh
# Worker診断スクリプト

echo "==================================="
echo "Python Worker Diagnostics"
echo "==================================="

# システム情報
echo "[1] System Information"
uname -a
cat /etc/os-release

# インスタンスメタデータ
echo "[2] Instance Metadata"
ec2-metadata --instance-id
ec2-metadata --instance-type
ec2-metadata --availability-zone

# 環境変数
echo "[3] Environment Variables"
env | grep -E "(AWS|SQS|OPENSEARCH|S3)" | sort

# Workerサービス状態
echo "[4] Worker Service Status"
sudo systemctl status file-processor-worker.service --no-pager

# 最新ログ
echo "[5] Recent Logs"
sudo journalctl -u file-processor-worker.service -n 50 --no-pager

# ディスク使用量
echo "[6] Disk Usage"
df -h

# メモリ使用量
echo "[7] Memory Usage"
free -h

# ネットワーク接続
echo "[8] Network Connectivity"
# SQS
aws sqs get-queue-attributes \
  --queue-url ${SQS_QUEUE_URL} \
  --attribute-names All \
  --region ${AWS_REGION} 2>&1 | head -5

# OpenSearch
curl -s -o /dev/null -w "%{http_code}\n" ${OPENSEARCH_ENDPOINT}/_cluster/health

# S3
aws s3 ls s3://${S3_BUCKET}/ --region ${AWS_REGION} | head -5

echo "==================================="
echo "Diagnostics Complete"
echo "==================================="
```

---

## まとめ

### ベストプラクティス要約

1. **AMI構成**
   - アプリケーションコードと依存関係をAMIに含める
   - 環境変数はUser Dataで注入
   - セキュリティ情報はIAMロール使用

2. **Auto Scaling**
   - SQSメッセージ数ベースのTarget Tracking
   - min=1, desired=2, max=10
   - ヘルスチェック猶予期間: 5分

3. **デプロイ**
   - ローリングアップデートを推奨
   - MinHealthyPercentage: 90%
   - インスタンスリフレッシュで自動化

4. **監視**
   - CloudWatch Agent必須
   - カスタムメトリクス収集
   - ログ集約化

### チェックリスト

AMI作成前:
- [ ] `build-ami.sh` 実行
- [ ] `ami-cleanup.sh` 実行
- [ ] 環境変数削除確認
- [ ] 一時ファイル削除確認

デプロイ前:
- [ ] AMI動作確認 (手動起動テスト)
- [ ] User Dataスクリプト検証
- [ ] IAMロール権限確認
- [ ] セキュリティグループ設定確認

デプロイ後:
- [ ] インスタンス起動確認
- [ ] Workerプロセス起動確認
- [ ] SQSメッセージ処理確認
- [ ] CloudWatch Logsエラー確認
- [ ] スケーリング動作確認
