/**
 * Secure File Operations Wrapper
 *
 * このモジュールは、Path Traversal保護が統合されたファイル操作ユーティリティを提供します。
 * すべてのファイルシステム操作をこのモジュール経由で行うことで、セキュリティを保証します。
 */

import { readFile, writeFile, stat, readdir } from 'fs/promises';
import { join } from 'path';
import { validatePath, sanitizeFilename, type PathValidationOptions } from './pathValidator';
import type { FileSystemAdapter } from '../adapters/FileSystemAdapter';

export interface SecureFileOperationConfig {
  baseDir: string;
  allowSymlinks?: boolean;
  maxPathLength?: number;
}

/**
 * セキュアなファイル操作クラス
 *
 * @example
 * ```typescript
 * const secureOps = new SecureFileOperations({
 *   baseDir: '/var/www/uploads'
 * });
 *
 * // 安全なファイル読み込み
 * const content = await secureOps.readFile('document.txt');
 *
 * // 安全なファイル書き込み
 * await secureOps.writeFile('output.txt', 'content');
 * ```
 */
export class SecureFileOperations {
  private readonly config: Required<SecureFileOperationConfig>;

  constructor(config: SecureFileOperationConfig) {
    this.config = {
      baseDir: config.baseDir,
      allowSymlinks: config.allowSymlinks ?? false,
      maxPathLength: config.maxPathLength ?? 4096,
    };
  }

  /**
   * パスを検証して正規化
   */
  private async validateAndNormalize(inputPath: string): Promise<string> {
    const validationOptions: PathValidationOptions = {
      allowedBaseDir: this.config.baseDir,
      allowSymlinks: this.config.allowSymlinks,
      maxPathLength: this.config.maxPathLength,
    };

    const result = await validatePath(inputPath, validationOptions);

    if (!result.isValid) {
      throw new Error(`Path validation failed: ${result.error} (${result.errorCode})`);
    }

    return result.normalizedPath!;
  }

  /**
   * 安全なファイル読み込み
   *
   * @param filePath - 読み込むファイルのパス（相対または絶対）
   * @returns ファイル内容
   * @throws パス検証失敗時またはファイル読み込み失敗時
   */
  async readFile(filePath: string): Promise<string> {
    const validatedPath = await this.validateAndNormalize(filePath);
    return await readFile(validatedPath, 'utf-8');
  }

  /**
   * 安全なファイル書き込み
   *
   * @param filePath - 書き込むファイルのパス
   * @param content - ファイル内容
   * @throws パス検証失敗時またはファイル書き込み失敗時
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const validatedPath = await this.validateAndNormalize(filePath);
    await writeFile(validatedPath, content, 'utf-8');
  }

  /**
   * 安全なファイル情報取得
   *
   * @param filePath - ファイルのパス
   * @returns ファイル統計情報
   */
  async getFileInfo(filePath: string) {
    const validatedPath = await this.validateAndNormalize(filePath);
    return await stat(validatedPath);
  }

  /**
   * 安全なディレクトリリスト取得
   *
   * @param dirPath - ディレクトリのパス
   * @returns ファイル/ディレクトリ名の配列
   */
  async listDirectory(dirPath: string): Promise<string[]> {
    const validatedPath = await this.validateAndNormalize(dirPath);
    return await readdir(validatedPath);
  }

  /**
   * 安全なパス結合
   *
   * @param paths - 結合するパス
   * @returns 検証済みの安全なパス
   */
  async safePath(...paths: string[]): Promise<string> {
    const sanitizedPaths = paths.map(p => sanitizeFilename(p));
    const joinedPath = join(...sanitizedPaths);
    return await this.validateAndNormalize(joinedPath);
  }

  /**
   * FileSystemAdapterとの統合
   *
   * FileSystemAdapterのメソッドをセキュアにラップ
   */
  static wrapAdapter(adapter: FileSystemAdapter, baseDir: string): SecureFileSystemAdapter {
    return new SecureFileSystemAdapter(adapter, baseDir);
  }
}

/**
 * セキュアなFileSystemAdapterラッパー
 *
 * 既存のFileSystemAdapterにPath Traversal保護を追加
 */
export class SecureFileSystemAdapter {
  private readonly secureOps: SecureFileOperations;

  constructor(
    private readonly adapter: FileSystemAdapter,
    baseDir: string
  ) {
    this.secureOps = new SecureFileOperations({ baseDir });
  }

  /**
   * 安全なファイル読み込み（アダプター経由）
   */
  async readFile(filePath: string): Promise<string> {
    // パス検証
    const validatedPath = await this.validatePath(filePath);

    // アダプター経由で読み込み
    const metadata = await this.adapter.getMetadata(validatedPath);

    if (!metadata) {
      throw new Error(`File not found: ${filePath}`);
    }

    // 実際の読み込みはSecureFileOperations経由
    return await this.secureOps.readFile(validatedPath);
  }

  /**
   * 安全なディレクトリスキャン（アダプター経由）
   */
  async *scanDirectory(
    dirPath: string,
    options?: {
      fileFilter?: (metadata: any) => boolean;
      onError?: (error: Error, path: string) => void;
    }
  ): AsyncGenerator<any> {
    // パス検証
    const validatedPath = await this.validatePath(dirPath);

    // アダプター経由でスキャン
    for await (const metadata of this.adapter.scanDirectory(validatedPath, options)) {
      // 各ファイルパスも検証
      try {
        await this.validatePath(metadata.path);
        yield metadata;
      } catch (error) {
        options?.onError?.(error as Error, metadata.path);
      }
    }
  }

  /**
   * 内部: パス検証
   */
  private async validatePath(filePath: string): Promise<string> {
    const result = await validatePath(filePath, {
      allowedBaseDir: this.adapter.getBasePath?.() || '/tmp',
      allowSymlinks: false,
    });

    if (!result.isValid) {
      throw new Error(`Invalid path: ${result.error} (${result.errorCode})`);
    }

    return result.normalizedPath!;
  }
}

/**
 * Express Middleware: FileSystemAdapterのパス検証
 *
 * @example
 * ```typescript
 * app.use('/api/files', createSecureAdapterMiddleware(adapter, '/mnt/nas'));
 * ```
 */
export const createSecureAdapterMiddleware = (
  adapter: FileSystemAdapter,
  baseDir: string
) => {
  const secureAdapter = SecureFileOperations.wrapAdapter(adapter, baseDir);

  return (req: any, _res: any, next: any) => {
    // リクエストにセキュアなアダプターを注入
    req.secureAdapter = secureAdapter;
    next();
  };
};
