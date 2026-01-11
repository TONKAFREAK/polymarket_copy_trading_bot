/**
 * CLI Dashboard V2 - Modern TUI using blessed library
 * Better alignment, less flickering, proper layout
 */

import * as blessed from "blessed";

// Maximum log entries to keep
const MAX_LOG_ENTRIES = 100;

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

export interface LogEntry {
  timestamp: number;
  type: "trade" | "skip" | "error" | "info" | "profit" | "loss" | "redeem";
  message: string;
  details?: string;
}

export class DashboardV2 {
  private screen: blessed.Widgets.Screen;
  private headerBox: blessed.Widgets.BoxElement;
  private statsBox: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.Log;
  private footerBox: blessed.Widgets.BoxElement;
  
  private stats: DashboardStats;
  private logs: LogEntry[] = [];
  private startTime: number;
  private isRunning: boolean = false;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startTime = Date.now();
    this.stats = {
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

    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Polymarket Copy Trader",
      fullUnicode: true,
    });

    // Create header
    this.headerBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 3,
      tags: true,
      border: { type: "line" },
      style: {
        border: { fg: "cyan" },
        fg: "white",
      },
    });

    // Create stats box
    this.statsBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: "100%",
      height: 8,
      tags: true,
      border: { type: "line" },
      style: {
        border: { fg: "cyan" },
        fg: "white",
      },
    });

    // Create log area
    this.logBox = blessed.log({
      parent: this.screen,
      top: 11,
      left: 0,
      width: "100%",
      height: "100%-14",
      tags: true,
      border: { type: "line" },
      label: " 📋 Activity Log ",
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: "█",
        style: { fg: "cyan" },
      },
      style: {
        border: { fg: "cyan" },
        fg: "white",
        label: { fg: "white", bold: true },
      },
    });

    // Create footer
    this.footerBox = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: {
        fg: "gray",
      },
    });

    // Handle resize
    this.screen.on("resize", () => {
      this.render();
    });

    // Handle exit keys
    this.screen.key(["C-c"], () => {
      // Don't exit directly - let the main process handle it
      process.emit("SIGINT", "SIGINT");
    });
  }

  /**
   * Start the dashboard
   */
  start(): void {
    this.isRunning = true;
    this.startTime = Date.now();

    // Initial render
    this.render();

    // Start refresh loop (every 500ms for smooth updates)
    this.refreshInterval = setInterval(() => {
      if (this.isRunning) {
        this.stats.uptime = Date.now() - this.startTime;
        this.render();
      }
    }, 500);
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
    this.screen.destroy();
  }

  /**
   * Update stats
   */
  updateStats(stats: Partial<DashboardStats>): void {
    this.stats = { ...this.stats, ...stats, lastUpdate: Date.now() };
    if (this.isRunning) {
      this.renderStats();
    }
  }

  /**
   * Add a log entry
   */
  log(entry: LogEntry): void {
    this.logs.unshift(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.pop();
    }
    
    if (this.isRunning) {
      this.addLogLine(entry);
    }
  }

  /**
   * Log a trade execution
   */
  logTrade(
    side: "BUY" | "SELL",
    shares: number,
    price: number,
    market: string,
    _orderId: string
  ): void {
    const sideStr = side === "BUY" ? "{green-fg}BUY{/}" : "{red-fg}SELL{/}";
    this.log({
      timestamp: Date.now(),
      type: "trade",
      message: `${sideStr} ${shares.toFixed(2)} @ $${price.toFixed(4)}`,
      details: market.length > 35 ? `${market.substring(0, 35)}...` : market,
    });
  }

  /**
   * Log a skipped trade
   */
  logSkip(reason: string, market?: string): void {
    this.log({
      timestamp: Date.now(),
      type: "skip",
      message: `Skipped: ${reason}`,
      details: market
        ? market.length > 40
          ? `${market.substring(0, 40)}...`
          : market
        : undefined,
    });
  }

  /**
   * Log an error
   */
  logError(message: string, details?: string): void {
    this.log({
      timestamp: Date.now(),
      type: "error",
      message: `Error: ${message}`,
      details,
    });
  }

  /**
   * Log info
   */
  logInfo(message: string, details?: string): void {
    this.log({
      timestamp: Date.now(),
      type: "info",
      message,
      details,
    });
  }

  /**
   * Log profit
   */
  logProfit(amount: number, market: string): void {
    this.log({
      timestamp: Date.now(),
      type: "profit",
      message: `+$${amount.toFixed(2)} Profit`,
      details: market,
    });
  }

  /**
   * Log loss
   */
  logLoss(amount: number, market: string): void {
    this.log({
      timestamp: Date.now(),
      type: "loss",
      message: `-$${Math.abs(amount).toFixed(2)} Loss`,
      details: market,
    });
  }

  /**
   * Log redeem activity
   */
  logRedeem(market: string, pnl: number): void {
    this.log({
      timestamp: Date.now(),
      type: "redeem",
      message: `Redeemed: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
      details: market,
    });
  }

  /**
   * Render the entire dashboard
   */
  private render(): void {
    this.renderHeader();
    this.renderStats();
    this.renderFooter();
    this.screen.render();
  }

  /**
   * Render header
   */
  private renderHeader(): void {
    let modeStr: string;
    let modeIcon: string;
    
    if (this.stats.mode === "dry-run") {
      modeStr = "{yellow-bg}{black-fg} DRY RUN {/}";
      modeIcon = "🔬";
    } else if (this.stats.mode === "paper") {
      modeStr = "{blue-bg}{white-fg} PAPER {/}";
      modeIcon = "📝";
    } else {
      modeStr = "{red-bg}{white-fg} LIVE {/}";
      modeIcon = "🔴";
    }

    const uptimeStr = this.formatUptime(this.stats.uptime);
    
    const title = "{bold}{cyan-fg}═══════════════════════  POLYMARKET COPY TRADER  ═══════════════════════{/}";
    const statusLine = `${modeIcon} ${modeStr}  ⏱️  ${uptimeStr}  🎯 ${this.stats.targetsCount} targets  ⚡ ${this.stats.pollingInterval}ms`;
    
    this.headerBox.setContent(`{center}${title}{/center}\n{center}${statusLine}{/center}`);
  }

  /**
   * Render stats section
   */
  private renderStats(): void {
    const portfolioValue = this.stats.balance + this.stats.positionsValue;
    const returnPct =
      this.stats.startingBalance > 0
        ? ((portfolioValue - this.stats.startingBalance) / this.stats.startingBalance) * 100
        : 0;
    const totalPnl = this.stats.realizedPnl + this.stats.unrealizedPnl;

    // Format helpers
    const formatMoney = (val: number): string => `$${Math.abs(val).toFixed(2)}`;
    const formatSignedMoney = (val: number): string => {
      const sign = val >= 0 ? "+" : "-";
      return `${sign}$${Math.abs(val).toFixed(2)}`;
    };
    const colorMoney = (val: number): string => {
      const str = formatSignedMoney(val);
      return val >= 0 ? `{green-fg}${str}{/}` : `{red-fg}${str}{/}`;
    };
    const formatPct = (val: number): string => {
      const sign = val >= 0 ? "+" : "";
      const str = `${sign}${val.toFixed(2)}%`;
      return val >= 0 ? `{green-fg}${str}{/}` : `{red-fg}${str}{/}`;
    };
    const winRateColor = (val: number): string => {
      const str = `${val.toFixed(1)}%`;
      return val >= 50 ? `{green-fg}${str}{/}` : `{yellow-fg}${str}{/}`;
    };

    // Build stats content with fixed-width columns
    const col1W = 26;
    const col2W = 28;
    // col3 uses remaining width

    const pad = (s: string, w: number): string => {
      // Strip blessed tags for length calculation
      const plainLen = s.replace(/\{[^}]+\}/g, "").length;
      const padding = Math.max(0, w - plainLen);
      return s + " ".repeat(padding);
    };

    // Row 1: Portfolio Summary
    const row1Col1 = `{cyan-fg}💰 Balance:{/}     ${formatMoney(this.stats.balance)}`;
    const row1Col2 = `{cyan-fg}📊 Positions:{/}   ${formatMoney(this.stats.positionsValue)} {gray-fg}(${this.stats.openPositions}){/}`;
    const row1Col3 = `{cyan-fg}📈 Portfolio:{/}   ${formatMoney(portfolioValue)} ${formatPct(returnPct)}`;
    
    // Row 2: PnL
    const row2Col1 = `{cyan-fg}✅ Realized:{/}    ${colorMoney(this.stats.realizedPnl)}`;
    const row2Col2 = `{cyan-fg}⏳ Unrealized:{/}  ${colorMoney(this.stats.unrealizedPnl)}`;
    const row2Col3 = `{cyan-fg}📊 Total PnL:{/}   ${colorMoney(totalPnl)}`;

    // Row 3: Trading Stats
    const row3Col1 = `{cyan-fg}🔄 Trades:{/}      ${this.stats.totalTrades}`;
    const row3Col2 = `{cyan-fg}🎯 Win Rate:{/}    ${winRateColor(this.stats.winRate)}`;
    const row3Col3 = `{cyan-fg}💸 Fees:{/}        {red-fg}-$${this.stats.totalFees.toFixed(2)}{/}`;

    // Row 4: Open orders (for live mode)
    const row4Col1 = this.stats.openOrdersCount !== undefined 
      ? `{cyan-fg}📋 Open Orders:{/} ${this.stats.openOrdersCount}`
      : "";
    const row4Col2 = "";
    const row4Col3 = `{gray-fg}Last update: ${this.formatTime(this.stats.lastUpdate)}{/}`;

    const content = [
      pad(row1Col1, col1W) + pad(row1Col2, col2W) + row1Col3,
      pad(row2Col1, col1W) + pad(row2Col2, col2W) + row2Col3,
      pad(row3Col1, col1W) + pad(row3Col2, col2W) + row3Col3,
      pad(row4Col1, col1W) + pad(row4Col2, col2W) + row4Col3,
    ].join("\n");

    this.statsBox.setContent(content);
  }

  /**
   * Add a log line to the log box
   */
  private addLogLine(entry: LogEntry): void {
    const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    
    let icon: string;
    let msgColor: string;

    switch (entry.type) {
      case "trade":
        icon = "📊";
        msgColor = "white";
        break;
      case "skip":
        icon = "⏭️ ";
        msgColor = "yellow";
        break;
      case "error":
        icon = "❌";
        msgColor = "red";
        break;
      case "profit":
        icon = "💰";
        msgColor = "green";
        break;
      case "loss":
        icon = "📉";
        msgColor = "red";
        break;
      case "redeem":
        icon = "🎫";
        msgColor = "magenta";
        break;
      case "info":
      default:
        icon = "ℹ️ ";
        msgColor = "gray";
        break;
    }

    let logLine = `{gray-fg}[${time}]{/} ${icon} {${msgColor}-fg}${entry.message}{/}`;
    if (entry.details) {
      logLine += ` {gray-fg}│ ${entry.details}{/}`;
    }

    this.logBox.log(logLine);
    this.screen.render();
  }

  /**
   * Render footer
   */
  private renderFooter(): void {
    this.footerBox.setContent("  Press Ctrl+C to stop");
  }

  /**
   * Format uptime
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format time for display
   */
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
let dashboardV2Instance: DashboardV2 | null = null;

export function getDashboardV2(): DashboardV2 {
  if (!dashboardV2Instance) {
    dashboardV2Instance = new DashboardV2();
  }
  return dashboardV2Instance;
}

export function resetDashboardV2(): void {
  if (dashboardV2Instance) {
    dashboardV2Instance.stop();
  }
  dashboardV2Instance = null;
}
