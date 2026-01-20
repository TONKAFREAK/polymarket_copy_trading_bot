# Troubleshooting Guide

This guide helps resolve common issues encountered while using the Polymarket Copy Trading Bot.

## Common Error Messages

### "API credentials not valid" or "Authentication failed"
**Reason**: The keys in your `.env` file are incorrect, copied with whitespace, or revocation.
**Solution**:
1.  Go to [Polymarket API Keys Settings](https://polymarket.com/settings).
2.  Delete the old key.
3.  Generate a new one.
4.  Copy the Key, Secret, and Passphrase *carefully* into `.env`.
5.  Restart the bot.

### "Insufficient balance"
**Reason**: Your "Proxy Wallet" (Polymarket Funder) does not have enough USDC.
**Solution**:
1.  Check your Polygon wallet address on [PolygonScan](https://polygonscan.com/).
2.  Ensure you have USDC (Bridged) on Polygon POS network.
3.  Deposit funds via the Polymarket website "Deposit" button.

### "Rate limited, backing off"
**Reason**: You are making too many requests to the Polymarket API.
**Solution**:
1.  Increase `poll-interval` in Settings (default is 500ms, try 1000ms or 2000ms).
2.  Reduce the number of open whale monitor tabs/processes.

### "Could not resolve token ID"
**Reason**: The bot found a trade for a market that doesn't exist in the local cache or Gamma API API yet (very new market).
**Solution**:
1.  Usually temporary. The bot will skip this trade.
2.  If persistent, check your internet connection.

### "Signature validation failed"
**Reason**: The `POLY_SIGNATURE_TYPE` in `.env` does not match your wallet type.
**Solution**:
-   Use `0` if you use a standard Metamask / Private Key setup (EOA).
-   Use `1` if you log in via Email/Google (Magic Link). (Most common).
-   Use `2` if you use a Gnosis Safe.

---

## Debugging

If the UI isn't showing enough info, you can enable verbose logging.

### In Desktop App
1.  Go to **Settings** > **Logs**.
2.  Look for error messages in red.
3.  Change **Log Level** to `Debug` to see every API call.

### In CLI / Terminal
Run with the debug flag:
```bash
npm run dev -- run --verbose
```
Or set the environment variable:
```bash
export LOG_LEVEL=debug
```

### Log Files
Logs are automatically saved to:
`data/logs/pmcopy.log`

You can open this file in VS Code or Notepad for a full history.

---

## Resetting State

If the application behaves strangely (e.g. wrong balance, stuck positions):

1.  **Clear Config/State**:
    Delete the `data/*.json` files (except `accounts.json` if you want to keep keys).
    ```bash
    rm data/state.json data/token-cache.json
    ```
2.  **Restart**:
    Stop the app completely (Ctrl+C) and start again.

---

## Still Stuck?

If you cannot resolve the issue:
1.  Check the [GitHub Issues](https://github.com/yourusername/polymarket-trading-bot/issues).
2.  Open a new issue with your log file attached.
