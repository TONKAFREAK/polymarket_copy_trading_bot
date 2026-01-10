/**
 * State Manager - centralized state management for the copy trader
 */

import {
  BotStatus,
  TargetStatus,
  DailyStats,
  TradeSignal,
  ExecutionResult,
} from "./types";
import { getPersistenceProvider, PersistenceProvider } from "../data";
import { getLogger } from "../utils/logger";

const logger = getLogger();

export class StateManager {
  private persistence: PersistenceProvider;
  private targetStats: Map<string, TargetStatus>;
  private startTime: number | null = null;
  private running: boolean = false;
  private lastError: string | null = null;
  private dailyStats: DailyStats;

  constructor(persistence?: PersistenceProvider) {
    this.persistence = persistence || getPersistenceProvider();
    this.targetStats = new Map();
    this.dailyStats = this.getDefaultDailyStats();
  }

  private getDefaultDailyStats(): DailyStats {
    return {
      date: new Date().toISOString().split("T")[0],
      totalTradesDetected: 0,
      totalTradesCopied: 0,
      totalUsdVolume: 0,
      successfulOrders: 0,
      failedOrders: 0,
    };
  }

  /**
   * Initialize state manager for given targets
   */
  async initialize(targets: string[]): Promise<void> {
    this.dailyStats = this.getDefaultDailyStats();

    for (const wallet of targets) {
      const normalized = wallet.toLowerCase();
      this.targetStats.set(normalized, {
        wallet: normalized,
        tradesDetected: 0,
        tradesCopied: 0,
        tradesSkipped: 0,
      });
    }

    // Reset daily volume if needed
    await this.persistence.resetDailyVolumeIfNeeded();

    logger.info("State manager initialized", { targets: targets.length });
  }

  /**
   * Mark bot as started
   */
  start(): void {
    this.running = true;
    this.startTime = Date.now();
    this.lastError = null;
    logger.info("Bot started");
  }

  /**
   * Mark bot as stopped
   */
  stop(): void {
    this.running = false;
    logger.info("Bot stopped");
  }

  /**
   * Check if a trade has been seen before
   */
  async hasSeenTrade(targetWallet: string, tradeId: string): Promise<boolean> {
    return this.persistence.hasSeenTradeId(targetWallet, tradeId);
  }

  /**
   * Mark a trade as seen
   */
  async markTradeSeen(targetWallet: string, tradeId: string): Promise<void> {
    await this.persistence.addSeenTradeId(targetWallet, tradeId);
  }

  /**
   * Record a detected trade
   */
  recordTradeDetected(signal: TradeSignal): void {
    const stats = this.targetStats.get(signal.targetWallet.toLowerCase());
    if (stats) {
      stats.tradesDetected++;
      stats.lastPolled = Date.now();
      stats.lastTrade = signal;
    }
    this.dailyStats.totalTradesDetected++;
  }

  /**
   * Record an execution result
   */
  async recordExecution(execution: ExecutionResult): Promise<void> {
    const wallet = execution.signal.targetWallet.toLowerCase();
    const stats = this.targetStats.get(wallet);

    if (execution.skipped) {
      if (stats) {
        stats.tradesSkipped++;
      }
    } else if (execution.result?.success) {
      if (stats) {
        stats.tradesCopied++;
      }
      this.dailyStats.totalTradesCopied++;
      this.dailyStats.successfulOrders++;

      // Update volume tracking
      const usdValue = execution.order
        ? execution.order.price * execution.order.size
        : execution.signal.notionalUsd || 0;

      if (usdValue > 0) {
        this.dailyStats.totalUsdVolume += usdValue;
        await this.persistence.addToDailyVolume(usdValue);

        // Update market exposure
        if (execution.signal.conditionId) {
          await this.persistence.addMarketExposure(
            execution.signal.conditionId,
            usdValue
          );
        }
      }
    } else {
      this.dailyStats.failedOrders++;
      if (execution.result?.errorMessage) {
        this.lastError = execution.result.errorMessage;
      }
    }

    // Mark trade as seen
    await this.markTradeSeen(wallet, execution.signal.tradeId);
  }

  /**
   * Get current daily volume
   */
  async getDailyVolume(): Promise<number> {
    const volume = await this.persistence.getDailyVolume();
    return volume.totalUsd;
  }

  /**
   * Get market exposure
   */
  async getMarketExposure(conditionId: string): Promise<number> {
    return this.persistence.getMarketExposure(conditionId);
  }

  /**
   * Set last error
   */
  setLastError(error: string): void {
    this.lastError = error;
  }

  /**
   * Get bot status
   */
  getStatus(): BotStatus {
    const now = Date.now();

    return {
      running: this.running,
      startTime: this.startTime || undefined,
      uptime: this.startTime ? now - this.startTime : undefined,
      targets: Array.from(this.targetStats.values()),
      dailyStats: { ...this.dailyStats },
      lastError: this.lastError || undefined,
    };
  }

  /**
   * Get target status
   */
  getTargetStatus(wallet: string): TargetStatus | undefined {
    return this.targetStats.get(wallet.toLowerCase());
  }

  /**
   * Update target last polled time
   */
  updateTargetPolled(wallet: string): void {
    const stats = this.targetStats.get(wallet.toLowerCase());
    if (stats) {
      stats.lastPolled = Date.now();
    }
  }

  /**
   * Add a new target
   */
  addTarget(wallet: string): void {
    const normalized = wallet.toLowerCase();
    if (!this.targetStats.has(normalized)) {
      this.targetStats.set(normalized, {
        wallet: normalized,
        tradesDetected: 0,
        tradesCopied: 0,
        tradesSkipped: 0,
      });
    }
  }

  /**
   * Remove a target
   */
  removeTarget(wallet: string): void {
    this.targetStats.delete(wallet.toLowerCase());
  }

  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    await this.persistence.close();
  }
}

// Singleton instance
let stateManagerInstance: StateManager | null = null;

export function getStateManager(): StateManager {
  if (!stateManagerInstance) {
    stateManagerInstance = new StateManager();
  }
  return stateManagerInstance;
}

export function resetStateManager(): void {
  stateManagerInstance = null;
}
