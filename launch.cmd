@echo off
setlocal

rem Note: If running on a remote server or over SSH, use ./start.sh (or ./launch.sh).
rem For remote access, browse to the server's Tailscale/LAN IP or use SSH port forwarding.

rem Start the Vite server in its own window from this project directory.
cd /d "%~dp0"
start "Personal Budget Tracker server" cmd.exe /k "cd /d ""%~dp0"" && npm.cmd run dev"

rem Give Vite a moment to start, then open the local app.
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5173/"

endlocal
