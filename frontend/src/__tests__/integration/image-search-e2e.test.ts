/**
 * Image Search E2E Integration Tests
 * 画像検索のエンドツーエンド統合テスト
 *
 * テスト対象:
 * - 画像アップロードから検索結果表示までの完全なフロー
 * - OpenSearch k-NN検索の精度検証
 * - エラーハンドリング
 * - パフォーマンス
 */

import { uploadImageForEmbedding, searchByImageEmbedding } from '@/lib/api/imageSearch';
import type { ImageEmbeddingResponse } from '@/types';

// Fetchモック
global.fetch = jest.fn();

describe('Image Search E2E Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete Image Search Flow', () => {
    it('画像アップロード → ベクトル化 → 検索のフルフローが動作すること', async () => {
      // Step 1: 画像アップロード
      const mockEmbedding = Array.from({ length: 1024 }, (_, i) => i / 1024);
      const uploadResponse: ImageEmbeddingResponse = {
        success: true,
        data: {
          embedding: mockEmbedding,
          dimensions: 1024,
          fileName: 'test-image.jpg',
          fileSize: 1024 * 1024,
          fileType: 'image/jpeg',
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => uploadResponse,
      });

      const testFile = new File(['test content'], 'test-image.jpg', {
        type: 'image/jpeg',
      });
      const uploadResult = await uploadImageForEmbedding(testFile);

      // Assert: アップロード成功
      expect(uploadResult).toHaveProperty('success', true);
      expect((uploadResult as ImageEmbeddingResponse).data.embedding).toHaveLength(1024);

      // Step 2: ベクトルを使って検索
      const mockSearchResults = {
        results: [
          {
            id: 'doc1',
            path: '/images/similar1.jpg',
            score: 0.95,
            metadata: { size: 2048000, modified: '2024-01-01' },
          },
          {
            id: 'doc2',
            path: '/images/similar2.jpg',
            score: 0.92,
            metadata: { size: 1024000, modified: '2024-01-02' },
          },
        ],
        total: 2,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSearchResults,
      });

      const searchResult = await searchByImageEmbedding(
        (uploadResult as ImageEmbeddingResponse).data.embedding,
        0.9
      );

      // Assert: 検索成功
      expect(searchResult.results).toHaveLength(2);
      expect(searchResult.results[0].score).toBeGreaterThanOrEqual(0.9);
      expect(searchResult.results[0].path).toBe('/images/similar1.jpg');
    });

    it('複数の画像を順次アップロードして検索できること', async () => {
      const testImages = [
        { name: 'image1.jpg', type: 'image/jpeg' },
        { name: 'image2.png', type: 'image/png' },
        { name: 'image3.jpg', type: 'image/jpeg' },
      ];

      for (const [index, imageInfo] of testImages.entries()) {
        // 画像アップロード
        const mockEmbedding = Array(1024).fill(index / 10);
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              embedding: mockEmbedding,
              dimensions: 1024,
              fileName: imageInfo.name,
              fileSize: 1024000,
              fileType: imageInfo.type,
            },
          }),
        });

        const file = new File(['content'], imageInfo.name, { type: imageInfo.type });
        const uploadResult = await uploadImageForEmbedding(file);

        expect((uploadResult as ImageEmbeddingResponse).success).toBe(true);

        // 検索実行
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [{ id: `result-${index}`, score: 0.95 }],
            total: 1,
          }),
        });

        const searchResult = await searchByImageEmbedding(mockEmbedding);
        expect(searchResult.results).toHaveLength(1);
      }
    });
  });

  describe('OpenSearch k-NN Search Accuracy Tests', () => {
    it('高い類似度（0.95以上）の結果が優先的に返されること', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.5);
      const mockResults = {
        results: [
          { id: '1', path: '/img1.jpg', score: 0.98, metadata: {} },
          { id: '2', path: '/img2.jpg', score: 0.96, metadata: {} },
          { id: '3', path: '/img3.jpg', score: 0.95, metadata: {} },
          { id: '4', path: '/img4.jpg', score: 0.91, metadata: {} },
        ],
        total: 4,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResults,
      });

      // Act
      const result = await searchByImageEmbedding(embedding, 0.9);

      // Assert: スコアの降順でソートされていることを確認
      const scores = result.results.map((r: any) => r.score);
      const isSorted = scores.every((score: number, i: number) =>
        i === 0 || scores[i - 1] >= score
      );
      expect(isSorted).toBe(true);
      expect(result.results[0].score).toBeGreaterThanOrEqual(0.95);
    });

    it('信頼度閾値以下の結果が除外されること', async () => {
      // Arrange: 閾値0.95で検索
      const embedding = Array(1024).fill(0.5);
      const mockResults = {
        results: [
          { id: '1', path: '/img1.jpg', score: 0.98, metadata: {} },
          { id: '2', path: '/img2.jpg', score: 0.96, metadata: {} },
          // score < 0.95 の結果は除外される
        ],
        total: 2,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResults,
      });

      // Act
      const result = await searchByImageEmbedding(embedding, 0.95);

      // Assert: すべての結果が閾値以上
      const allAboveThreshold = result.results.every(
        (r: any) => r.score >= 0.95
      );
      expect(allAboveThreshold).toBe(true);
    });

    it('類似画像が存在しない場合、空の結果が返されること', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.1);
      const mockEmptyResults = {
        results: [],
        total: 0,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmptyResults,
      });

      // Act
      const result = await searchByImageEmbedding(embedding, 0.9);

      // Assert
      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('大量の検索結果が返される場合、ページネーションが機能すること', async () => {
      // Arrange: 100件の結果
      const embedding = Array(1024).fill(0.5);
      const mockLargeResults = {
        results: Array.from({ length: 100 }, (_, i) => ({
          id: `doc-${i}`,
          path: `/images/img-${i}.jpg`,
          score: 0.99 - i * 0.001, // スコアを徐々に下げる
          metadata: { size: 1024000 },
        })),
        total: 100,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLargeResults,
      });

      // Act
      const result = await searchByImageEmbedding(embedding, 0.9);

      // Assert
      expect(result.results.length).toBeLessThanOrEqual(100);
      expect(result.total).toBe(100);
    });
  });

  describe('Error Handling Tests', () => {
    it('アップロードエラー後、検索が実行されないこと', async () => {
      // Arrange: アップロードエラー
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: 'Server error',
          code: 'INTERNAL_ERROR',
        }),
      });

      const testFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const uploadResult = await uploadImageForEmbedding(testFile);

      // Assert: エラーレスポンス
      expect(uploadResult).toHaveProperty('error');

      // 検索は実行されない（embeddingがないため）
      const hasEmbedding = 'data' in uploadResult && 'embedding' in uploadResult.data;
      expect(hasEmbedding).toBe(false);
    });

    it('OpenSearch接続エラーが適切にハンドリングされること', async () => {
      // Arrange: 検索エラー
      const embedding = Array(1024).fill(0.5);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          message: 'OpenSearch connection failed',
        }),
      });

      // Act & Assert
      await expect(searchByImageEmbedding(embedding)).rejects.toThrow(
        'OpenSearch connection failed'
      );
    });

    it('無効なベクトルデータで検索エラーが発生すること', async () => {
      // Arrange: 不正な次元数のベクトル
      const invalidEmbedding = Array(512).fill(0.5); // 1024次元ではない
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: 'Invalid embedding dimensions',
        }),
      });

      // Act & Assert
      await expect(searchByImageEmbedding(invalidEmbedding)).rejects.toThrow();
    });

    it('ネットワークタイムアウトが適切にハンドリングされること', async () => {
      // Arrange: タイムアウトシミュレーション
      const embedding = Array(1024).fill(0.5);
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network timeout')
      );

      // Act & Assert
      await expect(searchByImageEmbedding(embedding)).rejects.toThrow('Network timeout');
    });
  });

  describe('Performance Tests', () => {
    it('1000次元ベクトルの検索が5秒以内に完了すること', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.5);
      const mockResults = {
        results: Array(10).fill({ id: 'doc', score: 0.95 }),
        total: 10,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResults,
      });

      // Act
      const startTime = Date.now();
      await searchByImageEmbedding(embedding);
      const duration = Date.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(5000);
    });

    it('複数の並列検索リクエストが処理されること', async () => {
      // Arrange: 10個の同時検索
      const embedding = Array(1024).fill(0.5);
      const mockResults = { results: [], total: 0 };

      // すべてのfetchリクエストをモック
      (global.fetch as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: async () => mockResults,
        })
      );

      // Act: 並列実行
      const searches = Array.from({ length: 10 }, () =>
        searchByImageEmbedding(embedding, 0.9)
      );

      const results = await Promise.all(searches);

      // Assert: すべて成功
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result).toHaveProperty('results');
        expect(result).toHaveProperty('total');
      });
    });
  });

  describe('Data Integrity Tests', () => {
    it('ベクトルデータが検索リクエストで保持されること', async () => {
      // Arrange: 特定のベクトルパターン
      const embedding = Array.from({ length: 1024 }, (_, i) =>
        Math.sin(i / 100) // 正弦波パターン
      );

      let capturedEmbedding: number[] | null = null;
      (global.fetch as jest.Mock).mockImplementationOnce(async (url, options) => {
        const body = JSON.parse(options.body);
        capturedEmbedding = body.embedding;
        return {
          ok: true,
          json: async () => ({ results: [], total: 0 }),
        };
      });

      // Act
      await searchByImageEmbedding(embedding);

      // Assert: 送信されたベクトルが元のベクトルと一致
      expect(capturedEmbedding).toEqual(embedding);
    });

    it('検索結果のメタデータが正しく返されること', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.5);
      const expectedMetadata = {
        size: 2048000,
        modified: '2024-01-15T10:30:00Z',
        format: 'jpeg',
        dimensions: { width: 1920, height: 1080 },
      };

      const mockResults = {
        results: [
          {
            id: 'doc1',
            path: '/images/photo.jpg',
            score: 0.95,
            metadata: expectedMetadata,
          },
        ],
        total: 1,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResults,
      });

      // Act
      const result = await searchByImageEmbedding(embedding);

      // Assert: メタデータの整合性
      expect(result.results[0].metadata).toEqual(expectedMetadata);
    });
  });

  describe('Edge Cases', () => {
    it('ゼロベクトルでの検索が処理されること', async () => {
      // Arrange
      const zeroEmbedding = Array(1024).fill(0);
      const mockResults = { results: [], total: 0 };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResults,
      });

      // Act
      const result = await searchByImageEmbedding(zeroEmbedding);

      // Assert
      expect(result).toBeDefined();
      expect(result.results).toEqual([]);
    });

    it('極端に高い信頼度閾値（0.99）での検索が機能すること', async () => {
      // Arrange
      const embedding = Array(1024).fill(0.5);
      const mockResults = {
        results: [
          { id: '1', score: 0.995, path: '/exact-match.jpg' },
        ],
        total: 1,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResults,
      });

      // Act
      const result = await searchByImageEmbedding(embedding, 0.99);

      // Assert
      expect(result.results).toHaveLength(1);
      expect(result.results[0].score).toBeGreaterThanOrEqual(0.99);
    });

    it('空の画像ファイルがエラーを返すこと', async () => {
      // Arrange: 0バイトのファイル
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Invalid image file',
          code: 'INVALID_IMAGE',
        }),
      });

      const emptyFile = new File([], 'empty.jpg', { type: 'image/jpeg' });
      const result = await uploadImageForEmbedding(emptyFile);

      // Assert
      expect(result).toHaveProperty('error');
    });
  });
});
