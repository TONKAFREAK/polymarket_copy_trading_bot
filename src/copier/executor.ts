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

    // Special handling for REDEEM activities
    // REDEEM means the market resolved - we should settle our position, not trade
    if (signal.activityType === "REDEEM") {
      return this.handleRedeem(signal, timestamp);
    }

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
    usdValue = size * signal.price;

    // Polymarket requires minimum 5 shares per order
    const MIN_SHARES = 5;
    if (size < MIN_SHARES) {
      logger.debug("Order size below Polymarket minimum, adjusting", {
        originalSize: size,
        minRequired: MIN_SHARES,
      });
      size = MIN_SHARES;
      usdValue = size * signal.price;
    }

    // Also enforce minimum USD value if configured
    const minOrderSizeUsd = this.tradingConfig.minOrderSize || 0;
    if (minOrderSizeUsd > 0 && usdValue < minOrderSizeUsd && signal.price > 0) {
      // Calculate minimum shares needed to meet minimum order size
      size = Math.ceil((minOrderSizeUsd / signal.price) * 100) / 100;
      // Ensure we still meet the 5 share minimum
      size = Math.max(size, MIN_SHARES);
      usdValue = size * signal.price;
      logger.debug("Order size adjusted to meet minimum USD", {
        minOrderSizeUsd,
        adjustedSize: size,
        adjustedUsdValue: usdValue.toFixed(2),
      });
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
    // If tokenId is already valid (long numeric string), use it directly
    if (signal.tokenId && signal.tokenId.length > 20) {
      logger.debug("Using token ID from signal", {
        tokenId: signal.tokenId.substring(0, 20) + "...",
      });
      return signal.tokenId;
    }

    // Try to resolve using available information
    logger.debug("Resolving token ID", {
      hasTokenId: !!signal.tokenId,
      tokenIdLength: signal.tokenId?.length || 0,
      hasConditionId: !!signal.conditionId,
      hasSlug: !!signal.marketSlug,
      outcome: signal.outcome,
    });

    const resolved = await this.tokenResolver.resolveTokenId({
      tokenId: signal.tokenId,
      conditionId: signal.conditionId,
      marketSlug: signal.marketSlug,
      outcome: signal.outcome,
    });

    if (!resolved) {
      logger.warn("Failed to resolve token ID", {
        tokenId: signal.tokenId,
        conditionId: signal.conditionId,
        marketSlug: signal.marketSlug,
        outcome: signal.outcome,
        activityType: signal.activityType,
      });
    }

    return resolved;
  }

  /**
   * Handle REDEEM activity - settle positions when market resolves
   * When target redeems, we find ALL our positions in the same market and redeem them
   */
  private async handleRedeem(
    signal: TradeSignal,
    timestamp: number
  ): Promise<ExecutionResult> {
    logger.info("Processing REDEEM activity", {
      market: signal.marketSlug,
      tokenId: signal.tokenId?.substring(0, 16) + "...",
      price: signal.price,
    });

    // For paper trading, settle the position
    if (this.paperTradingEnabled && this.paperTradingManager) {
      const result = await this.paperTradingManager.handleRedeem(signal);
      return {
        signal,
        result,
        skipped: false,
        dryRun: false,
        timestamp,
      };
    }

    // For dry-run, just log it
    if (this.riskConfig.dryRun) {
      logger.info("REDEEM (dry-run): Market resolved", {
        market: signal.marketSlug,
        outcome: signal.outcome,
      });
      return {
        signal,
        result: {
          success: true,
          orderId: `REDEEM_DRY_${Date.now()}`,
        },
        skipped: false,
        dryRun: true,
        timestamp,
      };
    }

    // For live trading, find and redeem ALL our positions in the same market
    if (signal.tokenId || signal.conditionId) {
      try {
        const { redeemByTokenId } = await import("../commands/redeem");
        const { getGammaApiClient } = await import("../polymarket/gammaApi");
        const gammaApi = getGammaApiClient();

        // Get the conditionId from the target's token
        let targetConditionId = signal.conditionId;
        let marketName = signal.marketSlug || "Unknown";

        if (!targetConditionId && signal.tokenId) {
          const marketInfo = await gammaApi.getMarketByTokenId(signal.tokenId);
          if (marketInfo) {
            targetConditionId = marketInfo.conditionId;
            marketName = String(
              marketInfo.question || marketInfo.title || marketName
            );
          }
        }

        if (!targetConditionId) {
          logger.warn("REDEEM: Could not find conditionId for market", {
            tokenId: signal.tokenId?.substring(0, 16) + "...",
          });
          return {
            signal,
            skipped: true,
            skipReason: "REDEEM: Could not identify market conditionId",
            dryRun: false,
            timestamp,
          };
        }

        logger.info("REDEEM: Looking for our positions in resolved market", {
          market: marketName,
          conditionId: targetConditionId.substring(0, 20) + "...",
        });

        // Get our positions and find ones matching this conditionId
        const { positions } = await this.getPositions();
        const matchingPositions = positions.filter(
          (pos) => pos.conditionId === targetConditionId && pos.shares > 0
        );

        if (matchingPositions.length === 0) {
          logger.info("REDEEM: No matching positions found in this market", {
            market: marketName,
          });
          return {
            signal,
            result: {
              success: true,
              orderId: `REDEEM_NO_POS_${Date.now()}`,
            },
            skipped: false,
            dryRun: false,
            timestamp,
          };
        }

        logger.info("REDEEM: Found positions to redeem", {
          market: marketName,
          positionCount: matchingPositions.length,
          tokens: matchingPositions.map((p) => ({
            outcome: p.outcome,
            shares: p.shares.toFixed(2),
          })),
        });

        // Redeem each of our positions
        let totalUsdcGained = 0;
        let successCount = 0;
        let lastTxHash: string | undefined;

        for (const pos of matchingPositions) {
          logger.info("REDEEM: Attempting to redeem position", {
            tokenId: pos.tokenId.substring(0, 16) + "...",
            outcome: pos.outcome,
            shares: pos.shares.toFixed(2),
          });

          const result = await redeemByTokenId(pos.tokenId);

          if (result.success) {
            successCount++;
            totalUsdcGained += result.usdcGained;
            lastTxHash = result.txHash;
            logger.info("REDEEM: Position redeemed successfully", {
              outcome: pos.outcome,
              usdcGained: result.usdcGained.toFixed(2),
              txHash: result.txHash,
            });
          } else {
            logger.warn("REDEEM: Failed to redeem position", {
              outcome: pos.outcome,
              error: result.error,
            });
          }
        }

        if (successCount > 0) {
          logger.info("REDEEM: Auto-redemption complete", {
            market: marketName,
            successCount,
            totalPositions: matchingPositions.length,
            totalUsdcGained: totalUsdcGained.toFixed(2),
          });
          return {
            signal,
            result: {
              success: true,
              orderId: lastTxHash || `REDEEM_${Date.now()}`,
              executedPrice: totalUsdcGained,
              executedSize: successCount,
            },
            skipped: false,
            dryRun: false,
            timestamp,
          };
        } else {
          return {
            signal,
            result: {
              success: false,
              errorMessage: "All redemption attempts failed",
            },
            skipped: false,
            dryRun: false,
            timestamp,
          };
        }
      } catch (error) {
        logger.error("Failed to auto-redeem", {
          tokenId: signal.tokenId?.substring(0, 16) + "...",
          error: (error as Error).message,
        });
        return {
          signal,
          result: {
            success: false,
            errorMessage: (error as Error).message,
          },
          skipped: false,
          dryRun: false,
          timestamp,
        };
      }
    }

    // No token ID available - skip
    return {
      signal,
      skipped: true,
      skipReason: "REDEEM: No token ID available for redemption",
      dryRun: false,
      timestamp,
    };
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
   * Get live balance from CLOB client
   */
  async getLiveBalance(): Promise<number> {
    if (!this.clobClient) {
      return 0;
    }
    try {
      const balances = await this.clobClient.getBalances();
      return parseFloat(balances.usdc) || 0;
    } catch (error) {
      logger.error("Failed to get live balance", {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  /**
   * Get live stats for dashboard (balance, open orders, trades)
   */
  async getLiveStats(): Promise<{
    balance: number;
    openOrdersCount: number;
    recentTradesCount: number;
    totalVolume: number;
  }> {
    if (!this.clobClient) {
      return {
        balance: 0,
        openOrdersCount: 0,
        recentTradesCount: 0,
        totalVolume: 0,
      };
    }
    try {
      return await this.clobClient.getLiveStats();
    } catch (error) {
      logger.error("Failed to get live stats", {
        error: (error as Error).message,
      });
      return {
        balance: 0,
        openOrdersCount: 0,
        recentTradesCount: 0,
        totalVolume: 0,
      };
    }
  }

  /**
   * Get open orders from CLOB
   */
  async getOpenOrders(): Promise<unknown[]> {
    if (!this.clobClient) {
      return [];
    }
    try {
      return await this.clobClient.getOpenOrders();
    } catch (error) {
      logger.error("Failed to get open orders", {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Get recent trades from CLOB
   */
  async getTrades(): Promise<{
    trades: Array<Record<string, unknown>>;
    count: number;
  }> {
    if (!this.clobClient) {
      return { trades: [], count: 0 };
    }
    try {
      return await this.clobClient.getTrades();
    } catch (error) {
      logger.error("Failed to get trades", { error: (error as Error).message });
      return { trades: [], count: 0 };
    }
  }

  /**
   * Get current positions (aggregated from trade history)
   */
  async getPositions(): Promise<{
    positions: Array<{
      tokenId: string;
      outcome: string;
      shares: number;
      avgEntryPrice: number;
      currentValue: number;
      market: string;
      conditionId?: string;
      isResolved?: boolean;
      isRedeemable?: boolean;
      feesPaid?: number;
    }>;
    totalValue: number;
    totalFees: number;
  }> {
    if (!this.clobClient) {
      return { positions: [], totalValue: 0, totalFees: 0 };
    }
    try {
      return await this.clobClient.getPositions();
    } catch (error) {
      logger.error("Failed to get positions", {
        error: (error as Error).message,
      });
      return { positions: [], totalValue: 0, totalFees: 0 };
    }
  }

  /**
   * Get paper trading manager (for stats display)
   */
  getPaperTradingManager(): PaperTradingManager | null {
    return this.paperTradingManager;
  }

  /**
   * Get the CLOB client wrapper for advanced operations
   */
  getClobClient(): ClobClientWrapper | null {
    return this.clobClient;
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
