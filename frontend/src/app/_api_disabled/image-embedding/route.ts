/**
 * Image Embedding API Route Handler
 * POST /api/image-embedding
 *
 * 画像をAWS Bedrock Titan Multimodal Embeddingsでベクトル化
 *
 * Request Body (multipart/form-data):
 * - image: Image file (JPEG, PNG)
 *
 * Response:
 * - embedding: number[] (1024-dimensional vector)
 * - dimensions: number
 */

import { NextRequest, NextResponse } from 'next/server';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { getEmbeddingCache } from '@/lib/embeddingCache';

/**
 * AWS Bedrock Titan Multimodal Embeddings モデルID
 */
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'amazon.titan-embed-image-v1';

/**
 * Bedrockリージョン（Titan Multimodal Embeddingsはus-east-1でのみ利用可能）
 */
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';

/**
 * モックモードの判定（環境変数で制御）
 */
const USE_MOCK_MODE = process.env.USE_MOCK_EMBEDDING === 'true';

/**
 * リトライ設定
 */
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1秒
const MAX_RETRY_DELAY = 10000; // 10秒

/**
 * Bedrock Runtime クライアントのシングルトンインスタンス
 */
let bedrockClient: BedrockRuntimeClient | null = null;
let clientLastRefreshed: number = 0;
const CLIENT_REFRESH_INTERVAL = 3600000; // 1時間（認証トークン期限対策）

/**
 * CORSヘッダーを含むJSONレスポンスを生成
 */
function createCorsResponse(data: any, status: number): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/**
 * Bedrock Runtime クライアントを取得（認証トークン自動更新対応）
 * 注意: Titan Multimodal Embeddings は us-east-1 リージョンでのみ利用可能
 */
function getBedrockClient(): BedrockRuntimeClient {
  if (USE_MOCK_MODE) {
    console.log('[Bedrock] Mock mode is enabled');
    throw new Error('Mock mode enabled - real Bedrock client not available');
  }

  const now = Date.now();

  // クライアントを定期的にリフレッシュ（認証トークン期限対策）
  if (bedrockClient && now - clientLastRefreshed < CLIENT_REFRESH_INTERVAL) {
    return bedrockClient;
  }

  console.log('[Bedrock] Creating/refreshing Bedrock client');
  console.log('[Bedrock] Using region:', BEDROCK_REGION);
  console.log('[Bedrock] Using model:', BEDROCK_MODEL_ID);

  // 既存のクライアントがあれば破棄（認証情報の更新のため）
  if (bedrockClient) {
    bedrockClient = null;
  }

  bedrockClient = new BedrockRuntimeClient({
    region: BEDROCK_REGION,
    credentials: defaultProvider({
      // 認証情報プロバイダーのタイムアウト設定
      timeout: 5000,
      // 認証情報の自動更新を有効化
    }),
    maxAttempts: MAX_RETRIES,
  });

  clientLastRefreshed = now;
  console.log('[Bedrock] Client initialized successfully at', new Date(now).toISOString());

  return bedrockClient;
}

/**
 * 画像をBase64エンコード
 */
async function imageToBase64(imageBuffer: Buffer): Promise<string> {
  return imageBuffer.toString('base64');
}

/**
 * モック用の画像埋め込みベクトル生成
 * 開発環境用のダミーデータを返す
 */
function generateMockEmbedding(): number[] {
  // 1024次元のランダムベクトルを生成（実際のBedrock出力と同じ次元数）
  const embedding = Array.from({ length: 1024 }, () => Math.random() * 2 - 1);

  console.log('[MOCK MODE] Generated mock embedding vector (1024 dimensions)');

  return embedding;
}

/**
 * 指数バックオフでリトライを実行
 */
async function exponentialBackoff(attemptNumber: number): Promise<void> {
  const delay = Math.min(
    INITIAL_RETRY_DELAY * Math.pow(2, attemptNumber),
    MAX_RETRY_DELAY
  );
  const jitter = Math.random() * 0.3 * delay; // 30%のジッター
  const totalDelay = delay + jitter;

  console.log(`[Bedrock] Retrying after ${totalDelay.toFixed(0)}ms (attempt ${attemptNumber + 1}/${MAX_RETRIES})`);
  await new Promise((resolve) => setTimeout(resolve, totalDelay));
}

/**
 * エラーがリトライ可能かどうかを判定
 */
