/**
 * SearchHistory Component - Unit Tests
 *
 * テスト対象:
 * - HTMLボタンネストエラー修正後の動作確認
 * - アクセシビリティ（role, tabIndex, キーボード操作）
 * - 検索履歴の表示・削除・全削除機能
 * - アニメーション動作
 *
 * カバレッジ目標: 90%+
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchHistory } from './SearchHistory';
import type { SearchHistoryItem } from '@/types';

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

describe('SearchHistory Component', () => {
  // テストデータ
  const mockHistory: SearchHistoryItem[] = [
    {
      id: '1',
      query: 'React Testing',
      timestamp: Date.now() - 1000 * 60 * 5, // 5分前
      resultCount: 42,
    },
    {
      id: '2',
      query: 'TypeScript Best Practices',
      timestamp: Date.now() - 1000 * 60 * 60 * 2, // 2時間前
      resultCount: 15,
    },
    {
      id: '3',
      query: 'Next.js App Router',
      timestamp: Date.now() - 1000 * 60 * 60 * 24, // 1日前
      resultCount: 8,
    },
  ];

  const mockHandlers = {
    onSelectHistory: jest.fn(),
    onClearItem: jest.fn(),
    onClearAll: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('空の履歴の場合、空状態メッセージが表示される', () => {
      render(
        <SearchHistory
          history={[]}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.getByText('検索履歴はありません')).toBeInTheDocument();
      expect(
        screen.getByText('検索を実行すると、ここに履歴が表示されます')
      ).toBeInTheDocument();
    });

    it('履歴がある場合、全ての検索クエリが表示される', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.getByText('React Testing')).toBeInTheDocument();
      expect(screen.getByText('TypeScript Best Practices')).toBeInTheDocument();
      expect(screen.getByText('Next.js App Router')).toBeInTheDocument();
    });

    it('結果件数が表示される', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.getByText('42件の結果')).toBeInTheDocument();
      expect(screen.getByText('15件の結果')).toBeInTheDocument();
      expect(screen.getByText('8件の結果')).toBeInTheDocument();
    });

    it('履歴の件数が表示される', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.getByText('(3)')).toBeInTheDocument();
    });

    it('「すべて削除」ボタンが表示される', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.getByText('すべて削除')).toBeInTheDocument();
    });
  });

  describe('Timestamp Formatting', () => {
    it('1分未満の場合「たった今」と表示される', () => {
      const recentHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'Recent Search',
          timestamp: Date.now() - 1000 * 30, // 30秒前
          resultCount: 5,
        },
      ];

      render(
        <SearchHistory
          history={recentHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.getByText('たった今')).toBeInTheDocument();
    });

    it('5分前の場合「5分前」と表示される', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.getByText('5分前')).toBeInTheDocument();
    });

    it('2時間前の場合「2時間前」と表示される', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.getByText('2時間前')).toBeInTheDocument();
    });

    it('1日前の場合「1日前」と表示される', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.getByText('1日前')).toBeInTheDocument();
    });

    it('7日以上前の場合は日付形式で表示される', () => {
      const oldHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'Old Search',
          timestamp: Date.now() - 1000 * 60 * 60 * 24 * 10, // 10日前
          resultCount: 3,
        },
      ];

      render(
        <SearchHistory
          history={oldHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      // 日本語の日付形式が表示されることを確認（例: "12月7日"）
      const dateElement = screen.getByText(/\d+月\d+日/);
      expect(dateElement).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('検索履歴項目をクリックすると、onSelectHistoryが呼ばれる', async () => {
      const user = userEvent.setup();

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const historyItem = screen.getByText('React Testing');
      await user.click(historyItem);

      expect(mockHandlers.onSelectHistory).toHaveBeenCalledTimes(1);
      expect(mockHandlers.onSelectHistory).toHaveBeenCalledWith('React Testing');
    });

    it('削除ボタンをクリックすると、onClearItemが呼ばれる', async () => {
      const user = userEvent.setup();

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      // aria-labelを使って削除ボタンを特定
      const deleteButton = screen.getByLabelText('"React Testing"を履歴から削除');
      await user.click(deleteButton);

      expect(mockHandlers.onClearItem).toHaveBeenCalledTimes(1);
      expect(mockHandlers.onClearItem).toHaveBeenCalledWith('1');
    });

    it('削除ボタンクリック時に、onSelectHistoryは呼ばれない（イベント伝播の停止）', async () => {
      const user = userEvent.setup();

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const deleteButton = screen.getByLabelText('"React Testing"を履歴から削除');
      await user.click(deleteButton);

      expect(mockHandlers.onSelectHistory).not.toHaveBeenCalled();
      expect(mockHandlers.onClearItem).toHaveBeenCalledTimes(1);
    });

    it('「すべて削除」ボタンをクリックすると、onClearAllが呼ばれる', async () => {
      const user = userEvent.setup();

      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const clearAllButton = screen.getByLabelText('すべての履歴を削除');
      await user.click(clearAllButton);

      expect(mockHandlers.onClearAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility - Keyboard Navigation', () => {
    it('検索履歴項目はrole="button"とtabIndex=0を持つ', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const historyItems = screen.getAllByRole('button', {
        name: /を再検索/,
      });

      expect(historyItems.length).toBe(3);
      historyItems.forEach((item) => {
        expect(item).toHaveAttribute('tabIndex', '0');
      });
    });

    it('Enterキーで検索履歴を選択できる', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const historyItem = screen.getByRole('button', {
        name: '"React Testing"を再検索',
      });

      fireEvent.keyDown(historyItem, { key: 'Enter', code: 'Enter' });

      expect(mockHandlers.onSelectHistory).toHaveBeenCalledTimes(1);
      expect(mockHandlers.onSelectHistory).toHaveBeenCalledWith('React Testing');
    });

    it('Spaceキーで検索履歴を選択できる', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const historyItem = screen.getByRole('button', {
        name: '"React Testing"を再検索',
      });

      const keyDownEvent = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
      });

      Object.defineProperty(keyDownEvent, 'preventDefault', {
        value: jest.fn(),
      });

      fireEvent(historyItem, keyDownEvent);

      expect(mockHandlers.onSelectHistory).toHaveBeenCalledTimes(1);
    });

    it('適切なaria-labelが設定されている', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.getByLabelText('"React Testing"を再検索')).toBeInTheDocument();
      expect(
        screen.getByLabelText('"React Testing"を履歴から削除')
      ).toBeInTheDocument();
      expect(screen.getByLabelText('すべての履歴を削除')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('resultCountがundefinedの場合、結果件数は表示されない', () => {
      const historyWithoutCount: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'Test Query',
          timestamp: Date.now(),
        },
      ];

      render(
        <SearchHistory
          history={historyWithoutCount}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      expect(screen.queryByText(/件の結果/)).not.toBeInTheDocument();
    });

    it('長いクエリ文字列が適切に表示される', () => {
      const longQueryHistory: SearchHistoryItem[] = [
        {
          id: '1',
          query: 'This is a very long search query that should be truncated properly in the UI to prevent layout issues',
          timestamp: Date.now(),
          resultCount: 10,
        },
      ];

      render(
        <SearchHistory
          history={longQueryHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const queryElement = screen.getByText(longQueryHistory[0].query);
      expect(queryElement).toBeInTheDocument();
      // truncateクラスが適用されていることを確認
      expect(queryElement).toHaveClass('truncate');
    });

    it('履歴が10件以上ある場合、スクロール可能になる', () => {
      const manyHistory: SearchHistoryItem[] = Array.from({ length: 15 }, (_, i) => ({
        id: String(i),
        query: `Search Query ${i}`,
        timestamp: Date.now() - i * 1000 * 60,
        resultCount: i,
      }));

      const { container } = render(
        <SearchHistory
          history={manyHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const scrollContainer = container.querySelector('.max-h-\\[400px\\]');
      expect(scrollContainer).toBeInTheDocument();
      expect(scrollContainer).toHaveClass('overflow-y-auto');
    });
  });

  describe('No Button Nesting Validation', () => {
    it('削除ボタンは通常のbuttonタグである（ボタン内ボタンネストを回避）', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const deleteButton = screen.getByLabelText('"React Testing"を履歴から削除');

      // buttonタグであることを確認
      expect(deleteButton.tagName).toBe('BUTTON');

      // 親要素がbuttonでないことを確認（ボタンネスト回避）
      const parent = deleteButton.parentElement;
      expect(parent?.tagName).not.toBe('BUTTON');
    });

    it('クリック可能な履歴項目はdiv要素である（role="button"を使用）', () => {
      render(
        <SearchHistory
          history={mockHistory}
          onSelectHistory={mockHandlers.onSelectHistory}
          onClearItem={mockHandlers.onClearItem}
          onClearAll={mockHandlers.onClearAll}
        />
      );

      const historyItem = screen.getByRole('button', {
        name: '"React Testing"を再検索',
      });

      // divタグであることを確認（buttonタグではない）
      expect(historyItem.tagName).toBe('DIV');
      expect(historyItem).toHaveAttribute('role', 'button');
    });
  });
});
