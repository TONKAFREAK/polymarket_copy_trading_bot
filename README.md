# Polymarket Copy Trader

A production-grade CLI copy-trading bot for Polymarket prediction markets. Automatically copies trades from target wallets to your own wallet.

## ⚠️ IMPORTANT DISCLAIMER

**TRADING PREDICTION MARKETS INVOLVES SIGNIFICANT FINANCIAL RISK.**

- This software is provided "as-is" without any warranties
- You may lose all of your invested capital
- Past performance does not guarantee future results
- Only trade with money you can afford to lose
- Always start with dry-run mode and small amounts
- The developers are not responsible for any financial losses

**USE AT YOUR OWN RISK.**

---

## Features

- 🎯 **Multi-target tracking**: Watch multiple wallets simultaneously
- ⚡ **Fast polling**: Detect trades within 2-3 seconds
- 🔄 **Automatic execution**: Place equivalent trades via CLOB API
- 🛡️ **Risk controls**: Configurable limits and safeguards
- 📊 **Flexible sizing**: Fixed USD, fixed shares, or proportional
- 💾 **State persistence**: Never replay the same trade twice
- 🔌 **Optional Redis**: File-based by default, Redis optional
- 🧪 **Dry-run mode**: Test without real money
- 📈 **Paper trading**: Simulate trades with virtual funds and track PnL
- 💰 **Market resolution P&L**: Automatic settlement when prediction markets resolve
- 📺 **Live stats mode**: Real-time monitoring with `--watch` flag
- 🔀 **Trade aggregation**: Combines rapid-fire fills into single trades
- 📋 **Activity types**: Tracks TRADE, SPLIT, MERGE, and REDEEM operations
- 🏆 **Win/loss tracking**: See resolved market outcomes and win rate

## Quick Start

### 1. Prerequisites

- Node.js 18 or higher
- A Polymarket account with funded wallet
- Private key for your trading wallet

### 2. Installation

```bash
# Clone or download the project
cd polymarket-copy-trader

# Install dependencies
npm install

# Build the project
npm run build
```

### 3. Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your settings
# IMPORTANT: Set your PRIVATE_KEY
```

### 4. Initialize

```bash
# Initialize with target wallets
pmcopy init --targets 0xABC123...,0xDEF456... --mode fixed_usd --usd 10 --dry-run

# Or initialize empty and add targets later
pmcopy init
pmcopy targets add 0xABC123...
```

### 5. Run

```bash
# Test with dry-run mode first!
pmcopy run --dry-run

# When ready for live trading
pmcopy run
```

---

## Installation Options

### Global Installation

```bash
npm run build
npm link

# Now you can use 'pmcopy' anywhere
pmcopy --help
```

### Development Mode

```bash
# Run without building
npm run dev -- run --dry-run

# Or use tsx directly
npx tsx src/cli.ts run --dry-run
```

---

## CLI Commands

### `pmcopy init`

Initialize the copy trader configuration. All settings default to values from your `.env` file.

```bash
pmcopy init [options]

Options:
  -t, --targets <addresses>      Comma-separated wallet addresses to copy
  -m, --mode <mode>              Sizing mode: fixed_usd, fixed_shares, proportional
  -u, --usd <amount>             USD per trade (for fixed_usd mode)
  -s, --shares <amount>          Shares per trade (for fixed_shares mode)
  --multiplier <ratio>           Proportional multiplier (e.g., 0.25 for 25%)
  --slippage <percent>           Slippage tolerance (e.g., 0.01 for 1%)
  --max-usd-per-trade <amount>   Maximum USD per single trade
  --max-usd-per-market <amount>  Maximum USD exposure per market
  --max-daily-volume <amount>    Maximum daily USD trading volume
  --poll-interval <ms>           Polling interval in milliseconds
  -d, --dry-run                  Enable dry-run mode (default from .env)
  --no-dry-run                   Enable live trading
  -f, --force                    Force reinitialize
```

**Note:** All defaults come from your `.env` file. If not set in `.env`, sensible defaults are used.

**Examples:**

```bash
# Initialize with defaults from .env
pmcopy init --targets 0xabc123...

