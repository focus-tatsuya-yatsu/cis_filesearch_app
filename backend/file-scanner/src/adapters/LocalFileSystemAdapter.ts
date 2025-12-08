/**
 * Local FileSystem Adapter
 * ローカル開発・テスト用のファイルシステムアダプター
 */

import { MountedFileSystemAdapter } from './MountedFileSystemAdapter';

/**
 * LocalFileSystemAdapter Configuration
 */
export interface LocalFileSystemConfig {
  /**
   * ローカルファイルシステムのベースパス
   */
  basePath: string;

  /**
   * テスト用のサンドボックスモード
   * true の場合、ベースパス外へのアクセスを制限
   */
  sandboxMode?: boolean;
}

/**
 * LocalFileSystemAdapter
 * ローカル開発環境用のファイルシステムアダプター
 * MountedFileSystemAdapterを継承し、開発用の機能を追加
 */
export class LocalFileSystemAdapter extends MountedFileSystemAdapter {
  private readonly sandboxMode: boolean;
  private readonly basePath: string;

  constructor(config: LocalFileSystemConfig) {
    // MountedFileSystemAdapterの設定を作成
    super({
      mountPath: config.basePath,
      testFilePath: undefined,
      retryOptions: {
        maxRetries: 1,
        retryDelay: 100
      }
    });

    this.basePath = config.basePath;
    this.sandboxMode = config.sandboxMode || false;
    // Note: this.name is inherited from BaseFileSystemAdapter and cannot be changed
  }

  /**
   * 接続を確立（ローカルディレクトリの確認）
   */
  async connect(): Promise<void> {
    console.log(`Connecting to local filesystem at: ${this.basePath}`);
    console.log(`Sandbox mode: ${this.sandboxMode ? 'ENABLED' : 'DISABLED'}`);

    await super.connect();

    console.log('Successfully connected to local filesystem');
  }

  /**
   * 開発用: テストデータのセットアップ
   */
  async setupTestData(): Promise<void> {
    const fs = require('fs/promises');
    const path = require('path');

    console.log('Setting up test data...');

    // テスト用ディレクトリ構造を作成
    const testDirs = [
      'documents',
      'documents/pdf',
      'documents/docx',
      'images',
      'images/photos',
      'images/screenshots',
      'videos',
      'archives'
    ];

    for (const dir of testDirs) {
      const dirPath = path.join(this.basePath, dir);
      await fs.mkdir(dirPath, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }

    // テスト用ファイルを作成
    const testFiles = [
      { path: 'README.md', content: '# Test Data\n\nThis is test data for the file scanner.' },
      { path: 'documents/report.txt', content: 'Annual Report 2024\n\nTest content...' },
      { path: 'documents/pdf/sample.pdf.txt', content: '[PDF placeholder file]' },
      { path: 'images/test.jpg.txt', content: '[JPG placeholder file]' },
      { path: '.hidden_file', content: 'Hidden file content' }
    ];

    for (const file of testFiles) {
      const filePath = path.join(this.basePath, file.path);
      await fs.writeFile(filePath, file.content);
      console.log(`Created file: ${file.path}`);
    }

    console.log('Test data setup complete');
  }

  /**
   * 開発用: テストデータのクリーンアップ
   */
  async cleanupTestData(): Promise<void> {
    const fs = require('fs/promises');

    console.log('Cleaning up test data...');

    try {
      // ベースディレクトリの中身を削除（ベースディレクトリ自体は残す）
      const items = await fs.readdir(this.basePath);

      for (const item of items) {
        const itemPath = require('path').join(this.basePath, item);
        const stats = await fs.stat(itemPath);

        if (stats.isDirectory()) {
          await fs.rm(itemPath, { recursive: true, force: true });
        } else {
          await fs.unlink(itemPath);
        }

        console.log(`Removed: ${item}`);
      }

      console.log('Test data cleanup complete');
    } catch (error) {
      console.error('Error during cleanup:', error);
      throw error;
    }
  }

  /**
   * 開発用: 統計情報の取得
   */
  async getStatistics(): Promise<{
    totalFiles: number;
    totalDirectories: number;
    totalSize: number;
    fileTypes: Map<string, number>;
  }> {
    let totalFiles = 0;
    let totalDirectories = 0;
    let totalSize = 0;
    const fileTypes = new Map<string, number>();

    const scanOptions = {
      fileFilter: () => true,
      onError: (error: Error, path: string) => {
        console.warn(`Error scanning ${path}: ${error.message}`);
      }
    };

    for await (const metadata of this.scanDirectory('', scanOptions)) {
      if (metadata.isDirectory) {
        totalDirectories++;
      } else {
        totalFiles++;
        totalSize += metadata.size;

        // 拡張子別にカウント
        const ext = require('path').extname(metadata.name).toLowerCase();
        if (ext) {
          fileTypes.set(ext, (fileTypes.get(ext) || 0) + 1);
        }
      }
    }

    return {
      totalFiles,
      totalDirectories,
      totalSize,
      fileTypes
    };
  }
}