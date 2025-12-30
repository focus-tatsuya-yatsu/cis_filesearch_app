# トースト通知システム実装ガイド

## 概要

CIS File Searchアプリケーションに、ユーザーフレンドリーなトースト通知システムを実装しました。`sonner`ライブラリを使用し、検索結果やエラー、画像アップロード状態などをリアルタイムでユーザーに通知します。

## 主な機能

### 1. 通知タイプ

| タイプ | 色 | 自動消去 | 用途 |
|--------|-----|----------|------|
| **success** | 緑 | 3秒 | 操作成功、検索完了 |
| **error** | 赤 | 手動 | エラー発生、失敗通知 |
| **warning** | 黄 | 5秒 | 警告、検索結果0件 |
| **info** | 青 | 3秒 | 情報提供 |
| **loading** | グレー | 手動 | 処理中の状態 |

### 2. 実装箇所

#### SearchInterface.tsx
- **テキスト検索**
  - 検索クエリバリデーションエラー
  - 検索成功/失敗通知
  - 検索結果0件警告
  - APIエラー（リトライボタン付き）

- **画像検索**
  - 画像アップロード開始（ローディング）
  - アップロード成功/失敗
  - 類似画像検索結果通知
  - OpenSearch接続エラー

#### ImageUpload.tsx
- ファイルバリデーションエラー（ファイル形式、サイズ）
- 画像アップロード進捗
- ベクトル化完了通知

## 使用方法

### 基本的な使い方

```tsx
import { useToast } from '@/hooks'

const MyComponent: FC = () => {
  const toast = useToast()

  const handleAction = () => {
    // 成功通知
    toast.success('操作が完了しました')

    // エラー通知（説明付き）
    toast.error('エラーが発生しました', {
      description: '詳細なエラーメッセージ'
    })

    // 警告通知（カスタム表示時間）
    toast.warning('検索結果が見つかりません', {
      duration: 5000
    })

    // 情報通知
    toast.info('処理を開始しました')
  }

  return <button onClick={handleAction}>実行</button>
}
```

### アクションボタン付き通知

```tsx
const handleError = () => {
  toast.error('検索に失敗しました', {
    description: 'ネットワークエラーが発生しました',
    action: {
      label: '再試行',
      onClick: () => {
        // リトライ処理
        performSearch()
      }
    }
  })
}
```

### ローディング通知

```tsx
const handleUpload = async (file: File) => {
  // ローディングトースト表示
  const toastId = toast.loading('アップロード中...', {
    description: `${file.name}`
  })

  try {
    await uploadFile(file)

    // 成功トーストに切り替え
    toast.dismiss(toastId)
    toast.success('アップロード完了')
  } catch (error) {
    // エラートーストに切り替え
    toast.dismiss(toastId)
    toast.error('アップロード失敗')
  }
}
```

### Promise-based 通知

```tsx
const handleAsyncOperation = () => {
  toast.promise(
    fetchData(),
    {
      loading: 'データを取得中...',
      success: 'データ取得完了',
      error: 'データ取得に失敗しました'
    }
  )
}
```

## メッセージ定数

メッセージは`/src/lib/constants/toast-messages.ts`で集中管理されています。

```tsx
import {
  IMAGE_SEARCH_MESSAGES,
  TEXT_SEARCH_MESSAGES,
  API_ERROR_MESSAGES,
  FILTER_MESSAGES,
  FILE_OPERATION_MESSAGES
} from '@/lib/constants/toast-messages'

// 使用例
toast.success(IMAGE_SEARCH_MESSAGES.UPLOAD_SUCCESS)
toast.error(TEXT_SEARCH_MESSAGES.SEARCH_ERROR)
```

## カスタマイズ

### グローバル設定

`/src/app/providers.tsx`でToasterコンポーネントの設定を変更できます。

```tsx
<Toaster
  position="top-right"        // 表示位置
  expand={false}              // 展開モード
  richColors                  // リッチカラー
  closeButton                 // 閉じるボタン表示
  duration={3000}             // デフォルト表示時間
  toastOptions={{
    style: {
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    },
    className: 'sonner-toast',
  }}
/>
```

