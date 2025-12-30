#!/bin/bash

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

INSTANCE_ID="i-0e6ac1e4d535a4ab2"
QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="file-metadata"
REGION="ap-northeast-1"

echo -e "${GREEN}=== CIS FileSearch Worker Deployment Verification ===${NC}\n"

# 1. Instance Status Check
echo -e "${YELLOW}1. Checking EC2 Instance Status...${NC}"
aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --region $REGION \
  --query 'Reservations[0].Instances[0].[InstanceId,State.Name,LaunchTime,InstanceType,PublicIpAddress,PrivateIpAddress]' \
  --output table

# 2. CloudWatch Logs - Recent Processing
echo -e "\n${YELLOW}2. Checking CloudWatch Logs for File Processing...${NC}"
LOG_GROUP="/aws/ec2/cis-filesearch-worker"
LOG_STREAM=$(aws logs describe-log-streams \
  --log-group-name $LOG_GROUP \
  --region $REGION \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --query 'logStreams[0].logStreamName' \
  --output text)

if [ "$LOG_STREAM" != "None" ] && [ ! -z "$LOG_STREAM" ]; then
  echo -e "${GREEN}Latest log stream: $LOG_STREAM${NC}"

  # Get last 50 log entries
  echo -e "\n${YELLOW}Recent log entries (last 50):${NC}"
  aws logs tail $LOG_GROUP \
    --log-stream-names $LOG_STREAM \
    --region $REGION \
    --follow false \
    --format short \
    | tail -50
else
  echo -e "${RED}No log stream found${NC}"
fi

# 3. Check for Processing Indicators
echo -e "\n${YELLOW}3. Searching for File Processing Indicators in Logs...${NC}"
START_TIME=$(date -u -d '10 minutes ago' +%s)000
aws logs filter-log-events \
  --log-group-name $LOG_GROUP \
  --region $REGION \
  --start-time $START_TIME \
  --filter-pattern '"Processing message" OR "Indexed to OpenSearch" OR "DocuWorks" OR "file type detected"' \
  --query 'events[*].[timestamp,message]' \
  --output table \
  | head -100

# 4. SQS Queue Metrics
echo -e "\n${YELLOW}4. Checking SQS Queue Metrics...${NC}"
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --region $REGION \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
  --query 'Attributes' \
  --output table

# 5. OpenSearch Index Status
echo -e "\n${YELLOW}5. Checking OpenSearch Index...${NC}"
# Note: This requires network access to the VPC
echo "Attempting to check OpenSearch index (requires VPC access or bastion)..."

# Try to get index stats
curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_stats?pretty" 2>/dev/null || \
  echo -e "${RED}Cannot access OpenSearch directly. Use SSM or bastion host.${NC}"

# 6. CloudWatch Metrics for Worker
echo -e "\n${YELLOW}6. CloudWatch Custom Metrics (if available)...${NC}"
aws cloudwatch get-metric-statistics \
  --namespace "CISFileSearch" \
  --metric-name "FilesProcessed" \
  --dimensions Name=WorkerInstance,Value=$INSTANCE_ID \
  --statistics Sum \
  --start-time $(date -u -d '1 hour ago' --iso-8601=seconds) \
  --end-time $(date -u --iso-8601=seconds) \
  --period 300 \
  --region $REGION \
  --output table 2>/dev/null || echo "No custom metrics found yet"

# 7. System Logs via SSM (if SSM agent is running)
echo -e "\n${YELLOW}7. Attempting to fetch recent worker.log via SSM...${NC}"
aws ssm send-command \
  --instance-ids $INSTANCE_ID \
  --region $REGION \
  --document-name "AWS-RunShellScript" \
  --comment "Fetch worker logs" \
  --parameters 'commands=["tail -100 /var/log/worker.log"]' \
  --output json \
  --query 'Command.CommandId' \
  --output text 2>/dev/null | \
  xargs -I {} aws ssm get-command-invocation \
    --command-id {} \
    --instance-id $INSTANCE_ID \
    --region $REGION \
    --query 'StandardOutputContent' \
    --output text 2>/dev/null || \
  echo -e "${RED}SSM not available or agent not running${NC}"

echo -e "\n${GREEN}=== Verification Complete ===${NC}"
