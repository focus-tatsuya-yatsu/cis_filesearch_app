/**
 * フォームバリデーションユーティリティ
 *
 * メールアドレス、パスワードなどのバリデーション機能を提供
 */

// ========================================
// Types
// ========================================

export interface ValidationResult {
  isValid: boolean
  error: string | null
}

// ========================================
// Email Validation
// ========================================

/**
 * メールアドレスのバリデーション
 *
 * @param email - 検証するメールアドレス
 * @returns バリデーション結果
 */
export const validateEmail = (email: string): ValidationResult => {
  // 空文字チェック
  if (!email || email.trim() === '') {
    return {
      isValid: false,
      error: 'メールアドレスを入力してください',
    }
  }

  // RFC 5322準拠の緩いメール形式チェック
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailPattern.test(email)) {
    return {
      isValid: false,
      error: 'メールアドレスの形式が正しくありません',
    }
  }

  return {
    isValid: true,
    error: null,
  }
}

// ========================================
// Password Validation
// ========================================

/**
 * パスワード強度のバリデーション
 *
 * AWS Cognitoのデフォルトポリシーに準拠:
 * - 最小8文字
 * - 小文字を含む
 * - 大文字を含む
 * - 数字を含む
 * - 記号を含む
 *
 * @param password - 検証するパスワード
 * @returns バリデーション結果
 */
export const validatePassword = (password: string): ValidationResult => {
  // 空文字チェック
  if (!password || password.trim() === '') {
    return {
      isValid: false,
      error: 'パスワードを入力してください',
    }
  }

  // 長さチェック
  if (password.length < 8) {
    return {
      isValid: false,
      error: 'パスワードは8文字以上必要です',
    }
  }

  // 小文字チェック
  if (!/[a-z]/.test(password)) {
    return {
      isValid: false,
      error: 'パスワードには小文字を含めてください',
    }
  }

  // 大文字チェック
  if (!/[A-Z]/.test(password)) {
    return {
      isValid: false,
      error: 'パスワードには大文字を含めてください',
    }
  }

  // 数字チェック
  if (!/[0-9]/.test(password)) {
    return {
      isValid: false,
      error: 'パスワードには数字を含めてください',
    }
  }

  // 記号チェック
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return {
      isValid: false,
      error: 'パスワードには記号を含めてください',
    }
  }

  return {
    isValid: true,
    error: null,
  }
}

/**
 * パスワード確認のバリデーション
 *
 * @param password - 元のパスワード
 * @param confirmPassword - 確認用パスワード
 * @returns バリデーション結果
 */
export const validatePasswordConfirmation = (
  password: string,
  confirmPassword: string
): ValidationResult => {
  if (!confirmPassword || confirmPassword.trim() === '') {
    return {
      isValid: false,
      error: '確認用パスワードを入力してください',
    }
  }

  if (password !== confirmPassword) {
    return {
      isValid: false,
      error: 'パスワードが一致しません',
    }
  }

  return {
    isValid: true,
    error: null,
  }
}

// ========================================
// Verification Code Validation
// ========================================

/**
 * 検証コード（6桁数字）のバリデーション
 *
 * @param code - 検証コード
 * @returns バリデーション結果
 */
export const validateVerificationCode = (code: string): ValidationResult => {
  if (!code || code.trim() === '') {
    return {
      isValid: false,
      error: '検証コードを入力してください',
    }
  }

  // 6桁の数字チェック
  if (!/^\d{6}$/.test(code)) {
    return {
      isValid: false,
      error: '検証コードは6桁の数字で入力してください',
    }
  }

  return {
    isValid: true,
    error: null,
  }
}

// ========================================
// Username Validation
// ========================================

/**
 * ユーザー名のバリデーション
 *
 * @param username - ユーザー名（メールアドレスまたはユーザー名）
 * @returns バリデーション結果
 */
export const validateUsername = (username: string): ValidationResult => {
  if (!username || username.trim() === '') {
    return {
      isValid: false,
      error: 'ユーザー名またはメールアドレスを入力してください',
    }
  }

  // 最小文字数チェック
  if (username.length < 3) {
    return {
      isValid: false,
      error: 'ユーザー名は3文字以上必要です',
    }
  }

  return {
    isValid: true,
    error: null,
  }
}
