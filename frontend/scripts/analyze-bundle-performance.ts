/**
 * Bundle Size and Rendering Performance Analyzer
 *
 * フロントエンドのバンドルサイズとレンダリングパフォーマンスを分析
 *
 * 分析項目:
 * 1. バンドルサイズ分析
 * 2. コード分割の最適化提案
 * 3. Tree Shaking の効果測定
 * 4. レンダリングパフォーマンス計測
 * 5. Virtual Scrolling の効果検証
 *
 * 使用方法:
 * npx ts-node scripts/analyze-bundle-performance.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// === Configuration ===
const BUNDLE_CONFIG = {
  // Next.js ビルドディレクトリ
  BUILD_DIR: path.join(__dirname, '../.next'),

  // 分析対象ページ
  TARGET_PAGES: [
    '/search',
    '/api/image-embedding',
    '/api/search',
  ],

  // バンドルサイズ制限 (KB)
  SIZE_LIMITS: {
    FIRST_LOAD_JS: 200,     // First Load JS should be < 200KB
    TOTAL_SIZE: 500,        // Total bundle size < 500KB
    CHUNK_SIZE: 50,         // Individual chunk < 50KB
  },

  // パフォーマンス目標
  PERFORMANCE_TARGETS: {
    LCP: 2500,              // Largest Contentful Paint < 2.5s
    FID: 100,               // First Input Delay < 100ms
    CLS: 0.1,               // Cumulative Layout Shift < 0.1
    TTI: 3800,              // Time to Interactive < 3.8s
    TBT: 200,               // Total Blocking Time < 200ms
  },
};

// === Bundle Analysis ===
interface BundleAnalysis {
  totalSize: number;
  chunks: {
    name: string;
    size: number;
    gzipSize?: number;
  }[];
  pages: {
    route: string;
    firstLoadJS: number;
    isLarge: boolean;
  }[];
  recommendations: string[];
}

interface PerformanceAnalysis {
  metrics: {
    lcp?: number;
    fid?: number;
    cls?: number;
    tti?: number;
    tbt?: number;
  };
  recommendations: string[];
}

class BundlePerformanceAnalyzer {
  private bundleAnalysis: BundleAnalysis = {
    totalSize: 0,
    chunks: [],
    pages: [],
    recommendations: [],
  };

  private performanceAnalysis: PerformanceAnalysis = {
    metrics: {},
    recommendations: [],
  };

  /**
   * Next.js ビルドを実行
   */
  async buildProject(): Promise<void> {
    console.log('🔨 Building Next.js project...\n');

    try {
      const { stdout, stderr } = await execAsync('npm run build', {
        cwd: path.join(__dirname, '..'),
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      console.log(stdout);
      if (stderr) {
        console.warn('Build warnings:', stderr);
      }

      console.log('✅ Build completed successfully\n');
    } catch (error: any) {
      console.error('❌ Build failed:', error.message);
      throw error;
    }
  }

  /**
   * バンドルサイズを分析
   */
  async analyzeBundleSize(): Promise<void> {
    console.log('📦 Analyzing bundle size...\n');

    try {
      // .next/BUILD_ID を取得
      const buildIdPath = path.join(BUNDLE_CONFIG.BUILD_DIR, 'BUILD_ID');
      if (!fs.existsSync(buildIdPath)) {
        throw new Error('Build directory not found. Please run build first.');
      }

      const buildId = fs.readFileSync(buildIdPath, 'utf-8').trim();

      // Static chunks を分析
      const staticDir = path.join(BUNDLE_CONFIG.BUILD_DIR, 'static/chunks');
      if (fs.existsSync(staticDir)) {
        const chunks = fs.readdirSync(staticDir).filter((file) => file.endsWith('.js'));

        for (const chunk of chunks) {
          const chunkPath = path.join(staticDir, chunk);
          const stats = fs.statSync(chunkPath);
          const sizeKB = stats.size / 1024;

          this.bundleAnalysis.chunks.push({
            name: chunk,
            size: sizeKB,
          });

          this.bundleAnalysis.totalSize += sizeKB;
        }
      }

      // Pages を分析
      const pagesDir = path.join(BUNDLE_CONFIG.BUILD_DIR, 'server/pages');
      if (fs.existsSync(pagesDir)) {
        this.analyzePages(pagesDir);
      }

      // 推奨事項の生成
      this.generateBundleRecommendations();

      // 結果表示
      this.printBundleAnalysis();
    } catch (error: any) {
      console.error('❌ Bundle analysis failed:', error.message);
      throw error;
    }
  }

  /**
   * ページを分析
   */
  private analyzePages(pagesDir: string): void {
    const analyzeDirectory = (dir: string, prefix: string = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const route = path.join(prefix, entry.name);

        if (entry.isDirectory()) {
          analyzeDirectory(fullPath, route);
        } else if (entry.name.endsWith('.js')) {
          const stats = fs.statSync(fullPath);
          const sizeKB = stats.size / 1024;

          const isLarge = sizeKB > BUNDLE_CONFIG.SIZE_LIMITS.FIRST_LOAD_JS;

          this.bundleAnalysis.pages.push({
            route: route.replace('.js', ''),
            firstLoadJS: sizeKB,
            isLarge,
          });
        }
      }
    };

    analyzeDirectory(pagesDir);
  }

  /**
   * バンドル最適化の推奨事項を生成
   */
  private generateBundleRecommendations(): void {
    const { totalSize, chunks, pages } = this.bundleAnalysis;

    // 大きすぎるバンドル
    if (totalSize > BUNDLE_CONFIG.SIZE_LIMITS.TOTAL_SIZE) {
      this.bundleAnalysis.recommendations.push(
        `⚠️ Total bundle size (${totalSize.toFixed(2)}KB) exceeds limit (${BUNDLE_CONFIG.SIZE_LIMITS.TOTAL_SIZE}KB)`
      );
    }

    // 大きすぎるチャンク
    const largeChunks = chunks.filter((chunk) => chunk.size > BUNDLE_CONFIG.SIZE_LIMITS.CHUNK_SIZE);
    if (largeChunks.length > 0) {
      this.bundleAnalysis.recommendations.push(
        `⚠️ ${largeChunks.length} chunks exceed size limit (${BUNDLE_CONFIG.SIZE_LIMITS.CHUNK_SIZE}KB):`
      );
      largeChunks.forEach((chunk) => {
        this.bundleAnalysis.recommendations.push(
          `   - ${chunk.name}: ${chunk.size.toFixed(2)}KB`
        );
      });
    }

    // 大きすぎるページ
    const largePages = pages.filter((page) => page.isLarge);
    if (largePages.length > 0) {
      this.bundleAnalysis.recommendations.push(
        `⚠️ ${largePages.length} pages exceed First Load JS limit (${BUNDLE_CONFIG.SIZE_LIMITS.FIRST_LOAD_JS}KB):`
      );
      largePages.forEach((page) => {
        this.bundleAnalysis.recommendations.push(
          `   - ${page.route}: ${page.firstLoadJS.toFixed(2)}KB`
        );
      });
    }

    // 最適化提案
    this.bundleAnalysis.recommendations.push(
      '\n💡 Optimization Suggestions:',
      '1. Dynamic imports for heavy components:',
      '   - Lazy load ImageSearchContainer with next/dynamic',
      '   - Defer loading of ImagePreviewModal until needed',
      '   - Use React.lazy() for ImageSearchResults',
      '',
      '2. Tree shaking improvements:',
      '   - Ensure named imports from framer-motion',
      '   - Use modular lodash imports (lodash-es)',
      '   - Remove unused dependencies',
      '',
      '3. Code splitting strategies:',
      '   - Split vendor bundle by pages',
      '   - Create separate chunk for AWS SDK',
      '   - Separate Bedrock client initialization',
      '',
      '4. Image optimization:',
      '   - Use next/image for all images',
      '   - Implement WebP format with AVIF fallback',
      '   - Add proper image CDN caching',
      '',
      '5. CSS optimization:',
      '   - Use CSS Modules for component styles',
      '   - Minimize Tailwind CSS bundle with purge',
      '   - Consider CSS-in-JS bundle impact'
    );
  }

  /**
   * バンドル分析結果を表示
   */
  private printBundleAnalysis(): void {
    console.log('📊 Bundle Analysis Results:\n');

    console.log(`Total Size: ${this.bundleAnalysis.totalSize.toFixed(2)}KB`);
    console.log(`Total Chunks: ${this.bundleAnalysis.chunks.length}\n`);

    console.log('Top 10 Largest Chunks:');
    const sortedChunks = this.bundleAnalysis.chunks.sort((a, b) => b.size - a.size).slice(0, 10);
    sortedChunks.forEach((chunk, index) => {
      const emoji = chunk.size > BUNDLE_CONFIG.SIZE_LIMITS.CHUNK_SIZE ? '🔴' : '✅';
      console.log(`   ${index + 1}. ${emoji} ${chunk.name}: ${chunk.size.toFixed(2)}KB`);
    });

    console.log('\nPages:');
    this.bundleAnalysis.pages.forEach((page) => {
      const emoji = page.isLarge ? '🔴' : '✅';
      console.log(`   ${emoji} ${page.route}: ${page.firstLoadJS.toFixed(2)}KB`);
    });

    console.log('\n📋 Recommendations:\n');
    this.bundleAnalysis.recommendations.forEach((rec) => {
      console.log(rec);
    });
  }

  /**
   * Lighthouse を使用してパフォーマンス計測
   */
  async measurePerformance(): Promise<void> {
    console.log('\n🚀 Running Lighthouse performance audit...\n');

    try {
      // Lighthouseがインストールされているか確認
      try {
        await execAsync('lighthouse --version');
      } catch {
        console.log('⚠️ Lighthouse not found. Installing...');
        await execAsync('npm install -g lighthouse');
      }

      // Lighthouse実行
      const url = 'http://localhost:3000/search';
      const outputPath = path.join(__dirname, '../lighthouse-report.html');

      const { stdout } = await execAsync(
        `lighthouse ${url} --output=html --output-path=${outputPath} --chrome-flags="--headless" --only-categories=performance`
      );

      console.log(stdout);

      // JSON形式でも取得
      const jsonOutputPath = path.join(__dirname, '../lighthouse-report.json');
      await execAsync(
        `lighthouse ${url} --output=json --output-path=${jsonOutputPath} --chrome-flags="--headless" --only-categories=performance`
      );

      // JSON結果を解析
      const reportJson = JSON.parse(fs.readFileSync(jsonOutputPath, 'utf-8'));
      this.parsePerformanceMetrics(reportJson);

      console.log('✅ Lighthouse audit completed\n');
      console.log(`📄 HTML report: ${outputPath}`);
      console.log(`📄 JSON report: ${jsonOutputPath}\n`);
    } catch (error: any) {
      console.warn('⚠️ Lighthouse audit failed (this is optional):', error.message);
      console.log('Continuing with analysis...\n');
    }
  }

  /**
   * Lighthouseメトリクスを解析
   */
  private parsePerformanceMetrics(report: any): void {
    const audits = report.audits;

    // Core Web Vitals
    if (audits['largest-contentful-paint']) {
      this.performanceAnalysis.metrics.lcp = audits['largest-contentful-paint'].numericValue;
    }

    if (audits['max-potential-fid']) {
      this.performanceAnalysis.metrics.fid = audits['max-potential-fid'].numericValue;
    }

    if (audits['cumulative-layout-shift']) {
      this.performanceAnalysis.metrics.cls = audits['cumulative-layout-shift'].numericValue;
    }

    if (audits['interactive']) {
      this.performanceAnalysis.metrics.tti = audits['interactive'].numericValue;
    }

    if (audits['total-blocking-time']) {
      this.performanceAnalysis.metrics.tbt = audits['total-blocking-time'].numericValue;
    }

    // 推奨事項の生成
    this.generatePerformanceRecommendations();
    this.printPerformanceAnalysis();
  }

  /**
   * パフォーマンス最適化の推奨事項を生成
   */
  private generatePerformanceRecommendations(): void {
    const { metrics } = this.performanceAnalysis;

    // LCP
    if (metrics.lcp && metrics.lcp > BUNDLE_CONFIG.PERFORMANCE_TARGETS.LCP) {
      this.performanceAnalysis.recommendations.push(
        `⚠️ LCP (${(metrics.lcp / 1000).toFixed(2)}s) exceeds target (${BUNDLE_CONFIG.PERFORMANCE_TARGETS.LCP / 1000}s)`,
        '   - Optimize image loading with next/image',
        '   - Implement priority loading for hero images',
        '   - Use CDN for static assets',
        '   - Preload critical fonts and CSS'
      );
    }

    // FID
    if (metrics.fid && metrics.fid > BUNDLE_CONFIG.PERFORMANCE_TARGETS.FID) {
      this.performanceAnalysis.recommendations.push(
        `⚠️ FID (${metrics.fid.toFixed(2)}ms) exceeds target (${BUNDLE_CONFIG.PERFORMANCE_TARGETS.FID}ms)`,
        '   - Reduce JavaScript execution time',
        '   - Break up long tasks with code splitting',
        '   - Use web workers for heavy computations',
        '   - Defer non-critical JavaScript'
      );
    }

    // CLS
    if (metrics.cls && metrics.cls > BUNDLE_CONFIG.PERFORMANCE_TARGETS.CLS) {
      this.performanceAnalysis.recommendations.push(
        `⚠️ CLS (${metrics.cls.toFixed(3)}) exceeds target (${BUNDLE_CONFIG.PERFORMANCE_TARGETS.CLS})`,
        '   - Set explicit width/height for images',
        '   - Reserve space for dynamic content',
        '   - Avoid inserting content above existing content',
        '   - Use CSS transforms for animations'
      );
    }

    // TTI
    if (metrics.tti && metrics.tti > BUNDLE_CONFIG.PERFORMANCE_TARGETS.TTI) {
      this.performanceAnalysis.recommendations.push(
        `⚠️ TTI (${(metrics.tti / 1000).toFixed(2)}s) exceeds target (${BUNDLE_CONFIG.PERFORMANCE_TARGETS.TTI / 1000}s)`,
        '   - Minimize main thread work',
        '   - Reduce JavaScript payload',
        '   - Implement code splitting',
        '   - Use React.lazy() for components'
      );
    }

    // TBT
    if (metrics.tbt && metrics.tbt > BUNDLE_CONFIG.PERFORMANCE_TARGETS.TBT) {
      this.performanceAnalysis.recommendations.push(
        `⚠️ TBT (${metrics.tbt.toFixed(2)}ms) exceeds target (${BUNDLE_CONFIG.PERFORMANCE_TARGETS.TBT}ms)`,
        '   - Optimize third-party scripts',
        '   - Reduce JavaScript execution',
        '   - Break up long tasks',
        '   - Use requestIdleCallback for non-critical work'
      );
    }

    // Virtual Scrolling推奨
    this.performanceAnalysis.recommendations.push(
      '\n💡 Virtual Scrolling Optimization:',
      '1. Implement virtual scrolling for search results:',
      '   - Use @tanstack/react-virtual or react-window',
      '   - Render only visible items (15-20 items)',
      '   - Implement proper scroll event throttling',
      '',
      '2. Optimize rendering performance:',
      '   - Memoize ImageSearchResults component',
      '   - Use React.memo for individual result cards',
      '   - Implement proper key props for list items',
      '',
      '3. Image lazy loading:',
      '   - Use IntersectionObserver for viewport detection',
      '   - Load images on-demand as user scrolls',
      '   - Implement placeholder images',
      '',
      '4. Memory management:',
      '   - Clean up event listeners in useEffect',
      '   - Properly dispose of Framer Motion animations',
      '   - Monitor memory leaks with Chrome DevTools'
    );
  }

  /**
   * パフォーマンス分析結果を表示
   */
  private printPerformanceAnalysis(): void {
    console.log('📊 Performance Metrics:\n');

    const { metrics } = this.performanceAnalysis;

    if (metrics.lcp) {
      const status = metrics.lcp <= BUNDLE_CONFIG.PERFORMANCE_TARGETS.LCP ? '✅' : '❌';
      console.log(`   ${status} LCP: ${(metrics.lcp / 1000).toFixed(2)}s (target: ${BUNDLE_CONFIG.PERFORMANCE_TARGETS.LCP / 1000}s)`);
    }

    if (metrics.fid) {
      const status = metrics.fid <= BUNDLE_CONFIG.PERFORMANCE_TARGETS.FID ? '✅' : '❌';
      console.log(`   ${status} FID: ${metrics.fid.toFixed(2)}ms (target: ${BUNDLE_CONFIG.PERFORMANCE_TARGETS.FID}ms)`);
    }

    if (metrics.cls) {
      const status = metrics.cls <= BUNDLE_CONFIG.PERFORMANCE_TARGETS.CLS ? '✅' : '❌';
      console.log(`   ${status} CLS: ${metrics.cls.toFixed(3)} (target: ${BUNDLE_CONFIG.PERFORMANCE_TARGETS.CLS})`);
    }

    if (metrics.tti) {
      const status = metrics.tti <= BUNDLE_CONFIG.PERFORMANCE_TARGETS.TTI ? '✅' : '❌';
      console.log(`   ${status} TTI: ${(metrics.tti / 1000).toFixed(2)}s (target: ${BUNDLE_CONFIG.PERFORMANCE_TARGETS.TTI / 1000}s)`);
    }

    if (metrics.tbt) {
      const status = metrics.tbt <= BUNDLE_CONFIG.PERFORMANCE_TARGETS.TBT ? '✅' : '❌';
      console.log(`   ${status} TBT: ${metrics.tbt.toFixed(2)}ms (target: ${BUNDLE_CONFIG.PERFORMANCE_TARGETS.TBT}ms)`);
    }

    console.log('\n📋 Performance Recommendations:\n');
    this.performanceAnalysis.recommendations.forEach((rec) => {
      console.log(rec);
    });
  }

  /**
   * 完全な分析を実行
   */
  async run(): Promise<void> {
    console.log('🔍 Starting Bundle and Performance Analysis...\n');
    console.log('=' .repeat(80));

    try {
      // 1. ビルド実行
      await this.buildProject();

      // 2. バンドルサイズ分析
      await this.analyzeBundleSize();

      // 3. パフォーマンス計測（オプション）
      await this.measurePerformance();

      // 結果をJSONで保存
      const reportPath = path.join(__dirname, '../bundle-performance-analysis.json');
      const report = {
        bundleAnalysis: this.bundleAnalysis,
        performanceAnalysis: this.performanceAnalysis,
        timestamp: new Date().toISOString(),
      };

      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log('\n💾 Analysis results saved to:', reportPath);

      console.log('\n' + '='.repeat(80));
      console.log('✅ Analysis completed successfully');
    } catch (error: any) {
      console.error('\n❌ Analysis failed:', error.message);
      throw error;
    }
  }
}

// === メイン実行 ===
async function main() {
  try {
    const analyzer = new BundlePerformanceAnalyzer();
    await analyzer.run();
    process.exit(0);
  } catch (error: any) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// 実行
if (require.main === module) {
  main();
}

export { BundlePerformanceAnalyzer, BUNDLE_CONFIG };
