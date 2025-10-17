import { SelectHTMLAttributes, FC, forwardRef } from 'react'

import { ChevronDown } from 'lucide-react'

interface SelectOption {
  readonly value: string
  readonly label: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: readonly SelectOption[]
  error?: string
  placeholder?: string
}

export const Select: FC<SelectProps> = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, error, placeholder, className = '', ...props }, ref) => (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7] mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          className={`
              appearance-none
              block w-full rounded-lg
              border border-[#D1D1D6]/30 dark:border-[#38383A]/30
              bg-white/90 dark:bg-[#1C1C1E]/90
              text-[#1D1D1F] dark:text-[#F5F5F7]
              shadow-sm
              px-3 py-2 pr-10 text-base
              focus:ring-2 focus:ring-[#007AFF]/20 dark:focus:ring-[#0A84FF]/20
              focus:border-[#007AFF] dark:focus:border-[#0A84FF]
              disabled:bg-[#F5F5F7] dark:disabled:bg-[#2C2C2E]
              disabled:text-[#8E8E93] dark:disabled:text-[#6E6E73]
              transition-all duration-200
              ${error ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''}
              ${className}
            `}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <ChevronDown className="h-5 w-5 text-[#6E6E73] dark:text-[#8E8E93]" />
        </div>
      </div>
      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
)

Select.displayName = 'Select'
