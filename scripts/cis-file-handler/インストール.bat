@echo off
chcp 65001 >nul
title CIS File Handler インストール

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║      CIS File Handler インストーラー                      ║
echo ║      NASファイル直接オープン機能                          ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Check if handler file exists
if not exist "%SCRIPT_DIR%cis-open-handler.bat" (
    echo [エラー] cis-open-handler.bat が見つかりません。
    echo 同じフォルダに以下のファイルがあることを確認してください：
    echo   - cis-open-handler.bat
    echo.
    pause
    exit /b 1
)

echo インストールを開始します...
echo.

REM Run PowerShell script
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install.ps1"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ╔═══════════════════════════════════════════════════════════╗
    echo ║  インストールが完了しました！                              ║
    echo ║                                                           ║
    echo ║  CIS File Search アプリで「ファイルを開く」ボタンが        ║
    echo ║  使えるようになりました。                                  ║
    echo ╚═══════════════════════════════════════════════════════════╝
) else (
    echo.
    echo [エラー] インストールに失敗しました。
    echo IT管理者にお問い合わせください。
)

echo.
echo 何かキーを押すと閉じます...
pause >nul
