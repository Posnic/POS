@echo off
REM Always work at the repo root, wherever this was launched from
cd /d "%~dp0.."
echo ========================================
echo MongoDB Installation Helper
echo ========================================
echo.
echo MongoDB is required for Posnic to work.
echo.
echo This script will help you download and install MongoDB.
echo.
pause
echo.
echo Opening MongoDB download page...
echo.
start https://www.mongodb.com/try/download/community
echo.
echo ========================================
echo INSTALLATION INSTRUCTIONS
echo ========================================
echo.
echo 1. Download MongoDB Community Server (Windows x64, MSI)
echo.
echo 2. Run the installer and follow these steps:
echo    - Choose "Complete" installation
echo    - CHECK "Install MongoDB as a Service"
echo    - Service Name: MongoDB
echo    - UNCHECK "Install MongoDB Compass" (optional)
echo.
echo 3. After installation, verify service is running:
echo    - Press Win+R, type: services.msc
echo    - Find "MongoDB" service
echo    - Status should be "Running"
echo.
echo 4. Restart Posnic application
echo.
echo ========================================
echo.
pause
