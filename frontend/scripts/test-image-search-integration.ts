/**
 * Comprehensive Integration Test for Image Search Workflow
 * 画像検索ワークフロー全体の統合テスト
 *
 * このスクリプトは以下のフローを検証します：
 * 1. 画像アップロード → ベクトル化 (/api/image-embedding)
 * 2. ベクトルデータを使用した類似画像検索 (/api/search)
 * 3. 検索結果の検証
 *
 * 実行方法:
 * Local: tsx scripts/test-image-search-integration.ts
 * EC2 (VPC): VPC_MODE=true tsx scripts/test-image-search-integration.ts
 */

import fs from 'fs'
import path from 'path'

import FormData from 'form-data'

/**
 * 環境変数の設定
 */
const VPC_MODE = process.env.VPC_MODE === 'true'
const BASE_URL =
  process.env.BASE_URL || (VPC_MODE ? 'http://localhost:3000' : 'http://localhost:3000')
const IMAGE_EMBEDDING_API = `${BASE_URL}/api/image-embedding`
const SEARCH_API = `${BASE_URL}/api/search`

// テスト画像のパス
const TEST_IMAGES_DIR = path.join(__dirname, '../e2e/fixtures/images')
const TEST_IMAGE_JPEG = path.join(TEST_IMAGES_DIR, 'test-image.jpg')
const TEST_IMAGE_PNG = path.join(TEST_IMAGES_DIR, 'test-image.png')
const LARGE_IMAGE = path.join(TEST_IMAGES_DIR, 'large-image.jpg')
const INVALID_FILE = path.join(TEST_IMAGES_DIR, 'document.pdf')

/**
 * テスト結果統計
 */
interface TestStats {
  total: number
  passed: number
  failed: number
  skipped: number
}

const stats: TestStats = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
}

/**
 * カラー出力用のヘルパー
 */
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(message: string, color?: keyof typeof colors) {
  const colorCode = color ? colors[color] : colors.reset
  console.log(`${colorCode}${message}${colors.reset}`)
}

/**
 * テストアサーション
 */
