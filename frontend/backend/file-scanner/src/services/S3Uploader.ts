/**
 * S3 Uploader Service
 * ファイルをAmazon S3にアップロードするサービス
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import pLimit, { LimitFunction } from 'p-limit';
import { FileSystemAdapter } from '@/adapters';
import { FileMetadata, S3UploadResult, AWSConfig } from '@/types';
import { DatabaseManager } from './DatabaseManager';
import { ProgressTracker } from './ProgressTracker';
import { createLogger } from '@/utils/logger';

const logger = createLogger('S3Uploader');

/**
 * S3Uploaderの設定
 */
export interface S3UploaderConfig {
  /**
   * AWS設定
   */
  awsConfig: AWSConfig;

  /**
   * ファイルシステムアダプター
   */
  adapter: FileSystemAdapter;

  /**
   * データベースマネージャー
   */
  database: DatabaseManager;

  /**
   * 並行アップロード数
   */
  concurrency?: number;

  /**
   * リトライ回数
   */
  maxRetries?: number;

  /**
   * ドライランモード
   */
  dryRun?: boolean;

  /**
   * プログレストラッカー
   */
  progressTracker?: ProgressTracker;
}

/**
 * S3Uploader
 * ファイルをS3にアップロード
 */
export class S3Uploader {
  private readonly s3Client: S3Client;
  private readonly config: S3UploaderConfig;
  private readonly adapter: FileSystemAdapter;
  private readonly database: DatabaseManager;
  private readonly progressTracker?: ProgressTracker;
  private readonly limit: LimitFunction;
  private uploadQueue: Map<string, Upload> = new Map();
  private isUploading: boolean = false;

  constructor(config: S3UploaderConfig) {
    this.config = config;
    this.adapter = config.adapter;
    this.database = config.database;
    this.progressTracker = config.progressTracker;
    this.limit = pLimit(config.concurrency || config.awsConfig.s3.uploadConcurrency || 10);

    // S3クライアントを初期化
    this.s3Client = new S3Client({
      region: config.awsConfig.region,
      credentials: config.awsConfig.accessKeyId && config.awsConfig.secretAccessKey ? {
        accessKeyId: config.awsConfig.accessKeyId,
        secretAccessKey: config.awsConfig.secretAccessKey
      } : undefined,
      maxAttempts: config.maxRetries || 3
    });
  }

