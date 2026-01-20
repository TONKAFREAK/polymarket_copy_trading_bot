@echo off
REM Polymarket Copy Trading Bot - Setup Script (Windows)
REM This script installs all dependencies and builds the project

setlocal enabledelayedexpansion

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║   Polymarket Copy Trading Bot - Setup                         ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed.
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

echo ✓ Node.js version:
node --version
echo ✓ npm version:
npm --version
echo.

REM Install root dependencies
echo 📦 Installing root dependencies...
call npm install
if errorlevel 1 (
    echo ❌ Failed to install root dependencies
    pause
    exit /b 1
)
echo ✓ Root dependencies installed
echo.

REM Install client dependencies
echo 📦 Installing client dependencies...
cd client
call npm install
if errorlevel 1 (
    echo ❌ Failed to install client dependencies
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✓ Client dependencies installed
echo.

REM Build root project
echo 🔨 Building root project (TypeScript)...
call npm run build
if errorlevel 1 (
    echo ❌ Failed to build root project
    pause
    exit /b 1
)
echo ✓ Root project built
echo.

REM Build client
echo 🔨 Building client (Next.js + Electron)...
cd client
call npm run build
if errorlevel 1 (
    echo ❌ Failed to build client
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✓ Client built
echo.

echo ╔════════════════════════════════════════════════════════════════╗
echo ║   ✓ Setup Complete!                                           ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.
echo Next steps:
echo   1. Copy .env.example to .env and fill in your API keys
echo   2. Run 'npm run dev-desktop' to start the desktop app
echo   3. Or run 'npm run dev-cli' to use the CLI
echo.
pause
