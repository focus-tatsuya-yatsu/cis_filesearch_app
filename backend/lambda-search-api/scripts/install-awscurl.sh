#!/bin/bash

# Install awscurl for making signed requests to AWS services
# awscurl is a curl-like tool that automatically signs requests with AWS Signature V4

set -e

echo "Installing awscurl..."

# Check if Python3 is installed
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is required but not installed"
    exit 1
fi

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "ERROR: pip3 is required but not installed"
    exit 1
fi

# Install awscurl
pip3 install --user awscurl

echo ""
echo "awscurl installed successfully!"
echo ""
echo "Usage:"
echo "  awscurl --service es --region ap-northeast-1 https://opensearch-endpoint/_cat/indices"
echo ""
echo "Make sure ~/.local/bin is in your PATH:"
echo "  export PATH=\$PATH:~/.local/bin"
