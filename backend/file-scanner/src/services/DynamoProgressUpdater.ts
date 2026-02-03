/**
 * DynamoDB Progress Updater Service
 * SQS Consumerから呼び出され、同期進捗をDynamoDBに更新するサービス
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SyncProgress, SyncStatus, SyncResult } from '@/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('DynamoProgressUpdater');

/**
 * DynamoProgressUpdaterの設定
 */
export interface DynamoProgressUpdaterConfig {
  /**
   * AWSリージョン
   */
  region?: string;

  /**
   * DynamoDBテーブル名
   */
  tableName: string;

  /**
   * AWS認証情報（オプション）
   */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

/**
 * DynamoProgressUpdater
 * 同期進捗をDynamoDBに更新
 */
export class DynamoProgressUpdater {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: DynamoProgressUpdaterConfig) {
    this.tableName = config.tableName;

    const dynamoClient = new DynamoDBClient({
      region: config.region || 'ap-northeast-1',
      credentials: config.credentials
    });

    this.docClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: {
        removeUndefinedValues: true
      }
    });

    logger.info(`DynamoProgressUpdater initialized with table: ${this.tableName}`);
  }

  /**
   * ステータスを更新
   */
  async updateStatus(syncId: string, status: SyncStatus, errorMessage?: string): Promise<void> {
    const now = new Date().toISOString();

    const updateExpression = errorMessage
      ? 'SET #status = :status, updatedAt = :now, errorMessage = :error'
      : 'SET #status = :status, updatedAt = :now';

    const expressionAttributeValues: Record<string, any> = {
      ':status': status,
      ':now': now
    };

    if (errorMessage) {
      expressionAttributeValues[':error'] = errorMessage;
    }

    try {
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { syncId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: expressionAttributeValues
      }));

      logger.info(`Updated sync ${syncId} status to ${status}`);
    } catch (error) {
      logger.error(`Failed to update status for sync ${syncId}:`, error);
      throw error;
    }
  }

  /**
   * 進捗を更新
   */
  async updateProgress(
    syncId: string,
    progress: {
      current: number;
      total: number;
      currentNas?: string;
      processedFiles?: number;
      errors?: number;
    }
  ): Promise<void> {
    const now = new Date().toISOString();

    try {
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { syncId },
        UpdateExpression: 'SET progress = :progress, updatedAt = :now',
        ExpressionAttributeValues: {
          ':progress': progress,
          ':now': now
        }
      }));

      logger.debug(`Updated progress for sync ${syncId}: ${progress.current}/${progress.total}`);
    } catch (error) {
      logger.error(`Failed to update progress for sync ${syncId}:`, error);
      throw error;
    }
  }

  /**
   * 結果を更新して完了
   */
  async updateResult(syncId: string, result: SyncResult): Promise<void> {
    const now = new Date().toISOString();

    try {
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { syncId },
        UpdateExpression: 'SET #status = :status, #result = :result, updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#result': 'result'
        },
        ExpressionAttributeValues: {
          ':status': 'completed' as SyncStatus,
          ':result': result,
          ':now': now
        }
      }));

      logger.info(`Sync ${syncId} completed with result:`, result);
    } catch (error) {
      logger.error(`Failed to update result for sync ${syncId}:`, error);
      throw error;
    }
  }

  /**
   * 同期情報を取得
   */
  async getSync(syncId: string): Promise<SyncProgress | null> {
    try {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { syncId }
      }));

      return result.Item as SyncProgress | null;
    } catch (error) {
      logger.error(`Failed to get sync ${syncId}:`, error);
      throw error;
    }
  }

  /**
   * クリーンアップ
   */
  async cleanup(): Promise<void> {
    // DynamoDBクライアントは自動的にクリーンアップされるため、
    // 特別な処理は不要
    logger.info('DynamoProgressUpdater cleaned up');
  }
}
