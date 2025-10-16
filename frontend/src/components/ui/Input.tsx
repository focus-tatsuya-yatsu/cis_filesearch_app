import { InputHTMLAttributes, FC, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

export const Input: FC<InputProps> = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={`
              block w-full rounded-lg border border-gray-300 shadow-sm
              px-3 py-2 text-base
              focus:ring-2 focus:ring-primary-500 focus:border-primary-500
              disabled:bg-gray-50 disabled:text-gray-500
              ${icon ? 'pl-10' : ''}
              ${error ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''}
              ${className}
            `}
            {...props}
          />
        </div>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'