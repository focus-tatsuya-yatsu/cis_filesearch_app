/**
 * OpenSearch k-NN Optimized Index Creation Script
 *
 * このスクリプトは、パフォーマンス最適化されたk-NNインデックスを作成します。
 *
 * Usage:
 *   ts-node scripts/create-optimized-index.ts [options]
 *
 * Options:
 *   --index <name>         インデックス名 (デフォルト: file-index)
 *   --documents <number>   想定ドキュメント数 (デフォルト: 1000000)
 *   --nodes <number>       ノード数 (デフォルト: 3)
 *   --delete-existing      既存インデックスを削除
 *   --use-pq               Product Quantizationを使用
 */

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

interface IndexOptions {
  indexName: string;
  documentCount: number;
  nodeCount: number;
  deleteExisting: boolean;
  useProductQuantization: boolean;
}

/**
 * コマンドライン引数をパース
 */
function parseArgs(): IndexOptions {
  const args = process.argv.slice(2);
  const options: IndexOptions = {
    indexName: 'file-index',
    documentCount: 1_000_000,
    nodeCount: 3,
    deleteExisting: false,
    useProductQuantization: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--index':
        options.indexName = args[++i];
        break;
      case '--documents':
        options.documentCount = parseInt(args[++i], 10);
        break;
      case '--nodes':
        options.nodeCount = parseInt(args[++i], 10);
        break;
      case '--delete-existing':
        options.deleteExisting = true;
        break;
      case '--use-pq':
        options.useProductQuantization = true;
        break;
      case '--help':
        console.log(`
OpenSearch k-NN Optimized Index Creation Script

Usage:
  ts-node scripts/create-optimized-index.ts [options]

Options:
  --index <name>         インデックス名 (デフォルト: file-index)
  --documents <number>   想定ドキュメント数 (デフォルト: 1000000)
  --nodes <number>       ノード数 (デフォルト: 3)
  --delete-existing      既存インデックスを削除
  --use-pq               Product Quantizationを使用
  --help                 このヘルプを表示

Examples:
  # 標準インデックス作成
  ts-node scripts/create-optimized-index.ts --index file-index --documents 1000000

  # 大規模インデックス（PQ使用）
  ts-node scripts/create-optimized-index.ts --documents 10000000 --use-pq

  # 既存インデックスを削除して再作成
  ts-node scripts/create-optimized-index.ts --delete-existing
        `);
        process.exit(0);
    }
  }

  return options;
}

/**
 * 最適なシャード数を計算
 */
function calculateOptimalShards(
  documentCount: number,
  nodeCount: number
): number {
  // 1M documentsごとに1シャード、ノード数を考慮
  const baseShards = Math.ceil(documentCount / 1_000_000);
  return Math.max(1, baseShards * nodeCount);
}

/**
 * 最適なef_searchを計算
 */
function calculateOptimalEfSearch(documentCount: number): number {
  if (documentCount < 100_000) return 128;
  if (documentCount < 1_000_000) return 256;
  if (documentCount < 10_000_000) return 512;
  return 1024;
}

/**
 * OpenSearchクライアントを初期化
 */
async function createOpenSearchClient(): Promise<Client> {
  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
  }

  const region = process.env.AWS_REGION || 'ap-northeast-1';

  const client = new Client({
    ...AwsSigv4Signer({
      region,
      service: 'es',
      getCredentials: () => defaultProvider()(),
    }),
    node: endpoint,
    requestTimeout: 60000,
    maxRetries: 3,
  });

  // 接続テスト
  await client.ping();
  console.log('✓ OpenSearch connection established');

  return client;
}

/**
 * インデックス設定を生成
 */
