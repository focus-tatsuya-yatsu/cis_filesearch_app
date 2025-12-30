# S3プレビューAPI設計ガイド

## 概要

このドキュメントでは、S3に保存されたファイル（特にPDF）のプレビュー機能を実装するためのAPIアーキテクチャと実装詳細を説明します。

## 主要機能

### 1. Presigned URL生成（5分有効期限）

ファイルへの一時的な読み取りアクセスを提供し、セキュリティを確保しながら直接S3からファイルを取得可能にします。

**メリット：**
- ダウンロード不要でブラウザで直接表示
- タイムラグ最小化
- セキュアなアクセス制御

### 2. PDFの全ページプレビュー

表紙だけでなく、PDFのすべてのページにアクセス可能です。

**実装方式：**
- ページごとのS3オブジェクト生成（バックエンド処理時）
- メタデータファイルでページ数を管理
- ページ範囲指定による効率的な取得

### 3. 検索キーワードハイライト

検索キーワードを含むページを特定し、該当箇所をハイライト表示します。

**機能：**
- キーワードを含むページの自動検出
- テキスト抽出結果からのスニペット生成
- ページ内の位置情報（座標）の提供

### 4. 直接サーバーアクセス

Presigned URLを使用してS3から直接ファイルを取得するため、プロキシサーバーを経由せずに高速アクセスが可能です。

---

## アーキテクチャ

### システム構成

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│             │         │              │         │             │
│  Frontend   │────────▶│  Next.js API │────────▶│  AWS S3     │
│  (React)    │         │  Routes      │         │             │
│             │         │              │         │             │
└─────────────┘         └──────────────┘         └─────────────┘
                               │
                               │
                               ▼
                        ┌──────────────┐
                        │              │
                        │  OpenSearch  │
                        │  (Keyword    │
                        │   Search)    │
                        │              │
                        └──────────────┘
```

### データフロー

1. **プレビューリクエスト**
   ```
   Frontend → /api/preview?bucket=...&key=...&fileType=pdf
   ```

2. **Presigned URL生成**
   ```
   Next.js API → AWS S3 SDK → Presigned URL
   ```

3. **ブラウザでファイル表示**
   ```
   Frontend → S3 (Presigned URL) → ファイルダウンロード → ブラウザ表示
   ```

4. **キーワード検索**
   ```
   Frontend → /api/preview/keywords?keywords=...
           ↓
   S3 (テキスト抽出データ) → キーワードマッチング → ハイライト情報
   ```

---

## API仕様

### 1. `/api/preview` - 単一ファイルプレビュー

**エンドポイント:** `GET /api/preview`

**Query Parameters:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| bucket | string | ✅ | S3バケット名 |
| key | string | ✅ | S3オブジェクトキー |
| fileType | string | ✅ | ファイルタイプ（pdf, jpg, png, etc.） |
| pageNumber | number | ❌ | PDFのページ番号（PDFのみ） |
| expiresIn | number | ❌ | URL有効期限（秒、デフォルト: 300） |

**レスポンス例:**

```json
{
  "success": true,
  "data": {
    "previewUrl": "https://cis-filesearch-storage.s3.amazonaws.com/...",
    "expiresAt": "2025-12-16T10:30:00Z",
    "expiresIn": 300,
    "metadata": {
      "totalPages": 10,
      "fileName": "document.pdf",
      "fileSize": 1024000,
      "contentType": "application/pdf"
    }
  }
}
```

**使用例:**

```typescript
import { getPreviewUrl } from '@/services/preview-service';

const response = await getPreviewUrl(
  'cis-filesearch-storage',
  'processed/document.pdf',
  'pdf',
  1, // ページ番号
  300 // 有効期限（秒）
);

