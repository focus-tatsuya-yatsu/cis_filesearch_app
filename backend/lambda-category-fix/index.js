/**
 * Lambda function to fix wrong category in OpenSearch
 * Corrects documents where nas_server implies a different category than what's stored
 *
 * ts-server6/7 should be 'structure', ts-server3/5 should be 'road'
 */

const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const https = require('https');

// NAS server to category mapping
const NAS_SERVER_CATEGORY_MAP = {
  'ts-server3': { category: 'road', category_display: '道路' },
  'ts-server5': { category: 'road', category_display: '道路' },
  'ts-server6': { category: 'structure', category_display: '構造' },
  'ts-server7': { category: 'structure', category_display: '構造' }
};

const createClient = async () => {
  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  const region = process.env.AWS_REGION || 'ap-northeast-1';
  const useIp = process.env.OPENSEARCH_USE_IP === 'true';

  // For IP-based connection, we need to disable SSL certificate verification
  // and provide the proper Host header for AWS SigV4 signing
  if (useIp) {
    console.log('Using IP-based connection with custom SSL settings');

    const agent = new https.Agent({
      rejectUnauthorized: false,
    });

    return new Client({
      ...AwsSigv4Signer({
        region,
        service: 'es',
        getCredentials: () => {
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        },
      }),
      node: endpoint.startsWith('https://') ? endpoint : `https://${endpoint}`,
      ssl: {
        rejectUnauthorized: false,
      },
      agent,
      requestTimeout: 60000,
      maxRetries: 3,
      headers: {
        // Use the actual OpenSearch domain name for proper AWS SigV4 signing
        'Host': 'vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com',
      },
    });
  }

  // Standard domain-name based connection
  return new Client({
    ...AwsSigv4Signer({
      region,
      service: 'es',
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: endpoint.startsWith('https://') ? endpoint : `https://${endpoint}`,
  });
};

// Count documents with wrong category
const countWrongCategory = async (client, index) => {
  const result = await client.count({
    index,
    body: {
      query: {
        bool: {
          should: [
            // ts-server6/7 should be structure, not road
            {
              bool: {
                must: [
                  { terms: { nas_server: ['ts-server6', 'ts-server7'] } },
                  { term: { category: 'road' } }
                ]
              }
            },
            // ts-server3/5 should be road, not structure (less likely but check anyway)
            {
              bool: {
                must: [
                  { terms: { nas_server: ['ts-server3', 'ts-server5'] } },
                  { term: { category: 'structure' } }
                ]
              }
            }
          ],
          minimum_should_match: 1
        }
      }
    }
  });
  return result.body.count;
};

// Get detailed counts by server
const getDetailedCounts = async (client, index) => {
  const result = await client.search({
    index,
    body: {
      size: 0,
      query: {
        bool: {
          should: [
            {
              bool: {
                must: [
                  { terms: { nas_server: ['ts-server6', 'ts-server7'] } },
                  { term: { category: 'road' } }
                ]
              }
            },
            {
              bool: {
                must: [
                  { terms: { nas_server: ['ts-server3', 'ts-server5'] } },
                  { term: { category: 'structure' } }
                ]
              }
            }
          ],
          minimum_should_match: 1
        }
      },
      aggs: {
        by_server: {
          terms: { field: 'nas_server', size: 10 }
        },
        by_current_category: {
          terms: { field: 'category', size: 10 }
        },
        by_file_type: {
          terms: { field: 'file_type', size: 10 }
        }
      }
    }
  });

  return {
    total: result.body.hits.total.value,
    by_server: result.body.aggregations.by_server.buckets,
    by_current_category: result.body.aggregations.by_current_category.buckets,
    by_file_type: result.body.aggregations.by_file_type.buckets
  };
};

// Fix wrong categories using update_by_query
const fixWrongCategories = async (client, index, dryRun = false) => {
  const results = {
    structure_to_fix: 0,
    road_to_fix: 0,
    fixed: 0,
    errors: []
  };

  // Fix ts-server6/7 that incorrectly have category='road'
  const structureQuery = {
    index,
    body: {
      query: {
        bool: {
          must: [
            { terms: { nas_server: ['ts-server6', 'ts-server7'] } },
            { term: { category: 'road' } }
          ]
        }
      },
      script: {
        source: `
          ctx._source.category = 'structure';
          ctx._source.category_display = '構造';
        `,
        lang: 'painless'
      }
    },
    refresh: true,
    wait_for_completion: true,
    timeout: '5m'
  };

  if (dryRun) {
    // Count only
    const countResult = await client.count({
      index,
      body: { query: structureQuery.body.query }
    });
    results.structure_to_fix = countResult.body.count;
  } else {
    try {
      const updateResult = await client.updateByQuery(structureQuery);
      results.structure_to_fix = updateResult.body.total;
      results.fixed += updateResult.body.updated;
      console.log('Structure fix result:', JSON.stringify(updateResult.body));
    } catch (err) {
      console.error('Structure fix error:', err);
      results.errors.push(`Structure fix error: ${err.message}`);
    }
  }

  // Fix ts-server3/5 that incorrectly have category='structure'
  const roadQuery = {
    index,
    body: {
      query: {
        bool: {
          must: [
            { terms: { nas_server: ['ts-server3', 'ts-server5'] } },
            { term: { category: 'structure' } }
          ]
        }
      },
      script: {
        source: `
          ctx._source.category = 'road';
          ctx._source.category_display = '道路';
        `,
        lang: 'painless'
      }
    },
    refresh: true,
    wait_for_completion: true,
    timeout: '5m'
  };

  if (dryRun) {
    const countResult = await client.count({
      index,
      body: { query: roadQuery.body.query }
    });
    results.road_to_fix = countResult.body.count;
  } else {
    try {
      const updateResult = await client.updateByQuery(roadQuery);
      results.road_to_fix = updateResult.body.total;
      results.fixed += updateResult.body.updated;
      console.log('Road fix result:', JSON.stringify(updateResult.body));
    } catch (err) {
      console.error('Road fix error:', err);
      results.errors.push(`Road fix error: ${err.message}`);
    }
  }

  return results;
};

exports.handler = async (event) => {
  console.log('Category Fix Lambda started');
  console.log('Event:', JSON.stringify(event));
  console.log('Environment:', {
    OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT,
    OPENSEARCH_INDEX: process.env.OPENSEARCH_INDEX,
    OPENSEARCH_USE_IP: process.env.OPENSEARCH_USE_IP,
    AWS_REGION: process.env.AWS_REGION
  });

  const index = process.env.OPENSEARCH_INDEX || 'cis-files-v2';
  const dryRun = event.dryRun === true || event.dryRun === 'true';
  const action = event.action || 'count'; // 'count', 'details', or 'fix'

  try {
    const client = await createClient();

    let result;

    switch (action) {
      case 'count':
        const count = await countWrongCategory(client, index);
        result = {
          action: 'count',
          wrong_category_count: count,
          message: `Found ${count} documents with incorrect category`
        };
        break;

      case 'details':
        const details = await getDetailedCounts(client, index);
        result = {
          action: 'details',
          ...details,
          message: 'Detailed breakdown of documents with wrong category'
        };
        break;

      case 'fix':
        if (dryRun) {
          const fixPreview = await fixWrongCategories(client, index, true);
          result = {
            action: 'fix',
            dryRun: true,
            ...fixPreview,
            message: 'DRY RUN: No changes made. This is what would be fixed.'
          };
        } else {
          const fixResult = await fixWrongCategories(client, index, false);
          result = {
            action: 'fix',
            dryRun: false,
            ...fixResult,
            message: `Fixed ${fixResult.fixed} documents`
          };
        }
        break;

      case 'diagnose':
        // Get overall data status for ts-server6/7
        const diagnoseResult = await client.search({
          index,
          body: {
            size: 0,
            query: {
              terms: { nas_server: ['ts-server6', 'ts-server7'] }
            },
            aggs: {
              by_server: {
                terms: { field: 'nas_server', size: 10 }
              },
              by_category: {
                terms: { field: 'category', size: 10 }
              },
              by_file_type: {
                terms: { field: 'file_type', size: 20 }
              }
            }
          }
        });
        result = {
          action: 'diagnose',
          total_ts_server67_docs: diagnoseResult.body.hits.total.value,
          by_server: diagnoseResult.body.aggregations.by_server.buckets,
          by_category: diagnoseResult.body.aggregations.by_category.buckets,
          by_file_type: diagnoseResult.body.aggregations.by_file_type.buckets,
          message: 'Current state of ts-server6/7 documents'
        };
        break;

      default:
        result = {
          error: 'Unknown action',
          validActions: ['count', 'details', 'fix', 'diagnose'],
          message: 'Use action: "count" to see count, "details" for breakdown, "fix" to apply corrections, "diagnose" to see ts-server6/7 status'
        };
    }

    console.log('Result:', JSON.stringify(result));
    return {
      statusCode: 200,
      body: result
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: {
        error: error.message,
        stack: error.stack
      }
    };
  }
};