function assert(condition: boolean, message: string) {
  stats.total++
  if (condition) {
    stats.passed++
    log(`  ✓ ${message}`, 'green')
  } else {
    stats.failed++
    log(`  ✗ ${message}`, 'red')
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  assert(actual === expected, `${message} (expected: ${expected}, actual: ${actual})`)
}

function assertGreaterThan(actual: number, expected: number, message: string) {
  assert(actual > expected, `${message} (expected > ${expected}, actual: ${actual})`)
}

function assertRange(value: number, min: number, max: number, message: string) {
  assert(value >= min && value <= max, `${message} (expected: ${min}-${max}, actual: ${value})`)
}

/**
 * Test 1: 画像アップロード & ベクトル化テスト
 */
async function testImageUpload() {
  log('\n📤 Test 1: Image Upload & Vectorization', 'cyan')
  log('==========================================', 'cyan')

  try {
    // Test 1-1: Valid JPEG upload
    log('\n[1-1] Uploading valid JPEG image...', 'blue')
    const formData1 = new FormData()
    formData1.append('image', fs.createReadStream(TEST_IMAGE_JPEG), 'test-image.jpg')

    const response1 = await fetch(IMAGE_EMBEDDING_API, {
      method: 'POST',
      body: formData1 as any,
      headers: formData1.getHeaders ? formData1.getHeaders() : {},
    })

    const data1 = await response1.json()
    console.log('Response status:', response1.status)
    console.log('Response data:', JSON.stringify(data1, null, 2))

    assertEqual(response1.status, 200, 'HTTP status should be 200')
    assert(data1.success === true, 'Response should have success=true')
    assert(Array.isArray(data1.data.embedding), 'Embedding should be an array')
    assertEqual(data1.data.embedding.length, 1024, 'Embedding should have 1024 dimensions')
    assertEqual(data1.data.dimensions, 1024, 'Dimensions should be 1024')
    assertEqual(data1.data.fileType, 'image/jpeg', 'File type should be image/jpeg')

    // Save embedding for later search test
    const embeddingVector = data1.data.embedding

    // Test 1-2: Valid PNG upload
    log('\n[1-2] Uploading valid PNG image...', 'blue')
    const formData2 = new FormData()
    formData2.append('image', fs.createReadStream(TEST_IMAGE_PNG), 'test-image.png')

    const response2 = await fetch(IMAGE_EMBEDDING_API, {
      method: 'POST',
      body: formData2 as any,
      headers: formData2.getHeaders ? formData2.getHeaders() : {},
    })

    const data2 = await response2.json()
    assertEqual(response2.status, 200, 'HTTP status should be 200')
    assertEqual(data2.data.fileType, 'image/png', 'File type should be image/png')

    // Test 1-3: File too large (should fail)
    log('\n[1-3] Uploading file exceeding size limit...', 'blue')
    const formData3 = new FormData()
    formData3.append('image', fs.createReadStream(LARGE_IMAGE), 'large-image.jpg')

    const response3 = await fetch(IMAGE_EMBEDDING_API, {
      method: 'POST',
      body: formData3 as any,
      headers: formData3.getHeaders ? formData3.getHeaders() : {},
    })

    const data3 = await response3.json()
    assertEqual(response3.status, 400, 'HTTP status should be 400 for large file')
    assertEqual(data3.code, 'FILE_TOO_LARGE', 'Error code should be FILE_TOO_LARGE')

    // Test 1-4: Invalid file type (should fail)
    log('\n[1-4] Uploading invalid file type (PDF)...', 'blue')
    const formData4 = new FormData()
    formData4.append('image', fs.createReadStream(INVALID_FILE), 'document.pdf')

    const response4 = await fetch(IMAGE_EMBEDDING_API, {
      method: 'POST',
      body: formData4 as any,
      headers: formData4.getHeaders ? formData4.getHeaders() : {},
    })

    const data4 = await response4.json()
    assertEqual(response4.status, 400, 'HTTP status should be 400 for invalid file')
    assertEqual(data4.code, 'INVALID_FILE_TYPE', 'Error code should be INVALID_FILE_TYPE')

    log('\n✓ Image Upload & Vectorization tests completed', 'green')
    return embeddingVector
  } catch (error: any) {
    log(`\n✗ Image Upload & Vectorization tests failed: ${error.message}`, 'red')
    throw error
  }
}

/**
 * Test 2: 画像ベクトル検索テスト
 */
async function testImageVectorSearch(embedding: number[]) {
  log('\n🔍 Test 2: Image Vector Search', 'cyan')
  log('==============================', 'cyan')

  try {
    // Test 2-1: Basic image vector search
    log('\n[2-1] Performing image vector search...', 'blue')
    const searchBody = {
      imageEmbedding: embedding,
      searchType: 'image',
      searchMode: 'or',
      page: 1,
      size: 20,
    }

    const response1 = await fetch(SEARCH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody),
    })

    const data1 = await response1.json()
    console.log('Search response status:', response1.status)
    console.log('Search response data:', JSON.stringify(data1, null, 2))

    assertEqual(response1.status, 200, 'HTTP status should be 200')
    assert(
      data1.success === true || data1.data !== undefined,
      'Response should contain data or success=true'
    )

    // Test 2-2: Vector data integrity check
    log('\n[2-2] Verifying vector data integrity...', 'blue')
    const searchBody2 = {
      imageEmbedding: embedding,
      searchType: 'image',
      page: 1,
      size: 10,
    }

    const response2 = await fetch(SEARCH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody2),
    })

    assertEqual(response2.status, 200, 'HTTP status should be 200 for vector search')

    // Test 2-3: Pagination parameters
    log('\n[2-3] Testing pagination parameters...', 'blue')
    const searchBody3 = {
      imageEmbedding: embedding,
      searchType: 'image',
      page: 2,
      size: 50,
    }

    const response3 = await fetch(SEARCH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody3),
    })

    assertEqual(response3.status, 200, 'HTTP status should be 200 with pagination')

    // Test 2-4: Invalid request (empty embedding)
    log('\n[2-4] Testing error handling (empty embedding)...', 'blue')
    const searchBody4 = {
      imageEmbedding: [],
      searchType: 'image',
    }

    const response4 = await fetch(SEARCH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody4),
    })

    assertEqual(response4.status, 400, 'HTTP status should be 400 for empty embedding')

    // Test 2-5: Invalid pagination
    log('\n[2-5] Testing error handling (invalid pagination)...', 'blue')
    const searchBody5 = {
      imageEmbedding: embedding,
      page: -1,
      size: 200,
    }

    const response5 = await fetch(SEARCH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody5),
    })

    assertEqual(response5.status, 400, 'HTTP status should be 400 for invalid pagination')

    log('\n✓ Image Vector Search tests completed', 'green')
  } catch (error: any) {
    log(`\n✗ Image Vector Search tests failed: ${error.message}`, 'red')
    throw error
  }
}

/**
 * Test 3: エンドツーエンドワークフローテスト
 */
