/**
 * Preview API Route Handler
 * GET /api/preview
 *
 * Query Parameters:
 * - bucket: S3バケット名 (required)
 * - key: S3オブジェクトキー (required)
 * - fileType: ファイルタイプ (required)
 * - pageNumber: PDFのページ番号 (optional)
 * - expiresIn: URL有効期限（秒） (optional, default: 300)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "previewUrl": "https://...",
 *     "expiresAt": "2025-12-16T10:30:00Z",
 *     "metadata": { ... } // PDFの場合のみ
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server'

import { generatePreviewUrlByType, generatePdfPreviewUrl, getPdfMetadata } from '@/lib/s3-preview'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl

    // クエリパラメータを取得
    const bucket = searchParams.get('bucket')
    const key = searchParams.get('key')
    const fileType = searchParams.get('fileType')
    const pageNumberStr = searchParams.get('pageNumber')
    const expiresInStr = searchParams.get('expiresIn')

    // バリデーション
    if (!bucket || !key || !fileType) {
      return NextResponse.json(
        {
          error: 'Missing required parameters: bucket, key, and fileType',
          code: 'INVALID_PARAMETERS',
        },
        { status: 400 }
      )
    }

    const expiresIn = expiresInStr ? parseInt(expiresInStr) : 300

    if (expiresIn < 60 || expiresIn > 3600) {
      return NextResponse.json(
        {
          error: 'expiresIn must be between 60 and 3600 seconds',
          code: 'INVALID_EXPIRES_IN',
        },
        { status: 400 }
      )
    }

    let previewUrl: string
    let metadata: any = null

    // PDFの場合、特別な処理
    if (fileType.toLowerCase() === 'pdf') {
      const pageNumber = pageNumberStr ? parseInt(pageNumberStr) : undefined

      // PDFメタデータを取得
      try {
        metadata = await getPdfMetadata(bucket, key)
      } catch (error) {
        console.warn('Failed to get PDF metadata:', error)
        // メタデータ取得失敗は致命的ではない
      }

      // プレビューURLを生成
      previewUrl = await generatePdfPreviewUrl({
        bucket,
        key,
        pageNumber,
        expiresIn,
      })
    } else {
      // PDFでない場合は、ファイルタイプに応じたプレビューURLを生成
      previewUrl = await generatePreviewUrlByType(bucket, key, fileType, expiresIn)
    }

    // 有効期限を計算
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    const response = {
      success: true,
      data: {
        previewUrl,
        expiresAt,
        expiresIn,
        metadata,
      },
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error: any) {
    console.error('Preview API error:', error)

    // S3関連エラー
    if (error.name === 'NoSuchKey') {
      return NextResponse.json(
        {
          error: 'File not found in S3',
          code: 'FILE_NOT_FOUND',
        },
        { status: 404 }
      )
    }

    if (error.name === 'AccessDenied') {
      return NextResponse.json(
        {
          error: 'Access denied to S3 resource',
          code: 'ACCESS_DENIED',
        },
        { status: 403 }
      )
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
      { status: 500 }
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
