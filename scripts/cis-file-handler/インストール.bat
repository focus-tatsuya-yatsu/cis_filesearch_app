@echo off
chcp 65001 >nul
title CIS File Handler インストール

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║      CIS File Handler インストーラー v2.0                 ║
echo ║      NASファイル直接オープン機能                          ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Check if required files exist
if not exist "%SCRIPT_DIR%cis-open-handler.bat" (
    echo [エラー] cis-open-handler.bat が見つかりません。
    echo.
    echo 同じフォルダに以下のファイルがあることを確認してください：
    echo   - cis-open-handler.bat
    echo   - setup.ps1
    echo.
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%setup.ps1" (
    echo [エラー] setup.ps1 が見つかりません。
    echo.
    echo 同じフォルダに以下のファイルがあることを確認してください：
    echo   - cis-open-handler.bat
    echo   - setup.ps1
    echo.
    pause
    exit /b 1
)

echo インストールを開始します...
echo.
echo ※ファイルをローカルにコピーしてプロトコルを登録します
echo.

REM Run PowerShell setup script
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup.ps1"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ╔═══════════════════════════════════════════════════════════╗
    echo ║  インストールが完了しました！                              ║
    echo ║                                                           ║
    echo ║  CIS File Search アプリで「ファイルを開く」ボタン          ║
    echo ║  （緑色のフォルダアイコン）が使えるようになりました。       ║
    echo ║                                                           ║
    echo ║  ※このフォルダは削除しても大丈夫です                       ║
    echo ╚═══════════════════════════════════════════════════════════╝
) else (
    echo.
    echo [エラー] インストールに失敗しました。
    echo.
    echo 考えられる原因：
    echo   - PowerShellの実行ポリシーが制限されている
    echo   - ファイルへのアクセス権限がない
    echo.
    echo IT管理者にお問い合わせください。
)

echo.
echo 何かキーを押すと閉じます...
pause >nul
