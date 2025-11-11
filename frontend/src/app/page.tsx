/**
 * Home Page (Protected)
 *
 * アプリケーションのエントリーポイント
 *
 * @remarks
 * 認証ガードで保護されたページ:
 * - 認証済み: 検索インターフェースを表示
 * - 未認証: ログインフォームを表示
 * - ローディング中: スピナーを表示
 *
 * @authentication
 * このページは `withAuth` HOCで保護されています
 */

'use client'

import { FC } from 'react'

import { withAuth } from '@/components/Auth/ProtectedPage'
import { SearchInterface } from '@/components/search/SearchInterface'

/**
 * ホームページコンポーネント
 *
 * 認証済みユーザーに検索インターフェースを提供
 */
const HomePage: FC = () => {
  return <SearchInterface />
}

// 認証ガードでラップしてエクスポート
export default withAuth(HomePage)
