# DocuWorks + Bedrock Performance Optimization - Quick Reference

## Quick Decision Matrix

### When to Use What

| Scenario | Solution | Expected Performance |
|----------|----------|---------------------|
| Single document processing | Singleton SDK + Smart page selection | 250ms/doc |
| Batch processing (100+ files) | Pipelined processor | 10 docs/sec |
| Large files (100+ pages) | Chunk processing | 1 sec/doc |
| High queue backlog | Auto-scale to 20 instances | 200 docs/sec total |
| Cost optimization needed | Embedding cache + Spot instances | 60% cost reduction |
| Memory pressure | Auto-restart after 1000 docs | < 85% usage |

---

## Critical Configuration Values

### DocuWorks SDK

```csharp
// Singleton initialization (once per application)
private static readonly DocuWorksSDK _sdk = new DocuWorksSDK();

// License gate (single license constraint)
private readonly SemaphoreSlim _licenseGate = new SemaphoreSlim(1, 1);

// Restart threshold (prevent memory leaks)
private const int RESTART_THRESHOLD = 1000;
```

### Bedrock API

```csharp
// Rate limiting (avoid throttling)
private readonly TokenBucket _tokenBucket = new TokenBucket(10, 10); // 10 req/sec

// Retry configuration
private const int MAX_RETRIES = 5;
private const int BASE_DELAY_MS = 1000; // Exponential backoff

// Image optimization
private const int MAX_DIMENSION = 2048;
private const int JPEG_QUALITY = 85;
```

### OpenSearch

```json
{
  "settings": {
    "number_of_shards": 5,
    "number_of_replicas": 1,
    "refresh_interval": "30s",
    "knn": true,
    "knn.algo_param.ef_search": 100
  },
  "mappings": {
    "properties": {
      "page_embeddings.embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "ef_construction": 512,
          "m": 48
        }
      }
    }
  }
}
```

### Auto Scaling

```yaml
MinSize: 1
MaxSize: 20
TargetValue: 100  # messages per instance

ScaleOutCooldown: 300   # 5 minutes
ScaleInCooldown: 900    # 15 minutes
```

---

## Performance Troubleshooting

### Symptom: Slow Processing (< 5 docs/sec)

**Check:**
1. DocuWorks SDK initialization per document? → Use singleton
2. Processing all pages? → Use smart page selection (max 5 pages)
3. Bedrock throttling? → Check CloudWatch metrics
4. Memory pressure? → Check memory usage, force GC

**Fix:**
```csharp
// Before: 100+ pages × 50ms = 5+ seconds
foreach (var page in doc.AllPages) { /* ... */ }

// After: Max 5 pages = 250ms
var keyPages = SelectKeyPages(doc); // First, middle, last, etc.
foreach (var page in keyPages) { /* ... */ }
```

### Symptom: High Memory Usage (> 85%)

**Check:**
1. Documents not closed? → Always use try/finally
2. Thumbnails in memory? → Clear buffers after upload
3. No GC? → Force GC every 100 docs

**Fix:**
```csharp
try
{
    var doc = _sdk.OpenDocument(filePath);
    var thumbnails = ExtractThumbnails(doc);
    await ProcessThumbnails(thumbnails);
}
finally
{
    doc?.Close();
    thumbnails?.Clear();

    if (_processedCount % 100 == 0)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
    }
}
```

### Symptom: Bedrock Throttling

**Check:**
1. Concurrent requests > 10? → Use SemaphoreSlim
2. No retry logic? → Implement exponential backoff
3. Large images? → Resize to 2048×2048, JPEG 85%

**Fix:**
```csharp
// Rate limiter
await _rateLimiter.WaitAsync(); // Max 10 concurrent

try
{
    // Retry with exponential backoff
    for (int attempt = 0; attempt < MAX_RETRIES; attempt++)
    {
        try
        {
            return await _bedrock.InvokeModelAsync(request);
        }
        catch (ThrottlingException)
        {
            await Task.Delay(BASE_DELAY_MS * (int)Math.Pow(2, attempt));
        }
    }
}
finally
{
    _rateLimiter.Release();
}
```

### Symptom: Queue Backlog Growing

**Check:**
1. Auto Scaling not triggering? → Check CloudWatch alarm
2. At max instances (20)? → Increase MaxSize
3. Processing too slow? → Check per-doc processing time

