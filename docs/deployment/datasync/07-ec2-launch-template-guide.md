# 📋 CIS File Search - EC2 Launch Template設定ガイド

## 🎯 概要

このガイドでは、SQSメッセージを処理するEC2インスタンス用のLaunch Templateを作成します。Tesseract OCRとPython処理環境を含む、完全に自動化されたインスタンス起動設定を構築します。

## 📝 前提条件

- [ ] IAMロール（`CIS-EC2-FileProcessor-Role`）が作成済み
- [ ] Instance Profileが作成済み
- [ ] VPCとSubnetが設定済み
- [ ] Security Groupが作成済み（または作成予定）

## 🚀 Launch Template作成手順

### ステップ1: 基本設定

1. **EC2コンソール**を開く
2. 左メニューから「**Launch Templates**」を選択
3. 「**Create launch template**」をクリック

#### 1.1 Launch Template名と説明
```
Launch template name: CIS-FileProcessor-LaunchTemplate
Template version description: Initial version with Tesseract OCR and Python 3.11
Auto Scaling guidance: ✅ Provide guidance to help me set up a template...
```

### ステップ2: AMI選択

#### 2.1 推奨AMI
```
AMI ID: Amazon Linux 2023 AMI (最新版)
Architecture: 64-bit (x86)
Root device type: EBS
Virtualization type: HVM
```

**選定理由:**
- Python 3.11がプリインストール
- systemdサポート
- セキュリティアップデート
- 軽量で高速起動

### ステップ3: インスタンスタイプ

#### 3.1 推奨インスタンスタイプ
```
Primary: c5.xlarge
Secondary: c5a.xlarge (AMD版、少し安価)
Tertiary: m5.xlarge (汎用型)
```

**c5.xlargeスペック:**
- vCPU: 4
- メモリ: 8 GB
- ネットワーク: 最大10 Gbps
- EBS帯域幅: 最大4,750 Mbps

**選定理由:**
- Tesseract OCRはCPU集約型
- 4コアで並列処理可能
- Spot料金が安定

### ステップ4: Key Pairとネットワーク設定

#### 4.1 Key Pair
```
Key pair name: [任意選択またはなし]
```
> 💡 本番環境ではSSM Session Manager推奨

#### 4.2 ネットワーク設定
```
VPC: [プロジェクト用VPC]
Subnet: プライベートサブネット推奨
Auto-assign public IP: Disable
```

### ステップ5: Security Group設定

#### 5.1 新規Security Group作成
```yaml
Name: CIS-FileProcessor-SG
Description: Security group for file processor EC2 instances
Rules:
  Inbound:
    - なし（Session Manager経由でアクセス）

  Outbound:
    - Type: HTTPS (443)
      Destination: 0.0.0.0/0
      Description: AWS APIs, package downloads

    - Type: Custom TCP (3128)
      Destination: [Squid Proxy SG]
      Description: Internal proxy (optional)
```

### ステップ6: ストレージ設定

#### 6.1 EBSボリューム
```yaml
Root Volume:
  Device: /dev/xvda
  Size: 30 GB
  Volume type: gp3
  IOPS: 3000
  Throughput: 125 MB/s
  Delete on termination: Yes
  Encrypted: Yes
  KMS key: aws/ebs (default)
```

**追加ボリューム（オプション）:**
```yaml
Temporary Storage:
  Device: /dev/xvdb
  Size: 100 GB
  Volume type: gp3
  Mount point: /tmp/processing
  Delete on termination: Yes
  Encrypted: Yes
```

### ステップ7: IAM Instance Profile

```
IAM instance profile: CIS-EC2-FileProcessor-InstanceProfile
```

### ステップ8: User Data Script

#### 8.1 完全なUser Dataスクリプト

