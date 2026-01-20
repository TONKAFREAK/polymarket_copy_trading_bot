# Installation & Setup Guide

This guide covers the complete installation process for the Polymarket Copy Trading Bot.

## Prerequisites

Before starting, ensure you have the following installed:

1.  **Node.js**: Version 18.0.0 or higher is **required**.
    - Download: [nodejs.org](https://nodejs.org/)
    - Verify: `node --version`
2.  **Git**: For version control.
    - Download: [git-scm.com](https://git-scm.com/)
    - Verify: `git --version`
3.  **Polymarket Account**:
    - You need a funded Polygon (Matic) wallet address.
    - You need your API Keys (API Key, Secret, Passphrase). You can generate these in your Polymarket Profile settings.

---

## 1. Clone the Repository

Open your terminal or command prompt and run:

```bash
git clone https://github.com/yourusername/polymarket-trading-bot.git
cd polymarket-trading-bot
```

---

## 2. Automated Setup (Recommended)

We provide automated scripts to handle dependency installation and building.

### Windows

Double-click `setup.bat` or run it from Command Prompt:

```cmd
setup.bat
```

### macOS / Linux

Run the shell script:

```bash
chmod +x setup.sh
./setup.sh
```

**What the script does:**

1.  Checks if Node.js is installed.
2.  Installs root dependencies (`package.json`).
3.  Installs client dependencies (`client/package.json`).
4.  Builds the TypeScript backend.
5.  Builds the Electron + Next.js desktop application.

---

## 3. Manual Installation

If the automated script fails or you prefer manual control:

### Backend Setup

```bash
# Install root dependencies
npm install

# Build TypeScript code
npm run build
```

### Desktop Client Setup

```bash
cd client
# Install client dependencies
npm install

# Build the desktop app
npm run build
```

---

## 4. Environment Configuration

The application requires a `.env` file to store your credentials securely.

1.  **Copy the example file:**

    ```bash
    cp .env.example .env
    # On Windows: copy .env.example .env
    ```

2.  **Edit `.env`:**
    Open the file in any text editor and fill in your details.

    **Required for Live Trading:**
    - `POLY_API_KEY`: Your Polymarket API Key
    - `POLY_API_SECRET`: Your Polymarket API Secret
    - `POLY_PASSPHRASE`: Your Polymarket Passphrase
    - `PRIVATE_KEY`: Your wallet's private key (without `0x`)
    - `POLY_FUNDER_ADDRESS`: Your public wallet address

    **Optional/Defaults:**
    - `POLY_SIGNATURE_TYPE`: Set to `1` (Magic/Email) or `0` (Metamask).
    - `PAPER_TRADING`: Set to `true` to start in simulation mode.

---

## 5. Running the Application

### Desktop App (GUI)

Use the development script to launch the app:

**Windows:**

```cmd
dev.bat
# Select option 1
```

**macOS / Linux:**

```bash
./dev.sh
# Select option 1
```

### CLI Bot (Headless)

If you strictly want to run the copy trading logic without the UI:

```bash
npm run dev -- run
```

---

## Verification

To verify everything is working:

1.  Start the app.
2.  Go to the **Settings** tab.
3.  Check the bottom status bar for "Connected".
4.  If using the CLI, run `npm run dev -- status` to see the current configuration.
