/**
 * File Scanner Core Service
 * ファイルシステムをスキャンし、メタデータを収集する中核サービス
 */

import pLimit, { LimitFunction } from 'p-limit';
import { FileSystemAdapter } from '@/adapters';
import { FileMetadata, ScanResult, ScanError, ProgressCallback } from '@/types';
import { DatabaseManager } from './DatabaseManager';
import { ProgressTracker } from './ProgressTracker';
import { createLogger } from '@/utils/logger';

const logger = createLogger('FileScanner');

/**
 * FileScannerの設定
 */
export interface FileScannerConfig {
  /**
   * ファイルシステムアダプター
   */
  adapter: FileSystemAdapter;

  /**
   * データベースマネージャー
   */
  database: DatabaseManager;

  /**
   * 除外パターン（glob形式）
   */
  excludePatterns?: string[];

  /**
   * 最大ファイルサイズ（バイト）
   */
  maxFileSize?: number;

  /**
   * 並行処理数
   */
  concurrency?: number;

  /**
   * バッチサイズ（一度に処理するファイル数）
   */
  batchSize?: number;

  /**
   * 進捗コールバック
   */
  onProgress?: ProgressCallback;

  /**
   * ドライランモード
   */
  dryRun?: boolean;
}

/**
 * FileScanner
 * ファイルシステムをスキャンしてメタデータを収集
 */
export class FileScanner {
  private readonly config: FileScannerConfig;
  private readonly adapter: FileSystemAdapter;
  private readonly database: DatabaseManager;
  private readonly progressTracker: ProgressTracker;
  private readonly limit: LimitFunction;
  private isScanning: boolean = false;
  private scanAborted: boolean = false;

  constructor(config: FileScannerConfig) {
    this.config = config;
    this.adapter = config.adapter;
    this.database = config.database;
    this.limit = pLimit(config.concurrency || 10);

    this.progressTracker = new ProgressTracker({
      onProgress: config.onProgress
    });
  }

