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

// Default configuration values
const DEFAULT_TRADING_CONFIG: TradingConfig = {
  sizingMode: "fixed_usd",
  fixedUsdSize: 10,
  fixedSharesSize: 10,
  proportionalMultiplier: 0.25,
  slippage: 0.01,
};

const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxUsdPerTrade: 100,
  maxUsdPerMarket: 500,
  maxDailyUsdVolume: 1000,
  doNotTradeMarketsOlderThanSecondsFromResolution: 0,
  marketAllowlist: [],
  marketDenylist: [],
  dryRun: true,
};

const DEFAULT_POLLING_CONFIG: PollingConfig = {
  intervalMs: 2500,
  tradeLimit: 20,
  maxRetries: 3,
  baseBackoffMs: 1000,
};

const DEFAULT_APP_CONFIG: AppConfig = {
  trading: DEFAULT_TRADING_CONFIG,
  risk: DEFAULT_RISK_CONFIG,
  polling: DEFAULT_POLLING_CONFIG,
  targets: [],
  chainId: 137,
};

export class ConfigManager {
  private configPath: string;
  private config: AppConfig;

  constructor(dataDir: string = "./data") {
    this.configPath = path.join(dataDir, "config.json");
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from file or create default
   */
  private loadConfig(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, "utf-8");
        const loaded = JSON.parse(data) as Partial<AppConfig>;
        return this.mergeWithDefaults(loaded);
      }
    } catch (error) {
      console.warn("Failed to load config, using defaults:", error);
    }
    return { ...DEFAULT_APP_CONFIG };
  }

  /**
   * Merge loaded config with defaults to ensure all fields exist
   */
  private mergeWithDefaults(loaded: Partial<AppConfig>): AppConfig {
    return {
      trading: { ...DEFAULT_TRADING_CONFIG, ...loaded.trading },
      risk: { ...DEFAULT_RISK_CONFIG, ...loaded.risk },
      polling: { ...DEFAULT_POLLING_CONFIG, ...loaded.polling },
      targets: loaded.targets || [],
      chainId: loaded.chainId || 137,
    };
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
   * Reset configuration to defaults
   */
  reset(): void {
    this.config = { ...DEFAULT_APP_CONFIG };
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
