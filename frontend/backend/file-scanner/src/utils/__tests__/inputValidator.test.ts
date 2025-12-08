import { describe, it, expect } from '@jest/globals';
import {
  validateString,
  validateNumber,
  validateEmail,
  validateURL,
  validateSearchQuery,
  detectSQLInjection,
  detectXSS,
  detectCommandInjection,
  sanitizeHTML,
  ValidationError,
} from '../inputValidator';

describe('Input Validation', () => {
  describe('validateString', () => {
    it('should accept valid string', () => {
      const result = validateString('hello world');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('hello world');
    });

    it('should trim whitespace when trim=true', () => {
      const result = validateString('  hello  ', { trim: true });
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('hello');
    });

    it('should reject empty string when allowEmpty=false', () => {
      const result = validateString('', { allowEmpty: false });
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('EMPTY_INPUT');
    });

    it('should enforce minimum length', () => {
      const result = validateString('ab', { minLength: 3 });
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('TOO_SHORT');
    });

    it('should enforce maximum length', () => {
      const result = validateString('hello', { maxLength: 3 });
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('TOO_LONG');
    });

    it('should validate against pattern', () => {
      const result = validateString('abc123', { pattern: /^[a-z]+$/ });
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('PATTERN_MISMATCH');
    });

    it('should accept pattern match', () => {
      const result = validateString('abc', { pattern: /^[a-z]+$/ });
      expect(result.isValid).toBe(true);
    });

    it('should check blacklist', () => {
      const result = validateString('admin', { blacklist: ['admin', 'root'] });
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('BLACKLISTED');
    });

    it('should check whitelist', () => {
      const result = validateString('guest', { whitelist: ['user', 'admin'] });
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('NOT_WHITELISTED');
    });

    it('should reject non-string input', () => {
      const result = validateString(123);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]?.code).toBe('INVALID_TYPE');
    });
  });

  describe('validateNumber', () => {
    it('should accept valid number', () => {
      const result = validateNumber(42);
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(42);
    });

    it('should parse string numbers', () => {
      const result = validateNumber('42');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(42);
    });

    it('should reject NaN', () => {
      const result = validateNumber('not a number');
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('INVALID_NUMBER');
    });

    it('should enforce integer constraint', () => {
      const result = validateNumber(3.14, { integer: true });
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('NOT_INTEGER');
    });

    it('should enforce positive constraint', () => {
      const result = validateNumber(-5, { positive: true });
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('NOT_POSITIVE');
    });

    it('should enforce minimum value', () => {
      const result = validateNumber(5, { min: 10 });
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('BELOW_MINIMUM');
    });

    it('should enforce maximum value', () => {
      const result = validateNumber(100, { max: 50 });
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('ABOVE_MAXIMUM');
    });

    it('should accept valid range', () => {
      const result = validateNumber(25, { min: 0, max: 100 });
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(25);
    });
  });

  describe('validateEmail', () => {
    it('should accept valid email', () => {
      const result = validateEmail('user@example.com');
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid email', () => {
      const result = validateEmail('not-an-email');
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('INVALID_EMAIL');
    });

    it('should reject email without @', () => {
      const result = validateEmail('userexample.com');
      expect(result.isValid).toBe(false);
    });

    it('should trim whitespace', () => {
      const result = validateEmail('  user@example.com  ');
      expect(result.isValid).toBe(true);
    });

    it('should reject non-string input', () => {
      const result = validateEmail(12345);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('INVALID_TYPE');
    });
  });

  describe('validateURL', () => {
    it('should accept valid HTTP URL', () => {
      const result = validateURL('http://example.com');
      expect(result.isValid).toBe(true);
    });

    it('should accept valid HTTPS URL', () => {
      const result = validateURL('https://example.com/path');
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid URL', () => {
      const result = validateURL('not a url');
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('INVALID_URL');
    });

    it('should reject URL without protocol when required', () => {
      const result = validateURL('example.com', { requireProtocol: true });
      expect(result.isValid).toBe(false);
    });

    it('should reject javascript: protocol', () => {
      const result = validateURL('javascript:alert(1)');
      expect(result.isValid).toBe(false);
    });

    it('should enforce protocol whitelist', () => {
      const result = validateURL('ftp://example.com', { protocols: ['http', 'https'] });
      expect(result.isValid).toBe(false);
    });
  });

  describe('SQL Injection Detection', () => {
    it('should detect UNION SELECT attack', () => {
      expect(detectSQLInjection("' UNION SELECT * FROM users --")).toBe(true);
    });

    it('should detect OR 1=1 attack', () => {
      expect(detectSQLInjection("admin' OR '1'='1")).toBe(true);
    });

    it('should detect INSERT attack', () => {
      expect(detectSQLInjection("'; INSERT INTO users VALUES ('hacker', 'password'); --")).toBe(
        true
      );
    });

    it('should detect DROP TABLE attack', () => {
      expect(detectSQLInjection("'; DROP TABLE users; --")).toBe(true);
    });

    it('should not flag normal search terms', () => {
      expect(detectSQLInjection('search for documents')).toBe(false);
    });

    it('should not flag single quotes in normal text', () => {
      expect(detectSQLInjection("user's document")).toBe(false);
    });
  });

  describe('XSS Detection', () => {
    it('should detect <script> tag', () => {
      expect(detectXSS('<script>alert(1)</script>')).toBe(true);
    });

    it('should detect <iframe> tag', () => {
      expect(detectXSS('<iframe src="http://evil.com"></iframe>')).toBe(true);
    });

    it('should detect javascript: protocol', () => {
      expect(detectXSS('<a href="javascript:alert(1)">Click</a>')).toBe(true);
    });

    it('should detect event handlers', () => {
      expect(detectXSS('<img src=x onerror=alert(1)>')).toBe(true);
    });

    it('should detect <object> tag', () => {
      expect(detectXSS('<object data="http://evil.com"></object>')).toBe(true);
    });

    it('should not flag normal HTML text', () => {
      expect(detectXSS('This is a normal text')).toBe(false);
    });
  });

  describe('Command Injection Detection', () => {
    it('should detect semicolon command separator', () => {
      expect(detectCommandInjection('file.txt; rm -rf /')).toBe(true);
    });

    it('should detect pipe operator', () => {
      expect(detectCommandInjection('file.txt | cat /etc/passwd')).toBe(true);
    });

    it('should detect backticks', () => {
      expect(detectCommandInjection('file.txt`whoami`')).toBe(true);
    });

    it('should detect $() command substitution', () => {
      expect(detectCommandInjection('file.txt$(whoami)')).toBe(true);
    });

    it('should detect directory traversal', () => {
      expect(detectCommandInjection('../../../etc/passwd')).toBe(true);
    });

    it('should detect null byte injection', () => {
      expect(detectCommandInjection('file.txt\0.jpg')).toBe(true);
    });

    it('should not flag normal filenames', () => {
      expect(detectCommandInjection('document-2024.txt')).toBe(false);
    });
  });

  describe('validateSearchQuery', () => {
    it('should accept safe search query', () => {
      const result = validateSearchQuery('annual report 2024');
      expect(result.isValid).toBe(true);
    });

    it('should reject SQL injection attempt', () => {
      const result = validateSearchQuery("' UNION SELECT * FROM files --");
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('SQL_INJECTION_DETECTED');
    });

    it('should reject XSS attempt', () => {
      const result = validateSearchQuery('<script>alert(1)</script>');
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('XSS_DETECTED');
    });

    it('should reject command injection attempt', () => {
      const result = validateSearchQuery('file; rm -rf /');
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('COMMAND_INJECTION_DETECTED');
    });

    it('should reject empty query', () => {
      const result = validateSearchQuery('');
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('EMPTY_INPUT');
    });

    it('should reject query exceeding max length', () => {
      const result = validateSearchQuery('a'.repeat(2000));
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0].code).toBe('TOO_LONG');
    });

    it('should HTML escape the validated query', () => {
      const result = validateSearchQuery('test & query');
      expect(result.isValid).toBe(true);
      expect(result.value).toContain('&amp;');
    });
  });

  describe('sanitizeHTML', () => {
    it('should escape HTML entities', () => {
      expect(sanitizeHTML('<script>alert(1)</script>')).toBe(
        '&lt;script&gt;alert&#x28;1&#x29;&lt;&#x2F;script&gt;'
      );
    });

    it('should escape quotes', () => {
      expect(sanitizeHTML('"quoted" text')).toContain('&quot;');
    });

    it('should escape ampersand', () => {
      expect(sanitizeHTML('Tom & Jerry')).toContain('&amp;');
    });
  });

  describe('ValidationError', () => {
    it('should create error with all properties', () => {
      const error = new ValidationError('Test error', 'testField', 'TEST_CODE', { extra: 'data' });

      expect(error.message).toBe('Test error');
      expect(error.field).toBe('testField');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ extra: 'data' });
      expect(error.name).toBe('ValidationError');
    });
  });
});

describe('Express Middleware Integration', () => {
  // These tests would require Express mock setup
  it.todo('should validate request body');
  it.todo('should validate query parameters');
  it.todo('should return 400 for validation errors');
  it.todo('should sanitize validated values');
});