function isRetryableError(error: any): boolean {
  // ネットワークエラー、タイムアウト、5xxエラーはリトライ可能
  const retryableErrors = [
    'NetworkingError',
    'TimeoutError',
    'ThrottlingException',
    'TooManyRequestsException',
    'ServiceUnavailableException',
    'InternalServerError',
  ];

  if (retryableErrors.includes(error.name) || retryableErrors.includes(error.code)) {
    return true;
  }

  // HTTPステータスコードが5xxの場合もリトライ
  const statusCode = error.$metadata?.httpStatusCode;
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return true;
  }

  // 認証トークン期限切れもリトライ（クライアントリフレッシュ後）
  if (
    error.name === 'ExpiredTokenException' ||
    error.message?.includes('expired') ||
    error.message?.includes('token')
  ) {
    return true;
  }

  return false;
}

/**
 * AWS Bedrock Titan Embeddingsで画像をベクトル化（リトライロジック付き）
 */
async function generateImageEmbedding(imageBase64: string): Promise<number[]> {
  // モックモードの場合
  if (USE_MOCK_MODE) {
    console.log('[MOCK MODE] Using mock embedding instead of AWS Bedrock');
    // 少し遅延を入れて実際のAPI呼び出しをシミュレート
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return generateMockEmbedding();
  }

  let lastError: any;

  // リトライロジック
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // 認証トークン期限切れの可能性がある場合、クライアントを強制リフレッシュ
      if (attempt > 0) {
        console.log('[Bedrock] Forcing client refresh for retry');
        clientLastRefreshed = 0; // リフレッシュを強制
      }

      const client = getBedrockClient();

      const requestBody = {
        inputImage: imageBase64,
      };

      const command = new InvokeModelCommand({
        modelId: BEDROCK_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      });

      console.log(`[Bedrock] Sending request (attempt ${attempt + 1}/${MAX_RETRIES})`);
      const startTime = Date.now();

      const response = await client.send(command);

      const duration = Date.now() - startTime;
      console.log(`[Bedrock] Request completed in ${duration}ms`);

      // レスポンスボディをパース
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      if (!responseBody.embedding || !Array.isArray(responseBody.embedding)) {
        throw new Error('Invalid embedding response format');
      }

      console.log(`[Bedrock] Successfully generated embedding (${responseBody.embedding.length} dimensions)`);
      return responseBody.embedding;
    } catch (error: any) {
      lastError = error;

      console.error(`[Bedrock] Attempt ${attempt + 1} failed:`, {
        name: error.name,
        message: error.message,
        code: error.code,
        statusCode: error.$metadata?.httpStatusCode,
      });

      // リトライ可能なエラーかチェック
      if (attempt < MAX_RETRIES - 1 && isRetryableError(error)) {
        await exponentialBackoff(attempt);
        continue; // リトライ
      }

      // リトライ不可能なエラー、または最大リトライ回数に達した
      break;
    }
  }

  // すべてのリトライが失敗
  console.error('[Bedrock] All retry attempts failed');
  throw lastError;
}

