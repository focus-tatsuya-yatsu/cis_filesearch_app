/**
 * Database Manager Service
 * SQLiteを使用したローカルファイルメタデータ管理
 */

import sqlite3Import from 'sqlite3';
import type { Database } from 'sqlite3';
const sqlite3 = sqlite3Import.verbose();
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { FileMetadata } from '@/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('DatabaseManager');

/**
 * DatabaseManagerの設定
 */
export interface DatabaseConfig {
  /**
   * データベースファイルパス
   */
  dbPath?: string;

  /**
   * メモリ内データベースを使用（テスト用）
   */
  inMemory?: boolean;

  /**
   * 自動バキューム設定
   */
  autoVacuum?: boolean;
}

/**
 * DatabaseManager
 * ファイルメタデータのローカル管理
 */
export class DatabaseManager {
  private db: Database | null = null;
  private readonly config: DatabaseConfig;
  private isInitialized: boolean = false;

  // Promisified methods
  private run: any;
  private get: any;
  private all: any;

  constructor(config: DatabaseConfig = {}) {
    this.config = {
      dbPath: config.dbPath || process.env.DB_PATH || './data/scanner.db',
      inMemory: config.inMemory || false,
      autoVacuum: config.autoVacuum ?? true,
      ...config
    };
  }

