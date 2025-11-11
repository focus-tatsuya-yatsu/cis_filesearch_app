/**
 * 検索ページ
 *
 * ログイン成功後のリダイレクト先
 * 完全な検索インターフェースを提供
 */

'use client'

import { FC } from 'react'

import { withAuth } from '@/components/Auth/ProtectedPage'
import { SearchInterface } from '@/components/search/SearchInterface'

/**
 * 検索ページコンポーネント
 *
 * 認証済みユーザーに検索インターフェースを提供
 */
const SearchPage: FC = () => {
  return <SearchInterface />
}

// 認証ガードでラップしてエクスポート
export default withAuth(SearchPage)
