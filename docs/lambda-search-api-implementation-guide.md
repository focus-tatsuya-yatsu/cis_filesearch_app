# Lambda検索API実装ガイド - 完全版

## 📋 概要

このガイドは、Next.js API RoutesからLambda関数への検索API移行の完全な実装手順を提供します。

**目標アーキテクチャ**:
```
CloudFront → S3 (Static Frontend)
          ↓
   Browser JavaScript
          ↓
API Gateway (Cognito Authorizer)
          ↓
    Lambda (search-api)
          ↓
      OpenSearch
```

---

## 1. プロジェクト構造

```bash
backend/lambda/search-api/
├── src/
│   ├── handlers/
│   │   ├── searchHandler.ts           # メイン検索ハンドラー
│   │   ├── similarImageHandler.ts     # 類似画像検索
│   │   └── fileDetailHandler.ts       # ファイル詳細取得
│   ├── services/
│   │   ├── OpenSearchService.ts       # OpenSearch接続・クエリ
│   │   ├── ValidationService.ts       # 入力バリデーション
│   │   ├── S3PresignService.ts        # S3 Presigned URL生成
│   │   └── AuditLogService.ts         # 検索ログ記録
│   ├── models/
│   │   ├── SearchQuery.ts             # 検索クエリ型定義
│   │   ├── SearchResult.ts            # 検索結果型定義
│   │   └── FileDocument.ts            # ファイルドキュメント型
│   ├── utils/
│   │   ├── logger.ts                  # CloudWatch Logs
│   │   ├── errors.ts                  # カスタムエラークラス
│   │   └── response.ts                # レスポンスビルダー
│   └── config/
│       └── opensearch.ts              # OpenSearch設定
├── tests/
│   ├── unit/
│   │   ├── searchHandler.test.ts
│   │   └── OpenSearchService.test.ts
│   └── integration/
│       └── api.test.ts
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

---

## 2. 依存関係のインストール

### package.json

```json
{
  "name": "cis-filesearch-search-api",
  "version": "1.0.0",
  "description": "Lambda search API for CIS File Search",
  "main": "dist/handlers/searchHandler.js",
  "scripts": {
    "build": "tsc && tsc-alias",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint src/**/*.ts",
    "deploy": "npm run build && serverless deploy"
  },
  "dependencies": {
    "@opensearch-project/opensearch": "^2.6.0",
    "@aws-sdk/client-s3": "^3.600.0",
    "@aws-sdk/client-dynamodb": "^3.600.0",
    "@aws-sdk/s3-request-presigner": "^3.600.0",
    "aws-lambda": "^1.0.7"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.138",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.4",
    "typescript": "^5.5.0",
    "tsc-alias": "^1.8.10",
    "eslint": "^8.57.0"
  }
}
```

---

## 3. 型定義

### src/models/SearchQuery.ts

```typescript
/**
 * 検索クエリパラメータ
 */
export interface SearchQuery {
  /** 検索キーワード */
  query?: string;

  /** 検索モード: AND/OR */
  searchMode?: 'and' | 'or';

  /** ファイルタイプフィルター */
  fileType?: string;

  /** 開始日 (ISO 8601) */
  dateFrom?: string;

  /** 終了日 (ISO 8601) */
  dateTo?: string;

  /** ファイルサイズ最小値 (bytes) */
  minSize?: number;

  /** ファイルサイズ最大値 (bytes) */
  maxSize?: number;

  /** ページ番号 (1-based) */
  page?: number;

  /** 1ページあたりの結果数 */
  limit?: number;

  /** ソート基準 */
  sortBy?: 'relevance' | 'date' | 'name' | 'size';

  /** ソート順 */
  sortOrder?: 'asc' | 'desc';

  /** ファイルパスフィルター（部分一致） */
  pathFilter?: string;
}

/**
 * 検索クエリバリデーション結果
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}
```

### src/models/FileDocument.ts

```typescript
/**
 * OpenSearchファイルドキュメント
 */
export interface FileDocument {
  /** ドキュメントID (S3 Key) */
  id: string;

  /** ファイル名 */
  file_name: string;

  /** ファイルパス */
  file_path: string;

  /** ファイルサイズ (bytes) */
  file_size: number;

