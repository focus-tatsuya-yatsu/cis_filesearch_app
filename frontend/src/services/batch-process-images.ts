/**
 * Batch Process Images - S3画像の一括ベクトル化とOpenSearch保存
 *
 * S3バケット内の既存画像を走査し、ベクトル化してOpenSearchに保存します。
 *
 * 使用方法:
 * ```bash
 * # 開発環境
 * ts-node src/services/batch-process-images.ts
 *
 * # または Next.js API経由
 * curl -X POST http://localhost:3000/api/batch-process-images
 * ```
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

interface ProcessingResult {
  s3Key: string;
  success: boolean;
  error?: string;
  embeddingDimensions?: number;
}

interface BatchProcessingStats {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  results: ProcessingResult[];
}

/**
 * バッチ処理設定
 */
const CONFIG = {
  S3_BUCKET: process.env.S3_BUCKET_NAME || 'cis-filesearch-thumbnails',
  S3_PREFIX: 'thumbnails/', // サムネイル画像のプレフィックス
  OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT || '',
  OPENSEARCH_INDEX: process.env.OPENSEARCH_INDEX || 'cis-files',
  AWS_REGION: process.env.AWS_REGION || 'ap-northeast-1',
  BEDROCK_REGION: 'us-east-1', // Titan Multimodal Embeddings はus-east-1のみ
  BEDROCK_MODEL_ID: 'amazon.titan-embed-image-v1',
  BATCH_SIZE: 10, // 並列処理数
  MAX_FILES: 1000, // 最大処理ファイル数（制限）
  RETRY_ATTEMPTS: 3, // リトライ回数
  RETRY_DELAY_MS: 1000, // リトライ間隔（ミリ秒）
};

/**
 * S3クライアント
 */
const s3Client = new S3Client({
  region: CONFIG.AWS_REGION,
  credentials: defaultProvider(),
});

/**
 * Bedrock Runtimeクライアント
 */
const bedrockClient = new BedrockRuntimeClient({
  region: CONFIG.BEDROCK_REGION,
  credentials: defaultProvider(),
});

/**
 * S3から画像を取得してBase64エンコード
 */
async function getImageFromS3(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: CONFIG.S3_BUCKET,
    Key: s3Key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('Empty response body from S3');
  }

  // Streamを Bufferに変換
  const chunks: Uint8Array[] = [];
  const stream = response.Body as any;

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  return buffer.toString('base64');
}

/**
 * AWS Bedrock Titan Embeddingsで画像をベクトル化
 */
