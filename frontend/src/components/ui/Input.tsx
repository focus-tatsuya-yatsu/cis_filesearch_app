import { InputHTMLAttributes, FC, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

export const Input: FC<InputProps> = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className = '', ...props }, ref) => (
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
              ${
                error
                  ? 'border-[#FF3B30] dark:border-[#FF453A] focus:ring-[#FF3B30]/20 dark:focus:ring-[#FF453A]/20 focus:border-[#FF3B30] dark:focus:border-[#FF453A]'
                  : ''
              }
              ${className}
            `}
          {...props}
        />
      </div>
      {/* Error Message - Apple System Colors */}
      {error && <p className="mt-1 text-sm text-[#FF3B30] dark:text-[#FF453A]">{error}</p>}
    </div>
  )
)

Input.displayName = 'Input'
