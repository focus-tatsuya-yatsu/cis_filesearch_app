#!/bin/bash

# Test image search API
echo "Testing image search API..."

response=$(curl -s -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -d '{
    "imageVector": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    "searchType": "image",
    "page": 1,
    "limit": 5
  }')

echo "Full response:"
echo "$response" | jq '.'

echo -e "\nData section:"
echo "$response" | jq '.data'

echo -e "\nError (if any):"
echo "$response" | jq '.error'