**Fix:**
```bash
# Check queue metrics
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessagesVisible

# Check Auto Scaling status
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names cis-docuworks-asg

# If at max capacity, increase
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name cis-docuworks-asg \
  --max-size 30
```

### Symptom: High OpenSearch CPU

**Check:**
1. Too many shards? → Reduce to 5
2. Replicas during bulk load? → Set to 0 temporarily
3. ef_search too high? → Reduce to 50 for faster search

**Fix:**
```bash
# During bulk indexing
curl -X PUT "https://opensearch/files/_settings" -d '{
  "index": {
    "refresh_interval": "-1",
    "number_of_replicas": 0
  }
}'

# After bulk indexing
curl -X PUT "https://opensearch/files/_settings" -d '{
  "index": {
    "refresh_interval": "30s",
    "number_of_replicas": 1
  }
}'

curl -X POST "https://opensearch/files/_forcemerge?max_num_segments=1"
```

---

## Cost Optimization Cheat Sheet

### Immediate Actions (No Risk)

1. **Enable S3 Lifecycle**
   ```bash
   aws s3api put-bucket-lifecycle-configuration \
     --bucket cis-filesearch-landing \
     --lifecycle-configuration file://lifecycle.json
   ```

   Savings: $176.95/month (96% reduction on old files)

2. **Use Spot Instances**
   ```yaml
   OnDemandPercentageAboveBaseCapacity: 20%
   SpotAllocationStrategy: capacity-optimized
   ```

   Savings: $2,188.80/month (70% on peak instances)

3. **Cache Embeddings**
   ```csharp
   // Check cache before Bedrock call
   var cached = await _redis.GetAsync<float[]>(cacheKey);
   if (cached != null) return cached;
   ```

   Savings: $297/month (99% on repeat processing)

### Medium-Term Actions (Test First)

4. **Reserved Instances (1-year)**
   - OpenSearch: 5 × r6g.2xlarge RI
   - EC2 Base: 1 × c5.4xlarge RI

   Savings: $921.60/month (40% on fixed capacity)

5. **Right-Size OpenSearch**
   ```bash
   # After initial bulk load, scale down
   aws opensearch update-domain-config \
     --domain-name cis-filesearch \
     --cluster-config InstanceType=r6g.xlarge,InstanceCount=3
   ```

   Savings: $1,270.08/month (reduce to 3 smaller nodes)

### Total Potential Savings

| Optimization | Monthly Savings | Implementation Time |
|--------------|-----------------|---------------------|
| S3 Lifecycle | $176.95 | 10 minutes |
| Spot Instances | $2,188.80 | 1 hour |
| Embedding Cache | $297.00 | 4 hours |
| Reserved Instances | $921.60 | 30 minutes (decision) |
| Right-Size OpenSearch | $1,270.08 | 2 hours (testing) |
| **Total** | **$4,854.43/month** | **~8 hours** |

**ROI: $4,854 × 12 = $58,253/year for 8 hours of work**

---

## Monitoring Quick Commands

### Check System Health

```bash
# Queue depth
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessagesVisible,ApproximateAgeOfOldestMessage

# Auto Scaling status
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names cis-docuworks-asg \
  --query 'AutoScalingGroups[0].{Desired:DesiredCapacity,Min:MinSize,Max:MaxSize,Current:Instances[*].InstanceId}'

# OpenSearch health
curl -X GET "https://opensearch/_cluster/health?pretty"

# Bedrock usage (approximate from CloudWatch)
aws cloudwatch get-metric-statistics \
  --namespace CIS/DocuWorks \
  --metric-name BedrockRequestCount \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

### Check Performance Metrics

```powershell
# From EC2 instance
Get-Counter '\Memory\% Committed Bytes In Use'
Get-Counter '\Processor(_Total)\% Processor Time'
Get-Counter '\LogicalDisk(C:)\Avg. Disk sec/Read'

# Custom metrics
aws cloudwatch get-metric-statistics \
  --namespace CIS/DocuWorks \
  --metric-name DocuWorksProcessingTime \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum
```

### Check Cost (Current Month)

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=SERVICE \
  --filter file://cost-filter.json
```

---

## Emergency Procedures

### Procedure 1: Queue Backlog Critical (> 10,000 messages)

1. **Immediate:** Manually scale to max instances
   ```bash
   aws autoscaling set-desired-capacity \
     --auto-scaling-group-name cis-docuworks-asg \
     --desired-capacity 20
   ```

