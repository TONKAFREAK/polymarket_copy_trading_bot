@echo off
REM Polymarket Copy Trading Bot - Setup Script (Windows)

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   PMcopy - Setup
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed.
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

echo [OK] Node.js version:
node --version
echo [OK] npm version:
npm --version
echo.

REM Install root dependencies (CLI)
echo [1/4] Installing CLI dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] Failed to install CLI dependencies
    pause
    exit /b 1
)
echo [OK] CLI dependencies installed
echo.

REM Install client dependencies (Desktop App)
echo [2/4] Installing Desktop App dependencies...
cd client
call npm install
if errorlevel 1 (
    echo [ERROR] Failed to install Desktop App dependencies
    cd ..
    pause
    exit /b 1
)
cd ..
echo [OK] Desktop App dependencies installed
echo.

REM Build CLI
echo [3/4] Building CLI...
call npm run build
if errorlevel 1 (
    echo [ERROR] Failed to build CLI
    pause
    exit /b 1
)
echo [OK] CLI built
echo.

REM Create .env if not exists
echo [4/4] Checking configuration...
if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo [OK] Created .env from .env.example
    )
)
echo.

echo ========================================
echo   Setup Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Edit .env with your Polymarket API credentials
echo   2. Run 'npm run client' to start the Desktop App
echo   3. Run 'npm run cli' to start the CLI Bot
echo.
pause
