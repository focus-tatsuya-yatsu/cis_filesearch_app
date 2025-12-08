/**
 * Mock FileSystem Adapter
 * ユニットテスト用のモックファイルシステムアダプター
 */

import { Readable } from 'stream';
import * as crypto from 'crypto';
import { FileMetadata, FileStats } from '@/types';
import { BaseFileSystemAdapter } from './FileSystemAdapter';

/**
 * モックファイルエントリー
 */
interface MockFileEntry {
  path: string;
  content?: Buffer;
  metadata: FileMetadata;
  stats: FileStats;
}

/**
 * MockFileSystemAdapter Configuration
 */
export interface MockFileSystemConfig {
  /**
   * 初期ファイル/ディレクトリ構造
   */
  initialFiles?: MockFileEntry[];

  /**
   * エラーをシミュレートするパス
   */
  errorPaths?: string[];

  /**
   * 遅延をシミュレート（ミリ秒）
   */
  simulateDelay?: number;

  /**
   * 接続失敗をシミュレート
   */
  simulateConnectionFailure?: boolean;
}

/**
 * MockFileSystemAdapter
 * ユニットテスト用のメモリ内ファイルシステムアダプター
 */
export class MockFileSystemAdapter extends BaseFileSystemAdapter {
  private files: Map<string, MockFileEntry> = new Map();
  private readonly config: MockFileSystemConfig;
  private connectionAttempts = 0;

  constructor(config: MockFileSystemConfig = {}) {
    super('MockFileSystem');
    this.config = config;

    // 初期ファイルをセットアップ
    if (config.initialFiles) {
      for (const file of config.initialFiles) {
        this.files.set(file.path, file);
      }
    }
  }

  /**
   * 接続を確立（モック）
   */
  async connect(): Promise<void> {
    this.connectionAttempts++;

    if (this.config.simulateConnectionFailure) {
      throw new Error('Mock connection failed');
    }

    await this.simulateDelay();
    this.connected = true;
    console.log('Mock filesystem connected');
  }

  /**
   * 接続を切断（モック）
   */
  async disconnect(): Promise<void> {
    await this.simulateDelay();
    this.connected = false;
    console.log('Mock filesystem disconnected');
  }

  /**
   * ファイル/ディレクトリの存在確認
   */
  async exists(path: string): Promise<boolean> {
    await this.simulateDelay();
    this.checkError(path);
    return this.files.has(path);
  }

  /**
   * ファイルの詳細情報を取得
   */
  async stat(path: string): Promise<FileStats> {
    await this.simulateDelay();
    this.checkError(path);

    const entry = this.files.get(path);
    if (!entry) {
      throw new Error(`File not found: ${path}`);
    }

    return entry.stats;
  }

  /**
   * ディレクトリ内のファイル一覧を取得
   */
  async readdir(dirPath: string): Promise<string[]> {
    await this.simulateDelay();
    this.checkError(dirPath);

    const items: string[] = [];
    const dirPathWithSlash = dirPath.endsWith('/') ? dirPath : dirPath + '/';

    for (const [filePath] of this.files) {
      // 直接の子要素のみを返す
      if (filePath.startsWith(dirPathWithSlash)) {
        const relativePath = filePath.substring(dirPathWithSlash.length);
        const firstSlash = relativePath.indexOf('/');

        if (firstSlash === -1) {
          // ファイル（直接の子）
          items.push(relativePath);
        } else {
          // ディレクトリ（最初のセグメントのみ）
          const dirName = relativePath.substring(0, firstSlash);
          if (!items.includes(dirName)) {
            items.push(dirName);
          }
        }
      }
    }

    return items;
  }

  /**
   * ファイルのメタデータを取得
   */
  async getMetadata(path: string): Promise<FileMetadata> {
    await this.simulateDelay();
    this.checkError(path);

    const entry = this.files.get(path);
    if (!entry) {
      throw new Error(`File not found: ${path}`);
    }

    return entry.metadata;
  }

  /**
   * ファイルをストリームとして読み込み
   */
  async createReadStream(path: string): Promise<Readable> {
    await this.simulateDelay();
    this.checkError(path);

    const entry = this.files.get(path);
    if (!entry) {
      throw new Error(`File not found: ${path}`);
    }

    if (entry.metadata.isDirectory) {
      throw new Error(`Cannot read directory as stream: ${path}`);
    }

    const content = entry.content || Buffer.from('');
    return Readable.from(content);
  }

