/**
 * Unit Tests for Image Validation Utilities
 * 画像バリデーションユーティリティのユニットテスト
 *
 * Coverage Target: 100% (utility functions should be fully tested)
 */

import {
  isImageFile,
  isValidFileSize,
  validateImageFile,
  isValidVectorDimensions,
  validateVector,
  meetsConfidenceThreshold,
  filterByConfidence,
  getFileExtension,
  isImageExtension,
  isValidBase64,
  formatFileSize,
  ALLOWED_IMAGE_TYPES,
  MAX_FILE_SIZE,
  MIN_VECTOR_DIMENSIONS,
  MIN_CONFIDENCE_SCORE,
  type SearchResult,
} from './imageValidation';

/**
 * Mock File オブジェクト作成ヘルパー
 */
const createMockFile = (
  name: string,
  size: number,
  type: string,
  content?: string
): File => {
  // コンテンツが指定されていない場合、指定されたサイズのコンテンツを生成
  // 負のサイズの場合は空文字列、それ以外は指定サイズの文字列
  const fileContent = content !== undefined ? content : size > 0 ? 'a'.repeat(size) : '';
  const blob = new Blob([fileContent], { type });
  return new File([blob], name, { type });
};

describe('imageValidation', () => {
  describe('isImageFile', () => {
    it('should return true for JPEG files', () => {
      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      expect(isImageFile(file)).toBe(true);
    });

    it('should return true for PNG files', () => {
      const file = createMockFile('test.png', 1024, 'image/png');
      expect(isImageFile(file)).toBe(true);
    });

    it('should return true for JPG files', () => {
      const file = createMockFile('test.jpg', 1024, 'image/jpg');
      expect(isImageFile(file)).toBe(true);
    });

    it('should return false for non-image files', () => {
      const file = createMockFile('test.pdf', 1024, 'application/pdf');
      expect(isImageFile(file)).toBe(false);
    });

    it('should return false for GIF files (not supported)', () => {
      const file = createMockFile('test.gif', 1024, 'image/gif');
      expect(isImageFile(file)).toBe(false);
    });

    it('should return false for WebP files (not supported)', () => {
      const file = createMockFile('test.webp', 1024, 'image/webp');
      expect(isImageFile(file)).toBe(false);
    });
  });

  describe('isValidFileSize', () => {
    it('should return true for files within size limit', () => {
      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      expect(isValidFileSize(file)).toBe(true);
    });

    it('should return true for files at the maximum size limit', () => {
      const file = createMockFile('test.jpg', MAX_FILE_SIZE, 'image/jpeg');
      expect(isValidFileSize(file)).toBe(true);
    });

    it('should return false for files exceeding size limit', () => {
      const file = createMockFile('test.jpg', MAX_FILE_SIZE + 1, 'image/jpeg');
      expect(isValidFileSize(file)).toBe(false);
    });

    it('should return false for empty files', () => {
      const file = createMockFile('test.jpg', 0, 'image/jpeg', '');
      expect(isValidFileSize(file)).toBe(false);
    });

    it('should return false for negative file sizes', () => {
      const file = createMockFile('test.jpg', -1, 'image/jpeg');
      expect(isValidFileSize(file)).toBe(false);
    });
  });

  describe('validateImageFile', () => {
    it('should return valid for correct image files', () => {
      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const result = validateImageFile(file);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.errorCode).toBeUndefined();
    });

    it('should return error for missing file', () => {
      const result = validateImageFile(null as any);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('File is required');
      expect(result.errorCode).toBe('MISSING_FILE');
    });

    it('should return error for invalid file type', () => {
      const file = createMockFile('test.pdf', 1024, 'application/pdf');
      const result = validateImageFile(file);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Only');
      expect(result.errorCode).toBe('INVALID_FILE_TYPE');
    });

    it('should return error for files exceeding size limit', () => {
      const file = createMockFile('test.jpg', MAX_FILE_SIZE + 1, 'image/jpeg');
      const result = validateImageFile(file);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be less than');
      expect(result.errorCode).toBe('FILE_TOO_LARGE');
    });

    it('should return error for empty files', () => {
      const file = createMockFile('test.jpg', 0, 'image/jpeg', '');
      const result = validateImageFile(file);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('File is empty');
      expect(result.errorCode).toBe('EMPTY_FILE');
    });
  });

  describe('isValidVectorDimensions', () => {
    it('should return true for correct dimensions', () => {
      expect(isValidVectorDimensions(MIN_VECTOR_DIMENSIONS)).toBe(true);
    });

    it('should return false for incorrect dimensions', () => {
      expect(isValidVectorDimensions(512)).toBe(false);
      expect(isValidVectorDimensions(2048)).toBe(false);
      expect(isValidVectorDimensions(0)).toBe(false);
    });
  });

  describe('validateVector', () => {
    it('should return valid for correct vector', () => {
      const vector = new Array(MIN_VECTOR_DIMENSIONS).fill(0.5);
      const result = validateVector(vector);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error for non-array input', () => {
      const result = validateVector('not an array' as any);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Vector must be an array');
      expect(result.errorCode).toBe('INVALID_VECTOR_FORMAT');
    });

    it('should return error for empty vector', () => {
      const result = validateVector([]);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Vector is empty');
      expect(result.errorCode).toBe('EMPTY_VECTOR');
    });

    it('should return error for incorrect dimensions', () => {
      const vector = new Array(512).fill(0.5);
      const result = validateVector(vector);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('must have');
      expect(result.errorCode).toBe('INVALID_VECTOR_DIMENSIONS');
    });

    it('should return error for vector with invalid numbers', () => {
      const vector = new Array(MIN_VECTOR_DIMENSIONS).fill(0.5);
      vector[100] = NaN;
      const result = validateVector(vector);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Vector contains invalid numbers');
      expect(result.errorCode).toBe('INVALID_VECTOR_VALUES');
    });

    it('should return error for vector with Infinity', () => {
      const vector = new Array(MIN_VECTOR_DIMENSIONS).fill(0.5);
      vector[500] = Infinity;
      const result = validateVector(vector);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_VECTOR_VALUES');
    });

    it('should return error for vector with non-numeric values', () => {
      const vector = new Array(MIN_VECTOR_DIMENSIONS).fill(0.5);
      vector[200] = 'string' as any;
      const result = validateVector(vector);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_VECTOR_VALUES');
    });
  });

  describe('meetsConfidenceThreshold', () => {
    it('should return true for scores above threshold', () => {
      expect(meetsConfidenceThreshold(0.95)).toBe(true);
      expect(meetsConfidenceThreshold(1.0)).toBe(true);
    });

    it('should return true for scores at threshold', () => {
      expect(meetsConfidenceThreshold(MIN_CONFIDENCE_SCORE)).toBe(true);
    });

    it('should return false for scores below threshold', () => {
      expect(meetsConfidenceThreshold(0.89)).toBe(false);
      expect(meetsConfidenceThreshold(0.5)).toBe(false);
      expect(meetsConfidenceThreshold(0)).toBe(false);
    });
  });

  describe('filterByConfidence', () => {
    it('should filter results by confidence threshold', () => {
      const results: SearchResult[] = [
        { id: '1', score: 0.95 },
        { id: '2', score: 0.85 },
        { id: '3', score: 0.92 },
        { id: '4', score: 0.88 },
      ];

      const filtered = filterByConfidence(results);

      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe('1');
      expect(filtered[1].id).toBe('3');
    });

    it('should return empty array for no results', () => {
      const filtered = filterByConfidence([]);
      expect(filtered).toEqual([]);
    });

    it('should return all results if all meet threshold', () => {
      const results: SearchResult[] = [
        { id: '1', score: 0.95 },
        { id: '2', score: 0.91 },
        { id: '3', score: 0.92 },
      ];

      const filtered = filterByConfidence(results);
      expect(filtered).toHaveLength(3);
    });

    it('should return empty array if no results meet threshold', () => {
      const results: SearchResult[] = [
        { id: '1', score: 0.85 },
        { id: '2', score: 0.80 },
      ];

      const filtered = filterByConfidence(results);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('getFileExtension', () => {
    it('should extract file extension correctly', () => {
      expect(getFileExtension('image.jpg')).toBe('jpg');
      expect(getFileExtension('photo.PNG')).toBe('png');
      expect(getFileExtension('document.pdf')).toBe('pdf');
    });

    it('should handle files with multiple dots', () => {
      expect(getFileExtension('my.file.name.jpg')).toBe('jpg');
    });

    it('should return empty string for files without extension', () => {
      expect(getFileExtension('filename')).toBe('');
    });

    it('should handle empty strings', () => {
      expect(getFileExtension('')).toBe('');
    });
  });

  describe('isImageExtension', () => {
    it('should return true for image extensions', () => {
      expect(isImageExtension('photo.jpg')).toBe(true);
      expect(isImageExtension('image.jpeg')).toBe(true);
      expect(isImageExtension('picture.png')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isImageExtension('photo.JPG')).toBe(true);
      expect(isImageExtension('image.JPEG')).toBe(true);
      expect(isImageExtension('picture.PNG')).toBe(true);
    });

    it('should return false for non-image extensions', () => {
      expect(isImageExtension('document.pdf')).toBe(false);
      expect(isImageExtension('video.mp4')).toBe(false);
      expect(isImageExtension('file.txt')).toBe(false);
    });

    it('should return false for unsupported image formats', () => {
      expect(isImageExtension('image.gif')).toBe(false);
      expect(isImageExtension('photo.webp')).toBe(false);
    });
  });

  describe('isValidBase64', () => {
    it('should return true for valid Base64 strings', () => {
      expect(isValidBase64('SGVsbG8gV29ybGQ=')).toBe(true);
      expect(isValidBase64('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=')).toBe(true);
    });

    it('should handle Base64 strings without padding', () => {
      expect(isValidBase64('SGVsbG8')).toBe(true);
    });

    it('should return false for invalid Base64 strings', () => {
      expect(isValidBase64('Hello World!')).toBe(false);
      expect(isValidBase64('abc@#$%')).toBe(false);
    });

    it('should return false for empty strings', () => {
      expect(isValidBase64('')).toBe(false);
    });

    it('should return false for non-string inputs', () => {
      expect(isValidBase64(null as any)).toBe(false);
      expect(isValidBase64(undefined as any)).toBe(false);
      expect(isValidBase64(123 as any)).toBe(false);
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 Bytes');
      expect(formatFileSize(500)).toBe('500 Bytes');
    });

    it('should format kilobytes correctly', () => {
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(2048)).toBe('2 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('should format megabytes correctly', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1 MB');
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB');
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });

    it('should format gigabytes correctly', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
      expect(formatFileSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
    });
  });

  describe('Constants', () => {
    it('should have correct allowed image types', () => {
      expect(ALLOWED_IMAGE_TYPES).toEqual(['image/jpeg', 'image/png', 'image/jpg']);
    });

    it('should have correct max file size', () => {
      expect(MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
    });

    it('should have correct min vector dimensions', () => {
      expect(MIN_VECTOR_DIMENSIONS).toBe(1024);
    });

    it('should have correct min confidence score', () => {
      expect(MIN_CONFIDENCE_SCORE).toBe(0.9);
    });
  });
});
