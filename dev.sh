#!/bin/bash

# Polymarket Copy Trading Bot - Development Script (Mac/Linux)

echo ""
echo "========================================"
echo "  PMcopy - Development"
echo "========================================"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "[!] .env file not found"
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "[OK] Created .env from .env.example"
        echo "[!] Please edit .env with your API credentials"
        echo ""
    fi
fi

echo "Choose what to run:"
echo "  1) Desktop App (Electron + React)"
echo "  2) CLI Bot (Terminal)"
echo ""
read -p "Enter choice (1 or 2): " choice

case $choice in
    1)
        echo ""
        echo "Starting Desktop App..."
        npm run client
        ;;
    2)
        echo ""
        echo "Starting CLI Bot..."
        npm run cli
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac
