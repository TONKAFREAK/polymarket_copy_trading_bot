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
  feesPaid?: number;
}

export interface TradeLogEntry {
  timestamp: number;
  targetTradeTime?: number; // When the target filled the trade
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
  outcome?: string; // YES, NO, Over, Under, team names, etc.
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
  private lastTargetsContent: string = "";
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

    // Scroll keys: arrow keys for activity log, PgUp/PgDn for holdings
    this.screen.key(["up", "k"], () => {
      this.logBox.scroll(-1);
      this.screen.render();
    });

    this.screen.key(["down", "j"], () => {
      this.logBox.scroll(1);
      this.screen.render();
    });

    this.screen.key(["pageup"], () => {
      const targetLog = this.targetBox as unknown as blessed.Widgets.Log;
      targetLog.scroll(-10);
      this.screen.render();
    });

    this.screen.key(["pagedown"], () => {
      const targetLog = this.targetBox as unknown as blessed.Widgets.Log;
      targetLog.scroll(10);
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

    // Suppress network and library noise
    if (
      message.includes("request error") ||
      message.includes("ECONNRESET") ||
      message.includes("ETIMEDOUT") ||
      message.includes("ECONNREFUSED") ||
      message.includes("socket hang up") ||
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
    outcome?: string; // YES, NO, Over, Under, team names, etc.
    // Copy result
    copied: boolean;
    copyError?: string;
    yourShares?: number;
    yourPrice?: number;
    orderId?: string;
    question?: string;
    targetTradeTime?: number; // When target filled the trade
  }): void {
    const targetTotal = entry.targetShares * entry.targetPrice;
    const yourTotal = (entry.yourShares || 0) * (entry.yourPrice || 0);

    this.logs.unshift({
      timestamp: Date.now(),
      targetTradeTime: entry.targetTradeTime,
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
      outcome: entry.outcome,
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
    )}  {yellow-fg}Targets:{/} ${this.stats.targetsCount}  {white-fg}Poll:{/} ${
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
      )} {white-fg}(${this.stats.openPositions ?? 0}){/}`,
      // `{cyan-fg}Portfolio:{/}      ${fmtMoney(portfolioValue)} ${colorPct(
      //   returnPct
      // )}`,
      // `{white-fg}─────────────────────────{/}`,
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
    // Build content string first to check if it changed (prevents flickering)
    const contentLines: string[] = [];
    let newLabel = " 🎯 Targets ";

    // In live or paper mode, show ALL positions
    if (
      (this.stats.mode === "live" || this.stats.mode === "paper") &&
      this.livePositions.length > 0
    ) {
      const labelPrefix = this.stats.mode === "paper" ? "Paper " : "";
      newLabel = ` 📊 ${labelPrefix}Holdings`;

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
        const feesPaid = pos.feesPaid || 0;
        const feeStr = feesPaid > 0 ? `fee - $${feesPaid.toFixed(2)}` : "";

        // Calculate P&L percentage for display
        const costBasis = pos.shares * pos.avgEntryPrice;
        const pnlPercent =
          costBasis > 0
            ? ((pos.currentValue - costBasis) / costBasis) * 100
            : 0;
        const pnlColor = pnlPercent >= 0 ? "green" : "red";
        const pnlSign = pnlPercent >= 0 ? "+" : "";
        const pnlStr = `{${pnlColor}-fg}${pnlSign}${pnlPercent.toFixed(1)}%{/}`;

        // Line 1: Status, Side, Shares, Value, P&L%
        let feesDisplay = "";
        if (feeStr) {
          feesDisplay = ` {white-fg}${feeStr}{/}`;
        }
        contentLines.push(
          `${statusIcon} {${sideColor}-fg}${sideStr}{/} ${sharesStr} ${valueStr} ${pnlStr}${feesDisplay}`
        );

        // Line 2: Market question (full name, wrapped if needed)
        const marketName = pos.market || "Unknown Market";
        contentLines.push(`  {white-fg}${marketName}{/}`);

        // Line 3: Full Token ID
        contentLines.push(`  {white-fg}ID: ${pos.tokenId}{/}`);
      }
    } else {
      // Show targets when no positions
      if (this.targetAddresses.length === 0) {
        contentLines.push("{white-fg}No targets configured{/}");
      } else {
        for (let i = 0; i < this.targetAddresses.length; i++) {
          const addr = this.targetAddresses[i];
          contentLines.push(
            `{yellow-fg}${(i + 1)
              .toString()
              .padStart(2)}.{/} {white-fg}${addr}{/}`
          );
        }
      }
    }

    if (
      this.stats.openOrdersCount !== undefined &&
      this.stats.openOrdersCount > 0
    ) {
      contentLines.push(`{cyan-fg}Open Orders:{/} ${this.stats.openOrdersCount}`);
    }

    // Only update if content actually changed (prevents flickering)
    const newContent = contentLines.join("\n");
    if (newContent !== this.lastTargetsContent) {
      this.lastTargetsContent = newContent;
      this.targetBox.setLabel(newLabel);
      this.targetBox.setContent(newContent);
    }
  }

  private renderStatusBar(): void {
    const lastUpdateStr = this.formatTime(this.stats.lastUpdate);
    const feesStr =
      this.stats.totalFees > 0
        ? `{white-fg}-$${this.stats.totalFees.toFixed(2)}  |  {/}`
        : "{white-fg}$0.00  |  {/}";

    const content =
      `{white-fg}Updated: ${lastUpdateStr}  |  {/}` +
      `{white-fg}Fees: ${feesStr}  |  {/}` +
      `{white-fg}Press 'Q' or Ctrl+C to exit  |  {/}` +
      `{white-fg}Scroll Activity: Up/Down  |  {/}` +
      `{white-fg}Scroll Holdings: PgUp/PgDn{/}`;

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

    // Format activity type with color - include outcome for multi-outcome markets
    let activityIcon: string;
    const outcomeStr = entry.outcome ? ` ${entry.outcome.toUpperCase()}` : "";

    switch (entry.activityType) {
      case "TRADE":
        if (entry.side === "BUY") {
          activityIcon = `{green-fg}BUY${outcomeStr}{/}`;
        } else {
          activityIcon = `{red-fg}SELL${outcomeStr}{/}`;
        }
        break;
      case "REDEEM":
        activityIcon = "{magenta-fg}REDM{/}";
        break;
      case "SPLIT":
        activityIcon = `{cyan-fg}SPLT${outcomeStr}{/}`;
        break;
      case "MERGE":
        activityIcon = `{cyan-fg}MERG${outcomeStr}{/}`;
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
    // For REDEEM, target shares/price from API may be 0, show simplified line
    let line1 = `{white-fg}${time}{/} ${activityIcon} {yellow-fg}TARGET:{/} `;

    if (entry.activityType === "REDEEM") {
      // REDEEM: just show "redeemed" without 0 values
      line1 += `{white-fg}redeemed{/} {magenta-fg}${market}{/}`;
    } else {
      const targetShares = entry.targetShares?.toFixed(1) || "0.0";
      const targetPrice = entry.targetPrice?.toFixed(2) || "0.00";
      const targetTotal = entry.targetTotal?.toFixed(2) || "0.00";
      line1 += `${targetShares.padStart(
        5
      )} @ $${targetPrice} -- $${targetTotal.padStart(5)}`;
      line1 += ` {magenta-fg}${market}{/}`;
    }

    // Add target's fill time and latency if available
    if (entry.targetTradeTime) {
      const targetTime = this.formatTime(entry.targetTradeTime);
      line1 += ` {white-fg}@ ${targetTime}{/}`;

      // Calculate latency (our detection time - target fill time)
      const latencyMs = entry.timestamp - entry.targetTradeTime;
      const latencyStr = this.formatLatency(latencyMs);
      line1 += ` {red-fg}(${latencyStr}){/}`;
    }

    this.logBox.log(line1);

    // Line 2: Our result
    let line2 = `             `;
    if (entry.copied) {
      if (entry.activityType === "REDEEM") {
        // For REDEEM: yourPrice = USDC gained, yourShares = positions redeemed
        const usdcGained = entry.yourPrice || 0;
        const posCount = entry.yourShares?.toFixed(0) || "1";
        if (usdcGained > 0) {
          line2 += `{green-fg}→ REDEEMED:{/} {white-fg}+$${usdcGained.toFixed(
            2
          )}{/} (${posCount} position${Number(posCount) !== 1 ? "s" : ""})`;
        } else {
          // No USDC gained - likely a losing position or already redeemed
          line2 += `{yellow-fg}→ REDEEMED:{/} {white-fg}no payout{/} (${posCount} position${
            Number(posCount) !== 1 ? "s" : ""
          })`;
        }
      } else {
        // For regular trades
        const yourShares = entry.yourShares?.toFixed(1) || "0.0";
        const yourPrice = entry.yourPrice?.toFixed(2) || "0.00";
        const yourTotal = entry.yourTotal?.toFixed(2) || "0.00";
        line2 += `{green-fg}→ COPIED:{/} ${yourShares.padStart(
          5
        )} @ $${yourPrice} -- {white-fg}$${yourTotal.padStart(5)}{/}`;
      }
    } else if (entry.copyError) {
      // Error - clean up common error types for display
      let cleanError = entry.copyError;

      // Detect HTML error pages (Cloudflare/WAF blocks, rate limiting)
      if (cleanError.includes("<!DOCTYPE") || cleanError.includes("<html")) {
        cleanError = "API blocked (rate limited)";
      }
      // Clean up connection errors
      else if (
        cleanError.includes("ECONNRESET") ||
        cleanError.includes("ETIMEDOUT")
      ) {
        cleanError = "connection error (retrying)";
      }
      // Clean up socket errors
      else if (cleanError.includes("socket hang up")) {
        cleanError = "connection dropped";
      }

      const shortError =
        cleanError.length > 35
          ? cleanError.substring(0, 32) + "..."
          : cleanError;
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
    let line = `{white-fg}${time}{/} ${sideIcon}`;

    // Show your order details (primary info)
    if (entry.yourShares !== undefined && entry.yourPrice !== undefined) {
      const yourTotal =
        entry.yourTotal?.toFixed(2) ||
        (entry.yourShares * entry.yourPrice).toFixed(2);
      line += ` ${entry.yourShares
        .toFixed(1)
        .padStart(5)} @ $${entry.yourPrice.toFixed(2)}`;
      line += `-- {white-fg}$${yourTotal.padStart(6)}{/}`;
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

    // Clean up error messages for display
    let cleanMessage = message;
    if (type === "error") {
      if (
        cleanMessage.includes("<!DOCTYPE") ||
        cleanMessage.includes("<html")
      ) {
        cleanMessage = "API blocked (rate limited)";
      } else if (
        cleanMessage.includes("ECONNRESET") ||
        cleanMessage.includes("ETIMEDOUT")
      ) {
        cleanMessage = "Connection error (retrying)";
      } else if (cleanMessage.includes("socket hang up")) {
        cleanMessage = "Connection dropped";
      }
    }

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

    let line = `{white-fg}${time}{/} {${color}-fg}${prefix}{/} ${cleanMessage}`;
    if (details) {
      // Truncate details if too long
      const shortDetails =
        details.length > 35 ? details.substring(0, 32) + "..." : details;
      line += ` {white-fg}| ${shortDetails}{/}`;
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

  private formatLatency(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else {
      const seconds = (ms / 1000).toFixed(2);
      return `${seconds}s`;
    }
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
