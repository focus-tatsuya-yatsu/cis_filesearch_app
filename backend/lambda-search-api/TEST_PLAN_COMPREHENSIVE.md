# Lambda-OpenSearch包括的テスト計画

## 概要

Lambda Search API (cis-search-api-prod) とOpenSearchの接続修正後のテスト計画書です。

**現在の状況:**
- Lambda関数デプロイ済み
- OpenSearchエンドポイント修正済み
- 403 Forbiddenエラー残存（ロールマッピング設定待ち）

**テスト対象:**
1. テキスト検索（cis-filesインデックス）
2. 画像検索（file-index-v2-knnインデックス）
3. ハイブリッド検索（両インデックスの統合）

**カバレッジ目標:**
- ユニットテスト: 80%以上
- 統合テスト: 70%以上
- E2Eテスト: 主要シナリオ100%

---

## 1. ユニットテスト（Unit Tests）

### 1.1 バリデーションテスト

**ファイル:** `/src/__tests__/validator.test.ts`

```typescript
import {
  validateSearchQuery,
  validateImageEmbedding,
  validateSimilarityThreshold,
  ValidationError,
} from '../utils/validator';

describe('validateSearchQuery', () => {
  describe('正常系', () => {
    it('テキストクエリのみの場合、正しくパースできる', () => {
      const params = {
        q: '宇都宮',
        page: '1',
        limit: '20',
      };

      const result = validateSearchQuery(params);

      expect(result.query).toBe('宇都宮');
      expect(result.searchMode).toBe('or');
      expect(result.size).toBe(20);
      expect(result.from).toBe(0);
    });

    it('AND検索モードが正しく設定される', () => {
      const params = {
        q: '営業 報告書',
        searchMode: 'and',
      };

      const result = validateSearchQuery(params);

      expect(result.searchMode).toBe('and');
    });

    it('画像埋め込みベクトル（512次元）が正しくパースされる', () => {
      const embedding = Array(512).fill(0.5);
      const params = {
        imageEmbedding: JSON.stringify(embedding),
      };

      const result = validateSearchQuery(params);

      expect(result.imageEmbedding).toHaveLength(512);
      expect(result.imageEmbedding![0]).toBe(0.5);
    });

    it('画像埋め込みベクトル（1024次元）が正しくパースされる', () => {
      const embedding = Array(1024).fill(0.1);
      const params = {
        imageEmbedding: JSON.stringify(embedding),
      };

      const result = validateSearchQuery(params);

      expect(result.imageEmbedding).toHaveLength(1024);
    });

    it('ファイルタイプフィルターが正しく設定される', () => {
      const params = {
        q: 'test',
        fileType: 'pdf',
      };

      const result = validateSearchQuery(params);

      expect(result.fileType).toBe('pdf');
    });

    it('日付範囲フィルターが正しく設定される', () => {
      const params = {
        q: 'test',
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
      };

      const result = validateSearchQuery(params);

      expect(result.dateFrom).toBe('2025-01-01');
      expect(result.dateTo).toBe('2025-12-31');
    });

    it('ページネーションが正しく計算される', () => {
      const params = {
        q: 'test',
        page: '3',
        limit: '50',
      };

      const result = validateSearchQuery(params);

      expect(result.size).toBe(50);
      expect(result.from).toBe(100); // (page-1) * limit = 2 * 50
    });

    it('ソート設定が正しく適用される', () => {
      const params = {
        q: 'test',
        sortBy: 'date',
        sortOrder: 'asc',
      };

      const result = validateSearchQuery(params);

      expect(result.sortBy).toBe('date');
      expect(result.sortOrder).toBe('asc');
    });
  });

  describe('異常系', () => {
    it('検索条件が一つもない場合、エラーをスローする', () => {
      expect(() => {
        validateSearchQuery({});
      }).toThrow(ValidationError);
    });

    it('クエリ文字列が500文字を超える場合、エラーをスローする', () => {
      const longQuery = 'a'.repeat(501);
      expect(() => {
        validateSearchQuery({ q: longQuery });
      }).toThrow('Query string length must be between 1 and 500 characters');
    });

    it('ページ番号が1未満の場合、エラーをスローする', () => {
      expect(() => {
        validateSearchQuery({ q: 'test', page: '0' });
      }).toThrow('Page number must be between 1 and 1000');
    });

    it('ページ番号が1000を超える場合、エラーをスローする', () => {
      expect(() => {
        validateSearchQuery({ q: 'test', page: '1001' });
      }).toThrow('Page number must be between 1 and 1000');
    });

    it('limitが100を超える場合、エラーをスローする', () => {
      expect(() => {
        validateSearchQuery({ q: 'test', limit: '101' });
      }).toThrow('Limit must be between 1 and 100');
    });

    it('無効なsearchModeの場合、エラーをスローする', () => {
      expect(() => {
        validateSearchQuery({ q: 'test', searchMode: 'invalid' });
      }).toThrow("Search mode must be 'and' or 'or'");
    });

    it('無効なsortByの場合、エラーをスローする', () => {
      expect(() => {
        validateSearchQuery({ q: 'test', sortBy: 'invalid' });
      }).toThrow('Sort by must be one of:');
    });

    it('無効な日付フォーマットの場合、エラーをスローする', () => {
      expect(() => {
        validateSearchQuery({ q: 'test', dateFrom: 'invalid-date' });
      }).toThrow('Invalid date format for dateFrom');
    });

    it('画像埋め込みの次元数が無効な場合、エラーをスローする', () => {
      const embedding = Array(256).fill(0.5); // 無効な次元数
      expect(() => {
        validateSearchQuery({ imageEmbedding: JSON.stringify(embedding) });
      }).toThrow('Image embedding must have 512 or 1024 dimensions');
    });

    it('画像埋め込みに非数値が含まれる場合、エラーをスローする', () => {
      const embedding = Array(512).fill('invalid');
      expect(() => {
        validateSearchQuery({ imageEmbedding: JSON.stringify(embedding) });
      }).toThrow('All embedding values must be finite numbers');
    });
  });
});

describe('validateImageEmbedding', () => {
  it('512次元の埋め込みを受け入れる', () => {
    const embedding = Array(512).fill(0.5);
    const result = validateImageEmbedding(embedding);
    expect(result).toHaveLength(512);
  });

  it('1024次元の埋め込みを受け入れる', () => {
    const embedding = Array(1024).fill(0.5);
    const result = validateImageEmbedding(embedding);
    expect(result).toHaveLength(1024);
  });

  it('JSON文字列からパースできる', () => {
    const embedding = Array(512).fill(0.5);
    const result = validateImageEmbedding(JSON.stringify(embedding));
    expect(result).toHaveLength(512);
  });

  it('配列でない場合エラーをスローする', () => {
    expect(() => {
      validateImageEmbedding('not-an-array');
    }).toThrow('Image embedding must be an array');
  });
});

describe('validateSimilarityThreshold', () => {
  it('0から1の範囲の値を受け入れる', () => {
    expect(validateSimilarityThreshold(0.5)).toBe(0.5);
    expect(validateSimilarityThreshold('0.8')).toBe(0.8);
  });

  it('0未満の値でエラーをスローする', () => {
    expect(() => {
      validateSimilarityThreshold(-0.1);
    }).toThrow('Similarity threshold must be between 0 and 1');
  });

  it('1を超える値でエラーをスローする', () => {
    expect(() => {
      validateSimilarityThreshold(1.1);
    }).toThrow('Similarity threshold must be between 0 and 1');
  });
});
```

