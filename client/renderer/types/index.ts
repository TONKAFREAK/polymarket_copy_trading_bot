// Shared types for Electron IPC communication

export interface DashboardStats {
  mode: "dry-run" | "paper" | "live";
  balance: number;
  startingBalance: number;
  openPositions: number;
  positionsValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalTrades: number;
  totalFees: number;
  winRate: number;
  winningTrades: number;
  losingTrades: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  avgTradeSize: number;
  uptime: number;
  lastUpdate: number;
  pollingInterval: number;
  targetsCount: number;
  openOrdersCount?: number;
}

export interface Position {
  tokenId: string;
  outcome: string;
  shares: number;
  avgEntryPrice: number;
  currentValue: number;
  currentPrice: number;
  market: string;
  marketSlug?: string;
  side: "BUY" | "SELL";
  pnl: number;
  pnlPercent: number;
  totalCost: number;
  openedAt: number;
  isResolved?: boolean;
  isRedeemable?: boolean;
  settled?: boolean;
  settlementPrice?: number;
  settlementPnl?: number;
  conditionId?: string;
  feesPaid?: number;
  image?: string; // Market image URL from Polymarket
}

export interface TradeLog {
  id: string;
  timestamp: number;
  type:
    | "copy"
    | "skip"
    | "error"
    | "info"
    | "profit"
    | "loss"
    | "redeem"
    | "target";
  side?: "BUY" | "SELL";
  marketName?: string;
  outcome?: string;
  shares?: number;
  price?: number;
  total?: number;
  message?: string;
  details?: string;
  targetWallet?: string;
  success?: boolean;
  // Enhanced fields for TUI-like display
  activityType?: string; // TRADE, REDEEM, SPLIT, MERGE
  targetShares?: number;
  targetPrice?: number;
  targetTotal?: number;
  yourShares?: number;
  yourPrice?: number;
  yourTotal?: number;
  latencyMs?: number;
  copyError?: string;
  isNew?: boolean; // For animation
}

// Individual trade record from paper trading
export interface TradeRecord {
  id: string;
  timestamp: number;
  tokenId: string;
  marketSlug: string;
  market?: string; // Human readable market name
  outcome: "YES" | "NO";
  side: "BUY" | "SELL";
  price: number;
  shares: number;
  usdValue: number;
  fees: number;
  pnl?: number; // Set when closing a position
  targetWallet: string;
  tradeId: string;
  image?: string; // Market image URL from Polymarket
}

// Performance summary for the performance tab
export interface PerformanceStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgTradeSize: number;
  totalVolume: number;
  totalFees: number;
  startingBalance: number;
  currentBalance: number;
  returns: number; // Percentage return
}

export interface TradingConfig {
  trading: {
    sizingMode: "proportional" | "fixed_usd" | "fixed_shares";
    fixedUsdSize: number;
    fixedSharesSize: number;
    proportionalMultiplier: number;
    minOrderSize: number;
    minOrderShares: number;
    slippage: number;
  };
  risk: {
    maxUsdPerTrade: number;
    maxUsdPerMarket: number;
    maxDailyUsdVolume: number;
    doNotTradeMarketsOlderThanSecondsFromResolution: number;
    marketAllowlist: string[];
    marketDenylist: string[];
    dryRun: boolean;
  };
  stopLoss: {
    enabled: boolean;
    percent: number; // 0-100, percentage loss to trigger stop (e.g., 80 = sell at 80% loss)
    checkIntervalMs: number; // How often to check positions
  };
  autoRedeem: {
    enabled: boolean;
    intervalMs: number; // How often to check for redeemable positions
  };
  paperTrading: {
    enabled: boolean;
    startingBalance: number;
    feeRate: number; // e.g., 0.001 = 0.1%
  };
  polling: {
    intervalMs: number;
    tradeLimit: number;
    maxRetries: number;
    baseBackoffMs: number;
  };
  targets: string[];
  chainId: number;
  mode?: "paper" | "dry-run" | "live"; // Trading mode
}

export interface AppStatus {
  running: boolean;
  connected: boolean;
  lastError?: string;
  version: string;
}

// Wallet configuration for the bot
export interface WalletConfig {
  privateKey: string;
  polyApiKey: string;
  polyApiSecret: string;
  polyPassphrase: string;
  polyFunderAddress?: string;
}

// Check if wallet is configured
export interface WalletStatus {
  configured: boolean;
  address: string | null;
  hasApiKey: boolean;
  hasPrivateKey: boolean;
}

// ============================================
// ACCOUNT MANAGEMENT TYPES
// ============================================

// Represents a live trading account
export interface LiveAccount {
  id: string; // Unique identifier
  name: string; // User-friendly name
  address: string; // Wallet address
  privateKey: string; // Encrypted or raw private key
  polyApiKey: string;
  polyApiSecret: string;
  polyPassphrase: string;
  polyFunderAddress?: string;
  createdAt: number;
  lastUsedAt?: number;
}

// Account list and active selection
export interface AccountsState {
  // Currently active account (null = paper trading)
  activeAccountId: string | null;
  // List of configured live accounts
  accounts: LiveAccount[];
  // Whether user has seen the first-time paper trading popup
  hasSeenPaperPopup: boolean;
}

// Account info returned to renderer (without sensitive data)
export interface AccountInfo {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  lastUsedAt?: number;
}

// Current trading mode info
export interface TradingModeInfo {
  mode: "paper" | "live";
  activeAccount: AccountInfo | null;
  paperBalance: number;
  liveBalance?: number;
}
