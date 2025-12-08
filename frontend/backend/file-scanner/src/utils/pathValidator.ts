import { resolve, normalize, relative } from 'path';
import { stat } from 'fs/promises';

/**
 * Path Traversal Attack Protection Utility
 *
 * このモジュールはパストラバーサル攻撃を防ぐためのバリデーション機能を提供します。
 * OWASP Top 10 2021 - A01: Broken Access Control対策
 */

export interface PathValidationOptions {
  /** 許可するベースディレクトリ（絶対パス） */
  allowedBaseDir: string;
  /** シンボリックリンクを許可するか */
  allowSymlinks?: boolean;
  /** 最大パス長 */
  maxPathLength?: number;
  /** 許可する文字パターン（正規表現） */
  allowedCharactersPattern?: RegExp;
}

export interface PathValidationResult {
  isValid: boolean;
  normalizedPath?: string;
  error?: string;
  errorCode?: string;
}

/**
 * 危険なパスパターンを検出
 */
const DANGEROUS_PATTERNS = [
  /\.\./,                    // Parent directory traversal
  /^\/etc/i,                 // System directories
  /^\/proc/i,
  /^\/sys/i,
  /^\/dev/i,
  /^\/var\/log/i,
  /^C:\\Windows/i,           // Windows system directories
  /^C:\\Program Files/i,
  /\0/,                      // Null byte injection
  /[<>:"|?*]/,              // Invalid filename characters (Windows)
  /^\s|\s$/,                 // Leading/trailing whitespace
];

/**
 * パスが安全かどうかを検証
 *
 * @param inputPath - ユーザー入力のパス
 * @param options - バリデーションオプション
 * @returns 検証結果
 *
 * @example
 * ```typescript
 * const result = await validatePath('/uploads/file.txt', {
 *   allowedBaseDir: '/var/www/uploads',
 *   allowSymlinks: false
 * });
 *
 * if (result.isValid) {
 *   // Use result.normalizedPath safely
 * }
 * ```
 */
export const validatePath = async (
  inputPath: string,
  options: PathValidationOptions
): Promise<PathValidationResult> => {
  const {
    allowedBaseDir,
    allowSymlinks = false,
    maxPathLength = 4096,
    allowedCharactersPattern = /^[a-zA-Z0-9._\-\/\\]+$/,
  } = options;

  // 1. 基本的なバリデーション
  if (!inputPath || typeof inputPath !== 'string') {
    return {
      isValid: false,
      error: 'Path must be a non-empty string',
      errorCode: 'INVALID_INPUT',
    };
  }

  // 2. パス長チェック
  if (inputPath.length > maxPathLength) {
    return {
      isValid: false,
      error: `Path exceeds maximum length of ${maxPathLength}`,
      errorCode: 'PATH_TOO_LONG',
    };
  }

  // 3. 危険なパターンチェック
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(inputPath)) {
      return {
        isValid: false,
        error: `Path contains dangerous pattern: ${pattern}`,
        errorCode: 'DANGEROUS_PATTERN',
      };
    }
  }

  // 4. 許可文字チェック
  if (!allowedCharactersPattern.test(inputPath)) {
    return {
      isValid: false,
      error: 'Path contains invalid characters',
      errorCode: 'INVALID_CHARACTERS',
    };
  }

  try {
    // 5. パスの正規化
    const normalizedInput = normalize(inputPath);
    const normalizedBase = normalize(allowedBaseDir);

    // 6. 絶対パスに解決
    const resolvedPath = resolve(normalizedBase, normalizedInput);

    // 7. ベースディレクトリ内にあることを確認
    const relativePath = relative(normalizedBase, resolvedPath);

    if (relativePath.startsWith('..') || resolve(normalizedBase, relativePath) !== resolvedPath) {
      return {
        isValid: false,
        error: 'Path escapes allowed base directory',
        errorCode: 'PATH_TRAVERSAL_ATTEMPT',
      };
    }

    // 8. ファイルシステム上の存在確認とシンボリックリンクチェック
    try {
      const stats = await stat(resolvedPath);

      if (!allowSymlinks && stats.isSymbolicLink()) {
        return {
          isValid: false,
          error: 'Symbolic links are not allowed',
          errorCode: 'SYMLINK_NOT_ALLOWED',
        };
      }
    } catch (fsError) {
      // ファイルが存在しない場合は許可（新規作成の可能性）
      // ただし、ディレクトリトラバーサルは既に防いでいる
    }

    return {
      isValid: true,
      normalizedPath: resolvedPath,
    };
  } catch (error) {
    return {
      isValid: false,
      error: `Path validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      errorCode: 'VALIDATION_ERROR',
    };
  }
};

/**
 * Express middleware: Path validation for request parameters
 *
 * @example
 * ```typescript
 * app.use('/api/files', pathValidationMiddleware({
 *   paramName: 'filePath',
 *   allowedBaseDir: '/var/www/uploads'
 * }));
 * ```
 */
export const createPathValidationMiddleware = (options: PathValidationOptions & { paramName?: string }) => {
  const { paramName = 'path', ...validationOptions } = options;

  return async (req: any, res: any, next: any) => {
    const inputPath = req.query[paramName] || req.body[paramName] || req.params[paramName];

    if (!inputPath) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Missing required parameter: ${paramName}`,
        code: 'MISSING_PATH',
      });
    }

    const result = await validatePath(inputPath, validationOptions);

    if (!result.isValid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: result.error,
        code: result.errorCode,
      });
    }

    // 正規化されたパスをリクエストに追加
    req.validatedPath = result.normalizedPath;
    next();
  };
};

/**
 * サニタイズされたファイル名を生成
 *
 * @param filename - 元のファイル名
 * @returns サニタイズされたファイル名
 */
export const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^a-zA-Z0-9._\-]/g, '_')  // Invalid characters to underscore
    .replace(/^\.+/, '')                 // Remove leading dots
    .replace(/\.+/g, '.')                // Multiple dots to single dot
    .substring(0, 255);                  // Limit length
};

/**
 * 安全なパス結合
 *
 * @param base - ベースディレクトリ
 * @param paths - 結合するパス
 * @returns 安全に結合されたパス
 */
export const safePath = (base: string, ...paths: string[]): string => {
  const sanitizedPaths = paths.map(p => sanitizeFilename(p));
  return resolve(base, ...sanitizedPaths);
};
