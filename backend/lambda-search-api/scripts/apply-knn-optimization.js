/**
 * Apply OpenSearch k-NN Optimization
 * OpenSearchインデックスに最適化設定を適用
 *
 * Usage:
 * node scripts/apply-knn-optimization.js
 */

const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

// 最適化設定
const OPTIMIZED_INDEX_SETTINGS = {
  settings: {
    index: {
      number_of_shards: 3,
      number_of_replicas: 1,
      knn: true,
      'knn.algo_param.ef_search': 512,
      refresh_interval: '30s',
      max_result_window: 10000,
      'cache.query.enable': true,
      'cache.request.enable': true,
    },
    analysis: {
      analyzer: {
        default: {
          type: 'standard',
        },
      },
    },
  },
  mappings: {
    properties: {
      file_name: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
        },
      },
      file_path: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
        },
      },
      file_type: { type: 'keyword' },
      file_size: { type: 'long' },
      processed_at: { type: 'date' },
      extracted_text: { type: 'text' },
      image_embedding: {
        type: 'knn_vector',
        dimension: 1024,
        method: {
          name: 'hnsw',
          space_type: 'cosinesimil',
          engine: 'nmslib',
          parameters: {
            ef_construction: 512,
            m: 16,
          },
        },
      },
    },
  },
};

/**
 * OpenSearchクライアントを作成
 */
function createClient() {
  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  const region = process.env.AWS_REGION || 'ap-northeast-1';

  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
  }

  return new Client({
    ...AwsSigv4Signer({
      region,
      service: 'es',
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: endpoint,
    requestTimeout: 30000,
    maxRetries: 3,
  });
}

/**
 * インデックスが存在するか確認
 */
async function indexExists(client, indexName) {
  try {
    const response = await client.indices.exists({ index: indexName });
    return response.body;
  } catch (error) {
    console.error('Error checking index existence:', error);
    return false;
  }
}

/**
 * インデックステンプレートを作成
 */
async function createIndexTemplate(client, templateName, indexPattern) {
  console.log(`Creating index template: ${templateName}`);

  try {
    await client.indices.putIndexTemplate({
      name: templateName,
      body: {
        index_patterns: [indexPattern],
        template: OPTIMIZED_INDEX_SETTINGS,
        priority: 100,
      },
    });

    console.log(`✓ Index template created: ${templateName}`);
  } catch (error) {
    console.error('Error creating index template:', error);
    throw error;
  }
}

/**
 * 新規インデックスを作成
 */
async function createIndex(client, indexName) {
  console.log(`Creating new index: ${indexName}`);

  try {
    await client.indices.create({
      index: indexName,
      body: OPTIMIZED_INDEX_SETTINGS,
    });

    console.log(`✓ Index created: ${indexName}`);
  } catch (error) {
    if (error.meta?.body?.error?.type === 'resource_already_exists_exception') {
      console.log(`Index already exists: ${indexName}`);
    } else {
      console.error('Error creating index:', error);
      throw error;
    }
  }
}

/**
 * 既存インデックスの設定を更新
 */
async function updateIndexSettings(client, indexName) {
  console.log(`Updating index settings: ${indexName}`);

  try {
    // インデックスをクローズ（一部の設定変更に必要）
    await client.indices.close({ index: indexName });

    // 設定を更新
    await client.indices.putSettings({
      index: indexName,
      body: {
        'index.knn': true,
        'index.knn.algo_param.ef_search': 512,
        'index.refresh_interval': '30s',
        'index.cache.query.enable': true,
        'index.cache.request.enable': true,
      },
    });

    // インデックスを再オープン
    await client.indices.open({ index: indexName });

    console.log(`✓ Index settings updated: ${indexName}`);
  } catch (error) {
    console.error('Error updating index settings:', error);
    // エラー時もインデックスを再オープン
    try {
      await client.indices.open({ index: indexName });
    } catch (e) {
      // ignore
    }
    throw error;
  }
}

/**
 * インデックスにマッピングを追加
 */
async function updateIndexMappings(client, indexName) {
  console.log(`Updating index mappings: ${indexName}`);

  try {
    await client.indices.putMapping({
      index: indexName,
      body: {
        properties: {
          image_embedding: {
            type: 'knn_vector',
            dimension: 1024,
            method: {
              name: 'hnsw',
              space_type: 'cosinesimil',
              engine: 'nmslib',
              parameters: {
                ef_construction: 512,
                m: 16,
              },
            },
          },
        },
      },
    });

    console.log(`✓ Index mappings updated: ${indexName}`);
  } catch (error) {
    console.error('Error updating index mappings:', error);
    // マッピングエラーは警告のみ（既存フィールドの変更は不可のため）
    console.warn('Warning: Some mapping updates may have failed. This is normal for existing fields.');
  }
}

/**
 * インデックス統計を表示
 */
async function showIndexStats(client, indexName) {
  try {
    const stats = await client.indices.stats({
      index: indexName,
      metric: ['docs', 'store', 'search'],
    });

    const indexStats = stats.body._all.primaries;

    console.log('\n--- Index Statistics ---');
    console.log(`Documents: ${indexStats.docs.count.toLocaleString()}`);
    console.log(`Store Size: ${(indexStats.store.size_in_bytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Search Queries: ${indexStats.search.query_total.toLocaleString()}`);
    console.log(
      `Avg Query Time: ${(indexStats.search.query_time_in_millis / Math.max(indexStats.search.query_total, 1)).toFixed(2)} ms`
    );
    console.log('------------------------\n');
  } catch (error) {
    console.error('Error getting index stats:', error);
  }
}

/**
 * メイン処理
 */
async function main() {
  const indexName = process.env.OPENSEARCH_INDEX || 'file-index';
  const templateName = 'file-index-template';

  console.log('='.repeat(60));
  console.log('OpenSearch k-NN Optimization');
  console.log('='.repeat(60));
  console.log(`Target Index: ${indexName}`);
  console.log(`OpenSearch Endpoint: ${process.env.OPENSEARCH_ENDPOINT}`);
  console.log('');

  try {
    const client = createClient();

    // 接続テスト
    console.log('Testing OpenSearch connection...');
    await client.ping();
    console.log('✓ Connected to OpenSearch\n');

    // インデックスの存在確認
    const exists = await indexExists(client, indexName);

    if (!exists) {
      // 新規インデックス作成
      console.log('Index does not exist. Creating new index...\n');
      await createIndex(client, indexName);
    } else {
      // 既存インデックスの更新
      console.log('Index exists. Updating settings and mappings...\n');
      await updateIndexSettings(client, indexName);
      await updateIndexMappings(client, indexName);
    }

    // インデックステンプレート作成
    await createIndexTemplate(client, templateName, `${indexName}*`);

    // 統計表示
    await showIndexStats(client, indexName);

    console.log('='.repeat(60));
    console.log('✓ Optimization Complete!');
    console.log('='.repeat(60));

    // クライアント終了
    await client.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// 実行
if (require.main === module) {
  main();
}

module.exports = { main };
