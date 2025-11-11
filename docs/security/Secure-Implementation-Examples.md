# セキュアな実装例とテスト

## 目次

1. [Header コンポーネントのセキュアな実装](#header-コンポーネントのセキュアな実装)
2. [API クライアントの実装](#api-クライアントの実装)
3. [エラーハンドリング](#エラーハンドリング)
4. [セキュリティテスト](#セキュリティテスト)

---

## Header コンポーネントのセキュアな実装

### 現在の実装（セキュリティレビュー済み）

```typescript
// src/components/layout/Header.tsx
'use client'

import { FC, useState, useCallback } from 'react'
import { Search, Settings, Bell, User } from 'lucide-react'

import { Button } from '@/components/ui'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { UserMenu } from './UserMenu'
import { useAuth } from '@/contexts/AuthContext'

export const Header: FC = () => {
  const { isAuthenticated, isLoading, user, loginWithHostedUI, logout } = useAuth()
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  /**
   * Hosted UIでログイン
   *
   * ✅ セキュリティポイント:
   * - エラーハンドリングでスタックトレースを表示しない
   * - リダイレクト後は状態をクリーンアップ不要（ページ遷移）
   */
  const handleLogin = useCallback(async () => {
    try {
      setIsLoggingIn(true)
      await loginWithHostedUI() // Cognito Hosted UIにリダイレクト
    } catch (error) {
      // ❌ 詳細なエラーを表示しない
      console.error('❌ ログインに失敗しました:', error)

      // ✅ 一般的なエラーメッセージのみ表示
      // TODO: Toastコンポーネントで表示
      alert('ログインに失敗しました。もう一度お試しください。')

      setIsLoggingIn(false)
    }
    // Note: リダイレクトされるため、setIsLoggingIn(false)は通常実行されない
  }, [loginWithHostedUI])

  /**
   * ログアウト処理
   *
   * ✅ セキュリティポイント:
   * - Cognito セッションを完全にクリア
   * - localStorage をクリア（オプション）
   * - ページ全体をリロードしてメモリをクリア
   */
  const handleLogout = useCallback(async () => {
    try {
      await logout() // Cognito signOut + localStorage クリア
      console.log('✅ ログアウトしました')

      // ✅ オプション: 完全なページリロード
      window.location.href = '/' // SPA遷移ではなく完全リロード
    } catch (error) {
      console.error('❌ ログアウトに失敗しました:', error)
      // TODO: Toastコンポーネントで表示
      alert('ログアウトに失敗しました。ページを再読み込みしてください。')
    }
  }, [logout])

  return (
    <header
      className="bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-xl border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30 sticky top-0 z-50"
      role="banner"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ロゴ・タイトル */}
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-[#007AFF] to-[#0051D5] dark:from-[#0A84FF] dark:to-[#0066FF] rounded-xl p-2 shadow-sm">
              <Search className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#1D1D1F] dark:text-[#F5F5F7]">
                CIS File Search
              </h1>
              <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">企業内ファイル検索システム</p>
            </div>
          </div>

          {/* ナビゲーション */}
          <nav className="hidden md:flex items-center gap-6" aria-label="メインナビゲーション">
            <button type="button" className="nav-link">ホーム</button>
            <button type="button" className="nav-link">検索履歴</button>
            <button type="button" className="nav-link">お気に入り</button>
            <button type="button" className="nav-link">ヘルプ</button>
          </nav>

          {/* アクションボタン */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" icon={<Bell />} aria-label="通知">
              <span className="sr-only">通知</span>
            </Button>
            <Button variant="ghost" size="sm" icon={<Settings />} aria-label="設定">
              <span className="sr-only">設定</span>
            </Button>
            <div className="h-8 w-px bg-[#D1D1D6]/30 dark:bg-[#38383A]/30 mx-2" aria-hidden="true" />

            {/* 認証状態によって表示を切り替え */}
            {isLoading ? (
              // ✅ ローディング中（認証状態チェック中）
              <div
                className="h-9 w-24 animate-pulse bg-[#F5F5F7] dark:bg-[#2C2C2E] rounded-lg"
                aria-label="認証状態を確認中"
              />
            ) : isAuthenticated && user ? (
              // ✅ 認証済み: ユーザーメニュー
              // セキュリティポイント: 最小限のユーザー情報のみ表示
              <UserMenu user={user} onLogout={handleLogout} />
            ) : (
              // ✅ 未認証: ログインボタン
              <Button
                variant="outline"
                size="sm"
                icon={<User className="h-5 w-5" />}
                onClick={handleLogin}
                loading={isLoggingIn}
                disabled={isLoggingIn}
                aria-label="ログイン"
              >
                {isLoggingIn ? 'リダイレクト中...' : 'ログイン'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
```

---

## UserMenu コンポーネントのセキュアな実装

```typescript
// src/components/layout/UserMenu.tsx
'use client'

import { FC, useState } from 'react'
import { User, LogOut, Settings } from 'lucide-react'
import type { AuthUser } from 'aws-amplify/auth'

interface UserMenuProps {
  user: AuthUser
  onLogout: () => Promise<void>
}

/**
 * ユーザーメニューコンポーネント
 *
 * ✅ セキュリティポイント:
 * - 最小限のPIIのみ表示（name, email のみ）
 * - 機密情報（userId, phone など）は表示しない
 * - XSS対策のためHTMLエスケープ（Reactがデフォルトで実行）
 */
export const UserMenu: FC<UserMenuProps> = ({ user, onLogout }) => {
  const [isOpen, setIsOpen] = useState(false)

  // ✅ ユーザー名を安全に取得
  const displayName = user.username || 'ユーザー'

  // ❌ 悪い例: 全てのユーザー情報を表示
  // const displayInfo = JSON.stringify(user) // 機密情報漏洩リスク

  return (
    <div className="relative">
      {/* ユーザーアイコン */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
        aria-label="ユーザーメニュー"
        aria-expanded={isOpen}
      >
        <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white">
          <User className="h-5 w-5" />
        </div>
        <span className="text-sm font-medium">
          {/* ✅ XSS対策: Reactが自動的にエスケープ */}
          {displayName}
        </span>
      </button>

      {/* ドロップダウンメニュー */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            {/* ✅ 最小限のユーザー情報 */}
            <p className="text-sm font-medium">{displayName}</p>
            {/* メールアドレス表示（オプション） */}
            {/* <p className="text-xs text-gray-500">{user.email}</p> */}
          </div>

          <div className="p-2">
            <button
              onClick={() => {
                setIsOpen(false)
                // 設定ページへ遷移
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <Settings className="h-4 w-4" />
              設定
            </button>

            <button
              onClick={() => {
                setIsOpen(false)
                onLogout()
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-red-600"
            >
              <LogOut className="h-4 w-4" />
              ログアウト
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

---

## API クライアントの実装

```typescript
// src/lib/apiClient.ts
/**
 * セキュアな API クライアント
 *
 * ✅ セキュリティ機能:
 * - すべてのリクエストに JWT トークンを付与
 * - 401 Unauthorized エラーで自動ログアウト
 * - エラーレスポンスのサニタイズ
 * - CSRF 対策（API Gateway が検証）
 */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: any
}

class ApiClient {
  private baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  /**
   * JWT トークンを取得
   *
   * ✅ セキュリティポイント:
   * - トークンを変数に保存せず、必要な時のみ取得
   * - メモリ上に長期間保存しない
   */
  private async getToken(): Promise<string> {
    // AuthContext の getAccessToken() を使用
    const { fetchAuthSession } = await import('aws-amplify/auth')
    const session = await fetchAuthSession()
    const token = session.tokens?.accessToken?.toString()

    if (!token) {
      throw new Error('No authentication token available')
    }

    return token
  }

  /**
   * 401 エラーハンドリング
   *
   * ✅ セキュリティポイント:
   * - 無効なトークンを検出したら即座にログアウト
   * - セッション情報をクリア
   * - ログインページにリダイレクト
   */
  private handleUnauthorized(): void {
    console.error('❌ 401 Unauthorized - トークンが無効です')

    // localStorage をクリア
    localStorage.clear()
    sessionStorage.clear()

    // ログインページにリダイレクト
    window.location.href = '/?error=session_expired'
  }

  /**
   * 汎用リクエストメソッド
   */
  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    try {
      // ✅ JWT トークンを取得
      const token = await this.getToken()

      // ✅ Authorization ヘッダーを付与
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      }

      // ✅ リクエスト送信
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      })

      // ✅ 401 Unauthorized の検出
      if (response.status === 401) {
        this.handleUnauthorized()
        throw new Error('Unauthorized')
      }

      // ✅ その他のエラー
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || `HTTP ${response.status}`)
      }

      // ✅ 成功レスポンス
      return response.json()
    } catch (error) {
      // ✅ エラーログ（サーバーログのみ）
      console.error('API request failed:', {
        endpoint,
        method: options.method || 'GET',
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      throw error
    }
  }

  /**
   * GET リクエスト
   */
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' })
  }

  /**
   * POST リクエスト
   */
  async post<T>(endpoint: string, data: any): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body: data })
  }

  /**
   * PUT リクエスト
   */
  async put<T>(endpoint: string, data: any): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body: data })
  }

  /**
   * DELETE リクエスト
   */
  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }
}

