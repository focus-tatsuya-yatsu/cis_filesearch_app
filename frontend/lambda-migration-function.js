// Lambda function to create unified index and migrate data
const https = require('https');

const ENDPOINT = 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com';
const SOURCE_INDEX = 'cis-files';
const TARGET_INDEX = 'cis-files-unified';

function makeRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          data: responseData
        });
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

exports.handler = async (event) => {
  try {
    console.log('Starting unified index migration...');

    // Step 1: Delete existing unified index if exists
    console.log('Step 1: Deleting existing unified index if exists...');
    await makeRequest({
      hostname: ENDPOINT,
      port: 443,
      path: `/${TARGET_INDEX}`,
      method: 'DELETE'
    });

    // Step 2: Create unified index with k-NN support
    console.log('Step 2: Creating unified index...');
    const indexSettings = {
      settings: {
        index: {
          number_of_shards: 3,
          number_of_replicas: 1,
          knn: true,
          "knn.algo_param.ef_search": 100
        },
        analysis: {
          analyzer: {
            japanese_analyzer: {
              type: "custom",
              tokenizer: "kuromoji_tokenizer",
              filter: [
                "kuromoji_baseform",
                "kuromoji_part_of_speech",
                "cjk_width",
                "ja_stop",
                "kuromoji_stemmer",
                "lowercase"
              ]
            }
          }
        }
      },
      mappings: {
        properties: {
          file_path: { type: "keyword" },
          file_name: {
            type: "text",
            analyzer: "japanese_analyzer",
            fields: {
              keyword: { type: "keyword" },
              raw: { type: "text", analyzer: "standard" }
            }
          },
          content: { type: "text", analyzer: "japanese_analyzer" },
          file_type: { type: "keyword" },
          file_size: { type: "long" },
          created_date: { type: "date" },
          modified_date: { type: "date" },
          department: { type: "keyword" },
          tags: { type: "keyword" },
          image_embedding: {
            type: "knn_vector",
            dimension: 1024,
            method: {
              engine: "nmslib",
              space_type: "cosinesimil",
              name: "hnsw",
              parameters: {
                ef_construction: 512,
                m: 16
              }
            }
          },
          has_image_embedding: { type: "boolean" },
          embedding_created_at: { type: "date" },
          mime_type: { type: "keyword" },
          ocr_text: { type: "text", analyzer: "japanese_analyzer" }
        }
      }
    };

    const createResult = await makeRequest({
      hostname: ENDPOINT,
      port: 443,
      path: `/${TARGET_INDEX}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify(indexSettings));

    console.log('Index creation result:', createResult.data);

    // Step 3: Reindex data from source to target
    console.log('Step 3: Starting data migration...');
    const reindexBody = {
      source: { index: SOURCE_INDEX },
      dest: { index: TARGET_INDEX }
    };

    const reindexResult = await makeRequest({
      hostname: ENDPOINT,
      port: 443,
      path: '/_reindex',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify(reindexBody));

    console.log('Reindex result:', reindexResult.data);

    // Step 4: Get document count
    console.log('Step 4: Verifying migration...');
    const countResult = await makeRequest({
      hostname: ENDPOINT,
      port: 443,
      path: `/${TARGET_INDEX}/_count`,
      method: 'GET'
    });

    const count = JSON.parse(countResult.data).count;
    console.log(`Migration complete! Documents migrated: ${count}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Migration complete',
        documentsCount: count,
        targetIndex: TARGET_INDEX
      })
    };

  } catch (error) {
    console.error('Migration error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};