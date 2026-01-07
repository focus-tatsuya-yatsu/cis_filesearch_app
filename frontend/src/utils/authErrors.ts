/**
 * AWS Cognito認証エラーハンドリングユーティリティ
 *
 * Cognitoのエラーコードを日本語メッセージに変換
 */

// ========================================
// Error Types
// ========================================

/**
 * Cognito認証エラーの型
 */
export interface CognitoError {
  name: string
  message: string
}

// ========================================
// Error Message Mapping
// ========================================

/**
 * Cognitoエラーコードと日本語メッセージのマッピング
 */
const ERROR_MESSAGES: Record<string, string> = {
  // 認証エラー
  UserNotFoundException: 'ユーザーが見つかりません。メールアドレスを確認してください。',
  NotAuthorizedException: 'メールアドレスまたはパスワードが正しくありません。',
  InvalidParameterException: '入力内容に誤りがあります。もう一度お試しください。',
  InvalidPasswordException: 'パスワードの形式が正しくありません。',

  // パスワードリセットエラー
  CodeMismatchException: '検証コードが正しくありません。もう一度お試しください。',
  ExpiredCodeException: '検証コードの有効期限が切れています。もう一度送信してください。',
  LimitExceededException: '試行回数の上限に達しました。しばらく時間をおいてからお試しください。',

  // アカウント状態エラー
  UserNotConfirmedException: 'アカウントが確認されていません。メールを確認してください。',
  PasswordResetRequiredException: 'パスワードのリセットが必要です。',

  // ネットワークエラー
  NetworkError: 'ネットワークエラーが発生しました。接続を確認してください。',

  // その他
  TooManyRequestsException: 'リクエストが多すぎます。しばらく時間をおいてからお試しください。',
  TooManyFailedAttemptsException:
    'ログイン試行回数が多すぎます。しばらく時間をおいてからお試しください。',
}

// ========================================
// Error Handling Functions
// ========================================

/**
 * Cognitoエラーを日本語メッセージに変換
 *
 * @param error - Cognitoエラーオブジェクト
 * @returns ユーザーフレンドリーな日本語エラーメッセージ
 */
export const getCognitoErrorMessage = (error: unknown): string => {
  // nullまたはundefinedチェック
  if (!error) {
    return '予期しないエラーが発生しました。もう一度お試しください。'
  }

  // errorがobjectかどうか確認
  if (typeof error !== 'object') {
    return '予期しないエラーが発生しました。もう一度お試しください。'
  }

  const cognitoError = error as CognitoError

  // エラー名が存在する場合
  if (cognitoError.name && ERROR_MESSAGES[cognitoError.name]) {
    return ERROR_MESSAGES[cognitoError.name]
  }

  // デフォルトエラーメッセージ
  return '予期しないエラーが発生しました。もう一度お試しください。'
}

/**
 * エラーがCognitoエラーかどうかを判定
 *
 * @param error - エラーオブジェクト
 * @returns Cognitoエラーの場合true
 */
export const isCognitoError = (error: unknown): error is CognitoError =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  typeof (error as CognitoError).name === 'string'

/**
 * パスワードリセット関連のエラーかどうかを判定
 *
 * @param error - エラーオブジェクト
 * @returns パスワードリセットエラーの場合true
 */
export const isPasswordResetError = (error: unknown): boolean => {
  if (!isCognitoError(error)) return false

  const resetErrorNames = [
    'CodeMismatchException',
    'ExpiredCodeException',
    'LimitExceededException',
  ]

  return resetErrorNames.includes(error.name)
}

/**
 * ログインエラーかどうかを判定
 *
 * @param error - エラーオブジェクト
 * @returns ログインエラーの場合true
 */
export const isLoginError = (error: unknown): boolean => {
  if (!isCognitoError(error)) return false

  const loginErrorNames = [
    'UserNotFoundException',
    'NotAuthorizedException',
    'UserNotConfirmedException',
    'PasswordResetRequiredException',
  ]

  return loginErrorNames.includes(error.name)
}
