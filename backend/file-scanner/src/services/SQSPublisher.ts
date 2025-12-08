/**
 * SQS Publisher Service
 * ファイル処理メッセージをAmazon SQSに送信するサービス
 */

import { SQSClient, SendMessageCommand, SendMessageBatchCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import pLimit, { LimitFunction } from 'p-limit';
import { FileMetadata, FileProcessingMessage, AWSConfig, S3UploadResult } from '@/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('SQSPublisher');

/**
 * SQSPublisherの設定
 */
export interface SQSPublisherConfig {
  /**
   * AWS設定
   */
  awsConfig: AWSConfig;

  /**
   * バッチサイズ（一度に送信するメッセージ数）
   */
  batchSize?: number;

  /**
   * リトライ回数
   */
  maxRetries?: number;

  /**
   * ドライランモード
   */
  dryRun?: boolean;
}

/**
 * SQSPublisher
 * ファイル処理メッセージをSQSキューに送信
 */
export class SQSPublisher {
  private readonly sqsClient: SQSClient;
  private readonly config: SQSPublisherConfig;
  private readonly limit: LimitFunction;
  private messageQueue: FileProcessingMessage[] = [];
  private publishedCount: number = 0;
  private failedCount: number = 0;

  constructor(config: SQSPublisherConfig) {
    this.config = {
      batchSize: config.batchSize || 10, // SQSの最大バッチサイズ
      maxRetries: config.maxRetries || 3,
      ...config
    };

    // 並行処理の制限
    this.limit = pLimit(5);

    // SQSクライアントを初期化
    this.sqsClient = new SQSClient({
      region: config.awsConfig.region,
      credentials: config.awsConfig.accessKeyId && config.awsConfig.secretAccessKey ? {
        accessKeyId: config.awsConfig.accessKeyId,
        secretAccessKey: config.awsConfig.secretAccessKey
      } : undefined,
      maxAttempts: this.config.maxRetries
    });
  }

  /**
   * ファイルアップロード完了メッセージを送信
   */
  async publishFileUploaded(
    metadata: FileMetadata,
    s3Result: S3UploadResult
  ): Promise<void> {
    const message: FileProcessingMessage = {
      eventType: 'FILE_UPLOADED',
      s3Bucket: s3Result.bucket,
      s3Key: s3Result.key,
      fileSize: metadata.size,
      mimeType: metadata.mimeType,
      originalPath: metadata.path,
      checksum: metadata.checksum,
      timestamp: new Date().toISOString(),
      metadata: {
        etag: s3Result.etag,
        versionId: s3Result.versionId,
        uploadDuration: s3Result.uploadDuration
      }
    };

    await this.publishMessage(message);
  }

  /**
   * ファイル変更メッセージを送信
   */
  async publishFileModified(
    metadata: FileMetadata,
    s3Key: string,
    s3Bucket: string
  ): Promise<void> {
    const message: FileProcessingMessage = {
      eventType: 'FILE_MODIFIED',
      s3Bucket,
      s3Key,
      fileSize: metadata.size,
      mimeType: metadata.mimeType,
      originalPath: metadata.path,
      checksum: metadata.checksum,
      timestamp: new Date().toISOString(),
      metadata: {
        modifiedAt: metadata.modifiedAt.toISOString()
      }
    };

    await this.publishMessage(message);
  }

  /**
   * ファイル削除メッセージを送信
   */
  async publishFileDeleted(
    filePath: string,
    s3Key: string,
    s3Bucket: string
  ): Promise<void> {
    const message: FileProcessingMessage = {
      eventType: 'FILE_DELETED',
      s3Bucket,
      s3Key,
      fileSize: 0,
      mimeType: 'application/octet-stream',
      originalPath: filePath,
      timestamp: new Date().toISOString()
    };

    await this.publishMessage(message);
  }

  /**
   * メッセージを送信
   */
  async publishMessage(message: FileProcessingMessage): Promise<void> {
    if (this.config.dryRun) {
      logger.info(`[DRY RUN] Would publish message: ${JSON.stringify(message)}`);
      return;
    }

    try {
      const command = new SendMessageCommand({
        QueueUrl: this.config.awsConfig.sqs.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          EventType: {
            DataType: 'String',
            StringValue: message.eventType
          },
          MimeType: {
            DataType: 'String',
            StringValue: message.mimeType
          },
          FileSize: {
            DataType: 'Number',
            StringValue: String(message.fileSize)
          }
        },
        MessageDeduplicationId: this.generateDeduplicationId(message),
        MessageGroupId: this.generateGroupId(message)
      });

      const response = await this.sqsClient.send(command);
      this.publishedCount++;

      logger.debug(`Published message: ${response.MessageId} for ${message.originalPath}`);

    } catch (error) {
      this.failedCount++;
      logger.error(`Failed to publish message for ${message.originalPath}:`, error);
      throw error;
    }
  }

  /**
   * メッセージをバッチで送信
   */
  async publishBatch(messages: FileProcessingMessage[]): Promise<void> {
    if (messages.length === 0) return;

    if (this.config.dryRun) {
      logger.info(`[DRY RUN] Would publish ${messages.length} messages in batch`);
      return;
    }

    logger.info(`Publishing batch of ${messages.length} messages`);

    // メッセージをバッチサイズごとに分割
    const batches: FileProcessingMessage[][] = [];
    for (let i = 0; i < messages.length; i += this.config.batchSize!) {
      batches.push(messages.slice(i, i + this.config.batchSize!));
    }

    // 各バッチを並行送信
    const batchPromises = batches.map((batch, index) =>
      this.limit(async () => {
        await this.sendBatch(batch, index);
      })
    );

    await Promise.all(batchPromises);

    logger.info(`Batch publish completed: ${this.publishedCount} succeeded, ${this.failedCount} failed`);
  }

  /**
   * バッチを送信
   */
  private async sendBatch(messages: FileProcessingMessage[], batchIndex: number): Promise<void> {
    try {
      const entries = messages.map((message, index) => ({
        Id: `${batchIndex}_${index}`,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          EventType: {
            DataType: 'String',
            StringValue: message.eventType
          },
          MimeType: {
            DataType: 'String',
            StringValue: message.mimeType
          }
        },
        MessageDeduplicationId: this.generateDeduplicationId(message),
        MessageGroupId: this.generateGroupId(message)
      }));

      const command = new SendMessageBatchCommand({
        QueueUrl: this.config.awsConfig.sqs.queueUrl,
        Entries: entries
      });

      const response = await this.sqsClient.send(command);

      // 成功したメッセージをカウント
      if (response.Successful) {
        this.publishedCount += response.Successful.length;
      }

      // 失敗したメッセージを処理
      if (response.Failed && response.Failed.length > 0) {
        this.failedCount += response.Failed.length;
        response.Failed.forEach(failure => {
          logger.error(`Failed to send message ${failure.Id}: ${failure.Message}`);
        });

        // 失敗したメッセージを再試行キューに追加
        const failedMessages = response.Failed.map(f => {
          if (!f.Id) return undefined;
          const parts = f.Id.split('_');
          if (parts.length < 2 || !parts[1]) return undefined;
          const index = parseInt(parts[1]);
          return messages[index];
        }).filter((msg): msg is FileProcessingMessage => msg !== undefined);

        // DLQに送信するか、再試行する
        if (this.config.awsConfig.sqs.dlqUrl) {
          await this.sendToDLQ(failedMessages);
        }
      }

      logger.debug(`Batch ${batchIndex} sent: ${response.Successful?.length || 0} succeeded, ${response.Failed?.length || 0} failed`);

    } catch (error) {
      this.failedCount += messages.length;
      logger.error(`Failed to send batch ${batchIndex}:`, error);
      throw error;
    }
  }

  /**
   * Dead Letter Queue に送信
   */
  private async sendToDLQ(messages: FileProcessingMessage[]): Promise<void> {
    if (!this.config.awsConfig.sqs.dlqUrl) return;

    logger.warn(`Sending ${messages.length} messages to DLQ`);

    for (const message of messages) {
      try {
        const command = new SendMessageCommand({
          QueueUrl: this.config.awsConfig.sqs.dlqUrl,
          MessageBody: JSON.stringify(message),
          MessageAttributes: {
            OriginalQueue: {
              DataType: 'String',
              StringValue: this.config.awsConfig.sqs.queueUrl
            },
            FailedAt: {
              DataType: 'String',
              StringValue: new Date().toISOString()
            }
          }
        });

        await this.sqsClient.send(command);
        logger.debug(`Message sent to DLQ for ${message.originalPath}`);

      } catch (error) {
        logger.error(`Failed to send message to DLQ for ${message.originalPath}:`, error);
      }
    }
  }

  /**
   * キューのメトリクスを取得
   */
  async getQueueMetrics(): Promise<{
    approximateNumberOfMessages: number;
    approximateNumberOfMessagesNotVisible: number;
    approximateNumberOfMessagesDelayed: number;
  }> {
    try {
      const command = new GetQueueAttributesCommand({
        QueueUrl: this.config.awsConfig.sqs.queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed'
        ]
      });

      const response = await this.sqsClient.send(command);

      return {
        approximateNumberOfMessages: parseInt(response.Attributes?.ApproximateNumberOfMessages || '0'),
        approximateNumberOfMessagesNotVisible: parseInt(response.Attributes?.ApproximateNumberOfMessagesNotVisible || '0'),
        approximateNumberOfMessagesDelayed: parseInt(response.Attributes?.ApproximateNumberOfMessagesDelayed || '0')
      };

    } catch (error) {
      logger.error('Failed to get queue metrics:', error);
      throw error;
    }
  }

  /**
   * 重複排除IDを生成
   */
  private generateDeduplicationId(message: FileProcessingMessage): string {
    const data = `${message.eventType}_${message.s3Key}_${message.timestamp}`;
    return Buffer.from(data).toString('base64').substring(0, 128);
  }

  /**
   * グループIDを生成
   */
  private generateGroupId(message: FileProcessingMessage): string {
    // ファイルパスの最初の部分をグループIDとして使用
    const pathParts = message.originalPath.split('/');
    return pathParts[0] || 'default';
  }

  /**
   * 統計情報を取得
   */
  getStatistics(): {
    publishedCount: number;
    failedCount: number;
    queuedCount: number;
  } {
    return {
      publishedCount: this.publishedCount,
      failedCount: this.failedCount,
      queuedCount: this.messageQueue.length
    };
  }

  /**
   * 統計をリセット
   */
  resetStatistics(): void {
    this.publishedCount = 0;
    this.failedCount = 0;
  }

  /**
   * クリーンアップ
   */
  async cleanup(): Promise<void> {
    // 残りのメッセージを送信
    if (this.messageQueue.length > 0) {
      await this.publishBatch(this.messageQueue);
      this.messageQueue = [];
    }

    // SQSクライアントを破棄
    this.sqsClient.destroy();

    logger.info('SQSPublisher cleaned up');
  }
}