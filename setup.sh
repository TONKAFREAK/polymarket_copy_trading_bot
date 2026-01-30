#!/bin/bash

# Polymarket Copy Trading Bot - Setup Script (Mac/Linux)

set -e

echo ""
echo "========================================"
echo "  PMcopy - Setup"
echo "========================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed."
    echo "Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

echo "[OK] Node.js version: $(node --version)"
echo "[OK] npm version: $(npm --version)"
echo ""

# Install root dependencies (CLI)
echo "[1/4] Installing CLI dependencies..."
npm install
echo "[OK] CLI dependencies installed"
echo ""

# Install client dependencies (Desktop App)
echo "[2/4] Installing Desktop App dependencies..."
cd client
npm install
cd ..
echo "[OK] Desktop App dependencies installed"
echo ""

# Build CLI
echo "[3/4] Building CLI..."
npm run build
echo "[OK] CLI built"
echo ""

# Create .env if not exists
echo "[4/4] Checking configuration..."
if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    echo "[OK] Created .env from .env.example"
fi
echo ""

echo "========================================"
echo "  Setup Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your Polymarket API credentials"
echo "  2. Run 'npm run client' to start the Desktop App"
echo "  3. Run 'npm run cli' to start the CLI Bot"
echo ""
