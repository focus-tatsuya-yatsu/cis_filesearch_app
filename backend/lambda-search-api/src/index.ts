/**
 * Lambda Handler for CIS Search API
 * API Gateway → Lambda → OpenSearch
 * + Bedrock画像embedding生成
 */

import { APIGatewayProxyResult, Context } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
// 拡張版OpenSearchサービスを使用（503エラー対策）
import { searchDocuments } from './services/opensearch.service.enhanced';
import { validateSearchQuery } from './utils/validator';
import { handleError, createSuccessResponse } from './utils/error-handler';
import { Logger } from './services/logger.service';
import { SearchQuery } from './types';

// Bedrockクライアント（us-east-1でTitan Embed Image v1を使用）
const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

// S3クライアント
const s3Client = new S3Client({ region: 'ap-northeast-1' });
const THUMBNAIL_BUCKET = 'cis-filesearch-s3-thumbnail';
const LANDING_BUCKET = 'cis-filesearch-s3-landing';
const DOCUWORKS_CONVERTED_PREFIX = 'docuworks-converted/';
const CONVERTED_PDF_PREFIX = 'converted-pdf/';

// CORSヘッダー
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json',
};

/**
 * 画像のembeddingを生成（Bedrock Titan Embed Image v1）
 */
async function generateImageEmbedding(imageBase64: string): Promise<number[]> {
  const command = new InvokeModelCommand({
    modelId: 'amazon.titan-embed-image-v1',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputImage: imageBase64 }),
  });

  const response = await bedrockClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

/**
 * プレビュー画像のPresigned URLを生成
 */
async function getPreviewUrl(fileName: string, pageNumber: number = 1): Promise<string> {
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
 */
async function getPreviewPages(fileName: string): Promise<{ pages: Array<{ pageNumber: number; key: string; size?: number }>; totalPages: number }> {
  const prefix = `previews/${fileName}/`;

  const command = new ListObjectsV2Command({
    Bucket: THUMBNAIL_BUCKET,
    Prefix: prefix,
  });

  const response = await s3Client.send(command);

  if (!response.Contents || response.Contents.length === 0) {
    return { pages: [], totalPages: 0 };
  }

  // ページ番号でソート - nullを除外してソート
  type PageInfo = { pageNumber: number; key: string; size?: number };
  const pages: PageInfo[] = response.Contents
    .map((obj): PageInfo | null => {
      const match = obj.Key?.match(/page_(\d+)\.jpg$/);
      if (!match) return null;
      return {
        pageNumber: parseInt(match[1]),
        key: obj.Key || '',
        size: obj.Size,
      };
    })
    .filter((p): p is PageInfo => p !== null)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  return {
    pages,
    totalPages: pages.length,
  };
}

/**
 * S3オブジェクトの存在を確認
 */
async function checkS3ObjectExists(bucket: string, key: string): Promise<boolean> {
  try {
    // ListObjectsV2で存在確認（HEADリクエストの代わり）
    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: key,
      MaxKeys: 1,
    });
    const response = await s3Client.send(listCommand);
    return response.Contents?.some((obj) => obj.Key === key) || false;
  } catch {
    return false;
  }
}

/**
 * DocuWorks変換済みPDFのPresigned URLを取得
 * 変換済みPDFは以下の形式で保存される:
 * 1. 直接パス: {original_path}.pdf（拡張子のみ変更）
 * 2. docuworks-converted: docuworks-converted/{category}/{server}/{path}/{timestamp}_{server}_{filename}.pdf
 * 3. converted-pdf: converted-pdf/{filename}.pdf
 *
 * 注意: PowerShellスクリプトのバグにより、一部のファイルは異なるサーバーのフォルダに
 * アップロードされている可能性がある (例: ts-server7のファイルがts-server3フォルダに)
 */
