@echo off
REM ========================================================================
REM CIS File Handler - Wrapper that calls PowerShell handler
REM Version: 2.3 (Production)
REM ========================================================================

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Call PowerShell script with hidden window
powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "%SCRIPT_DIR%cis-open-handler.ps1" "%~1"