console.log(response.data.previewUrl);
```

---

### 2. `/api/preview/pages` - PDFページ一覧プレビュー

**エンドポイント:** `GET /api/preview/pages`

**Query Parameters:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| bucket | string | ✅ | S3バケット名 |
| key | string | ✅ | S3オブジェクトキー |
| startPage | number | ❌ | 開始ページ（デフォルト: 1） |
| endPage | number | ❌ | 終了ページ（デフォルト: 総ページ数） |
| keywords | string | ❌ | ハイライトキーワード（カンマ区切り） |
| expiresIn | number | ❌ | URL有効期限（秒、デフォルト: 300） |

**制限:**
- 一度に取得できるページ数: 最大50ページ
- URL有効期限: 60秒〜3600秒

**レスポンス例:**

```json
{
  "success": true,
  "data": {
    "pages": [
      {
        "pageNumber": 1,
        "previewUrl": "https://...",
        "hasKeywords": true,
        "keywords": ["検索", "ワード"]
      },
      {
        "pageNumber": 2,
        "previewUrl": "https://...",
        "hasKeywords": false,
        "keywords": []
      }
    ],
    "metadata": {
      "totalPages": 10,
      "fileName": "document.pdf",
      "fileSize": 1024000
    },
    "expiresAt": "2025-12-16T10:30:00Z"
  }
}
```

**使用例:**

```typescript
import { getPdfPages } from '@/services/preview-service';

const response = await getPdfPages(
  'cis-filesearch-storage',
  'processed/document.pdf',
  1, // 開始ページ
  10, // 終了ページ
  ['検索', 'キーワード'] // ハイライトキーワード
);

response.data.pages.forEach(page => {
  console.log(`Page ${page.pageNumber}: ${page.previewUrl}`);
});
```

---

### 3. `/api/preview/keywords` - キーワードハイライト情報

**エンドポイント:** `GET /api/preview/keywords`

**Query Parameters:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| bucket | string | ✅ | S3バケット名 |
| key | string | ✅ | S3オブジェクトキー |
| keywords | string | ✅ | 検索キーワード（カンマ区切り） |

**制限:**
- 最大キーワード数: 10個
- 各ページのスニペット数: 最大5個

**レスポンス例:**

```json
{
  "success": true,
  "data": {
    "pages": [
      {
        "pageNumber": 1,
        "keywords": ["検索"],
        "snippets": [
          {
            "text": "...これは検索キーワードを含む文章です...",
            "keyword": "検索",
            "position": {
              "x": 100,
              "y": 200
            }
          }
        ],
        "matchCount": 2
      }
    ],
    "totalMatches": 10,
    "keywords": ["検索", "キーワード"]
  }
}
```

**使用例:**

```typescript
import { getKeywordHighlights } from '@/services/preview-service';

const response = await getKeywordHighlights(
  'cis-filesearch-storage',
  'processed/document.pdf',
  ['検索', 'キーワード']
);

response.data.pages.forEach(page => {
  console.log(`Page ${page.pageNumber}: ${page.matchCount} matches`);
  page.snippets.forEach(snippet => {
    console.log(`  - ${snippet.text}`);
  });
});
```

---

## バックエンド実装要件

### S3オブジェクト構造

PDFファイル処理時に以下のS3オブジェクトを生成する必要があります：

```
processed/
├── document.pdf                    # 元のPDFファイル
├── document.pdf.metadata.json      # メタデータ
├── document.pdf.text.json          # テキスト抽出結果
└── document.pdf/
    └── pages/
        ├── page-1.pdf              # ページ1のPDF
        ├── page-2.pdf              # ページ2のPDF
        └── page-3.pdf              # ページ3のPDF
```

### メタデータファイル形式 (`document.pdf.metadata.json`)

```json
{
  "file_name": "document.pdf",
  "file_path": "processed/document.pdf",
  "file_size": 1024000,
  "content_type": "application/pdf",
  "total_pages": 10,
  "processed_at": "2025-12-16T10:00:00Z",
  "processor_version": "1.0.0"
}
```

### テキスト抽出結果形式 (`document.pdf.text.json`)

```json
{
  "file_name": "document.pdf",
  "total_pages": 10,
  "pages": [
    {
      "page_number": 1,
      "text": "ページ1の全文テキスト...",
      "words": [
        {
          "text": "検索",
          "x": 100,
          "y": 200,
          "width": 50,
          "height": 20,
          "confidence": 0.98
        }
      ]
    }
  ]
}
```

---

## フロントエンド実装ガイド

### 1. PdfPreviewコンポーネントの使用

```tsx
import { PdfPreview } from '@/components/features/PdfPreview';

