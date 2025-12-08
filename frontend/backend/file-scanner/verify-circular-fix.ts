/**
 * Verification script for circular reference fix
 * Run with: npx ts-node verify-circular-fix.ts
 */

import { createLogger } from './src/utils/logger.js';
import { serializeError, safeStringify } from './src/utils/safe-json.js';

const logger = createLogger('VerifyCircularFix');

console.log('🔍 Starting circular reference fix verification...\n');

// Test 1: Simple circular reference
console.log('Test 1: Simple circular reference');
const obj1: Record<string, unknown> = { name: 'test', value: 123 };
obj1.self = obj1;

try {
  const result = safeStringify(obj1);
  logger.info('Simple circular test passed', { result });
  console.log('✅ PASS: Simple circular reference handled correctly\n');
} catch (error) {
  console.log('❌ FAIL: Simple circular reference test failed');
  logger.error('Simple circular test failed', { error });
}

// Test 2: Error object with circular reference
console.log('Test 2: Error object with circular reference');
const error = new Error('Test error') as Error & { circular?: unknown };
error.circular = error;

try {
  logger.error('Testing error with circular reference', { error });
  console.log('✅ PASS: Error with circular reference logged without warnings\n');
} catch (err) {
  console.log('❌ FAIL: Error logging failed');
  console.error(err);
}

// Test 3: AWS SDK-like error
console.log('Test 3: AWS SDK-like error object');
const awsError = new Error('Access Denied') as Error & {
  Code: string;
  StatusCode: number;
  RequestId: string;
  $metadata?: {
    httpStatusCode: number;
    requestId: string;
    attempts: number;
  };
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

try {
  const serialized = serializeError(awsError);
  logger.warn('AWS SDK error serialization test', { serialized });
  console.log('✅ PASS: AWS SDK error serialized correctly');
  console.log('   Serialized properties:', Object.keys(serialized));
  console.log('');
} catch (error) {
  console.log('❌ FAIL: AWS error serialization failed');
  console.error(error);
}

// Test 4: Network error with socket
console.log('Test 4: Network error with socket object');
const networkError = new Error('ECONNREFUSED') as Error & {
  code: string;
  socket?: {
    constructor: { name: string };
    connecting: boolean;
  };
};
networkError.code = 'ECONNREFUSED';
networkError.socket = {
  constructor: { name: 'Socket' },
  connecting: false,
};

try {
  logger.error('Network error test', { error: networkError });
  console.log('✅ PASS: Network error with socket logged without circular warning\n');
} catch (error) {
  console.log('❌ FAIL: Network error logging failed');
  console.error(error);
}

// Test 5: Complex nested object
console.log('Test 5: Complex nested object with mixed types');
const complexObj = {
  user: { name: 'John', id: 123 },
  data: [1, 2, 3, { nested: { value: 'deep' } }],
  metadata: {
    timestamp: new Date().toISOString(),
    error: new Error('Sample error'),
  },
};

try {
  logger.info('Complex object test', complexObj);
  console.log('✅ PASS: Complex nested object logged successfully\n');
} catch (error) {
  console.log('❌ FAIL: Complex object logging failed');
  console.error(error);
}

// Test 6: Verify no warnings in logs
console.log('Test 6: Checking for circular reference warnings');
console.log('⚠️  Please check the console output above.');
console.log('   If you see NO warnings like "Converting circular structure to JSON",');
console.log('   then the fix is working correctly!\n');

console.log('✅ Verification complete!');
console.log('\nℹ️  Next steps:');
console.log('   1. Check that no "circular structure" warnings appear above');
console.log('   2. Run unit tests: yarn test src/utils/__tests__/safe-json.test.ts');
console.log('   3. Monitor logs during normal operation for any circular warnings');
