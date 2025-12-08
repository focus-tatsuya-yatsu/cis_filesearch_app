/**
 * Mounted FileSystem Adapter
 * OSレベルでマウント済みのファイルシステム（NFS/SMB等）へのアクセスを提供
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { FileMetadata, FileStats } from '@/types';
import { BaseFileSystemAdapter } from './FileSystemAdapter';
import mime from 'mime-types';

/**
 * MountedFileSystemAdapter Configuration
 */
export interface MountedFileSystemConfig {
  /**
   * マウントポイントのベースパス
   */
  mountPath: string;

  /**
   * 接続確認用のテストファイルパス（オプション）
   */
  testFilePath?: string;

  /**
   * リトライ設定
   */
  retryOptions?: {
    maxRetries: number;
    retryDelay: number;
  };
}

/**
 * MountedFileSystemAdapter
 * マウント済みファイルシステムへのアクセス実装
 */
export class MountedFileSystemAdapter extends BaseFileSystemAdapter {
  private readonly config: MountedFileSystemConfig;

  constructor(config: MountedFileSystemConfig) {
    super('MountedFileSystem');
    this.config = config;
  }

  /**
   * 接続を確立（マウント状態の確認）
   */
  async connect(): Promise<void> {
    try {
      // マウントポイントの存在確認
      const stats = await fs.stat(this.config.mountPath);
      if (!stats.isDirectory()) {
        throw new Error(`Mount path is not a directory: ${this.config.mountPath}`);
      }

      // テストファイルが指定されていれば存在確認
      if (this.config.testFilePath) {
        const testPath = this.resolvePath(this.config.testFilePath);
        const exists = await this.exists(testPath);
        if (!exists) {
          throw new Error(`Test file not found: ${testPath}`);
        }
      }

      this.connected = true;
      console.log(`Connected to mounted filesystem at: ${this.config.mountPath}`);
    } catch (error) {
      this.connected = false;
      throw this.handleError(error, 'Connection failed');
    }
  }

  /**
   * 接続を切断
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    console.log('Disconnected from mounted filesystem');
  }

  /**
   * ファイル/ディレクトリの存在確認
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      await fs.access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ファイルの詳細情報を取得
   */
  async stat(filePath: string): Promise<FileStats> {
    const resolvedPath = this.resolvePath(filePath);
    const stats = await fs.stat(resolvedPath);

    return {
      size: stats.size,
      mtime: stats.mtime,
      ctime: stats.ctime,
      atime: stats.atime,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymbolicLink: stats.isSymbolicLink()
    };
  }

  /**
   * ディレクトリ内のファイル一覧を取得
   */
  async readdir(dirPath: string): Promise<string[]> {
    const resolvedPath = this.resolvePath(dirPath);
    return await fs.readdir(resolvedPath);
  }

  /**
   * ファイルのメタデータを取得
   */
  async getMetadata(filePath: string): Promise<FileMetadata> {
    const resolvedPath = this.resolvePath(filePath);
    const stats = await fs.stat(resolvedPath);
    const name = path.basename(filePath);

    // MIMEタイプの判定
    let mimeType = 'application/octet-stream';
    if (stats.isDirectory()) {
      mimeType = 'inode/directory';
    } else {
      const detected = mime.lookup(name);
      if (detected) {
        mimeType = detected;
      }
    }

    return {
      path: filePath,
      name: name,
      size: stats.size,
      mimeType: mimeType,
      modifiedAt: stats.mtime,
      createdAt: stats.birthtime,
      isDirectory: stats.isDirectory()
    };
  }

  /**
   * ファイルをストリームとして読み込み
   */
  async createReadStream(filePath: string): Promise<Readable> {
    const resolvedPath = this.resolvePath(filePath);

    // ファイルの存在確認
    if (!(await this.exists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    return createReadStream(resolvedPath);
  }

  /**
   * ファイルの内容を読み込み
   */
  async readFile(filePath: string): Promise<Buffer> {
    const resolvedPath = this.resolvePath(filePath);
    return await fs.readFile(resolvedPath);
  }

  /**
   * ファイルのチェックサムを計算
   */
  async calculateChecksum(filePath: string): Promise<string> {
    const resolvedPath = this.resolvePath(filePath);
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(resolvedPath);

    await pipeline(stream, hash);
    return hash.digest('hex');
  }

  /**
   * パスがディレクトリかどうか判定
   */
  async isDirectory(filePath: string): Promise<boolean> {
    try {
      const stats = await this.stat(filePath);
      return stats.isDirectory;
    } catch {
      return false;
    }
  }

  /**
   * パスがファイルかどうか判定
   */
  async isFile(filePath: string): Promise<boolean> {
    try {
      const stats = await this.stat(filePath);
      return stats.isFile;
    } catch {
      return false;
    }
  }

  /**
   * ファイルサイズを取得
   */
  async getFileSize(filePath: string): Promise<number> {
    const stats = await this.stat(filePath);
    return stats.size;
  }

  /**
   * パスの解決（相対パスを絶対パスに変換）
   */
  private resolvePath(filePath: string): string {
    // 絶対パスの場合はそのまま返す
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    // 相対パスの場合はマウントパスからの相対パスとして解決
    return path.join(this.config.mountPath, filePath);
  }

  /**
   * リトライ機能付きの操作実行
   * @internal - Currently unused but kept for future retry functionality
   */
  // @ts-expect-error - Unused but kept for future implementation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const { maxRetries = 3, retryDelay = 1000 } = this.config.retryOptions || {};
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          console.warn(
            `${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`
          );
          await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
        }
      }
    }

    throw new Error(`${operationName} failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
  }
}