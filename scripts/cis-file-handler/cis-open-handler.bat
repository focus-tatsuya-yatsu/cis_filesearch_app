@echo off
setlocal enabledelayedexpansion

REM ========================================================================
REM CIS File Handler - Opens NAS files from cis-open:// protocol
REM Version: 2.0 (Security Enhanced)
REM
REM Usage: cis-open-handler.bat "cis-open://\\server\share\file.txt"
REM
REM Security measures:
REM   - Strict server whitelist (ts-server3, ts-server5, ts-server6, ts-server7)
REM   - Command injection prevention
REM   - Path traversal prevention
REM   - URL double-encoding attack prevention
REM ========================================================================

REM Get the full URL passed as argument
set "url=%~1"

REM Check if URL is empty
if "%url%"=="" (
    echo Error: No URL provided
    exit /b 1
)

REM Remove the protocol prefix (cis-open://)
set "path=!url:cis-open://=!"

REM ========================================================================
REM URL Decoding (multiple passes to prevent double-encoding attacks)
REM ========================================================================

REM First pass of URL decoding
call :UrlDecode path

REM Second pass to catch double-encoded characters
call :UrlDecode path

REM ========================================================================
REM Security Check 1: Dangerous characters (Command Injection Prevention)
REM ========================================================================

REM Check for shell metacharacters that could enable command injection
REM Characters: & | < > ^ ! ; ` $ ( )
for %%C in ("&" "|" "<" ">" "^" "!" ";" "`" "$" "(" ")") do (
    echo !path! | findstr /C:%%C >nul 2>&1
    if !errorlevel!==0 (
        echo Error: Invalid characters detected in path
        echo Security violation: potential command injection
        exit /b 1
    )
)

REM ========================================================================
REM Security Check 2: Path Traversal Prevention
REM ========================================================================

REM Check for ".." sequences that could escape the allowed directory
echo !path! | findstr /i "\.\." >nul 2>&1
if !errorlevel!==0 (
    echo Error: Path traversal detected
    echo Security violation: ".." is not allowed in paths
    exit /b 1
)

REM Check for encoded path traversal attempts
echo !path! | findstr /i "%%2e%%2e" >nul 2>&1
if !errorlevel!==0 (
    echo Error: Encoded path traversal detected
    exit /b 1
)

REM ========================================================================
REM Security Check 3: Strict Server Whitelist
REM ========================================================================

REM Only allow specific NAS servers (strict list, not pattern)
set "server_allowed=0"

REM Extract server name from path (assumes UNC path format: \\server\share\...)
for /f "tokens=1 delims=\" %%a in ("!path:~2!") do (
    set "server_name=%%a"
)

REM Check against whitelist of allowed servers
if /i "!server_name!"=="ts-server3" set "server_allowed=1"
if /i "!server_name!"=="ts-server5" set "server_allowed=1"
if /i "!server_name!"=="ts-server6" set "server_allowed=1"
if /i "!server_name!"=="ts-server7" set "server_allowed=1"

if "!server_allowed!"=="0" (
    echo Error: Server "!server_name!" is not in the allowed list
    echo Allowed servers: ts-server3, ts-server5, ts-server6, ts-server7
    exit /b 1
)

REM ========================================================================
REM Security Check 4: Path format validation
REM ========================================================================

REM Ensure path starts with \\ (UNC format)
echo !path! | findstr /r "^\\\\" >nul
if errorlevel 1 (
    echo Error: Invalid path format (must be UNC path starting with \\)
    exit /b 1
)

REM ========================================================================
REM Open the file/directory
REM ========================================================================

REM Check if the path is a file or directory
if exist "!path!\" (
    REM It's a directory - open in Explorer
    explorer.exe "!path!"
) else if exist "!path!" (
    REM It's a file - open with default application
    start "" "!path!"
) else (
    REM Path doesn't exist - try to open parent folder in Explorer
    for %%F in ("!path!") do set "parentDir=%%~dpF"

    if exist "!parentDir!" (
        explorer.exe "!parentDir!"
    ) else (
        REM Try to open just the server share root
        for /f "tokens=1,2 delims=\" %%a in ("!path:~2!") do (
            set "serverShare=\\%%a\%%b"
        )
        if exist "!serverShare!\" (
            explorer.exe "!serverShare!"
        ) else (
            echo Error: Path not accessible
            echo Path: !path!
            exit /b 1
        )
    )
)

exit /b 0

REM ========================================================================
REM Subroutine: URL Decode
REM ========================================================================
:UrlDecode
REM Decode common URL-encoded characters

REM Decode backslashes (%%5C -> \)
set "%1=!%1:%%5C=\!"
set "%1=!%1:%%5c=\!"

REM Decode forward slashes (%%2F -> /)
set "%1=!%1:%%2F=/!"
set "%1=!%1:%%2f=/!"

REM Decode spaces (%%20 -> space)
set "%1=!%1:%%20= !"

REM Decode colons (%%3A -> :)
set "%1=!%1:%%3A=:!"
set "%1=!%1:%%3a=:!"

REM Decode plus as space (common in URLs)
set "%1=!%1:+= !"

REM Decode percent sign (%%25 -> %%)
set "%1=!%1:%%25=%%!"

REM Convert forward slashes to backslashes for Windows paths
set "%1=!%1:/=\!"

goto :eof