  /** ファイルタイプ (拡張子) */
  file_type: string;

  /** MIMEタイプ */
  mime_type: string;

  /** 作成日時 */
  created_at: string;

  /** 更新日時 */
  updated_at: string;

  /** OCRテキスト */
  ocr_text?: string;

  /** サムネイルURL */
  thumbnail_url?: string;

  /** インデックス作成日時 */
  indexed_at: string;

  /** 検索スコア */
  score?: number;

  /** S3バケット名 */
  bucket?: string;

  /** S3キー */
  s3_key?: string;
}
```

### src/models/SearchResult.ts

```typescript
import { FileDocument } from './FileDocument';

/**
 * 検索結果
 */
export interface SearchResult {
  /** 検索結果ドキュメント */
  results: FileDocument[];

  /** 総ヒット数 */
  total: number;

  /** 検索実行時間 (ms) */
  took: number;

  /** 集約結果 (オプション) */
  aggregations?: {
    fileTypes?: { [key: string]: number };
    dateHistogram?: Array<{ date: string; count: number }>;
  };
}
```

---

## 4. サービス層実装

### src/services/ValidationService.ts

```typescript
import { SearchQuery, ValidationResult } from '@/models';

export class ValidationService {
  /**
   * 検索クエリをバリデーション
   */
  static validateSearchQuery(params: Record<string, any>): ValidationResult {
    const errors: string[] = [];

    // ページ番号のバリデーション
    if (params.page) {
      const page = parseInt(params.page);
      if (isNaN(page) || page < 1) {
        errors.push('Page must be a positive integer');
      }
    }

    // 件数制限のバリデーション
    if (params.limit) {
      const limit = parseInt(params.limit);
      if (isNaN(limit) || limit < 1 || limit > 100) {
        errors.push('Limit must be between 1 and 100');
      }
    }

    // 日付範囲のバリデーション
    if (params.dateFrom && !this.isValidISODate(params.dateFrom)) {
      errors.push('Invalid dateFrom format (ISO 8601 required)');
    }

    if (params.dateTo && !this.isValidISODate(params.dateTo)) {
      errors.push('Invalid dateTo format (ISO 8601 required)');
    }

    // 日付の前後関係チェック
    if (params.dateFrom && params.dateTo) {
      if (new Date(params.dateFrom) > new Date(params.dateTo)) {
        errors.push('dateFrom must be before dateTo');
      }
    }

    // ファイルサイズのバリデーション
    if (params.minSize && (isNaN(params.minSize) || params.minSize < 0)) {
      errors.push('minSize must be a non-negative number');
    }

    if (params.maxSize && (isNaN(params.maxSize) || params.maxSize < 0)) {
      errors.push('maxSize must be a non-negative number');
      }

    // サイズ範囲チェック
    if (params.minSize && params.maxSize && params.minSize > params.maxSize) {
      errors.push('minSize must be less than maxSize');
    }

    // 検索パラメータ存在チェック
    if (!params.q && !params.fileType && !params.dateFrom && !params.dateTo && !params.pathFilter) {
      errors.push('At least one search parameter is required');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * ISO 8601形式の日付バリデーション
   */
  private static isValidISODate(dateString: string): boolean {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * SQLインジェクション防止（OpenSearchクエリ）
   */
  static sanitizeSearchQuery(query: string): string {
    // 特殊文字をエスケープ
    return query.replace(/[\\+\-=&|><!(){}[\]^"~*?:/]/g, '\\$&');
  }
}
```

---

### src/services/OpenSearchService.ts

```typescript
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SearchQuery, SearchResult, FileDocument } from '@/models';
import { createLogger } from '@/utils/logger';
import { OpenSearchError } from '@/utils/errors';

const logger = createLogger('OpenSearchService');

export interface OpenSearchConfig {
  endpoint: string;
  region: string;
  indexName?: string;
  timeout?: number;
}

export class OpenSearchService {
  private client: Client;
  private indexName: string;

  constructor(config: OpenSearchConfig) {
    this.indexName = config.indexName || 'files';

    // AWS Signature V4でOpenSearchに接続
    this.client = new Client({
      ...AwsSigv4Signer({
        region: config.region,
        service: 'es',
        getCredentials: () => {
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        },
      }),
      node: config.endpoint,
      requestTimeout: config.timeout || 30000,
      ssl: {
        rejectUnauthorized: true,
      },
    });

    logger.info('OpenSearch client initialized', {
      endpoint: config.endpoint,
      index: this.indexName,
    });
  }

  /**
   * ファイル検索を実行
   */
  async search(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();

    try {
      const searchBody = this.buildSearchQuery(query);

      logger.debug('Executing search', { searchBody });

      const response = await this.client.search({
        index: this.indexName,
        body: searchBody,
      });

      const results = this.parseSearchResults(response.body);

      logger.info('Search completed', {
        query: query.query,
        total: results.total,
        took: response.body.took,
      });

      return results;

    } catch (error: any) {
      logger.error('Search failed', {
        error: error.message,
        query: query.query,
      });

      throw new OpenSearchError('Search execution failed', error);
    }
  }

  /**
   * OpenSearchクエリDSLを構築
   */
  private buildSearchQuery(query: SearchQuery): any {
    const { query: q, searchMode, fileType, dateFrom, dateTo, minSize, maxSize, pathFilter, page = 1, limit = 20, sortBy = 'relevance', sortOrder = 'desc' } = query;

    const searchBody: any = {
      from: (page - 1) * limit,
      size: limit,
      query: {
        bool: {
          must: [],
          filter: [],
          should: [],
        },
      },
      sort: this.buildSortClause(sortBy, sortOrder),
      // ハイライト設定
      highlight: {
        fields: {
          file_name: {},
          ocr_text: {
            fragment_size: 150,
            number_of_fragments: 3,
          },
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
      },
    };

    // テキスト検索クエリ
    if (q) {
      searchBody.query.bool.must.push({
        multi_match: {
          query: q,
          fields: [
            'file_name^3',      // ファイル名に最高のブースト
            'ocr_text^2',       // OCRテキストに中程度のブースト
            'file_path',        // パスに通常のブースト
          ],
          type: 'best_fields',
          operator: searchMode === 'and' ? 'and' : 'or',
          fuzziness: 'AUTO',   // あいまい検索
          prefix_length: 1,     // 最初の1文字は厳密一致
        },
      });
    }

    // ファイルタイプフィルター
    if (fileType) {
      searchBody.query.bool.filter.push({
        term: { 'file_type.keyword': fileType },
      });
    }

    // 日付範囲フィルター
    if (dateFrom || dateTo) {
      searchBody.query.bool.filter.push({
        range: {
          updated_at: {
            ...(dateFrom && { gte: dateFrom }),
            ...(dateTo && { lte: dateTo }),
          },
        },
      });
    }

    // ファイルサイズ範囲フィルター
    if (minSize !== undefined || maxSize !== undefined) {
      searchBody.query.bool.filter.push({
        range: {
          file_size: {
            ...(minSize !== undefined && { gte: minSize }),
            ...(maxSize !== undefined && { lte: maxSize }),
          },
        },
      });
    }

    // ファイルパスフィルター
    if (pathFilter) {
      searchBody.query.bool.filter.push({
        wildcard: {
          'file_path.keyword': `*${pathFilter}*`,
        },
      });
    }

    // 集約クエリ（ファイルタイプ別カウント）
    searchBody.aggs = {
      file_types: {
        terms: {
          field: 'file_type.keyword',
          size: 20,
        },
      },
      date_histogram: {
        date_histogram: {
          field: 'updated_at',
          calendar_interval: 'month',
        },
      },
    };

    return searchBody;
  }

  /**
   * ソート条件を構築
   */
  private buildSortClause(sortBy: string, sortOrder: 'asc' | 'desc'): any[] {
    switch (sortBy) {
      case 'date':
        return [{ updated_at: { order: sortOrder } }];
      case 'name':
        return [{ 'file_name.keyword': { order: sortOrder } }];
      case 'size':
        return [{ file_size: { order: sortOrder } }];
      case 'relevance':
      default:
        return [{ _score: { order: 'desc' } }];
    }
  }

  /**
   * 検索結果をパース
   */
  private parseSearchResults(responseBody: any): SearchResult {
    const hits = responseBody.hits.hits;

    const results: FileDocument[] = hits.map((hit: any) => ({
      id: hit._id,
      score: hit._score,
      ...hit._source,
      // ハイライト結果を追加
      highlights: hit.highlight,
    }));

    // 集約結果をパース
    const aggregations = responseBody.aggregations
      ? {
          fileTypes: this.parseFileTypeAggregation(responseBody.aggregations.file_types),
          dateHistogram: this.parseDateHistogram(responseBody.aggregations.date_histogram),
        }
      : undefined;

    return {
      results,
      total: responseBody.hits.total.value,
      took: responseBody.took,
      aggregations,
    };
  }

  /**
   * ファイルタイプ集約をパース
   */
  private parseFileTypeAggregation(agg: any): { [key: string]: number } {
    const result: { [key: string]: number } = {};
    agg.buckets.forEach((bucket: any) => {
      result[bucket.key] = bucket.doc_count;
    });
    return result;
  }

  /**
   * 日付ヒストグラムをパース
   */
  private parseDateHistogram(agg: any): Array<{ date: string; count: number }> {
    return agg.buckets.map((bucket: any) => ({
      date: bucket.key_as_string,
      count: bucket.doc_count,
    }));
  }

  /**
   * 類似画像検索 (k-NN)
   */
  async similarImageSearch(imageVector: number[], limit: number = 10): Promise<SearchResult> {
    try {
      const response = await this.client.search({
        index: 'images',
        body: {
          size: limit,
          query: {
            knn: {
              image_vector: {
                vector: imageVector,
                k: limit,
              },
            },
          },
        },
      });

      return this.parseSearchResults(response.body);

    } catch (error: any) {
      logger.error('Similar image search failed', { error: error.message });
      throw new OpenSearchError('Similar image search failed', error);
    }
  }

  /**
   * ヘルスチェック
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.cluster.health();
      return response.body.status !== 'red';
    } catch (error) {
      return false;
    }
  }
}
```

---

### src/services/S3PresignService.ts

```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createLogger } from '@/utils/logger';

const logger = createLogger('S3PresignService');

export class S3PresignService {
  private s3Client: S3Client;
  private bucket: string;

  constructor(bucket: string, region: string = 'ap-northeast-1') {
    this.bucket = bucket;
    this.s3Client = new S3Client({ region });
  }

  /**
   * ファイルダウンロード用のPresigned URL生成
   */
  async getDownloadUrl(s3Key: string, expiresIn: number = 900): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      });

      const url = await getSignedUrl(this.s3Client, command, {
        expiresIn, // デフォルト15分
      });

      logger.info('Generated presigned URL', { s3Key, expiresIn });

      return url;

    } catch (error: any) {
      logger.error('Failed to generate presigned URL', {
        error: error.message,
        s3Key,
      });
      throw error;
    }
  }
}
```

---

### src/services/AuditLogService.ts

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SearchQuery } from '@/models';
import { createLogger } from '@/utils/logger';

const logger = createLogger('AuditLogService');

export interface SearchLogEntry {
  logId: string;
  userId: string;
  userEmail: string;
  query: SearchQuery;
  totalResults: number;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditLogService {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(tableName: string = 'cis-filesearch-search-logs', region: string = 'ap-northeast-1') {
    const client = new DynamoDBClient({ region });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = tableName;
  }

  /**
   * 検索ログを記録
   */
  async logSearch(entry: SearchLogEntry): Promise<void> {
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            logId: entry.logId,
            userId: entry.userId,
            userEmail: entry.userEmail,
            query: JSON.stringify(entry.query),
            totalResults: entry.totalResults,
            timestamp: entry.timestamp,
            ipAddress: entry.ipAddress,
            userAgent: entry.userAgent,
            ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90日後に自動削除
          },
        })
      );

      logger.debug('Search log saved', { logId: entry.logId });

    } catch (error: any) {
      logger.error('Failed to save search log', {
        error: error.message,
        logId: entry.logId,
      });
      // 検索ログの失敗は検索API自体を失敗させない
    }
  }
}
```

---

## 5. Lambda Handlerの完全実装

### src/handlers/searchHandler.ts

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { OpenSearchService } from '@/services/OpenSearchService';
import { ValidationService } from '@/services/ValidationService';
import { AuditLogService } from '@/services/AuditLogService';
import { SearchQuery, SearchResult } from '@/models';
import { createLogger } from '@/utils/logger';
import { createSuccessResponse, createErrorResponse } from '@/utils/response';
import { AppError } from '@/utils/errors';

const logger = createLogger('SearchHandler');

// 環境変数から設定を読み込み
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT!;
const AWS_REGION = process.env.AWS_REGION || 'ap-northeast-1';
const SEARCH_LOGS_TABLE = process.env.SEARCH_LOGS_TABLE || 'cis-filesearch-search-logs';

// サービスのシングルトンインスタンス（コールド スタート最適化）
let openSearchService: OpenSearchService;
let auditLogService: AuditLogService;

/**
 * 初期化関数（コールドスタート時のみ実行）
 */
function initializeServices() {
  if (!openSearchService) {
    openSearchService = new OpenSearchService({
      endpoint: OPENSEARCH_ENDPOINT,
      region: AWS_REGION,
    });
  }

  if (!auditLogService) {
    auditLogService = new AuditLogService(SEARCH_LOGS_TABLE, AWS_REGION);
  }
}

/**
 * Lambda Handler: ファイル検索API
 * GET /search?q={query}&fileType={type}&page={page}&limit={limit}
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  // リクエストIDをロガーに設定
  logger.setRequestId(context.requestId);

  logger.info('Search request received', {
    requestId: context.requestId,
    path: event.path,
    queryParams: event.queryStringParameters,
  });

  try {
    // サービスの初期化（コールドスタート時のみ）
    initializeServices();

    // 1. クエリパラメータを取得
    const queryParams = event.queryStringParameters || {};

    // 2. バリデーション
    const validationResult = ValidationService.validateSearchQuery(queryParams);

    if (!validationResult.isValid) {
      logger.warn('Validation failed', { errors: validationResult.errors });
      return createErrorResponse(400, 'INVALID_QUERY', validationResult.errors.join(', '));
    }

    // 3. 検索クエリを構築
    const searchQuery: SearchQuery = {
      query: queryParams.q ? ValidationService.sanitizeSearchQuery(queryParams.q) : undefined,
      searchMode: (queryParams.searchMode as 'and' | 'or') || 'or',
      fileType: queryParams.fileType,
      dateFrom: queryParams.dateFrom,
      dateTo: queryParams.dateTo,
      minSize: queryParams.minSize ? parseInt(queryParams.minSize) : undefined,
      maxSize: queryParams.maxSize ? parseInt(queryParams.maxSize) : undefined,
      pathFilter: queryParams.pathFilter,
      page: parseInt(queryParams.page || '1'),
      limit: parseInt(queryParams.limit || '20'),
      sortBy: (queryParams.sortBy as any) || 'relevance',
      sortOrder: (queryParams.sortOrder as 'asc' | 'desc') || 'desc',
    };

    // 4. ユーザー情報を取得 (Cognito Claims)
    const userId = event.requestContext.authorizer?.claims?.sub || 'anonymous';
    const userEmail = event.requestContext.authorizer?.claims?.email || '';

    logger.info('User authenticated', { userId, userEmail });

    // 5. OpenSearchで検索実行
    const startTime = Date.now();
    const searchResult: SearchResult = await openSearchService.search(searchQuery);
    const searchDuration = Date.now() - startTime;

    logger.info('Search completed', {
      userId,
      query: searchQuery.query,
      totalResults: searchResult.total,
      duration: searchDuration,
    });

    // 6. 検索ログを記録 (非同期、エラーは無視)
    auditLogService
      .logSearch({
        logId: context.requestId,
        userId,
        userEmail,
        query: searchQuery,
        totalResults: searchResult.total,
        timestamp: new Date().toISOString(),
        ipAddress: event.requestContext.identity?.sourceIp,
        userAgent: event.headers['User-Agent'],
      })
      .catch((error) => {
        logger.error('Failed to log search', { error: error.message });
      });

    // 7. レスポンスを構築
    const response = {
      results: searchResult.results,
      pagination: {
        total: searchResult.total,
        page: searchQuery.page,
        limit: searchQuery.limit,
        totalPages: Math.ceil(searchResult.total / searchQuery.limit!),
      },
      query: searchQuery,
      took: searchResult.took,
      requestId: context.requestId,
      aggregations: searchResult.aggregations,
    };

    return createSuccessResponse(response, {
      'Cache-Control': 'private, max-age=60',
    });

  } catch (error: any) {
    logger.error('Search failed', {
      error: error.message,
      stack: error.stack,
    });

    // エラーハンドリング
    if (error instanceof AppError) {
      return createErrorResponse(error.statusCode, error.code, error.message);
    }

    if (error.name === 'ConnectionError') {
      return createErrorResponse(503, 'OPENSEARCH_UNAVAILABLE', 'Search service is temporarily unavailable');
    }

    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
};
```

---

## 6. ユーティリティ実装

### src/utils/response.ts

```typescript
import { APIGatewayProxyResult } from 'aws-lambda';

/**
 * 成功レスポンスを生成
 */
export function createSuccessResponse(
  data: any,
  additionalHeaders?: Record<string, string>
): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'true',
      ...additionalHeaders,
    },
    body: JSON.stringify({
      success: true,
      data,
    }),
  };
}