# Initialize with custom settings (overrides .env)
pmcopy init -t 0xabc...,0xdef... -m fixed_usd -u 25 --slippage 0.02

# Initialize for proportional copying (10% of target size)
pmcopy init -t 0xabc... -m proportional --multiplier 0.1

# Initialize with custom risk limits
pmcopy init -t 0xabc... --max-usd-per-trade 50 --max-daily-volume 500
```

### `pmcopy run`

Start the copy trading bot.

```bash
pmcopy run [options]

Options:
  -i, --interval <ms>  Polling interval in milliseconds
  -d, --dry-run       Enable dry-run mode
  --no-dry-run        Disable dry-run mode
  -v, --verbose       Enable verbose logging
```

**Examples:**

```bash
# Run in dry-run mode (recommended for testing)
pmcopy run --dry-run

# Run with faster polling
pmcopy run --interval 2000 --dry-run

# Live trading (use with caution!)
pmcopy run --no-dry-run
```

### `pmcopy status`

Show current configuration and statistics.

```bash
pmcopy status [options]

Options:
  -j, --json  Output as JSON
```

### `pmcopy targets`

Manage target wallets to copy.

```bash
# List all targets
pmcopy targets list

# Add a target
pmcopy targets add 0x123...

# Remove a target
pmcopy targets remove 0x123...

# Clear all targets
pmcopy targets clear --force
```

### `pmcopy config`

Manage configuration settings.

```bash
# Show all configuration
pmcopy config get

# Get specific value
pmcopy config get trading.slippage

# Set a value
pmcopy config set trading.fixedUsdSize 25
pmcopy config set risk.maxDailyUsdVolume 500

# List available keys
pmcopy config keys

# Reset to defaults
pmcopy config reset --force
```

### `pmcopy stats`

View paper trading performance and PnL.

```bash
pmcopy stats [options]

Options:
  -j, --json              Output as JSON
  -c, --csv               Export trades to CSV
  -r, --reset             Reset paper trading account
  -b, --balance <amount>  Starting balance for reset (default: 1000)
  -s, --settle            Force settlement of resolved positions
  -w, --watch             Live auto-refresh mode
  -i, --interval <secs>   Refresh interval for watch mode (default: 10)
```

**Examples:**

```bash
# Show paper trading stats (requires PAPER_TRADING=true)
pmcopy stats

# Output as JSON
pmcopy stats --json

# Export trades to CSV
pmcopy stats --csv

# Reset paper trading account
pmcopy stats --reset

# Reset with custom starting balance
pmcopy stats --reset --balance 500

# Force settlement check for resolved markets
pmcopy stats --settle

# Live stats mode (auto-refresh every 10 seconds)
pmcopy stats --watch

