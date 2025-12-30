#!/usr/bin/env node
/**
 * OpenSearchインデックス診断スクリプト
 *
 * 目的:
 * - インデックスの存在確認
 * - マッピング構造の検証（特にimage_embeddingフィールド）
 * - ドキュメント数とサンプルデータの確認
 * - 画像検索用のk-NN設定の検証
 */

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import https from 'https';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';

// 環境変数の読み込み
config({ path: '.env.local' });

interface DiagnosticResult {
  section: string;
  status: 'OK' | 'WARNING' | 'ERROR';
  details: any;
}

const results: DiagnosticResult[] = [];

async function diagnoseOpenSearch() {
  console.log('=================================================');
  console.log('OpenSearch インデックス診断を開始します');
  console.log('=================================================\n');

  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  const indexName = process.env.OPENSEARCH_INDEX || 'file-index';
  const region = process.env.AWS_REGION || 'ap-northeast-1';

  console.log('設定情報:');
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Index: ${indexName}`);
  console.log(`  Region: ${region}\n`);

  if (!endpoint) {
    console.error('❌ OPENSEARCH_ENDPOINT が設定されていません');
    process.exit(1);
  }

  try {
    // OpenSearchクライアントの初期化
    console.log('OpenSearchクライアントを初期化中...');

    const client = new Client({
      ...AwsSigv4Signer({
        region,
        service: 'es',
        getCredentials: () => {
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        },
      }),
      node: endpoint,
      ssl: {
        rejectUnauthorized: false,
      },
      agent: new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true,
        maxSockets: 50,
        timeout: 30000,
      }),
      requestTimeout: 30000,
      maxRetries: 3,
    });

    // 1. 接続テスト
    console.log('\n[1] 接続テスト');
    console.log('---');
    try {
      const pingResult = await client.ping();
      console.log('✅ OpenSearchへの接続成功');
      results.push({
        section: 'Connection',
        status: 'OK',
        details: { statusCode: pingResult.statusCode },
      });
    } catch (error: any) {
      console.error('❌ 接続失敗:', error.message);
      results.push({
        section: 'Connection',
        status: 'ERROR',
        details: { error: error.message },
      });
      throw error;
    }

    // 2. クラスター情報
    console.log('\n[2] クラスター情報');
    console.log('---');
    try {
      const clusterHealth = await client.cluster.health();
      console.log(`  ステータス: ${clusterHealth.body.status}`);
      console.log(`  ノード数: ${clusterHealth.body.number_of_nodes}`);
      console.log(`  データノード数: ${clusterHealth.body.number_of_data_nodes}`);
      console.log(`  アクティブシャード: ${clusterHealth.body.active_shards}`);

      const status = clusterHealth.body.status === 'green' ? 'OK' :
                     clusterHealth.body.status === 'yellow' ? 'WARNING' : 'ERROR';

      results.push({
        section: 'Cluster Health',
        status,
        details: clusterHealth.body,
      });
    } catch (error: any) {
      console.error('❌ クラスター情報の取得に失敗:', error.message);
      results.push({
        section: 'Cluster Health',
        status: 'ERROR',
        details: { error: error.message },
      });
    }

    // 3. インデックスの存在確認
    console.log('\n[3] インデックスの存在確認');
    console.log('---');
    try {
      const indexExists = await client.indices.exists({ index: indexName });

      if (indexExists.body) {
        console.log(`✅ インデックス '${indexName}' が存在します`);
        results.push({
          section: 'Index Existence',
          status: 'OK',
          details: { exists: true },
        });
      } else {
        console.error(`❌ インデックス '${indexName}' が存在しません`);
        results.push({
          section: 'Index Existence',
          status: 'ERROR',
          details: { exists: false },
        });
        throw new Error('Index does not exist');
      }
    } catch (error: any) {
      console.error('❌ インデックス確認エラー:', error.message);
      results.push({
        section: 'Index Existence',
        status: 'ERROR',
        details: { error: error.message },
      });
      throw error;
    }

    // 4. インデックス設定の確認
    console.log('\n[4] インデックス設定');
    console.log('---');
    try {
      const indexSettings = await client.indices.getSettings({ index: indexName });
      const settings = indexSettings.body[indexName]?.settings;

      if (settings?.index) {
        console.log(`  シャード数: ${settings.index.number_of_shards}`);
        console.log(`  レプリカ数: ${settings.index.number_of_replicas}`);

        // k-NN設定の確認
        if ((settings.index as any)['knn']) {
          console.log('✅ k-NN設定が有効です');
          console.log(`  k-NN有効: ${(settings.index as any)['knn']}`);
          results.push({
            section: 'Index Settings (k-NN)',
            status: 'OK',
            details: { knn_enabled: true, settings: (settings.index as any)['knn'] },
          });
        } else {
          console.warn('⚠️  k-NN設定が見つかりません');
          results.push({
            section: 'Index Settings (k-NN)',
            status: 'WARNING',
            details: { knn_enabled: false },
          });
        }
      }
    } catch (error: any) {
      console.error('❌ 設定取得エラー:', error.message);
      results.push({
        section: 'Index Settings',
        status: 'ERROR',
        details: { error: error.message },
      });
    }

    // 5. マッピングの確認
    console.log('\n[5] インデックスマッピング');
    console.log('---');
    try {
      const mappingResponse = await client.indices.getMapping({ index: indexName });
      const mappings = mappingResponse.body[indexName]?.mappings;

      if (!mappings || !mappings.properties) {
        throw new Error('マッピング情報が取得できません');
      }

      console.log('  フィールド一覧:');
      const properties = mappings.properties as any;

      // 重要なフィールドを確認
      const criticalFields = [
        'file_name',
        'file_path',
        'file_type',
        'file_size',
        'processed_at',
        'extracted_text',
        'image_embedding',
        's3_key'
      ];

      criticalFields.forEach(field => {
        if (properties[field]) {
          const fieldType = properties[field].type;
          console.log(`    ✅ ${field}: ${fieldType}`);

          // image_embeddingの詳細を確認
          if (field === 'image_embedding') {
            const embeddingConfig = properties[field];
            console.log(`       - dimensions: ${embeddingConfig.dimension || 'N/A'}`);
            console.log(`       - method: ${embeddingConfig.method?.name || 'N/A'}`);
            console.log(`       - space_type: ${embeddingConfig.method?.space_type || 'N/A'}`);
            console.log(`       - engine: ${embeddingConfig.method?.engine || 'N/A'}`);

            if (fieldType === 'knn_vector' && embeddingConfig.dimension === 1024) {
              results.push({
                section: 'Mapping (image_embedding)',
                status: 'OK',
                details: embeddingConfig,
              });
            } else {
              results.push({
                section: 'Mapping (image_embedding)',
                status: 'ERROR',
                details: {
                  message: 'image_embeddingフィールドの設定が不正です',
                  current: embeddingConfig,
                  expected: { type: 'knn_vector', dimension: 1024 }
                },
              });
            }
          }
        } else {
          console.log(`    ❌ ${field}: 存在しません`);

          if (field === 'image_embedding') {
            results.push({
              section: 'Mapping (image_embedding)',
              status: 'ERROR',
              details: { message: 'image_embeddingフィールドが存在しません' },
            });
          }
        }
      });

      // 全フィールドのリスト
      console.log('\n  全フィールド一覧:');
      Object.keys(properties).forEach(field => {
        console.log(`    - ${field} (${properties[field].type})`);
      });

    } catch (error: any) {
      console.error('❌ マッピング取得エラー:', error.message);
      results.push({
        section: 'Index Mapping',
        status: 'ERROR',
        details: { error: error.message },
      });
    }

    // 6. ドキュメント統計
    console.log('\n[6] ドキュメント統計');
    console.log('---');
    try {
      const countResponse = await client.count({ index: indexName });
      const totalDocs = countResponse.body.count;

      console.log(`  総ドキュメント数: ${totalDocs}`);

      if (totalDocs === 0) {
        console.warn('⚠️  インデックスが空です');
        results.push({
          section: 'Document Count',
          status: 'WARNING',
          details: { count: 0 },
        });
      } else {
        results.push({
          section: 'Document Count',
          status: 'OK',
          details: { count: totalDocs },
        });

        // image_embeddingを持つドキュメントの数を確認
        const embeddingCountResponse = await client.count({
          index: indexName,
          body: {
            query: {
              exists: {
                field: 'image_embedding'
              }
            }
          }
        });

        const embeddingCount = embeddingCountResponse.body.count;
        console.log(`  画像ベクトルを持つドキュメント: ${embeddingCount}`);
        console.log(`  画像ベクトル保有率: ${((embeddingCount / totalDocs) * 100).toFixed(2)}%`);

        if (embeddingCount === 0) {
          console.error('❌ 画像ベクトルを持つドキュメントが存在しません！');
          results.push({
            section: 'Image Embeddings',
            status: 'ERROR',
            details: {
              message: '画像ベクトルを持つドキュメントが0件です',
              totalDocs,
              embeddingCount: 0
            },
          });
        } else {
          results.push({
            section: 'Image Embeddings',
            status: 'OK',
            details: { totalDocs, embeddingCount, percentage: (embeddingCount / totalDocs) * 100 },
          });
        }
      }
    } catch (error: any) {
      console.error('❌ ドキュメント数取得エラー:', error.message);
      results.push({
        section: 'Document Count',
        status: 'ERROR',
        details: { error: error.message },
      });
    }

    // 7. サンプルドキュメントの確認
    console.log('\n[7] サンプルドキュメント');
    console.log('---');
    try {
      const searchResponse = await client.search({
        index: indexName,
        body: {
          query: { match_all: {} },
          size: 3,
        },
      });

      const hits = searchResponse.body.hits.hits;
      console.log(`  取得件数: ${hits.length}`);

      hits.forEach((hit: any, index: number) => {
        const source = hit._source;
        console.log(`\n  サンプル ${index + 1}:`);
        console.log(`    ID: ${hit._id}`);
        console.log(`    ファイル名: ${source.file_name}`);
        console.log(`    ファイルタイプ: ${source.file_type}`);
        console.log(`    処理日時: ${source.processed_at}`);
        console.log(`    image_embedding: ${source.image_embedding ? `存在 (${source.image_embedding.length}次元)` : '存在しない'}`);
        console.log(`    s3_key: ${source.s3_key || 'なし'}`);
      });

      results.push({
        section: 'Sample Documents',
        status: 'OK',
        details: { count: hits.length, samples: hits.map((h: any) => h._source) },
      });
    } catch (error: any) {
      console.error('❌ サンプル取得エラー:', error.message);
      results.push({
        section: 'Sample Documents',
        status: 'ERROR',
        details: { error: error.message },
      });
    }

    // 8. k-NN検索のテスト
    console.log('\n[8] k-NN検索テスト');
    console.log('---');
    try {
      // ランダムなベクトルで検索テスト
      const testVector = Array.from({ length: 1024 }, () => Math.random());

      const knnSearchResponse = await client.search({
        index: indexName,
        body: {
          query: {
            knn: {
              image_embedding: {
                vector: testVector,
                k: 5,
              },
            },
          },
          size: 5,
        },
      });

      const knnHits = knnSearchResponse.body.hits.hits;
      console.log(`  k-NN検索結果: ${knnHits.length}件`);

      if (knnHits.length > 0) {
        console.log('✅ k-NN検索が正常に動作しています');
        knnHits.forEach((hit: any, index: number) => {
          console.log(`    ${index + 1}. ${hit._source.file_name} (score: ${hit._score})`);
        });
        results.push({
          section: 'k-NN Search Test',
          status: 'OK',
          details: { resultCount: knnHits.length },
        });
      } else {
        console.warn('⚠️  k-NN検索で結果が返りません');
        results.push({
          section: 'k-NN Search Test',
          status: 'WARNING',
          details: { resultCount: 0 },
        });
      }
    } catch (error: any) {
      console.error('❌ k-NN検索テストエラー:', error.message);
      results.push({
        section: 'k-NN Search Test',
        status: 'ERROR',
        details: { error: error.message },
      });
    }

    // 診断結果のサマリー
    console.log('\n');
    console.log('=================================================');
    console.log('診断結果サマリー');
    console.log('=================================================\n');

    const errorCount = results.filter(r => r.status === 'ERROR').length;
    const warningCount = results.filter(r => r.status === 'WARNING').length;
    const okCount = results.filter(r => r.status === 'OK').length;

    console.log(`✅ 正常: ${okCount}`);
    console.log(`⚠️  警告: ${warningCount}`);
    console.log(`❌ エラー: ${errorCount}\n`);

    if (errorCount > 0) {
      console.log('エラー詳細:');
      results
        .filter(r => r.status === 'ERROR')
        .forEach(r => {
          console.log(`  ❌ ${r.section}`);
          console.log(`     ${JSON.stringify(r.details, null, 2)}`);
        });
    }

    if (warningCount > 0) {
      console.log('\n警告詳細:');
      results
        .filter(r => r.status === 'WARNING')
        .forEach(r => {
          console.log(`  ⚠️  ${r.section}`);
          console.log(`     ${JSON.stringify(r.details, null, 2)}`);
        });
    }

    // 結果をJSON形式で保存
    const outputPath = '/Users/tatsuya/focus_project/cis_filesearch_app/frontend/scripts/opensearch-diagnosis-result.json';
    writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n診断結果を ${outputPath} に保存しました`);

    await client.close();

    process.exit(errorCount > 0 ? 1 : 0);

  } catch (error: any) {
    console.error('\n診断中に致命的なエラーが発生しました:', error.message);
    console.error('スタックトレース:', error.stack);
    process.exit(1);
  }
}

// 実行
diagnoseOpenSearch();
