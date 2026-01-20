#!/bin/bash

# Polymarket Copy Trading Bot - Development Script (Mac/Linux)
# Run the app in development mode

set -e

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   Polymarket Copy Trading Bot - Development                   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "✓ .env created - please fill in your API keys"
    echo ""
fi

echo "Choose which to run:"
echo "  1) Desktop App (Electron + Next.js)"
echo "  2) CLI Bot"
echo ""
read -p "Enter your choice (1 or 2): " choice

case $choice in
    1)
        echo "Starting Desktop App..."
        cd client
        npm run dev
        ;;
    2)
        echo "Starting CLI Bot..."
        npm run dev
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac
