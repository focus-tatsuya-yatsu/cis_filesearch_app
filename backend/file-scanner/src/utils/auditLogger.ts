/**
 * Security Audit Logging System
 *
 * このモジュールは、セキュリティ監査ログを記録するシステムを提供します。
 * OWASP Top 10 2021 - A09: Security Logging and Monitoring Failures対策
 */

import { createLogger, format, transports, Logger } from 'winston';
import { join } from 'path';

/**
 * 監査ログイベントタイプ
 */
export enum AuditEventType {
  // Authentication & Authorization
  AUTH_LOGIN_SUCCESS = 'auth.login.success',
  AUTH_LOGIN_FAILED = 'auth.login.failed',
  AUTH_LOGOUT = 'auth.logout',
  AUTH_TOKEN_REFRESH = 'auth.token.refresh',
  AUTH_TOKEN_EXPIRED = 'auth.token.expired',
  AUTH_TOKEN_INVALID = 'auth.token.invalid',
  AUTH_MFA_REQUIRED = 'auth.mfa.required',
  AUTH_MFA_SUCCESS = 'auth.mfa.success',
  AUTH_MFA_FAILED = 'auth.mfa.failed',

  // Authorization
  AUTHZ_ACCESS_GRANTED = 'authz.access.granted',
  AUTHZ_ACCESS_DENIED = 'authz.access.denied',
  AUTHZ_PERMISSION_CHANGED = 'authz.permission.changed',
  AUTHZ_ROLE_CHANGED = 'authz.role.changed',

  // File Operations
  FILE_READ = 'file.read',
  FILE_WRITE = 'file.write',
  FILE_DELETE = 'file.delete',
  FILE_DOWNLOAD = 'file.download',
  FILE_UPLOAD = 'file.upload',

  // Security Events
  SECURITY_VALIDATION_FAILED = 'security.validation.failed',
  SECURITY_PATH_TRAVERSAL_ATTEMPT = 'security.path_traversal.attempt',
  SECURITY_SQL_INJECTION_ATTEMPT = 'security.sql_injection.attempt',
  SECURITY_XSS_ATTEMPT = 'security.xss.attempt',
  SECURITY_COMMAND_INJECTION_ATTEMPT = 'security.command_injection.attempt',
  SECURITY_RATE_LIMIT_EXCEEDED = 'security.rate_limit.exceeded',
  SECURITY_SUSPICIOUS_ACTIVITY = 'security.suspicious_activity',

  // Configuration Changes
  CONFIG_UPDATED = 'config.updated',
  CONFIG_SECRETS_ACCESSED = 'config.secrets.accessed',

  // System Events
  SYSTEM_STARTUP = 'system.startup',
  SYSTEM_SHUTDOWN = 'system.shutdown',
  SYSTEM_ERROR = 'system.error',
}

/**
 * 監査ログの重要度レベル
 */
export enum AuditSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * 監査ログエントリ
 */
export interface AuditLogEntry {
  // Metadata
  timestamp: string;
  eventType: AuditEventType;
  severity: AuditSeverity;
  eventId: string;

  // Actor (who performed the action)
  userId?: string;
  username?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;

  // Action (what was done)
  action: string;
  resource?: string;
  resourceType?: string;

  // Result
  success: boolean;
  errorMessage?: string;
  errorCode?: string;

  // Context
  metadata?: Record<string, any>;

  // Compliance
  complianceNote?: string;
}

/**
 * 監査ログ設定
 */
export interface AuditLogConfig {
  logDir?: string;
  logToConsole?: boolean;
  logToFile?: boolean;
  logToCloudWatch?: boolean;
  maxFileSize?: number;
  maxFiles?: number;
  maskSensitiveData?: boolean;
}

/**
 * センシティブデータフィールド
 */
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'privateKey',
  'creditCard',
  'ssn',
];

/**
 * 監査ロガークラス
 */
export class AuditLogger {
  private logger: Logger;
  private config: Required<AuditLogConfig>;

  constructor(config: AuditLogConfig = {}) {
    this.config = {
      logDir: config.logDir || './logs/audit',
      logToConsole: config.logToConsole ?? true,
      logToFile: config.logToFile ?? true,
      logToCloudWatch: config.logToCloudWatch ?? false,
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
      maxFiles: config.maxFiles || 30,
      maskSensitiveData: config.maskSensitiveData ?? true,
    };

    this.logger = this.createLogger();
  }

