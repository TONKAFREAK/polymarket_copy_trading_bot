/**
 * Paper Trading Manager - Simulates trades with virtual funds
 * Tracks positions, calculates PnL, and provides performance stats
 */

import * as fs from "fs";
import * as path from "path";
import { getLogger } from "../utils/logger";
import { TradeSignal, OrderRequest, OrderResult, TradeSide } from "./types";
import { getGammaApiClient } from "../polymarket/gammaApi";

const logger = getLogger();

// ============================================
// PAPER TRADING TYPES
// ============================================

export interface PaperPosition {
  tokenId: string;
  marketSlug: string;
  outcome: "YES" | "NO";
  side: TradeSide;
  shares: number;
  avgEntryPrice: number;
  totalCost: number;
  currentPrice?: number;
  unrealizedPnl?: number;
  openedAt: number;
  resolved?: boolean; // True if market has expired/resolved
  settled?: boolean; // True if P&L has been realized from resolution
  settlementPrice?: number; // 1.0 if won, 0.0 if lost
  settlementPnl?: number; // Final P&L from resolution
}

export interface PaperTrade {
  id: string;
  timestamp: number;
  tokenId: string;
  marketSlug: string;
  outcome: "YES" | "NO";
  side: TradeSide;
  price: number;
  shares: number;
  usdValue: number;
  fees: number;
  pnl?: number; // Set when closing a position
  targetWallet: string;
  tradeId: string;
}

export interface PaperTradingState {
  enabled: boolean;
  startingBalance: number;
  currentBalance: number;
  positions: Record<string, PaperPosition>; // tokenId -> position
  trades: PaperTrade[];
  stats: PaperTradingStats;
  createdAt: number;
  updatedAt: number;
}

export interface PaperTradingStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  totalFees: number;
  largestWin: number;
  largestLoss: number;
  winRate: number;
  profitFactor: number;
  avgTradeSize: number;
}

// ============================================
// PAPER TRADING MANAGER
// ============================================

export class PaperTradingManager {
  private state: PaperTradingState;
  private stateFile: string;
  private feeRate: number = 0.001; // 0.1% fee simulation

  constructor(dataDir: string = "./data", startingBalance: number = 1000) {
    this.stateFile = path.join(dataDir, "paper-state.json");
    this.state = this.loadState(startingBalance);
  }

