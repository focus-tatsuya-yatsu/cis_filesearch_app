#!/bin/bash
#
# CIS File Handler インストーラーパッケージビルドスクリプト
#
# このスクリプトは、NASファイル直接オープン機能のインストーラーを
# ZIPパッケージとしてビルドします。
#

set -e

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# パスの設定
SOURCE_DIR="$SCRIPT_DIR/cis-file-handler"
OUTPUT_DIR="$PROJECT_ROOT/frontend/public/downloads"
ZIP_NAME="CIS-FileHandler-Setup.zip"
OUTPUT_PATH="$OUTPUT_DIR/$ZIP_NAME"

echo "================================================"
echo "  CIS File Handler インストーラービルド"
echo "================================================"
echo ""

# ソースディレクトリの確認
if [ ! -d "$SOURCE_DIR" ]; then
    echo "エラー: ソースディレクトリが見つかりません: $SOURCE_DIR"
    exit 1
fi

# 必要なファイルの確認
REQUIRED_FILES=(
    "install.bat"
    "uninstall.bat"
    "setup.ps1"
    "cis-open-handler.bat"
    "cis-open-handler.ps1"
    "README.md"
)

echo "必要なファイルを確認中..."
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$SOURCE_DIR/$file" ]; then
        echo "エラー: 必要なファイルが見つかりません: $file"
        exit 1
    fi
    echo "  ✓ $file"
done
echo ""

# 出力ディレクトリの作成
mkdir -p "$OUTPUT_DIR"

# 既存のZIPを削除
if [ -f "$OUTPUT_PATH" ]; then
    echo "既存のZIPファイルを削除中..."
    rm "$OUTPUT_PATH"
fi

# 一時ディレクトリを作成
TEMP_DIR=$(mktemp -d)
PACKAGE_DIR="$TEMP_DIR/CIS-FileHandler"
mkdir -p "$PACKAGE_DIR"

echo "ファイルをコピー中..."
for file in "${REQUIRED_FILES[@]}"; do
    cp "$SOURCE_DIR/$file" "$PACKAGE_DIR/"
    echo "  → $file"
done
echo ""

# ZIPを作成
echo "ZIPパッケージを作成中..."
cd "$TEMP_DIR"
zip -r "$OUTPUT_PATH" "CIS-FileHandler"

# 一時ディレクトリを削除
rm -rf "$TEMP_DIR"

# 結果を表示
echo ""
echo "================================================"
echo "  ビルド完了！"
echo "================================================"
echo ""
echo "出力ファイル: $OUTPUT_PATH"
echo "ファイルサイズ: $(du -h "$OUTPUT_PATH" | cut -f1)"
echo ""
echo "配布URL（開発環境）:"
echo "  http://localhost:3000/downloads/$ZIP_NAME"
echo ""
