@echo off
setlocal
echo ===================================================
echo   BoxOffice65 - Demo Launcher
echo ===================================================
echo.

rem Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b
)

echo [1/3] Building project (if needed)...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b
)

call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] npm run build failed.
    pause
    exit /b
)

echo.
echo [2/3] Starting Server...
echo The app will be available at http://localhost:3001
echo (Do not close this window)
echo.

start http://localhost:3001
call npm run start

pause