/**
 * エラーレスポンスを生成
 */
export function createErrorResponse(
  statusCode: number,
  code: string,
  message: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'true',
    },
    body: JSON.stringify({
      success: false,
      error: {
        code,
        message,
      },
    }),
  };
}
```

### src/utils/logger.ts

```typescript
export interface LogContext {
  requestId?: string;
  userId?: string;
  [key: string]: any;
}

class Logger {
  private context: LogContext = {};
  private serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  setRequestId(requestId: string) {
    this.context.requestId = requestId;
  }

  setUserId(userId: string) {
    this.context.userId = userId;
  }

  private log(level: string, message: string, meta?: any) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: this.serviceName,
        message,
        ...this.context,
        ...meta,
      })
    );
  }

  info(message: string, meta?: any) {
    this.log('INFO', message, meta);
  }

  error(message: string, meta?: any) {
    this.log('ERROR', message, meta);
  }

  warn(message: string, meta?: any) {
    this.log('WARN', message, meta);
  }

  debug(message: string, meta?: any) {
    this.log('DEBUG', message, meta);
  }
}

export function createLogger(serviceName: string): Logger {
  return new Logger(serviceName);
}
```

### src/utils/errors.ts

```typescript
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class OpenSearchError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(503, 'OPENSEARCH_ERROR', message);
    this.name = 'OpenSearchError';
    if (originalError) {
      this.stack = originalError.stack;
    }
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, 'VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}
```

---

## 7. デプロイ設定

### serverless.yml (Serverless Framework使用の場合)

```yaml
service: cis-filesearch-search-api