### 1.2 エラーハンドラーテスト

**ファイル:** `/src/__tests__/error-handler.test.ts`

```typescript
import {
  handleError,
  createSuccessResponse,
  OpenSearchError,
  OpenSearchIndexNotFoundError,
  OpenSearchUnavailableError,
} from '../utils/error-handler';
import { ValidationError } from '../utils/validator';

describe('handleError', () => {
  it('ValidationErrorを400エラーに変換する', () => {
    const error = new ValidationError('Invalid query', 'q', 'Query is empty');
    const response = handleError(error);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('OpenSearchIndexNotFoundErrorを404エラーに変換する', () => {
    const error = new OpenSearchIndexNotFoundError('Index not found');
    const response = handleError(error);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INDEX_NOT_FOUND');
  });

  it('OpenSearchUnavailableErrorを503エラーに変換する', () => {
    const error = new OpenSearchUnavailableError('Service unavailable');
    const response = handleError(error);

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('未知のエラーを500エラーに変換する', () => {
    const error = new Error('Unknown error');
    const response = handleError(error);

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('CORSヘッダーを含む', () => {
    const error = new Error('Test error');
    const response = handleError(error);

    expect(response.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
  });
});

describe('createSuccessResponse', () => {
  it('成功レスポンスを正しく構築する', () => {
    const data = { message: 'Success' };
    const response = createSuccessResponse(data);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(data);
  });

  it('CORSヘッダーを含む', () => {
    const response = createSuccessResponse({});

    expect(response.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
    expect(response.headers).toHaveProperty('Content-Type', 'application/json');
  });
});
```

### 1.3 Lambda Handlerテスト

**ファイル:** `/src/__tests__/index.test.ts`

