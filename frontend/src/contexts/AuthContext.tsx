/**
 * AWS Cognito認証Context
 *
 * アプリケーション全体で認証状態を管理
 */

'use client'

import { createContext, useContext, useState, useEffect, useCallback, FC, ReactNode } from 'react'

import {
  signIn,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  confirmSignIn,
  signInWithRedirect,
  resetPassword,
  confirmResetPassword,
} from 'aws-amplify/auth'
import type { AuthUser } from 'aws-amplify/auth'
import { configureAmplify, validateAmplifyConfig } from '@/lib/amplify'

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
  /** Cognito Hosted UIでログイン */
  loginWithHostedUI: () => Promise<void>
  /** ログアウト処理 */
  logout: () => Promise<void>
  /** アクセストークン取得 */
  getAccessToken: () => Promise<string | null>
  /** MFA確認（TOTP/SMS） */
  confirmMFA: (code: string) => Promise<void>
  /** 新しいパスワード設定（初回ログイン時） */
  confirmNewPassword: (newPassword: string) => Promise<void>
  /** パスワードリセットリクエスト（検証コード送信） */
  requestPasswordReset: (username: string) => Promise<void>
  /** パスワードリセット完了（新しいパスワード設定） */
  confirmPasswordReset: (username: string, code: string, newPassword: string) => Promise<void>
}

interface LoginResult {
  success: boolean
  requiresMFA: boolean
  mfaType?: 'SMS_MFA' | 'SOFTWARE_TOKEN_MFA'
  requiresNewPassword: boolean
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
  const [isConfigured, setIsConfigured] = useState(false)

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
   * Amplify初期化
   *
   * @remarks
   * コンポーネントマウント時に一度だけ実行されます。
   * Amplifyが正常に設定された場合のみ、以降の認証処理が可能になります。
   */
  useEffect(() => {
    const initializeAmplify = async () => {
      try {
        console.log('🔧 Amplify初期化を開始...')
        validateAmplifyConfig()
        configureAmplify()
        console.log('✅ Amplify設定が完了しました')
        setIsConfigured(true)
      } catch (error) {
        console.error('❌ Amplify設定に失敗しました:', error)
        setIsLoading(false)
      }
    }

    initializeAmplify()
  }, [])

  /**
   * Amplify初期化後にセッションチェック
   *
   * @remarks
   * isConfigured が true になってから実行されます。
   */
  useEffect(() => {
    if (isConfigured) {
      checkUser()
    }
  }, [isConfigured, checkUser])

  /**
   * ログイン処理
   *
   * @param username - ユーザー名またはメールアドレス
   * @param password - パスワード
   * @returns ログイン結果（MFA必要かどうか、新しいパスワード必要かどうか）
   */
  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      try {
        const result = await signIn({ username, password })

        // 新しいパスワードが必要な場合（初回ログイン）
        if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
          return {
            success: false,
            requiresMFA: false,
            requiresNewPassword: true,
          }
        }

        // MFAが必要な場合
        if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_SMS_CODE') {
          return {
            success: false,
            requiresMFA: true,
            mfaType: 'SMS_MFA',
            requiresNewPassword: false,
          }
        }

        if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
          return {
            success: false,
            requiresMFA: true,
            mfaType: 'SOFTWARE_TOKEN_MFA',
            requiresNewPassword: false,
          }
        }

        // MFA不要、新規パスワード不要（ログイン成功）
        await checkUser()
        return {
          success: true,
          requiresMFA: false,
          requiresNewPassword: false,
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
   * 新しいパスワード設定処理（初回ログイン時）
   *
   * @param newPassword - 新しいパスワード
   * @remarks
   * NEW_PASSWORD_REQUIRED challengeに応答するために使用します。
   * signInの後、confirmSignInでnewPasswordを設定します。
   */
  const confirmNewPassword = useCallback(
    async (newPassword: string): Promise<void> => {
      try {
        await confirmSignIn({ challengeResponse: newPassword })
        await checkUser()
      } catch (error) {
        console.error('New password confirmation failed:', error)
        throw error
      }
    },
    [checkUser]
  )

  /**
   * Cognito Hosted UIでログイン
   *
   * OAuth 2.0 PKCE (Authorization Code Grant with Proof Key for Code Exchange) を使用して
   * Cognitoが提供するHosted UIにリダイレクトします。
   * ログイン完了後、/auth/callbackにリダイレクトされます。
   */
  const loginWithHostedUI = useCallback(async (): Promise<void> => {
    try {
      await signInWithRedirect()
    } catch (error) {
      console.error('Hosted UI login failed:', error)
      throw error
    }
  }, [])

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

  /**
   * パスワードリセットリクエスト
   *
   * ユーザーのメールアドレスに検証コードを送信します
   *
   * @param username - ユーザー名またはメールアドレス
   */
  const requestPasswordReset = useCallback(async (username: string): Promise<void> => {
    try {
      await resetPassword({ username })
    } catch (error) {
      console.error('Password reset request failed:', error)
      throw error
    }
  }, [])

  /**
   * パスワードリセット完了
   *
   * 検証コードと新しいパスワードでパスワードをリセットします
   *
   * @param username - ユーザー名またはメールアドレス
   * @param code - メールで受信した検証コード
   * @param newPassword - 新しいパスワード
   */
  const confirmPasswordReset = useCallback(
    async (username: string, code: string, newPassword: string): Promise<void> => {
      try {
        await confirmResetPassword({
          username,
          confirmationCode: code,
          newPassword,
        })
      } catch (error) {
        console.error('Password reset confirmation failed:', error)
        throw error
      }
    },
    []
  )

  // Amplify初期化中の表示
  if (!isConfigured && isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"></div>
          <p className="text-sm text-gray-600">Amplify初期化中...</p>
        </div>
      </div>
    )
  }

  // Amplify設定エラー時の表示
  if (!isConfigured && !isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="rounded-lg border border-red-200 bg-red-50 p-6">
            <h2 className="text-lg font-semibold text-red-800">設定エラー</h2>
            <p className="mt-2 text-sm text-red-600">
              AWS Amplifyの設定に失敗しました。
              <br />
              環境変数を確認してください。
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        loginWithHostedUI,
        logout,
        getAccessToken,
        confirmMFA,
        confirmNewPassword,
        requestPasswordReset,
        confirmPasswordReset,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
