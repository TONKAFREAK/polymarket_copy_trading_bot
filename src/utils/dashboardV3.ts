/**
 * Dashboard V3 - Professional TUI with focused windows
 * Clean layout, scrollable logs, live data display
 */

import * as blessed from "blessed";
import { setConsoleInterceptCallback } from "./logger";

// Maximum log entries to keep in memory
const MAX_LOG_ENTRIES = 500;

export interface DashboardStats {
  mode: "dry-run" | "paper" | "live";
  balance: number;
  startingBalance: number;
  openPositions: number;
  positionsValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalTrades: number;
  totalFees: number;
  winRate: number;
  uptime: number;
  lastUpdate: number;
  pollingInterval: number;
  targetsCount: number;
  openOrdersCount?: number;
}

export interface LivePosition {
  tokenId: string;
  outcome: string;
  shares: number;
  avgEntryPrice: number;
  currentValue: number;
  market: string;
  isResolved?: boolean;
  isRedeemable?: boolean;
  conditionId?: string;
}

export interface TradeLogEntry {
  timestamp: number;
  type:
    | "copy"
    | "skip"
    | "error"
    | "info"
    | "profit"
    | "loss"
    | "redeem"
    | "target";
  // Trade details
  activityType?: string;
  targetWallet?: string;
  targetShares?: number;
  targetPrice?: number;
  targetTotal?: number;
  yourShares?: number;
  yourPrice?: number;
  yourTotal?: number;
  side?: "BUY" | "SELL";
  marketName?: string;
  tokenId?: string;
  // Copy result
  copied?: boolean;
  copyError?: string;
  // For non-trade logs
  message?: string;
  details?: string;
  question?: string;
}

export class DashboardV3 {
  private screen: blessed.Widgets.Screen;
  private headerBox: blessed.Widgets.BoxElement;
  private statsBox: blessed.Widgets.BoxElement;
  private targetBox: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.Log;
  private statusBar: blessed.Widgets.BoxElement;

  private stats: DashboardStats;
  private logs: TradeLogEntry[] = [];
  private startTime: number;
  private isRunning: boolean = false;
  private refreshInterval: NodeJS.Timeout | null = null;
  private targetAddresses: string[] = [];
  private livePositions: LivePosition[] = [];
  // Cache previous content to prevent flickering
  private lastHeaderContent: string = "";
  private lastStatsContent: string = "";
  private lastStatusBarContent: string = "";
  private positionsNeedRefresh: boolean = true;

