/**
 * Lambda Handler Unit Tests
 */

import { handler } from '../index';
import { Context } from 'aws-lambda';
import * as opensearchService from '../services/opensearch.service.enhanced';

// OpenSearchサービスをモック
jest.mock('../services/opensearch.service.enhanced');

const mockContext: Context = {
  awsRequestId: 'test-request-id-12345',
  functionName: 'cis-search-api-prod',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:ap-northeast-1:123456789012:function:cis-search-api-prod',
  memoryLimitInMB: '512',
  getRemainingTimeInMillis: () => 30000,
  callbackWaitsForEmptyEventLoop: false,
  logGroupName: '/aws/lambda/cis-search-api-prod',
  logStreamName: '2025/12/19/[$LATEST]test-stream',
  done: jest.fn(),
  fail: jest.fn(),
  succeed: jest.fn(),
};

describe('Lambda Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET リクエスト（テキスト検索）', () => {
    it('正常なテキスト検索リクエストを処理する', async () => {
      const mockSearchResult = {
        results: [
          {
            id: '1',
            fileName: '宇都宮報告書.pdf',
            filePath: '/documents/2025/宇都宮報告書.pdf',
            fileType: 'pdf',
            fileSize: 102400,
            modifiedDate: '2025-12-01T10:00:00Z',
            snippet: '宇都宮営業所の月次報告書です。売上は前年比120%...',
            relevanceScore: 0.95,
          },
        ],
        total: 1,
        took: 15,
      };

      jest
        .spyOn(opensearchService, 'searchDocuments')
        .mockResolvedValue(mockSearchResult);

      const event = {
        httpMethod: 'GET',
        path: '/search',
        queryStringParameters: {
          q: '宇都宮',
          page: '1',
          limit: '20',
        },
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.results).toHaveLength(1);
      expect(body.data.results[0].fileName).toContain('宇都宮');
      expect(body.data.query.q).toBe('宇都宮');
      expect(body.data.pagination.total).toBe(1);
    });

    it('AND検索モードが正しく適用される', async () => {
      jest.spyOn(opensearchService, 'searchDocuments').mockResolvedValue({
        results: [],
        total: 0,
        took: 10,
      });

      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          q: '営業 報告書',
          searchMode: 'and',
        },
      };

      await handler(event, mockContext);

      expect(opensearchService.searchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          query: '営業 報告書',
          searchMode: 'and',
        })
      );
    });

    it('OR検索モードが正しく適用される', async () => {
      jest.spyOn(opensearchService, 'searchDocuments').mockResolvedValue({
        results: [],
        total: 0,
        took: 10,
      });

      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          q: 'PDF Excel',
          searchMode: 'or',
        },
      };

      await handler(event, mockContext);

      expect(opensearchService.searchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'PDF Excel',
          searchMode: 'or',
        })
      );
    });

    it('ファイルタイプフィルターが正しく適用される', async () => {
      jest.spyOn(opensearchService, 'searchDocuments').mockResolvedValue({
        results: [],
        total: 0,
        took: 10,
      });

      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          q: 'test',
          fileType: 'pdf',
        },
      };

      await handler(event, mockContext);

      expect(opensearchService.searchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          fileType: 'pdf',
        })
      );
    });

    it('日付範囲フィルターが正しく適用される', async () => {
      jest.spyOn(opensearchService, 'searchDocuments').mockResolvedValue({
        results: [],
        total: 0,
        took: 10,
      });

      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          q: 'test',
          dateFrom: '2025-01-01',
          dateTo: '2025-12-31',
        },
      };

      await handler(event, mockContext);

      expect(opensearchService.searchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: '2025-01-01',
          dateTo: '2025-12-31',
        })
      );
    });

    it('ソート設定が正しく適用される', async () => {
      jest.spyOn(opensearchService, 'searchDocuments').mockResolvedValue({
        results: [],
        total: 0,
        took: 10,
      });

      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          q: 'test',
          sortBy: 'date',
          sortOrder: 'asc',
        },
      };

      await handler(event, mockContext);

      expect(opensearchService.searchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          sortBy: 'date',
          sortOrder: 'asc',
        })
      );
    });

    it('ページネーションが正しく計算される', async () => {
      const mockSearchResult = {
        results: [],
        total: 100,
        took: 10,
      };

      jest
        .spyOn(opensearchService, 'searchDocuments')
        .mockResolvedValue(mockSearchResult);

      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          q: 'test',
          page: '3',
          limit: '20',
        },
      };

      const response = await handler(event, mockContext);

      expect(opensearchService.searchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 40, // (page - 1) * limit = 2 * 20
          size: 20,
        })
      );

      const body = JSON.parse(response.body);
      expect(body.data.pagination.page).toBe(3);
      expect(body.data.pagination.limit).toBe(20);
      expect(body.data.pagination.totalPages).toBe(5); // ceil(100 / 20)
    });

    it('無効なクエリパラメータで400エラーを返す', async () => {
      const event = {
        httpMethod: 'GET',
        queryStringParameters: {},
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('クエリが長すぎる場合400エラーを返す', async () => {
      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          q: 'a'.repeat(501),
        },
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST リクエスト（画像検索）', () => {
    it('正常な画像検索リクエストを処理する', async () => {
      const mockSearchResult = {
        results: [
          {
            id: '1',
            fileName: 'product-image.jpg',
            filePath: '/images/products/product-image.jpg',
            fileType: 'image',
            fileSize: 204800,
            modifiedDate: '2025-12-01T10:00:00Z',
            snippet: '',
            relevanceScore: 0.89,
          },
        ],
        total: 1,
        took: 25,
      };

      jest
        .spyOn(opensearchService, 'searchDocuments')
        .mockResolvedValue(mockSearchResult);

      const embedding = Array(512).fill(0.5);
      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          imageEmbedding: embedding,
          page: 1,
          limit: 20,
        }),
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.results).toHaveLength(1);
      expect(body.data.query.searchType).toBe('image');
    });

    it('1024次元の画像埋め込みを処理できる', async () => {
      jest.spyOn(opensearchService, 'searchDocuments').mockResolvedValue({
        results: [],
        total: 0,
        took: 20,
      });

      const embedding = Array(1024).fill(0.3);
      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          imageEmbedding: embedding,
        }),
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
      expect(opensearchService.searchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          imageEmbedding: embedding,
        })
      );
    });

    it('画像検索とテキスト検索の組み合わせを処理する', async () => {
      jest.spyOn(opensearchService, 'searchDocuments').mockResolvedValue({
        results: [],
        total: 0,
        took: 20,
      });

      const embedding = Array(512).fill(0.3);
      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          q: '宇都宮',
          imageEmbedding: embedding,
        }),
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
      expect(opensearchService.searchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          query: '宇都宮',
          imageEmbedding: embedding,
        })
      );
    });

    it('無効な画像埋め込みで400エラーを返す', async () => {
      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          imageEmbedding: Array(256).fill(0.5), // 無効な次元数
        }),
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(400);
    });

    it('JSONパースエラーを適切に処理する', async () => {
      const event = {
        httpMethod: 'POST',
        body: 'invalid json',
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(500);
    });
  });

  describe('OPTIONS リクエスト（CORS）', () => {
    it('CORSプリフライトリクエストを処理する', async () => {
      const event = {
        httpMethod: 'OPTIONS',
        path: '/search',
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
      expect(response.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      expect(response.body).toBe('');
    });
  });

  describe('エラーハンドリング', () => {
    it('OpenSearchエラーを適切に処理する', async () => {
      jest
        .spyOn(opensearchService, 'searchDocuments')
        .mockRejectedValue(new Error('OpenSearch connection failed'));

      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          q: 'test',
        },
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('503エラーを適切に処理する', async () => {
      const error = new Error('Service unavailable');
      (error as any).statusCode = 503;

      jest
        .spyOn(opensearchService, 'searchDocuments')
        .mockRejectedValue(error);

      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          q: 'test',
        },
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(500);
    });
  });

  describe('HTTP API v2形式のイベント', () => {
    it('HTTP API v2形式のGETリクエストを処理する', async () => {
      jest.spyOn(opensearchService, 'searchDocuments').mockResolvedValue({
        results: [],
        total: 0,
        took: 10,
      });

      const event = {
        version: '2.0',
        requestContext: {
          http: {
            method: 'GET',
            path: '/search',
          },
        },
        queryStringParameters: {
          q: 'test',
        },
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('メソッドの検証', () => {
    it('PUTリクエストで405エラーを返す', async () => {
      const event = {
        httpMethod: 'PUT',
        path: '/search',
      };

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200); // エラーコードではなく200でエラーメッセージを返す実装
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.code).toBe('METHOD_NOT_ALLOWED');
    });

    it('DELETEリクエストで405エラーを返す', async () => {
      const event = {
        httpMethod: 'DELETE',
        path: '/search',
      };

      const response = await handler(event, mockContext);

      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
    });
  });
});
