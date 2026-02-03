#!/usr/bin/env node
/**
 * CIS File Scanner - Main Entry Point
 * NASファイルをスキャンしてAWS S3にアップロードするメインアプリケーション
 */

import * as dotenv from 'dotenv';
import { program } from 'commander';
import * as cron from 'node-cron';
import { FileSystemAdapterFactory } from '@/adapters';
import { FileScanner, DatabaseManager, ProgressTracker, S3Uploader, SQSPublisher, SQSConsumer, PowerShellRunner } from '@/services';
import { AWSConfig, NASConfig, ScannerConfig, SyncResult } from '@/types';
import { createLogger } from '@/utils/logger';
import * as path from 'path';

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

/**
 * SQSキューを診断
 */
async function diagnoseSQS() {
  logger.info('========================================');
  logger.info('SQS Queue Diagnostics');
  logger.info('========================================');

  const config = loadConfig();

  if (!config.aws.sqs.queueUrl) {
    logger.error('SQS_QUEUE_URL is not set');
    process.exit(1);
  }

  try {
    const publisher = new SQSPublisher({
      awsConfig: config.aws,
      dryRun: false
    });

    // キューメトリクスを取得
    const metrics = await publisher.getQueueMetrics();

    console.log('\n📊 Queue Metrics:');
    console.log(`  Messages in Queue: ${metrics.approximateNumberOfMessages}`);
    console.log(`  Messages in Flight: ${metrics.approximateNumberOfMessagesNotVisible}`);
    console.log(`  Messages Delayed: ${metrics.approximateNumberOfMessagesDelayed}`);

    // 処理速度の分析
    const totalPendingMessages = metrics.approximateNumberOfMessages +
                         metrics.approximateNumberOfMessagesNotVisible;

    console.log('\n⚠️ Analysis:');
    console.log(`  Total pending (queue + in-flight): ${totalPendingMessages}`);

    if (metrics.approximateNumberOfMessages > 1000) {
      console.log(`  ⚠️ High backlog detected: ${metrics.approximateNumberOfMessages} messages`);
      console.log('  Recommendation: Increase python-worker instances');
    } else if (metrics.approximateNumberOfMessages > 100) {
      console.log(`  ⚠️ Moderate backlog: ${metrics.approximateNumberOfMessages} messages`);
      console.log('  Recommendation: Monitor worker processing speed');
    } else {
      console.log(`  ✅ Queue is healthy: ${metrics.approximateNumberOfMessages} messages`);
    }

    if (metrics.approximateNumberOfMessagesNotVisible > 500) {
      console.log(`  ⚠️ High in-flight messages: ${metrics.approximateNumberOfMessagesNotVisible}`);
      console.log('  Possible issue: Workers not deleting messages after processing');
    }

    // DLQ確認
    if (config.aws.sqs.dlqUrl) {
      console.log('\n🔴 Checking Dead Letter Queue...');
      const dlqPublisher = new SQSPublisher({
        awsConfig: {
          ...config.aws,
          sqs: {
            queueUrl: config.aws.sqs.dlqUrl,
            dlqUrl: undefined
          }
        },
        dryRun: false
      });

      const dlqMetrics = await dlqPublisher.getQueueMetrics();
      console.log(`  DLQ Messages: ${dlqMetrics.approximateNumberOfMessages}`);

      if (dlqMetrics.approximateNumberOfMessages > 0) {
        console.log('  ⚠️ Failed messages detected in DLQ!');
        console.log('  Action required: Investigate and reprocess failed messages');
      } else {
        console.log('  ✅ No failed messages in DLQ');
      }

      await dlqPublisher.cleanup();
    }

    // 統計情報
    const stats = publisher.getStatistics();
    console.log('\n📈 Publisher Statistics:');
    console.log(`  Published: ${stats.publishedCount}`);
    console.log(`  Failed: ${stats.failedCount}`);
    console.log(`  Queued: ${stats.queuedCount}`);

    // 推奨アクション
    console.log('\n💡 Recommendations:');

    const backlog = metrics.approximateNumberOfMessages;
    const estimatedHours = backlog / (10 * 60); // 10 files/min

    if (backlog > 100) {
      console.log('  1. Scale up python-worker instances:');
      console.log(`     - Current backlog: ${backlog} messages`);
      console.log(`     - Estimated time to clear (1 worker): ${estimatedHours.toFixed(1)} hours`);
      console.log('     - Recommended: 4-8 worker instances');

      console.log('\n  2. Enable batch processing in python-worker:');
      console.log('     - Change sqs_max_messages from 1 to 10');
      console.log('     - Implement bulk indexing in OpenSearch');

      console.log('\n  3. Monitor CloudWatch Logs:');
      console.log('     - Check for processing errors');
      console.log('     - Verify OpenSearch connection');
    } else {
      console.log('  ✅ System is operating normally');
    }

    await publisher.cleanup();

  } catch (error) {
    logger.error('Diagnostics failed:', error);
    process.exit(1);
  }
}

