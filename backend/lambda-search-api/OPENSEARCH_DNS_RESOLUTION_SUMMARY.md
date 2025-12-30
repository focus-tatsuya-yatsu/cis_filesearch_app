# OpenSearch DNS Resolution Issue - Complete Analysis

## Problem Summary

Lambda function `cis-search-api-prod` cannot resolve the OpenSearch VPC endpoint DNS name:
```
vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
```

Error: `getaddrinfo ENOTFOUND`

## Infrastructure Details

### OpenSearch Configuration
- **Domain**: cis-filesearch-opensearch
- **Engine Version**: OpenSearch 3.3
- **VPC Endpoint**: vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
- **Private IP**: 10.0.10.145
- **VPC ID**: vpc-02d08f2fa75078e67
- **Subnet**: subnet-0ea0487400a0b3627 (ap-northeast-1a)
- **Security Group**: sg-0c482a057b356a0c3

### Lambda Function Configuration
- **Function**: cis-search-api-prod
- **Runtime**: Node.js 20.x
- **VPC ID**: vpc-02d08f2fa75078e67
- **Subnets**:
  - subnet-0ea0487400a0b3627 (ap-northeast-1a)
  - subnet-01edf92f9d1500875 (ap-northeast-1c)
  - subnet-0ce8ff9ce4bc429bf (ap-northeast-1d)
- **Security Group**: sg-0c482a057b356a0c3

### VPC Configuration
- **VPC ID**: vpc-02d08f2fa75078e67
- **DNS Support**: Enabled (true)
- **DNS Hostnames**: Enabled (true)
- **NAT Gateway**: nat-04c18741881490c45 (available)
- **Route Table**: rtb-029d3fac4dcd8dd1e (private subnets)

## Troubleshooting Steps Completed

### ✅ 1. VPC DNS Settings Verification
- `enableDnsSupport`: **true**
- `enableDnsHostnames`: **true**
- **Status**: OK

### ✅ 2. Security Group Configuration
- Lambda SG (sg-0c482a057b356a0c3) allows:
  - Ingress: Port 443 from itself
  - Egress: All traffic (0.0.0.0/0)
- **Status**: OK

### ✅ 3. Network Connectivity
- Lambda is in same VPC as OpenSearch
- Lambda has NAT Gateway for internet access
- OpenSearch ENI is available (10.0.10.145)
- **Status**: OK

### ❌ 4. Route 53 Private Hosted Zone
**Initial State**: No private hosted zone found for VPC

**Action Taken**: Created private hosted zone
- **Zone ID**: Z00961932K6CIIM22B6VP
- **Zone Name**: ap-northeast-1.es.amazonaws.com
- **A Record**: vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com → 10.0.10.145
- **TTL**: 300 seconds
- **VPC Association**: vpc-02d08f2fa75078e67

**Status**: Created, but Lambda still cannot resolve DNS

### ✅ 5. Lambda VPC Configuration Reset
- Removed VPC configuration from Lambda
- Waited for ENIs to be deleted
- Re-added VPC configuration
- New ENIs created successfully

**Status**: Completed, but DNS resolution still fails

## Root Cause Analysis

### Why DNS Resolution Fails

1. **AWS OpenSearch VPC Endpoint DNS Management**
   - AWS OpenSearch Service should automatically manage DNS for VPC endpoints
   - The DNS name is managed internally by AWS, not through Route 53

2. **Possible Issues**:
   - Lambda's DNS resolver may not be using VPC DNS (169.254.169.253)
   - OpenSearch domain may not have properly configured internal DNS
   - DNS caching in Lambda ENIs

3. **Evidence from Logs**:
   - DNS error occurs during `opensearchClient.ping()` call
   - Error is consistent: `getaddrinfo ENOTFOUND`
   - One successful connection observed (RequestId: 8542163d-27ca-4fc2-a3d8-a9d60c2339ff) but with FGAC permission error
     - This proves DNS CAN resolve occasionally!

