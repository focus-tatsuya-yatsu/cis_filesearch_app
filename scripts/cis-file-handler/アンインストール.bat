@echo off
chcp 65001 >nul
title CIS File Handler アンインストール

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║      CIS File Handler アンインストーラー                   ║
echo ║      NASファイル直接オープン機能の削除                      ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Check if setup.ps1 exists
if not exist "%SCRIPT_DIR%setup.ps1" (
    echo [警告] setup.ps1 が見つかりません。
    echo 直接レジストリとファイルを削除します...
    echo.

    REM Fallback: Use uninstall.ps1 if it exists
    if exist "%SCRIPT_DIR%uninstall.ps1" (
        powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%uninstall.ps1"
    ) else (
        REM Manual cleanup
        echo レジストリを削除中...
        reg delete "HKCU\Software\Classes\cis-open" /f >nul 2>&1

        echo インストールディレクトリを削除中...
        rmdir /s /q "%LOCALAPPDATA%\CIS\FileHandler" >nul 2>&1

        echo.
        echo アンインストールが完了しました。
    )

    echo.
    pause
    exit /b 0
)

echo アンインストールを開始します...
echo.

REM Run PowerShell setup script with -Uninstall flag
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup.ps1" -Uninstall

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ╔═══════════════════════════════════════════════════════════╗
    echo ║  アンインストールが完了しました！                          ║
    echo ║                                                           ║
    echo ║  cis-open:// プロトコルハンドラーが削除されました。        ║
    echo ║                                                           ║
    echo ║  引き続き「パスをコピー」機能はご利用いただけます。        ║
    echo ╚═══════════════════════════════════════════════════════════╝
) else (
    echo.
    echo [エラー] アンインストールに失敗しました。
    echo IT管理者にお問い合わせください。
)

echo.
echo 何かキーを押すと閉じます...
pause >nul