# Live stats with custom refresh interval (30 seconds)
pmcopy stats --watch --interval 30
```

---

## Configuration

### Environment Variables (.env)

| Variable        | Description                                         | Default                          |
| --------------- | --------------------------------------------------- | -------------------------------- |
| `PRIVATE_KEY`   | Your wallet private key (required for live trading) | -                                |
| `CHAIN_ID`      | Network: 137 (Polygon) or 80001 (Mumbai)            | 137                              |
| `RPC_URL`       | Polygon RPC endpoint                                | https://polygon-rpc.com          |
| `CLOB_API_URL`  | Polymarket CLOB API (order execution)               | https://clob.polymarket.com      |
| `DATA_API_URL`  | Polymarket Data API (wallet activity)               | https://data-api.polymarket.com  |
| `GAMMA_API_URL` | Polymarket Gamma API (market metadata)              | https://gamma-api.polymarket.com |
| `WS_URL`        | Real-time data WebSocket                            | wss://ws-subscriptions-clob.polymarket.com/ws |
| `PAPER_TRADING` | Enable paper trading with virtual funds             | false                            |
| `PAPER_STARTING_BALANCE` | Initial virtual balance                    | 1000                             |
| `PAPER_FEE_RATE` | Simulated trading fee (0.001 = 0.1%)               | 0.001                            |
| `USE_REDIS`     | Use Redis for persistence                           | false                            |
| `REDIS_URL`     | Redis connection URL                                | redis://localhost:6379           |
| `DATA_DIR`      | Directory for JSON persistence                      | ./data                           |
| `LOG_LEVEL`     | Logging level                                       | info                             |
| `DRY_RUN`       | Default dry-run mode                                | true                             |

### Polymarket API Endpoints

| API         | URL                                              | Purpose                                |
| ----------- | ------------------------------------------------ | -------------------------------------- |
| **CLOB**    | https://clob.polymarket.com                      | Order placement, balances, order book  |
| **Data**    | https://data-api.polymarket.com                  | Wallet activity history, trade lookup  |
| **Gamma**   | https://gamma-api.polymarket.com                 | Market metadata, resolution status     |
| **RTDS WS** | wss://ws-subscriptions-clob.polymarket.com/ws    | Real-time price updates, order fills   |

### Configuration Keys

#### Trading

| Key                              | Description                                 | Default   |
| -------------------------------- | ------------------------------------------- | --------- |
| `trading.sizingMode`             | `fixed_usd`, `fixed_shares`, `proportional` | fixed_usd |
| `trading.fixedUsdSize`           | USD per trade                               | 10        |
| `trading.fixedSharesSize`        | Shares per trade                            | 10        |
| `trading.proportionalMultiplier` | Multiplier for proportional mode            | 0.25      |
| `trading.slippage`               | Slippage tolerance (0.01 = 1%)              | 0.01      |

#### Risk

| Key                      | Description                   | Default |
| ------------------------ | ----------------------------- | ------- |
| `risk.maxUsdPerTrade`    | Maximum USD per single trade  | 100     |
| `risk.maxUsdPerMarket`   | Maximum exposure per market   | 500     |
| `risk.maxDailyUsdVolume` | Maximum daily trading volume  | 1000    |
| `risk.dryRun`            | Dry-run mode (no real trades) | true    |
| `risk.marketAllowlist`   | Only trade these markets      | []      |
| `risk.marketDenylist`    | Never trade these markets     | []      |

#### Polling

| Key                  | Description              | Default |
| -------------------- | ------------------------ | ------- |
| `polling.intervalMs` | Polling interval         | 2500    |
| `polling.tradeLimit` | Trades to fetch per poll | 20      |
| `polling.maxRetries` | Max retries on error     | 3       |

---

## Risk Controls

### Built-in Safety Features

1. **Dry-run mode** (enabled by default): Simulates trades without executing
2. **Per-trade limit**: Maximum USD per single trade
3. **Per-market limit**: Maximum exposure to any single market
4. **Daily volume limit**: Maximum total trading volume per day
5. **Trade deduplication**: Never copies the same trade twice
6. **Market filtering**: Allowlist/denylist specific markets
7. **Slippage protection**: Marketable limit orders with configurable slippage

### Recommended Settings for Beginners

```bash
# Start with dry-run and small sizes
pmcopy init --targets 0x... --mode fixed_usd --usd 5 --dry-run

# Set conservative limits
pmcopy config set risk.maxUsdPerTrade 20
pmcopy config set risk.maxDailyUsdVolume 100
```

---

## Paper Trading

Paper trading lets you simulate trades with virtual funds to evaluate the profitability of your copy trading strategy before risking real money.

### Enabling Paper Trading

1. Set in your `.env` file:

```bash
# Disable dry-run (which only logs, doesn't simulate)
DRY_RUN=false

# Enable paper trading with virtual funds
PAPER_TRADING=true

# Set your virtual starting balance
PAPER_STARTING_BALANCE=1000

# Simulated fee rate (0.001 = 0.1%)
PAPER_FEE_RATE=0.001
```

2. Run the bot:

```bash
pmcopy run
```

### Viewing Performance

```bash
# See full performance stats
pmcopy stats

# Export trade history to CSV for analysis
pmcopy stats --csv

