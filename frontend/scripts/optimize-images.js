#!/usr/bin/env node

/**
 * 画像最適化スクリプト
 *
 * public/images内の画像をWebP形式に変換し、最適化します。
 * Next.js Static Exportでは動的な画像最適化が使えないため、
 * ビルド時に事前に最適化を行います。
 */

const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

// ========================================
// 設定
// ========================================

const IMAGE_DIR = path.join(__dirname, '../public/images')
const OUTPUT_DIR = path.join(__dirname, '../public/images/optimized')
const SUPPORTED_FORMATS = /\.(jpg|jpeg|png)$/i
const WEBP_QUALITY = 80
const THUMBNAIL_WIDTH = 200

// ========================================
// 画像最適化処理
// ========================================

/**
 * ディレクトリ作成
 */
const ensureDirectoryExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 画像ファイル最適化
 */
const optimizeImage = async (inputPath, outputPath) => {
  try {
    const image = sharp(inputPath)
    const metadata = await image.metadata()

    console.log(`  📸 ${path.basename(inputPath)} (${metadata.width}x${metadata.height})`)

    // WebP変換（品質80%）
    await image.webp({ quality: WEBP_QUALITY }).toFile(outputPath.replace(/\.\w+$/, '.webp'))

    console.log(`    ✅ WebP生成完了`)

    // サムネイル生成（幅200px）
    if (metadata.width > THUMBNAIL_WIDTH) {
      const thumbnailPath = outputPath.replace(/(\.\w+)$/, `-thumb$1`)
      await sharp(inputPath)
        .resize(THUMBNAIL_WIDTH)
        .webp({ quality: WEBP_QUALITY })
        .toFile(thumbnailPath.replace(/\.\w+$/, '.webp'))

      console.log(`    ✅ サムネイル生成完了`)
    }
  } catch (error) {
    console.error(`    ❌ エラー: ${error.message}`)
  }
}

/**
 * ディレクトリ内の全画像を処理
 */
const processDirectory = async (inputDir, outputDir) => {
  ensureDirectoryExists(outputDir)

  const files = fs.readdirSync(inputDir)

  for (const file of files) {
    const inputPath = path.join(inputDir, file)
    const outputPath = path.join(outputDir, file)

    if (fs.statSync(inputPath).isDirectory()) {
      // サブディレクトリを再帰処理
      await processDirectory(inputPath, outputPath)
    } else if (SUPPORTED_FORMATS.test(file)) {
      // 画像ファイルを最適化
      await optimizeImage(inputPath, outputPath)
    }
  }
}

// ========================================
// メイン処理
// ========================================

const main = async () => {
  console.log('🚀 画像最適化スクリプト開始\n')

  if (!fs.existsSync(IMAGE_DIR)) {
    console.log(`⚠️ 画像ディレクトリが見つかりません: ${IMAGE_DIR}`)
    console.log('   public/images/ ディレクトリを作成してください。')
    process.exit(0)
  }

  const startTime = Date.now()

  await processDirectory(IMAGE_DIR, OUTPUT_DIR)

  const endTime = Date.now()
  const duration = ((endTime - startTime) / 1000).toFixed(2)

  console.log(`\n✅ 最適化完了！ (${duration}秒)`)
  console.log(`📁 出力先: ${OUTPUT_DIR}`)
}

main().catch((error) => {
  console.error('❌ エラーが発生しました:', error)
  process.exit(1)
})
