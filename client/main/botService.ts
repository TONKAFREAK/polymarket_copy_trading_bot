/**
 * Bot Service - Bridges the Electron app with the actual trading bot logic
 *
 * This module integrates:
 * - WebSocketWatcher for real-time trade detection
 * - PaperTradingManager for paper trade execution
 * - CLOB Client for live trade execution
 */

import path from "path";
import fs from "fs";
import { BrowserWindow } from "electron";
import { ClobClientWrapper } from "./clobClient";

// Types for trade signals and events
interface TradeSignal {
  tokenId: string;
  conditionId: string;
  marketSlug: string;
  outcome: "YES" | "NO";
  outcomeIndex: number;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  targetWallet: string;
  tradeId: string;
  timestamp: number;
  eventSlug?: string;
  name?: string;
  title?: string;
  activityType?: string;
  transactionHash?: string;
}

interface BotConfig {
  trading: {
    sizingMode: "proportional" | "fixed-usd" | "fixed-shares";
    fixedUsdSize: number;
    fixedSharesSize: number;
    proportionalMultiplier: number;
    minOrderSize: number;
    minOrderShares: number;
    slippage: number;
  };
  risk: {
    maxUsdPerTrade: number;
    maxUsdPerMarket: number;
    maxDailyUsdVolume: number;
    dryRun: boolean;
  };
  targets: string[];
  mode?: "paper" | "live" | "dry-run"; // Trading mode
}

interface PaperState {
  enabled: boolean;
  startingBalance: number;
  currentBalance: number;
  positions: Record<string, any>;
  trades: any[];
  stats: any;
  createdAt: number;
  updatedAt: number;
}

interface BotStats {
  status: "running" | "stopped" | "error";
  connected: boolean;
  messagesReceived: number;
  targetTradesDetected: number;
  tradesExecuted: number;
  startTime: number | null;
  lastTradeTime: number | null;
  errors: string[];
  mode: "paper" | "live" | "dry-run";
}

// Event types sent to renderer
export type BotEvent =
  | { type: "status"; data: BotStats }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "trade-detected"; data: TradeSignal }
  | {
      type: "trade-executed";
      data: {
        signal: TradeSignal;
        result: any;
        yourShares: number;
        yourPrice: number;
        yourTotal: number;
        fees: number;
        latencyMs: number;
      };
    }
  | { type: "trade-skipped"; data: { signal: TradeSignal; reason: string } }
  | { type: "error"; data: { message: string; context: string } }
  | { type: "log"; data: { level: string; message: string; details?: any } };

export class BotService {
  private mainWindow: BrowserWindow | null = null;
  private dataDir: string;
  private running: boolean = false;
  private connected: boolean = false;
  private stats: BotStats;
  private config: BotConfig | null = null;
  private state: PaperState | null = null;
  private tradingMode: "paper" | "live" | "dry-run" = "paper";

  // WebSocket connection (using @polymarket/real-time-data-client)
  private wsClient: any = null;
  private targets: Set<string> = new Set();
  private seenTrades: Set<string> = new Set();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private chartSnapshotTimer: NodeJS.Timeout | null = null;
  private debugStatsTimer: NodeJS.Timeout | null = null;
  private gcTimer: NodeJS.Timeout | null = null;
  private messageCount: number = 0;
  private targetTradeCount: number = 0;