  /**
   * ファイルの内容を読み込み
   */
  async readFile(path: string): Promise<Buffer> {
    await this.simulateDelay();
    this.checkError(path);

    const entry = this.files.get(path);
    if (!entry) {
      throw new Error(`File not found: ${path}`);
    }

    if (entry.metadata.isDirectory) {
      throw new Error(`Cannot read directory: ${path}`);
    }

    return entry.content || Buffer.from('');
  }

  /**
   * ファイルのチェックサムを計算
   */
  async calculateChecksum(path: string): Promise<string> {
    await this.simulateDelay();
    this.checkError(path);

    const content = await this.readFile(path);
    const hash = crypto.createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
  }

  /**
   * パスがディレクトリかどうか判定
   */
  async isDirectory(path: string): Promise<boolean> {
    await this.simulateDelay();
    this.checkError(path);

    const entry = this.files.get(path);
    return entry ? entry.metadata.isDirectory : false;
  }

  /**
   * パスがファイルかどうか判定
   */
  async isFile(path: string): Promise<boolean> {
    await this.simulateDelay();
    this.checkError(path);

    const entry = this.files.get(path);
    return entry ? !entry.metadata.isDirectory : false;
  }

  /**
   * ファイルサイズを取得
   */
  async getFileSize(path: string): Promise<number> {
    await this.simulateDelay();
    this.checkError(path);

    const entry = this.files.get(path);
    if (!entry) {
      throw new Error(`File not found: ${path}`);
    }

    return entry.metadata.size;
  }

  // ========================================
  // テストヘルパーメソッド
  // ========================================

  /**
   * ファイルを追加（テスト用）
   */
  addFile(path: string, content: string | Buffer, metadata?: Partial<FileMetadata>): void {
    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    const now = new Date();

    const entry: MockFileEntry = {
      path,
      content: buffer,
      metadata: {
        path,
        name: path.split('/').pop() || '',
        size: buffer.length,
        mimeType: 'application/octet-stream',
        modifiedAt: now,
        createdAt: now,
        isDirectory: false,
        ...metadata
      },
      stats: {
        size: buffer.length,
        mtime: now,
        ctime: now,
        atime: now,
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false
      }
    };

    this.files.set(path, entry);
  }

  /**
   * ディレクトリを追加（テスト用）
   */
  addDirectory(path: string, metadata?: Partial<FileMetadata>): void {
    const now = new Date();

    const entry: MockFileEntry = {
      path,
      metadata: {
        path,
        name: path.split('/').pop() || '',
        size: 0,
        mimeType: 'inode/directory',
        modifiedAt: now,
        createdAt: now,
        isDirectory: true,
        ...metadata
      },
      stats: {
        size: 0,
        mtime: now,
        ctime: now,
        atime: now,
        isFile: false,
        isDirectory: true,
        isSymbolicLink: false
      }
    };

    this.files.set(path, entry);
  }

  /**
   * ファイルを削除（テスト用）
   */
  removeFile(path: string): void {
    this.files.delete(path);
  }

  /**
   * すべてのファイルをクリア（テスト用）
   */
  clear(): void {
    this.files.clear();
  }

  /**
   * 接続試行回数を取得（テスト用）
   */
  getConnectionAttempts(): number {
    return this.connectionAttempts;
  }

  /**
   * ファイル数を取得（テスト用）
   */
  getFileCount(): number {
    return this.files.size;
  }

  /**
   * ファイルの存在を確認（同期版、テスト用）
   */
  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  // ========================================
  // プライベートヘルパー
  // ========================================

  /**
   * 遅延をシミュレート
   */
  private async simulateDelay(): Promise<void> {
    if (this.config.simulateDelay) {
      await new Promise(resolve => setTimeout(resolve, this.config.simulateDelay));
    }
  }

  /**
   * エラーをチェック
   */
  private checkError(path: string): void {
    if (this.config.errorPaths?.includes(path)) {
      throw new Error(`Simulated error for path: ${path}`);
    }
  }
}