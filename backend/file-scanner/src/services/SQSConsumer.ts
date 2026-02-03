/**
 * SQS Consumer Service
 * SQSキューから同期メッセージを受信して差分スキャンを実行するサービス
 */

import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message
} from '@aws-sdk/client-sqs';
import { SyncMessage, SyncResult } from '@/types';
import { DynamoProgressUpdater } from './DynamoProgressUpdater';
import { createLogger } from '@/utils/logger';

const logger = createLogger('SQSConsumer');

/**
 * スキャン実行関数の型
 */
export type ScanExecutor = (options: {
  syncId: string;
  nasServers: string[];
  fullSync: boolean;
  onProgress?: (current: number, total: number, currentNas: string, processedFiles: number) => void;
}) => Promise<SyncResult>;

/**
 * SQSConsumerの設定
 */
export interface SQSConsumerConfig {
  /**
   * AWSリージョン
   */
  region?: string;

  /**
   * SQSキューURL
   */
  queueUrl: string;

  /**
   * DynamoDBテーブル名
   */
  dynamoTableName: string;

  /**
   * 待機時間（秒）- ロングポーリング
   */
  waitTimeSeconds?: number;

  /**
   * 可視性タイムアウト（秒）
   */
  visibilityTimeout?: number;

  /**
   * 最大メッセージ数
   */
  maxNumberOfMessages?: number;

  /**
   * スキャン実行関数
   */
  scanExecutor: ScanExecutor;

  /**
   * AWS認証情報（オプション）
   */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

/**
 * SQSConsumer
 * SQSキューをポーリングしてスキャンを実行
 */
export class SQSConsumer {
  private readonly sqsClient: SQSClient;
  private readonly progressUpdater: DynamoProgressUpdater;
  private readonly config: Required<Omit<SQSConsumerConfig, 'credentials'>> & Pick<SQSConsumerConfig, 'credentials'>;
  private isRunning: boolean = false;
  private processedCount: number = 0;
  private errorCount: number = 0;

  constructor(config: SQSConsumerConfig) {
    this.config = {
      region: config.region || 'ap-northeast-1',
      waitTimeSeconds: config.waitTimeSeconds || 20, // ロングポーリング
      visibilityTimeout: config.visibilityTimeout || 3600, // 1時間（長時間スキャン対応）
      maxNumberOfMessages: config.maxNumberOfMessages || 1,
      ...config
    };

    this.sqsClient = new SQSClient({
      region: this.config.region,
      credentials: config.credentials
    });

    this.progressUpdater = new DynamoProgressUpdater({
      region: this.config.region,
      tableName: this.config.dynamoTableName,
      credentials: config.credentials
    });

    logger.info(`SQSConsumer initialized for queue: ${this.config.queueUrl}`);
  }

  /**
   * コンシューマーを開始
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Consumer is already running');
      return;
    }

    this.isRunning = true;
    logger.info('SQS Consumer started');

    while (this.isRunning) {
      try {
        await this.pollMessages();
      } catch (error) {
        logger.error('Error in polling loop:', error);
        // エラー後は少し待機して再試行
        await this.sleep(5000);
      }
    }

    logger.info('SQS Consumer stopped');
  }

  /**
   * コンシューマーを停止
   */
  stop(): void {
    logger.info('Stopping SQS Consumer...');
    this.isRunning = false;
  }

  /**
   * メッセージをポーリング
   */
  private async pollMessages(): Promise<void> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.config.queueUrl,
      WaitTimeSeconds: this.config.waitTimeSeconds,
      VisibilityTimeout: this.config.visibilityTimeout,
      MaxNumberOfMessages: this.config.maxNumberOfMessages,
      MessageAttributeNames: ['All']
    });

    const response = await this.sqsClient.send(command);

    if (!response.Messages || response.Messages.length === 0) {
      logger.debug('No messages received');
      return;
    }

    logger.info(`Received ${response.Messages.length} message(s)`);

    for (const message of response.Messages) {
      await this.processMessage(message);
    }
  }

  /**
   * メッセージを処理
   */
  private async processMessage(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) {
      logger.warn('Invalid message received');
      return;
    }

    let syncMessage: SyncMessage;

    try {
      syncMessage = JSON.parse(message.Body);
    } catch (error) {
      logger.error('Failed to parse message body:', error);
      // 不正なメッセージは削除
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    const { syncId, nasServers, fullSync, triggeredBy } = syncMessage;

    logger.info(`Processing sync job: ${syncId}`);
    logger.info(`  NAS Servers: ${nasServers.join(', ')}`);
    logger.info(`  Full Sync: ${fullSync}`);
    logger.info(`  Triggered By: ${triggeredBy}`);

    try {
      // 冪等性チェック - 既に処理中または完了していないか確認
      const existingSync = await this.progressUpdater.getSync(syncId);
      if (existingSync && existingSync.status !== 'pending') {
        logger.warn(`Sync ${syncId} is already ${existingSync.status}, skipping`);
        await this.deleteMessage(message.ReceiptHandle);
        return;
      }

      // ステータスを in_progress に更新
      await this.progressUpdater.updateStatus(syncId, 'in_progress');

      // スキャンを実行
      const result = await this.config.scanExecutor({
        syncId,
        nasServers,
        fullSync,
        onProgress: async (current, total, currentNas, processedFiles) => {
          await this.progressUpdater.updateProgress(syncId, {
            current,
            total,
            currentNas,
            processedFiles,
            errors: 0
          });
        }
      });

      // 結果を更新
      await this.progressUpdater.updateResult(syncId, result);

      // メッセージを削除
      await this.deleteMessage(message.ReceiptHandle);

      this.processedCount++;
      logger.info(`Sync ${syncId} completed successfully`);

    } catch (error) {
      this.errorCount++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Sync ${syncId} failed:`, error);

      // エラーステータスを更新
      await this.progressUpdater.updateStatus(syncId, 'failed', errorMessage);

      // メッセージを削除（DLQに移動させるため）
      // 注: DLQを使用する場合は、ここでは削除せずにタイムアウトさせる
      // ここでは削除してエラーログに記録する方式を採用
      await this.deleteMessage(message.ReceiptHandle);
    }
  }

  /**
   * メッセージを削除
   */
  private async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      await this.sqsClient.send(new DeleteMessageCommand({
        QueueUrl: this.config.queueUrl,
        ReceiptHandle: receiptHandle
      }));
      logger.debug('Message deleted from queue');
    } catch (error) {
      logger.error('Failed to delete message:', error);
    }
  }

  /**
   * スリープ
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 統計情報を取得
   */
  getStatistics(): {
    processedCount: number;
    errorCount: number;
    isRunning: boolean;
  } {
    return {
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      isRunning: this.isRunning
    };
  }

  /**
   * クリーンアップ
   */
  async cleanup(): Promise<void> {
    this.stop();
    await this.progressUpdater.cleanup();
    this.sqsClient.destroy();
    logger.info('SQSConsumer cleaned up');
  }
}
