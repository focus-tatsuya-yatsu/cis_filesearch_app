/**
 * Image Embedding API Route Integration Tests
 * ベクトル化処理の統合テスト（Bedrockモック含む）
 *
 * テスト対象:
 * - AWS Bedrock統合
 * - ベクトル化処理
 * - キャッシュ機能
 * - リトライロジック
 * - エラーハンドリング
 */

import { POST, OPTIONS } from '../route';
import { NextRequest } from 'next/server';

// AWS SDKのモック
jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    InvokeModelCommand: jest.fn(),
  };
});

// 埋め込みキャッシュのモック
jest.mock('@/lib/embeddingCache', () => {
  const mockCache = {
    get: jest.fn(),
    set: jest.fn(),
    logStats: jest.fn(),
  };
  return {
    getEmbeddingCache: jest.fn(() => mockCache),
  };
});

describe('Image Embedding API Route Integration Tests', () => {
  let mockRequest: NextRequest;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // モックモードを有効化
    process.env.USE_MOCK_EMBEDDING = 'true';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('POST /api/image-embedding', () => {
    it('正常な画像がベクトル化されること（モックモード）', async () => {
      // Arrange: 正常な画像ファイル
      const imageFile = new File(
        [Buffer.from('fake-image-content')],
        'test-image.jpg',
        { type: 'image/jpeg' }
      );
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act: API呼び出し
      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Assert: レスポンス検証
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data).toBeDefined();
      expect(responseData.data.embedding).toBeDefined();
      expect(responseData.data.dimensions).toBe(1024); // Titan Embeddingsは1024次元
      expect(Array.isArray(responseData.data.embedding)).toBe(true);
      expect(responseData.data.embedding.length).toBe(1024);
      expect(responseData.data.fileName).toBe('test-image.jpg');
      expect(responseData.data.fileType).toBe('image/jpeg');
    });

    it('PNG画像が正しく処理されること', async () => {
      // Arrange
      const imageFile = new File(
        [Buffer.from('fake-png-content')],
        'test-image.png',
        { type: 'image/png' }
      );
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(responseData.data.fileType).toBe('image/png');
    });

    it('画像ファイルが提供されない場合、400エラーが返されること', async () => {
      // Arrange: 空のフォームデータ
      const formData = new FormData();
      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(responseData.error).toBe('Image file is required');
      expect(responseData.code).toBe('MISSING_IMAGE');
    });

    it('ファイルサイズが5MBを超える場合、エラーが返されること', async () => {
      // Arrange: 6MBの大きなファイル
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
      const imageFile = new File([largeBuffer], 'large-image.jpg', {
        type: 'image/jpeg',
      });
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(responseData.error).toContain('5MB');
      expect(responseData.code).toBe('FILE_TOO_LARGE');
    });

    it('サポートされていないファイル形式が拒否されること', async () => {
      // Arrange: GIFファイル
      const imageFile = new File(
        [Buffer.from('fake-gif-content')],
        'test-image.gif',
        { type: 'image/gif' }
      );
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(responseData.error).toContain('JPEG and PNG');
      expect(responseData.code).toBe('INVALID_FILE_TYPE');
    });

    it('複数の異なるファイル形式が正しく拒否されること', async () => {
      const unsupportedTypes = [
        { name: 'test.bmp', type: 'image/bmp' },
        { name: 'test.webp', type: 'image/webp' },
        { name: 'test.svg', type: 'image/svg+xml' },
        { name: 'test.pdf', type: 'application/pdf' },
      ];

      for (const fileType of unsupportedTypes) {
        const imageFile = new File(
          [Buffer.from('content')],
          fileType.name,
          { type: fileType.type }
        );
        const formData = new FormData();
        formData.append('image', imageFile);

        mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
          method: 'POST',
          body: formData,
        });

        const response = await POST(mockRequest);
        const responseData = await response.json();

        expect(response.status).toBe(400);
        expect(responseData.code).toBe('INVALID_FILE_TYPE');
      }
    });
  });

  describe('Bedrock Integration Tests (Mock Mode)', () => {
    it('モックモードで1024次元のベクトルが生成されること', async () => {
      // Arrange
      const imageFile = new File(
        [Buffer.from('test-content')],
        'test.jpg',
        { type: 'image/jpeg' }
      );
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Assert
      expect(responseData.data.dimensions).toBe(1024);
      expect(responseData.data.embedding).toHaveLength(1024);

      // ベクトルの値が-1から1の範囲にあることを確認
      const allInRange = responseData.data.embedding.every(
        (val: number) => val >= -1 && val <= 1
      );
      expect(allInRange).toBe(true);
    });

    it('ベクトルの値が数値であることを確認', async () => {
      // Arrange
      const imageFile = new File(
        [Buffer.from('test-content')],
        'test.jpg',
        { type: 'image/jpeg' }
      );
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Assert
      const allNumbers = responseData.data.embedding.every(
        (val: any) => typeof val === 'number' && !isNaN(val)
      );
      expect(allNumbers).toBe(true);
    });
  });

  describe('Cache Integration Tests', () => {
    it('キャッシュが利用可能な場合、キャッシュから取得されること', async () => {
      // Arrange: キャッシュモックを設定
      const { getEmbeddingCache } = require('@/lib/embeddingCache');
      const mockCache = getEmbeddingCache();
      const cachedEmbedding = Array(1024).fill(0.5);
      mockCache.get.mockReturnValueOnce(cachedEmbedding);

      const imageFile = new File(
        [Buffer.from('cached-image')],
        'cached.jpg',
        { type: 'image/jpeg' }
      );
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Assert
      expect(mockCache.get).toHaveBeenCalled();
      expect(responseData.data.cached).toBe(true);
      expect(responseData.data.embedding).toEqual(cachedEmbedding);
    });

    it('キャッシュミスの場合、新しくベクトルが生成されること', async () => {
      // Arrange
      const { getEmbeddingCache } = require('@/lib/embeddingCache');
      const mockCache = getEmbeddingCache();
      mockCache.get.mockReturnValueOnce(null); // キャッシュミス

      const imageFile = new File(
        [Buffer.from('new-image')],
        'new.jpg',
        { type: 'image/jpeg' }
      );
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Assert
      expect(mockCache.get).toHaveBeenCalled();
      expect(mockCache.set).toHaveBeenCalled();
      expect(responseData.data.cached).toBe(false);
      expect(responseData.data.embedding).toHaveLength(1024);
    });
  });

  describe('CORS Headers Tests', () => {
    it('CORSヘッダーが正しく設定されること', async () => {
      // Arrange
      const imageFile = new File(
        [Buffer.from('test')],
        'test.jpg',
        { type: 'image/jpeg' }
      );
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);

      // Assert: CORSヘッダー確認
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('OPTIONSリクエストが正しく処理されること', async () => {
      // Act
      const response = await OPTIONS();

      // Assert
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    });
  });

  describe('Performance Tests', () => {
    it('モックモードでのレスポンスタイムが2秒以内であること', async () => {
      // Arrange
      const imageFile = new File(
        [Buffer.from('performance-test')],
        'perf.jpg',
        { type: 'image/jpeg' }
      );
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const startTime = Date.now();
      const response = await POST(mockRequest);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(2000); // 2秒以内
    }, 5000); // テストタイムアウト: 5秒

    it('複数の同時リクエストが処理されること', async () => {
      // Arrange: 5つの同時リクエスト
      const requests = Array.from({ length: 5 }, (_, i) => {
        const imageFile = new File(
          [Buffer.from(`test-${i}`)],
          `test-${i}.jpg`,
          { type: 'image/jpeg' }
        );
        const formData = new FormData();
        formData.append('image', imageFile);

        return new NextRequest('http://localhost:3000/api/image-embedding', {
          method: 'POST',
          body: formData,
        });
      });

      // Act: 並列実行
      const responses = await Promise.all(
        requests.map(req => POST(req))
      );

      // Assert: すべて成功
      const allSuccessful = await Promise.all(
        responses.map(async (res) => {
          const data = await res.json();
          return res.status === 200 && data.success === true;
        })
      );

      expect(allSuccessful.every(success => success)).toBe(true);
    }, 10000);
  });

  describe('Edge Cases', () => {
    it('0バイトファイルが処理されること', async () => {
      // Arrange: 空のファイル
      const imageFile = new File([], 'empty.jpg', { type: 'image/jpeg' });
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);
      const responseData = await response.json();

      // Assert: ベクトル化は成功するが、実際のユースケースでは無効
      expect(response.status).toBe(200);
      expect(responseData.data.fileSize).toBe(0);
    });

    it('境界値のファイルサイズ（ちょうど5MB）が許可されること', async () => {
      // Arrange: ちょうど5MB
      const exactBuffer = Buffer.alloc(5 * 1024 * 1024);
      const imageFile = new File([exactBuffer], 'exact-5mb.jpg', {
        type: 'image/jpeg',
      });
      const formData = new FormData();
      formData.append('image', imageFile);

      mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
        method: 'POST',
        body: formData,
      });

      // Act
      const response = await POST(mockRequest);

      // Assert
      expect(response.status).toBe(200);
    });

    it('ファイル名に特殊文字が含まれる場合も処理されること', async () => {
      // Arrange: 特殊文字を含むファイル名
      const specialNames = [
        'test image (1).jpg',
        'テスト画像.jpg',
        'test-image_2024.jpg',
        'image#1.jpg',
      ];

      for (const fileName of specialNames) {
        const imageFile = new File(
          [Buffer.from('content')],
          fileName,
          { type: 'image/jpeg' }
        );
        const formData = new FormData();
        formData.append('image', imageFile);

        mockRequest = new NextRequest('http://localhost:3000/api/image-embedding', {
          method: 'POST',
          body: formData,
        });

        const response = await POST(mockRequest);
        const responseData = await response.json();

        expect(response.status).toBe(200);
        expect(responseData.data.fileName).toBe(fileName);
      }
    });
  });
});
