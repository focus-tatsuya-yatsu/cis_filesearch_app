/**
 * Lambda関数: OpenSearch インデックスマイグレーション
 *
 * この関数をVPC内にデプロイして実行することで、
 * EC2インスタンスなしでOpenSearchマイグレーションを実行できます。
 *
 * デプロイ方法:
 * 1. AWS Lambdaコンソールで新しい関数を作成
 * 2. ランタイム: Node.js 18.x
 * 3. VPC設定: OpenSearchと同じVPC、サブネット、セキュリティグループを選択
 * 4. タイムアウト: 15分に設定
 * 5. メモリ: 512MB以上
 * 6. 環境変数:
 *    - OPENSEARCH_ENDPOINT: https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
 *    - INDEX_NAME: cis-files
 */

const https = require('https');
const { URL } = require('url');

// OpenSearch設定
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT ||
  'https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com';
const INDEX_NAME = process.env.INDEX_NAME || 'cis-files';

/**
 * OpenSearchへのHTTPリクエストを実行
 */
async function opensearchRequest(path, method = 'GET', body = null) {
  const url = new URL(path, OPENSEARCH_ENDPOINT);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
          }
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * メインのマイグレーション処理
 */
exports.handler = async (event) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupIndex = `${INDEX_NAME}-backup-${timestamp}`;
  const newIndex = `${INDEX_NAME}-migrated`;

  try {
    console.log('=== OpenSearch Migration Starting ===');
    console.log(`Endpoint: ${OPENSEARCH_ENDPOINT}`);
    console.log(`Index: ${INDEX_NAME}`);

    // 1. 接続確認
    console.log('Step 1: Checking connection...');
    await opensearchRequest('/');
    console.log('✓ Connected to OpenSearch');

    // 2. 既存インデックスの確認
    console.log('Step 2: Checking existing index...');
    const indices = await opensearchRequest('/_cat/indices?format=json');
    const targetIndex = indices.find(idx => idx.index === INDEX_NAME);

    if (!targetIndex) {
      throw new Error(`Index ${INDEX_NAME} not found`);
    }
    console.log(`✓ Index found: ${INDEX_NAME} (${targetIndex['docs.count']} documents)`);

    // 3. 現在のマッピングを確認
    console.log('Step 3: Checking current mapping...');
    const mapping = await opensearchRequest(`/${INDEX_NAME}/_mapping`);
    const imageEmbedding = mapping[INDEX_NAME]?.mappings?.properties?.image_embedding;

    if (imageEmbedding?.type === 'knn_vector' && imageEmbedding?.dimension === 1024) {
      console.log('✓ Index already has correct knn_vector mapping');
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Index already has correct mapping',
          mapping: imageEmbedding
        })
      };
    }

    // 4. バックアップ作成
    console.log(`Step 4: Creating backup index: ${backupIndex}...`);
    const reindexResult = await opensearchRequest('/_reindex?wait_for_completion=true', 'POST', {
      source: { index: INDEX_NAME },
      dest: { index: backupIndex }
    });
    console.log(`✓ Backup created: ${reindexResult.total} documents`);

    // 5. 新しいインデックスを作成
    console.log(`Step 5: Creating new index with correct mapping: ${newIndex}...`);

    const newMapping = {
      settings: {
        index: {
          knn: true,
          "knn.algo_param.ef_search": 100,
          number_of_shards: 1,
          number_of_replicas: 1,
          refresh_interval: "30s"
        },
        analysis: {
          analyzer: {
            custom_analyzer: {
              type: "custom",
              tokenizer: "standard",
              filter: ["lowercase", "asciifolding"]
            }
          }
        }
      },
      mappings: {
        properties: {
          file_name: {
            type: "text",
            analyzer: "custom_analyzer",
            fields: {
              keyword: {
                type: "keyword",
                ignore_above: 256
              }
            }
          },
          file_path: {
            type: "text",
            analyzer: "custom_analyzer",
            fields: {
              keyword: {
                type: "keyword",
                ignore_above: 512
              }
            }
          },
          file_type: { type: "keyword" },
          file_size: { type: "long" },
          modified_date: { type: "date" },
          extracted_text: {
            type: "text",
            analyzer: "custom_analyzer"
          },
          image_embedding: {
            type: "knn_vector",
            dimension: 1024,
            method: {
              name: "hnsw",
              space_type: "innerproduct",
              engine: "faiss",
              parameters: {
                ef_construction: 128,
                m: 24
              }
            }
          },
          metadata: {
            type: "object",
            enabled: false
          },
          s3_location: { type: "keyword" },
          indexed_at: { type: "date" }
        }
      }
    };

    await opensearchRequest(`/${newIndex}`, 'PUT', newMapping);
    console.log('✓ New index created with correct mapping');

    // 6. データを移行（image_embeddingフィールドは除外）
    console.log('Step 6: Migrating data to new index...');
    const migrateResult = await opensearchRequest('/_reindex?wait_for_completion=true', 'POST', {
      source: {
        index: backupIndex,
        _source: {
          excludes: ["image_embedding"]
        }
      },
      dest: { index: newIndex }
    });
    console.log(`✓ Data migrated: ${migrateResult.total} documents`);

    // 7. エイリアスを更新
    console.log('Step 7: Updating alias...');
    try {
      await opensearchRequest('/_aliases', 'POST', {
        actions: [
          { remove: { index: INDEX_NAME, alias: INDEX_NAME } },
          { add: { index: newIndex, alias: INDEX_NAME } }
        ]
      });
    } catch (e) {
      // エイリアスが存在しない場合は新規作成
      await opensearchRequest('/_aliases', 'POST', {
        actions: [
          { add: { index: newIndex, alias: INDEX_NAME } }
        ]
      });
    }
    console.log('✓ Alias updated');

    console.log('=== Migration Completed Successfully ===');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Migration completed successfully',
        details: {
          backupIndex,
          newIndex,
          documentsProcessed: migrateResult.total,
          alias: INDEX_NAME
        }
      })
    };

  } catch (error) {
    console.error('Migration failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      })
    };
  }
};