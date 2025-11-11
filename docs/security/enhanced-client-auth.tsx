/**
 * 強化されたクライアントサイド認証
 *
 * 注意: これは次善策であり、Lambda@Edgeによるサーバーサイド認証が最も推奨される
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  fallbackUrl?: string;
}

/**
 * 保護されたルートコンポーネント
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  fallbackUrl = '/',
}) => {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthentication();

    // ⚠️ 定期的な認証チェック（5分ごと）
    const interval = setInterval(() => {
      checkAuthentication();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  async function checkAuthentication() {
    try {
      // 1. ユーザー情報を取得
      const user = await getCurrentUser();

      // 2. セッション情報を取得
      const session = await fetchAuthSession();

      // 3. トークンの有効性を検証
      const tokens = session.tokens;
      if (!tokens?.idToken) {
        throw new Error('No valid tokens');
      }

      // 4. トークンの有効期限をチェック
      const idToken = tokens.idToken.toString();
      const payload = JSON.parse(atob(idToken.split('.')[1]));
      const exp = payload.exp * 1000;
      const now = Date.now();

      if (exp <= now) {
        throw new Error('Token expired');
      }

      // 5. 認証成功
      setIsAuthenticated(true);
      setIsLoading(false);
    } catch (error) {
      console.error('Authentication check failed:', error);

      // 認証失敗 → リダイレクト
      setIsAuthenticated(false);
      setIsLoading(false);

      // セッションストレージをクリア
      if (typeof window !== 'undefined') {
        sessionStorage.clear();
        localStorage.clear();
      }

      // ログインページにリダイレクト
      router.replace(fallbackUrl);
    }
  }

  // ローディング中
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mx-auto"></div>
          <p className="text-gray-600">認証を確認中...</p>
        </div>
      </div>
    );
  }

  // 認証失敗
  if (!isAuthenticated) {
    return null;  // リダイレクト処理中
  }

  // 認証成功 → コンテンツを表示
  return <>{children}</>;
};

/**
 * 使用例
 *
 * // app/search/page.tsx
 * 'use client';
 *
 * import { ProtectedRoute } from '@/components/Auth/ProtectedRoute';
 *
 * export default function SearchPage() {
 *   return (
 *     <ProtectedRoute>
 *       <div>
 *         <h1>検索ページ</h1>
 *         {/* 保護されたコンテンツ * /}
 *       </div>
 *     </ProtectedRoute>
 *   );
 * }
 */
