/**
 * Error Handling Utilities
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import { ErrorCode, ApiErrorResponse } from '../types';
import { Logger } from '../services/logger.service';

const logger = new Logger('ErrorHandler');

/**
 * カスタムエラークラス
 */
export class OpenSearchError extends Error {
  constructor(
    message: string,
    public statusCode: number = 503,
    public errorCode: ErrorCode = ErrorCode.OPENSEARCH_UNAVAILABLE
  ) {
    super(message);
    this.name = 'OpenSearchError';
  }
}

export class OpenSearchIndexNotFoundError extends OpenSearchError {
  constructor(message: string = 'OpenSearch index not found') {
    super(message, 404, ErrorCode.OPENSEARCH_INDEX_NOT_FOUND);
    this.name = 'OpenSearchIndexNotFoundError';
  }
}

export class OpenSearchUnavailableError extends OpenSearchError {
  constructor(message: string = 'OpenSearch service is temporarily unavailable') {
    super(message, 503, ErrorCode.OPENSEARCH_UNAVAILABLE);
    this.name = 'OpenSearchUnavailableError';
  }
}

/**
 * エラーをAPIレスポンスに変換
 */
export function handleError(error: any): APIGatewayProxyResult {
  logger.error('Error occurred', { error: error.message, stack: error.stack });

  // ValidationError
  if (error.name === 'ValidationError') {
    return createErrorResponse(
      400,
      ErrorCode.INVALID_QUERY,
      error.message,
      {
        field: error.field,
        reason: error.reason,
      }
    );
  }

  // OpenSearchIndexNotFoundError
  if (error instanceof OpenSearchIndexNotFoundError) {
    return createErrorResponse(
      404,
      ErrorCode.OPENSEARCH_INDEX_NOT_FOUND,
      error.message
    );
  }

  // OpenSearchUnavailableError
  if (error instanceof OpenSearchUnavailableError) {
    return createErrorResponse(
      503,
      ErrorCode.OPENSEARCH_UNAVAILABLE,
      error.message
    );
  }

  // OpenSearchError (一般)
  if (error instanceof OpenSearchError) {
    return createErrorResponse(
      error.statusCode,
      error.errorCode,
      error.message
    );
  }

  // その他のエラー
  const isDevelopment = process.env.NODE_ENV === 'development';
  return createErrorResponse(
    500,
    ErrorCode.INTERNAL_ERROR,
    'Internal server error',
    isDevelopment ? { originalError: error.message } : undefined
  );
}

/**
 * エラーレスポンスを作成
 */
export function createErrorResponse(
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, any>
): APIGatewayProxyResult {
  const errorResponse: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: JSON.stringify(errorResponse),
  };
}

/**
 * 成功レスポンスを作成
 */
export function createSuccessResponse(data: any): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'private, max-age=60',
    },
    body: JSON.stringify({
      success: true,
      data,
    }),
  };
}