  /**
   * Load paper trading state from file or create new
   */
  private loadState(startingBalance: number): PaperTradingState {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, "utf-8");
        const loaded = JSON.parse(data) as PaperTradingState;
        logger.info("Loaded paper trading state", {
          balance: loaded.currentBalance,
          positions: Object.keys(loaded.positions).length,
          trades: loaded.trades.length,
        });
        return loaded;
      }
    } catch (err) {
      logger.warn("Failed to load paper trading state, creating new", {
        error: err,
      });
    }

    // Create new state
    return this.createNewState(startingBalance);
  }

  /**
   * Create a fresh paper trading state
   */
  private createNewState(startingBalance: number): PaperTradingState {
    return {
      enabled: true,
      startingBalance,
      currentBalance: startingBalance,
      positions: {},
      trades: [],
      stats: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalRealizedPnl: 0,
        totalUnrealizedPnl: 0,
        totalFees: 0,
        largestWin: 0,
        largestLoss: 0,
        winRate: 0,
        profitFactor: 0,
        avgTradeSize: 0,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Save state to file
   */
  private saveState(): void {
    try {
      this.state.updatedAt = Date.now();
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (err) {
      logger.error("Failed to save paper trading state", { error: err });
    }
  }

  /**
   * Reset paper trading account
   */
  reset(startingBalance?: number): void {
    const balance = startingBalance || this.state.startingBalance;
    this.state = this.createNewState(balance);
    this.saveState();
    logger.info("Paper trading account reset", { startingBalance: balance });
  }

  /**
   * Get current state
   */
  getState(): PaperTradingState {
    return this.state;
  }

  /**
   * Get current balance
   */
  getBalance(): number {
    return this.state.currentBalance;
  }

  /**
   * Execute a paper trade
   */
  async executePaperTrade(
    signal: TradeSignal,
    order: OrderRequest
  ): Promise<OrderResult> {
    const usdValue = order.size * order.price;
    const fees = usdValue * this.feeRate;
    const totalCost = usdValue + fees;

    // Check if we have enough balance for buys
    if (signal.side === "BUY" && totalCost > this.state.currentBalance) {
      return {
        success: false,
        errorMessage: `Insufficient paper balance: need $${totalCost.toFixed(
          2
        )}, have $${this.state.currentBalance.toFixed(2)}`,
      };
    }

    // Create trade record
    const trade: PaperTrade = {
      id: `paper-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      tokenId: order.tokenId,
      marketSlug: signal.marketSlug || "unknown",
      outcome: (signal.outcome as "YES" | "NO") || "YES",
      side: signal.side,
      price: order.price,
      shares: order.size,
      usdValue,
      fees,
      targetWallet: signal.targetWallet,
      tradeId: signal.tradeId,
    };

    // Update position and balance
    if (signal.side === "BUY") {
      this.processBuy(
        order.tokenId,
        signal,
        order.price,
        order.size,
        totalCost,
        trade
      );
    } else {
      this.processSell(
        order.tokenId,
        signal,
        order.price,
        order.size,
        fees,
        trade
      );
    }

    // Update stats
    this.state.stats.totalTrades++;
    this.state.stats.totalFees += fees;
    this.state.stats.avgTradeSize =
      this.state.trades.reduce((sum, t) => sum + t.usdValue, 0) /
      this.state.trades.length;

    // Save state
    this.saveState();

    logger.info("Paper trade executed", {
      type: signal.activityType || "TRADE",
      side: signal.side,
      shares: order.size,
      price: order.price,
      usdValue: usdValue.toFixed(2),
      fees: fees.toFixed(4),
      newBalance: this.state.currentBalance.toFixed(2),
    });

    return {
      success: true,
      orderId: trade.id,
      executedPrice: order.price,
      executedSize: order.size,
    };
  }

  /**
   * Process a buy order
   */
  private processBuy(
    tokenId: string,
    signal: TradeSignal,
    price: number,
    shares: number,
    totalCost: number,
    trade: PaperTrade
  ): void {
    // Deduct from balance
    this.state.currentBalance -= totalCost;

    // Update or create position
    const existing = this.state.positions[tokenId];
    if (existing && existing.shares > 0) {
      // Average in
      const newTotalCost = existing.totalCost + price * shares;
      const newShares = existing.shares + shares;
      existing.avgEntryPrice = newTotalCost / newShares;
      existing.shares = newShares;
      existing.totalCost = newTotalCost;
    } else {
      // New position
      this.state.positions[tokenId] = {
        tokenId,
        marketSlug: signal.marketSlug || "unknown",
        outcome: (signal.outcome as "YES" | "NO") || "YES",
        side: "BUY",
        shares,
        avgEntryPrice: price,
        totalCost: price * shares,
        openedAt: Date.now(),
      };
    }

    this.state.trades.push(trade);
  }

  /**
   * Process a sell order
   */
  private processSell(
    tokenId: string,
    signal: TradeSignal,
    price: number,
    shares: number,
    fees: number,
    trade: PaperTrade
  ): void {
    const existing = this.state.positions[tokenId];

    if (existing && existing.shares > 0) {
      // Closing existing position (partial or full)
      const sharesToClose = Math.min(shares, existing.shares);
      const costBasis = existing.avgEntryPrice * sharesToClose;
      const saleProceeds = price * sharesToClose - fees;
      const pnl = saleProceeds - costBasis;

      trade.pnl = pnl;

      // Update balance
      this.state.currentBalance += saleProceeds;

      // Update position
      existing.shares -= sharesToClose;
      existing.totalCost = existing.avgEntryPrice * existing.shares;

      if (existing.shares <= 0) {
        delete this.state.positions[tokenId];
      }

      // Update stats
      this.state.stats.totalRealizedPnl += pnl;
      if (pnl > 0) {
        this.state.stats.winningTrades++;
        this.state.stats.largestWin = Math.max(
          this.state.stats.largestWin,
          pnl
        );
      } else {
        this.state.stats.losingTrades++;
        this.state.stats.largestLoss = Math.min(
          this.state.stats.largestLoss,
          pnl
        );
      }

      // Calculate win rate
      const closedTrades =
        this.state.stats.winningTrades + this.state.stats.losingTrades;
      this.state.stats.winRate =
        closedTrades > 0
          ? (this.state.stats.winningTrades / closedTrades) * 100
          : 0;
    } else {
      // Short selling (opening a short position)
      const proceeds = price * shares - fees;
      this.state.currentBalance += proceeds;

      this.state.positions[tokenId] = {
        tokenId,
        marketSlug: signal.marketSlug || "unknown",
        outcome: (signal.outcome as "YES" | "NO") || "YES",
        side: "SELL",
        shares: -shares, // Negative for short
        avgEntryPrice: price,
        totalCost: -(price * shares),
        openedAt: Date.now(),
      };
    }

    this.state.trades.push(trade);
  }

  /**
   * Settle resolved positions - calculate final P&L based on market resolution
   * In Polymarket: winning shares pay $1.00, losing shares pay $0.00
   */
  async settleResolvedPositions(): Promise<{
    settled: number;
    totalPnl: number;
    wins: number;
    losses: number;
  }> {
    const gammaApi = getGammaApiClient();
    let settledCount = 0;
    let totalSettlementPnl = 0;
    let wins = 0;
    let losses = 0;

    for (const [tokenId, position] of Object.entries(this.state.positions)) {
      // Skip if already settled or no shares
      if (position.settled || position.shares === 0) continue;

      try {
        // Check if market is resolved
        const resolution = await gammaApi.getMarketResolution(
          position.marketSlug
        );

        if (!resolution.resolved) {
          continue; // Market not resolved yet
        }

        // Determine if this position won or lost
        // For a BUY position on YES: wins if YES won (outcome price = 1)
        // For a BUY position on NO: wins if NO won (outcome price = 1)
        const outcomeIndex = position.outcome === "YES" ? 0 : 1;
        const settlementPrice = resolution.outcomePrices[outcomeIndex] ?? 0;

        // Calculate P&L
        // Settlement value = shares * settlement price ($1 if won, $0 if lost)
        // P&L = settlement value - cost basis
        const settlementValue = position.shares * settlementPrice;
        const costBasis = position.totalCost;
        const pnl = settlementValue - costBasis;

        // Update position
        position.resolved = true;
        position.settled = true;
        position.settlementPrice = settlementPrice;
        position.settlementPnl = pnl;

        // Add settlement value to balance (winning positions pay out)
        this.state.currentBalance += settlementValue;

        // Update stats
        this.state.stats.totalRealizedPnl += pnl;
        if (pnl > 0) {
          wins++;
          this.state.stats.winningTrades++;
          if (pnl > this.state.stats.largestWin) {
            this.state.stats.largestWin = pnl;
          }
        } else if (pnl < 0) {
          losses++;
          this.state.stats.losingTrades++;
          if (pnl < this.state.stats.largestLoss) {
            this.state.stats.largestLoss = pnl;
          }
        }

        // Zero out position shares (position is closed)
        position.shares = 0;

        settledCount++;
        totalSettlementPnl += pnl;

        logger.info("Position settled", {
          market: position.marketSlug,
          outcome: position.outcome,
          won: settlementPrice >= 0.99,
          pnl: pnl.toFixed(2),
          settlementValue: settlementValue.toFixed(2),
        });
      } catch (error) {
        logger.debug("Failed to settle position", {
          tokenId,
          market: position.marketSlug,
          error: (error as Error).message,
        });
      }
    }

    // Update win rate
    const totalClosedTrades =
      this.state.stats.winningTrades + this.state.stats.losingTrades;
    this.state.stats.winRate =
      totalClosedTrades > 0
        ? (this.state.stats.winningTrades / totalClosedTrades) * 100
        : 0;

    // Calculate profit factor
    const totalWins = Object.values(this.state.positions)
      .filter((p) => p.settlementPnl && p.settlementPnl > 0)
      .reduce((sum, p) => sum + (p.settlementPnl || 0), 0);
    const totalLosses = Math.abs(
      Object.values(this.state.positions)
        .filter((p) => p.settlementPnl && p.settlementPnl < 0)
        .reduce((sum, p) => sum + (p.settlementPnl || 0), 0)
    );
    this.state.stats.profitFactor =
      totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    this.saveState();

    return {
      settled: settledCount,
      totalPnl: totalSettlementPnl,
      wins,
      losses,
    };
  }

  /**
   * Update position prices and unrealized PnL
   * Also checks for and settles resolved markets
   */
  async updatePrices(): Promise<void> {
    let totalUnrealizedPnl = 0;

    // First, settle any resolved positions
    const settlement = await this.settleResolvedPositions();
    if (settlement.settled > 0) {
      logger.info("Settled resolved positions", {
        count: settlement.settled,
        pnl: settlement.totalPnl.toFixed(2),
        wins: settlement.wins,
        losses: settlement.losses,
      });
    }

    for (const [_tokenId, position] of Object.entries(this.state.positions)) {
      if (position.shares === 0 || position.settled) continue;

      try {
        // Try to get current price from Gamma API
        const gammaApi = getGammaApiClient();
        const market = await gammaApi.getMarketBySlug(position.marketSlug);
        if (market) {
          // Check if market is now closed
          if (market.closed) {
            position.resolved = true;
            // Will be settled on next call
            continue;
          }

          // Get current price from market tokens
          let currentPrice = position.avgEntryPrice;
          if (market.tokens && market.tokens.length > 0) {
            const outcomeIndex = position.outcome === "YES" ? 0 : 1;
            if (market.tokens[outcomeIndex]) {
              currentPrice = market.tokens[outcomeIndex].price || currentPrice;
            }
          }
          // Also try parsing outcomePrices if available
          if (market.outcomePrices) {
            try {
              const prices = market.outcomePrices.startsWith("[")
                ? JSON.parse(market.outcomePrices)
                : market.outcomePrices
                    .split(",")
                    .map((p: string) => parseFloat(p));
              const outcomeIndex = position.outcome === "YES" ? 0 : 1;
              if (prices[outcomeIndex] !== undefined) {
                currentPrice = prices[outcomeIndex];
              }
            } catch {
              // Use token price
            }
          }

          position.currentPrice = currentPrice;

          if (position.shares > 0) {
            // Long position: value = shares * currentPrice, cost = totalCost
            const currentValue = position.shares * currentPrice;
            position.unrealizedPnl = currentValue - position.totalCost;
          }

          totalUnrealizedPnl += position.unrealizedPnl || 0;
        } else {
          // Market not found - likely expired/resolved, mark as needing settlement
          position.resolved = true;
        }
      } catch {
        // 422 errors mean market is expired/resolved - silently skip
        // Keep existing values, mark position as potentially resolved
        position.resolved = true;
      }
    }

    this.state.stats.totalUnrealizedPnl = totalUnrealizedPnl;
    this.saveState();
  }

  /**
   * Get formatted stats for display
   */
  getFormattedStats(): string {
    const state = this.state;
    const stats = state.stats;
    const totalPnl = stats.totalRealizedPnl + stats.totalUnrealizedPnl;

    // Calculate portfolio value (cash + positions at entry)
    const positionValue = Object.values(state.positions).reduce(
      (sum, pos) => sum + Math.abs(pos.shares) * pos.avgEntryPrice,
      0
    );
    const portfolioValue = state.currentBalance + positionValue;
    const returnPct =
      ((portfolioValue - state.startingBalance) / state.startingBalance) * 100;

    // Helper to pad line to exactly 60 chars content + borders
    const pad = (content: string): string => {
      const line = `║ ${content}`;
      return line.padEnd(61) + "║";
    };

    const lines = [
      "╔════════════════════════════════════════════════════════════╗",
      "║              📊 PAPER TRADING PERFORMANCE                  ║",
      "╠════════════════════════════════════════════════════════════╣",
      pad("ACCOUNT"),
      pad(
        `  Starting Balance:    $${state.startingBalance
          .toFixed(2)
          .padStart(10)}`
      ),
      pad(
        `  Cash Balance:        $${state.currentBalance
          .toFixed(2)
          .padStart(10)}`
      ),
      pad(`  Position Value:      $${positionValue.toFixed(2).padStart(10)}`),
      pad(`  Portfolio Value:     $${portfolioValue.toFixed(2).padStart(10)}`),
      pad(
        `  Total Return:       ${returnPct >= 0 ? "+" : ""}${returnPct
          .toFixed(2)
          .padStart(7)}%`
      ),
      "╠════════════════════════════════════════════════════════════╣",
      pad("PNL BREAKDOWN"),
      pad(
        `  Realized PnL:       ${
          stats.totalRealizedPnl >= 0 ? "+" : ""
        }$${stats.totalRealizedPnl.toFixed(2).padStart(10)}`
      ),
      pad(
        `  Unrealized PnL:     ${
          stats.totalUnrealizedPnl >= 0 ? "+" : ""
        }$${stats.totalUnrealizedPnl.toFixed(2).padStart(10)}`
      ),
      pad(
        `  Total PnL:          ${totalPnl >= 0 ? "+" : ""}$${totalPnl
          .toFixed(2)
          .padStart(10)}`
      ),
      pad(
        `  Total Fees:          -$${stats.totalFees.toFixed(2).padStart(10)}`
      ),
      "╠════════════════════════════════════════════════════════════╣",
      pad("TRADE STATISTICS"),
      pad(
        `  Total Trades:        ${stats.totalTrades.toString().padStart(10)}`
      ),
      pad(
        `  Winning Trades:      ${stats.winningTrades.toString().padStart(10)}`
      ),
      pad(
        `  Losing Trades:       ${stats.losingTrades.toString().padStart(10)}`
      ),
      pad(`  Win Rate:            ${stats.winRate.toFixed(1).padStart(9)}%`),
      pad(
        `  Avg Trade Size:      $${stats.avgTradeSize.toFixed(2).padStart(10)}`
      ),
      pad(
        `  Largest Win:        ${
          stats.largestWin >= 0 ? "+" : ""
        }$${stats.largestWin.toFixed(2).padStart(10)}`
      ),
      pad(
        `  Largest Loss:       ${stats.largestLoss < 0 ? "-" : " "}$${Math.abs(
          stats.largestLoss
        )
          .toFixed(2)
          .padStart(10)}`
      ),
      "╠════════════════════════════════════════════════════════════╣",
      pad("OPEN POSITIONS"),
    ];

    const positions = Object.values(state.positions);
    if (positions.length === 0) {
      lines.push(pad("  No open positions"));
    } else {
      for (const pos of positions.slice(0, 8)) {
        const status = pos.resolved
          ? "EXPIRED"
          : pos.shares > 0
          ? "LONG "
          : "SHORT";
        const pnlStr =
          pos.unrealizedPnl !== undefined
            ? `${pos.unrealizedPnl >= 0 ? "+" : ""}$${pos.unrealizedPnl.toFixed(
                2
              )}`
            : pos.resolved
            ? "EXPIRED"
            : "N/A";
        const slug =
          pos.marketSlug.length > 22
            ? pos.marketSlug.substring(0, 19) + "..."
            : pos.marketSlug;
        const shares = Math.abs(pos.shares).toFixed(1);
        const price = pos.avgEntryPrice.toFixed(2);
        lines.push(
          pad(
            `  ${slug.padEnd(22)} ${status} ${shares.padStart(
              6
            )} @ $${price} ${pnlStr}`
          )
        );
      }
      if (positions.length > 8) {
        lines.push(pad(`  ... and ${positions.length - 8} more positions`));
      }
    }

    lines.push(
      "╠════════════════════════════════════════════════════════════╣"
    );
    lines.push(pad("RECENT TRADES"));

    const recentTrades = state.trades.slice(-5).reverse();
    if (recentTrades.length === 0) {
      lines.push(pad("  No trades yet"));
    } else {
      for (const trade of recentTrades) {
        const time = new Date(trade.timestamp).toLocaleTimeString();
        const pnlStr =
          trade.pnl !== undefined
            ? `PnL: ${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(2)}`
            : `$${trade.usdValue.toFixed(2)}`;
        const slug =
          trade.marketSlug.length > 18
            ? trade.marketSlug.substring(0, 15) + "..."
            : trade.marketSlug;
        lines.push(
          pad(`  ${time} ${trade.side.padEnd(4)} ${slug.padEnd(18)} ${pnlStr}`)
        );
      }
    }

    lines.push(
      "╚════════════════════════════════════════════════════════════╝"
    );

    const sessionDuration = Date.now() - state.createdAt;
    const hours = Math.floor(sessionDuration / 3600000);
    const minutes = Math.floor((sessionDuration % 3600000) / 60000);
    lines.push(
      `Session duration: ${hours}h ${minutes}m | Last updated: ${new Date(
        state.updatedAt
      ).toLocaleString()}`
    );

    return lines.join("\n");
  }

  /**
   * Get JSON stats for programmatic use
   */
  getStats(): PaperTradingStats & {
    currentBalance: number;
    startingBalance: number;
    positionCount: number;
    totalReturn: number;
  } {
    const returnPct =
      ((this.state.currentBalance -
        this.state.startingBalance +
        this.state.stats.totalUnrealizedPnl) /
        this.state.startingBalance) *
      100;

    return {
      ...this.state.stats,
      currentBalance: this.state.currentBalance,
      startingBalance: this.state.startingBalance,
      positionCount: Object.keys(this.state.positions).length,
      totalReturn: returnPct,
    };
  }

  /**
   * Export trade history to CSV
   */
  exportTradesToCsv(): string {
    const headers = [
      "Timestamp",
      "Market",
      "Side",
      "Shares",
      "Price",
      "USD Value",
      "Fees",
      "PnL",
      "Target Wallet",
    ];
    const rows = this.state.trades.map((t) =>
      [
        new Date(t.timestamp).toISOString(),
        t.marketSlug,
        t.side,
        t.shares.toFixed(4),
        t.price.toFixed(4),
        t.usdValue.toFixed(2),
        t.fees.toFixed(4),
        t.pnl !== undefined ? t.pnl.toFixed(2) : "",
        t.targetWallet,
      ].join(",")
    );

    return [headers.join(","), ...rows].join("\n");
  }
}

// Singleton instance
let paperTradingInstance: PaperTradingManager | null = null;

export function getPaperTradingManager(
  dataDir?: string,
  startingBalance?: number
): PaperTradingManager {
  if (!paperTradingInstance) {
    paperTradingInstance = new PaperTradingManager(dataDir, startingBalance);
  }
  return paperTradingInstance;
}

export function resetPaperTradingManager(): void {
  paperTradingInstance = null;
}
