###############################################################################
# 01-test-nas-connection.ps1
# 目的: DataSync Agent VMからNASへの接続テスト
# 実行タイミング: クライアント先
# 実行場所: Hyper-V VMまたはスキャナPC
###############################################################################

param(
    [Parameter(Mandatory=$true)]
    [string]$NasServer,

    [Parameter(Mandatory=$true)]
    [string]$SharePath,

    [Parameter(Mandatory=$true)]
    [string]$Username,

    [Parameter(Mandatory=$true)]
    [Security.SecureString]$Password,

    [Parameter(Mandatory=$false)]
    [string]$Domain = ""
)

Write-Host "=========================================="
Write-Host "NAS接続テスト"
Write-Host "=========================================="
Write-Host ""

# 接続情報表示
Write-Host "NAS Server: $NasServer"
Write-Host "Share Path: $SharePath"
Write-Host "Username: $Username"
Write-Host "Domain: $(if ($Domain) { $Domain } else { '(なし)' })"
Write-Host ""

# Ping テスト
Write-Host "Step 1: Ping テスト"
$pingResult = Test-Connection -ComputerName $NasServer -Count 4 -ErrorAction SilentlyContinue

if ($pingResult) {
    Write-Host "   ✅ Ping成功"
    Write-Host "   平均応答時間: $($pingResult.ResponseTime | Measure-Object -Average | Select-Object -ExpandProperty Average)ms"
} else {
    Write-Host "   ❌ Ping失敗 - NASサーバーに到達できません"
    exit 1
}

Write-Host ""

# SMB接続テスト
Write-Host "Step 2: SMB接続テスト"

$uncPath = "\\$NasServer\$SharePath"
Write-Host "   UNCパス: $uncPath"

try {
    # 既存の接続を削除
    net use $uncPath /delete 2>$null

    # パスワードを平文に変換（一時的）
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    $PlainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

    # ドメイン付きユーザー名
    $fullUsername = if ($Domain) { "$Domain\$Username" } else { $Username }

    # 接続試行
    $netUseCmd = "net use $uncPath /user:$fullUsername $PlainPassword"
    Invoke-Expression $netUseCmd | Out-Null

    Write-Host "   ✅ SMB接続成功"

    # ファイル一覧取得テスト
    Write-Host ""
    Write-Host "Step 3: ファイル一覧取得テスト"
    $files = Get-ChildItem -Path $uncPath -ErrorAction Stop | Select-Object -First 5

    Write-Host "   ✅ ファイル一覧取得成功"
    Write-Host "   最初の5ファイル:"
    $files | ForEach-Object {
        Write-Host "      - $($_.Name) ($($_.Length) bytes)"
    }

    # 読み取りテスト
    Write-Host ""
    Write-Host "Step 4: ファイル読み取りテスト"
    $testFile = $files | Where-Object { -not $_.PSIsContainer } | Select-Object -First 1

    if ($testFile) {
        $content = Get-Content -Path $testFile.FullName -TotalCount 10 -ErrorAction Stop
        Write-Host "   ✅ ファイル読み取り成功"
        Write-Host "   テストファイル: $($testFile.Name)"
    } else {
        Write-Host "   ⚠️  読み取りテスト用のファイルが見つかりません"
    }

    # 接続解除
    net use $uncPath /delete 2>$null

    Write-Host ""
    Write-Host "=========================================="
    Write-Host "✅ NAS接続テスト完了 - すべて成功"
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "次のステップ:"
    Write-Host "  DataSync NAS Location作成スクリプトを実行してください"
    Write-Host ""

} catch {
    Write-Host "   ❌ エラー: $_"

    # 接続解除（エラー時）
    net use $uncPath /delete 2>$null

    Write-Host ""
    Write-Host "=========================================="
    Write-Host "❌ NAS接続テスト失敗"
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "トラブルシューティング:"
    Write-Host "  1. NASサーバー名/IPアドレスが正しいか確認"
    Write-Host "  2. 共有フォルダパスが正しいか確認"
    Write-Host "  3. ユーザー名/パスワードが正しいか確認"
    Write-Host "  4. ファイアウォール設定を確認（SMB: TCP 445）"
    Write-Host "  5. ドメイン名が必要な場合は指定"
    Write-Host ""

    exit 1
}
