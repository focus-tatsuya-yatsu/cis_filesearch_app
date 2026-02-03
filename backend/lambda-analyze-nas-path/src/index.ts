/**
 * nas_path分析Lambda関数
 * OpenSearchのnas_pathフィールドの空パターンを分析
 */

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

interface AnalysisResult {
  summary: {
    totalDocuments: number;
    documentsWithNasPath: number;
    documentsWithoutNasPath: number;
    percentageWithoutNasPath: number;
  };
  byServer: Record<string, { withNasPath: number; withoutNasPath: number; percentage: number }>;
  byFileType: Record<string, { withNasPath: number; withoutNasPath: number; percentage: number }>;
  byS3KeyPrefix: Record<string, { withNasPath: number; withoutNasPath: number; percentage: number; samples: string[] }>;
  byDateRange: {
    before2024: { withNasPath: number; withoutNasPath: number };
    year2024: { withNasPath: number; withoutNasPath: number };
    year2025: { withNasPath: number; withoutNasPath: number };
  };
  samples: {
    withNasPath: Array<{
      file_name: string;
      file_path: string;
      nas_path: string;
      file_type: string;
      s3_key?: string;
      indexed_at?: string;
    }>;
    withoutNasPath: Array<{
      file_name: string;
      file_path: string;
      file_type: string;
      s3_key?: string;
      indexed_at?: string;
    }>;
  };
  s3KeyPatternAnalysis: {
    description: string;
    prefixBreakdown: Array<{
      prefix: string;
      total: number;
      withNasPath: number;
      withoutNasPath: number;
      percentageWithout: number;
    }>;
    correlationFindings: string[];
  };
}

let opensearchClient: Client | null = null;

async function getClient(): Promise<Client> {
  if (opensearchClient) {
    return opensearchClient;
  }

  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  const region = process.env.AWS_REGION || 'ap-northeast-1';

  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
  }

  const fullEndpoint = endpoint.startsWith('https://') ? endpoint : `https://${endpoint}`;

  opensearchClient = new Client({
    ...AwsSigv4Signer({
      region,
      service: 'es',
      getCredentials: () => defaultProvider()(),
    }),
    node: fullEndpoint,
    requestTimeout: 60000,
    maxRetries: 3,
  });

  await opensearchClient.ping();
  console.log('OpenSearch client connected successfully');

  return opensearchClient;
}

