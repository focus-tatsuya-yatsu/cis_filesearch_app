#!/bin/bash
#
# CIS File Processor Worker - Installation Script for EC2
# This script sets up the Python worker application on EC2 instances
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/opt/cis-file-processor"
LOG_DIR="/var/log/cis-worker"
USER="cis-worker"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}CIS File Processor Worker Installation${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root or with sudo${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Step 1: System Update${NC}"
apt-get update
apt-get upgrade -y

echo -e "\n${YELLOW}Step 2: Install System Dependencies${NC}"
apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    tesseract-ocr \
    tesseract-ocr-jpn \
    tesseract-ocr-eng \
    poppler-utils \
    libpoppler-cpp-dev \
    ffmpeg \
    imagemagick \
    git \
    curl \
    wget \
    unzip

echo -e "\n${YELLOW}Step 3: Install Japanese Fonts (for OCR)${NC}"
apt-get install -y \
    fonts-noto-cjk \
    fonts-ipafont \
    fonts-ipaexfont

echo -e "\n${YELLOW}Step 4: Create Application User${NC}"
if ! id -u $USER > /dev/null 2>&1; then
    useradd -m -s /bin/bash $USER
    echo -e "${GREEN}Created user: $USER${NC}"
else
    echo -e "${GREEN}User $USER already exists${NC}"
fi

echo -e "\n${YELLOW}Step 5: Create Application Directories${NC}"
mkdir -p $APP_DIR
mkdir -p $LOG_DIR
mkdir -p $APP_DIR/temp

echo -e "\n${YELLOW}Step 6: Copy Application Files${NC}"
# Note: Files should be copied from S3 or Git repository
# This is a placeholder for the actual deployment method

# Example: Download from S3
# aws s3 cp s3://your-deployment-bucket/cis-worker.tar.gz /tmp/
# tar -xzf /tmp/cis-worker.tar.gz -C $APP_DIR/

# Example: Clone from Git
# git clone https://github.com/your-org/cis-worker.git $APP_DIR/

# For now, assuming files are already in current directory
if [ -d "../src" ]; then
    cp -r ../src $APP_DIR/
    cp ../requirements.txt $APP_DIR/
    cp ../.env.example $APP_DIR/.env
    echo -e "${GREEN}Application files copied${NC}"
else
    echo -e "${RED}Source files not found. Please copy manually.${NC}"
fi

echo -e "\n${YELLOW}Step 7: Create Python Virtual Environment${NC}"
cd $APP_DIR
python3 -m venv venv
source venv/bin/activate

echo -e "\n${YELLOW}Step 8: Install Python Dependencies${NC}"
pip install --upgrade pip
pip install -r requirements.txt

echo -e "\n${YELLOW}Step 9: Set Permissions${NC}"
chown -R $USER:$USER $APP_DIR
chown -R $USER:$USER $LOG_DIR
chmod 755 $APP_DIR
chmod 755 $LOG_DIR

echo -e "\n${YELLOW}Step 10: Install systemd Service${NC}"
cat > /etc/systemd/system/cis-worker.service << 'EOF'
[Unit]
Description=CIS File Processor Worker
After=network.target

[Service]
Type=simple
User=cis-worker
Group=cis-worker
WorkingDirectory=/opt/cis-file-processor
Environment="PATH=/opt/cis-file-processor/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=/opt/cis-file-processor/venv/bin/python /opt/cis-file-processor/src/main.py
Restart=always
RestartSec=10
StandardOutput=append:/var/log/cis-worker/worker.log
StandardError=append:/var/log/cis-worker/error.log

# Resource Limits
LimitNOFILE=65536
LimitNPROC=4096

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cis-worker.service
echo -e "${GREEN}systemd service installed${NC}"

echo -e "\n${YELLOW}Step 11: Configure CloudWatch Agent${NC}"
# Install CloudWatch Agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
rpm -U ./amazon-cloudwatch-agent.rpm || dpkg -i ./amazon-cloudwatch-agent.deb

# Configure CloudWatch Agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'EOF'
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/cis-worker/worker.log",
            "log_group_name": "/aws/ec2/cis-file-processor",
            "log_stream_name": "{instance_id}/worker",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/log/cis-worker/error.log",
            "log_group_name": "/aws/ec2/cis-file-processor",
            "log_stream_name": "{instance_id}/error",
            "timezone": "UTC"
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
          {
            "name": "cpu_usage_idle",
            "rename": "CPU_IDLE",
            "unit": "Percent"
          },
          "cpu_usage_iowait"
        ],
        "metrics_collection_interval": 60,
        "totalcpu": false
      },
      "disk": {
        "measurement": [
          {
            "name": "used_percent",
            "rename": "DISK_USED",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60,
        "resources": [
          "/"
        ]
      },
      "mem": {
        "measurement": [
          {
            "name": "mem_used_percent",
            "rename": "MEM_USED",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60
      }
    }
  }
}
EOF

# Start CloudWatch Agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

echo -e "${GREEN}CloudWatch Agent configured${NC}"

echo -e "\n${YELLOW}Step 12: Configure Spot Interruption Handler${NC}"
cat > /usr/local/bin/spot-interrupt-handler.sh << 'EOF'
#!/bin/bash
# Spot Instance Interruption Handler

while true; do
    # Check for spot interruption notice
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://169.254.169.254/latest/meta-data/spot/instance-action)

    if [ "$HTTP_CODE" == "200" ]; then
        echo "Spot interruption notice received. Initiating graceful shutdown..."

        # Send SIGTERM to worker process
        systemctl stop cis-worker.service

        # Wait for service to stop (max 30 seconds)
        timeout 30 bash -c 'while systemctl is-active cis-worker.service; do sleep 1; done'

        echo "Worker service stopped gracefully"
        break
    fi

    sleep 5
done
EOF

chmod +x /usr/local/bin/spot-interrupt-handler.sh

# Create systemd service for spot handler
cat > /etc/systemd/system/spot-interrupt-handler.service << 'EOF'
[Unit]
Description=Spot Instance Interruption Handler
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/spot-interrupt-handler.sh
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable spot-interrupt-handler.service
systemctl start spot-interrupt-handler.service

echo -e "${GREEN}Spot interruption handler installed${NC}"

echo -e "\n${YELLOW}Step 13: Configure Log Rotation${NC}"
cat > /etc/logrotate.d/cis-worker << EOF
/var/log/cis-worker/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 cis-worker cis-worker
    sharedscripts
    postrotate
        systemctl reload cis-worker.service > /dev/null 2>&1 || true
    endscript
}
EOF

echo -e "${GREEN}Log rotation configured${NC}"

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Installation Complete!${NC}"
echo -e "${GREEN}========================================${NC}"

echo -e "\n${YELLOW}Next Steps:${NC}"
echo -e "1. Configure environment variables in ${APP_DIR}/.env"
echo -e "2. Test the configuration:"
echo -e "   cd ${APP_DIR}"
echo -e "   source venv/bin/activate"
echo -e "   python verify_aws_config.py"
echo -e "3. Start the service:"
echo -e "   sudo systemctl start cis-worker.service"
echo -e "4. Check service status:"
echo -e "   sudo systemctl status cis-worker.service"
echo -e "5. View logs:"
echo -e "   tail -f ${LOG_DIR}/worker.log"

echo -e "\n${GREEN}Done!${NC}"