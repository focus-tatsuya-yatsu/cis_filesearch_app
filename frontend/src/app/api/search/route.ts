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

import { NextRequest, NextResponse } from 'next/server';
import { searchDocuments, SearchQuery } from '@/lib/opensearch';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // クエリパラメータを取得
    const query = searchParams.get('q') || '';
    const searchMode = (searchParams.get('searchMode') || 'or') as 'and' | 'or';
    const fileType = searchParams.get('fileType') || undefined;
    const dateFrom = searchParams.get('dateFrom') || undefined;
    const dateTo = searchParams.get('dateTo') || undefined;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const sortBy = (searchParams.get('sortBy') || 'relevance') as 'relevance' | 'date' | 'name' | 'size';
    const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';

    // バリデーション
    if (!query && !fileType && !dateFrom && !dateTo) {
      return NextResponse.json(
        {
          error: 'At least one search parameter is required',
          code: 'INVALID_QUERY'
        },
        { status: 400 }
      );
    }

    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          error: 'Invalid pagination parameters',
          code: 'INVALID_PAGINATION'
        },
        { status: 400 }
      );
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
    };

    // OpenSearchで検索
    const searchResult = await searchDocuments(searchQuery);

    // レスポンスを構築
    const response = {
      success: true,
      data: {
        results: searchResult.results,
        pagination: {
          total: searchResult.total,
          page,
          limit,
          totalPages: Math.ceil(searchResult.total / limit),
        },
        query: {
          q: query,
          searchMode,
          fileType,
          dateFrom,
          dateTo,
          sortBy,
          sortOrder,
        },
        took: searchResult.took,
      },
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    });

  } catch (error: any) {
    console.error('Search API error:', error);

    // エラーハンドリング
    if (error.message?.includes('OPENSEARCH_ENDPOINT')) {
      return NextResponse.json(
        {
          error: 'OpenSearch service is not configured',
          code: 'SERVICE_UNAVAILABLE'
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
      { status: 500 }
    );
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
  });
}