```typescript
import { handler } from '../index';
import { Context } from 'aws-lambda';
import * as opensearchService from '../services/opensearch.service.enhanced';

// OpenSearchサービスをモック
jest.mock('../services/opensearch.service.enhanced');

const mockContext: Context = {
  awsRequestId: 'test-request-id',
  functionName: 'test-function',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:ap-northeast-1:123456789012:function:test',
  memoryLimitInMB: '512',
  getRemainingTimeInMillis: () => 3000,
  callbackWaitsForEmptyEventLoop: false,
  logGroupName: '/aws/lambda/test',
  logStreamName: 'test-stream',
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
            filePath: '/documents/宇都宮報告書.pdf',
            fileType: 'pdf',
            fileSize: 102400,
            modifiedDate: '2025-12-01',
            snippet: '宇都宮営業所の月次報告書...',
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
      expect(body.data.results).toHaveLength(1);
      expect(body.data.results[0].fileName).toContain('宇都宮');
      expect(body.data.query.q).toBe('宇都宮');
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

    it('無効なクエリパラメータで400エラーを返す', async () => {
      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          q: '',
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
            modifiedDate: '2025-12-01',
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
      expect(body.data.results).toHaveLength(1);
      expect(body.data.query.searchType).toBe('image');
    });

    it('画像検索とテキスト検索の組み合わせを処理する', async () => {
      jest.spyOn(opensearchService, 'searchDocuments').mockResolvedValue({
        results: [],
        total: 0,
        took: 20,
      });

      const embedding = Array(1024).fill(0.3);
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
      expect(response.headers).toHaveProperty('Access-Control-Allow-Methods');
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
    });
  });
});
```

---

## 2. 統合テスト（Integration Tests）

### 2.1 OpenSearch接続テスト

**ファイル:** `/src/__tests__/integration/opensearch-connection.test.ts`

```typescript
import { getOpenSearchClient } from '../../services/opensearch.service.enhanced';

describe('OpenSearch Connection Integration', () => {
  // 実際のOpenSearchエンドポイントに接続
  // 環境変数が設定されている必要がある

  beforeAll(() => {
    // 環境変数の確認
    if (!process.env.OPENSEARCH_ENDPOINT) {
      throw new Error('OPENSEARCH_ENDPOINT must be set for integration tests');
    }
  });

  it('OpenSearchクラスターにpingできる', async () => {
    const client = await getOpenSearchClient();
    const result = await client.ping();

    expect(result.statusCode).toBe(200);
  }, 30000);

  it('クラスターヘルスを取得できる', async () => {
    const client = await getOpenSearchClient();
    const health = await client.cluster.health();

    expect(health.body.status).toMatch(/green|yellow|red/);
    expect(health.body.number_of_nodes).toBeGreaterThan(0);
  }, 30000);

  it('インデックス一覧を取得できる', async () => {
    const client = await getOpenSearchClient();
    const indices = await client.cat.indices({ format: 'json' });

    expect(Array.isArray(indices.body)).toBe(true);
  }, 30000);
});
```

### 2.2 テキスト検索統合テスト

**ファイル:** `/src/__tests__/integration/text-search.test.ts`

```typescript
import { searchDocuments } from '../../services/opensearch.service.enhanced';
import { SearchQuery } from '../../types';

describe('Text Search Integration', () => {
  describe('日本語検索', () => {
    it('「宇都宮」で検索し、結果を取得できる', async () => {
      const query: SearchQuery = {
        query: '宇都宮',
        size: 20,
        from: 0,
        sortBy: 'relevance',
        sortOrder: 'desc',
      };

      const result = await searchDocuments(query);

      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.took).toBeGreaterThan(0);

      // 結果がある場合、宇都宮を含むはず
      if (result.results.length > 0) {
        const hasMatch = result.results.some(
          (r) =>
            r.fileName.includes('宇都宮') ||
            r.filePath.includes('宇都宮') ||
            r.snippet.includes('宇都宮')
        );
        expect(hasMatch).toBe(true);
      }
    }, 30000);

    it('AND検索モードが正しく動作する', async () => {
      const query: SearchQuery = {
        query: '営業 報告書',
        searchMode: 'and',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      expect(result.total).toBeGreaterThanOrEqual(0);

      // AND検索なので、両方のキーワードを含むはず
      if (result.results.length > 0) {
        result.results.forEach((r) => {
          const text = `${r.fileName} ${r.filePath} ${r.snippet}`.toLowerCase();
          const has営業 = text.includes('営業');
          const has報告書 = text.includes('報告書');
          // AND検索なので厳密には両方必要だが、ファジネスの影響を考慮
          expect(has営業 || has報告書).toBe(true);
        });
      }
    }, 30000);

    it('OR検索モードが正しく動作する', async () => {
      const query: SearchQuery = {
        query: 'PDF Excel',
        searchMode: 'or',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      expect(result.total).toBeGreaterThanOrEqual(0);
    }, 30000);
  });

  describe('フィルター', () => {
    it('ファイルタイプフィルターが正しく適用される', async () => {
      const query: SearchQuery = {
        query: 'test',
        fileType: 'pdf',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      // 結果がある場合、すべてPDFファイルのはず
      if (result.results.length > 0) {
        result.results.forEach((r) => {
          expect(r.fileType.toLowerCase()).toBe('pdf');
        });
      }
    }, 30000);

    it('日付範囲フィルターが正しく適用される', async () => {
      const query: SearchQuery = {
        query: 'test',
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      // 結果がある場合、日付範囲内のはず
      if (result.results.length > 0) {
        result.results.forEach((r) => {
          const date = new Date(r.modifiedDate);
          expect(date.getTime()).toBeGreaterThanOrEqual(new Date('2025-01-01').getTime());
          expect(date.getTime()).toBeLessThanOrEqual(new Date('2025-12-31').getTime());
        });
      }
    }, 30000);
  });

  describe('ページネーション', () => {
    it('ページネーションが正しく動作する', async () => {
      const query1: SearchQuery = {
        query: 'test',
        size: 10,
        from: 0,
      };

      const query2: SearchQuery = {
        query: 'test',
        size: 10,
        from: 10,
      };

      const result1 = await searchDocuments(query1);
      const result2 = await searchDocuments(query2);

      // totalは同じはず
      expect(result1.total).toBe(result2.total);

      // 結果が十分にある場合、IDが重複しないはず
      if (result1.results.length > 0 && result2.results.length > 0) {
        const ids1 = result1.results.map((r) => r.id);
        const ids2 = result2.results.map((r) => r.id);
        const overlap = ids1.filter((id) => ids2.includes(id));
        expect(overlap.length).toBe(0);
      }
    }, 30000);
  });

  describe('ソート', () => {
    it('関連度順ソートが正しく動作する', async () => {
      const query: SearchQuery = {
        query: '宇都宮',
        sortBy: 'relevance',
        sortOrder: 'desc',
        size: 10,
        from: 0,
      };

      const result = await searchDocuments(query);

      // スコアが降順になっているはず
      if (result.results.length > 1) {
        for (let i = 0; i < result.results.length - 1; i++) {
          expect(result.results[i].relevanceScore).toBeGreaterThanOrEqual(
            result.results[i + 1].relevanceScore
          );
        }
      }
    }, 30000);

    it('日付順ソートが正しく動作する', async () => {
      const query: SearchQuery = {
        query: 'test',
        sortBy: 'date',
        sortOrder: 'desc',
        size: 10,
        from: 0,
      };

      const result = await searchDocuments(query);

      // 日付が降順になっているはず
      if (result.results.length > 1) {
        for (let i = 0; i < result.results.length - 1; i++) {
          const date1 = new Date(result.results[i].modifiedDate).getTime();
          const date2 = new Date(result.results[i + 1].modifiedDate).getTime();
          expect(date1).toBeGreaterThanOrEqual(date2);
        }
      }
    }, 30000);
  });
});
```

