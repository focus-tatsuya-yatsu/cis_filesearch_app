# CIS ファイル検索システム コーディング規約

## 1. 基本原則

### 1.1 コーディングフィロソフィー

- **読みやすさ重視**: コードは書く時間より読む時間の方が長い
- **DRY原則**: Don't Repeat Yourself - 重複を避ける
- **KISS原則**: Keep It Simple, Stupid - シンプルに保つ
- **YAGNI原則**: You Aren't Gonna Need It - 必要になるまで実装しない

## 2. TypeScript/JavaScript規約

### 2.1 モジュールシステム

**必須: ES Modulesを使用**

```typescript
// ✅ 良い例: ES Modules with destructuring
import { useState, useEffect } from "react";
import { fetchUser, updateUser } from "@/services/api";
import type { User } from "@/types";

// ❌ 悪い例: CommonJS
const React = require("react");
```

### 2.2 命名規則

```typescript
// インターフェース: PascalCase
interface UserProfile {
  id: string;
  name: string;
}

// 型エイリアス: PascalCase
type UserId = string;

// 変数・関数: camelCase
const userCount = 10;
const calculateTotal = (items: Item[]) => { /* ... */ };

// 定数: UPPER_SNAKE_CASE
const MAX_FILE_SIZE = 10485760;
const API_TIMEOUT = 30000;
```

### 2.3 関数定義

```typescript
// ✅ 必須: アロー関数を使用
export const UserCard: FC<UserCardProps> = ({ name, email }) => {
  return <div>{/* ... */}</div>;
};

// ✅ 良い例: 明示的な戻り値の型
const calculatePrice = (items: Item[]): number => {
  return items.reduce((sum, item) => sum + item.price, 0);
};

// ❌ 悪い例: function宣言（クラスメソッド以外）
function UserCard(props) {
  return <div>{props.name}</div>;
}
```

### 2.4 分割代入の使用

```typescript
// ✅ 良い例: Propsの分割代入
export const ProductCard: FC<ProductCardProps> = ({
  name,
  price,
  inStock = true
}) => {
  return <div>{name}</div>;
};

// ❌ 悪い例: props直接アクセス
export const ProductCard = (props) => {
  return <div>{props.name}</div>;
};
```

## 3. React規約

### 3.1 コンポーネント定義

```typescript
// ✅ 必須: FC with proper typing
import { FC } from 'react';

interface UserCardProps {
  user: User;
  onEdit?: (user: User) => void;
}

export const UserCard: FC<UserCardProps> = ({ user, onEdit }) => {
  return (
    <div>
      <h3>{user.name}</h3>
      {onEdit && <button onClick={() => onEdit(user)}>Edit</button>}
    </div>
  );
};
```

### 3.2 Hooks使用規則

```typescript
// ✅ 良い例: カスタムフック
const useUser = (userId: string) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchUser(userId).then(setUser).finally(() => setIsLoading(false));
  }, [userId]);

  return { user, isLoading };
};

// ✅ 良い例: 分割代入で使用
const { data, isLoading } = useSWR("/api/user", fetcher);
```

## 4. CSS/スタイリング規約

### 4.1 Tailwind CSS

```tsx
// ✅ 良い例: Tailwindユーティリティクラス
<div className="flex items-center justify-between p-4 bg-white rounded-lg">
  <h2 className="text-xl font-semibold">Title</h2>
</div>

// ✅ 良い例: レスポンシブデザイン
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>
```

### 4.2 単位の使用

```css
/* ✅ 良い例: 相対単位 */
.container {
  padding: 1rem;
  font-size: 1.125rem;
  width: 100%;
  max-width: 80vw;
}

/* ❌ 悪い例: 固定px値の過度な使用 */
.container {
  padding: 16px;
  width: 1200px;
}
```

## 5. ファイル構造規約

### 5.1 インポート順序

```typescript
// 1. React/Next.js
import { useState } from "react";
import { useRouter } from "next/navigation";

// 2. 外部ライブラリ
import { z } from "zod";

// 3. 内部モジュール（絶対パス）
import { Button } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";

// 4. 相対パス
import { SearchBar } from "./SearchBar";

// 5. 型定義
import type { User } from "@/types";

// 6. スタイル
import styles from "./styles.module.css";
```

## 6. エラーハンドリング

```typescript
// ✅ 良い例: カスタムエラークラス
class ValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

// ✅ 良い例: try-catch
const fetchUserData = async (userId: string): Promise<User> => {
  try {
    const response = await api.get(`/users/${userId}`);
    return response.data;
  } catch (error) {
    logger.error("Failed to fetch user", { userId, error });
    throw new UserNotFoundError(userId);
  }
};
```

## 7. テスト規約

```typescript
// ✅ 良い例: AAA パターン (Arrange, Act, Assert)
describe("UserService", () => {
  it("should return user data", async () => {
    // Arrange
    const userId = "user123";
    mockApi.get.mockResolvedValueOnce({ data: expectedUser });

    // Act
    const result = await userService.fetchUser(userId);

    // Assert
    expect(result).toEqual(expectedUser);
  });
});
```

## 8. コメント規約

```typescript
/**
 * ファイルを検索し、結果を返す
 *
 * @param query - 検索クエリ
 * @param options - 検索オプション
 * @returns 検索結果の配列
 * @throws {ValidationError} クエリが不正な場合
 */
export const searchFiles = async (
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> => {
  // 実装
};
```

## 9. Git規約

### 9.1 コミットメッセージ

```bash
feat(search): 画像類似検索機能を追加
fix(auth): ログイン時のトークン更新エラーを修正
docs(api): エンドポイント仕様を更新
refactor(db): データベース接続処理を最適化
test(search): 検索機能のユニットテストを追加
```

### 9.2 ブランチ命名

```bash
feature/search-optimization
bugfix/login-error
hotfix/critical-security-issue
```

## 10. セキュリティ規約

```typescript
// ❌ 悪い例: ハードコーディング
const apiKey = "sk-1234567890abcdef";

// ✅ 良い例: 環境変数
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error("API_KEY is required");

// ✅ 良い例: Zodによる入力検証
const searchSchema = z.object({
  query: z.string().min(1).max(100),
  page: z.number().int().positive()
});
```

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-15 | 初版作成 | CIS開発チーム |