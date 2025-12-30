/**
 * Logger Service
 * CloudWatch Logsへの構造化ログ出力
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export class Logger {
  private context: string;
  private logLevel: LogLevel;

  constructor(context: string) {
    this.context = context;
    this.logLevel = this.getLogLevel();
  }

  private getLogLevel(): LogLevel {
    const level = process.env.LOG_LEVEL?.toLowerCase() || 'info';
    return (LogLevel[level.toUpperCase() as keyof typeof LogLevel] || LogLevel.INFO);
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentIndex = levels.indexOf(this.logLevel);
    const targetIndex = levels.indexOf(level);
    return targetIndex >= currentIndex;
  }

  private log(level: LogLevel, message: string, meta?: Record<string, any>) {
    if (!this.shouldLog(level)) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      ...(meta && { meta }),
    };

    // CloudWatch Logsに構造化ログとして出力
    console.log(JSON.stringify(logEntry));
  }

  debug(message: string, meta?: Record<string, any>) {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: Record<string, any>) {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: Record<string, any>) {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, meta?: Record<string, any>) {
    this.log(LogLevel.ERROR, message, meta);
  }
}
