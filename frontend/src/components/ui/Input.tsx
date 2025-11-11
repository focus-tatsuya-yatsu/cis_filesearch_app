import { InputHTMLAttributes, forwardRef, useState } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className = '', type = 'text', ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false)

    // パスワード表示切り替え時の実際のtype
    const actualType = type === 'password' && showPassword ? 'text' : type

    // パスワードフィールドの場合、右側にボタンのスペースを確保
    const passwordPaddingClass = type === 'password' ? 'pr-10' : ''

    return (
      <div className="w-full">
        {/* Label - Apple System Colors */}
        {label && (
          <label className="block text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7] mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {/* Icon Container */}
          {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6E6E73] dark:text-[#98989D]">
              {icon}
            </div>
          )}
          {/* Input Field - Apple Design System with Glass Morphism */}
          <input
            ref={ref}
            type={actualType}
            className={`
              block w-full rounded-xl
              border border-[#D1D1D6]/30 dark:border-[#38383A]/30
              bg-white/90 dark:bg-[#1C1C1E]/90
              backdrop-blur-xl
              text-[#1D1D1F] dark:text-[#F5F5F7]
              placeholder:text-[#6E6E73] dark:placeholder:text-[#98989D]
              shadow-sm
              px-3 py-2 text-base
              focus:outline-none
              focus:ring-2 focus:ring-[#007AFF]/20 dark:focus:ring-[#0A84FF]/20
              focus:border-[#007AFF] dark:focus:border-[#0A84FF]
              disabled:bg-[#F5F5F7] dark:disabled:bg-[#2C2C2E]
              disabled:text-[#8E8E93] dark:disabled:text-[#6E6E73]
              disabled:cursor-not-allowed
              transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
              ${icon ? 'pl-10' : ''}
              ${passwordPaddingClass}
              ${
                error
                  ? 'border-[#FF3B30] dark:border-[#FF453A] focus:ring-[#FF3B30]/20 dark:focus:ring-[#FF453A]/20 focus:border-[#FF3B30] dark:focus:border-[#FF453A]'
                  : ''
              }
              ${className}
            `}
            {...props}
          />
          {/* Password Toggle Button */}
          {type === 'password' && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#6E6E73] dark:text-[#98989D] hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7] transition-colors"
              tabIndex={-1}
            >
              {showPassword ? (
                // Eye Slash Icon (Hide)
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              ) : (
                // Eye Icon (Show)
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              )}
            </button>
          )}
        </div>
        {/* Error Message - Apple System Colors */}
        {error && <p className="mt-1 text-sm text-[#FF3B30] dark:text-[#FF453A]">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
