'use client'

import { useEffect } from 'react'

import { Toaster } from 'sonner'

import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext' // layout.tsx から移動

export function Providers({ children }: { children: React.ReactNode }) {
  // 開発環境でのみデバッグログを出力
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('🚀 Providers initialized')
      console.log('📦 Environment:', {
        NODE_ENV: process.env.NODE_ENV,
        HAS_COGNITO_USER_POOL_ID: !!process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
        HAS_COGNITO_APP_CLIENT_ID: !!process.env.NEXT_PUBLIC_COGNITO_APP_CLIENT_ID,
        HAS_COGNITO_DOMAIN: !!process.env.NEXT_PUBLIC_COGNITO_DOMAIN,
        HAS_APP_URL: !!process.env.NEXT_PUBLIC_APP_URL,
      })
    }
  }, [])

  // 複数のProviderをここでネスト(入れ子に)します
  return (
    <AuthProvider>
      <ThemeProvider>
        {/* Toast Notification Provider */}
        <Toaster
          position="top-right"
          expand={false}
          richColors
          closeButton
          duration={3000}
          toastOptions={{
            style: {
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            },
            className: 'sonner-toast',
          }}
        />
        {children}
      </ThemeProvider>
    </AuthProvider>
  )
}