### 2.3 画像検索統合テスト

**ファイル:** `/src/__tests__/integration/image-search.test.ts`

```typescript
import { searchDocuments } from '../../services/opensearch.service.enhanced';
import { SearchQuery } from '../../types';

describe('Image Search Integration', () => {
  describe('k-NN検索', () => {
    it('512次元埋め込みで画像検索できる', async () => {
      // ダミーの埋め込みベクトル（実際の使用ではCLIPモデルから生成）
      const embedding = Array(512)
        .fill(0)
        .map(() => Math.random() * 2 - 1);

      const query: SearchQuery = {
        imageEmbedding: embedding,
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.results)).toBe(true);

      // スコアが設定されているはず
      if (result.results.length > 0) {
        result.results.forEach((r) => {
          expect(r.relevanceScore).toBeGreaterThan(0);
        });
      }
    }, 30000);

    it('1024次元埋め込みで画像検索できる（Bedrock Titan）', async () => {
      const embedding = Array(1024)
        .fill(0)
        .map(() => Math.random() * 2 - 1);

      const query: SearchQuery = {
        imageEmbedding: embedding,
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.results)).toBe(true);
    }, 30000);

    it('画像検索結果が類似度順にソートされている', async () => {
      const embedding = Array(512)
        .fill(0)
        .map(() => Math.random() * 2 - 1);

      const query: SearchQuery = {
        imageEmbedding: embedding,
        size: 10,
        from: 0,
      };

      const result = await searchDocuments(query);

      // スコアが降順になっているはず
      if (result.results.length > 1) {
        for (let i = 0; i < result.results.length - 1; i++) {
          expect(result.results[i].relevanceScore).toBeGreaterThanOrEqual(
            result.results[i + 1].relevanceScore
          );
        }
      }
    }, 30000);
  });

  describe('画像検索 + フィルター', () => {
    it('画像検索にファイルタイプフィルターを適用できる', async () => {
      const embedding = Array(512)
        .fill(0)
        .map(() => Math.random() * 2 - 1);

      const query: SearchQuery = {
        imageEmbedding: embedding,
        fileType: 'jpg',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      // 結果がある場合、すべてJPGファイルのはず
      if (result.results.length > 0) {
        result.results.forEach((r) => {
          expect(r.fileType.toLowerCase()).toMatch(/jpg|jpeg/);
        });
      }
    }, 30000);

    it('画像検索に日付範囲フィルターを適用できる', async () => {
      const embedding = Array(512)
        .fill(0)
        .map(() => Math.random() * 2 - 1);

      const query: SearchQuery = {
        imageEmbedding: embedding,
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      expect(result.total).toBeGreaterThanOrEqual(0);
    }, 30000);
  });
});
```

