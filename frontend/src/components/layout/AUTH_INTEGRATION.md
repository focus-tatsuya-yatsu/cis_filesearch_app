# Header Authentication Integration

AWS Cognito認証をHeaderコンポーネントに統合した実装ドキュメント

## 📋 概要

このドキュメントは、Headerコンポーネントへの認証統合の実装詳細を説明します。

### 実装されたコンポーネント

1. **Header.tsx** - メインヘッダーコンポーネント（認証統合版）
2. **UserMenu.tsx** - 認証済みユーザー向けドロップダウンメニュー
3. **Header.test.tsx** - Headerコンポーネントのテスト（認証含む）
4. **UserMenu.test.tsx** - UserMenuコンポーネントのテスト

## 🎯 主要機能

### 1. 認証状態による表示切り替え

**未認証状態:**
```
[Theme] [Notifications] [Settings] | [ログインボタン]
```

**認証済み状態:**
```
[Theme] [Notifications] [Settings] | [User Avatar + Name ▼]
                                      └─ Dropdown Menu
```

**ローディング状態:**
```
[Theme] [Notifications] [Settings] | [アニメーションプレースホルダー]
```

### 2. Cognito Hosted UI統合

- `loginWithHostedUI()` を使用してHosted UIにリダイレクト
- OAuth 2.0 PKCE フローを使用
- `/auth/callback` にリダイレクト後、自動的にセッション確立

### 3. ユーザーメニュー機能

- ユーザー情報表示（名前/メールアドレス）
- マイページへのリンク（TODO）
- 設定ページへのリンク（TODO）
- ログアウト機能

## 🔧 技術実装

### Header Component

```typescript
import { useAuth } from '@/contexts/AuthContext'

export const Header: FC = () => {
  const { isAuthenticated, isLoading, user, loginWithHostedUI, logout } = useAuth()

  const handleLogin = useCallback(async () => {
    try {
      setIsLoggingIn(true)
      await loginWithHostedUI()  // Hosted UIにリダイレクト
    } catch (error) {
      console.error('❌ ログインに失敗しました:', error)
      setIsLoggingIn(false)
    }
  }, [loginWithHostedUI])

  const handleLogout = useCallback(async () => {
    try {
      await logout()
      console.log('✅ ログアウトしました')
    } catch (error) {
      console.error('❌ ログアウトに失敗しました:', error)
    }
  }, [logout])

  // 認証状態によって表示を切り替え
  return (
    <>
      {isLoading ? (
        <LoadingPlaceholder />
      ) : isAuthenticated && user ? (
        <UserMenu user={user} onLogout={handleLogout} />
      ) : (
        <LoginButton onClick={handleLogin} loading={isLoggingIn} />
      )}
    </>
  )
}
```

### UserMenu Component

**主要機能:**
- ドロップダウンメニューの開閉制御
- メニュー外クリックで自動的に閉じる
- Escapeキーで閉じる
- キーボードナビゲーション対応

**実装パターン:**
```typescript
export const UserMenu: FC<UserMenuProps> = ({ user, onLogout }) => {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // メニュー外クリック検出
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Escapeキー検出
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])
}
```

## 🎨 デザイン仕様

### Apple-Inspired Design

**カラーパレット:**
- Primary Blue (Light): `#007AFF`
- Primary Blue (Dark): `#0A84FF`
- Text Primary (Light): `#1D1D1F`
- Text Primary (Dark): `#F5F5F7`
- Text Secondary (Light): `#6E6E73`
- Text Secondary (Dark): `#8E8E93`
- Danger Red (Light): `#FF3B30`
- Danger Red (Dark): `#FF453A`

**アニメーション:**
- フェードイン + スライドイン（メニュー表示時）
- ホバー時のスケール変化: `hover:scale-[1.02]`
- アクティブ時のスケール変化: `active:scale-[0.98]`

**レスポンシブ対応:**
- モバイル: ユーザー名を非表示、アバターのみ表示
- タブレット以上: ユーザー名を表示

## ♿ アクセシビリティ

### ARIA属性

```html
<!-- トグルボタン -->
<button
  aria-haspopup="true"
  aria-expanded={isOpen}
  aria-label="ユーザーメニュー"
>
  ...
</button>

<!-- ドロップダウンメニュー -->
<div
  role="menu"
  aria-orientation="vertical"
  aria-labelledby="user-menu-button"
>
  <button role="menuitem">マイページ</button>
  <button role="menuitem">設定</button>
  <button role="menuitem">ログアウト</button>
</div>
```

### キーボードナビゲーション

- `Tab`: フォーカス移動
- `Enter` / `Space`: メニュー項目選択
- `Escape`: メニューを閉じる

### スクリーンリーダー対応

- すべてのアイコンボタンに `aria-label` 設定
- 装飾的な要素に `aria-hidden="true"` 設定
- 視覚的に隠されたラベルに `.sr-only` クラス使用

## 🧪 テスト戦略

### Header.test.tsx

**テストカバレッジ:**
1. 基本UI要素の描画
2. 未認証状態でのログインボタン表示
3. ログインボタンクリック時の `loginWithHostedUI()` 呼び出し
4. ログイン処理中のローディング表示
5. 認証済み状態でのユーザーメニュー表示
6. ログアウト処理の実行
7. ローディング状態でのプレースホルダー表示
8. アクセシビリティ属性の検証

**モック戦略:**
```typescript
// AuthContextをモック
const mockUseAuth = jest.fn()
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

// UserMenuをモック（簡略化）
jest.mock('./UserMenu', () => ({
  UserMenu: ({ user, onLogout }) => (
    <div data-testid="user-menu">
      <span>{user.username}</span>
      <button onClick={onLogout}>ログアウト</button>
    </div>
  ),
}))
```

### UserMenu.test.tsx

**テストカバレッジ:**
1. 初期状態（メニュー閉じた状態）
2. メニューの開閉動作
3. メニュー外クリックで閉じる
4. Escapeキーで閉じる
5. 各メニュー項目のクリックイベント
6. ログアウト処理の実行
7. ユーザー情報の表示
8. アクセシビリティ属性の検証

**テスト実行:**
```bash
# 全テスト実行
yarn test

# 特定ファイルのテスト
yarn test Header.test.tsx
yarn test UserMenu.test.tsx

# カバレッジレポート生成
yarn test --coverage
```

## 🔒 セキュリティ考慮事項

### XSS対策
- ユーザー入力の適切なエスケープ（Reactのデフォルト動作）
- `dangerouslySetInnerHTML` は使用しない

### CSRF対策
- AWS Amplifyが自動的にCSRFトークンを処理

### セッション管理
- トークンは `aws-amplify` が自動管理
- アクセストークン取得は `getAccessToken()` を使用

## 📝 今後のTODO

### 1. トースト通知の実装

現在、成功/失敗メッセージはコンソールログのみ。
ユーザーフレンドリーなトースト通知を実装する必要があります。

```typescript
// TODO: トースト通知ライブラリの導入
import { toast } from 'react-hot-toast'

const handleLogin = async () => {
  try {
    await loginWithHostedUI()
    // トーストは表示されない（リダイレクトされるため）
  } catch (error) {
    toast.error('ログインに失敗しました。もう一度お試しください。')
  }
}

const handleLogout = async () => {
  try {
    await logout()
    toast.success('ログアウトしました')
  } catch (error) {
    toast.error('ログアウトに失敗しました')
  }
}
```

### 2. マイページと設定ページの実装

UserMenuから遷移する先のページを実装:
- `/profile` - マイページ
- `/settings` - 設定ページ

```typescript
import { useRouter } from 'next/navigation'

const router = useRouter()

const handleNavigateToProfile = () => {
  setIsOpen(false)
  router.push('/profile')
}

const handleNavigateToSettings = () => {
  setIsOpen(false)
  router.push('/settings')
}
```

### 3. ユーザーアバター画像の対応

現在はアイコンのみ。実際のユーザーアバター画像を表示する機能:

```typescript
interface UserMenuProps {
  user: AuthUser
  avatarUrl?: string  // オプショナルなアバターURL
  onLogout: () => void
}

export const UserMenu: FC<UserMenuProps> = ({ user, avatarUrl, onLogout }) => {
  return (
    <div className="h-7 w-7 rounded-full overflow-hidden">
      {avatarUrl ? (
        <img src={avatarUrl} alt={displayName} />
      ) : (
        <div className="bg-gradient-to-br from-[#007AFF] to-[#0051D5]">
          <User className="h-4 w-4 text-white" />
        </div>
      )}
    </div>
  )
}
```

### 4. ユーザー属性の拡張表示

Cognitoから取得できる追加属性の表示:
- 氏名（given_name, family_name）
- 電話番号
- 所属組織

```typescript
const getUserDisplayInfo = (user: AuthUser) => {
  const attributes = user.signInUserSession?.idToken?.payload
  return {
    email: attributes?.email,
    name: attributes?.name || attributes?.username,
    familyName: attributes?.family_name,
    givenName: attributes?.given_name,
    phoneNumber: attributes?.phone_number,
  }
}
```

### 5. パフォーマンス最適化

- メニューアニメーションの最適化
- `useCallback` / `useMemo` の適切な使用
- コンポーネントの遅延ロード（Code Splitting）

```typescript
import dynamic from 'next/dynamic'

const UserMenu = dynamic(() => import('./UserMenu').then(mod => mod.UserMenu), {
  loading: () => <div className="h-9 w-24 animate-pulse bg-gray-200 rounded-lg" />,
})
```

## 📚 参考資料

- [AWS Amplify Authentication Docs](https://docs.amplify.aws/lib/auth/getting-started/q/platform/js/)
- [AWS Cognito Hosted UI](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-app-integration.html)
- [React Testing Library Best Practices](https://testing-library.com/docs/react-testing-library/intro/)
- [WAI-ARIA Menu Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu/)

## 🤝 コントリビューション

このコンポーネントを改善する際は:

1. TypeScriptの型安全性を維持
2. アクセシビリティ基準（WCAG 2.1 AA）を遵守
3. テストカバレッジを維持（最低80%）
4. Apple Design Guidelinesに準拠したUI/UX
5. パフォーマンスへの影響を最小化

---

**Last Updated**: 2025-01-11
**Version**: 1.0.0
**Author**: Claude Code Assistant