```bash
#!/bin/bash
set -e

# ========================================
# CIS File Processor - EC2 Bootstrap Script
# ========================================

# ログ設定
LOG_FILE="/var/log/user-data.log"
exec > >(tee -a $LOG_FILE)
exec 2>&1

echo "===== Bootstrap Started at $(date) ====="

# ========================================
# 1. システムアップデート
# ========================================
echo "Updating system packages..."
dnf update -y

# ========================================
# 2. 必要なパッケージのインストール
# ========================================
echo "Installing required packages..."
dnf install -y \
    python3.11 \
    python3.11-pip \
    python3.11-devel \
    gcc \
    gcc-c++ \
    make \
    git \
    jq \
    htop \
    amazon-cloudwatch-agent

# ========================================
# 3. Tesseract OCRインストール
# ========================================
echo "Installing Tesseract OCR..."

# EPELリポジトリを有効化
dnf install -y epel-release
dnf config-manager --set-enabled epel

# Tesseractと言語パックをインストール
dnf install -y \
    tesseract \
    tesseract-langpack-jpn \
    tesseract-langpack-eng \
    tesseract-langpack-jpn_vert

# Tesseractバージョン確認
tesseract --version

# ========================================
# 4. アプリケーションディレクトリ作成
# ========================================
echo "Creating application directories..."
mkdir -p /var/app/cis-file-processor/{logs,config,temp}
mkdir -p /tmp/processing

# ========================================
# 5. Python仮想環境セットアップ
# ========================================
echo "Setting up Python virtual environment..."
cd /var/app/cis-file-processor
python3.11 -m venv venv
source venv/bin/activate

# 必要なPythonパッケージをインストール
pip install --upgrade pip
pip install \
    boto3==1.34.* \
    botocore \
    requests \
    pillow \
    pytesseract \
    pypdf \
    python-docx \
    openpyxl \
    python-multipart \
    pydantic \
    structlog \
    prometheus-client

# ========================================
# 6. アプリケーションコード取得
# ========================================
echo "Fetching application code..."

# S3から最新のアプリケーションコードを取得
aws s3 cp s3://cis-filesearch-deployment/latest/file-processor.tar.gz /tmp/
tar -xzf /tmp/file-processor.tar.gz -C /var/app/cis-file-processor/
rm /tmp/file-processor.tar.gz

# 設定ファイルを取得
aws s3 cp s3://cis-filesearch-deployment/config/processor-config.json \
    /var/app/cis-file-processor/config/

# ========================================
# 7. CloudWatch Agent設定
# ========================================
echo "Configuring CloudWatch Agent..."

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'EOF'
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "cwagent"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/app/cis-file-processor/logs/application.log",
            "log_group_name": "/aws/ec2/cis-filesearch-processor/application",
            "log_stream_name": "{instance_id}/application",
            "retention_in_days": 7,
            "timezone": "Asia/Tokyo"
          },
          {
            "file_path": "/var/log/messages",
            "log_group_name": "/aws/ec2/cis-filesearch-processor/system",
            "log_stream_name": "{instance_id}/system",
            "retention_in_days": 7
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "CIS/FileProcessor",
    "metrics_collected": {
      "cpu": {
        "measurement": [
          {"name": "cpu_usage_idle", "rename": "CPU_IDLE", "unit": "Percent"},
          {"name": "cpu_usage_iowait", "rename": "CPU_IOWAIT", "unit": "Percent"},
          "cpu_time_guest"
        ],
        "metrics_collection_interval": 60
      },
      "disk": {
        "measurement": [
          {"name": "used_percent", "rename": "DISK_USED", "unit": "Percent"},
          {"name": "disk_free", "rename": "DISK_FREE", "unit": "Gigabytes"}
        ],
        "metrics_collection_interval": 60,
        "resources": ["/", "/tmp/processing"]
      },
      "mem": {
        "measurement": [
          {"name": "mem_used_percent", "rename": "MEM_USED", "unit": "Percent"},
          {"name": "mem_available", "rename": "MEM_AVAILABLE", "unit": "Megabytes"}
        ],
        "metrics_collection_interval": 60
      },
      "net": {
        "measurement": [
          {"name": "bytes_sent", "rename": "NET_SENT", "unit": "Bytes"},
          {"name": "bytes_recv", "rename": "NET_RECV", "unit": "Bytes"}
        ],
        "metrics_collection_interval": 60
      }
    }
  }
}
EOF

# CloudWatch Agentを起動
systemctl enable amazon-cloudwatch-agent
systemctl start amazon-cloudwatch-agent

# ========================================
# 8. systemdサービス作成
# ========================================
echo "Creating systemd service..."

cat > /etc/systemd/system/cis-file-processor.service <<'EOF'
[Unit]
Description=CIS File Processor Service
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/var/app/cis-file-processor
Environment="PATH=/var/app/cis-file-processor/venv/bin:/usr/local/bin:/usr/bin"
ExecStart=/var/app/cis-file-processor/venv/bin/python main.py
Restart=always
RestartSec=10
StandardOutput=append:/var/app/cis-file-processor/logs/application.log
StandardError=append:/var/app/cis-file-processor/logs/application.log

# リソース制限
MemoryLimit=7G
CPUQuota=350%

[Install]
WantedBy=multi-user.target
EOF

# サービスを有効化して起動
systemctl daemon-reload
systemctl enable cis-file-processor
systemctl start cis-file-processor

# ========================================
# 9. Spot Instance中断ハンドリング
# ========================================
echo "Setting up Spot Instance interruption handler..."

cat > /usr/local/bin/spot-interrupt-handler.sh <<'EOF'
#!/bin/bash
while true; do
  # EC2メタデータサービスからSpot中断通知をチェック
  TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null)

  HTTP_CODE=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" \
    -s -w %{http_code} -o /dev/null \
    http://169.254.169.254/latest/meta-data/spot/instance-action)

  if [ "$HTTP_CODE" == "200" ]; then
    echo "Spot interruption notice detected!"
    # アプリケーションにグレースフルシャットダウンシグナルを送信
    systemctl stop cis-file-processor
    # 処理中のファイルをS3に退避
    aws s3 sync /tmp/processing/ s3://cis-filesearch-temp/interrupted/
    break
  fi
  sleep 5
done
EOF

chmod +x /usr/local/bin/spot-interrupt-handler.sh

# バックグラウンドで実行
nohup /usr/local/bin/spot-interrupt-handler.sh &

# ========================================
# 10. ヘルスチェックスクリプト
# ========================================
echo "Creating health check script..."

cat > /usr/local/bin/health-check.sh <<'EOF'
#!/bin/bash
# アプリケーションのヘルスチェック
curl -f http://localhost:8080/health || exit 1
EOF

chmod +x /usr/local/bin/health-check.sh

# ========================================
# 11. 完了通知
# ========================================
echo "Sending completion notification..."

INSTANCE_ID=$(ec2-metadata --instance-id | cut -d " " -f 2)
REGION=$(ec2-metadata --availability-zone | cut -d " " -f 2 | sed 's/[a-z]$//')

# CloudWatchにカスタムメトリクスを送信
aws cloudwatch put-metric-data \
    --namespace "CIS/FileProcessor" \
    --metric-name "InstanceBootstrapComplete" \
    --value 1 \
    --dimensions InstanceId=$INSTANCE_ID \
    --region $REGION

echo "===== Bootstrap Completed at $(date) ====="
```