/**
 * POST /api/image-embedding
 * 画像をアップロードしてベクトル化
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Image Embedding API] Starting image embedding request');
    console.log('[Image Embedding API] Mock mode:', USE_MOCK_MODE);

    // マルチパートフォームデータを取得
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;

    if (!imageFile) {
      console.error('[Image Embedding API] No image file provided');
      return createCorsResponse(
        {
          error: 'Image file is required',
          code: 'MISSING_IMAGE',
        },
        400
      );
    }

    console.log('[Image Embedding API] Received file:', {
      name: imageFile.name,
      size: imageFile.size,
      type: imageFile.type,
    });

    // ファイルサイズチェック（最大5MB）
    if (imageFile.size > 5 * 1024 * 1024) {
      console.error('[Image Embedding API] File too large:', imageFile.size);
      return createCorsResponse(
        {
          error: 'Image file size must be less than 5MB',
          code: 'FILE_TOO_LARGE',
        },
        400
      );
    }

    // ファイルタイプチェック
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(imageFile.type)) {
      console.error('[Image Embedding API] Invalid file type:', imageFile.type);
      return createCorsResponse(
        {
          error: 'Only JPEG and PNG images are supported',
          code: 'INVALID_FILE_TYPE',
        },
        400
      );
    }

    // ファイルをBufferに変換
    const arrayBuffer = await imageFile.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    console.log('[Image Embedding API] File converted to buffer, size:', imageBuffer.length);

    // キャッシュチェック
    const cache = getEmbeddingCache();
    let embedding = cache.get(imageBuffer);
    let fromCache = false;

    if (embedding) {
      console.log('[Image Embedding API] Cache hit - using cached embedding');
      fromCache = true;
    } else {
      console.log('[Image Embedding API] Cache miss - generating new embedding');

      // Base64エンコード
      const imageBase64 = await imageToBase64(imageBuffer);
      console.log('[Image Embedding API] File encoded to base64, length:', imageBase64.length);

      // Bedrockで埋め込みベクトル生成
      console.log('[Image Embedding API] Generating embedding...');
      const startTime = Date.now();
      embedding = await generateImageEmbedding(imageBase64);
      const duration = Date.now() - startTime;

      console.log(`[Image Embedding API] Embedding generated successfully in ${duration}ms, dimensions:`, embedding.length);

      // キャッシュに保存
      cache.set(imageBuffer, embedding);
      console.log('[Image Embedding API] Embedding cached for future requests');
    }

    // キャッシュ統計をログ出力
    cache.logStats();

    // レスポンス
    return createCorsResponse(
      {
        success: true,
        data: {
          embedding,
          dimensions: embedding.length,
          fileName: imageFile.name,
          fileSize: imageFile.size,
          fileType: imageFile.type,
          cached: fromCache, // キャッシュヒットかどうか
        },
      },
      200
    );
  } catch (error: any) {
    console.error('[Image Embedding API] Error occurred:', error);
    console.error('[Image Embedding API] Error name:', error.name);
    console.error('[Image Embedding API] Error code:', error.code);
    console.error('[Image Embedding API] Error stack:', error.stack);

    // AWS認証情報エラー
    if (
      error.message?.includes('credentials not configured') ||
      error.name === 'CredentialsProviderError' ||
      error.message?.toLowerCase().includes('could not load credentials')
    ) {
      console.error('[Image Embedding API] AWS credentials error');
      return createCorsResponse(
        {
          error: 'AWS credentials not configured',
          code: 'MISSING_CREDENTIALS',
          message: process.env.NODE_ENV === 'development'
            ? 'Please configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.local'
            : 'Authentication failed',
        },
        401
      );
    }

    // Bedrock アクセス権限エラー
    if (error.code === 'AccessDeniedException' || error.name === 'AccessDeniedException') {
      console.error('[Image Embedding API] Access denied to Bedrock');
      return createCorsResponse(
        {
          error: 'Access denied to AWS Bedrock',
          code: 'ACCESS_DENIED',
          message: process.env.NODE_ENV === 'development'
            ? 'IAM user/role needs bedrock:InvokeModel permission'
            : 'Access denied',
        },
        403
      );
    }

    // Bedrock モデル未対応リージョン
    if (
      error.code === 'ValidationException' &&
      error.message?.includes('not supported in region')
    ) {
      console.error('[Image Embedding API] Model not available in region');
      return createCorsResponse(
        {
          error: 'Bedrock model not available in this region',
          code: 'MODEL_NOT_AVAILABLE',
          message: process.env.NODE_ENV === 'development'
            ? `${BEDROCK_MODEL_ID} is not available in ${process.env.AWS_REGION || 'ap-northeast-1'}`
            : 'Service unavailable in region',
        },
        503
      );
    }

    // Bedrock リージョンエラー
    if (error.message?.includes('region') || error.code === 'InvalidRegionException') {
      console.error('[Image Embedding API] Invalid region');
      return createCorsResponse(
        {
          error: 'AWS Bedrock not available in this region',
          code: 'INVALID_REGION',
          message: process.env.NODE_ENV === 'development'
            ? `Bedrock service may not be available in ${process.env.AWS_REGION || 'ap-northeast-1'}`
            : 'Service unavailable in region',
        },
        503
      );
    }

    // Bedrock サービスエラー
    if (error.message?.includes('Bedrock') || error.name?.includes('Bedrock')) {
      console.error('[Image Embedding API] Bedrock service error');
      return createCorsResponse(
        {
          error: 'AWS Bedrock service error',
          code: 'BEDROCK_ERROR',
          message: process.env.NODE_ENV === 'development' ? error.message : 'Service error',
        },
        503
      );
    }

    // その他の内部エラー
    console.error('[Image Embedding API] Internal server error');
    return createCorsResponse(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred',
      },
      500
    );
  }
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
