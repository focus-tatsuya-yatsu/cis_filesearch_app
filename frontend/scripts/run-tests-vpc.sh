#!/bin/bash
#
# VPC内のEC2インスタンスでテストを実行するスクリプト
# Execute tests from EC2 instance within VPC
#
# このスクリプトは以下を実行します：
# 1. OpenSearch への接続テスト
# 2. 画像検索統合テスト
# 3. E2Eテスト（Playwright）
#
# 前提条件:
# - EC2インスタンスがVPC内に存在
# - OpenSearchエンドポイントへのアクセス権限
# - Node.js, yarn がインストール済み
#
# 実行方法:
# ssh into EC2 instance, then run:
# ./scripts/run-tests-vpc.sh

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Running Tests in VPC Environment                     ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if running inside VPC
if ! curl -s -m 2 http://169.254.169.254/latest/meta-data/instance-id > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Warning: Not running on EC2 instance${NC}"
    echo -e "${YELLOW}This script is designed to run within AWS VPC${NC}"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Environment variables
export VPC_MODE=true
export OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT:-"vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"}
export BASE_URL=${BASE_URL:-"http://localhost:3000"}

echo -e "${YELLOW}Configuration:${NC}"
echo -e "  VPC Mode: ${VPC_MODE}"
echo -e "  OpenSearch Endpoint: ${OPENSEARCH_ENDPOINT}"
echo -e "  Base URL: ${BASE_URL}"
echo ""

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js: $(node --version)${NC}"

if ! command -v yarn &> /dev/null; then
    echo -e "${RED}✗ Yarn is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Yarn: $(yarn --version)${NC}"

if ! command -v curl &> /dev/null; then
    echo -e "${RED}✗ curl is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ curl is available${NC}"

if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}⚠️  jq is not installed. Installing...${NC}"
    sudo yum install -y jq || sudo apt-get install -y jq
fi
echo -e "${GREEN}✓ jq: $(jq --version)${NC}"

echo ""

# Test 1: OpenSearch Connectivity
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Test 1: OpenSearch Connectivity${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if ./scripts/test-opensearch-image-search.sh; then
    echo -e "${GREEN}✓ OpenSearch tests passed${NC}"
else
    echo -e "${RED}✗ OpenSearch tests failed${NC}"
    exit 1
fi

echo ""

# Test 2: Image Search Integration
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Test 2: Image Search Integration${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Start Next.js server in background
echo -e "${BLUE}Starting Next.js development server...${NC}"
yarn dev &
SERVER_PID=$!

# Wait for server to be ready
echo -e "${BLUE}Waiting for server to be ready...${NC}"
sleep 10

# Check if server is running
if ! curl -s http://localhost:3000 > /dev/null; then
    echo -e "${RED}✗ Next.js server failed to start${NC}"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi
echo -e "${GREEN}✓ Next.js server is running${NC}"
echo ""

# Run integration tests
if tsx scripts/test-image-search-integration.ts; then
    echo -e "${GREEN}✓ Integration tests passed${NC}"
    TEST_RESULT=0
else
    echo -e "${RED}✗ Integration tests failed${NC}"
    TEST_RESULT=1
fi

# Stop server
echo ""
echo -e "${BLUE}Stopping Next.js server...${NC}"
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
echo -e "${GREEN}✓ Server stopped${NC}"

if [ $TEST_RESULT -ne 0 ]; then
    exit 1
fi

echo ""

# Test 3: E2E Tests (Playwright) - Optional
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Test 3: E2E Tests (Optional)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

read -p "Run E2E tests with Playwright? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Install Playwright browsers if not already installed
    if ! yarn playwright:install --dry-run 2>/dev/null; then
        echo -e "${BLUE}Installing Playwright browsers...${NC}"
        yarn playwright:install
    fi

    # Start server again
    echo -e "${BLUE}Starting Next.js server for E2E tests...${NC}"
    yarn dev &
    SERVER_PID=$!
    sleep 10

    # Run E2E tests
    if yarn test:e2e; then
        echo -e "${GREEN}✓ E2E tests passed${NC}"
    else
        echo -e "${RED}✗ E2E tests failed${NC}"
        kill $SERVER_PID 2>/dev/null || true
        exit 1
    fi

    # Stop server
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
else
    echo -e "${YELLOW}Skipping E2E tests${NC}"
fi

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  All VPC Tests Completed Successfully                 ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✅ All tests passed!${NC}"