  /**
   * Winstonロガーの作成
   */
  private createLogger(): Logger {
    const logTransports: any[] = [];

    // Console transport
    if (this.config.logToConsole) {
      logTransports.push(
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.timestamp(),
            format.printf(({ timestamp, level, message, ...meta }) => {
              return `${timestamp} [${level}]: ${message} ${
                Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
              }`;
            })
          ),
        })
      );
    }

    // File transport
    if (this.config.logToFile) {
      logTransports.push(
        new transports.File({
          filename: join(this.config.logDir, 'audit.log'),
          format: format.combine(format.timestamp(), format.json()),
          maxsize: this.config.maxFileSize,
          maxFiles: this.config.maxFiles,
          tailable: true,
        })
      );

      // Separate file for critical events
      logTransports.push(
        new transports.File({
          filename: join(this.config.logDir, 'audit-critical.log'),
          level: 'error',
          format: format.combine(format.timestamp(), format.json()),
          maxsize: this.config.maxFileSize,
          maxFiles: this.config.maxFiles,
        })
      );
    }

    return createLogger({
      level: 'info',
      transports: logTransports,
      exitOnError: false,
    });
  }

  /**
   * センシティブデータをマスク
   */
  private maskSensitiveData(data: any): any {
    if (!this.config.maskSensitiveData) {
      return data;
    }

    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const masked = { ...data };

    for (const key of Object.keys(masked)) {
      const lowerKey = key.toLowerCase();

      if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
        masked[key] = '***MASKED***';
      } else if (typeof masked[key] === 'object') {
        masked[key] = this.maskSensitiveData(masked[key]);
      }
    }

    return masked;
  }

  /**
   * 監査ログエントリを生成
   */
  private createLogEntry(
    eventType: AuditEventType,
    action: string,
    options: Partial<AuditLogEntry> = {}
  ): AuditLogEntry {
    return {
      timestamp: new Date().toISOString(),
      eventType,
      severity: options.severity || AuditSeverity.INFO,
      eventId: this.generateEventId(),
      action,
      success: options.success ?? true,
      userId: options.userId,
      username: options.username,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      sessionId: options.sessionId,
      resource: options.resource,
      resourceType: options.resourceType,
      errorMessage: options.errorMessage,
      errorCode: options.errorCode,
      metadata: options.metadata ? this.maskSensitiveData(options.metadata) : undefined,
      complianceNote: options.complianceNote,
    };
  }

  /**
   * イベントIDを生成
   */
  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * ログレベルを決定
   */
  private getLogLevel(severity: AuditSeverity): string {
    switch (severity) {
      case AuditSeverity.INFO:
        return 'info';
      case AuditSeverity.WARNING:
        return 'warn';
      case AuditSeverity.ERROR:
      case AuditSeverity.CRITICAL:
        return 'error';
      default:
        return 'info';
    }
  }

  /**
   * 監査ログを記録
   */
  log(
    eventType: AuditEventType,
    action: string,
    options: Partial<AuditLogEntry> = {}
  ): void {
    const logEntry = this.createLogEntry(eventType, action, options);
    const logLevel = this.getLogLevel(logEntry.severity);

    this.logger.log(logLevel, action, logEntry);

    // CloudWatch integration (if enabled)
    if (this.config.logToCloudWatch) {
      this.sendToCloudWatch(logEntry);
    }
  }

  /**
   * CloudWatchへの送信（プレースホルダー）
   */
  private async sendToCloudWatch(logEntry: AuditLogEntry): Promise<void> {
    // TODO: Phase Bで実装（AWS SDK統合）
    // CloudWatchLogs.putLogEvents() を使用
  }

  /**
   * 認証成功ログ
   */
  logAuthSuccess(userId: string, username: string, ipAddress: string, metadata?: any): void {
    this.log(AuditEventType.AUTH_LOGIN_SUCCESS, 'User logged in successfully', {
      severity: AuditSeverity.INFO,
      userId,
      username,
      ipAddress,
      success: true,
      metadata,
      complianceNote: 'GDPR Article 32 - Security of processing',
    });
  }

  /**
   * 認証失敗ログ
   */
  logAuthFailure(
    username: string,
    ipAddress: string,
    reason: string,
    metadata?: any
  ): void {
    this.log(AuditEventType.AUTH_LOGIN_FAILED, 'Login attempt failed', {
      severity: AuditSeverity.WARNING,
      username,
      ipAddress,
      success: false,
      errorMessage: reason,
      metadata,
      complianceNote: 'SOC 2 CC6.1 - Logical access security',
    });
  }

  /**
   * アクセス拒否ログ
   */
  logAccessDenied(
    userId: string,
    username: string,
    resource: string,
    reason: string,
    metadata?: any
  ): void {
    this.log(AuditEventType.AUTHZ_ACCESS_DENIED, 'Access denied to resource', {
      severity: AuditSeverity.WARNING,
      userId,
      username,
      resource,
      success: false,
      errorMessage: reason,
      metadata,
      complianceNote: 'SOC 2 CC6.2 - Authorization',
    });
  }

  /**
   * ファイルアクセスログ
   */
  logFileAccess(
    userId: string,
    username: string,
    filePath: string,
    operation: 'read' | 'write' | 'delete',
    success: boolean,
    metadata?: any
  ): void {
    const eventTypeMap = {
      read: AuditEventType.FILE_READ,
      write: AuditEventType.FILE_WRITE,
      delete: AuditEventType.FILE_DELETE,
    };

    this.log(eventTypeMap[operation], `File ${operation} operation`, {
      severity: success ? AuditSeverity.INFO : AuditSeverity.WARNING,
      userId,
      username,
      resource: filePath,
      resourceType: 'file',
      success,
      metadata,
      complianceNote: 'GDPR Article 30 - Records of processing activities',
    });
  }

  /**
   * セキュリティイベントログ
   */
  logSecurityEvent(
    eventType: AuditEventType,
    description: string,
    ipAddress: string,
    userId?: string,
    metadata?: any
  ): void {
    this.log(eventType, description, {
      severity: AuditSeverity.CRITICAL,
      userId,
      ipAddress,
      success: false,
      metadata,
      complianceNote: 'GDPR Article 33 - Notification of a personal data breach',
    });
  }

  /**
   * Path Traversal攻撃ログ
   */
  logPathTraversalAttempt(
    ipAddress: string,
    attemptedPath: string,
    userId?: string,
    metadata?: any
  ): void {
    this.logSecurityEvent(
      AuditEventType.SECURITY_PATH_TRAVERSAL_ATTEMPT,
      'Path traversal attack detected',
      ipAddress,
      userId,
      { attemptedPath, ...metadata }
    );
  }

  /**
   * SQLインジェクション攻撃ログ
   */
  logSQLInjectionAttempt(
    ipAddress: string,
    query: string,
    userId?: string,
    metadata?: any
  ): void {
    this.logSecurityEvent(
      AuditEventType.SECURITY_SQL_INJECTION_ATTEMPT,
      'SQL injection attack detected',
      ipAddress,
      userId,
      { query: query.substring(0, 200), ...metadata }
    );
  }

  /**
   * XSS攻撃ログ
   */
  logXSSAttempt(
    ipAddress: string,
    payload: string,
    userId?: string,
    metadata?: any
  ): void {
    this.logSecurityEvent(
      AuditEventType.SECURITY_XSS_ATTEMPT,
      'XSS attack detected',
      ipAddress,
      userId,
      { payload: payload.substring(0, 200), ...metadata }
    );
  }

  /**
   * レート制限超過ログ
   */
  logRateLimitExceeded(
    ipAddress: string,
    endpoint: string,
    userId?: string,
    metadata?: any
  ): void {
    this.log(AuditEventType.SECURITY_RATE_LIMIT_EXCEEDED, 'Rate limit exceeded', {
      severity: AuditSeverity.WARNING,
      userId,
      ipAddress,
      resource: endpoint,
      success: false,
      metadata,
    });
  }
}

