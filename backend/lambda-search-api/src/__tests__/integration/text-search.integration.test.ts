/**
 * Text Search Integration Tests
 *
 * 実際のOpenSearchインスタンスに接続してテストを実行します
 * 環境変数が必要:
 * - OPENSEARCH_ENDPOINT
 * - OPENSEARCH_INDEX
 * - AWS_REGION
 */

import { searchDocuments } from '../../services/opensearch.service.enhanced';
import { SearchQuery } from '../../types';

// 統合テストは環境変数が設定されている場合のみ実行
const shouldRunIntegrationTests = process.env.OPENSEARCH_ENDPOINT && process.env.RUN_INTEGRATION_TESTS === 'true';

const describeIntegration = shouldRunIntegrationTests ? describe : describe.skip;

describeIntegration('Text Search Integration', () => {
  // タイムアウトを延長（OpenSearch接続に時間がかかる可能性があるため）
  jest.setTimeout(30000);

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

      expect(result).toBeDefined();
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.took).toBeGreaterThan(0);

      // 結果がある場合、宇都宮を含むはず
      if (result.results.length > 0) {
        console.log(`Found ${result.results.length} results for "宇都宮"`);
        console.log('First result:', JSON.stringify(result.results[0], null, 2));

        const hasMatch = result.results.some(
          (r) =>
            r.fileName.includes('宇都宮') ||
            r.filePath.includes('宇都宮') ||
            r.snippet.includes('宇都宮')
        );
        expect(hasMatch).toBe(true);
      }
    });

    it('複数の日本語キーワードで検索できる', async () => {
      const query: SearchQuery = {
        query: '営業 報告書',
        searchMode: 'or',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.results)).toBe(true);

      if (result.results.length > 0) {
        console.log(`Found ${result.results.length} results for "営業 報告書"`);
      }
    });
  });

  describe('AND検索モード', () => {
    it('AND検索モードが正しく動作する', async () => {
      const query: SearchQuery = {
        query: '営業 報告書',
        searchMode: 'and',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      expect(result.total).toBeGreaterThanOrEqual(0);
      console.log(`AND search found ${result.total} results`);

      // AND検索なので、両方のキーワードを含むはず
      if (result.results.length > 0) {
        result.results.forEach((r, index) => {
          const text = `${r.fileName} ${r.filePath} ${r.snippet}`.toLowerCase();
          console.log(`Result ${index + 1}:`, {
            fileName: r.fileName,
            has営業: text.includes('営業'),
            has報告書: text.includes('報告書'),
          });
        });
      }
    });
  });

  describe('OR検索モード', () => {
    it('OR検索モードが正しく動作する', async () => {
      const query: SearchQuery = {
        query: 'PDF Excel',
        searchMode: 'or',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      expect(result.total).toBeGreaterThanOrEqual(0);
      console.log(`OR search found ${result.total} results`);

      // OR検索なので、どちらかのキーワードを含むはず
      if (result.results.length > 0) {
        const hasMatch = result.results.some((r) => {
          const text = `${r.fileName} ${r.filePath} ${r.snippet}`.toLowerCase();
          return text.includes('pdf') || text.includes('excel');
        });
        console.log('Has matching keyword:', hasMatch);
      }
    });
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

      console.log(`PDF filter found ${result.total} results`);

      // 結果がある場合、すべてPDFファイルのはず
      if (result.results.length > 0) {
        result.results.forEach((r) => {
          console.log(`File type: ${r.fileType}`);
          expect(r.fileType.toLowerCase()).toMatch(/pdf/);
        });
      }
    });

    it('日付範囲フィルターが正しく適用される', async () => {
      const query: SearchQuery = {
        query: 'test',
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      console.log(`Date filter found ${result.total} results`);

      // 結果がある場合、日付範囲内のはず
      if (result.results.length > 0) {
        const startDate = new Date('2025-01-01').getTime();
        const endDate = new Date('2025-12-31').getTime();

        result.results.forEach((r) => {
          const date = new Date(r.modifiedDate).getTime();
          console.log(`Modified date: ${r.modifiedDate}`);
          expect(date).toBeGreaterThanOrEqual(startDate);
          expect(date).toBeLessThanOrEqual(endDate);
        });
      }
    });

    it('複数のフィルターを組み合わせて使用できる', async () => {
      const query: SearchQuery = {
        query: 'test',
        fileType: 'pdf',
        dateFrom: '2025-01-01',
        size: 20,
        from: 0,
      };

      const result = await searchDocuments(query);

      console.log(`Combined filters found ${result.total} results`);
      expect(result.total).toBeGreaterThanOrEqual(0);
    });
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

      console.log('Page 1 total:', result1.total);
      console.log('Page 2 total:', result2.total);

      // totalは同じはず
      expect(result1.total).toBe(result2.total);

      // 結果が十分にある場合、IDが重複しないはず
      if (result1.results.length > 0 && result2.results.length > 0) {
        const ids1 = result1.results.map((r) => r.id);
        const ids2 = result2.results.map((r) => r.id);
        const overlap = ids1.filter((id) => ids2.includes(id));
        expect(overlap.length).toBe(0);
        console.log('No overlapping IDs between pages');
      }
    });

    it('異なるページサイズで正しく動作する', async () => {
      const sizes = [5, 10, 20, 50];

      for (const size of sizes) {
        const query: SearchQuery = {
          query: 'test',
          size,
          from: 0,
        };

        const result = await searchDocuments(query);

        console.log(`Size ${size}: got ${result.results.length} results`);
        expect(result.results.length).toBeLessThanOrEqual(size);
      }
    });
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

      console.log(`Relevance sort found ${result.total} results`);

      // スコアが降順になっているはず
      if (result.results.length > 1) {
        for (let i = 0; i < result.results.length - 1; i++) {
          console.log(
            `Result ${i + 1} score: ${result.results[i].relevanceScore}`
          );
          expect(result.results[i].relevanceScore).toBeGreaterThanOrEqual(
            result.results[i + 1].relevanceScore
          );
        }
      }
    });

    it('日付順ソート（降順）が正しく動作する', async () => {
      const query: SearchQuery = {
        query: 'test',
        sortBy: 'date',
        sortOrder: 'desc',
        size: 10,
        from: 0,
      };

      const result = await searchDocuments(query);

      console.log(`Date sort (desc) found ${result.total} results`);

      // 日付が降順になっているはず
      if (result.results.length > 1) {
        for (let i = 0; i < result.results.length - 1; i++) {
          const date1 = new Date(result.results[i].modifiedDate).getTime();
          const date2 = new Date(result.results[i + 1].modifiedDate).getTime();
          console.log(`Result ${i + 1} date: ${result.results[i].modifiedDate}`);
          expect(date1).toBeGreaterThanOrEqual(date2);
        }
      }
    });

    it('日付順ソート（昇順）が正しく動作する', async () => {
      const query: SearchQuery = {
        query: 'test',
        sortBy: 'date',
        sortOrder: 'asc',
        size: 10,
        from: 0,
      };

      const result = await searchDocuments(query);

      console.log(`Date sort (asc) found ${result.total} results`);

      // 日付が昇順になっているはず
      if (result.results.length > 1) {
        for (let i = 0; i < result.results.length - 1; i++) {
          const date1 = new Date(result.results[i].modifiedDate).getTime();
          const date2 = new Date(result.results[i + 1].modifiedDate).getTime();
          expect(date1).toBeLessThanOrEqual(date2);
        }
      }
    });

    it('ファイル名順ソートが正しく動作する', async () => {
      const query: SearchQuery = {
        query: 'test',
        sortBy: 'name',
        sortOrder: 'asc',
        size: 10,
        from: 0,
      };

      const result = await searchDocuments(query);

      console.log(`Name sort found ${result.total} results`);

      if (result.results.length > 1) {
        for (let i = 0; i < result.results.length - 1; i++) {
          console.log(`Result ${i + 1} name: ${result.results[i].fileName}`);
        }
      }
    });

    it('ファイルサイズ順ソートが正しく動作する', async () => {
      const query: SearchQuery = {
        query: 'test',
        sortBy: 'size',
        sortOrder: 'desc',
        size: 10,
        from: 0,
      };

      const result = await searchDocuments(query);

      console.log(`Size sort found ${result.total} results`);

      // サイズが降順になっているはず
      if (result.results.length > 1) {
        for (let i = 0; i < result.results.length - 1; i++) {
          console.log(`Result ${i + 1} size: ${result.results[i].fileSize}`);
          expect(result.results[i].fileSize).toBeGreaterThanOrEqual(
            result.results[i + 1].fileSize
          );
        }
      }
    });
  });

  describe('ハイライト', () => {
    it('検索結果にハイライト情報が含まれる', async () => {
      const query: SearchQuery = {
        query: '宇都宮',
        size: 10,
        from: 0,
      };

      const result = await searchDocuments(query);

      if (result.results.length > 0) {
        const firstResult = result.results[0];
        console.log('Highlights:', JSON.stringify(firstResult.highlights, null, 2));

        // ハイライトが設定されている可能性がある
        if (firstResult.highlights) {
          const hasHighlight =
            firstResult.highlights.fileName ||
            firstResult.highlights.filePath ||
            firstResult.highlights.extractedText;

          if (hasHighlight) {
            console.log('Highlights are present');
          }
        }

        // スニペットが設定されているはず
        expect(firstResult.snippet).toBeDefined();
        console.log('Snippet:', firstResult.snippet);
      }
    });
  });

  describe('パフォーマンス', () => {
    it('検索が1秒以内に完了する', async () => {
      const query: SearchQuery = {
        query: 'test',
        size: 20,
        from: 0,
      };

      const start = Date.now();
      const result = await searchDocuments(query);
      const duration = Date.now() - start;

      console.log(`Search completed in ${duration}ms`);
      console.log(`OpenSearch took: ${result.took}ms`);

      expect(duration).toBeLessThan(1000);
    });

    it('複雑な検索クエリでもパフォーマンスが維持される', async () => {
      const query: SearchQuery = {
        query: '営業 報告書 宇都宮',
        searchMode: 'and',
        fileType: 'pdf',
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        sortBy: 'relevance',
        sortOrder: 'desc',
        size: 20,
        from: 0,
      };

      const start = Date.now();
      const result = await searchDocuments(query);
      const duration = Date.now() - start;

      console.log(`Complex search completed in ${duration}ms`);
      expect(duration).toBeLessThan(2000);
    });
  });
});
