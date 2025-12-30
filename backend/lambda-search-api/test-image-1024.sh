#!/bin/bash

# Generate a 1024-dimension vector filled with 0.1
vector=$(python3 -c "print(','.join(['0.1'] * 1024))")

echo "Testing image search with 1024 dimensions..."

response=$(curl -s -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -d "{
    \"imageVector\": [$vector],
    \"searchType\": \"image\",
    \"page\": 1,
    \"limit\": 5
  }")

echo "Success status:"
echo "$response" | jq '.success'

echo -e "\nTotal results found:"
echo "$response" | jq '.data.total'

echo -e "\nFirst 3 results:"
echo "$response" | jq '.data.results[:3]'
