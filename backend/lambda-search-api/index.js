/**
 * CIS File Search Lambda Function
 * OpenSearch検索 + Bedrock画像embedding生成
 * フィルター機能対応版
 */

const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// OpenSearch設定
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT || 'vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com';
const REGION = 'ap-northeast-1';

// Bedrockクライアント
const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

// S3クライアント
const s3Client = new S3Client({ region: REGION });
const THUMBNAIL_BUCKET = 'cis-filesearch-s3-thumbnail';

// OpenSearchクライアント作成
const createOpenSearchClient = () => {
  return new Client({
    ...AwsSigv4Signer({
      region: REGION,
      service: 'es',
      getCredentials: () => defaultProvider()(),
    }),
    node: `https://${OPENSEARCH_ENDPOINT}`,
  });
};

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json'
};

/**
 * file_nameがない場合、file_pathからファイル名を抽出
 */
function extractFileName(source) {
  if (source.file_name) {
    return source.file_name;
  }
  // file_pathからファイル名を抽出
  const filePath = source.file_path || '';
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath || 'Unknown';
}

/**
 * 画像のembeddingを生成
 */
async function generateImageEmbedding(imageBase64) {
  const command = new InvokeModelCommand({
    modelId: 'amazon.titan-embed-image-v1',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputImage: imageBase64 })
  });
  
  const response = await bedrockClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

/**
 * プレビュー画像のPresigned URLを生成
 * @param {string} fileName - ファイル名（拡張子なし）
 * @param {number} pageNumber - ページ番号（1始まり）
 * @returns {Promise<string>} Presigned URL
 */
async function getPreviewUrl(fileName, pageNumber = 1) {
  const key = `previews/${fileName}/page_${pageNumber}.jpg`;
  
  const command = new GetObjectCommand({
    Bucket: THUMBNAIL_BUCKET,
    Key: key,
  });
  
  // 5分間有効なPresigned URLを生成
  const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  return url;
}

/**
 * ファイルの全プレビューページ情報を取得
 * @param {string} fileName - ファイル名（拡張子なし）
 * @returns {Promise<{pages: Array, totalPages: number}>}
 */
async function getPreviewPages(fileName) {
  const prefix = `previews/${fileName}/`;
  
  const command = new ListObjectsV2Command({
    Bucket: THUMBNAIL_BUCKET,
    Prefix: prefix,
  });
  
  const response = await s3Client.send(command);
  
  if (!response.Contents || response.Contents.length === 0) {
    return { pages: [], totalPages: 0 };
  }
  
  // ページ番号でソート
  const pages = response.Contents
    .map(obj => {
      const match = obj.Key.match(/page_(\d+)\.jpg$/);
      return match ? {
        pageNumber: parseInt(match[1]),
        key: obj.Key,
        size: obj.Size,
      } : null;
    })
    .filter(p => p !== null)
    .sort((a, b) => a.pageNumber - b.pageNumber);
  
  return {
    pages,
    totalPages: pages.length,
  };
}

/**
 * プレビューリクエストを処理
 * @param {Object} params - リクエストパラメータ
 * @returns {Promise<Object>} レスポンス
 */
