/**
 * Artillery Load Test Processor
 * ロードテストのカスタムロジック
 */

const fs = require('fs');
const path = require('path');

// テスト画像のディレクトリ
const TEST_IMAGES_DIR = path.join(__dirname, '../test-images');

// テスト画像リスト
let testImages = [];
let cachedImages = [];

/**
 * 初期化処理
 */
module.exports = {
  /**
   * テスト開始前の初期化
   */
  beforeScenario: function (userContext, events, done) {
    // テスト画像をロード
    if (testImages.length === 0) {
      if (fs.existsSync(TEST_IMAGES_DIR)) {
        testImages = fs
          .readdirSync(TEST_IMAGES_DIR)
          .filter((file) => /\.(jpg|jpeg|png)$/i.test(file))
          .map((file) => path.join(TEST_IMAGES_DIR, file));

        console.log(`Loaded ${testImages.length} test images`);

        // キャッシュ用画像（最初の5枚を繰り返し使用）
        cachedImages = testImages.slice(0, Math.min(5, testImages.length));
      } else {
        console.warn(`Test images directory not found: ${TEST_IMAGES_DIR}`);
      }
    }

    return done();
  },

  /**
   * ランダムな画像を選択
   */
  selectRandomImage: function (requestParams, context, ee, next) {
    if (testImages.length === 0) {
      console.error('No test images available');
      return next(new Error('No test images'));
    }

    const randomIndex = Math.floor(Math.random() * testImages.length);
    context.vars.imageFile = testImages[randomIndex];

    return next();
  },

  /**
   * キャッシュされた画像を選択
   */
  selectCachedImage: function (requestParams, context, ee, next) {
    if (cachedImages.length === 0) {
      console.error('No cached images available');
      return next(new Error('No cached images'));
    }

    const randomIndex = Math.floor(Math.random() * cachedImages.length);
    context.vars.cachedImageFile = cachedImages[randomIndex];

    return next();
  },

  /**
   * メトリクスを記録
   */
  recordMetrics: function (context, ee, next) {
    const uploadTime = parseInt(context.vars.uploadTime || 0);
    const searchTime = parseInt(context.vars.searchTime || 0);
    const cached = context.vars.cached === true || context.vars.cached === 'true';

    // カスタムメトリクスを送信
    ee.emit('histogram', 'image_upload_duration', uploadTime);
    ee.emit('histogram', 'search_duration', searchTime);
    ee.emit('rate', 'cache_hit_rate', cached ? 1 : 0);

    return next();
  },

  /**
   * テスト完了後の処理
   */
  afterScenario: function (userContext, events, done) {
    // クリーンアップ処理（必要に応じて）
    return done();
  },
};