provider:
  name: aws
  runtime: nodejs20.x
  region: ${opt:region, 'ap-northeast-1'}
  stage: ${opt:stage, 'prod'}
  memorySize: 512
  timeout: 30
  logRetentionInDays: 7

  environment:
    OPENSEARCH_ENDPOINT: ${env:OPENSEARCH_ENDPOINT}
    AWS_REGION: ${self:provider.region}
    SEARCH_LOGS_TABLE: cis-filesearch-search-logs-${self:provider.stage}

  iam:
    role:
      statements:
        # OpenSearch接続権限
        - Effect: Allow
          Action:
            - es:ESHttpGet
            - es:ESHttpPost
          Resource: 'arn:aws:es:${self:provider.region}:*:domain/cis-filesearch-opensearch-prod/*'

        # DynamoDB検索ログ書き込み権限
        - Effect: Allow
          Action:
            - dynamodb:PutItem
          Resource: 'arn:aws:dynamodb:${self:provider.region}:*:table/cis-filesearch-search-logs-${self:provider.stage}'

functions:
  search:
    handler: dist/handlers/searchHandler.handler
    events:
      - http:
          path: search
          method: GET
          cors: true
          authorizer:
            type: COGNITO_USER_POOLS
            authorizerId:
              Ref: ApiGatewayAuthorizer

  similarImageSearch:
    handler: dist/handlers/similarImageHandler.handler
    events:
      - http:
          path: search/similar-images
          method: POST
          cors: true
          authorizer:
            type: COGNITO_USER_POOLS
            authorizerId:
              Ref: ApiGatewayAuthorizer