export default function DocumentViewer() {
  return (
    <PdfPreview
      bucket="cis-filesearch-storage"
      s3Key="processed/document.pdf"
      keywords={['検索', 'キーワード']}
      initialPage={1}
      className="h-screen"
    />
  );
}
```

### 2. Preview Serviceの直接使用

```typescript
import {
  getPreviewUrl,
  getPdfPages,
  getKeywordHighlights,
  previewUrlCache,
} from '@/services/preview-service';

// 単一ページのプレビュー
const singlePageUrl = await getPreviewUrl(
  'bucket',
  'key',
  'pdf',
  1
);

// 全ページのプレビュー
const allPages = await getPdfPages(
  'bucket',
  'key'
);

// キーワードハイライト
const highlights = await getKeywordHighlights(
  'bucket',
  'key',
  ['keyword1', 'keyword2']
);

// キャッシュを使用した効率的なURL取得
const cachedUrl = await previewUrlCache.getUrl(
  'bucket',
  'key',
  'pdf',
  1
);
```

### 3. URLキャッシュ管理

Presigned URLは5分間有効ですが、キャッシュを使用することで不要なAPI呼び出しを削減できます。

```typescript
import { previewUrlCache } from '@/services/preview-service';

// 期限切れキャッシュをクリア
previewUrlCache.clearExpired();

// 全キャッシュをクリア
previewUrlCache.clearAll();
```

---

## セキュリティ考慮事項

### 1. Presigned URL

- **有効期限:** デフォルト5分（300秒）、最大1時間（3600秒）
- **アクセス制御:** S3バケットポリシーとIAMロールで制御
- **HTTPS:** 全ての通信をHTTPS経由で行う

### 2. API認証

Next.js APIルートは、Cognitoなどの認証システムと統合する必要があります：

```typescript
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  // /api/preview/* へのリクエストに認証を要求
  if (request.nextUrl.pathname.startsWith('/api/preview')) {
    const token = request.headers.get('Authorization');

    if (!token || !(await verifyToken(token))) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}
```

### 3. レート制限

API呼び出しのレート制限を実装して、サービスの濫用を防ぎます：

```typescript
// lib/rate-limit.ts
import { LRUCache } from 'lru-cache';

type RateLimitOptions = {
  interval: number;
  uniqueTokenPerInterval: number;
};

export function rateLimit(options: RateLimitOptions) {
  const tokenCache = new LRUCache({
    max: options.uniqueTokenPerInterval || 500,
    ttl: options.interval || 60000,
  });

  return {
    check: (limit: number, token: string) =>
      new Promise<void>((resolve, reject) => {
        const tokenCount = (tokenCache.get(token) as number[]) || [0];
        if (tokenCount[0] === 0) {
          tokenCache.set(token, tokenCount);
        }
        tokenCount[0] += 1;

        const currentUsage = tokenCount[0];
        const isRateLimited = currentUsage >= limit;

        return isRateLimited ? reject() : resolve();
      }),
  };
}

// Usage in API route
const limiter = rateLimit({
  interval: 60 * 1000, // 60 seconds
  uniqueTokenPerInterval: 500,
});

export async function GET(request: NextRequest) {
  try {
    await limiter.check(10, 'CACHE_TOKEN'); // 10 requests per minute
  } catch {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429 }
    );
  }

  // ... rest of the code
}
```

---

## パフォーマンス最適化

### 1. ページ分割読み込み

全ページを一度に読み込むのではなく、必要なページ範囲のみを取得：

```typescript
// 最初の10ページのみ取得
const initialPages = await getPdfPages(
  'bucket',
  'key',
  1,
  10
);

