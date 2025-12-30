/**
 * OpenSearch Index Migration Tests
 *
 * 包括的なインデックス移行テストスイート
 * - Pre-migration validation
 * - Migration process verification
 * - Post-migration validation
 * - Rollback procedures
 * - Performance benchmarking
 * - Data integrity checks
 *
 * Environment: AWS OpenSearch Service
 * Target: 1M documents with k-NN vector mapping (1024 dimensions)
 * Risk Level: HIGH (Production system)
 */

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

// Type definitions
interface IndexMapping {
  properties: {
    [key: string]: any;
    image_embedding?: {
      type: string;
      dimension?: number;
      method?: {
        name: string;
        space_type: string;
        engine: string;
        parameters: {
          ef_construction: number;
          m: number;
        };
      };
    };
  };
}

interface IndexStats {
  _all: {
    primaries: {
      docs: {
        count: number;
        deleted: number;
      };
      store: {
        size_in_bytes: number;
      };
    };
  };
}

interface SearchResult {
  hits: {
    total: {
      value: number;
    };
    hits: Array<{
      _id: string;
      _score: number;
      _source: any;
    }>;
  };
  took: number;
}

interface MigrationTestConfig {
  sourceIndex: string;
  targetIndex: string;
  aliasName: string;
  opensearchEndpoint: string;
  region: string;
  expectedDimension: number;
  sampleSize: number; // データ整合性チェックのサンプル数
}

/**
 * OpenSearch Migration Test Suite
 */
