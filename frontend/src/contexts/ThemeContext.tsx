'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    // ローカルストレージまたはシステム設定から初期テーマを取得
    const savedTheme = localStorage.getItem('theme') as Theme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

    if (savedTheme) {
      setTheme(savedTheme)
    } else if (prefersDark) {
      setTheme('dark')
    }
  }, [])

  useEffect(() => {
    // テーマが変更されたらドキュメントのクラスと localStorage を更新
    console.log('Theme changed to:', theme)
    if (theme === 'dark') {
      console.log('Adding dark class to documentElement')
      document.documentElement.classList.add('dark')
    } else {
      console.log('Removing dark class from documentElement')
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('theme', theme)
    console.log('documentElement classes:', document.documentElement.className)
  }, [theme])

  const toggleTheme = () => {
    console.log('toggleTheme called, current theme:', theme)
    setTheme(prevTheme => {
      const newTheme = prevTheme === 'light' ? 'dark' : 'light'
      console.log('Setting new theme:', newTheme)
      return newTheme
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}