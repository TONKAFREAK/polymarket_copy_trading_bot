#!/bin/bash

# Polymarket Copy Trading Bot - Setup Script
# This script installs all dependencies and builds the project

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   Polymarket Copy Trading Bot - Setup                         ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

echo "✓ Node.js version: $(node --version)"
echo "✓ npm version: $(npm --version)"
echo ""

# Install root dependencies
echo "📦 Installing root dependencies..."
npm install
echo "✓ Root dependencies installed"
echo ""

# Install client dependencies
echo "📦 Installing client dependencies..."
cd client
npm install
cd ..
echo "✓ Client dependencies installed"
echo ""

# Build root project
echo "🔨 Building root project (TypeScript)..."
npm run build
echo "✓ Root project built"
echo ""

# Build client
echo "🔨 Building client (Next.js + Electron)..."
cd client
npm run build
cd ..
echo "✓ Client built"
echo ""

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   ✓ Setup Complete!                                           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Copy .env.example to .env and fill in your API keys"
echo "  2. Run 'npm run dev-desktop' to start the desktop app"
echo "  3. Or run 'npm run dev-cli' to use the CLI"
echo ""
