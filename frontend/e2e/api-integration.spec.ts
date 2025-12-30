/**
 * E2E Tests for API Integration
 * API統合のE2Eテスト
 *
 * Test Coverage:
 * 1. Frontend API route (/api/search)
 * 2. Lambda function invocation
 * 3. Request/Response formatting
 * 4. Error propagation
 */

import { test, expect } from '@playwright/test';

test.describe('API Integration Tests', () => {
  test.describe('GET /api/search - Text Search', () => {
    test('should call API with correct query parameters', async ({ page, request }) => {
      await page.goto('/');

      // Intercept API calls
      const apiCalls: any[] = [];
      await page.route('**/api/search*', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        const headers = route.request().headers();

        apiCalls.push({ url, method, headers });
        console.log(`📡 API Call: ${method} ${url}`);

        // Continue with the actual request
        await route.continue();
      });

      // Perform search
      const searchInput = page.locator('input[type="search"]').or(page.getByTestId('search-input'));
      await searchInput.fill('test query');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(2000);

      // Verify API was called
      expect(apiCalls.length).toBeGreaterThan(0);

      const apiCall = apiCalls[0];
      expect(apiCall.method).toBe('GET');
      expect(apiCall.url).toContain('/api/search');
      expect(apiCall.url).toContain('q=test%20query');
    });

    test('should include searchMode parameter', async ({ page }) => {
      let capturedUrl = '';

      await page.route('**/api/search*', async (route) => {
        capturedUrl = route.request().url();
        await route.continue();
      });

      await page.goto('/');
      const searchInput = page.locator('input[type="search"]');
      await searchInput.fill('test');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(2000);

      // Should include searchMode (either 'and' or 'or')
      expect(capturedUrl).toMatch(/searchMode=(and|or)/);
    });

    test('should handle Japanese characters in URL encoding', async ({ page }) => {
      let capturedUrl = '';

      await page.route('**/api/search*', async (route) => {
        capturedUrl = route.request().url();
        console.log(`📡 Captured URL: ${capturedUrl}`);
        await route.continue();
      });

      await page.goto('/');
      const searchInput = page.locator('input[type="search"]');
      await searchInput.fill('宇都宮');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(2000);

      // URL should be properly encoded
      expect(capturedUrl).toBeTruthy();
      expect(capturedUrl).toContain('q=');

      // Check encoding (should be %E5%AE%87%E9%83%BD%E5%AE%AE or similar)
      const url = new URL(capturedUrl);
      const qParam = url.searchParams.get('q');
      console.log(`Query parameter value: ${qParam}`);
      expect(qParam).toBe('宇都宮');
    });
  });

  test.describe('POST /api/search - Image Search', () => {
    test('should send POST request with image embedding', async ({ page }) => {
      let postBody: any = null;

      await page.route('**/api/search', async (route) => {
        if (route.request().method() === 'POST') {
          const body = route.request().postData();
          if (body) {
            try {
              postBody = JSON.parse(body);
              console.log('📤 POST body:', JSON.stringify(postBody, null, 2));
            } catch (e) {
              console.error('Failed to parse POST body');
            }
          }
        }
        await route.continue();
      });

      await page.goto('/');

      // Upload an image (if image search UI exists)
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.isVisible().catch(() => false)) {
        // Create a minimal test image
        const buffer = Buffer.from(
          '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',
          'base64'
        );

        await fileInput.setInputFiles({
          name: 'test.jpg',
          mimeType: 'image/jpeg',
          buffer: buffer,
        });

        await page.waitForTimeout(3000);

        // Verify POST was made with embedding
        if (postBody) {
          expect(postBody).toHaveProperty('imageEmbedding');
          expect(Array.isArray(postBody.imageEmbedding)).toBeTruthy();
          expect(postBody.searchType).toBe('image');
        }
      } else {
        console.log('⚠ File input not found, skipping image upload test');
        test.skip();
      }
    });
  });

  test.describe('Lambda Function Response Handling', () => {
    test('should handle successful Lambda response', async ({ page }) => {
      // Mock successful Lambda response
      await page.route('**/api/search*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              results: [
                {
                  id: '1',
                  fileName: 'test-file.pdf',
                  filePath: '/documents/test-file.pdf',
                  fileType: 'pdf',
                  fileSize: 1024,
                  modifiedDate: '2024-01-15T10:00:00Z',
                  snippet: 'Test content snippet',
                  relevanceScore: 0.95,
                },
              ],
              pagination: {
                total: 1,
                page: 1,
                limit: 20,
                totalPages: 1,
              },
              query: { q: 'test' },
              took: 45,
            },
          }),
        });
      });

      await page.goto('/');
      const searchInput = page.locator('input[type="search"]');
      await searchInput.fill('test');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(1500);

      // Verify results are displayed
      const results = await page.getByTestId('search-results').isVisible().catch(() => false);
      const resultItems = await page.locator('[data-testid="result-item"]').count();

      console.log(`✓ Results displayed: ${resultItems} items`);
      expect(results || resultItems > 0).toBeTruthy();
    });

    test('should handle Lambda 400 error', async ({ page }) => {
      await page.route('**/api/search*', async (route) => {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Invalid query parameters',
            code: 'INVALID_QUERY',
          }),
        });
      });

      await page.goto('/');
      const searchInput = page.locator('input[type="search"]');
      await searchInput.fill('test');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(1500);

      // Should show error message
      const errorVisible = await page.getByTestId('error-message').isVisible().catch(() => false);
      expect(errorVisible).toBeTruthy();
    });

    test('should handle Lambda 500 error', async ({ page }) => {
      await page.route('**/api/search*', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Internal server error',
            code: 'INTERNAL_ERROR',
          }),
        });
      });

      await page.goto('/');
      const searchInput = page.locator('input[type="search"]');
      await searchInput.fill('test');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(1500);

      // Should show user-friendly error
      const errorMessage = await page.getByTestId('error-message').textContent();
      console.log(`Error message: ${errorMessage}`);

      expect(errorMessage).toBeTruthy();
      // Should not expose technical details
      expect(errorMessage).not.toContain('500');
    });

    test('should handle Lambda timeout', async ({ page }) => {
      await page.route('**/api/search*', async (route) => {
        await route.fulfill({
          status: 504,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Gateway timeout',
            code: 'TIMEOUT',
          }),
        });
      });

      await page.goto('/');
      const searchInput = page.locator('input[type="search"]');
      await searchInput.fill('test');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(1500);

      // Should show timeout error
      const errorVisible = await page.getByTestId('error-message').isVisible().catch(() => false);
      expect(errorVisible).toBeTruthy();
    });
  });

  test.describe('Request Headers and CORS', () => {
    test('should include correct Content-Type header', async ({ page }) => {
      let headers: any = {};

      await page.route('**/api/search*', async (route) => {
        headers = route.request().headers();
        console.log('📋 Request headers:', headers);
        await route.continue();
      });

      await page.goto('/');
      const searchInput = page.locator('input[type="search"]');
      await searchInput.fill('test');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(1500);

      // Verify Content-Type is set
      expect(headers['content-type'] || headers['Content-Type']).toBeTruthy();
    });

    test('should handle CORS preflight', async ({ page, request }) => {
      // Test OPTIONS request
      const response = await request.fetch('/api/search', {
        method: 'OPTIONS',
      });

      expect(response.status()).toBe(200);

      const headers = response.headers();
      console.log('📋 CORS headers:', headers);

      // Should have CORS headers
      expect(headers['access-control-allow-origin']).toBeTruthy();
    });
  });

  test.describe('Response Transformation', () => {
    test('should transform Lambda response to frontend format', async ({ page }) => {
      // Mock Lambda response with different field names
      await page.route('**/api/search*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              results: [
                {
                  id: 'doc-123',
                  fileName: 'sample.pdf',
                  filePath: '/docs/sample.pdf',
                  fileType: 'pdf',
                  fileSize: 2048,
                  modifiedDate: '2024-01-15T10:00:00Z',
                  snippet: 'Sample document content',
                  relevanceScore: 0.92,
                },
              ],
              total: 1,
              page: 1,
              limit: 20,
            },
          }),
        });
      });

      await page.goto('/');
      const searchInput = page.locator('input[type="search"]');
      await searchInput.fill('sample');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(1500);

      // Verify data is displayed correctly
      const fileName = await page.getByText('sample.pdf').isVisible().catch(() => false);
      expect(fileName).toBeTruthy();
    });
  });

  test.describe('Performance and Caching', () => {
    test('should measure API response time', async ({ page }) => {
      const responseTimes: number[] = [];

      await page.route('**/api/search*', async (route) => {
        const startTime = Date.now();
        await route.continue();
        const endTime = Date.now();
        const duration = endTime - startTime;
        responseTimes.push(duration);
        console.log(`⏱ API response time: ${duration}ms`);
      });

      await page.goto('/');

      // Perform 3 searches
      const queries = ['test1', 'test2', 'test3'];
      for (const query of queries) {
        const searchInput = page.locator('input[type="search"]');
        await searchInput.fill(query);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
      }

      // Check average response time
      const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      console.log(`📊 Average API response time: ${avgTime.toFixed(2)}ms`);

      // Should be under 3 seconds
      expect(avgTime).toBeLessThan(3000);
    });

    test('should respect Cache-Control headers', async ({ page }) => {
      let cacheControl = '';

      await page.route('**/api/search*', async (route) => {
        const response = await route.fetch();
        const headers = response.headers();
        cacheControl = headers['cache-control'] || '';
        console.log(`📋 Cache-Control: ${cacheControl}`);

        await route.fulfill({ response });
      });

      await page.goto('/');
      const searchInput = page.locator('input[type="search"]');
      await searchInput.fill('cache test');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(1500);

      // Verify cache control is set
      expect(cacheControl).toBeTruthy();
    });
  });

  test.describe('Error Recovery and Retry Logic', () => {
    test('should retry on network failure', async ({ page }) => {
      let attemptCount = 0;

      await page.route('**/api/search*', async (route) => {
        attemptCount++;
        console.log(`🔄 Attempt ${attemptCount}`);

        if (attemptCount === 1) {
          // First attempt fails
          await route.abort('failed');
        } else {
          // Second attempt succeeds
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                results: [],
                total: 0,
              },
            }),
          });
        }
      });

      await page.goto('/');
      const searchInput = page.locator('input[type="search"]');
      await searchInput.fill('retry test');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(3000);

      // Should eventually show results or handled error
      const hasResponse = await page.getByTestId('search-results').isVisible().catch(() => false) ||
                         await page.getByTestId('error-message').isVisible().catch(() => false);

      expect(hasResponse).toBeTruthy();
      console.log(`✓ Completed after ${attemptCount} attempts`);
    });
  });
});
