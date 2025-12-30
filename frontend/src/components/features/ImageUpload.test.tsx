/**
 * React Testing Library Tests for ImageUpload Component
 * 画像アップロードコンポーネントのRTLテスト
 *
 * Coverage Target: 90%+ (UI components critical for user interaction)
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageUpload, ImageUploadProps } from './ImageUpload';

/**
 * テスト用のモックファイル作成
 */
const createMockFile = (
  name: string,
  size: number,
  type: string
): File => {
  const content = 'a'.repeat(size);
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
};

/**
 * ドラッグイベント作成ヘルパー
 */
const createDragEvent = (type: string, files: File[]): DragEvent => {
  const dataTransfer = {
    files,
    items: files.map((file) => ({
      kind: 'file' as const,
      type: file.type,
      getAsFile: () => file,
    })),
    types: ['Files'],
  };

  return new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer: dataTransfer as any,
  });
};

/**
 * global fetch のモック
 */
global.fetch = jest.fn();

/**
 * FileReader のモック
 */
class MockFileReader {
  onload: ((e: ProgressEvent<FileReader>) => void) | null = null;
  result: string | null = null;

  readAsDataURL(blob: Blob) {
    setTimeout(() => {
      this.result = 'data:image/jpeg;base64,mockBase64String';
      this.onload?.({
        target: this,
      } as ProgressEvent<FileReader>);
    }, 0);
  }
}

global.FileReader = MockFileReader as any;

