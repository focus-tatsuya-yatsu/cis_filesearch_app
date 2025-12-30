/**
 * Lambda Handler for CIS Search API
 * API Gateway → Lambda → OpenSearch
 */

import { APIGatewayProxyResult, Context } from 'aws-lambda';
// 拡張版OpenSearchサービスを使用（503エラー対策）
import { searchDocuments } from './services/opensearch.service.enhanced';
import { validateSearchQuery } from './utils/validator';
import { handleError, createSuccessResponse } from './utils/error-handler';
import { Logger } from './services/logger.service';
import { SearchQuery } from './types';

const logger = new Logger('LambdaHandler');

/**
 * Lambda Handler
 * API GatewayからのHTTPリクエストを処理
 *
 * Supports both:
 * - REST API (APIGatewayProxyEvent)
 * - HTTP API v2 (APIGatewayProxyEventV2)
 */
export async function handler(
  event: any,
  context: Context
): Promise<APIGatewayProxyResult> {
  // Normalize event format (support both REST API and HTTP API v2)
  const httpMethod = event.httpMethod || event.requestContext?.http?.method || 'UNKNOWN';
  const path = event.path || event.requestContext?.http?.path || event.rawPath || '/';
  const queryParams = event.queryStringParameters || {};

  // リクエストID、タイムスタンプをログに記録
  logger.info('Lambda invoked', {
    requestId: context.awsRequestId,
    httpMethod,
    path,
    eventVersion: event.version || '1.0',
  });

  try {
    // OPTIONSリクエスト（CORS Preflight）
    if (httpMethod === 'OPTIONS') {
      return handleOptionsRequest();
    }

    // POSTリクエストの処理（画像検索用）
    if (httpMethod === 'POST') {
      return await handlePostRequest(event, context);
    }

    // GETリクエストの処理（テキスト検索用）
    if (httpMethod !== 'GET') {
      logger.warn('Method not allowed', { httpMethod, path });
      return createSuccessResponse({
        error: 'Method not allowed',
        code: 'METHOD_NOT_ALLOWED',
      });
    }

    // クエリパラメータは既に上で取得済み

    // バリデーション
    const searchQuery: SearchQuery = validateSearchQuery(queryParams);

    logger.info('Search query validated', { searchQuery });

    // OpenSearchで検索実行
    const searchResult = await searchDocuments(searchQuery);

    // ページネーション情報を構築
    const page = searchQuery.from! / searchQuery.size! + 1;
    const limit = searchQuery.size!;
    const totalPages = Math.ceil(searchResult.total / limit);

    // レスポンスを構築
    const responseData = {
      results: searchResult.results,
      pagination: {
        total: searchResult.total,
        page,
        limit,
        totalPages,
      },
      query: {
        q: searchQuery.query,
        searchMode: searchQuery.searchMode,
        fileType: searchQuery.fileType,
        dateFrom: searchQuery.dateFrom,
        dateTo: searchQuery.dateTo,
        sortBy: searchQuery.sortBy,
        sortOrder: searchQuery.sortOrder,
      },
      took: searchResult.took,
    };

    logger.info('Search completed successfully', {
      resultCount: searchResult.results.length,
      total: searchResult.total,
      took: searchResult.took,
    });

    return createSuccessResponse(responseData);
  } catch (error: any) {
    logger.error('Lambda execution failed', {
      error: error.message,
      stack: error.stack,
    });

    return handleError(error);
  }
}

/**
 * POSTリクエスト処理（画像検索用）
 */
async function handlePostRequest(
  event: any,
  _context: Context
): Promise<APIGatewayProxyResult> {
  try {
    // リクエストボディをパース
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    logger.info('POST request body parsed', {
      hasImageEmbedding: !!body.imageEmbedding,
      embeddingLength: body.imageEmbedding?.length,
    });

    // バリデーション（POSTリクエスト用）
    const searchQuery: SearchQuery = validateSearchQuery(body);

    logger.info('POST search query validated', {
      searchQuery: {
        ...searchQuery,
        imageEmbedding: searchQuery.imageEmbedding ? `[${searchQuery.imageEmbedding.length} dimensions]` : undefined
      }
    });

    // OpenSearchで検索実行
    const searchResult = await searchDocuments(searchQuery);

    // ページネーション情報を構築
    const page = Math.floor(searchQuery.from! / searchQuery.size!) + 1;
    const limit = searchQuery.size!;
    const totalPages = Math.ceil(searchResult.total / limit);

    // レスポンスを構築
    const responseData = {
      results: searchResult.results,
      pagination: {
        total: searchResult.total,
        page,
        limit,
        totalPages,
      },
      query: {
        q: searchQuery.query,
        searchMode: searchQuery.searchMode,
        searchType: searchQuery.imageEmbedding ? 'image' : 'text',
        fileType: searchQuery.fileType,
        dateFrom: searchQuery.dateFrom,
        dateTo: searchQuery.dateTo,
        sortBy: searchQuery.sortBy,
        sortOrder: searchQuery.sortOrder,
      },
      took: searchResult.took,
    };

    logger.info('POST search completed successfully', {
      resultCount: searchResult.results.length,
      total: searchResult.total,
      took: searchResult.took,
    });

    return createSuccessResponse(responseData);
  } catch (error: any) {
    logger.error('POST request failed', {
      error: error.message,
      stack: error.stack,
    });

    return handleError(error);
  }
}

/**
 * OPTIONSリクエスト（CORS Preflight）のハンドリング
 */
function handleOptionsRequest(): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '3600',
    },
    body: '',
  };
}
