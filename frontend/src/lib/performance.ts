/**
 * パフォーマンス測定ユーティリティ
 * Core Web Vitals、カスタムメトリクス、リソースタイミングの測定
 */

export interface PerformanceMetrics {
  // Core Web Vitals
  LCP?: number; // Largest Contentful Paint
  FID?: number; // First Input Delay
  CLS?: number; // Cumulative Layout Shift
  FCP?: number; // First Contentful Paint
  TTFB?: number; // Time to First Byte

  // Custom Metrics
  searchTime?: number;
  imageUploadTime?: number;
  compressionTime?: number;
  renderTime?: number;

  // Resource Timing
  resourceLoadTime?: number;
  jsLoadTime?: number;
  cssLoadTime?: number;
  imageLoadTime?: number;
}

export interface PerformanceReport {
  timestamp: number;
  url: string;
  userAgent: string;
  metrics: PerformanceMetrics;
  resourceTiming: PerformanceResourceTiming[];
  navigation: PerformanceNavigationTiming | null;
}

/**
 * Core Web Vitalsを測定
 */
export const measureCoreWebVitals = (): Promise<PerformanceMetrics> => {
  return new Promise((resolve) => {
    const metrics: PerformanceMetrics = {};

    // LCP（Largest Contentful Paint）
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1] as any;
      metrics.LCP = lastEntry.renderTime || lastEntry.loadTime;
    });
    lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });

    // FID（First Input Delay）
    const fidObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry: any) => {
        if (!metrics.FID || entry.processingStart - entry.startTime < metrics.FID) {
          metrics.FID = entry.processingStart - entry.startTime;
        }
      });
    });
    fidObserver.observe({ entryTypes: ['first-input'] });

    // CLS（Cumulative Layout Shift）
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry: any) => {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
          metrics.CLS = clsValue;
        }
      });
    });
    clsObserver.observe({ entryTypes: ['layout-shift'] });

    // FCP（First Contentful Paint）
    const fcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        if (entry.name === 'first-contentful-paint') {
          metrics.FCP = entry.startTime;
        }
      });
    });
    fcpObserver.observe({ entryTypes: ['paint'] });

    // TTFB（Time to First Byte）
    const navigationTiming = performance.getEntriesByType(
      'navigation'
    )[0] as PerformanceNavigationTiming;
    if (navigationTiming) {
      metrics.TTFB = navigationTiming.responseStart - navigationTiming.requestStart;
    }

    // 3秒後にメトリクスを返す
    setTimeout(() => {
      resolve(metrics);
    }, 3000);
  });
};

/**
 * カスタムメトリクスを測定
 */
export class PerformanceTracker {
  private marks: Map<string, number> = new Map();
  private measures: Map<string, number> = new Map();

  /**
   * マークを記録
   */
  mark(name: string): void {
    const timestamp = performance.now();
    this.marks.set(name, timestamp);
    performance.mark(name);
  }

  /**
   * 2つのマーク間の時間を測定
   */
  measure(name: string, startMark: string, endMark?: string): number {
    try {
      if (!endMark) {
        this.mark(`${name}-end`);
        endMark = `${name}-end`;
      }

      performance.measure(name, startMark, endMark);
      const measure = performance.getEntriesByName(name, 'measure')[0];
      const duration = measure.duration;

      this.measures.set(name, duration);
      return duration;
    } catch (error) {
      console.error(`Failed to measure ${name}:`, error);
      return 0;
    }
  }

  /**
   * マークからの経過時間を取得
   */
  getDuration(markName: string): number {
    const markTime = this.marks.get(markName);
    if (!markTime) {
      console.warn(`Mark ${markName} not found`);
      return 0;
    }
    return performance.now() - markTime;
  }

  /**
   * すべての測定結果を取得
   */
  getAllMeasures(): Map<string, number> {
    return new Map(this.measures);
  }

  /**
   * 測定結果をクリア
   */
  clear(): void {
    this.marks.clear();
    this.measures.clear();
    performance.clearMarks();
    performance.clearMeasures();
  }
}

/**
 * リソースタイミングを分析
 */
export const analyzeResourceTiming = (): {
  js: number;
  css: number;
  images: number;
  total: number;
} => {
  const resources = performance.getEntriesByType(
    'resource'
  ) as PerformanceResourceTiming[];

  const timing = {
    js: 0,
    css: 0,
    images: 0,
    total: 0,
  };

  resources.forEach((resource) => {
    const duration = resource.duration;

    if (resource.name.endsWith('.js')) {
      timing.js += duration;
    } else if (resource.name.endsWith('.css')) {
      timing.css += duration;
    } else if (
      resource.name.match(/\.(jpg|jpeg|png|gif|webp|avif|svg)$/i)
    ) {
      timing.images += duration;
    }

    timing.total += duration;
  });

  return timing;
};

/**
 * パフォーマンスレポートを生成
 */
