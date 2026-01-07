/**
 * Optimized Image Embedding API Route Handler
 * POST /api/image-embedding
 *
 * Performance Optimizations:
 * - Bedrock client connection pooling
 * - Request caching
 * - Image preprocessing
 * - Concurrent request handling
 * - Metrics collection
 */

import crypto from 'crypto'

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Performance Metrics
 */
interface PerformanceMetrics {
  totalTime: number
  imageProcessingTime: number
  bedrockInvocationTime: number
  imageSize: number
  dimensions: { width: number; height: number }
}

/**
 * Cache Entry
 */
interface CacheEntry {
  embedding: number[]
  timestamp: number
  metrics: PerformanceMetrics
}

/**
 * Configuration
 */
const BEDROCK_MODEL_ID = 'amazon.titan-embed-image-v1'
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const CACHE_TTL = 3600 * 1000 // 1 hour
const CACHE_MAX_SIZE = 100 // Maximum cache entries

/**
 * Bedrock Runtime Client Pool
 * Connection reuse for better performance
 */
let bedrockClient: BedrockRuntimeClient | null = null
let clientInitTime: number = 0

/**
 * In-memory cache for embeddings
 * Key: Image hash, Value: Embedding vector
 */
const embeddingCache = new Map<string, CacheEntry>()

/**
 * Get or create Bedrock client (singleton pattern)
 */
function getBedrockClient(): BedrockRuntimeClient {
  const now = Date.now()

  // Recreate client every 5 minutes to refresh credentials
  if (bedrockClient && now - clientInitTime < 5 * 60 * 1000) {
    return bedrockClient
  }

  const region = process.env.AWS_REGION || 'ap-northeast-1'

  bedrockClient = new BedrockRuntimeClient({
    region,
    credentials: defaultProvider(),
    maxAttempts: 3,
    requestHandler: {
      connectionTimeout: 3000,
      requestTimeout: 30000,
    },
  })

  clientInitTime = now
  console.log('[BedrockClient] Client initialized/refreshed')

  return bedrockClient
}

/**
 * Calculate image hash for caching
 */
function calculateImageHash(imageBuffer: Buffer): string {
  return crypto.createHash('sha256').update(imageBuffer).digest('hex')
}

/**
 * Clean expired cache entries
 */
function cleanExpiredCache(): void {
  const now = Date.now()
  const expiredKeys: string[] = []

  embeddingCache.forEach((entry, key) => {
    if (now - entry.timestamp > CACHE_TTL) {
      expiredKeys.push(key)
    }
  })

  expiredKeys.forEach((key) => embeddingCache.delete(key))

  // Limit cache size (LRU-like behavior)
  if (embeddingCache.size > CACHE_MAX_SIZE) {
    const sortedEntries = Array.from(embeddingCache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    )

    const toRemove = sortedEntries.slice(0, embeddingCache.size - CACHE_MAX_SIZE)
    toRemove.forEach(([key]) => embeddingCache.delete(key))
  }

  if (expiredKeys.length > 0) {
    console.log(`[Cache] Cleaned ${expiredKeys.length} expired entries`)
  }
}

/**
 * Get cached embedding
 */
function getCachedEmbedding(imageHash: string): CacheEntry | null {
  const entry = embeddingCache.get(imageHash)

  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    console.log('[Cache] Hit for image hash:', imageHash.substring(0, 16))
    return entry
  }

  if (entry) {
    embeddingCache.delete(imageHash)
  }

  return null
}

/**
 * Cache embedding result
 */
function cacheEmbedding(imageHash: string, embedding: number[], metrics: PerformanceMetrics): void {
  embeddingCache.set(imageHash, {
    embedding,
    timestamp: Date.now(),
    metrics,
  })

  console.log('[Cache] Stored embedding for hash:', imageHash.substring(0, 16))
  console.log('[Cache] Current cache size:', embeddingCache.size)
}

/**
 * Validate and preprocess image
 */
async function preprocessImage(
  imageFile: File
): Promise<{ buffer: Buffer; metadata: { width?: number; height?: number } }> {
  // File size validation
  if (imageFile.size > MAX_IMAGE_SIZE) {
    throw new Error(`Image file size must be less than ${MAX_IMAGE_SIZE / 1024 / 1024}MB`)
  }

  // File type validation
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg']
  if (!allowedTypes.includes(imageFile.type)) {
    throw new Error('Only JPEG and PNG images are supported')
  }

  // Convert to buffer
  const arrayBuffer = await imageFile.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Basic metadata extraction (could be extended with sharp library)
  const metadata = {
    width: undefined,
    height: undefined,
  }

  return { buffer, metadata }
}

