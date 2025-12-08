/**
 * Logger Utility
 * Winston を使用したロギングユーティリティ
 */

import winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import { createCircularReplacer, serializeError } from './safe-json.js';

// 環境変数から設定を読み込み
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_DIR = process.env.LOG_DIR || './logs';
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || '30';
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '50m';

// ログディレクトリを作成
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * カスタムログフォーマット
 */
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, label, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]`;

    if (label) {
      msg += ` [${label}]`;
    }

    msg += ` ${message}`;

    // メタデータがある場合は追加（循環参照対応）
    if (Object.keys(metadata).length > 0) {
      try {
        // Process errors in metadata
        const processedMetadata = { ...metadata };
        if (processedMetadata.error instanceof Error) {
          processedMetadata.error = serializeError(processedMetadata.error);
        }
        msg += ` ${JSON.stringify(processedMetadata, createCircularReplacer())}`;
      } catch (error) {
        msg += ` [Metadata serialization error: ${error instanceof Error ? error.message : String(error)}]`;
      }
    }

    return msg;
  })
);

/**
 * コンソール出力用のカラフォーマット
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, label, ...metadata }) => {
    let msg = `${timestamp} ${level}`;

    if (label) {
      msg += ` [${label}]`;
    }

    msg += ` ${message}`;

    // メタデータがある場合は追加（開発環境のみ、循環参照対応）
    if (process.env.NODE_ENV === 'development' && Object.keys(metadata).length > 0) {
      try {
        // Process errors in metadata
        const processedMetadata = { ...metadata };
        if (processedMetadata.error instanceof Error) {
          processedMetadata.error = serializeError(processedMetadata.error);
        }
        msg += ` ${JSON.stringify(processedMetadata, createCircularReplacer(), 2)}`;
      } catch (error) {
        msg += ` [Metadata serialization error: ${error instanceof Error ? error.message : String(error)}]`;
      }
    }

    return msg;
  })
);

/**
 * デフォルトのロガーを作成
 */
const defaultLogger = winston.createLogger({
  level: LOG_LEVEL,
  format: customFormat,
  transports: [
    // コンソール出力
    new winston.transports.Console({
      format: consoleFormat
    }),

    // ファイル出力（エラーログ）
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: parseInt(LOG_MAX_SIZE) * 1024 * 1024, // MB to bytes
      maxFiles: parseInt(LOG_MAX_FILES)
    }),

    // ファイル出力（全ログ）
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: parseInt(LOG_MAX_SIZE) * 1024 * 1024,
      maxFiles: parseInt(LOG_MAX_FILES)
    })
  ]
});

/**
 * 本番環境用の設定
 */
if (process.env.NODE_ENV === 'production') {
  // 本番環境ではコンソール出力を制限
  defaultLogger.clear();

  defaultLogger.add(new winston.transports.Console({
    level: 'warn',
    format: winston.format.simple()
  }));

  defaultLogger.add(new winston.transports.File({
    filename: path.join(LOG_DIR, 'error.log'),
    level: 'error',
    maxsize: parseInt(LOG_MAX_SIZE) * 1024 * 1024,
    maxFiles: parseInt(LOG_MAX_FILES)
  }));

  defaultLogger.add(new winston.transports.File({
    filename: path.join(LOG_DIR, 'combined.log'),
    maxsize: parseInt(LOG_MAX_SIZE) * 1024 * 1024,
    maxFiles: parseInt(LOG_MAX_FILES)
  }));
}

/**
 * ラベル付きロガーを作成
 */
export function createLogger(label: string): winston.Logger {
  return defaultLogger.child({ label });
}

/**
 * ログレベルを動的に変更
 */
export function setLogLevel(level: string): void {
  defaultLogger.level = level;
}

/**
 * ログをフラッシュ（すべてのトランスポートを閉じる）
 */
export async function flushLogs(): Promise<void> {
  return new Promise((resolve) => {
    defaultLogger.end(() => resolve());
  });
}

/**
 * パフォーマンス計測用のロガー
 */
export class PerformanceLogger {
  private startTime: number;
  private logger: winston.Logger;
  private operation: string;

  constructor(operation: string, label?: string) {
    this.operation = operation;
    this.logger = createLogger(label || 'Performance');
    this.startTime = Date.now();
    this.logger.debug(`Started: ${operation}`);
  }

  /**
   * 中間ポイントをログ
   */
  checkpoint(message: string): void {
    const elapsed = Date.now() - this.startTime;
    this.logger.debug(`${message} (${elapsed}ms)`);
  }

  /**
   * 完了をログ
   */
  complete(message?: string): void {
    const elapsed = Date.now() - this.startTime;
    const msg = message || `Completed: ${this.operation}`;
    this.logger.info(`${msg} (${elapsed}ms)`);
  }

  /**
   * エラーをログ
   */
  error(error: Error): void {
    const elapsed = Date.now() - this.startTime;
    this.logger.error(`Failed: ${this.operation} (${elapsed}ms)`, { error: serializeError(error) });
  }
}

// デフォルトエクスポート
export default defaultLogger;