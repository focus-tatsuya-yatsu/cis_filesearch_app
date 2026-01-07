/**
 * PDF Pages Preview API
 * GET /api/preview/pages
 *
 * PDFの全ページまたは指定ページ範囲のプレビューURLを生成
 *
 * Query Parameters:
 * - bucket: S3バケット名 (required)
 * - key: S3オブジェクトキー (required)
 * - startPage: 開始ページ (optional, default: 1)
 * - endPage: 終了ページ (optional, default: totalPages)
 * - keywords: ハイライトキーワード（カンマ区切り） (optional)
 * - expiresIn: URL有効期限（秒） (optional, default: 300)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "pages": [
 *       {
 *         "pageNumber": 1,
 *         "previewUrl": "https://...",
 *         "hasKeywords": true,
 *         "keywords": ["keyword1", "keyword2"]
 *       },
 *       ...
 *     ],
 *     "metadata": {
 *       "totalPages": 10,
 *       "fileName": "document.pdf",
 *       "fileSize": 1024000
 *     },
 *     "expiresAt": "2025-12-16T10:30:00Z"
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server'

import { searchDocuments } from '@/lib/opensearch'
import { generateMultiplePageUrls, getPdfMetadata } from '@/lib/s3-preview'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl

    // クエリパラメータを取得
    const bucket = searchParams.get('bucket')
    const key = searchParams.get('key')
    const startPageStr = searchParams.get('startPage')
    const endPageStr = searchParams.get('endPage')
    const keywordsStr = searchParams.get('keywords')
    const expiresInStr = searchParams.get('expiresIn')

    // バリデーション
    if (!bucket || !key) {
      return NextResponse.json(
        {
          error: 'Missing required parameters: bucket and key',
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

    // PDFメタデータを取得
    const metadata = await getPdfMetadata(bucket, key)

    const startPage = startPageStr ? parseInt(startPageStr) : 1
    const endPage = endPageStr
      ? Math.min(parseInt(endPageStr), metadata.totalPages)
      : metadata.totalPages

    if (startPage < 1 || endPage < startPage || endPage > metadata.totalPages) {
      return NextResponse.json(
        {
          error: 'Invalid page range',
          code: 'INVALID_PAGE_RANGE',
          details: {
            startPage,
            endPage,
            totalPages: metadata.totalPages,
          },
        },
        { status: 400 }
      )
    }

    // ページ番号の配列を生成
    const pageNumbers: number[] = []
    for (let i = startPage; i <= endPage; i++) {
      pageNumbers.push(i)
    }

    // 最大50ページまでの制限
    if (pageNumbers.length > 50) {
      return NextResponse.json(
        {
          error: 'Too many pages requested. Maximum is 50 pages per request.',
          code: 'TOO_MANY_PAGES',
          details: {
            requested: pageNumbers.length,
            maximum: 50,
          },
        },
        { status: 400 }
      )
    }

    // キーワードを解析
    const keywords = keywordsStr
      ? keywordsStr
          .split(',')
          .map((k) => k.trim())
          .filter((k) => k.length > 0)
      : []

    // キーワードを含むページを検索（OpenSearchから取得）
    const pagesWithKeywords: Set<number> = new Set()
    const keywordsByPage: Map<number, string[]> = new Map()

    if (keywords.length > 0) {
      try {
        // OpenSearchで該当ファイルのキーワード検索
        const searchResult = await searchDocuments({
          query: keywords.join(' OR '),
          size: 1,
        })

        // ページごとのキーワード情報を取得
        // 実際の実装では、OpenSearchのページごとのハイライト情報を使用
        // ここでは簡略化のため、全ページに対してキーワードが含まれると仮定
        if (searchResult.results.length > 0) {
          const result = searchResult.results[0]

          // ハイライト情報からページ番号を抽出
          // 実装: extracted_textのハイライトにページ番号情報が含まれている想定
          if (result.highlights?.extractedText) {
            pageNumbers.forEach((pageNum) => {
              pagesWithKeywords.add(pageNum)
              keywordsByPage.set(pageNum, keywords)
            })
          }
        }
      } catch (error) {
        console.warn('Failed to search for keywords:', error)
        // キーワード検索失敗は致命的ではない
      }
    }

    // 複数ページのプレビューURLを生成
    const urlMap = await generateMultiplePageUrls(bucket, key, pageNumbers, expiresIn)

    // レスポンスを構築
    const pages = Array.from(urlMap.entries()).map(([pageNumber, url]) => ({
      pageNumber,
      previewUrl: url,
      hasKeywords: pagesWithKeywords.has(pageNumber),
      keywords: keywordsByPage.get(pageNumber) || [],
    }))

    // ページ番号順にソート
    pages.sort((a, b) => a.pageNumber - b.pageNumber)

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    const response = {
      success: true,
      data: {
        pages,
        metadata: {
          totalPages: metadata.totalPages,
          fileName: metadata.fileName,
          fileSize: metadata.fileSize,
        },
        expiresAt,
      },
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error: any) {
    console.error('PDF Pages Preview API error:', error)

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
