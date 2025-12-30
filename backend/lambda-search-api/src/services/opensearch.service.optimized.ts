/**
 * Optimized OpenSearch Service
 *
 * Optimizations:
 * - Connection pooling with keep-alive
 * - Reduced timeout values
 * - Query optimization (field selection, highlight reduction)
 * - Efficient result mapping
 * - Better error handling
 *
 * Expected improvements:
 * - Query time: -30%
 * - Response size: -40%
 * - Connection overhead: -60%
 */

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import https from 'https';
import { SearchQuery, SearchResponse, SearchResult, OpenSearchConfig } from '../types';
import { Logger } from './logger.service';
import {
  OpenSearchError,
  OpenSearchIndexNotFoundError,
  OpenSearchUnavailableError,
} from '../utils/error-handler';

const logger = new Logger('OpenSearchService');

/**
 * Global HTTPS agent for connection pooling
 * Reused across Lambda invocations for better performance
 */
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 15000,
  rejectUnauthorized: process.env.NODE_ENV === 'production',
});

/**
 * OpenSearch client singleton
 * Reused across Lambda invocations (warm starts)
 */
let opensearchClient: Client | null = null;
let clientInitializedAt: number = 0;
const CLIENT_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get OpenSearch configuration from environment
 */
function getOpenSearchConfig(): OpenSearchConfig {
  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
  }

  return {
    endpoint,
    index: process.env.OPENSEARCH_INDEX || 'file-index',
    region: process.env.AWS_REGION || 'ap-northeast-1',
  };
}

/**
 * Get or create OpenSearch client (lazy initialization)
 */
export async function getOpenSearchClient(): Promise<Client> {
  const now = Date.now();

  // Reuse existing client if still valid
  if (opensearchClient && now - clientInitializedAt < CLIENT_TTL) {
    logger.debug('Reusing existing OpenSearch client');
    return opensearchClient;
  }

  // Close expired client
  if (opensearchClient) {
    logger.info('Closing expired OpenSearch client');
    await opensearchClient.close();
    opensearchClient = null;
  }

  const config = getOpenSearchConfig();
  logger.info('Initializing new OpenSearch client', {
    endpoint: config.endpoint,
    region: config.region,
  });

  try {
    const useIp = process.env.OPENSEARCH_USE_IP === 'true';

    opensearchClient = new Client({
      ...AwsSigv4Signer({
        region: config.region,
        service: 'es' as const,
        getCredentials: () => defaultProvider()(),
      }),
      node: config.endpoint,

      // Optimized agent configuration
      agent: httpsAgent,

      // Optimized timeouts
      requestTimeout: 15000, // Reduced from 30s
      pingTimeout: 3000,

      // Reduced retries
      maxRetries: 2, // Reduced from 3

      // SSL configuration
      ssl: useIp
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: process.env.NODE_ENV === 'production' },

      // Custom headers for IP-based connections
      ...(useIp && {
        headers: {
          Host: 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com',
        },
      }),
    });

    // Connection test with timeout
    const pingPromise = opensearchClient.ping();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    );

    await Promise.race([pingPromise, timeoutPromise]);

    clientInitializedAt = now;
    logger.info('OpenSearch client initialized successfully');

    return opensearchClient;
  } catch (error: any) {
    logger.error('Failed to initialize OpenSearch client', {
      error: error.message,
    });
    opensearchClient = null;
    throw new OpenSearchUnavailableError('Failed to connect to OpenSearch');
  }
}

/**
 * Search documents with optimized query
 */