// スクロールに応じて追加ページを取得
const nextPages = await getPdfPages(
  'bucket',
  'key',
  11,
  20
);
```

### 2. キャッシュ戦略

- **ブラウザキャッシュ:** `Cache-Control: private, max-age=60`
- **アプリケーションキャッシュ:** `PreviewUrlCache`クラス
- **CDN:** CloudFrontを使用してS3オブジェクトをキャッシュ

### 3. 並列処理

複数のページURLを並列で生成：

```typescript
import { generateMultiplePageUrls } from '@/lib/s3-preview';

const pageNumbers = [1, 2, 3, 4, 5];
const urlMap = await generateMultiplePageUrls(
  'bucket',
  'key',
  pageNumbers
);
```

---

## エラーハンドリング

### クライアントサイド

```typescript
try {
  const url = await getPreviewUrl('bucket', 'key', 'pdf');
  // URLを使用
} catch (error) {
  if (error.message.includes('FILE_NOT_FOUND')) {
    // ファイルが見つからない
    showNotification('ファイルが見つかりません');
  } else if (error.message.includes('ACCESS_DENIED')) {
    // アクセス権限がない
    showNotification('アクセス権限がありません');
  } else {
    // その他のエラー
    showNotification('エラーが発生しました');
  }
}
```

### サーバーサイド

APIルートでは、適切なHTTPステータスコードとエラーメッセージを返します：

```typescript
// 404 Not Found
return NextResponse.json(
  { error: 'File not found', code: 'FILE_NOT_FOUND' },
  { status: 404 }
);

// 403 Forbidden
return NextResponse.json(
  { error: 'Access denied', code: 'ACCESS_DENIED' },
  { status: 403 }
);

// 500 Internal Server Error
return NextResponse.json(
  { error: 'Internal server error', code: 'INTERNAL_ERROR' },
  { status: 500 }
);
```

---

## デプロイメント設定

### 環境変数

`.env.local`に以下の設定が必要です：

```bash
# OpenSearch
OPENSEARCH_ENDPOINT=https://search-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index

# AWS
AWS_REGION=ap-northeast-1

# S3
S3_BUCKET=cis-filesearch-storage
S3_PROCESSED_PREFIX=processed/
S3_THUMBNAIL_PREFIX=thumbnails/
```

### IAMロール権限

Next.jsアプリケーションを実行するEC2インスタンスまたはLambda関数には、以下のIAMポリシーが必要です：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-storage/*",
        "arn:aws:s3:::cis-filesearch-storage"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch/*"
    }
  ]
}
```

---

## テスト

### ユニットテスト

```typescript
// __tests__/services/preview-service.test.ts
import { getPreviewUrl } from '@/services/preview-service';

describe('Preview Service', () => {
  it('should generate presigned URL', async () => {
    const response = await getPreviewUrl(
      'test-bucket',
      'test-key',
      'pdf'
    );

    expect(response.success).toBe(true);
    expect(response.data.previewUrl).toContain('https://');
    expect(response.data.expiresIn).toBe(300);
  });
});
```

### 統合テスト

```typescript
// __tests__/api/preview.test.ts
import { GET } from '@/app/api/preview/route';
import { NextRequest } from 'next/server';

describe('/api/preview', () => {
  it('should return 400 for missing parameters', async () => {
    const request = new NextRequest('http://localhost/api/preview');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });
});
```

---

## まとめ

このS3プレビューAPIシステムにより、以下が実現されます：

1. **高速なプレビュー表示:** Presigned URLによる直接S3アクセス
2. **セキュアなアクセス:** 有効期限付きURL、IAM権限制御
3. **柔軟なページ管理:** ページ単位でのアクセス、範囲指定
4. **強力な検索機能:** キーワードハイライト、スニペット生成
5. **スケーラブルなアーキテクチャ:** サーバーレス、キャッシュ最適化

このシステムは、エンタープライズレベルのファイル検索アプリケーションに必要な、パフォーマンス、セキュリティ、ユーザビリティを全て満たしています。
