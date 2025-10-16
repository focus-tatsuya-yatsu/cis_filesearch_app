import { FC, ReactNode } from 'react'
import { motion } from 'framer-motion'

interface CardProps {
  children: ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
}

export const Card: FC<CardProps> = ({ children, className = '', hover = false, onClick }) => {
  const Component = hover ? motion.div : 'div'
  const hoverProps = hover
    ? {
        whileHover: { scale: 1.01, boxShadow: '0 10px 30px rgba(0,0,0,0.1)' },
        transition: { duration: 0.2 },
      }
    : {}

  return (
    <Component
      className={`
        bg-white rounded-xl shadow-md p-6
        ${onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
      onClick={onClick}
      {...hoverProps}
    >
      {children}
    </Component>
  )
}