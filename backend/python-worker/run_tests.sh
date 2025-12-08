#!/bin/bash

# ==========================================
# Test Runner Script
# Comprehensive test execution for Python Worker
# ==========================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ==========================================
# Helper Functions
# ==========================================

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# ==========================================
# Configuration
# ==========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default options
RUN_UNIT=true
RUN_INTEGRATION=true
RUN_E2E=true
RUN_PERFORMANCE=false
RUN_LINT=true
RUN_COVERAGE=true
PARALLEL=true
FAIL_FAST=false
VERBOSE=false

# ==========================================
# Parse Arguments
# ==========================================

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Options:
    -h, --help              Show this help message
    -a, --all               Run all tests (default)
    -u, --unit              Run only unit tests
    -i, --integration       Run only integration tests
    -e, --e2e               Run only E2E tests
    -p, --performance       Run performance tests
    -l, --lint              Run linting (default: true)
    --no-lint               Skip linting
    -c, --coverage          Generate coverage report (default: true)
    --no-coverage           Skip coverage report
    -f, --fail-fast         Stop on first failure
    -v, --verbose           Verbose output
    --no-parallel           Disable parallel execution
    --quick                 Quick test run (unit only, no lint)

Examples:
    $0                      # Run all tests
    $0 --unit --coverage    # Run unit tests with coverage
    $0 --quick              # Quick unit test run
    $0 --e2e --verbose      # Verbose E2E tests
    $0 --performance        # Run performance benchmarks
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        -a|--all)
            RUN_UNIT=true
            RUN_INTEGRATION=true
            RUN_E2E=true
            shift
            ;;
        -u|--unit)
            RUN_UNIT=true
            RUN_INTEGRATION=false
            RUN_E2E=false
            RUN_PERFORMANCE=false
            shift
            ;;
        -i|--integration)
            RUN_UNIT=false
            RUN_INTEGRATION=true
            RUN_E2E=false
            RUN_PERFORMANCE=false
            shift
            ;;
        -e|--e2e)
            RUN_UNIT=false
            RUN_INTEGRATION=false
            RUN_E2E=true
            RUN_PERFORMANCE=false
            shift
            ;;
        -p|--performance)
            RUN_UNIT=false
            RUN_INTEGRATION=false
            RUN_E2E=false
            RUN_PERFORMANCE=true
            shift
            ;;
        -l|--lint)
            RUN_LINT=true
            shift
            ;;
        --no-lint)
            RUN_LINT=false
            shift
            ;;
        -c|--coverage)
            RUN_COVERAGE=true
            shift
            ;;
        --no-coverage)
            RUN_COVERAGE=false
            shift
            ;;
        -f|--fail-fast)
            FAIL_FAST=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        --no-parallel)
            PARALLEL=false
            shift
            ;;
        --quick)
            RUN_UNIT=true
            RUN_INTEGRATION=false
            RUN_E2E=false
            RUN_PERFORMANCE=false
            RUN_LINT=false
            RUN_COVERAGE=false
            shift
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# ==========================================
# Setup
# ==========================================

print_header "Python Worker Test Suite"

# Check Python version
PYTHON_VERSION=$(python --version 2>&1 | awk '{print $2}')
print_success "Python version: $PYTHON_VERSION"

# Check if dependencies are installed
if ! python -c "import pytest" 2>/dev/null; then
    print_error "pytest not found. Installing dependencies..."
    pip install -r requirements-test.txt
fi

# Create necessary directories
mkdir -p htmlcov
mkdir -p test-results

# ==========================================
# Linting
# ==========================================