async function runAnalysis(): Promise<AnalysisResult> {
  const client = await getClient();
  const index = process.env.OPENSEARCH_INDEX || 'cis-files';

  console.log(`Running analysis on index: ${index}`);

  // マッピング情報を取得
  const mappingResponse = await client.indices.getMapping({ index });
  console.log('Index mapping fields:', JSON.stringify(Object.keys(mappingResponse.body[index]?.mappings?.properties || {})));

  // 1. 全体のサマリー
  const totalCount = await client.count({ index });
  const totalDocuments = totalCount.body.count;

  const withNasPathCount = await client.count({
    index,
    body: {
      query: {
        bool: {
          must: [{ exists: { field: 'nas_path' } }],
          must_not: [{ term: { 'nas_path.keyword': '' } }],
        },
      },
    },
  });

  const withoutNasPathCount = await client.count({
    index,
    body: {
      query: {
        bool: {
          should: [
            { bool: { must_not: [{ exists: { field: 'nas_path' } }] } },
            { term: { 'nas_path.keyword': '' } },
          ],
          minimum_should_match: 1,
        },
      },
    },
  });

  // 2. サーバー別分析 (match_phrase方式)
  const servers = ['ts-server3', 'ts-server5', 'ts-server6', 'ts-server7'];
  const byServer: Record<string, { withNasPath: number; withoutNasPath: number; percentage: number }> = {};

  for (const server of servers) {
    // まず総数を取得
    const serverTotal = await client.count({
      index,
      body: {
        query: {
          match_phrase: { file_path: server },
        },
      },
    });

    const serverWithNasPath = await client.count({
      index,
      body: {
        query: {
          bool: {
            must: [
              { match_phrase: { file_path: server } },
              { exists: { field: 'nas_path' } },
            ],
            must_not: [{ term: { 'nas_path.keyword': '' } }],
          },
        },
      },
    });

    const serverWithoutNasPath = await client.count({
      index,
      body: {
        query: {
          bool: {
            must: [{ match_phrase: { file_path: server } }],
            should: [
              { bool: { must_not: [{ exists: { field: 'nas_path' } }] } },
              { term: { 'nas_path.keyword': '' } },
            ],
            minimum_should_match: 1,
          },
        },
      },
    });

    const withPath = serverWithNasPath.body.count;
    const withoutPath = serverWithoutNasPath.body.count;
    const total = serverTotal.body.count;
    console.log(`Server ${server}: total=${total}, withPath=${withPath}, withoutPath=${withoutPath}`);
    byServer[server] = {
      withNasPath: withPath,
      withoutNasPath: withoutPath,
      percentage: total > 0 ? Math.round((withoutPath / total) * 100 * 100) / 100 : 0,
    };
  }

  // 3. ファイルタイプ別分析 (ファイル名のsuffix検索)
  const byFileType: Record<string, { withNasPath: number; withoutNasPath: number; percentage: number }> = {};

  // 主要なファイルタイプをファイル名のsuffix検索で取得
  const fileTypeExtensions: string[] = ['xdw', 'XDW', 'xbd', 'XBD', 'pdf', 'PDF', 'jpg', 'JPG', 'jpeg', 'JPEG', 'png', 'PNG', 'sfc', 'SFC', 'xlsx', 'XLSX', 'xls', 'XLS', 'docx', 'DOCX', 'doc', 'DOC'];

  // file_nameフィールドで正規表現検索
  for (const ext of fileTypeExtensions) {
    const extTotal = await client.count({
      index,
      body: {
        query: {
          regexp: { 'file_name': `.*\\.${ext}$` },
        },
      },
    });

    if (extTotal.body.count === 0) {
      console.log(`FileType ${ext}: no files found`);
      continue;
    }

    const extWithNasPath = await client.count({
      index,
      body: {
        query: {
          bool: {
            must: [
              { regexp: { 'file_name': `.*\\.${ext}$` } },
              { exists: { field: 'nas_path' } },
            ],
            must_not: [{ term: { 'nas_path.keyword': '' } }],
          },
        },
      },
    });

    const extWithoutNasPath = await client.count({
      index,
      body: {
        query: {
          bool: {
            must: [{ regexp: { 'file_name': `.*\\.${ext}$` } }],
            should: [
              { bool: { must_not: [{ exists: { field: 'nas_path' } }] } },
              { term: { 'nas_path.keyword': '' } },
            ],
            minimum_should_match: 1,
          },
        },
      },
    });

    const withPath = extWithNasPath.body.count;
    const withoutPath = extWithoutNasPath.body.count;
    const total = extTotal.body.count;
    console.log(`FileType ${ext}: total=${total}, withPath=${withPath}, withoutPath=${withoutPath}`);
    // 大文字小文字を正規化してマージ
    const normalizedKey = ext.toLowerCase();
    if (byFileType[normalizedKey]) {
      byFileType[normalizedKey].withNasPath += withPath;
      byFileType[normalizedKey].withoutNasPath += withoutPath;
      const newTotal = byFileType[normalizedKey].withNasPath + byFileType[normalizedKey].withoutNasPath;
      byFileType[normalizedKey].percentage = newTotal > 0 ? Math.round((byFileType[normalizedKey].withoutNasPath / newTotal) * 100 * 100) / 100 : 0;
    } else {
      byFileType[normalizedKey] = {
        withNasPath: withPath,
        withoutNasPath: withoutPath,
        percentage: total > 0 ? Math.round((withoutPath / total) * 100 * 100) / 100 : 0,
      };
    }
  }

  // 4. 日付範囲別分析 (indexed_at フィールドを使用)
  const dateRangeAnalysis = await client.search({
    index,
    body: {
      size: 0,
      aggs: {
        before_2024: {
          filter: {
            range: {
              indexed_at: {
                lt: '2024-01-01',
              },
            },
          },
          aggs: {
            has_nas_path: {
              filter: {
                bool: {
                  must: [{ exists: { field: 'nas_path' } }],
                  must_not: [{ term: { 'nas_path.keyword': '' } }],
                },
              },
            },
            no_nas_path: {
              filter: {
                bool: {
                  should: [
                    { bool: { must_not: [{ exists: { field: 'nas_path' } }] } },
                    { term: { 'nas_path.keyword': '' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            },
          },
        },
        year_2024: {
          filter: {
            range: {
              indexed_at: {
                gte: '2024-01-01',
                lt: '2025-01-01',
              },
            },
          },
          aggs: {
            has_nas_path: {
              filter: {
                bool: {
                  must: [{ exists: { field: 'nas_path' } }],
                  must_not: [{ term: { 'nas_path.keyword': '' } }],
                },
              },
            },
            no_nas_path: {
              filter: {
                bool: {
                  should: [
                    { bool: { must_not: [{ exists: { field: 'nas_path' } }] } },
                    { term: { 'nas_path.keyword': '' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            },
          },
        },
        year_2025: {
          filter: {
            range: {
              indexed_at: {
                gte: '2025-01-01',
              },
            },
          },
          aggs: {
            has_nas_path: {
              filter: {
                bool: {
                  must: [{ exists: { field: 'nas_path' } }],
                  must_not: [{ term: { 'nas_path.keyword': '' } }],
                },
              },
            },
            no_nas_path: {
              filter: {
                bool: {
                  should: [
                    { bool: { must_not: [{ exists: { field: 'nas_path' } }] } },
                    { term: { 'nas_path.keyword': '' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            },
          },
        },
      },
    },
  });
  console.log(`Date analysis: before_2024=${dateRangeAnalysis.body.aggregations.before_2024.doc_count}, year_2024=${dateRangeAnalysis.body.aggregations.year_2024.doc_count}, year_2025=${dateRangeAnalysis.body.aggregations.year_2025.doc_count}`);

  // 5. S3キープレフィックス別分析
  // file_pathは s3://cis-filesearch-s3-landing/documents/... 形式で保存されている
  console.log('Starting S3 key prefix analysis...');
  const s3Bucket = 's3://cis-filesearch-s3-landing/';
  const s3KeyPrefixes = ['documents/', 'files/', 'processed/', 'docuworks-converted/', 'thumbnails/'];
  const byS3KeyPrefix: Record<string, { withNasPath: number; withoutNasPath: number; percentage: number; samples: string[] }> = {};
  const prefixBreakdown: Array<{
    prefix: string;
    total: number;
    withNasPath: number;
    withoutNasPath: number;
    percentageWithout: number;
  }> = [];

  for (const prefix of s3KeyPrefixes) {
    // file_pathフィールドでプレフィックスを検索（match_phrase_prefixを使用）
    const fullPrefix = `${s3Bucket}${prefix}`;
    console.log(`Searching with fullPrefix: ${fullPrefix}`);

    // match_phrase_prefixでプレフィックス検索
    const prefixTotal = await client.count({
      index,
      body: {
        query: {
          match_phrase_prefix: { file_path: fullPrefix },
        },
      },
    });

    if (prefixTotal.body.count === 0) {
      console.log(`S3 Prefix ${prefix}: no files found (fullPrefix: ${fullPrefix})`);
      continue;
    }

    const prefixWithNasPath = await client.count({
      index,
      body: {
        query: {
          bool: {
            must: [
              { match_phrase_prefix: { file_path: fullPrefix } },
              { exists: { field: 'nas_path' } },
            ],
            must_not: [{ term: { 'nas_path.keyword': '' } }],
          },
        },
      },
    });

    const prefixWithoutNasPath = await client.count({
      index,
      body: {
        query: {
          bool: {
            must: [{ match_phrase_prefix: { file_path: fullPrefix } }],
            should: [
              { bool: { must_not: [{ exists: { field: 'nas_path' } }] } },
              { term: { 'nas_path.keyword': '' } },
            ],
            minimum_should_match: 1,
          },
        },
      },
    });

    // サンプル取得
    const prefixSamples = await client.search({
      index,
      body: {
        query: {
          match_phrase_prefix: { file_path: fullPrefix },
        },
        size: 5,
        _source: ['file_path'],
      },
    });

    const withPath = prefixWithNasPath.body.count;
    const withoutPath = prefixWithoutNasPath.body.count;
    const total = prefixTotal.body.count;
    const percentage = total > 0 ? Math.round((withoutPath / total) * 100 * 100) / 100 : 0;

    console.log(`S3 Prefix ${prefix}: total=${total}, withPath=${withPath}, withoutPath=${withoutPath}, percentage=${percentage}%`);

    byS3KeyPrefix[prefix] = {
      withNasPath: withPath,
      withoutNasPath: withoutPath,
      percentage,
      samples: prefixSamples.body.hits.hits.map((hit: any) => hit._source.file_path),
    };

    prefixBreakdown.push({
      prefix,
      total,
      withNasPath: withPath,
      withoutNasPath: withoutPath,
      percentageWithout: percentage,
    });
  }

  // 6. カテゴリ + サーバー組み合わせ分析
  console.log('Starting category + server combination analysis...');
  const categories = ['road', 'structure'];
  for (const category of categories) {
    for (const server of servers) {
      const combinedPrefix = `${s3Bucket}documents/${category}/${server}/`;
      const displayPrefix = `documents/${category}/${server}/`;

      const combinedTotal = await client.count({
        index,
        body: {
          query: {
            match_phrase_prefix: { file_path: combinedPrefix },
          },
        },
      });

      if (combinedTotal.body.count === 0) continue;

      const combinedWithNasPath = await client.count({
        index,
        body: {
          query: {
            bool: {
              must: [
                { match_phrase_prefix: { file_path: combinedPrefix } },
                { exists: { field: 'nas_path' } },
              ],
              must_not: [{ term: { 'nas_path.keyword': '' } }],
            },
          },
        },
      });

      const combinedWithoutNasPath = await client.count({
        index,
        body: {
          query: {
            bool: {
              must: [{ match_phrase_prefix: { file_path: combinedPrefix } }],
              should: [
                { bool: { must_not: [{ exists: { field: 'nas_path' } }] } },
                { term: { 'nas_path.keyword': '' } },
              ],
              minimum_should_match: 1,
            },
          },
        },
      });

      const combinedSamples = await client.search({
        index,
        body: {
          query: {
            match_phrase_prefix: { file_path: combinedPrefix },
          },
          size: 3,
          _source: ['file_path'],
        },
      });

      const withPath = combinedWithNasPath.body.count;
      const withoutPath = combinedWithoutNasPath.body.count;
      const total = combinedTotal.body.count;
      const percentage = total > 0 ? Math.round((withoutPath / total) * 100 * 100) / 100 : 0;

      console.log(`Combined ${displayPrefix}: total=${total}, withPath=${withPath}, withoutPath=${withoutPath}`);

      byS3KeyPrefix[displayPrefix] = {
        withNasPath: withPath,
        withoutNasPath: withoutPath,
        percentage,
        samples: combinedSamples.body.hits.hits.map((hit: any) => hit._source.file_path),
      };

      prefixBreakdown.push({
        prefix: displayPrefix,
        total,
        withNasPath: withPath,
        withoutNasPath: withoutPath,
        percentageWithout: percentage,
      });
    }
  }

  // 相関関係の分析結果をまとめる
  const correlationFindings: string[] = [];

  // サーバー別の相関を分析
  for (const server of servers) {
    const serverData = byServer[server];
    if (serverData && serverData.withNasPath + serverData.withoutNasPath > 0) {
      if (serverData.percentage > 80) {
        correlationFindings.push(`${server}: nas_pathが欠落しているファイルが${serverData.percentage}%と非常に高い`);
      } else if (serverData.percentage < 20) {
        correlationFindings.push(`${server}: nas_pathが正常に設定されている（欠落率${serverData.percentage}%）`);
      }
    }
  }

  // プレフィックス別の相関を分析
  for (const item of prefixBreakdown) {
    if (item.total > 100) {
      if (item.percentageWithout > 80) {
        correlationFindings.push(`プレフィックス "${item.prefix}": nas_path欠落率${item.percentageWithout}% (${item.withoutNasPath}/${item.total}件) - 要修正`);
      } else if (item.percentageWithout < 10) {
        correlationFindings.push(`プレフィックス "${item.prefix}": nas_path設定済み（欠落率${item.percentageWithout}%）`);
      }
    }
  }

  // 7. サンプルデータ取得（s3_keyを含める）
  const samplesWithNasPath = await client.search({
    index,
    body: {
      query: {
        bool: {
          must: [{ exists: { field: 'nas_path' } }],
          must_not: [{ term: { 'nas_path.keyword': '' } }],
        },
      },
      size: 20,
      _source: ['file_name', 'file_path', 'nas_path', 'file_type', 'indexed_at', 'processed_at', 's3_key'],
    },
  });

  const samplesWithoutNasPath = await client.search({
    index,
    body: {
      query: {
        bool: {
          should: [
            { bool: { must_not: [{ exists: { field: 'nas_path' } }] } },
            { term: { 'nas_path.keyword': '' } },
          ],
          minimum_should_match: 1,
        },
      },
      size: 20,
      _source: ['file_name', 'file_path', 'nas_path', 'file_type', 'indexed_at', 'processed_at', 's3_key'],
    },
  });

  const dateAggs = dateRangeAnalysis.body.aggregations;
  const byDateRange = {
    before2024: {
      withNasPath: dateAggs.before_2024.has_nas_path.doc_count,
      withoutNasPath: dateAggs.before_2024.no_nas_path.doc_count,
    },
    year2024: {
      withNasPath: dateAggs.year_2024.has_nas_path.doc_count,
      withoutNasPath: dateAggs.year_2024.no_nas_path.doc_count,
    },
    year2025: {
      withNasPath: dateAggs.year_2025.has_nas_path.doc_count,
      withoutNasPath: dateAggs.year_2025.no_nas_path.doc_count,
    },
  };

  return {
    summary: {
      totalDocuments,
      documentsWithNasPath: withNasPathCount.body.count,
      documentsWithoutNasPath: withoutNasPathCount.body.count,
      percentageWithoutNasPath:
        totalDocuments > 0
          ? Math.round((withoutNasPathCount.body.count / totalDocuments) * 100 * 100) / 100
          : 0,
    },
    byServer,
    byFileType,
    byS3KeyPrefix,
    byDateRange,
    samples: {
      withNasPath: samplesWithNasPath.body.hits.hits.map((hit: any) => ({
        file_name: hit._source.file_name,
        file_path: hit._source.file_path,
        nas_path: hit._source.nas_path,
        file_type: hit._source.file_type,
        s3_key: hit._source.s3_key,
        indexed_at: hit._source.indexed_at || hit._source.processed_at,
      })),
      withoutNasPath: samplesWithoutNasPath.body.hits.hits.map((hit: any) => ({
        file_name: hit._source.file_name,
        file_path: hit._source.file_path,
        file_type: hit._source.file_type,
        s3_key: hit._source.s3_key,
        indexed_at: hit._source.indexed_at || hit._source.processed_at,
      })),
    },
    s3KeyPatternAnalysis: {
      description: 'S3キープレフィックスとnas_pathの相関分析結果',
      prefixBreakdown: prefixBreakdown.sort((a, b) => b.total - a.total),
      correlationFindings,
    },
  };
}

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  console.log('Lambda invoked with event:', JSON.stringify(event));

  try {
    const result = await runAnalysis();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result, null, 2),
    };
  } catch (error: any) {
    console.error('Analysis failed:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Analysis failed',
        message: error.message,
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      }),
    };
  }
};

// CLI実行用
if (require.main === module) {
  (async () => {
    try {
      const result = await runAnalysis();
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  })();
}