resources:
  Resources:
    # Cognito Authorizer
    ApiGatewayAuthorizer:
      Type: AWS::ApiGateway::Authorizer
      Properties:
        Name: cognito-authorizer
        Type: COGNITO_USER_POOLS
        IdentitySource: method.request.header.Authorization
        RestApiId:
          Ref: ApiGatewayRestApi
        ProviderARNs:
          - ${env:COGNITO_USER_POOL_ARN}

    # 検索ログテーブル
    SearchLogsTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: cis-filesearch-search-logs-${self:provider.stage}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: logId
            AttributeType: S
          - AttributeName: userId
            AttributeType: S
        KeySchema:
          - AttributeName: logId
            KeyType: HASH
        GlobalSecondaryIndexes:
          - IndexName: userId-index
            KeySchema:
              - AttributeName: userId
                KeyType: HASH
            Projection:
              ProjectionType: ALL
        TimeToLiveSpecification:
          Enabled: true
          AttributeName: ttl

plugins:
  - serverless-plugin-typescript
  - serverless-offline
```

---

## 8. テスト実装

### tests/unit/searchHandler.test.ts

```typescript
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '@/handlers/searchHandler';

// Mock dependencies
jest.mock('@/services/OpenSearchService');
jest.mock('@/services/AuditLogService');

