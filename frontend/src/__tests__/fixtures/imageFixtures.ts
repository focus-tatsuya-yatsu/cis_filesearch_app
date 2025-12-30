/**
 * Test Fixtures for Image Search Tests
 * 画像検索テスト用のフィクスチャ
 */

/**
 * モックファイル作成ヘルパー
 */
export const createMockFile = (
  name: string,
  size: number,
  type: string,
  content?: string
): File => {
  const fileContent = content || 'a'.repeat(size);
  const blob = new Blob([fileContent], { type });
  return new File([blob], name, { type });
};

/**
 * 有効な画像ファイルのフィクスチャ
 */
export const validImageFiles = {
  jpeg: {
    small: createMockFile('small.jpg', 1024, 'image/jpeg'),
    medium: createMockFile('medium.jpg', 100 * 1024, 'image/jpeg'),
    large: createMockFile('large.jpg', 4.5 * 1024 * 1024, 'image/jpeg'),
    maxSize: createMockFile('max-size.jpg', 5 * 1024 * 1024, 'image/jpeg'),
  },
  png: {
    small: createMockFile('small.png', 2048, 'image/png'),
    medium: createMockFile('medium.png', 200 * 1024, 'image/png'),
    large: createMockFile('large.png', 4 * 1024 * 1024, 'image/png'),
  },
  jpg: {
    small: createMockFile('small.jpg', 1024, 'image/jpg'),
  },
};

/**
 * 無効なファイルのフィクスチャ
 */
export const invalidFiles = {
  tooLarge: createMockFile('too-large.jpg', 6 * 1024 * 1024, 'image/jpeg'),
  empty: createMockFile('empty.jpg', 0, 'image/jpeg', ''),
  pdf: createMockFile('document.pdf', 1024, 'application/pdf'),
  gif: createMockFile('animated.gif', 1024, 'image/gif'),
  webp: createMockFile('modern.webp', 1024, 'image/webp'),
  svg: createMockFile('vector.svg', 1024, 'image/svg+xml'),
  text: createMockFile('text.txt', 1024, 'text/plain'),
};

/**
 * 特殊なファイル名のフィクスチャ
 */
export const specialFilenames = {
  japanese: createMockFile('テスト画像.jpg', 1024, 'image/jpeg'),
  withSpaces: createMockFile('test image file.jpg', 1024, 'image/jpeg'),
  withParentheses: createMockFile('image (1).jpg', 1024, 'image/jpeg'),
  longName: createMockFile(
    'very_long_filename_that_exceeds_normal_length_limits_for_testing_purposes.jpg',
    1024,
    'image/jpeg'
  ),
  specialChars: createMockFile('image-2024_test.jpg', 1024, 'image/jpeg'),
};

/**
 * モックベクトルデータ
 */
export const mockVectors = {
  valid1024: new Array(1024).fill(0.5),
  random1024: Array.from({ length: 1024 }, () => Math.random()),
  normalized1024: Array.from({ length: 1024 }, (_, i) =>
    Math.sin((i * Math.PI) / 512)
  ),
  invalid512: new Array(512).fill(0.5),
  invalid2048: new Array(2048).fill(0.5),
  withNaN: (() => {
    const vec = new Array(1024).fill(0.5);
    vec[500] = NaN;
    return vec;
  })(),
  withInfinity: (() => {
    const vec = new Array(1024).fill(0.5);
    vec[500] = Infinity;
    return vec;
  })(),
};

/**
 * モック検索結果
 */
