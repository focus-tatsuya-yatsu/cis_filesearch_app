# Image Vector Search API Documentation

## Overview

The Image Vector Search API extends the CIS File Search system with similarity-based image search capabilities using CLIP embeddings and OpenSearch k-NN.

## Base URL

```
Production: https://api.cis-filesearch.com/v1
Staging: https://staging-api.cis-filesearch.com/v1
```

## Authentication

All endpoints require Cognito JWT token:

```
Authorization: Bearer <JWT_TOKEN>
```

---

## Endpoints

### 1. Generate Image Embedding

Generate a vector embedding from an uploaded or existing image.

**Endpoint:** `POST /api/image-embedding`

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>
```

**Request Body:**

Option A: S3 URL
```json
{
  "imageUrl": "s3://cis-filesearch-bucket/images/photo.jpg",
  "useCache": true
}
```

Option B: Base64 Image
```json
{
  "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "useCache": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "embedding": [0.123, -0.456, 0.789, ...],  // 512 dimensions
    "dimension": 512,
    "model": "openai/clip-vit-base-patch32",
    "inferenceTime": 1.234,
    "cached": false,
    "imageHash": "abc123..."
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "EMBEDDING_ERROR",
    "message": "Failed to generate embedding: Image format not supported"
  }
}
```

**Status Codes:**
- `200 OK`: Embedding generated successfully
- `400 Bad Request`: Invalid request parameters
- `401 Unauthorized`: Missing or invalid JWT token
- `500 Internal Server Error`: Embedding generation failed

**Rate Limits:**
- 100 requests per minute per user
- 1000 requests per hour per user

**Example Usage:**

```bash
# Generate embedding from S3 image
curl -X POST "https://api.cis-filesearch.com/v1/api/image-embedding" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "s3://cis-filesearch-bucket/test.jpg",
    "useCache": true
  }'
```

```typescript
// Frontend example
import { fetchAuthSession } from 'aws-amplify/auth';

async function generateEmbedding(imageFile: File): Promise<number[]> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();

  // Convert file to base64
  const base64 = await fileToBase64(imageFile);

  const response = await fetch('/api/image-embedding', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imageBase64: base64,
      useCache: true,
    }),
  });

  const result = await response.json();
  return result.data.embedding;
}
```

---

### 2. Search with Vector (Enhanced Search Endpoint)

Search files using text, image vectors, or both.

**Endpoint:** `GET /api/search`

**Request Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | No* | Text search query |
| `imageEmbedding` | number[] | No* | 512-dimensional vector (JSON array) |
| `searchMode` | string | No | `and` or `or` (default: `or`) |
| `similarityThreshold` | number | No | Minimum cosine similarity (0-1, default: 0.9) |
| `fileType` | string | No | Filter by file type (e.g., `jpg`, `png`, `pdf`) |
| `dateFrom` | string | No | Start date (ISO 8601) |
| `dateTo` | string | No | End date (ISO 8601) |
| `page` | number | No | Page number (default: 1) |
| `limit` | number | No | Results per page (1-100, default: 20) |
| `sortBy` | string | No | Sort field: `relevance`, `date`, `name`, `size` |
| `sortOrder` | string | No | Sort order: `asc`, `desc` (default: `desc`) |

\* At least one of `q` or `imageEmbedding` is required

**Search Modes:**

1. **Text-only Search:**
```
GET /api/search?q=meeting+notes&limit=20
```

2. **Image-only Search:**
```
GET /api/search?imageEmbedding=[0.1,0.2,...]&similarityThreshold=0.9
```

3. **Hybrid Search (Text + Image):**
```
GET /api/search?q=presentation&imageEmbedding=[0.1,0.2,...]&similarityThreshold=0.85
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "file_123",
        "fileName": "project_presentation.jpg",
        "filePath": "/projects/2024/presentation.jpg",
        "fileType": "jpg",
        "fileSize": 2048576,
        "modifiedDate": "2024-01-15T10:30:00Z",
        "snippet": "Project overview and key metrics...",
        "relevanceScore": 0.95,
        "textScore": 0.85,
        "imageScore": 0.98,
        "thumbnailUrl": "https://cdn.example.com/thumbnails/file_123.jpg",
        "highlights": {
          "fileName": ["project <mark>presentation</mark>"],
          "extractedText": ["key <mark>metrics</mark> for Q1"]
        }
      }
    ],
    "pagination": {
      "total": 142,
      "page": 1,
      "limit": 20,
      "totalPages": 8
    },
    "query": {
      "textQuery": "presentation",
      "hasImageQuery": true,
      "similarityThreshold": 0.85,
      "searchMode": "or"
    },
    "took": 234
  }
}
```

**Score Explanation:**

- `relevanceScore`: Overall relevance (0-1, higher is better)
- `textScore`: Text match score (only if text query provided)
- `imageScore`: Visual similarity score (only if image embedding provided)

**Filtering:**

```bash
# Filter by file type and date range
GET /api/search?q=report&fileType=pdf&dateFrom=2024-01-01&dateTo=2024-12-31

