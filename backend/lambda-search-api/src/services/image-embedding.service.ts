/**
 * Image Embedding Service
 * Interfaces with the Image Embedding Lambda function
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Logger } from './logger.service';

const logger = new Logger('ImageEmbeddingService');

export interface GenerateEmbeddingRequest {
  imageUrl?: string;
  imageBase64?: string;
  useCache?: boolean;
}

export interface GenerateEmbeddingResponse {
  embedding: number[];
  dimension: number;
  model: string;
  inferenceTime?: number;
  cached: boolean;
  imageHash: string;
}

export class ImageEmbeddingService {
  private lambdaClient: LambdaClient;
  private functionName: string;

  constructor(functionName?: string, region?: string) {
    this.functionName = functionName || process.env.IMAGE_EMBEDDING_FUNCTION_NAME || 'cis-image-embedding';
    this.lambdaClient = new LambdaClient({
      region: region || process.env.AWS_REGION || 'ap-northeast-1',
    });

    logger.info('ImageEmbeddingService initialized', {
      functionName: this.functionName,
    });
  }

  /**
   * Generate image embedding by invoking the image embedding Lambda function
   */
  async generateEmbedding(request: GenerateEmbeddingRequest): Promise<GenerateEmbeddingResponse> {
    try {
      logger.info('Invoking image embedding Lambda', {
        functionName: this.functionName,
        hasImageUrl: !!request.imageUrl,
        hasImageBase64: !!request.imageBase64,
      });

      const startTime = Date.now();

      // Prepare Lambda payload
      const payload = {
        imageUrl: request.imageUrl,
        imageBase64: request.imageBase64,
        useCache: request.useCache !== false,
        operation: 'generate',
      };

      // Invoke Lambda function
      const command = new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: 'RequestResponse', // Synchronous invocation
        Payload: Buffer.from(JSON.stringify(payload)),
      });

      const response = await this.lambdaClient.send(command);

      // Parse response
      if (!response.Payload) {
        throw new Error('Empty response from Lambda function');
      }

      const responsePayload = JSON.parse(Buffer.from(response.Payload).toString());
      const invocationTime = Date.now() - startTime;

      logger.info('Image embedding Lambda invoked successfully', {
        invocationTime,
        statusCode: responsePayload.statusCode,
      });

      // Check for errors
      if (response.FunctionError) {
        throw new Error(`Lambda function error: ${response.FunctionError}`);
      }

      if (responsePayload.statusCode !== 200) {
        const errorBody = JSON.parse(responsePayload.body);
        throw new Error(errorBody.error?.message || 'Failed to generate embedding');
      }

      // Parse successful response
      const result = JSON.parse(responsePayload.body);

      if (!result.success || !result.data) {
        throw new Error('Invalid response format from Lambda function');
      }

      return result.data as GenerateEmbeddingResponse;

    } catch (error: any) {
      logger.error('Failed to generate image embedding', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Generate embedding from S3 image URL
   */
  async generateEmbeddingFromS3(s3Url: string, useCache: boolean = true): Promise<number[]> {
    const result = await this.generateEmbedding({
      imageUrl: s3Url,
      useCache,
    });

    return result.embedding;
  }

  /**
   * Generate embedding from base64 encoded image
   */
  async generateEmbeddingFromBase64(base64Data: string, useCache: boolean = true): Promise<number[]> {
    const result = await this.generateEmbedding({
      imageBase64: base64Data,
      useCache,
    });

    return result.embedding;
  }

  /**
   * Batch generate embeddings for multiple images
   * Uses parallel invocations with concurrency limit
   */
  async batchGenerateEmbeddings(
    imageUrls: string[],
    concurrency: number = 10
  ): Promise<Array<{ url: string; embedding: number[] | null; error?: string }>> {
    logger.info('Batch generating embeddings', {
      totalImages: imageUrls.length,
      concurrency,
    });

    const results: Array<{ url: string; embedding: number[] | null; error?: string }> = [];

    // Process in batches
    for (let i = 0; i < imageUrls.length; i += concurrency) {
      const batch = imageUrls.slice(i, i + concurrency);

      const batchPromises = batch.map(async (url) => {
        try {
          const embedding = await this.generateEmbeddingFromS3(url);
          return { url, embedding, error: undefined };
        } catch (error: any) {
          logger.error('Failed to generate embedding for image', {
            url,
            error: error.message,
          });
          return { url, embedding: null, error: error.message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      logger.info('Batch completed', {
        batchNumber: Math.floor(i / concurrency) + 1,
        totalBatches: Math.ceil(imageUrls.length / concurrency),
      });
    }

    return results;
  }

  /**
   * Calculate cosine similarity between two vectors
   * Used for client-side similarity filtering
   */
  static calculateCosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vectors must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Validate embedding vector
   */
  static validateEmbedding(embedding: number[], expectedDimension: number = 512): boolean {
    if (!Array.isArray(embedding)) {
      return false;
    }

    if (embedding.length !== expectedDimension) {
      return false;
    }

    // Check if all values are numbers and finite
    return embedding.every((value) => typeof value === 'number' && Number.isFinite(value));
  }
}
