#!/bin/bash

###############################################################################
# Comprehensive E2E Test Execution Script
# CIS File Search Application - localhost:3000 Testing
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}CIS File Search - Comprehensive E2E Tests${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if development server is running
check_server() {
    echo -e "${YELLOW}[1/7] Checking development server...${NC}"

    if curl -s http://localhost:3000 > /dev/null; then
        echo -e "${GREEN}✓ Development server is running on localhost:3000${NC}"
    else
        echo -e "${RED}✗ Development server is not running${NC}"
        echo -e "${YELLOW}Starting development server...${NC}"
        yarn dev &
        SERVER_PID=$!
        sleep 10
        echo -e "${GREEN}✓ Development server started (PID: $SERVER_PID)${NC}"
    fi
    echo ""
}

# Check environment configuration
check_env() {
    echo -e "${YELLOW}[2/7] Checking environment configuration...${NC}"

    if [ -f .env.local ]; then
        echo -e "${GREEN}✓ .env.local file found${NC}"

        # Check for API Gateway URL
        if grep -q "NEXT_PUBLIC_API_GATEWAY_URL" .env.local; then
            API_URL=$(grep "NEXT_PUBLIC_API_GATEWAY_URL" .env.local | cut -d '=' -f 2)
            echo -e "${GREEN}✓ API Gateway URL configured: $API_URL${NC}"
        else
            echo -e "${RED}✗ NEXT_PUBLIC_API_GATEWAY_URL not found in .env.local${NC}"
            exit 1
        fi
    else
        echo -e "${RED}✗ .env.local file not found${NC}"
        echo -e "${YELLOW}Creating .env.local from .env.example...${NC}"
        cp .env.example .env.local
        echo -e "${YELLOW}Please update .env.local with actual values${NC}"
        exit 1
    fi
    echo ""
}

# Install Playwright if needed
check_playwright() {
    echo -e "${YELLOW}[3/7] Checking Playwright installation...${NC}"

    if yarn playwright --version > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Playwright is installed${NC}"
    else
        echo -e "${YELLOW}Installing Playwright...${NC}"
        yarn playwright:install
        echo -e "${GREEN}✓ Playwright installed${NC}"
    fi
    echo ""
}

# Run text search tests
run_text_search_tests() {
    echo -e "${YELLOW}[4/7] Running Text Search E2E Tests...${NC}"

    if yarn test:e2e e2e/text-search.spec.ts --reporter=list; then
        echo -e "${GREEN}✓ Text search tests passed${NC}"
        ((PASSED_TESTS++))
    else
        echo -e "${RED}✗ Text search tests failed${NC}"
        ((FAILED_TESTS++))
    fi
    ((TOTAL_TESTS++))
    echo ""
}

# Run image search tests
run_image_search_tests() {
    echo -e "${YELLOW}[5/7] Running Image Search E2E Tests...${NC}"

    if yarn test:e2e e2e/image-search.spec.ts --reporter=list; then
        echo -e "${GREEN}✓ Image search tests passed${NC}"
        ((PASSED_TESTS++))
    else
        echo -e "${RED}✗ Image search tests failed${NC}"
        ((FAILED_TESTS++))
    fi
    ((TOTAL_TESTS++))
    echo ""
}

# Run API integration tests
run_api_integration_tests() {
    echo -e "${YELLOW}[6/7] Running API Integration Tests...${NC}"

    if yarn test:e2e e2e/api-integration.spec.ts --reporter=list; then
        echo -e "${GREEN}✓ API integration tests passed${NC}"
        ((PASSED_TESTS++))
    else
        echo -e "${RED}✗ API integration tests failed${NC}"
        ((FAILED_TESTS++))
    fi
    ((TOTAL_TESTS++))
    echo ""
}

# Generate test report
generate_report() {
    echo -e "${YELLOW}[7/7] Generating test report...${NC}"

    REPORT_FILE="test-results/e2e-test-report-$(date +%Y%m%d-%H%M%S).md"
    mkdir -p test-results

    cat > "$REPORT_FILE" <<EOF
# E2E Test Report
**Date**: $(date '+%Y-%m-%d %H:%M:%S')
**Environment**: localhost:3000
**Total Tests**: $TOTAL_TESTS
**Passed**: $PASSED_TESTS
**Failed**: $FAILED_TESTS
**Success Rate**: $(awk "BEGIN {printf \"%.2f\", ($PASSED_TESTS/$TOTAL_TESTS)*100}")%

## Test Results Summary

| Test Suite | Status | Details |
|------------|--------|---------|
| Text Search | $([ $((TOTAL_TESTS >= 1 && PASSED_TESTS >= 1)) -eq 1 ] && echo "✅ PASS" || echo "❌ FAIL") | English and Japanese text search |
| Image Search | $([ $((TOTAL_TESTS >= 2 && PASSED_TESTS >= 2)) -eq 1 ] && echo "✅ PASS" || echo "❌ FAIL") | Image upload and search |
| API Integration | $([ $((TOTAL_TESTS >= 3 && PASSED_TESTS >= 3)) -eq 1 ] && echo "✅ PASS" || echo "❌ FAIL") | Frontend-backend integration |

## Known Issues

- Japanese text search may return 500 error (under investigation)
- Image search using mock embeddings in development

## Next Steps

1. Review failed test screenshots in playwright-report/
2. Check CloudWatch logs for Lambda errors
3. Verify OpenSearch index configuration
4. Re-run failed tests with --debug flag

## Detailed Test Output

See Playwright HTML report: \`yarn test:e2e:report\`

EOF

    echo -e "${GREEN}✓ Test report generated: $REPORT_FILE${NC}"
    echo ""
}

# Print summary
print_summary() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Test Execution Summary${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "Total Tests:  $TOTAL_TESTS"
    echo -e "${GREEN}Passed:       $PASSED_TESTS${NC}"

    if [ $FAILED_TESTS -gt 0 ]; then
        echo -e "${RED}Failed:       $FAILED_TESTS${NC}"
    else
        echo -e "Failed:       $FAILED_TESTS"
    fi

    SUCCESS_RATE=$(awk "BEGIN {printf \"%.2f\", ($PASSED_TESTS/$TOTAL_TESTS)*100}")
    echo -e "Success Rate: ${SUCCESS_RATE}%"
    echo ""

    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "${GREEN}🎉 All tests passed!${NC}"
    else
        echo -e "${YELLOW}⚠️  Some tests failed. Review the report for details.${NC}"
        echo -e "${YELLOW}Run 'yarn test:e2e:report' to view detailed results${NC}"
    fi
    echo ""
}

# Main execution
main() {
    check_server
    check_env
    check_playwright
    run_text_search_tests
    run_image_search_tests
    run_api_integration_tests
    generate_report
    print_summary

    # Exit with error if tests failed
    if [ $FAILED_TESTS -gt 0 ]; then
        exit 1
    fi
}

# Run main function
main
