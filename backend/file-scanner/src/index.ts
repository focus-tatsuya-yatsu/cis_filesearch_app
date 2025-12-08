#!/usr/bin/env node
/**
 * CIS File Scanner - Main Entry Point
 * NASファイルをスキャンしてAWS S3にアップロードするメインアプリケーション
 */

import * as dotenv from 'dotenv';
import { program } from 'commander';
import * as cron from 'node-cron';
import { FileSystemAdapterFactory } from '@/adapters';
import { FileScanner, DatabaseManager, ProgressTracker, S3Uploader, SQSPublisher } from '@/services';
import { AWSConfig, NASConfig, ScannerConfig } from '@/types';
import { createLogger } from '@/utils/logger';

// 環境変数を読み込み
dotenv.config();

const logger = createLogger('Main');

/**
 * アプリケーション設定を読み込み
 */
function loadConfig(): {
  aws: AWSConfig;
  nas: NASConfig;
  scanner: ScannerConfig;
} {
  return {
    aws: {
      region: process.env.AWS_REGION || 'ap-northeast-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      s3: {
        bucket: process.env.S3_BUCKET_NAME || 'cis-filesearch-landing',
        uploadConcurrency: parseInt(process.env.S3_UPLOAD_CONCURRENCY || '10'),
        multipartThreshold: parseInt(process.env.S3_MULTIPART_THRESHOLD_MB || '100'),
        chunkSize: parseInt(process.env.S3_MULTIPART_CHUNK_SIZE_MB || '10')
      },
      sqs: {
        queueUrl: process.env.SQS_QUEUE_URL || '',
        dlqUrl: process.env.SQS_DLQ_URL
      }
    },
    nas: {
      protocol: (process.env.NAS_PROTOCOL as any) || 'auto',
      mountPath: process.env.NAS_MOUNT_PATH || '/mnt/nas',
      host: process.env.NAS_HOST,
      username: process.env.NAS_USERNAME,
      password: process.env.NAS_PASSWORD,
      domain: process.env.NAS_DOMAIN
    },
    scanner: {
      nasPath: process.env.NAS_MOUNT_PATH || '/mnt/nas',
      s3Bucket: process.env.S3_BUCKET_NAME || 'cis-filesearch-landing',
      sqsQueueUrl: process.env.SQS_QUEUE_URL || '',
      batchSize: parseInt(process.env.SCAN_BATCH_SIZE || '1000'),
      parallelism: parseInt(process.env.SCAN_PARALLELISM || '20'),
      excludePatterns: (process.env.SCAN_EXCLUDE_PATTERNS || '').split(',').filter(p => p),
      maxFileSize: process.env.SCAN_MAX_FILE_SIZE_MB
        ? parseInt(process.env.SCAN_MAX_FILE_SIZE_MB) * 1024 * 1024
        : undefined,
      dryRun: process.env.DRY_RUN === 'true'
    }
  };
}

/**
 * フルスキャンを実行
 */
