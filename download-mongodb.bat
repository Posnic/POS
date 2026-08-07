@echo off
echo ========================================
echo Downloading MongoDB for Posnic
echo ========================================
echo.
echo This will download MongoDB 7.0 (portable version)
echo and set it up in your project folder.
echo.
pause

set MONGODB_VERSION=7.0.14
set DOWNLOAD_URL=https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-%MONGODB_VERSION%.zip
set DOWNLOAD_FILE=mongodb.zip
set EXTRACT_FOLDER=mongodb-temp

echo.
echo Downloading MongoDB %MONGODB_VERSION%...
echo URL: %DOWNLOAD_URL%
echo.

powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%DOWNLOAD_FILE%'}"

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Download failed!
    echo.
    echo Please download manually from:
    echo https://www.mongodb.com/try/download/community
    echo.
    echo Choose: Windows x64, ZIP (not MSI)
    echo Save as: mongodb.zip in this folder
    echo Then run: setup-bundled-mongodb.bat
    pause
    exit /b 1
)

echo.
echo Download complete!
echo.
echo Extracting MongoDB...

powershell -Command "Expand-Archive -Path '%DOWNLOAD_FILE%' -DestinationPath '%EXTRACT_FOLDER%' -Force"

if %errorlevel% neq 0 (
    echo ERROR: Extraction failed!
    pause
    exit /b 1
)

echo.
echo Setting up MongoDB folder structure...

if not exist "mongodb" mkdir mongodb
if not exist "mongodb\bin" mkdir mongodb\bin

echo.
echo Copying MongoDB binaries...

xcopy /E /I /Y "%EXTRACT_FOLDER%\mongodb-win32-x86_64-windows-%MONGODB_VERSION%\bin\*" "mongodb\bin\"

echo.
echo Cleaning up temporary files...

rmdir /S /Q "%EXTRACT_FOLDER%"
del "%DOWNLOAD_FILE%"

echo.
echo Creating data and log directories...

if not exist "mongodb\data" mkdir mongodb\data
if not exist "mongodb\log" mkdir mongodb\log

echo.
echo ========================================
echo MongoDB Setup Complete!
echo ========================================
echo.
echo MongoDB is now bundled with your project at:
echo %CD%\mongodb
echo.
echo Next steps:
echo 1. MongoDB will start automatically with Posnic
echo 2. No external installation needed
echo 3. All data stored in: mongodb\data
echo.
pause
