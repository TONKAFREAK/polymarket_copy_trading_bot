/**
 * Configuration management for the Polymarket Copy Trader
 */

import * as fs from "fs";
import * as path from "path";
import {
  AppConfig,
  TradingConfig,
  RiskConfig,
  PollingConfig,
  SizingMode,
} from "../copier/types";
import { getEnvConfig, EnvConfig } from "./env";

/**
 * Get default trading config from environment variables
 */
function getDefaultTradingConfig(env: EnvConfig): TradingConfig {
  return {
    sizingMode: env.sizingMode as SizingMode,
    fixedUsdSize: env.defaultUsdSize,
    fixedSharesSize: env.defaultSharesSize,
    proportionalMultiplier: env.proportionalMultiplier,
    minOrderSize: env.minOrderSize,
    slippage: env.slippage,
  };
}

/**
 * Get default risk config from environment variables
 */
function getDefaultRiskConfig(env: EnvConfig): RiskConfig {
  return {
    maxUsdPerTrade: env.maxUsdPerTrade,
    maxUsdPerMarket: env.maxUsdPerMarket,
    maxDailyUsdVolume: env.maxDailyUsdVolume,
    doNotTradeMarketsOlderThanSecondsFromResolution: 0,
    marketAllowlist: [],
    marketDenylist: [],
    dryRun: env.dryRun,
  };
}

/**
 * Get default polling config from environment variables
 */
function getDefaultPollingConfig(env: EnvConfig): PollingConfig {
  return {
    intervalMs: env.pollIntervalMs,
    tradeLimit: 20,
    maxRetries: 3,
    baseBackoffMs: 1000,
  };
}

/**
 * Get default app config from environment variables
 */
function getDefaultAppConfig(env: EnvConfig): AppConfig {
  return {
    trading: getDefaultTradingConfig(env),
    risk: getDefaultRiskConfig(env),
    polling: getDefaultPollingConfig(env),
    targets: [],
    chainId: env.chainId,
  };
}

export class ConfigManager {
  private configPath: string;
  private config: AppConfig;
  private env: EnvConfig;

