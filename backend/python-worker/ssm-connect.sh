#!/bin/bash

# SSM Session Manager Connection Script
# Use this to connect to the worker instance and check logs directly

INSTANCE_ID="i-0e6ac1e4d535a4ab2"
REGION="ap-northeast-1"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== SSM Session Manager Tools ===${NC}\n"

show_menu() {
  echo "Select an option:"
  echo "1) Start interactive session"
  echo "2) View worker.log (tail -100)"
  echo "3) View worker.log (full)"
  echo "4) Check Python process status"
  echo "5) Check network connectivity to OpenSearch"
  echo "6) View supervisor status"
  echo "7) Check disk space and memory"
  echo "8) View recent processed files"
  echo "9) Port forward to OpenSearch (local:9200 -> OpenSearch)"
  echo "0) Exit"
  echo -n "Enter choice: "
}

execute_command() {
  local cmd="$1"
  local desc="$2"

  echo -e "\n${YELLOW}$desc${NC}"
  COMMAND_ID=$(aws ssm send-command \
    --instance-ids $INSTANCE_ID \
    --region $REGION \
    --document-name "AWS-RunShellScript" \
    --comment "$desc" \
    --parameters "commands=[\"$cmd\"]" \
    --query 'Command.CommandId' \
    --output text)

  if [ $? -eq 0 ]; then
    echo "Command ID: $COMMAND_ID"
    echo "Waiting for command to complete..."
    sleep 3

    aws ssm get-command-invocation \
      --command-id $COMMAND_ID \
      --instance-id $INSTANCE_ID \
      --region $REGION \
      --query 'StandardOutputContent' \
      --output text
  else
    echo -e "${RED}Failed to send command${NC}"
  fi
}

while true; do
  show_menu
  read choice

  case $choice in
    1)
      echo -e "${GREEN}Starting interactive session...${NC}"
      aws ssm start-session --target $INSTANCE_ID --region $REGION
      ;;
    2)
      execute_command "tail -100 /var/log/worker.log" "Viewing last 100 lines of worker.log"
      ;;
    3)
      execute_command "cat /var/log/worker.log" "Viewing full worker.log"
      ;;
    4)
      execute_command "ps aux | grep -i python; echo '---'; supervisorctl status" "Checking Python processes"
      ;;
    5)
      execute_command "curl -v https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cluster/health 2>&1" "Testing OpenSearch connectivity"
      ;;
    6)
      execute_command "sudo supervisorctl status" "Checking supervisor status"
      ;;
    7)
      execute_command "df -h; echo '---'; free -h; echo '---'; top -bn1 | head -20" "System resources"
      ;;
    8)
      execute_command "grep -i 'indexed to opensearch' /var/log/worker.log | tail -20" "Recent processed files"
      ;;
    9)
      echo -e "${GREEN}Setting up port forwarding...${NC}"
      echo "Local port 9200 -> OpenSearch"
      echo "After starting, you can access OpenSearch at: http://localhost:9200"
      echo ""
      aws ssm start-session \
        --target $INSTANCE_ID \
        --region $REGION \
        --document-name AWS-StartPortForwardingSessionToRemoteHost \
        --parameters "{\"host\":[\"vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com\"],\"portNumber\":[\"443\"],\"localPortNumber\":[\"9200\"]}"
      ;;
    0)
      echo -e "${GREEN}Exiting...${NC}"
      exit 0
      ;;
    *)
      echo -e "${RED}Invalid option${NC}"
      ;;
  esac

  echo ""
  read -p "Press Enter to continue..."
  echo ""
done