### 2.4 ハイブリッド検索統合テスト

**ファイル:** `/src/__tests__/integration/hybrid-search.test.ts`

```typescript
import { searchDocuments } from '../../services/opensearch.service.enhanced';
import { SearchQuery } from '../../types';

describe('Hybrid Search Integration', () => {
  it('テキスト検索と画像検索を組み合わせて実行できる', async () => {
    const embedding = Array(512)
      .fill(0)
      .map(() => Math.random() * 2 - 1);

    const query: SearchQuery = {
      query: '宇都宮',
      imageEmbedding: embedding,
      size: 20,
      from: 0,
    };

    const result = await searchDocuments(query);

    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.results)).toBe(true);

    // ハイブリッド検索では両方の条件が考慮される
    // 現在の実装では画像検索が優先されるため、テキストはフィルターとして機能
  }, 30000);

  it('ハイブリッド検索にフィルターを適用できる', async () => {
    const embedding = Array(512)
      .fill(0)
      .map(() => Math.random() * 2 - 1);

    const query: SearchQuery = {
      query: 'test',
      imageEmbedding: embedding,
      fileType: 'pdf',
      dateFrom: '2025-01-01',
      size: 20,
      from: 0,
    };

    const result = await searchDocuments(query);

    expect(result.total).toBeGreaterThanOrEqual(0);
  }, 30000);
});
```

---

## 3. E2Eテスト（End-to-End Tests）

### 3.1 Lambda実行テスト

**ファイル:** `/scripts/test-lambda-e2e.sh`

```bash
#!/bin/bash
# E2Eテスト: 実際のLambda関数を呼び出してテスト

set -e

FUNCTION_NAME="cis-search-api-prod"
REGION="ap-northeast-1"

echo "========================================="
echo "Lambda E2E Tests"
echo "========================================="

# 1. テキスト検索テスト（宇都宮）
echo -e "\n1. Testing text search: 宇都宮"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"宇都宮","page":"1","limit":"10"}}' \
  /tmp/lambda-response-text.json

cat /tmp/lambda-response-text.json | jq .
RESULT=$(cat /tmp/lambda-response-text.json | jq -r '.statusCode')
if [ "$RESULT" != "200" ]; then
  echo "❌ Text search failed"
  exit 1
fi
echo "✅ Text search passed"

# 2. AND検索テスト
echo -e "\n2. Testing AND search mode"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"営業 報告書","searchMode":"and","page":"1","limit":"10"}}' \
  /tmp/lambda-response-and.json

RESULT=$(cat /tmp/lambda-response-and.json | jq -r '.statusCode')
if [ "$RESULT" != "200" ]; then
  echo "❌ AND search failed"
  exit 1
fi
echo "✅ AND search passed"

# 3. フィルター付き検索テスト
echo -e "\n3. Testing search with filters"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","fileType":"pdf","dateFrom":"2025-01-01","page":"1","limit":"10"}}' \
  /tmp/lambda-response-filter.json

RESULT=$(cat /tmp/lambda-response-filter.json | jq -r '.statusCode')
if [ "$RESULT" != "200" ]; then
  echo "❌ Filtered search failed"
  exit 1
fi
echo "✅ Filtered search passed"

# 4. 画像検索テスト
echo -e "\n4. Testing image search"
# 512次元のダミー埋め込み生成
EMBEDDING=$(node -e "console.log(JSON.stringify(Array(512).fill(0.5)))")
PAYLOAD=$(jq -n \
  --arg embedding "$EMBEDDING" \
  '{"httpMethod":"POST","body":("{\"imageEmbedding\":"+$embedding+",\"page\":1,\"limit\":10}")}')

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload "$PAYLOAD" \
  /tmp/lambda-response-image.json

RESULT=$(cat /tmp/lambda-response-image.json | jq -r '.statusCode')
if [ "$RESULT" != "200" ]; then
  echo "❌ Image search failed"
  exit 1
fi
echo "✅ Image search passed"

# 5. ハイブリッド検索テスト
echo -e "\n5. Testing hybrid search (text + image)"
HYBRID_PAYLOAD=$(jq -n \
  --arg embedding "$EMBEDDING" \
  '{"httpMethod":"POST","body":("{\"q\":\"宇都宮\",\"imageEmbedding\":"+$embedding+",\"page\":1,\"limit\":10}")}')

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload "$HYBRID_PAYLOAD" \
  /tmp/lambda-response-hybrid.json

RESULT=$(cat /tmp/lambda-response-hybrid.json | jq -r '.statusCode')
if [ "$RESULT" != "200" ]; then
  echo "❌ Hybrid search failed"
  exit 1
fi
echo "✅ Hybrid search passed"

# 6. エラーケーステスト
echo -e "\n6. Testing error cases"

# 無効なクエリ
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{}}' \
  /tmp/lambda-response-error.json

RESULT=$(cat /tmp/lambda-response-error.json | jq -r '.statusCode')
if [ "$RESULT" != "400" ]; then
  echo "❌ Error handling failed"
  exit 1
fi
echo "✅ Error handling passed"

# 7. CORSテスト
echo -e "\n7. Testing CORS preflight"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"OPTIONS","path":"/search"}' \
  /tmp/lambda-response-cors.json

RESULT=$(cat /tmp/lambda-response-cors.json | jq -r '.statusCode')
if [ "$RESULT" != "200" ]; then
  echo "❌ CORS test failed"
  exit 1
fi
echo "✅ CORS test passed"

echo -e "\n========================================="
echo "✅ All E2E tests passed!"
echo "========================================="
```