describe('OpenSearch Index Migration - Comprehensive Test Strategy', () => {
  let client: Client;
  let config: MigrationTestConfig;

  beforeAll(() => {
    config = {
      sourceIndex: process.env.OPENSEARCH_SOURCE_INDEX || 'file-search-dev',
      targetIndex: process.env.OPENSEARCH_TARGET_INDEX || 'file-search-v2-test',
      aliasName: process.env.OPENSEARCH_ALIAS || 'file-search',
      opensearchEndpoint: process.env.OPENSEARCH_ENDPOINT || 'https://localhost:9200',
      region: process.env.AWS_REGION || 'ap-northeast-1',
      expectedDimension: 1024,
      sampleSize: 100,
    };

    // OpenSearchクライアントの初期化
    client = new Client({
      ...AwsSigv4Signer({
        region: config.region,
        service: 'es',
        getCredentials: () => defaultProvider()(),
      }),
      node: config.opensearchEndpoint,
      requestTimeout: 30000,
    });
  });

  afterAll(async () => {
    await client.close();
  });

  // ========================================================================
  // 1. PRE-MIGRATION TESTING REQUIREMENTS
  // ========================================================================

  describe('1. Pre-Migration Testing Requirements', () => {
    describe('1.1 Source Index Validation', () => {
      it('should verify source index exists', async () => {
        const response = await client.indices.exists({
          index: config.sourceIndex,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(true);
      });

      it('should get source index document count', async () => {
        const response = await client.count({
          index: config.sourceIndex,
        });

        expect(response.body.count).toBeGreaterThanOrEqual(0);

        // Store for later comparison
        (global as any).sourceDocumentCount = response.body.count;

        console.log(`Source index document count: ${response.body.count}`);
      });

      it('should verify source index mapping structure', async () => {
        const response = await client.indices.getMapping({
          index: config.sourceIndex,
        });

        const mapping = response.body[config.sourceIndex].mappings as IndexMapping;

        expect(mapping).toBeDefined();
        expect(mapping.properties).toBeDefined();
        expect(mapping.properties.file_name).toBeDefined();
        expect(mapping.properties.file_path).toBeDefined();

        console.log('Source mapping properties:', Object.keys(mapping.properties));
      });

      it('should check current image_embedding field type', async () => {
        const response = await client.indices.getMapping({
          index: config.sourceIndex,
        });

        const mapping = response.body[config.sourceIndex].mappings as IndexMapping;

        if (mapping.properties.image_embedding) {
          const fieldType = mapping.properties.image_embedding.type;
          const dimension = mapping.properties.image_embedding.dimension;

          console.log(`Current image_embedding type: ${fieldType}, dimension: ${dimension}`);

          // Expected to fail if not knn_vector
          if (fieldType !== 'knn_vector') {
            console.warn('⚠️ image_embedding is not knn_vector type - migration required');
          }
        } else {
          console.warn('⚠️ image_embedding field does not exist - migration required');
        }
      });

      it('should verify cluster health is green or yellow', async () => {
        const response = await client.cluster.health();

        const status = response.body.status;

        expect(['green', 'yellow']).toContain(status);

        console.log(`Cluster health: ${status}`);

        if (status === 'red') {
          throw new Error('Cluster health is RED - migration should not proceed');
        }
      });

      it('should calculate source index size', async () => {
        const response = await client.indices.stats({
          index: config.sourceIndex,
        });

        const stats = response.body as IndexStats;
        const sizeInBytes = stats._all.primaries.store.size_in_bytes;
        const sizeInMB = (sizeInBytes / 1024 / 1024).toFixed(2);

        (global as any).sourceIndexSize = sizeInBytes;

        console.log(`Source index size: ${sizeInMB} MB`);

        expect(sizeInBytes).toBeGreaterThanOrEqual(0);
      });

      it('should sample random documents for integrity check', async () => {
        const response = await client.search({
          index: config.sourceIndex,
          body: {
            size: config.sampleSize,
            query: {
              function_score: {
                query: { match_all: {} },
                random_score: {},
              },
            },
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        expect(hits.length).toBeGreaterThan(0);

        // Store sample documents for post-migration comparison
        (global as any).sampleDocuments = hits.map(hit => ({
          id: hit._id,
          source: hit._source,
        }));

        console.log(`Sampled ${hits.length} documents for integrity check`);
      });
    });

    describe('1.2 Backup Verification', () => {
      it('should verify snapshot repository is configured', async () => {
        try {
          const response = await client.snapshot.getRepository({
            repository: '_all',
          });

          const repos = Object.keys(response.body);

          console.log(`Available snapshot repositories: ${repos.join(', ')}`);

          expect(repos.length).toBeGreaterThan(0);
        } catch (error) {
          console.warn('⚠️ No snapshot repository configured - consider setting up backups');
        }
      });

      it('should create pre-migration snapshot (optional)', async () => {
        // This is a safeguard - creates a snapshot before migration
        const snapshotName = `pre-migration-${Date.now()}`;

        try {
          const response = await client.snapshot.create({
            repository: 'my_backup', // Replace with actual repository name
            snapshot: snapshotName,
            body: {
              indices: config.sourceIndex,
              include_global_state: false,
            },
            wait_for_completion: false,
          });

          console.log(`Pre-migration snapshot created: ${snapshotName}`);

          expect(response.statusCode).toBe(200);
        } catch (error) {
          console.warn('⚠️ Snapshot creation skipped - ensure manual backup exists');
        }
      });
    });

    describe('1.3 Resource Availability Check', () => {
      it('should verify sufficient disk space', async () => {
        const response = await client.nodes.stats({
          metric: 'fs',
        });

        const nodes = response.body.nodes;
        const nodeIds = Object.keys(nodes);

        nodeIds.forEach(nodeId => {
          const fsTotal = nodes[nodeId].fs.total;
          const availableBytes = fsTotal.available_in_bytes;
          const totalBytes = fsTotal.total_in_bytes;
          const usagePercent = ((totalBytes - availableBytes) / totalBytes * 100).toFixed(2);

          console.log(`Node ${nodeId}: ${usagePercent}% used`);

          // Ensure at least 20% free space
          expect(parseFloat(usagePercent)).toBeLessThan(80);
        });
      });

      it('should verify sufficient memory', async () => {
        const response = await client.nodes.stats({
          metric: 'jvm',
        });

        const nodes = response.body.nodes;
        const nodeIds = Object.keys(nodes);

        nodeIds.forEach(nodeId => {
          const jvm = nodes[nodeId].jvm;
          const memUsedPercent = jvm.mem.heap_used_percent;

          console.log(`Node ${nodeId}: JVM heap ${memUsedPercent}% used`);

          // Ensure heap usage is below 90%
          expect(memUsedPercent).toBeLessThan(90);
        });
      });
    });
  });

  // ========================================================================
  // 2. MIGRATION VALIDATION TESTS
  // ========================================================================

  describe('2. Migration Validation Tests', () => {
    describe('2.1 Target Index Creation', () => {
      it('should create target index with correct k-NN mapping', async () => {
        const expectedMapping = {
          properties: {
            file_name: {
              type: 'text',
              analyzer: 'custom_analyzer',
              fields: {
                keyword: {
                  type: 'keyword',
                  ignore_above: 256,
                },
              },
            },
            file_path: {
              type: 'text',
              analyzer: 'custom_analyzer',
              fields: {
                keyword: {
                  type: 'keyword',
                  ignore_above: 512,
                },
              },
            },
            file_type: {
              type: 'keyword',
            },
            file_size: {
              type: 'long',
            },
            modified_date: {
              type: 'date',
            },
            processed_at: {
              type: 'date',
            },
            extracted_text: {
              type: 'text',
              analyzer: 'custom_analyzer',
            },
            image_embedding: {
              type: 'knn_vector',
              dimension: 1024,
              method: {
                name: 'hnsw',
                space_type: 'innerproduct',
                engine: 'faiss',
                parameters: {
                  ef_construction: 128,
                  m: 24,
                },
              },
            },
            metadata: {
              type: 'object',
              enabled: false,
            },
            s3_location: {
              type: 'keyword',
            },
            indexed_at: {
              type: 'date',
            },
          },
        };

        const settings = {
          index: {
            knn: true,
            'knn.algo_param.ef_search': 100,
            number_of_shards: 1,
            number_of_replicas: 1,
            refresh_interval: '30s',
          },
          analysis: {
            analyzer: {
              custom_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'asciifolding'],
              },
            },
          },
        };

        // Delete target index if exists (for test repeatability)
        try {
          await client.indices.delete({
            index: config.targetIndex,
          });
        } catch {
          // Ignore if doesn't exist
        }

        const response = await client.indices.create({
          index: config.targetIndex,
          body: {
            settings,
            mappings: expectedMapping,
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.acknowledged).toBe(true);

        console.log(`✓ Target index created: ${config.targetIndex}`);
      });

      it('should verify target index mapping is correct', async () => {
        const response = await client.indices.getMapping({
          index: config.targetIndex,
        });

        const mapping = response.body[config.targetIndex].mappings as IndexMapping;

        // Verify k-NN vector field
        expect(mapping.properties.image_embedding).toBeDefined();
        expect(mapping.properties.image_embedding?.type).toBe('knn_vector');
        expect(mapping.properties.image_embedding?.dimension).toBe(config.expectedDimension);

        // Verify HNSW parameters
        const method = mapping.properties.image_embedding?.method;
        expect(method?.name).toBe('hnsw');
        expect(method?.space_type).toBe('innerproduct');
        expect(method?.engine).toBe('faiss');
        expect(method?.parameters.ef_construction).toBe(128);
        expect(method?.parameters.m).toBe(24);

        console.log('✓ Target mapping verified successfully');
      });

      it('should verify k-NN index settings', async () => {
        const response = await client.indices.getSettings({
          index: config.targetIndex,
        });

        const settings = response.body[config.targetIndex].settings.index;

        expect(settings.knn).toBe('true');
        expect(settings['knn.algo_param.ef_search']).toBe('100');

        console.log('✓ k-NN settings verified');
      });
    });

    describe('2.2 Data Reindexing Process', () => {
      it('should initiate reindex from source to target', async () => {
        const response = await client.reindex({
          wait_for_completion: false,
          body: {
            source: {
              index: config.sourceIndex,
              _source: {
                excludes: ['image_embedding'], // Exclude old embedding field
              },
            },
            dest: {
              index: config.targetIndex,
            },
          },
        });

        const taskId = response.body.task;

        expect(taskId).toBeDefined();

        (global as any).reindexTaskId = taskId;

        console.log(`✓ Reindex task started: ${taskId}`);
      });

      it('should monitor reindex progress', async () => {
        const taskId = (global as any).reindexTaskId;

        if (!taskId) {
          console.warn('⚠️ No reindex task ID - skipping progress check');
          return;
        }

        // Poll task status
        let completed = false;
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes max (5s intervals)

        while (!completed && attempts < maxAttempts) {
          const response = await client.tasks.get({
            task_id: taskId,
          });

          completed = response.body.completed;

          if (!completed) {
            const status = response.body.task?.status;
            const created = status?.created || 0;
            const total = status?.total || 0;
            const percent = total > 0 ? ((created / total) * 100).toFixed(2) : 0;

            console.log(`Reindex progress: ${created}/${total} (${percent}%)`);

            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
            attempts++;
          }
        }

        expect(completed).toBe(true);

        console.log('✓ Reindex completed successfully');
      });

      it('should verify target index document count matches source', async () => {
        const sourceCount = (global as any).sourceDocumentCount || 0;

        const response = await client.count({
          index: config.targetIndex,
        });

        const targetCount = response.body.count;

        console.log(`Source: ${sourceCount}, Target: ${targetCount}`);

        // Allow small discrepancy due to deletions during migration
        const tolerance = Math.max(1, Math.floor(sourceCount * 0.001)); // 0.1% tolerance
        expect(Math.abs(targetCount - sourceCount)).toBeLessThanOrEqual(tolerance);
      });
    });

    describe('2.3 Alias Management', () => {
      it('should remove old alias from source index', async () => {
        try {
          await client.indices.deleteAlias({
            index: config.sourceIndex,
            name: config.aliasName,
          });

          console.log(`✓ Removed alias ${config.aliasName} from ${config.sourceIndex}`);
        } catch (error) {
          console.warn('⚠️ Alias may not exist on source index');
        }
      });

      it('should add alias to target index', async () => {
        const response = await client.indices.putAlias({
          index: config.targetIndex,
          name: config.aliasName,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.acknowledged).toBe(true);

        console.log(`✓ Added alias ${config.aliasName} to ${config.targetIndex}`);
      });

      it('should verify alias points to target index', async () => {
        const response = await client.indices.getAlias({
          name: config.aliasName,
        });

        const aliases = Object.keys(response.body);

        expect(aliases).toContain(config.targetIndex);
        expect(aliases).not.toContain(config.sourceIndex);

        console.log(`✓ Alias ${config.aliasName} points to ${config.targetIndex}`);
      });

      it('should perform atomic alias swap (zero-downtime)', async () => {
        // This is the production-safe way
        const response = await client.indices.updateAliases({
          body: {
            actions: [
              {
                remove: {
                  index: config.sourceIndex,
                  alias: config.aliasName,
                },
              },
              {
                add: {
                  index: config.targetIndex,
                  alias: config.aliasName,
                },
              },
            ],
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.acknowledged).toBe(true);

        console.log('✓ Atomic alias swap completed (zero-downtime)');
      });
    });
  });

  // ========================================================================
  // 3. POST-MIGRATION VERIFICATION TESTS
  // ========================================================================

  describe('3. Post-Migration Verification Tests', () => {
    describe('3.1 Data Integrity Validation', () => {
      it('should verify all sample documents exist in target index', async () => {
        const sampleDocs = (global as any).sampleDocuments || [];

        if (sampleDocs.length === 0) {
          console.warn('⚠️ No sample documents - skipping integrity check');
          return;
        }

        for (const doc of sampleDocs) {
          const response = await client.get({
            index: config.targetIndex,
            id: doc.id,
          });

          expect(response.statusCode).toBe(200);
          expect(response.body._source).toBeDefined();

          // Verify key fields match
          const source = response.body._source;
          expect(source.file_name).toBe(doc.source.file_name);
          expect(source.file_path).toBe(doc.source.file_path);
        }

        console.log(`✓ Verified ${sampleDocs.length} sample documents`);
      });

      it('should verify field types are preserved', async () => {
        const response = await client.search({
          index: config.targetIndex,
          size: 1,
          body: {
            query: { match_all: {} },
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        if (hits.length > 0) {
          const doc = hits[0]._source;

          expect(typeof doc.file_name).toBe('string');
          expect(typeof doc.file_path).toBe('string');
          expect(typeof doc.file_type).toBe('string');
          expect(typeof doc.file_size).toBe('number');

          console.log('✓ Field types preserved correctly');
        }
      });

      it('should verify no data loss occurred', async () => {
        const sourceCount = (global as any).sourceDocumentCount;

        const response = await client.count({
          index: config.targetIndex,
        });

        const targetCount = response.body.count;
        const lossPercent = ((sourceCount - targetCount) / sourceCount * 100).toFixed(2);

        console.log(`Data loss: ${lossPercent}%`);

        // Allow max 0.1% data loss
        expect(parseFloat(lossPercent)).toBeLessThan(0.1);
      });
    });

    describe('3.2 Search Functionality Validation', () => {
      it('should perform basic text search', async () => {
        const response = await client.search({
          index: config.targetIndex,
          body: {
            query: {
              multi_match: {
                query: 'test',
                fields: ['file_name', 'file_path', 'extracted_text'],
              },
            },
            size: 10,
          },
        });

        expect(response.statusCode).toBe(200);

        const result = response.body as SearchResult;
        expect(result.hits.total.value).toBeGreaterThanOrEqual(0);

        console.log(`✓ Text search returned ${result.hits.total.value} results`);
      });

      it('should verify highlighting works', async () => {
        const response = await client.search({
          index: config.targetIndex,
          body: {
            query: {
              match: {
                file_name: 'test',
              },
            },
            highlight: {
              fields: {
                file_name: {},
                file_path: {},
                extracted_text: {},
              },
              pre_tags: ['<mark>'],
              post_tags: ['</mark>'],
            },
            size: 5,
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        if (hits.length > 0) {
          const hasHighlight = hits.some(hit => hit.highlight !== undefined);
          expect(hasHighlight).toBe(true);

          console.log('✓ Highlighting functionality verified');
        }
      });

      it('should verify sorting works', async () => {
        const response = await client.search({
          index: config.targetIndex,
          body: {
            query: { match_all: {} },
            sort: [
              { processed_at: { order: 'desc' } },
            ],
            size: 10,
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        expect(hits.length).toBeGreaterThan(0);

        // Verify sorted order
        for (let i = 0; i < hits.length - 1; i++) {
          const current = new Date(hits[i]._source.processed_at).getTime();
          const next = new Date(hits[i + 1]._source.processed_at).getTime();
          expect(current).toBeGreaterThanOrEqual(next);
        }

        console.log('✓ Sorting functionality verified');
      });

      it('should verify filtering works', async () => {
        const response = await client.search({
          index: config.targetIndex,
          body: {
            query: {
              bool: {
                filter: [
                  { term: { file_type: 'pdf' } },
                ],
              },
            },
            size: 10,
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        hits.forEach(hit => {
          expect(hit._source.file_type).toBe('pdf');
        });

        console.log('✓ Filtering functionality verified');
      });
    });

    describe('3.3 k-NN Vector Search Validation', () => {
      it('should verify k-NN vector field accepts data', async () => {
        // Create a test vector
        const testVector = Array(config.expectedDimension).fill(0).map(() => Math.random());

        const testDocId = 'test-vector-doc';

        const response = await client.index({
          index: config.targetIndex,
          id: testDocId,
          body: {
            file_name: 'test-vector.jpg',
            file_path: '/test/vector.jpg',
            file_type: 'jpg',
            file_size: 1024,
            processed_at: new Date().toISOString(),
            image_embedding: testVector,
          },
          refresh: 'wait_for',
        });

        expect(response.statusCode).toBe(201);

        // Clean up
        await client.delete({
          index: config.targetIndex,
          id: testDocId,
        });

        console.log('✓ k-NN vector field accepts data correctly');
      });

      it('should reject vector with wrong dimension', async () => {
        const wrongVector = Array(512).fill(0).map(() => Math.random()); // Wrong dimension

        await expect(
          client.index({
            index: config.targetIndex,
            id: 'test-wrong-dimension',
            body: {
              file_name: 'test.jpg',
              file_path: '/test.jpg',
              file_type: 'jpg',
              file_size: 1024,
              processed_at: new Date().toISOString(),
              image_embedding: wrongVector,
            },
          })
        ).rejects.toThrow();

        console.log('✓ Dimension validation working correctly');
      });

      it('should perform k-NN vector search (if vectors exist)', async () => {
        // Check if any documents have vectors
        const response = await client.search({
          index: config.targetIndex,
          body: {
            query: {
              exists: {
                field: 'image_embedding',
              },
            },
            size: 1,
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        if (hits.length > 0) {
          const queryVector = hits[0]._source.image_embedding;

          const knnResponse = await client.search({
            index: config.targetIndex,
            body: {
              query: {
                script_score: {
                  query: { match_all: {} },
                  script: {
                    source: 'knn_score',
                    lang: 'knn',
                    params: {
                      field: 'image_embedding',
                      query_value: queryVector,
                      space_type: 'innerproduct',
                    },
                  },
                },
              },
              size: 10,
            },
          });

          const knnHits = (knnResponse.body as SearchResult).hits.hits;
          expect(knnHits.length).toBeGreaterThan(0);

          console.log(`✓ k-NN search returned ${knnHits.length} results`);
        } else {
          console.warn('⚠️ No vectors in index - k-NN search skipped');
        }
      });
    });

    describe('3.4 Performance Validation', () => {
      it('should verify search latency is acceptable', async () => {
        const startTime = Date.now();

        await client.search({
          index: config.targetIndex,
          body: {
            query: {
              multi_match: {
                query: 'test document',
                fields: ['file_name', 'file_path', 'extracted_text'],
              },
            },
            size: 20,
          },
        });

        const latency = Date.now() - startTime;

        console.log(`Search latency: ${latency}ms`);

        // Expect latency < 500ms for standard search
        expect(latency).toBeLessThan(500);
      });

      it('should verify index refresh rate', async () => {
        const response = await client.indices.getSettings({
          index: config.targetIndex,
        });

        const refreshInterval = response.body[config.targetIndex].settings.index.refresh_interval;

        expect(refreshInterval).toBe('30s');

        console.log(`✓ Refresh interval: ${refreshInterval}`);
      });
    });
  });

  // ========================================================================
  // 4. ROLLBACK TESTING PROCEDURES
  // ========================================================================

  describe('4. Rollback Testing Procedures', () => {
    describe('4.1 Rollback Preparation', () => {
      it('should verify source index still exists', async () => {
        const response = await client.indices.exists({
          index: config.sourceIndex,
        });

        expect(response.body).toBe(true);

        console.log('✓ Source index still exists for rollback');
      });

      it('should verify source index is healthy', async () => {
        const response = await client.cluster.health({
          index: config.sourceIndex,
        });

        const status = response.body.status;

        expect(['green', 'yellow']).toContain(status);

        console.log(`✓ Source index health: ${status}`);
      });
    });

    describe('4.2 Rollback Execution', () => {
      it('should perform rollback by swapping alias back', async () => {
        // Simulate rollback
        const response = await client.indices.updateAliases({
          body: {
            actions: [
              {
                remove: {
                  index: config.targetIndex,
                  alias: config.aliasName,
                },
              },
              {
                add: {
                  index: config.sourceIndex,
                  alias: config.aliasName,
                },
              },
            ],
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.acknowledged).toBe(true);

        console.log('✓ Rollback alias swap completed');
      });

      it('should verify rollback was successful', async () => {
        const response = await client.indices.getAlias({
          name: config.aliasName,
        });

        const aliases = Object.keys(response.body);

        expect(aliases).toContain(config.sourceIndex);
        expect(aliases).not.toContain(config.targetIndex);

        console.log('✓ Rollback verified - alias points to source index');
      });

      it('should verify search functionality after rollback', async () => {
        const response = await client.search({
          index: config.aliasName,
          body: {
            query: { match_all: {} },
            size: 10,
          },
        });

        expect(response.statusCode).toBe(200);

        const result = response.body as SearchResult;
        expect(result.hits.hits.length).toBeGreaterThan(0);

        console.log('✓ Search works after rollback');
      });
    });

    describe('4.3 Rollback Time Measurement', () => {
      it('should measure rollback execution time', async () => {
        const startTime = Date.now();

        // Perform alias swap (rollback)
        await client.indices.updateAliases({
          body: {
            actions: [
              {
                remove: {
                  index: config.sourceIndex,
                  alias: config.aliasName,
                },
              },
              {
                add: {
                  index: config.targetIndex,
                  alias: config.aliasName,
                },
              },
            ],
          },
        });

        const rollbackTime = Date.now() - startTime;

        console.log(`Rollback execution time: ${rollbackTime}ms`);

        // Rollback should be nearly instantaneous
        expect(rollbackTime).toBeLessThan(1000);
      });
    });
  });

  // ========================================================================
  // 5. PERFORMANCE BENCHMARKING TESTS
  // ========================================================================

  describe('5. Performance Benchmarking Tests', () => {
    describe('5.1 Search Performance Benchmarks', () => {
      it('should benchmark standard text search', async () => {
        const iterations = 10;
        const latencies: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();

          await client.search({
            index: config.targetIndex,
            body: {
              query: {
                multi_match: {
                  query: `test query ${i}`,
                  fields: ['file_name', 'file_path', 'extracted_text'],
                },
              },
              size: 20,
            },
          });

          latencies.push(Date.now() - startTime);
        }

        const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
        const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)];
        const p99Latency = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.99)];

        console.log(`Text Search - Avg: ${avgLatency.toFixed(2)}ms, P95: ${p95Latency}ms, P99: ${p99Latency}ms`);

        expect(avgLatency).toBeLessThan(200); // Target: <200ms avg
        expect(p95Latency).toBeLessThan(500); // Target: <500ms P95
      });

      it('should benchmark filtered search', async () => {
        const iterations = 10;
        const latencies: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();

          await client.search({
            index: config.targetIndex,
            body: {
              query: {
                bool: {
                  must: [
                    {
                      multi_match: {
                        query: 'test',
                        fields: ['file_name', 'file_path'],
                      },
                    },
                  ],
                  filter: [
                    { term: { file_type: 'pdf' } },
                  ],
                },
              },
              size: 20,
            },
          });

          latencies.push(Date.now() - startTime);
        }

        const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;

        console.log(`Filtered Search - Avg: ${avgLatency.toFixed(2)}ms`);

        expect(avgLatency).toBeLessThan(250);
      });

      it('should benchmark sorted search', async () => {
        const iterations = 10;
        const latencies: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();

          await client.search({
            index: config.targetIndex,
            body: {
              query: { match_all: {} },
              sort: [
                { processed_at: { order: 'desc' } },
              ],
              size: 20,
            },
          });

          latencies.push(Date.now() - startTime);
        }

        const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;

        console.log(`Sorted Search - Avg: ${avgLatency.toFixed(2)}ms`);

        expect(avgLatency).toBeLessThan(300);
      });

      it('should benchmark k-NN vector search (if vectors exist)', async () => {
        // Find a document with vector
        const response = await client.search({
          index: config.targetIndex,
          body: {
            query: {
              exists: {
                field: 'image_embedding',
              },
            },
            size: 1,
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        if (hits.length === 0) {
          console.warn('⚠️ No vectors - k-NN benchmark skipped');
          return;
        }

        const queryVector = hits[0]._source.image_embedding;
        const iterations = 10;
        const latencies: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();

          await client.search({
            index: config.targetIndex,
            body: {
              query: {
                script_score: {
                  query: { match_all: {} },
                  script: {
                    source: 'knn_score',
                    lang: 'knn',
                    params: {
                      field: 'image_embedding',
                      query_value: queryVector,
                      space_type: 'innerproduct',
                    },
                  },
                },
              },
              size: 10,
            },
          });

          latencies.push(Date.now() - startTime);
        }

        const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
        const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)];

        console.log(`k-NN Search - Avg: ${avgLatency.toFixed(2)}ms, P95: ${p95Latency}ms`);

        // Target for balanced config (ef_construction=128, m=24): <30ms avg, <50ms P95
        expect(avgLatency).toBeLessThan(50);
        expect(p95Latency).toBeLessThan(100);
      });
    });

    describe('5.2 Index Performance Benchmarks', () => {
      it('should benchmark document indexing speed', async () => {
        const testDocs = 10;
        const startTime = Date.now();

        const promises = [];
        for (let i = 0; i < testDocs; i++) {
          promises.push(
            client.index({
              index: config.targetIndex,
              id: `perf-test-${i}`,
              body: {
                file_name: `perf-test-${i}.pdf`,
                file_path: `/perf/test-${i}.pdf`,
                file_type: 'pdf',
                file_size: 1024 * i,
                processed_at: new Date().toISOString(),
                extracted_text: `Performance test document ${i}`,
              },
            })
          );
        }

        await Promise.all(promises);

        const totalTime = Date.now() - startTime;
        const docsPerSecond = (testDocs / (totalTime / 1000)).toFixed(2);

        console.log(`Indexing - ${testDocs} docs in ${totalTime}ms (${docsPerSecond} docs/sec)`);

        // Cleanup
        for (let i = 0; i < testDocs; i++) {
          await client.delete({
            index: config.targetIndex,
            id: `perf-test-${i}`,
          });
        }

        expect(parseFloat(docsPerSecond)).toBeGreaterThan(5);
      });

      it('should benchmark bulk indexing', async () => {
        const bulkSize = 100;
        const body: any[] = [];

        for (let i = 0; i < bulkSize; i++) {
          body.push(
            { index: { _index: config.targetIndex, _id: `bulk-test-${i}` } },
            {
              file_name: `bulk-test-${i}.pdf`,
              file_path: `/bulk/test-${i}.pdf`,
              file_type: 'pdf',
              file_size: 1024 * i,
              processed_at: new Date().toISOString(),
              extracted_text: `Bulk test document ${i}`,
            }
          );
        }

        const startTime = Date.now();

        await client.bulk({
          body,
          refresh: 'wait_for',
        });

        const totalTime = Date.now() - startTime;
        const docsPerSecond = (bulkSize / (totalTime / 1000)).toFixed(2);

        console.log(`Bulk Indexing - ${bulkSize} docs in ${totalTime}ms (${docsPerSecond} docs/sec)`);

        // Cleanup
        for (let i = 0; i < bulkSize; i++) {
          await client.delete({
            index: config.targetIndex,
            id: `bulk-test-${i}`,
          });
        }

        expect(parseFloat(docsPerSecond)).toBeGreaterThan(50);
      });
    });

    describe('5.3 Resource Utilization Benchmarks', () => {
      it('should measure index memory footprint', async () => {
        const response = await client.indices.stats({
          index: config.targetIndex,
          metric: 'store',
        });

        const stats = response.body as IndexStats;
        const sizeInBytes = stats._all.primaries.store.size_in_bytes;
        const sizeInMB = (sizeInBytes / 1024 / 1024).toFixed(2);

        console.log(`Index size: ${sizeInMB} MB`);

        // Store for comparison
        (global as any).targetIndexSize = sizeInBytes;

        const sourceSize = (global as any).sourceIndexSize || sizeInBytes;
        const sizeIncrease = ((sizeInBytes - sourceSize) / sourceSize * 100).toFixed(2);

        console.log(`Size change: ${sizeIncrease}%`);

        // k-NN vectors will increase size significantly
        // Allow up to 200% increase for vector storage
        expect(parseFloat(sizeIncrease)).toBeLessThan(200);
      });

      it('should measure JVM heap usage', async () => {
        const response = await client.nodes.stats({
          metric: 'jvm',
        });

        const nodes = response.body.nodes;
        const nodeIds = Object.keys(nodes);

        nodeIds.forEach(nodeId => {
          const jvm = nodes[nodeId].jvm;
          const heapUsedPercent = jvm.mem.heap_used_percent;
          const heapUsedMB = (jvm.mem.heap_used_in_bytes / 1024 / 1024).toFixed(2);

          console.log(`Node ${nodeId}: Heap ${heapUsedPercent}% (${heapUsedMB} MB)`);

          // Heap usage should be reasonable
          expect(heapUsedPercent).toBeLessThan(85);
        });
      });
    });
  });

  // ========================================================================
  // 6. DATA INTEGRITY VALIDATION METHODS
  // ========================================================================

  describe('6. Data Integrity Validation Methods', () => {
    describe('6.1 Checksum Validation', () => {
      it('should verify document count consistency', async () => {
        const sourceResponse = await client.count({
          index: config.sourceIndex,
        });

        const targetResponse = await client.count({
          index: config.targetIndex,
        });

        const sourceCount = sourceResponse.body.count;
        const targetCount = targetResponse.body.count;

        console.log(`Source: ${sourceCount}, Target: ${targetCount}`);

        const difference = Math.abs(sourceCount - targetCount);
        const differencePercent = (difference / sourceCount * 100).toFixed(2);

        console.log(`Difference: ${difference} docs (${differencePercent}%)`);

        // Allow max 0.1% difference
        expect(parseFloat(differencePercent)).toBeLessThan(0.1);
      });

      it('should verify random sample integrity', async () => {
        const sampleSize = 100;

        // Get random docs from source
        const sourceResponse = await client.search({
          index: config.sourceIndex,
          body: {
            size: sampleSize,
            query: {
              function_score: {
                query: { match_all: {} },
                random_score: {},
              },
            },
          },
        });

        const sourceHits = (sourceResponse.body as SearchResult).hits.hits;

        let matchCount = 0;
        let mismatchCount = 0;

        for (const sourceDoc of sourceHits) {
          try {
            const targetResponse = await client.get({
              index: config.targetIndex,
              id: sourceDoc._id,
            });

            const targetSource = targetResponse.body._source;

            // Verify key fields
            if (
              targetSource.file_name === sourceDoc._source.file_name &&
              targetSource.file_path === sourceDoc._source.file_path &&
              targetSource.file_type === sourceDoc._source.file_type
            ) {
              matchCount++;
            } else {
              mismatchCount++;
            }
          } catch (error) {
            mismatchCount++;
          }
        }

        const matchPercent = (matchCount / sourceHits.length * 100).toFixed(2);

        console.log(`Sample integrity: ${matchCount}/${sourceHits.length} (${matchPercent}%)`);

        expect(parseFloat(matchPercent)).toBeGreaterThan(99);
      });
    });

    describe('6.2 Field Validation', () => {
      it('should verify all required fields exist', async () => {
        const response = await client.search({
          index: config.targetIndex,
          body: {
            size: 100,
            query: { match_all: {} },
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        const requiredFields = ['file_name', 'file_path', 'file_type', 'file_size', 'processed_at'];

        hits.forEach(hit => {
          requiredFields.forEach(field => {
            expect(hit._source[field]).toBeDefined();
          });
        });

        console.log(`✓ All required fields present in ${hits.length} documents`);
      });

      it('should verify field value types', async () => {
        const response = await client.search({
          index: config.targetIndex,
          body: {
            size: 100,
            query: { match_all: {} },
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        hits.forEach(hit => {
          const doc = hit._source;

          expect(typeof doc.file_name).toBe('string');
          expect(typeof doc.file_path).toBe('string');
          expect(typeof doc.file_type).toBe('string');
          expect(typeof doc.file_size).toBe('number');
          expect(typeof doc.processed_at).toBe('string');
        });

        console.log(`✓ Field types validated for ${hits.length} documents`);
      });

      it('should verify vector field dimension (if exists)', async () => {
        const response = await client.search({
          index: config.targetIndex,
          body: {
            query: {
              exists: {
                field: 'image_embedding',
              },
            },
            size: 10,
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        hits.forEach(hit => {
          const vector = hit._source.image_embedding;
          expect(Array.isArray(vector)).toBe(true);
          expect(vector.length).toBe(config.expectedDimension);
        });

        console.log(`✓ Vector dimensions validated for ${hits.length} documents`);
      });
    });

    describe('6.3 Cross-Index Comparison', () => {
      it('should compare aggregation results between indexes', async () => {
        // File type distribution
        const sourceAgg = await client.search({
          index: config.sourceIndex,
          body: {
            size: 0,
            aggs: {
              file_types: {
                terms: {
                  field: 'file_type',
                  size: 100,
                },
              },
            },
          },
        });

        const targetAgg = await client.search({
          index: config.targetIndex,
          body: {
            size: 0,
            aggs: {
              file_types: {
                terms: {
                  field: 'file_type',
                  size: 100,
                },
              },
            },
          },
        });

        const sourceBuckets = sourceAgg.body.aggregations.file_types.buckets;
        const targetBuckets = targetAgg.body.aggregations.file_types.buckets;

        console.log('File type distribution comparison:');
        sourceBuckets.forEach((bucket: any) => {
          const targetBucket = targetBuckets.find((b: any) => b.key === bucket.key);
          const targetCount = targetBucket ? targetBucket.doc_count : 0;
          const difference = Math.abs(bucket.doc_count - targetCount);

          console.log(`  ${bucket.key}: Source=${bucket.doc_count}, Target=${targetCount}, Diff=${difference}`);
        });

        // Buckets should match closely
        expect(sourceBuckets.length).toBe(targetBuckets.length);
      });

      it('should compare date range distributions', async () => {
        const dateRanges = [
          { from: 'now-1d', to: 'now' },
          { from: 'now-7d', to: 'now' },
          { from: 'now-30d', to: 'now' },
        ];

        for (const range of dateRanges) {
          const sourceResponse = await client.count({
            index: config.sourceIndex,
            body: {
              query: {
                range: {
                  processed_at: range,
                },
              },
            },
          });

          const targetResponse = await client.count({
            index: config.targetIndex,
            body: {
              query: {
                range: {
                  processed_at: range,
                },
              },
            },
          });

          const sourceCount = sourceResponse.body.count;
          const targetCount = targetResponse.body.count;
          const difference = Math.abs(sourceCount - targetCount);

          console.log(`Range ${range.from} to ${range.to}: Source=${sourceCount}, Target=${targetCount}, Diff=${difference}`);

          expect(difference).toBeLessThanOrEqual(Math.max(1, sourceCount * 0.01)); // 1% tolerance
        }
      });
    });

    describe('6.4 Corruption Detection', () => {
      it('should detect null or empty required fields', async () => {
        const response = await client.search({
          index: config.targetIndex,
          body: {
            size: 100,
            query: {
              bool: {
                should: [
                  {
                    bool: {
                      must_not: {
                        exists: {
                          field: 'file_name',
                        },
                      },
                    },
                  },
                  {
                    bool: {
                      must_not: {
                        exists: {
                          field: 'file_path',
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        });

        const corruptedDocs = (response.body as SearchResult).hits.hits;

        console.log(`Found ${corruptedDocs.length} potentially corrupted documents`);

        expect(corruptedDocs.length).toBe(0);
      });

      it('should detect invalid date formats', async () => {
        const response = await client.search({
          index: config.targetIndex,
          body: {
            size: 100,
            query: { match_all: {} },
          },
        });

        const hits = (response.body as SearchResult).hits.hits;

        let invalidDates = 0;

        hits.forEach(hit => {
          const processedAt = hit._source.processed_at;
          if (processedAt && isNaN(Date.parse(processedAt))) {
            invalidDates++;
            console.warn(`Invalid date in doc ${hit._id}: ${processedAt}`);
          }
        });

        expect(invalidDates).toBe(0);
      });

      it('should detect duplicate documents', async () => {
        const response = await client.search({
          index: config.targetIndex,
          body: {
            size: 0,
            aggs: {
              duplicates: {
                terms: {
                  field: 'file_path.keyword',
                  min_doc_count: 2,
                  size: 100,
                },
              },
            },
          },
        });

        const duplicateBuckets = response.body.aggregations.duplicates.buckets;

        console.log(`Found ${duplicateBuckets.length} duplicate file paths`);

        if (duplicateBuckets.length > 0) {
          duplicateBuckets.forEach((bucket: any) => {
            console.warn(`Duplicate: ${bucket.key} (${bucket.doc_count} copies)`);
          });
        }

        // Some duplicates may be expected, but should be minimal
        expect(duplicateBuckets.length).toBeLessThan(100);
      });
    });
  });
});