async function runFullScan(options: any = {}) {
  logger.info('========================================');
  logger.info('Starting Full Scan');
  logger.info('========================================');

  const config = loadConfig();

  // ドライランモードの確認
  if (options.dryRun || config.scanner.dryRun) {
    logger.warn('DRY RUN MODE ENABLED - No actual uploads will be performed');
  }

  try {
    // コンポーネントを初期化
    const adapter = FileSystemAdapterFactory.createFromEnv();
    const database = new DatabaseManager({
      dbPath: process.env.DB_PATH
    });
    const progressTracker = new ProgressTracker({
      enableLogging: true
    });

    // アダプターに接続
    await adapter.connect();

    // データベースを初期化
    await database.initialize();

    // スキャナーを作成
    const scanner = new FileScanner({
      adapter,
      database,
      excludePatterns: config.scanner.excludePatterns,
      maxFileSize: config.scanner.maxFileSize,
      concurrency: config.scanner.parallelism,
      batchSize: config.scanner.batchSize,
      onProgress: (event) => {
        if (event.percentage % 10 === 0) {
          logger.info(`Scan progress: ${event.percentage}% (${event.current}/${event.total})`);
        }
      },
      dryRun: options.dryRun || config.scanner.dryRun
    });

    // S3アップローダーを作成
    const uploader = new S3Uploader({
      awsConfig: config.aws,
      adapter,
      database,
      progressTracker,
      dryRun: options.dryRun || config.scanner.dryRun
    });

    // SQSパブリッシャーを作成
    const publisher = new SQSPublisher({
      awsConfig: config.aws,
      dryRun: options.dryRun || config.scanner.dryRun
    });

    // スキャンを実行
    logger.info(`Scanning directory: ${config.scanner.nasPath}`);
    const scanResult = await scanner.startScan(config.scanner.nasPath);

    logger.info('Scan completed:');
    logger.info(`  Total files: ${scanResult.totalFiles}`);
    logger.info(`  Total size: ${(scanResult.totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
    logger.info(`  New files: ${scanResult.newFiles.length}`);
    logger.info(`  Modified files: ${scanResult.modifiedFiles.length}`);
    logger.info(`  Deleted files: ${scanResult.deletedFiles.length}`);
    logger.info(`  Errors: ${scanResult.errors.length}`);

    // 新規・変更ファイルをアップロード
    if (scanResult.newFiles.length > 0 || scanResult.modifiedFiles.length > 0) {
      logger.info('Starting file upload to S3...');

      const filesToUpload = [...scanResult.newFiles, ...scanResult.modifiedFiles];
      const uploadResults = await uploader.uploadBatch(filesToUpload);

      logger.info(`Upload completed: ${uploadResults.length} files uploaded`);

      // SQSにメッセージを送信
      if (!options.skipSqs && config.aws.sqs.queueUrl) {
        logger.info('Publishing messages to SQS...');

        for (const [index, result] of uploadResults.entries()) {
          const fileMetadata = filesToUpload[index];
          if (fileMetadata) {
            await publisher.publishFileUploaded(fileMetadata, result);
          }
        }

        logger.info('SQS messages published');
      }
    }

    // 統計情報を保存
    await database.saveScanHistory({
      rootPath: config.scanner.nasPath,
      totalFiles: scanResult.totalFiles,
      totalSize: scanResult.totalSize,
      newFiles: scanResult.newFiles.length,
      modifiedFiles: scanResult.modifiedFiles.length,
      deletedFiles: scanResult.deletedFiles.length,
      errors: scanResult.errors.length,
      duration: scanResult.scanDuration,
      status: 'completed'
    });

    // クリーンアップ
    await database.cleanup();
    await database.close();
    await adapter.disconnect();
    await uploader.cleanup();
    await publisher.cleanup();

    logger.info('Full scan completed successfully');

  } catch (error) {
    logger.error('Full scan failed:', error);
    process.exit(1);
  }
}

/**
 * 差分スキャンを実行
 */
async function runDifferentialScan(options: any = {}) {
  logger.info('========================================');
  logger.info('Starting Differential Scan');
  logger.info('========================================');

  const config = loadConfig();

  try {
    // コンポーネントを初期化
    const adapter = FileSystemAdapterFactory.createFromEnv();
    const database = new DatabaseManager();

    await adapter.connect();
    await database.initialize();

    // 最後のスキャン時刻を取得
    const stats = await database.getStatistics();
    const lastScanTime = stats.lastScanTime;

    if (!lastScanTime) {
      logger.warn('No previous scan found. Running full scan instead.');
      return await runFullScan(options);
    }

    logger.info(`Last scan: ${lastScanTime.toISOString()}`);

    // スキャナーを作成
    const scanner = new FileScanner({
      adapter,
      database,
      excludePatterns: config.scanner.excludePatterns,
      maxFileSize: config.scanner.maxFileSize,
      concurrency: config.scanner.parallelism,
      dryRun: options.dryRun || config.scanner.dryRun
    });

    // 差分スキャンを実行
    const scanResult = await scanner.quickScan(config.scanner.nasPath, lastScanTime);

    logger.info(`Differential scan found ${scanResult.modifiedFiles.length} changed files`);

    // 変更ファイルをアップロード
    if (scanResult.modifiedFiles.length > 0) {
      const uploader = new S3Uploader({
        awsConfig: config.aws,
        adapter,
        database,
        dryRun: options.dryRun || config.scanner.dryRun
      });

      await uploader.uploadBatch(scanResult.modifiedFiles);
      await uploader.cleanup();
    }

    // クリーンアップ
    await database.close();
    await adapter.disconnect();

    logger.info('Differential scan completed successfully');

  } catch (error) {
    logger.error('Differential scan failed:', error);
    process.exit(1);
  }
}

/**
 * スケジュールされたスキャンを開始
 */
function startScheduledScan(cronExpression: string) {
  logger.info(`Starting scheduled scan with cron: ${cronExpression}`);

  const task = cron.schedule(cronExpression, async () => {
    logger.info('Scheduled scan triggered');
    await runDifferentialScan();
  });

  task.start();
  logger.info('Scheduled scan started. Press Ctrl+C to stop.');

  // プロセス終了時のクリーンアップ
  process.on('SIGINT', () => {
    logger.info('Stopping scheduled scan...');
    task.stop();
    process.exit(0);
  });
}

/**
 * 統計情報を表示
 */
async function showStatistics() {
  const database = new DatabaseManager();
  await database.initialize();

  const stats = await database.getStatistics();
  const history = await database.getScanHistory(5);

  console.log('\n========================================');
  console.log('File Scanner Statistics');
  console.log('========================================\n');

  console.log('Current Database:');
  console.log(`  Total files: ${stats.totalFiles}`);
  console.log(`  Total size: ${(stats.totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`  Last scan: ${stats.lastScanTime?.toISOString() || 'Never'}`);

  console.log('\nFile Types (Top 10):');
  const fileTypes = Object.entries(stats.fileTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [ext, count] of fileTypes) {
    console.log(`  ${ext}: ${count} files`);
  }

  console.log('\nRecent Scan History:');
  for (const scan of history) {
    console.log(`  ${scan.scanTime.toISOString()}: ${scan.totalFiles} files, ${scan.status}`);
  }

  await database.close();
}

// CLIコマンドを設定
program
  .name('cis-file-scanner')
  .description('CIS File Scanner - NAS to S3 file synchronization')
  .version('1.0.0');

// フルスキャンコマンド
program
  .command('scan')
  .description('Run a full scan of the NAS')
  .option('-d, --dry-run', 'Perform a dry run without uploading')
  .option('--skip-sqs', 'Skip SQS message publishing')
  .action(runFullScan);

// 差分スキャンコマンド
program
  .command('diff')
  .description('Run a differential scan (only changed files)')
  .option('-d, --dry-run', 'Perform a dry run without uploading')
  .action(runDifferentialScan);

// スケジュール実行コマンド
program
  .command('schedule <cron>')
  .description('Start scheduled scanning (e.g., "0 */6 * * *" for every 6 hours)')
  .action(startScheduledScan);

// 統計表示コマンド
program
  .command('stats')
  .description('Show scanning statistics')
  .action(showStatistics);

// CLIを実行
program.parse();

// コマンドが指定されなかった場合
if (!process.argv.slice(2).length) {
  program.outputHelp();
}