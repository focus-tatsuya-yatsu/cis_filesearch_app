/**
 * 入力検証ユーティリティ
 * マジックナンバー検証、ファイル名サニタイズ、クエリサニタイズ
 */

import path from 'path';

/**
 * 検証結果の型定義
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: string;
}

/**
 * 画像マジックナンバー検証結果
 */
export interface ImageValidationResult extends ValidationResult {
  type?: string; // 'image/jpeg' | 'image/png'
}

/**
 * ファイルヘッダー（マジックナンバー）で画像タイプを検証
 * JPEG: FF D8 FF
 * PNG: 89 50 4E 47 0D 0A 1A 0A
 */
export async function verifyImageMagicNumber(buffer: Buffer): Promise<ImageValidationResult> {
  if (buffer.length < 12) {
    return {
      valid: false,
      error: 'File too small',
      errorCode: 'FILE_TOO_SMALL',
    };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { valid: true, type: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return { valid: true, type: 'image/png' };
  }

  // 認識できない形式
  const magicHex = buffer.slice(0, 8).toString('hex');
  return {
    valid: false,
    error: `Unsupported file type. Magic number: ${magicHex}`,
    errorCode: 'INVALID_MAGIC_NUMBER',
  };
}

/**
 * ファイル名の安全なサニタイズ
 * - パストラバーサル対策
 * - 危険な文字の除去
 * - 拡張子の検証
 */
export function sanitizeFileName(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') {
    return 'unnamed';
  }

  // ✅ パストラバーサル対策: ディレクトリ部分を除去
  const baseName = path.basename(fileName);

  // ✅ 危険な文字を除去
  // 許可: 英数字、ピリオド、ハイフン、アンダースコア、スペース（アンダースコアに変換）
  const sanitized = baseName
    .replace(/[^a-zA-Z0-9._-\s]/g, '_') // 危険な文字を _ に置換
    .replace(/\s+/g, '_') // スペースを _ に置換
    .replace(/\.{2,}/g, '.') // 連続するピリオドを1つに
    .replace(/^\.+/, '') // 先頭のピリオドを除去
    .substring(0, 255); // 最大長制限

  // ✅ 拡張子の検証
  const ext = path.extname(sanitized).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png'];

  if (!allowedExtensions.includes(ext)) {
    // 拡張子がない、または許可されていない場合
    return `unnamed_${Date.now()}.jpg`; // デフォルトファイル名
  }

  // ファイル名が空の場合
  if (sanitized.length === 0) {
    return `unnamed_${Date.now()}${ext}`;
  }

  return sanitized;
}

/**
 * 検索クエリのサニタイズ
 * - SQLインジェクション対策
 * - XSS対策
 * - 長さ制限
 */
export function sanitizeSearchQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    return '';
  }

  return query
    .replace(/[<>\"'`]/g, '') // XSS対策: タグ、クォート除去
    .replace(/[;{}[\]\\]/g, '') // インジェクション対策: 特殊文字除去
    .replace(/\s+/g, ' ') // 連続するスペースを1つに
    .trim()
    .substring(0, 500); // 最大長制限
}

/**
 * 検索モードのホワイトリスト検証
 */
export function validateSearchMode(mode: string): 'and' | 'or' {
  const allowedModes: ('and' | 'or')[] = ['and', 'or'];
  return allowedModes.includes(mode as any) ? (mode as 'and' | 'or') : 'or';
}

/**
 * ソートパラメータのホワイトリスト検証
 */
export function validateSortBy(sortBy: string): 'relevance' | 'date' | 'name' | 'size' {
  const allowedSortBy: ('relevance' | 'date' | 'name' | 'size')[] = [
    'relevance',
    'date',
    'name',
    'size',
  ];
  return allowedSortBy.includes(sortBy as any) ? (sortBy as any) : 'relevance';
}

/**
 * ソート順序のホワイトリスト検証
 */
export function validateSortOrder(sortOrder: string): 'asc' | 'desc' {
  const allowedSortOrder: ('asc' | 'desc')[] = ['asc', 'desc'];
  return allowedSortOrder.includes(sortOrder as any) ? (sortOrder as 'asc' | 'desc') : 'desc';
}

/**
 * ファイルタイプのホワイトリスト検証
 */
export function validateFileType(fileType: string): string | undefined {
  const allowedFileTypes = [
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'txt',
    'csv',
    'jpg',
    'jpeg',
    'png',
    'gif',
    'svg',
    'zip',
    'rar',
    'mp4',
    'avi',
    'all',
  ];

  const normalizedType = fileType.toLowerCase();
  return allowedFileTypes.includes(normalizedType) ? normalizedType : undefined;
}

/**
 * 日付形式の検証（ISO 8601）
 */
export function validateDate(dateString: string): string | undefined {
  if (!dateString) {
    return undefined;
  }

  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

/**
 * ページネーションパラメータの検証
 */
export function validatePagination(
  page: number,
  limit: number
): { page: number; limit: number } {
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100); // 最大100件

  return { page: safePage, limit: safeLimit };
}

/**
 * HTMLエスケープ（XSS対策）
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return text.replace(/[&<>"'/]/g, (char) => map[char]);
}

/**
 * 画像埋め込みベクトルの検証
 * - 配列チェック
 * - 次元数チェック（1024次元）
 * - 数値型チェック
 * - 範囲チェック（-1 ~ 1）
 * - ノルムチェック（||v|| ≈ 1）
 */
export function validateEmbeddingVector(vector: number[]): ValidationResult {
  // ✅ 1. 配列チェック
  if (!Array.isArray(vector)) {
    return {
      valid: false,
      error: 'Embedding must be an array',
      errorCode: 'INVALID_VECTOR_FORMAT',
    };
  }

  // ✅ 2. 次元数チェック（Titan Embeddings: 1024次元）
  if (vector.length !== 1024) {
    return {
      valid: false,
      error: `Invalid dimensions: expected 1024, got ${vector.length}`,
      errorCode: 'INVALID_VECTOR_DIMENSIONS',
    };
  }

  // ✅ 3. 数値型チェック
  const hasInvalidNumbers = vector.some((val) => typeof val !== 'number' || !isFinite(val));
  if (hasInvalidNumbers) {
    return {
      valid: false,
      error: 'Embedding contains non-finite numbers',
      errorCode: 'INVALID_VECTOR_VALUES',
    };
  }

  // ✅ 4. 範囲チェック（正規化済みベクトル: -1 ~ 1）
  const hasOutOfRange = vector.some((val) => val < -1 || val > 1);
  if (hasOutOfRange) {
    return {
      valid: false,
      error: 'Embedding values out of range [-1, 1]',
      errorCode: 'VECTOR_OUT_OF_RANGE',
    };
  }

  // ✅ 5. ノルムチェック（正規化済みベクトル: ||v|| ≈ 1）
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (Math.abs(norm - 1.0) > 0.1) {
    return {
      valid: false,
      error: `Embedding not normalized: ||v|| = ${norm.toFixed(4)}`,
      errorCode: 'VECTOR_NOT_NORMALIZED',
    };
  }

  return { valid: true };
}
