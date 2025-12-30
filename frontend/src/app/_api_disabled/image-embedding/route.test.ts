/**
 * Integration Tests for Image Embedding API Route
 * 画像埋め込みAPI ルートのインテグレーションテスト
 *
 * Coverage Target: 85%+ (API routes critical functionality)
 */

import { NextRequest } from 'next/server';
import { POST, OPTIONS } from './route';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Mock AWS SDK
jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: jest.fn(() => jest.fn()),
}));

/**
 * テスト用のモックファイル作成ヘルパー
 */
const createMockFile = (name: string, size: number, type: string): File => {
  const blob = new Blob(['a'.repeat(size)], { type });
  return new File([blob], name, { type });
};

/**
 * テスト用のモックリクエスト作成ヘルパー
 */
const createMockRequest = (file?: File): NextRequest => {
  const formData = new FormData();
  if (file) {
    formData.append('image', file);
  }

  return {
    formData: jest.fn().mockResolvedValue(formData),
  } as unknown as NextRequest;
};

describe('POST /api/image-embedding', () => {
  let mockSend: jest.Mock;
  let mockBedrockClient: jest.Mocked<BedrockRuntimeClient>;

  beforeEach(() => {
    // Bedrock クライアントのモックをリセット
    jest.clearAllMocks();

    // モック関数の設定
    mockSend = jest.fn();
    mockBedrockClient = {
      send: mockSend,
    } as any;

    (BedrockRuntimeClient as jest.MockedClass<typeof BedrockRuntimeClient>).mockImplementation(
      () => mockBedrockClient
    );

    // デフォルトの成功レスポンス
    const mockEmbedding = new Array(1024).fill(0.5);
    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({
          embedding: mockEmbedding,
        })
      ),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Success Cases', () => {
    it('should successfully process valid JPEG image', async () => {
      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.embedding).toHaveLength(1024);
      expect(data.data.dimensions).toBe(1024);
      expect(data.data.fileName).toBe('test.jpg');
      expect(data.data.fileType).toBe('image/jpeg');
    });

    it('should successfully process valid PNG image', async () => {
      const file = createMockFile('test.png', 2048, 'image/png');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.fileType).toBe('image/png');
    });

    it('should call Bedrock API with correct parameters', async () => {
      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const request = createMockRequest(file);

      await POST(request);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(InvokeModelCommand));

      const command = mockSend.mock.calls[0][0];
      expect(command.input.modelId).toBe('amazon.titan-embed-image-v1');
      expect(command.input.contentType).toBe('application/json');
    });

    it('should handle file at maximum size limit', async () => {
      const maxSize = 5 * 1024 * 1024; // 5MB
      const file = createMockFile('large.jpg', maxSize, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('Validation Error Cases', () => {
    it('should return 400 when no image file is provided', async () => {
      const request = createMockRequest(); // ファイルなし

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Image file is required');
      expect(data.code).toBe('MISSING_IMAGE');
    });

    it('should return 400 for file size exceeding limit', async () => {
      const tooLargeSize = 6 * 1024 * 1024; // 6MB
      const file = createMockFile('huge.jpg', tooLargeSize, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Image file size must be less than 5MB');
      expect(data.code).toBe('FILE_TOO_LARGE');
    });

    it('should return 400 for unsupported file type (PDF)', async () => {
      const file = createMockFile('document.pdf', 1024, 'application/pdf');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Only JPEG and PNG images are supported');
      expect(data.code).toBe('INVALID_FILE_TYPE');
    });

    it('should return 400 for unsupported image type (GIF)', async () => {
      const file = createMockFile('animated.gif', 1024, 'image/gif');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_FILE_TYPE');
    });

    it('should return 400 for unsupported image type (WebP)', async () => {
      const file = createMockFile('modern.webp', 1024, 'image/webp');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_FILE_TYPE');
    });
  });

  describe('Bedrock Error Cases', () => {
    it('should return 503 when Bedrock service fails', async () => {
      mockSend.mockRejectedValue(new Error('Bedrock service unavailable'));

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe('AWS Bedrock service error');
      expect(data.code).toBe('BEDROCK_ERROR');
    });

    it('should include error message in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      mockSend.mockRejectedValue(new Error('Bedrock connection timeout'));

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.message).toBeDefined();
      expect(data.message).toContain('timeout');

      process.env.NODE_ENV = originalEnv;
    });

    it('should hide error message in production mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      mockSend.mockRejectedValue(new Error('Bedrock internal error'));

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.message).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle Bedrock throttling error', async () => {
      const throttlingError = new Error('ThrottlingException: Rate exceeded');
      mockSend.mockRejectedValue(throttlingError);

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.code).toBe('BEDROCK_ERROR');
    });
  });

  describe('Internal Error Cases', () => {
    it('should return 500 for unexpected errors', async () => {
      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const request = {
        formData: jest.fn().mockRejectedValue(new Error('Unexpected error')),
      } as unknown as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
      expect(data.code).toBe('INTERNAL_ERROR');
    });

    it('should handle malformed FormData', async () => {
      const request = {
        formData: jest.fn().mockRejectedValue(new TypeError('Invalid FormData')),
      } as unknown as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Response Format', () => {
    it('should return correct response structure', async () => {
      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('embedding');
      expect(data.data).toHaveProperty('dimensions');
      expect(data.data).toHaveProperty('fileName');
      expect(data.data).toHaveProperty('fileSize');
      expect(data.data).toHaveProperty('fileType');
    });

    it('should return array of numbers for embedding', async () => {
      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(Array.isArray(data.data.embedding)).toBe(true);
      expect(typeof data.data.embedding[0]).toBe('number');
    });

    it('should include file metadata in response', async () => {
      const file = createMockFile('my-photo.jpg', 2048, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.fileName).toBe('my-photo.jpg');
      expect(data.data.fileSize).toBe(2048);
      expect(data.data.fileType).toBe('image/jpeg');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small images (1 byte)', async () => {
      const file = createMockFile('tiny.jpg', 1, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle special characters in filename', async () => {
      const file = createMockFile('テスト画像 (1).jpg', 1024, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.fileName).toBe('テスト画像 (1).jpg');
    });

    it('should handle empty Bedrock response', async () => {
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({})),
      });

      const file = createMockFile('test.jpg', 1024, 'image/jpeg');
      const request = createMockRequest(file);

      const response = await POST(request);
      const data = await response.json();

      // undefined embedding should cause error
      expect(response.status).toBe(500);
    });
  });
});

describe('OPTIONS /api/image-embedding', () => {
  it('should return 200 with CORS headers', async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });

  it('should return null body', async () => {
    const response = await OPTIONS();
    const body = await response.text();

    expect(body).toBe('');
  });
});
