@echo off
echo ===================================================
echo   BoxOffice65 - Demo Launcher
echo ===================================================
echo.
echo [1/3] Building project (if needed)...
call npm install
call npm run build

echo.
echo [2/3] Starting Server...
echo The app will be available at http://localhost:3001
echo (Do not close this window)
echo.

start http://localhost:3001
call npm run start

pause

