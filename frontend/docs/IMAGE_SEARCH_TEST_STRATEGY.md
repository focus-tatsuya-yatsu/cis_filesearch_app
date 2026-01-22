# 画像検索機能 - テスト戦略とデバッグガイド

## 概要

本ドキュメントでは、画像検索機能における現在のエラーを解決するための包括的なテスト戦略を提供します。

### 現在の問題

1. **画像ベクトル化**: 成功（1024次元ベクトル生成）
2. **データ送信**: GETリクエストで`image=1`というパラメータのみが送信される
3. **実際のベクトルデータ**: 検索APIに渡されていない
4. **API側の準備**: POSTメソッドで画像ベクトルを受け取る準備ができている

### 問題の根本原因

コード分析の結果、**実装自体は正しい**ことが判明しました。以下のフローは期待通りに動作します：

```typescript
// ✅ SearchInterface.tsx (221-260行目)
const handleImageSearch = useCallback(async (embedding: number[]) => {
  const response = await searchFiles({
    imageEmbedding: embedding,
    searchType: 'image',
    // ...
  })
}, [])

// ✅ search.ts (214-239行目)
export async function searchFiles(params: SearchParams) {
  if (params.imageEmbedding && params.imageEmbedding.length > 0) {
    const response = await fetch('/api/search', {
      method: 'POST',
      body: JSON.stringify({
        imageEmbedding: params.imageEmbedding,
        // ...
      }),
    })
  }
}

// ✅ /api/search/route.ts (192-217行目)
if (searchQuery.imageEmbedding && searchQuery.imageEmbedding.length > 0) {
  const apiResponse = await fetch(apiGatewayUrl, {
    method: 'POST',
    body: JSON.stringify({
      imageEmbedding: searchQuery.imageEmbedding,
      // ...
    }),
  })
}
```

**問題は**: データフローの検証とデバッグが不足している点です。

---

## テスト戦略

### 1. テストピラミッド構造

```
        /\
       /  \      E2E Tests (10%)
      /----\     - 画像アップロードから検索結果まで
     /      \    - クロスブラウザ対応
    /--------\
   / Integration\ Integration Tests (20%)
  /    Tests    \ - ベクトル化 → search.ts → /api/search → Lambda
 /--------------\
/   Unit Tests   \ Unit Tests (70%)
/________________\ - searchFiles関数のPOSTロジック
                   - handleImageSearch関数のデータ渡し
                   - 個別関数の振る舞い
```

### 2. テストカバレッジ目標

| カテゴリ   | ファイル                                 | カバレッジ目標 |
| ---------- | ---------------------------------------- | -------------- |
| 単体テスト | `/lib/api/search.ts`                     | 85%+           |
| 単体テスト | `/components/search/SearchInterface.tsx` | 80%+           |
| 統合テスト | `/app/api/search/route.ts`               | 80%+           |
| E2E        | 画像検索フロー全体                       | 主要パス100%   |

---

## 単体テスト（Unit Tests）

### 1.1 `/lib/api/search.ts` - searchFiles関数のテスト

**ファイル**: `/src/lib/api/__tests__/search.test.ts`

**テスト内容**:

- ✅ 画像検索時にPOSTメソッドを使用
- ✅ imageEmbeddingが正しくJSON bodyに含まれる
- ✅ GETメソッドは使用されない
- ✅ パラメータの正しいマッピング
- ✅ エラーハンドリング

```typescript
describe('searchFiles - Image Search', () => {
  it('should use POST method when imageEmbedding is provided', async () => {
    // 1024次元のベクトル
    const embedding = Array.from({ length: 1024 }, () => Math.random())

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { results: [] } }),
    })

    await searchFiles({ imageEmbedding: embedding })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/search',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('imageEmbedding'),
      })
    )
  })

  it('should include full embedding array in request body', async () => {
    const embedding = Array.from({ length: 1024 }, (_, i) => i / 1024)

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { results: [] } }),
    })

    await searchFiles({ imageEmbedding: embedding })

    const callArgs = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(callArgs[1].body)

    expect(body.imageEmbedding).toHaveLength(1024)
    expect(body.imageEmbedding[0]).toBe(0)
    expect(body.imageEmbedding[1023]).toBeCloseTo(1023 / 1024)
  })
})
```

### 1.2 `/components/search/SearchInterface.tsx` - handleImageSearchのテスト

**ファイル**: `/src/components/search/__tests__/SearchInterface.test.tsx`

**テスト内容**:

- ✅ handleImageSearchがembeddingを受け取る
- ✅ searchFiles関数に正しくembeddingを渡す
- ✅ 検索結果の信頼度フィルタ（90%以上）

```typescript
describe('SearchInterface - handleImageSearch', () => {
  it('should call searchFiles with imageEmbedding', async () => {
    const mockSearchFiles = jest.fn().mockResolvedValue({
      success: true,
      data: { results: [] },
    })

    // searchFilesをモック
    jest.mock('@/lib/api/search', () => ({
      searchFiles: mockSearchFiles,
    }))

    const embedding = Array.from({ length: 1024 }, () => Math.random())

    const { result } = renderHook(() => useSearchInterface())

    await act(async () => {
      await result.current.handleImageSearch(embedding)
    })

    expect(mockSearchFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        imageEmbedding: embedding,
        searchType: 'image',
      })
    )
  })
})
```

