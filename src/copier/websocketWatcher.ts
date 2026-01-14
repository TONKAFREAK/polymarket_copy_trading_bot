/**
 * WebSocket Trade Watcher - Real-time trade detection via Polymarket WebSocket
 *
 * This watcher uses WebSocket streaming instead of polling for near-instant
 * trade detection. Latency is typically <1 second vs 20-60+ seconds with polling.
 */

import {
  RealTimeDataClient,
  ConnectionStatus,
} from "@polymarket/real-time-data-client";
import { TradeSignal, ActivityType } from "./types";
import { StateManager, getStateManager } from "./state";
import { getLogger } from "../utils/logger";

const logger = getLogger();

export interface WebSocketWatcherEvents {
  onTradeDetected: (signal: TradeSignal) => Promise<void>;
  onError: (error: Error, context: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export interface WebSocketWatcherConfig {
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
}

/**
 * Trade payload from WebSocket
 */
interface WsTrade {
  asset: string; // Token ID
  conditionId: string;
  eventSlug: string;
  slug: string; // Market slug
  outcome: string;
  outcomeIndex: number;
  price: number;
  side: string; // BUY or SELL
  size: number;
  timestamp: number;
  transactionHash: string;
  proxyWallet: string; // Trader's wallet address
  name?: string;
  pseudonym?: string;
  title?: string;
}

export class WebSocketWatcher {
  private targets: Set<string>;
  private events: WebSocketWatcherEvents;
  private config: WebSocketWatcherConfig;
  private stateManager: StateManager;
  private client: RealTimeDataClient | null = null;
  private running: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageCount: number = 0;
  private targetTradeCount: number = 0;
  private connected: boolean = false;
  // Fast in-memory dedup for instant lookup (clear periodically)
  private recentTrades: Set<string> = new Set();
  private lastCleanup: number = Date.now();

  constructor(
    targets: string[],
    events: WebSocketWatcherEvents,
    config?: WebSocketWatcherConfig,
    stateManager?: StateManager
  ) {
    // Normalize targets to lowercase for matching
    this.targets = new Set(targets.map((t) => t.toLowerCase()));
    this.events = events;
    this.config = {
      reconnectDelayMs: config?.reconnectDelayMs || 5000,
      maxReconnectAttempts: config?.maxReconnectAttempts || 10,
    };
    this.stateManager = stateManager || getStateManager();
  }

  /**
   * Start the WebSocket watcher
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn("WebSocket watcher already running");
      return;
    }

    this.running = true;
    this.reconnectAttempts = 0;

    logger.info("Starting WebSocket watcher", {
      targets: this.targets.size,
    });

    this.connect();
  }

  /**
   * Connect to WebSocket
   */
  private connect(): void {
    try {
      this.client = new RealTimeDataClient({
        onConnect: (client) => {
          logger.info("WebSocket connected to Polymarket");
          this.reconnectAttempts = 0;
          this.connected = true;
          this.messageCount = 0;
          this.targetTradeCount = 0;

          // Subscribe to both trades AND orders_matched to capture all activity
          // trades: captures filled trades (BUY/SELL)
          // orders_matched: captures matched orders which may include SELLs not in trades
          // Note: proxyWallet filter is not supported by the API
          client.subscribe({
            subscriptions: [
              {
                topic: "activity",
                type: "trades",
              },
              {
                topic: "activity",
                type: "orders_matched",
              },
            ],
          });
          logger.info("WebSocket subscribed to trades and orders_matched", {
            targets: this.targets.size,
            targetWallets: Array.from(this.targets).map(
              (w) => w.substring(0, 10) + "..."
            ),
          });

          this.events.onConnected?.();
        },
        onMessage: (_, message) => {
          this.messageCount++;
          // Log every 100 messages to show we're receiving data
          if (this.messageCount % 100 === 0) {
            logger.info(
              `WebSocket received ${this.messageCount} messages, ${this.targetTradeCount} target trades`
            );
          }
          // Process message synchronously for speed, async parts handled inside
          this.handleMessage(message);
        },
        onStatusChange: (status) => {
          logger.debug("WebSocket status change", { status });
          if (status === ConnectionStatus.DISCONNECTED) {
            logger.warn("WebSocket disconnected", {
              messagesReceived: this.messageCount,
              targetTrades: this.targetTradeCount,
            });
            this.connected = false;
            this.events.onDisconnected?.();
            this.scheduleReconnect();
          }
        },
        autoReconnect: true,
        pingInterval: 15000, // More frequent pings to keep connection alive
      });

      this.client.connect();
    } catch (error) {
      logger.error("Failed to connect WebSocket", {
        error: (error as Error).message,
      });
      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming WebSocket message - OPTIMIZED FOR SPEED
   * Uses in-memory dedup for instant lookup, processes synchronously where possible
   * Handles both 'trades' and 'orders_matched' message types
   */
  private handleMessage(message: {
    topic: string;
    type: string;
    payload: unknown;
  }): void {
    // Fast path: filter non-activity messages immediately
    if (message.topic !== "activity") {
      return;
    }

    // Handle both 'trades' and 'orders_matched' types
    if (message.type !== "trades" && message.type !== "orders_matched") {
      return;
    }

    const trade = message.payload as WsTrade;
    if (!trade) return;

    // Fast path: check wallet filter
    const traderWallet = trade.proxyWallet?.toLowerCase();
    if (!traderWallet || !this.targets.has(traderWallet)) {
      return;
    }

    // Found a target trade!
    this.targetTradeCount++;

    // Create trade ID for deduplication
    const tradeId =
      trade.transactionHash || `ws-${trade.timestamp}-${trade.asset}`;

    // FAST in-memory dedup (instant, no async)
    if (this.recentTrades.has(tradeId)) {
      return; // Already processed
    }
    this.recentTrades.add(tradeId);

    // Clean up old entries periodically (every 60 seconds)
    const now = Date.now();
    if (now - this.lastCleanup > 60000) {
      this.recentTrades.clear();
      this.lastCleanup = now;
    }

    // Convert to TradeSignal immediately (no await)
    const signal: TradeSignal = {
      targetWallet: traderWallet,
      tradeId,
      timestamp:
        trade.timestamp > 1e12 ? trade.timestamp : trade.timestamp * 1000,
      tokenId: trade.asset,
      conditionId: trade.conditionId,
      marketSlug: trade.slug,
      side: trade.side.toUpperCase() as "BUY" | "SELL",
      price: trade.price,
      sizeShares: trade.size,
      notionalUsd: trade.price * trade.size,
      outcome: trade.outcome?.toUpperCase() === "YES" ? "YES" : "NO",
      activityType: "TRADE" as ActivityType,
    };

    // Log minimally for speed, but include message type and side for debugging
    logger.info("WS trade detected", {
      type: message.type,
      w: traderWallet.substring(0, 8),
      side: signal.side,
      p: signal.price.toFixed(2),
      sz: signal.sizeShares?.toFixed(1),
    });

    // Fire and forget: mark as seen in state manager (don't await)
    this.stateManager.markTradeSeen(traderWallet, tradeId).catch(() => {});
    this.stateManager.recordTradeDetected(signal);

    // Emit trade immediately (this is the critical path)
    this.events.onTradeDetected(signal).catch((error) => {
      logger.error("Error emitting trade", { error: (error as Error).message });
      this.events.onError(error as Error, "Emitting WebSocket trade");
    });
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (!this.running) return;

    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
      logger.error("Max reconnect attempts reached, giving up");
      this.events.onError(
        new Error("WebSocket max reconnect attempts reached"),
        "Reconnection failed"
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelayMs || 5000;

    logger.info(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Stop the watcher
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      try {
        this.client.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
      this.client = null;
    }

    logger.info("WebSocket watcher stopped");
  }

  /**
   * Add a target wallet to watch
   */
  addTarget(wallet: string): void {
    this.targets.add(wallet.toLowerCase());
    logger.debug("Added target to WebSocket watcher", {
      wallet: wallet.substring(0, 10),
    });
  }

  /**
   * Remove a target wallet
   */
  removeTarget(wallet: string): void {
    this.targets.delete(wallet.toLowerCase());
    logger.debug("Removed target from WebSocket watcher", {
      wallet: wallet.substring(0, 10),
    });
  }

  /**
   * Get watcher status
   */
  getStatus(): {
    running: boolean;
    connected: boolean;
    targets: number;
    messageCount: number;
    targetTradeCount: number;
  } {
    return {
      running: this.running,
      connected: this.connected,
      targets: this.targets.size,
      messageCount: this.messageCount,
      targetTradeCount: this.targetTradeCount,
    };
  }

  /**
   * Get list of targets
   */
  getTargets(): string[] {
    return Array.from(this.targets);
  }
}

// Factory function
export function createWebSocketWatcher(
  targets: string[],
  events: WebSocketWatcherEvents,
  config?: WebSocketWatcherConfig
): WebSocketWatcher {
  return new WebSocketWatcher(targets, events, config);
}
