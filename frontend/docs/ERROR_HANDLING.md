# フロントエンドエラーハンドリング仕様

## 概要

このドキュメントでは、CIS File Search ApplicationのフロントエンドにおけるエラーハンドリングのアプローチとAPIを説明します。

## 設計原則

1. **エラーをthrowしない** - API呼び出しはエラーオブジェクトを返却し、呼び出し側で適切にハンドリング
2. **ユーザーフレンドリーなメッセージ** - HTTPステータスコードに応じた分かりやすいメッセージを表示
3. **リトライ可能性の明示** - 一時的なエラーにはリトライボタンを表示
4. **開発環境での詳細情報** - デバッグ情報を開発環境でのみ表示

## API

### 型定義

#### `ApiErrorResponse`

```typescript
export interface ApiErrorResponse {
  userMessage: string // ユーザー向けの分かりやすいメッセージ
  technicalMessage: string // 技術的なエラー詳細
  statusCode: number // HTTPステータスコード
  retryable: boolean // リトライ可能かどうか
  debugInfo?: {
    // 開発環境でのみ含まれる
    originalError?: string
    timestamp: string
    endpoint: string
  }
}
```

### 関数

#### `searchFiles(params: SearchParams): Promise<SearchResponse | ApiErrorResponse>`

検索APIを呼び出す関数。成功時は`SearchResponse`、エラー時は`ApiErrorResponse`を返却。

**使用例:**

```typescript
const response = await searchFiles({ q: 'test', searchMode: 'or' })

if (isApiError(response)) {
  // エラー処理
  console.error(response.userMessage)
  if (response.retryable) {
    // リトライ可能
  }
} else {
  // 成功時の処理
  const results = response.data.results
}
```

#### `isApiError(response: SearchResponse | ApiErrorResponse): response is ApiErrorResponse`

型ガード関数。レスポンスがエラーかどうかを判定。

#### `getErrorMessage(statusCode: number, errorData?: SearchError): string`

HTTPステータスコードに基づいてユーザーフレンドリーなエラーメッセージを生成（内部関数）。

#### `isRetryableError(statusCode: number): boolean`

エラーがリトライ可能かどうかを判定（内部関数）。

## HTTPステータスコードとメッセージのマッピング

| ステータスコード  | ユーザーメッセージ                                                           | リトライ可能 |
| ----------------- | ---------------------------------------------------------------------------- | ------------ |
| 400               | 検索条件が正しくありません。入力内容を確認してください。                     | ❌           |
| 401               | 認証が必要です。ログインしてください。                                       | ❌           |
| 403               | このリソースへのアクセス権限がありません。                                   | ❌           |
| 404               | 検索サービスが見つかりません。管理者に連絡してください。                     | ❌           |
| 429               | リクエストが多すぎます。しばらく待ってから再度お試しください。               | ✅           |
| 500               | サーバーエラーが発生しました。時間をおいて再度お試しください。               | ❌           |
| 502               | ゲートウェイエラーが発生しました。時間をおいて再度お試しください。           | ✅           |
| 503               | **サービスが一時的に利用できません。しばらく待ってから再度お試しください。** | ✅           |
| 504               | タイムアウトが発生しました。検索条件を絞り込んで再度お試しください。         | ✅           |
| 0 (Network Error) | ネットワークエラーが発生しました。インターネット接続を確認してください。     | ✅           |

## コンポーネントでの使用例

### SearchInterface コンポーネント

```typescript
import { searchFiles, isApiError, type ApiErrorResponse } from '@/lib/api/search'

const [searchError, setSearchError] = useState<ApiErrorResponse | null>(null)
const [lastSearchParams, setLastSearchParams] = useState<{
  query: string
  mode: 'and' | 'or'
} | null>(null)

const handleSearch = async (query: string, searchMode: 'and' | 'or' = 'or') => {
  setSearchError(null)
  setLastSearchParams({ query, mode: searchMode })

  const response = await searchFiles({ q: query, searchMode })

  if (isApiError(response)) {
    setSearchResults([])
    setSearchError(response)
    return
  }

  // 成功時の処理
  setSearchResults(response.data.results)
}

const handleRetry = () => {
  if (lastSearchParams) {
    handleSearch(lastSearchParams.query, lastSearchParams.mode)
  }
}
```

### エラー表示UI

```typescript
{searchError && (
  <div className="error-container">
    <h3>検索中にエラーが発生しました</h3>
    <p>{searchError.userMessage}</p>

    {/* リトライボタン（retryableな場合のみ） */}
    {searchError.retryable && (
      <button onClick={handleRetry}>再試行</button>
    )}

    {/* デバッグ情報（開発環境のみ） */}
    {searchError.debugInfo && process.env.NODE_ENV === 'development' && (
      <details>
        <summary>デバッグ情報</summary>
        <div>
          <p>Status Code: {searchError.statusCode}</p>
          <p>Technical Message: {searchError.technicalMessage}</p>
          <p>Timestamp: {searchError.debugInfo.timestamp}</p>
          <p>Endpoint: {searchError.debugInfo.endpoint}</p>
        </div>
      </details>
    )}
  </div>
)}
```