describe('searchHandler', () => {
  const mockEvent: Partial<APIGatewayProxyEvent> = {
    queryStringParameters: {
      q: 'test query',
      page: '1',
      limit: '20',
    },
    requestContext: {
      requestId: 'test-request-id',
      authorizer: {
        claims: {
          sub: 'user-123',
          email: 'user@example.com',
        },
      },
    } as any,
  };

  const mockContext: Partial<Context> = {
    requestId: 'test-request-id',
  };

  it('should return search results', async () => {
    const result = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('results');
    expect(body.data).toHaveProperty('pagination');
  });

  it('should return validation error for invalid parameters', async () => {
    const invalidEvent = {
      ...mockEvent,
      queryStringParameters: {
        page: '-1', // Invalid
      },
    };

    const result = await handler(invalidEvent as APIGatewayProxyEvent, mockContext as Context);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_QUERY');
  });
});
```

---

## 9. デプロイ手順

### ステップ1: ビルド

```bash
cd backend/lambda/search-api
npm install
npm run build
```

### ステップ2: Serverless Frameworkでデプロイ

```bash
# 環境変数を設定
export OPENSEARCH_ENDPOINT=https://search-cis-filesearch-xxxx.ap-northeast-1.es.amazonaws.com
export COGNITO_USER_POOL_ARN=arn:aws:cognito-idp:ap-northeast-1:123456789012:userpool/ap-northeast-1_xxxxxxxxx