/**
 * グローバル監査ロガーインスタンス
 */
let globalAuditLogger: AuditLogger | null = null;

/**
 * グローバル監査ロガーを初期化
 */
export const initializeAuditLogger = (config?: AuditLogConfig): AuditLogger => {
  globalAuditLogger = new AuditLogger(config);
  return globalAuditLogger;
};

/**
 * グローバル監査ロガーを取得
 */
export const getAuditLogger = (): AuditLogger => {
  if (!globalAuditLogger) {
    globalAuditLogger = new AuditLogger();
  }
  return globalAuditLogger;
};

/**
 * Express Middleware: 監査ログ自動記録
 *
 * @example
 * ```typescript
 * app.use(auditLogMiddleware());
 * ```
 */
export const auditLogMiddleware = () => {
  const auditLogger = getAuditLogger();

  return (req: any, res: any, next: any) => {
    const startTime = Date.now();

    // リクエスト情報を保存
    const requestInfo = {
      method: req.method,
      url: req.url,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
      username: req.user?.username,
    };

    // レスポンス終了時にログ記録
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      // セキュリティ関連エンドポイントのみログ記録
      const securityEndpoints = ['/api/auth', '/api/files', '/api/admin'];

      if (securityEndpoints.some(endpoint => req.url.startsWith(endpoint))) {
        auditLogger.log(
          statusCode >= 400
            ? AuditEventType.SECURITY_VALIDATION_FAILED
            : AuditEventType.AUTHZ_ACCESS_GRANTED,
          `${req.method} ${req.url}`,
          {
            severity:
              statusCode >= 500
                ? AuditSeverity.ERROR
                : statusCode >= 400
                ? AuditSeverity.WARNING
                : AuditSeverity.INFO,
            userId: requestInfo.userId,
            username: requestInfo.username,
            ipAddress: requestInfo.ipAddress,
            userAgent: requestInfo.userAgent,
            resource: req.url,
            success: statusCode < 400,
            metadata: {
              method: req.method,
              statusCode,
              duration,
            },
          }
        );
      }
    });

    next();
  };
};
