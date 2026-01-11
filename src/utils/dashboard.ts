/**
 * CLI Dashboard - Futuristic real-time trading dashboard for the copy trader
 * Clean design with proper layout and no overlapping
 */

import chalk from "chalk";

// ANSI escape codes
const ESC = "\x1B";
const CSI = `${ESC}[`;

// Maximum log entries to keep
const MAX_LOG_ENTRIES = 100;

// Dashboard configuration
const DASHBOARD_CONFIG = {
  headerHeight: 3,
  statsHeight: 10,
  dividerHeight: 2,
  footerHeight: 2,
  minLogLines: 8,
  maxLogLines: 15,
};

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
}

export interface LogEntry {
  timestamp: number;
  type: "trade" | "skip" | "error" | "info" | "profit" | "loss" | "redeem";
  message: string;
  details?: string;
}

export class Dashboard {
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
    };
  }

  /**
   * Start the dashboard
   */
  start(): void {
    this.isRunning = true;
    this.startTime = Date.now();

    // Clear screen and hide cursor
    this.clearScreen();
    this.hideCursor();

    // Initial render
    this.render();

    // Start refresh loop (every 1 second)
    this.refreshInterval = setInterval(() => {
      if (this.isRunning) {
        this.stats.uptime = Date.now() - this.startTime;
        this.render();
      }
    }, 1000);
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
    this.showCursor();
    console.log("\n\n");
  }

  /**
   * Update stats
   */
  updateStats(stats: Partial<DashboardStats>): void {
    this.stats = { ...this.stats, ...stats, lastUpdate: Date.now() };
  }

  /**
   * Add a log entry
   */
  log(entry: LogEntry): void {
    this.logs.unshift(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.pop();
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
    const sideStr = side === "BUY" ? chalk.green("BUY") : chalk.red("SELL");
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
   * Render the dashboard
   */
  private render(): void {
    const width = Math.min(process.stdout.columns || 80, 100);
    const height = process.stdout.rows || 30;

    // Calculate available log space
    const fixedHeight =
      DASHBOARD_CONFIG.headerHeight +
      DASHBOARD_CONFIG.statsHeight +
      DASHBOARD_CONFIG.dividerHeight +
      DASHBOARD_CONFIG.footerHeight;
    const availableLogLines = Math.max(
      DASHBOARD_CONFIG.minLogLines,
      Math.min(DASHBOARD_CONFIG.maxLogLines, height - fixedHeight)
    );

    // Build complete frame
    const lines: string[] = [];

    // Header
    lines.push(...this.renderHeader(width));

    // Stats
    lines.push(...this.renderStats(width));

    // Divider
    lines.push(...this.renderDivider(width));

    // Logs
    lines.push(...this.renderLogs(width, availableLogLines));

    // Footer
    lines.push(...this.renderFooter(width));

    // Move to top and render everything at once
    this.moveCursor(0, 0);

    // Clear each line and write new content
    for (let i = 0; i < lines.length; i++) {
      this.clearLine();
      console.log(lines[i]);
    }

    // Clear any remaining old content
    const totalRendered = lines.length;
    for (let i = totalRendered; i < height; i++) {
      this.clearLine();
      console.log("");
    }
  }

  /**
   * Render header
   */
  private renderHeader(width: number): string[] {
    const lines: string[] = [];

    // Top border with title
    const title = "  POLYMARKET COPY TRADER  ";
    const borderChar = "═";
    const leftPad = Math.floor((width - title.length - 2) / 2);
    const rightPad = width - title.length - leftPad - 2;

    lines.push(
      chalk.cyan("╔") +
        chalk.cyan(borderChar.repeat(leftPad)) +
        chalk.bgCyan.black.bold(title) +
        chalk.cyan(borderChar.repeat(rightPad)) +
        chalk.cyan("╗")
    );

    // Mode and status line
    let modeStr: string;
    let modeIcon: string;
    if (this.stats.mode === "dry-run") {
      modeStr = chalk.bgYellow.black(" DRY RUN ");
      modeIcon = "🔬";
    } else if (this.stats.mode === "paper") {
      modeStr = chalk.bgBlue.white(" PAPER ");
      modeIcon = "📝";
    } else {
      modeStr = chalk.bgRed.white(" LIVE ");
      modeIcon = "🔴";
    }

    const uptimeStr = this.formatUptime(this.stats.uptime);
    const statusContent = `${modeIcon} ${modeStr}  ⏱️  ${chalk.white(
      uptimeStr
    )}  🎯 ${chalk.white(this.stats.targetsCount)} targets  ⚡ ${chalk.white(
      this.stats.pollingInterval
    )}ms`;
    lines.push(
      chalk.cyan("║") +
        " " +
        statusContent +
        this.padToWidth("", width - this.stripAnsi(statusContent).length - 3) +
        chalk.cyan("║")
    );

    return lines;
  }

  /**
   * Render stats section
   */
  private renderStats(width: number): string[] {
    const lines: string[] = [];
    const innerWidth = width - 4;
    const colWidth = Math.floor(innerWidth / 3);

    // Separator
    lines.push(
      chalk.cyan("╠") + chalk.cyan("═".repeat(width - 2)) + chalk.cyan("╣")
    );

    // Calculate values
    const portfolioValue = this.stats.balance + this.stats.positionsValue;
    const returnPct =
      this.stats.startingBalance > 0
        ? ((portfolioValue - this.stats.startingBalance) /
            this.stats.startingBalance) *
          100
        : 0;
    const totalPnl = this.stats.realizedPnl + this.stats.unrealizedPnl;

    // Format helpers with fixed width for alignment
    const formatMoneyVal = (val: number, width: number = 10): string => {
      return ("$" + Math.abs(val).toFixed(2)).padStart(width);
    };

    const formatSignedMoney = (val: number, width: number = 10): string => {
      const sign = val >= 0 ? "+" : "-";
      return (sign + "$" + Math.abs(val).toFixed(2)).padStart(width);
    };

    const colorMoney = (val: number, str: string): string => {
      return val >= 0 ? chalk.green(str) : chalk.red(str);
    };

    const formatPct = (val: number): string => {
      const sign = val >= 0 ? "+" : "";
      const str = `${sign}${val.toFixed(2)}%`;
      return val >= 0 ? chalk.green(str) : chalk.red(str);
    };

    // Row 1: Portfolio Summary
    const row1Col1 = `${chalk.cyan("💰 Balance:")}    ${chalk.white(
      formatMoneyVal(this.stats.balance)
    )}`;
    const row1Col2 = `${chalk.cyan("📊 Positions:")}  ${chalk.white(
      formatMoneyVal(this.stats.positionsValue)
    )} ${chalk.gray(`(${this.stats.openPositions})`)}`;
    const row1Col3 = `${chalk.cyan("📈 Portfolio:")}  ${chalk.white(
      formatMoneyVal(portfolioValue)
    )} ${formatPct(returnPct)}`;
    lines.push(
      this.formatRowFixed(row1Col1, row1Col2, row1Col3, colWidth, innerWidth)
    );

    // Row 2: PnL
    const row2Col1 = `${chalk.cyan("✅ Realized:")}   ${colorMoney(
      this.stats.realizedPnl,
      formatSignedMoney(this.stats.realizedPnl)
    )}`;
    const row2Col2 = `${chalk.cyan("⏳ Unrealized:")} ${colorMoney(
      this.stats.unrealizedPnl,
      formatSignedMoney(this.stats.unrealizedPnl)
    )}`;
    const row2Col3 = `${chalk.cyan("📊 Total PnL:")}  ${colorMoney(
      totalPnl,
      formatSignedMoney(totalPnl)
    )}`;
    lines.push(
      this.formatRowFixed(row2Col1, row2Col2, row2Col3, colWidth, innerWidth)
    );

    // Row 3: Trading Stats & Fees
    const row3Col1 = `${chalk.cyan("🔄 Trades:")}     ${chalk.white(
      this.stats.totalTrades.toString().padStart(10)
    )}`;
    const winRateStr = `${this.stats.winRate.toFixed(1)}%`.padStart(10);
    const winRateColor = this.stats.winRate >= 50 ? chalk.green : chalk.yellow;
    const row3Col2 = `${chalk.cyan("🎯 Win Rate:")}   ${winRateColor(
      winRateStr
    )}`;
    const row3Col3 = `${chalk.cyan("💸 Fees:")}       ${chalk.red(
      "-$" + this.stats.totalFees.toFixed(2)
    )}`;
    lines.push(
      this.formatRowFixed(row3Col1, row3Col2, row3Col3, colWidth, innerWidth)
    );

    return lines;
  }

  /**
   * Format a row with three fixed-width columns
   */
  private formatRowFixed(
    col1: string,
    col2: string,
    col3: string,
    colWidth: number,
    totalWidth: number
  ): string {
    const col1Padded = this.padToWidth(col1, colWidth);
    const col2Padded = this.padToWidth(col2, colWidth);
    const col3Padded = this.padToWidth(col3, totalWidth - colWidth * 2);
    return (
      chalk.cyan("║") +
      " " +
      col1Padded +
      col2Padded +
      col3Padded +
      " " +
      chalk.cyan("║")
    );
  }

  /**
   * Render divider between stats and logs
   */
  private renderDivider(width: number): string[] {
    const lines: string[] = [];
    const title = " 📋 ACTIVITY LOG ";
    const leftPad = Math.floor((width - title.length - 2) / 2);
    const rightPad = width - title.length - leftPad - 2;

    lines.push(
      chalk.cyan("╠") +
        chalk.cyan("═".repeat(leftPad)) +
        chalk.bold.white(title) +
        chalk.cyan("═".repeat(rightPad)) +
        chalk.cyan("╣")
    );

    return lines;
  }

  /**
   * Render logs section
   */
  private renderLogs(width: number, maxLines: number): string[] {
    const lines: string[] = [];
    const innerWidth = width - 4;

    const logsToShow = Math.min(this.logs.length, maxLines);

    for (let i = 0; i < maxLines; i++) {
      if (i < logsToShow) {
        const entry = this.logs[i];
        const line = this.formatLogEntry(entry, innerWidth);
        lines.push(chalk.cyan("║") + " " + line + " " + chalk.cyan("║"));
      } else {
        // Empty line
        lines.push(chalk.cyan("║") + " ".repeat(width - 2) + chalk.cyan("║"));
      }
    }

    return lines;
  }

  /**
   * Format a single log entry
   */
  private formatLogEntry(entry: LogEntry, width: number): string {
    const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const timeStr = chalk.gray(`[${time}]`);

    let icon: string;
    let msgColor: (s: string) => string;

    switch (entry.type) {
      case "trade":
        icon = "📊";
        msgColor = chalk.white;
        break;
      case "skip":
        icon = "⏭️ ";
        msgColor = chalk.yellow;
        break;
      case "error":
        icon = "❌";
        msgColor = chalk.red;
        break;
      case "profit":
        icon = "💰";
        msgColor = chalk.green;
        break;
      case "loss":
        icon = "📉";
        msgColor = chalk.red;
        break;
      case "redeem":
        icon = "🎫";
        msgColor = chalk.magenta;
        break;
      case "info":
      default:
        icon = "ℹ️ ";
        msgColor = chalk.gray;
        break;
    }

    // Format message
    let content = `${timeStr} ${icon} ${msgColor(entry.message)}`;

    if (entry.details) {
      const detailStr = chalk.gray(` │ ${entry.details}`);
      content += detailStr;
    }

    // Pad or truncate to width
    const plainLen = this.stripAnsi(content).length;
    if (plainLen > width) {
      // Need to truncate - this is approximate with ANSI codes
      return (
        content.substring(0, width + (content.length - plainLen) - 3) +
        chalk.gray("...")
      );
    } else {
      return content + " ".repeat(width - plainLen);
    }
  }

  /**
   * Render footer
   */
  private renderFooter(width: number): string[] {
    const lines: string[] = [];

    // Bottom border
    lines.push(
      chalk.cyan("╚") + chalk.cyan("═".repeat(width - 2)) + chalk.cyan("╝")
    );

    // Help text
    const helpText = chalk.gray.italic("  Press Ctrl+C to stop");
    lines.push(helpText);

    return lines;
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  private clearScreen(): void {
    process.stdout.write(`${CSI}2J`);
    process.stdout.write(`${CSI}H`);
  }

  private clearLine(): void {
    process.stdout.write(`${CSI}2K`);
  }

  private hideCursor(): void {
    process.stdout.write(`${CSI}?25l`);
  }

  private showCursor(): void {
    process.stdout.write(`${CSI}?25h`);
  }

  private moveCursor(x: number, y: number): void {
    process.stdout.write(`${CSI}${y + 1};${x + 1}H`);
  }

  private padToWidth(text: string, width: number): string {
    const plainLen = this.stripAnsi(text).length;
    if (plainLen >= width) {
      return text;
    }
    return text + " ".repeat(width - plainLen);
  }

  private stripAnsi(text: string): string {
    return text.replace(/\x1B\[[0-9;]*m/g, "");
  }

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
}

// Singleton instance
let dashboardInstance: Dashboard | null = null;

export function getDashboard(): Dashboard {
  if (!dashboardInstance) {
    dashboardInstance = new Dashboard();
  }
  return dashboardInstance;
}

export function resetDashboard(): void {
  if (dashboardInstance) {
    dashboardInstance.stop();
  }
  dashboardInstance = null;
}
