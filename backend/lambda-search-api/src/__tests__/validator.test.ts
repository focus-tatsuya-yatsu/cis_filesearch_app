/**
 * Validator Unit Tests
 */

import { validateSearchQuery, ValidationError } from '../utils/validator';

describe('validateSearchQuery', () => {
  test('正常なクエリパラメータをバリデーション', () => {
    const params = {
      q: '報告書',
      searchMode: 'or',
      page: '1',
      limit: '20',
      sortBy: 'relevance',
      sortOrder: 'desc',
    };

    const result = validateSearchQuery(params);

    expect(result).toEqual({
      query: '報告書',
      searchMode: 'or',
      fileType: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      size: 20,
      from: 0,
      sortBy: 'relevance',
      sortOrder: 'desc',
    });
  });

  test('クエリパラメータがない場合はエラー', () => {
    const params = {};

    expect(() => validateSearchQuery(params)).toThrow(ValidationError);
    expect(() => validateSearchQuery(params)).toThrow(
      'At least one search parameter is required'
    );
  });

  test('ページネーション範囲外の場合はエラー', () => {
    const params = {
      q: 'test',
      page: '1001',
    };

    expect(() => validateSearchQuery(params)).toThrow(ValidationError);
  });

  test('limit範囲外の場合はエラー', () => {
    const params = {
      q: 'test',
      limit: '101',
    };

    expect(() => validateSearchQuery(params)).toThrow(ValidationError);
  });

  test('無効なsearchModeの場合はエラー', () => {
    const params = {
      q: 'test',
      searchMode: 'invalid',
    };

    expect(() => validateSearchQuery(params)).toThrow(ValidationError);
  });

  test('無効な日付フォーマットの場合はエラー', () => {
    const params = {
      q: 'test',
      dateFrom: 'invalid-date',
    };

    expect(() => validateSearchQuery(params)).toThrow(ValidationError);
  });

  test('ファイルタイプフィルターが正常に適用される', () => {
    const params = {
      fileType: 'pdf',
      page: '1',
      limit: '20',
    };

    const result = validateSearchQuery(params);

    expect(result.fileType).toBe('pdf');
  });

  test('日付範囲フィルターが正常に適用される', () => {
    const params = {
      q: 'test',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
    };

    const result = validateSearchQuery(params);

    expect(result.dateFrom).toBe('2024-01-01');
    expect(result.dateTo).toBe('2024-12-31');
  });
});
