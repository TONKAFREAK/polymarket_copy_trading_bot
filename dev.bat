@echo off
REM Polymarket Copy Trading Bot - Development Script (Windows)

echo.
echo ========================================
echo   PMcopy - Development
echo ========================================
echo.

REM Check if .env file exists
if not exist .env (
    echo [!] .env file not found
    if exist .env.example (
        copy .env.example .env >nul
        echo [OK] Created .env from .env.example
        echo [!] Please edit .env with your API credentials
        echo.
    )
)

echo Choose what to run:
echo   1) Desktop App (Electron + React)
echo   2) CLI Bot (Terminal)
echo.
set /p choice="Enter choice (1 or 2): "

if "%choice%"=="1" (
    echo.
    echo Starting Desktop App...
    npm run client
) else if "%choice%"=="2" (
    echo.
    echo Starting CLI Bot...
    npm run cli
) else (
    echo Invalid choice
    pause
    exit /b 1
)
