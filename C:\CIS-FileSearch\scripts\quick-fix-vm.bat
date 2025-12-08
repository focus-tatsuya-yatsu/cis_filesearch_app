@echo off
echo ================================================
echo     DataSync VM クイックフィックス
echo ================================================
echo.

REM 管理者権限チェック
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 管理者権限が必要です
    echo    右クリック → 管理者として実行
    pause
    exit /b 1
)

echo ステップ1: VHDXファイルダウンロード
echo.
powershell -ExecutionPolicy Bypass -File "C:\CIS-FileSearch\scripts\DOWNLOAD-VHDX-MANUAL.ps1"

echo.
echo ステップ2: VM作成再実行
echo.
choice /C YN /M "VM作成を再実行しますか？"
if %errorlevel% == 1 (
    powershell -ExecutionPolicy Bypass -File "C:\CIS-FileSearch\scripts\HYPER-V-DATASYNC-QUICK-SETUP.ps1"
)

echo.
echo ✅ 完了
pause