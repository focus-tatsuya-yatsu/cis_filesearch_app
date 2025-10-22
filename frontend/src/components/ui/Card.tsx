import { FC, ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
}

export const Card: FC<CardProps> = ({ children, className = '', hover = false, onClick }) => {
  // CSS Transitions for hover effect (Apple Design Philosophy)
  const hoverClasses = hover
    ? 'transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[1.01] hover:shadow-lg'
    : ''

  return (
    <div
      className={`
        bg-white rounded-xl shadow-md p-6
        ${onClick ? 'cursor-pointer' : ''}
        ${hoverClasses}
        ${className}
      `}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  )
}
