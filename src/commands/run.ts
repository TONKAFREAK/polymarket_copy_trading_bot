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
import { createWebSocketWatcher } from "../copier/websocketWatcher";
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
import { autoRedeemSilent } from "./redeem";

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

        // Track positions we've already attempted to redeem (to avoid spam)
        const redeemedTokenIds = new Set<string>();

        // Track recently processed trades to prevent duplicates (WS + polling race)
        const processedTrades = new Map<string, number>(); // tradeKey -> timestamp
        const TRADE_DEDUP_WINDOW_MS = 30000; // 30 seconds dedup window

        // Helper to get active dashboard for logging
        const getActiveDashboard = () => dashboardV3 || dashboard;

        // Trade handler - shared by both WebSocket and polling watchers
        const handleTrade = async (signal: TradeSignal) => {
          // Create unique trade key for deduplication using tradeId (most reliable)
          // or fallback to a composite key
          const tradeKey =
            signal.tradeId ||
            `${signal.targetWallet}-${signal.tokenId}-${signal.side}-${signal.price}-${signal.timestamp}`;
          const now = Date.now();

          // Check if we recently processed this exact trade
          const lastProcessed = processedTrades.get(tradeKey);
          if (lastProcessed && now - lastProcessed < TRADE_DEDUP_WINDOW_MS) {
            // Already processed this trade recently, skip
            logger.debug("Skipping duplicate trade detection", { tradeKey });
            return;
          }

          // Mark this trade as processed
          processedTrades.set(tradeKey, now);

          // Clean up old entries to prevent memory leak
          if (processedTrades.size > 100) {
            for (const [key, time] of processedTrades) {
              if (now - time > TRADE_DEDUP_WINDOW_MS) {
                processedTrades.delete(key);
              }
            }
          }

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
        };

        const handleError = (error: Error, context: string) => {
          logError(logger, error, context);
          stateManager.setLastError(error.message);
          const activeDashboard = getActiveDashboard();
          if (activeDashboard) {
            activeDashboard.logError(error.message, context);
          }
        };

        // Auto-redeem timer - periodically checks for and redeems winning positions
        let autoRedeemInterval: NodeJS.Timeout | null = null;

        const startAutoRedeem = () => {
          if (!env.autoRedeem || env.paperTrading || config.risk.dryRun) {
            logger.debug(
              "Auto-redeem disabled (off, paper trading, or dry-run mode)"
            );
            return;
          }

          const intervalMs = env.autoRedeemIntervalMs || 300000; // Default 5 minutes
          logger.info(
            `Auto-redeem enabled, running every ${Math.round(
              intervalMs / 60000
            )} minutes`
          );

          const runAutoRedeem = async () => {
            try {
              logger.debug("Running auto-redeem check...");
              const result = await autoRedeemSilent();

              if (result.redeemedCount > 0) {
                const activeDashboard = getActiveDashboard();
                if (activeDashboard) {
                  activeDashboard.logInfo(
                    `Auto-redeemed ${result.redeemedCount} position(s)`,
                    `+$${result.totalUsdcGained.toFixed(2)} USDC`
                  );
                }
                logger.info("Auto-redeem completed", {
                  redeemed: result.redeemedCount,
                  usdcGained: result.totalUsdcGained,
                });
              }

              if (result.errors.length > 0) {
                logger.debug("Auto-redeem had errors", {
                  errors: result.errors,
                });
              }
            } catch (error) {
              logger.error("Auto-redeem error", {
                error: (error as Error).message,
              });
            }
          };

          // Run immediately, then on interval
          runAutoRedeem();
          autoRedeemInterval = setInterval(runAutoRedeem, intervalMs);
        };

        // Stop-loss timer - periodically checks for positions down by X% and sells them
        let stopLossInterval: NodeJS.Timeout | null = null;
        const stopLossSoldTokenIds = new Set<string>(); // Track sold positions to avoid re-selling

        const startStopLoss = () => {
          if (
            env.stopLossPercent <= 0 ||
            env.paperTrading ||
            config.risk.dryRun
          ) {
            logger.debug(
              "Stop-loss disabled (off, paper trading, or dry-run mode)"
            );
            return;
          }

          const intervalMs = env.stopLossCheckIntervalMs || 30000; // Default 30 seconds
          const threshold = env.stopLossPercent / 100; // Convert percentage to decimal
          logger.info(
            `Stop-loss enabled at ${
              env.stopLossPercent
            }%, checking every ${Math.round(intervalMs / 1000)}s`
          );

          const runStopLoss = async () => {
            try {
              // Import sell function
              const { sellPositions } = await import("./sell");

              // Get current positions
              const positionsData = await executor.getPositions();

              for (const pos of positionsData.positions) {
                // Skip already sold or resolved positions
                if (stopLossSoldTokenIds.has(pos.tokenId)) continue;
                if (pos.isResolved || pos.isRedeemable) continue;
                if (pos.shares <= 0.01) continue;

                // Calculate P&L percentage
                const costBasis = pos.shares * pos.avgEntryPrice;
                if (costBasis <= 0) continue;

                const pnlPercent = (pos.currentValue - costBasis) / costBasis;

                // Check if position is down by threshold (e.g., -80% = -0.8)
                if (pnlPercent <= -threshold) {
                  const activeDashboard = getActiveDashboard();
                  const lossPercent = Math.abs(pnlPercent * 100).toFixed(1);

                  if (activeDashboard) {
                    activeDashboard.logInfo(
                      `🛑 Stop-loss triggered (-${lossPercent}%)`,
                      pos.market.substring(0, 40) + "..."
                    );
                  }

                  logger.warn("Stop-loss triggered", {
                    market: pos.market,
                    tokenId: pos.tokenId,
                    lossPercent: lossPercent + "%",
                    costBasis: costBasis.toFixed(2),
                    currentValue: pos.currentValue.toFixed(2),
                  });

                  // Mark as sold before attempting (prevent re-attempts)
                  stopLossSoldTokenIds.add(pos.tokenId);

                  try {
                    // Sell the position
                    const sellResults = await sellPositions({
                      tokenId: pos.tokenId,
                      slippage: 0.05, // 5% slippage for stop-loss (more aggressive)
                      dryRun: false,
                    });

                    if (sellResults.length > 0 && sellResults[0].success) {
                      const result = sellResults[0];
                      if (activeDashboard) {
                        activeDashboard.logInfo(
                          `✅ Stop-loss sold: $${result.value.toFixed(2)}`,
                          `${result.shares.toFixed(
                            1
                          )} @ $${result.price.toFixed(2)}`
                        );
                      }
                      logger.info("Stop-loss position sold", {
                        market: pos.market,
                        shares: result.shares,
                        price: result.price,
                        value: result.value,
                        orderId: result.orderId,
                      });
                    } else if (sellResults.length > 0) {
                      const error = sellResults[0].error || "Unknown error";
                      if (activeDashboard) {
                        activeDashboard.logError(
                          `Stop-loss sell failed`,
                          error.substring(0, 50)
                        );
                      }
                      logger.error("Stop-loss sell failed", {
                        error,
                        tokenId: pos.tokenId,
                      });
                      // Remove from sold set so it can retry
                      stopLossSoldTokenIds.delete(pos.tokenId);
                    }
                  } catch (sellError) {
                    if (activeDashboard) {
                      activeDashboard.logError(
                        `Stop-loss error`,
                        (sellError as Error).message.substring(0, 50)
                      );
                    }
                    logger.error("Stop-loss sell error", {
                      error: (sellError as Error).message,
                    });
                    // Remove from sold set so it can retry
                    stopLossSoldTokenIds.delete(pos.tokenId);
                  }
                }
              }
            } catch (error) {
              logger.error("Stop-loss check error", {
                error: (error as Error).message,
              });
            }
          };

          // Run on interval (not immediately - let positions load first)
          stopLossInterval = setInterval(runStopLoss, intervalMs);
          // Run first check after 10 seconds
          setTimeout(runStopLoss, 10000);
        };

        // Activity poller - polls for non-TRADE activities (REDEEM, SPLIT, MERGE)
        // WebSocket only streams TRADEs, so we need this for other activity types
        let activityPollerInterval: NodeJS.Timeout | null = null;
        const seenActivityIds = new Set<string>();

        const startActivityPoller = async () => {
          const { getDataApiClient } = await import("../polymarket/dataApi");
          const dataApi = getDataApiClient();

          const pollActivities = async () => {
            for (const target of config.targets) {
              try {
                const activities = await dataApi.fetchNonTradeActivities(
                  target,
                  20
                );

                for (const activity of activities) {
                  const signal = dataApi.normalizeTrade(activity, target);

                  // Skip if we've seen this activity
                  if (seenActivityIds.has(signal.tradeId)) continue;

                  // Skip old activities (more than 5 minutes old)
                  const age = Date.now() - signal.timestamp;
                  if (age > 5 * 60 * 1000) {
                    seenActivityIds.add(signal.tradeId);
                    continue;
                  }

                  seenActivityIds.add(signal.tradeId);

                  // Also mark in state manager to prevent double processing
                  const seen = await stateManager.hasSeenTrade(
                    target,
                    signal.tradeId
                  );
                  if (seen) continue;
                  await stateManager.markTradeSeen(target, signal.tradeId);

                  // Log the activity detection
                  const activeDashboard = getActiveDashboard();
                  if (activeDashboard) {
                    activeDashboard.logInfo(
                      `${signal.activityType} detected`,
                      signal.marketSlug?.substring(0, 40) || "Unknown market"
                    );
                  }

                  // Process it
                  await handleTrade(signal);
                }
              } catch (error) {
                // Silently ignore polling errors
              }
            }

            // Clean up old seen IDs periodically (keep last 1000)
            if (seenActivityIds.size > 1000) {
              const arr = Array.from(seenActivityIds);
              seenActivityIds.clear();
              arr.slice(-500).forEach((id) => seenActivityIds.add(id));
            }
          };

          // Poll every 30 seconds for non-trade activities
          activityPollerInterval = setInterval(pollActivities, 30000);
          // Run once immediately
          pollActivities();
        };

        // Polling watcher - only used as fallback when WebSocket is disconnected
        let pollingWatcher: ReturnType<typeof createWatcher> | null = null;
        let pollingActive = false;

        const startPollingFallback = async () => {
          if (pollingActive || pollingWatcher) return;
          pollingActive = true;

          const pollingConfig = {
            ...config.polling,
            intervalMs: 2000, // Fast polling when it's the primary method
          };
          pollingWatcher = createWatcher(config.targets, pollingConfig, {
            onTradeDetected: handleTrade,
            onError: handleError,
          });
          await pollingWatcher.start();

          const activeDashboard = getActiveDashboard();
          if (activeDashboard) {
            activeDashboard.logInfo(
              "Polling fallback started",
              "Using API polling while WebSocket reconnects"
            );
          }
        };

        const stopPollingFallback = async () => {
          if (!pollingActive || !pollingWatcher) return;
          pollingActive = false;

          await pollingWatcher.stop();
          pollingWatcher = null;
        };

        // Use WebSocket watcher for real-time trade detection (much faster!)
        // Falls back to polling watcher if WebSocket fails
        const wsWatcher = createWebSocketWatcher(config.targets, {
          onTradeDetected: handleTrade,
          onError: handleError,
          onConnected: async () => {
            const activeDashboard = getActiveDashboard();
            if (activeDashboard) {
              activeDashboard.logInfo(
                "WebSocket connected",
                "Real-time trade detection active"
              );
            }
            // Stop polling when WebSocket is connected
            await stopPollingFallback();
          },
          onDisconnected: async () => {
            const activeDashboard = getActiveDashboard();
            if (activeDashboard) {
              activeDashboard.logError(
                "WebSocket disconnected",
                "Starting polling fallback..."
              );
            }
            // Start polling when WebSocket disconnects
            await startPollingFallback();
          },
        });

        spinner.succeed("Components initialized (WebSocket primary)");

        // Start the WebSocket watcher
        stateManager.start();
        await wsWatcher.start();

        // Start activity poller for non-TRADE activities (REDEEM, SPLIT, MERGE)
        // WebSocket only streams TRADEs, so we need this running always
        await startActivityPoller();

        // Start auto-redeem if enabled (live trading only)
        startAutoRedeem();

        // Start stop-loss monitoring if enabled (live trading only)
        startStopLoss();

        // Give WebSocket 5 seconds to connect, then start polling as fallback if needed
        setTimeout(async () => {
          const wsStatus = wsWatcher.getStatus();
          if (!wsStatus.connected && !pollingActive) {
            const activeDashboard = getActiveDashboard();
            if (activeDashboard) {
              activeDashboard.logInfo(
                "WebSocket not ready",
                "Starting polling fallback"
              );
            }
            await startPollingFallback();
          }
        }, 5000);

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
                let totalFees = 0;

                if (dashboardV3) {
                  try {
                    const positionsData = await executor.getPositions();
                    positionsValue = positionsData.totalValue;
                    openPositionsCount = positionsData.positions.length;
                    totalFees = positionsData.totalFees;

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
                        feesPaid: p.feesPaid,
                      }));
                    dashboardV3.setPositions(livePositions);

                    // Auto-redeem any positions that are redeemable (and not already attempted)
                    const redeemablePositions = positionsData.positions.filter(
                      (p) =>
                        p.isRedeemable &&
                        p.shares > 0 &&
                        !redeemedTokenIds.has(p.tokenId)
                    );
                    if (redeemablePositions.length > 0) {
                      // Import redeem function
                      const { redeemByTokenId } = await import("./redeem");

                      for (const pos of redeemablePositions) {
                        // Mark as attempted before trying (prevents re-attempts on next refresh)
                        redeemedTokenIds.add(pos.tokenId);

                        try {
                          dashboardV3.logInfo(
                            "Auto-redeeming resolved position",
                            `${pos.outcome} - ${pos.market.substring(0, 40)}...`
                          );

                          const redeemResult = await redeemByTokenId(
                            pos.tokenId
                          );

                          if (redeemResult.success) {
                            dashboardV3.logRedeem(
                              pos.market,
                              redeemResult.usdcGained
                            );
                          } else {
                            dashboardV3.logError(
                              `Redeem failed: ${redeemResult.error?.substring(
                                0,
                                50
                              )}`,
                              pos.market.substring(0, 40)
                            );
                          }
                        } catch (redeemErr) {
                          // Log but don't crash on redeem errors
                          dashboardV3.logError(
                            `Redeem error: ${(
                              redeemErr as Error
                            ).message.substring(0, 50)}`,
                            pos.market.substring(0, 40)
                          );
                        }
                      }
                    }
                  } catch {
                    // Silently ignore position fetch errors
                  }
                }

                activeDashboard.updateStats({
                  balance: liveStats.balance,
                  openOrdersCount: liveStats.openOrdersCount,
                  totalTrades: sessionTrades.count,
                  positionsValue,
                  openPositions: openPositionsCount,
                  totalFees,
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
            if (activityPollerInterval) clearInterval(activityPollerInterval);
            if (autoRedeemInterval) clearInterval(autoRedeemInterval);
            if (stopLossInterval) clearInterval(stopLossInterval);
            activeDashboard.stop();
            disableDashboardMode(); // Re-enable console logging
            console.log(chalk.yellow("\n\nShutting down..."));
            await wsWatcher.stop();
            if (pollingWatcher) await pollingWatcher.stop();
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
            await wsWatcher.stop();
            if (pollingWatcher) await pollingWatcher.stop();
            if (activityPollerInterval) clearInterval(activityPollerInterval);
            if (autoRedeemInterval) clearInterval(autoRedeemInterval);
            if (stopLossInterval) clearInterval(stopLossInterval);
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

      // For REDEEM, target shares/price from Data API are often 0
      // Use 1.0 as price (redemption value) for display
      const targetSharesDisplay = isRedeem ? 0 : signal.sizeShares || 0;
      const targetPriceDisplay = isRedeem ? 1.0 : signal.price;

      // Log target activity with our copy result
      dashboardV3.logTargetActivity({
        activityType: signal.activityType || "TRADE",
        side: signal.side,
        targetWallet: signal.targetWallet,
        targetShares: targetSharesDisplay,
        targetPrice: targetPriceDisplay,
        marketName,
        copied: result.result?.success === true && !result.skipped,
        copyError: result.skipped
          ? result.skipReason
          : result.result?.errorMessage,
        yourShares: isRedeem ? positionsRedeemed : result.order?.size,
        yourPrice: isRedeem ? usdcGained : result.order?.price,
        orderId,
        targetTradeTime: signal.timestamp,
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
