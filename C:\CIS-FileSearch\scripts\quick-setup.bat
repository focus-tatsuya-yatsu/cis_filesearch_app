@echo off
echo ===========================================
echo CIS FileSearch クイックセットアップ
echo ===========================================
echo.

REM 管理者権限の確認
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo エラー: このスクリプトは管理者権限で実行する必要があります
    echo 右クリックして「管理者として実行」を選択してください
    pause
    exit /b 1
)

echo [1/4] 既存のタスクを削除中...
schtasks /delete /tn "CIS-FileSearch-Service" /f >nul 2>&1
schtasks /delete /tn "DocuWorks-Converter" /f >nul 2>&1
echo      ✓ 完了
echo.

echo [2/4] 新しいタスクを登録中...
schtasks /create /xml "C:\CIS-FileSearch\scripts\CIS-FileSearch-Task.xml" /tn "CIS-FileSearch-Service"
if %errorLevel% eq 0 (
    echo      ✓ タスクが正常に登録されました
) else (
    echo      ✗ タスクの登録に失敗しました
    pause
    exit /b 1
)
echo.

echo [3/4] サービスを起動中...
schtasks /run /tn "CIS-FileSearch-Service"
echo      ✓ サービスが起動しました
echo.

echo [4/4] セットアップの検証中...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\CIS-FileSearch\scripts\verify-setup.ps1"
echo.

echo ===========================================
echo セットアップ完了！
echo ===========================================
echo.
echo 次のステップ:
echo 1. .xdw ファイルを C:\CIS-FileSearch\incoming に配置
echo 2. 自動的にPDFに変換されます
echo 3. S3にアップロード後、archiveフォルダに移動されます
echo.
echo ログファイル:
echo   C:\CIS-FileSearch\logs\
echo.
pause