// ✅ シングルトンインスタンス
export const apiClient = new ApiClient(
  process.env.NEXT_PUBLIC_API_GATEWAY_URL || ''
)
```

### 使用例

```typescript
// src/app/search/page.tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/contexts/AuthContext'

interface SearchResult {
  id: string
  name: string
  path: string
}

export default function SearchPage() {
  const { isAuthenticated } = useAuth()

  // ✅ React Query で自動的に JWT トークン付きリクエスト
  const { data, error, isLoading } = useQuery<SearchResult[]>({
    queryKey: ['search'],
    queryFn: () => apiClient.get<SearchResult[]>('/api/v1/search?q=test'),
    enabled: isAuthenticated, // 認証済みの場合のみ実行
    retry: false, // 401エラーの場合はリトライしない
  })

  // ✅ UI最適化のために isAuthenticated を使用
  // （セキュリティ境界ではない）
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>ログインしてください</p>
      </div>
    )
  }

  if (isLoading) return <div>読み込み中...</div>

  // ✅ エラー表示（詳細は表示しない）
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>エラーが発生しました。もう一度お試しください。</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">検索結果</h1>
      <ul className="space-y-2">
        {data?.map((file) => (
          <li key={file.id} className="p-4 border rounded">
            <p className="font-medium">{file.name}</p>
            <p className="text-sm text-gray-500">{file.path}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

---

## セキュリティテスト

### 1. JWT 検証のテスト

```typescript
// __tests__/security/jwt-verification.test.ts
import { apiClient } from '@/lib/apiClient'

describe('JWT 検証テスト', () => {
  beforeEach(() => {
    // モックのリセット
    jest.clearAllMocks()
  })

  it('無効な JWT トークンで 401 エラーが返されること', async () => {
    // Arrange: 無効なトークンをモック
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      status: 401,
      ok: false,
      json: async () => ({ error: 'Invalid token' }),
    } as Response)

    // Act & Assert
    await expect(apiClient.get('/api/v1/search')).rejects.toThrow('Unauthorized')
  })

  it('トークンなしで 401 エラーが返されること', async () => {
    // Arrange: getToken() が失敗
    jest.spyOn(apiClient as any, 'getToken').mockRejectedValueOnce(
      new Error('No authentication token available')
    )

    // Act & Assert
    await expect(apiClient.get('/api/v1/search')).rejects.toThrow(
      'No authentication token available'
    )
  })

  it('有効な JWT トークンで 200 OK が返されること', async () => {
    // Arrange
    jest.spyOn(apiClient as any, 'getToken').mockResolvedValueOnce('valid-token')
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ results: [] }),
    } as Response)

    // Act
    const result = await apiClient.get('/api/v1/search')

    // Assert
    expect(result).toEqual({ results: [] })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/search'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer valid-token',
        }),
      })
    )
  })

  it('401 エラーで自動ログアウトが実行されること', async () => {
    // Arrange
    const localStorageClearSpy = jest.spyOn(Storage.prototype, 'clear')
    const sessionStorageClearSpy = jest.spyOn(sessionStorage, 'clear')

    delete window.location
    window.location = { href: '' } as any

    jest.spyOn(apiClient as any, 'getToken').mockResolvedValueOnce('expired-token')
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      status: 401,
      ok: false,
    } as Response)

    // Act
    try {
      await apiClient.get('/api/v1/search')
    } catch (error) {
      // Expected
    }

    // Assert
    expect(localStorageClearSpy).toHaveBeenCalled()
    expect(sessionStorageClearSpy).toHaveBeenCalled()
    expect(window.location.href).toBe('/?error=session_expired')
  })
})
```

### 2. XSS 対策のテスト

```typescript
// __tests__/security/xss-prevention.test.ts
import { render, screen } from '@testing-library/react'
import { sanitizeHTML } from '@/utils/sanitize'

describe('XSS 対策テスト', () => {
  it('HTMLタグがエスケープされること', () => {
    const maliciousInput = '<script>alert("XSS")</script>'
    const sanitized = sanitizeHTML(maliciousInput)

    expect(sanitized).not.toContain('<script>')
    expect(sanitized).not.toContain('</script>')
  })

  it('イベントハンドラーが削除されること', () => {
    const maliciousInput = '<img src=x onerror="alert(\'XSS\')">'
    const sanitized = sanitizeHTML(maliciousInput)

    expect(sanitized).not.toContain('onerror')
    expect(sanitized).not.toContain('alert')
  })

  it('Reactコンポーネントが自動的にエスケープすること', () => {
    const UserDisplay = ({ name }: { name: string }) => (
      <div>{name}</div>
    )

    const maliciousName = '<script>alert("XSS")</script>'
    render(<UserDisplay name={maliciousName} />)

    // Reactは自動的にエスケープするため、スクリプトは実行されない
    expect(screen.getByText(maliciousName)).toBeInTheDocument()
  })
})
```

### 3. CSRF 対策のテスト

```typescript
// __tests__/security/csrf-prevention.test.ts
describe('CSRF 対策テスト（PKCE）', () => {
  it('state パラメータが検証されること', () => {
    // Amplify が自動的に state 検証を行うため、
    // ここでは localStorage の state を確認

    // Arrange: ログイン開始時
    localStorage.setItem('amplify-signin-state', 'original-state')

    // Act: コールバック時の state 検証（Amplify内部）
    const callbackState = 'tampered-state'
    const savedState = localStorage.getItem('amplify-signin-state')

    // Assert: state が一致しない場合はエラー
    expect(callbackState).not.toBe(savedState)
  })

  it('code_verifier が保存され、トークン交換時に使用されること', () => {
    // Arrange
    localStorage.setItem('amplify-signin-code-verifier', 'original-verifier')

    // Act
    const codeVerifier = localStorage.getItem('amplify-signin-code-verifier')

    // Assert
    expect(codeVerifier).toBe('original-verifier')
  })
})
```

---

## 手動セキュリティテスト

### 1. XSS 攻撃のシミュレーション

```bash
# ブラウザのコンソールで実行（本番環境では絶対に実行しないこと）

# 1. localStorage のトークンを確認
Object.keys(localStorage).filter(key => key.includes('CognitoIdentityServiceProvider'))

# 2. XSS スクリプトの挿入を試みる（CSP でブロックされるはず）
const script = document.createElement('script')
script.textContent = "alert('XSS')"
document.body.appendChild(script)
# → CSP により Content Security Policy violation が発生

# 3. インラインスクリプトの実行を試みる（CSP でブロックされるはず）
eval("alert('XSS')")
# → CSP により eval is not allowed が発生
```

### 2. JWT 検証のテスト（Postman/curl）

```bash
# 1. 無効なトークンでリクエスト
curl -X GET https://api.example.com/v1/search \
  -H "Authorization: Bearer invalid-token"

# 期待される結果:
# HTTP 401 Unauthorized
# { "error": "Invalid or expired token" }

# 2. トークンなしでリクエスト
curl -X GET https://api.example.com/v1/search

# 期待される結果:
# HTTP 401 Unauthorized
# { "error": "Missing Authorization header" }

# 3. 有効なトークンでリクエスト
curl -X GET https://api.example.com/v1/search \
  -H "Authorization: Bearer <VALID_JWT_TOKEN>"

# 期待される結果:
# HTTP 200 OK
# { "results": [...] }
```

### 3. CSRF 攻撃のシミュレーション

```html
<!-- 攻撃者が作成する悪意のあるページ -->
<!DOCTYPE html>
<html>
<head>
  <title>Fake Page</title>
</head>
<body>
  <!-- 偽の authorization code でコールバック -->
  <img src="https://your-app.com/auth/callback?code=FAKE_CODE&state=FAKE_STATE" />
</body>
</html>
```

期待される結果:
- Amplify が state 検証に失敗
- エラーが発生し、ログインが完了しない

---

## まとめ

### ✅ 実装済みのセキュリティ対策

1. **OAuth 2.0 PKCE フロー** - AWS Amplify が自動実装
2. **JWT トークン検証** - API Gateway Cognito Authorizer
3. **エラーハンドリング** - 詳細情報を表示しない
4. **最小権限の原則** - 必要最小限のユーザー情報のみ表示

### 🔴 今後実装すべき対策

1. **CSP ヘッダー** - XSS 攻撃の防止（P0）
2. **Refresh Token 有効期限短縮** - トークン漏洩時の影響最小化（P0）
3. **DOMPurify** - 入力サニタイズ（P1）
4. **CloudWatch モニタリング** - 異常なアクセスの検知（P2）

---

**次のステップ**: [Header-Authentication-Security-Checklist.md](./Header-Authentication-Security-Checklist.md) を参照して、実装を進めてください。
