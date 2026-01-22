@echo off
setlocal enabledelayedexpansion

REM CIS File Handler - Opens NAS files from cis-open:// protocol
REM Usage: cis-open-handler.bat "cis-open://\\server\share\file.txt"

REM Get the full URL passed as argument
set "url=%~1"

REM Log the received URL (for debugging)
REM echo Received URL: %url% >> "%TEMP%\cis-open-handler.log"

REM Check if URL is empty
if "%url%"=="" (
    echo Error: No URL provided
    exit /b 1
)

REM Remove the protocol prefix (cis-open://)
set "path=!url:cis-open://=!"

REM URL decode common characters
REM Decode backslashes (%%5C -> \)
set "path=!path:%%5C=\!"
set "path=!path:%%5c=\!"

REM Decode spaces (%%20 -> space)
set "path=!path:%%20= !"

REM Decode forward slashes (%%2F -> /)
set "path=!path:%%2F=/!"
set "path=!path:%%2f=/!"

REM Decode colons (%%3A -> :)
set "path=!path:%%3A=:!"
set "path=!path:%%3a=:!"

REM Decode Japanese characters and other special characters
REM Note: Most Japanese characters will already be properly handled
REM if they were properly encoded in UTF-8

REM Security check: Only allow UNC paths starting with \\ts-server
REM This prevents arbitrary file access
echo !path! | findstr /i /r "^\\\\ts-server[0-9]*\\" >nul
if errorlevel 1 (
    echo Error: Only NAS server paths are allowed
    echo Path must start with \\ts-server
    REM echo Security violation: %path% >> "%TEMP%\cis-open-handler.log"
    exit /b 1
)

REM Log the decoded path (for debugging)
REM echo Decoded path: %path% >> "%TEMP%\cis-open-handler.log"

REM Check if the path is a file or directory
if exist "!path!\" (
    REM It's a directory - open in Explorer
    explorer.exe "!path!"
) else if exist "!path!" (
    REM It's a file - open with default application
    start "" "!path!"
) else (
    REM Path doesn't exist - still try to open parent folder in Explorer
    REM Extract the parent directory
    for %%F in ("!path!") do set "parentDir=%%~dpF"

    if exist "!parentDir!" (
        explorer.exe "!parentDir!"
    ) else (
        REM Try to open just the server share root
        for /f "tokens=1,2,3 delims=\" %%a in ("!path!") do (
            set "serverShare=\\%%b\%%c"
        )
        explorer.exe "!serverShare!"
    )
)

exit /b 0