if [ "$RUN_LINT" = true ]; then
    print_header "Code Quality Checks"

    # Black
    echo "Running Black (code formatting)..."
    if black --check --diff . 2>&1 | tee test-results/black.log; then
        print_success "Black: Passed"
    else
        print_warning "Black: Some files need formatting (run 'black .' to fix)"
    fi

    # isort
    echo -e "\nRunning isort (import sorting)..."
    if isort --check-only --diff . 2>&1 | tee test-results/isort.log; then
        print_success "isort: Passed"
    else
        print_warning "isort: Some imports need sorting (run 'isort .' to fix)"
    fi

    # Flake8
    echo -e "\nRunning Flake8 (style guide)..."
    if flake8 . --count --statistics 2>&1 | tee test-results/flake8.log; then
        print_success "Flake8: Passed"
    else
        print_warning "Flake8: Found style issues"
    fi

    # Pylint
    echo -e "\nRunning Pylint (static analysis)..."
    pylint **/*.py --exit-zero 2>&1 | tee test-results/pylint.log
    print_success "Pylint: Complete (see test-results/pylint.log)"
fi

# ==========================================
# Build pytest command
# ==========================================

PYTEST_CMD="pytest"
PYTEST_ARGS=""

if [ "$VERBOSE" = true ]; then
    PYTEST_ARGS="$PYTEST_ARGS -v"
fi

if [ "$FAIL_FAST" = true ]; then
    PYTEST_ARGS="$PYTEST_ARGS -x"
fi

if [ "$PARALLEL" = true ]; then
    PYTEST_ARGS="$PYTEST_ARGS -n auto"
fi

if [ "$RUN_COVERAGE" = true ]; then
    PYTEST_ARGS="$PYTEST_ARGS --cov=. --cov-report=html --cov-report=term-missing --cov-report=xml"
fi

# ==========================================
# Unit Tests
# ==========================================

if [ "$RUN_UNIT" = true ]; then
    print_header "Unit Tests"

    $PYTEST_CMD tests/unit \
        $PYTEST_ARGS \
        --junit-xml=test-results/junit-unit.xml \
        -m "unit and not slow"

    if [ $? -eq 0 ]; then
        print_success "Unit tests passed"
    else
        print_error "Unit tests failed"
        exit 1
    fi
fi

# ==========================================
# Integration Tests
# ==========================================

if [ "$RUN_INTEGRATION" = true ]; then
    print_header "Integration Tests"

    $PYTEST_CMD tests/integration \
        $PYTEST_ARGS \
        --junit-xml=test-results/junit-integration.xml \
        -m integration

    if [ $? -eq 0 ]; then
        print_success "Integration tests passed"
    else
        print_error "Integration tests failed"
        exit 1
    fi
fi

# ==========================================
# E2E Tests
# ==========================================

if [ "$RUN_E2E" = true ]; then
    print_header "End-to-End Tests"

    $PYTEST_CMD tests/e2e \
        $PYTEST_ARGS \
        --junit-xml=test-results/junit-e2e.xml \
        -m e2e

    if [ $? -eq 0 ]; then
        print_success "E2E tests passed"
    else
        print_error "E2E tests failed"
        exit 1
    fi
fi

# ==========================================
# Performance Tests
# ==========================================

if [ "$RUN_PERFORMANCE" = true ]; then
    print_header "Performance Tests"

    $PYTEST_CMD tests/performance \
        --benchmark-only \
        --benchmark-json=test-results/benchmark.json \
        -m performance

    if [ $? -eq 0 ]; then
        print_success "Performance tests passed"
    else
        print_error "Performance tests failed"
        exit 1
    fi
fi

# ==========================================
# Coverage Summary
# ==========================================

if [ "$RUN_COVERAGE" = true ]; then
    print_header "Coverage Summary"

    # Display coverage summary
    coverage report

    # Check coverage threshold
    COVERAGE=$(coverage report | tail -1 | awk '{print $NF}' | sed 's/%//')
    THRESHOLD=80

    echo ""
    if (( $(echo "$COVERAGE >= $THRESHOLD" | bc -l) )); then
        print_success "Coverage: ${COVERAGE}% (threshold: ${THRESHOLD}%)"
    else
        print_error "Coverage: ${COVERAGE}% is below threshold of ${THRESHOLD}%"
        exit 1
    fi

    echo ""
    print_success "HTML coverage report: file://$(pwd)/htmlcov/index.html"
fi

# ==========================================
# Summary
# ==========================================

print_header "Test Summary"

echo "Test results saved to: test-results/"
echo ""

if [ "$RUN_UNIT" = true ]; then
    print_success "Unit tests: PASSED"
fi

if [ "$RUN_INTEGRATION" = true ]; then
    print_success "Integration tests: PASSED"
fi

if [ "$RUN_E2E" = true ]; then
    print_success "E2E tests: PASSED"
fi

if [ "$RUN_PERFORMANCE" = true ]; then
    print_success "Performance tests: PASSED"
fi

if [ "$RUN_COVERAGE" = true ]; then
    print_success "Coverage: ${COVERAGE}%"
fi

echo ""
print_success "All tests completed successfully!"

# ==========================================
# Quick Links
# ==========================================

echo ""
echo "Quick Links:"
echo "  Coverage Report: file://$(pwd)/htmlcov/index.html"
echo "  Test Results:    $(pwd)/test-results/"
echo ""