async function generateImageEmbedding(imageBase64: string): Promise<number[]> {
  const requestBody = {
    inputImage: imageBase64,
  };

  const command = new InvokeModelCommand({
    modelId: CONFIG.BEDROCK_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  const response = await bedrockClient.send(command);

  // レスポンスボディをパース
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  return responseBody.embedding;
}

/**
 * OpenSearchに画像埋め込みを保存
 */
async function saveEmbeddingToOpenSearch(
  s3Key: string,
  imageEmbedding: number[]
): Promise<void> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const response = await fetch(`${apiUrl}/api/save-image-embedding`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      s3Key,
      imageEmbedding,
      fileName: s3Key.split('/').pop() || 'unknown',
      filePath: s3Key,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Unknown error');
  }
}

/**
 * 単一画像を処理（ベクトル化 + OpenSearch保存）
 */
async function processImage(
  s3Key: string,
  retryCount = 0
): Promise<ProcessingResult> {
  try {
    console.log(`[Batch Process] Processing: ${s3Key}`);

    // S3から画像を取得
    const imageBase64 = await getImageFromS3(s3Key);
    console.log(`[Batch Process] Retrieved from S3: ${s3Key} (${imageBase64.length} bytes)`);

    // ベクトル化
    const imageEmbedding = await generateImageEmbedding(imageBase64);
    console.log(`[Batch Process] Generated embedding: ${s3Key} (${imageEmbedding.length} dimensions)`);

    // OpenSearchに保存
    await saveEmbeddingToOpenSearch(s3Key, imageEmbedding);
    console.log(`[Batch Process] Saved to OpenSearch: ${s3Key}`);

    return {
      s3Key,
      success: true,
      embeddingDimensions: imageEmbedding.length,
    };
  } catch (error: any) {
    console.error(`[Batch Process] Error processing ${s3Key}:`, error.message);

    // リトライロジック
    if (retryCount < CONFIG.RETRY_ATTEMPTS) {
      console.log(`[Batch Process] Retrying ${s3Key} (attempt ${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS})`);
      await new Promise((resolve) => setTimeout(resolve, CONFIG.RETRY_DELAY_MS));
      return processImage(s3Key, retryCount + 1);
    }

    return {
      s3Key,
      success: false,
      error: error.message,
    };
  }
}

/**
 * S3バケット内の画像を一括処理
 */
export async function batchProcessImages(): Promise<BatchProcessingStats> {
  console.log('[Batch Process] Starting batch processing...');
  console.log('[Batch Process] Configuration:', {
    bucket: CONFIG.S3_BUCKET,
    prefix: CONFIG.S3_PREFIX,
    batchSize: CONFIG.BATCH_SIZE,
    maxFiles: CONFIG.MAX_FILES,
  });

  const stats: BatchProcessingStats = {
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    errors: [],
    results: [],
  };

  try {
    // S3から画像リストを取得
    const listCommand = new ListObjectsV2Command({
      Bucket: CONFIG.S3_BUCKET,
      Prefix: CONFIG.S3_PREFIX,
      MaxKeys: CONFIG.MAX_FILES,
    });

    const listResponse = await s3Client.send(listCommand);

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      console.log('[Batch Process] No images found in S3');
      return stats;
    }

    // 画像ファイルのみフィルタリング（jpg, jpeg, png）
    const imageKeys = listResponse.Contents
      .filter((obj) => obj.Key && /\.(jpg|jpeg|png)$/i.test(obj.Key))
      .map((obj) => obj.Key!)
      .slice(0, CONFIG.MAX_FILES);

    stats.total = imageKeys.length;
    console.log(`[Batch Process] Found ${stats.total} image files to process`);

    // バッチ処理（並列実行）
    for (let i = 0; i < imageKeys.length; i += CONFIG.BATCH_SIZE) {
      const batch = imageKeys.slice(i, i + CONFIG.BATCH_SIZE);
      console.log(`[Batch Process] Processing batch ${Math.floor(i / CONFIG.BATCH_SIZE) + 1}/${Math.ceil(imageKeys.length / CONFIG.BATCH_SIZE)}`);

      const batchResults = await Promise.all(
        batch.map((key) => processImage(key))
      );

      // 統計を更新
      for (const result of batchResults) {
        stats.processed++;
        stats.results.push(result);

        if (result.success) {
          stats.successful++;
        } else {
          stats.failed++;
          if (result.error) {
            stats.errors.push(`${result.s3Key}: ${result.error}`);
          }
        }
      }

      console.log(`[Batch Process] Progress: ${stats.processed}/${stats.total} (${stats.successful} successful, ${stats.failed} failed)`);
    }

    console.log('[Batch Process] Batch processing completed');
    console.log('[Batch Process] Final stats:', {
      total: stats.total,
      processed: stats.processed,
      successful: stats.successful,
      failed: stats.failed,
      successRate: `${((stats.successful / stats.total) * 100).toFixed(2)}%`,
    });

    return stats;
  } catch (error: any) {
    console.error('[Batch Process] Fatal error:', error);
    stats.errors.push(`Fatal error: ${error.message}`);
    throw error;
  }
}

/**
 * スクリプト実行時のエントリーポイント
 */
if (require.main === module) {
  batchProcessImages()
    .then((stats) => {
      console.log('\n=== Batch Processing Complete ===');
      console.log(`Total files: ${stats.total}`);
      console.log(`Processed: ${stats.processed}`);
      console.log(`Successful: ${stats.successful}`);
      console.log(`Failed: ${stats.failed}`);

      if (stats.errors.length > 0) {
        console.log('\nErrors:');
        stats.errors.forEach((error) => console.log(`  - ${error}`));
      }

      process.exit(stats.failed > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Failed to complete batch processing:', error);
      process.exit(1);
    });
}
