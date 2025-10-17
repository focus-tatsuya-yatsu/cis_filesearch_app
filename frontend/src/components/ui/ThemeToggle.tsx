'use client'

import { FC } from 'react'

import { Moon, Sun } from 'lucide-react'

import { useTheme } from '@/contexts/ThemeContext'

import { Button } from './Button'

export const ThemeToggle: FC = () => {
  const { theme, toggleTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleTheme}
      icon={theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
      aria-label={theme === 'light' ? 'ダークモードに切り替え' : 'ライトモードに切り替え'}
    >
      <span className="sr-only">{theme === 'light' ? 'ダークモード' : 'ライトモード'}</span>
    </Button>
  )
}
