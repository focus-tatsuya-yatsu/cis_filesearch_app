/**
 * 監査ログユーティリティ
 * セキュリティイベントの構造化ログを記録
 */

import { CloudWatchLogsClient, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { maskIP } from './auth';

/**
 * 監査ログの構造
 */
export interface AuditLog {
  timestamp: string;
  eventType: string;
  userId?: string;
  ipAddress: string;
  userAgent: string;
  resource: string;
  action: string;
  result: 'success' | 'failure';
  details?: Record<string, any>;
  errorCode?: string;
  errorMessage?: string;
  processingTime?: number; // ミリ秒
}

/**
 * CloudWatch Logsクライアント（シングルトン）
 */
let cloudWatchClient: CloudWatchLogsClient | null = null;

/**
 * CloudWatch Logsクライアントを取得
 */
function getCloudWatchClient(): CloudWatchLogsClient {
  if (!cloudWatchClient) {
    cloudWatchClient = new CloudWatchLogsClient({
      region: process.env.AWS_REGION || 'ap-northeast-1',
    });
  }
  return cloudWatchClient;
}

/**
 * CloudWatchへの監査ログ送信
 */
export async function sendAuditLog(log: AuditLog): Promise<void> {
  // 開発環境ではコンソールに出力
  if (process.env.NODE_ENV === 'development') {
    console.log('[Audit Log]', JSON.stringify(log, null, 2));
    return;
  }

  try {
    const client = getCloudWatchClient();
    const logGroupName = process.env.AUDIT_LOG_GROUP || '/aws/lambda/cis-search-api-audit';
    const logStreamName = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    await client.send(
      new PutLogEventsCommand({
        logGroupName,
        logStreamName,
        logEvents: [
          {
            timestamp: Date.now(),
            message: JSON.stringify(log),
          },
        ],
      })
    );
  } catch (error) {
    console.error('[Audit Log] Failed to send audit log:', error);
    // フォールバック: console.logに出力（CloudWatch Logsが自動収集）
    console.log('[Audit Log]', JSON.stringify(log, null, 2));
  }
}

/**
 * 成功時の監査ログを作成
 */
export async function logSuccess(params: {
  eventType: string;
  userId?: string;
  ipAddress: string;
  userAgent: string;
  resource: string;
  action: string;
  details?: Record<string, any>;
  processingTime?: number;
}): Promise<void> {
  const log: AuditLog = {
    timestamp: new Date().toISOString(),
    eventType: params.eventType,
    userId: params.userId,
    ipAddress: maskIP(params.ipAddress), // IPマスキング（GDPR準拠）
    userAgent: params.userAgent.substring(0, 200), // 長すぎるUser-Agentを切り詰め
    resource: params.resource,
    action: params.action,
    result: 'success',
    details: params.details,
    processingTime: params.processingTime,
  };

  await sendAuditLog(log);
}

/**
 * 失敗時の監査ログを作成
 */
export async function logFailure(params: {
  eventType: string;
  userId?: string;
  ipAddress: string;
  userAgent: string;
  resource: string;
  action: string;
  errorCode: string;
  errorMessage?: string;
  processingTime?: number;
}): Promise<void> {
  const log: AuditLog = {
    timestamp: new Date().toISOString(),
    eventType: params.eventType,
    userId: params.userId,
    ipAddress: maskIP(params.ipAddress),
    userAgent: params.userAgent.substring(0, 200),
    resource: params.resource,
    action: params.action,
    result: 'failure',
    errorCode: params.errorCode,
    errorMessage: params.errorMessage?.substring(0, 500), // エラーメッセージを切り詰め
    processingTime: params.processingTime,
  };

  await sendAuditLog(log);
}

/**
 * 認証失敗ログ
 */
export async function logAuthFailure(params: {
  ipAddress: string;
  userAgent: string;
  resource: string;
  reason: string;
}): Promise<void> {
  await logFailure({
    eventType: 'AUTHENTICATION_FAILURE',
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    resource: params.resource,
    action: 'AUTHENTICATE',
    errorCode: 'INVALID_TOKEN',
    errorMessage: params.reason,
  });
}

/**
 * レート制限超過ログ
 */
export async function logRateLimitExceeded(params: {
  userId?: string;
  ipAddress: string;
  userAgent: string;
  resource: string;
  limitType: string; // 'ip' | 'user' | 'global'
}): Promise<void> {
  await logFailure({
    eventType: 'RATE_LIMIT_EXCEEDED',
    userId: params.userId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    resource: params.resource,
    action: 'REQUEST',
    errorCode: 'RATE_LIMIT_EXCEEDED',
    errorMessage: `Rate limit exceeded for ${params.limitType}`,
  });
}

/**
 * 画像アップロードログ
 */
export async function logImageUpload(params: {
  userId?: string;
  ipAddress: string;
  userAgent: string;
  fileSize: number;
  fileType: string;
  cached: boolean;
  processingTime: number;
}): Promise<void> {
  await logSuccess({
    eventType: 'IMAGE_EMBEDDING_REQUEST',
    userId: params.userId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    resource: '/api/image-embedding',
    action: 'POST',
    details: {
      fileSize: params.fileSize,
      fileType: params.fileType,
      cached: params.cached,
    },
    processingTime: params.processingTime,
  });
}

/**
 * 検索クエリログ
 */
export async function logSearchQuery(params: {
  userId?: string;
  ipAddress: string;
  userAgent: string;
  queryLength: number;
  resultCount: number;
  processingTime: number;
  hasImageSearch: boolean;
}): Promise<void> {
  await logSuccess({
    eventType: 'SEARCH_REQUEST',
    userId: params.userId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    resource: '/api/search',
    action: 'POST',
    details: {
      queryLength: params.queryLength,
      resultCount: params.resultCount,
      hasImageSearch: params.hasImageSearch,
    },
    processingTime: params.processingTime,
  });
}

/**
 * セキュリティイベントログ（疑わしいアクティビティ）
 */
export async function logSecurityEvent(params: {
  eventType: string;
  userId?: string;
  ipAddress: string;
  userAgent: string;
  resource: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  details?: Record<string, any>;
}): Promise<void> {
  const log: AuditLog = {
    timestamp: new Date().toISOString(),
    eventType: params.eventType,
    userId: params.userId,
    ipAddress: maskIP(params.ipAddress),
    userAgent: params.userAgent.substring(0, 200),
    resource: params.resource,
    action: 'SECURITY_EVENT',
    result: 'failure',
    errorCode: params.severity.toUpperCase(),
    errorMessage: params.description,
    details: params.details,
  };

  await sendAuditLog(log);

  // 重大なセキュリティイベントの場合はアラートを送信
  if (params.severity === 'critical' || params.severity === 'high') {
    console.error('[Security Alert]', JSON.stringify(log, null, 2));
    // TODO: SNS経由でアラート送信
  }
}
