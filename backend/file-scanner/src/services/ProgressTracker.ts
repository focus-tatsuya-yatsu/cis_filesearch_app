/**
 * Progress Tracker Service
 * スキャン進捗を追跡・報告するサービス
 */

import { ProgressEvent, ProgressCallback } from '@/types';
import { EventEmitter } from 'events';
import { createLogger } from '@/utils/logger';

const logger = createLogger('ProgressTracker');

/**
 * ProgressTrackerの設定
 */
export interface ProgressTrackerConfig {
  /**
   * 進捗コールバック
   */
  onProgress?: ProgressCallback;

  /**
   * 更新間隔（ミリ秒）
   */
  updateInterval?: number;

  /**
   * ログ出力を有効にする
   */
  enableLogging?: boolean;
}

/**
 * 進捗情報
 */
interface ProgressInfo {
  type: 'scan' | 'upload' | 'process';
  startTime: number;
  current: number;
  total: number;
  lastUpdate: number;
  message?: string;
}

/**
 * ProgressTracker
 * 各種処理の進捗を追跡
 */
export class ProgressTracker extends EventEmitter {
  private readonly config: ProgressTrackerConfig;
  private progressMap: Map<string, ProgressInfo> = new Map();
  private updateTimer?: NodeJS.Timeout;

  constructor(config: ProgressTrackerConfig = {}) {
    super();
    this.config = {
      updateInterval: config.updateInterval || 1000,
      enableLogging: config.enableLogging ?? true,
      ...config
    };
  }

  /**
   * 進捗追跡を開始
   */
  start(type: 'scan' | 'upload' | 'process', total?: number): void {
    const info: ProgressInfo = {
      type,
      startTime: Date.now(),
      current: 0,
      total: total || 0,
      lastUpdate: Date.now()
    };

    this.progressMap.set(type, info);

    if (this.config.enableLogging) {
      logger.info(`Started ${type} progress tracking`);
    }

    this.emit('start', { type });

    // 定期更新を開始
    if (!this.updateTimer) {
      this.startPeriodicUpdate();
    }
  }

  /**
   * 進捗を更新
   */
  update(current: number, message?: string, metadata?: any): void {
    const type = this.getCurrentType();
    if (!type) return;

    const info = this.progressMap.get(type);
    if (!info) return;

    info.current = current;
    info.lastUpdate = Date.now();
    if (message) {
      info.message = message;
    }

    // 即座に更新を送信するか、間隔制限をチェック
    const timeSinceLastUpdate = Date.now() - info.lastUpdate;
    if (timeSinceLastUpdate >= this.config.updateInterval!) {
      this.sendProgressUpdate(type, info, metadata);
    }
  }

  /**
   * 総数を更新
   */
  updateTotal(total: number): void {
    const type = this.getCurrentType();
    if (!type) return;

    const info = this.progressMap.get(type);
    if (info) {
      info.total = total;
    }
  }

  /**
   * 進捗を増加
   */
  increment(amount: number = 1, message?: string): void {
    const type = this.getCurrentType();
    if (!type) return;

    const info = this.progressMap.get(type);
    if (info) {
      info.current += amount;
      if (message) {
        info.message = message;
      }
      this.update(info.current, message);
    }
  }

  /**
   * 進捗追跡を完了
   */
  complete(type?: 'scan' | 'upload' | 'process'): void {
    const targetType = type || this.getCurrentType();
    if (!targetType) return;

    const info = this.progressMap.get(targetType);
    if (!info) return;

    const duration = Date.now() - info.startTime;

    if (this.config.enableLogging) {
      logger.info(`Completed ${targetType}: ${info.current} items in ${duration}ms`);
    }

    // 完了イベントを送信
    const event: ProgressEvent = {
      type: targetType,
      current: info.current,
      total: info.total || info.current,
      percentage: 100,
      message: `${targetType} completed`,
      metadata: { duration }
    };

    if (this.config.onProgress) {
      this.config.onProgress(event);
    }

    this.emit('complete', event);

    // 進捗情報を削除
    this.progressMap.delete(targetType);

    // すべての追跡が完了したらタイマーを停止
    if (this.progressMap.size === 0 && this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }
  }