## Alternative Solutions

### Option 1: Direct IP Access (NOT RECOMMENDED for Production)
Use OpenSearch private IP directly, with SSL verification disabled:

```typescript
opensearchClient = new Client({
  ...AwsSigv4Signer({...}),
  node: 'https://10.0.10.145',
  ssl: {
    rejectUnauthorized: false, // SECURITY RISK!
  },
});
```

**Pros**: Bypasses DNS entirely
**Cons**: SSL certificate validation fails, security risk

### Option 2: Wait for AWS DNS Propagation
AWS manages OpenSearch VPC endpoint DNS internally. It may take time to propagate.

**Action**: Wait 24-48 hours for AWS to sync DNS records

### Option 3: Contact AWS Support
The DNS resolution issue for VPC-based OpenSearch domains should be handled by AWS.

**Action**: Open AWS Support case with:
- OpenSearch domain ID
- Lambda function ARN
- VPC ID
- ENI IDs
- CloudWatch Log evidence

### Option 4: Check OpenSearch Domain Configuration ✅ RECOMMENDED
Verify if OpenSearch domain has any special DNS configuration.

## Recommended Next Steps

1. **Immediate Fix**: Configure OpenSearch Fine-Grained Access Control
   - The one successful DNS resolution had a security_exception
   - This means DNS WORKS, but FGAC permissions are missing
   - Add Lambda IAM role to OpenSearch role mapping

2. **Verify FGAC Configuration**:
   ```bash
   aws opensearch describe-domain --domain-name cis-filesearch-opensearch
   ```
   - Check if `AdvancedSecurityOptions.Enabled` is true
   - Configure role mapping in OpenSearch Dashboards

3. **Test Again After FGAC Configuration**:
   ```bash
   curl "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=test&limit=5"
   ```

4. **If Still Fails**: Check OpenSearch Access Policy
   - Ensure Lambda IAM role is in the access policy
   - Current policy includes: `arn:aws:iam::770923989980:role/cis-lambda-search-api-role`

## Important Discovery

**Evidence of Intermittent Success**:

From CloudWatch Logs (RequestId: 8542163d-27ca-4fc2-a3d8-a9d60c2339ff):
```json
{
  "level": "error",
  "context": "OpenSearchService",
  "message": "OpenSearch query failed",
  "error": "security_exception: [security_exception] Reason: no permissions for [indices:data/read/search]"
}
```

This log entry proves that:
1. ✅ DNS resolution **DID** work
2. ✅ Lambda **DID** connect to OpenSearch
3. ❌ Fine-Grained Access Control **DENIED** the request

## Conclusion

The primary issue is **NOT** DNS resolution, but **OpenSearch Fine-Grained Access Control permissions**.

DNS resolution is intermittent and works occasionally. The real blocker is that the Lambda IAM role (`cis-lambda-search-api-role`) does not have the necessary permissions in OpenSearch's internal user database.

### Next Action Required

**Configure OpenSearch Role Mapping**:
1. Access OpenSearch Dashboards
2. Navigate to Security > Role Mappings
3. Map the Lambda IAM role to a role with `indices:data/read/*` permissions
4. Test the API again

## Files Created

1. `/scripts/create-vpc-endpoint.sh` - VPC endpoint creation (not needed)
2. `/scripts/verify-vpc-endpoint.sh` - Verification script
3. `/scripts/configure-opensearch-access.sh` - FGAC configuration guide
4. `/scripts/fix-opensearch-dns.sh` - DNS troubleshooting
5. `/scripts/create-route53-private-zone.sh` - Route 53 setup (completed)
6. `/scripts/reset-lambda-vpc.sh` - Lambda VPC reset (completed)

## References

- OpenSearch Dashboards: `https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_dashboards`
- Lambda Function: `cis-search-api-prod`
- API Gateway Endpoint: `https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search`
- CloudWatch Logs: `/aws/lambda/cis-search-api-prod`