async function handlePreviewRequest(params) {
  const { fileName, pageNumber = 1, action: previewAction } = params;
  
  if (!fileName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'fileName is required' }),
    };
  }
  
  try {
    // ファイル名から拡張子を除去
    const baseFileName = fileName.replace(/\.[^/.]+$/, '');
    
    if (previewAction === 'get_preview_info') {
      // プレビュー情報のみ取得
      const info = await getPreviewPages(baseFileName);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            fileName: baseFileName,
            totalPages: info.totalPages,
            pages: info.pages,
          },
        }),
      };
    } else {
      // 指定ページのPresigned URLを取得
      const info = await getPreviewPages(baseFileName);
      
      if (info.totalPages === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Preview not found for this file',
          }),
        };
      }
      
      const page = Math.min(Math.max(1, parseInt(pageNumber)), info.totalPages);
      const previewUrl = await getPreviewUrl(baseFileName, page);
      
      // 全ページのURLを生成（オプション）
      const allPageUrls = await Promise.all(
        info.pages.map(async (p) => ({
          pageNumber: p.pageNumber,
          url: await getPreviewUrl(baseFileName, p.pageNumber),
          size: p.size,
        }))
      );
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            fileName: baseFileName,
            currentPage: page,
            totalPages: info.totalPages,
            previewUrl,
            allPages: allPageUrls,
          },
        }),
      };
    }
  } catch (error) {
    console.error('Preview error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
}

/**
 * フィルター条件からOpenSearchクエリを構築
 */
function buildFilterQuery(params) {
  const filters = [];
  
  // カテゴリフィルター - シンプルなmatch
  if (params.categories && params.categories.length > 0) {
    const categoryFilters = params.categories.map(cat => {
      if (cat === 'road') {
        return { match: { file_path: 'road' } };
      } else if (cat === 'structure') {
        return { match: { file_path: 'structure' } };
      }
      return null;
    }).filter(f => f !== null);
    
    if (categoryFilters.length > 0) {
      filters.push({ bool: { should: categoryFilters, minimum_should_match: 1 } });
    }
  }
  
  // フォルダフィルター
  if (params.folders && params.folders.length > 0) {
    const folderFilters = params.folders.map(folder => ({
      match: { file_path: folder }
    }));
    filters.push({ bool: { should: folderFilters, minimum_should_match: 1 } });
  }
  
  // ファイルタイプフィルター（file_nameの拡張子でワイルドカード検索）
  if (params.fileType && params.fileType !== 'all') {
    const typeMapping = {
      'pdf': ['.pdf', '.PDF'],
      'xlsx': ['.xlsx', '.XLSX', '.xls', '.XLS'],
      'docx': ['.docx', '.DOCX', '.doc', '.DOC'],
      'pptx': ['.pptx', '.PPTX', '.ppt', '.PPT'],
      'xdw': ['.xdw', '.XDW', '.xbd', '.XBD'],
      'image': ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF', '.bmp', '.BMP', '.tiff', '.TIFF'],
      'other': []
    };
    const extensions = typeMapping[params.fileType];
    if (extensions && extensions.length > 0) {
      // 拡張子をmatchクエリで検索（analyzer経由でトークン化される）
      const typeFilters = extensions.map(ext => ({
        match_phrase: { file_name: ext }
      }));
      filters.push({ bool: { should: typeFilters, minimum_should_match: 1 } });
    } else if (params.fileType === 'other') {
      const knownExtensions = ['.pdf', '.PDF', '.xlsx', '.XLSX', '.xls', '.XLS', '.docx', '.DOCX', '.doc', '.DOC', '.pptx', '.PPTX', '.ppt', '.PPT', '.xdw', '.XDW', '.xbd', '.XBD', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.gif', '.GIF', '.bmp', '.BMP', '.tiff', '.TIFF'];
      const excludeFilters = knownExtensions.map(ext => ({
        match_phrase: { file_name: ext }
      }));
      // 既知の拡張子を除外し、file_nameが存在するドキュメントのみ
      filters.push({ 
        bool: { 
          must: [{ exists: { field: 'file_name' } }],
          must_not: excludeFilters 
        } 
      });
    }
  }
  
  // 日付フィルター
  if (params.dateFrom || params.dateTo) {
    const dateField = params.dateFilterType === 'modification' ? 'modified_at' : 'created_at';
    const dateFilter = { range: { [dateField]: {} } };
    if (params.dateFrom) dateFilter.range[dateField].gte = params.dateFrom;
    if (params.dateTo) dateFilter.range[dateField].lte = params.dateTo;
    filters.push(dateFilter);
  }
  
  return filters;
}

/**
 * メインハンドラー
 */
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event));
  
  try {
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    
    // OPTIONS（CORS preflight）
    if (httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: corsHeaders, body: '' };
    }
    
    // パラメータ取得
    let params = {};
    if (httpMethod === 'POST' && event.body) {
      params = JSON.parse(event.body);
    } else if (event.queryStringParameters) {
      params = event.queryStringParameters;
    }
    
    console.log('Params:', JSON.stringify(params));
    
    // 削除リクエストの処理

    // プレビューリクエストの処理
    if (params.action === 'get_preview' || params.action === 'get_preview_info') {
      return await handlePreviewRequest(params);
    }

    if (params.action === 'delete_by_query') {
      const client = createOpenSearchClient();
      try {
        const targetIndex = params.index || 'cis-files';
        console.log('Deleting from index:', targetIndex);
        console.log('Delete query:', JSON.stringify(params.query));
        const response = await client.deleteByQuery({
          index: targetIndex,
          body: {
            query: params.query
          },
          refresh: true
        });
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            deleted: response.body.deleted,
            total: response.body.total
          })
        };
      } catch (error) {
        console.error('Delete error:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: error.message })
        };
      }
    }
    
    // embedding生成アクション
    if (params.action === 'generate-embedding' && params.image) {
      console.log('Generating embedding for image...');
      const embedding = await generateImageEmbedding(params.image);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            embedding: embedding,
            dimensions: embedding.length
          }
        })
      };
    }
    
    // 検索処理
    const client = createOpenSearchClient();
    const searchType = params.searchType || 'text';
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 20;
    const searchQuery = params.searchQuery || params.q || '';
    const searchMode = params.searchMode || 'or';
    const sortBy = params.sortBy || 'relevance';
    const sortOrder = params.sortOrder || 'desc';
    const imageVector = params.imageVector;

    // OpenSearch max_result_window制限チェック（デフォルト: 10,000）
    const MAX_RESULT_WINDOW = 10000;
    const from = (page - 1) * limit;
    if (from + limit > MAX_RESULT_WINDOW) {
      console.warn(`Pagination limit exceeded: from=${from}, limit=${limit}, max=${MAX_RESULT_WINDOW}`);
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'PAGINATION_LIMIT_EXCEEDED',
          message: `検索結果の表示上限（${MAX_RESULT_WINDOW.toLocaleString()}件）を超えています。検索条件を絞り込んでください。`,
          details: {
            requestedFrom: from,
            requestedLimit: limit,
            maxResultWindow: MAX_RESULT_WINDOW,
            maxAccessiblePage: Math.floor(MAX_RESULT_WINDOW / limit)
          }
        })
      };
    }
    
    let indexName, searchBody;
    
    // フィルター条件を構築
    const filterClauses = buildFilterQuery(params);
    console.log('Filter clauses:', JSON.stringify(filterClauses));
    console.log('Categories param:', params.categories);
    
    if (searchType === 'image' && imageVector) {
      // ハイブリッド検索（テキスト + 画像）またはに対応
      if (searchQuery && searchQuery.trim()) {
        // ハイブリッド検索: テキストで絞り込み → 画像で類似度スコアリング
        console.log('Hybrid search: text + image');

        // Step 1: テキスト検索でファイルパスを取得
        const textClient = createOpenSearchClient();
        const textQueryObj = {
          bool: {
            should: [
              {
                multi_match: {
                  query: searchQuery,
                  fields: ['file_name^3', 'content^2', 'file_path'],
                  operator: searchMode === 'and' ? 'and' : 'or'
                }
              }
            ],
            minimum_should_match: 1
          }
        };
        
        const textSearchBody = {
          size: 1000, // テキスト検索で最大1000件取得
          track_total_hits: true,
          query: {
            bool: {
              must: [textQueryObj],
              filter: filterClauses
            }
          },
          _source: ['file_name', 'file_path', 'file_type', 'file_size', 'modified_at', 'content']
        };
        
        console.log('Text search body:', JSON.stringify(textSearchBody));
        
        const textResponse = await textClient.search({
          index: 'cis-files',
          body: textSearchBody
        });
        
        const textHits = textResponse.body.hits.hits;
        console.log('Text search results:', textHits.length);
        const imageFilesInText = textHits.filter(h => /\.(jpg|jpeg|png|gif|bmp)$/i.test(h._source.file_path));

        if (textHits.length === 0) {
          // テキスト検索結果が0件の場合
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              success: true,
              data: {
                results: [],
                total: 0,
                page,
                limit,
                searchType: 'hybrid',
                index: 'hybrid'
              }
            })
          };
        }
        
        // Step 2: テキスト検索結果のフォルダパスで画像インデックスを検索
        // ファイルパスからユニークなフォルダパスを抽出
        const folderPaths = [...new Set(textHits.map(hit => {
          const path = hit._source.file_path;
          return path.substring(0, path.lastIndexOf('/'));
        }))];

        // 元のファイルパスも保持（後方互換性のため）
        const filePaths = textHits.map(hit => hit._source.file_path);
        
        // 画像インデックスでkNN検索（フィルタなし、多めに取得して後でフィルタ）
        indexName = 'file-index-v2-knn';
        searchBody = {
          size: 500, // 多めに取得
          from: 0,
          track_total_hits: true,
          query: {
            knn: {
              image_embedding: {
                vector: imageVector,
                k: 500
              }
            }
          },
          _source: ['file_name', 'file_path', 'file_type', 'file_size', 'modified_at', 'department', 'tags']
        };
        
        // テキスト検索結果をマップに保存（後でスニペットを結合）
        const textResultsMap = {};
        textHits.forEach(hit => {
          textResultsMap[hit._source.file_path] = {
            textScore: hit._score,
            content: hit._source.content,
            snippet: hit._source.content ? hit._source.content.substring(0, 200) : ''
          };
        });
        
        // 画像検索を実行
        const imageClient = createOpenSearchClient();
        
        const imageResponse = await imageClient.search({
          index: indexName,
          body: searchBody
        });

        // フォルダパスでフィルタ
        const filteredHits = imageResponse.body.hits.hits.filter(hit => {
          const hitFolder = hit._source.file_path.substring(0, hit._source.file_path.lastIndexOf('/'));
          return folderPaths.some(folder => hitFolder.startsWith(folder) || folder.startsWith(hitFolder));
        });

        // フィルタ後の結果で置き換え
        const totalFilteredCount = filteredHits.length; // フィルタ後の全件数を保持
        imageResponse.body.hits.hits = filteredHits.slice(0, limit);
        imageResponse.body.hits.total = { value: totalFilteredCount, relation: 'eq' };

        // 結果を結合
        const hybridResults = imageResponse.body.hits.hits.map(hit => {
          const filePath = hit._source.file_path;
          const textData = textResultsMap[filePath] || {};
          return {
            id: hit._id,
            fileName: extractFileName(hit._source),
            filePath: filePath,
            fileType: hit._source.file_type,
            fileSize: hit._source.file_size,
            modifiedDate: hit._source.modified_date,
            department: hit._source.department,
            tags: hit._source.tags,
            imageScore: hit._score,
            textScore: textData.textScore || 0,
            snippet: textData.snippet || '',
            relevanceScore: hit._score // 画像スコアをメインに
          };
        });
        
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            data: {
              results: hybridResults,
              textSearchCount: textResponse.body.hits.total.value || textHits.length,
              imageSearchCount: imageResponse.body.hits.hits.length,
              total: totalFilteredCount,
              page,
              limit,
              searchType: 'hybrid',
              index: 'hybrid',
              appliedFilters: {
                categories: params.categories || [],
                folders: params.folders || [],
                fileType: params.fileType || 'all',
                dateFrom: params.dateFrom || null,
                dateTo: params.dateTo || null
              }
            }
          })
        };
      }
      
      // 画像のみ検索（kNN）
      
      indexName = 'file-index-v2-knn';
      
      searchBody = {
        size: limit,
        from: (page - 1) * limit,
        track_total_hits: true,
        query: {
          bool: {
            must: [
              {
                knn: {
                  image_embedding: {
                    vector: imageVector,
                    k: Math.min(limit * 2, 100)
                  }
                }
              }
            ],
            filter: filterClauses
          }
        },
        _source: ['file_name', 'file_path', 'file_type', 'file_size', 'modified_at', 'department', 'tags']
      };
    } else {
      // テキスト検索
      indexName = 'cis-files';
      
      let queryObj;
      if (!searchQuery.trim()) {
        queryObj = { match_all: {} };
      } else {
        queryObj = {
          bool: {
            should: [
              {
                multi_match: {
                  query: searchQuery,
                  fields: ['file_name^3', 'content^2', 'file_path'],
                  operator: searchMode === 'and' ? 'and' : 'or'
                }
              },
              {
                wildcard: {
                  file_name: {
                    value: `*${searchQuery}*`,
                    boost: 2
                  }
                }
              }
            ],
            minimum_should_match: 1
          }
        };
      }
      
      // フィルター条件を追加
      searchBody = {
        size: limit,
        from: (page - 1) * limit,
        track_total_hits: true,
        query: filterClauses.length > 0 ? {
          bool: {
            must: [queryObj],
            filter: filterClauses
          }
        } : queryObj,
        highlight: {
          // unifiedタイプは最も堅牢なハイライター
          type: 'unified',
          fields: {
            content: {
              fragment_size: 150,
              number_of_fragments: 1
            }
          }
        },
        _source: ['file_name', 'file_path', 'file_type', 'file_size', 'created_at', 'modified_at', 'department', 'tags', 'content']
      };
      
      // ソート
      if (sortBy === 'date') {
        searchBody.sort = [{ modified_at: { order: sortOrder, missing: '_last' } }];
      } else if (sortBy === 'size') {
        searchBody.sort = [{ file_size: { order: sortOrder } }];
      } else if (sortBy === 'name') {
        searchBody.sort = [{ 'file_name': { order: sortOrder } }];
      }
    }
    
    console.log('Search body:', JSON.stringify(searchBody));
    
    // テキストインデックスのサムネイル数を確認（デバッグ用）
    if (indexName === 'cis-files' && !params.debugChecked) {
      try {
        const thumbCount = await client.count({
          index: 'cis-files',
          body: {
            query: {
              exists: { field: 'thumbnail_s3_key' }
            }
          }
        });
        console.log('Docs with thumbnail_s3_key:', thumbCount.body.count);
        
        // サンプルを取得
        const sampleDoc = await client.search({
          index: 'cis-files',
          body: {
            size: 3,
            query: { exists: { field: 'thumbnail_s3_key' } },
            _source: ['file_name', 'file_path', 'thumbnail_s3_key', 'thumbnail_url']
          }
        });
        if (sampleDoc.body.hits.hits.length > 0) {
          console.log('Sample thumbnail docs:', JSON.stringify(sampleDoc.body.hits.hits.map(h => ({
            file: h._source.file_name,
            thumb_key: h._source.thumbnail_s3_key
          }))));
        }
      } catch (e) {
        console.log('Thumbnail check error:', e.message);
      }
    }
    
    // OpenSearch検索実行
    console.log('OpenSearch Query:', JSON.stringify(searchBody, null, 2));
    const response = await client.search({
      index: indexName,
      body: searchBody
    });
    console.log('OpenSearch response total:', response.body.hits.total);
    console.log('OpenSearch response hits count:', response.body.hits.hits.length);
    const sampleTypes = response.body.hits.hits.slice(0, 10).map(h => h._source.file_type);
    
    // カテゴリ判定用：roadを含まないファイルパスを検出
    const nonRoadFiles = response.body.hits.hits
      .filter(h => !h._source.file_path.toLowerCase().includes('road'))
      .slice(0, 10)
      .map(h => h._source.file_path);
    if (nonRoadFiles.length > 0) {
      console.log('Files without "road" in path:', JSON.stringify(nonRoadFiles));
    }
    console.log('Sample file_type values:', JSON.stringify(sampleTypes));
    
    // デバッグ: 検索結果のファイル拡張子を確認
    if (response.body.hits.hits.length > 0) {
      const extensions = {};
      response.body.hits.hits.forEach(hit => {
        const path = hit._source.file_path || '';
        const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
        extensions[ext] = (extensions[ext] || 0) + 1;
      });
      console.log('File extensions in results:', JSON.stringify(extensions));
      console.log('Index used:', indexName);
    
    // 全結果のカテゴリ分布を確認（road/structureを含むかどうか）
    const totalHits = response.body.hits.total.value || response.body.hits.total;
    if (searchType === 'image' && totalHits > 20) {
      // 全件取得して分析（最大500件）
      const allDocsResponse = await client.search({
        index: indexName,
        body: {
          size: 500,
          _source: ['file_path'],
          query: searchBody.query
        }
      });
      const allPaths = allDocsResponse.body.hits.hits.map(h => h._source.file_path);
      const roadCount = allPaths.filter(p => p.toLowerCase().includes('road')).length;
      const structureCount = allPaths.filter(p => p.toLowerCase().includes('structure')).length;
      const otherPaths = allPaths.filter(p => !p.toLowerCase().includes('road') && !p.toLowerCase().includes('structure'));
      console.log('Category distribution (up to 500):', JSON.stringify({
        total: allPaths.length,
        road: roadCount,
        structure: structureCount,
        other: otherPaths.length
      }));
      if (otherPaths.length > 0) {
        console.log('Files without road/structure:', JSON.stringify(otherPaths.slice(0, 10)));
      }
    }
    }
    
    // 画像インデックスのサンプルファイルタイプを確認（デバッグ用）
    if (indexName === 'file-index-v2-knn') {
      try {
        const sampleResponse = await client.search({
          index: 'file-index-v2-knn',
          body: {
            size: 100,
            _source: ['file_path', 'file_type']
          }
        });
        
        // バケット別にカウント
        const bucketCount = { landing: 0, thumbnail: 0, other: 0 };
        sampleResponse.body.hits.hits.forEach(hit => {
          const path = hit._source.file_path || '';
          if (path.includes('thumbnail')) bucketCount.thumbnail++;
          else if (path.includes('landing')) bucketCount.landing++;
          else bucketCount.other++;
        });
        console.log('KNN index bucket distribution (100 docs):', JSON.stringify(bucketCount));
        console.log('Sample paths:', sampleResponse.body.hits.hits.slice(0, 3).map(h => h._source.file_path));
      } catch (e) {
        console.log('Sample query error:', e.message);
      }
    }
    
    // 結果整形
    const results = response.body.hits.hits.map(hit => ({
      id: hit._id,
      fileName: extractFileName(hit._source),
      filePath: hit._source.file_path,
      fileType: hit._source.file_type,
      fileSize: hit._source.file_size,
      modifiedDate: hit._source.modified_date,
      department: hit._source.department,
      tags: hit._source.tags,
      snippet: hit.highlight?.content?.[0] || hit._source.content?.substring(0, 200) || '',
      relevanceScore: hit._score,
      highlights: hit.highlight || {}
    }));
    
    const total = typeof response.body.hits.total === 'object' 
      ? response.body.hits.total.value 
      : response.body.hits.total;
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: {
          results,
          total,
          page,
          limit,
          searchType,
          index: indexName,
          appliedFilters: {
            categories: params.categories || [],
            folders: params.folders || [],
            fileType: params.fileType || 'all',
            dateFrom: params.dateFrom || null,
            dateTo: params.dateTo || null
          }
        }
      })
    };
    
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