### スタイリング

`/src/styles/globals.css`でカスタムスタイルを定義しています。

```css
/* 成功トースト */
[data-type='success'].sonner-toast {
  @apply bg-green-50 border-green-200 text-green-900;
}

/* ダークモード対応 */
.dark [data-type='success'].sonner-toast {
  @apply bg-green-900/30 border-green-800/50 text-green-100;
}
```

## アーキテクチャ

### ディレクトリ構造

```
frontend/
├── src/
│   ├── hooks/
│   │   ├── useToast.ts              # カスタムフック
│   │   └── useToast.test.ts         # ユニットテスト
│   ├── lib/
│   │   └── constants/
│   │       └── toast-messages.ts    # メッセージ定数
│   ├── app/
│   │   └── providers.tsx            # Toasterプロバイダー
│   └── styles/
│       └── globals.css              # カスタムスタイル
```

### フロー図

```
User Action
    ↓
Component (useToast hook)
    ↓
Toast Display (sonner)
    ↓
Auto-dismiss or Manual Close
```

## ベストプラクティス

### 1. 適切な通知タイプを選択

- **success**: 操作が成功したとき
- **error**: エラーが発生したとき（ユーザーが対処する必要がある）
- **warning**: 注意が必要な状況（例：検索結果0件）
- **info**: 中立的な情報提供

### 2. メッセージは簡潔に

```tsx
// ✅ Good
toast.success('保存しました')

// ❌ Bad
toast.success('データベースへの保存処理が正常に完了し、トランザクションがコミットされました')
```

### 3. 詳細はdescriptionに

```tsx
toast.error('検索に失敗しました', {
  description: 'OpenSearchへの接続がタイムアウトしました'
})
```

### 4. リトライ可能なエラーにはアクションボタンを追加

```tsx
if (error.retryable) {
  toast.error(error.message, {
    action: {
      label: '再試行',
      onClick: handleRetry
    }
  })
}
```

### 5. ローディング状態を適切に管理

```tsx
const toastId = toast.loading('処理中...')
try {
  await asyncOperation()
  toast.dismiss(toastId)
  toast.success('完了')
} catch (error) {
  toast.dismiss(toastId)
  toast.error('失敗')
}
```

## テスト

### ユニットテスト

```bash
yarn test useToast
```

### 手動テスト項目

- [ ] 検索クエリ入力なしで検索 → エラートースト表示
- [ ] 検索成功 → 成功トースト表示（件数表示）
- [ ] 検索結果0件 → 警告トースト表示
- [ ] 画像アップロード → ローディング → 成功トースト
- [ ] 無効な画像形式 → エラートースト表示
- [ ] ネットワークエラー → リトライボタン付きエラートースト

## トラブルシューティング

### トーストが表示されない

1. Toasterコンポーネントが`providers.tsx`に追加されているか確認
2. `sonner`パッケージがインストールされているか確認
3. ブラウザコンソールでエラーを確認

### スタイルが適用されない

1. `globals.css`のインポートが正しいか確認
2. Tailwind CSSのビルドが正常に完了しているか確認
3. ブラウザのキャッシュをクリア

### ダークモードで表示が崩れる

`globals.css`のダークモードスタイルを確認し、必要に応じて調整してください。

## 関連ファイル

- `/src/hooks/useToast.ts` - カスタムフック実装
- `/src/lib/constants/toast-messages.ts` - メッセージ定数
- `/src/app/providers.tsx` - グローバルプロバイダー設定
- `/src/styles/globals.css` - カスタムスタイル
- `/src/components/search/SearchInterface.tsx` - 実装例
- `/src/components/features/ImageUpload.tsx` - 実装例

## 今後の拡張予定

- [ ] 通知履歴の保存とレビュー機能
- [ ] カスタム通知アイコン
- [ ] 音声通知（オプション）
- [ ] 多言語対応（英語メッセージ）
- [ ] アクセシビリティ向上（ARIA属性追加）

## 参考資料

- [Sonner公式ドキュメント](https://sonner.emilkowal.ski/)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Tailwind CSS](https://tailwindcss.com/docs)
