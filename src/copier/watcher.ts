/**
 * Trade Watcher - polls target wallets for new trades
 * Includes trade aggregation to prevent over-trading when target makes rapid micro-trades
 */

import { TradeSignal, PollingConfig, ActivityType } from "./types";
import { DataApiClient, getDataApiClient } from "../polymarket/dataApi";
import { StateManager, getStateManager } from "./state";
import { getLogger, logTradeDetected } from "../utils/logger";
import { sleep } from "../utils/http";

const logger = getLogger();

// ============================================
// TRADE AGGREGATION
// ============================================

/**
 * Aggregated trade - groups rapid trades on same token+side+activityType
 */
interface AggregatedTrade {
  tokenId: string;
  side: "BUY" | "SELL";
  activityType: ActivityType;
  targetWallet: string;
  trades: TradeSignal[];
  totalShares: number;
  totalNotionalUsd: number;
  avgPrice: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

/**
 * Pending aggregation buffer
 */
interface AggregationBuffer {
  [key: string]: AggregatedTrade; // key = tokenId:side
}

// Aggregation window in milliseconds
// IMPORTANT: Set to 0 to disable aggregation (emit trades individually)
// Only use aggregation if target is known to make rapid micro-trades
const AGGREGATION_WINDOW_MS = 0;

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

  // Trade aggregation buffers - one per target
  private aggregationBuffers: Map<string, AggregationBuffer> = new Map();
  private aggregationTimers: Map<string, NodeJS.Timeout> = new Map();

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

    // Clear all poll timers
    for (const timer of this.pollTimers.values()) {
      clearTimeout(timer);
    }
    this.pollTimers.clear();

    // Clear all aggregation timers
    for (const timer of this.aggregationTimers.values()) {
      clearTimeout(timer);
    }
    this.aggregationTimers.clear();
    this.aggregationBuffers.clear();

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

        // Mark as seen (prevents re-processing)
        await this.stateManager.markTradeSeen(target, signal.tradeId);

        // Add to aggregation buffer instead of processing immediately
        await this.addToAggregationBuffer(target, signal);
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
   * Add a trade to the aggregation buffer
   * Trades on the same tokenId+side+activityType within the window are combined
   * If AGGREGATION_WINDOW_MS is 0, emit trades individually without aggregation
   */
  private async addToAggregationBuffer(
    target: string,
    signal: TradeSignal
  ): Promise<void> {
    // If aggregation is disabled (window = 0), emit trade immediately without buffering
    if (AGGREGATION_WINDOW_MS === 0) {
      logger.debug(
        `Emitting trade individually (no aggregation): ${signal.tradeId.substring(
          0,
          20
        )}...`
      );

      logTradeDetected(
        logger,
        signal.targetWallet,
        signal.tradeId,
        signal.side,
        signal.price,
        signal.tokenId
      );

      this.stateManager.recordTradeDetected(signal);

      try {
        await this.events.onTradeDetected(signal);
      } catch (error) {
        this.events.onError(
          error as Error,
          `Processing trade ${signal.tradeId}`
        );
      }
      return;
    }

    // Get or create buffer for this target
    if (!this.aggregationBuffers.has(target)) {
      this.aggregationBuffers.set(target, {});
    }
    const buffer = this.aggregationBuffers.get(target)!;

    // Key for aggregation: tokenId + side + activityType
    const activityType = signal.activityType || "TRADE";
    const key = `${signal.tokenId}:${signal.side}:${activityType}`;

    if (buffer[key]) {
      // Add to existing aggregation
      const agg = buffer[key];
      agg.trades.push(signal);
      agg.totalShares += signal.sizeShares || 0;
      agg.totalNotionalUsd += signal.notionalUsd || 0;
      agg.lastTimestamp = Math.max(agg.lastTimestamp, signal.timestamp);

      // Recalculate average price
      const totalValue = agg.trades.reduce(
        (sum, t) => sum + t.price * (t.sizeShares || 0),
        0
      );
      agg.avgPrice =
        agg.totalShares > 0 ? totalValue / agg.totalShares : signal.price;

      logger.debug(
        `Aggregating ${activityType}: ${key} now has ${
          agg.trades.length
        } trades, $${agg.totalNotionalUsd.toFixed(2)}`
      );
    } else {
      // Start new aggregation
      buffer[key] = {
        tokenId: signal.tokenId,
        side: signal.side,
        activityType,
        targetWallet: target,
        trades: [signal],
        totalShares: signal.sizeShares || 0,
        totalNotionalUsd: signal.notionalUsd || 0,
        avgPrice: signal.price,
        firstTimestamp: signal.timestamp,
        lastTimestamp: signal.timestamp,
      };

      logger.debug(`New ${activityType} aggregation started: ${key}`);

      // Start timer to flush this aggregation
      this.scheduleAggregationFlush(target, key);
    }
  }

  /**
   * Schedule flush of an aggregated trade after the window expires
   */
  private scheduleAggregationFlush(target: string, key: string): void {
    const timerKey = `${target}:${key}`;

    // Clear any existing timer
    if (this.aggregationTimers.has(timerKey)) {
      clearTimeout(this.aggregationTimers.get(timerKey)!);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      await this.flushAggregatedTrade(target, key);
      this.aggregationTimers.delete(timerKey);
    }, AGGREGATION_WINDOW_MS);

    this.aggregationTimers.set(timerKey, timer);
  }

  /**
   * Flush an aggregated trade - emit as a single trade event
   */
  private async flushAggregatedTrade(
    target: string,
    key: string
  ): Promise<void> {
    const buffer = this.aggregationBuffers.get(target);
    if (!buffer || !buffer[key]) {
      return;
    }

    const agg = buffer[key];
    delete buffer[key];

    // Create a merged trade signal
    const mergedSignal: TradeSignal = {
      targetWallet: target,
      tradeId: `agg-${agg.trades[0].tradeId}`, // Use first trade's ID with prefix
      timestamp: agg.lastTimestamp,
      tokenId: agg.tokenId,
      side: agg.side,
      price: agg.avgPrice,
      sizeShares: agg.totalShares,
      notionalUsd: agg.totalNotionalUsd,
      outcome: agg.trades[0].outcome,
      conditionId: agg.trades[0].conditionId,
      marketSlug: agg.trades[0].marketSlug,
      activityType: agg.activityType,
    };

    logger.info("Emitting aggregated activity", {
      type: agg.activityType,
      side: agg.side,
      tradesAggregated: agg.trades.length,
      totalNotionalUsd: agg.totalNotionalUsd.toFixed(2),
      avgPrice: agg.avgPrice.toFixed(4),
      tokenId: agg.tokenId.substring(0, 16) + "...",
    });

    // Log the aggregated trade
    logTradeDetected(
      logger,
      mergedSignal.targetWallet,
      mergedSignal.tradeId,
      mergedSignal.side,
      mergedSignal.price,
      mergedSignal.tokenId
    );

    this.stateManager.recordTradeDetected(mergedSignal);

    // Emit the merged signal
    try {
      await this.events.onTradeDetected(mergedSignal);
    } catch (error) {
      this.events.onError(
        error as Error,
        `Processing aggregated ${agg.activityType} ${mergedSignal.tradeId}`
      );
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