---

## 統合テスト（Integration Tests）

### 2.1 画像アップロード → ベクトル化 → 検索API

**ファイル**: `/src/app/api/__tests__/image-search-integration.test.ts`

**テスト内容**:

- ✅ `/api/image-embedding` → `/api/search` のデータフロー
- ✅ ベクトルデータの正確な伝達
- ✅ Lambda APIへのPOSTリクエスト

```typescript
describe('Image Search Integration', () => {
  it('should pass vector data from embedding to search API', async () => {
    // Step 1: 画像をアップロードしてベクトル取得
    const formData = new FormData()
    formData.append('image', new File(['test'], 'test.jpg', { type: 'image/jpeg' }))

    const embeddingResponse = await fetch('/api/image-embedding', {
      method: 'POST',
      body: formData,
    })

    const {
      data: { embedding },
    } = await embeddingResponse.json()
    expect(embedding).toHaveLength(1024)

    // Step 2: ベクトルを使って検索
    const searchResponse = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageEmbedding: embedding,
        searchType: 'image',
      }),
    })

    expect(searchResponse.ok).toBe(true)

    // Step 3: Lambda APIが呼ばれたか確認（モックまたはスパイ）
    // Lambda側でベクトルデータを受け取ったことを確認
  })
})
```

### 2.2 `/api/search` ルートハンドラのテスト

**ファイル**: `/src/app/api/search/__tests__/route.test.ts`

**テスト内容**:

- ✅ POSTリクエストでimageEmbeddingを受け取る
- ✅ Lambda APIに正しくPOSTする
- ✅ ベクトルデータが欠損しない

```typescript
describe('POST /api/search - Image Search', () => {
  it('should forward imageEmbedding to Lambda API', async () => {
    const embedding = Array.from({ length: 1024 }, () => Math.random())

    // Lambda APIをモック
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          results: [{ id: '1', fileName: 'test.jpg', relevanceScore: 0.95 }],
        },
      }),
    })

    const request = new Request('http://localhost:3000/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageEmbedding: embedding,
        searchType: 'image',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    // Lambda APIが呼ばれたか確認
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('imageEmbedding'),
      })
    )

    // ベクトルデータが含まれているか確認
    const callArgs = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.imageEmbedding).toHaveLength(1024)
  })
})
```

---

## E2Eテスト（End-to-End Tests）

**ファイル**: `/e2e/image-search.spec.ts` （既に存在）

既存のE2Eテストは包括的ですが、以下を追加検証：

### 3.1 ネットワークログの検証

```typescript
test('should send POST request with vector data to /api/search', async ({ page }) => {
  // ネットワークリクエストをキャプチャ
  const requests: any[] = []

  page.on('request', (request) => {
    if (request.url().includes('/api/search')) {
      requests.push({
        method: request.method(),
        url: request.url(),
        postData: request.postData(),
      })
    }
  })

  // 画像をアップロード
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(VALID_JPEG)

  // 検索完了を待機
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 15000 })

  // POST リクエストが送信されたか確認
  const searchRequest = requests.find((r) => r.method === 'POST')
  expect(searchRequest).toBeTruthy()

  // ベクトルデータが含まれているか確認
  const postData = JSON.parse(searchRequest.postData)
  expect(postData.imageEmbedding).toBeDefined()
  expect(postData.imageEmbedding).toHaveLength(1024)
})
```

---

## デバッグツール

### 4.1 リクエスト/レスポンスロガー

**ファイル**: `/src/lib/api/debug-logger.ts`

```typescript
/**
 * 画像検索デバッグロガー
 * 開発環境でのみ動作
 */
export class ImageSearchDebugLogger {
  private static isEnabled = process.env.NODE_ENV === 'development'

  static logRequest(endpoint: string, method: string, data: any) {
    if (!this.isEnabled) return

    console.group(`[DEBUG] Request to ${endpoint}`)
    console.log('Method:', method)
    console.log('Data:', {
      ...data,
      imageEmbedding: data.imageEmbedding
        ? `[Vector: ${data.imageEmbedding.length} dimensions]`
        : 'Not provided',
    })
    console.groupEnd()
  }

  static logResponse(endpoint: string, status: number, data: any) {
    if (!this.isEnabled) return

    console.group(`[DEBUG] Response from ${endpoint}`)
    console.log('Status:', status)
    console.log('Data:', data)
    console.groupEnd()
  }

  static logVectorData(embedding: number[]) {
    if (!this.isEnabled) return

    console.group('[DEBUG] Image Vector Data')
    console.log('Dimensions:', embedding.length)
    console.log('First 10 values:', embedding.slice(0, 10))
    console.log('Last 10 values:', embedding.slice(-10))
    console.log('Min value:', Math.min(...embedding))
    console.log('Max value:', Math.max(...embedding))
    console.log('Average:', embedding.reduce((a, b) => a + b) / embedding.length)
    console.groupEnd()
  }
}
```

### 4.2 使用例

```typescript
// search.ts に追加
import { ImageSearchDebugLogger } from './debug-logger'

export async function searchFiles(params: SearchParams) {
  if (params.imageEmbedding && params.imageEmbedding.length > 0) {
    // デバッグログ
    ImageSearchDebugLogger.logVectorData(params.imageEmbedding)
    ImageSearchDebugLogger.logRequest('/api/search', 'POST', params)

    const response = await fetch('/api/search', {
      method: 'POST',
      body: JSON.stringify({ ... })
    })

    const data = await response.json()
    ImageSearchDebugLogger.logResponse('/api/search', response.status, data)

    return data
  }
}
```

---

## テスト実行方法

### 単体テスト

```bash
# 全単体テスト実行
yarn test:unit

# 画像検索関連のみ
yarn test:image-search

# カバレッジレポート付き
yarn test:coverage

# ウォッチモード
yarn test:watch
```

### 統合テスト

```bash
# API統合テスト
yarn test:integration

# 特定のテストファイル
yarn test src/app/api/search/__tests__/route.test.ts
```

### E2Eテスト

```bash
# 全E2Eテスト実行
yarn test:e2e

# UIモード（デバッグに便利）
yarn test:e2e:ui

# デバッグモード
yarn test:e2e:debug

# レポート表示
yarn test:e2e:report
```

---

## デバッグチェックリスト

画像検索が動作しない場合、以下を確認：

### フロントエンド

- [ ] 画像ファイルが正しくアップロードされている
- [ ] `/api/image-embedding` が1024次元ベクトルを返す
- [ ] `handleImageSearch` が呼ばれている
- [ ] `searchFiles` に `imageEmbedding` が渡されている
- [ ] **POSTメソッド**で `/api/search` が呼ばれている
- [ ] リクエストボディに `imageEmbedding` が含まれている

### バックエンド（Next.js API Routes）

- [ ] `/api/search` のPOSTハンドラが呼ばれている
- [ ] `body.imageEmbedding` が存在する
- [ ] ベクトルの長さが1024である
- [ ] Lambda APIに**POSTメソッド**で送信している
- [ ] Lambda APIのURLが正しい（`NEXT_PUBLIC_API_GATEWAY_URL`）

### Lambda API

- [ ] Lambda関数がPOSTリクエストを受け取っている
- [ ] `event.body` にベクトルデータが含まれている
- [ ] OpenSearchにクエリを送信している
- [ ] 結果が返ってきている

---

## ログポイント

各レイヤーで以下をログ出力：

```typescript
// 1. SearchInterface.tsx
console.log('[SearchInterface] Embedding dimensions:', embedding.length)

// 2. search.ts
console.log('[searchFiles] Sending POST with embedding:', {
  dimensions: params.imageEmbedding?.length,
  method: 'POST'
})

// 3. /api/search/route.ts
console.log('[POST /api/search] Received imageEmbedding:', {
  dimensions: body.imageEmbedding?.length,
  targetUrl: apiGatewayUrl
})

// 4. Lambda (Python/Node.js)
print(f"[Lambda] Received vector: {len(event['body']['imageEmbedding'])} dimensions")
```

---

## 期待される結果

すべてのテストがパスすると：

1. ✅ 単体テスト: searchFiles関数がPOSTメソッドを使用
2. ✅ 単体テスト: ベクトルデータが完全にJSON bodyに含まれる
3. ✅ 統合テスト: `/api/image-embedding` → `/api/search` → Lambda APIのフロー成功
4. ✅ E2E: 画像アップロードから検索結果表示まで正常動作
5. ✅ デバッグログ: 各レイヤーでベクトルデータが確認できる

---

## トラブルシューティング

### ベクトルデータが空の場合

**原因**: `imageEmbedding` が正しく渡されていない

**確認方法**:

```typescript
// SearchInterface.tsx の handleImageSearch
console.log('Embedding before searchFiles:', embedding.length) // 1024 が期待値

// search.ts の searchFiles
console.log('Params received:', params.imageEmbedding?.length) // 1024 が期待値
```

### GETメソッドが使われている場合

**原因**: 条件分岐が正しく動作していない

**確認方法**:

```typescript
// search.ts の条件チェック
console.log('Should use POST?', {
  hasEmbedding: params.imageEmbedding && params.imageEmbedding.length > 0,
  embeddingLength: params.imageEmbedding?.length,
})
```

---

## まとめ

本テスト戦略により、画像検索機能のエラーを確実に検出・修正できます。

**重要ポイント**:

1. 単体テストで各関数の動作を保証
2. 統合テストでデータフローを検証
3. E2Eテストでユーザージャーニー全体を確認
4. デバッグログで問題箇所を特定

次のステップ:

1. 単体テストを実装
2. 統合テストを実装
3. デバッグロガーを追加
4. テストを実行してカバレッジを確認
