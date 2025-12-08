/**
 * Input Validation Utilities
 *
 * このモジュールは、すべてのユーザー入力を検証・サニタイズするユーティリティを提供します。
 * OWASP Top 10 2021 - A03: Injection対策
 */

import validator from 'validator';

/**
 * バリデーションエラー
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly code: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * バリデーション結果
 */
export interface ValidationResult<T = any> {
  isValid: boolean;
  value?: T;
  errors?: ValidationError[];
}

/**
 * 文字列バリデーションオプション
 */
export interface StringValidationOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  allowEmpty?: boolean;
  trim?: boolean;
  blacklist?: string[];
  whitelist?: string[];
}

/**
 * 数値バリデーションオプション
 */
export interface NumberValidationOptions {
  min?: number;
  max?: number;
  integer?: boolean;
  positive?: boolean;
}

/**
 * 危険なパターン（SQLインジェクション、XSS対策）
 */
const DANGEROUS_SQL_PATTERNS = [
  /(\bUNION\b.*\bSELECT\b)/i,
  /(\bSELECT\b.*\bFROM\b)/i,
  /(\bINSERT\b.*\bINTO\b)/i,
  /(\bUPDATE\b.*\bSET\b)/i,
  /(\bDELETE\b.*\bFROM\b)/i,
  /(\bDROP\b.*\bTABLE\b)/i,
  /(\bEXEC\b.*\()/i,
  /(;.*--)/,
  /('.*OR.*'.*=.*')/i,
  /(".*OR.*".*=.*")/i,
];

const DANGEROUS_XSS_PATTERNS = [
  /<script[^>]*>.*<\/script>/gi,
  /<iframe[^>]*>.*<\/iframe>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,  // Event handlers like onclick=
  /<object[^>]*>.*<\/object>/gi,
  /<embed[^>]*>/gi,
];

const DANGEROUS_COMMAND_PATTERNS = [
  /[;&|`$()]/,  // Shell metacharacters
  /\.\./,       // Directory traversal
  /\0/,         // Null byte
];

/**
 * 文字列バリデーション
 *
 * @example
 * ```typescript
 * const result = validateString('user input', {
 *   minLength: 1,
 *   maxLength: 100,
 *   pattern: /^[a-zA-Z0-9_-]+$/
 * });
 * ```
 */
export const validateString = (
  input: any,
  options: StringValidationOptions = {},
  fieldName = 'field'
): ValidationResult<string> => {
  const {
    minLength = 0,
    maxLength = 10000,
    pattern,
    allowEmpty = false,
    trim = true,
    blacklist = [],
    whitelist = [],
  } = options;

  // Type check
  if (typeof input !== 'string') {
    return {
      isValid: false,
      errors: [new ValidationError('Input must be a string', fieldName, 'INVALID_TYPE')],
    };
  }

  let value = trim ? input.trim() : input;

  // Empty check
  if (!allowEmpty && value.length === 0) {
    return {
      isValid: false,
      errors: [new ValidationError('Input cannot be empty', fieldName, 'EMPTY_INPUT')],
    };
  }

  // Length check
  if (value.length < minLength) {
    return {
      isValid: false,
      errors: [
        new ValidationError(
          `Input must be at least ${minLength} characters`,
          fieldName,
          'TOO_SHORT',
          { minLength, actualLength: value.length }
        ),
      ],
    };
  }

  if (value.length > maxLength) {
    return {
      isValid: false,
      errors: [
        new ValidationError(
          `Input must not exceed ${maxLength} characters`,
          fieldName,
          'TOO_LONG',
          { maxLength, actualLength: value.length }
        ),
      ],
    };
  }

  // Pattern check
  if (pattern && !pattern.test(value)) {
    return {
      isValid: false,
      errors: [
        new ValidationError(
          'Input does not match required pattern',
          fieldName,
          'PATTERN_MISMATCH',
          { pattern: pattern.toString() }
        ),
      ],
    };
  }

  // Blacklist check
  if (blacklist.length > 0 && blacklist.includes(value)) {
    return {
      isValid: false,
      errors: [new ValidationError('Input contains forbidden value', fieldName, 'BLACKLISTED')],
    };
  }

  // Whitelist check
  if (whitelist.length > 0 && !whitelist.includes(value)) {
    return {
      isValid: false,
      errors: [new ValidationError('Input value is not allowed', fieldName, 'NOT_WHITELISTED')],
    };
  }

  return {
    isValid: true,
    value,
  };
};

/**
 * 数値バリデーション
 *
 * @example
 * ```typescript
 * const result = validateNumber('42', {
 *   min: 0,
 *   max: 100,
 *   integer: true
 * });
 * ```
 */
export const validateNumber = (
  input: any,
  options: NumberValidationOptions = {},
  fieldName = 'field'
): ValidationResult<number> => {
  const { min, max, integer = false, positive = false } = options;

  // Parse number
  const value = typeof input === 'number' ? input : parseFloat(input);

  if (isNaN(value)) {
    return {
      isValid: false,
      errors: [new ValidationError('Input must be a valid number', fieldName, 'INVALID_NUMBER')],
    };
  }

  // Integer check
  if (integer && !Number.isInteger(value)) {
    return {
      isValid: false,
      errors: [new ValidationError('Input must be an integer', fieldName, 'NOT_INTEGER')],
    };
  }

  // Positive check
  if (positive && value <= 0) {
    return {
      isValid: false,
      errors: [new ValidationError('Input must be positive', fieldName, 'NOT_POSITIVE')],
    };
  }

  // Range check
  if (min !== undefined && value < min) {
    return {
      isValid: false,
      errors: [
        new ValidationError(
          `Input must be at least ${min}`,
          fieldName,
          'BELOW_MINIMUM',
          { min, value }
        ),
      ],
    };
  }

  if (max !== undefined && value > max) {
    return {
      isValid: false,
      errors: [
        new ValidationError(
          `Input must not exceed ${max}`,
          fieldName,
          'ABOVE_MAXIMUM',
          { max, value }
        ),
      ],
    };
  }

  return {
    isValid: true,
    value,
  };
};

/**
 * EmailバリデーションUtility function for validating email addresses
 *
 * @example
 * ```typescript
 * const result = validateEmail('user@example.com');
 * ```
 */
export const validateEmail = (input: any, fieldName = 'email'): ValidationResult<string> => {
  if (typeof input !== 'string') {
    return {
      isValid: false,
      errors: [new ValidationError('Email must be a string', fieldName, 'INVALID_TYPE')],
    };
  }

  const trimmed = input.trim();

  if (!validator.isEmail(trimmed)) {
    return {
      isValid: false,
      errors: [new ValidationError('Invalid email format', fieldName, 'INVALID_EMAIL')],
    };
  }

  return {
    isValid: true,
    value: validator.normalizeEmail(trimmed) || trimmed,
  };
};

/**
 * URLバリデーション
 *
 * @example
 * ```typescript
 * const result = validateURL('https://example.com');
 * ```
 */
export const validateURL = (
  input: any,
  options: { protocols?: string[]; requireProtocol?: boolean } = {},
  fieldName = 'url'
): ValidationResult<string> => {
  const { protocols = ['http', 'https'], requireProtocol = true } = options;

  if (typeof input !== 'string') {
    return {
      isValid: false,
      errors: [new ValidationError('URL must be a string', fieldName, 'INVALID_TYPE')],
    };
  }

  const trimmed = input.trim();

  if (
    !validator.isURL(trimmed, {
      protocols,
      require_protocol: requireProtocol,
      require_valid_protocol: true,
    })
  ) {
    return {
      isValid: false,
      errors: [new ValidationError('Invalid URL format', fieldName, 'INVALID_URL')],
    };
  }

  return {
    isValid: true,
    value: trimmed,
  };
};

/**
 * SQLインジェクション検出
 *
 * @param input - 検査する文字列
 * @returns SQLインジェクションパターンが検出された場合true
 */
export const detectSQLInjection = (input: string): boolean => {
  return DANGEROUS_SQL_PATTERNS.some(pattern => pattern.test(input));
};

/**
 * XSS攻撃検出
 *
 * @param input - 検査する文字列
 * @returns XSS攻撃パターンが検出された場合true
 */
export const detectXSS = (input: string): boolean => {
  return DANGEROUS_XSS_PATTERNS.some(pattern => pattern.test(input));
};

/**
 * コマンドインジェクション検出
 *
 * @param input - 検査する文字列
 * @returns コマンドインジェクションパターンが検出された場合true
 */
export const detectCommandInjection = (input: string): boolean => {
  return DANGEROUS_COMMAND_PATTERNS.some(pattern => pattern.test(input));
};

/**
 * 安全な検索クエリバリデーション
 *
 * SQLインジェクション、XSS、コマンドインジェクションを検出
 *
 * @example
 * ```typescript
 * const result = validateSearchQuery("user's document");
 * if (result.isValid) {
 *   // Safe to use in search
 * }
 * ```
 */
export const validateSearchQuery = (
  input: any,
  fieldName = 'query'
): ValidationResult<string> => {
  // Basic string validation
  const stringResult = validateString(
    input,
    {
      minLength: 1,
      maxLength: 1000,
      trim: true,
    },
    fieldName
  );

  if (!stringResult.isValid) {
    return stringResult;
  }

  const value = stringResult.value!;

  // SQL Injection check
  if (detectSQLInjection(value)) {
    return {
      isValid: false,
      errors: [
        new ValidationError(
          'Query contains potential SQL injection pattern',
          fieldName,
          'SQL_INJECTION_DETECTED'
        ),
      ],
    };
  }

  // XSS check
  if (detectXSS(value)) {
    return {
      isValid: false,
      errors: [
        new ValidationError(
          'Query contains potential XSS attack pattern',
          fieldName,
          'XSS_DETECTED'
        ),
      ],
    };
  }

  // Command injection check
  if (detectCommandInjection(value)) {
    return {
      isValid: false,
      errors: [
        new ValidationError(
          'Query contains potential command injection pattern',
          fieldName,
          'COMMAND_INJECTION_DETECTED'
        ),
      ],
    };
  }

  return {
    isValid: true,
    value: validator.escape(value),  // HTML escape for safety
  };
};

/**
 * サニタイゼーション: HTMLエスケープ
 */
export const sanitizeHTML = (input: string): string => {
  return validator.escape(input);
};

/**
 * サニタイゼーション: SQLエスケープ（パラメータ化クエリを推奨）
 */
export const sanitizeSQL = (input: string): string => {
  return input.replace(/'/g, "''").replace(/\\/g, '\\\\');
};

/**
 * Express Middleware: Request body validation
 *
 * @example
 * ```typescript
 * app.post('/api/search',
 *   validateRequestBody({
 *     query: { type: 'string', required: true, maxLength: 500 },
 *     limit: { type: 'number', required: false, min: 1, max: 100 }
 *   }),
 *   searchController
 * );
 * ```
 */
export const validateRequestBody = (schema: Record<string, any>) => {
  return (req: any, res: any, next: any) => {
    const errors: ValidationError[] = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      // Required check
      if (rules.required && (value === undefined || value === null)) {
        errors.push(new ValidationError(`Field '${field}' is required`, field, 'REQUIRED'));
        continue;
      }

      // Skip validation if field is optional and not provided
      if (!rules.required && (value === undefined || value === null)) {
        continue;
      }

      // Type-specific validation
      let result: ValidationResult;

      switch (rules.type) {
        case 'string':
          result = validateString(value, rules, field);
          break;
        case 'number':
          result = validateNumber(value, rules, field);
          break;
        case 'email':
          result = validateEmail(value, field);
          break;
        case 'url':
          result = validateURL(value, rules, field);
          break;
        case 'searchQuery':
          result = validateSearchQuery(value, field);
          break;
        default:
          result = { isValid: true };
      }

      if (!result.isValid && result.errors) {
        errors.push(...result.errors);
      } else if (result.value !== undefined) {
        // Update request body with validated/sanitized value
        req.body[field] = result.value;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Request validation failed',
        details: errors.map(e => ({
          field: e.field,
          message: e.message,
          code: e.code,
        })),
      });
    }

    next();
  };
};

/**
 * Express Middleware: Query parameter validation
 */
export const validateQueryParams = (schema: Record<string, any>) => {
  return (req: any, res: any, next: any) => {
    const errors: ValidationError[] = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.query[field];

      // Similar validation logic as validateRequestBody
      if (rules.required && !value) {
        errors.push(new ValidationError(`Query parameter '${field}' is required`, field, 'REQUIRED'));
        continue;
      }

      if (!rules.required && !value) {
        continue;
      }

      let result: ValidationResult;

      switch (rules.type) {
        case 'string':
          result = validateString(value, rules, field);
          break;
        case 'number':
          result = validateNumber(value, rules, field);
          break;
        case 'searchQuery':
          result = validateSearchQuery(value, field);
          break;
        default:
          result = { isValid: true };
      }

      if (!result.isValid && result.errors) {
        errors.push(...result.errors);
      } else if (result.value !== undefined) {
        req.query[field] = result.value;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Query parameter validation failed',
        details: errors.map(e => ({
          field: e.field,
          message: e.message,
          code: e.code,
        })),
      });
    }

    next();
  };
};
