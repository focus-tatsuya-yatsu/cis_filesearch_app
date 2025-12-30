/**
 * EmptyState Component - Unit Tests
 *
 * テスト対象:
 * - コンポーネントの基本レンダリング
 * - オプショナルプロパティのハンドリング
 * - アニメーション動作
 * - アクションボタンのインタラクション
 *
 * カバレッジ目標: 95%+
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './EmptyState';
import { Search, AlertCircle, FileX } from 'lucide-react';

// Framer Motionのモック
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...props }: any) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
  },
}));

describe('EmptyState Component', () => {
  describe('Rendering', () => {
    it('タイトルのみを表示できる', () => {
      render(<EmptyState title="検索結果がありません" />);

      expect(screen.getByText('検索結果がありません')).toBeInTheDocument();
    });

    it('タイトルとdescriptionを表示できる', () => {
      render(
        <EmptyState
          title="検索結果がありません"
          description="別のキーワードで検索してみてください"
        />
      );

      expect(screen.getByText('検索結果がありません')).toBeInTheDocument();
      expect(
        screen.getByText('別のキーワードで検索してみてください')
      ).toBeInTheDocument();
    });

    it('アイコンを表示できる', () => {
      render(
        <EmptyState
          icon={<Search data-testid="search-icon" className="h-16 w-16" />}
          title="検索結果がありません"
        />
      );

      expect(screen.getByTestId('search-icon')).toBeInTheDocument();
    });

    it('アクションボタンを表示できる', () => {
      const mockAction = jest.fn();

      render(
        <EmptyState
          title="エラーが発生しました"
          action={
            <button onClick={mockAction} data-testid="retry-button">
              再試行
            </button>
          }
        />
      );

      expect(screen.getByTestId('retry-button')).toBeInTheDocument();
    });

    it('すべてのプロパティを同時に表示できる', () => {
      const mockAction = jest.fn();

      render(
        <EmptyState
          icon={<FileX data-testid="file-icon" className="h-16 w-16" />}
          title="ファイルが見つかりません"
          description="指定されたファイルは存在しないか、削除された可能性があります"
          action={
            <button onClick={mockAction} data-testid="back-button">
              戻る
            </button>
          }
        />
      );

      expect(screen.getByTestId('file-icon')).toBeInTheDocument();
      expect(screen.getByText('ファイルが見つかりません')).toBeInTheDocument();
      expect(
        screen.getByText('指定されたファイルは存在しないか、削除された可能性があります')
      ).toBeInTheDocument();
      expect(screen.getByTestId('back-button')).toBeInTheDocument();
    });
  });

  describe('Optional Props', () => {
    it('descriptionが提供されていない場合、表示されない', () => {
      const { container } = render(<EmptyState title="エラー" />);

      // descriptionのpタグが存在しないことを確認
      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs.length).toBe(0);
    });

    it('iconが提供されていない場合、表示されない', () => {
      render(<EmptyState title="エラー" />);

      // アイコンコンテナが存在しないことを確認
      const iconContainer = screen.queryByTestId('icon-container');
      expect(iconContainer).not.toBeInTheDocument();
    });

    it('actionが提供されていない場合、表示されない', () => {
      const { container } = render(<EmptyState title="エラー" />);

      // アクションコンテナが存在しないことを確認
      const actionDivs = container.querySelectorAll('div > div > div');
      const hasActionContainer = Array.from(actionDivs).some((div) =>
        div.children.length > 0 && div.children[0].tagName === 'BUTTON'
      );
      expect(hasActionContainer).toBe(false);
    });
  });

  describe('Custom ClassName', () => {
    it('カスタムクラス名が適用される', () => {
      const { container } = render(
        <EmptyState title="テスト" className="custom-class bg-red-500" />
      );

      const emptyStateDiv = container.querySelector('.custom-class');
      expect(emptyStateDiv).toBeInTheDocument();
      expect(emptyStateDiv).toHaveClass('bg-red-500');
    });

    it('デフォルトクラスとカスタムクラスが両方適用される', () => {
      const { container } = render(
        <EmptyState title="テスト" className="my-custom-class" />
      );

      const emptyStateDiv = container.querySelector('.my-custom-class');
      expect(emptyStateDiv).toBeInTheDocument();
      expect(emptyStateDiv).toHaveClass('flex');
      expect(emptyStateDiv).toHaveClass('flex-col');
      expect(emptyStateDiv).toHaveClass('items-center');
      expect(emptyStateDiv).toHaveClass('justify-center');
    });
  });

  describe('User Interactions', () => {
    it('アクションボタンがクリック可能', async () => {
      const user = userEvent.setup();
      const mockAction = jest.fn();

      render(
        <EmptyState
          title="エラー"
          action={
            <button onClick={mockAction} data-testid="action-button">
              リトライ
            </button>
          }
        />
      );

      const actionButton = screen.getByTestId('action-button');
      await user.click(actionButton);

      expect(mockAction).toHaveBeenCalledTimes(1);
    });

    it('複数回のクリックが処理される', async () => {
      const user = userEvent.setup();
      const mockAction = jest.fn();

      render(
        <EmptyState
          title="エラー"
          action={
            <button onClick={mockAction} data-testid="action-button">
              リトライ
            </button>
          }
        />
      );

      const actionButton = screen.getByTestId('action-button');
      await user.click(actionButton);
      await user.click(actionButton);
      await user.click(actionButton);

      expect(mockAction).toHaveBeenCalledTimes(3);
    });
  });

  describe('Content Layout', () => {
    it('タイトルが見出しタグ(h3)でレンダリングされる', () => {
      render(<EmptyState title="検索結果なし" />);

      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('検索結果なし');
    });

    it('アイコン、タイトル、説明、アクションの順序が正しい', () => {
      const mockAction = jest.fn();

      const { container } = render(
        <EmptyState
          icon={<Search data-testid="icon" className="h-16 w-16" />}
          title="タイトル"
          description="説明文"
          action={<button data-testid="action">アクション</button>}
        />
      );

      const elements = container.querySelectorAll(
        '.flex > div, .flex > h3, .flex > p'
      );

      // 順序を確認（アイコン → タイトル → 説明 → アクション）
      const icon = screen.getByTestId('icon');
      const title = screen.getByText('タイトル');
      const description = screen.getByText('説明文');
      const action = screen.getByTestId('action');

      // compareDocumentPositionを使って順序を確認
      expect(
        icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        description.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });
  });

  describe('Styling', () => {
    it('タイトルに適切なスタイリングクラスが適用される', () => {
      render(<EmptyState title="テスト" />);

      const title = screen.getByText('テスト');
      expect(title).toHaveClass('text-xl');
      expect(title).toHaveClass('font-semibold');
      expect(title).toHaveClass('mb-2');
    });

    it('説明文に適切なスタイリングクラスが適用される', () => {
      render(<EmptyState title="テスト" description="説明" />);

      const description = screen.getByText('説明');
      expect(description).toHaveClass('text-center');
      expect(description).toHaveClass('max-w-md');
      expect(description).toHaveClass('mb-6');
    });

    it('アイコンコンテナに適切なスタイリングクラスが適用される', () => {
      const { container } = render(
        <EmptyState
          icon={<AlertCircle className="h-16 w-16" />}
          title="テスト"
        />
      );

      const iconContainer = container.querySelector('.mb-4');
      expect(iconContainer).toBeInTheDocument();
    });
  });

  describe('Real-World Scenarios', () => {
    it('検索結果0件の表示', () => {
      render(
        <EmptyState
          icon={<Search className="h-16 w-16" />}
          title="検索結果が見つかりませんでした"
          description="検索キーワードを変更してもう一度お試しください"
        />
      );

      expect(screen.getByText('検索結果が見つかりませんでした')).toBeInTheDocument();
      expect(
        screen.getByText('検索キーワードを変更してもう一度お試しください')
      ).toBeInTheDocument();
    });

    it('エラー状態の表示', () => {
      const handleRetry = jest.fn();

      render(
        <EmptyState
          icon={<AlertCircle className="h-16 w-16 text-red-500" />}
          title="エラーが発生しました"
          description="サーバーとの通信に失敗しました。しばらくしてから再度お試しください。"
          action={
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-blue-500 text-white rounded"
            >
              再試行
            </button>
          }
        />
      );

      expect(screen.getByText('エラーが発生しました')).toBeInTheDocument();
      expect(
        screen.getByText(
          'サーバーとの通信に失敗しました。しばらくしてから再度お試しください。'
        )
      ).toBeInTheDocument();
      expect(screen.getByText('再試行')).toBeInTheDocument();
    });

    it('ファイルが見つからない状態の表示', () => {
      render(
        <EmptyState
          icon={<FileX className="h-16 w-16" />}
          title="ファイルが見つかりません"
          description="指定されたファイルは存在しないか、アクセス権限がありません"
        />
      );

      expect(screen.getByText('ファイルが見つかりません')).toBeInTheDocument();
      expect(
        screen.getByText('指定されたファイルは存在しないか、アクセス権限がありません')
      ).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('タイトルが見出しとして認識される', () => {
      render(<EmptyState title="エラーメッセージ" />);

      const heading = screen.getByRole('heading', { name: 'エラーメッセージ' });
      expect(heading).toBeInTheDocument();
    });

    it('複雑なコンテンツでもアクセシビリティが保たれる', () => {
      const mockAction = jest.fn();

      render(
        <EmptyState
          icon={<Search aria-label="検索アイコン" className="h-16 w-16" />}
          title="検索結果なし"
          description="検索条件を変更してください"
          action={
            <button onClick={mockAction} aria-label="検索条件をリセット">
              リセット
            </button>
          }
        />
      );

      expect(screen.getByRole('heading', { name: '検索結果なし' })).toBeInTheDocument();
      expect(screen.getByLabelText('検索条件をリセット')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('空文字列のタイトルでも表示される', () => {
      render(<EmptyState title="" />);

      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('');
    });

    it('非常に長いタイトルが表示される', () => {
      const longTitle =
        'これは非常に長いタイトルです。これは非常に長いタイトルです。これは非常に長いタイトルです。';

      render(<EmptyState title={longTitle} />);

      expect(screen.getByText(longTitle)).toBeInTheDocument();
    });

    it('非常に長い説明文が表示される', () => {
      const longDescription =
        'これは非常に長い説明文です。'.repeat(20);

      render(<EmptyState title="テスト" description={longDescription} />);

      expect(screen.getByText(longDescription)).toBeInTheDocument();

      // max-w-mdクラスで幅が制限されることを確認
      const description = screen.getByText(longDescription);
      expect(description).toHaveClass('max-w-md');
    });

    it('複数のアクションボタンを含めることができる', () => {
      render(
        <EmptyState
          title="エラー"
          action={
            <div className="flex gap-2">
              <button data-testid="cancel">キャンセル</button>
              <button data-testid="retry">再試行</button>
            </div>
          }
        />
      );

      expect(screen.getByTestId('cancel')).toBeInTheDocument();
      expect(screen.getByTestId('retry')).toBeInTheDocument();
    });
  });
});