  /**
   * データベースを初期化
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // データベースディレクトリを作成
      if (!this.config.inMemory && this.config.dbPath) {
        const dbDir = path.dirname(this.config.dbPath);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
      }

      // データベースを開く
      const dbPath = this.config.inMemory ? ':memory:' : this.config.dbPath!;

      await new Promise<void>((resolve, reject) => {
        this.db = new sqlite3.Database(dbPath, (err) => {
          if (err) {
            reject(err);
          } else {
            logger.info(`Database opened: ${dbPath}`);
            resolve();
          }
        });
      });

      // メソッドをPromise化
      this.run = promisify(this.db!.run.bind(this.db));
      this.get = promisify(this.db!.get.bind(this.db));
      this.all = promisify(this.db!.all.bind(this.db));

      // テーブルを作成
      await this.createTables();

      // インデックスを作成
      await this.createIndexes();

      // 自動バキュームを設定
      if (this.config.autoVacuum) {
        await this.run('PRAGMA auto_vacuum = INCREMENTAL');
      }

      this.isInitialized = true;
      logger.info('Database initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * テーブルを作成
   */
  private async createTables(): Promise<void> {
    // ファイルメタデータテーブル
    await this.run(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime_type TEXT,
        modified_at INTEGER NOT NULL,
        created_at INTEGER,
        is_directory INTEGER NOT NULL,
        checksum TEXT,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        last_synced INTEGER,
        s3_key TEXT,
        s3_etag TEXT,
        created_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        updated_timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // スキャン履歴テーブル
    await this.run(`
      CREATE TABLE IF NOT EXISTS scan_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_time INTEGER NOT NULL,
        root_path TEXT NOT NULL,
        total_files INTEGER,
        total_size INTEGER,
        new_files INTEGER,
        modified_files INTEGER,
        deleted_files INTEGER,
        errors INTEGER,
        duration INTEGER,
        status TEXT,
        created_timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // エラーログテーブル
    await this.run(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT,
        error_type TEXT,
        error_message TEXT,
        recoverable INTEGER,
        created_timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    logger.debug('Tables created');
  }

  /**
   * インデックスを作成
   */
  private async createIndexes(): Promise<void> {
    await this.run('CREATE INDEX IF NOT EXISTS idx_files_path ON files(path)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_files_status ON files(status)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified_at)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_files_size ON files(size)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_scan_history_time ON scan_history(scan_time)');

    logger.debug('Indexes created');
  }

  /**
   * ファイルを挿入
   */
  async insertFile(metadata: FileMetadata): Promise<void> {
    const sql = `
      INSERT OR IGNORE INTO files (
        path, name, size, mime_type, modified_at, created_at,
        is_directory, checksum, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      metadata.path,
      metadata.name,
      metadata.size,
      metadata.mimeType,
      metadata.modifiedAt.getTime(),
      metadata.createdAt?.getTime() || null,
      metadata.isDirectory ? 1 : 0,
      metadata.checksum || null,
      'pending'
    ];

    await this.run(sql, params);
    logger.debug(`Inserted file: ${metadata.path}`);
  }

  /**
   * ファイルを更新
   */
  async updateFile(metadata: FileMetadata): Promise<void> {
    const sql = `
      UPDATE files SET
        name = ?,
        size = ?,
        mime_type = ?,
        modified_at = ?,
        checksum = ?,
        updated_timestamp = strftime('%s', 'now')
      WHERE path = ?
    `;

    const params = [
      metadata.name,
      metadata.size,
      metadata.mimeType,
      metadata.modifiedAt.getTime(),
      metadata.checksum || null,
      metadata.path
    ];

    await this.run(sql, params);
    logger.debug(`Updated file: ${metadata.path}`);
  }

  /**
   * ファイルを削除済みとしてマーク
   */
  async markAsDeleted(path: string): Promise<void> {
    const sql = `
      UPDATE files SET
        status = 'deleted',
        updated_timestamp = strftime('%s', 'now')
      WHERE path = ?
    `;

    await this.run(sql, [path]);
    logger.debug(`Marked as deleted: ${path}`);
  }

  /**
   * ファイルメタデータを取得
   */
  async getFileMetadata(path: string): Promise<FileMetadata | null> {
    const sql = `
      SELECT * FROM files WHERE path = ? AND status != 'deleted'
    `;

    const row = await this.get(sql, [path]);

    if (!row) {
      return null;
    }

    return this.rowToMetadata(row);
  }

  /**
   * すべてのファイルパスを取得
   */
  async getAllFilePaths(): Promise<string[]> {
    const sql = `
      SELECT path FROM files WHERE status != 'deleted'
    `;

    const rows = await this.all(sql);
    return rows.map((row: any) => row.path);
  }

  /**
   * 統計情報を取得
   */
  async getStatistics(): Promise<{
    totalFiles: number;
    totalSize: number;
    fileTypes: { [key: string]: number };
    lastScanTime?: Date;
  }> {
    // ファイル数とサイズを取得
    const statsSql = `
      SELECT
        COUNT(*) as total_files,
        SUM(size) as total_size
      FROM files
      WHERE is_directory = 0 AND status != 'deleted'
    `;

    const stats = await this.get(statsSql);

    // 拡張子別のファイル数を取得
    const typesSql = `
      SELECT
        LOWER(SUBSTR(name, INSTR(name, '.') + 1)) as extension,
        COUNT(*) as count
      FROM files
      WHERE is_directory = 0 AND status != 'deleted' AND INSTR(name, '.') > 0
      GROUP BY extension
      ORDER BY count DESC
      LIMIT 20
    `;

    const types = await this.all(typesSql);
    const fileTypes: { [key: string]: number } = {};
    for (const type of types) {
      fileTypes[`.${type.extension}`] = type.count;
    }

    // 最後のスキャン時刻を取得
    const lastScanSql = `
      SELECT MAX(scan_time) as last_scan
      FROM scan_history
      WHERE status = 'completed'
    `;

    const lastScan = await this.get(lastScanSql);

    return {
      totalFiles: stats.total_files || 0,
      totalSize: stats.total_size || 0,
      fileTypes,
      lastScanTime: lastScan?.last_scan ? new Date(lastScan.last_scan) : undefined
    };
  }

  /**
   * スキャン履歴を保存
   */
  async saveScanHistory(result: {
    rootPath: string;
    totalFiles: number;
    totalSize: number;
    newFiles: number;
    modifiedFiles: number;
    deletedFiles: number;
    errors: number;
    duration: number;
    status: 'completed' | 'aborted' | 'failed';
  }): Promise<void> {
    const sql = `
      INSERT INTO scan_history (
        scan_time, root_path, total_files, total_size,
        new_files, modified_files, deleted_files, errors,
        duration, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      Date.now(),
      result.rootPath,
      result.totalFiles,
      result.totalSize,
      result.newFiles,
      result.modifiedFiles,
      result.deletedFiles,
      result.errors,
      result.duration,
      result.status
    ];

    await this.run(sql, params);
    logger.info('Scan history saved');
  }

  /**
   * スキャン履歴を取得
   */
  async getScanHistory(limit: number = 10): Promise<any[]> {
    const sql = `
      SELECT * FROM scan_history
      ORDER BY scan_time DESC
      LIMIT ?
    `;

    const rows = await this.all(sql, [limit]);

    return rows.map((row: any) => ({
      scanTime: new Date(row.scan_time),
      rootPath: row.root_path,
      totalFiles: row.total_files,
      totalSize: row.total_size,
      newFiles: row.new_files,
      modifiedFiles: row.modified_files,
      deletedFiles: row.deleted_files,
      errors: row.errors,
      duration: row.duration,
      status: row.status
    }));
  }

  /**
   * ペンディング中のファイルを取得
   */
  async getPendingFiles(limit: number = 100): Promise<FileMetadata[]> {
    const sql = `
      SELECT * FROM files
      WHERE status = 'pending' AND is_directory = 0
      ORDER BY size ASC
      LIMIT ?
    `;

    const rows = await this.all(sql, [limit]);
    return rows.map((row: any) => this.rowToMetadata(row));
  }

  /**
   * ファイルのS3情報を更新
   */
  async updateS3Info(path: string, s3Key: string, s3Etag: string): Promise<void> {
    const sql = `
      UPDATE files SET
        s3_key = ?,
        s3_etag = ?,
        status = 'synced',
        last_synced = ?,
        updated_timestamp = strftime('%s', 'now')
      WHERE path = ?
    `;

    await this.run(sql, [s3Key, s3Etag, Date.now(), path]);
    logger.debug(`Updated S3 info for: ${path}`);
  }

  /**
   * エラーを記録
   */
  async logError(path: string, errorType: string, errorMessage: string, recoverable: boolean = true): Promise<void> {
    const sql = `
      INSERT INTO error_logs (file_path, error_type, error_message, recoverable)
      VALUES (?, ?, ?, ?)
    `;

    await this.run(sql, [path, errorType, errorMessage, recoverable ? 1 : 0]);

    // ファイルのステータスも更新
    await this.run(
      'UPDATE files SET status = ?, error_message = ? WHERE path = ?',
      ['error', errorMessage, path]
    );
  }

  /**
   * データベースをクリーンアップ
   */
  async cleanup(): Promise<void> {
    // 古いエラーログを削除
    await this.run(`
      DELETE FROM error_logs
      WHERE created_timestamp < strftime('%s', 'now', '-30 days')
    `);

    // 削除済みファイルを物理削除
    await this.run(`
      DELETE FROM files
      WHERE status = 'deleted' AND updated_timestamp < strftime('%s', 'now', '-7 days')
    `);

    // バキューム実行
    if (this.config.autoVacuum) {
      await this.run('PRAGMA incremental_vacuum');
    }

    logger.info('Database cleanup completed');
  }

  /**
   * データベースを閉じる
   */
  async close(): Promise<void> {
    if (!this.db) return;

    await new Promise<void>((resolve, reject) => {
      this.db!.close((err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          logger.info('Database closed');
          resolve();
        }
      });
    });

    this.db = null;
    this.isInitialized = false;
  }

  /**
   * 行データをFileMetadataに変換
   */
  private rowToMetadata(row: any): FileMetadata {
    return {
      path: row.path,
      name: row.name,
      size: row.size,
      mimeType: row.mime_type,
      modifiedAt: new Date(row.modified_at),
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      isDirectory: row.is_directory === 1,
      checksum: row.checksum || undefined
    };
  }
}