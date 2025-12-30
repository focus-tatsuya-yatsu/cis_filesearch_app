# CIS File Search Application - E2E Test Strategy

## Overview

This document outlines the comprehensive End-to-End (E2E) testing strategy for the CIS File Search Application running on localhost:3000 with backend Lambda function integration.

## Test Environment

- **Frontend**: Next.js 15 on localhost:3000
- **Backend**: AWS Lambda (`cis-search-api-prod`)
- **API Gateway**: https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
- **Test Framework**: Playwright
- **Test Coverage Target**: 80%+

## Current Status

### Working Features
- Image search with mock embeddings
- Frontend UI rendering
- API Gateway connectivity

### Known Issues
- Text search with Japanese characters ("宇都宮") returns 500 error
- Error occurs at `src/app/api/search/route.ts:96`

## Test Categories

### 1. Text Search Functionality

#### 1.1 English Text Search
- **Test Case**: Simple English keyword search
- **Expected**: Returns relevant results
- **Priority**: HIGH

#### 1.2 Japanese Text Search
- **Test Case**: Japanese keyword search (e.g., "宇都宮", "財務報告書")
- **Expected**: Returns relevant results with proper encoding
- **Priority**: CRITICAL (Currently failing)

#### 1.3 AND/OR Search Modes
- **Test Case**: Toggle between AND and OR operators
- **Expected**: Different result sets based on mode
- **Priority**: HIGH

#### 1.4 Special Characters
- **Test Case**: Search with special characters, symbols, spaces
- **Expected**: Proper encoding and results
- **Priority**: MEDIUM

### 2. Image Search Functionality

#### 2.1 Image Upload
- **Test Case**: Upload JPEG/PNG via file selection
- **Expected**: Preview shown, embedding generated
- **Priority**: HIGH

#### 2.2 Drag and Drop
- **Test Case**: Drag and drop image file
- **Expected**: Same as file selection
- **Priority**: MEDIUM

#### 2.3 Image Validation
- **Test Case**: Invalid file type, file too large
- **Expected**: Appropriate error messages
- **Priority**: HIGH

#### 2.4 Mock Embedding Mode
- **Test Case**: Verify mock embeddings work in development
- **Expected**: Returns mock results
- **Priority**: MEDIUM

### 3. Frontend-Backend Integration

#### 3.1 API Route Handler
- **Test Case**: GET request to /api/search
- **Expected**: Proper parameter passing to Lambda
- **Priority**: CRITICAL

#### 3.2 POST Request (Image Search)
- **Test Case**: POST with image embedding
- **Expected**: Successful Lambda invocation
- **Priority**: HIGH

#### 3.3 Response Formatting
- **Test Case**: Lambda response transformation
- **Expected**: Consistent frontend format
- **Priority**: HIGH

#### 3.4 CORS Handling
- **Test Case**: Cross-origin requests
- **Expected**: Proper CORS headers
- **Priority**: MEDIUM

### 4. API Error Handling

#### 4.1 Network Errors
- **Test Case**: Simulate network failure
- **Expected**: User-friendly error message
- **Priority**: HIGH

#### 4.2 4xx Client Errors
- **Test Case**: Invalid parameters, missing auth
- **Expected**: Specific error messages
- **Priority**: HIGH

#### 4.3 5xx Server Errors
- **Test Case**: Lambda timeout, OpenSearch down
- **Expected**: Retry mechanism, fallback
- **Priority**: CRITICAL

#### 4.4 Timeout Handling
- **Test Case**: Request exceeds timeout
- **Expected**: Cancel and show timeout message
- **Priority**: MEDIUM

### 5. Performance Metrics

#### 5.1 Response Time
- **Metric**: Time from request to result display
- **Target**: < 3 seconds for text, < 5 seconds for image
- **Priority**: HIGH

#### 5.2 Concurrent Requests
- **Metric**: Handle multiple simultaneous searches
- **Target**: No degradation up to 10 concurrent users
- **Priority**: MEDIUM

#### 5.3 Large Result Sets
- **Metric**: Performance with 1000+ results
- **Target**: Pagination works smoothly
- **Priority**: MEDIUM

#### 5.4 Resource Usage
- **Metric**: Memory and CPU usage
- **Target**: < 200MB memory, < 50% CPU
- **Priority**: LOW

## Test Implementation Plan

### Phase 1: Critical Path Tests (Day 1)
1. Fix Japanese text search 500 error
2. Create basic text search E2E test
3. Verify API Gateway integration
4. Test error handling for common scenarios

### Phase 2: Comprehensive Coverage (Day 2-3)
1. Complete image search E2E tests
2. Integration tests for all API endpoints
3. Performance benchmarking tests
4. Cross-browser compatibility tests

### Phase 3: Edge Cases and Optimization (Day 4-5)
1. Error recovery and retry tests
2. Security and input validation tests
3. Accessibility tests
4. Load testing

## Debugging Strategy for Current Issues

### Text Search 500 Error Investigation

1. **Check API Gateway URL encoding**
   - Verify Japanese characters are properly encoded
   - Test with different encoding methods (UTF-8, URL encoding)

2. **Inspect Lambda invocation**
   - Check CloudWatch logs for Lambda errors
   - Verify request body format
   - Confirm OpenSearch connectivity

3. **Frontend API route debugging**
   - Add detailed logging at line 96 in route.ts
   - Check request/response headers
   - Verify error handling logic

4. **OpenSearch index verification**
   - Confirm `cis-files` index exists
   - Verify Japanese text is properly indexed
   - Test direct OpenSearch queries

## Test Execution Commands

```bash
# Run all E2E tests
yarn test:e2e

# Run specific test suite
yarn test:e2e --grep "Text Search"

# Run with UI mode for debugging
yarn test:e2e:ui

# Run with debug mode
yarn test:e2e:debug

# Generate test report
yarn test:e2e:report

# Run performance tests
yarn perf:test
```

## Expected Test Results

### Success Criteria
- ✅ All critical path tests pass
- ✅ 80%+ code coverage on frontend API routes
- ✅ No flaky tests
- ✅ Performance metrics within target ranges
- ✅ Error handling works for all scenarios

### Failure Investigation
- 📋 Detailed error logs with stack traces
- 📸 Screenshots on failure
- 🎥 Video recordings of failed tests
- 📊 Performance metrics at failure point

## Continuous Monitoring

### Automated Checks
- Run E2E tests on every commit
- Performance regression detection
- Error rate monitoring
- API availability checks

### Manual Reviews
- Weekly test suite review
- Monthly performance audit
- Quarterly security assessment

## Test Data Management

### Mock Data
- Sample files in multiple formats
- Test images (JPEG, PNG, various sizes)
- Japanese and English text samples

### Test Fixtures
- Location: `/frontend/e2e/fixtures/`
- Images: Valid JPEGs, PNGs, invalid files
- Text: Search queries in multiple languages

## Next Steps

1. ✅ Create comprehensive test strategy document (this file)
2. ⏳ Implement text search E2E tests
3. ⏳ Debug and fix Japanese text search error
4. ⏳ Create integration tests for API routes
5. ⏳ Implement performance measurement tests
6. ⏳ Document all test results and findings

## References

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Next.js Testing](https://nextjs.org/docs/testing)
- [AWS Lambda Testing Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/testing-guide.html)
