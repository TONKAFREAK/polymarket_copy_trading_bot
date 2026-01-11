/**
 * Run command - start the copy trading bot
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getConfigManager } from "../config";
import { getEnvConfig, validateEnvConfig, ensureDataDir } from "../config/env";
import { getStateManager, StateManager } from "../copier/state";
import { createWatcher } from "../copier/watcher";
import { createExecutor, Executor } from "../copier/executor";
import { createRiskManager } from "../copier/risk";
import { getPaperTradingManager } from "../copier/paperTrading";
import { TradeSignal, AppConfig } from "../copier/types";
import {
  getLogger,
  logError,
  enableDashboardMode,
  disableDashboardMode,
} from "../utils/logger";
// Use V3 dashboard (blessed-based with improved UI)
import {
  DashboardV3,
  getDashboardV3,
  LivePosition,
} from "../utils/dashboardV3";
import { Dashboard, getDashboard } from "../utils/dashboard";
import { getGammaApiClient } from "../polymarket/gammaApi";

const logger = getLogger();

export function createRunCommand(): Command {
  const command = new Command("run")
    .description("Start the copy trading bot")
    .option("-i, --interval <ms>", "Polling interval in milliseconds")
    .option("-d, --dry-run", "Enable dry-run mode (no real trades)")
    .option("--no-dry-run", "Disable dry-run mode (live trading)")
    .option("-v, --verbose", "Enable verbose logging")
    .option("--no-dashboard", "Disable the live dashboard UI")
    .action(async (options) => {
      // Validate environment
      const env = getEnvConfig();
      ensureDataDir(env.dataDir);

      // Get configuration
      const configManager = getConfigManager(env.dataDir);
      const config = configManager.getConfig();

      // Apply command-line overrides
      if (options.interval) {
        config.polling.intervalMs = parseInt(options.interval, 10);
      }
      if (options.dryRun !== undefined) {
        config.risk.dryRun = options.dryRun;
      }

      // Validate environment for live trading
      const validation = validateEnvConfig(env);
      if (!validation.valid && !config.risk.dryRun) {
        console.log(chalk.red("\n❌ Environment validation failed:"));
        validation.errors.forEach((err) => {
          console.log(chalk.red(`  • ${err}`));
        });
        console.log(
          chalk.yellow(
            "\nPlease fix the errors in your .env file or use --dry-run mode."
          )
        );
        process.exit(1);
      }

      // Check if we have targets
      if (config.targets.length === 0) {
        console.log(chalk.yellow("⚠️  No targets configured!"));
        console.log(chalk.gray("Add targets with: pmcopy targets add 0x..."));
        process.exit(1);
      }

      // Determine if we should use the dashboard
      const useDashboard = options.dashboard !== false && !options.verbose;

      if (!useDashboard) {
        // Display configuration in non-dashboard mode
        console.log(chalk.bold.cyan("\n🚀 Polymarket Copy Trader\n"));
        displayConfig(config);
      }

      // Show warning for live trading (not paper, not dry-run)
      if (!config.risk.dryRun && !env.paperTrading) {
        console.log(chalk.bgRed.white.bold("\n ⚠️  LIVE TRADING MODE "));
        console.log(
          chalk.red("Real money will be used. Press Ctrl+C to abort.\n")
        );
        await countdown(5);
      }

      // Enable dashboard mode early to intercept library console output
      if (useDashboard) {
        enableDashboardMode();
      }

      // Initialize components
      const spinner = ora("Initializing components...").start();

      // Dashboard can be either V3 (blessed) or V1 (chalk)
      let dashboardV3: DashboardV3 | null = null;
      let dashboard: Dashboard | null = null;
      const useV3Dashboard = true; // Use new blessed-based dashboard

      // Gamma API for fetching market names
      const gammaApi = getGammaApiClient();

      try {
        // State manager
        const stateManager = getStateManager();
        await stateManager.initialize(config.targets);

        // Risk manager
        const riskManager = createRiskManager(config);

        // Executor
        const executor = createExecutor(
          config.trading,
          config.risk,
          riskManager
        );
        await executor.initialize();

        // Get paper trading manager if enabled
        const paperTradingManager = env.paperTrading
          ? getPaperTradingManager(env.dataDir, env.paperStartingBalance)
          : null;

        // Initialize dashboard if enabled
        if (useDashboard) {
          // Try to use V3 dashboard (blessed-based), fall back to V1 if issues
          if (useV3Dashboard) {
            try {
              dashboardV3 = getDashboardV3();
              // Set target addresses for display
              dashboardV3.setTargets(config.targets);
            } catch {
              // Fall back to old dashboard
              dashboard = getDashboard();
            }
          } else {
            dashboard = getDashboard();
          }

          // Set initial stats
          const mode = config.risk.dryRun
            ? "dry-run"
            : env.paperTrading
            ? "paper"
            : "live";

          // Calculate initial positions value
          let initialPositionsValue = 0;
          let initialOpenPositions = 0;
          let liveBalance = 0;
          let liveOpenOrdersCount = 0;

          if (paperTradingManager) {
            const positions = paperTradingManager.getPositions();
            Object.values(positions).forEach((pos) => {
              if (!pos.settled && pos.shares > 0) {
                initialPositionsValue +=
                  (pos.currentPrice || pos.avgEntryPrice) * pos.shares;
                initialOpenPositions++;
              }
            });
          } else if (mode === "live") {
            // Fetch live stats from CLOB client
            try {
              const liveStats = await executor.getLiveStats();
              liveBalance = liveStats.balance;
              liveOpenOrdersCount = liveStats.openOrdersCount;
            } catch (e) {
              logger.error("Failed to fetch initial live stats", {
                error: (e as Error).message,
              });
            }
          }

          const initialStats = paperTradingManager
            ? {
                mode: mode as "dry-run" | "paper" | "live",
                balance: paperTradingManager.getBalance(),
                startingBalance: paperTradingManager.getStats().startingBalance,
                openPositions: initialOpenPositions,
                positionsValue: initialPositionsValue,
                unrealizedPnl:
                  paperTradingManager.getStats().totalUnrealizedPnl,
                realizedPnl: paperTradingManager.getStats().totalRealizedPnl,
                totalTrades: paperTradingManager.getStats().totalTrades,
                winRate: paperTradingManager.getStats().winRate,
                totalFees: paperTradingManager.getStats().totalFees,
                pollingInterval: config.polling.intervalMs,
                targetsCount: config.targets.length,
              }
            : {
                mode: mode as "dry-run" | "paper" | "live",
                balance: liveBalance,
                startingBalance: liveBalance, // For live mode, starting balance = current balance
                openPositions: 0,
                positionsValue: 0,
                unrealizedPnl: 0,
                openOrdersCount: liveOpenOrdersCount,
                realizedPnl: 0,
                totalTrades: 0,
                winRate: 0,
                totalFees: 0,
                pollingInterval: config.polling.intervalMs,
                targetsCount: config.targets.length,
              };

          // Update either dashboard
          if (dashboardV3) {
            dashboardV3.updateStats(initialStats);
          } else if (dashboard) {
            dashboard.updateStats(initialStats);
          }
        }

        // Session trade tracker for live mode
        const sessionTrades = {
          count: 0,
          totalValue: 0,
          successCount: 0,
        };

        // Helper to get active dashboard for logging
        const getActiveDashboard = () => dashboardV3 || dashboard;

        // Watcher with event handlers
        const watcher = createWatcher(config.targets, config.polling, {
          onTradeDetected: async (signal: TradeSignal) => {
            const result = await handleTradeDetected(
              signal,
              executor,
              stateManager,
              getActiveDashboard(),
              paperTradingManager,
              gammaApi
            );

            // Track session stats for live mode
            if (result && !paperTradingManager) {
              sessionTrades.count++;
              if (result.success) {
                sessionTrades.successCount++;
                sessionTrades.totalValue += result.value;
              }
            }
          },
          onError: (error: Error, context: string) => {
            logError(logger, error, context);
            stateManager.setLastError(error.message);
            const activeDashboard = getActiveDashboard();
            if (activeDashboard) {
              activeDashboard.logError(error.message, context);
            }
          },
        });

        spinner.succeed("Components initialized");

        // Start the watcher
        stateManager.start();
        await watcher.start();

        if (useDashboard && (dashboardV3 || dashboard)) {
          // Start the active dashboard
          const activeDashboard = dashboardV3 || dashboard!;
          activeDashboard.start();
          activeDashboard.logInfo(
            "Copy trader started",
            `Watching ${config.targets.length} target(s)`
          );

          // Set up price/resolution check interval (every 30 seconds)
          // This checks for resolved markets and updates prices
          const priceUpdateInterval = setInterval(async () => {
            if (paperTradingManager) {
              try {
                const settlementResult =
                  await paperTradingManager.updatePrices();
                if (settlementResult && settlementResult.settled > 0) {
                  const pnlStr =
                    settlementResult.totalPnl >= 0
                      ? `+$${settlementResult.totalPnl.toFixed(2)}`
                      : `-$${Math.abs(settlementResult.totalPnl).toFixed(2)}`;
                  activeDashboard.logInfo(
                    `Settled ${settlementResult.settled} position(s)`,
                    `${settlementResult.wins}W/${settlementResult.losses}L | PnL: ${pnlStr}`
                  );
                }
              } catch {
                // Silently ignore price update errors
              }
            }
          }, 30000);

          // Set up stats refresh interval (every 2 seconds for UI)
          // For live mode, also fetch real data from API
          const statsRefresh = setInterval(async () => {
            if (paperTradingManager) {
              const stats = paperTradingManager.getStats();
              const positions = paperTradingManager.getPositions();

              // Calculate positions value (only non-settled positions with shares > 0)
              let positionsValue = 0;
              let openPositionsCount = 0;
              Object.values(positions).forEach((pos) => {
                if (!pos.settled && pos.shares > 0) {
                  positionsValue +=
                    (pos.currentPrice || pos.avgEntryPrice) * pos.shares;
                  openPositionsCount++;
                }
              });

              activeDashboard.updateStats({
                balance: paperTradingManager.getBalance(),
                openPositions: openPositionsCount,
                positionsValue,
                unrealizedPnl: stats.totalUnrealizedPnl,
                realizedPnl: stats.totalRealizedPnl,
                totalTrades: stats.totalTrades,
                winRate: stats.winRate,
                totalFees: stats.totalFees,
              });
            } else if (!config.risk.dryRun && !env.paperTrading) {
              // Live mode - fetch real stats from API + session stats + positions
              try {
                const liveStats = await executor.getLiveStats();
                const winRate =
                  sessionTrades.count > 0
                    ? (sessionTrades.successCount / sessionTrades.count) * 100
                    : 0;

                // Fetch positions first so portfolio value mirrors holdings
                let positionsValue = sessionTrades.totalValue;
                let openPositionsCount = 0;

                if (dashboardV3) {
                  try {
                    const positionsData = await executor.getPositions();
                    positionsValue = positionsData.totalValue;
                    openPositionsCount = positionsData.positions.length;

                    // Always push the latest positions so status icons can update
                    const livePositions: LivePosition[] =
                      positionsData.positions.map((p) => ({
                        tokenId: p.tokenId,
                        outcome: p.outcome,
                        shares: p.shares,
                        avgEntryPrice: p.avgEntryPrice,
                        currentValue: p.currentValue,
                        market: p.market,
                        isResolved: p.isResolved,
                        isRedeemable: p.isRedeemable,
                        conditionId: p.conditionId,
                      }));
                    dashboardV3.setPositions(livePositions);
                  } catch {
                    // Silently ignore position fetch errors
                  }
                }

                activeDashboard.updateStats({
                  balance: liveStats.balance,
                  openOrdersCount: liveStats.openOrdersCount,
                  totalTrades: sessionTrades.count,
                  positionsValue,
                  openPositions: openPositionsCount || undefined,
                  winRate,
                });
              } catch {
                // Silently ignore live stats errors
              }
            }
          }, 2000);

          // Handle graceful shutdown
          const shutdown = async () => {
            clearInterval(priceUpdateInterval);
            clearInterval(statsRefresh);
            activeDashboard.stop();
            disableDashboardMode(); // Re-enable console logging
            console.log(chalk.yellow("\n\nShutting down..."));
            await watcher.stop();
            stateManager.stop();
            await stateManager.close();
            console.log(chalk.green("Goodbye! 👋\n"));
            process.exit(0);
          };

          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);
        } else {
          // Non-dashboard mode
          console.log(chalk.green("\n✅ Starting copy trader...\n"));
          console.log(chalk.gray("─".repeat(50)));
          console.log(chalk.bold("Status:"), chalk.green("RUNNING"));
          console.log(
            chalk.bold("Polling Interval:"),
            `${config.polling.intervalMs}ms`
          );

          let modeStr: string;
          if (config.risk.dryRun) {
            modeStr = chalk.yellow("DRY RUN");
          } else if (env.paperTrading) {
            modeStr = chalk.blue("PAPER TRADING");
          } else {
            modeStr = chalk.red("LIVE");
          }
          console.log(chalk.bold("Mode:"), modeStr);
          console.log(chalk.gray("─".repeat(50)));
          console.log(chalk.gray("\nPress Ctrl+C to stop.\n"));

          // Handle graceful shutdown
          const shutdown = async () => {
            console.log(chalk.yellow("\n\nShutting down..."));
            await watcher.stop();
            stateManager.stop();
            await stateManager.close();
            console.log(chalk.green("Goodbye! 👋\n"));
            process.exit(0);
          };

          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);
        }

        // Keep the process running
        await new Promise(() => {}); // Never resolves
      } catch (error) {
        if (dashboardV3) {
          dashboardV3.stop();
        } else if (dashboard) {
          dashboard.stop();
        }
        spinner.fail("Failed to initialize");
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    });

  return command;
}

/**
 * Handle a detected trade
 * Returns trade result info for session tracking
 */
