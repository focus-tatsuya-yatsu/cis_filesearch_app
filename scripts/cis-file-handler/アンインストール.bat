@echo off
chcp 65001 >nul
title CIS File Handler アンインストール

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║      CIS File Handler アンインストーラー                  ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

echo アンインストールを開始します...
echo.

REM Run PowerShell script
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%uninstall.ps1"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ╔═══════════════════════════════════════════════════════════╗
    echo ║  アンインストールが完了しました。                          ║
    echo ╚═══════════════════════════════════════════════════════════╝
) else (
    echo.
    echo [エラー] アンインストールに失敗しました。
)

echo.
echo 何かキーを押すと閉じます...
pause >nul