async function getDocuWorksConvertedPdfUrl(fileName: string, s3Key?: string): Promise<{ url: string; found: boolean }> {
  // 元のファイル名から拡張子を除去（日本語や記号も含む）
  const baseFileName = fileName.replace(/\.(xdw|xbd)$/i, '');

  // s3Keyのクリーンアップ: OpenSearchに保存された異常な形式を修正
  // 例: "processed/s3://cis-filesearch-s3-landing/documents/road/..." → "documents/road/..."
  let cleanedS3Key = s3Key;
  if (cleanedS3Key) {
    cleanedS3Key = cleanedS3Key.replace(/^processed\/s3:\/\/[^/]+\//, '');
    cleanedS3Key = cleanedS3Key.replace(/^s3:\/\/[^/]+\//, '');
  }
  console.log(`Searching for DocuWorks PDF: fileName=${fileName}, baseFileName=${baseFileName}, s3Key=${s3Key}, cleanedS3Key=${cleanedS3Key}`);

  // ===== Phase 1: 直接パス検索（最も高速） =====
  if (cleanedS3Key) {
    // パターン1: cleanedS3Keyの拡張子をPDFに変更
    const directPdfKey = cleanedS3Key.replace(/\.(xdw|xbd)$/i, '.pdf');
    console.log(`Checking direct path: ${directPdfKey}`);
    if (await checkS3ObjectExists(LANDING_BUCKET, directPdfKey)) {
      console.log(`DocuWorks PDF found at direct path: ${directPdfKey}`);
      const command = new GetObjectCommand({
        Bucket: LANDING_BUCKET,
        Key: directPdfKey,
      });
      const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      return { url, found: true };
    }

    // パターン2: docuworks-converted フォルダで同じパス構造
    const docuworksConvertedKey = cleanedS3Key
      .replace(/^(?:processed|documents)\//, DOCUWORKS_CONVERTED_PREFIX)
      .replace(/\.(xdw|xbd)$/i, '.pdf');
    console.log(`Checking docuworks-converted direct path: ${docuworksConvertedKey}`);
    if (await checkS3ObjectExists(LANDING_BUCKET, docuworksConvertedKey)) {
      console.log(`DocuWorks PDF found at docuworks-converted path: ${docuworksConvertedKey}`);
      const command = new GetObjectCommand({
        Bucket: LANDING_BUCKET,
        Key: docuworksConvertedKey,
      });
      const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      return { url, found: true };
    }
  }

  // ===== Phase 2: converted-pdf フォルダ検索 =====
  const convertedPdfKey = `${CONVERTED_PDF_PREFIX}${baseFileName}.pdf`;
  console.log(`Checking converted-pdf folder: ${convertedPdfKey}`);
  if (await checkS3ObjectExists(LANDING_BUCKET, convertedPdfKey)) {
    console.log(`DocuWorks PDF found in converted-pdf: ${convertedPdfKey}`);
    const command = new GetObjectCommand({
      Bucket: LANDING_BUCKET,
      Key: convertedPdfKey,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { url, found: true };
  }

  // ===== Phase 3: プレフィックス検索（タイムスタンプ付きファイル対応） =====
  // 検索するプレフィックスのリストを構築
  const searchPrefixes: string[] = [];

  if (cleanedS3Key) {
    // cleanedS3Keyからカテゴリとサーバーを抽出
    // 例: documents/road/ts-server3/R06_JOB/.../file.xdw
    const pathMatch = cleanedS3Key.match(/(?:processed|documents)\/(road|structure)\/(ts-server\d+)/);
    if (pathMatch) {
      const category = pathMatch[1];
      const server = pathMatch[2];

      // 1. 正しいパスで検索
      searchPrefixes.push(`${DOCUWORKS_CONVERTED_PREFIX}${category}/${server}/`);

      // 2. PowerShellバグ対策: 同じカテゴリの別サーバーでも検索
      // (ts-server7のファイルがts-server3にアップロードされている可能性)
      if (category === 'road') {
        searchPrefixes.push(`${DOCUWORKS_CONVERTED_PREFIX}road/ts-server3/`);
        searchPrefixes.push(`${DOCUWORKS_CONVERTED_PREFIX}road/ts-server5/`);
      } else if (category === 'structure') {
        searchPrefixes.push(`${DOCUWORKS_CONVERTED_PREFIX}structure/ts-server6/`);
        searchPrefixes.push(`${DOCUWORKS_CONVERTED_PREFIX}structure/ts-server7/`);
      }
    }
  }

  // フォールバック: 全体を検索
  if (searchPrefixes.length === 0) {
    searchPrefixes.push(DOCUWORKS_CONVERTED_PREFIX);
  }

  // 重複を除去
  const uniquePrefixes = [...new Set(searchPrefixes)];
  console.log(`Search prefixes: ${uniquePrefixes.join(', ')}`);

  // ファイル名の正規化: 記号を除去してマッチングしやすくする
  const normalizedBase = baseFileName
    .replace(/[_\-\s]+/g, '') // アンダースコア、ハイフン、スペースを除去
    .toLowerCase();

  // 各プレフィックスで検索
  for (const searchPrefix of uniquePrefixes) {
    console.log(`Searching in: ${searchPrefix}`);

    let continuationToken: string | undefined;
    let searchedCount = 0;
    const maxSearchCount = 5000; // 各プレフィックスで最大5000件

    try {
      while (searchedCount < maxSearchCount) {
        const listCommand = new ListObjectsV2Command({
          Bucket: LANDING_BUCKET,
          Prefix: searchPrefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        });

        const response = await s3Client.send(listCommand);

        if (response.Contents) {
          // ファイル名が含まれているものを検索（部分一致）
          // 変換後のファイル名形式: {timestamp}_{server}_{original_filename}.pdf
          // または: {timestamp}_{server}_{original_filename}_{date}.pdf
          const matchingFile = response.Contents.find((obj) => {
            if (!obj.Key || !obj.Key.endsWith('.pdf')) return false;
            const objFileName = obj.Key.split('/').pop() || '';

            // タイムスタンプとサーバー名プレフィックスを除去して比較
            // 例: "084117_ts-server7_報告書.pdf" → "報告書"
            // 例: "084117_ts-server7_報告書_20260114.pdf" → "報告書_20260114"
            const cleanedName = objFileName
              .replace(/\.pdf$/i, '')
              .replace(/^\d{6}_ts-server\d+_/, ''); // タイムスタンプ_サーバー名_を除去

            // 末尾のタイムスタンプも除去
            const cleanedNameNoTimestamp = cleanedName.replace(/_\d{14}$/, '');

            // 正規化して比較
            const normalizedCleaned = cleanedName.replace(/[_\-\s]+/g, '').toLowerCase();
            const normalizedCleanedNoTs = cleanedNameNoTimestamp.replace(/[_\-\s]+/g, '').toLowerCase();

            // 完全一致（最優先）
            if (cleanedName === baseFileName || cleanedNameNoTimestamp === baseFileName) {
              return true;
            }

            // 正規化して完全一致
            if (normalizedCleaned === normalizedBase || normalizedCleanedNoTs === normalizedBase) {
              return true;
            }

            // 厳格な部分一致: ファイル名が完全に含まれている場合のみ
            // （逆方向の「baseFileName.includes(cleanedName)」は誤マッチの原因になるので削除）
            // タイムスタンプ付きファイル名（例: 084637_ts-server7_元ファイル名_20260114101250.pdf）
            // に対応するため、比率チェックを緩和（20%以上）
            // ただし、ファイル名が短すぎる場合（5文字未満）は除外
            const minMatchRatio = 0.2;
            const minBaseLength = 5;
            if (cleanedName.includes(baseFileName) && baseFileName.length >= minBaseLength) {
              // baseFileNameがcleanedNameに完全に含まれている場合は有効なマッチ
              // 比率チェックは非常に短いファイル名の誤マッチを防ぐためのみ
              if (baseFileName.length / cleanedName.length >= minMatchRatio) {
                return true;
              }
            }

            // 正規化した厳格な部分一致
            if (normalizedCleaned.includes(normalizedBase) && normalizedBase.length >= minBaseLength) {
              if (normalizedBase.length / normalizedCleaned.length >= minMatchRatio) {
                return true;
              }
            }

            return false;
          });

          if (matchingFile?.Key) {
            console.log(`DocuWorks converted PDF found: ${matchingFile.Key}`);
            const command = new GetObjectCommand({
              Bucket: LANDING_BUCKET,
              Key: matchingFile.Key,
            });
            const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
            return { url, found: true };
          }
        }

        searchedCount += response.Contents?.length || 0;
        continuationToken = response.NextContinuationToken;

        if (!continuationToken) {
          break; // これ以上結果がない
        }
      }

      console.log(`Searched ${searchedCount} files in ${searchPrefix}`);
    } catch (err) {
      console.error(`Error searching in ${searchPrefix}:`, err);
    }
  }

  console.log(`DocuWorks PDF not found for: ${baseFileName}`);
  return { url: '', found: false };
}

/**
 * プレビューリクエストを処理
 */
async function handlePreviewRequest(params: {
  action?: string;
  fileName?: string;
  fileType?: string;
  s3Key?: string;
  pageNumber?: number;
}): Promise<APIGatewayProxyResult> {
  const { fileName, fileType, s3Key, pageNumber = 1, action: previewAction } = params;

  if (!fileName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'fileName is required' }),
    };
  }

  try {
    // ファイルタイプに基づいて処理を分岐
    const isDocuWorks = fileType === 'docuworks' ||
                        /\.(xdw|xbd)$/i.test(fileName);

    // DocuWorksファイルの場合は変換済みPDFを返す
    if (isDocuWorks) {
      console.log(`Processing DocuWorks preview request: ${fileName}`);

      const result = await getDocuWorksConvertedPdfUrl(fileName, s3Key);

      if (result.found) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            data: {
              fileName,
              previewType: 'pdf',
              pdfUrl: result.url,
              totalPages: 1, // PDFの場合、フロントエンドでページ数を取得
              message: 'DocuWorks file converted to PDF',
            },
          }),
        };
      } else {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'DocuWorks converted PDF not found',
            message: 'このDocuWorksファイルはまだPDFに変換されていません',
          }),
        };
      }
    }

    // 通常のファイル（JPEG プレビュー）
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

      const page = Math.min(Math.max(1, pageNumber), info.totalPages);
      const previewUrl = await getPreviewUrl(baseFileName, page);

      // 全ページのURLを生成
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
            previewType: 'images',
            currentPage: page,
            totalPages: info.totalPages,
            previewUrl,
            allPages: allPageUrls,
          },
        }),
      };
    }
  } catch (error: any) {
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

const logger = new Logger('LambdaHandler');

/**
 * Lambda Handler
 * API GatewayからのHTTPリクエストを処理
 *
 * Supports both:
 * - REST API (APIGatewayProxyEvent)
 * - HTTP API v2 (APIGatewayProxyEventV2)
 */
export async function handler(
  event: any,
  context: Context
): Promise<APIGatewayProxyResult> {
  // Normalize event format (support both REST API and HTTP API v2)
  const httpMethod = event.httpMethod || event.requestContext?.http?.method || 'UNKNOWN';
  const path = event.path || event.requestContext?.http?.path || event.rawPath || '/';
  const queryParams = event.queryStringParameters || {};

  // リクエストID、タイムスタンプをログに記録
  logger.info('Lambda invoked', {
    requestId: context.awsRequestId,
    httpMethod,
    path,
    eventVersion: event.version || '1.0',
  });

  try {
    // OPTIONSリクエスト（CORS Preflight）
    if (httpMethod === 'OPTIONS') {
      return handleOptionsRequest();
    }

    // POSTリクエストの処理（画像検索用）
    if (httpMethod === 'POST') {
      return await handlePostRequest(event, context);
    }

    // GETリクエストの処理（テキスト検索用）
    if (httpMethod !== 'GET') {
      logger.warn('Method not allowed', { httpMethod, path });
      return createSuccessResponse({
        error: 'Method not allowed',
        code: 'METHOD_NOT_ALLOWED',
      });
    }

    // クエリパラメータは既に上で取得済み

    // バリデーション
    const searchQuery: SearchQuery = validateSearchQuery(queryParams);

    logger.info('Search query validated', { searchQuery });

    // OpenSearchで検索実行
    const searchResult = await searchDocuments(searchQuery);

    // ページネーション情報を構築
    const page = searchQuery.from! / searchQuery.size! + 1;
    const limit = searchQuery.size!;
    const totalPages = Math.ceil(searchResult.total / limit);

    // レスポンスを構築
    const responseData = {
      results: searchResult.results,
      pagination: {
        total: searchResult.total,
        page,
        limit,
        totalPages,
      },
      query: {
        q: searchQuery.query,
        searchMode: searchQuery.searchMode,
        fileType: searchQuery.fileType,
        dateFrom: searchQuery.dateFrom,
        dateTo: searchQuery.dateTo,
        sortBy: searchQuery.sortBy,
        sortOrder: searchQuery.sortOrder,
      },
      took: searchResult.took,
    };

    logger.info('Search completed successfully', {
      resultCount: searchResult.results.length,
      total: searchResult.total,
      took: searchResult.took,
    });

    return createSuccessResponse(responseData);
  } catch (error: any) {
    logger.error('Lambda execution failed', {
      error: error.message,
      stack: error.stack,
    });

    return handleError(error);
  }
}

/**
 * POSTリクエスト処理（画像検索用 + embedding生成）
 */
async function handlePostRequest(
  event: any,
  _context: Context
): Promise<APIGatewayProxyResult> {
  try {
    // リクエストボディをパース
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    // プレビューアクションの処理
    if (body.action === 'get_preview' || body.action === 'get_preview_info') {
      logger.info('Processing preview request', { action: body.action, fileName: body.fileName });
      return await handlePreviewRequest(body);
    }

    // generate-embeddingアクションの処理
    if (body.action === 'generate-embedding' && body.image) {
      logger.info('Generating image embedding', { imageLength: body.image.length });
      try {
        const embedding = await generateImageEmbedding(body.image);
        logger.info('Image embedding generated successfully', { dimensions: embedding.length });
        return createSuccessResponse({
          embedding,
          dimensions: embedding.length,
        });
      } catch (embeddingError: any) {
        logger.error('Failed to generate image embedding', {
          error: embeddingError.message,
          stack: embeddingError.stack,
        });
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            success: false,
            error: {
              code: 'EMBEDDING_GENERATION_FAILED',
              message: 'Failed to generate image embedding',
              details: { originalError: embeddingError.message },
            },
          }),
        };
      }
    }

    logger.info('POST request body parsed', {
      hasImageEmbedding: !!body.imageEmbedding,
      embeddingLength: body.imageEmbedding?.length,
    });

    // バリデーション（POSTリクエスト用）
    const searchQuery: SearchQuery = validateSearchQuery(body);

    logger.info('POST search query validated', {
      searchQuery: {
        ...searchQuery,
        imageEmbedding: searchQuery.imageEmbedding ? `[${searchQuery.imageEmbedding.length} dimensions]` : undefined
      }
    });

    // OpenSearchで検索実行
    const searchResult = await searchDocuments(searchQuery);

    // ページネーション情報を構築
    const page = Math.floor(searchQuery.from! / searchQuery.size!) + 1;
    const limit = searchQuery.size!;
    const totalPages = Math.ceil(searchResult.total / limit);

    // レスポンスを構築
    // フロントエンドの期待するフォーマットに合わせる（totalをトップレベルに配置）
    const responseData = {
      results: searchResult.results,
      total: searchResult.total,  // フロントエンドはdata.totalを期待
      pagination: {
        total: searchResult.total,
        page,
        limit,
        totalPages,
      },
      query: {
        q: searchQuery.query,
        searchMode: searchQuery.searchMode,
        searchType: searchQuery.imageEmbedding ? 'image' : 'text',
        fileType: searchQuery.fileType,
        dateFrom: searchQuery.dateFrom,
        dateTo: searchQuery.dateTo,
        sortBy: searchQuery.sortBy,
        sortOrder: searchQuery.sortOrder,
      },
      took: searchResult.took,
    };

    logger.info('POST search completed successfully', {
      resultCount: searchResult.results.length,
      total: searchResult.total,
      took: searchResult.took,
    });

    return createSuccessResponse(responseData);
  } catch (error: any) {
    logger.error('POST request failed', {
      error: error.message,
      stack: error.stack,
    });

    return handleError(error);
  }
}

/**
 * OPTIONSリクエスト（CORS Preflight）のハンドリング
 */
function handleOptionsRequest(): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '3600',
    },
    body: '',
  };
}