async function testEndToEndWorkflow() {
  log('\n🔄 Test 3: End-to-End Workflow', 'cyan')
  log('==============================', 'cyan')

  try {
    const startTime = Date.now()

    // Step 1: Upload image
    log('\n[3-1] Step 1: Upload image and generate embedding...', 'blue')
    const formData = new FormData()
    formData.append('image', fs.createReadStream(TEST_IMAGE_JPEG), 'test-image.jpg')

    const uploadResponse = await fetch(IMAGE_EMBEDDING_API, {
      method: 'POST',
      body: formData as any,
      headers: formData.getHeaders ? formData.getHeaders() : {},
    })

    const uploadData = await uploadResponse.json()
    assertEqual(uploadResponse.status, 200, 'Upload should succeed')
    const { embedding } = uploadData.data

    // Step 2: Search with embedding
    log('\n[3-2] Step 2: Search using generated embedding...', 'blue')
    const searchResponse = await fetch(SEARCH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageEmbedding: embedding,
        searchType: 'image',
        page: 1,
        size: 20,
      }),
    })

    assertEqual(searchResponse.status, 200, 'Search should succeed')

    const endTime = Date.now()
    const duration = endTime - startTime

    log(`\n⏱️  Total workflow duration: ${duration}ms`, 'yellow')
    assertRange(duration, 0, 30000, 'Workflow should complete within 30 seconds')

    log('\n✓ End-to-End Workflow test completed', 'green')
  } catch (error: any) {
    log(`\n✗ End-to-End Workflow test failed: ${error.message}`, 'red')
    throw error
  }
}

/**
 * Test 4: パフォーマンステスト
 */
async function testPerformance() {
  log('\n⚡ Test 4: Performance Tests', 'cyan')
  log('============================', 'cyan')

  try {
    // Test 4-1: Upload performance
    log('\n[4-1] Measuring upload performance...', 'blue')
    const uploadTimes: number[] = []

    for (let i = 0; i < 5; i++) {
      const startTime = Date.now()

      const formData = new FormData()
      formData.append('image', fs.createReadStream(TEST_IMAGE_JPEG), 'test-image.jpg')

      const response = await fetch(IMAGE_EMBEDDING_API, {
        method: 'POST',
        body: formData as any,
        headers: formData.getHeaders ? formData.getHeaders() : {},
      })

      const endTime = Date.now()
      const duration = endTime - startTime
      uploadTimes.push(duration)

      assertEqual(response.status, 200, `Upload ${i + 1} should succeed`)
      log(`  Upload ${i + 1}: ${duration}ms`, 'yellow')
    }

    const avgUploadTime = uploadTimes.reduce((a, b) => a + b, 0) / uploadTimes.length
    log(`\n  Average upload time: ${avgUploadTime.toFixed(2)}ms`, 'yellow')
    assertRange(avgUploadTime, 0, 10000, 'Average upload time should be under 10 seconds')

    log('\n✓ Performance tests completed', 'green')
  } catch (error: any) {
    log(`\n✗ Performance tests failed: ${error.message}`, 'red')
    throw error
  }
}

/**
 * メインテスト実行
 */
async function main() {
  log('\n╔════════════════════════════════════════════════════════╗', 'cyan')
  log('║  Image Search Integration Test Suite                  ║', 'cyan')
  log('╚════════════════════════════════════════════════════════╝', 'cyan')
  log(`\nMode: ${VPC_MODE ? 'VPC (EC2)' : 'Local'}`, 'yellow')
  log(`Base URL: ${BASE_URL}`, 'yellow')
  log(`Test Images Dir: ${TEST_IMAGES_DIR}`, 'yellow')

  // Check if test images exist
  if (!fs.existsSync(TEST_IMAGE_JPEG)) {
    log('\n⚠️  Test images not found. Creating test fixtures...', 'yellow')
    log('Please run: bash e2e/fixtures/create-test-images.sh', 'yellow')
    process.exit(1)
  }

  try {
    // Run all test suites
    const embedding = await testImageUpload()
    await testImageVectorSearch(embedding)
    await testEndToEndWorkflow()
    await testPerformance()

    // Print summary
    log('\n╔════════════════════════════════════════════════════════╗', 'cyan')
    log('║  Test Summary                                          ║', 'cyan')
    log('╚════════════════════════════════════════════════════════╝', 'cyan')
    log(`\nTotal tests: ${stats.total}`, 'blue')
    log(`Passed: ${stats.passed}`, 'green')
    log(`Failed: ${stats.failed}`, stats.failed > 0 ? 'red' : 'blue')
    log(`Skipped: ${stats.skipped}`, 'yellow')

    const passRate = ((stats.passed / stats.total) * 100).toFixed(2)
    log(`\nPass rate: ${passRate}%`, stats.failed === 0 ? 'green' : 'red')

    if (stats.failed === 0) {
      log('\n✅ All tests passed!', 'green')
      process.exit(0)
    } else {
      log('\n❌ Some tests failed', 'red')
      process.exit(1)
    }
  } catch (error: any) {
    log(`\n❌ Test suite failed: ${error.message}`, 'red')
    console.error(error.stack)

    log('\n╔════════════════════════════════════════════════════════╗', 'cyan')
    log('║  Test Summary                                          ║', 'cyan')
    log('╚════════════════════════════════════════════════════════╝', 'cyan')
    log(`\nTotal tests: ${stats.total}`, 'blue')
    log(`Passed: ${stats.passed}`, 'green')
    log(`Failed: ${stats.failed}`, 'red')

    process.exit(1)
  }
}

// Run tests
main()
