/**
 * Unit tests for safe-json utilities
 * Tests circular reference handling and AWS SDK error serialization
 */

import {
  serializeError,
  createCircularReplacer,
  safeStringify,
  safeParse,
} from '../safe-json';

describe('safe-json utilities', () => {
  describe('serializeError', () => {
    it('should serialize standard Error objects', () => {
      const error = new Error('Test error');
      const serialized = serializeError(error);

      expect(serialized.name).toBe('Error');
      expect(serialized.message).toBe('Test error');
      expect(serialized.stack).toBeDefined();
    });

    it('should serialize custom error properties', () => {
      const error = new Error('Custom error') as Error & {
        code: string;
        statusCode: number;
      };
      error.code = 'ERR_CUSTOM';
      error.statusCode = 500;

      const serialized = serializeError(error);

      expect(serialized.code).toBe('ERR_CUSTOM');
      expect(serialized.statusCode).toBe(500);
    });

    it('should handle AWS SDK error objects', () => {
      // Simulate AWS SDK error structure
      const awsError = new Error('Access Denied') as Error & {
        Code: string;
        StatusCode: number;
        RequestId: string;
        $metadata?: Record<string, unknown>;
      };
      awsError.name = 'AccessDenied';
      awsError.Code = 'AccessDenied';
      awsError.StatusCode = 403;
      awsError.RequestId = 'abc-123-xyz';
      awsError.$metadata = {
        httpStatusCode: 403,
        requestId: 'abc-123-xyz',
        attempts: 1,
      };

      const serialized = serializeError(awsError);

      expect(serialized.name).toBe('AccessDenied');
      expect(serialized.message).toBe('Access Denied');
      expect(serialized.code).toBe('AccessDenied');
      expect(serialized.statusCode).toBe(403);
      expect(serialized.requestId).toBe('abc-123-xyz');
      expect(serialized.$metadata).toBeDefined();
    });

    it('should handle non-Error objects', () => {
      const serialized = serializeError('string error');

      expect(serialized.name).toBe('UnknownError');
      expect(serialized.message).toBe('string error');
    });

    it('should skip unserializable properties', () => {
      const error = new Error('Test') as Error & {
        socket?: unknown;
        goodProperty: string;
      };

      // Add a circular reference (socket-like object)
      const fakeSocket = {
        constructor: { name: 'Socket' },
        data: 'some data',
      };
      error.socket = fakeSocket;
      error.goodProperty = 'safe value';

      const serialized = serializeError(error);

      expect(serialized.goodProperty).toBe('safe value');
      expect(serialized.socket).toBeUndefined();
    });

    it('should handle errors with circular references in custom properties', () => {
      const error = new Error('Test') as Error & {
        data?: Record<string, unknown>;
      };

      const circularObj: Record<string, unknown> = { value: 'test' };
      circularObj.self = circularObj;
      error.data = circularObj;

      const serialized = serializeError(error);

      // Should not throw, and data should be marked as unserializable
      expect(serialized).toBeDefined();
      expect(serialized.name).toBe('Error');
    });
  });

  describe('createCircularReplacer', () => {
    it('should handle circular references', () => {
      const obj: Record<string, unknown> = { name: 'test' };
      obj.self = obj;

      const replacer = createCircularReplacer();
      const result = JSON.stringify(obj, replacer);

      expect(result).toContain('"name":"test"');
      expect(result).toContain('[Circular]');
    });

    it('should handle nested circular references', () => {
      const obj: Record<string, unknown> = { a: { b: { c: {} } } };
      (obj.a as Record<string, unknown>).b as Record<string, unknown>;
      ((obj.a as Record<string, unknown>).b as Record<string, unknown>).c = obj;

      const replacer = createCircularReplacer();
      const result = JSON.stringify(obj, replacer);

      expect(result).toContain('[Circular]');
    });

    it('should serialize Error objects automatically', () => {
      const obj = {
        error: new Error('Test error'),
        message: 'Something went wrong',
      };

      const replacer = createCircularReplacer();
      const result = JSON.stringify(obj, replacer);
      const parsed = JSON.parse(result);

      expect(parsed.error.name).toBe('Error');
      expect(parsed.error.message).toBe('Test error');
      expect(parsed.message).toBe('Something went wrong');
    });

    it('should handle arrays', () => {
      const arr = [1, 2, { value: 3 }];
      const replacer = createCircularReplacer();
      const result = JSON.stringify(arr, replacer);

      expect(result).toBe('[1,2,{"value":3}]');
    });

    it('should mark complex objects appropriately', () => {
      const obj = {
        normal: 'value',
        socket: {
          constructor: { name: 'Socket' },
          data: 'test',
        },
      };

      const replacer = createCircularReplacer();
      const result = JSON.stringify(obj, replacer);

      expect(result).toContain('"normal":"value"');
      expect(result).toContain('[Socket]');
    });
  });

  describe('safeStringify', () => {
    it('should stringify normal objects', () => {
      const obj = { name: 'John', age: 30 };
      const result = safeStringify(obj);

      expect(result).toBe('{"name":"John","age":30}');
    });

    it('should handle circular references without throwing', () => {
      const obj: Record<string, unknown> = { name: 'test' };
      obj.self = obj;

      const result = safeStringify(obj);

      expect(result).toContain('"name":"test"');
      expect(result).toContain('[Circular]');
    });

    it('should support pretty-printing', () => {
      const obj = { a: 1, b: 2 };
      const result = safeStringify(obj, 2);

      expect(result).toContain('  "a": 1');
      expect(result).toContain('  "b": 2');
    });

    it('should handle errors in stringification', () => {
      // Create an object with a property that throws when accessed
      const obj = {};
      Object.defineProperty(obj, 'badProp', {
        get() {
          throw new Error('Cannot access');
        },
        enumerable: true,
      });

      const result = safeStringify(obj);

      // Should not throw, returns error message
      expect(result).toContain('Stringification Error');
    });

    it('should handle AWS SDK-like error objects', () => {
      const awsError = new Error('S3 Error') as Error & {
        Code: string;
        RequestId: string;
      };
      awsError.Code = 'NoSuchKey';
      awsError.RequestId = 'xyz-789';

      const obj = {
        operation: 'getObject',
        error: awsError,
      };

      const result = safeStringify(obj);
      const parsed = JSON.parse(result);

      expect(parsed.operation).toBe('getObject');
      expect(parsed.error.name).toBe('Error');
      expect(parsed.error.message).toBe('S3 Error');
      expect(parsed.error.code).toBe('NoSuchKey');
      expect(parsed.error.requestId).toBe('xyz-789');
    });
  });

  describe('safeParse', () => {
    it('should parse valid JSON', () => {
      const json = '{"name":"John","age":30}';
      const result = safeParse(json, {});

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should return fallback for invalid JSON', () => {
      const invalidJson = '{invalid json}';
      const fallback = { default: true };
      const result = safeParse(invalidJson, fallback);

      expect(result).toEqual(fallback);
    });

    it('should handle empty string', () => {
      const result = safeParse('', { empty: true });

      expect(result).toEqual({ empty: true });
    });

    it('should preserve type information with generics', () => {
      interface User {
        name: string;
        age: number;
      }

      const json = '{"name":"Alice","age":25}';
      const fallback: User = { name: 'Unknown', age: 0 };
      const result = safeParse<User>(json, fallback);

      expect(result.name).toBe('Alice');
      expect(result.age).toBe(25);
    });
  });

  describe('Performance tests', () => {
    it('should handle large objects efficiently', () => {
      const largeObj = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          data: { value: i * 2 },
        })),
      };

      const startTime = performance.now();
      const result = safeStringify(largeObj);
      const endTime = performance.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(100); // Should complete in <100ms
    });

    it('should handle deeply nested objects', () => {
      let deepObj: Record<string, unknown> = { value: 'deep' };
      for (let i = 0; i < 50; i++) {
        deepObj = { nested: deepObj };
      }

      const result = safeStringify(deepObj);

      expect(result).toBeDefined();
      expect(result).toContain('"value":"deep"');
    });
  });

  describe('Real-world AWS SDK scenarios', () => {
    it('should handle S3 GetObject errors', () => {
      // Simulate real AWS S3 error
      const s3Error = new Error('The specified key does not exist.') as Error & {
        Code: string;
        name: string;
        $metadata?: {
          httpStatusCode: number;
          requestId: string;
          cfId?: string;
          attempts: number;
          totalRetryDelay: number;
        };
      };
      s3Error.name = 'NoSuchKey';
      s3Error.Code = 'NoSuchKey';
      s3Error.$metadata = {
        httpStatusCode: 404,
        requestId: 'REQ123',
        attempts: 1,
        totalRetryDelay: 0,
      };

      const serialized = serializeError(s3Error);

      expect(serialized.name).toBe('NoSuchKey');
      expect(serialized.message).toBe('The specified key does not exist.');
      expect(serialized.code).toBe('NoSuchKey');
      expect(serialized.$metadata).toBeDefined();
      expect((serialized.$metadata as { httpStatusCode: number }).httpStatusCode).toBe(404);
    });

    it('should handle network errors with sockets', () => {
      const networkError = new Error('ECONNREFUSED') as Error & {
        code: string;
        errno: number;
        syscall: string;
        socket?: unknown;
      };
      networkError.code = 'ECONNREFUSED';
      networkError.errno = -61;
      networkError.syscall = 'connect';

      // Simulate socket object (this would normally cause circular reference)
      networkError.socket = {
        constructor: { name: 'Socket' },
        connecting: false,
      };

      const result = safeStringify({ error: networkError });

      // Should not throw, socket should be filtered out
      expect(result).toBeDefined();
      expect(result).toContain('ECONNREFUSED');
      // Verify successful stringification without errors
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });
});