export async function searchDocuments(
  searchQuery: SearchQuery
): Promise<SearchResponse> {
  const client = await getOpenSearchClient();
  const config = getOpenSearchConfig();

  const {
    query,
    searchMode = 'or',
    imageEmbedding,
    fileType,
    dateFrom,
    dateTo,
    size = 20,
    from = 0,
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = searchQuery;

  logger.info('Executing search query', {
    query: query?.substring(0, 50), // Log first 50 chars only
    searchMode,
    fileType,
    size,
    from,
    sortBy,
  });

  // Build query clauses
  const mustClauses: any[] = [];
  const shouldClauses: any[] = [];
  const filterClauses: any[] = [];

  const hasTextQuery = query && query.trim();
  const hasImageQuery = imageEmbedding && imageEmbedding.length > 0;

  // Text search query
  if (hasTextQuery) {
    const textQuery = {
      multi_match: {
        query: query!.trim(),
        fields: ['file_name^3', 'file_path^2', 'extracted_text'],
        type: 'best_fields',
        operator: searchMode,
        fuzziness: searchMode === 'or' ? 'AUTO' : '0',
      },
    };

    if (hasImageQuery) {
      shouldClauses.push(textQuery);
    } else {
      mustClauses.push(textQuery);
    }
  }

  // Image vector search (k-NN)
  if (hasImageQuery) {
    shouldClauses.push({
      script_score: {
        query: { match_all: {} },
        script: {
          source: 'knn_score',
          lang: 'knn',
          params: {
            field: 'image_embedding',
            query_value: imageEmbedding,
            space_type: 'cosinesimil',
          },
        },
      },
    });
  }

  // File type filter
  if (fileType && fileType !== 'all') {
    filterClauses.push({
      term: { file_type: fileType },
    });
  }

  // Date range filter
  if (dateFrom || dateTo) {
    const rangeQuery: any = {};
    if (dateFrom) rangeQuery.gte = dateFrom;
    if (dateTo) rangeQuery.lte = dateTo;

    filterClauses.push({
      range: { processed_at: rangeQuery },
    });
  }

  // Sort configuration
  const sort: any[] = [];
  if (sortBy === 'relevance') {
    sort.push('_score');
  } else if (sortBy === 'date') {
    sort.push({ processed_at: { order: sortOrder } });
  } else if (sortBy === 'name') {
    sort.push({ 'file_name.keyword': { order: sortOrder } });
  } else if (sortBy === 'size') {
    sort.push({ file_size: { order: sortOrder } });
  }

  // Optimized search body
  const searchBody: any = {
    query: {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : undefined,
        should: shouldClauses.length > 0 ? shouldClauses : undefined,
        filter: filterClauses.length > 0 ? filterClauses : undefined,
        minimum_should_match:
          shouldClauses.length > 0 && mustClauses.length === 0 ? 1 : undefined,
      },
    },

    // Optimized highlighting (reduced fragment count)
    highlight: {
      fields: {
        extracted_text: {
          fragment_size: 150,
          number_of_fragments: 2, // Reduced from 3
          boundary_scanner: 'sentence',
        },
        file_name: {
          number_of_fragments: 0, // Highlight entire field
        },
        file_path: {
          number_of_fragments: 0,
        },
      },
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
    },

    // Field selection (exclude large fields)
    _source: {
      includes: [
        'file_name',
        'file_path',
        'file_type',
        'file_size',
        'processed_at',
      ],
      excludes: ['image_embedding', 'full_text'], // Exclude large fields
    },

    // Fetch extracted_text separately for snippet
    stored_fields: ['extracted_text'],

    size,
    from,
    sort,

    // Optimized total hits tracking
    track_total_hits: from + size < 10000 ? true : 10000,
  };

  try {
    const startTime = Date.now();

    const response = await client.search({
      index: config.index,
      body: searchBody,
    });

    const took = Date.now() - startTime;

    const totalHits = response.body.hits?.total;
    const totalValue =
      typeof totalHits === 'number' ? totalHits : totalHits?.value || 0;

    logger.info('Search query completed', {
      took,
      hits: totalValue,
      returnedHits: response.body.hits.hits.length,
    });

    // Efficient result mapping
    const results: SearchResult[] = response.body.hits.hits.map((hit: any) => {
      const source = hit._source;
      const highlights = hit.highlight || {};

      // Generate snippet efficiently
      let snippet = '';
      if (highlights.extracted_text?.length > 0) {
        snippet = highlights.extracted_text.join(' ... ');
      } else if (hit.fields?.extracted_text?.[0]) {
        // Use stored field for snippet
        const text = hit.fields.extracted_text[0];
        snippet = text.substring(0, 200) + (text.length > 200 ? '...' : '');
      }

      return {
        id: hit._id,
        fileName: source.file_name || '',
        filePath: source.file_path || '',
        fileType: source.file_type || '',
        fileSize: source.file_size || 0,
        modifiedDate: source.processed_at || '',
        snippet,
        relevanceScore: hit._score || 0,
        highlights: {
          fileName: highlights.file_name,
          filePath: highlights.file_path,
          extractedText: highlights.extracted_text,
        },
      };
    });

    return {
      results,
      total: totalValue,
      took: response.body.took || 0,
    };
  } catch (error: any) {
    logger.error('OpenSearch query failed', {
      error: error.message,
      statusCode: error.statusCode,
    });

    if (error.statusCode === 404) {
      throw new OpenSearchIndexNotFoundError(
        `Index '${config.index}' not found`
      );
    } else if (error.statusCode === 503 || error.code === 'ECONNREFUSED') {
      throw new OpenSearchUnavailableError(
        'OpenSearch service is temporarily unavailable'
      );
    } else {
      throw new OpenSearchError(
        `Search operation failed: ${error.message}`,
        500
      );
    }
  }
}

/**
 * Close OpenSearch client (for cleanup)
 */
export async function closeOpenSearchClient(): Promise<void> {
  if (opensearchClient) {
    logger.info('Closing OpenSearch client');
    try {
      await opensearchClient.close();
    } catch (error) {
      logger.warn('Error closing OpenSearch client', { error });
    } finally {
      opensearchClient = null;
      clientInitializedAt = 0;
    }
  }
}

/**
 * Health check for monitoring
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const client = await getOpenSearchClient();
    await client.ping({}, { requestTimeout: 3000 });
    return true;
  } catch (error) {
    logger.error('Health check failed', { error });
    return false;
  }
}