/**
 * SQS Consumerモードでスキャンを実行
 * フロントエンドからのNAS同期リクエストを処理
 *
 * 処理フロー:
 * 1. SQSからメッセージを受信
 * 2. PowerShellスクリプト（nas-sync-improved.ps1）を実行
 *    - NASから incoming/ フォルダにファイルをコピー
 *    - DocuWorks Converter と DataSync Monitor が後続処理
 * 3. DynamoDBに進捗を更新
 */
async function startSQSConsumer() {
  logger.info('========================================');
  logger.info('Starting SQS Consumer Mode');
  logger.info('========================================');

  const config = loadConfig();

  // 必須環境変数の確認
  const syncQueueUrl = process.env.SYNC_SQS_QUEUE_URL;
  const dynamoTableName = process.env.SYNC_DYNAMODB_TABLE;
  const nasSyncScriptPath = process.env.NAS_SYNC_SCRIPT_PATH || 'C:\\CIS-FileSearch\\scripts\\nas-sync-improved.ps1';
  const syncMode = process.env.SYNC_MODE || 'auto'; // 'powershell' | 'nodejs' | 'auto'

  if (!syncQueueUrl) {
    logger.error('SYNC_SQS_QUEUE_URL environment variable is required');
    process.exit(1);
  }

  if (!dynamoTableName) {
    logger.error('SYNC_DYNAMODB_TABLE environment variable is required');
    process.exit(1);
  }

  logger.info(`Queue URL: ${syncQueueUrl}`);
  logger.info(`DynamoDB Table: ${dynamoTableName}`);
  logger.info(`Sync Mode: ${syncMode}`);

  // 実行モードの決定
  const isWindows = PowerShellRunner.isWindowsEnvironment();
  const usePowerShell = syncMode === 'powershell' || (syncMode === 'auto' && isWindows);

  if (usePowerShell) {
    logger.info(`PowerShell Script: ${nasSyncScriptPath}`);
    logger.info('Mode: PowerShell (nas-sync-improved.ps1 + DocuWorks Converter + DataSync Monitor)');
  } else {
    logger.info('Mode: Node.js (built-in file scanner - DocuWorks processing not available)');
    logger.warn('WARNING: DocuWorks OCR processing is not available in Node.js mode');
  }

  // ホワイトリスト: 許可されたNASサーバー名
  const allowedNasServers = new Set([
    'ts-server3', 'ts-server5', 'ts-server6', 'ts-server7'
  ]);

  // UUID形式のバリデーション
  const isValidUuid = (str: string): boolean => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  };

  // スキャン実行関数を定義（PowerShell版）
  const scanExecutorPowerShell = async (options: {
    syncId: string;
    nasServers: string[];
    fullSync: boolean;
    onProgress?: (current: number, total: number, currentNas: string, processedFiles: number) => void;
  }): Promise<SyncResult> => {
    const { syncId, nasServers, fullSync, onProgress } = options;

    // 入力バリデーション
    if (!isValidUuid(syncId)) {
      throw new Error(`Invalid syncId format: ${syncId}`);
    }

    for (const server of nasServers) {
      if (!allowedNasServers.has(server)) {
        throw new Error(`Invalid NAS server: ${server}. Allowed: ${Array.from(allowedNasServers).join(', ')}`);
      }
    }

    logger.info(`Executing PowerShell sync for ${syncId}`);
    logger.info(`  NAS Servers: ${nasServers.join(', ')}`);
    logger.info(`  Full Sync: ${fullSync}`);

    // PowerShellRunnerを作成
    const runner = new PowerShellRunner({
      scriptPath: nasSyncScriptPath,
      workingDirectory: path.dirname(nasSyncScriptPath),
      timeout: 4 * 60 * 60 * 1000, // 4時間
      environment: {
        AWS_REGION: config.aws.region,
        AWS_PROFILE: process.env.AWS_PROFILE || 'cis-scanner'
      }
    });

    try {
      // 進捗更新（開始）
      if (onProgress) {
        onProgress(0, nasServers.length, 'starting', 0);
      }

      // PowerShellスクリプトを実行
      const result = await runner.executeNasSync({
        fullSync,
        dryRun: config.scanner.dryRun,
        onProgress: (message) => {
          logger.debug(`PowerShell: ${message}`);
          // 進捗メッセージからNAS名と処理数を抽出
          const nasMatch = message.match(/\[([^\]]+)\]/);
          if (nasMatch?.[1] && onProgress) {
            const currentNas = nasMatch[1];
            const processedMatch = message.match(/(\d+)\s*\/\s*(\d+)/);
            if (processedMatch?.[1] && processedMatch?.[2]) {
              const current = parseInt(processedMatch[1], 10);
              const total = parseInt(processedMatch[2], 10);
              onProgress(current, total, currentNas, current);
            }
          }
        }
      });

      logger.info('PowerShell sync completed:');
      logger.info(`  New files: ${result.new_files}`);
      logger.info(`  Changed files: ${result.changed_files}`);
      logger.info(`  Deleted files: ${result.deleted_files}`);
      logger.info(`  Synced: ${result.synced}`);
      logger.info(`  Errors: ${result.errors}`);

      return {
        newFiles: result.new_files,
        changedFiles: result.changed_files,
        deletedFiles: result.deleted_files,
        syncedFiles: result.synced,
        errors: result.errors
      };

    } catch (error) {
      logger.error('PowerShell sync failed:', error);
      throw error;
    }
  };

  // スキャン実行関数を定義（Node.js版 - 開発/テスト用フォールバック）
  const scanExecutorNodeJs = async (options: {
    syncId: string;
    nasServers: string[];
    fullSync: boolean;
    onProgress?: (current: number, total: number, currentNas: string, processedFiles: number) => void;
  }): Promise<SyncResult> => {
    const { syncId, nasServers, fullSync, onProgress } = options;

    logger.info(`Executing Node.js scan for sync ${syncId}`);
    logger.info(`  NAS Servers: ${nasServers.join(', ')}`);
    logger.info(`  Full Sync: ${fullSync}`);

    let totalNewFiles = 0;
    let totalChangedFiles = 0;
    let totalDeletedFiles = 0;
    let totalSyncedFiles = 0;
    let totalErrors = 0;

    // 各NASサーバーをスキャン
    for (let i = 0; i < nasServers.length; i++) {
      const nasServer = nasServers[i]!;
      logger.info(`Scanning NAS: ${nasServer} (${i + 1}/${nasServers.length})`);

      try {
        // コンポーネントを初期化
        const adapter = FileSystemAdapterFactory.createFromEnv();
        const database = new DatabaseManager({
          dbPath: process.env.DB_PATH
        });

        await adapter.connect();
        await database.initialize();

        // NASパスを構築
        const nasPath = `${config.scanner.nasPath}/${nasServer}`;

        const scanner = new FileScanner({
          adapter,
          database,
          excludePatterns: config.scanner.excludePatterns,
          maxFileSize: config.scanner.maxFileSize,
          concurrency: config.scanner.parallelism,
          batchSize: config.scanner.batchSize,
          dryRun: config.scanner.dryRun
        });

        const uploader = new S3Uploader({
          awsConfig: config.aws,
          adapter,
          database,
          dryRun: config.scanner.dryRun
        });

        let scanResult;
        if (fullSync) {
          scanResult = await scanner.startScan(nasPath);
        } else {
          const stats = await database.getStatistics();
          if (stats.lastScanTime) {
            scanResult = await scanner.quickScan(nasPath, stats.lastScanTime);
          } else {
            scanResult = await scanner.startScan(nasPath);
          }
        }

        totalNewFiles += scanResult.newFiles.length;
        totalChangedFiles += scanResult.modifiedFiles.length;
        totalDeletedFiles += scanResult.deletedFiles.length;
        totalSyncedFiles += scanResult.newFiles.length + scanResult.modifiedFiles.length;
        totalErrors += scanResult.errors.length;

        // ファイルをアップロード
        const filesToUpload = [...scanResult.newFiles, ...scanResult.modifiedFiles];
        if (filesToUpload.length > 0) {
          await uploader.uploadBatch(filesToUpload);
        }

        await uploader.cleanup();
        await database.close();
        await adapter.disconnect();

        // 進捗を更新
        if (onProgress) {
          onProgress(i + 1, nasServers.length, nasServer, totalSyncedFiles);
        }

      } catch (error) {
        totalErrors++;
        logger.error(`Failed to scan NAS ${nasServer}:`, error);
      }
    }

    return {
      newFiles: totalNewFiles,
      changedFiles: totalChangedFiles,
      deletedFiles: totalDeletedFiles,
      syncedFiles: totalSyncedFiles,
      errors: totalErrors
    };
  };

  // 使用するスキャン実行関数を選択
  const scanExecutor = usePowerShell ? scanExecutorPowerShell : scanExecutorNodeJs;

  // SQS Consumerを作成して開始
  const consumer = new SQSConsumer({
    region: config.aws.region,
    queueUrl: syncQueueUrl,
    dynamoTableName,
    scanExecutor,
    credentials: config.aws.accessKeyId && config.aws.secretAccessKey ? {
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey
    } : undefined
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Received shutdown signal');
    await consumer.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 統計情報を定期的に表示
  setInterval(() => {
    const stats = consumer.getStatistics();
    logger.info(`Consumer stats: processed=${stats.processedCount}, errors=${stats.errorCount}`);
  }, 60000); // 1分ごと

  // Consumer開始
  await consumer.start();
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

// SQS診断コマンド
program
  .command('diagnose-sqs')
  .description('Diagnose SQS queue status and performance')
  .action(diagnoseSQS);

// SQS Consumerコマンド（デーモンモード）
program
  .command('consumer')
  .description('Start SQS consumer mode to process sync requests from web UI')
  .action(startSQSConsumer);

// CLIを実行
program.parse();

// コマンドが指定されなかった場合
if (!process.argv.slice(2).length) {
  program.outputHelp();
}