  /**
   * エラーを記録
   */
  error(error: Error, metadata?: any): void {
    const type = this.getCurrentType();
    if (!type) return;

    if (this.config.enableLogging) {
      logger.error(`Error in ${type}:`, error);
    }

    this.emit('error', { type, error, metadata });
  }

  /**
   * 現在の進捗情報を取得
   */
  getProgress(type?: 'scan' | 'upload' | 'process'): ProgressEvent | null {
    const targetType = type || this.getCurrentType();
    if (!targetType) return null;

    const info = this.progressMap.get(targetType);
    if (!info) return null;

    const percentage = info.total > 0
      ? Math.round((info.current / info.total) * 100)
      : 0;

    return {
      type: targetType,
      current: info.current,
      total: info.total,
      percentage,
      message: info.message,
      metadata: {
        duration: Date.now() - info.startTime,
        rate: this.calculateRate(info)
      }
    };
  }

  /**
   * すべての進捗情報を取得
   */
  getAllProgress(): ProgressEvent[] {
    const results: ProgressEvent[] = [];

    for (const [, info] of this.progressMap) {
      const percentage = info.total > 0
        ? Math.round((info.current / info.total) * 100)
        : 0;

      results.push({
        type: info.type,
        current: info.current,
        total: info.total,
        percentage,
        message: info.message,
        metadata: {
          duration: Date.now() - info.startTime,
          rate: this.calculateRate(info)
        }
      });
    }

    return results;
  }

  /**
   * 進捗追跡をリセット
   */
  reset(): void {
    this.progressMap.clear();

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }

    this.emit('reset');
  }

  /**
   * 統計情報を取得
   */
  getStatistics(): {
    activeTrackers: number;
    totalProcessed: number;
    averageRate: number;
  } {
    let totalProcessed = 0;
    let totalRate = 0;
    let rateCount = 0;

    for (const info of this.progressMap.values()) {
      totalProcessed += info.current;
      const rate = this.calculateRate(info);
      if (rate > 0) {
        totalRate += rate;
        rateCount++;
      }
    }

    return {
      activeTrackers: this.progressMap.size,
      totalProcessed,
      averageRate: rateCount > 0 ? totalRate / rateCount : 0
    };
  }

  /**
   * 定期更新を開始
   */
  private startPeriodicUpdate(): void {
    this.updateTimer = setInterval(() => {
      for (const [type, info] of this.progressMap) {
        this.sendProgressUpdate(type, info);
      }
    }, this.config.updateInterval!);
  }

  /**
   * 進捗更新を送信
   */
  private sendProgressUpdate(_type: string, info: ProgressInfo, metadata?: any): void {
    const percentage = info.total > 0
      ? Math.round((info.current / info.total) * 100)
      : 0;

    const event: ProgressEvent = {
      type: info.type,
      current: info.current,
      total: info.total,
      percentage,
      message: info.message,
      metadata: metadata || {
        duration: Date.now() - info.startTime,
        rate: this.calculateRate(info)
      }
    };

    if (this.config.onProgress) {
      this.config.onProgress(event);
    }

    this.emit('progress', event);
  }

  /**
   * 処理速度を計算
   */
  private calculateRate(info: ProgressInfo): number {
    const duration = (Date.now() - info.startTime) / 1000; // 秒単位
    return duration > 0 ? info.current / duration : 0;
  }

  /**
   * 現在のタイプを取得
   */
  private getCurrentType(): 'scan' | 'upload' | 'process' | null {
    if (this.progressMap.size === 0) return null;

    // 最新のタイプを返す
    const types = Array.from(this.progressMap.keys());
    return types[types.length - 1] as any;
  }

  /**
   * 推定残り時間を計算
   */
  getEstimatedTimeRemaining(type?: 'scan' | 'upload' | 'process'): number | null {
    const progress = this.getProgress(type);
    if (!progress || !progress.metadata?.rate || progress.current === 0) {
      return null;
    }

    const remaining = progress.total - progress.current;
    const rate = progress.metadata.rate as number;
    return rate > 0 ? remaining / rate : null;
  }
}