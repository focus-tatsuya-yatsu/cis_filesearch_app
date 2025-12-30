/**
 * Dual Index Search API Lambda Function with IAM Authentication
 * Supports both text search (cis-files) and image search (file-index-v2-knn)
 */

const AWS = require('aws-sdk');
const https = require('https');
const crypto = require('crypto');

// AWS SDK configuration
AWS.config.update({
  region: process.env.AWS_REGION || 'ap-northeast-1',
  credentials: new AWS.EnvironmentCredentials('AWS')
});

/**
 * AWS Signature V4 request signer
 */
class AWSSignerV4 {
  constructor(credentials, region, service) {
    this.credentials = credentials;
    this.region = region;
    this.service = service;
  }

  async sign(request) {
    const credentials = await this.getCredentials();
    const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = datetime.substring(0, 8);

    // Add required headers
    request.headers = request.headers || {};
    request.headers['Host'] = request.hostname;
    request.headers['X-Amz-Date'] = datetime;

    if (credentials.sessionToken) {
      request.headers['X-Amz-Security-Token'] = credentials.sessionToken;
    }

    // Store the body for signing
    request.body = request.body || '';

    // Create canonical request
    const canonicalRequest = this.createCanonicalRequest(request);
    const stringToSign = this.createStringToSign(datetime, date, canonicalRequest);
    const signature = this.calculateSignature(credentials.secretAccessKey, date, stringToSign);

    // Add authorization header
    const authHeader = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${date}/${this.region}/${this.service}/aws4_request, SignedHeaders=${this.getSignedHeaders(request.headers)}, Signature=${signature}`;
    request.headers['Authorization'] = authHeader;

    return request;
  }

  async getCredentials() {
    return new Promise((resolve, reject) => {
      this.credentials.get((err) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            accessKeyId: this.credentials.accessKeyId,
            secretAccessKey: this.credentials.secretAccessKey,
            sessionToken: this.credentials.sessionToken
          });
        }
      });
    });
  }

  createCanonicalRequest(request) {
    const method = request.method || 'GET';
    const path = request.path || '/';
    const queryString = '';
    const headers = this.getCanonicalHeaders(request.headers);
    const signedHeaders = this.getSignedHeaders(request.headers);
    const payload = request.body || '';
    const hashedPayload = this.hash(payload);

    return `${method}\n${path}\n${queryString}\n${headers}\n${signedHeaders}\n${hashedPayload}`;
  }

  getCanonicalHeaders(headers) {
    const sorted = Object.keys(headers)
      .map(key => key.toLowerCase())
      .sort()
      .map(key => {
        const originalKey = Object.keys(headers).find(k => k.toLowerCase() === key);
        const value = headers[originalKey];
        return `${key}:${String(value).trim()}`;
      })
      .join('\n');
    return sorted + '\n';
  }

  getSignedHeaders(headers) {
    return Object.keys(headers)
      .map(key => key.toLowerCase())
      .sort()
      .join(';');
  }

  createStringToSign(datetime, date, canonicalRequest) {
    const hashedRequest = this.hash(canonicalRequest);
    return `AWS4-HMAC-SHA256\n${datetime}\n${date}/${this.region}/${this.service}/aws4_request\n${hashedRequest}`;
  }

  calculateSignature(secretAccessKey, date, stringToSign) {
    const kDate = this.hmac(`AWS4${secretAccessKey}`, date);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, this.service);
    const kSigning = this.hmac(kService, 'aws4_request');
    return this.hmac(kSigning, stringToSign, 'hex');
  }

  hash(data) {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  }

  hmac(key, data, encoding = null) {
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(data, 'utf8');
    return encoding ? hmac.digest(encoding) : hmac.digest();
  }
}

/**
 * OpenSearch client with IAM authentication
 */
class OpenSearchClient {
  constructor(endpoint) {
    this.endpoint = endpoint.replace(/^https?:\/\//, '');
    this.signer = new AWSSignerV4(
      new AWS.EnvironmentCredentials('AWS'),
      process.env.AWS_REGION || 'ap-northeast-1',
      'es'
    );
  }

  async request(method, path, body = null) {
    const options = {
      hostname: this.endpoint,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: body || ''
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    // Sign the request
    await this.signer.sign(options);

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve(data);
            }
          } else {
            reject(new Error(`OpenSearch error: ${res.statusCode} - ${data}`));
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(body);
      }

      req.end();
    });
  }

  async search(index, query) {
    const path = `/${index}/_search`;
    const body = JSON.stringify(query);
    return this.request('POST', path, body);
  }
}

/**
 * Main handler function
 */
exports.handler = async (event) => {
  console.log('Lambda function started with IAM authentication');
  console.log('Received event:', JSON.stringify(event));

  try {
    // Handle both GET (queryStringParameters) and POST (body) requests
    const httpMethod = event.httpMethod || event.requestContext?.http?.method || 'GET';
    let params;

    if (httpMethod === 'POST' && event.body) {
      params = JSON.parse(event.body);
    } else {
      params = event.queryStringParameters || {};
    }

    // Extract parameters
    const query = params.q || params.query || '';
    const searchType = params.searchType;
    const imageVector = params.imageVector;
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 20;
    const sortBy = params.sortBy || 'relevance';
    const sortOrder = params.sortOrder || 'desc';
    const searchMode = params.searchMode || 'or';
    const filters = params.filters || {};

    // Create OpenSearch client
    const endpoint = process.env.OPENSEARCH_ENDPOINT;
    if (!endpoint) {
      throw new Error('OPENSEARCH_ENDPOINT environment variable is required');
    }

    const client = new OpenSearchClient(endpoint);

    // Determine index and build search query
    let indexName;
    let searchBody;

    if (searchType === 'image' && imageVector) {
      indexName = 'file-index-v2-knn';
      console.log(`Performing image search on index: ${indexName}`);

      searchBody = {
        size: limit,
        from: (page - 1) * limit,
        query: {
          knn: {
            image_embedding: {
              vector: imageVector,
              k: Math.min(limit * 2, 100)
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
    } else {
      indexName = 'cis-files';
      console.log(`Performing text search on index: ${indexName}`);

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
          { modified_date: { order: sortOrder, missing: '_last' } }
        ];
      } else if (sortBy === 'size') {
        searchBody.sort = [
          { file_size: { order: sortOrder } }
        ];
      } else if (sortBy === 'name') {
        searchBody.sort = [
          { 'file_name.keyword': { order: sortOrder } }
        ];
      }
    }

    // Execute search
    console.log(`Executing search on ${indexName}:`, JSON.stringify(searchBody, null, 2));
    const response = await client.search(indexName, searchBody);

    console.log('Search completed successfully');

    // Format response
    const results = response.hits.hits.map((hit) => ({
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

    const totalHits = response.hits.total;
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