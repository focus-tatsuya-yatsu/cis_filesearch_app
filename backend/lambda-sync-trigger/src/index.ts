import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context
} from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL || '';
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || '';

interface SyncRequest {
  nasServers?: string[];
  fullSync?: boolean;
  triggeredBy?: string;
}

interface SyncProgress {
  syncId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  nasServers: string[];
  fullSync: boolean;
  triggeredBy: string;
  progress?: {
    current: number;
    total: number;
    currentNas?: string;
    processedFiles?: number;
    errors?: number;
  };
  result?: {
    newFiles: number;
    changedFiles: number;
    deletedFiles: number;
    syncedFiles: number;
    errors: number;
  };
  errorMessage?: string;
  ttl: number;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json'
};

const response = (statusCode: number, body: object): APIGatewayProxyResult => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body)
});

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const httpMethod = event.httpMethod;
  const path = event.path || event.resource;

  // Handle CORS preflight
  if (httpMethod === 'OPTIONS') {
    return response(200, { message: 'OK' });
  }

  try {
    // POST /sync - Start a new sync
    if (httpMethod === 'POST' && path.endsWith('/sync')) {
      return await startSync(event);
    }

    // GET /sync/progress/{sync_id} - Get sync progress
    if (httpMethod === 'GET' && path.includes('/sync/progress/')) {
      const syncId = event.pathParameters?.sync_id || extractSyncId(path);
      if (!syncId) {
        return response(400, { error: 'Missing sync_id parameter' });
      }
      return await getProgress(syncId);
    }

    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error('Error:', error);
    return response(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

const extractSyncId = (path: string): string | null => {
  const match = path.match(/\/sync\/progress\/([^/]+)/);
  return match ? match[1] : null;
};

const startSync = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let requestBody: SyncRequest = {};

  if (event.body) {
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return response(400, { error: 'Invalid JSON body' });
    }
  }

  const syncId = randomUUID();
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours

  // Default to all NAS servers if not specified
  const nasServers = requestBody.nasServers || [
    'ts-server3',
    'ts-server5',
    'ts-server6',
    'ts-server7'
  ];

  const syncProgress: SyncProgress = {
    syncId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    nasServers,
    fullSync: requestBody.fullSync || false,
    triggeredBy: requestBody.triggeredBy || 'web-ui',
    progress: {
      current: 0,
      total: nasServers.length,
      processedFiles: 0,
      errors: 0
    },
    ttl
  };

  // Save to DynamoDB
  await docClient.send(new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: syncProgress
  }));

  // Send message to SQS
  const sqsMessage = {
    syncId,
    nasServers,
    fullSync: requestBody.fullSync || false,
    triggeredBy: requestBody.triggeredBy || 'web-ui',
    timestamp: now
  };

  await sqsClient.send(new SendMessageCommand({
    QueueUrl: SQS_QUEUE_URL,
    MessageBody: JSON.stringify(sqsMessage),
    MessageGroupId: 'sync-trigger',
    MessageDeduplicationId: syncId
  }));

  console.log(`Sync job created: ${syncId}`);

  return response(202, {
    message: 'Sync job created',
    syncId,
    status: 'pending',
    nasServers,
    fullSync: requestBody.fullSync || false
  });
};

const getProgress = async (syncId: string): Promise<APIGatewayProxyResult> => {
  const result = await docClient.send(new GetCommand({
    TableName: DYNAMODB_TABLE,
    Key: { syncId }
  }));

  if (!result.Item) {
    return response(404, {
      error: 'Sync job not found',
      syncId
    });
  }

  const progress = result.Item as SyncProgress;

  return response(200, {
    syncId: progress.syncId,
    status: progress.status,
    createdAt: progress.createdAt,
    updatedAt: progress.updatedAt,
    nasServers: progress.nasServers,
    fullSync: progress.fullSync,
    triggeredBy: progress.triggeredBy,
    progress: progress.progress,
    result: progress.result,
    errorMessage: progress.errorMessage
  });
};

// Export for testing
export { startSync, getProgress, SyncProgress, SyncRequest };