export const generatePerformanceReport = async (): Promise<PerformanceReport> => {
  const metrics = await measureCoreWebVitals();
  const resourceTiming = performance.getEntriesByType(
    'resource'
  ) as PerformanceResourceTiming[];
  const navigation = performance.getEntriesByType(
    'navigation'
  )[0] as PerformanceNavigationTiming;

  return {
    timestamp: Date.now(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    metrics,
    resourceTiming,
    navigation,
  };
};

/**
 * パフォーマンスレポートをコンソールに出力
 */
export const logPerformanceReport = async (): Promise<void> => {
  const report = await generatePerformanceReport();

  console.group('🚀 Performance Report');
  console.log('Timestamp:', new Date(report.timestamp).toISOString());
  console.log('URL:', report.url);

  console.group('📊 Core Web Vitals');
  console.log('LCP:', report.metrics.LCP?.toFixed(2), 'ms');
  console.log('FID:', report.metrics.FID?.toFixed(2), 'ms');
  console.log('CLS:', report.metrics.CLS?.toFixed(4));
  console.log('FCP:', report.metrics.FCP?.toFixed(2), 'ms');
  console.log('TTFB:', report.metrics.TTFB?.toFixed(2), 'ms');
  console.groupEnd();

  const resourceAnalysis = analyzeResourceTiming();
  console.group('📦 Resource Timing');
  console.log('JavaScript:', resourceAnalysis.js.toFixed(2), 'ms');
  console.log('CSS:', resourceAnalysis.css.toFixed(2), 'ms');
  console.log('Images:', resourceAnalysis.images.toFixed(2), 'ms');
  console.log('Total:', resourceAnalysis.total.toFixed(2), 'ms');
  console.groupEnd();

  if (report.navigation) {
    console.group('🌐 Navigation Timing');
    console.log('DNS Lookup:', report.navigation.domainLookupEnd - report.navigation.domainLookupStart, 'ms');
    console.log('TCP Connection:', report.navigation.connectEnd - report.navigation.connectStart, 'ms');
    console.log('Request Time:', report.navigation.responseStart - report.navigation.requestStart, 'ms');
    console.log('Response Time:', report.navigation.responseEnd - report.navigation.responseStart, 'ms');
    console.log('DOM Processing:', report.navigation.domComplete - report.navigation.domInteractive, 'ms');
    console.log('Load Complete:', report.navigation.loadEventEnd - report.navigation.loadEventStart, 'ms');
    console.groupEnd();
  }

  console.groupEnd();
};

/**
 * パフォーマンス予算のチェック
 */
export interface PerformanceBudget {
  LCP: number; // ms
  FID: number; // ms
  CLS: number;
  FCP: number; // ms
  TTFB: number; // ms
  bundleSize: number; // KB
}

export const defaultBudget: PerformanceBudget = {
  LCP: 2500, // 2.5秒
  FID: 100, // 100ms
  CLS: 0.1,
  FCP: 1800, // 1.8秒
  TTFB: 800, // 800ms
  bundleSize: 500, // 500KB
};

export const checkPerformanceBudget = async (
  budget: PerformanceBudget = defaultBudget
): Promise<{
  passed: boolean;
  violations: string[];
  metrics: PerformanceMetrics;
}> => {
  const metrics = await measureCoreWebVitals();
  const violations: string[] = [];

  if (metrics.LCP && metrics.LCP > budget.LCP) {
    violations.push(
      `LCP (${metrics.LCP.toFixed(0)}ms) exceeds budget (${budget.LCP}ms)`
    );
  }

  if (metrics.FID && metrics.FID > budget.FID) {
    violations.push(
      `FID (${metrics.FID.toFixed(0)}ms) exceeds budget (${budget.FID}ms)`
    );
  }

  if (metrics.CLS && metrics.CLS > budget.CLS) {
    violations.push(
      `CLS (${metrics.CLS.toFixed(4)}) exceeds budget (${budget.CLS})`
    );
  }

  if (metrics.FCP && metrics.FCP > budget.FCP) {
    violations.push(
      `FCP (${metrics.FCP.toFixed(0)}ms) exceeds budget (${budget.FCP}ms)`
    );
  }

  if (metrics.TTFB && metrics.TTFB > budget.TTFB) {
    violations.push(
      `TTFB (${metrics.TTFB.toFixed(0)}ms) exceeds budget (${budget.TTFB}ms)`
    );
  }

  return {
    passed: violations.length === 0,
    violations,
    metrics,
  };
};

/**
 * グローバルパフォーマンストラッカー
 */
export const performanceTracker = new PerformanceTracker();

/**
 * 開発環境でパフォーマンスモニタリングを有効化
 */
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // ページロード完了後にレポートを出力
  window.addEventListener('load', () => {
    setTimeout(() => {
      logPerformanceReport();
    }, 3000);
  });

  // グローバルに公開（デバッグ用）
  (window as any).__performanceTracker = performanceTracker;
  (window as any).__generatePerformanceReport = generatePerformanceReport;
  (window as any).__checkPerformanceBudget = checkPerformanceBudget;
}
