@echo off
title CIS File Handler Setup

echo.
echo ========================================================
echo   CIS File Handler Installer v2.0
echo   NAS File Direct Open Feature
echo ========================================================
echo.

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Check if required files exist
if not exist "%SCRIPT_DIR%cis-open-handler.bat" (
    echo [ERROR] cis-open-handler.bat not found.
    echo.
    echo Please make sure the following files are in the same folder:
    echo   - cis-open-handler.bat
    echo   - setup.ps1
    echo.
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%setup.ps1" (
    echo [ERROR] setup.ps1 not found.
    echo.
    echo Please make sure the following files are in the same folder:
    echo   - cis-open-handler.bat
    echo   - setup.ps1
    echo.
    pause
    exit /b 1
)

echo Starting installation...
echo.

REM Run PowerShell setup script
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup.ps1"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   Installation completed successfully!
    echo.
    echo   You can now use the "Open in Explorer" button
    echo   [green folder icon] in CIS File Search.
    echo.
    echo   * You can delete this folder after installation
    echo ========================================================
) else (
    echo.
    echo [ERROR] Installation failed.
    echo.
    echo Possible causes:
    echo   - PowerShell execution policy is restricted
    echo   - No permission to access files
    echo.
    echo Please contact IT administrator.
)

echo.
echo Press any key to close...
pause >nul