## ベストプラクティス

### 1. エラーをthrowせず、適切にハンドリング

```typescript
// ✅ Good - エラーオブジェクトを返却
export async function searchFiles(
  params: SearchParams
): Promise<SearchResponse | ApiErrorResponse> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return {
        userMessage: getErrorMessage(response.status),
        technicalMessage: response.statusText,
        statusCode: response.status,
        retryable: isRetryableError(response.status),
      }
    }
    return await response.json()
  } catch (error) {
    return {
      userMessage: 'ネットワークエラーが発生しました。',
      technicalMessage: error.message,
      statusCode: 0,
      retryable: true,
    }
  }
}

// ❌ Bad - エラーをthrow
export async function searchFiles(params: SearchParams): Promise<SearchResponse> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Search failed') // エラーをthrowしない
  }
  return await response.json()
}
```

### 2. 型ガードを使用した型安全な処理

```typescript
// ✅ Good - 型ガードで型を判定
const response = await searchFiles(params)

if (isApiError(response)) {
  // TypeScriptがApiErrorResponseと認識
  console.error(response.userMessage)
  console.error(response.statusCode)
} else {
  // TypeScriptがSearchResponseと認識
  const results = response.data.results
}

// ❌ Bad - 型安全でない
const response = await searchFiles(params)
if (response.statusCode) {
  // statusCodeはApiErrorResponseにしか存在しない
  // 型が曖昧
}
```

### 3. 開発環境と本番環境でのログの分離

```typescript
// ✅ Good - 環境に応じたログ出力
const isDevelopment = process.env.NODE_ENV === 'development'

if (isDevelopment) {
  console.error('Search API Error (Development):', {
    statusCode,
    userMessage,
    technicalMessage,
    errorData,
    url,
  })
} else {
  console.error('Search API Error:', {
    statusCode,
    message: userMessage,
  })
}

// ❌ Bad - 本番環境で詳細なログを出力
console.error('Error:', error) // 本番環境ではセキュリティリスク
```

### 4. リトライロジックの実装

```typescript
// ✅ Good - lastSearchParamsを保存してリトライ可能に
const [lastSearchParams, setLastSearchParams] = useState<SearchParams | null>(null)

const handleSearch = async (params: SearchParams) => {
  setLastSearchParams(params) // リトライ用に保存

  const response = await searchFiles(params)

  if (isApiError(response) && response.retryable) {
    // リトライボタンを表示
  }
}

const handleRetry = () => {
  if (lastSearchParams) {
    handleSearch(lastSearchParams)
  }
}
```

## テスト戦略

### ユニットテスト

```typescript
describe('searchFiles', () => {
  it('should return ApiErrorResponse on 503 error', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ error: 'Service unavailable' }),
      } as Response)
    )

    const response = await searchFiles({ q: 'test' })

    expect(isApiError(response)).toBe(true)
    if (isApiError(response)) {
      expect(response.statusCode).toBe(503)
      expect(response.userMessage).toContain('一時的に利用できません')
      expect(response.retryable).toBe(true)
    }
  })

  it('should return SearchResponse on success', async () => {
    const mockData = { success: true, data: { results: [], pagination: {} } }
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockData),
      } as Response)
    )

    const response = await searchFiles({ q: 'test' })

    expect(isApiError(response)).toBe(false)
    if (!isApiError(response)) {
      expect(response.success).toBe(true)
    }
  })
})
```

### E2Eテスト (Playwright)

```typescript
test('should display error message and retry button on 503 error', async ({ page }) => {
  // 503エラーをモック
  await page.route('**/api/search*', (route) =>
    route.fulfill({ status: 503, body: JSON.stringify({ error: 'Service unavailable' }) })
  )

  await page.goto('/search')
  await page.fill('[placeholder*="検索"]', 'test')
  await page.click('button:has-text("検索")')

  // エラーメッセージの確認
  await expect(page.locator('text=サービスが一時的に利用できません')).toBeVisible()

  // リトライボタンの確認
  await expect(page.locator('button:has-text("再試行")')).toBeVisible()

  // デバッグ情報の確認（開発環境のみ）
  if (process.env.NODE_ENV === 'development') {
    await expect(page.locator('details:has-text("デバッグ情報")')).toBeVisible()
  }
})
```

## まとめ

このエラーハンドリングアプローチにより:

1. **ユーザー体験の向上** - 分かりやすいエラーメッセージとリトライ機能
2. **開発者体験の向上** - 開発環境での詳細なデバッグ情報
3. **保守性の向上** - 一貫したエラー処理パターン
4. **型安全性** - TypeScriptの型ガードによる堅牢な型チェック

を実現しています。