  constructor() {
    this.startTime = Date.now();
    this.stats = this.getDefaultStats();

    // Create screen with optimized settings
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Polymarket Copy Trader",
      fullUnicode: true,
      dockBorders: true,
      autoPadding: false,
    });

    // Header - Title bar (fixed height)
    this.headerBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 3,
      tags: true,
      border: { type: "line" },
      style: {
        border: { fg: "blue" },
        fg: "white",
        bg: "black",
      },
    });

    // Stats panel - Left side (fixed dimensions)
    this.statsBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: "50%",
      height: 10,
      tags: true,
      label: " 📊 Portfolio ",
      border: { type: "line" },
      padding: { left: 1, right: 1 },
      style: {
        border: { fg: "cyan" },
        fg: "white",
        bg: "black",
        label: { fg: "cyan", bold: true },
      },
    });

    // Target wallets/Holdings panel - Right side (scrollable)
    this.targetBox = blessed.log({
      parent: this.screen,
      top: 3,
      left: "50%",
      width: "50%",
      height: 10,
      tags: true,
      label: " 🎯 Targets ",
      border: { type: "line" },
      scrollable: true,
      mouse: true,
      keys: true,
      padding: { left: 1, right: 1 },
      scrollbar: {
        ch: "▐",
        style: { fg: "yellow" },
      },
      style: {
        border: { fg: "yellow" },
        fg: "white",
        bg: "black",
        label: { fg: "yellow", bold: true },
      },
    }) as unknown as blessed.Widgets.BoxElement;

    // Activity log - Main area (takes remaining space)
    this.logBox = blessed.log({
      parent: this.screen,
      top: 13,
      left: 0,
      width: "100%",
      height: "100%-16",
      tags: true,
      label: " 📋 Activity Log ",
      border: { type: "line" },
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      padding: { left: 1, right: 1 },
      scrollbar: {
        ch: "▐",
        style: { fg: "cyan" },
        track: { ch: "│", style: { fg: "gray" } },
      },
      style: {
        border: { fg: "green" },
        fg: "white",
        bg: "black",
        label: { fg: "green", bold: true },
      },
    });

    // Status bar
    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 3,
      tags: true,
      border: { type: "line" },
      style: {
        border: { fg: "gray" },
        fg: "gray",
        bg: "black",
      },
    });

    // Handle screen resize
    this.screen.on("resize", () => {
      this.render();
    });

    // Keyboard shortcuts
    this.screen.key(["C-c"], () => {
      process.emit("SIGINT", "SIGINT");
    });

    this.screen.key(["q"], () => {
      process.emit("SIGINT", "SIGINT");
    });

    // Scroll keys for log
    this.screen.key(["up", "k"], () => {
      this.logBox.scroll(-1);
      this.screen.render();
    });

    this.screen.key(["down", "j"], () => {
      this.logBox.scroll(1);
      this.screen.render();
    });

    this.screen.key(["pageup"], () => {
      this.logBox.scroll(-10);
      this.screen.render();
    });

    this.screen.key(["pagedown"], () => {
      this.logBox.scroll(10);
      this.screen.render();
    });
  }

  private getDefaultStats(): DashboardStats {
    return {
      mode: "paper",
      balance: 0,
      startingBalance: 0,
      openPositions: 0,
      positionsValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      totalTrades: 0,
      totalFees: 0,
      winRate: 0,
      uptime: 0,
      lastUpdate: Date.now(),
      pollingInterval: 500,
      targetsCount: 0,
      openOrdersCount: 0,
    };
  }

  /**
   * Set target addresses for display
   */
  setTargets(addresses: string[]): void {
    this.targetAddresses = addresses;
    this.renderTargets();
  }

  /**
   * Set live positions for display (live mode only)
   */
  setPositions(positions: LivePosition[]): void {
    // Check if positions actually changed (avoid unnecessary re-renders)
    const positionsChanged =
      positions.length !== this.livePositions.length ||
      JSON.stringify(positions) !== JSON.stringify(this.livePositions);

    if (positionsChanged) {
      this.livePositions = positions;
      this.stats.openPositions = positions.length;
      this.stats.positionsValue = positions.reduce(
        (sum, p) => sum + p.currentValue,
        0
      );
      this.positionsNeedRefresh = true;
    }
  }

  /**
   * Start the dashboard
   */
  start(): void {
    this.isRunning = true;
    this.startTime = Date.now();
    this.render();

    // Register console intercept to capture library output
    setConsoleInterceptCallback((type: string, message: string) => {
      this.handleInterceptedConsole(type, message);
    });

    // Refresh at 500ms intervals - only update changed content
    this.refreshInterval = setInterval(() => {
      if (this.isRunning) {
        this.stats.uptime = Date.now() - this.startTime;
        this.renderHeader();
        this.renderStats();
        // Only re-render positions when they've changed
        if (this.positionsNeedRefresh) {
          this.renderTargets();
          this.positionsNeedRefresh = false;
        }
        this.renderStatusBar();
        this.screen.render();
      }
    }, 500);
  }

  /**
   * Handle intercepted console output from libraries
   */
  private handleInterceptedConsole(type: string, message: string): void {
    // Parse CLOB client errors to extract meaningful info
    if (message.includes("[CLOB Client] request error")) {
      // Extract the actual error from the JSON - these are already logged by our code
      // Just suppress them to prevent dashboard corruption
      return;
    }

    // Suppress other common library noise
    if (
      message.includes("request error") ||
      message.includes("axios") ||
      message.includes("transitional")
    ) {
      return;
    }

    // Log unexpected console output as info
    if (type === "error") {
      // Only show short error messages
      const shortMsg =
        message.length > 80 ? message.substring(0, 77) + "..." : message;
      this.addInfoLogLine("error", shortMsg);
    }
  }

  /**
   * Stop the dashboard
   */
  stop(): void {
    this.isRunning = false;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    // Clear console intercept
    setConsoleInterceptCallback(() => {});
    this.screen.destroy();
  }

  /**
   * Update stats
   */
  updateStats(stats: Partial<DashboardStats>): void {
    this.stats = { ...this.stats, ...stats, lastUpdate: Date.now() };
  }

  /**
   * Log a target activity with our copy result (main activity log function)
   * Shows what target did AND what we did (or error)
   */
  logTargetActivity(entry: {
    activityType: string; // TRADE, REDEEM, SPLIT, MERGE
    side?: "BUY" | "SELL";
    targetWallet: string;
    targetShares: number;
    targetPrice: number;
    marketName: string;
    // Copy result
    copied: boolean;
    copyError?: string;
    yourShares?: number;
    yourPrice?: number;
    orderId?: string;
    question?: string;
  }): void {
    const targetTotal = entry.targetShares * entry.targetPrice;
    const yourTotal = (entry.yourShares || 0) * (entry.yourPrice || 0);

    this.logs.unshift({
      timestamp: Date.now(),
      type: entry.copied ? "copy" : entry.copyError ? "error" : "skip",
      activityType: entry.activityType,
      side: entry.side,
      targetWallet: entry.targetWallet,
      targetShares: entry.targetShares,
      targetPrice: entry.targetPrice,
      targetTotal,
      yourShares: entry.yourShares,
      yourPrice: entry.yourPrice,
      yourTotal,
      marketName: entry.marketName,
      copied: entry.copied,
      copyError: entry.copyError,
      question: entry.question,
    });

    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.pop();
    }

    this.addActivityLogLine(this.logs[0]);
  }

  /**
   * Log a copy trade (main logging function)
   */
  logCopyTrade(entry: {
    side: "BUY" | "SELL";
    targetWallet: string;
    targetShares: number;
    targetPrice: number;
    yourShares: number;
    yourPrice: number;
    marketName: string;
    success: boolean;
    orderId?: string;
  }): void {
    // Use the new enhanced logging
    this.logTargetActivity({
      activityType: "TRADE",
      side: entry.side,
      targetWallet: entry.targetWallet,
      targetShares: entry.targetShares,
      targetPrice: entry.targetPrice,
      marketName: entry.marketName,
      copied: entry.success,
      yourShares: entry.yourShares,
      yourPrice: entry.yourPrice,
      orderId: entry.orderId,
    });
  }

  /**
   * Log a trade execution (simplified interface compatible with Dashboard)
   */
  logTrade(
    side: "BUY" | "SELL",
    shares: number,
    price: number,
    market: string,
    _orderId: string
  ): void {
    this.logs.unshift({
      timestamp: Date.now(),
      type: "copy",
      activityType: "TRADE",
      side,
      yourShares: shares,
      yourPrice: price,
      yourTotal: shares * price,
      marketName: market,
    });

    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.pop();
    }

    this.addTradeLogLine(this.logs[0]);
  }

  /**
   * Log a skipped trade
   */
  logSkip(reason: string, market?: string): void {
    this.logs.unshift({
      timestamp: Date.now(),
      type: "skip",
      message: reason,
      marketName: market,
    });

    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.pop();
    }

    this.addInfoLogLine("skip", `Skipped: ${reason}`, market);
  }

  /**
   * Log an error
   */
  logError(message: string, details?: string): void {
    this.logs.unshift({
      timestamp: Date.now(),
      type: "error",
      message,
      details,
    });

    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.pop();
    }

    this.addInfoLogLine("error", message, details);
  }

  /**
   * Log info message
   */
  logInfo(message: string, details?: string): void {
    this.logs.unshift({
      timestamp: Date.now(),
      type: "info",
      message,
      details,
    });

    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.pop();
    }

    this.addInfoLogLine("info", message, details);
  }

  /**
   * Log profit
   */
  logProfit(amount: number, market: string): void {
    this.addInfoLogLine("profit", `+$${amount.toFixed(2)} Profit`, market);
  }

  /**
   * Log loss
   */
  logLoss(amount: number, market: string): void {
    this.addInfoLogLine(
      "loss",
      `-$${Math.abs(amount).toFixed(2)} Loss`,
      market
    );
  }

  /**
   * Log redeem
   */
  logRedeem(market: string, pnl: number): void {
    const pnlStr =
      pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    this.addInfoLogLine("redeem", `Redeemed: ${pnlStr}`, market);
  }

  // ========================================
  // PRIVATE RENDER METHODS
  // ========================================

  private render(): void {
    this.renderHeader();
    this.renderStats();
    this.renderTargets();
    this.renderStatusBar();
    this.screen.render();
  }

  private renderHeader(): void {
    let modeTag: string;

    switch (this.stats.mode) {
      case "dry-run":
        modeTag = "{yellow-bg}{black-fg} DRY RUN {/}";
        break;
      case "paper":
        modeTag = "{blue-bg}{white-fg} PAPER {/}";
        break;
      case "live":
        modeTag = "{red-bg}{white-fg} LIVE {/}";
        break;
    }

    const uptimeStr = this.formatDuration(this.stats.uptime);
    const title = "{bold}{cyan-fg}POLYMARKET COPY TRADER{/}";
    const status = `${modeTag}  {cyan-fg}Uptime:{/} ${uptimeStr.padEnd(
      10
    )}  {yellow-fg}Targets:{/} ${this.stats.targetsCount}  {gray-fg}Poll:{/} ${
      this.stats.pollingInterval
    }ms`;

    const content = `{center}${title}{/center}\n{center}${status}{/center}`;

    // Only update if content changed (prevents flickering)
    if (content !== this.lastHeaderContent) {
      this.lastHeaderContent = content;
      this.headerBox.setContent(content);
    }
  }

  private renderStats(): void {
    //const portfolioValue = this.stats.balance + this.stats.positionsValue;
    // const returnPct =
    //   this.stats.startingBalance > 0
    //     ? ((portfolioValue - this.stats.startingBalance) /
    //         this.stats.startingBalance) *
    //       100
    //     : 0;
    // const totalPnl = this.stats.realizedPnl + this.stats.unrealizedPnl;

    const fmtMoney = (v: number) => {
      const str = `$${Math.abs(v).toFixed(2)}`;
      return str.padStart(10);
    };
    // const fmtSignedMoney = (v: number) => {
    //   const sign = v >= 0 ? "+" : "-";
    //   return `${sign}$${Math.abs(v).toFixed(2)}`.padStart(11);
    // };
    // const colorMoney = (v: number) => {
    //   const str = fmtSignedMoney(v);
    //   return v >= 0 ? `{green-fg}${str}{/}` : `{red-fg}${str}{/}`;
    // };
    // const colorPct = (v: number) => {
    //   const sign = v >= 0 ? "+" : "-";
    //   const str = `${sign}${Math.abs(v).toFixed(1)}%`;
    //   return v >= 0 ? `{green-fg}${str}{/}` : `{red-fg}${str}{/}`;
    // };

    // Fixed-width layout using simple ASCII labels (no emojis for alignment)
    const lines = [
      `{cyan-fg}Cash Balance:{/}   ${fmtMoney(this.stats.balance)}`,
      `{cyan-fg}Positions:{/}      ${fmtMoney(
        this.stats.positionsValue
      )} {gray-fg}(${this.stats.openPositions}){/}`,
      // `{cyan-fg}Portfolio:{/}      ${fmtMoney(portfolioValue)} ${colorPct(
      //   returnPct
      // )}`,
      // `{gray-fg}─────────────────────────{/}`,
      // `{cyan-fg}Realized PnL:{/}   ${colorMoney(this.stats.realizedPnl)}`,
      // `{cyan-fg}Unrealized:{/}     ${colorMoney(this.stats.unrealizedPnl)}`,
      // `{cyan-fg}Total PnL:{/}      ${colorMoney(totalPnl)}`,
    ];

    const content = lines.join("\n");

    // Only update if content changed (prevents flickering)
    if (content !== this.lastStatsContent) {
      this.lastStatsContent = content;
      this.statsBox.setContent(content);
    }
  }

  private renderTargets(): void {
    // Cast to log for proper scrollable content
    const targetLog = this.targetBox as unknown as blessed.Widgets.Log;

    // Clear and rebuild content
    targetLog.setContent("");

    // In live or paper mode, show ALL positions
    if (
      (this.stats.mode === "live" || this.stats.mode === "paper") &&
      this.livePositions.length > 0
    ) {
      const labelPrefix = this.stats.mode === "paper" ? "Paper " : "";
      this.targetBox.setLabel(
        ` 📊 ${labelPrefix}Holdings` //(${this.livePositions.length})
      );

      // Show ALL positions with full details
      for (const pos of this.livePositions) {
        // Status indicator
        let statusIcon = "{cyan-fg}●{/}"; // Open/active
        if (pos.isRedeemable) {
          statusIcon = "{green-fg}✓{/}"; // Redeemable (won)
        } else if (pos.isResolved) {
          statusIcon = "{yellow-fg}○{/}"; // Lost
        }

        // Side color (YES=green, NO=red)
        const isYes =
          pos.outcome.toUpperCase().startsWith("Y") ||
          pos.outcome.toUpperCase().startsWith("U");
        const sideColor = isYes ? "green" : "red";
        const sideStr = isYes ? "YES" : "NO ";

        // Format shares and value
        const sharesStr = pos.shares.toFixed(1).padStart(6);
        const valueStr = `$${pos.currentValue.toFixed(2)}`.padStart(8);

        // Line 1: Status, Side, Shares, Value
        targetLog.log(
          `${statusIcon} {${sideColor}-fg}${sideStr}{/} ${sharesStr} ${valueStr}`
        );

        // Line 2: Market question (full name, wrapped if needed)
        const marketName = pos.market || "Unknown Market";
        targetLog.log(`  {white-fg}${marketName}{/}`);
      }

      // Legend at bottom
      // targetLog.log(`{gray-fg}─────────────────────────────────{/}`);
      // targetLog.log(
      //   `{cyan-fg}●{/}Open {green-fg}✓{/}Redeemable {yellow-fg}○{/}Lost`
      // );
    } else {
      // Show targets when no positions
      this.targetBox.setLabel(" 🎯 Targets ");

      if (this.targetAddresses.length === 0) {
        targetLog.log("{gray-fg}No targets configured{/}");
      } else {
        for (let i = 0; i < this.targetAddresses.length; i++) {
          const addr = this.targetAddresses[i];
          //const shortAddr = `${addr.substring(0, 8)}...${addr.slice(-6)}`;
          targetLog.log(
            `{yellow-fg}${(i + 1)
              .toString()
              .padStart(2)}.{/} {white-fg}${addr}{/}`
          );
        }
      }
    }

    // // Add trading stats at the bottom
    // targetLog.log(`{gray-fg}─────────────────────────────────{/}`);
    // targetLog.log(
    //   `{cyan-fg}Trades:{/} ${String(this.stats.totalTrades).padStart(
    //     4
    //   )}  {cyan-fg}Win:{/} ${this.stats.winRate.toFixed(1).padStart(5)}%`
    // );

    if (
      this.stats.openOrdersCount !== undefined &&
      this.stats.openOrdersCount > 0
    ) {
      targetLog.log(`{cyan-fg}Open Orders:{/} ${this.stats.openOrdersCount}`);
    }
  }

  private renderStatusBar(): void {
    const lastUpdateStr = this.formatTime(this.stats.lastUpdate);
    const feesStr =
      this.stats.totalFees > 0
        ? `{white-fg}-$${this.stats.totalFees.toFixed(2)}{/}`
        : "{white-fg}$0.00  |  {/}";

    const content =
      `{white-fg}Updated: ${lastUpdateStr}  |  {/}` +
      `{white-fg}Fees: ${feesStr}  |  {/}` +
      `{white-fg}Press 'Q' or Ctrl+C to exit  |  {/}` +
      `{white-fg}Scroll: Up/Down or PgUp/PgDn{/}`;

    // Only update if content changed (prevents flickering)
    if (content !== this.lastStatusBarContent) {
      this.lastStatusBarContent = content;
      this.statusBar.setContent(content);
    }
  }

  /**
   * Add enhanced activity log line showing target action AND our copy result
   */
  private addActivityLogLine(entry: TradeLogEntry): void {
    const time = this.formatTime(entry.timestamp);

    // Format activity type with color
    let activityIcon: string;
    switch (entry.activityType) {
      case "TRADE":
        activityIcon =
          entry.side === "BUY" ? "{green-fg}BUY {/}" : "{red-fg}SELL{/}";
        break;
      case "REDEEM":
        activityIcon = "{magenta-fg}REDM{/}";
        break;
      case "SPLIT":
        activityIcon = "{cyan-fg}SPLT{/}";
        break;
      case "MERGE":
        activityIcon = "{cyan-fg}MERG{/}";
        break;
      default:
        activityIcon = "{white-fg}    {/}";
    }

    // Format market name - use marketName field, fallback to question or Unknown
    if (entry.activityType === "REDEEM" && entry.question) {
      entry.marketName = entry.question;
    }
    let market = entry.marketName || entry.question || "Unknown";

    // Line 1: Target's action
    const targetShares = entry.targetShares?.toFixed(1) || "0.0";
    const targetPrice = entry.targetPrice?.toFixed(2) || "0.00";
    const targetTotal = entry.targetTotal?.toFixed(2) || "0.00";

    let line1 = `{gray-fg}${time}{/} ${activityIcon} {yellow-fg}TARGET:{/} `;
    line1 += `${targetShares.padStart(
      5
    )} @ $${targetPrice} -- $${targetTotal.padStart(5)}`;
    line1 += ` {magenta-fg}${market}{/}`;

    this.logBox.log(line1);

    // Line 2: Our result
    let line2 = `             `;
    if (entry.copied) {
      if (entry.activityType === "REDEEM") {
        // For REDEEM: yourPrice = USDC gained, yourShares = positions redeemed
        const usdcGained = entry.yourPrice?.toFixed(2) || "0.00";
        const posCount = entry.yourShares?.toFixed(0) || "1";
        line2 += `{green-fg}→ REDEEMED:{/} {white-fg}+$${usdcGained}{/} (${posCount} position${
          Number(posCount) !== 1 ? "s" : ""
        })`;
      } else {
        // For regular trades
        const yourShares = entry.yourShares?.toFixed(1) || "0.0";
        const yourPrice = entry.yourPrice?.toFixed(2) || "0.00";
        const yourTotal = entry.yourTotal?.toFixed(2) || "0.00";
        line2 += `{green-fg}→ COPIED:{/} ${yourShares.padStart(
          5
        )}@$${yourPrice}={white-fg}$${yourTotal.padStart(5)}{/}`;
      }
    } else if (entry.copyError) {
      // Error
      const shortError =
        entry.copyError.length > 35
          ? entry.copyError.substring(0, 32) + "..."
          : entry.copyError;
      line2 += `{red-fg}→ ERROR:{/} ${shortError}`;
    } else {
      // Skipped
      line2 += `{yellow-fg}→ SKIPPED{/}`;
    }

    this.logBox.log(line2);
    this.screen.render();
  }

  private addTradeLogLine(entry: TradeLogEntry): void {
    const time = this.formatTime(entry.timestamp);
    const sideIcon =
      entry.side === "BUY" ? "{green-fg}BUY {/}" : "{red-fg}SELL{/}";

    // Format market name with fixed width
    let market = entry.marketName || "Unknown";
    if (market.length > 30) {
      market = market.substring(0, 27) + "...";
    }

    // Build structured log line - simpler format for alignment
    let line = `{gray-fg}${time}{/} ${sideIcon}`;

    // Show your order details (primary info)
    if (entry.yourShares !== undefined && entry.yourPrice !== undefined) {
      const yourTotal =
        entry.yourTotal?.toFixed(2) ||
        (entry.yourShares * entry.yourPrice).toFixed(2);
      line += ` ${entry.yourShares
        .toFixed(1)
        .padStart(5)}@$${entry.yourPrice.toFixed(2)}`;
      line += `={white-fg}$${yourTotal.padStart(6)}{/}`;
    }

    // Show market name
    line += ` {magenta-fg}${market}{/}`;

    this.logBox.log(line);
    this.screen.render();
  }

  private addInfoLogLine(
    type: string,
    message: string,
    details?: string
  ): void {
    const time = this.formatTime(Date.now());

    let prefix: string;
    let color: string;

    switch (type) {
      case "skip":
        prefix = "SKIP";
        color = "yellow";
        break;
      case "error":
        prefix = "ERR ";
        color = "red";
        break;
      case "profit":
        prefix = "WIN ";
        color = "green";
        break;
      case "loss":
        prefix = "LOSS";
        color = "red";
        break;
      case "redeem":
        prefix = "REDM";
        color = "magenta";
        break;
      default:
        prefix = "INFO";
        color = "white";
    }

    let line = `{gray-fg}${time}{/} {${color}-fg}${prefix}{/} ${message}`;
    if (details) {
      // Truncate details if too long
      const shortDetails =
        details.length > 35 ? details.substring(0, 32) + "..." : details;
      line += ` {gray-fg}| ${shortDetails}{/}`;
    }

    this.logBox.log(line);
    this.screen.render();
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
}

// Singleton instance
let dashboardV3Instance: DashboardV3 | null = null;

export function getDashboardV3(): DashboardV3 {
  if (!dashboardV3Instance) {
    dashboardV3Instance = new DashboardV3();
  }
  return dashboardV3Instance;
}

export function resetDashboardV3(): void {
  if (dashboardV3Instance) {
    dashboardV3Instance.stop();
  }
  dashboardV3Instance = null;
}
