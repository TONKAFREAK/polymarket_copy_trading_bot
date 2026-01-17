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
  private messageCount: number = 0;
  private targetTradeCount: number = 0;

  // CLOB client for live trading
  private clobClient: any = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
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
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("bot:event", event);
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
  private readonly STATE_SAVE_DEBOUNCE_MS = 100;

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
        return JSON.parse(fs.readFileSync(statePath, "utf-8"));
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
    if (accountsState.activeAccountId) {
      this.tradingMode = "live";
    } else {
      this.tradingMode = this.config.mode || "paper";
    }

    // Apply dry-run override if set
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
      } catch (e: any) {
        this.log("error", `Failed to initialize CLOB client: ${e.message}`);
        this.emit({
          type: "error",
          data: {
            message: `CLOB init failed: ${e.message}`,
            context: "startup",
          },
        });
        // Fall back to paper mode
        this.tradingMode = "paper";
        this.stats.mode = "paper";
        this.log("warn", "Falling back to paper trading mode");
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

    return true;
  }

  async stop(): Promise<boolean> {
    if (!this.running) {
      return true;
    }

    this.log("info", "Stopping bot service...");

    // Set running to false FIRST to prevent any reconnection attempts
    this.running = false;
    this.stats.status = "stopped";

    // Clear reconnect timer immediately
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clear chart snapshot timer
    if (this.chartSnapshotTimer) {
      clearInterval(this.chartSnapshotTimer);
      this.chartSnapshotTimer = null;
    }

    // Disconnect WebSocket with force
    if (this.wsClient) {
      try {
        // Unsubscribe first if possible
        try {
          this.wsClient.unsubscribe?.({ subscriptions: [] });
        } catch (e) {
          // Ignore
        }
        // Force disconnect
        this.wsClient.disconnect?.();
        this.wsClient.close?.();
      } catch (e) {
        // Ignore close errors
      }
      this.wsClient = null;
    }

    // Flush any pending state to disk
    await this.flushState();

    this.connected = false;
    this.stats.connected = false;
    this.emit({ type: "disconnected" });
    this.emit({ type: "status", data: this.stats });

    this.log("info", "Bot service stopped successfully");

    return true;
  }

  private async connectWebSocket() {
    try {
      // Dynamically import the real-time data client
      const { RealTimeDataClient, ConnectionStatus } =
        await import("@polymarket/real-time-data-client");

      this.log("info", "Connecting to Polymarket WebSocket...", {
        targets: this.targets.size,
      });

      this.wsClient = new RealTimeDataClient({
        onConnect: (client: any) => {
          this.log("info", "WebSocket connected to Polymarket");
          this.connected = true;
          this.stats.connected = true;
          this.messageCount = 0;
          this.targetTradeCount = 0;
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
        },
        onMessage: (_: any, message: any) => {
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
        },
        onStatusChange: (status: any) => {
          this.log("debug", "WebSocket status change", { status });

          if (status === ConnectionStatus.DISCONNECTED) {
            this.log("warn", "WebSocket disconnected");
            this.connected = false;
            this.stats.connected = false;
            this.emit({ type: "disconnected" });
            this.emit({ type: "status", data: this.stats });

            // Schedule reconnect
            if (this.running) {
              this.scheduleReconnect();
            }
          }
        },
        autoReconnect: true,
        pingInterval: 15000,
      });

      this.wsClient.connect();
    } catch (error: any) {
      this.log("error", "Failed to connect WebSocket", {
        error: error.message,
      });
      this.stats.errors.push(error.message);
      this.emit({
        type: "error",
        data: { message: error.message, context: "websocket" },
      });

      if (this.running) {
        this.scheduleReconnect();
      }
    }
  }

  // Reconnection state for exponential backoff
  private reconnectAttempts: number = 0;
  private readonly RECONNECT_BASE_MS = 100;
  private readonly RECONNECT_MAX_MS = 5000;

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Exponential backoff with jitter: 100ms, 200ms, 400ms, 800ms... up to 5000ms
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
      if (this.running) {
        this.log("info", "Attempting to reconnect...");
        this.connectWebSocket();
      }
    }, delay);
  }

  private resetReconnectState() {
    this.reconnectAttempts = 0;
  }

  // Start chart snapshot timer - records balance every 60 seconds
  private startChartSnapshotTimer() {
    if (this.chartSnapshotTimer) {
      clearInterval(this.chartSnapshotTimer);
    }

    // Record initial snapshot
    this.recordChartSnapshot();

    // Record every 60 seconds
    this.chartSnapshotTimer = setInterval(() => {
      if (this.running) {
        this.recordChartSnapshot();
      }
    }, 60000); // 1 minute
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

      // Keep last 10080 points (7 days at 1 min intervals)
      if (chartHistory.snapshots.length > 10080) {
        // Downsample older data
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const recentSnapshots = chartHistory.snapshots.filter(
          (s: any) => s.timestamp >= oneDayAgo,
        );
        const oldSnapshots = chartHistory.snapshots.filter(
          (s: any) => s.timestamp < oneDayAgo,
        );
        const downsampledOld = oldSnapshots.filter(
          (_: any, i: number) => i % 5 === 0,
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

    // Clean up old trades periodically (keep last 1000)
    if (this.seenTrades.size > 1000) {
      const arr = Array.from(this.seenTrades);
      this.seenTrades = new Set(arr.slice(-500));
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
    if (this.tradingMode === "live") {
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
      this.executePaperTrade(signal);
    }
  }

  private executePaperTrade(signal: TradeSignal) {
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

    // Apply min size
    if (shares < config.minOrderSize) {
      this.log(
        "info",
        `Trade skipped: size ${shares.toFixed(2)} below minimum ${config.minOrderSize}`,
      );
      this.emit({
        type: "trade-skipped",
        data: { signal, reason: "Below minimum size" },
      });
      return;
    }

    // Apply max trade limit
    const usdValue = shares * signal.price;
    if (usdValue > this.config.risk.maxUsdPerTrade) {
      shares = this.config.risk.maxUsdPerTrade / signal.price;
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
    try {
      // Try to load the CLOB client from our src directory
      const { ClobClientWrapper } = await import(
        path.join(process.cwd(), "src", "polymarket", "clobClient")
      );

      // Load credentials from environment or config
      const envPath = path.join(this.dataDir, ".env");
      let privateKey = process.env.POLY_PRIVATE_KEY;

      // Also check env file
      if (!privateKey && fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        const match = envContent.match(/POLY_PRIVATE_KEY=(.+)/);
        if (match) {
          privateKey = match[1].trim();
        }
      }

      if (!privateKey) {
        throw new Error(
          "No private key configured. Set POLY_PRIVATE_KEY in environment.",
        );
      }

      this.clobClient = new ClobClientWrapper({
        privateKey,
        chainId: 137, // Polygon mainnet
      });

      await this.clobClient.initialize();
      this.log("info", "CLOB client initialized for live trading");
    } catch (e: any) {
      this.log("error", `Failed to initialize CLOB client: ${e.message}`);
      throw e;
    }
  }

  private async executeLiveTrade(signal: TradeSignal): Promise<void> {
    if (!this.clobClient || !this.config) {
      this.log("error", "CLOB client not initialized");
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

      // Apply min size
      if (shares < config.minOrderSize) {
        this.log(
          "info",
          `Trade skipped: size ${shares.toFixed(2)} below minimum ${config.minOrderSize}`,
        );
        this.emit({
          type: "trade-skipped",
          data: { signal, reason: "Below minimum size" },
        });
        return;
      }

      // Apply max trade limit
      const usdValue = shares * signal.price;
      if (usdValue > this.config.risk.maxUsdPerTrade) {
        shares = this.config.risk.maxUsdPerTrade / signal.price;
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
      const orderResult = await this.clobClient.placeOrder({
        tokenId: signal.tokenId,
        side: signal.side,
        size: shares,
        price: limitPrice,
      });

      const latencyMs = Date.now() - startTime;

      if (orderResult.success) {
        this.stats.tradesExecuted++;
        this.stats.lastTradeTime = Date.now();

        const fees = orderResult.fees || shares * limitPrice * 0.001;

        this.log(
          "info",
          `LIVE trade executed: ${signal.side} ${shares.toFixed(2)} @ $${orderResult.avgPrice?.toFixed(4) || limitPrice.toFixed(4)}`,
          {
            orderId: orderResult.orderId,
            filledShares: orderResult.filledShares,
            latencyMs,
          },
        );

        this.emit({
          type: "trade-executed",
          data: {
            signal,
            result: orderResult,
            yourShares: orderResult.filledShares || shares,
            yourPrice: orderResult.avgPrice || limitPrice,
            yourTotal:
              (orderResult.filledShares || shares) *
              (orderResult.avgPrice || limitPrice),
            fees,
            latencyMs,
          },
        });
      } else {
        this.log("error", `LIVE trade failed: ${orderResult.error}`);
        this.emit({
          type: "trade-skipped",
          data: { signal, reason: orderResult.error || "Order failed" },
        });
      }
    } catch (e: any) {
      const latencyMs = Date.now() - startTime;
      this.log("error", `LIVE trade error: ${e.message}`, { latencyMs });
      this.stats.errors.push(e.message);
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
  } | null> {
    // Check if we have a clob client initialized
    if (!this.clobClient) {
      // Try to initialize it
      try {
        await this.initializeClobClient();
      } catch (e) {
        this.log(
          "warn",
          "Cannot fetch live stats - CLOB client not initialized",
        );
        return null;
      }
    }

    if (!this.clobClient) {
      return null;
    }

    try {
      // Get balance from Polymarket
      const balances = await this.clobClient.getBalances();
      const balance = parseFloat(balances.usdc) || 0;

      // Get positions
      const positionsData = await this.clobClient.getPositions();
      const positions = positionsData.positions || [];

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

      // Get trades for statistics
      const tradesData = await this.clobClient.getTrades();
      const trades = tradesData.trades || [];

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
        const assetId = trade.asset_id;
        if (!tradesByAsset.has(assetId)) {
          tradesByAsset.set(assetId, []);
        }
        tradesByAsset.get(assetId)!.push(trade);

        const size = parseFloat(trade.size) || 0;
        const price = parseFloat(trade.price) || 0;
        totalVolume += size * price;

        const feeRate = parseFloat(trade.fee_rate_bps || "0") / 10000;
        totalFees += size * price * feeRate;
      }

      // Calculate realized PnL from closed positions (FIFO)
      let realizedPnl = 0;
      for (const assetTrades of Array.from(tradesByAsset.values())) {
        const sorted = assetTrades.sort(
          (a: any, b: any) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );

        let shares = 0;
        let costBasis = 0;

        for (const trade of sorted) {
          const size = parseFloat(trade.size) || 0;
          const price = parseFloat(trade.price) || 0;
          const isBuy = trade.side === "BUY";

          if (isBuy) {
            costBasis += size * price;
            shares += size;
          } else {
            // Calculate realized PnL on sell
            const avgCost = shares > 0 ? costBasis / shares : 0;
            const pnl = (price - avgCost) * size;
            realizedPnl += pnl;

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
            const proportion = size / shares;
            costBasis -= costBasis * proportion;
            shares -= size;
          }
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

      return {
        balance,
        startingBalance,
        positions,
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
      };
    } catch (e: any) {
      this.log("error", "Failed to fetch live stats", { error: e.message });
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