2. **Check:** Verify instances are starting
   ```bash
   watch -n 10 'aws autoscaling describe-auto-scaling-groups \
     --auto-scaling-group-names cis-docuworks-asg \
     --query "AutoScalingGroups[0].Instances[*].[InstanceId,LifecycleState]"'
   ```

3. **Monitor:** Watch queue depth decrease
   ```bash
   watch -n 30 'aws sqs get-queue-attributes \
     --queue-url $QUEUE_URL \
     --attribute-names ApproximateNumberOfMessagesVisible \
     --query "Attributes.ApproximateNumberOfMessagesVisible"'
   ```

4. **After:** Auto Scaling will scale down after cooldown period

### Procedure 2: High Error Rate (> 10%)

1. **Check DLQ:** Identify error patterns
   ```bash
   aws sqs receive-message \
     --queue-url $DLQ_URL \
     --max-number-of-messages 10
   ```

2. **Common errors and fixes:**
   - "Document cannot be opened": Corrupted file → Skip and log
   - "Bedrock throttling": Rate limit → Already has retry logic
   - "OpenSearch timeout": Cluster overload → Check cluster health

3. **Reprocess DLQ:**
   ```bash
   # After fixing root cause
   aws sqs purge-queue --queue-url $DLQ_URL # or redrive to main queue
   ```

### Procedure 3: Memory Leak Suspected

1. **Check memory usage:**
   ```powershell
   # On EC2 instance
   Get-Process -Name DocuWorksWorker | Select-Object WorkingSet64
   ```

2. **Force restart workers:**
   ```powershell
   # Graceful restart (process current message, then exit)
   Stop-Process -Name DocuWorksWorker -Force
   # Auto Scaling will restart automatically
   ```

3. **Check for improvement:**
   ```bash
   aws cloudwatch get-metric-statistics \
     --namespace CIS/DocuWorks \
     --metric-name MemoryUsagePercent \
     --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 300 \
     --statistics Average
   ```

---

## Performance Benchmarks (Reference)

### Expected Performance

| Metric | Value | Notes |
|--------|-------|-------|
| DocuWorks open | 50-200ms | Depends on file size |
| Thumbnail extraction | 20-50ms/page | Per page |
| Smart page selection | 5 pages max | First, middle, last, etc. |
| Total DocuWorks time | 250ms | Average per document |
| Bedrock embedding | 300ms | Per image (parallel 10) |
| OpenSearch indexing | 50ms | Bulk 500 docs |
| Cache hit rate | 60-70% | Memory + Disk |
| End-to-end latency | 1-2 seconds | P95 |

### Throughput

| Configuration | Docs/Second | Docs/Hour | Docs/Day |
|---------------|-------------|-----------|----------|
| 1 instance | 10 | 36,000 | 864,000 |
| 5 instances | 50 | 180,000 | 4,320,000 |
| 10 instances | 100 | 360,000 | 8,640,000 |
| 20 instances (max) | 200 | 720,000 | 17,280,000 |

**Time to process 5M files:**
- 1 instance: 5.8 days
- 5 instances: 1.2 days
- 10 instances: 14 hours
- 20 instances: 7 hours

---

## Key Takeaways

### Do This (Best Practices)

- ✅ Use singleton DocuWorks SDK instance
- ✅ Implement smart page selection (max 5 pages)
- ✅ Cache embeddings for 90 days
- ✅ Use spot instances for 80% of fleet
- ✅ Enable S3 lifecycle policies
- ✅ Monitor memory usage, restart at threshold
- ✅ Use exponential backoff for Bedrock
- ✅ Bulk index to OpenSearch (500 docs)
- ✅ Pre-warm cache with popular files

### Don't Do This (Common Mistakes)

- ❌ Initialize SDK for each document (50-100ms overhead)
- ❌ Process all pages (waste of time and cost)
- ❌ Skip embedding cache (99% cost waste)
- ❌ Use only on-demand instances (70% cost waste)
- ❌ Keep S3 objects forever (96% cost waste)
- ❌ Ignore memory leaks (will crash)
- ❌ No retry logic for Bedrock (high error rate)
- ❌ Individual OpenSearch inserts (100x slower)
- ❌ Cold cache startup (poor UX)

---

## Contact & Support

**For issues:**
1. Check this quick reference first
2. Review full guide: `docuworks-bedrock-performance-optimization.md`
3. Check CloudWatch logs and metrics
4. Contact: performance-team@example.com

**Document Version:** 1.0
**Last Updated:** 2025-12-02
**Maintained By:** Performance Optimization Team
