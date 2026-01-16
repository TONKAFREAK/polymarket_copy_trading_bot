/**
 * Core type definitions for the Polymarket Copy Trader
 */

// ============================================
// TRADE SIGNAL TYPES
// ============================================

export type TradeSide = "BUY" | "SELL";

/**
 * Activity types from Polymarket API
 * - TRADE: Regular buy/sell trade
 * - SPLIT: Split collateral into YES/NO tokens
 * - MERGE: Merge YES+NO tokens back into collateral
 * - REDEEM: Redeem winning tokens after market resolution
 * - REWARD: Liquidity rewards or incentives
 * - CONVERSION: Token conversion
 * - MAKER_REBATE: Rebate for market makers
 */
export type ActivityType =
  | "TRADE"
  | "SPLIT"
  | "MERGE"
  | "REDEEM"
  | "REWARD"
  | "CONVERSION"
  | "MAKER_REBATE";

export interface TradeSignal {
  /** Wallet address of the target being copied */
  targetWallet: string;
  /** Unique identifier for the trade (from API or derived hash) */
  tradeId: string;
  /** Unix timestamp of the trade */
  timestamp: number;
  /** Polymarket condition ID */
  conditionId?: string;
  /** Market slug or identifier */
  marketSlug?: string;
  /** Token ID required for CLOB order submission */
  tokenId: string;
  /** Trade side: BUY or SELL */
  side: TradeSide;
  /** Price per share (0-1) */
  price: number;
  /** Number of shares traded */
  sizeShares?: number;
  /** Notional USD value of the trade */
  notionalUsd?: number;
  /** Outcome: YES, NO, or any other outcome string (for multi-outcome markets like sports) */
  outcome?: string;
  /** Activity type from API */
  activityType?: ActivityType;
  /** Raw API response for debugging */
  rawData?: Record<string, unknown>;
}

// ============================================
// CONFIGURATION TYPES
// ============================================

export type SizingMode = "fixed_usd" | "fixed_shares" | "proportional";

export interface TradingConfig {
  /** Sizing mode for trade execution */
  sizingMode: SizingMode;
  /** Fixed USD amount per trade (for fixed_usd mode) */
  fixedUsdSize: number;
  /** Fixed shares per trade (for fixed_shares mode) */
  fixedSharesSize: number;
  /** Proportional multiplier (for proportional mode) */
  proportionalMultiplier: number;
  /** Minimum order size in USD */
  minOrderSize: number;
  /** Slippage tolerance (0.01 = 1%) */
  slippage: number;
}

export interface RiskConfig {
  /** Maximum USD per single trade */
  maxUsdPerTrade: number;
  /** Maximum USD exposure per market */
  maxUsdPerMarket: number;
  /** Maximum daily USD volume */
  maxDailyUsdVolume: number;
  /** Don't trade markets older than N seconds from resolution (0 = disabled) */
  doNotTradeMarketsOlderThanSecondsFromResolution: number;
  /** Market allowlist (condition IDs or slug keywords) - empty = all allowed */
  marketAllowlist: string[];
  /** Market denylist (condition IDs or slug keywords) */
  marketDenylist: string[];
  /** Dry run mode - no real trades */
  dryRun: boolean;
}

export interface PollingConfig {
  /** Polling interval in milliseconds */
  intervalMs: number;
  /** Number of trades to fetch per poll */
  tradeLimit: number;
  /** Maximum retries on network errors */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  baseBackoffMs: number;
}

export interface AppConfig {
  trading: TradingConfig;
  risk: RiskConfig;
  polling: PollingConfig;
  /** List of target wallet addresses to copy */
  targets: string[];
  /** Chain ID (137 = Polygon Mainnet) */
  chainId: number;
}

// ============================================
// PERSISTENCE TYPES
// ============================================

