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
import { TradeSignal, AppConfig } from "../copier/types";
import { getLogger, logError } from "../utils/logger";

const logger = getLogger();

export function createRunCommand(): Command {
  const command = new Command("run")
    .description("Start the copy trading bot")
    .option("-i, --interval <ms>", "Polling interval in milliseconds")
    .option("-d, --dry-run", "Enable dry-run mode (no real trades)")
    .option("--no-dry-run", "Disable dry-run mode (live trading)")
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (options) => {
      console.log(chalk.bold.cyan("\n🚀 Polymarket Copy Trader\n"));

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

      // Display configuration
      displayConfig(config);

      // Show warning for live trading
      if (!config.risk.dryRun) {
        console.log(chalk.bgRed.white.bold("\n ⚠️  LIVE TRADING MODE "));
        console.log(
          chalk.red("Real money will be used. Press Ctrl+C to abort.\n")
        );
        await countdown(5);
      }

      // Initialize components
      const spinner = ora("Initializing components...").start();

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

        // Watcher with event handlers
        const watcher = createWatcher(config.targets, config.polling, {
          onTradeDetected: async (signal: TradeSignal) => {
            await handleTradeDetected(signal, executor, stateManager);
          },
          onError: (error: Error, context: string) => {
            logError(logger, error, context);
            stateManager.setLastError(error.message);
          },
        });

        spinner.succeed("Components initialized");

        // Start the watcher
        console.log(chalk.green("\n✅ Starting copy trader...\n"));
        stateManager.start();
        await watcher.start();

        // Display running status
        console.log(chalk.gray("─".repeat(50)));
        console.log(chalk.bold("Status:"), chalk.green("RUNNING"));
        console.log(
          chalk.bold("Polling Interval:"),
          `${config.polling.intervalMs}ms`
        );
        console.log(
          chalk.bold("Mode:"),
          config.risk.dryRun ? chalk.yellow("DRY RUN") : chalk.red("LIVE")
        );
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

        // Keep the process running
        await new Promise(() => {}); // Never resolves
      } catch (error) {
        spinner.fail("Failed to initialize");
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    });

  return command;
}

/**
 * Handle a detected trade
 */
async function handleTradeDetected(
  signal: TradeSignal,
  executor: Executor,
  stateManager: StateManager
): Promise<void> {
  console.log(chalk.cyan("\n📊 Trade Detected:"));
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
  console.log(chalk.gray(`  Price: $${signal.price.toFixed(4)}`));
  console.log(chalk.gray(`  Token: ${signal.tokenId.substring(0, 16)}...`));

  // Execute the trade
  const result = await executor.execute(signal);
  await stateManager.recordExecution(result);

  if (result.skipped) {
    console.log(chalk.yellow(`  ⏭️  Skipped: ${result.skipReason}`));
  } else if (result.result?.success) {
    console.log(
      chalk.green(
        `  ✅ Order ${result.dryRun ? "Simulated" : "Placed"}: ${
          result.result.orderId
        }`
      )
    );
    console.log(
      chalk.gray(
        `     Size: ${result.order?.size.toFixed(
          2
        )} shares @ $${result.order?.price.toFixed(4)}`
      )
    );
  } else {
    console.log(chalk.red(`  ❌ Order Failed: ${result.result?.errorMessage}`));
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
    console.log(`    Multiplier: ${(config.trading.proportionalMultiplier * 100).toFixed(0)}%`);
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
  console.log(`    Max per Trade: $${maxTrade > 1e9 ? "unlimited" : maxTrade.toLocaleString()}`);
  console.log(`    Max per Market: $${maxMarket > 1e9 ? "unlimited" : maxMarket.toLocaleString()}`);
  console.log(`    Max Daily Volume: $${maxDaily > 1e9 ? "unlimited" : maxDaily.toLocaleString()}`);

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