# Get JSON stats for programmatic use
pmcopy stats --json
```

### Paper Trading Stats Include

- **Account**: Starting balance, current balance, total return %
- **PnL**: Realized PnL, unrealized PnL, total fees
- **Trade Stats**: Win rate, total trades, largest win/loss
- **Positions**: All open positions with current prices
- **History**: Recent trades with PnL per trade
- **Resolved Markets**: Automatic settlement with correct P&L calculation

### Market Resolution & Settlement

Polymarket is a prediction market where:
- **Winning shares** pay out $1.00 each
- **Losing shares** pay out $0.00 each

When markets resolve, paper trading automatically:
1. Detects resolution via the Gamma API (`outcomePrices` field)
2. Determines if your position won or lost
3. Calculates P&L: `(shares × settlementPrice) - costBasis`
4. Updates your balance accordingly
5. Tracks win rate and settlement history

**Example**: You buy 100 YES shares at $0.65 ($65 total). If YES wins:
- Settlement value: 100 × $1.00 = $100
- P&L: $100 - $65 = **+$35 profit**

If YES loses:
- Settlement value: 100 × $0.00 = $0
- P&L: $0 - $65 = **-$65 loss**

### Live Stats Mode

Monitor your paper trading performance in real-time:

```bash
# Auto-refresh every 10 seconds
pmcopy stats --watch

# Custom refresh interval (30 seconds)
pmcopy stats --watch --interval 30

# Press Ctrl+C to stop
```

Live stats automatically:
- Update position prices from current market data
- Settle any newly resolved positions
- Recalculate unrealized P&L
- Show real-time account value

### Resetting Paper Account

```bash
# Reset with default starting balance ($1000)
pmcopy stats --reset

# Reset with custom balance
pmcopy stats --reset --balance 500
```

### Mode Comparison

| Mode                 | Real Orders | Tracks PnL | Use Case                             |
| -------------------- | ----------- | ---------- | ------------------------------------ |
| `DRY_RUN=true`       | No          | No         | Quick testing, see what would happen |
| `PAPER_TRADING=true` | No          | Yes        | Evaluate strategy profitability      |
| Both `false`         | **YES**     | Via chain  | **LIVE TRADING - Real money!**       |

---

## How It Works

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Data API      │────▶│    Watcher      │────▶│    Executor     │
│  (Polling)      │     │  (Detect Trades)│     │  (Place Orders) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │                        │
                               ▼                        ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  Risk Manager   │     │   CLOB Client   │
                        │  (Validate)     │     │  (Execute)      │
                        └─────────────────┘     └─────────────────┘
                               │                        │
                               ▼                        ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  State Manager  │     │  Token Resolver │
                        │  (Persist)      │     │  (Metadata)     │
                        └─────────────────┘     └─────────────────┘
```

### Flow

1. **Polling**: Every 2.5 seconds, fetch recent activity for each target wallet
2. **Detection**: Parse and normalize trades, splits, merges, and redemptions
3. **Aggregation**: Combine rapid-fire trades within 5-second windows
4. **Deduplication**: Skip activities that have been seen before
5. **Risk Check**: Validate against all risk limits
6. **Token Resolution**: Resolve market metadata if needed
7. **Execution**: Place order via CLOB (or simulate in dry-run/paper trading)
8. **Persistence**: Save state to prevent replay

### Activity Types

The bot detects and handles multiple activity types from target wallets:

| Type       | Description                                    | Action                           |
| ---------- | ---------------------------------------------- | -------------------------------- |
| `TRADE`    | Standard buy/sell order                        | Copy the trade                   |
| `SPLIT`    | USDC split into YES + NO positions             | Buy both outcomes                |
| `MERGE`    | YES + NO positions merged back to USDC         | Sell both outcomes               |
| `REDEEM`   | Winning shares redeemed for $1                 | Auto-settled (market resolved)   |

### Trade Aggregation

When target wallets execute multiple trades rapidly (common with large orders that fill across multiple price levels), the bot aggregates them:

- **5-second window**: Trades on the same market within 5 seconds are combined
- **Prevents over-trading**: Instead of copying 10 small fills, copies 1 aggregated trade
- **Accurate sizing**: Total shares and USD amounts are summed correctly

Example: Target buys 1000 shares filled as 100+200+300+400 in 2 seconds
→ Bot copies as single 1000-share trade