function generateIndexConfig(options: IndexOptions): any {
  const { documentCount, nodeCount, useProductQuantization } = options;

  const shardCount = calculateOptimalShards(documentCount, nodeCount);
  const efSearch = calculateOptimalEfSearch(documentCount);

  // レプリカ数: 本番環境では1、開発環境では0
  const replicaCount = process.env.NODE_ENV === 'production' ? 1 : 0;

  console.log('\n📊 Index Configuration:');
  console.log(`  Documents: ${documentCount.toLocaleString()}`);
  console.log(`  Nodes: ${nodeCount}`);
  console.log(`  Shards: ${shardCount}`);
  console.log(`  Replicas: ${replicaCount}`);
  console.log(`  ef_search: ${efSearch}`);
  console.log(`  Product Quantization: ${useProductQuantization ? 'Enabled' : 'Disabled'}\n`);

  const config: any = {
    settings: {
      index: {
        // シャード設定
        number_of_shards: shardCount,
        number_of_replicas: replicaCount,

        // k-NN設定
        knn: true,
        'knn.algo_param.ef_search': efSearch,

        // パフォーマンス最適化
        refresh_interval: '30s',
        max_result_window: 10000,
        translog: {
          durability: 'async',
          flush_threshold_size: '512mb',
        },

        // キャッシュ設定
        'cache.query.enable': true,
        'cache.request.enable': true,
        queries: {
          cache: {
            enabled: true,
          },
        },

        // メモリ最適化
        merge: {
          policy: {
            max_merged_segment: '5gb',
          },
        },
        codec: 'best_compression',
      },

      // 日本語アナライザー
      analysis: {
        analyzer: {
          japanese_analyzer: {
            type: 'custom',
            tokenizer: 'kuromoji_tokenizer',
            filter: ['kuromoji_baseform', 'lowercase', 'cjk_width'],
          },
        },
      },
    },

    mappings: {
      properties: {
        // ファイル情報
        file_name: {
          type: 'text',
          analyzer: 'japanese_analyzer',
          fields: {
            keyword: { type: 'keyword' },
          },
        },
        file_path: {
          type: 'text',
          analyzer: 'japanese_analyzer',
          fields: {
            keyword: { type: 'keyword' },
          },
        },
        file_type: { type: 'keyword' },
        file_size: { type: 'long' },
        processed_at: { type: 'date' },

        // テキスト抽出結果
        extracted_text: {
          type: 'text',
          analyzer: 'japanese_analyzer',
        },

        // 画像埋め込みベクトル（1024次元）
        image_embedding: {
          type: 'knn_vector',
          dimension: 1024,
          method: {
            name: 'hnsw',
            space_type: 'innerproduct', // 正規化済みベクトルに最適
            engine: 'faiss',            // 高速エンジン
            parameters: {
              ef_construction: 128,     // インデックス構築時の探索範囲
              m: 24,                     // ノードあたりの双方向リンク数
            },
          },
        },
      },
    },
  };

  // Product Quantizationフィールドを追加
  if (useProductQuantization) {
    config.mappings.properties.image_embedding_pq = {
      type: 'knn_vector',
      dimension: 1024,
      method: {
        name: 'hnsw',
        space_type: 'innerproduct',
        engine: 'faiss',
        parameters: {
          ef_construction: 128,
          m: 16,
          encoder: {
            name: 'pq',
            parameters: {
              code_size: 8,  // 1024 / 8 = 128次元に圧縮
              m: 8,          // サブベクトル数
            },
          },
        },
      },
    };

    console.log('  ✓ Product Quantization field added (87.5% memory reduction)');
  }

  return config;
}

/**
 * メインスクリプト
 */
async function main() {
  const options = parseArgs();

  console.log('🚀 OpenSearch k-NN Optimized Index Creation');
  console.log('==========================================\n');

  try {
    // OpenSearchクライアント初期化
    const client = await createOpenSearchClient();

    // 既存インデックスの確認
    const indexExists = await client.indices.exists({
      index: options.indexName,
    });

    if (indexExists.body) {
      if (options.deleteExisting) {
        console.log(`⚠️  Deleting existing index: ${options.indexName}`);
        await client.indices.delete({
          index: options.indexName,
        });
        console.log('✓ Existing index deleted\n');
      } else {
        console.error(
          `❌ Index '${options.indexName}' already exists. Use --delete-existing to overwrite.`
        );
        process.exit(1);
      }
    }

    // インデックス設定を生成
    const indexConfig = generateIndexConfig(options);

    // インデックス作成
    console.log(`📝 Creating optimized index: ${options.indexName}...`);
    await client.indices.create({
      index: options.indexName,
      body: indexConfig,
    });

    console.log('✓ Index created successfully\n');

    // インデックス設定を確認
    const settings = await client.indices.getSettings({
      index: options.indexName,
    });

    console.log('📋 Index Settings Verification:');
    const indexSettings = settings.body[options.indexName].settings.index;
    console.log(`  Shards: ${indexSettings.number_of_shards}`);
    console.log(`  Replicas: ${indexSettings.number_of_replicas}`);
    console.log(`  k-NN: ${indexSettings.knn}`);
    console.log(`  ef_search: ${indexSettings['knn.algo_param.ef_search']}`);
    console.log(`  Refresh Interval: ${indexSettings.refresh_interval}`);
    console.log(`  Codec: ${indexSettings.codec}\n`);

    // マッピング確認
    const mappings = await client.indices.getMapping({
      index: options.indexName,
    });

    const vectorField =
      mappings.body[options.indexName].mappings.properties.image_embedding;

    console.log('🔍 Vector Field Configuration:');
    console.log(`  Dimension: ${vectorField.dimension}`);
    console.log(`  Method: ${vectorField.method.name}`);
    console.log(`  Space Type: ${vectorField.method.space_type}`);
    console.log(`  Engine: ${vectorField.method.engine}`);
    console.log(
      `  ef_construction: ${vectorField.method.parameters.ef_construction}`
    );
    console.log(`  m: ${vectorField.method.parameters.m}\n`);

    console.log('✅ Index creation completed successfully!');

    // パフォーマンス推奨事項
    console.log('\n💡 Performance Recommendations:');
    console.log(`  1. Monitor query latency (target: < 100ms P95)`);
    console.log(`  2. Track cache hit rate (target: > 60%)`);
    console.log(`  3. Adjust ef_search based on latency vs accuracy needs`);
    console.log(
      `  4. Consider Product Quantization for ${
        options.documentCount > 5_000_000 ? 'this' : 'larger'
      } datasets`
    );
    console.log(`  5. Enable CloudWatch monitoring for production use`);

    await client.close();
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.meta?.body) {
      console.error('Details:', JSON.stringify(error.meta.body, null, 2));
    }
    process.exit(1);
  }
}

// スクリプト実行
main();
