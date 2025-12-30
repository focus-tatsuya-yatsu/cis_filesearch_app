/**
 * Error Handler Unit Tests
 */

import {
  handleError,
  createSuccessResponse,
  OpenSearchError,
  OpenSearchIndexNotFoundError,
  OpenSearchUnavailableError,
} from '../utils/error-handler';
import { ValidationError } from '../utils/validator';

describe('Error Handler', () => {
  describe('handleError', () => {
    it('ValidationErrorを400エラーに変換する', () => {
      const error = new ValidationError('Invalid query', 'q', 'Query is empty');
      const response = handleError(error);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid query');
    });

    it('OpenSearchIndexNotFoundErrorを404エラーに変換する', () => {
      const error = new OpenSearchIndexNotFoundError('Index not found');
      const response = handleError(error);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INDEX_NOT_FOUND');
      expect(body.error.message).toContain('Index not found');
    });

    it('OpenSearchUnavailableErrorを503エラーに変換する', () => {
      const error = new OpenSearchUnavailableError('Service unavailable');
      const response = handleError(error);

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.message).toContain('Service unavailable');
    });

    it('OpenSearchErrorを適切なステータスコードで返す', () => {
      const error = new OpenSearchError('Search failed', 500);
      const response = handleError(error);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('OPENSEARCH_ERROR');
    });

    it('未知のエラーを500エラーに変換する', () => {
      const error = new Error('Unknown error');
      const response = handleError(error);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('Unknown error');
    });

    it('CORSヘッダーを含む', () => {
      const error = new Error('Test error');
      const response = handleError(error);

      expect(response.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Methods');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Headers');
    });

    it('Content-Typeヘッダーを含む', () => {
      const error = new Error('Test error');
      const response = handleError(error);

      expect(response.headers).toHaveProperty('Content-Type', 'application/json');
    });

    it('エラーレスポンスのボディ構造が正しい', () => {
      const error = new ValidationError('Test validation error', 'field', 'reason');
      const response = handleError(error);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('success', false);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });

  describe('createSuccessResponse', () => {
    it('成功レスポンスを正しく構築する', () => {
      const data = { message: 'Success', count: 10 };
      const response = createSuccessResponse(data);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual(data);
    });

    it('空のデータでも正しく動作する', () => {
      const response = createSuccessResponse({});

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({});
    });

    it('CORSヘッダーを含む', () => {
      const response = createSuccessResponse({});

      expect(response.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Methods');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Headers');
    });

    it('Content-Typeヘッダーを含む', () => {
      const response = createSuccessResponse({});

      expect(response.headers).toHaveProperty('Content-Type', 'application/json');
    });

    it('複雑なデータ構造を正しくシリアライズする', () => {
      const complexData = {
        results: [
          { id: 1, name: 'test1' },
          { id: 2, name: 'test2' },
        ],
        pagination: {
          total: 2,
          page: 1,
        },
      };

      const response = createSuccessResponse(complexData);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual(complexData);
    });
  });

  describe('Custom Error Classes', () => {
    it('OpenSearchErrorが正しくインスタンス化される', () => {
      const error = new OpenSearchError('Test error', 500);

      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('OpenSearchError');
    });

    it('OpenSearchIndexNotFoundErrorが正しくインスタンス化される', () => {
      const error = new OpenSearchIndexNotFoundError('Index not found');

      expect(error.message).toBe('Index not found');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('OpenSearchIndexNotFoundError');
    });

    it('OpenSearchUnavailableErrorが正しくインスタンス化される', () => {
      const error = new OpenSearchUnavailableError('Service down');

      expect(error.message).toBe('Service down');
      expect(error.statusCode).toBe(503);
      expect(error.name).toBe('OpenSearchUnavailableError');
    });
  });
});
