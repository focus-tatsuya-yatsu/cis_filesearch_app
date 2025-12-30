#!/bin/bash

# テスト用画像を生成するスクリプト
# ImageMagick (convert) または sips を使用

echo "テスト用画像を生成しています..."

OUTPUT_DIR="./test-images"
mkdir -p "$OUTPUT_DIR"

# sips (macOSに標準インストール) を使用してテスト画像を生成
if command -v sips &> /dev/null; then
  echo "sips を使用して画像を生成します"

  # 小さい画像 (100KB程度)
  sips -z 800 600 --setProperty format jpeg \
    --setProperty formatOptions 70 \
    /System/Library/Desktop\ Pictures/Solid\ Colors/Blue.png \
    --out "$OUTPUT_DIR/test-small.jpg" &> /dev/null || echo "警告: test-small.jpg の生成に失敗"

  echo "✓ $OUTPUT_DIR/test-small.jpg を作成しました"

elif command -v convert &> /dev/null; then
  echo "ImageMagick (convert) を使用して画像を生成します"

  # 小さい画像 (100KB程度)
  convert -size 800x600 xc:blue "$OUTPUT_DIR/test-small.jpg"
  echo "✓ $OUTPUT_DIR/test-small.jpg を作成しました"

else
  echo "警告: sips または ImageMagick がインストールされていません"
  echo ""
  echo "代替方法:"
  echo "1. インターネットから適当な画像をダウンロード"
  echo "2. $OUTPUT_DIR/test-small.jpg として保存"
  echo ""
  echo "または、以下のURLから画像をダウンロード:"
  echo "https://via.placeholder.com/800x600.jpg"

  # curlでプレースホルダー画像をダウンロード
  if command -v curl &> /dev/null; then
    echo ""
    echo "プレースホルダー画像をダウンロードしています..."
    curl -s -o "$OUTPUT_DIR/test-small.jpg" "https://via.placeholder.com/800x600.jpg"
    if [ -f "$OUTPUT_DIR/test-small.jpg" ]; then
      echo "✓ $OUTPUT_DIR/test-small.jpg をダウンロードしました"
    else
      echo "✗ ダウンロードに失敗しました"
    fi
  fi
fi

# 生成されたファイルのサイズを表示
if [ -f "$OUTPUT_DIR/test-small.jpg" ]; then
  FILE_SIZE=$(wc -c < "$OUTPUT_DIR/test-small.jpg")
  FILE_SIZE_KB=$((FILE_SIZE / 1024))
  echo ""
  echo "生成された画像:"
  echo "  ファイル: $OUTPUT_DIR/test-small.jpg"
  echo "  サイズ: ${FILE_SIZE_KB}KB (${FILE_SIZE} bytes)"
  echo ""
  echo "この画像を使用してAPIテストを実行できます:"
  echo "  node scripts/test-image-upload.js $OUTPUT_DIR/test-small.jpg"
else
  echo ""
  echo "テスト画像の生成に失敗しました"
  echo "手動で画像を $OUTPUT_DIR/test-small.jpg に配置してください"
fi
