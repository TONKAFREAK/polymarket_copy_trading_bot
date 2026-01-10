/**
 * Trade Executor - handles order placement for copied trades
 */

import {
  TradeSignal,
  TradingConfig,
  RiskConfig,
  OrderRequest,
  OrderResult,
  ExecutionResult,
} from "./types";
import { RiskManager } from "./risk";
import { PaperTradingManager, getPaperTradingManager } from "./paperTrading";
import { ClobClientWrapper, getClobClient } from "../polymarket/clobClient";
import { getTokenResolver, TokenResolver } from "../polymarket/tokenResolver";
import { getLogger, logOrderPlaced, logOrderSkipped } from "../utils/logger";
import { getEnvConfig } from "../config/env";

const logger = getLogger();

export class Executor {
  private tradingConfig: TradingConfig;
  private riskConfig: RiskConfig;
  private riskManager: RiskManager;
  private clobClient: ClobClientWrapper | null = null;
  private paperTradingManager: PaperTradingManager | null = null;
  private tokenResolver: TokenResolver;
  private initialized: boolean = false;
  private paperTradingEnabled: boolean = false;

  constructor(
    tradingConfig: TradingConfig,
    riskManager: RiskManager,
    riskConfig: RiskConfig,
    tokenResolver?: TokenResolver
  ) {
    this.tradingConfig = tradingConfig;
    this.riskConfig = riskConfig;
    this.riskManager = riskManager;
    this.tokenResolver = tokenResolver || getTokenResolver();
  }

  /**
   * Initialize the executor (CLOB client)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const envConfig = getEnvConfig();
    this.paperTradingEnabled = envConfig.paperTrading;

    // Initialize paper trading if enabled
    if (this.paperTradingEnabled) {
      this.paperTradingManager = getPaperTradingManager(
        envConfig.dataDir,
        envConfig.paperStartingBalance
      );
      logger.info("Paper trading enabled", {
        startingBalance: envConfig.paperStartingBalance,
        currentBalance: this.paperTradingManager.getBalance(),
      });
    }

    // Only initialize CLOB client if not in dry-run mode and not paper trading
    if (!this.riskConfig.dryRun && !this.paperTradingEnabled) {
      this.clobClient = await getClobClient();
    }

    this.initialized = true;
    logger.info("Executor initialized", {
      dryRun: this.riskConfig.dryRun,
      paperTrading: this.paperTradingEnabled,
    });
  }

  /**
   * Update configuration
   */
  updateConfig(tradingConfig: TradingConfig, riskConfig: RiskConfig): void {
    this.tradingConfig = tradingConfig;
    this.riskConfig = riskConfig;
  }

  /**
   * Execute a trade based on detected signal
   */
  async execute(signal: TradeSignal): Promise<ExecutionResult> {
    const timestamp = Date.now();

    // Calculate trade size
    const { size, usdValue } = this.calculateSize(signal);

    // Perform risk check
    const riskCheck = await this.riskManager.checkTrade(signal, usdValue);
    if (!riskCheck.allowed) {
      logOrderSkipped(
        logger,
        signal.tradeId,
        riskCheck.reason || "Risk check failed"
      );
      return {
        signal,
        skipped: true,
        skipReason: riskCheck.reason,
        dryRun: this.riskConfig.dryRun,
        timestamp,
      };
    }

    // Resolve token ID if needed
    const tokenId = await this.resolveTokenId(signal);
    if (!tokenId) {
      const reason = "Could not resolve token ID";
      logOrderSkipped(logger, signal.tradeId, reason);
      return {
        signal,
        skipped: true,
        skipReason: reason,
        dryRun: this.riskConfig.dryRun,
        timestamp,
      };
    }

    // Calculate limit price with slippage
    const limitPrice = this.calculateLimitPrice(signal.price, signal.side);

    // Create order request
    const orderRequest: OrderRequest = {
      tokenId,
      side: signal.side,
      price: limitPrice,
      size,
      type: "GTC",
    };

    // Execute or simulate
    let result: OrderResult;

    if (this.riskConfig.dryRun) {
      result = this.simulateOrder(orderRequest);
    } else if (this.paperTradingEnabled && this.paperTradingManager) {
      result = await this.paperTradingManager.executePaperTrade(
        signal,
        orderRequest
      );
    } else {
      result = await this.placeOrder(orderRequest);
    }

    logOrderPlaced(
      logger,
      signal.tradeId,
      result.orderId || "N/A",
      signal.side,
      limitPrice,
      size,
      this.riskConfig.dryRun
    );

    return {
      signal,
      order: orderRequest,
      result,
      skipped: false,
      dryRun: this.riskConfig.dryRun,
      timestamp,
    };
  }

