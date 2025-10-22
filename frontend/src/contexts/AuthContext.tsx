/**
 * AWS Cognito認証Context
 *
 * アプリケーション全体で認証状態を管理
 */

'use client'

import { createContext, useContext, useState, useEffect, useCallback, FC, ReactNode } from 'react'

import { signIn, signOut, getCurrentUser, fetchAuthSession, confirmSignIn } from 'aws-amplify/auth'
import type { AuthUser } from 'aws-amplify/auth'

// ========================================
// Types
// ========================================

interface AuthContextType {
  /** 現在ログイン中のユーザー */
  user: AuthUser | null
  /** 認証状態のロード中フラグ */
  isLoading: boolean
  /** ログイン済みフラグ */
  isAuthenticated: boolean
  /** ログイン処理 */
  login: (username: string, password: string) => Promise<LoginResult>
  /** ログアウト処理 */
  logout: () => Promise<void>
  /** アクセストークン取得 */
  getAccessToken: () => Promise<string | null>
  /** MFA確認（TOTP/SMS） */
  confirmMFA: (code: string) => Promise<void>
}

interface LoginResult {
  success: boolean
  requiresMFA: boolean
  mfaType?: 'SMS_MFA' | 'SOFTWARE_TOKEN_MFA'
}

interface AuthProviderProps {
  children: ReactNode
}

// ========================================
// Context
// ========================================

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * AuthContextを使用するためのカスタムフック
 */
export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

// ========================================
// Provider Component
// ========================================

export const AuthProvider: FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  /**
   * 現在のユーザー情報を取得
   */
  const checkUser = useCallback(async () => {
    try {
      const currentUser = await getCurrentUser()
      setUser(currentUser)
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * 初回マウント時にセッションチェック
   */
  useEffect(() => {
    checkUser()
  }, [checkUser])

  /**
   * ログイン処理
   *
   * @param username - ユーザー名またはメールアドレス
   * @param password - パスワード
   * @returns ログイン結果（MFA必要かどうか）
   */
  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      try {
        const result = await signIn({ username, password })

        // MFAが必要な場合
        if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_SMS_CODE') {
          return {
            success: false,
            requiresMFA: true,
            mfaType: 'SMS_MFA',
          }
        }

        if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
          return {
            success: false,
            requiresMFA: true,
            mfaType: 'SOFTWARE_TOKEN_MFA',
          }
        }

        // MFA不要（ログイン成功）
        await checkUser()
        return {
          success: true,
          requiresMFA: false,
        }
      } catch (error) {
        console.error('Login failed:', error)
        throw error
      }
    },
    [checkUser]
  )

  /**
   * MFA確認処理
   *
   * @param code - 6桁のMFAコード
   */
  const confirmMFA = useCallback(
    async (code: string): Promise<void> => {
      try {
        await confirmSignIn({ challengeResponse: code })
        await checkUser()
      } catch (error) {
        console.error('MFA confirmation failed:', error)
        throw error
      }
    },
    [checkUser]
  )

  /**
   * ログアウト処理
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await signOut()
      setUser(null)
    } catch (error) {
      console.error('Logout failed:', error)
      throw error
    }
  }, [])

  /**
   * アクセストークン取得
   *
   * @returns アクセストークン文字列、または null
   */
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const session = await fetchAuthSession()
      return session.tokens?.accessToken?.toString() ?? null
    } catch (error) {
      console.error('Failed to fetch access token:', error)
      return null
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        getAccessToken,
        confirmMFA,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