async function handleTradeDetected(
  signal: TradeSignal,
  executor: Executor,
  stateManager: StateManager,
  dashboard: Dashboard | DashboardV3 | null,
  paperTradingManager:
    | import("../copier/paperTrading").PaperTradingManager
    | null,
  gammaApi: import("../polymarket/gammaApi").GammaApiClient
): Promise<{ success: boolean; value: number } | null> {
  // Always try to fetch the proper market question from Gamma API
  let marketName = "";

  try {
    // Try by token ID first (most reliable) - uses clob_token_ids param
    // This is the ONLY reliable way to get exact market match
    // DO NOT use condition_id - it returns multiple markets and picks wrong one
    if (signal.tokenId && signal.tokenId.length > 20) {
      const market = await gammaApi.getMarketByTokenId(signal.tokenId);
      if (market && market.question) {
        marketName = market.question;
      }
    }
  } catch {
    // Silently use fallback
  }

  // Final fallback to slug or token ID (don't use condition_id - it's unreliable)
  if (!marketName) {
    marketName =
      signal.marketSlug ||
      (signal.tokenId
        ? signal.tokenId.substring(0, 25) + "..."
        : "Unknown Market");
  }

  // Execute the trade
  const result = await executor.execute(signal);
  await stateManager.recordExecution(result);

  const orderId = result.result?.orderId || "N/A";

  if (dashboard) {
    // Dashboard mode - use enhanced activity logging if V3
    if ("logTargetActivity" in dashboard) {
      const dashboardV3 = dashboard as DashboardV3;

      // For REDEEM, show the USDC gained instead of shares/price
      const isRedeem = signal.activityType === "REDEEM";
      const usdcGained = isRedeem ? result.result?.executedPrice : undefined;
      const positionsRedeemed = isRedeem
        ? result.result?.executedSize
        : undefined;

      // Log target activity with our copy result
      dashboardV3.logTargetActivity({
        activityType: signal.activityType || "TRADE",
        side: signal.side,
        targetWallet: signal.targetWallet,
        targetShares: signal.sizeShares || 0,
        targetPrice: signal.price,
        marketName,
        copied: result.result?.success === true && !result.skipped,
        copyError: result.skipped
          ? result.skipReason
          : result.result?.errorMessage,
        yourShares: isRedeem ? positionsRedeemed : result.order?.size,
        yourPrice: isRedeem ? usdcGained : result.order?.price,
        orderId,
      });

      // Update stats if paper trading
      if (paperTradingManager) {
        const stats = paperTradingManager.getStats();
        const positions = paperTradingManager.getPositions();

        let positionsValue = 0;
        let openPositionsCount = 0;
        Object.values(positions).forEach((pos) => {
          if (!pos.settled && pos.shares > 0) {
            // Calculate current value: currentPrice * shares (if available)
            // This matches how positions are displayed in the dashboard
            const currentPrice = pos.currentPrice ?? pos.avgEntryPrice;
            positionsValue += currentPrice * pos.shares;
            openPositionsCount++;
          }
        });

        dashboardV3.updateStats({
          balance: paperTradingManager.getBalance(),
          openPositions: openPositionsCount,
          positionsValue,
          unrealizedPnl: stats.totalUnrealizedPnl,
          realizedPnl: stats.totalRealizedPnl,
          totalTrades: stats.totalTrades,
          winRate: stats.winRate,
          totalFees: stats.totalFees,
        });
      }

      // Return success/value for session tracking
      if (result.skipped || !result.result?.success) {
        return result.result?.success === false
          ? { success: false, value: 0 }
          : null;
      }

      const tradeValue = result.order
        ? result.order.price * result.order.size
        : 0;
      return { success: true, value: tradeValue };
    } else {
      // Fallback for old dashboard
      if (result.skipped) {
        dashboard.logSkip(result.skipReason || "Unknown reason", marketName);
        return null;
      } else if (result.result?.success) {
        dashboard.logTrade(
          signal.side,
          result.order?.size || 0,
          result.order?.price || signal.price,
          marketName,
          orderId
        );

        // Update stats if paper trading
        if (paperTradingManager) {
          const stats = paperTradingManager.getStats();
          const positions = paperTradingManager.getPositions();

          let positionsValue = 0;
          let openPositionsCount = 0;
          Object.values(positions).forEach((pos) => {
            if (!pos.settled && pos.shares > 0) {
              // Calculate current value: currentPrice * shares (if available)
              const currentPrice = pos.currentPrice ?? pos.avgEntryPrice;
              positionsValue += currentPrice * pos.shares;
              openPositionsCount++;
            }
          });

          dashboard.updateStats({
            balance: paperTradingManager.getBalance(),
            openPositions: openPositionsCount,
            positionsValue,
            unrealizedPnl: stats.totalUnrealizedPnl,
            realizedPnl: stats.totalRealizedPnl,
            totalTrades: stats.totalTrades,
            winRate: stats.winRate,
            totalFees: stats.totalFees,
          });
        }

        const tradeValue = result.order
          ? result.order.price * result.order.size
          : 0;
        return { success: true, value: tradeValue };
      } else {
        dashboard.logError(
          result.result?.errorMessage || "Order failed",
          marketName
        );
        return { success: false, value: 0 };
      }
    }
  } else {
    // Console mode
    console.log(chalk.cyan("\n📊 Trade Detected:"));
    console.log(chalk.gray(`  Market: ${marketName}`));
    console.log(
      chalk.gray(`  Target: ${signal.targetWallet.substring(0, 10)}...`)
    );
    console.log(
      chalk.gray(
        `  Side: ${
          signal.side === "BUY" ? chalk.green("BUY") : chalk.red("SELL")
        }`
      )
    );
    console.log(
      chalk.gray(
        `  Target Fill: ${
          signal.sizeShares?.toFixed(2) || "?"
        } shares @ $${signal.price.toFixed(4)}`
      )
    );
    console.log(
      chalk.gray(
        `  Your Order: ${result.order?.size.toFixed(2) || "?"} shares @ $${
          result.order?.price?.toFixed(4) || signal.price.toFixed(4)
        }`
      )
    );

    if (result.skipped) {
      console.log(chalk.yellow(`  ⏭️  Skipped: ${result.skipReason}`));
      return null;
    } else if (result.result?.success) {
      console.log(
        chalk.green(
          `  ✅ Order ${result.dryRun ? "Simulated" : "Placed"}: ${orderId}`
        )
      );
      const tradeValue = result.order
        ? result.order.price * result.order.size
        : 0;
      return { success: true, value: tradeValue };
    } else {
      console.log(
        chalk.red(`  ❌ Order Failed: ${result.result?.errorMessage}`)
      );
      return { success: false, value: 0 };
    }
  }
}