  /**
   * ファイルをS3にアップロード
   */
  async uploadFile(metadata: FileMetadata): Promise<S3UploadResult> {
    const startTime = Date.now();

    try {
      // ディレクトリはスキップ
      if (metadata.isDirectory) {
        logger.debug(`Skipping directory: ${metadata.path}`);
        return {
          key: this.generateS3Key(metadata.path),
          bucket: this.config.awsConfig.s3.bucket,
          size: 0,
          uploadDuration: 0
        };
      }

      // S3キーを生成
      const s3Key = this.generateS3Key(metadata.path);

      // 既にアップロード済みかチェック
      const exists = await this.checkFileExists(s3Key);
      if (exists) {
        logger.debug(`File already exists in S3: ${s3Key}`);
        return {
          key: s3Key,
          bucket: this.config.awsConfig.s3.bucket,
          size: metadata.size,
          uploadDuration: Date.now() - startTime
        };
      }

      // ドライランモードの場合はここで終了
      if (this.config.dryRun) {
        logger.info(`[DRY RUN] Would upload: ${metadata.path} -> s3://${this.config.awsConfig.s3.bucket}/${s3Key}`);
        return {
          key: s3Key,
          bucket: this.config.awsConfig.s3.bucket,
          size: metadata.size,
          uploadDuration: 0
        };
      }

      // ファイルサイズに応じてアップロード方法を選択
      let result: S3UploadResult;

      if (metadata.size < this.config.awsConfig.s3.multipartThreshold * 1024 * 1024) {
        // 小さいファイルは通常のアップロード
        result = await this.uploadSmallFile(metadata, s3Key);
      } else {
        // 大きいファイルはマルチパートアップロード
        result = await this.uploadLargeFile(metadata, s3Key);
      }

      // データベースを更新
      await this.database.updateS3Info(metadata.path, s3Key, result.etag || '');

      logger.info(`Uploaded: ${metadata.path} -> ${s3Key} (${metadata.size} bytes in ${result.uploadDuration}ms)`);

      return result;

    } catch (error) {
      logger.error(`Failed to upload ${metadata.path}:`, error);
      await this.database.logError(metadata.path, 'UPLOAD_ERROR', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * 複数ファイルをバッチアップロード
   */
  async uploadBatch(files: FileMetadata[]): Promise<S3UploadResult[]> {
    if (this.isUploading) {
      throw new Error('Upload already in progress');
    }

    this.isUploading = true;
    logger.info(`Starting batch upload of ${files.length} files`);

    // プログレストラッカーを開始
    if (this.progressTracker) {
      this.progressTracker.start('upload', files.length);
    }

    try {
      const results: S3UploadResult[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      // 並行アップロード
      const uploadPromises = files.map((file) =>
        this.limit(async () => {
          try {
            const result = await this.uploadFile(file);
            results.push(result);

            // プログレスを更新
            if (this.progressTracker) {
              this.progressTracker.increment(1, `Uploaded: ${file.name}`);
            }

            return result;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push({ file: file.path, error: errorMsg });
            logger.error(`Failed to upload ${file.path}:`, error);
            return null;
          }
        })
      );

      await Promise.all(uploadPromises);

      // プログレストラッカーを完了
      if (this.progressTracker) {
        this.progressTracker.complete('upload');
      }

      // エラーがあった場合はログ出力
      if (errors.length > 0) {
        logger.warn(`Upload completed with ${errors.length} errors`);
        errors.forEach(e => logger.error(`  - ${e.file}: ${e.error}`));
      }

      logger.info(`Batch upload completed: ${results.length} succeeded, ${errors.length} failed`);

      return results.filter(r => r !== null) as S3UploadResult[];

    } finally {
      this.isUploading = false;
    }
  }

  /**
   * ペンディング中のファイルをアップロード
   */
  async uploadPendingFiles(limit: number = 100): Promise<S3UploadResult[]> {
    logger.info('Fetching pending files for upload');

    const pendingFiles = await this.database.getPendingFiles(limit);
    if (pendingFiles.length === 0) {
      logger.info('No pending files to upload');
      return [];
    }

    logger.info(`Found ${pendingFiles.length} pending files`);
    return await this.uploadBatch(pendingFiles);
  }

  /**
   * 小さいファイルをアップロード（通常のPutObject）
   */
  private async uploadSmallFile(metadata: FileMetadata, s3Key: string): Promise<S3UploadResult> {
    const startTime = Date.now();

    // ファイルストリームを作成
    const stream = await this.adapter.createReadStream(metadata.path);

    // PutObjectコマンドを実行
    const command = new PutObjectCommand({
      Bucket: this.config.awsConfig.s3.bucket,
      Key: s3Key,
      Body: stream,
      ContentType: metadata.mimeType,
      Metadata: {
        'original-path': metadata.path,
        'modified-at': metadata.modifiedAt.toISOString(),
        'checksum': metadata.checksum || ''
      }
    });

    const response = await this.s3Client.send(command);

    return {
      key: s3Key,
      bucket: this.config.awsConfig.s3.bucket,
      etag: response.ETag,
      versionId: response.VersionId,
      size: metadata.size,
      uploadDuration: Date.now() - startTime
    };
  }

  /**
   * 大きいファイルをアップロード（マルチパート）
   */
  private async uploadLargeFile(metadata: FileMetadata, s3Key: string): Promise<S3UploadResult> {
    const startTime = Date.now();

    // ファイルストリームを作成
    const stream = await this.adapter.createReadStream(metadata.path);

    // AWS SDK v3のUploadクラスを使用（自動的にマルチパートアップロードを管理）
    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.config.awsConfig.s3.bucket,
        Key: s3Key,
        Body: stream,
        ContentType: metadata.mimeType,
        Metadata: {
          'original-path': metadata.path,
          'modified-at': metadata.modifiedAt.toISOString(),
          'checksum': metadata.checksum || ''
        }
      },
      queueSize: this.config.awsConfig.s3.uploadConcurrency || 4,
      partSize: this.config.awsConfig.s3.chunkSize * 1024 * 1024,
      leavePartsOnError: false
    });

    // アップロード進捗を監視
    upload.on('httpUploadProgress', (progress) => {
      if (progress.loaded && progress.total) {
        const percentage = Math.round((progress.loaded / progress.total) * 100);
        logger.debug(`Upload progress for ${metadata.name}: ${percentage}%`);
      }
    });

    // アップロードキューに追加
    this.uploadQueue.set(s3Key, upload);

    try {
      const result = await upload.done();

      return {
        key: s3Key,
        bucket: this.config.awsConfig.s3.bucket,
        etag: result.ETag,
        versionId: result.VersionId,
        size: metadata.size,
        uploadDuration: Date.now() - startTime
      };
    } finally {
      // アップロードキューから削除
      this.uploadQueue.delete(s3Key);
    }
  }

  /**
   * ファイルがS3に存在するかチェック
   */
  private async checkFileExists(s3Key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.awsConfig.s3.bucket,
        Key: s3Key
      });

      await this.s3Client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * S3キーを生成
   */
  private generateS3Key(filePath: string): string {
    // パスを正規化
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');

    // 日付プレフィックスを追加（年/月/日）
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    return `files/${year}/${month}/${day}/${normalized}`;
  }

  /**
   * アップロードを中止
   */
  async abortUpload(s3Key?: string): Promise<void> {
    if (s3Key) {
      // 特定のアップロードを中止
      const upload = this.uploadQueue.get(s3Key);
      if (upload) {
        await upload.abort();
        this.uploadQueue.delete(s3Key);
        logger.info(`Aborted upload: ${s3Key}`);
      }
    } else {
      // すべてのアップロードを中止
      for (const [key, upload] of this.uploadQueue) {
        await upload.abort();
        logger.info(`Aborted upload: ${key}`);
      }
      this.uploadQueue.clear();
    }
  }

  /**
   * アップロード統計を取得
   */
  getUploadStatistics(): {
    activeUploads: number;
    queuedFiles: string[];
  } {
    return {
      activeUploads: this.uploadQueue.size,
      queuedFiles: Array.from(this.uploadQueue.keys())
    };
  }

  /**
   * クリーンアップ
   */
  async cleanup(): Promise<void> {
    // すべてのアップロードを中止
    await this.abortUpload();

    // S3クライアントを破棄
    this.s3Client.destroy();

    logger.info('S3Uploader cleaned up');
  }
}