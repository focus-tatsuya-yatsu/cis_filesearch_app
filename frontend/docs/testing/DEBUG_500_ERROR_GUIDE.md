# Japanese Text Search 500 Error - Debugging Guide

## Problem Description

**Symptom**: Text search with Japanese characters (e.g., "宇都宮") returns 500 error
**Location**: Error occurs at `src/app/api/search/route.ts:96`
**Status**: CRITICAL - Blocking Japanese text search functionality

## Error Analysis

### Line 96 Context
```typescript
if (!apiResponse.ok) {
  const errorData = await apiResponse.json().catch(() => ({}));
  throw new Error(errorData.error?.message || `API Gateway error: ${apiResponse.status}`);
}
```

### Potential Root Causes

1. **URL Encoding Issue**
   - Japanese characters not properly encoded in query string
   - API Gateway may reject improperly encoded URLs
   - Solution: Verify `encodeURIComponent()` is used

2. **Lambda Function Error**
   - Lambda receiving malformed query parameters
   - OpenSearch query fails with Japanese text
   - Solution: Check Lambda CloudWatch logs

3. **API Gateway Configuration**
   - Missing UTF-8 encoding support
   - Request validation rules blocking Japanese characters
   - Solution: Review API Gateway settings

4. **OpenSearch Index Issue**
   - Index not configured for Japanese text analysis
   - Analyzer missing for Japanese tokenization
   - Solution: Verify index mappings

## Debugging Steps

### Step 1: Check Browser Network Tab

```bash
# Open browser DevTools (Chrome/Firefox)
# Navigate to Network tab
# Filter: /api/search
# Perform search with "宇都宮"
# Check:
# - Request URL encoding
# - Request headers (Content-Type, Accept)
# - Response status and body
```

**Expected Request URL**:
```
/api/search?q=%E5%AE%87%E9%83%BD%E5%AE%AE&searchMode=or&page=1&limit=20&sortBy=relevance&sortOrder=desc
```

### Step 2: Check Lambda CloudWatch Logs

```bash
# AWS CLI command to fetch recent logs
aws logs tail /aws/lambda/cis-search-api-prod --follow

# Or use AWS Console:
# 1. Go to CloudWatch > Log groups
# 2. Find /aws/lambda/cis-search-api-prod
# 3. Check latest log stream
# 4. Search for errors around timestamp of 500 error
```

**Look for**:
- JSON parsing errors
- OpenSearch connection errors
- IAM permission errors
- Query syntax errors

### Step 3: Test Lambda Function Directly

```bash
# Create test event
cat > test-event.json <<EOF
{
  "queryStringParameters": {
    "q": "宇都宮",
    "searchMode": "or",
    "page": "1",
    "limit": "20"
  },
  "httpMethod": "GET"
}
EOF

# Invoke Lambda
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload file://test-event.json \
  --region ap-northeast-1 \
  response.json

# Check response
cat response.json | jq .
```

### Step 4: Test OpenSearch Directly

```bash
# Get OpenSearch endpoint
OPENSEARCH_ENDPOINT="https://search-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com"

# Test search with Japanese text
curl -X POST "${OPENSEARCH_ENDPOINT}/cis-files/_search" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -d '{
    "query": {
      "multi_match": {
        "query": "宇都宮",
        "fields": ["file_name", "content", "file_path"]
      }
    }
  }'
```

### Step 5: Check API Gateway Logs

```bash
# Enable API Gateway logging if not already enabled
aws apigatewayv2 get-stage \
  --api-id 5xbn3ng31f \
  --stage-name default

# Check CloudWatch logs for API Gateway
aws logs tail /aws/apigateway/5xbn3ng31f --follow
```

### Step 6: Add Debug Logging

**Edit `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/app/api/search/route.ts`**:

```typescript
// Add before line 87
console.log('[DEBUG] Search params:', {
  query,
  searchMode,
  fileType,
  page,
  limit,
  queryString: queryParams.toString()
});

// Add after line 92
console.log('[DEBUG] API Response:', {
  status: apiResponse.status,
  statusText: apiResponse.statusText,
  headers: Object.fromEntries(apiResponse.headers.entries())
});

// Add in catch block
console.error('[DEBUG] Full error:', {
  message: error.message,
  stack: error.stack,
  apiUrl: apiGatewayUrl,
  queryParams: queryParams.toString()
});
```

