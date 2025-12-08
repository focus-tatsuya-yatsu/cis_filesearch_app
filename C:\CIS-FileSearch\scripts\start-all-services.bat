@echo off
echo ===========================================
echo CIS FileSearch 統合サービス起動
echo ===========================================
echo.
echo 開始時刻: %date% %time%
echo.

REM DocuWorks変換サービスを別ウィンドウで起動
echo [1/2] DocuWorks変換サービスを起動中...
start "DocuWorks Converter" /min cmd /c "cd /d C:\CIS-FileSearch\scripts && powershell.exe -NoProfile -ExecutionPolicy Bypass -File converter-task.ps1"
echo      ✓ DocuWorks変換サービスが起動しました
echo.

REM 少し待機
timeout /t 3 /nobreak > nul

REM DataSync監視サービスを別ウィンドウで起動
echo [2/2] DataSync監視サービスを起動中...
start "DataSync Monitor" /min cmd /c "cd /d C:\CIS-FileSearch\scripts && powershell.exe -NoProfile -ExecutionPolicy Bypass -File datasync-monitor.ps1"
echo      ✓ DataSync監視サービスが起動しました
echo.

echo ===========================================
echo すべてのサービスが起動しました
echo ===========================================
echo.
echo サービスステータス:
echo   - DocuWorks Converter: 実行中（incoming フォルダを監視）
echo   - DataSync Monitor: 実行中（converted フォルダを監視）
echo.
echo 処理フロー:
echo   incoming → [DocuWorks変換] → converted → [S3アップロード] → archive
echo.
echo このウィンドウは閉じても大丈夫です。
echo サービスはバックグラウンドで実行されています。
echo.
timeout /t 10