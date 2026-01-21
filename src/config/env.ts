/**
 * Environment variable loading and validation
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load .env file
dotenv.config();

export interface EnvConfig {
  // Wallet & Auth
  privateKey: string;
  polyApiKey?: string;
  polyApiSecret?: string;
  polyPassphrase?: string;
  polyFunderAddress?: string; // Polymarket profile address (for Magic/Email login)
  polySignatureType: number; // 0 = EOA, 1 = Magic/Email, 2 = Safe proxy

  // Network
  chainId: number;
  rpcUrl: string;

  // API Endpoints
  clobApiUrl: string;
  dataApiUrl: string;
  gammaApiUrl: string;

  // Persistence
  useRedis: boolean;
  redisUrl: string;
  dataDir: string;

  // Logging
  logLevel: string;
  logToFile: boolean;
  logFile: string;

  // Defaults
  pollIntervalMs: number;
  sizingMode: string;
  defaultUsdSize: number;
  defaultSharesSize: number;
  proportionalMultiplier: number;
  minOrderSize: number;
  minOrderShares: number;
  slippage: number;
  maxUsdPerTrade: number;
  maxUsdPerMarket: number;
  maxDailyUsdVolume: number;
  dryRun: boolean;

  // Paper trading
  paperTrading: boolean;
  paperStartingBalance: number;
  paperFeeRate: number;

  // Auto-redeem
  autoRedeem: boolean;
  autoRedeemIntervalMs: number;

  // Stop-loss: auto-sell positions down by this percentage (0 = disabled)
  stopLossPercent: number;
  stopLossCheckIntervalMs: number;
}

function getEnvString(key: string, defaultValue: string = ""): string {
  return process.env[key] || defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]?.toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return defaultValue;
}

export function loadEnvConfig(): EnvConfig {
  return {
    // Wallet & Auth
    privateKey: getEnvString("PRIVATE_KEY"),
    polyApiKey: getEnvString("POLY_API_KEY") || undefined,
    polyApiSecret: getEnvString("POLY_API_SECRET") || undefined,
    polyPassphrase: getEnvString("POLY_PASSPHRASE") || undefined,
    polyFunderAddress: getEnvString("POLY_FUNDER_ADDRESS") || undefined,
    polySignatureType: getEnvNumber("POLY_SIGNATURE_TYPE", 0), // 0 = EOA by default

    // Network
    chainId: getEnvNumber("CHAIN_ID", 137),
    rpcUrl: getEnvString("RPC_URL", "https://polygon-rpc.com"),

    // API Endpoints
    clobApiUrl: getEnvString("CLOB_API_URL", "https://clob.polymarket.com"),
    dataApiUrl: getEnvString("DATA_API_URL", "https://data-api.polymarket.com"),
    gammaApiUrl: getEnvString(
      "GAMMA_API_URL",
      "https://gamma-api.polymarket.com",
    ),

    // Persistence
    useRedis: getEnvBoolean("USE_REDIS", false),
    redisUrl: getEnvString("REDIS_URL", "redis://localhost:6379"),
    dataDir: getEnvString("DATA_DIR", "./data"),

    // Logging
    logLevel: getEnvString("LOG_LEVEL", "info"),
    logToFile: getEnvBoolean("LOG_TO_FILE", true),
    logFile: getEnvString("LOG_FILE", "./data/logs/pmcopy.log"),

    // Defaults - optimized for low latency
    pollIntervalMs: getEnvNumber("POLL_INTERVAL_MS", 300), // Fast polling for quick copy
    sizingMode: getEnvString("SIZING_MODE", "proportional"),
    defaultUsdSize: getEnvNumber("DEFAULT_USD_SIZE", 10),
    defaultSharesSize: getEnvNumber("DEFAULT_SHARES_SIZE", 10),
    proportionalMultiplier: getEnvNumber("PROPORTIONAL_MULTIPLIER", 0.01),
    minOrderSize: getEnvNumber("MIN_ORDER_SIZE", 0.01),
    minOrderShares: getEnvNumber("MIN_ORDER_SHARES", 0.01),
    slippage: getEnvNumber("SLIPPAGE", 0.01),
    maxUsdPerTrade: getEnvNumber("MAX_USD_PER_TRADE", 100),
    maxUsdPerMarket: getEnvNumber("MAX_USD_PER_MARKET", 500),
    maxDailyUsdVolume: getEnvNumber("MAX_DAILY_USD_VOLUME", 1000),
    dryRun: getEnvBoolean("DRY_RUN", false),

    // Paper trading
    paperTrading: getEnvBoolean("PAPER_TRADING", true),
    paperStartingBalance: getEnvNumber("PAPER_STARTING_BALANCE", 1000),
    paperFeeRate: getEnvNumber("PAPER_FEE_RATE", 0.001),

    // Auto-redeem: automatically redeem winning positions periodically
    autoRedeem: getEnvBoolean("AUTO_REDEEM", false),
    autoRedeemIntervalMs: getEnvNumber("AUTO_REDEEM_INTERVAL_MS", 300000), // 5 minutes default

    // Stop-loss: auto-sell positions down by this percentage (0 = disabled, 80 = sell at 80% loss)
    stopLossPercent: getEnvNumber("STOP_LOSS_PERCENT", 0), // 0 = disabled by default
    stopLossCheckIntervalMs: getEnvNumber("STOP_LOSS_CHECK_INTERVAL_MS", 30000), // 30 seconds
  };
}

export function validateEnvConfig(config: EnvConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Private key is required for actual trading (not needed for dry-run or paper trading)
  const needsRealKey = !config.dryRun && !config.paperTrading;

  if (
    !config.privateKey ||
    config.privateKey === "your_private_key_here_without_0x"
  ) {
    if (needsRealKey) {
      errors.push(
        "PRIVATE_KEY is required for live trading. Set it in .env file.",
      );
    }
  } else if (!/^[a-fA-F0-9]{64}$/.test(config.privateKey)) {
    // Only validate key format if we actually need a real key
    if (needsRealKey) {
      errors.push(
        "PRIVATE_KEY should be a 64-character hex string without 0x prefix.",
      );
    }
  }

  // Validate chain ID
  if (config.chainId !== 137 && config.chainId !== 80001) {
    errors.push(
      "CHAIN_ID should be 137 (Polygon Mainnet) or 80001 (Mumbai Testnet).",
    );
  }

  // Validate URLs
  const urlPattern = /^https?:\/\/.+/;
  if (!urlPattern.test(config.clobApiUrl)) {
    errors.push("CLOB_API_URL is not a valid URL.");
  }
  if (!urlPattern.test(config.dataApiUrl)) {
    errors.push("DATA_API_URL is not a valid URL.");
  }
  if (!urlPattern.test(config.gammaApiUrl)) {
    errors.push("GAMMA_API_URL is not a valid URL.");
  }

  // Validate numeric ranges
  if (config.pollIntervalMs < 100) {
    errors.push(
      "POLL_INTERVAL_MS should be at least 100ms to avoid rate limiting.",
    );
  }
  if (config.slippage < 0 || config.slippage > 0.5) {
    errors.push("SLIPPAGE should be between 0 and 0.5 (50%).");
  }
  if (config.maxUsdPerTrade <= 0) {
    errors.push("MAX_USD_PER_TRADE should be positive.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function ensureDataDir(dataDir: string): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const logsDir = path.join(dataDir, "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// Export singleton env config
let envConfigInstance: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (!envConfigInstance) {
    envConfigInstance = loadEnvConfig();
  }
  return envConfigInstance;
}

export function resetEnvConfig(): void {
  envConfigInstance = null;
}
