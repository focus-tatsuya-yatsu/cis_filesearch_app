/**
 * OpenSearch API - Integration Tests
 *
 * テスト対象:
 * - API Gateway経由の検索機能
 * - エラーハンドリング
 * - レスポンス変換
 * - クエリパラメータ構築
 *
 * カバレッジ目標: 85%+
 */

// OpenSearchクライアントのモック（インポート前に定義）
jest.mock('@opensearch-project/opensearch', () => ({
  Client: jest.fn(),
}));

jest.mock('@opensearch-project/opensearch/aws', () => ({
  AwsSigv4Signer: jest.fn(),
}));

jest.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: jest.fn(),
}));

import { searchDocuments, SearchQuery } from './opensearch';

// fetchのモック
global.fetch = jest.fn();

// windowオブジェクトのモック
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

describe('OpenSearch API Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // デフォルトの環境変数設定
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://api.example.com';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
  });

  describe('searchDocuments - API Gateway経由', () => {
    it('基本的な検索が実行できる', async () => {
      const mockResponse = {
        results: [
          {
            id: '1',
            fileName: 'test.pdf',
            filePath: '/documents/test.pdf',
            fileType: 'pdf',
            fileSize: 1024,
            modifiedDate: '2024-01-01',
            snippet: 'Test content',
            relevanceScore: 0.95,
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
        took: 42,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
      };

      const result = await searchDocuments(query);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(result.results).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.took).toBe(42);
    });

    it('検索モード(AND)が正しく送信される', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test query',
        searchMode: 'and',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('searchMode=and');
    });

    it('検索モード(OR)が正しく送信される', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test query',
        searchMode: 'or',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('searchMode=or');
    });

    it('ファイルタイプフィルターが正しく送信される', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
        fileType: 'pdf',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('fileType=pdf');
    });

    it('日付範囲フィルターが正しく送信される', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('dateFrom=2024-01-01');
      expect(callUrl).toContain('dateTo=2024-12-31');
    });

    it('ページネーションパラメータが正しく送信される', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 2, limit: 50, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
        size: 50,
        from: 50, // 2ページ目
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('page=2');
      expect(callUrl).toContain('limit=50');
    });

    it('ソート設定が正しく送信される', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
        sortBy: 'date',
        sortOrder: 'asc',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('sortBy=date');
      expect(callUrl).toContain('sortOrder=asc');
    });

    it('Cognitoトークンがある場合、Authorizationヘッダーが送信される', async () => {
      mockLocalStorage.getItem.mockReturnValueOnce('mock-cognito-token');

      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
      };

      await searchDocuments(query);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const headers = fetchCall[1].headers;

      expect(headers['Authorization']).toBe('Bearer mock-cognito-token');
    });

    it('複数の検索結果を正しく処理する', async () => {
      const mockResponse = {
        results: [
          {
            id: '1',
            fileName: 'file1.pdf',
            filePath: '/path/file1.pdf',
            fileType: 'pdf',
            fileSize: 1024,
            modifiedDate: '2024-01-01',
            snippet: 'Content 1',
            relevanceScore: 0.95,
          },
          {
            id: '2',
            fileName: 'file2.docx',
            filePath: '/path/file2.docx',
            fileType: 'docx',
            fileSize: 2048,
            modifiedDate: '2024-01-02',
            snippet: 'Content 2',
            relevanceScore: 0.85,
          },
          {
            id: '3',
            fileName: 'file3.txt',
            filePath: '/path/file3.txt',
            fileType: 'txt',
            fileSize: 512,
            modifiedDate: '2024-01-03',
            snippet: 'Content 3',
            relevanceScore: 0.75,
          },
        ],
        pagination: {
          total: 3,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
        took: 50,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
      };

      const result = await searchDocuments(query);

      expect(result.results).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.results[0].fileName).toBe('file1.pdf');
      expect(result.results[1].fileName).toBe('file2.docx');
      expect(result.results[2].fileName).toBe('file3.txt');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://api.example.com';
    });

    it('API Gateway URLが設定されていない場合、エラーを投げる', async () => {
      delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
      delete process.env.OPENSEARCH_ENDPOINT; // OpenSearchエンドポイントも無効化

      const query: SearchQuery = {
        query: 'test',
      };

      await expect(searchDocuments(query)).rejects.toThrow(
        'OpenSearch client is not available'
      );
    });

    it('API GatewayがHTTPエラーを返した場合、エラーを投げる', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const query: SearchQuery = {
        query: 'test',
      };

      await expect(searchDocuments(query)).rejects.toThrow(
        'API Gateway error: 500 Internal Server Error'
      );
    });

    it('404エラーを正しくハンドリングする', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const query: SearchQuery = {
        query: 'test',
      };

      await expect(searchDocuments(query)).rejects.toThrow(
        'API Gateway error: 404 Not Found'
      );
    });

    it('ネットワークエラーを正しくハンドリングする', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const query: SearchQuery = {
        query: 'test',
      };

      await expect(searchDocuments(query)).rejects.toThrow('Network error');
    });

    it('タイムアウトエラーを正しくハンドリングする', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Request timeout')
      );

      const query: SearchQuery = {
        query: 'test',
      };

      await expect(searchDocuments(query)).rejects.toThrow('Request timeout');
    });
  });

  describe('Default Values', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://api.example.com';
    });

    it('searchModeのデフォルト値は"or"', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('searchMode=or');
    });

    it('sizeのデフォルト値は20', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('limit=20');
    });

    it('fromのデフォルト値は0（1ページ目）', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('page=1');
    });

    it('sortByのデフォルト値は"relevance"', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('sortBy=relevance');
    });

    it('sortOrderのデフォルト値は"desc"', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('sortOrder=desc');
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://api.example.com';
    });

    it('空文字列のクエリでも検索できる', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: '',
      };

      const result = await searchDocuments(query);

      expect(result.results).toHaveLength(0);
    });

    it('検索結果が0件でも正しく処理される', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 5,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'nonexistent',
      };

      const result = await searchDocuments(query);

      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('大量の検索結果を正しく処理する', async () => {
      const largeResults = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        fileName: `file${i}.pdf`,
        filePath: `/path/file${i}.pdf`,
        fileType: 'pdf',
        fileSize: 1024 * i,
        modifiedDate: '2024-01-01',
        snippet: `Content ${i}`,
        relevanceScore: 1 - i * 0.01,
      }));

      const mockResponse = {
        results: largeResults,
        pagination: { total: 100, page: 1, limit: 100, totalPages: 1 },
        took: 200,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
        size: 100,
      };

      const result = await searchDocuments(query);

      expect(result.results).toHaveLength(100);
      expect(result.total).toBe(100);
    });

    it('特殊文字を含むクエリを正しくエンコードする', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test & query = value',
      };

      await searchDocuments(query);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      // URLエンコードされていることを確認
      expect(callUrl).toContain('q=test+%26+query+%3D+value');
    });

    it('非常に長いクエリ文字列を処理できる', async () => {
      const mockResponse = {
        results: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const longQuery = 'word '.repeat(100);

      const query: SearchQuery = {
        query: longQuery,
      };

      const result = await searchDocuments(query);

      expect(result).toBeDefined();
    });
  });

  describe('Response Transformation', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://api.example.com';
    });

    it('API GatewayレスポンスがSearchResponse型に正しく変換される', async () => {
      const mockResponse = {
        results: [
          {
            id: '1',
            fileName: 'test.pdf',
            filePath: '/test.pdf',
            fileType: 'pdf',
            fileSize: 1024,
            modifiedDate: '2024-01-01',
            snippet: 'Test',
            relevanceScore: 0.95,
          },
        ],
        pagination: {
          total: 100,
          page: 1,
          limit: 20,
          totalPages: 5,
        },
        took: 42,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
      };

      const result = await searchDocuments(query);

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('took');
      expect(result.total).toBe(100);
      expect(result.took).toBe(42);
    });

    it('paginationプロパティがない場合、デフォルト値が使用される', async () => {
      const mockResponse = {
        results: [],
        took: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const query: SearchQuery = {
        query: 'test',
      };

      const result = await searchDocuments(query);

      expect(result.total).toBe(0);
      expect(result.took).toBe(10);
    });
  });
});
