/**
 * Safe JSON serialization utilities
 * Handles circular references and complex objects like AWS SDK errors
 * @module utils/safe-json
 */

/**
 * Serialized error object interface
 */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  statusCode?: number;
  [key: string]: unknown;
}

/**
 * Serializes an Error object into a plain JSON-safe object
 * Handles AWS SDK errors and custom error properties
 *
 * @param error - The error object to serialize
 * @returns A plain object containing error properties
 *
 * @example
 * ```typescript
 * try {
 *   await s3Client.send(command);
 * } catch (error) {
 *   const serialized = serializeError(error);
 *   console.log(JSON.stringify(serialized)); // Safe to stringify
 * }
 * ```
 */
export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return {
      name: 'UnknownError',
      message: String(error),
    };
  }

  const serialized: SerializedError = {
    name: error.name,
    message: error.message,
  };

  // Add stack trace if available
  if (error.stack) {
    serialized.stack = error.stack;
  }

  // Extract common error properties
  const errorObj = error as unknown as Record<string, unknown>;

  // AWS SDK error properties
  if (errorObj.$metadata) {
    serialized.$metadata = errorObj.$metadata;
  }

  if (errorObj.Code || errorObj.code) {
    serialized.code = String(errorObj.Code || errorObj.code);
  }

  if (errorObj.statusCode || errorObj.StatusCode) {
    serialized.statusCode = Number(errorObj.statusCode || errorObj.StatusCode);
  }

  if (errorObj.requestId || errorObj.RequestId) {
    serialized.requestId = String(errorObj.requestId || errorObj.RequestId);
  }

  // Add any other enumerable properties (excluding circular references)
  const safeKeys = ['name', 'message', 'stack', 'code', 'statusCode', 'requestId', '$metadata'];
  for (const key in errorObj) {
    if (!safeKeys.includes(key) && Object.prototype.hasOwnProperty.call(errorObj, key)) {
      const value = errorObj[key];

      // Skip functions, sockets, and other complex objects
      if (
        typeof value !== 'function' &&
        !isCircularOrComplex(value)
      ) {
        try {
          // Attempt to serialize the value
          JSON.stringify(value);
          serialized[key] = value;
        } catch {
          // Skip values that can't be serialized
          serialized[key] = '[Unserializable]';
        }
      }
    }
  }

  return serialized;
}

/**
 * Checks if a value is likely to be circular or too complex to serialize
 *
 * @param value - The value to check
 * @returns true if the value should be skipped
 */
function isCircularOrComplex(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  const type = typeof value;

  if (type !== 'object') {
    return false;
  }

  // Check for known complex objects
  const constructorName = value.constructor?.name;
  const complexTypes = [
    'Socket',
    'TLSSocket',
    'HTTPParser',
    'ClientRequest',
    'IncomingMessage',
    'Agent',
    'Server',
    'Stream',
    'EventEmitter',
  ];

  return complexTypes.includes(constructorName || '');
}

/**
 * Creates a replacer function for JSON.stringify that handles circular references
 *
 * @returns A replacer function for JSON.stringify
 *
 * @example
 * ```typescript
 * const obj = { a: 1 };
 * obj.circular = obj;
 *
 * const json = JSON.stringify(obj, createCircularReplacer());
 * // Result: {"a":1,"circular":"[Circular]"}
 * ```
 */
export function createCircularReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet();

  return function replacer(_key: string, value: unknown): unknown {
    // Handle Error objects
    if (value instanceof Error) {
      return serializeError(value);
    }

    // Handle primitives and null
    if (typeof value !== 'object' || value === null) {
      return value;
    }

    // Detect circular reference
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    // Handle arrays
    if (Array.isArray(value)) {
      return value;
    }

    // Check for complex objects
    if (isCircularOrComplex(value)) {
      return `[${value.constructor?.name || 'Complex'}]`;
    }

    return value;
  };
}

/**
 * Safely stringifies an object, handling circular references and errors
 *
 * @param obj - The object to stringify
 * @param space - Optional spacing for pretty-printing
 * @returns JSON string or error message
 *
 * @example
 * ```typescript
 * const obj = { user: 'john', data: { id: 1 } };
 * obj.data.self = obj.data;
 *
 * const json = safeStringify(obj, 2);
 * console.log(json); // Pretty-printed JSON without circular reference error
 * ```
 */
export function safeStringify(obj: unknown, space?: number): string {
  try {
    return JSON.stringify(obj, createCircularReplacer(), space);
  } catch (error) {
    return `[Stringification Error: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

/**
 * Safely parses a JSON string with error handling
 *
 * @param json - The JSON string to parse
 * @param fallback - Fallback value if parsing fails
 * @returns Parsed object or fallback
 *
 * @example
 * ```typescript
 * const result = safeParse('{"valid": "json"}', {});
 * // Result: { valid: 'json' }
 *
 * const invalid = safeParse('invalid json', { default: true });
 * // Result: { default: true }
 * ```
 */
export function safeParse<T = unknown>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
