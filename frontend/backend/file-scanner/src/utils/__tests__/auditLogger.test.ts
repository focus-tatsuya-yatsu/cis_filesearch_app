import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  AuditLogger,
  AuditEventType,
  AuditSeverity,
  initializeAuditLogger,
  getAuditLogger,
} from '../auditLogger';

describe('Security Audit Logging', () => {
  let testLogDir: string;
  let auditLogger: AuditLogger;

  beforeEach(async () => {
    // テスト用の一時ディレクトリを作成
    testLogDir = await mkdtemp(join(tmpdir(), 'audit-test-'));

    auditLogger = new AuditLogger({
      logDir: testLogDir,
      logToConsole: false,
      logToFile: true,
      maskSensitiveData: true,
    });
  });

  afterEach(async () => {
    // テストディレクトリをクリーンアップ
    await rm(testLogDir, { recursive: true, force: true });
  });

  describe('AuditLogger instantiation', () => {
    it('should create logger with default config', () => {
      const logger = new AuditLogger();
      expect(logger).toBeInstanceOf(AuditLogger);
    });

    it('should create logger with custom config', () => {
      const logger = new AuditLogger({
        logDir: '/custom/path',
        logToConsole: true,
        logToFile: true,
        maxFileSize: 5 * 1024 * 1024,
      });
      expect(logger).toBeInstanceOf(AuditLogger);
    });
  });

  describe('Basic logging', () => {
    it('should log info event', () => {
      expect(() => {
        auditLogger.log(AuditEventType.SYSTEM_STARTUP, 'System started', {
          severity: AuditSeverity.INFO,
          success: true,
        });
      }).not.toThrow();
    });

    it('should log warning event', () => {
      expect(() => {
        auditLogger.log(AuditEventType.SECURITY_VALIDATION_FAILED, 'Validation failed', {
          severity: AuditSeverity.WARNING,
          success: false,
        });
      }).not.toThrow();
    });

    it('should log error event', () => {
      expect(() => {
        auditLogger.log(AuditEventType.SYSTEM_ERROR, 'System error occurred', {
          severity: AuditSeverity.ERROR,
          success: false,
          errorMessage: 'Database connection failed',
        });
      }).not.toThrow();
    });

    it('should log critical event', () => {
      expect(() => {
        auditLogger.log(
          AuditEventType.SECURITY_SQL_INJECTION_ATTEMPT,
          'SQL injection detected',
          {
            severity: AuditSeverity.CRITICAL,
            success: false,
            ipAddress: '192.168.1.100',
          }
        );
      }).not.toThrow();
    });
  });

  describe('Authentication logging', () => {
    it('should log successful login', () => {
      expect(() => {
        auditLogger.logAuthSuccess('user-123', 'john.doe', '192.168.1.10', {
          loginMethod: 'password',
        });
      }).not.toThrow();
    });

    it('should log failed login', () => {
      expect(() => {
        auditLogger.logAuthFailure('john.doe', '192.168.1.10', 'Invalid password', {
          attemptCount: 3,
        });
      }).not.toThrow();
    });
  });

  describe('Authorization logging', () => {
    it('should log access denied', () => {
      expect(() => {
        auditLogger.logAccessDenied(
          'user-123',
          'john.doe',
          '/api/admin/users',
          'Insufficient permissions'
        );
      }).not.toThrow();
    });
  });

  describe('File access logging', () => {
    it('should log successful file read', () => {
      expect(() => {
        auditLogger.logFileAccess(
          'user-123',
          'john.doe',
          '/uploads/document.pdf',
          'read',
          true
        );
      }).not.toThrow();
    });

    it('should log failed file write', () => {
      expect(() => {
        auditLogger.logFileAccess(
          'user-123',
          'john.doe',
          '/uploads/document.pdf',
          'write',
          false,
          { error: 'Permission denied' }
        );
      }).not.toThrow();
    });

    it('should log file deletion', () => {
      expect(() => {
        auditLogger.logFileAccess(
          'user-123',
          'john.doe',
          '/uploads/old-file.txt',
          'delete',
          true
        );
      }).not.toThrow();
    });
  });

  describe('Security event logging', () => {
    it('should log path traversal attempt', () => {
      expect(() => {
        auditLogger.logPathTraversalAttempt(
          '192.168.1.100',
          '../../../etc/passwd',
          'user-123'
        );
      }).not.toThrow();
    });

    it('should log SQL injection attempt', () => {
      expect(() => {
        auditLogger.logSQLInjectionAttempt(
          '192.168.1.100',
          "' UNION SELECT * FROM users --",
          'user-123'
        );
      }).not.toThrow();
    });

    it('should log XSS attempt', () => {
      expect(() => {
        auditLogger.logXSSAttempt(
          '192.168.1.100',
          '<script>alert(1)</script>',
          'user-123'
        );
      }).not.toThrow();
    });

    it('should log rate limit exceeded', () => {
      expect(() => {
        auditLogger.logRateLimitExceeded('192.168.1.100', '/api/search', 'user-123', {
          requestCount: 150,
          limit: 100,
        });
      }).not.toThrow();
    });
  });

  describe('Sensitive data masking', () => {
    it('should mask password fields', () => {
      const spy = jest.spyOn(auditLogger as any, 'maskSensitiveData');

      auditLogger.log(AuditEventType.AUTH_LOGIN_SUCCESS, 'Login', {
        metadata: {
          password: 'secret123',
          username: 'john.doe',
        },
      });

      // maskSensitiveData should be called
      expect(spy).toHaveBeenCalled();
    });

    it('should mask token fields', () => {
      const maskedData = (auditLogger as any).maskSensitiveData({
        token: 'jwt-token-here',
        userId: 'user-123',
      });

      expect(maskedData.token).toBe('***MASKED***');
      expect(maskedData.userId).toBe('user-123');
    });

    it('should mask nested sensitive fields', () => {
      const maskedData = (auditLogger as any).maskSensitiveData({
        user: {
          username: 'john',
          password: 'secret',
          profile: {
            apiKey: 'key-123',
          },
        },
      });

      expect(maskedData.user.password).toBe('***MASKED***');
      expect(maskedData.user.profile.apiKey).toBe('***MASKED***');
      expect(maskedData.user.username).toBe('john');
    });

    it('should not mask when maskSensitiveData is false', () => {
      const logger = new AuditLogger({
        logDir: testLogDir,
        logToConsole: false,
        maskSensitiveData: false,
      });

      const maskedData = (logger as any).maskSensitiveData({
        password: 'secret',
      });

      expect(maskedData.password).toBe('secret');
    });
  });

  describe('Event ID generation', () => {
    it('should generate unique event IDs', () => {
      const id1 = (auditLogger as any).generateEventId();
      const id2 = (auditLogger as any).generateEventId();

      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
    });
  });

  describe('Global logger', () => {
    it('should initialize global logger', () => {
      const logger = initializeAuditLogger({
        logDir: testLogDir,
        logToConsole: false,
      });

      expect(logger).toBeInstanceOf(AuditLogger);
    });

    it('should get global logger instance', () => {
      initializeAuditLogger({ logDir: testLogDir });
      const logger = getAuditLogger();

      expect(logger).toBeInstanceOf(AuditLogger);
    });

    it('should create default logger if not initialized', () => {
      const logger = getAuditLogger();
      expect(logger).toBeInstanceOf(AuditLogger);
    });
  });

  describe('Log entry structure', () => {
    it('should include all required fields', () => {
      const createLogEntry = (auditLogger as any).createLogEntry.bind(auditLogger);

      const entry = createLogEntry(
        AuditEventType.AUTH_LOGIN_SUCCESS,
        'User login',
        {
          userId: 'user-123',
          username: 'john.doe',
          ipAddress: '192.168.1.10',
          success: true,
        }
      );

      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('eventType');
      expect(entry).toHaveProperty('severity');
      expect(entry).toHaveProperty('eventId');
      expect(entry).toHaveProperty('action');
      expect(entry).toHaveProperty('success');
      expect(entry.userId).toBe('user-123');
      expect(entry.username).toBe('john.doe');
      expect(entry.ipAddress).toBe('192.168.1.10');
    });

    it('should include compliance notes', () => {
      const createLogEntry = (auditLogger as any).createLogEntry.bind(auditLogger);

      const entry = createLogEntry(
        AuditEventType.AUTH_LOGIN_SUCCESS,
        'User login',
        {
          complianceNote: 'GDPR Article 32',
        }
      );

      expect(entry.complianceNote).toBe('GDPR Article 32');
    });
  });

  describe('Log levels', () => {
    it('should map INFO severity to info level', () => {
      const level = (auditLogger as any).getLogLevel(AuditSeverity.INFO);
      expect(level).toBe('info');
    });

    it('should map WARNING severity to warn level', () => {
      const level = (auditLogger as any).getLogLevel(AuditSeverity.WARNING);
      expect(level).toBe('warn');
    });

    it('should map ERROR severity to error level', () => {
      const level = (auditLogger as any).getLogLevel(AuditSeverity.ERROR);
      expect(level).toBe('error');
    });

    it('should map CRITICAL severity to error level', () => {
      const level = (auditLogger as any).getLogLevel(AuditSeverity.CRITICAL);
      expect(level).toBe('error');
    });
  });
});

describe('Audit Middleware', () => {
  // Middleware tests require Express mock setup
  it.todo('should log security-related requests');
  it.todo('should include request duration');
  it.todo('should log failed requests with higher severity');
  it.todo('should include user information if authenticated');
});
