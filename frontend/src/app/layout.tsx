import { FC, ReactNode } from 'react'

import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

// ThemeProvider の代わりに Providers をインポートします
import { Providers } from './providers'
import '@/styles/globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'CIS ファイル検索システム',
  description: '企業内ファイル検索アプリケーション',
}

interface RootLayoutProps {
  children: ReactNode
}

const RootLayout: FC<RootLayoutProps> = ({ children }) => (
  <html lang="ja" suppressHydrationWarning>
    <body className={inter.className} suppressHydrationWarning>
      <script
        dangerouslySetInnerHTML={{
          __html: `
              (function() {
                try {
                  const theme = localStorage.getItem('theme');
                  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  if (theme === 'dark' || (!theme && prefersDark)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `,
        }}
      />
      {/* ThemeProvider の代わりに Providers で囲みます */}
      <Providers>{children}</Providers>
    </body>
  </html>
)

export default RootLayout
