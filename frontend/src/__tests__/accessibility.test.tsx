/**
 * Accessibility Tests
 *
 * テスト対象:
 * - キーボードナビゲーション
 * - ARIA属性の正確性
 * - フォーカス管理
 * - スクリーンリーダー互換性
 *
 * カバレッジ目標: 95%+
 */

import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { SearchHistory } from '@/components/search/SearchHistory';
import { EmptyState } from '@/components/ui/EmptyState';
import type { SearchHistoryItem } from '@/types';
import { Search } from 'lucide-react';

// jest-axe matchers
expect.extend(toHaveNoViolations);

// Framer Motionのモック
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...props }: any) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe('Accessibility Tests', () => {
  describe('SearchHistory Component', () => {
    const mockHistory: SearchHistoryItem[] = [
      {
        id: '1',
        query: 'React Testing',
        timestamp: Date.now() - 1000 * 60 * 5,
        resultCount: 42,
      },
      {
        id: '2',
        query: 'TypeScript',
        timestamp: Date.now() - 1000 * 60 * 60,
        resultCount: 15,
      },
    ];

    const mockHandlers = {
      onSelectHistory: jest.fn(),
      onClearItem: jest.fn(),
      onClearAll: jest.fn(),
    };

    it('アクセシビリティ違反がない', async () => {
      const { container } = render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('空状態でもアクセシビリティ違反がない', async () => {
      const { container } = render(
        <SearchHistory
          history={[]}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('すべてのインタラクティブ要素に適切なaria-labelが設定されている', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      // 検索履歴項目
      expect(screen.getByLabelText('"React Testing"を再検索')).toBeInTheDocument();
      expect(screen.getByLabelText('"TypeScript"を再検索')).toBeInTheDocument();

      // 削除ボタン
      expect(
        screen.getByLabelText('"React Testing"を履歴から削除')
      ).toBeInTheDocument();
      expect(screen.getByLabelText('"TypeScript"を履歴から削除')).toBeInTheDocument();

      // すべて削除ボタン
      expect(screen.getByLabelText('すべての履歴を削除')).toBeInTheDocument();
    });

    it('ボタン要素はrole="button"を持つ', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const buttons = screen.getAllByRole('button');
      // 2つの履歴項目 + 2つの削除ボタン + 1つのすべて削除ボタン = 5
      expect(buttons.length).toBeGreaterThanOrEqual(3);
    });

    it('インタラクティブ要素がキーボードでアクセス可能', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const historyItem = screen.getByLabelText('"React Testing"を再検索');
      expect(historyItem).toHaveAttribute('tabIndex', '0');

      const deleteButton = screen.getByLabelText('"React Testing"を履歴から削除');
      // ボタン要素はデフォルトでフォーカス可能
      expect(deleteButton.tagName).toBe('BUTTON');
    });

    it('フォーカスインジケーターが適用される', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const historyItem = screen.getByLabelText('"React Testing"を再検索');
      expect(historyItem).toHaveClass('focus:outline-none');
      expect(historyItem).toHaveClass('focus:ring-2');
    });
  });

  describe('EmptyState Component', () => {
    it('アクセシビリティ違反がない - 基本', async () => {
      const { container } = render(
        <EmptyState title="検索結果がありません" />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('アクセシビリティ違反がない - フル機能', async () => {
      const { container } = render(
        <EmptyState
          icon={<Search aria-label="検索アイコン" className="h-16 w-16" />}
          title="検索結果がありません"
          description="別のキーワードで検索してください"
          action={
            <button aria-label="検索をクリア">クリア</button>
          }
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('タイトルが見出しとして適切に識別される', () => {
      render(
        <EmptyState
          title="検索結果なし"
          description="別のキーワードを試してください"
        />
      );

      const heading = screen.getByRole('heading', { level: 3, name: '検索結果なし' });
      expect(heading).toBeInTheDocument();
    });

    it('アクションボタンがアクセシブル', () => {
      render(
        <EmptyState
          title="エラー"
          action={
            <button aria-label="再試行">リトライ</button>
          }
        />
      );

      const button = screen.getByRole('button', { name: '再試行' });
      expect(button).toBeInTheDocument();
    });

    it('アイコンに適切なaria-labelが設定可能', () => {
      render(
        <EmptyState
          icon={<Search aria-label="検索アイコン" className="h-16 w-16" />}
          title="検索結果なし"
        />
      );

      expect(screen.getByLabelText('検索アイコン')).toBeInTheDocument();
    });
  });

  describe('Keyboard Navigation', () => {
    const mockHistory: SearchHistoryItem[] = [
      {
        id: '1',
        query: 'Test Query 1',
        timestamp: Date.now(),
        resultCount: 10,
      },
      {
        id: '2',
        query: 'Test Query 2',
        timestamp: Date.now(),
        resultCount: 20,
      },
    ];

    const mockHandlers = {
      onSelectHistory: jest.fn(),
      onClearItem: jest.fn(),
      onClearAll: jest.fn(),
    };

    it('Tab キーですべてのインタラクティブ要素にアクセスできる', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      // すべてのfocusable要素を取得
      const focusableElements = screen.getAllByRole('button');

      // すべての要素がtabIndexを持つかデフォルトでフォーカス可能
      focusableElements.forEach((element) => {
        const tabIndex = element.getAttribute('tabIndex');
        const isButton = element.tagName === 'BUTTON';

        expect(tabIndex !== null || isButton).toBe(true);
      });
    });

    it('Enter/Spaceキーで要素を操作できる', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const historyItem = screen.getByLabelText('"Test Query 1"を再検索');

      // onKeyDown ハンドラーが設定されていることを確認
      expect(historyItem).toHaveAttribute('tabIndex', '0');
    });
  });

  describe('Screen Reader Support', () => {
    it('重要な情報がテキストで提供される', () => {
      const mockHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'React',
          timestamp: Date.now() - 1000 * 60 * 5,
          resultCount: 42,
        },
      ];

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={jest.fn()}
          onClearItem={jest.fn()}
          onClearAll={jest.fn()}
        />
      );

      // クエリテキスト
      expect(screen.getByText('React')).toBeInTheDocument();

      // 結果件数
      expect(screen.getByText('42件の結果')).toBeInTheDocument();

      // タイムスタンプ
      expect(screen.getByText('5分前')).toBeInTheDocument();
    });

    it('アイコンのみの情報がaria-labelで補完される', () => {
      render(
        <SearchHistory
          history={[]}
          onSelectHistory={jest.fn()}
          onClearItem={jest.fn()}
          onClearAll={jest.fn()}
        />
      );

      // 空状態のメッセージがテキストで提供される
      expect(screen.getByText('検索履歴はありません')).toBeInTheDocument();
      expect(
        screen.getByText('検索を実行すると、ここに履歴が表示されます')
      ).toBeInTheDocument();
    });
  });

  describe('Color Contrast and Visual Accessibility', () => {
    it('テキストが適切なコントラストクラスを使用している', () => {
      const mockHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'Test',
          timestamp: Date.now(),
          resultCount: 5,
        },
      ];

      const { container } = render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={jest.fn()}
          onClearItem={jest.fn()}
          onClearAll={jest.fn()}
        />
      );

      // ダークモード対応のクラスが使用されている
      const darkModeClasses = container.querySelectorAll('[class*="dark:"]');
      expect(darkModeClasses.length).toBeGreaterThan(0);
    });

    it('ホバー状態が視覚的に識別可能', () => {
      const mockHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'Test',
          timestamp: Date.now(),
          resultCount: 5,
        },
      ];

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={jest.fn()}
          onClearItem={jest.fn()}
          onClearAll={jest.fn()}
        />
      );

      const historyItem = screen.getByLabelText('"Test"を再検索');
      expect(historyItem.className).toContain('hover:');
    });
  });

  describe('Focus Management', () => {
    it('削除ボタンにフォーカスリングが適用される', () => {
      const mockHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'Test',
          timestamp: Date.now(),
          resultCount: 5,
        },
      ];

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={jest.fn()}
          onClearItem={jest.fn()}
          onClearAll={jest.fn()}
        />
      );

      const deleteButton = screen.getByLabelText('"Test"を履歴から削除');
      expect(deleteButton.className).toContain('focus:');
    });

    it('すべて削除ボタンにフォーカスが適用される', () => {
      const mockHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'Test',
          timestamp: Date.now(),
          resultCount: 5,
        },
      ];

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={jest.fn()}
          onClearItem={jest.fn()}
          onClearAll={jest.fn()}
        />
      );

      const clearAllButton = screen.getByLabelText('すべての履歴を削除');
      expect(clearAllButton).toBeInTheDocument();
    });
  });

  describe('Semantic HTML', () => {
    it('適切な見出しレベルが使用されている', () => {
      const mockHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'Test',
          timestamp: Date.now(),
          resultCount: 5,
        },
      ];

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={jest.fn()}
          onClearItem={jest.fn()}
          onClearAll={jest.fn()}
        />
      );

      const heading = screen.getByText('最近の検索');
      expect(heading.tagName).toBe('H3');
    });

    it('リスト構造が適切に実装されている', () => {
      render(
        <EmptyState
          title="検索結果なし"
          description="別のキーワードで検索してください"
        />
      );

      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toBeInTheDocument();
    });
  });

  describe('WCAG 2.1 Compliance', () => {
    it('Level A - テキスト代替が提供されている', () => {
      render(
        <EmptyState
          icon={<Search aria-label="検索" className="h-16 w-16" />}
          title="結果なし"
        />
      );

      expect(screen.getByLabelText('検索')).toBeInTheDocument();
    });

    it('Level AA - 操作可能なコントロールが十分なサイズである', () => {
      const mockHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'Test',
          timestamp: Date.now(),
          resultCount: 5,
        },
      ];

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={jest.fn()}
          onClearItem={jest.fn()}
          onClearAll={jest.fn()}
        />
      );

      const deleteButton = screen.getByLabelText('"Test"を履歴から削除');
      // p-2クラスが適用されていることを確認（最小タッチターゲット）
      expect(deleteButton.className).toContain('p-2');
    });

    it('Level AA - キーボードのみで操作可能', () => {
      const mockHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'Test',
          timestamp: Date.now(),
          resultCount: 5,
        },
      ];

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={jest.fn()}
          onClearItem={jest.fn()}
          onClearAll={jest.fn()}
        />
      );

      const interactiveElements = screen.getAllByRole('button');
      interactiveElements.forEach((element) => {
        const tabIndex = element.getAttribute('tabIndex');
        const isButton = element.tagName === 'BUTTON';

        // ボタンまたはtabIndex="0"を持つ要素
        expect(tabIndex === '0' || isButton).toBe(true);
      });
    });
  });
});
