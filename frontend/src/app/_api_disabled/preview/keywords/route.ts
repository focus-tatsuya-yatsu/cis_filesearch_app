/**
 * Keyword Highlight API
 * GET /api/preview/keywords
 *
 * PDFファイル内でキーワードを含むページを検索し、ハイライト情報を返す
 *
 * Query Parameters:
 * - bucket: S3バケット名 (required)
 * - key: S3オブジェクトキー (required)
 * - keywords: 検索キーワード（カンマ区切り） (required)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "pages": [
 *       {
 *         "pageNumber": 1,
 *         "keywords": ["keyword1"],
 *         "snippets": [
 *           {
 *             "text": "...keyword1が含まれる文章...",
 *             "keyword": "keyword1",
 *             "position": { "x": 100, "y": 200 }
 *           }
 *         ],
 *         "matchCount": 2
 *       },
 *       ...
 *     ],
 *     "totalMatches": 10,
 *     "keywords": ["keyword1", "keyword2"]
 *   }
 * }
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'

import { getS3Client } from '@/lib/s3-preview'

interface KeywordMatch {
  pageNumber: number
  keywords: string[]
  snippets: Array<{
    text: string
    keyword: string
    position?: {
      x: number
      y: number
    }
  }>
  matchCount: number
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl

    // クエリパラメータを取得
    const bucket = searchParams.get('bucket')
    const key = searchParams.get('key')
    const keywordsStr = searchParams.get('keywords')

    // バリデーション
    if (!bucket || !key || !keywordsStr) {
      return NextResponse.json(
        {
          error: 'Missing required parameters: bucket, key, and keywords',
          code: 'INVALID_PARAMETERS',
        },
        { status: 400 }
      )
    }

    // キーワードを解析
    const keywords = keywordsStr
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0)

    if (keywords.length === 0) {
      return NextResponse.json(
        {
          error: 'At least one keyword is required',
          code: 'NO_KEYWORDS',
        },
        { status: 400 }
      )
    }

    // 最大10キーワードまでの制限
    if (keywords.length > 10) {
      return NextResponse.json(
        {
          error: 'Too many keywords. Maximum is 10 keywords per request.',
          code: 'TOO_MANY_KEYWORDS',
          details: {
            provided: keywords.length,
            maximum: 10,
          },
        },
        { status: 400 }
      )
    }

    // S3からPDFのテキスト抽出結果を取得
    // 処理時に各ページのテキストとページ番号が保存されている想定
    const client = getS3Client()

    // テキスト抽出結果のキーを構築
    // 例: processed/document.pdf -> processed/document.pdf.text.json
    const textKey = `${key}.text.json`

    let pdfTextData: any

    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: textKey,
      })

      const response = await client.send(command)

      if (!response.Body) {
        throw new Error('Text extraction data is empty')
      }

      // ストリームを文字列に変換
      const bodyContents = await streamToString(response.Body)
      pdfTextData = JSON.parse(bodyContents)
    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
        return NextResponse.json(
          {
            error: 'Text extraction data not found. File may not have been processed yet.',
            code: 'TEXT_DATA_NOT_FOUND',
          },
          { status: 404 }
        )
      }
      throw error
    }

    // ページごとのテキストデータ
    // 想定フォーマット:
    // {
    //   "pages": [
    //     {
    //       "page_number": 1,
    //       "text": "ページ1のテキスト内容...",
    //       "words": [
    //         { "text": "単語", "x": 100, "y": 200, "width": 50, "height": 20 }
    //       ]
    //     },
    //     ...
    //   ]
    // }

    const pages: KeywordMatch[] = []
    let totalMatches = 0

    // 各ページでキーワードを検索
    for (const pageData of pdfTextData.pages || []) {
      const pageNumber = pageData.page_number
      const pageText = pageData.text || ''
      const words = pageData.words || []

      const matchedKeywords: string[] = []
      const snippets: any[] = []
      let pageMatchCount = 0

      // 各キーワードを検索
      for (const keyword of keywords) {
        const lowerKeyword = keyword.toLowerCase()
        const lowerPageText = pageText.toLowerCase()

        // キーワードが含まれているか確認
        if (!lowerPageText.includes(lowerKeyword)) {
          continue
        }

        matchedKeywords.push(keyword)

        // キーワードの出現位置を全て検索
        let startIndex = 0
        while (true) {
          const index = lowerPageText.indexOf(lowerKeyword, startIndex)
          if (index === -1) break

          pageMatchCount++
          totalMatches++

          // スニペットを生成（前後100文字）
          const snippetStart = Math.max(0, index - 100)
          const snippetEnd = Math.min(pageText.length, index + keyword.length + 100)
          let snippetText = pageText.substring(snippetStart, snippetEnd)

          // 前後に省略記号を追加
          if (snippetStart > 0) snippetText = '...' + snippetText
          if (snippetEnd < pageText.length) snippetText = snippetText + '...'

          // 位置情報を検索（words配列から）
          let position: { x: number; y: number } | undefined = undefined

          // キーワードに対応する単語を探す
          const matchingWord = words.find((word: any) => {
            const wordText = (word.text || '').toLowerCase()
            return wordText === lowerKeyword
          })

          if (matchingWord) {
            position = {
              x: matchingWord.x || 0,
              y: matchingWord.y || 0,
            }
          }

          snippets.push({
            text: snippetText,
            keyword,
            position,
          })

          startIndex = index + keyword.length

          // 最大5スニペットまで
          if (snippets.length >= 5) break
        }
      }

      // マッチしたキーワードがある場合、ページ情報を追加
      if (matchedKeywords.length > 0) {
        pages.push({
          pageNumber,
          keywords: matchedKeywords,
          snippets,
          matchCount: pageMatchCount,
        })
      }
    }

    const response = {
      success: true,
      data: {
        pages,
        totalMatches,
        keywords,
      },
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error: any) {
    console.error('Keyword Highlight API error:', error)

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
 * ReadableStreamを文字列に変換
 */
async function streamToString(stream: any): Promise<string> {
  const chunks: Uint8Array[] = []

  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString('utf-8')
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
