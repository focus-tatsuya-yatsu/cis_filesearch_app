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
if [ -f scripts/install-tesseract-al2023.sh ]; then
    bash scripts/install-tesseract-al2023.sh
else
    echo "⚠️  Tesseract installation script not found. Please install manually."
fi

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
sudo tee /etc/systemd/system/file-processor-worker.service > /dev/null << 'EOF'
[Unit]
Description=File Processor Worker
After=network.target

[Service]
Type=simple
User=appuser
Group=appuser
WorkingDirectory=/app
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
EnvironmentFile=/etc/file-processor/env
ExecStart=/usr/bin/python3.11 /app/worker.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=file-processor-worker

[Install]
WantedBy=multi-user.target
EOF

sudo mkdir -p /etc/file-processor
sudo systemctl daemon-reload
sudo systemctl enable file-processor-worker.service

# 10. CloudWatch Agent設定
echo "[10/10] Configuring CloudWatch Agent..."
sudo mkdir -p /opt/aws/amazon-cloudwatch-agent/etc/
sudo tee /opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json > /dev/null << 'EOF'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/file-processor.log",
            "log_group_name": "/aws/ec2/file-processor",
            "log_stream_name": "{instance_id}",
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
        "measurement": [{"name": "cpu_usage_idle", "unit": "Percent"}],
        "totalcpu": false
      },
      "disk": {
        "measurement": [{"name": "used_percent", "unit": "Percent"}],
        "resources": ["/"]
      },
      "mem": {
        "measurement": [{"name": "mem_used_percent", "unit": "Percent"}]
      }
    }
  }
}
EOF

sudo systemctl enable amazon-cloudwatch-agent

echo "==================================="
echo "AMI Build Preparation Complete!"
echo "==================================="
echo ""
echo "Next steps:"
echo "1. Review configuration"
echo "2. Run: sudo bash scripts/ami-cleanup.sh"
echo "3. Create AMI from EC2 console or AWS CLI"