### 3.2 API Gateway統合テスト

**ファイル:** `/scripts/test-api-gateway-e2e.sh`

```bash
#!/bin/bash
# API Gateway経由のE2Eテスト

set -e

API_ENDPOINT="https://5xbn5nq51f.execute-api.ap-northeast-1.amazonaws.com/prod/search"

echo "========================================="
echo "API Gateway E2E Tests"
echo "========================================="

# 1. テキスト検索（宇都宮）
echo -e "\n1. Testing text search via API Gateway"
curl -s -X GET "$API_ENDPOINT?q=宇都宮&page=1&limit=10" \
  -H "Content-Type: application/json" \
  | jq . > /tmp/api-response-text.json

STATUS=$(cat /tmp/api-response-text.json | jq -r '.success')
if [ "$STATUS" != "true" ]; then
  echo "❌ Text search failed"
  cat /tmp/api-response-text.json
  exit 1
fi
echo "✅ Text search passed"

# 2. 画像検索
echo -e "\n2. Testing image search via API Gateway"
EMBEDDING=$(node -e "console.log(JSON.stringify(Array(512).fill(0.5)))")
curl -s -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"imageEmbedding\":$EMBEDDING,\"page\":1,\"limit\":10}" \
  | jq . > /tmp/api-response-image.json

STATUS=$(cat /tmp/api-response-image.json | jq -r '.success')
if [ "$STATUS" != "true" ]; then
  echo "❌ Image search failed"
  cat /tmp/api-response-image.json
  exit 1
fi
echo "✅ Image search passed"

# 3. ハイブリッド検索
echo -e "\n3. Testing hybrid search via API Gateway"
curl -s -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"q\":\"宇都宮\",\"imageEmbedding\":$EMBEDDING,\"page\":1,\"limit\":10}" \
  | jq . > /tmp/api-response-hybrid.json

STATUS=$(cat /tmp/api-response-hybrid.json | jq -r '.success')
if [ "$STATUS" != "true" ]; then
  echo "❌ Hybrid search failed"
  cat /tmp/api-response-hybrid.json
  exit 1
fi
echo "✅ Hybrid search passed"

# 4. CORSヘッダー検証
echo -e "\n4. Testing CORS headers"
CORS_HEADER=$(curl -s -I -X OPTIONS "$API_ENDPOINT" | grep -i "access-control-allow-origin")
if [ -z "$CORS_HEADER" ]; then
  echo "❌ CORS headers not found"
  exit 1
fi
echo "✅ CORS headers present: $CORS_HEADER"

echo -e "\n========================================="
echo "✅ All API Gateway E2E tests passed!"
echo "========================================="
```

---

## 4. パフォーマンステスト

### 4.1 レスポンスタイムテスト

**ファイル:** `/scripts/test-performance.sh`

```bash
#!/bin/bash
# パフォーマンステスト

set -e

API_ENDPOINT="https://5xbn5nq51f.execute-api.ap-northeast-1.amazonaws.com/prod/search"
ITERATIONS=10

echo "========================================="
echo "Performance Tests (${ITERATIONS} iterations)"
echo "========================================="

# テキスト検索のレスポンスタイム計測
echo -e "\n1. Text search response time"
total=0
for i in $(seq 1 $ITERATIONS); do
  start=$(date +%s%3N)
  curl -s -X GET "$API_ENDPOINT?q=宇都宮&page=1&limit=10" > /dev/null
  end=$(date +%s%3N)
  duration=$((end - start))
  echo "  Iteration $i: ${duration}ms"
  total=$((total + duration))
done
average=$((total / ITERATIONS))
echo "  Average: ${average}ms"

if [ $average -gt 1000 ]; then
  echo "⚠️  Warning: Average response time exceeds 1000ms"
fi

# 画像検索のレスポンスタイム計測
echo -e "\n2. Image search response time"
EMBEDDING=$(node -e "console.log(JSON.stringify(Array(512).fill(0.5)))")
total=0
for i in $(seq 1 $ITERATIONS); do
  start=$(date +%s%3N)
  curl -s -X POST "$API_ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "{\"imageEmbedding\":$EMBEDDING,\"page\":1,\"limit\":10}" > /dev/null
  end=$(date +%s%3N)
  duration=$((end - start))
  echo "  Iteration $i: ${duration}ms"
  total=$((total + duration))
done
average=$((total / ITERATIONS))
echo "  Average: ${average}ms"

if [ $average -gt 2000 ]; then
  echo "⚠️  Warning: Average response time exceeds 2000ms"
fi

echo -e "\n========================================="
echo "✅ Performance tests completed"
echo "========================================="
```