export const mockSearchResults = {
  highConfidence: [
    {
      id: '1',
      fileName: 'report-2024.pdf',
      filePath: '/documents/reports/2024/report-2024.pdf',
      score: 0.95,
      fileSize: 2048000,
      modifiedAt: '2024-01-15T10:30:00Z',
      fileType: 'pdf',
    },
    {
      id: '2',
      fileName: 'chart.xlsx',
      filePath: '/documents/charts/chart.xlsx',
      score: 0.92,
      fileSize: 512000,
      modifiedAt: '2024-01-14T15:20:00Z',
      fileType: 'xlsx',
    },
    {
      id: '3',
      fileName: 'presentation.pptx',
      filePath: '/documents/presentations/presentation.pptx',
      score: 0.91,
      fileSize: 8192000,
      modifiedAt: '2024-01-13T09:15:00Z',
      fileType: 'pptx',
    },
  ],
  mixedConfidence: [
    {
      id: '1',
      fileName: 'high-match.pdf',
      filePath: '/documents/high-match.pdf',
      score: 0.95,
      fileSize: 1024000,
      modifiedAt: '2024-01-15T10:30:00Z',
      fileType: 'pdf',
    },
    {
      id: '2',
      fileName: 'medium-match.docx',
      filePath: '/documents/medium-match.docx',
      score: 0.85,
      fileSize: 512000,
      modifiedAt: '2024-01-14T15:20:00Z',
      fileType: 'docx',
    },
    {
      id: '3',
      fileName: 'low-match.txt',
      filePath: '/documents/low-match.txt',
      score: 0.75,
      fileSize: 10240,
      modifiedAt: '2024-01-13T09:15:00Z',
      fileType: 'txt',
    },
  ],
  empty: [],
  largeSet: Array.from({ length: 100 }, (_, i) => ({
    id: `${i + 1}`,
    fileName: `document-${i + 1}.pdf`,
    filePath: `/documents/batch/document-${i + 1}.pdf`,
    score: 0.9 + Math.random() * 0.1,
    fileSize: 1024000 + Math.floor(Math.random() * 5120000),
    modifiedAt: new Date(2024, 0, 1 + i).toISOString(),
    fileType: 'pdf',
  })),
};

/**
 * モックAPIレスポンス
 */
export const mockApiResponses = {
  embeddingSuccess: {
    success: true,
    data: {
      embedding: mockVectors.valid1024,
      dimensions: 1024,
      fileName: 'test.jpg',
      fileSize: 1024,
      fileType: 'image/jpeg',
    },
  },
  embeddingError: {
    error: 'Failed to generate embedding',
    code: 'BEDROCK_ERROR',
    message: 'AWS Bedrock service unavailable',
  },
  searchSuccess: {
    success: true,
    data: {
      results: mockSearchResults.highConfidence,
      total: mockSearchResults.highConfidence.length,
      searchMode: 'image',
    },
  },
  searchEmpty: {
    success: true,
    data: {
      results: [],
      total: 0,
      searchMode: 'image',
    },
  },
  searchError: {
    error: 'Search failed',
    code: 'SEARCH_ERROR',
    message: 'OpenSearch query failed',
  },
  validationError: {
    error: 'Invalid file type',
    code: 'INVALID_FILE_TYPE',
  },
};

/**
 * Base64エンコードされたテスト画像データ
 */
export const base64Images = {
  // 1x1 JPEG (最小)
  minimalJpeg:
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',

  // 1x1 PNG (最小)
  minimalPng:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',

  // 不正なBase64文字列
  invalid: 'This is not a valid base64 string!@#$%',
};

/**
 * テスト用のタイムアウト設定
 */
export const testTimeouts = {
  upload: 10000, // 10秒
  search: 15000, // 15秒
  render: 5000, // 5秒
};

/**
 * テスト用のエラーメッセージ
 */
export const errorMessages = {
  missingFile: 'File is required',
  invalidFileType: 'Only image/jpeg, image/png, image/jpg images are supported',
  fileTooLarge: 'File size must be less than 5MB',
  emptyFile: 'File is empty',
  invalidVector: 'Vector must have 1024 dimensions',
  networkError: 'Network error',
  bedrockError: 'AWS Bedrock service error',
  searchError: 'Search failed',
};

/**
 * モックドラッグイベント作成ヘルパー
 */
export const createMockDragEvent = (
  type: string,
  files: File[]
): DragEvent => {
  const dataTransfer = new DataTransfer();
  files.forEach((file) => dataTransfer.items.add(file));

  return new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer,
  });
};

/**
 * モックFileReaderクラス
 */
export class MockFileReader {
  onload: ((e: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((e: ProgressEvent<FileReader>) => void) | null = null;
  result: string | ArrayBuffer | null = null;
  readyState: number = 0;

  readAsDataURL(blob: Blob): void {
    this.readyState = 1;
    setTimeout(() => {
      this.readyState = 2;
      this.result = `data:${blob.type};base64,${base64Images.minimalJpeg}`;
      this.onload?.({
        target: this,
      } as ProgressEvent<FileReader>);
    }, 0);
  }

  readAsArrayBuffer(blob: Blob): void {
    this.readyState = 1;
    setTimeout(() => {
      this.readyState = 2;
      this.result = new ArrayBuffer(blob.size);
      this.onload?.({
        target: this,
      } as ProgressEvent<FileReader>);
    }, 0);
  }
}
