/**
 * Batch Process Images API Route Handler
 * POST /api/batch-process-images
 *
 * S3バケット内の画像を一括処理してベクトル化し、OpenSearchに保存
 *
 * Request Body (optional):
 * - maxFiles: number (最大処理ファイル数、デフォルト: 1000)
 * - batchSize: number (並列処理数、デフォルト: 10)
 * - prefix: string (S3プレフィックス、デフォルト: 'thumbnails/')
 *
 * Response:
 * - success: boolean
 * - stats: BatchProcessingStats
 */

import { NextRequest, NextResponse } from 'next/server'

import { batchProcessImages } from '@/services/batch-process-images'

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
 * POST /api/batch-process-images
 * S3画像の一括処理
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Batch Process API] Starting batch processing request')

    // リクエストボディを取得（オプション設定）
    const body = await request.json().catch(() => ({}))
    const { maxFiles, batchSize, prefix } = body

    console.log('[Batch Process API] Configuration:', {
      maxFiles: maxFiles || 'default',
      batchSize: batchSize || 'default',
      prefix: prefix || 'default',
    })

    // 環境変数を一時的に上書き（設定がある場合）
    if (maxFiles) {
      process.env.BATCH_MAX_FILES = maxFiles.toString()
    }
    if (batchSize) {
      process.env.BATCH_SIZE = batchSize.toString()
    }
    if (prefix) {
      process.env.BATCH_S3_PREFIX = prefix
    }

    // バッチ処理を実行
    const stats = await batchProcessImages()

    console.log('[Batch Process API] Batch processing completed:', {
      total: stats.total,
      successful: stats.successful,
      failed: stats.failed,
    })

    return createCorsResponse(
      {
        success: true,
        message: 'Batch processing completed',
        stats: {
          total: stats.total,
          processed: stats.processed,
          successful: stats.successful,
          failed: stats.failed,
          successRate:
            stats.total > 0 ? `${((stats.successful / stats.total) * 100).toFixed(2)}%` : '0%',
          errors: stats.errors.slice(0, 10), // 最初の10件のエラーのみ返す
        },
      },
      200
    )
  } catch (error: any) {
    console.error('[Batch Process API] Error occurred:', error)
    console.error('[Batch Process API] Error stack:', error.stack)

    return createCorsResponse(
      {
        success: false,
        error: 'Batch processing failed',
        code: 'BATCH_PROCESS_ERROR',
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