# デプロイ
serverless deploy --stage prod --region ap-northeast-1
```

### ステップ3: API Gatewayエンドポイント確認

```bash
# デプロイ後に表示されるエンドポイントURLをメモ
# 例: https://xxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/search
```

---

## 10. フロントエンド統合

### src/lib/api/search.ts (フロントエンド側)

```typescript
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL!;

export interface SearchParams {
  q?: string;
  fileType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
}

export async function searchFiles(params: SearchParams) {
  // Cognito JWTトークン取得
  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken?.toString();

  if (!idToken) {
    throw new Error('User not authenticated');
  }

  // クエリパラメータを構築
  const queryString = new URLSearchParams(
    Object.entries(params)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)])
  ).toString();

  const response = await fetch(`${API_BASE_URL}/search?${queryString}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error.message || 'Search failed');
  }

  return response.json();
}
```

---

## まとめ

このガイドに従うことで、Next.js API RoutesからLambda関数への完全な移行が可能です。

**主なメリット**:
- ✅ Cognito認証によるセキュリティ強化
- ✅ スケーラビリティの向上 (Lambda自動スケール)
- ✅ CloudFront + S3 Staticとの統合
- ✅ 検索ログの自動記録
- ✅ エラーハンドリングとモニタリングの強化

**次のステップ**: `/docs/ec2-autoscaling-architecture-review.md` の優先度付き改善リストに従って実装を進めてください。
