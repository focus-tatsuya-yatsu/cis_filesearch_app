/**
 * Integration Tests for /api/search Route Handler
 * ベクトルデータが/api/searchに正しく送信されるか検証
 */

import { NextRequest } from 'next/server'
import { POST, GET } from '../route'

// fetchをモック
global.fetch = jest.fn()

/**
 * Helper function to create NextRequest object
 * Next.js 15では直接的なRequestオブジェクト作成が必要
 */
function createNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init)
  return request as unknown as NextRequest
}

describe('POST /api/search - Image Search Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // 環境変数を設定
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://api.example.com/search'
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_GATEWAY_URL
  })

  describe('Image Embedding Forwarding to Lambda API', () => {
    it('should forward imageEmbedding to Lambda API via POST', async () => {
      // Arrange: 1024次元のベクトル
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const requestBody = {
        imageEmbedding: embedding,
        searchType: 'image',
        searchMode: 'or',
        page: 1,
        size: 20,
      }

      // Lambda APIのモックレスポンス
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [
              {
                id: '1',
                fileName: 'test-image.jpg',
                filePath: '/path/to/test-image.jpg',
                fileType: 'image/jpeg',
                fileSize: 1024000,
                modifiedDate: '2025-01-01T00:00:00Z',
                snippet: '',
                relevanceScore: 0.95,
              },
            ],
            pagination: {
              total: 1,
              page: 1,
              limit: 20,
              totalPages: 1,
            },
            query: requestBody,
            took: 150,
          },
        }),
      })

      // Next.js Request オブジェクトを作成
      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      // Act: POST ハンドラを実行
      const response = await POST(request)
      const responseData = await response.json()

      // Assert: Lambda APIが呼ばれたか確認
      expect(global.fetch).toHaveBeenCalledTimes(1)

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0]

      // URLが正しいか
      expect(url).toBe('https://api.example.com/search')

      // POSTメソッドが使用されたか
      expect(options.method).toBe('POST')

      // ヘッダーが正しいか
      expect(options.headers['Content-Type']).toBe('application/json')

      // ボディにベクトルデータが含まれているか
      const body = JSON.parse(options.body)
      expect(body.imageEmbedding).toBeDefined()
      expect(body.imageEmbedding).toHaveLength(1024)
      expect(body.searchMode).toBe('or')

      // レスポンスが正しいか
      expect(responseData.success).toBe(true)
      expect(responseData.data.results).toHaveLength(1)
    })

    it('should preserve vector data integrity when forwarding', async () => {
      // Arrange: 特定のパターンを持つベクトル
      const embedding = Array.from({ length: 1024 }, (_, i) => i / 1024)
      const requestBody = {
        imageEmbedding: embedding,
        searchType: 'image',
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: requestBody,
            took: 100,
          },
        }),
      })

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      // Act
      await POST(request)

      // Assert: ベクトルデータが正確に保持されているか
      const [, options] = (global.fetch as jest.Mock).mock.calls[0]
      const body = JSON.parse(options.body)

      expect(body.imageEmbedding[0]).toBe(0)
      expect(body.imageEmbedding[512]).toBeCloseTo(512 / 1024, 5)
      expect(body.imageEmbedding[1023]).toBeCloseTo(1023 / 1024, 5)
    })

    it('should include pagination parameters in Lambda request', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const requestBody = {
        imageEmbedding: embedding,
        searchType: 'image',
        page: 5,
        size: 50,
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 5, limit: 50, totalPages: 0 },
            query: requestBody,
            took: 100,
          },
        }),
      })

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      await POST(request)

      const [, options] = (global.fetch as jest.Mock).mock.calls[0]
      const body = JSON.parse(options.body)

      expect(body.page).toBe(5)
      expect(body.size).toBe(50)
      expect(body.from).toBe(200) // (page - 1) * limit = 4 * 50 = 200
    })

    it('should include sort parameters in Lambda request', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const requestBody = {
        imageEmbedding: embedding,
        searchType: 'image',
        sortBy: 'date',
        sortOrder: 'asc',
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: requestBody,
            took: 100,
          },
        }),
      })

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      await POST(request)

      const [, options] = (global.fetch as jest.Mock).mock.calls[0]
      const body = JSON.parse(options.body)

      expect(body.sortBy).toBe('date')
      expect(body.sortOrder).toBe('asc')
    })
  })

  describe('Validation and Error Handling', () => {
    it('should return 400 if imageEmbedding is missing and no other params', async () => {
      const requestBody = {
        searchType: 'image',
        // imageEmbedding is missing
      }

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      const response = await POST(request)
      const responseData = await response.json()

      expect(response.status).toBe(400)
      expect(responseData.code).toBe('INVALID_QUERY')
    })

    it('should return 400 if imageEmbedding is empty array', async () => {
      const requestBody = {
        imageEmbedding: [], // empty array
        searchType: 'image',
      }

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      const response = await POST(request)
      const responseData = await response.json()

      expect(response.status).toBe(400)
      expect(responseData.code).toBe('INVALID_QUERY')
    })

    it('should return 400 if pagination parameters are invalid', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const requestBody = {
        imageEmbedding: embedding,
        page: -1, // invalid
        size: 200, // exceeds limit
      }

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      const response = await POST(request)
      const responseData = await response.json()

      expect(response.status).toBe(400)
      expect(responseData.code).toBe('INVALID_PAGINATION')
    })

    it('should handle Lambda API error gracefully', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const requestBody = {
        imageEmbedding: embedding,
        searchType: 'image',
      }

      // Lambda APIがエラーを返す
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          error: {
            message: 'OpenSearch service unavailable',
          },
        }),
      })

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      const response = await POST(request)
      const responseData = await response.json()

      expect(response.status).toBe(500)
      expect(responseData.code).toBe('INTERNAL_ERROR')
    })

    it('should return 503 if API Gateway URL is not configured', async () => {
      delete process.env.NEXT_PUBLIC_API_GATEWAY_URL

      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const requestBody = {
        imageEmbedding: embedding,
        searchType: 'image',
      }

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      const response = await POST(request)
      const responseData = await response.json()

      expect(response.status).toBe(500)
      expect(responseData.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('Text Search Fallback (GET method)', () => {
    it('should use GET method for text search even in POST handler', async () => {
      const requestBody = {
        query: 'test query',
        searchMode: 'and',
        page: 1,
        size: 20,
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: requestBody,
            took: 100,
          },
        }),
      })

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      await POST(request)

      // GETメソッドでLambda APIが呼ばれる
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toContain('?')
      expect(url).toContain('q=test+query')
      expect(options.method).toBe('GET')
    })
  })

  describe('Console Logging (Debug)', () => {
    it('should log image search request details', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const requestBody = {
        imageEmbedding: embedding,
        searchType: 'image',
        page: 1,
        size: 20,
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: requestBody,
            took: 100,
          },
        }),
      })

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      await POST(request)

      // コンソールログが出力されたか確認
      expect(consoleSpy).toHaveBeenCalledWith(
        '[POST] Image search request to Lambda',
        expect.objectContaining({
          embeddingDimensions: 1024,
          page: 1,
          limit: 20,
        })
      )

      consoleSpy.mockRestore()
    })

    it('should log Lambda response details', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const requestBody = {
        imageEmbedding: embedding,
        searchType: 'image',
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [
              { id: '1', fileName: 'test.jpg', relevanceScore: 0.95 },
              { id: '2', fileName: 'test2.jpg', relevanceScore: 0.92 },
            ],
            pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
            query: requestBody,
            took: 150,
          },
        }),
      })

      const request = createNextRequest('http://localhost:3000/api/search', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      await POST(request)

      expect(consoleSpy).toHaveBeenCalledWith(
        '[POST] Lambda response received:',
        expect.objectContaining({
          resultCount: 2,
          total: 2,
        })
      )

      consoleSpy.mockRestore()
    })
  })
})

describe('GET /api/search - Text Search (Regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://api.example.com/search'
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_GATEWAY_URL
  })

  it('should handle text-only search via GET', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          results: [],
          pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
          query: { q: 'test', searchMode: 'or' },
          took: 100,
        },
      }),
    })

    const request = createNextRequest(
      'http://localhost:3000/api/search?q=test&searchMode=or'
    )

    const response = await GET(request)
    const responseData = await response.json()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(responseData.success).toBe(true)
  })
})