  // CLOB client for live trading (full order placement)
  private clobClient: any = null;
  // Live data client for fetching portfolio data (read-only)
  private liveDataClient: any = null;
  // Cache for live stats to prevent flickering
  private liveStatsCache: {
    data: any;
    timestamp: number;
  } | null = null;
  private readonly LIVE_STATS_CACHE_TTL = 30000; // 30 seconds to prevent rate limiting

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.isReconnecting = false;
    this.stats = {
      status: "stopped",
      connected: false,
      messagesReceived: 0,
      targetTradesDetected: 0,
      tradesExecuted: 0,
      startTime: null,
      lastTradeTime: null,
      errors: [],
      mode: "paper",
    };
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  private emit(event: BotEvent) {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("bot:event", event);
      }
    } catch (err) {
      // Ignore IPC errors - window may have been closed
    }
  }

  private log(
    level: "info" | "warn" | "error" | "debug",
    message: string,
    details?: any,
  ) {
    console.log(`[BotService] ${level}: ${message}`, details || "");
    this.emit({ type: "log", data: { level, message, details } });
  }

  // State save debouncing for performance
  private stateSaveTimer: NodeJS.Timeout | null = null;
  private stateDirty: boolean = false;
  private readonly STATE_SAVE_DEBOUNCE_MS = 500; // Increased from 100ms to reduce disk I/O

  // Memory limits to prevent unbounded growth
  private readonly MAX_TRADES = 500;
  private readonly MAX_ERRORS = 50;
  private readonly MAX_SEEN_TRADES = 500;
  private readonly MAX_POSITIONS = 200;

  private loadConfig(): BotConfig {
    try {
      const configPath = path.join(this.dataDir, "config.json");
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    } catch (e) {
      this.log("error", "Failed to load config", e);
    }
    return {
      trading: {
        sizingMode: "proportional",
        fixedUsdSize: 10,
        fixedSharesSize: 10,
        proportionalMultiplier: 0.01,
        minOrderSize: 1,
        minOrderShares: 0.01,
        slippage: 0.01,
      },
      risk: {
        maxUsdPerTrade: 1000,
        maxUsdPerMarket: 1e22,
        maxDailyUsdVolume: 1e22,
        dryRun: true,
      },
      targets: [],
      mode: "paper" as const,
    };
  }

  private loadState(): PaperState {
    try {
      const statePath = path.join(this.dataDir, "paper-state.json");
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));

        // Trim trades array on load to prevent memory bloat
        if (state.trades && state.trades.length > this.MAX_TRADES) {
          state.trades = state.trades.slice(-this.MAX_TRADES);
          this.log(
            "info",
            `Trimmed trades on load: kept ${this.MAX_TRADES} most recent`,
          );
        }

        // Clean up old closed positions (shares === 0)
        if (state.positions) {
          const posEntries = Object.entries(state.positions);
          let removedCount = 0;
          for (const [tokenId, pos] of posEntries) {
            const p = pos as any;
            if (p.shares <= 0 || p.settled) {
              delete state.positions[tokenId];
              removedCount++;
            }
          }
          if (removedCount > 0) {
            this.log(
              "info",
              `Cleaned up ${removedCount} closed positions on load`,
            );
          }

          // If still too many positions, keep only the most recent
          const remainingPositions = Object.entries(state.positions);
          if (remainingPositions.length > this.MAX_POSITIONS) {
            // Sort by openedAt and keep most recent
            const sorted = remainingPositions.sort((a, b) => {
              const aTime = (a[1] as any).openedAt || 0;
              const bTime = (b[1] as any).openedAt || 0;
              return bTime - aTime;
            });
            state.positions = Object.fromEntries(
              sorted.slice(0, this.MAX_POSITIONS),
            );
            this.log(
              "info",
              `Trimmed positions on load: kept ${this.MAX_POSITIONS} most recent`,
            );
          }
        }

        return state;
      }
    } catch (e) {
      this.log("error", "Failed to load state", e);
    }
    return {
      enabled: true,
      startingBalance: 10000,
      currentBalance: 10000,
      positions: {},
      trades: [],
      stats: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private loadAccountsState(): {
    activeAccountId: string | null;
    accounts: any[];
    hasSeenPaperPopup: boolean;
  } {
    try {
      const accountsPath = path.join(this.dataDir, "accounts.json");
      if (fs.existsSync(accountsPath)) {
        return JSON.parse(fs.readFileSync(accountsPath, "utf-8"));
      }
    } catch (e) {
      this.log("error", "Failed to load accounts state", e);
    }
    return {
      activeAccountId: null,
      accounts: [],
      hasSeenPaperPopup: false,
    };
  }

  /**
   * Save state with debouncing - doesn't block trade execution
   * Multiple saves within STATE_SAVE_DEBOUNCE_MS are batched
   */
  private saveState() {
    this.stateDirty = true;

    // Clear existing timer to extend debounce window
    if (this.stateSaveTimer) {
      clearTimeout(this.stateSaveTimer);
    }

    // Schedule async write after debounce period
    this.stateSaveTimer = setTimeout(() => {
      this.writeStateToDisk();
    }, this.STATE_SAVE_DEBOUNCE_MS);
  }

  /**
   * Actually write state to disk asynchronously
   */
  private async writeStateToDisk(): Promise<void> {
    if (!this.stateDirty || !this.state) return;

    this.stateDirty = false;
    this.stateSaveTimer = null;

    try {
      const statePath = path.join(this.dataDir, "paper-state.json");
      this.state.updatedAt = Date.now();
      await fs.promises.writeFile(
        statePath,
        JSON.stringify(this.state, null, 2),
        "utf-8",
      );
    } catch (e) {
      this.log("error", "Failed to save state", e);
      this.stateDirty = true; // Retry on next save
    }
  }

  /**
   * Force immediate state flush (for shutdown)
   */
  async flushState(): Promise<void> {
    if (this.stateSaveTimer) {
      clearTimeout(this.stateSaveTimer);
    }
    await this.writeStateToDisk();
  }

  async start(): Promise<boolean> {
    if (this.running) {
      this.log("warn", "Bot already running");
      return true;
    }

    this.log("info", "Starting bot service...");

    // Load config and state
    this.config = this.loadConfig();
    this.state = this.loadState();

    // Log initial state
    this.log(
      "info",
      `Loaded configuration: ${this.config.targets?.length || 0} targets`,
    );
    this.log(
      "debug",
      `Config: sizingMode=${this.config.trading?.sizingMode}, maxPerTrade=$${this.config.risk?.maxUsdPerTrade}`,
    );

    // Determine trading mode from accounts state (takes priority over config)
    const accountsState = this.loadAccountsState();
    this.log(
      "info",
      `Accounts state loaded - activeAccountId: ${accountsState.activeAccountId || "null"}, accounts count: ${accountsState.accounts?.length || 0}`,
    );

    if (accountsState.activeAccountId) {
      // Verify the account actually exists
      const activeAccount = accountsState.accounts?.find(
        (acc: any) => acc.id === accountsState.activeAccountId,
      );
      if (activeAccount) {
        this.tradingMode = "live";
        this.log(
          "info",
          `Active account found: ${activeAccount.name} (${activeAccount.address})`,
        );
      } else {
        this.log(
          "error",
          `activeAccountId ${accountsState.activeAccountId} not found in accounts list!`,
        );
        this.tradingMode = this.config.mode || "paper";
      }
    } else {
      this.tradingMode = this.config.mode || "paper";
    }

    // Apply dry-run override if set (but NOT for live mode)
    if (this.config.risk?.dryRun && this.tradingMode !== "live") {
      this.tradingMode = "dry-run";
    }

    this.stats.mode = this.tradingMode;
    this.log("info", `Trading mode: ${this.tradingMode.toUpperCase()}`);

    // Log paper trading state
    if (this.tradingMode === "paper" && this.state) {
      this.log(
        "info",
        `Paper balance: $${this.state.currentBalance?.toFixed(2) || "10000.00"}`,
      );
      const posCount = Object.keys(this.state.positions || {}).length;
      this.log("debug", `Open positions: ${posCount}`);
    }

    // Initialize CLOB client for live trading
    if (this.tradingMode === "live") {
      try {
        await this.initializeClobClient();
        this.log(
          "info",
          "CLOB client initialized successfully for LIVE trading",
        );
      } catch (e: any) {
        this.log(
          "error",
          `CRITICAL: Failed to initialize CLOB client: ${e.message}`,
        );
        this.log("error", "CRITICAL: Bot will NOT execute live trades!");
        this.emit({
          type: "error",
          data: {
            message: `CRITICAL: CLOB init failed - ${e.message}. Cannot start in live mode!`,
            context: "startup",
          },
        });
        // THROW error to prevent starting the bot in wrong mode
        // User MUST fix their credentials or switch to paper trading manually
        throw new Error(
          `Cannot start live trading: ${e.message}. Please check your API credentials in Settings, or switch to Paper Trading.`,
        );
      }
    }

    // Set up targets
    this.targets = new Set(
      (this.config.targets || []).map((t) => t.toLowerCase()),
    );

    if (this.targets.size === 0) {
      this.log("warn", "No target wallets configured!");
      this.emit({
        type: "error",
        data: { message: "No target wallets configured", context: "startup" },
      });
    }

    this.running = true;
    this.stats.status = "running";
    this.stats.startTime = Date.now();
    this.stats.messagesReceived = 0;
    this.stats.targetTradesDetected = 0;
    this.seenTrades.clear();

    this.emit({ type: "status", data: this.stats });

    // Connect to WebSocket
    await this.connectWebSocket();

    // Start chart snapshot timer (every 60 seconds)
    this.startChartSnapshotTimer();

    // Start debug stats timer (every 5 minutes) to monitor for memory leaks
    this.startDebugStatsTimer();

    // Start periodic garbage collection timer (every 2 minutes)
    this.startGCTimer();

    return true;
  }

  async stop(): Promise<boolean> {
    if (!this.running) {
      return true;
    }

    this.log("info", "Stopping bot service...");

    // Set running to false FIRST to prevent any reconnection attempts
    this.running = false;
    this.isReconnecting = false;
    this.stats.status = "stopped";

    // Clear all timers immediately
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.chartSnapshotTimer) {
      clearInterval(this.chartSnapshotTimer);
      this.chartSnapshotTimer = null;
    }

    if (this.debugStatsTimer) {
      clearInterval(this.debugStatsTimer);
      this.debugStatsTimer = null;
    }

    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }

    if (this.stateSaveTimer) {
      clearTimeout(this.stateSaveTimer);
      this.stateSaveTimer = null;
    }

    // Disconnect WebSocket with force and clear all references
    await this.cleanupWebSocket();

    // Clean up CLOB client
    if (this.clobClient) {
      try {
        if (typeof this.clobClient.disconnect === "function") {
          await this.clobClient.disconnect();
        }
        if (typeof this.clobClient.close === "function") {
          this.clobClient.close();
        }
      } catch (e) {
        // Ignore
      }
      this.clobClient = null;
    }

    // Clean up live data client
    this.liveDataClient = null;
    this.liveStatsCache = null;

    // Flush any pending state to disk
    await this.flushState();

    // Clear in-memory caches
    this.seenTrades.clear();
    this.targets.clear();
    this.messageCount = 0;
    this.targetTradeCount = 0;

    this.connected = false;
    this.stats.connected = false;
    this.emit({ type: "disconnected" });
    this.emit({ type: "status", data: this.stats });

    this.log("info", "Bot service stopped successfully");

    // Hint to GC
    if (global.gc) {
      setTimeout(() => global.gc?.(), 100);
    }

    return true;
  }

  // Flag to prevent concurrent reconnection attempts
  private isReconnecting: boolean = false;

  // Track destroyed state to prevent callbacks from stale WebSocket clients
  private wsClientDestroyed: boolean = false;

  // Properly clean up WebSocket client and all its event handlers
  private async cleanupWebSocket(): Promise<void> {
    if (!this.wsClient) return;

    this.log("info", "Cleaning up WebSocket connection...");

    // Mark as destroyed FIRST to prevent any callbacks
    this.wsClientDestroyed = true;

    // Keep reference to clear it
    const clientToCleanup = this.wsClient;
    this.wsClient = null;

    try {
      // Disable auto-reconnect FIRST (set on both options and client)
      try {
        if (clientToCleanup.options) {
          clientToCleanup.options.autoReconnect = false;
        }
        // Some versions store it directly on client
        clientToCleanup.autoReconnect = false;
        clientToCleanup._autoReconnect = false;
      } catch (e) {
        // Ignore
      }

      // Clear any internal timers the library might have
      try {
        if (clientToCleanup._reconnectTimer) {
          clearTimeout(clientToCleanup._reconnectTimer);
          clientToCleanup._reconnectTimer = null;
        }
        if (clientToCleanup._pingTimer) {
          clearInterval(clientToCleanup._pingTimer);
          clientToCleanup._pingTimer = null;
        }
        if (clientToCleanup.reconnectTimer) {
          clearTimeout(clientToCleanup.reconnectTimer);
          clientToCleanup.reconnectTimer = null;
        }
        if (clientToCleanup.pingInterval) {
          clearInterval(clientToCleanup.pingInterval);
          clientToCleanup.pingInterval = null;
        }
      } catch (e) {
        // Ignore
      }

      // Remove all event listeners to prevent memory leaks and callbacks
      try {
        if (typeof clientToCleanup.removeAllListeners === "function") {
          clientToCleanup.removeAllListeners();
        }
      } catch (e) {
        // Ignore
      }

      // Try to unsubscribe from all topics (ignore errors)
      try {
        clientToCleanup.unsubscribe?.({ subscriptions: [] });
      } catch (e) {
        // Ignore
      }

      // Force disconnect using the client's disconnect method
      try {
        if (typeof clientToCleanup.disconnect === "function") {
          clientToCleanup.disconnect();
        }
      } catch (e) {
        // Ignore
      }

      // Also close the underlying raw WebSocket if it exists
      const ws =
        clientToCleanup._ws || clientToCleanup.ws || clientToCleanup.socket;
      if (ws) {
        try {
          // Remove listeners from raw ws to prevent reconnect triggers
          ws.onopen = null;
          ws.onclose = null;
          ws.onerror = null;
          ws.onmessage = null;

          // Also remove event emitter style listeners
          if (typeof ws.removeAllListeners === "function") {
            ws.removeAllListeners();
          }

          // Force close with normal closure code
          if (ws.readyState === 0 || ws.readyState === 1) {
            // CONNECTING or OPEN
            ws.close(1000, "Bot stopped");
          }

          // Terminate if close isn't enough
          if (typeof ws.terminate === "function") {
            ws.terminate();
          }
        } catch (e) {
          // Ignore
        }
      }

      this.log("info", "WebSocket disconnected successfully");
    } catch (e) {
      this.log("warn", `Error during WebSocket cleanup: ${e}`);
    } finally {
      this.isReconnecting = false;
      this.connected = false;
      this.stats.connected = false;
    }
  }

  private async connectWebSocket() {
    // Prevent concurrent reconnection attempts
    if (this.isReconnecting) {
      this.log("debug", "Skipping connectWebSocket - already reconnecting");
      return;
    }

    // Don't connect if bot isn't running
    if (!this.running) {
      this.log("debug", "Skipping connectWebSocket - bot not running");
      return;
    }

    this.isReconnecting = true;
    // Reset destroyed flag for new connection
    this.wsClientDestroyed = false;

    try {
      // Clean up existing WebSocket client before creating a new one
      await this.cleanupWebSocket();

      // Reset destroyed flag again after cleanup (cleanup sets it to true)
      this.wsClientDestroyed = false;

      // Dynamically import the real-time data client
      const { RealTimeDataClient, ConnectionStatus } =
        await import("@polymarket/real-time-data-client");

      this.log("info", "Connecting to Polymarket WebSocket...", {
        targets: this.targets.size,
      });

      // Capture reference to check if this client instance is still valid
      const clientId = Date.now();

      const newClient = new RealTimeDataClient({
        onConnect: (client: any) => {
          // Ignore if this client was destroyed or bot is not running
          if (
            this.wsClientDestroyed ||
            !this.running ||
            this.wsClient !== newClient
          ) {
            this.log(
              "debug",
              "Ignoring onConnect - client destroyed or bot not running",
            );
            return;
          }

          try {
            this.log("info", "WebSocket connected to Polymarket");
            this.connected = true;
            this.stats.connected = true;
            this.messageCount = 0;
            this.targetTradeCount = 0;
            this.isReconnecting = false; // Clear reconnecting flag on successful connect
            this.resetReconnectState(); // Reset backoff on successful connect

            // Subscribe to trades and orders_matched
            client.subscribe({
              subscriptions: [
                { topic: "activity", type: "trades" },
                { topic: "activity", type: "orders_matched" },
              ],
            });

            this.log("info", "Subscribed to trades and orders_matched", {
              targets: Array.from(this.targets).map(
                (w) => w.substring(0, 10) + "...",
              ),
            });

            this.emit({ type: "connected" });
            this.emit({ type: "status", data: this.stats });
          } catch (err: any) {
            this.log("error", `Error in onConnect: ${err.message}`);
            this.isReconnecting = false;
          }
        },
        onMessage: (_: any, message: any) => {
          // Ignore messages if client destroyed or bot is not running
          if (
            this.wsClientDestroyed ||
            !this.running ||
            this.wsClient !== newClient
          ) {
            return;
          }

          try {
            this.messageCount++;
            this.stats.messagesReceived = this.messageCount;

            // Log every 100 messages
            if (this.messageCount % 100 === 0) {
              this.log(
                "debug",
                `Polling stats: ${this.messageCount} messages received, ${this.targetTradeCount} target trades detected`,
              );
              this.emit({ type: "status", data: this.stats });
            }

            // Log every 10 messages at info level for visibility
            if (this.messageCount % 10 === 0) {
              this.log(
                "debug",
                `WebSocket heartbeat: ${this.messageCount} msgs, ${this.targetTradeCount} target trades`,
              );
            }

            this.handleMessage(message);
          } catch (err: any) {
            this.log("error", `Error processing message: ${err.message}`);
          }
        },
        onStatusChange: (status: any) => {
          // Ignore status changes if client destroyed or bot is not running
          if (
            this.wsClientDestroyed ||
            !this.running ||
            this.wsClient !== newClient
          ) {
            this.log(
              "debug",
              "Ignoring onStatusChange - client destroyed or bot not running",
              {
                status,
              },
            );
            return;
          }

          try {
            this.log("debug", "WebSocket status change", { status });

            if (status === ConnectionStatus.CONNECTED) {
              // Already handled in onConnect, but ensure flags are set
              this.connected = true;
              this.stats.connected = true;
              this.isReconnecting = false;
            } else if (status === ConnectionStatus.CONNECTING) {
              // Just log, don't do anything - wait for CONNECTED or DISCONNECTED
              this.log("debug", "WebSocket connecting...");
            } else if (status === ConnectionStatus.DISCONNECTED) {
              this.log("warn", "WebSocket disconnected");
              this.connected = false;
              this.stats.connected = false;
              this.emit({ type: "disconnected" });
              this.emit({ type: "status", data: this.stats });

              // Schedule reconnect only if running and not already reconnecting
              if (this.running && !this.isReconnecting) {
                this.scheduleReconnect();
              }
            }
          } catch (err: any) {
            this.log("error", `Error in onStatusChange: ${err.message}`);
          }
        },
        // Disable built-in auto-reconnect - we handle reconnection ourselves
        // This prevents race conditions between the client's reconnect and ours
        autoReconnect: false,
        pingInterval: 15000,
      });

      // Store the new client
      this.wsClient = newClient;

      newClient.connect();
    } catch (error: any) {
      this.log("error", "Failed to connect WebSocket", {
        error: error.message,
      });
      this.stats.errors.push(error.message);
      // Trim errors to prevent memory leak
      if (this.stats.errors.length > this.MAX_ERRORS) {
        this.stats.errors = this.stats.errors.slice(-this.MAX_ERRORS);
      }
      this.emit({
        type: "error",
        data: { message: error.message, context: "websocket" },
      });

      this.isReconnecting = false; // Reset on error
      if (this.running && !this.isReconnecting) {
        this.scheduleReconnect();
      }
    }
  }

  // Reconnection state for exponential backoff
  private reconnectAttempts: number = 0;
  private readonly RECONNECT_BASE_MS = 1000; // Start with 1 second
  private readonly RECONNECT_MAX_MS = 30000; // Max 30 seconds

  private scheduleReconnect() {
    // Don't schedule if already reconnecting or not running
    if (this.isReconnecting || !this.running) {
      this.log(
        "debug",
        `Skipping scheduleReconnect - isReconnecting: ${this.isReconnecting}, running: ${this.running}`,
      );
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Exponential backoff with jitter: 1s, 2s, 4s, 8s... up to 30s
    const baseDelay = Math.min(
      this.RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      this.RECONNECT_MAX_MS,
    );
    // Add 20% jitter to prevent thundering herd
    const jitter = baseDelay * 0.2 * Math.random();
    const delay = Math.round(baseDelay + jitter);

    this.reconnectAttempts++;
    this.log(
      "info",
      `Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      if (this.running && !this.isReconnecting) {
        this.log("info", "Attempting to reconnect...");
        this.connectWebSocket();
      }
    }, delay);
  }

  private resetReconnectState() {
    this.reconnectAttempts = 0;
  }

  // Start chart snapshot timer - records balance periodically
  private startChartSnapshotTimer() {
    if (this.chartSnapshotTimer) {
      clearInterval(this.chartSnapshotTimer);
    }

    // Record initial snapshot
    this.recordChartSnapshot();

    // Record every 2 minutes (reduced from 1 minute to lower disk I/O)
    this.chartSnapshotTimer = setInterval(() => {
      if (this.running) {
        this.recordChartSnapshot();
      }
    }, 120000); // 2 minutes
  }

  // Start debug stats timer - logs memory and stats for crash debugging
  private startDebugStatsTimer() {
    if (this.debugStatsTimer) {
      clearInterval(this.debugStatsTimer);
    }

    // Log every 10 minutes (reduced from 5 to lower disk I/O)
    this.debugStatsTimer = setInterval(() => {
      if (this.running) {
        this.logDebugStats();
      }
    }, 600000); // 10 minutes
  }

  // Periodic garbage collection and memory cleanup
  private startGCTimer() {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
    }

    // Run cleanup every 2 minutes
    this.gcTimer = setInterval(() => {
      if (this.running) {
        this.performMemoryCleanup();
      }
    }, 120000); // 2 minutes
  }

  // Perform memory cleanup tasks
  private performMemoryCleanup() {
    try {
      // Clean up seenTrades set
      if (this.seenTrades.size > this.MAX_SEEN_TRADES) {
        const arr = Array.from(this.seenTrades);
        this.seenTrades = new Set(
          arr.slice(-Math.floor(this.MAX_SEEN_TRADES / 2)),
        );
        this.log(
          "debug",
          `Cleaned seenTrades: ${arr.length} -> ${this.seenTrades.size}`,
        );
      }

      // Clean up stats.errors
      if (this.stats.errors.length > this.MAX_ERRORS) {
        this.stats.errors = this.stats.errors.slice(-this.MAX_ERRORS);
      }

      // Clean up state trades if loaded
      if (
        this.state &&
        this.state.trades &&
        this.state.trades.length > this.MAX_TRADES
      ) {
        this.state.trades = this.state.trades.slice(-this.MAX_TRADES);
        this.log("debug", `Trimmed state.trades to ${this.MAX_TRADES}`);
      }

      // Clean up closed positions from state
      if (this.state && this.state.positions) {
        const posEntries = Object.entries(this.state.positions);
        for (const [tokenId, pos] of posEntries) {
          const p = pos as any;
          if (p.shares <= 0 || p.settled) {
            delete this.state.positions[tokenId];
          }
        }
      }

      // Clear live stats cache if stale
      if (
        this.liveStatsCache &&
        Date.now() - this.liveStatsCache.timestamp > 60000
      ) {
        this.liveStatsCache = null;
      }

      // Hint to GC if available (Node.js with --expose-gc flag)
      if (global.gc) {
        global.gc();
        this.log("debug", "Triggered manual GC");
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  // Log memory usage and stats for debugging
  private logDebugStats() {
    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
      const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(2);
      const rssMB = (memUsage.rss / 1024 / 1024).toFixed(2);
      const uptimeHours = this.stats.startTime
        ? ((Date.now() - this.stats.startTime) / 1000 / 60 / 60).toFixed(2)
        : "0";

      const debugInfo = {
        timestamp: new Date().toISOString(),
        uptime: `${uptimeHours} hours`,
        memory: {
          heapUsed: `${heapUsedMB} MB`,
          heapTotal: `${heapTotalMB} MB`,
          rss: `${rssMB} MB`,
        },
        stats: {
          messages: this.messageCount,
          targetTrades: this.targetTradeCount,
          tradesExecuted: this.stats.tradesExecuted,
          errors: this.stats.errors.length,
          seenTradesSize: this.seenTrades.size,
          positionsCount: this.state
            ? Object.keys(this.state.positions || {}).length
            : 0,
          tradesCount: this.state?.trades?.length || 0,
        },
        connected: this.connected,
        mode: this.tradingMode,
      };

      // Write to debug log file
      const debugLogPath = path.join(this.dataDir, "debug-stats.log");
      const logLine = JSON.stringify(debugInfo) + "\n";
      fs.appendFileSync(debugLogPath, logLine);

      // Keep debug log file from growing too large (max 100KB)
      try {
        const stats = fs.statSync(debugLogPath);
        if (stats.size > 100 * 1024) {
          const content = fs.readFileSync(debugLogPath, "utf-8");
          const lines = content.split("\n").filter((l) => l.trim());
          const recentLines = lines.slice(-50); // Keep last 50 entries
          fs.writeFileSync(debugLogPath, recentLines.join("\n") + "\n");
        }
      } catch {
        // Ignore
      }

      this.log(
        "debug",
        `Memory: ${heapUsedMB}MB heap, ${rssMB}MB RSS | Uptime: ${uptimeHours}h | Msgs: ${this.messageCount}`,
      );
    } catch (e) {
      // Ignore debug logging errors
    }
  }

  // Record a chart snapshot
  private recordChartSnapshot() {
    try {
      // Calculate current total PnL (realized + unrealized)
      let unrealizedPnl = 0;
      const positions = this.state?.positions || {};
      for (const pos of Object.values(positions) as any[]) {
        if (pos && pos.shares > 0 && pos.currentPrice !== undefined) {
          const currentValue = pos.shares * pos.currentPrice;
          const costBasis = pos.totalCost || pos.avgEntryPrice * pos.shares;
          unrealizedPnl += currentValue - costBasis;
        }
      }

      const realizedPnl = this.state?.stats?.totalRealizedPnl || 0;
      const totalPnl = realizedPnl + unrealizedPnl;
      const startingBalance = this.state?.startingBalance || 10000;

      const snapshot = {
        timestamp: Date.now(),
        pnl: totalPnl,
        realizedPnl,
        unrealizedPnl,
        balance: startingBalance + totalPnl,
      };

      // Load existing history
      const historyPath = path.join(this.dataDir, "chart-history.json");
      let chartHistory = { snapshots: [] as any[] };
      try {
        if (fs.existsSync(historyPath)) {
          chartHistory = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
        }
      } catch (e) {
        // Start fresh
      }

      // Add new snapshot
      chartHistory.snapshots.push(snapshot);

      // Keep last 5040 points (7 days at 2 min intervals) - reduced from 10080
      if (chartHistory.snapshots.length > 5040) {
        // Downsample older data more aggressively
        const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
        const recentSnapshots = chartHistory.snapshots.filter(
          (s: any) => s.timestamp >= twelveHoursAgo,
        );
        const oldSnapshots = chartHistory.snapshots.filter(
          (s: any) => s.timestamp < twelveHoursAgo,
        );
        // Keep only every 10th old point (reduces 6 hours of data to ~18 points)
        const downsampledOld = oldSnapshots.filter(
          (_: any, i: number) => i % 10 === 0,
        );
        chartHistory.snapshots = [...downsampledOld, ...recentSnapshots];
      }

      fs.writeFileSync(
        historyPath,
        JSON.stringify(chartHistory, null, 2),
        "utf-8",
      );
    } catch (e) {
      this.log("debug", "Failed to record chart snapshot", e);
    }
  }

  private handleMessage(message: {
    topic: string;
    type: string;
    payload: any;
  }) {
    try {
      // Filter non-activity messages
      if (message.topic !== "activity") {
        return;
      }

      if (message.type !== "trades" && message.type !== "orders_matched") {
        return;
      }

      const trade = message.payload;
      if (!trade) return;

      // Check if this is from a target wallet
      const traderWallet = trade.proxyWallet?.toLowerCase();
      if (!traderWallet || !this.targets.has(traderWallet)) {
        return; // Not a target wallet, ignore
      }

      // Build trade ID for deduplication
      const tradeId = `${trade.transactionHash}-${trade.asset}-${trade.side}-${trade.size}`;

      // Skip if already seen
      if (this.seenTrades.has(tradeId)) {
        return;
      }
      this.seenTrades.add(tradeId);

      // Clean up old trades more aggressively (keep last MAX_SEEN_TRADES/2)
      if (this.seenTrades.size > this.MAX_SEEN_TRADES) {
        const arr = Array.from(this.seenTrades);
        this.seenTrades = new Set(
          arr.slice(-Math.floor(this.MAX_SEEN_TRADES / 2)),
        );
      }

      this.targetTradeCount++;
      this.stats.targetTradesDetected = this.targetTradeCount;

      // Build trade signal
      // Note: Polymarket timestamps can be in seconds or milliseconds, normalize to ms
      let tradeTimestamp = trade.timestamp || Date.now();
      if (tradeTimestamp < 1e12) {
        // Timestamp is in seconds, convert to milliseconds
        tradeTimestamp = tradeTimestamp * 1000;
      }

      const signal: TradeSignal = {
        tokenId: trade.asset,
        conditionId: trade.conditionId,
        marketSlug: trade.slug || trade.eventSlug,
        outcome: trade.outcome as "YES" | "NO",
        outcomeIndex: trade.outcomeIndex,
        side: trade.side as "BUY" | "SELL",
        price: trade.price,
        size: trade.size,
        targetWallet: traderWallet,
        tradeId,
        timestamp: tradeTimestamp,
        eventSlug: trade.eventSlug,
        name: trade.name,
        title: trade.title,
        transactionHash: trade.transactionHash,
      };

      this.log(
        "info",
        `Target trade detected: ${signal.side} ${signal.size.toFixed(2)} ${signal.outcome} @ $${signal.price.toFixed(3)}`,
        {
          market: signal.marketSlug,
          wallet: signal.targetWallet.substring(0, 10) + "...",
        },
      );

      this.emit({ type: "trade-detected", data: signal });

      // Execute trade based on mode
      this.log(
        "info",
        `Dispatching trade in ${this.tradingMode.toUpperCase()} mode`,
      );

      if (this.tradingMode === "live") {
        this.log("info", "[LIVE] Calling executeLiveTrade...");
        this.executeLiveTrade(signal);
      } else if (this.tradingMode === "dry-run") {
        // Dry run - just log, don't execute
        this.log(
          "info",
          `[DRY-RUN] Would execute: ${signal.side} ${signal.size.toFixed(2)} ${signal.outcome}`,
        );
        this.emit({
          type: "trade-skipped",
          data: { signal, reason: "Dry run mode" },
        });
      } else {
        // Paper trading
        this.log("info", "[PAPER] Calling executePaperTrade...");
        this.executePaperTrade(signal);
      }
    } catch (err: any) {
      this.log("error", `Error handling message: ${err.message}`);
    }
  }

  private executePaperTrade(signal: TradeSignal) {
    try {
      if (!this.state || !this.config) return;

      // Calculate position size based on config
      let shares = signal.size;
      const config = this.config.trading;

      switch (config.sizingMode) {
        case "fixed-usd":
          shares = config.fixedUsdSize / signal.price;
          break;
        case "fixed-shares":
          shares = config.fixedSharesSize;
          break;
        case "proportional":
          shares = signal.size * config.proportionalMultiplier;
          break;
      }

      // Apply minimum USD size if configured
      let usdValue = shares * signal.price;
      const minOrderSizeUsd = config.minOrderSize ?? 0;
      if (
        minOrderSizeUsd > 0 &&
        usdValue < minOrderSizeUsd &&
        signal.price > 0
      ) {
        shares = Math.ceil((minOrderSizeUsd / signal.price) * 100) / 100;
        usdValue = shares * signal.price;
        this.log("debug", "Adjusted paper trade to meet minimum USD size", {
          minOrderSizeUsd,
          adjustedShares: shares,
          adjustedUsdValue: usdValue.toFixed(2),
        });
      }

      // Apply minimum shares size if configured
      const minOrderShares = config.minOrderShares ?? 0;
      if (minOrderShares > 0 && shares < minOrderShares) {
        this.log(
          "info",
          `Trade skipped: size ${shares.toFixed(2)} below minimum ${minOrderShares}`,
        );
        this.emit({
          type: "trade-skipped",
          data: { signal, reason: "Below minimum shares" },
        });
        return;
      }

      // Apply max trade limit
      if (usdValue > this.config.risk.maxUsdPerTrade) {
        shares = this.config.risk.maxUsdPerTrade / signal.price;
        usdValue = shares * signal.price;
      }

      const cost = shares * signal.price;
      const fees = cost * 0.001; // 0.1% fee

      // Check balance for BUY orders
      if (signal.side === "BUY") {
        if (cost + fees > this.state.currentBalance) {
          this.log(
            "warn",
            `Insufficient balance: need $${(cost + fees).toFixed(2)}, have $${this.state.currentBalance.toFixed(2)}`,
          );
          this.emit({
            type: "trade-skipped",
            data: { signal, reason: "Insufficient balance" },
          });
          return;
        }
      }

      // Execute the trade
      const tokenId = signal.tokenId;
      const existingPosition = this.state.positions[tokenId];

      if (signal.side === "BUY") {
        // BUY: Add to position
        if (existingPosition && existingPosition.shares > 0) {
          // Average in
          const totalShares = existingPosition.shares + shares;
          const totalCost = existingPosition.totalCost + cost;
          existingPosition.shares = totalShares;
          existingPosition.totalCost = totalCost;
          existingPosition.avgEntryPrice = totalCost / totalShares;
          existingPosition.feesPaid = (existingPosition.feesPaid || 0) + fees;
        } else {
          // New position
          this.state.positions[tokenId] = {
            tokenId,
            marketSlug: signal.marketSlug,
            outcome: signal.outcome,
            side: "BUY",
            shares,
            avgEntryPrice: signal.price,
            totalCost: cost,
            currentPrice: signal.price,
            openedAt: Date.now(),
            feesPaid: fees,
            conditionId: signal.conditionId,
          };
        }

        // Deduct from balance
        this.state.currentBalance -= cost + fees;
      } else {
        // SELL: Reduce position
        if (!existingPosition || existingPosition.shares <= 0) {
          this.log("info", "No position to sell");
          this.emit({
            type: "trade-skipped",
            data: { signal, reason: "No position to sell" },
          });
          return;
        }

        const sellShares = Math.min(shares, existingPosition.shares);
        const proceeds = sellShares * signal.price;
        const entryValue =
          (sellShares / existingPosition.shares) * existingPosition.totalCost;
        const pnl = proceeds - entryValue - fees;

        existingPosition.shares -= sellShares;
        existingPosition.totalCost -= entryValue;
        existingPosition.feesPaid = (existingPosition.feesPaid || 0) + fees;

        // Add to balance
        this.state.currentBalance += proceeds - fees;

        // Clean up fully closed positions to prevent memory leak
        if (existingPosition.shares <= 0) {
          delete this.state.positions[tokenId];
        }

        // Update stats
        if (!this.state.stats) this.state.stats = {};
        this.state.stats.totalRealizedPnl =
          (this.state.stats.totalRealizedPnl || 0) + pnl;

        if (pnl > 0) {
          this.state.stats.winningTrades =
            (this.state.stats.winningTrades || 0) + 1;
          this.state.stats.largestWin = Math.max(
            this.state.stats.largestWin || 0,
            pnl,
          );
        } else if (pnl < 0) {
          this.state.stats.losingTrades =
            (this.state.stats.losingTrades || 0) + 1;
          this.state.stats.largestLoss = Math.min(
            this.state.stats.largestLoss || 0,
            pnl,
          );
        }
      }

      // Record trade
      const trade = {
        id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        tokenId,
        marketSlug: signal.marketSlug,
        outcome: signal.outcome,
        side: signal.side,
        price: signal.price,
        shares,
        usdValue: cost,
        fees,
        targetWallet: signal.targetWallet,
        tradeId: signal.tradeId,
      };

      this.state.trades.push(trade);
      // Trim trades array aggressively to prevent memory leak
      if (this.state.trades.length > this.MAX_TRADES) {
        // Keep only half when trimming to reduce frequency of trim operations
        this.state.trades = this.state.trades.slice(
          -Math.floor(this.MAX_TRADES * 0.75),
        );
      }

      // Update stats
      if (!this.state.stats) this.state.stats = {};
      this.state.stats.totalTrades = (this.state.stats.totalTrades || 0) + 1;
      this.state.stats.totalFees = (this.state.stats.totalFees || 0) + fees;

      // Save state
      this.saveState();

      this.stats.tradesExecuted++;
      this.stats.lastTradeTime = Date.now();

      // Calculate latency from target trade time
      const latencyMs = signal.timestamp ? Date.now() - signal.timestamp : 0;

      this.log(
        "info",
        `Executed paper ${signal.side}: ${shares.toFixed(2)} ${signal.outcome} @ $${signal.price.toFixed(3)}`,
        {
          market: signal.marketSlug,
          cost: cost.toFixed(2),
          balance: this.state.currentBalance.toFixed(2),
        },
      );

      this.emit({
        type: "trade-executed",
        data: {
          signal,
          result: trade,
          yourShares: shares,
          yourPrice: signal.price,
          yourTotal: cost,
          fees,
          latencyMs,
        },
      });
      this.emit({ type: "status", data: this.stats });
    } catch (err: any) {
      this.log("error", `Error executing paper trade: ${err.message}`);
      this.emit({
        type: "trade-skipped",
        data: { signal, reason: `Error: ${err.message}` },
      });
    }
  }

  getMode(): "paper" | "live" | "dry-run" {
    return this.tradingMode;
  }

  setMode(mode: "paper" | "live" | "dry-run") {
    this.tradingMode = mode;
    this.stats.mode = mode;
    if (this.config) {
      this.config.mode = mode;
      // Save updated config
      try {
        const configPath = path.join(this.dataDir, "config.json");
        fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
      } catch (e) {
        this.log("error", "Failed to save mode to config", e);
      }
    }
    this.log("info", `Trading mode changed to: ${mode.toUpperCase()}`);
  }

  private async initializeClobClient(): Promise<void> {
    this.log("info", "Initializing CLOB client for live trading...");

    try {
      // Load credentials from active account in accounts.json
      const accountsState = this.loadAccountsState();
      let privateKey: string | null = null;
      let polyApiKey: string | null = null;
      let polyApiSecret: string | null = null;
      let polyPassphrase: string | null = null;
      let polyFunderAddress: string | null = null;
      let signatureType: number = 0; // Default to 0 (EOA/browser wallet)

      if (accountsState.activeAccountId && accountsState.accounts) {
        const activeAccount = accountsState.accounts.find(
          (acc: any) => acc.id === accountsState.activeAccountId,
        );
        if (activeAccount) {
          privateKey = activeAccount.privateKey;
          polyApiKey = activeAccount.polyApiKey;
          polyApiSecret = activeAccount.polyApiSecret;
          polyPassphrase = activeAccount.polyPassphrase;
          polyFunderAddress = activeAccount.polyFunderAddress;
          // Use signatureType from account, default to 0 (EOA wallet)
          signatureType = activeAccount.signatureType ?? 0;
          this.log(
            "info",
            `Using credentials from active account: ${activeAccount.name} (${activeAccount.address}), signatureType: ${signatureType}`,
          );
        }
      }

      if (!privateKey) {
        throw new Error(
          "No private key configured. Please add and select a live account in Settings.",
        );
      }

      if (!polyApiKey || !polyApiSecret || !polyPassphrase) {
        throw new Error(
          "Missing Polymarket API credentials. Please ensure your account has API Key, Secret, and Passphrase configured.",
        );
      }

      // Ensure private key has 0x prefix
      if (!privateKey.startsWith("0x")) {
        privateKey = "0x" + privateKey;
      }

      // Create the CLOB client using the local bundled module
      this.clobClient = new ClobClientWrapper({
        privateKey,
        chainId: 137, // Polygon mainnet
        polyApiKey,
        polyApiSecret,
        polyPassphrase,
        polyFunderAddress: polyFunderAddress || undefined,
        signatureType, // 0 = browser wallet, 1 = Magic/Email login
      });

      await this.clobClient.initialize();
      this.log("info", "CLOB client initialized for live trading");
    } catch (e: any) {
      this.log("error", `Failed to initialize CLOB client: ${e.message}`);
      throw e;
    }
  }

  private async initializeLiveDataClient(): Promise<void> {
    try {
      // Import the LiveDataClient
      const { LiveDataClient } = await import("./liveDataClient");

      // Load the active account from accounts.json
      const accountsPath = path.join(this.dataDir, "accounts.json");
      let privateKey: string | null = null;
      let walletAddress: string | null = null;
      let funderAddress: string | null = null;

      if (fs.existsSync(accountsPath)) {
        try {
          const accountsState = JSON.parse(
            fs.readFileSync(accountsPath, "utf-8"),
          );
          if (accountsState.activeAccountId && accountsState.accounts) {
            const activeAccount = accountsState.accounts.find(
              (acc: any) => acc.id === accountsState.activeAccountId,
            );
            if (activeAccount) {
              privateKey = activeAccount.privateKey;
              walletAddress = activeAccount.address;
              // IMPORTANT: Use polyFunderAddress for querying positions/balances
              // This is the Polymarket proxy address where funds are held
              funderAddress = activeAccount.polyFunderAddress;
              this.log(
                "info",
                `Found active account: ${activeAccount.name} (wallet: ${walletAddress}, funder: ${funderAddress || "same as wallet"})`,
              );
            }
          }
        } catch (e) {
          this.log("warn", "Failed to parse accounts.json");
        }
      }

      // Fallback to .env file if no active account found
      if (!privateKey && !walletAddress) {
        const envPath = path.join(this.dataDir, ".env");
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, "utf-8");
          // Try PRIVATE_KEY first (used by account switching), then POLY_PRIVATE_KEY
          let match = envContent.match(/PRIVATE_KEY=(.+)/);
          if (match) {
            privateKey = match[1].trim();
          }
          // Also try to get funder address from .env
          match = envContent.match(/POLY_FUNDER_ADDRESS=(.+)/);
          if (match) {
            funderAddress = match[1].trim();
          }
        }
      }

      if (!privateKey && !walletAddress) {
        throw new Error(
          "No active account selected. Please add and select a live account in Settings.",
        );
      }

      // Use funder address (Polymarket proxy) for API queries if available
      // Otherwise fall back to wallet address
      const queryAddress = funderAddress || walletAddress || privateKey!;
      this.liveDataClient = new LiveDataClient(queryAddress);
      this.log(
        "info",
        `Live data client initialized for address: ${this.liveDataClient.getWalletAddress()} (funderAddress: ${funderAddress ? "yes" : "no"})`,
      );
    } catch (e: any) {
      this.log("error", `Failed to initialize live data client: ${e.message}`);
      throw e;
    }
  }

  private async executeLiveTrade(signal: TradeSignal): Promise<void> {
    this.log("info", `[LIVE TRADE] Attempting to execute live trade...`);

    if (!this.clobClient || !this.config) {
      this.log(
        "error",
        "[LIVE TRADE] CLOB client not initialized - cannot execute!",
      );
      this.emit({
        type: "trade-skipped",
        data: { signal, reason: "CLOB client not initialized" },
      });
      return;
    }

    const startTime = Date.now();

    try {
      // Calculate position size
      let shares = signal.size;
      const config = this.config.trading;

      switch (config.sizingMode) {
        case "fixed-usd":
          shares = config.fixedUsdSize / signal.price;
          break;
        case "fixed-shares":
          shares = config.fixedSharesSize;
          break;
        case "proportional":
          shares = signal.size * config.proportionalMultiplier;
          break;
      }

      // Apply minimum USD size if configured
      let usdValue = shares * signal.price;
      const minOrderSizeUsd = config.minOrderSize ?? 0;
      if (
        minOrderSizeUsd > 0 &&
        usdValue < minOrderSizeUsd &&
        signal.price > 0
      ) {
        shares = Math.ceil((minOrderSizeUsd / signal.price) * 100) / 100;
        usdValue = shares * signal.price;
        this.log("debug", "Adjusted live trade to meet minimum USD size", {
          minOrderSizeUsd,
          adjustedShares: shares,
          adjustedUsdValue: usdValue.toFixed(2),
        });
      }

      // Apply minimum shares size if configured
      const minOrderShares = config.minOrderShares ?? 0;
      if (minOrderShares > 0 && shares < minOrderShares) {
        this.log(
          "info",
          `Trade skipped: size ${shares.toFixed(2)} below minimum ${minOrderShares}`,
        );
        this.emit({
          type: "trade-skipped",
          data: { signal, reason: "Below minimum shares" },
        });
        return;
      }

      // Apply max trade limit
      if (usdValue > this.config.risk.maxUsdPerTrade) {
        shares = this.config.risk.maxUsdPerTrade / signal.price;
        usdValue = shares * signal.price;
      }

      // Apply slippage to price
      const slippageMultiplier =
        signal.side === "BUY" ? 1 + config.slippage : 1 - config.slippage;
      const limitPrice = signal.price * slippageMultiplier;

      this.log(
        "info",
        `Executing LIVE trade: ${signal.side} ${shares.toFixed(2)} ${signal.outcome} @ $${limitPrice.toFixed(4)}`,
      );

      // Place the order via CLOB client
      this.log("debug", "[LIVE TRADE] Calling clobClient.placeOrder...", {
        tokenId: signal.tokenId,
        side: signal.side,
        size: shares,
        price: limitPrice,
      });

      const orderResult = await this.clobClient.placeOrder({
        tokenId: signal.tokenId,
        side: signal.side,
        size: shares,
        price: limitPrice,
      });

      this.log("debug", "[LIVE TRADE] Order result:", orderResult);

      const latencyMs = Date.now() - startTime;

      if (orderResult.success) {
        this.stats.tradesExecuted++;
        this.stats.lastTradeTime = Date.now();

        // Use correct field names from OrderResult interface
        const filledShares = orderResult.executedSize || shares;
        const filledPrice = orderResult.executedPrice || limitPrice;
        const fees = shares * limitPrice * 0.001; // Estimate fees

        this.log(
          "info",
          `LIVE trade executed: ${signal.side} ${filledShares.toFixed(2)} @ $${filledPrice.toFixed(4)}`,
          {
            orderId: orderResult.orderId,
            filledShares,
            latencyMs,
          },
        );

        this.emit({
          type: "trade-executed",
          data: {
            signal,
            result: orderResult,
            yourShares: filledShares,
            yourPrice: filledPrice,
            yourTotal: filledShares * filledPrice,
            fees,
            latencyMs,
          },
        });
      } else {
        // clobClient returns errorMessage, not error
        const errorMsg =
          orderResult.errorMessage || orderResult.error || "Unknown error";
        this.log("error", `LIVE trade failed: ${errorMsg}`);
        this.emit({
          type: "trade-skipped",
          data: { signal, reason: errorMsg || "Order failed" },
        });
      }
    } catch (e: any) {
      const latencyMs = Date.now() - startTime;
      this.log("error", `LIVE trade error: ${e.message}`, { latencyMs });
      this.stats.errors.push(e.message);
      // Trim errors to prevent memory leak
      if (this.stats.errors.length > this.MAX_ERRORS) {
        this.stats.errors = this.stats.errors.slice(-this.MAX_ERRORS);
      }
      this.emit({
        type: "error",
        data: { message: e.message, context: "live-trade" },
      });
      this.emit({ type: "trade-skipped", data: { signal, reason: e.message } });
    }
  }

  getStats(): BotStats {
    return this.stats;
  }

  isRunning(): boolean {
    return this.running;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Get live stats from Polymarket API
  async getLiveStats(): Promise<{
    balance: number;
    startingBalance?: number;
    positions: any[];
    positionsValue: number;
    unrealizedPnl: number;
    realizedPnl: number;
    totalTrades: number;
    totalFees: number;
    winRate: number;
    winningTrades: number;
    losingTrades: number;
    largestWin: number;
    largestLoss: number;
    profitFactor: number;
    avgTradeSize: number;
    trades?: any[];
  } | null> {
    // Return cached data if still valid
    if (
      this.liveStatsCache &&
      Date.now() - this.liveStatsCache.timestamp < this.LIVE_STATS_CACHE_TTL
    ) {
      return this.liveStatsCache.data;
    }

    // Check if we have a live data client initialized
    if (!this.liveDataClient) {
      // Try to initialize it
      try {
        await this.initializeLiveDataClient();
      } catch (e) {
        this.log(
          "warn",
          "Cannot fetch live stats - Live data client not initialized",
        );
        // Return cached data even if expired, rather than null
        if (this.liveStatsCache) {
          return this.liveStatsCache.data;
        }
        return null;
      }
    }

    if (!this.liveDataClient) {
      // Return cached data even if expired
      if (this.liveStatsCache) {
        return this.liveStatsCache.data;
      }
      return null;
    }

    try {
      // Try to use CLOB client first if available (authenticated, more reliable)
      let balance = 0;
      let positions: any[] = [];
      let trades: any[] = [];

      // Initialize CLOB client if not already done
      if (!this.clobClient) {
        try {
          await this.initializeClobClient();
        } catch (e: any) {
          this.log(
            "warn",
            "Could not initialize CLOB client for live stats",
            e.message,
          );
        }
      }

      if (this.clobClient) {
        try {
          // OPTIMIZATION: Fetch balance first (fast), it updates the UI immediately
          const balances = await this.clobClient.getBalances();
          balance = parseFloat(balances.usdc) || 0;
          this.log("debug", `CLOB client balance: $${balance}`);

          // OPTIMIZATION: Fetch positions and trades in parallel using Promise.all
          const [positionsResult, tradesResult] = await Promise.all([
            this.clobClient.getPositions().catch((e: any) => {
              this.log("warn", `Failed to fetch positions: ${e.message}`);
              return { positions: [], totalValue: 0, totalFees: 0 };
            }),
            this.clobClient.getTrades().catch((e: any) => {
              this.log("warn", `Failed to fetch trades: ${e.message}`);
              return { trades: [], count: 0 };
            }),
          ]);

          if (positionsResult && positionsResult.positions) {
            positions = positionsResult.positions.map((pos: any) => ({
              tokenId: pos.tokenId,
              outcome: pos.outcome || "YES",
              shares: pos.shares,
              avgEntryPrice: pos.avgEntryPrice,
              currentPrice: pos.avgEntryPrice, // Current market price would need separate API call
              currentValue: pos.currentValue,
              market: pos.market || "Unknown Market",
              conditionId: pos.conditionId,
              isResolved: pos.isResolved,
              isRedeemable: pos.isRedeemable,
              feesPaid: pos.feesPaid,
            }));
            this.log(
              "debug",
              `CLOB client positions: ${positions.length}, totalValue: $${positionsResult.totalValue.toFixed(2)}`,
            );
          }

          if (tradesResult && tradesResult.trades) {
            trades = tradesResult.trades.map((t: any) => {
              // Fix timestamp parsing - handle both ISO string and Unix timestamp formats
              let timestamp: number;
              if (typeof t.match_time === 'string') {
                // ISO 8601 format: "2024-01-01T10:00:00Z"
                timestamp = new Date(t.match_time).getTime();
                // If invalid date, try parsing as Unix timestamp
                if (isNaN(timestamp)) {
                  timestamp = parseInt(t.match_time, 10);
                  if (timestamp < 1e12) timestamp *= 1000; // Convert seconds to ms
                }
              } else if (typeof t.match_time === 'number') {
                timestamp = t.match_time < 1e12 ? t.match_time * 1000 : t.match_time;
              } else {
                timestamp = Date.now();
              }

              const price = parseFloat(t.price) || 0;
              const size = parseFloat(t.size) || 0;
              const feeRateBps = parseFloat(t.fee_rate_bps) || 0;
              // Fee calculation: price * size * (bps / 10000)
              const fees = price * size * (feeRateBps / 10000);

              return {
                id: t.id,
                timestamp,
                tokenId: t.asset_id,
                market: t.market,
                outcome: t.outcome || "YES",
                side: t.side?.toUpperCase() || "BUY",
                price,
                shares: size,
                usdValue: price * size,
                fees,
                feeRateBps,
              };
            });
            this.log("debug", `CLOB client trades: ${trades.length}`);
          }
        } catch (e: any) {
          this.log(
            "warn",
            `CLOB client data fetch failed: ${e.message}, falling back to LiveDataClient`,
          );
        }
      }

      // Fallback to LiveDataClient ONLY if CLOB client completely failed (no positions AND no balance)
      // Don't fallback if we have positions - that means CLOB is working, just maybe no USDC balance
      const clobWorked = positions.length > 0 || balance > 0;
      if (!clobWorked && this.liveDataClient) {
        try {
          this.log(
            "debug",
            "CLOB client returned no data, trying LiveDataClient fallback",
          );
          const liveData = await this.liveDataClient.getLiveData();
          balance = liveData.balance || 0;
          positions = liveData.positions || [];
          trades = liveData.trades || [];
          this.log(
            "debug",
            `LiveDataClient fallback: balance=$${balance}, positions=${positions.length}, trades=${trades.length}`,
          );
        } catch (e: any) {
          this.log("warn", `LiveDataClient fallback failed: ${e.message}`);
        }
      }

      // Calculate positions value and unrealized PnL
      let positionsValue = 0;
      let unrealizedPnl = 0;

      for (const pos of positions) {
        if (pos.shares > 0) {
          positionsValue += pos.currentValue || 0;
          const costBasis = pos.avgEntryPrice * pos.shares;
          unrealizedPnl += (pos.currentValue || 0) - costBasis;
        }
      }

      // Calculate trade statistics
      let totalVolume = 0;
      let totalFees = 0;
      let winningTrades = 0;
      let losingTrades = 0;
      let totalWins = 0;
      let totalLosses = 0;
      let largestWin = 0;
      let largestLoss = 0;

      // Group trades by asset to calculate realized PnL
      const tradesByAsset = new Map<string, any[]>();
      for (const trade of trades) {
        const assetId = trade.tokenId;
        if (!tradesByAsset.has(assetId)) {
          tradesByAsset.set(assetId, []);
        }
        tradesByAsset.get(assetId)!.push(trade);

        totalVolume += trade.usdValue || 0;
        totalFees += trade.fees || 0;
      }

      // Calculate realized PnL from closed positions (FIFO) and track closed positions
      let realizedPnl = 0;
      const closedPositions: any[] = [];

      for (const [assetId, assetTrades] of Array.from(tradesByAsset.entries())) {
        const sorted = assetTrades.sort(
          (a: any, b: any) => a.timestamp - b.timestamp,
        );

        let shares = 0;
        let costBasis = 0;
        let positionPnl = 0;
        let totalBought = 0;
        let totalSold = 0;
        let lastTrade: any = null;
        let avgEntryPrice = 0;
        let avgExitPrice = 0;

        for (const trade of sorted) {
          const size = trade.shares || 0;
          const price = trade.price || 0;
          const isBuy = trade.side === "BUY";
          lastTrade = trade;

          if (isBuy) {
            costBasis += size * price;
            shares += size;
            totalBought += size;
            avgEntryPrice = shares > 0 ? costBasis / shares : 0;
          } else if (shares > 0) {
            // Calculate realized PnL on sell
            const avgCost = costBasis / shares;
            const pnl = (price - avgCost) * size;
            realizedPnl += pnl;
            positionPnl += pnl;
            totalSold += size;
            avgExitPrice = totalSold > 0 ? (avgExitPrice * (totalSold - size) + price * size) / totalSold : price;

            if (pnl > 0) {
              winningTrades++;
              totalWins += pnl;
              largestWin = Math.max(largestWin, pnl);
            } else if (pnl < 0) {
              losingTrades++;
              totalLosses += Math.abs(pnl);
              largestLoss = Math.min(largestLoss, pnl);
            }

            // Reduce cost basis proportionally
            const proportion = Math.min(size / shares, 1);
            costBasis -= costBasis * proportion;
            shares -= size;
          }
        }

        // Track as closed position if fully sold (shares near 0) and had sells
        if (shares < 0.01 && totalSold > 0 && lastTrade) {
          closedPositions.push({
            tokenId: assetId,
            outcome: lastTrade.outcome || "Yes",
            shares: 0,
            avgEntryPrice,
            avgExitPrice,
            currentValue: 0,
            market: lastTrade.market || "Unknown Market",
            pnl: positionPnl,
            settlementPnl: positionPnl,
            settled: true,
            closedAt: lastTrade.timestamp,
          });
        }
      }

      const totalTrades = trades.length;
      const closedTrades = winningTrades + losingTrades;
      const winRate = closedTrades > 0 ? winningTrades / closedTrades : 0;
      const profitFactor =
        totalLosses > 0
          ? totalWins / totalLosses
          : totalWins > 0
            ? Infinity
            : 0;
      const avgTradeSize = totalTrades > 0 ? totalVolume / totalTrades : 0;

      // Load starting balance from saved state if available
      const liveStatePath = path.join(this.dataDir, "live-state.json");
      let startingBalance = balance + positionsValue;
      try {
        if (fs.existsSync(liveStatePath)) {
          const savedState = JSON.parse(
            fs.readFileSync(liveStatePath, "utf-8"),
          );
          startingBalance = savedState.startingBalance || startingBalance;
        } else {
          // Save initial starting balance
          fs.writeFileSync(
            liveStatePath,
            JSON.stringify(
              {
                startingBalance: balance + positionsValue,
                createdAt: Date.now(),
              },
              null,
              2,
            ),
            "utf-8",
          );
        }
      } catch (e) {
        // Ignore
      }

      const result = {
        balance,
        startingBalance,
        positions,
        closedPositions,
        positionsValue,
        unrealizedPnl,
        realizedPnl,
        totalTrades,
        totalFees,
        winRate,
        winningTrades,
        losingTrades,
        largestWin,
        largestLoss,
        profitFactor,
        avgTradeSize,
        trades,
      };

      // Cache the result
      this.liveStatsCache = {
        data: result,
        timestamp: Date.now(),
      };

      return result;
    } catch (e: any) {
      this.log("error", "Failed to fetch live stats", { error: e.message });
      // Return cached data if available, even on error
      if (this.liveStatsCache) {
        return this.liveStatsCache.data;
      }
      return null;
    }
  }
}

// Singleton instance
let botService: BotService | null = null;

export function getBotService(dataDir?: string): BotService {
  if (!botService && dataDir) {
    botService = new BotService(dataDir);
  }
  if (!botService) {
    throw new Error("BotService not initialized");
  }
  return botService;
}