/**
 * Generate embedding using AWS Bedrock
 */
async function generateImageEmbedding(imageBase64: string): Promise<number[]> {
  const client = getBedrockClient()

  const requestBody = {
    inputImage: imageBase64,
  }

  const command = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  })

  const startTime = Date.now()

  try {
    const response = await client.send(command)
    const invocationTime = Date.now() - startTime

    const responseBody = JSON.parse(new TextDecoder().decode(response.body))

    console.log('[Bedrock] Invocation time:', invocationTime, 'ms')

    return responseBody.embedding
  } catch (error: any) {
    console.error('[Bedrock] Embedding generation failed:', error)
    throw new Error(`Failed to generate embedding: ${error.message}`)
  }
}

/**
 * POST /api/image-embedding
 * Upload image and generate embedding vector
 */
export async function POST(request: NextRequest) {
  const requestStartTime = Date.now()

  try {
    // Clean expired cache entries periodically
    cleanExpiredCache()

    // Parse multipart form data
    const formData = await request.formData()
    const imageFile = formData.get('image') as File

    if (!imageFile) {
      return NextResponse.json(
        {
          error: 'Image file is required',
          code: 'MISSING_IMAGE',
        },
        { status: 400 }
      )
    }

    // Preprocess image
    const preprocessStartTime = Date.now()
    const { buffer: imageBuffer, metadata } = await preprocessImage(imageFile)
    const preprocessTime = Date.now() - preprocessStartTime

    // Calculate image hash for caching
    const imageHash = calculateImageHash(imageBuffer)

    // Check cache
    const cachedEntry = getCachedEmbedding(imageHash)
    if (cachedEntry) {
      const totalTime = Date.now() - requestStartTime

      return NextResponse.json({
        success: true,
        data: {
          embedding: cachedEntry.embedding,
          dimensions: cachedEntry.embedding.length,
          fileName: imageFile.name,
          fileSize: imageFile.size,
          fileType: imageFile.type,
          cached: true,
        },
        performance: {
          totalTime,
          cached: true,
          cacheAge: Date.now() - cachedEntry.timestamp,
        },
      })
    }

    // Generate Base64
    const imageBase64 = imageBuffer.toString('base64')

    // Generate embedding
    const embeddingStartTime = Date.now()
    const embedding = await generateImageEmbedding(imageBase64)
    const embeddingTime = Date.now() - embeddingStartTime

    const totalTime = Date.now() - requestStartTime

    // Performance metrics
    const metrics: PerformanceMetrics = {
      totalTime,
      imageProcessingTime: preprocessTime,
      bedrockInvocationTime: embeddingTime,
      imageSize: imageFile.size,
      dimensions: {
        width: metadata.width || 0,
        height: metadata.height || 0,
      },
    }

    // Cache the result
    cacheEmbedding(imageHash, embedding, metrics)

    // Response
    return NextResponse.json({
      success: true,
      data: {
        embedding,
        dimensions: embedding.length,
        fileName: imageFile.name,
        fileSize: imageFile.size,
        fileType: imageFile.type,
        cached: false,
      },
      performance: {
        totalTime,
        imageProcessingTime: preprocessTime,
        bedrockInvocationTime: embeddingTime,
        cached: false,
      },
    })
  } catch (error: any) {
    console.error('[ImageEmbedding] API error:', error)

    // Error handling
    if (error.message?.includes('Bedrock')) {
      return NextResponse.json(
        {
          error: 'AWS Bedrock service error',
          code: 'BEDROCK_ERROR',
          message: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
        { status: 503 }
      )
    }

    if (error.message?.includes('size')) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'FILE_TOO_LARGE',
        },
        { status: 400 }
      )
    }

    if (error.message?.includes('supported')) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'INVALID_FILE_TYPE',
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/image-embedding/stats
 * Get cache statistics
 */
export async function GET() {
  cleanExpiredCache()

  return NextResponse.json({
    cache: {
      size: embeddingCache.size,
      maxSize: CACHE_MAX_SIZE,
      ttl: CACHE_TTL,
    },
    client: {
      initialized: bedrockClient !== null,
      age: bedrockClient ? Date.now() - clientInitTime : 0,
    },
  })
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
