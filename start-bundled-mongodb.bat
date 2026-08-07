@echo off
echo Starting bundled MongoDB...

set MONGODB_PATH=%~dp0mongodb
set MONGODB_BIN=%MONGODB_PATH%\bin
set MONGODB_DATA=%MONGODB_PATH%\data
set MONGODB_LOG=%MONGODB_PATH%\log

if not exist "%MONGODB_BIN%\mongod.exe" (
    echo ERROR: MongoDB not found!
    echo Please run: download-mongodb.bat first
    exit /b 1
)

if not exist "%MONGODB_DATA%" mkdir "%MONGODB_DATA%"
if not exist "%MONGODB_LOG%" mkdir "%MONGODB_LOG%"

echo MongoDB Path: %MONGODB_BIN%
echo Data Path: %MONGODB_DATA%
echo.

start "MongoDB" "%MONGODB_BIN%\mongod.exe" --dbpath "%MONGODB_DATA%" --logpath "%MONGODB_LOG%\mongodb.log" --port 27017

echo MongoDB started!
echo.
echo Press any key to stop MongoDB...
pause > nul

taskkill /FI "WINDOWTITLE eq MongoDB*" /T /F
