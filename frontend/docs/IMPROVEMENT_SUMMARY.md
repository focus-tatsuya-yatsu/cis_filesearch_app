# フロントエンドエラーハンドリング改善サマリー

## 改善日時
2025-12-17

## 改善の背景

### 問題点
1. **503エラーが発生しても適切なメッセージが表示されない**
   - ユーザーには何が起きているか分からない
   - エラーがコンソールに`throw new Error()`で投げられている

2. **エラー時のユーザー体験が悪い**
   - リトライ機能がない
   - エラーの原因が分かりにくい

3. **開発時のデバッグが困難**
   - エラーの詳細情報が不足している
   - ステータスコードやエンドポイント情報が確認しにくい

## 実装した改善

### 1. エラーハンドリングアーキテクチャの改善

#### 変更前
```typescript
// エラーをthrowする従来の方式
export async function searchFiles(params: SearchParams): Promise<SearchResponse> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorData: SearchError = await response.json();
      throw new Error(errorData.message || errorData.error); // ❌ エラーをthrow
    }
    return await response.json();
  } catch (error: any) {
    console.error('Search API call failed:', error);
    throw new Error(error.message || 'Failed to perform search'); // ❌ エラーをthrow
  }
}
```

#### 変更後
```typescript
// エラーオブジェクトを返却する新しい方式
export async function searchFiles(
  params: SearchParams
): Promise<SearchResponse | ApiErrorResponse> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      // ✅ エラーオブジェクトを構築して返却
      return {
        userMessage: getErrorMessage(response.status),
        technicalMessage: errorData?.message || response.statusText,
        statusCode: response.status,
        retryable: isRetryableError(response.status),
        debugInfo: isDevelopment ? { ... } : undefined,
      };
    }
    return await response.json();
  } catch (error: any) {
    // ✅ ネットワークエラーもエラーオブジェクトとして返却
    return {
      userMessage: 'ネットワークエラーが発生しました。',
      technicalMessage: error.message,
      statusCode: 0,
      retryable: true,
    };
  }
}
```

### 2. HTTPステータスコード別のユーザーメッセージ

| ステータス | メッセージ | リトライ |
|----------|----------|---------|
| 400 | 検索条件が正しくありません。入力内容を確認してください。 | ❌ |
| 401 | 認証が必要です。ログインしてください。 | ❌ |
| 403 | このリソースへのアクセス権限がありません。 | ❌ |
| 404 | 検索サービスが見つかりません。管理者に連絡してください。 | ❌ |
| 429 | リクエストが多すぎます。しばらく待ってから再度お試しください。 | ✅ |
| 500 | サーバーエラーが発生しました。時間をおいて再度お試しください。 | ❌ |
| 502 | ゲートウェイエラーが発生しました。時間をおいて再度お試しください。 | ✅ |
| **503** | **サービスが一時的に利用できません。しばらく待ってから再度お試しください。** | ✅ |
| 504 | タイムアウトが発生しました。検索条件を絞り込んで再度お試しください。 | ✅ |
| 0 | ネットワークエラーが発生しました。インターネット接続を確認してください。 | ✅ |

### 3. 型安全なエラーハンドリング

#### 新しい型定義
```typescript
export interface ApiErrorResponse {
  userMessage: string;        // ユーザー向けメッセージ
  technicalMessage: string;   // 技術的詳細
  statusCode: number;         // HTTPステータスコード
  retryable: boolean;         // リトライ可能性
  debugInfo?: {              // 開発環境でのみ含まれる
    originalError?: string;
    timestamp: string;
    endpoint: string;
  };
}
```

#### 型ガード関数
```typescript
export const isApiError = (
  response: SearchResponse | ApiErrorResponse
): response is ApiErrorResponse => {
  return 'statusCode' in response && 'userMessage' in response;
};
```

### 4. コンポーネント側の改善

#### SearchInterface コンポーネント

**変更前:**
```typescript
const [searchError, setSearchError] = useState<string | null>(null);

// エラー時
catch (error: any) {
  console.error('Search failed:', error);
  setSearchResults([]);
  const errorMessage = error.message || '検索中にエラーが発生しました';
  setSearchError(errorMessage); // ❌ 文字列のみ
}
```

**変更後:**
```typescript
const [searchError, setSearchError] = useState<ApiErrorResponse | null>(null);
const [lastSearchParams, setLastSearchParams] = useState<{ query: string; mode: 'and' | 'or' } | null>(null);

// エラー時
const response = await searchFiles({ ... });
if (isApiError(response)) {
  setSearchResults([]);
  setSearchError(response); // ✅ 詳細なエラーオブジェクト
  return;
}
```

### 5. リトライ機能の追加

```typescript
/**
 * リトライ処理
 * 前回の検索パラメータを使って再度検索を実行
 */
const handleRetry = useCallback(() => {
  if (lastSearchParams) {
    handleSearch(lastSearchParams.query, lastSearchParams.mode);
  }
}, [lastSearchParams, handleSearch]);
```

### 6. ユーザーフレンドリーなエラーUI

```typescript
{searchError && (
  <div className="error-container">
    {/* エラーアイコン */}
    <div className="error-icon">
      <svg>...</svg>
    </div>

    {/* エラーメッセージ */}
    <h3>検索中にエラーが発生しました</h3>
    <p>{searchError.userMessage}</p>

    {/* リトライボタン（retryableな場合のみ） */}
    {searchError.retryable && (
      <button onClick={handleRetry}>
        <svg>...</svg>
        再試行
      </button>
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

## 改善の効果

### ユーザー体験の向上
✅ エラー発生時に分かりやすいメッセージを表示
✅ リトライ可能なエラーには「再試行」ボタンを表示
✅ ネットワークエラーと認証エラーを区別して表示

### 開発者体験の向上
✅ 開発環境では詳細なデバッグ情報を表示
✅ エラーログが構造化され、問題の特定が容易に
✅ 本番環境では最小限のログのみ出力（セキュリティ向上）

### コードの保守性向上
✅ エラーをthrowせず、一貫したエラーハンドリングパターン
✅ 型ガードによる型安全なエラー処理
✅ HTTPステータスコード別の明確なメッセージマッピング

## 修正したファイル

### 1. `/src/lib/api/search.ts`
- `ApiErrorResponse` 型の追加
- `getErrorMessage()` 関数の追加
- `isRetryableError()` 関数の追加
- `searchFiles()` 関数の改善（エラーオブジェクトを返却）
- `isApiError()` 型ガード関数の追加

### 2. `/src/components/search/SearchInterface.tsx`
- `searchError` stateの型を `ApiErrorResponse | null` に変更
- `lastSearchParams` stateの追加（リトライ用）
- `handleSearch()` の改善（エラーオブジェクトを処理）
- `handleRetry()` の追加
- エラー表示UIの改善（リトライボタン、デバッグ情報）

### 3. `/docs/ERROR_HANDLING.md` (新規作成)
エラーハンドリングの仕様とベストプラクティスをドキュメント化

## ビルド検証

```bash
npm run build
```

✅ TypeScriptビルド成功
✅ 型エラーなし
✅ 本番環境でのビルド成功

## 次のステップ

### 推奨される追加改善
1. **エラー監視** - Sentry等のエラートラッキングツールの導入
2. **リトライ戦略** - exponential backoffを使った自動リトライ
3. **オフライン対応** - Service Workerを使ったオフライン検知
4. **エラーアナリティクス** - エラーの発生頻度を分析

### テスト追加
1. **ユニットテスト** - `searchFiles()`関数のエラーケーステスト
2. **E2Eテスト** - 503エラー時のUI動作確認
3. **統合テスト** - リトライ機能の動作確認

## まとめ

この改善により、503エラーを含むすべてのHTTPエラーに対して、ユーザーフレンドリーなエラーメッセージとリトライ機能を提供できるようになりました。また、開発環境では詳細なデバッグ情報が表示されるため、問題の特定が容易になります。

エラーをthrowせず、エラーオブジェクトを返却するアプローチにより、型安全で保守性の高いコードになりました。