  /**
   * スキャンを開始
   */
  async startScan(rootPath: string): Promise<ScanResult> {
    if (this.isScanning) {
      throw new Error('Scan already in progress');
    }

    this.isScanning = true;
    this.scanAborted = false;

    logger.info(`Starting scan of: ${rootPath}`);
    const startTime = Date.now();

    try {
      // アダプターが接続されていない場合は接続
      if (!this.adapter.isConnected()) {
        await this.adapter.connect();
      }

      // ルートパスの存在確認
      if (!(await this.adapter.exists(rootPath))) {
        throw new Error(`Root path does not exist: ${rootPath}`);
      }

      // データベースを初期化
      await this.database.initialize();

      // 既存ファイルの取得（差分検出用）
      const existingFiles = await this.database.getAllFilePaths();
      const existingSet = new Set(existingFiles);

      // スキャン結果の初期化
      const result: ScanResult = {
        totalFiles: 0,
        totalSize: 0,
        totalDirectories: 0,
        newFiles: [],
        modifiedFiles: [],
        deletedFiles: [],
        unchangedFiles: [],
        errors: [],
        scanDuration: 0
      };

      // プログレストラッカーを開始
      this.progressTracker.start('scan');

      // ファイルをスキャン
      const scannedFiles = new Set<string>();
      const batch: FileMetadata[] = [];

      for await (const metadata of this.scanDirectory(rootPath)) {
        if (this.scanAborted) {
          logger.info('Scan aborted by user');
          break;
        }

        scannedFiles.add(metadata.path);

        if (metadata.isDirectory) {
          result.totalDirectories++;
        } else {
          result.totalFiles++;
          result.totalSize += metadata.size;
        }

        // バッチに追加
        batch.push(metadata);

        // バッチサイズに達したら処理
        if (batch.length >= (this.config.batchSize || 100)) {
          await this.processBatch(batch, result, existingSet);
          batch.length = 0;
        }

        // 進捗を更新
        this.progressTracker.update(result.totalFiles + result.totalDirectories, metadata.path);
      }

      // 残りのバッチを処理
      if (batch.length > 0) {
        await this.processBatch(batch, result, existingSet);
      }

      // 削除されたファイルを検出
      for (const existingPath of existingFiles) {
        if (!scannedFiles.has(existingPath)) {
          const metadata = await this.database.getFileMetadata(existingPath);
          if (metadata) {
            result.deletedFiles.push(metadata);

            if (!this.config.dryRun) {
              await this.database.markAsDeleted(existingPath);
            }
          }
        }
      }

      // スキャン時間を計算
      result.scanDuration = Date.now() - startTime;

      // プログレストラッカーを完了
      this.progressTracker.complete();

      logger.info(`Scan completed: ${result.totalFiles} files, ${result.totalDirectories} directories, ${result.scanDuration}ms`);
      logger.info(`New: ${result.newFiles.length}, Modified: ${result.modifiedFiles.length}, Deleted: ${result.deletedFiles.length}`);

      return result;

    } catch (error) {
      logger.error('Scan failed:', error);
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * スキャンを中止
   */
  async abortScan(): Promise<void> {
    if (!this.isScanning) {
      throw new Error('No scan in progress');
    }

    logger.info('Aborting scan...');
    this.scanAborted = true;
  }

  /**
   * 差分スキャン（高速モード）
   */
  async quickScan(rootPath: string, lastScanTime?: Date): Promise<ScanResult> {
    logger.info(`Starting quick scan (changes since: ${lastScanTime?.toISOString() || 'never'})`);

    // 通常のスキャンと同じ処理だが、lastScanTimeより新しいファイルのみを対象とする
    // ここでは簡略化のため、通常のスキャンを実行
    return this.startScan(rootPath);
  }

  /**
   * ディレクトリを再帰的にスキャン
   */
  private async *scanDirectory(dirPath: string): AsyncGenerator<FileMetadata> {
    const scanOptions = {
      excludePatterns: this.config.excludePatterns,
      fileFilter: (metadata: FileMetadata) => {
        // 最大ファイルサイズのチェック
        if (!metadata.isDirectory && this.config.maxFileSize) {
          return metadata.size <= this.config.maxFileSize;
        }
        return true;
      },
      onError: (error: Error, path: string) => {
        logger.error(`Error scanning ${path}:`, error);
        // エラーを記録するが、スキャンは続行
      }
    };

    for await (const metadata of this.adapter.scanDirectory(dirPath, scanOptions)) {
      // チェックサムを計算（小さいファイルのみ）
      if (!metadata.isDirectory && metadata.size < 1024 * 1024) { // 1MB未満
        try {
          metadata.checksum = await this.adapter.calculateChecksum(metadata.path);
        } catch (error) {
          logger.warn(`Failed to calculate checksum for ${metadata.path}:`, error);
        }
      }

      yield metadata;
    }
  }

  /**
   * ファイルのバッチを処理
   */
  private async processBatch(
    batch: FileMetadata[],
    result: ScanResult,
    existingSet: Set<string>
  ): Promise<void> {
    if (this.config.dryRun) {
      // ドライランモードでは分類のみ行う
      for (const metadata of batch) {
        if (existingSet.has(metadata.path)) {
          result.unchangedFiles.push(metadata);
        } else {
          result.newFiles.push(metadata);
        }
      }
      return;
    }

    // データベースとの比較処理
    const processPromises = batch.map(metadata =>
      this.limit(async () => {
        try {
          const existing = await this.database.getFileMetadata(metadata.path);

          if (!existing) {
            // 新規ファイル
            result.newFiles.push(metadata);
            await this.database.insertFile(metadata);
          } else if (this.hasChanged(existing, metadata)) {
            // 変更されたファイル
            result.modifiedFiles.push(metadata);
            await this.database.updateFile(metadata);
          } else {
            // 変更なし
            result.unchangedFiles.push(metadata);
          }
        } catch (error) {
          const scanError: ScanError = {
            path: metadata.path,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date(),
            recoverable: true
          };
          result.errors.push(scanError);
          logger.error(`Error processing ${metadata.path}:`, error);
        }
      })
    );

    await Promise.all(processPromises);
  }

  /**
   * ファイルが変更されたかチェック
   */
  private hasChanged(existing: FileMetadata, current: FileMetadata): boolean {
    // サイズが異なる場合は変更あり
    if (existing.size !== current.size) {
      return true;
    }

    // 更新日時が異なる場合は変更あり
    if (existing.modifiedAt.getTime() !== current.modifiedAt.getTime()) {
      return true;
    }

    // チェックサムが存在する場合は比較
    if (existing.checksum && current.checksum) {
      return existing.checksum !== current.checksum;
    }

    return false;
  }

  /**
   * スキャン統計を取得
   */
  async getStatistics(): Promise<{
    totalFiles: number;
    totalSize: number;
    fileTypes: Map<string, number>;
    lastScanTime?: Date;
  }> {
    const stats = await this.database.getStatistics();
    return {
      totalFiles: stats.totalFiles,
      totalSize: stats.totalSize,
      fileTypes: new Map(Object.entries(stats.fileTypes)),
      lastScanTime: stats.lastScanTime
    };
  }

  /**
   * スキャン履歴を取得
   */
  async getScanHistory(limit: number = 10): Promise<any[]> {
    return await this.database.getScanHistory(limit);
  }
}