# Filter by similarity threshold
GET /api/search?imageEmbedding=[...]&similarityThreshold=0.95
```

**Sorting:**

```bash
# Sort by date (newest first)
GET /api/search?q=meeting&sortBy=date&sortOrder=desc

# Sort by file size (largest first)
GET /api/search?q=video&fileType=mp4&sortBy=size&sortOrder=desc

# Sort by relevance (default)
GET /api/search?q=document&sortBy=relevance
```

**Pagination:**

```bash
# Get first page (20 results)
GET /api/search?q=report&page=1&limit=20

# Get second page
GET /api/search?q=report&page=2&limit=20

# Get 50 results per page
GET /api/search?q=large+dataset&limit=50
```

**Error Responses:**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_QUERY",
    "message": "Image embedding must have 512 dimensions, got 256"
  }
}
```

```json
{
  "success": false,
  "error": {
    "code": "OPENSEARCH_UNAVAILABLE",
    "message": "Search service is temporarily unavailable"
  }
}
```

**Status Codes:**
- `200 OK`: Search completed successfully
- `400 Bad Request`: Invalid query parameters
- `401 Unauthorized`: Missing or invalid JWT token
- `503 Service Unavailable`: OpenSearch unavailable

**Rate Limits:**
- 60 requests per minute per user
- 1000 requests per hour per user

**Example Usage:**

```bash
# Text search
curl "https://api.cis-filesearch.com/v1/api/search?q=meeting+notes&limit=10" \
  -H "Authorization: Bearer $JWT_TOKEN"

# Image search
EMBEDDING="[0.1,0.2,0.3,...]"  # 512 dimensions
curl "https://api.cis-filesearch.com/v1/api/search?imageEmbedding=${EMBEDDING}&similarityThreshold=0.9" \
  -H "Authorization: Bearer $JWT_TOKEN"

# Hybrid search
curl "https://api.cis-filesearch.com/v1/api/search?q=chart&imageEmbedding=${EMBEDDING}" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

```typescript
// Frontend example
import { fetchAuthSession } from 'aws-amplify/auth';

interface SearchParams {
  query?: string;
  imageEmbedding?: number[];
  similarityThreshold?: number;
  fileType?: string;
  page?: number;
  limit?: number;
}

