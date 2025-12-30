# Quick Start: API Gateway 500 Error Diagnostics

## 🚨 Problem

Getting 500 errors when calling the search API:

```
GET /api/search/?q=宇都宮&searchMode=or&page=1&limit=20 500
Search API error: Error: API Gateway error: 500
```

## ⚡ Quick Diagnostic (Start Here)

### Step 1: Run Quick Test (10 seconds)

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
./scripts/quick-test.sh
```

This will immediately tell you if the problem is in:
- ✅ Lambda function (works/fails)
- ✅ API Gateway (works/fails)
- ✅ Recent logs

### Step 2: Interpret Results

**Scenario A: Both Pass ✓✓**
```
✓ Lambda: PASS (Status: 200)
✓ API Gateway: PASS (Status: 200)
```
➜ Issue is transient or browser-specific. Try again from browser.

**Scenario B: Lambda Passes, API Gateway Fails ✓✗**
```
✓ Lambda: PASS (Status: 200)
✗ API Gateway: FAIL (Status: 500)
```
➜ Problem is in API Gateway configuration.

**Action:**
```bash
./scripts/check-api-gateway-integration.sh
```

**Common fixes:**
- Add Lambda permission for API Gateway
- Verify integration type is AWS_PROXY
- Check API Gateway deployment

**Scenario C: Lambda Fails ✗**
```
✗ Lambda: FAIL (Status: 500)
  Error: OpenSearch error: 403 - Forbidden
```
➜ Problem is in Lambda function.

**Action:**
```bash
./scripts/diagnose-api-gateway-500.sh
```

**Common fixes:**
- Check OpenSearch connectivity
- Verify IAM role permissions
- Check environment variables
- Increase timeout

## 🔍 Detailed Testing

### Test Specific Query

If quick test passes but specific queries fail:

```bash
./scripts/test-specific-query.sh
```

This tests:
- Original failing query (宇都宮)
- Different query variations
- GET vs POST methods
- Parameter handling

### Full Diagnostic

For comprehensive analysis:

```bash
./scripts/diagnose-api-gateway-500.sh
```

This tests ALL aspects:
- Lambda text search
- Lambda image search
- API Gateway integration
- OpenSearch connectivity
- Configuration settings
- Permissions

## 🛠️ Common Fixes

### Fix 1: Lambda Timeout

**Symptom:** Task timed out after 3.00 seconds

**Solution:**
```bash
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --timeout 30 \
  --region ap-northeast-1
```

### Fix 2: Missing API Gateway Permission

**Symptom:** Lambda works, API Gateway returns 500

**Check:**
```bash
aws lambda get-policy \
  --function-name cis-search-api-prod \
  --region ap-northeast-1