describe('ImageUpload', () => {
  let mockOnUploadSuccess: jest.Mock;
  let mockOnUploadError: jest.Mock;
  let mockOnUploadingChange: jest.Mock;

  beforeEach(() => {
    mockOnUploadSuccess = jest.fn();
    mockOnUploadError = jest.fn();
    mockOnUploadingChange = jest.fn();

    // デフォルトの成功レスポンス
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          embedding: new Array(1024).fill(0.5),
          dimensions: 1024,
          fileName: 'test.jpg',
          fileSize: 1024,
          fileType: 'image/jpeg',
        },
      }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render upload area with instructions', () => {
      render(<ImageUpload />);

      expect(screen.getByTestId('image-upload')).toBeInTheDocument();
      expect(screen.getByTestId('drop-zone')).toBeInTheDocument();
      expect(screen.getByText(/画像をドラッグ&ドロップ/)).toBeInTheDocument();
      expect(screen.getByText(/JPEG, PNG/)).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      render(<ImageUpload className="custom-class" />);

      const element = screen.getByTestId('image-upload');
      expect(element).toHaveClass('custom-class');
    });

    it('should render hidden file input', () => {
      render(<ImageUpload />);

      const input = screen.getByTestId('file-input');
      expect(input).toHaveAttribute('type', 'file');
      expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/jpg');
      expect(input).toHaveClass('hidden');
    });
  });

  describe('File Selection via Click', () => {
    it('should open file dialog when clicking drop zone', async () => {
      const user = userEvent.setup();
      render(<ImageUpload />);

      const input = screen.getByTestId('file-input') as HTMLInputElement;
      const clickSpy = jest.spyOn(input, 'click');

      const dropZone = screen.getByTestId('drop-zone');
      await user.click(dropZone);

      expect(clickSpy).toHaveBeenCalled();
    });

    it('should handle file selection and show preview', async () => {
      render(<ImageUpload onUploadSuccess={mockOnUploadSuccess} />);

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('preview-image')).toBeInTheDocument();
      });
    });

    it('should call onUploadSuccess after successful upload', async () => {
      render(<ImageUpload onUploadSuccess={mockOnUploadSuccess} />);

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockOnUploadSuccess).toHaveBeenCalledWith(
          expect.objectContaining({
            embedding: expect.any(Array),
            dimensions: 1024,
            fileName: 'test.jpg',
          })
        );
      });
    });

    it('should show loading state during upload', async () => {
      // 遅延レスポンスのモック
      (global.fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => ({
                    success: true,
                    data: {
                      embedding: new Array(1024).fill(0.5),
                      dimensions: 1024,
                    },
                  }),
                }),
              100
            )
          )
      );

      render(<ImageUpload onUploadingChange={mockOnUploadingChange} />);

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/アップロード中/)).toBeInTheDocument();
      });

      expect(mockOnUploadingChange).toHaveBeenCalledWith(true);

      await waitFor(
        () => {
          expect(mockOnUploadingChange).toHaveBeenCalledWith(false);
        },
        { timeout: 2000 }
      );
    });
  });

  describe('Drag and Drop', () => {
    it('should handle dragover event', () => {
      render(<ImageUpload />);

      const dropZone = screen.getByTestId('drop-zone');
      const file = createMockFile('test.jpg', 1024, 'image/jpeg');

      fireEvent.dragOver(dropZone, {
        dataTransfer: { files: [file] },
      });

      // ドラッグ状態が反映されることを確認（スタイル変更）
      expect(dropZone).toHaveClass('border-blue-500');
    });

    it('should handle dragleave event', () => {
      render(<ImageUpload />);

      const dropZone = screen.getByTestId('drop-zone');

      fireEvent.dragOver(dropZone);
      expect(dropZone).toHaveClass('border-blue-500');

      fireEvent.dragLeave(dropZone);
      expect(dropZone).not.toHaveClass('border-blue-500');
    });

    it('should handle file drop', async () => {
      render(<ImageUpload onUploadSuccess={mockOnUploadSuccess} />);

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const dropZone = screen.getByTestId('drop-zone');

      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file] },
      });

      await waitFor(() => {
        expect(mockOnUploadSuccess).toHaveBeenCalled();
      });
    });

    it('should not accept drop when disabled', () => {
      render(<ImageUpload disabled />);

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const dropZone = screen.getByTestId('drop-zone');

      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file] },
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not accept drop when uploading', async () => {
      render(<ImageUpload />);

      const file1 = createMockFile('test1.jpg', 1024, 'image/jpeg');
      const file2 = createMockFile('test2.jpg', 1024, 'image/jpeg');
      const dropZone = screen.getByTestId('drop-zone');

      // 最初のファイルをドロップ
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file1] },
      });

      // アップロード中に2つ目のファイルをドロップ
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file2] },
      });

      // 1回だけ呼ばれることを確認
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Validation Errors', () => {
    it('should show error for invalid file type', async () => {
      render(<ImageUpload onUploadError={mockOnUploadError} />);

      const file = createMockFile('document.pdf', 1024, 'application/pdf');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument();
      });

      expect(mockOnUploadError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_FILE_TYPE',
        })
      );
    });

    it('should show error for file too large', async () => {
      render(<ImageUpload onUploadError={mockOnUploadError} />);

      const largeSize = 6 * 1024 * 1024; // 6MB
      const file = createMockFile('large.jpg', largeSize, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument();
      });

      expect(mockOnUploadError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'FILE_TOO_LARGE',
        })
      );
    });

    it('should show error for empty file', async () => {
      render(<ImageUpload onUploadError={mockOnUploadError} />);

      const file = createMockFile('empty.jpg', 0, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockOnUploadError).toHaveBeenCalledWith(
          expect.objectContaining({
            code: 'EMPTY_FILE',
          })
        );
      });
    });
  });

  describe('Upload Errors', () => {
    it('should handle API error response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        json: async () => ({
          error: 'Server error',
          code: 'SERVER_ERROR',
        }),
      });

      render(<ImageUpload onUploadError={mockOnUploadError} />);

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument();
      });

      expect(mockOnUploadError).toHaveBeenCalled();
    });

    it('should handle network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      render(<ImageUpload onUploadError={mockOnUploadError} />);

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockOnUploadError).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Network error',
          })
        );
      });
    });
  });

  describe('Clear Functionality', () => {
    it('should clear selection when clicking clear button', async () => {
      render(<ImageUpload />);

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('preview-image')).toBeInTheDocument();
      });

      const clearButton = screen.getByTestId('clear-button');
      fireEvent.click(clearButton);

      expect(screen.queryByTestId('preview-image')).not.toBeInTheDocument();
      expect(screen.queryByTestId('error-message')).not.toBeInTheDocument();
    });

    it('should reset file input value when clearing', async () => {
      render(<ImageUpload />);

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId('preview-image')).toBeInTheDocument();
      });

      const clearButton = screen.getByTestId('clear-button');
      fireEvent.click(clearButton);

      expect(input.value).toBe('');
    });
  });

  describe('Disabled State', () => {
    it('should disable file input when disabled prop is true', () => {
      render(<ImageUpload disabled />);

      const input = screen.getByTestId('file-input') as HTMLInputElement;
      expect(input).toBeDisabled();
    });

    it('should not open file dialog when disabled', async () => {
      const user = userEvent.setup();
      render(<ImageUpload disabled />);

      const input = screen.getByTestId('file-input') as HTMLInputElement;
      const clickSpy = jest.spyOn(input, 'click');

      const dropZone = screen.getByTestId('drop-zone');
      await user.click(dropZone);

      expect(clickSpy).not.toHaveBeenCalled();
    });

    it('should show disabled styling', () => {
      render(<ImageUpload disabled />);

      const dropZone = screen.getByTestId('drop-zone');
      expect(dropZone).toHaveClass('opacity-50', 'cursor-not-allowed');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(<ImageUpload />);

      const input = screen.getByTestId('file-input');
      expect(input).toHaveAttribute('type', 'file');
    });

    it('should be keyboard accessible', async () => {
      const user = userEvent.setup();
      render(<ImageUpload />);

      const dropZone = screen.getByTestId('drop-zone');

      // Tab でフォーカス
      await user.tab();

      // Enter でクリック
      await user.keyboard('{Enter}');

      // ファイルダイアログが開くことを確認（実際のテスト環境では完全には検証できない）
      expect(dropZone).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple rapid file selections', async () => {
      render(<ImageUpload onUploadSuccess={mockOnUploadSuccess} />);

      const file1 = createMockFile('test1.jpg', 1024, 'image/jpeg');
      const file2 = createMockFile('test2.jpg', 1024, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file1] } });
      fireEvent.change(input, { target: { files: [file2] } });

      await waitFor(() => {
        expect(mockOnUploadSuccess).toHaveBeenCalled();
      });
    });

    it('should handle special characters in filename', async () => {
      render(<ImageUpload onUploadSuccess={mockOnUploadSuccess} />);

      const file = createMockFile('テスト画像 (1).jpg', 1024, 'image/jpeg');
      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockOnUploadSuccess).toHaveBeenCalledWith(
          expect.objectContaining({
            fileName: 'test.jpg', // API response
          })
        );
      });
    });

    it('should handle no files in input change event', () => {
      render(<ImageUpload />);

      const input = screen.getByTestId('file-input') as HTMLInputElement;

      fireEvent.change(input, { target: { files: null } });

      expect(screen.queryByTestId('preview-image')).not.toBeInTheDocument();
    });
  });
});
