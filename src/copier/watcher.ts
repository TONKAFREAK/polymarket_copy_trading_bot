/**
 * Trade Watcher - polls target wallets for new trades
 */

import { TradeSignal, PollingConfig } from "./types";
import { DataApiClient, getDataApiClient } from "../polymarket/dataApi";
import { StateManager, getStateManager } from "./state";
import { getLogger, logTradeDetected } from "../utils/logger";
import { sleep } from "../utils/http";

const logger = getLogger();

export interface WatcherEvents {
  onTradeDetected: (signal: TradeSignal) => Promise<void>;
  onError: (error: Error, context: string) => void;
}

export class Watcher {
  private targets: string[];
  private config: PollingConfig;
  private dataApi: DataApiClient;
  private stateManager: StateManager;
  private running: boolean = false;
  private events: WatcherEvents;
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    targets: string[],
    config: PollingConfig,
    events: WatcherEvents,
    dataApi?: DataApiClient,
    stateManager?: StateManager
  ) {
    this.targets = targets.map((t) => t.toLowerCase());
    this.config = config;
    this.events = events;
    this.dataApi =
      dataApi ||
      getDataApiClient({
        tradeLimit: config.tradeLimit,
        maxRetries: config.maxRetries,
        baseBackoffMs: config.baseBackoffMs,
      });
    this.stateManager = stateManager || getStateManager();
  }

  /**
   * Start watching all targets
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn("Watcher already running");
      return;
    }

    this.running = true;
    logger.info("Starting watcher", {
      targets: this.targets.length,
      intervalMs: this.config.intervalMs,
    });

    // Start polling each target
    for (const target of this.targets) {
      this.startPollingTarget(target);
    }
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    this.running = false;

    // Clear all timers
    for (const timer of this.pollTimers.values()) {
      clearTimeout(timer);
    }
    this.pollTimers.clear();

    logger.info("Watcher stopped");
  }

  /**
   * Add a target to watch
   */
  addTarget(wallet: string): void {
    const normalized = wallet.toLowerCase();
    if (!this.targets.includes(normalized)) {
      this.targets.push(normalized);
      if (this.running) {
        this.startPollingTarget(normalized);
      }
    }
  }

  /**
   * Remove a target from watching
   */
  removeTarget(wallet: string): void {
    const normalized = wallet.toLowerCase();
    const index = this.targets.indexOf(normalized);
    if (index !== -1) {
      this.targets.splice(index, 1);

      // Stop polling this target
      const timer = this.pollTimers.get(normalized);
      if (timer) {
        clearTimeout(timer);
        this.pollTimers.delete(normalized);
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: PollingConfig): void {
    this.config = config;
  }

  /**
   * Start polling a specific target
   */
  private startPollingTarget(target: string): void {
    const poll = async () => {
      if (!this.running) return;

      try {
        await this.pollTarget(target);
      } catch (error) {
        this.events.onError(error as Error, `Polling target ${target}`);
      }

      // Schedule next poll
      if (this.running && this.targets.includes(target)) {
        const timer = setTimeout(poll, this.config.intervalMs);
        this.pollTimers.set(target, timer);
      }
    };

    // Start first poll
    poll();
  }

  /**
   * Poll a target for new trades
   */
  private async pollTarget(target: string): Promise<void> {
    logger.debug(`Polling target ${target.substring(0, 10)}...`);

    try {
      // Fetch recent trades
      const trades = await this.dataApi.fetchTrades(
        target,
        this.config.tradeLimit
      );

      this.stateManager.updateTargetPolled(target);

      if (!trades || trades.length === 0) {
        logger.debug(`No trades found for ${target.substring(0, 10)}...`);
        return;
      }

      logger.debug(
        `Processing ${trades.length} trades for ${target.substring(0, 10)}...`
      );

      // Process trades in chronological order (oldest first)
      const sortedTrades = trades.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeA - timeB;
      });

      for (const trade of sortedTrades) {
        // Normalize the trade
        const signal = this.dataApi.normalizeTrade(trade, target);

        // Check if we've seen this trade before
        const seen = await this.stateManager.hasSeenTrade(
          target,
          signal.tradeId
        );
        if (seen) {
          continue;
        }

        // Skip very old trades (more than 5 minutes old on first detection)
        // This prevents copying old historical trades on startup
        const age = Date.now() - signal.timestamp;
        const maxAge = 5 * 60 * 1000; // 5 minutes
        if (age > maxAge) {
          logger.debug(
            `Skipping old trade (${Math.round(
              age / 1000
            )}s old): ${signal.tradeId.substring(0, 20)}...`
          );
          // Mark as seen but don't process
          await this.stateManager.markTradeSeen(target, signal.tradeId);
          continue;
        }

        // New trade detected!
        logTradeDetected(
          logger,
          signal.targetWallet,
          signal.tradeId,
          signal.side,
          signal.price,
          signal.tokenId
        );

        this.stateManager.recordTradeDetected(signal);

        // Emit event for processing
        try {
          await this.events.onTradeDetected(signal);
        } catch (error) {
          this.events.onError(
            error as Error,
            `Processing trade ${signal.tradeId}`
          );
        }
      }
    } catch (error) {
      // Handle rate limiting
      if ((error as Error).message?.includes("429")) {
        logger.warn("Rate limited, backing off...", { target });
        await sleep(this.config.baseBackoffMs * 2);
      }
      throw error;
    }
  }

  /**
   * Get watcher status
   */
  getStatus(): { running: boolean; targets: string[]; intervalMs: number } {
    return {
      running: this.running,
      targets: [...this.targets],
      intervalMs: this.config.intervalMs,
    };
  }

  /**
   * Get list of targets
   */
  getTargets(): string[] {
    return [...this.targets];
  }
}

// Factory function
export function createWatcher(
  targets: string[],
  config: PollingConfig,
  events: WatcherEvents
): Watcher {
  return new Watcher(targets, config, events);
}