export interface PersistedState {
  /** Set of seen trade IDs per target wallet */
  seenTradeIds: Record<string, string[]>;
  /** Daily volume tracking */
  dailyVolume: {
    date: string; // YYYY-MM-DD
    totalUsd: number;
  };
  /** Per-market exposure tracking */
  marketExposure: Record<string, number>; // conditionId -> USD exposure
  /** Last poll timestamp per target */
  lastPollTimestamp: Record<string, number>;
}

export interface TokenCache {
  /** Mapping from conditionId to token metadata */
  tokens: Record<string, TokenMetadata>;
  /** Last updated timestamp */
  lastUpdated: number;
}

export interface TokenMetadata {
  conditionId: string;
  marketSlug: string;
  question: string;
  yesTokenId: string;
  noTokenId: string;
  endDate?: string;
  active: boolean;
  /** All outcomes with their token IDs (for multi-outcome markets) */
  outcomes?: OutcomeToken[];
}

export interface OutcomeToken {
  tokenId: string;
  outcome: string; // "Yes", "No", "Over", "Under", team names, etc.
  price?: number;
}

// ============================================
// ORDER TYPES
// ============================================

export interface OrderRequest {
  tokenId: string;
  side: TradeSide;
  price: number;
  size: number; // in shares
  type: "GTC" | "GTD" | "FOK";
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  errorMessage?: string;
  executedPrice?: number;
  executedSize?: number;
  transactionHash?: string;
}

export interface ExecutionResult {
  signal: TradeSignal;
  order?: OrderRequest;
  result?: OrderResult;
  skipped: boolean;
  skipReason?: string;
  dryRun: boolean;
  timestamp: number;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface DataApiTrade {
  id: string;
  taker: string;
  maker: string;
  market: string;
  asset: string;
  side: string;
  price: string;
  size: string;
  timestamp: string;
  transactionHash: string;
  outcome: string;
  // Activity type field
  type?: string;
  // Additional fields that may be present
  conditionId?: string;
  tokenId?: string;
  [key: string]: unknown;
}

export interface DataApiActivity {
  id: string;
  user: string;
  type: string;
  market: string;
  asset: string;
  side: string;
  price: string;
  size: string;
  timestamp: string;
  conditionId?: string;
  transactionHash?: string;
  outcome?: string;
  [key: string]: unknown;
}

export interface GammaMarket {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  tokens: GammaToken[];
  endDate: string;
  active: boolean;
  closed: boolean;
  /** Comma-separated outcome prices, e.g. "1,0" means YES won, "0,1" means NO won */
  outcomePrices?: string;
  /** JSON string of outcomes array, e.g. '["Yes","No"]' */
  outcomes?: string;
  /** Resolution status from UMA oracle */
  umaResolutionStatus?: string;
  /** When market was resolved/closed */
  closedTime?: string;
  /** CLOB token IDs as JSON array string */
  clobTokenIds?: string;
  [key: string]: unknown;
}

export interface GammaToken {
  token_id: string;
  outcome: string;
  price: number;
  winner?: boolean;
  [key: string]: unknown;
}

// ============================================
// STATUS TYPES
// ============================================

export interface BotStatus {
  running: boolean;
  startTime?: number;
  uptime?: number;
  targets: TargetStatus[];
  dailyStats: DailyStats;
  lastError?: string;
}

export interface TargetStatus {
  wallet: string;
  lastPolled?: number;
  tradesDetected: number;
  tradesCopied: number;
  tradesSkipped: number;
  lastTrade?: TradeSignal;
}

export interface DailyStats {
  date: string;
  totalTradesDetected: number;
  totalTradesCopied: number;
  totalUsdVolume: number;
  successfulOrders: number;
  failedOrders: number;
}

// ============================================
// EVENT TYPES
// ============================================

export type BotEvent =
  | { type: "TRADE_DETECTED"; signal: TradeSignal }
  | { type: "ORDER_PLACED"; execution: ExecutionResult }
  | { type: "ORDER_SKIPPED"; signal: TradeSignal; reason: string }
  | { type: "ERROR"; error: Error; context?: string }
  | { type: "STARTED"; timestamp: number }
  | { type: "STOPPED"; timestamp: number };
