# ==========================================
# CIS File Scanner - Production Setup Verification Script (Windows)
# ==========================================
# このスクリプトは本番環境のセットアップ状態を検証します
# 実行方法: .\verify-setup.ps1
# ==========================================

# エラー時に停止
$ErrorActionPreference = "Continue"

# カラー出力用関数
function Write-Success {
    param([string]$Message)
    Write-Host "  ✓ " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Failure {
    param([string]$Message)
    Write-Host "  ✗ " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Write-Warning-Custom {
    param([string]$Message)
    Write-Host "  ⚠ " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Info {
    param([string]$Message)
    Write-Host "  ℹ " -ForegroundColor Cyan -NoNewline
    Write-Host $Message
}

# チェック結果カウンター
$script:PassedCount = 0
$script:FailedCount = 0
$script:WarningCount = 0

# ヘッダー表示
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "🔍 CIS File Scanner - Production Setup Verification" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# ==========================================
# Step 1: Node.js バージョン確認
# ==========================================
Write-Host "[Step 1/8] " -ForegroundColor Blue -NoNewline
Write-Host "Node.js Version Check"
Write-Host "----------------------------------------"

try {
    $nodeVersion = & node --version 2>$null
    if ($nodeVersion -match "v(\d+)\.") {
        $nodeMajor = [int]$matches[1]
        if ($nodeMajor -ge 18) {
            Write-Success "Node.js: $nodeVersion (OK)"
            $script:PassedCount++
        } else {
            Write-Failure "Node.js: $nodeVersion (require v18+)"
            Write-Info "Install from: https://nodejs.org/"
            $script:FailedCount++
        }
    }
} catch {
    Write-Failure "Node.js not found"
    Write-Info "Install from: https://nodejs.org/"
    $script:FailedCount++
}
Write-Host ""

# ==========================================
# Step 2: Yarn インストール確認
# ==========================================
Write-Host "[Step 2/8] " -ForegroundColor Blue -NoNewline
Write-Host "Yarn Installation Check"
Write-Host "----------------------------------------"

try {
    $yarnVersion = & yarn --version 2>$null
    if ($yarnVersion) {
        Write-Success "Yarn: v$yarnVersion"
        $script:PassedCount++
    }
} catch {
    Write-Failure "Yarn not found"
    Write-Info "Install: npm install -g yarn"
    $script:FailedCount++
}
Write-Host ""

# ==========================================
# Step 3: プロジェクト構造確認
# ==========================================
Write-Host "[Step 3/8] " -ForegroundColor Blue -NoNewline
Write-Host "Project Structure Check"
Write-Host "----------------------------------------"

# 必須ファイルのチェック
$requiredFiles = @("package.json", "tsconfig.json", "src")
$missingFiles = @()

foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Write-Success "$file exists"
        $script:PassedCount++
    } else {
        Write-Failure "$file not found"
        $missingFiles += $file
        $script:FailedCount++
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Info "Missing files: $($missingFiles -join ', ')"
}
Write-Host ""

# ==========================================
# Step 4: .env ファイル確認
# ==========================================
Write-Host "[Step 4/8] " -ForegroundColor Blue -NoNewline
Write-Host "Environment File Check"
Write-Host "----------------------------------------"

if (Test-Path ".env") {
    Write-Success ".env file exists"
    $script:PassedCount++

    # 必須環境変数のチェック
    $envContent = Get-Content ".env" -Raw
    $requiredVars = @("AWS_REGION", "S3_BUCKET_NAME", "NAS_MOUNT_PATH")
    $missingVars = @()

    foreach ($var in $requiredVars) {
        if ($envContent -match "^$var=.+") {
            Write-Success "$var is configured"
            $script:PassedCount++
        } else {
            Write-Failure "$var is missing or empty"
            $missingVars += $var
            $script:FailedCount++
        }
    }

    # AWS認証情報が.envにないかチェック（セキュリティ）
    if ($envContent -match "AWS_ACCESS_KEY_ID=[^#\s]") {
        Write-Warning-Custom "AWS_ACCESS_KEY_ID found in .env (Security Risk!)"
        Write-Info "Use AWS CLI instead: aws configure"
        $script:WarningCount++
    } else {
        Write-Success "AWS credentials not in .env (Good!)"
        $script:PassedCount++
    }

} else {
    Write-Failure ".env file not found"
    Write-Info "Create: cp .env.production .env"
    $script:FailedCount++
}
Write-Host ""

# ==========================================
# Step 5: NAS マウント確認
# ==========================================
Write-Host "[Step 5/8] " -ForegroundColor Blue -NoNewline
Write-Host "NAS Mount Check"
Write-Host "----------------------------------------"

# .envからNASパスを読み取り
$nasPath = $null
if (Test-Path ".env") {
    $envContent = Get-Content ".env"
    foreach ($line in $envContent) {
        if ($line -match "^NAS_MOUNT_PATH=(.+)") {
            $nasPath = $matches[1].Trim()
            break
        }
    }
}

if ($nasPath) {
    Write-Info "NAS path configured: $nasPath"

    if (Test-Path $nasPath) {
        Write-Success "NAS mount path exists: $nasPath"
        $script:PassedCount++

        # アクセス権限確認
        try {
            $testAccess = Get-ChildItem $nasPath -ErrorAction Stop | Select-Object -First 5
            Write-Success "Read permission: OK"
            Write-Info "Sample files/folders: $($testAccess.Count) items"
            $script:PassedCount++
        } catch {
            Write-Failure "No read permission for $nasPath"
            Write-Info "Check: net use"
            $script:FailedCount++
        }
    } else {
        Write-Failure "NAS mount path not found: $nasPath"
        Write-Info "Map network drive: net use Z: \\server\share /persistent:yes"
        $script:FailedCount++
    }
} else {
    Write-Warning-Custom "NAS_MOUNT_PATH not set in .env"
    $script:WarningCount++
}
Write-Host ""

# ==========================================
# Step 6: AWS 認証情報確認
# ==========================================
Write-Host "[Step 6/8] " -ForegroundColor Blue -NoNewline
Write-Host "AWS Credentials Check"
Write-Host "----------------------------------------"

# AWS CLI確認
try {
    $awsVersion = & aws --version 2>$null
    if ($awsVersion) {
        Write-Success "AWS CLI installed: $($awsVersion -split ' ' | Select-Object -First 1)"
        $script:PassedCount++

        # AWS認証情報テスト
        $s3BucketName = $null
        if (Test-Path ".env") {
            $envContent = Get-Content ".env"
            foreach ($line in $envContent) {
                if ($line -match "^S3_BUCKET_NAME=(.+)") {
                    $s3BucketName = $matches[1].Trim()
                    break
                }
            }
        }

        if ($s3BucketName) {
            try {
                $null = & aws s3 ls "s3://$s3BucketName/" 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "AWS credentials valid (S3 access confirmed)"
                    Write-Success "S3 bucket accessible: $s3BucketName"
                    $script:PassedCount += 2
                } else {
                    Write-Failure "Cannot access S3 bucket: $s3BucketName"
                    Write-Info "Check: aws configure"
                    $script:FailedCount++
                }
            } catch {
                Write-Failure "S3 access test failed"
                Write-Info "Check: aws configure"
                $script:FailedCount++
            }
        } else {
            Write-Warning-Custom "S3_BUCKET_NAME not set in .env"
            $script:WarningCount++
        }
    }
} catch {
    Write-Warning-Custom "AWS CLI not installed (optional)"
    Write-Info "Install: winget install Amazon.AWSCLI"
    $script:WarningCount++
}
Write-Host ""

# ==========================================
# Step 7: 依存関係インストール確認
# ==========================================
Write-Host "[Step 7/8] " -ForegroundColor Blue -NoNewline
Write-Host "Dependencies Check"
Write-Host "----------------------------------------"

if (Test-Path "node_modules") {
    Write-Success "node_modules exists"
    $script:PassedCount++

    # 主要パッケージ確認
    $criticalPackages = @("@aws-sdk/client-s3", "@aws-sdk/client-sqs", "sqlite3")
    foreach ($pkg in $criticalPackages) {
        if (Test-Path "node_modules/$pkg") {
            Write-Success "$pkg installed"
            $script:PassedCount++
        } else {
            Write-Warning-Custom "$pkg not found"
            $script:WarningCount++
        }
    }
} else {
    Write-Failure "node_modules not found"
    Write-Info "Run: yarn install"
    $script:FailedCount++
}
Write-Host ""

# ==========================================
# Step 8: ビルド確認
# ==========================================
Write-Host "[Step 8/8] " -ForegroundColor Blue -NoNewline
Write-Host "Build Check"
Write-Host "----------------------------------------"

if (Test-Path "dist\index.js") {
    Write-Success "dist\index.js exists"
    $script:PassedCount++

    # ファイルサイズ確認
    $fileSize = (Get-Item "dist\index.js").Length
    Write-Info "Build size: $([math]::Round($fileSize/1KB, 2)) KB"
} else {
    Write-Failure "dist\index.js not found"
    Write-Info "Run: yarn build"
    $script:FailedCount++
}
Write-Host ""

# ==========================================
# Optional: ドライラン実行
# ==========================================
Write-Host "[Optional] " -ForegroundColor Blue -NoNewline
Write-Host "Dry Run Test"
Write-Host "----------------------------------------"

$response = Read-Host "Run dry-run test? (y/n)"
if ($response -eq 'y' -or $response -eq 'Y') {
    if (Test-Path "dist\index.js") {
        Write-Info "Running dry-run scan..."
        Write-Host ""

        $env:DRY_RUN = "true"
        & node dist\index.js scan

        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Success "Dry-run completed successfully"
            $script:PassedCount++
        } else {
            Write-Host ""
            Write-Failure "Dry-run failed"
            $script:FailedCount++
        }
    } else {
        Write-Failure "Cannot run dry-run (build required)"
        $script:FailedCount++
    }
} else {
    Write-Info "Dry-run skipped"
}
Write-Host ""