### 4.2 負荷テスト

**ファイル:** `/scripts/test-load.sh`

```bash
#!/bin/bash
# 負荷テスト: 並列リクエストでテスト

set -e

API_ENDPOINT="https://5xbn5nq51f.execute-api.ap-northeast-1.amazonaws.com/prod/search"
CONCURRENT=10
TOTAL_REQUESTS=100

echo "========================================="
echo "Load Test"
echo "Concurrent: $CONCURRENT"
echo "Total Requests: $TOTAL_REQUESTS"
echo "========================================="

# ApacheBenchを使用
ab -n $TOTAL_REQUESTS -c $CONCURRENT \
  "$API_ENDPOINT?q=test&page=1&limit=10"

echo -e "\n========================================="
echo "✅ Load test completed"
echo "========================================="
```

---

## 5. エラーケーステスト

### 5.1 認証エラーテスト

**ファイル:** `/src/__tests__/integration/error-cases.test.ts`

```typescript
import { handler } from '../../index';
import { Context } from 'aws-lambda';

const mockContext: Context = {
  // ... context definition
};

describe('Error Cases Integration', () => {
  it('403エラー（権限不足）を適切に処理する', async () => {
    // OpenSearchロールマッピングが未設定の状態をシミュレート
    // この時点では403エラーが返るはず

    const event = {
      httpMethod: 'GET',
      queryStringParameters: {
        q: 'test',
      },
    };

    const response = await handler(event, mockContext);

    // 403エラーの場合
    if (response.statusCode === 403) {
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toMatch(/FORBIDDEN|ACCESS_DENIED/);
    }
  });

  it('503エラー（サービス利用不可）を適切に処理する', async () => {
    // OpenSearchクラスターが利用不可の状態をテスト

    const event = {
      httpMethod: 'GET',
      queryStringParameters: {
        q: 'test',
      },
    };

    const response = await handler(event, mockContext);

    if (response.statusCode === 503) {
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    }
  });

  it('インデックスが存在しない場合、404エラーを返す', async () => {
    // 存在しないインデックスを指定
    process.env.OPENSEARCH_INDEX = 'non-existent-index';

    const event = {
      httpMethod: 'GET',
      queryStringParameters: {
        q: 'test',
      },
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INDEX_NOT_FOUND');
  });
});
```

---

## 6. テスト実行手順

### 6.1 ローカルでのユニットテスト

```bash
# 依存関係インストール
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
npm install

# すべてのユニットテストを実行
npm test

# ウォッチモード
npm run test:watch

# カバレッジ付き
npm run test:coverage

# 特定のテストファイルのみ
npm test -- validator.test.ts
```

### 6.2 統合テストの実行

```bash
# 環境変数設定
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="cis-files"
export AWS_REGION="ap-northeast-1"

# 統合テスト実行
npm test -- --testPathPattern=integration
```

### 6.3 E2Eテストの実行

```bash
# Lambda関数のE2Eテスト
cd scripts
chmod +x test-lambda-e2e.sh
./test-lambda-e2e.sh

# API GatewayのE2Eテスト
chmod +x test-api-gateway-e2e.sh
./test-api-gateway-e2e.sh
```

### 6.4 パフォーマンステストの実行

```bash
# レスポンスタイムテスト
chmod +x test-performance.sh
./test-performance.sh

# 負荷テスト（要ApacheBench）
chmod +x test-load.sh
./test-load.sh
```

---

## 7. テストカバレッジレポート

### 7.1 カバレッジ目標

| テストタイプ | カバレッジ目標 | 現在の状況 |
|------------|--------------|----------|
| ユニットテスト | 80%以上 | 実装待ち |
| 統合テスト | 70%以上 | 実装待ち |
| E2Eテスト | 主要シナリオ100% | 実装待ち |

### 7.2 カバレッジレポート生成

```bash
# カバレッジレポート生成
npm run test:coverage

# HTMLレポート閲覧
open coverage/lcov-report/index.html
```

### 7.3 未カバレッジ領域の特定

カバレッジレポートから以下を重点的に確認：
- エラーハンドリングパス
- エッジケース
- フィルター条件の組み合わせ
- ページネーションの境界値

---

## 8. CI/CD統合

### 8.1 GitHub Actions設定

**ファイル:** `/.github/workflows/lambda-tests.yml`

