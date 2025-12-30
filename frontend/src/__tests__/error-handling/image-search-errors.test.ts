/**
 * Image Search Error Handling & Edge Cases Tests
 * 画像検索のエラーハンドリングとエッジケーステスト
 *
 * テスト対象:
 * - OpenSearch接続エラー
 * - Lambda関数タイムアウト
 * - 無効なベクトルデータ
 * - ネットワークエラー
 * - レート制限
 * - データ整合性エラー
 */

import { uploadImageForEmbedding, searchByImageEmbedding } from '@/lib/api/imageSearch';

global.fetch = jest.fn();

describe('Image Search Error Handling Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('OpenSearch Connection Errors', () => {
    it('OpenSearch接続タイムアウトが適切にハンドリングされること', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.5);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => ({
          message: 'Gateway Timeout - OpenSearch connection timed out',
        }),
      });

      // Act & Assert
      await expect(searchByImageEmbedding(embedding)).rejects.toThrow(
        /timeout/i
      );
    });

    it('OpenSearchが利用不可の場合、503エラーが返されること', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.5);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          message: 'Service Unavailable - OpenSearch cluster is down',
        }),
      });

      // Act & Assert
      await expect(searchByImageEmbedding(embedding)).rejects.toThrow(
        /unavailable/i
      );
    });

    it('OpenSearch認証エラーが適切に報告されること', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.5);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          message: 'Unauthorized - Invalid OpenSearch credentials',
        }),
      });

      // Act & Assert
      await expect(searchByImageEmbedding(embedding)).rejects.toThrow(
        /Unauthorized/i
      );
    });

    it('OpenSearchインデックスが存在しない場合のエラー', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.5);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          message: 'Index not found',
        }),
      });

      // Act & Assert
      await expect(searchByImageEmbedding(embedding)).rejects.toThrow(
        /not found/i
      );
    });
  });

  describe('Lambda Function Errors', () => {
    it('Lambda関数タイムアウトが適切にハンドリングされること', async () => {
      // Arrange
      const testFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => ({
          error: 'Lambda function timeout',
          code: 'LAMBDA_TIMEOUT',
          message: 'The Lambda function exceeded the maximum execution time',
        }),
      });

      // Act
      const result = await uploadImageForEmbedding(testFile);

      // Assert
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('code', 'LAMBDA_TIMEOUT');
    });

    it('Lambdaメモリ不足エラーが報告されること', async () => {
      // Arrange
      const testFile = new File(['content'], 'large.jpg', { type: 'image/jpeg' });
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: 'Lambda out of memory',
          code: 'LAMBDA_OUT_OF_MEMORY',
        }),
      });

      // Act
      const result = await uploadImageForEmbedding(testFile);

      // Assert
      expect(result).toHaveProperty('code', 'LAMBDA_OUT_OF_MEMORY');
    });

    it('Lambda関数コールドスタートによる遅延が許容されること', async () => {
      // Arrange: コールドスタートシミュレーション（5秒の遅延）
      const testFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
      const mockEmbedding = Array(1024).fill(0.5);

      (global.fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({
                  success: true,
                  data: {
                    embedding: mockEmbedding,
                    dimensions: 1024,
                    fileName: 'test.jpg',
                    fileSize: 1024,
                    fileType: 'image/jpeg',
                  },
                }),
              });
            }, 5000);
          })
      );

      // Act
      const startTime = Date.now();
      const result = await uploadImageForEmbedding(testFile);
      const duration = Date.now() - startTime;

      // Assert: 遅延があっても成功
      expect(result).toHaveProperty('success', true);
      expect(duration).toBeGreaterThanOrEqual(5000);
    }, 10000); // 10秒のタイムアウト
  });

  describe('Invalid Vector Data Errors', () => {
    it('次元数が不正なベクトルでエラーが発生すること', async () => {
      // Arrange: 512次元（正しくは1024次元）
      const invalidEmbedding = Array(512).fill(0.5);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: 'Invalid embedding dimensions. Expected 1024, got 512',
        }),
      });

      // Act & Assert
      await expect(searchByImageEmbedding(invalidEmbedding)).rejects.toThrow(
        /dimensions/i
      );
    });

    it('NaN値を含むベクトルでエラーが発生すること', async () => {
      // Arrange
      const invalidEmbedding = Array(1024).fill(NaN);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: 'Embedding contains invalid values (NaN)',
        }),
      });

      // Act & Assert
      await expect(searchByImageEmbedding(invalidEmbedding)).rejects.toThrow(
        /invalid/i
      );
    });

    it('Infinity値を含むベクトルでエラーが発生すること', async () => {
      // Arrange
      const invalidEmbedding = Array(1024).fill(Infinity);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: 'Embedding contains invalid values (Infinity)',
        }),
      });

      // Act & Assert
      await expect(searchByImageEmbedding(invalidEmbedding)).rejects.toThrow();
    });

    it('空のベクトル配列でエラーが発生すること', async () => {
      // Arrange
      const emptyEmbedding: number[] = [];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: 'Embedding cannot be empty',
        }),
      });

      // Act & Assert
      await expect(searchByImageEmbedding(emptyEmbedding)).rejects.toThrow();
    });
  });

  describe('Network Errors', () => {
    it('ネットワーク切断エラーが適切にハンドリングされること', async () => {
      // Arrange
      const testFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network request failed')
      );

      // Act
      const result = await uploadImageForEmbedding(testFile);

      // Assert
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('code', 'NETWORK_ERROR');
    });

    it('DNSエラーが適切にハンドリングされること', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.5);
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('getaddrinfo ENOTFOUND')
      );

      // Act & Assert
      await expect(searchByImageEmbedding(embedding)).rejects.toThrow(
        /ENOTFOUND/
      );
    });

    it('接続リセットエラーが適切にハンドリングされること', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.5);
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('ECONNRESET')
      );

      // Act & Assert
      await expect(searchByImageEmbedding(embedding)).rejects.toThrow(
        /ECONNRESET/
      );
    });
  });

  describe('Rate Limiting Errors', () => {
    it('レート制限エラーが適切に報告されること', async () => {
      // Arrange
      const testFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Please wait before making another request',
          retryAfter: 60,
        }),
      });

      // Act
      const result = await uploadImageForEmbedding(testFile);

      // Assert
      expect(result).toHaveProperty('code', 'RATE_LIMIT_EXCEEDED');
    });

    it('AWS Bedrockスロットリングエラーが報告されること', async () => {
      // Arrange
      const testFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          error: 'AWS Bedrock throttling',
          code: 'THROTTLING_EXCEPTION',
          message: 'Rate exceeded for Bedrock API',
        }),
      });

      // Act
      const result = await uploadImageForEmbedding(testFile);

      // Assert
      expect(result).toHaveProperty('code', 'THROTTLING_EXCEPTION');
    });
  });

  describe('Data Integrity Errors', () => {
    it('破損した画像ファイルでエラーが発生すること', async () => {
      // Arrange: 破損データ
      const corruptedFile = new File([new Uint8Array([0xff, 0xd8, 0x00])], 'corrupt.jpg', {
        type: 'image/jpeg',
      });
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Corrupted image file',
          code: 'INVALID_IMAGE',
          message: 'Unable to decode image',
        }),
      });

      // Act
      const result = await uploadImageForEmbedding(corruptedFile);

      // Assert
      expect(result).toHaveProperty('code', 'INVALID_IMAGE');
    });

    it('不正なMIMEタイプが拒否されること', async () => {
      // Arrange: テキストファイルを画像として偽装
      const fakeImageFile = new File(['plain text content'], 'fake.jpg', {
        type: 'image/jpeg',
      });
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Invalid file type',
          code: 'INVALID_FILE_TYPE',
          message: 'File content does not match declared MIME type',
        }),
      });

      // Act
      const result = await uploadImageForEmbedding(fakeImageFile);

      // Assert
      expect(result).toHaveProperty('code', 'INVALID_FILE_TYPE');
    });
  });

  describe('Retry Logic Tests', () => {
    it('一時的なエラー後、リトライが成功すること', async () => {
      // Arrange: 最初は失敗、2回目は成功
      const embedding = Array(1024).fill(0.5);
      let callCount = 0;

      (global.fetch as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: async () => ({ message: 'Service temporarily unavailable' }),
          });
        } else {
          return Promise.resolve({
            ok: true,
            json: async () => ({ results: [], total: 0 }),
          });
        }
      });

      // Act: 1回目は失敗、手動でリトライ
      const firstAttempt = searchByImageEmbedding(embedding);
      await expect(firstAttempt).rejects.toThrow();

      const secondAttempt = await searchByImageEmbedding(embedding);

      // Assert: 2回目は成功
      expect(secondAttempt).toBeDefined();
      expect(secondAttempt.results).toEqual([]);
    });

    it('連続したエラーで最終的に失敗すること', async () => {
      // Arrange: 常に失敗
      const embedding = Array(1024).fill(0.5);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Internal server error' }),
      });

      // Act & Assert: 複数回試行してもすべて失敗
      for (let i = 0; i < 3; i++) {
        await expect(searchByImageEmbedding(embedding)).rejects.toThrow();
      }

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Edge Cases', () => {
    it('極端に大きな画像ファイル（10MB）が拒否されること', async () => {
      // Arrange: 10MBのファイル
      const largeBuffer = new ArrayBuffer(10 * 1024 * 1024);
      const largeFile = new File([largeBuffer], 'huge.jpg', { type: 'image/jpeg' });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 413,
        json: async () => ({
          error: 'Payload too large',
          code: 'FILE_TOO_LARGE',
          message: 'Maximum file size is 5MB',
        }),
      });

      // Act
      const result = await uploadImageForEmbedding(largeFile);

      // Assert
      expect(result).toHaveProperty('code', 'FILE_TOO_LARGE');
    });

    it('ファイル名に特殊文字が含まれてもエラーが発生しないこと', async () => {
      // Arrange
      const specialChars = ['file name with spaces.jpg', 'ファイル名.jpg', 'file@#$.jpg'];

      for (const fileName of specialChars) {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              embedding: Array(1024).fill(0.5),
              dimensions: 1024,
              fileName,
              fileSize: 1024,
              fileType: 'image/jpeg',
            },
          }),
        });

        const file = new File(['content'], fileName, { type: 'image/jpeg' });
        const result = await uploadImageForEmbedding(file);

        expect(result).toHaveProperty('success', true);
      }
    });

    it('非常に小さい画像（1x1ピクセル）が処理されること', async () => {
      // Arrange: 極小画像
      const tinyFile = new File([new Uint8Array(100)], 'tiny.jpg', {
        type: 'image/jpeg',
      });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            embedding: Array(1024).fill(0.5),
            dimensions: 1024,
            fileName: 'tiny.jpg',
            fileSize: 100,
            fileType: 'image/jpeg',
          },
        }),
      });

      // Act
      const result = await uploadImageForEmbedding(tinyFile);

      // Assert
      expect(result).toHaveProperty('success', true);
    });

    it('同じ画像を連続してアップロードできること', async () => {
      // Arrange
      const testFile = new File(['content'], 'duplicate.jpg', { type: 'image/jpeg' });
      const mockResponse = {
        success: true,
        data: {
          embedding: Array(1024).fill(0.5),
          dimensions: 1024,
          fileName: 'duplicate.jpg',
          fileSize: 1024,
          fileType: 'image/jpeg',
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      // Act: 同じファイルを3回アップロード
      const results = await Promise.all([
        uploadImageForEmbedding(testFile),
        uploadImageForEmbedding(testFile),
        uploadImageForEmbedding(testFile),
      ]);

      // Assert: すべて成功
      results.forEach((result) => {
        expect(result).toHaveProperty('success', true);
      });
    });
  });
});
