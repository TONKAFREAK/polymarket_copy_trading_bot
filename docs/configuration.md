# Configuration Reference

The bot can be configured via Environment Variables (`.env`) or through the Settings UI in the Desktop App.

## Environment Variables (.env)

These values are loaded on startup.

### 🔑 Authentication & Wallet

| Variable | Description | Required | Example |
| :--- | :--- | :--- | :--- |
| `PRIVATE_KEY` | Your wallet's private key. **Keep this secret!** Required for signing orders. | Yes (Live) | `a1b2...` |
| `POLY_API_KEY` | Polymarket CLOB API Key. | Yes | `...` |
| `POLY_API_SECRET` | Polymarket CLOB API Secret. | Yes | `...` |
| `POLY_PASSPHRASE` | Polymarket CLOB Passphrase. | Yes | `...` |
| `POLY_FUNDER_ADDRESS` | Your public wallet address (starts with 0x). | Yes | `0x123...` |
| `POLY_SIGNATURE_TYPE` | Signature type. `0` = EOA (Metamask), `1` = Magic (Email/Social), `2` = Safe. | No | `1` |

---

### 📈 Trading Strategy

| Variable | Description | Default |
| :--- | :--- | :--- |
| `POLL_INTERVAL_MS` | How often (in ms) to check target wallets for new trades. Lower = faster but uses more API quota. | `500` |
| `SIZING_MODE` | Strategy for trade size calculation. Options: `fixed_usd`, `fixed_shares`, `proportional`. | `proportional` |
| `DEFAULT_USD_SIZE` | Amount to trade if mode is `fixed_usd`. | `10` |
| `DEFAULT_SHARES_SIZE` | Number of shares to trade if mode is `fixed_shares`. | `10` |
| `PROPORTIONAL_MULTIPLIER`| Multiplier for `proportional` mode. `0.25` means copy 25% of whale's size. | `0.25` |
| `MIN_ORDER_SIZE` | Minimum order size in USD. Orders smaller than this are bumped up to this value. | `0.1` |
| `SLIPPAGE_TOLERANCE` | Max allowed slippage. `0.01` = 1%. Defines the limit price vs market price. | `0.01` |

---

### 🛡️ Risk Management

| Variable | Description | Default |
| :--- | :--- | :--- |
| `MAX_POSITION_SIZE` | Maximum allowed size (USD) for any single position. | `1000` |
| `DAILY_LOSS_LIMIT` | Stop trading if daily losses exceed this amount (USD). | `500` |
| `PROFIT_TARGET_PCT` | Take profit percentage (e.g. `10` for 10%). *Note: Not fully implemented in v1.* | `10` |
| `STOP_LOSS_PCT` | Stop loss percentage (e.g. `5` for 5%). | `5` |
| `MAX_USD_PER_TRADE` | Hard cap on a single trade size. Overrides sizing calculations. | `100` |
| `MAX_USD_HIGH_RISK` | Lower cap for risky markets (if implemented). | `50` |

---

### 🧪 Paper Trading

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PAPER_TRADING` | Enable simulation mode. No real funds used. | `false` |
| `PAPER_STARTING_BALANCE` | Initial virtual balance (USDC). | `10000` |
| `PAPER_FEE_RATE` | Simulated fee rate. `0.001` = 0.1%. | `0.001` |
| `DRY_RUN` | Only log trades without executing (different from Paper Trading). | `true` |

---

### ⚙️ System

| Variable | Description | Default |
| :--- | :--- | :--- |
| `LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error`. | `info` |
| `LOG_FILE` | Path to log file. | `./data/logs/pmcopy.log` |
| `USE_REDIS` | Use Redis for state persistence instead of JSON files. | `false` |
| `REDIS_URL` | Connection string for Redis. | `redis://localhost:6379` |

---

## configuration.json

The application also persists runtime settings effectively in `data/config.json`.
When you change settings in the Desktop UI ("Settings" tab), they are saved here.

**Structure:**
```json
{
  "accounts": [
    {
      "name": "Main",
      "address": "0x...",
      "polyApiKey": "...",
      "enabled": true
    }
  ],
  "trading": {
    "enabled": true,
    "strategy": {
      "mode": "fixed_usd",
      "fixedAmount": 10
    }
  },
  "paperTrading": {
    "enabled": false,
    "startingBalance": 10000
  }
}
```

> **Note:** UI settings typically take precedence over `.env` defaults for runtime operations.
