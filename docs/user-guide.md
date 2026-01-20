# User Guide (Desktop App)

The Polymarket Copy Trading Bot features a comprehensive Desktop Application built with Electron and Next.js.

## Main Interface

### 1. Dashboard Tab

The mission control center.

- **Balance Card**: Shows your current Login, Address, and Live/Paper Balance.
- **Portfolio Summary**: Total value, Realized P&L, Open Positions count.
- **Active Positions**: A quick list of your currently open positions.

### 2. Portfolio Tab

Manage your holdings.

- **Open Positions**: Shows all active bets.
  - _Columns_: Market Name, Outcome (Yes/No), Shares, Avg Price, Current Value, P&L.
  - **Action**: "Sell" button to manually exit a position immediately.
- **Closed Positions**: History of positions that have been sold or redeemed.

### 3. Whales Tab

Monitor the smart money.

- **Live Feed**: Real-time stream of large trades happening on Polymarket.
  - Displays: Time, Market, Side (Buy/Sell), Size (USD), Entry Price, and Trader Wallet.
  - **Filtering**: Use the "Min Size" buttons ($1k, $5k, $10k+) to filter out noise.
- **Copying**: Click on a Whale's wallet address to open their Profile profile.
- **Trader Profile**:
  - When you click a wallet, a modal opens showing:
    - **Stats**: Win Rate, Total P&L, Volume.
    - **Open Positions**: What they are holding right now.
    - **Recent Activity**: Their last 50 trades.
    - **Graph**: A historical P&L chart for that user.
  - **"Add to Copy List"**: Button to instantly start copying this trader.

### 4. Performance Tab

Track your bot's effectiveness.

- **Metrics**: Win Rate %, Profit Factor, Largest Win, Average Trade Size.
- **Charts**: Visualized P&L over time (24h, 7d, 30d).
- **Trade History**: Detailed log of every executed trade with timestamps and transaction hashes.

### 5. Settings Tab

Configure the bot without editing files.

- **General**: Toggle Paper Trading, set Polling Interval (Speed).
- **Accounts**: Add multiple Polymarket accounts (manage keys).
- **Risk**: Set Daily Stop Loss, Max Position Size.
- **Logs**: View live application logs for debugging.

---

## Workflow: How to Start Copying

1.  **Find a Target**:
    Go to the **Whales** tab. Watch the live feed for a few minutes. Look for traders with high "Green" P&L or large successful bets.
2.  **Analyze**:
    Click their address. Check their **Win Rate** and **P&L Chart**. If they are consistently profitable, they are a good candidate.
3.  **Add Target**:
    Click **"Add to Copy List"**.
4.  **Configure Sizing**:
    Go to **Settings**. Choose your Sizing Mode (e.g., `Proportional` at `0.1` to copy 10% of their size).
5.  **Start Paper Trading**:
    Enable **Paper Trading** in Settings first. Let the bot run for a day.
6.  **Go Live**:
    Once confident, disable Paper Trading to use real funds.

---

## Manual Trading

You can also manually interact with markets:

- **Panic Sell**: In the Portfolio tab, hit "Sell" on any position to dump it at market price.
- **Redeem**: Winning positions (markets resolved to YES/NO) are auto-redeemed, but you can trigger a redemption check via CLI if needed.