### ステップ9: Advanced Details

#### 9.1 Spot Instance設定
```yaml
Request type: Spot
Maximum price: On-demand price (推奨)
Persistent request: No
Interruption behavior: Terminate
Block duration: なし
```

#### 9.2 Termination Protection
```yaml
Enable termination protection: No (Auto Scalingで管理)
```

#### 9.3 Monitoring
```yaml
Detailed CloudWatch monitoring: Enable
```

#### 9.4 Metadata Options
```yaml
Metadata accessible: Enabled
Metadata version: V2 only (IMDSv2)
Metadata token response hop limit: 1
```

#### 9.5 Credit Specification (T系インスタンスの場合)
```yaml
Credit specification: Standard
```

## 🔧 Launch Template バージョン管理

### デフォルトバージョン設定
```bash
# 最新バージョンをデフォルトに設定
aws ec2 modify-launch-template \
    --launch-template-name CIS-FileProcessor-LaunchTemplate \
    --default-version '$Latest'
```

### バージョン作成時の注意点
1. **Major Changes**: 新バージョン作成
2. **Minor Updates**: User Data更新のみ
3. **Testing**: 常に新バージョンをテスト環境で検証

## 📊 コスト最適化

### Spot vs On-Demand 価格比較（2024年1月時点）
| Instance Type | On-Demand | Spot (avg) | 節約率 |
|--------------|-----------|------------|--------|
| c5.xlarge | $0.17/hour | $0.05/hour | 70% |
| c5a.xlarge | $0.154/hour | $0.046/hour | 70% |
| m5.xlarge | $0.192/hour | $0.057/hour | 70% |

### 月間コスト試算（720時間）
- **On-Demand**: $122.40/月
- **Spot**: $36.00/月
- **節約額**: $86.40/月

## 🔍 トラブルシューティング

### User Data実行確認
```bash
# ログ確認
sudo cat /var/log/user-data.log
sudo tail -f /var/log/cloud-init-output.log

# サービス状態確認
sudo systemctl status cis-file-processor
sudo journalctl -u cis-file-processor -f
```

### Tesseract OCR動作確認
```bash
# バージョン確認
tesseract --version

# 言語パック確認
tesseract --list-langs

# テスト実行
echo "テスト" > test.txt
tesseract test.txt output -l jpn
cat output.txt
```

### CloudWatch Agent確認
```bash
# ステータス確認
sudo systemctl status amazon-cloudwatch-agent

# 設定確認
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a query -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
```

## ✅ 完了チェックリスト

- [ ] Launch Template作成完了
- [ ] AMIとインスタンスタイプ選択
- [ ] Security Group設定
- [ ] IAM Instance Profile紐付け
- [ ] User Dataスクリプト設定
- [ ] Spot Instance設定
- [ ] CloudWatch詳細モニタリング有効化
- [ ] IMDSv2設定
- [ ] テストインスタンス起動確認

## 📚 参考リンク

- [EC2 Launch Templates Documentation](https://docs.aws.amazon.com/autoscaling/ec2/userguide/LaunchTemplates.html)
- [Spot Instance Best Practices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-best-practices.html)
- [Tesseract OCR Documentation](https://github.com/tesseract-ocr/tesseract)
- [CloudWatch Agent Configuration](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-Configuration-File-Details.html)

## 🚀 次のステップ

Launch Template作成後は、[08-auto-scaling-group-guide.md](./08-auto-scaling-group-guide.md)でAuto Scaling Groupの設定を行います。