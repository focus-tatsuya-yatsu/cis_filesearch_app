# 画像検索UIコンポーネント - 使用ガイド

本番環境対応の画像検索UIコンポーネント実装ガイド

## 概要

このドキュメントでは、画像検索機能を実装するための4つのコンポーネントの使用方法を説明します。

## コンポーネント構成

### 1. ImageSearchContainer (メインコンテナ)
画像検索のメインコンテナコンポーネント。状態管理とビジネスロジックを担当。

### 2. ImageSearchDropdown (画像アップロード)
ドラッグ&ドロップ対応の画像アップロードUI。

### 3. ImageSearchResults (検索結果表示)
検索結果をグリッド表示し、類似度スコアとファイル情報を提供。

### 4. ImagePreviewModal (プレビューモーダル)
画像とファイル詳細情報を表示するフルスクリーンモーダル。

### 5. SearchProgress (進捗表示)
検索の進捗状況を視覚的に表示。

## 基本的な使用方法

### 最小限の実装

```tsx
import { ImageSearchContainer } from '@/components/features/ImageSearchContainer'

export const SearchPage = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">ファイル検索</h1>

      {/* 画像検索コンテナ */}
      <ImageSearchContainer />
    </div>
  )
}
```

### カスタマイズされた実装

```tsx
import { ImageSearchContainer } from '@/components/features/ImageSearchContainer'
import { useState } from 'react'

export const AdvancedSearchPage = () => {
  const [searchMode, setSearchMode] = useState<'text' | 'image'>('text')

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">
        {searchMode === 'text' ? 'テキスト検索' : '画像検索'}
      </h1>

      {/* カスタマイズされた画像検索 */}
      <ImageSearchContainer
        onSearchModeChange={(mode) => setSearchMode(mode)}
        initialOpen={false}
        confidenceThreshold={0.92} // 信頼度92%以上
      />
    </div>
  )
}
```

## Props詳細

### ImageSearchContainer

| Prop | Type | Default | 説明 |
|------|------|---------|------|
| `onSearchModeChange` | `(mode: 'text' \| 'image') => void` | - | 検索モード変更時のコールバック |
| `initialOpen` | `boolean` | `false` | 初期表示時にドロップダウンを開くか |
| `confidenceThreshold` | `number` | `0.9` | 類似度の閾値（0-1） |

### ImageSearchResults

| Prop | Type | Default | 説明 |
|------|------|---------|------|
| `results` | `SearchResult[]` | - | 検索結果の配列 |
| `isLoading` | `boolean` | `false` | ローディング状態 |
| `confidenceThreshold` | `number` | `0.9` | 表示する類似度の閾値 |

### ImagePreviewModal

| Prop | Type | Default | 説明 |
|------|------|---------|------|
| `file` | `SearchResult` | - | プレビューするファイル情報 |
| `isOpen` | `boolean` | - | モーダルの開閉状態 |
| `onClose` | `() => void` | - | モーダルを閉じる時のコールバック |

### SearchProgress

| Prop | Type | Default | 説明 |
|------|------|---------|------|
| `progress` | `number` | - | 進捗率（0-100） |
| `message` | `string` | - | カスタムステータスメッセージ（オプション） |
| `className` | `string` | `''` | カスタムクラス名 |

## 型定義

### SearchResult

```typescript
interface SearchResult {
  id: string
  fileName: string
  filePath: string
  fileType: string
  fileSize: number
  modifiedDate: string
  snippet: string
  relevanceScore: number // 0-1の類似度スコア
}
```

### ImageSearchState

```typescript
interface ImageSearchState {
  imageFile: File | null
  imagePreviewUrl: string | null
  isUploading: boolean
  embedding: number[] | null
  error: string | null
}
```

## 高度な使用例

### 検索モード切替機能

