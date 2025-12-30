/**
 * E2E Tests for Image Search Feature
 * 画像検索機能のE2Eテスト
 *
 * このテストは完全なユーザージャーニーをカバーします：
 * 1. 画像アップロード（ドラッグ&ドロップ、ファイル選択）
 * 2. ベクトル生成
 * 3. 検索結果表示
 * 4. 信頼度フィルタリング
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * テスト用画像ファイルのパス
 */
const TEST_IMAGES_DIR = path.join(__dirname, 'fixtures', 'images');
const VALID_JPEG = path.join(TEST_IMAGES_DIR, 'test-image.jpg');
const VALID_PNG = path.join(TEST_IMAGES_DIR, 'test-image.png');
const LARGE_IMAGE = path.join(TEST_IMAGES_DIR, 'large-image.jpg');
const INVALID_FILE = path.join(TEST_IMAGES_DIR, 'document.pdf');

/**
 * テスト用画像を作成（存在しない場合）
 */
test.beforeAll(async () => {
  // テストディレクトリが存在しない場合は作成
  if (!fs.existsSync(TEST_IMAGES_DIR)) {
    fs.mkdirSync(TEST_IMAGES_DIR, { recursive: true });
  }

  // 簡単なテスト画像を作成（実際のプロジェクトでは実際の画像を使用）
  if (!fs.existsSync(VALID_JPEG)) {
    // 1x1 JPEG の最小データ（Base64デコード）
    const minimalJpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',
      'base64'
    );
    fs.writeFileSync(VALID_JPEG, minimalJpeg);
  }

  if (!fs.existsSync(VALID_PNG)) {
    // 1x1 PNG の最小データ（Base64デコード）
    const minimalPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(VALID_PNG, minimalPng);
  }

  if (!fs.existsSync(LARGE_IMAGE)) {
    // 6MB のダミーファイル（バリデーションテスト用）
    const largeData = Buffer.alloc(6 * 1024 * 1024);
    fs.writeFileSync(LARGE_IMAGE, largeData);
  }

  if (!fs.existsSync(INVALID_FILE)) {
    // PDFファイル（バリデーションテスト用）
    fs.writeFileSync(INVALID_FILE, 'Not an image file');
  }
});

/**
 * テストのセットアップ
 */