```

**Fix:**
```bash
aws lambda add-permission \
  --function-name cis-search-api-prod \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:ap-northeast-1:*:5xbn3ng31f/*" \
  --region ap-northeast-1
```

### Fix 3: OpenSearch Connection

**Symptom:** OpenSearch error: 403 or timeout

**Check environment:**
```bash
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --region ap-northeast-1 \
  --query 'Environment.Variables'
```

**Verify:**
- OPENSEARCH_ENDPOINT is set
- Lambda is in correct VPC/subnets
- Security groups allow outbound HTTPS
- IAM role has es:ESHttp* permissions

### Fix 4: Integration Type

**Symptom:** Response format issues

**Check:**
```bash
./scripts/check-api-gateway-integration.sh | grep -A 10 "Integration Details"
```

**Verify:**
- IntegrationType: AWS_PROXY
- PayloadFormatVersion: 2.0 (for HTTP API)

## 📊 Manual Testing

### Test Lambda Directly

```bash
# Create test event
cat > /tmp/test.json <<EOF
{
  "httpMethod": "GET",
  "queryStringParameters": {
    "q": "宇都宮",
    "searchMode": "or",
    "page": "1",
    "limit": "5"
  }
}
EOF

# Invoke
aws lambda invoke \
  --function-name cis-search-api-prod \
  --region ap-northeast-1 \
  --payload file:///tmp/test.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/response.json

# Check response
cat /tmp/response.json | jq '.'
```

**Expected:**
```json
{
  "statusCode": 200,
  "body": "{\"success\":true,\"data\":{...}}"
}
```

### Test API Gateway

```bash
curl -v "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=%E5%AE%87%E9%83%BD%E5%AE%AE&page=1&limit=5"
```

**Expected:** HTTP 200 with JSON response

### Check Logs

```bash
# Get latest logs
aws logs tail /aws/lambda/cis-search-api-prod \
  --region ap-northeast-1 \
  --follow

# Or get specific log stream
LOG_STREAM=$(aws logs describe-log-streams \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --region ap-northeast-1 \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --query 'logStreams[0].logStreamName' \
  --output text)

aws logs get-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --log-stream-name "$LOG_STREAM" \
  --region ap-northeast-1 \
  --limit 50
```

## 📚 Next Steps

### If Quick Test Shows Issue

1. **Lambda Fails:**
   - Review [DIAGNOSTIC_GUIDE.md](DIAGNOSTIC_GUIDE.md)
   - Check OpenSearch connectivity
   - Verify IAM permissions
   - Review CloudWatch logs

2. **API Gateway Fails:**
   - Check integration configuration
   - Verify Lambda permissions
   - Check deployment status
   - Review API Gateway logs

3. **Both Pass:**
   - Test from actual frontend
   - Check CORS configuration
   - Verify request parameters
   - Monitor for intermittent issues

### Enable Monitoring

**Enable API Gateway logging:**
```bash
# Create log group
aws logs create-log-group \
  --log-group-name /aws/apigateway/cis-search-api \
  --region ap-northeast-1

# Update stage
aws apigatewayv2 update-stage \
  --api-id 5xbn3ng31f \
  --stage-name '$default' \
  --access-log-settings DestinationArn=arn:aws:logs:ap-northeast-1:<account-id>:log-group:/aws/apigateway/cis-search-api \
  --region ap-northeast-1
```

**View API Gateway logs:**
```bash
aws logs tail /aws/apigateway/cis-search-api --follow
```

## 🔗 Related Documentation

- [DIAGNOSTIC_GUIDE.md](DIAGNOSTIC_GUIDE.md) - Comprehensive diagnostic procedures
- [scripts/README.md](scripts/README.md) - All available diagnostic scripts
- [README.md](README.md) - Main project documentation

## 💡 Tips

1. **Always start with quick-test.sh** - saves time by identifying the problem area immediately
2. **Check logs** - CloudWatch logs often reveal the exact error
3. **Test incrementally** - test Lambda first, then API Gateway
4. **Document findings** - note what works and what doesn't
5. **Use verbose output** - add `-v` to curl commands for detailed info

## 🆘 Still Having Issues?

If you've tried everything and still have issues:

1. **Collect diagnostic data:**
   ```bash
   ./scripts/diagnose-api-gateway-500.sh > diagnostic-report.txt
   ./scripts/check-api-gateway-integration.sh > integration-report.txt
   aws logs filter-log-events \
     --log-group-name /aws/lambda/cis-search-api-prod \
     --start-time $(date -u -d '1 hour ago' +%s)000 \
     --region ap-northeast-1 > lambda-logs.txt
   ```

2. **Review configuration:**
   - Lambda timeout (should be 30s, not 3s)
   - Lambda memory (should be 512MB+)
   - VPC configuration (if applicable)
   - Security groups
   - IAM roles and policies

3. **Check AWS service status:**
   - https://status.aws.amazon.com/

4. **Try redeploying:**
   ```bash
   # Redeploy Lambda
   cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
   npm run build
   ./scripts/deploy-production.sh

   # Verify
   ./scripts/quick-test.sh
   ```

## ✅ Success Indicators

You know everything is working when:

- ✅ `quick-test.sh` shows all green checkmarks
- ✅ Direct Lambda invocation returns 200
- ✅ API Gateway returns 200
- ✅ Actual search from frontend works
- ✅ Both text and image search work
- ✅ Japanese characters handled correctly
- ✅ Pagination and sorting work
- ✅ No errors in CloudWatch logs

## 🎯 Expected Test Results

### Successful Lambda Response
```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  "body": "{\"success\":true,\"data\":{\"results\":[...],\"total\":10000,\"page\":1,\"limit\":5,\"searchType\":\"text\",\"index\":\"cis-files\"}}"
}
```

### Successful API Gateway Response
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "...",
        "fileName": "【宇都宮】monochrome.ctb",
        "filePath": "s3://...",
        "relevanceScore": 40.225395
      }
    ],
    "total": 10000,
    "page": 1,
    "limit": 5,
    "searchType": "text",
    "index": "cis-files"
  }
}
```

---

**Last Updated:** 2024-12-19
**Status:** Ready for use
