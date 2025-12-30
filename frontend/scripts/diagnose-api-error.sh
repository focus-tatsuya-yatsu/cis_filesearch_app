#!/bin/bash

###############################################################################
# API Error Diagnostic Script
# Quickly diagnose the Japanese text search 500 error
###############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}API Error Diagnostics${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if server is running
echo -e "${YELLOW}[1/6] Checking local development server...${NC}"
if curl -s http://localhost:3000 > /dev/null; then
    echo -e "${GREEN}✓ Server is running on localhost:3000${NC}"
else
    echo -e "${RED}✗ Server is not running${NC}"
    echo -e "${YELLOW}Start the server with: yarn dev${NC}"
    exit 1
fi
echo ""

# Test English search
echo -e "${YELLOW}[2/6] Testing English text search...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "http://localhost:3000/api/search?q=test&searchMode=or&page=1&limit=20")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✓ English search successful (HTTP $HTTP_CODE)${NC}"
    echo "Response preview: $(echo "$BODY" | head -c 100)..."
else
    echo -e "${RED}✗ English search failed (HTTP $HTTP_CODE)${NC}"
    echo "Error: $BODY"
fi
echo ""

# Test Japanese search
echo -e "${YELLOW}[3/6] Testing Japanese text search (宇都宮)...${NC}"
# URL encode Japanese text
JAPANESE_QUERY=$(echo -n "宇都宮" | jq -sRr @uri)
RESPONSE=$(curl -s -w "\n%{http_code}" "http://localhost:3000/api/search?q=${JAPANESE_QUERY}&searchMode=or&page=1&limit=20")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✓ Japanese search successful (HTTP $HTTP_CODE)${NC}"
    echo "Response preview: $(echo "$BODY" | head -c 100)..."
else
    echo -e "${RED}✗ Japanese search failed (HTTP $HTTP_CODE)${NC}"
    echo -e "${RED}This is the known issue!${NC}"
    echo "Error response:"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
fi
echo ""

# Test Lambda directly (if AWS CLI is available)
echo -e "${YELLOW}[4/6] Testing Lambda function directly...${NC}"
if command -v aws &> /dev/null; then
    # Check if .env.local has API Gateway URL
    if [ -f .env.local ]; then
        API_GATEWAY_URL=$(grep "NEXT_PUBLIC_API_GATEWAY_URL" .env.local | cut -d '=' -f 2 | tr -d ' "')

        if [ -n "$API_GATEWAY_URL" ]; then
            echo "API Gateway URL: $API_GATEWAY_URL"

            # Test with English
            echo "Testing Lambda with English query..."
            LAMBDA_RESPONSE=$(curl -s -w "\n%{http_code}" "${API_GATEWAY_URL}?q=test&searchMode=or&page=1&limit=20")
            LAMBDA_CODE=$(echo "$LAMBDA_RESPONSE" | tail -n 1)

            if [ "$LAMBDA_CODE" == "200" ]; then
                echo -e "${GREEN}✓ Lambda responds to English query (HTTP $LAMBDA_CODE)${NC}"
            else
                echo -e "${RED}✗ Lambda failed for English query (HTTP $LAMBDA_CODE)${NC}"
            fi

            # Test with Japanese
            echo "Testing Lambda with Japanese query..."
            LAMBDA_RESPONSE=$(curl -s -w "\n%{http_code}" "${API_GATEWAY_URL}?q=${JAPANESE_QUERY}&searchMode=or&page=1&limit=20")
            LAMBDA_CODE=$(echo "$LAMBDA_RESPONSE" | tail -n 1)
            LAMBDA_BODY=$(echo "$LAMBDA_RESPONSE" | head -n -1)

            if [ "$LAMBDA_CODE" == "200" ]; then
                echo -e "${GREEN}✓ Lambda responds to Japanese query (HTTP $LAMBDA_CODE)${NC}"
                echo -e "${YELLOW}→ Issue is in frontend route handler${NC}"
            else
                echo -e "${RED}✗ Lambda failed for Japanese query (HTTP $LAMBDA_CODE)${NC}"
                echo -e "${YELLOW}→ Issue is in Lambda function or OpenSearch${NC}"
                echo "Lambda error:"
                echo "$LAMBDA_BODY" | jq . 2>/dev/null || echo "$LAMBDA_BODY"
            fi
        else
            echo -e "${YELLOW}⚠ API Gateway URL not configured in .env.local${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ .env.local not found${NC}"
    fi
else
    echo -e "${YELLOW}⚠ AWS CLI not installed, skipping Lambda direct test${NC}"
fi
echo ""

# Check environment configuration
echo -e "${YELLOW}[5/6] Checking environment configuration...${NC}"
if [ -f .env.local ]; then
    echo -e "${GREEN}✓ .env.local exists${NC}"

    if grep -q "NEXT_PUBLIC_API_GATEWAY_URL" .env.local; then
        echo -e "${GREEN}✓ API Gateway URL configured${NC}"
    else
        echo -e "${RED}✗ NEXT_PUBLIC_API_GATEWAY_URL not found${NC}"
    fi

    if grep -q "OPENSEARCH_ENDPOINT" .env.local; then
        echo -e "${GREEN}✓ OpenSearch endpoint configured${NC}"
    else
        echo -e "${YELLOW}⚠ OPENSEARCH_ENDPOINT not found (may use default)${NC}"
    fi
else
    echo -e "${RED}✗ .env.local not found${NC}"
fi
echo ""

# Check browser console for errors
echo -e "${YELLOW}[6/6] Recommendations...${NC}"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "1. Check browser console (F12) when searching for '宇都宮'"
echo "2. Review CloudWatch logs for Lambda function 'cis-search-api-prod'"
echo "3. Verify OpenSearch index 'cis-files' has Japanese analyzer"
echo "4. Check src/app/api/search/route.ts line 96 for error details"
echo ""
echo -e "${BLUE}Debugging Commands:${NC}"
echo "• View frontend logs: Check terminal running 'yarn dev'"
echo "• View Lambda logs: aws logs tail /aws/lambda/cis-search-api-prod --follow"
echo "• Test with curl: curl 'http://localhost:3000/api/search?q=${JAPANESE_QUERY}'"
echo "• Run E2E tests: yarn test:e2e e2e/text-search.spec.ts"
echo ""
echo -e "${BLUE}Documentation:${NC}"
echo "• See: /Users/tatsuya/focus_project/cis_filesearch_app/frontend/docs/testing/DEBUG_500_ERROR_GUIDE.md"
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Diagnostic Summary${NC}"
echo -e "${BLUE}========================================${NC}"
if [ "$HTTP_CODE" == "500" ]; then
    echo -e "${RED}Status: 500 ERROR CONFIRMED${NC}"
    echo -e "${YELLOW}The Japanese text search is failing as reported${NC}"
    echo ""
    echo "Root cause likely:"
    echo "  1. URL encoding issue in frontend route handler"
    echo "  2. Lambda function error with Japanese characters"
    echo "  3. OpenSearch index missing Japanese analyzer"
else
    echo -e "${GREEN}Status: Tests passed or different error${NC}"
fi
echo ""