### Sizing Modes

| Mode           | Description                                            |
| -------------- | ------------------------------------------------------ |
| `fixed_usd`    | Always trade the same USD amount (e.g., $10 per trade) |
| `fixed_shares` | Always trade the same number of shares                 |
| `proportional` | Trade a percentage of the target's size (e.g., 25%)    |

### Order Types

Orders are placed as "marketable limit orders":

- **BUY**: Limit price = target price × (1 + slippage)
- **SELL**: Limit price = target price × (1 - slippage)

This allows orders to fill immediately while protecting against excessive slippage.

---

## Persistence

### File-based (Default)

Data is stored in `./data/`:

- `config.json` - Configuration settings
- `state.json` - Seen trade IDs, daily volume, exposure
- `token-cache.json` - Market metadata cache

### Redis (Optional)

Enable Redis for distributed deployments:

```bash
# .env
USE_REDIS=true
REDIS_URL=redis://localhost:6379
```

---

## Troubleshooting

### Common Issues

#### "No targets configured"

```bash
# Add target wallets
pmcopy targets add 0xABC123...
```

#### "PRIVATE_KEY is required for live trading"

Edit your `.env` file and add your private key:

```
PRIVATE_KEY=your64characterhexstringwithout0x
```

#### "Rate limited, backing off"

The bot will automatically retry with exponential backoff. If persistent:

- Increase polling interval: `pmcopy config set polling.intervalMs 5000`
- Reduce number of targets

#### "Could not resolve token ID"

The market metadata couldn't be fetched. This can happen for:

- Very new markets
- Resolved/closed markets

The trade will be skipped automatically.

### Debug Mode

Enable verbose logging:

```bash
# In .env
LOG_LEVEL=debug

# Or via CLI
pmcopy run --verbose
```

### View Logs

Logs are written to `./data/logs/pmcopy.log` by default.

```bash
# Follow logs
tail -f data/logs/pmcopy.log
```

---

## Security Best Practices

1. **Never share your private key**
2. **Use a dedicated wallet** with limited funds for copy trading
3. **Start with dry-run mode** to validate behavior
4. **Set conservative limits** initially
5. **Monitor the bot** regularly
6. **Keep your .env file secure** (it's gitignored by default)

---

## Project Structure

```
polymarket-copy-trader/
├── src/
│   ├── cli.ts                 # CLI entry point
│   ├── commands/              # CLI commands
│   │   ├── init.ts
│   │   ├── run.ts
│   │   ├── status.ts
│   │   ├── stats.ts           # Paper trading stats (--watch, --settle)
│   │   ├── targets.ts
│   │   └── config.ts
│   ├── config/                # Configuration management
│   │   ├── index.ts
│   │   └── env.ts
│   ├── data/                  # Persistence layer
│   │   ├── persistence.ts
│   │   ├── fileProvider.ts
│   │   └── redisProvider.ts
│   ├── polymarket/            # Polymarket API clients
│   │   ├── clobClient.ts      # CLOB API for order execution
│   │   ├── dataApi.ts         # Data API for wallet activity
│   │   ├── gammaApi.ts        # Gamma API for market metadata & resolution
│   │   └── tokenResolver.ts   # Token ID resolution
│   ├── copier/                # Core copy trading logic
│   │   ├── types.ts           # Type definitions
│   │   ├── watcher.ts         # Trade detection & aggregation
│   │   ├── executor.ts        # Trade execution
│   │   ├── paperTrading.ts    # Paper trading simulation
│   │   ├── risk.ts            # Risk management
│   │   └── state.ts           # State management
│   └── utils/                 # Utilities
│       ├── http.ts
│       └── logger.ts
├── data/                      # Runtime data (gitignored)
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- --help

# Build for production
npm run build

# Type checking
npm run typecheck
```

---

## License

MIT License - see LICENSE file for details.

---

## Support

This is open-source software provided without warranty. For issues:

1. Check the troubleshooting section
2. Review your configuration
3. Enable debug logging
4. Check the Polymarket API status

---

**Remember: Always test with dry-run mode first, and never trade more than you can afford to lose.**