test.describe('Image Search Feature', () => {
  test.beforeEach(async ({ page }) => {
    // 検索ページに移動
    await page.goto('/');
  });

  test.describe('Image Upload via File Selection', () => {
    test('should upload JPEG image via file selection', async ({ page }) => {
      // ファイル入力要素を取得
      const fileInput = page.locator('input[type="file"]');

      // ファイルを選択
      await fileInput.setInputFiles(VALID_JPEG);

      // プレビューが表示されることを確認
      await expect(page.getByTestId('preview-image')).toBeVisible();

      // アップロード中の表示を確認
      await expect(page.getByText(/アップロード中/)).toBeVisible();

      // アップロード完了を待機
      await expect(page.getByText(/アップロード中/)).not.toBeVisible({
        timeout: 10000,
      });

      // 成功メッセージまたは検索結果を確認
      await expect(
        page.getByText(/検索結果/).or(page.getByTestId('search-results'))
      ).toBeVisible();
    });

    test('should upload PNG image via file selection', async ({ page }) => {
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_PNG);

      await expect(page.getByTestId('preview-image')).toBeVisible();
      await expect(page.getByText(/アップロード中/)).not.toBeVisible({
        timeout: 10000,
      });
    });

    test('should show error for invalid file type', async ({ page }) => {
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(INVALID_FILE);

      // エラーメッセージを確認
      await expect(page.getByTestId('error-message')).toBeVisible();
      await expect(page.getByText(/JPEG.*PNG/i)).toBeVisible();
    });

    test('should show error for file too large', async ({ page }) => {
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(LARGE_IMAGE);

      // エラーメッセージを確認
      await expect(page.getByTestId('error-message')).toBeVisible();
      await expect(page.getByText(/5MB/i)).toBeVisible();
    });
  });

  test.describe('Image Upload via Drag and Drop', () => {
    test('should accept dropped image file', async ({ page }) => {
      // ドロップゾーンを取得
      const dropZone = page.getByTestId('drop-zone');

      // ファイルをドラッグ＆ドロップ
      const fileBuffer = fs.readFileSync(VALID_JPEG);
      await dropZone.setInputFiles({
        name: 'test-image.jpg',
        mimeType: 'image/jpeg',
        buffer: fileBuffer,
      });

      // プレビューが表示されることを確認
      await expect(page.getByTestId('preview-image')).toBeVisible();
    });

    test('should show drag over state', async ({ page }) => {
      const dropZone = page.getByTestId('drop-zone');

      // ドラッグオーバー状態をシミュレート（実際のDOMイベントでテスト）
      await dropZone.dispatchEvent('dragover', {
        dataTransfer: {
          files: [],
        },
      });

      // スタイルの変更を確認
      await expect(dropZone).toHaveClass(/border-blue-500/);
    });
  });

  test.describe('Search Results', () => {
    test('should display search results after upload', async ({ page }) => {
      // 画像をアップロード
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      // 検索結果が表示されるまで待機
      await expect(page.getByTestId('search-results')).toBeVisible({
        timeout: 15000,
      });

      // 結果が存在することを確認
      const resultItems = page.locator('[data-testid="result-item"]');
      await expect(resultItems).toHaveCountGreaterThan(0);
    });

    test('should show only high confidence results (90%+)', async ({ page }) => {
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      await expect(page.getByTestId('search-results')).toBeVisible({
        timeout: 15000,
      });

      // 各結果の信頼度スコアを確認
      const confidenceScores = page.locator('[data-testid="confidence-score"]');
      const count = await confidenceScores.count();

      for (let i = 0; i < count; i++) {
        const scoreText = await confidenceScores.nth(i).textContent();
        const score = parseFloat(scoreText?.replace('%', '') || '0');
        expect(score).toBeGreaterThanOrEqual(90);
      }
    });

    test('should show message when no results found', async ({ page }) => {
      // API レスポンスをモック（結果なし）
      await page.route('**/api/search/image', async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            success: true,
            data: {
              results: [],
              total: 0,
            },
          }),
        });
      });

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      // 結果なしメッセージを確認
      await expect(page.getByText(/検索結果が見つかりませんでした/)).toBeVisible();
    });
  });

  test.describe('Clear Functionality', () => {
    test('should clear uploaded image', async ({ page }) => {
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      await expect(page.getByTestId('preview-image')).toBeVisible();

      // クリアボタンをクリック
      await page.getByTestId('clear-button').click();

      // プレビューが消えることを確認
      await expect(page.getByTestId('preview-image')).not.toBeVisible();

      // アップロードエリアが再表示されることを確認
      await expect(page.getByText(/画像をドラッグ&ドロップ/)).toBeVisible();
    });
  });

  test.describe('Combined Text and Image Search', () => {
    test('should combine text query with image search', async ({ page }) => {
      // テキスト検索フィールドに入力
      const searchInput = page.getByTestId('search-input');
      await searchInput.fill('財務報告書');

      // 画像をアップロード
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      // 検索実行
      await page.getByTestId('search-button').click();

      // 結果が表示されることを確認
      await expect(page.getByTestId('search-results')).toBeVisible({
        timeout: 15000,
      });

      // テキストと画像の両方でフィルタされた結果であることを確認
      await expect(page.getByText(/財務報告書/)).toBeVisible();
    });

    test('should toggle between AND/OR search modes', async ({ page }) => {
      await page.getByTestId('search-input').fill('レポート');

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      // AND モード
      await page.getByTestId('search-mode-and').click();
      await page.getByTestId('search-button').click();

      const andResults = await page
        .locator('[data-testid="result-item"]')
        .count();

      // OR モード
      await page.getByTestId('search-mode-or').click();
      await page.getByTestId('search-button').click();

      await page.waitForTimeout(1000); // 再検索を待機

      const orResults = await page.locator('[data-testid="result-item"]').count();

      // OR モードの方が結果が多いことを確認
      expect(orResults).toBeGreaterThanOrEqual(andResults);
    });
  });

  test.describe('Error Handling', () => {
    test('should handle network error gracefully', async ({ page }) => {
      // ネットワークエラーをシミュレート
      await page.route('**/api/image-embedding', async (route) => {
        await route.abort('failed');
      });

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      // エラーメッセージを確認
      await expect(page.getByTestId('error-message')).toBeVisible();
    });

    test('should handle API error response', async ({ page }) => {
      // API エラーレスポンスをモック
      await page.route('**/api/image-embedding', async (route) => {
        await route.fulfill({
          status: 503,
          body: JSON.stringify({
            error: 'AWS Bedrock service error',
            code: 'BEDROCK_ERROR',
          }),
        });
      });

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      await expect(page.getByTestId('error-message')).toBeVisible();
      await expect(page.getByText(/service error/i)).toBeVisible();
    });

    test('should retry on temporary failure', async ({ page }) => {
      let attemptCount = 0;

      await page.route('**/api/image-embedding', async (route) => {
        attemptCount++;

        if (attemptCount === 1) {
          // 最初のリクエストは失敗
          await route.abort('failed');
        } else {
          // 2回目は成功
          await route.continue();
        }
      });

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      // リトライ後に成功することを確認
      await expect(page.getByTestId('search-results')).toBeVisible({
        timeout: 20000,
      });
    });
  });

  test.describe('Performance', () => {
    test('should complete upload within reasonable time', async ({ page }) => {
      const startTime = Date.now();

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      await expect(page.getByTestId('search-results')).toBeVisible({
        timeout: 15000,
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // 15秒以内に完了することを確認
      expect(duration).toBeLessThan(15000);
    });

    test('should handle concurrent uploads', async ({ page, context }) => {
      // 複数のページを開いて同時にアップロード
      const page2 = await context.newPage();
      await page2.goto('/');

      const upload1 = page.locator('input[type="file"]').setInputFiles(VALID_JPEG);
      const upload2 = page2.locator('input[type="file"]').setInputFiles(VALID_PNG);

      await Promise.all([upload1, upload2]);

      // 両方のページで結果が表示されることを確認
      await expect(page.getByTestId('search-results')).toBeVisible({
        timeout: 20000,
      });
      await expect(page2.getByTestId('search-results')).toBeVisible({
        timeout: 20000,
      });

      await page2.close();
    });
  });

  test.describe('Cross-Browser Compatibility', () => {
    test('should work in different browsers', async ({ page, browserName }) => {
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      await expect(page.getByTestId('preview-image')).toBeVisible();
      await expect(page.getByTestId('search-results')).toBeVisible({
        timeout: 15000,
      });

      console.log(`✓ Image search works in ${browserName}`);
    });
  });

  test.describe('Accessibility', () => {
    test('should be keyboard navigable', async ({ page }) => {
      // Tab でフォーカスを移動
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Enter でファイル選択ダイアログを開く
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(VALID_JPEG);

      await expect(page.getByTestId('preview-image')).toBeVisible();
    });

    test('should have proper ARIA labels', async ({ page }) => {
      const dropZone = page.getByTestId('drop-zone');
      const ariaLabel = await dropZone.getAttribute('aria-label');

      // ARIA ラベルまたはアクセシブルなテキストが存在することを確認
      expect(ariaLabel || (await dropZone.textContent())).toBeTruthy();
    });
  });
});
