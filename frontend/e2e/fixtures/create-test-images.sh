#!/bin/bash
# Create test images for E2E tests
# E2Eテスト用の画像ファイルを生成

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGES_DIR="${SCRIPT_DIR}/images"

echo "Creating test images in ${IMAGES_DIR}"
echo "================================================"

# Create images directory if it doesn't exist
mkdir -p "${IMAGES_DIR}"

# 1. Create minimal valid JPEG (1x1 pixel)
echo "Creating test-image.jpg (1x1 JPEG)..."
echo "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=" | base64 -d > "${IMAGES_DIR}/test-image.jpg"

# 2. Create minimal valid PNG (1x1 pixel)
echo "Creating test-image.png (1x1 PNG)..."
echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" | base64 -d > "${IMAGES_DIR}/test-image.png"

# 3. Create a larger JPEG for testing file size limits (create 6MB file)
echo "Creating large-image.jpg (6MB file for validation testing)..."
dd if=/dev/zero of="${IMAGES_DIR}/large-image.jpg" bs=1m count=6 2>/dev/null

# 4. Create an invalid file (PDF) for testing file type validation
echo "Creating document.pdf (invalid file type)..."
echo "%PDF-1.4 Invalid PDF for testing" > "${IMAGES_DIR}/document.pdf"

# 5. Create a realistic test JPEG using ImageMagick (if available)
if command -v convert &> /dev/null; then
    echo "Creating realistic-test.jpg using ImageMagick..."
    convert -size 800x600 xc:blue -pointsize 72 -fill white -gravity center -annotate +0+0 'Test Image\nfor E2E Testing' "${IMAGES_DIR}/realistic-test.jpg"
else
    echo "ImageMagick not found. Skipping realistic-test.jpg creation."
    echo "To install: brew install imagemagick (macOS) or apt-get install imagemagick (Linux)"
fi

# 6. Create Japanese filename test image
echo "Creating テスト画像.jpg (Japanese filename test)..."
cp "${IMAGES_DIR}/test-image.jpg" "${IMAGES_DIR}/テスト画像.jpg"

# 7. Create special characters filename test
echo "Creating test-image (1).jpg (special characters test)..."
cp "${IMAGES_DIR}/test-image.jpg" "${IMAGES_DIR}/test-image (1).jpg"

echo ""
echo "Test images created successfully!"
echo "================================================"
echo ""
echo "Available test images:"
ls -lh "${IMAGES_DIR}"
echo ""
echo "Total files: $(ls -1 "${IMAGES_DIR}" | wc -l)"
