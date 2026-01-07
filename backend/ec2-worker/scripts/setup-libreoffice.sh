#!/bin/bash
# ============================================================================
# LibreOffice Setup Script for EC2 Worker
# Office系ファイルのプレビュー生成に必要なLibreOfficeをインストール
# ============================================================================

set -e

echo "=============================================="
echo "LibreOffice Setup for EC2 Worker"
echo "=============================================="

# OS検出
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    elif [ -f /etc/amazon-linux-release ]; then
        OS="amzn"
        VERSION=$(cat /etc/amazon-linux-release | grep -oP '\d+')
    else
        OS=$(uname -s)
    fi
    echo "Detected OS: $OS $VERSION"
}

# Amazon Linux 2023用
install_amazon_linux_2023() {
    echo "Installing LibreOffice on Amazon Linux 2023..."

    # LibreOfficeコアとコンポーネント
    sudo dnf install -y \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-langpack-ja

    # 日本語フォント
    echo "Installing Japanese fonts..."
    sudo dnf install -y \
        google-noto-sans-cjk-jp-fonts \
        google-noto-serif-cjk-jp-fonts \
        ipa-gothic-fonts \
        ipa-mincho-fonts \
        ipa-pgothic-fonts \
        ipa-pmincho-fonts || true

    # フォントキャッシュ更新
    fc-cache -fv
}

# Amazon Linux 2用
install_amazon_linux_2() {
    echo "Installing LibreOffice on Amazon Linux 2..."

    # EPELリポジトリ有効化
    sudo amazon-linux-extras install -y epel

    # LibreOffice
    sudo yum install -y \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-langpack-ja

    # 日本語フォント
    echo "Installing Japanese fonts..."
    sudo yum install -y \
        google-noto-sans-cjk-jp-fonts \
        google-noto-serif-cjk-fonts \
        ipa-gothic-fonts \
        ipa-mincho-fonts || true

    fc-cache -fv
}

# Ubuntu/Debian用
install_debian() {
    echo "Installing LibreOffice on Ubuntu/Debian..."

    sudo apt-get update
    sudo apt-get install -y \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-l10n-ja

    # 日本語フォント
    echo "Installing Japanese fonts..."
    sudo apt-get install -y \
        fonts-noto-cjk \
        fonts-noto-cjk-extra \
        fonts-ipafont \
        fonts-ipafont-gothic \
        fonts-ipafont-mincho || true

    fc-cache -fv
}

# CentOS/RHEL用
install_rhel() {
    echo "Installing LibreOffice on CentOS/RHEL..."

    sudo yum install -y epel-release
    sudo yum install -y \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-langpack-ja

    # 日本語フォント
    echo "Installing Japanese fonts..."
    sudo yum install -y \
        google-noto-sans-cjk-jp-fonts \
        google-noto-serif-cjk-fonts || true

    fc-cache -fv
}

# インストール確認
verify_installation() {
    echo ""
    echo "=============================================="
    echo "Verifying LibreOffice Installation"
    echo "=============================================="

    # sofficeコマンド確認
    if command -v soffice &> /dev/null; then
        SOFFICE_PATH=$(which soffice)
        echo "✅ LibreOffice found: $SOFFICE_PATH"

        # バージョン確認
        VERSION=$(soffice --version 2>/dev/null || echo "Unable to get version")
        echo "   Version: $VERSION"
    else
        echo "❌ LibreOffice (soffice) not found in PATH"

        # 代替パスを確認
        ALTERNATIVE_PATHS=(
            "/usr/bin/soffice"
            "/usr/bin/libreoffice"
            "/opt/libreoffice/program/soffice"
        )

        for path in "${ALTERNATIVE_PATHS[@]}"; do
            if [ -f "$path" ]; then
                echo "   Found at: $path"
                echo "   Add to PATH or update OfficeConverter configuration"
            fi
        done

        exit 1
    fi

    # 変換テスト（オプション）
    echo ""
    echo "Testing conversion capability..."

    # テスト用のシンプルなHTMLを作成
    TEST_DIR=$(mktemp -d)
    TEST_HTML="$TEST_DIR/test.html"
    TEST_PDF="$TEST_DIR/test.pdf"

    echo "<html><body><h1>Test</h1></body></html>" > "$TEST_HTML"

    # PDF変換テスト
    if soffice --headless --convert-to pdf --outdir "$TEST_DIR" "$TEST_HTML" &> /dev/null; then
        if [ -f "$TEST_DIR/test.pdf" ]; then
            echo "✅ PDF conversion test: PASSED"
        else
            echo "⚠️ PDF conversion test: PDF not created"
        fi
    else
        echo "⚠️ PDF conversion test: Failed (may work with actual Office files)"
    fi

    # クリーンアップ
    rm -rf "$TEST_DIR"

    echo ""
    echo "=============================================="
    echo "Setup Complete!"
    echo "=============================================="
    echo ""
    echo "LibreOffice is ready for Office file preview generation."
    echo ""
    echo "Supported formats:"
    echo "  - Word: .doc, .docx"
    echo "  - Excel: .xls, .xlsx"
    echo "  - PowerPoint: .ppt, .pptx"
    echo "  - OpenDocument: .odt, .ods, .odp"
}

# メイン処理
main() {
    detect_os

    case "$OS" in
        amzn)
            if [[ "$VERSION" == "2023" ]] || [[ "$VERSION" -ge 2023 ]]; then
                install_amazon_linux_2023
            else
                install_amazon_linux_2
            fi
            ;;
        ubuntu|debian)
            install_debian
            ;;
        centos|rhel|rocky|almalinux)
            install_rhel
            ;;
        *)
            echo "Unsupported OS: $OS"
            echo "Please install LibreOffice manually:"
            echo "  - Amazon Linux 2023: sudo dnf install libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress"
            echo "  - Ubuntu/Debian: sudo apt-get install libreoffice"
            echo "  - CentOS/RHEL: sudo yum install libreoffice"
            exit 1
            ;;
    esac

    verify_installation
}

# スクリプト実行
main "$@"