```tsx
import { useState } from 'react'
import { ImageSearchContainer } from '@/components/features/ImageSearchContainer'
import { SearchBar } from '@/components/search/SearchBar'

export const UnifiedSearchPage = () => {
  const [searchMode, setSearchMode] = useState<'text' | 'image'>('text')

  return (
    <div className="p-6">
      {/* モード切替タブ */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setSearchMode('text')}
          className={`px-4 py-2 rounded-lg ${
            searchMode === 'text'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700'
          }`}
        >
          テキスト検索
        </button>
        <button
          onClick={() => setSearchMode('image')}
          className={`px-4 py-2 rounded-lg ${
            searchMode === 'image'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700'
          }`}
        >
          画像検索
        </button>
      </div>

      {/* 検索インターフェース */}
      {searchMode === 'text' ? (
        <SearchBar />
      ) : (
        <ImageSearchContainer
          onSearchModeChange={setSearchMode}
          initialOpen={true}
        />
      )}
    </div>
  )
}
```

### カスタム信頼度閾値

```tsx
import { useState } from 'react'
import { ImageSearchContainer } from '@/components/features/ImageSearchContainer'

export const PreciseSearchPage = () => {
  const [threshold, setThreshold] = useState(0.9)

  return (
    <div className="p-6">
      {/* 閾値調整スライダー */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          類似度閾値: {Math.round(threshold * 100)}%
        </label>
        <input
          type="range"
          min="0.5"
          max="1"
          step="0.05"
          value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>

      <ImageSearchContainer
        confidenceThreshold={threshold}
        initialOpen={true}
      />
    </div>
  )
}
```

## スタイリング

### Tailwind CSS クラス

全てのコンポーネントはTailwind CSSを使用しています。カスタマイズは以下の方法で行えます：

```tsx
// カスタムクラスを追加
<SearchProgress
  progress={50}
  className="mt-8 shadow-xl"
/>
```

### ダークモード対応

全てのコンポーネントはダークモード対応しています。`dark:`プレフィックスを使用してカスタマイズ可能：

```tsx
<div className="bg-white dark:bg-gray-900">
  <ImageSearchContainer />
</div>
```

## アクセシビリティ

全てのコンポーネントはWCAG 2.1 AA基準に準拠：

- **ARIA labels**: 全てのインタラクティブ要素にラベルを付与
- **キーボード操作**: ESCキーでモーダルを閉じる
- **フォーカス管理**: 適切なフォーカストラップ
- **スクリーンリーダー対応**: role属性とaria-*属性

## パフォーマンス最適化

### 画像の最適化

- 最大ファイルサイズ: 5MB
- 対応フォーマット: JPEG, PNG
- 自動圧縮: アップロード時に自動実行

### レンダリング最適化

- Framer Motionによるスムーズなアニメーション
- 遅延ローディング: 結果は必要時のみレンダリング
- メモ化: 不要な再レンダリングを防止

## トラブルシューティング

### 画像がアップロードできない

1. ファイルサイズを確認（5MB以下）
2. ファイル形式を確認（JPEG/PNG）
3. ブラウザのコンソールでエラーメッセージを確認

### 検索結果が表示されない

1. APIエンドポイントが正しく設定されているか確認
2. OpenSearch接続を確認
3. 信頼度閾値を下げて再試行

### アニメーションが動作しない

1. Framer Motionがインストールされているか確認
2. `AnimatePresence`が正しく使用されているか確認

## テスト

### ユニットテスト

```bash
# 全てのテストを実行
yarn test

# 特定のコンポーネントのテストのみ実行
yarn test ImageSearchContainer.test.tsx
```

### E2Eテスト

```bash
# Playwright E2Eテスト
yarn test:e2e
```

## 今後の拡張予定

- [ ] S3 Preview API統合による実際の画像プレビュー
- [ ] 複数画像の一括アップロード
- [ ] 画像編集機能（トリミング、回転）
- [ ] 検索履歴の保存と復元
- [ ] エクスポート機能（CSV, JSON）

## 参考リンク

- [TypeScript Documentation](https://www.typescriptlang.org/)
- [Framer Motion](https://www.framer.com/motion/)
- [Tailwind CSS](https://tailwindcss.com/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
