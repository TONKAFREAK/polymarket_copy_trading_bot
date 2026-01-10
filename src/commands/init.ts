/**
 * Init command - initialize the copy trader configuration
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getConfigManager } from "../config";
import { getEnvConfig, validateEnvConfig, ensureDataDir } from "../config/env";
import { SizingMode } from "../copier/types";

export function createInitCommand(): Command {
  // Get env config to use as defaults
  const env = getEnvConfig();

  const command = new Command("init")
    .description("Initialize the Polymarket copy trader configuration")
    .option(
      "-t, --targets <addresses>",
      "Comma-separated list of target wallet addresses to copy"
    )
    .option(
      "-m, --mode <mode>",
      "Sizing mode: fixed_usd, fixed_shares, proportional",
      env.sizingMode
    )
    .option(
      "-u, --usd <amount>",
      "USD amount per trade (for fixed_usd mode)",
      String(env.defaultUsdSize)
    )
    .option(
      "-s, --shares <amount>",
      "Shares per trade (for fixed_shares mode)",
      String(env.defaultSharesSize)
    )
    .option(
      "--slippage <percent>",
      "Slippage tolerance (e.g., 0.01 for 1%)",
      String(env.slippage)
    )
    .option(
      "--multiplier <ratio>",
      "Proportional multiplier (e.g., 0.25 for 25%)",
      String(env.proportionalMultiplier)
    )
    .option(
      "--max-usd-per-trade <amount>",
      "Maximum USD per single trade",
      String(env.maxUsdPerTrade)
    )
    .option(
      "--max-usd-per-market <amount>",
      "Maximum USD exposure per market",
      String(env.maxUsdPerMarket)
    )
    .option(
      "--max-daily-volume <amount>",
      "Maximum daily USD trading volume",
      String(env.maxDailyUsdVolume)
    )
    .option(
      "--poll-interval <ms>",
      "Polling interval in milliseconds",
      String(env.pollIntervalMs)
    )
    .option("-d, --dry-run", "Enable dry-run mode (no real trades)", env.dryRun)
    .option("--no-dry-run", "Disable dry-run mode (live trading)")
    .option("-f, --force", "Force reinitialize (overwrite existing config)")
    .action(async (options) => {
      const spinner = ora("Initializing Polymarket Copy Trader...").start();

      try {
        // Validate environment
        const envConfig = getEnvConfig();
        const validation = validateEnvConfig(envConfig);

        if (!validation.valid && !options.dryRun) {
          spinner.fail("Environment validation failed");
          console.log(chalk.red("\nErrors:"));
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

        // Ensure data directory exists
        ensureDataDir(envConfig.dataDir);

        // Initialize config
        const configManager = getConfigManager(envConfig.dataDir);

        // Parse targets
        const targets: string[] = options.targets
          ? options.targets.split(",").map((t: string) => t.trim())
          : [];

        // Validate sizing mode
        const validModes: SizingMode[] = [
          "fixed_usd",
          "fixed_shares",
          "proportional",
        ];
        const sizingMode = options.mode as SizingMode;
        if (!validModes.includes(sizingMode)) {
          spinner.fail(`Invalid sizing mode: ${options.mode}`);
          console.log(chalk.yellow(`Valid modes: ${validModes.join(", ")}`));
          process.exit(1);
        }

        // Initialize configuration with all options
        configManager.initializeFull({
          targets,
          sizingMode,
          fixedUsdSize: parseFloat(options.usd),
          fixedSharesSize: parseFloat(options.shares),
          proportionalMultiplier: parseFloat(options.multiplier),
          slippage: parseFloat(options.slippage),
          maxUsdPerTrade: parseFloat(options.maxUsdPerTrade),
          maxUsdPerMarket: parseFloat(options.maxUsdPerMarket),
          maxDailyUsdVolume: parseFloat(options.maxDailyVolume),
          pollIntervalMs: parseInt(options.pollInterval),
          dryRun: options.dryRun,
        });

        spinner.succeed("Configuration initialized successfully!");

        // Display configuration summary
        console.log("\n" + chalk.bold("Configuration Summary:"));
        console.log(chalk.gray("─".repeat(50)));

        console.log(
          `  ${chalk.cyan("Targets:")} ${
            targets.length > 0
              ? targets.length + " wallet(s)"
              : chalk.yellow("None (add with: pmcopy targets add <address>)")
          }`
        );
        targets.forEach((t) => {
          console.log(`    ${chalk.gray("•")} ${t}`);
        });

        console.log(`  ${chalk.cyan("Sizing Mode:")} ${sizingMode}`);

        if (sizingMode === "fixed_usd") {
          console.log(`  ${chalk.cyan("USD per Trade:")} $${options.usd}`);
        } else if (sizingMode === "fixed_shares") {
          console.log(`  ${chalk.cyan("Shares per Trade:")} ${options.shares}`);
        } else if (sizingMode === "proportional") {
          console.log(
            `  ${chalk.cyan("Proportional Multiplier:")} ${(
              parseFloat(options.multiplier) * 100
            ).toFixed(0)}%`
          );
        }

        console.log(
          `  ${chalk.cyan("Slippage:")} ${(
            parseFloat(options.slippage) * 100
          ).toFixed(1)}%`
        );

        console.log(chalk.gray("\n  Risk Limits:"));
        const maxTrade = parseFloat(options.maxUsdPerTrade);
        const maxMarket = parseFloat(options.maxUsdPerMarket);
        const maxDaily = parseFloat(options.maxDailyVolume);
        console.log(
          `    ${chalk.cyan("Max USD/Trade:")} $${
            maxTrade > 1e9 ? "unlimited" : maxTrade.toLocaleString()
          }`
        );
        console.log(
          `    ${chalk.cyan("Max USD/Market:")} $${
            maxMarket > 1e9 ? "unlimited" : maxMarket.toLocaleString()
          }`
        );
        console.log(
          `    ${chalk.cyan("Max Daily Volume:")} $${
            maxDaily > 1e9 ? "unlimited" : maxDaily.toLocaleString()
          }`
        );

        console.log(chalk.gray("\n  Polling:"));
        console.log(`    ${chalk.cyan("Interval:")} ${options.pollInterval}ms`);

        console.log(
          `\n  ${chalk.cyan("Mode:")} ${
            options.dryRun
              ? chalk.green("DRY RUN (no real trades)")
              : envConfig.paperTrading
              ? chalk.yellow("PAPER TRADING (simulated)")
              : chalk.red("LIVE TRADING (real money!)")
          }`
        );

        console.log(chalk.gray("─".repeat(50)));

        // Show env source info
        console.log(chalk.gray("\n  (Defaults loaded from .env file)"));

        // Show next steps
        console.log("\n" + chalk.bold("Next Steps:"));

        if (targets.length === 0) {
          console.log(
            `  1. Add targets: ${chalk.cyan("pmcopy targets add 0x...")}`
          );
        }

        console.log(
          `  ${targets.length === 0 ? "2" : "1"}. Review config: ${chalk.cyan(
            "pmcopy config get"
          )}`
        );
        console.log(
          `  ${targets.length === 0 ? "3" : "2"}. Start copying: ${chalk.cyan(
            "pmcopy run"
          )}`
        );

        // Warning banner
        if (!options.dryRun && !envConfig.paperTrading) {
          console.log("\n" + chalk.bgRed.white.bold(" ⚠️  WARNING "));
          console.log(
            chalk.red("Live trading is enabled! Real money will be used.")
          );
          console.log(
            chalk.red("Make sure you understand the risks before proceeding.")
          );
        }
      } catch (error) {
        spinner.fail("Initialization failed");
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    });

  return command;
}