  /**
   * Calculate trade size based on sizing mode
   */
  private calculateSize(signal: TradeSignal): {
    size: number;
    usdValue: number;
  } {
    let size: number;
    let usdValue: number;

    switch (this.tradingConfig.sizingMode) {
      case "fixed_usd":
        // Trade a fixed USD amount
        usdValue = this.tradingConfig.fixedUsdSize;
        // Calculate shares: USD / price
        size = signal.price > 0 ? usdValue / signal.price : 0;
        break;

      case "fixed_shares":
        // Trade a fixed number of shares
        size = this.tradingConfig.fixedSharesSize;
        usdValue = size * signal.price;
        break;

      case "proportional":
        // Scale based on target's trade size
        if (signal.sizeShares && signal.sizeShares > 0) {
          size = signal.sizeShares * this.tradingConfig.proportionalMultiplier;
        } else if (signal.notionalUsd && signal.notionalUsd > 0) {
          usdValue =
            signal.notionalUsd * this.tradingConfig.proportionalMultiplier;
          size = signal.price > 0 ? usdValue / signal.price : 0;
        } else {
          // Fallback to fixed USD
          usdValue = this.tradingConfig.fixedUsdSize;
          size = signal.price > 0 ? usdValue / signal.price : 0;
        }
        usdValue = size * signal.price;
        break;

      default:
        // Default to fixed USD
        usdValue = this.tradingConfig.fixedUsdSize;
        size = signal.price > 0 ? usdValue / signal.price : 0;
    }

    // Round size to reasonable precision
    size = Math.round(size * 100) / 100;

    // Ensure minimum size
    if (size < 0.01) {
      size = 0.01;
    }

    return { size, usdValue };
  }

  /**
   * Calculate limit price with slippage
   */
  private calculateLimitPrice(
    targetPrice: number,
    side: "BUY" | "SELL"
  ): number {
    let limitPrice: number;

    if (side === "BUY") {
      // Willing to pay more for BUY
      limitPrice = targetPrice * (1 + this.tradingConfig.slippage);
      // Cap at 0.99
      limitPrice = Math.min(limitPrice, 0.99);
    } else {
      // Willing to accept less for SELL
      limitPrice = targetPrice * (1 - this.tradingConfig.slippage);
      // Floor at 0.01
      limitPrice = Math.max(limitPrice, 0.01);
    }

    // Round to 2 decimal places (Polymarket precision)
    return Math.round(limitPrice * 100) / 100;
  }

  /**
   * Resolve token ID from signal
   */
  private async resolveTokenId(signal: TradeSignal): Promise<string | null> {
    // If tokenId is already valid, use it
    if (signal.tokenId && signal.tokenId.length > 20) {
      return signal.tokenId;
    }

    // Try to resolve using available information
    const resolved = await this.tokenResolver.resolveTokenId({
      tokenId: signal.tokenId,
      conditionId: signal.conditionId,
      marketSlug: signal.marketSlug,
      outcome: signal.outcome,
    });

    return resolved;
  }

  /**
   * Place a real order via CLOB client
   */
  private async placeOrder(orderRequest: OrderRequest): Promise<OrderResult> {
    if (!this.clobClient) {
      return {
        success: false,
        errorMessage: "CLOB client not initialized",
      };
    }

    try {
      return await this.clobClient.placeMarketableLimitOrder(
        orderRequest.tokenId,
        orderRequest.side,
        orderRequest.price,
        orderRequest.size,
        this.tradingConfig.slippage
      );
    } catch (error) {
      return {
        success: false,
        errorMessage: (error as Error).message,
      };
    }
  }

  /**
   * Simulate an order (dry run)
   */
  private simulateOrder(orderRequest: OrderRequest): OrderResult {
    logger.info("Simulating order (dry-run)", {
      tokenId: orderRequest.tokenId.substring(0, 16) + "...",
      side: orderRequest.side,
      price: orderRequest.price,
      size: orderRequest.size,
      usdValue: (orderRequest.price * orderRequest.size).toFixed(2),
    });

    return {
      success: true,
      orderId: `DRY_RUN_${Date.now()}`,
      executedPrice: orderRequest.price,
      executedSize: orderRequest.size,
    };
  }

  /**
   * Get executor status
   */
  getStatus(): {
    initialized: boolean;
    dryRun: boolean;
    paperTrading: boolean;
    paperBalance?: number;
  } {
    return {
      initialized: this.initialized,
      dryRun: this.riskConfig.dryRun,
      paperTrading: this.paperTradingEnabled,
      paperBalance: this.paperTradingManager?.getBalance(),
    };
  }

  /**
   * Get paper trading manager (for stats display)
   */
  getPaperTradingManager(): PaperTradingManager | null {
    return this.paperTradingManager;
  }
}

// Factory function
export function createExecutor(
  tradingConfig: TradingConfig,
  riskConfig: RiskConfig,
  riskManager: RiskManager
): Executor {
  return new Executor(tradingConfig, riskManager, riskConfig);
}
