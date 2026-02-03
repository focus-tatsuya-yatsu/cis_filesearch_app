@echo off
title CIS File Handler Uninstall

echo.
echo ========================================================
echo   CIS File Handler Uninstaller
echo   Remove NAS File Direct Open Feature
echo ========================================================
echo.

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Check if setup.ps1 exists
if not exist "%SCRIPT_DIR%setup.ps1" (
    echo [WARNING] setup.ps1 not found.
    echo Removing registry and files directly...
    echo.

    REM Manual cleanup
    echo Removing registry...
    reg delete "HKCU\Software\Classes\cis-open" /f >nul 2>&1

    echo Removing installation directory...
    rmdir /s /q "%LOCALAPPDATA%\CIS\FileHandler" >nul 2>&1

    echo.
    echo Uninstallation completed.

    echo.
    pause
    exit /b 0
)

echo Starting uninstallation...
echo.

REM Run PowerShell setup script with -Uninstall flag
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup.ps1" -Uninstall

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   Uninstallation completed successfully!
    echo.
    echo   The cis-open:// protocol handler has been removed.
    echo.
    echo   You can still use the "Copy Path" feature.
    echo ========================================================
) else (
    echo.
    echo [ERROR] Uninstallation failed.
    echo Please contact IT administrator.
)

echo.
echo Press any key to close...
pause >nul