# ==========================================
# 結果サマリー
# ==========================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "📊 Verification Summary" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  " -NoNewline
Write-Host "✓ Passed:   " -ForegroundColor Green -NoNewline
Write-Host $script:PassedCount
Write-Host "  " -NoNewline
Write-Host "⚠ Warnings: " -ForegroundColor Yellow -NoNewline
Write-Host $script:WarningCount
Write-Host "  " -NoNewline
Write-Host "✗ Failed:   " -ForegroundColor Red -NoNewline
Write-Host $script:FailedCount
Write-Host ""

if ($script:FailedCount -eq 0) {
    Write-Host "  " -NoNewline
    Write-Host "🎉 Setup verification completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next steps:"
    Write-Host "  1. Review your .env configuration"
    Write-Host "  2. Run: " -NoNewline
    Write-Host "DRY_RUN=true node dist/index.js scan" -ForegroundColor Cyan
    Write-Host "  3. If dry-run succeeds, run: " -NoNewline
    Write-Host "node dist/index.js scan" -ForegroundColor Cyan
    Write-Host ""
    exit 0
} else {
    Write-Host "  " -NoNewline
    Write-Host "⚠️  Setup verification failed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Please fix the issues above before proceeding."
    Write-Host "  Refer to " -NoNewline
    Write-Host "SETUP_PRODUCTION.md" -ForegroundColor Cyan -NoNewline
    Write-Host " for detailed instructions."
    Write-Host "  Or use the complete guide: " -NoNewline
    Write-Host "docs/deployment/windows-scanner-pc-setup-guide.md" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}
