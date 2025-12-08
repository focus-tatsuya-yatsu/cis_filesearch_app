/**
 * FileSystem Abstraction Layer
 * プロトコルに依存しないファイルシステムアクセスを提供
 */

import { FileMetadata, FileStats } from '@/types';
import { Readable } from 'stream';

/**
 * FileSystemAdapter Interface
 * 各種ファイルシステム（NFS, SMB, ローカル等）の共通インターフェース
 */
export interface FileSystemAdapter {
  /**
   * アダプター名を取得
   */
  getName(): string;

  /**
   * 接続を確立
   */
  connect(): Promise<void>;

  /**
   * 接続を切断
   */
  disconnect(): Promise<void>;

  /**
   * 接続状態を確認
   */
  isConnected(): boolean;

  /**
   * ファイル/ディレクトリの存在確認
   */
  exists(path: string): Promise<boolean>;

  /**
   * ファイルの詳細情報を取得
   */
  stat(path: string): Promise<FileStats>;

  /**
   * ディレクトリ内のファイル一覧を取得
   */
  readdir(path: string): Promise<string[]>;

  /**
   * ファイルのメタデータを取得
   */
  getMetadata(path: string): Promise<FileMetadata>;

  /**
   * ファイルをストリームとして読み込み
   */
  createReadStream(path: string): Promise<Readable>;

  /**
   * ファイルの内容を読み込み（小さいファイル用）
   */
  readFile(path: string): Promise<Buffer>;

  /**
   * ファイルのチェックサムを計算
   */
  calculateChecksum(path: string): Promise<string>;

  /**
   * パスがディレクトリかどうか判定
   */
  isDirectory(path: string): Promise<boolean>;

  /**
   * パスがファイルかどうか判定
   */
  isFile(path: string): Promise<boolean>;

  /**
   * ファイルサイズを取得
   */
  getFileSize(path: string): Promise<number>;

  /**
   * 再帰的にディレクトリをスキャン
   */
  scanDirectory(
    path: string,
    options?: ScanOptions
  ): AsyncGenerator<FileMetadata>;
}

/**
 * スキャンオプション
 */
export interface ScanOptions {
  /**
   * 除外パターン（glob形式）
   */
  excludePatterns?: string[];

  /**
   * 最大深度
   */
  maxDepth?: number;

  /**
   * ファイルフィルター関数
   */
  fileFilter?: (metadata: FileMetadata) => boolean;

  /**
   * エラーハンドラー
   */
  onError?: (error: Error, path: string) => void;

  /**
   * 進捗コールバック
   */
  onProgress?: (current: number, path: string) => void;
}

/**
 * FileSystemAdapter基底クラス
 * 共通機能を実装
 */
export abstract class BaseFileSystemAdapter implements FileSystemAdapter {
  protected connected: boolean = false;
  protected readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }

  isConnected(): boolean {
    return this.connected;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract exists(path: string): Promise<boolean>;
  abstract stat(path: string): Promise<FileStats>;
  abstract readdir(path: string): Promise<string[]>;
  abstract getMetadata(path: string): Promise<FileMetadata>;
  abstract createReadStream(path: string): Promise<Readable>;
  abstract readFile(path: string): Promise<Buffer>;
  abstract calculateChecksum(path: string): Promise<string>;
  abstract isDirectory(path: string): Promise<boolean>;
  abstract isFile(path: string): Promise<boolean>;
  abstract getFileSize(path: string): Promise<number>;

  /**
   * 共通のディレクトリスキャン実装
   */
  async *scanDirectory(
    basePath: string,
    options: ScanOptions = {}
  ): AsyncGenerator<FileMetadata> {
    const {
      excludePatterns = [],
      maxDepth = Infinity,
      fileFilter,
      onError,
      onProgress
    } = options;

    let scannedCount = 0;

    const shouldExclude = (path: string): boolean => {
      // 除外パターンのチェック実装
      return excludePatterns.some(pattern => {
        // 簡単なワイルドカードマッチング
        const regex = new RegExp(
          '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        );
        return regex.test(path);
      });
    };

    const scanRecursive = async function* (
      this: BaseFileSystemAdapter,
      currentPath: string,
      currentDepth: number
    ): AsyncGenerator<FileMetadata> {
      if (currentDepth > maxDepth) return;

      try {
        const items = await this.readdir(currentPath);

        for (const item of items) {
          const fullPath = `${currentPath}/${item}`.replace(/\/+/g, '/');

          if (shouldExclude(fullPath)) continue;

          try {
            const metadata = await this.getMetadata(fullPath);

            scannedCount++;
            if (onProgress) {
              onProgress(scannedCount, fullPath);
            }

            if (!fileFilter || fileFilter(metadata)) {
              yield metadata;
            }

            if (metadata.isDirectory && currentDepth < maxDepth) {
              yield* scanRecursive.call(this, fullPath, currentDepth + 1);
            }
          } catch (error) {
            if (onError) {
              onError(error as Error, fullPath);
            }
          }
        }
      } catch (error) {
        if (onError) {
          onError(error as Error, currentPath);
        }
      }
    }.bind(this);

    yield* scanRecursive(basePath, 0);
  }

  /**
   * エラーハンドリングヘルパー
   */
  protected handleError(error: unknown, context: string): Error {
    if (error instanceof Error) {
      error.message = `${context}: ${error.message}`;
      return error;
    }
    return new Error(`${context}: ${String(error)}`);
  }
}