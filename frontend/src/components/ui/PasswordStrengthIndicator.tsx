/**
 * パスワード強度インジケーターコンポーネント
 *
 * パスワードの強度をリアルタイムで可視化し、
 * AWS Cognitoのパスワードポリシーへの準拠を確認します。
 *
 * Apple Human Interface Guidelinesに基づいた洗練されたアニメーションと
 * 視覚的フィードバックを提供します。
 */

'use client'

import { FC, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ========================================
// Types
// ========================================

interface PasswordStrengthIndicatorProps {
  /** パスワード文字列 */
  password: string
  /** 表示するラベル */
  showLabel?: boolean
}

interface PasswordRequirement {
  label: string
  test: (password: string) => boolean
  met: boolean
}

type StrengthLevel = 'none' | 'weak' | 'fair' | 'good' | 'strong'

// ========================================
// Component
// ========================================

export const PasswordStrengthIndicator: FC<PasswordStrengthIndicatorProps> = ({
  password,
  showLabel = true,
}) => {
  /**
   * パスワード要件チェック
   */
  const requirements = useMemo<PasswordRequirement[]>(() => {
    return [
      {
        label: '8文字以上',
        test: (pwd) => pwd.length >= 8,
        met: password.length >= 8,
      },
      {
        label: '小文字を含む (a-z)',
        test: (pwd) => /[a-z]/.test(pwd),
        met: /[a-z]/.test(password),
      },
      {
        label: '大文字を含む (A-Z)',
        test: (pwd) => /[A-Z]/.test(pwd),
        met: /[A-Z]/.test(password),
      },
      {
        label: '数字を含む (0-9)',
        test: (pwd) => /[0-9]/.test(pwd),
        met: /[0-9]/.test(password),
      },
      {
        label: '記号を含む (!@#$%...)',
        test: (pwd) => /[^a-zA-Z0-9]/.test(pwd),
        met: /[^a-zA-Z0-9]/.test(password),
      },
    ]
  }, [password])

  /**
   * パスワード強度の計算（より洗練されたアルゴリズム）
   */
  const strengthLevel = useMemo<StrengthLevel>(() => {
    if (!password) return 'none'

    let score = 0

    // 基本要件チェック (0-3 points)
    if (password.length >= 8) score++
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
    if (/[0-9]/.test(password) && /[^a-zA-Z0-9]/.test(password)) score++

    // ボーナスポイント (0-2 points)
    if (password.length >= 12) score++
    if ((password.match(/[^a-zA-Z0-9]/g) || []).length >= 2) score++

    // スコアを強度レベルにマッピング
    if (score <= 1) return 'weak'
    if (score === 2) return 'weak'
    if (score === 3) return 'fair'
    if (score === 4) return 'good'
    return 'strong'
  }, [password])

  /**
   * 強度レベルに対応する色とラベル (Apple System Colors)
   */
  const strengthConfig = useMemo(() => {
    const configs = {
      none: {
        bgColor: '#D1D1D6',
        darkBgColor: '#48484A',
        label: '',
        textColor: '#6E6E73',
        darkTextColor: '#98989D',
        percentage: 0,
      },
      weak: {
        bgColor: '#FF3B30',
        darkBgColor: '#FF453A',
        label: '弱い',
        textColor: '#FF3B30',
        darkTextColor: '#FF453A',
        percentage: 25,
      },
      fair: {
        bgColor: '#FF9500',
        darkBgColor: '#FF9F0A',
        label: '普通',
        textColor: '#FF9500',
        darkTextColor: '#FF9F0A',
        percentage: 50,
      },
      good: {
        bgColor: '#34C759',
        darkBgColor: '#32D74B',
        label: '良い',
        textColor: '#34C759',
        darkTextColor: '#32D74B',
        percentage: 75,
      },
      strong: {
        bgColor: '#007AFF',
        darkBgColor: '#0A84FF',
        label: '強力',
        textColor: '#007AFF',
        darkTextColor: '#0A84FF',
        percentage: 100,
      },
    }

    return configs[strengthLevel]
  }, [strengthLevel])

  // パスワードが未入力の場合は何も表示しない
  if (!password) return null

  return (
    <motion.div
      className="space-y-3"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* 強度バー */}
      <div className="space-y-2">
        {/* Progress bar container */}
        <div className="h-1 w-full bg-[#E5E5EA] dark:bg-[#3A3A3C] rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{
              backgroundColor: strengthConfig.bgColor,
            }}
            initial={{ width: 0 }}
            animate={{ width: `${strengthConfig.percentage}%` }}
            transition={{
              duration: 0.3,
              ease: 'easeOut',
            }}
          />
        </div>

        {/* 強度ラベル */}
        <AnimatePresence mode="wait">
          {showLabel && strengthConfig.label && (
            <motion.p
              key={strengthLevel}
              className="text-xs font-medium"
              style={{ color: strengthConfig.bgColor }}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2 }}
            >
              パスワード強度: {strengthConfig.label}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* 要件チェックリスト */}
      <div className="bg-[#F5F5F7] dark:bg-[#1C1C1E] rounded-xl p-4 space-y-2">
        <p className="text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">
          パスワードの要件
        </p>
        <div className="space-y-1.5">
          {requirements.map((requirement, index) => (
            <motion.div
              key={index}
              className="flex items-center gap-2"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05, duration: 0.2 }}
            >
              {/* Checkmark icon with animation */}
              <motion.div
                className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center transition-all duration-200 ${
                  requirement.met
                    ? 'bg-[#34C759] dark:bg-[#32D74B]'
                    : 'bg-[#D1D1D6] dark:bg-[#48484A]'
                }`}
                animate={{ scale: requirement.met ? [1, 1.2, 1] : 1 }}
                transition={{ duration: 0.3 }}
              >
                <AnimatePresence mode="wait">
                  {requirement.met ? (
                    <motion.svg
                      key="check"
                      className="w-3 h-3 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </motion.svg>
                  ) : null}
                </AnimatePresence>
              </motion.div>

              {/* Requirement label */}
              <span
                className={`text-xs transition-colors duration-200 ${
                  requirement.met
                    ? 'text-[#1D1D1F] dark:text-[#F5F5F7] font-medium'
                    : 'text-[#6E6E73] dark:text-[#98989D]'
                }`}
              >
                {requirement.label}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
