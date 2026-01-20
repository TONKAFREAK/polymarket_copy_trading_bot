@echo off
REM Polymarket Copy Trading Bot - Development Script (Windows)
REM Run the app in development mode

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║   Polymarket Copy Trading Bot - Development                   ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

REM Check if .env file exists
if not exist .env (
    echo ⚠️  .env file not found!
    echo Creating .env from .env.example...
    copy .env.example .env
    echo ✓ .env created - please fill in your API keys
)

echo.
echo Starting development mode...
echo Choose which to run:
echo   1) Desktop App (Electron + Next.js)
echo   2) CLI Bot
echo.
set /p choice="Enter your choice (1 or 2): "

if "%choice%"=="1" (
    echo Starting Desktop App...
    cd client
    call npm run dev
) else if "%choice%"=="2" (
    echo Starting CLI Bot...
    call npm run dev
) else (
    echo Invalid choice
    pause
    exit /b 1
)
