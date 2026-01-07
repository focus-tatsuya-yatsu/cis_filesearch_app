/**
 * Search API Route Handler
 * GET /api/search
 *
 * Query Parameters:
 * - q: 検索クエリ (required)
 * - fileType: ファイルタイプフィルター (optional)
 * - dateFrom: 開始日 (optional)
 * - dateTo: 終了日 (optional)
 * - page: ページ番号 (default: 1)
 * - limit: 結果数 (default: 20)
 * - sortBy: ソート基準 (relevance|date|name|size, default: relevance)
 * - sortOrder: ソート順 (asc|desc, default: desc)
 */

import { NextRequest, NextResponse } from 'next/server'

import { SearchQuery } from '@/lib/opensearch'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl

    // クエリパラメータを取得
    const query = searchParams.get('q') || ''
    const searchMode = (searchParams.get('searchMode') || 'or') as 'and' | 'or'
    const fileType = searchParams.get('fileType') || undefined
    const dateFrom = searchParams.get('dateFrom') || undefined
    const dateTo = searchParams.get('dateTo') || undefined
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const sortBy = (searchParams.get('sortBy') || 'relevance') as
      | 'relevance'
      | 'date'
      | 'name'
      | 'size'
    const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc'

    // バリデーション
    if (!query && !fileType && !dateFrom && !dateTo) {
      return NextResponse.json(
        {
          error: 'At least one search parameter is required',
          code: 'INVALID_QUERY',
        },
        { status: 400 }
      )
    }

    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          error: 'Invalid pagination parameters',
          code: 'INVALID_PAGINATION',
        },
        { status: 400 }
      )
    }

    // 検索パラメータを構築
    const searchQuery: SearchQuery = {
      query,
      searchMode,
      fileType,
      dateFrom,
      dateTo,
      size: limit,
      from: (page - 1) * limit,
      sortBy,
      sortOrder,
    }

    // API Gateway URLを取得
    const apiGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL
    if (!apiGatewayUrl) {
      throw new Error('API Gateway URL is not configured')
    }

    // クエリパラメータを構築
    const queryParams = new URLSearchParams()
    if (query) queryParams.append('q', query)
    queryParams.append('searchType', 'text') // Lambdaが期待するsearchTypeパラメータを追加
    queryParams.append('searchMode', searchMode)
    if (fileType) queryParams.append('fileType', fileType)
    if (dateFrom) queryParams.append('dateFrom', dateFrom)
    if (dateTo) queryParams.append('dateTo', dateTo)
    queryParams.append('page', page.toString())
    queryParams.append('limit', limit.toString())
    queryParams.append('sortBy', sortBy)
    queryParams.append('sortOrder', sortOrder)

    // API Gatewayを呼び出す
    const apiResponse = await fetch(`${apiGatewayUrl}?${queryParams.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!apiResponse.ok) {
      const errorData = await apiResponse.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `API Gateway error: ${apiResponse.status}`)
    }

    const apiData = await apiResponse.json()

    // レスポンスを構築（API Gatewayのレスポンスをそのまま返す）
    const response = apiData

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error: any) {
    console.error('Search API error:', error)

    // エラーハンドリング
    if (error.message?.includes('OPENSEARCH_ENDPOINT')) {
      return NextResponse.json(
        {
          error: 'OpenSearch service is not configured',
          code: 'SERVICE_UNAVAILABLE',
        },
        { status: 503 }
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
 * POST handler for search with body parameters
 * More flexible for complex search queries
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // バリデーション
    // 画像検索の場合はimageEmbeddingが必須、それ以外は従来のパラメータが必要
    const hasImageEmbedding =
      body.imageEmbedding && Array.isArray(body.imageEmbedding) && body.imageEmbedding.length > 0
    const hasSearchParams = body.query || body.fileType || body.dateFrom || body.dateTo

    if (!hasImageEmbedding && !hasSearchParams) {
      return NextResponse.json(
        {
          error:
            'At least one search parameter is required (query, fileType, dateRange, or imageEmbedding)',
          code: 'INVALID_QUERY',
        },
        { status: 400 }
      )
    }

    const page = body.page || 1
    const limit = body.size || 20

    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          error: 'Invalid pagination parameters',
          code: 'INVALID_PAGINATION',
        },
        { status: 400 }
      )
    }

    // 検索パラメータを構築
    const searchQuery: SearchQuery = {
      query: body.query || '',
      searchMode: body.searchMode || 'or',
      imageEmbedding: body.imageEmbedding,
      fileType: body.fileType,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      size: limit,
      from: body.from || 0,
      sortBy: body.sortBy || 'relevance',
      sortOrder: body.sortOrder || 'desc',
    }

    // API Gateway URLを取得
    const apiGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL
    if (!apiGatewayUrl) {
      throw new Error('API Gateway URL is not configured')
    }

    // 画像検索の場合はPOSTメソッドでボディを送信
    if (searchQuery.imageEmbedding && searchQuery.imageEmbedding.length > 0) {
      console.log('[POST] Image search request to Lambda', {
        embeddingDimensions: searchQuery.imageEmbedding.length,
        page,
        limit,
        apiGatewayUrl,
      })

      // API Gatewayを呼び出す（POST）
      const apiResponse = await fetch(apiGatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageVector: searchQuery.imageEmbedding, // Lambda関数はimageVectorを期待
          searchType: 'image', // 画像検索用のsearchType
          searchMode: searchQuery.searchMode || 'or',
          page,
          limit, // sizeではなくlimitを使用
          from: (page - 1) * limit,
          sortBy: searchQuery.sortBy || 'relevance',
          sortOrder: searchQuery.sortOrder || 'desc',
          fileType: searchQuery.fileType,
          dateFrom: searchQuery.dateFrom,
          dateTo: searchQuery.dateTo,
        }),
      })

      console.log('[POST] Lambda response status:', {
        status: apiResponse.status,
        statusText: apiResponse.statusText,
        ok: apiResponse.ok,
        headers: Object.fromEntries(apiResponse.headers.entries()),
      })

      // レスポンステキストを先に取得（デバッグ用）
      const responseText = await apiResponse.text()
      console.log('[POST] Lambda raw response:', responseText.substring(0, 500))

      if (!apiResponse.ok) {
        let errorData: any = {}
        try {
          errorData = JSON.parse(responseText)
        } catch (e) {
          console.error('[POST] Failed to parse error response:', e)
        }

        console.error('[POST] Lambda API error:', {
          status: apiResponse.status,
          error: errorData,
          responseText: responseText.substring(0, 1000),
        })
        throw new Error(errorData.error?.message || `API Gateway error: ${apiResponse.status}`)
      }

      let response: any
      try {
        response = JSON.parse(responseText)
      } catch (e) {
        console.error('[POST] Failed to parse success response:', e)
        throw new Error('Invalid JSON response from Lambda')
      }

      console.log('[POST] Lambda response parsed:', {
        success: response.success,
        hasData: !!response.data,
        resultCount: response.data?.results?.length || 0,
        total: response.data?.total || 0,
      })

      return NextResponse.json(response, {
        headers: {
          'Cache-Control': 'private, max-age=60',
        },
      })
    }

    // テキスト検索の場合はGETメソッドでクエリパラメータを送信
    const queryParams = new URLSearchParams()
    if (searchQuery.query) queryParams.append('q', searchQuery.query)
    queryParams.append('searchType', 'text') // Lambdaが期待するsearchTypeパラメータを追加
    queryParams.append('searchMode', searchQuery.searchMode || 'or')
    if (searchQuery.fileType) queryParams.append('fileType', searchQuery.fileType)
    if (searchQuery.dateFrom) queryParams.append('dateFrom', searchQuery.dateFrom)
    if (searchQuery.dateTo) queryParams.append('dateTo', searchQuery.dateTo)
    queryParams.append('page', page.toString())
    queryParams.append('limit', limit.toString())
    queryParams.append('sortBy', searchQuery.sortBy || 'relevance')
    queryParams.append('sortOrder', searchQuery.sortOrder || 'desc')

    // API Gatewayを呼び出す（GET）
    const apiResponse = await fetch(`${apiGatewayUrl}?${queryParams.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!apiResponse.ok) {
      const errorData = await apiResponse.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `API Gateway error: ${apiResponse.status}`)
    }

    const response = await apiResponse.json()

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error: any) {
    console.error('Search API error:', error)

    // エラーハンドリング
    if (error.message?.includes('OPENSEARCH_ENDPOINT')) {
      return NextResponse.json(
        {
          error: 'OpenSearch service is not configured',
          code: 'SERVICE_UNAVAILABLE',
        },
        { status: 503 }
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