/**
 * Display configuration summary
 */
function displayConfig(config: AppConfig): void {
  const env = getEnvConfig();

  console.log(chalk.bold("Configuration:"));
  console.log(chalk.gray("─".repeat(50)));

  console.log(`  ${chalk.cyan("Targets:")} ${config.targets.length}`);
  config.targets.forEach((t) => {
    console.log(
      `    ${chalk.gray("•")} ${t.substring(0, 10)}...${t.slice(-6)}`
    );
  });

  console.log(`  ${chalk.cyan("Sizing:")} ${config.trading.sizingMode}`);

  if (config.trading.sizingMode === "fixed_usd") {
    console.log(`    USD per Trade: $${config.trading.fixedUsdSize}`);
  } else if (config.trading.sizingMode === "fixed_shares") {
    console.log(`    Shares per Trade: ${config.trading.fixedSharesSize}`);
  } else {
    console.log(
      `    Multiplier: ${(config.trading.proportionalMultiplier * 100).toFixed(
        0
      )}%`
    );
  }

  console.log(
    `  ${chalk.cyan("Slippage:")} ${(config.trading.slippage * 100).toFixed(
      1
    )}%`
  );

  console.log(`  ${chalk.cyan("Risk Limits:")}`);
  const maxTrade = config.risk.maxUsdPerTrade;
  const maxMarket = config.risk.maxUsdPerMarket;
  const maxDaily = config.risk.maxDailyUsdVolume;
  console.log(
    `    Max per Trade: $${
      maxTrade > 1e9 ? "unlimited" : maxTrade.toLocaleString()
    }`
  );
  console.log(
    `    Max per Market: $${
      maxMarket > 1e9 ? "unlimited" : maxMarket.toLocaleString()
    }`
  );
  console.log(
    `    Max Daily Volume: $${
      maxDaily > 1e9 ? "unlimited" : maxDaily.toLocaleString()
    }`
  );

  console.log(`  ${chalk.cyan("Polling:")} ${config.polling.intervalMs}ms`);

  // Show trading mode (Dry Run / Paper Trading / Live)
  let modeDisplay: string;
  if (config.risk.dryRun) {
    modeDisplay = chalk.yellow("DRY RUN (logging only)");
  } else if (env.paperTrading) {
    modeDisplay = chalk.blue("PAPER TRADING (simulated)");
  } else {
    modeDisplay = chalk.red("LIVE TRADING (real money!)");
  }
  console.log(`  ${chalk.cyan("Mode:")} ${modeDisplay}`);

  if (env.paperTrading && !config.risk.dryRun) {
    console.log(`    Starting Balance: $${env.paperStartingBalance}`);
    console.log(`    Fee Rate: ${(env.paperFeeRate * 100).toFixed(2)}%`);
  }

  console.log(chalk.gray("─".repeat(50)));
}

/**
 * Countdown before live trading
 */
async function countdown(seconds: number): Promise<void> {
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(chalk.yellow(`Starting in ${i}...\r`));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log();
}
