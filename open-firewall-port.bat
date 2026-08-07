@echo off
echo Adding Windows Firewall rule for POSNIC API port 5555...
netsh advfirewall firewall delete rule name="POSNIC API 5555" >nul 2>&1
netsh advfirewall firewall add rule name="POSNIC API 5555" dir=in action=allow protocol=TCP localport=5555 profile=any
if %errorlevel%==0 (
    echo SUCCESS! Port 5555 is now open for all network connections.
) else (
    echo FAILED. Please run this file as Administrator.
)
pause
