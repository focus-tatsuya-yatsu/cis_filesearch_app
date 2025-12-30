/**
 * Dual Index Search API Lambda Function - Simplified VPC Version
 * Supports both text search (cis-files) and image search (file-index-v2-knn)
 */

const { Client } = require('@opensearch-project/opensearch');
const AWS = require('aws-sdk');

// OpenSearch client configuration - simplified for VPC
const createClient = () => {
  const endpoint = process.env.OPENSEARCH_ENDPOINT;

  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is required');
  }

  console.log('Connecting to OpenSearch endpoint:', endpoint);

  // Clean endpoint (remove any protocol if present)
  const cleanEndpoint = endpoint.replace(/^https?:\/\//, '');

  // Get AWS credentials from environment
  const credentials = new AWS.EnvironmentCredentials('AWS');

  // Create AWS4 signer
  const signer = new AWS.Signers.V4(
    new AWS.HttpRequest(new AWS.Endpoint(`https://${cleanEndpoint}`), 'ap-northeast-1'),
    'es'
  );

  // Create client with AWS IAM authentication
  return new Client({
    node: `https://${cleanEndpoint}`,
    auth: {
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken
      },
      service: 'es',
      region: process.env.AWS_REGION || 'ap-northeast-1'
    },
    ssl: {
      rejectUnauthorized: false // For VPC internal communication
    },
    requestTimeout: 30000
  });
};

/**
 * Main handler function
 */
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event));

  try {
    // Handle both GET (queryStringParameters) and POST (body) requests
    const httpMethod = event.httpMethod || event.requestContext?.http?.method || 'GET';
    let params;

    if (httpMethod === 'POST' && event.body) {
      // POST request: parse body
      params = JSON.parse(event.body);
    } else {
      // GET request: use queryStringParameters
      params = event.queryStringParameters || {};
    }

    // Extract parameters with fallbacks
    const query = params.q || params.query || '';
    const searchType = params.searchType;
    const imageVector = params.imageVector;
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 20;
    const sortBy = params.sortBy || 'relevance';
    const sortOrder = params.sortOrder || 'desc';
    const searchMode = params.searchMode || 'or';
    const filters = params.filters || {};

    const client = createClient();

    // Determine index based on search type
    let indexName;
    let searchBody;

    if (searchType === 'image' && imageVector) {
      // Image search using k-NN
      indexName = 'file-index-v2-knn';
      console.log(`Performing image search on index: ${indexName}`);

      searchBody = {
        size: limit,
        from: (page - 1) * limit,
        query: {
          knn: {
            image_embedding: {
              vector: imageVector,
              k: Math.min(limit * 2, 100) // Search for more candidates
            }
          }
        },
        _source: [
          'file_name',
          'file_path',
          'file_type',
          'file_size',
          'modified_date',
          'department',
          'tags',
          'content'
        ]
      };

      // Add filters if provided
      if (Object.keys(filters).length > 0) {
        searchBody.post_filter = {
          bool: {
            must: Object.entries(filters).map(([field, value]) => ({
              term: { [field]: value }
            }))
          }
        };
      }

    } else {
      // Text search
      indexName = 'cis-files';
      console.log(`Performing text search on index: ${indexName}`);

      // Build query based on search mode
      const queryBuilder = () => {
        if (!query || query.trim() === '') {
          return { match_all: {} };
        }

        const operator = searchMode === 'and' ? 'and' : 'or';

        return {
          bool: {
            should: [
              {
                multi_match: {
                  query: query,
                  fields: ['file_name^3', 'content^2', 'file_path'],
                  type: 'best_fields',
                  operator: operator
                }
              },
              {
                wildcard: {
                  file_name: {
                    value: `*${query}*`,
                    boost: 2
                  }
                }
              }
            ],
            minimum_should_match: 1
          }
        };
      };

      searchBody = {
        size: limit,
        from: (page - 1) * limit,
        query: queryBuilder(),
        highlight: {
          fields: {
            content: {
              fragment_size: 150,
              number_of_fragments: 1
            },
            file_name: {}
          }
        },
        _source: [
          'file_name',
          'file_path',
          'file_type',
          'file_size',
          'created_date',
          'modified_date',
          'department',
          'tags',
          'content'
        ]
      };

      // Add sorting
      if (sortBy === 'date') {
        searchBody.sort = [
          {
            modified_date: {
              order: sortOrder,
              missing: '_last'
            }
          }
        ];
      } else if (sortBy === 'size') {
        searchBody.sort = [
          {
            file_size: {
              order: sortOrder
            }
          }
        ];
      } else if (sortBy === 'name') {
        searchBody.sort = [
          {
            'file_name.keyword': {
              order: sortOrder
            }
          }
        ];
      }

      // Add filters
      if (Object.keys(filters).length > 0) {
        const filterQueries = [];

        if (filters.fileType) {
          filterQueries.push({
            terms: { file_type: Array.isArray(filters.fileType) ? filters.fileType : [filters.fileType] }
          });
        }

        if (filters.department) {
          filterQueries.push({
            term: { department: filters.department }
          });
        }

        if (filters.dateRange) {
          const dateFilter = { range: { modified_date: {} } };
          if (filters.dateRange.from) {
            dateFilter.range.modified_date.gte = filters.dateRange.from;
          }
          if (filters.dateRange.to) {
            dateFilter.range.modified_date.lte = filters.dateRange.to;
          }
          filterQueries.push(dateFilter);
        }

        if (filterQueries.length > 0) {
          searchBody.query = {
            bool: {
              must: searchBody.query,
              filter: filterQueries
            }
          };
        }
      }
    }

    // Execute search
    console.log(`Executing search on ${indexName}:`, JSON.stringify(searchBody, null, 2));
    const response = await client.search({
      index: indexName,
      body: searchBody
    });

    // Format response
    const results = response.body.hits.hits.map((hit) => ({
      id: hit._id,
      fileName: hit._source.file_name,
      filePath: hit._source.file_path,
      fileType: hit._source.file_type,
      fileSize: hit._source.file_size,
      createdDate: hit._source.created_date,
      modifiedDate: hit._source.modified_date,
      department: hit._source.department,
      tags: hit._source.tags,
      snippet: hit.highlight?.content?.[0] || hit._source.content?.substring(0, 200),
      relevanceScore: hit._score,
      highlights: hit.highlight || {}
    }));

    const totalHits = response.body.hits.total;
    const total = typeof totalHits === 'object' ? totalHits.value : totalHits;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        data: {
          results: results,
          total: total,
          page: page,
          limit: limit,
          searchType: searchType || 'text',
          index: indexName
        }
      })
    };

  } catch (error) {
    console.error('Search error:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};