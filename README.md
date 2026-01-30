# PMcopy - Polymarket Copy Trading Bot

A professional copy trading platform for Polymarket. Monitor whale traders in real-time and automatically copy their trades.

![Screenshot](hero.png)

**Discord**: https://discord.gg/ZX5nJzWdVG

---

## Disclaimer

**Trading prediction markets involves significant financial risk.**

- This software is provided "as-is" without warranties
- You may lose all invested capital
- Only trade with money you can afford to lose
- Start with paper trading before using real funds
- Keep your API credentials secure

**USE AT YOUR OWN RISK.**

---

## Features

- **Real-time Whale Monitoring** - Detect large trades within milliseconds
- **Automated Copy Trading** - Automatically mirror trades with customizable sizing
- **Paper Trading** - Test strategies without risking real money
- **Multi-Account Support** - Manage multiple trading accounts
- **Risk Management** - Stop loss, take profit, position limits
- **Performance Analytics** - Track P&L, win rate, trade history
- **Desktop App** - Modern Electron + React interface
- **CLI Bot** - Terminal interface for headless operation

---

## Screenshots

### Dashboard
![Dashboard](dashboard.png)

### Whale Trades
![Whales](whales.png)

### Whale Profile
![Whale Profile](wprofile.png)

### Performance
![Performance](performance.png)

### Traders
![Traders](traders.png)

### Settings
![Settings](settings.png)

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) 18.0.0 or higher
- Polymarket account with API credentials

### Installation

**Option 1: Using setup script**

```bash
# Windows
setup.bat

# Mac/Linux
chmod +x setup.sh && ./setup.sh
```

**Option 2: Manual installation**

```bash
# Clone the repo
git clone https://github.com/TONKAFREAK/polymarket_trading_bot.git
cd polymarket_trading_bot

# Install dependencies
npm install
cd client && npm install && cd ..

# Build CLI
npm run build
```

### Configuration

```bash
# Copy example config
cp .env.example .env

# Edit .env with your Polymarket API credentials
```

### Running

**Desktop App:**
```bash
npm run client
```

**CLI Bot:**
```bash
npm run cli
```

**Or use the dev script:**
```bash
# Windows
dev.bat

# Mac/Linux
./dev.sh
```

---

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run client` | Start Desktop App |
| `npm run cli` | Start CLI Bot |
| `npm run client:build` | Build Desktop App for distribution |
| `npm run cli:build` | Build CLI |
| `npm run install:all` | Install all dependencies |

---

## Configuration

### Environment Variables (.env)

```env
# Polymarket API Credentials
POLY_API_KEY=your_api_key
POLY_API_SECRET=your_api_secret
POLY_PASSPHRASE=your_passphrase
POLY_FUNDER_ADDRESS=0x...

# Signature type: 0=EOA, 1=Magic/Email, 2=Browser Wallet
POLY_SIGNATURE_TYPE=0

# Trading Settings
SIZING_MODE=proportional
DEFAULT_USD_SIZE=10
PROPORTIONAL_MULTIPLIER=0.25
MIN_ORDER_SIZE=0.1
SLIPPAGE_TOLERANCE=0.01

# Risk Management
MAX_POSITION_SIZE=1000
DAILY_LOSS_LIMIT=500
STOP_LOSS_PCT=5
PROFIT_TARGET_PCT=10

# Paper Trading
PAPER_TRADING=false
PAPER_STARTING_BALANCE=10000
```

---

## Building Releases

### Build Desktop App

```bash
npm run client:build
```

Output in `client/dist/`:
- **Windows**: `.exe` installer + portable
- **macOS**: `.dmg`
- **Linux**: `.AppImage`

### Create GitHub Release

1. Build the app:
   ```bash
   npm run client:build
   ```

2. Create version tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. Go to GitHub → Releases → Draft new release

4. Upload files from `client/dist/`

5. Publish

---

## Project Structure

```
polymarket_trading_bot/
├── src/                    # CLI source code
│   ├── cli.ts             # CLI entry point
│   ├── commands/          # CLI commands
│   ├── copier/            # Copy trading logic
│   ├── polymarket/        # Polymarket API
│   └── utils/             # Utilities
├── client/                 # Desktop App (Electron + Next.js)
│   ├── main/              # Electron main process
│   ├── renderer/          # React frontend
│   └── dist/              # Built app
├── data/                   # Persistent data
├── .env                    # Configuration
├── setup.bat / setup.sh   # Setup scripts
└── dev.bat / dev.sh       # Dev scripts
```

---

## Support

- **Discord**: [Join](https://discord.gg/ZX5nJzWdVG)
- **Issues**: [GitHub Issues](https://github.com/TONKAFREAK/polymarket-trading-bot/issues)

---

## License

MIT License

---

Made for the Polymarket community by TONKAFREAK