## Common Fixes

### Fix 1: Ensure Proper URL Encoding

```typescript
// In route.ts, verify encoding
const queryParams = new URLSearchParams();
if (query) queryParams.append('q', query); // encodeURIComponent is automatic

// Double-check the final URL
const finalUrl = `${apiGatewayUrl}?${queryParams.toString()}`;
console.log('Final API URL:', finalUrl);
```

### Fix 2: Update Lambda to Handle Japanese Text

```javascript
// In Lambda index.js
exports.handler = async (event) => {
  console.log('Raw event:', JSON.stringify(event));

  // Decode query parameter
  const query = decodeURIComponent(params.q || '');
  console.log('Decoded query:', query);

  // Rest of handler...
};
```

### Fix 3: Configure OpenSearch Japanese Analyzer

```bash
# Create or update index with Japanese analyzer
curl -X PUT "${OPENSEARCH_ENDPOINT}/cis-files" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -d '{
    "settings": {
      "analysis": {
        "analyzer": {
          "japanese_analyzer": {
            "type": "custom",
            "tokenizer": "kuromoji_tokenizer",
            "filter": ["kuromoji_baseform", "kuromoji_part_of_speech", "cjk_width", "lowercase"]
          }
        }
      }
    },
    "mappings": {
      "properties": {
        "file_name": {
          "type": "text",
          "analyzer": "japanese_analyzer"
        },
        "content": {
          "type": "text",
          "analyzer": "japanese_analyzer"
        }
      }
    }
  }'
```

### Fix 4: Add Error Handling in Frontend

```typescript
// Wrap API call in try-catch with detailed error
try {
  const apiResponse = await fetch(`${apiGatewayUrl}?${queryParams.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Charset': 'utf-8'
    },
  });

  console.log('API Response Status:', apiResponse.status);

  if (!apiResponse.ok) {
    // Get error details
    const errorText = await apiResponse.text();
    console.error('API Error Response:', errorText);

    let errorData;
    try {
      errorData = JSON.parse(errorText);
    } catch (e) {
      errorData = { error: errorText };
    }

    throw new Error(errorData.error?.message || `API Gateway error: ${apiResponse.status} - ${errorText.substring(0, 100)}`);
  }

  const apiData = await apiResponse.json();
  return NextResponse.json(apiData);

} catch (error: any) {
  console.error('Search API error:', {
    message: error.message,
    stack: error.stack,
    url: apiGatewayUrl,
    query: queryParams.toString()
  });

  return NextResponse.json(
    {
      error: 'Search failed',
      code: 'SEARCH_ERROR',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred during search',
      details: process.env.NODE_ENV === 'development' ? {
        url: apiGatewayUrl,
        query: query,
        stack: error.stack
      } : undefined
    },
    { status: 500 }
  );
}
```

## Verification Steps

After applying fixes:

1. **Test Japanese Search**:
   ```bash
   curl "http://localhost:3000/api/search?q=%E5%AE%87%E9%83%BD%E5%AE%AE&searchMode=or&page=1&limit=20"
   ```

2. **Check Browser Console**:
   - No errors in console
   - Search results displayed or proper error message

3. **Verify Lambda Logs**:
   - No errors in CloudWatch
   - Query properly decoded

4. **Run E2E Tests**:
   ```bash
   yarn test:e2e --grep "Japanese Text Search"
   ```

## Expected Results

✅ **Success Indicators**:
- HTTP 200 response from /api/search
- Japanese results displayed in UI
- CloudWatch shows successful query
- No encoding errors in logs

❌ **Failure Indicators**:
- HTTP 500 error persists
- "API Gateway error" in frontend
- OpenSearch query syntax errors
- IAM permission denied errors

## Related Files

- `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/app/api/search/route.ts` (Line 96)
- `/Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/index.js`
- `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/lib/api/search.ts`

## Next Steps

1. Follow debugging steps in order
2. Document findings in this file
3. Apply appropriate fix based on root cause
4. Run comprehensive E2E tests
5. Monitor production logs for 24 hours

## Contact Points

- **Lambda Function**: `cis-search-api-prod` in ap-northeast-1
- **API Gateway**: `https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search`
- **OpenSearch**: Check OPENSEARCH_ENDPOINT in .env

---

**Last Updated**: 2025-12-19
**Status**: Investigation in progress
