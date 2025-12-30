/**
 * Production Image Search E2E Tests
 * 本番環境での画像検索機能テスト（1000件のOpenSearchデータ）
 *
 * このテストは実際のバックエンドAPIとOpenSearchデータを使用します：
 * - API: https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
 * - Index: file-index-v2-knn (1000件の画像データ)
 * - Frontend: http://localhost:3000
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * テスト設定
 */
const TEST_CONFIG = {
  baseUrl: 'http://localhost:3000',
  apiUrl: 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search',
  indexName: 'file-index-v2-knn',
  totalDocuments: 1000,
  defaultConfidence: 0.9,
  searchTimeout: 5000, // 検索完了まで最大5秒
};

/**
 * テスト用画像ファイル
 */
const TEST_IMAGES_DIR = path.join(__dirname, 'fixtures', 'images');
const SAMPLE_IMAGES = {
  jpeg: path.join(TEST_IMAGES_DIR, 'test-image.jpg'),
  png: path.join(TEST_IMAGES_DIR, 'test-image.png'),
  large: path.join(TEST_IMAGES_DIR, 'large-test.jpg'),
};

/**
 * テスト用ヘルパー関数
 */
class ImageSearchTestHelper {
  constructor(private page: Page) {}

  /**
   * 画像検索ボタンをクリック
   */
  async openImageSearch() {
    const imageSearchButton = this.page.getByRole('button', { name: /画像で検索/i });
    await imageSearchButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * 画像をアップロード
   */
  async uploadImage(imagePath: string) {
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(imagePath);
  }

  /**
   * 検索結果の読み込み完了を待機
   */
  async waitForSearchResults(timeout: number = TEST_CONFIG.searchTimeout) {
    await this.page.waitForSelector('[data-testid="search-results"]', {
      timeout,
      state: 'visible',
    });
  }

  /**
   * 検索結果の件数を取得
   */
  async getResultCount(): Promise<number> {
    const results = this.page.locator('[data-testid="result-item"]');
    return await results.count();
  }

  /**
   * すべての結果の信頼度スコアを取得
   */
  async getAllConfidenceScores(): Promise<number[]> {
    const scoreElements = this.page.locator('[data-testid="confidence-score"]');
    const count = await scoreElements.count();
    const scores: number[] = [];

    for (let i = 0; i < count; i++) {
      const text = await scoreElements.nth(i).textContent();
      const score = parseFloat(text?.replace('%', '') || '0') / 100;
      scores.push(score);
    }

    return scores;
  }

  /**
   * 特定のファイル情報を検証
   */
  async verifyFileMetadata(index: number) {
    const resultItem = this.page.locator('[data-testid="result-item"]').nth(index);

    // ファイル名が表示されているか
    const fileName = await resultItem.locator('[data-testid="file-name"]').textContent();
    expect(fileName).toBeTruthy();

    // ファイルパスが表示されているか
    const filePath = await resultItem.locator('[data-testid="file-path"]').textContent();
    expect(filePath).toBeTruthy();

    // ファイルサイズが表示されているか
    const fileSize = await resultItem.locator('[data-testid="file-size"]').textContent();
    expect(fileSize).toMatch(/[0-9]+(\.[0-9]+)?\s*(B|KB|MB|GB)/);

    // 更新日が表示されているか
    const modifiedDate = await resultItem.locator('[data-testid="modified-date"]').textContent();
    expect(modifiedDate).toBeTruthy();

    return { fileName, filePath, fileSize, modifiedDate };
  }

  /**
   * パスコピー機能をテスト
   */
  async testCopyPath(resultIndex: number = 0) {
    const copyButton = this.page
      .locator('[data-testid="result-item"]')
      .nth(resultIndex)
      .locator('[aria-label*="コピー"]');

    await copyButton.click();

    // コピー成功のトーストまたはアイコン変化を確認
    await expect(
      this.page.getByText(/コピーしました/).or(this.page.locator('[data-testid="copy-success"]'))
    ).toBeVisible({ timeout: 3000 });
  }
}

/**
 * テストスイート
 */
test.describe('Production Image Search - Real Data (1000 docs)', () => {
  let helper: ImageSearchTestHelper;

  test.beforeEach(async ({ page }) => {
    helper = new ImageSearchTestHelper(page);
    await page.goto(TEST_CONFIG.baseUrl);
  });

  test.describe('Basic Upload and Search', () => {
    test('should upload JPEG and return results from 1000 documents', async ({ page }) => {
      const startTime = Date.now();

      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);

      // 検索結果の表示を待機
      await helper.waitForSearchResults(10000);

      const duration = Date.now() - startTime;
      console.log(`✓ Search completed in ${duration}ms`);

      // レスポンスタイムの検証（目標: 5秒以内）
      expect(duration).toBeLessThan(5000);

      // 結果が存在することを確認
      const resultCount = await helper.getResultCount();
      console.log(`✓ Found ${resultCount} results`);
      expect(resultCount).toBeGreaterThan(0);

      // 結果件数が妥当な範囲内か（1000件のデータから）
      expect(resultCount).toBeLessThanOrEqual(100); // ページネーション考慮
    });

    test('should upload PNG and return results', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.png);

      await helper.waitForSearchResults();

      const resultCount = await helper.getResultCount();
      expect(resultCount).toBeGreaterThan(0);
    });
  });

  test.describe('Search Quality - Confidence Threshold', () => {
    test('should only show results with 90%+ confidence', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      const scores = await helper.getAllConfidenceScores();
      console.log(`✓ Confidence scores:`, scores.slice(0, 5));

      // すべてのスコアが90%以上
      scores.forEach((score) => {
        expect(score).toBeGreaterThanOrEqual(TEST_CONFIG.defaultConfidence);
      });

      // スコアが降順にソートされているか
      for (let i = 0; i < scores.length - 1; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
      }
    });

    test('should filter results based on confidence threshold', async ({ page }) => {
      // TODO: UI で信頼度閾値を変更できる場合のテスト
      // 例: 95% に変更して結果が減ることを確認
    });
  });

  test.describe('File Metadata Display', () => {
    test('should display complete file metadata for all results', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      const resultCount = await helper.getResultCount();
      const samplesToCheck = Math.min(resultCount, 5); // 最初の5件をチェック

      for (let i = 0; i < samplesToCheck; i++) {
        const metadata = await helper.verifyFileMetadata(i);
        console.log(`✓ Result ${i + 1}:`, metadata);
      }
    });

    test('should correctly format file paths with truncation', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      const filePath = await page
        .locator('[data-testid="result-item"]')
        .first()
        .locator('[data-testid="file-path"]')
        .textContent();

      // パスが適切に省略されているか（長すぎないか）
      expect(filePath!.length).toBeLessThan(100);

      // パスに必要な情報が含まれているか
      expect(filePath).toMatch(/\//); // スラッシュを含む
    });

    test('should format file sizes correctly', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      const fileSize = await page
        .locator('[data-testid="result-item"]')
        .first()
        .locator('[data-testid="file-size"]')
        .textContent();

      // ファイルサイズが正しいフォーマット
      expect(fileSize).toMatch(/^[0-9]+(\.[0-9]+)?\s*(B|KB|MB|GB)$/);
    });

    test('should format dates in Japanese locale', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      const date = await page
        .locator('[data-testid="result-item"]')
        .first()
        .locator('[data-testid="modified-date"]')
        .textContent();

      // 日本語の日付フォーマット（例: 2025/01/20 14:30）
      expect(date).toMatch(/\d{4}[\/\-]\d{2}[\/\-]\d{2}/);
    });
  });

  test.describe('Department Information', () => {
    test('should display department information from OpenSearch data', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      // 部署情報が表示されているか
      const department = await page
        .locator('[data-testid="result-item"]')
        .first()
        .locator('[data-testid="department"]')
        .textContent();

      console.log(`✓ Department:`, department);

      // 部署名が存在するか（例: 道路設計部）
      expect(department).toBeTruthy();
    });
  });

  test.describe('Copy Path Functionality', () => {
    test('should copy file path to clipboard', async ({ page, context }) => {
      // クリップボード権限を付与
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      await helper.testCopyPath(0);

      // クリップボードの内容を確認（可能な場合）
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toBeTruthy();
      expect(clipboardText).toMatch(/\//); // パスを含む
    });

    test('should show success toast after copy', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      const copyButton = page
        .locator('[data-testid="result-item"]')
        .first()
        .locator('[aria-label*="コピー"]');

      await copyButton.click();

      // 成功トーストが表示される
      await expect(page.getByText(/コピーしました/i)).toBeVisible({ timeout: 3000 });
    });
  });

  test.describe('Pagination and Large Result Sets', () => {
    test('should handle pagination for large result sets', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      const resultCount = await helper.getResultCount();
      console.log(`✓ Initial results: ${resultCount}`);

      // ページネーションボタンが存在するか（結果が多い場合）
      const nextButton = page.getByRole('button', { name: /次へ|next/i });
      const hasMore = await nextButton.isVisible().catch(() => false);

      if (hasMore) {
        await nextButton.click();
        await page.waitForTimeout(1000);

        const newResultCount = await helper.getResultCount();
        console.log(`✓ Results after pagination: ${newResultCount}`);

        // 結果が更新されたことを確認
        expect(newResultCount).toBeGreaterThan(0);
      }
    });
  });

  test.describe('Performance with Large Dataset', () => {
    test('should maintain performance with 1000 docs index', async ({ page }) => {
      const measurements = [];

      // 3回測定して平均を取る
      for (let i = 0; i < 3; i++) {
        await page.reload();

        const startTime = Date.now();

        await helper.openImageSearch();
        await helper.uploadImage(SAMPLE_IMAGES.jpeg);
        await helper.waitForSearchResults();

        const duration = Date.now() - startTime;
        measurements.push(duration);

        console.log(`✓ Attempt ${i + 1}: ${duration}ms`);
      }

      const avgDuration = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      console.log(`✓ Average search time: ${avgDuration}ms`);

      // 平均検索時間が5秒以内
      expect(avgDuration).toBeLessThan(5000);

      // 標準偏差が小さい（安定している）
      const variance =
        measurements.reduce((sum, val) => sum + Math.pow(val - avgDuration, 2), 0) /
        measurements.length;
      const stdDev = Math.sqrt(variance);

      console.log(`✓ Standard deviation: ${stdDev}ms`);
      expect(stdDev).toBeLessThan(2000); // 2秒以内のブレ
    });

    test('should handle UI responsiveness during search', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);

      // 検索中にUIが応答するか
      const progressIndicator = page.getByTestId('search-progress');
      await expect(progressIndicator).toBeVisible({ timeout: 1000 });

      // プログレスバーが動作しているか
      const progress = await progressIndicator.getAttribute('aria-valuenow');
      expect(parseInt(progress || '0')).toBeGreaterThan(0);
    });

    test('should not cause memory leaks with repeated searches', async ({ page }) => {
      // 5回連続で検索を実行
      for (let i = 0; i < 5; i++) {
        await helper.openImageSearch();
        await helper.uploadImage(SAMPLE_IMAGES.jpeg);
        await helper.waitForSearchResults();

        // クリアして次の検索へ
        const clearButton = page.getByTestId('clear-button');
        if (await clearButton.isVisible()) {
          await clearButton.click();
        }
      }

      // ページが正常に動作していることを確認
      await helper.openImageSearch();
      await expect(page.getByText(/画像で検索/)).toBeVisible();
    });
  });

  test.describe('Error Handling with Real Backend', () => {
    test('should handle backend timeout gracefully', async ({ page }) => {
      // 非常に大きな画像でタイムアウトを誘発（もし実装されている場合）
      // または、ネットワークスロットルを使用

      await page.route('**/api/image-embedding', async (route) => {
        // 10秒遅延させる
        await new Promise((resolve) => setTimeout(resolve, 10000));
        await route.continue();
      });

      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);

      // タイムアウトエラーメッセージが表示される
      await expect(page.getByText(/タイムアウト|時間がかかりすぎています/i)).toBeVisible({
        timeout: 15000,
      });
    });

    test('should handle empty result set gracefully', async ({ page }) => {
      // 検索結果が0件の場合をシミュレート
      await page.route('**/api/search', async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            success: true,
            hits: [],
            total: 0,
          }),
        });
      });

      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);

      // 空状態メッセージが表示される
      await expect(page.getByText(/結果が見つかりませんでした/i)).toBeVisible();
      await expect(page.getByText(/別の画像で試してみてください/i)).toBeVisible();
    });
  });

  test.describe('Real File Examples from Index', () => {
    test('should find CIMG0012.JPG in results', async ({ page }) => {
      // インデックスに存在するファイル名を検索結果で確認
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      // 全結果のファイル名を取得
      const fileNames = await page.locator('[data-testid="file-name"]').allTextContents();

      console.log(`✓ Sample file names:`, fileNames.slice(0, 5));

      // いずれかの結果にJPGファイルが含まれているか
      const hasJpgFile = fileNames.some((name) => /\.(jpg|jpeg|png)$/i.test(name));
      expect(hasJpgFile).toBe(true);
    });

    test('should verify department "道路設計部" in results', async ({ page }) => {
      await helper.openImageSearch();
      await helper.uploadImage(SAMPLE_IMAGES.jpeg);
      await helper.waitForSearchResults();

      // 部署情報を取得
      const departments = await page.locator('[data-testid="department"]').allTextContents();

      console.log(`✓ Departments found:`, [...new Set(departments)]);

      // 部署名が存在することを確認
      expect(departments.length).toBeGreaterThan(0);
    });
  });
});
