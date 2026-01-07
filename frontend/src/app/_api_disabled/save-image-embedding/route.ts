/**
 * Save Image Embedding API Route Handler
 * POST /api/save-image-embedding
 *
 * 画像のベクトルをOpenSearchに保存
 *
 * Request Body:
 * - s3Key: string (S3オブジェクトキー、ドキュメントID)
 * - imageEmbedding: number[] (1024-dimensional vector)
 * - fileName?: string (ファイル名、オプション)
 * - filePath?: string (ファイルパス、オプション)
 *
 * Response:
 * - success: boolean
 * - message: string
 */

import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { Client } from '@opensearch-project/opensearch'
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws'
import { NextRequest, NextResponse } from 'next/server'

/**
 * OpenSearch クライアントのシングルトンインスタンス
 */
let opensearchClient: Client | null = null

/**
 * CORSヘッダーを含むJSONレスポンスを生成
 */
function createCorsResponse(data: any, status: number): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

/**
 * OpenSearch クライアントを取得
 */
function getOpenSearchClient(): Client {
  if (opensearchClient) {
    return opensearchClient
  }

  const endpoint = process.env.OPENSEARCH_ENDPOINT
  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is not set')
  }

  const region = process.env.AWS_REGION || 'ap-northeast-1'

  opensearchClient = new Client({
    ...AwsSigv4Signer({
      region,
      service: 'es',
      getCredentials: () => {
        const credentialsProvider = defaultProvider()
        return credentialsProvider()
      },
    }),
    node: `https://${endpoint}`,
    requestTimeout: 30000,
    maxRetries: 3,
  })

  return opensearchClient
}

/**
 * POST /api/save-image-embedding
 * 画像埋め込みベクトルをOpenSearchに保存
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Save Image Embedding API] Starting save request')

    // リクエストボディを取得
    const body = await request.json()
    const { s3Key, imageEmbedding, fileName, filePath } = body

    // バリデーション
    if (!s3Key) {
      console.error('[Save Image Embedding API] Missing s3Key')
      return createCorsResponse(
        {
          success: false,
          error: 'S3 key is required',
          code: 'MISSING_S3_KEY',
        },
        400
      )
    }

    if (!imageEmbedding || !Array.isArray(imageEmbedding) || imageEmbedding.length !== 1024) {
      console.error('[Save Image Embedding API] Invalid image embedding:', {
        isArray: Array.isArray(imageEmbedding),
        length: imageEmbedding?.length,
      })
      return createCorsResponse(
        {
          success: false,
          error: 'Image embedding must be a 1024-dimensional array',
          code: 'INVALID_EMBEDDING',
        },
        400
      )
    }

    console.log('[Save Image Embedding API] Request validated:', {
      s3Key,
      embeddingDimensions: imageEmbedding.length,
      hasFileName: !!fileName,
      hasFilePath: !!filePath,
    })

    // OpenSearch クライアントを取得
    const client = getOpenSearchClient()
    const indexName = process.env.OPENSEARCH_INDEX || 'cis-files'

    console.log('[Save Image Embedding API] Connecting to OpenSearch:', {
      endpoint: process.env.OPENSEARCH_ENDPOINT,
      index: indexName,
    })

    // ドキュメントIDを生成（S3キーをBase64エンコード）
    const documentId = Buffer.from(s3Key).toString('base64')

    // ドキュメントが存在するか確認
    let documentExists = false
    try {
      const existsResponse = await client.exists({
        index: indexName,
        id: documentId,
      })
      documentExists = existsResponse.body
      console.log('[Save Image Embedding API] Document exists:', documentExists)
    } catch (error) {
      console.warn('[Save Image Embedding API] Error checking document existence:', error)
    }

    // ドキュメントを更新または作成
    if (documentExists) {
      // 既存ドキュメントを更新（部分更新）
      console.log('[Save Image Embedding API] Updating existing document')

      const updateBody: any = {
        image_embedding: imageEmbedding,
      }

      // オプションフィールドも更新
      if (fileName) updateBody.file_name = fileName
      if (filePath) updateBody.file_path = filePath

      const updateResponse = await client.update({
        index: indexName,
        id: documentId,
        body: {
          doc: updateBody,
        },
      })

      console.log('[Save Image Embedding API] Document updated successfully:', {
        result: updateResponse.body.result,
        version: updateResponse.body._version,
      })

      return createCorsResponse(
        {
          success: true,
          message: 'Image embedding updated successfully',
          documentId,
          result: updateResponse.body.result,
        },
        200
      )
    } else {
      // 新規ドキュメントを作成
      console.log('[Save Image Embedding API] Creating new document')

      const createBody: any = {
        s3_key: s3Key,
        image_embedding: imageEmbedding,
        file_name: fileName || s3Key.split('/').pop() || 'unknown',
        file_path: filePath || s3Key,
        file_type: fileName ? fileName.split('.').pop()?.toLowerCase() || 'unknown' : 'unknown',
        processed_at: new Date().toISOString(),
      }

      const createResponse = await client.index({
        index: indexName,
        id: documentId,
        body: createBody,
      })

      console.log('[Save Image Embedding API] Document created successfully:', {
        result: createResponse.body.result,
        version: createResponse.body._version,
      })

      return createCorsResponse(
        {
          success: true,
          message: 'Image embedding saved successfully',
          documentId,
          result: createResponse.body.result,
        },
        201
      )
    }
  } catch (error: any) {
    console.error('[Save Image Embedding API] Error occurred:', error)
    console.error('[Save Image Embedding API] Error name:', error.name)
    console.error('[Save Image Embedding API] Error message:', error.message)
    console.error('[Save Image Embedding API] Error stack:', error.stack)

    // OpenSearch接続エラー
    if (error.message?.includes('OPENSEARCH_ENDPOINT')) {
      return createCorsResponse(
        {
          success: false,
          error: 'OpenSearch endpoint not configured',
          code: 'MISSING_ENDPOINT',
        },
        503
      )
    }

    // AWS認証エラー
    if (
      error.message?.toLowerCase().includes('credentials') ||
      error.name === 'CredentialsProviderError'
    ) {
      return createCorsResponse(
        {
          success: false,
          error: 'AWS credentials not configured',
          code: 'MISSING_CREDENTIALS',
        },
        401
      )
    }

    // OpenSearch アクセス権限エラー
    if (error.statusCode === 403 || error.name === 'AccessDeniedException') {
      return createCorsResponse(
        {
          success: false,
          error: 'Access denied to OpenSearch',
          code: 'ACCESS_DENIED',
        },
        403
      )
    }

    // その他の内部エラー
    return createCorsResponse(
      {
        success: false,
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred',
      },
      500
    )
  }
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