async function searchFiles(params: SearchParams) {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();

  // Build query string
  const queryParams = new URLSearchParams();
  if (params.query) queryParams.set('q', params.query);
  if (params.imageEmbedding) {
    queryParams.set('imageEmbedding', JSON.stringify(params.imageEmbedding));
  }
  if (params.similarityThreshold) {
    queryParams.set('similarityThreshold', params.similarityThreshold.toString());
  }
  if (params.fileType) queryParams.set('fileType', params.fileType);
  if (params.page) queryParams.set('page', params.page.toString());
  if (params.limit) queryParams.set('limit', params.limit.toString());

  const response = await fetch(`/api/search?${queryParams}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return await response.json();
}

// Usage examples
// 1. Text search
const textResults = await searchFiles({ query: 'meeting notes', limit: 20 });

// 2. Image search
const imageEmbedding = await generateEmbedding(imageFile);
const imageResults = await searchFiles({
  imageEmbedding,
  similarityThreshold: 0.9,
});

// 3. Hybrid search
const hybridResults = await searchFiles({
  query: 'presentation',
  imageEmbedding,
  similarityThreshold: 0.85,
});
```

---

## Search Strategies

### 1. Pure Text Search
Best for: Document search, file name search

```typescript
const results = await searchFiles({
  query: 'quarterly report 2024',
  fileType: 'pdf',
  sortBy: 'relevance',
});
```

### 2. Pure Image Search
Best for: Finding visually similar images, duplicate detection

```typescript
const embedding = await generateEmbedding(uploadedImage);
const results = await searchFiles({
  imageEmbedding: embedding,
  similarityThreshold: 0.95,  // High threshold for near-duplicates
  fileType: 'jpg',
});
```

### 3. Hybrid Search
Best for: Complex queries combining visual and textual information

```typescript
const embedding = await generateEmbedding(chartImage);
const results = await searchFiles({
  query: 'sales chart',
  imageEmbedding: embedding,
  similarityThreshold: 0.85,  // Lower threshold for semantic similarity
});
```

### 4. Filtered Search
Best for: Narrowing down results by metadata

```typescript
const results = await searchFiles({
  query: 'meeting',
  dateFrom: '2024-01-01',
  dateTo: '2024-12-31',
  fileType: 'docx',
  sortBy: 'date',
  sortOrder: 'desc',
});
```

---

## Best Practices

### Image Embedding Generation

1. **Use Caching:** Always set `useCache: true` for better performance
2. **Image Size:** Resize large images before upload (max 2048x2048)
3. **Supported Formats:** JPG, PNG, GIF, BMP, TIFF
4. **Batch Processing:** Use batch APIs for bulk operations

### Search Optimization

1. **Similarity Threshold:**
   - `0.95-1.0`: Near-duplicates only
   - `0.85-0.95`: Similar images (recommended)
   - `0.70-0.85`: Semantically similar
   - `< 0.70`: Too broad, many false positives

2. **Pagination:** Use reasonable page sizes (20-50) for best performance

3. **Filtering:** Apply filters (fileType, date) to reduce search space

4. **Hybrid Search:** Combine text and image for best accuracy

### Error Handling

```typescript
async function searchWithRetry(params: SearchParams, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await searchFiles(params);
    } catch (error: any) {
      if (error.code === 'OPENSEARCH_UNAVAILABLE' && i < maxRetries - 1) {
        // Exponential backoff
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      throw error;
    }
  }
}
```

---

## Performance Considerations

### Latency

| Operation | Expected Latency (p95) |
|-----------|------------------------|
| Generate Embedding (cache miss) | < 2000ms |
| Generate Embedding (cache hit) | < 100ms |
| Text Search | < 300ms |
| Vector Search | < 500ms |
| Hybrid Search | < 700ms |

### Throughput

| Endpoint | Rate Limit |
|----------|------------|
| /api/image-embedding | 100 req/min |
| /api/search | 60 req/min |

### Cost Optimization

1. **Cache embeddings** for frequently accessed images
2. **Batch requests** when possible
3. **Use pagination** instead of fetching all results
4. **Filter early** to reduce search space

---

## Security

### Data Privacy

- All image data is encrypted at rest (S3) and in transit (HTTPS)
- Embeddings do not contain original image data
- Cache entries automatically expire after 30 days

### Access Control

- All endpoints require JWT authentication
- Users can only search files they have permission to access
- Rate limiting prevents abuse

### Audit Logging

All search queries are logged with:
- User ID and email
- Query parameters
- Timestamp
- Result count

---

## Troubleshooting

### Common Issues

**Issue:** "Image embedding must have 512 dimensions"
**Solution:** Ensure you're passing the complete embedding array

**Issue:** "Search service is temporarily unavailable"
**Solution:** Retry with exponential backoff, check OpenSearch status

**Issue:** "No results found" with high similarity threshold
**Solution:** Lower the similarityThreshold to 0.85-0.90

**Issue:** Slow search performance
**Solution:**
- Add more filters (fileType, date range)
- Reduce page size
- Check OpenSearch cluster health

---

## Changelog

### v1.1.0 (2024-01-15)
- Added image vector search support
- Added `imageEmbedding` parameter to search endpoint
- Added `/api/image-embedding` endpoint
- Added `similarityThreshold` parameter
- Added `textScore` and `imageScore` to results

### v1.0.0 (2023-12-01)
- Initial release
- Text-based search
- File type and date filtering
- Pagination and sorting

---

## Support

For API issues or questions:
- Email: api-support@cis-filesearch.com
- Slack: #api-support
- Documentation: https://docs.cis-filesearch.com

## Related Documentation

- [Deployment Guide](./IMAGE_VECTOR_SEARCH_DEPLOYMENT.md)
- [Architecture Design](./IMAGE_VECTOR_SEARCH_ARCHITECTURE.md)
- [Frontend Integration Guide](../../frontend/docs/IMAGE_SEARCH_INTEGRATION.md)
