/**
 * ログインフォームコンポーネント
 *
 * AWS Cognito認証を使用したログイン画面
 */

'use client'

import { useState, FC } from 'react'

import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/contexts/AuthContext'

export const LoginForm: FC = () => {
  const { login, confirmMFA } = useAuth()
  const router = useRouter()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [requiresMFA, setRequiresMFA] = useState(false)
  const [mfaType, setMfaType] = useState<'SMS_MFA' | 'SOFTWARE_TOKEN_MFA'>()

  /**
   * ログインフォーム送信処理
   */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const result = await login(username, password)

      if (result.requiresMFA) {
        setRequiresMFA(true)
        setMfaType(result.mfaType)
      } else {
        // ログイン成功 → 検索ページへリダイレクト
        router.push('/search')
      }
    } catch (err) {
      console.error('Login error:', err)
      setError('ログインに失敗しました。ユーザー名とパスワードを確認してください。')
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * MFA確認処理
   */
  const handleMFAConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await confirmMFA(mfaCode)
      router.push('/search')
    } catch (err) {
      console.error('MFA confirmation error:', err)
      setError('認証コードが正しくありません。もう一度お試しください。')
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * MFA画面に戻る
   */
  const handleBackToLogin = () => {
    setRequiresMFA(false)
    setMfaCode('')
    setError('')
  }

  // MFA確認画面
  if (requiresMFA) {
    return (
      <div className="w-full max-w-md space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-center">多要素認証</h2>
          <p className="mt-2 text-sm text-center text-gray-600">
            {mfaType === 'SMS_MFA'
              ? 'SMSに送信された6桁のコードを入力してください'
              : 'Google Authenticatorアプリの6桁のコードを入力してください'}
          </p>
        </div>

        <form onSubmit={handleMFAConfirm} className="space-y-4">
          <div>
            <label htmlFor="mfaCode" className="block text-sm font-medium mb-2">
              認証コード
            </label>
            <Input
              id="mfaCode"
              type="text"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="123456"
              required
              maxLength={6}
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              className="text-center text-2xl tracking-widest"
            />
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}

          <div className="space-y-2">
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? '確認中...' : '確認'}
            </Button>

            <Button type="button" variant="ghost" onClick={handleBackToLogin} className="w-full">
              ログイン画面に戻る
            </Button>
          </div>
        </form>
      </div>
    )
  }

  // ログイン画面
  return (
    <div className="w-full max-w-md space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-center">CIS ファイル検索システム</h2>
        <p className="mt-2 text-sm text-center text-gray-600">ログインしてください</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm font-medium mb-2">
            ユーザー名 / メールアドレス
          </label>
          <Input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="user@example.com"
            required
            autoComplete="username"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-2">
            パスワード
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}

        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading ? 'ログイン中...' : 'ログイン'}
        </Button>

        <div className="text-center text-sm text-gray-500">
          <a href="/forgot-password" className="hover:text-gray-700 underline">
            パスワードをお忘れですか？
          </a>
        </div>
      </form>
    </div>
  )
}
