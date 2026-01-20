# Paper Trading Guide

Paper Trading allows you to forward-test your copying strategies without risking real money. It simulates the entire lifecycle of a trade, from execution to market resolution.

## How it works

When Paper Trading is enabled (`PAPER_TRADING=true`), the bot intercepts all "Execute" commands. Instead of sending signed orders to the Polymarket CLOB (Central Limit Order Book), it:

1.  **Simulates a Fill**: Assumes the order fills immediately at the current market price (plus slippage tolerance).
2.  **Deducts Virtual Balance**: Updates your `paper-state.json` balance.
3.  **Records Position**: Adds the trade to your simulated portfolio.
4.  **Tracks Fees**: Applies a simulated fee (default 0.1%) to mimic real trading costs.

---

## Setting Up

1.  **Enable it**:
    - **GUI**: Go to Settings -> "Enable Paper Trading".
    - **CLI/.env**: Set `PAPER_TRADING=true`.
2.  **Configure Balance**:
    - Default is $10,000 USDC.
    - You can change this in Settings (GUI) or `PAPER_STARTING_BALANCE` (.env).

---

## The Simulation Lifecycle

### 1. Buying

Whale executes a buy. The bot copies it.

- **Action**: Buy 100 Shares of "Is it raining?" (YES) at $0.50.
- **Cost**: $50.00 + $0.05 fee.
- **Result**: Balance -$50.05. Position: +100 YES Shares.

### 2. Tracking

The Portfolio tab shows this position. The "Current Value" updates based on the _real_ live price of the outcome on Polymarket.

- If price goes to $0.60, your P&L shows +$10.00.

### 3. Selling

You click "Sell" or the Auto-Sell logic triggers (Stop Loss/Take Profit).

- **Action**: Sell 100 Shares at $0.60.
- **Proceeds**: $60.00 - $0.06 fee.
- **Result**: Balance +$59.94. Net Profit: ~$9.89.

### 4. Market Resolution (Settlement)

If you hold the position until the event ends:

- The bot checks `Gamma API` for market resolution.
- **If YES Won**: Position resolves to $1.00 per share. You get $100.
- **If YES Lost**: Position resolves to $0.00. You get $0.
- Your paper balance is automatically credited.

---

## Resetting

If you blow up your virtual account or want to restart testing:

- **GUI**: Settings -> "Reset Paper Trading".
  - This wipes all positions and resets balance to the starting amount.
- **CLI**: `npm run dev -- paper reset`

---

## Differences vs Live Trading

| Feature        | Paper Trading               | Live Trading                           |
| :------------- | :-------------------------- | :------------------------------------- |
| **Execution**  | Instant (Assumed liquidity) | Real (Depends on Order Book liquidity) |
| **Slippage**   | Simulated (Worst case)      | Real (Market impact)                   |
| **Fees**       | Fixed rate (0.1%)           | Dynamic (Maker/Taker fees)             |
| **Settlement** | Auto-calculated             | Smart Contract redemption              |

**Note**: Paper trading cannot simulate "Market Impact". If you try to buy $1M worth of shares paper trading, it will fill instantly at the current price. In real life, that would move the price significantly.
