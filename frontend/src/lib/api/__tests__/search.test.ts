/**
 * Unit Tests for search.ts
 * searchFiles関数の画像検索POSTロジック検証
 */

import { searchFiles, isApiError, type SearchParams } from '../search'

// fetchをモック
global.fetch = jest.fn()

describe('searchFiles - Image Search POST Logic', () => {
  beforeEach(() => {
    // 各テスト前にモックをリセット
    jest.clearAllMocks()
  })

  describe('POST Method for Image Search', () => {
    it('should use POST method when imageEmbedding is provided', async () => {
      // Arrange: 1024次元のベクトルを準備
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const params: SearchParams = {
        imageEmbedding: embedding,
        searchType: 'image',
        searchMode: 'or',
        page: 1,
        limit: 20,
      }

      // fetchのモックレスポンスを設定
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: params,
            took: 100,
          },
        }),
      })

      // Act: searchFiles関数を実行
      await searchFiles(params)

      // Assert: POSTメソッドが使用されたか確認
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/search',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      )
    })

    it('should NOT use POST method when imageEmbedding is empty', async () => {
      // Arrange: 空のimageEmbedding
      const params: SearchParams = {
        q: 'test query',
        imageEmbedding: [], // 空配列
        searchMode: 'or',
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: params,
            took: 100,
          },
        }),
      })

      // Act
      await searchFiles(params)

      // Assert: GETメソッドが使用される
      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const url = callArgs[0]
      const options = callArgs[1]

      expect(url).toContain('/api/search?')
      expect(options.method).toBe('GET')
    })

    it('should NOT use POST method when imageEmbedding is undefined', async () => {
      // Arrange: imageEmbeddingなし
      const params: SearchParams = {
        q: 'test query',
        searchMode: 'or',
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: params,
            took: 100,
          },
        }),
      })

      // Act
      await searchFiles(params)

      // Assert: GETメソッドが使用される
      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const options = callArgs[1]
      expect(options.method).toBe('GET')
    })
  })

  describe('Request Body with Image Embedding', () => {
    it('should include full embedding array in request body', async () => {
      // Arrange: 特定のパターンを持つベクトル
      const embedding = Array.from({ length: 1024 }, (_, i) => i / 1024)
      const params: SearchParams = {
        imageEmbedding: embedding,
        searchType: 'image',
        searchMode: 'or',
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: params,
            took: 100,
          },
        }),
      })

      // Act
      await searchFiles(params)

      // Assert: リクエストボディにベクトルが含まれているか確認
      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1].body)

      expect(requestBody.imageEmbedding).toBeDefined()
      expect(requestBody.imageEmbedding).toHaveLength(1024)
      expect(requestBody.imageEmbedding[0]).toBe(0)
      expect(requestBody.imageEmbedding[1023]).toBeCloseTo(1023 / 1024, 5)
    })

    it('should include searchType as "image" in request body', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const params: SearchParams = {
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
            query: params,
            took: 100,
          },
        }),
      })

      await searchFiles(params)

      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1].body)

      expect(requestBody.searchType).toBe('image')
    })

    it('should include pagination parameters in request body', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const params: SearchParams = {
        imageEmbedding: embedding,
        searchType: 'image',
        page: 3,
        limit: 50,
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 3, limit: 50, totalPages: 0 },
            query: params,
            took: 100,
          },
        }),
      })

      await searchFiles(params)

      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1].body)

      expect(requestBody.page).toBe(3)
      expect(requestBody.size).toBe(50)
    })

    it('should include sort parameters in request body', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const params: SearchParams = {
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
            query: params,
            took: 100,
          },
        }),
      })

      await searchFiles(params)

      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1].body)

      expect(requestBody.sortBy).toBe('date')
      expect(requestBody.sortOrder).toBe('asc')
    })
  })

  describe('Error Handling for Image Search', () => {
    it('should return ApiErrorResponse on HTTP 400 error', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const params: SearchParams = {
        imageEmbedding: embedding,
        searchType: 'image',
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: 'Invalid parameters',
          code: 'INVALID_QUERY',
        }),
      })

      const response = await searchFiles(params)

      expect(isApiError(response)).toBe(true)
      if (isApiError(response)) {
        expect(response.statusCode).toBe(400)
        expect(response.userMessage).toContain('検索条件が正しくありません')
      }
    })

    it('should return ApiErrorResponse on network error', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const params: SearchParams = {
        imageEmbedding: embedding,
        searchType: 'image',
      }

      ;(global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      )

      const response = await searchFiles(params)

      expect(isApiError(response)).toBe(true)
      if (isApiError(response)) {
        expect(response.statusCode).toBe(0)
        expect(response.retryable).toBe(true)
        expect(response.userMessage).toContain('ネットワークエラー')
      }
    })

    it('should return ApiErrorResponse on HTTP 503 error with retryable flag', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const params: SearchParams = {
        imageEmbedding: embedding,
        searchType: 'image',
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: 'Service temporarily unavailable',
          code: 'SERVICE_UNAVAILABLE',
        }),
      })

      const response = await searchFiles(params)

      expect(isApiError(response)).toBe(true)
      if (isApiError(response)) {
        expect(response.statusCode).toBe(503)
        expect(response.retryable).toBe(true)
        expect(response.userMessage).toContain('一時的に利用できません')
      }
    })
  })

  describe('GET Method for Text Search (Regression Test)', () => {
    it('should use GET method for text-only search', async () => {
      const params: SearchParams = {
        q: 'test query',
        searchMode: 'and',
        page: 1,
        limit: 20,
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: params,
            took: 100,
          },
        }),
      })

      await searchFiles(params)

      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const url = callArgs[0]
      const options = callArgs[1]

      expect(url).toContain('/api/search?')
      expect(url).toContain('q=test+query')
      expect(url).toContain('searchMode=and')
      expect(options.method).toBe('GET')
    })
  })

  describe('Credentials and Headers', () => {
    it('should include credentials in POST request', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const params: SearchParams = {
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
            query: params,
            took: 100,
          },
        }),
      })

      await searchFiles(params)

      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const options = callArgs[1]

      expect(options.credentials).toBe('include')
    })

    it('should set Content-Type header to application/json', async () => {
      const embedding = Array.from({ length: 1024 }, () => Math.random())
      const params: SearchParams = {
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
            query: params,
            took: 100,
          },
        }),
      })

      await searchFiles(params)

      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const options = callArgs[1]

      expect(options.headers['Content-Type']).toBe('application/json')
    })
  })

  describe('Edge Cases', () => {
    it('should handle very large embedding arrays (stress test)', async () => {
      // 通常は1024次元だが、さらに大きい配列でもテスト
      const largeEmbedding = Array.from({ length: 2048 }, () => Math.random())
      const params: SearchParams = {
        imageEmbedding: largeEmbedding,
        searchType: 'image',
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: params,
            took: 100,
          },
        }),
      })

      await searchFiles(params)

      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1].body)

      expect(requestBody.imageEmbedding).toHaveLength(2048)
    })

    it('should handle negative values in embedding array', async () => {
      // ベクトルには負の値も含まれる可能性がある
      const embedding = Array.from({ length: 1024 }, (_, i) =>
        i % 2 === 0 ? Math.random() : -Math.random()
      )
      const params: SearchParams = {
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
            query: params,
            took: 100,
          },
        }),
      })

      await searchFiles(params)

      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1].body)

      expect(requestBody.imageEmbedding[1]).toBeLessThan(0) // 負の値が保持されているか
    })

    it('should handle zero-length embedding array as text search', async () => {
      // 空配列の場合はテキスト検索として扱う
      const params: SearchParams = {
        q: 'fallback query',
        imageEmbedding: [],
        searchType: 'image',
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            results: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            query: params,
            took: 100,
          },
        }),
      })

      await searchFiles(params)

      // GETメソッドが使用されるべき
      const callArgs = (global.fetch as jest.Mock).mock.calls[0]
      const options = callArgs[1]
      expect(options.method).toBe('GET')
    })
  })
})