  constructor(dataDir: string = "./data") {
    this.configPath = path.join(dataDir, "config.json");
    this.env = getEnvConfig();
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from file or create default from env
   */
  private loadConfig(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, "utf-8");
        const loaded = JSON.parse(data) as Partial<AppConfig>;
        return this.mergeWithDefaults(loaded);
      }
    } catch (error) {
      console.warn("Failed to load config, using defaults from .env:", error);
    }
    return getDefaultAppConfig(this.env);
  }

  /**
   * Merge loaded config with defaults (from env) to ensure all fields exist
   */
  private mergeWithDefaults(loaded: Partial<AppConfig>): AppConfig {
    const defaultConfig = getDefaultAppConfig(this.env);
    return {
      trading: { ...defaultConfig.trading, ...loaded.trading },
      risk: { ...defaultConfig.risk, ...loaded.risk },
      polling: { ...defaultConfig.polling, ...loaded.polling },
      targets: loaded.targets || [],
      chainId: loaded.chainId || this.env.chainId,
    };
  }

  /**
   * Get the environment config
   */
  getEnvConfig(): EnvConfig {
    return this.env;
  }

  /**
   * Save configuration to file
   */
  save(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  /**
   * Get the full configuration
   */
  getConfig(): AppConfig {
    return { ...this.config };
  }

  /**
   * Get a specific configuration value by path (e.g., "trading.slippage")
   */
  get<T = unknown>(keyPath: string): T | undefined {
    const parts = keyPath.split(".");
    let current: unknown = this.config;

    for (const part of parts) {
      if (current && typeof current === "object" && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current as T;
  }

  /**
   * Set a specific configuration value by path
   */
  set(keyPath: string, value: unknown): boolean {
    const parts = keyPath.split(".");
    const lastPart = parts.pop();

    if (!lastPart) return false;

    let current: Record<string, unknown> = this.config as unknown as Record<
      string,
      unknown
    >;

    for (const part of parts) {
      if (current && typeof current === "object" && part in current) {
        current = current[part] as Record<string, unknown>;
      } else {
        return false;
      }
    }

    if (current && typeof current === "object") {
      // Validate and convert value based on expected type
      const convertedValue = this.convertValue(keyPath, value);
      if (convertedValue === undefined) return false;

      current[lastPart] = convertedValue;
      this.save();
      return true;
    }

    return false;
  }

  /**
   * Convert string value to appropriate type based on config path
   */
  private convertValue(keyPath: string, value: unknown): unknown {
    const numericPaths = [
      "trading.fixedUsdSize",
      "trading.fixedSharesSize",
      "trading.proportionalMultiplier",
      "trading.slippage",
      "risk.maxUsdPerTrade",
      "risk.maxUsdPerMarket",
      "risk.maxDailyUsdVolume",
      "risk.doNotTradeMarketsOlderThanSecondsFromResolution",
      "polling.intervalMs",
      "polling.tradeLimit",
      "polling.maxRetries",
      "polling.baseBackoffMs",
      "chainId",
    ];

    const booleanPaths = ["risk.dryRun"];

    const arrayPaths = [
      "risk.marketAllowlist",
      "risk.marketDenylist",
      "targets",
    ];

    const sizingModes: SizingMode[] = [
      "fixed_usd",
      "fixed_shares",
      "proportional",
    ];

    if (keyPath === "trading.sizingMode") {
      if (sizingModes.includes(value as SizingMode)) {
        return value;
      }
      return undefined;
    }

    if (numericPaths.includes(keyPath)) {
      const num = Number(value);
      return isNaN(num) ? undefined : num;
    }

    if (booleanPaths.includes(keyPath)) {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return undefined;
    }

    if (arrayPaths.includes(keyPath)) {
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        return value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return undefined;
    }

    return value;
  }

  // ============================================
  // TARGETS MANAGEMENT
  // ============================================

  /**
   * Get all target wallets
   */
  getTargets(): string[] {
    return [...this.config.targets];
  }

  /**
   * Add a target wallet
   */
  addTarget(wallet: string): boolean {
    const normalized = wallet.toLowerCase();
    if (!this.isValidAddress(normalized)) {
      return false;
    }
    if (this.config.targets.includes(normalized)) {
      return false; // Already exists
    }
    this.config.targets.push(normalized);
    this.save();
    return true;
  }

  /**
   * Remove a target wallet
   */
  removeTarget(wallet: string): boolean {
    const normalized = wallet.toLowerCase();
    const index = this.config.targets.indexOf(normalized);
    if (index === -1) {
      return false;
    }
    this.config.targets.splice(index, 1);
    this.save();
    return true;
  }

  /**
   * Set multiple targets at once
   */
  setTargets(wallets: string[]): void {
    this.config.targets = wallets
      .map((w) => w.toLowerCase())
      .filter((w) => this.isValidAddress(w));
    this.save();
  }

  /**
   * Validate Ethereum address format
   */
  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initialize with provided options
   */
  initialize(options: {
    targets?: string[];
    sizingMode?: SizingMode;
    usd?: number;
    shares?: number;
    slippage?: number;
    dryRun?: boolean;
  }): void {
    if (options.targets) {
      this.setTargets(options.targets);
    }
    if (options.sizingMode) {
      this.config.trading.sizingMode = options.sizingMode;
    }
    if (options.usd !== undefined) {
      this.config.trading.fixedUsdSize = options.usd;
    }
    if (options.shares !== undefined) {
      this.config.trading.fixedSharesSize = options.shares;
    }
    if (options.slippage !== undefined) {
      this.config.trading.slippage = options.slippage;
    }
    if (options.dryRun !== undefined) {
      this.config.risk.dryRun = options.dryRun;
    }
    this.save();
  }

  /**
   * Initialize with full options (used by init command)
   */
  initializeFull(options: {
    targets?: string[];
    sizingMode?: SizingMode;
    fixedUsdSize?: number;
    fixedSharesSize?: number;
    proportionalMultiplier?: number;
    slippage?: number;
    maxUsdPerTrade?: number;
    maxUsdPerMarket?: number;
    maxDailyUsdVolume?: number;
    pollIntervalMs?: number;
    dryRun?: boolean;
  }): void {
    // Set targets
    if (options.targets) {
      this.setTargets(options.targets);
    }

    // Trading config
    if (options.sizingMode) {
      this.config.trading.sizingMode = options.sizingMode;
    }
    if (options.fixedUsdSize !== undefined && !isNaN(options.fixedUsdSize)) {
      this.config.trading.fixedUsdSize = options.fixedUsdSize;
    }
    if (
      options.fixedSharesSize !== undefined &&
      !isNaN(options.fixedSharesSize)
    ) {
      this.config.trading.fixedSharesSize = options.fixedSharesSize;
    }
    if (
      options.proportionalMultiplier !== undefined &&
      !isNaN(options.proportionalMultiplier)
    ) {
      this.config.trading.proportionalMultiplier =
        options.proportionalMultiplier;
    }
    if (options.slippage !== undefined && !isNaN(options.slippage)) {
      this.config.trading.slippage = options.slippage;
    }

    // Risk config
    if (
      options.maxUsdPerTrade !== undefined &&
      !isNaN(options.maxUsdPerTrade)
    ) {
      this.config.risk.maxUsdPerTrade = options.maxUsdPerTrade;
    }
    if (
      options.maxUsdPerMarket !== undefined &&
      !isNaN(options.maxUsdPerMarket)
    ) {
      this.config.risk.maxUsdPerMarket = options.maxUsdPerMarket;
    }
    if (
      options.maxDailyUsdVolume !== undefined &&
      !isNaN(options.maxDailyUsdVolume)
    ) {
      this.config.risk.maxDailyUsdVolume = options.maxDailyUsdVolume;
    }
    if (options.dryRun !== undefined) {
      this.config.risk.dryRun = options.dryRun;
    }

    // Polling config
    if (
      options.pollIntervalMs !== undefined &&
      !isNaN(options.pollIntervalMs)
    ) {
      this.config.polling.intervalMs = options.pollIntervalMs;
    }

    this.save();
  }

  /**
   * Reset configuration to defaults (from env)
   */
  reset(): void {
    this.config = getDefaultAppConfig(this.env);
    this.save();
  }

  /**
   * Get all configuration keys for help display
   */
  static getConfigKeys(): string[] {
    return [
      "trading.sizingMode",
      "trading.fixedUsdSize",
      "trading.fixedSharesSize",
      "trading.proportionalMultiplier",
      "trading.slippage",
      "risk.maxUsdPerTrade",
      "risk.maxUsdPerMarket",
      "risk.maxDailyUsdVolume",
      "risk.doNotTradeMarketsOlderThanSecondsFromResolution",
      "risk.marketAllowlist",
      "risk.marketDenylist",
      "risk.dryRun",
      "polling.intervalMs",
      "polling.tradeLimit",
      "polling.maxRetries",
      "polling.baseBackoffMs",
      "chainId",
    ];
  }
}

// Singleton instance
let configManagerInstance: ConfigManager | null = null;

export function getConfigManager(dataDir?: string): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager(
      dataDir || process.env.DATA_DIR || "./data"
    );
  }
  return configManagerInstance;
}

export function resetConfigManager(): void {
  configManagerInstance = null;
}