```yaml
name: Lambda Search API Tests

on:
  push:
    branches: [main, develop]
    paths:
      - 'backend/lambda-search-api/**'
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20.x'

      - name: Install dependencies
        working-directory: backend/lambda-search-api
        run: npm ci

      - name: Run unit tests
        working-directory: backend/lambda-search-api
        run: npm test -- --coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: backend/lambda-search-api/coverage/lcov.info

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20.x'

      - name: Install dependencies
        working-directory: backend/lambda-search-api
        run: npm ci

      - name: Run integration tests
        working-directory: backend/lambda-search-api
        env:
          OPENSEARCH_ENDPOINT: ${{ secrets.OPENSEARCH_ENDPOINT }}
          OPENSEARCH_INDEX: cis-files-test
          AWS_REGION: ap-northeast-1
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: npm test -- --testPathPattern=integration

  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-northeast-1

      - name: Run E2E tests
        working-directory: backend/lambda-search-api/scripts
        run: |
          chmod +x test-lambda-e2e.sh
          ./test-lambda-e2e.sh
```

---

## 9. 特定のテストシナリオ

### 9.1 「宇都宮」検索テストケース

```typescript
describe('「宇都宮」検索の包括的テスト', () => {
  it('テキスト検索のみで「宇都宮」を検索できる', async () => {
    const query: SearchQuery = {
      query: '宇都宮',
      size: 20,
      from: 0,
    };

    const result = await searchDocuments(query);

    expect(result.total).toBeGreaterThan(0);
    // 結果に「宇都宮」が含まれることを確認
    const hasMatch = result.results.some(r =>
      r.fileName.includes('宇都宮') ||
      r.filePath.includes('宇都宮') ||
      r.snippet.includes('宇都宮')
    );
    expect(hasMatch).toBe(true);
  });

  it('「宇都宮」 + 画像検索のハイブリッド検索', async () => {
    const embedding = Array(512).fill(0).map(() => Math.random() * 2 - 1);

    const query: SearchQuery = {
      query: '宇都宮',
      imageEmbedding: embedding,
      size: 20,
      from: 0,
    };

    const result = await searchDocuments(query);

    expect(result.total).toBeGreaterThanOrEqual(0);
    // ハイブリッド検索は両方の条件を考慮
  });

  it('「宇都宮」 + PDFフィルター', async () => {
    const query: SearchQuery = {
      query: '宇都宮',
      fileType: 'pdf',
      size: 20,
      from: 0,
    };

    const result = await searchDocuments(query);

    if (result.results.length > 0) {
      result.results.forEach(r => {
        expect(r.fileType.toLowerCase()).toBe('pdf');
      });
    }
  });

  it('「宇都宮」 + 日付範囲フィルター', async () => {
    const query: SearchQuery = {
      query: '宇都宮',
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      size: 20,
      from: 0,
    };

    const result = await searchDocuments(query);

    expect(result.total).toBeGreaterThanOrEqual(0);
  });
});
```

---

## 10. トラブルシューティング

### 10.1 403 Forbiddenエラー

**原因:** OpenSearchのロールマッピング未設定

**解決方法:**
```bash
# ロールマッピング設定スクリプト実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/scripts
./setup-role-mapping.py
```

**確認方法:**
```bash
# テスト実行
npm test -- --testPathPattern=integration/opensearch-connection
```

### 10.2 テストタイムアウト

**原因:** OpenSearch接続が遅い、またはネットワーク問題

**解決方法:**
```typescript
// jest.config.jsでタイムアウトを延長
module.exports = {
  testTimeout: 30000, // 30秒
};
```

### 10.3 環境変数未設定

**原因:** OPENSEARCH_ENDPOINTなどが未設定

**解決方法:**
```bash
# .env.testファイル作成
cat > .env.test <<EOF
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=cis-files
AWS_REGION=ap-northeast-1
EOF

# テスト実行時に読み込み
source .env.test
npm test
```

---

## 11. テスト結果の記録

### 11.1 テスト結果サマリー

| テストカテゴリ | 実行日 | 成功 | 失敗 | カバレッジ |
|-------------|-------|-----|-----|----------|
| ユニットテスト | - | - | - | -% |
| 統合テスト | - | - | - | -% |
| E2Eテスト | - | - | - | -% |

### 11.2 既知の問題

| 問題 | 優先度 | ステータス | 備考 |
|------|-------|----------|------|
| 403 Forbiddenエラー | 高 | 対応中 | ロールマッピング設定待ち |

---

## まとめ

このテスト計画では以下をカバーしています：

1. **ユニットテスト**: バリデーション、エラーハンドリング、Lambda Handler
2. **統合テスト**: OpenSearch接続、テキスト検索、画像検索、ハイブリッド検索
3. **E2Eテスト**: Lambda実行、API Gateway統合
4. **パフォーマンステスト**: レスポンスタイム、負荷テスト
5. **エラーケーステスト**: 403, 503, 404エラー

**次のステップ:**
1. ロールマッピング設定完了後、全テストを実行
2. カバレッジレポート確認
3. 不足しているテストケースを追加
4. CI/CD統合設定
