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
  const command = new Command("init")
    .description("Initialize the Polymarket copy trader configuration")
    .option(
      "-t, --targets <addresses>",
      "Comma-separated list of target wallet addresses to copy"
    )
    .option(
      "-m, --mode <mode>",
      "Sizing mode: fixed_usd, fixed_shares, proportional",
      "fixed_usd"
    )
    .option(
      "-u, --usd <amount>",
      "USD amount per trade (for fixed_usd mode)",
      "10"
    )
    .option(
      "-s, --shares <amount>",
      "Shares per trade (for fixed_shares mode)",
      "10"
    )
    .option(
      "--slippage <percent>",
      "Slippage tolerance (e.g., 0.01 for 1%)",
      "0.01"
    )
    .option("-d, --dry-run", "Enable dry-run mode (no real trades)", true)
    .option("--no-dry-run", "Disable dry-run mode (live trading)")
    .option("-f, --force", "Force reinitialize (overwrite existing config)")
    .action(async (options) => {
      const spinner = ora("Initializing Polymarket Copy Trader...").start();

      try {
        // Validate environment
        const env = getEnvConfig();
        const validation = validateEnvConfig(env);

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
        ensureDataDir(env.dataDir);

        // Initialize config
        const configManager = getConfigManager(env.dataDir);

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

        // Initialize configuration
        configManager.initialize({
          targets,
          sizingMode,
          usd: parseFloat(options.usd),
          shares: parseFloat(options.shares),
          slippage: parseFloat(options.slippage),
          dryRun: options.dryRun,
        });

        spinner.succeed("Configuration initialized successfully!");

        // Display configuration summary
        console.log("\n" + chalk.bold("Configuration Summary:"));
        console.log(chalk.gray("─".repeat(40)));

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
        }

        console.log(
          `  ${chalk.cyan("Slippage:")} ${(
            parseFloat(options.slippage) * 100
          ).toFixed(1)}%`
        );
        console.log(
          `  ${chalk.cyan("Dry Run:")} ${
            options.dryRun
              ? chalk.green("Enabled (no real trades)")
              : chalk.red("Disabled (LIVE TRADING)")
          }`
        );

        console.log(chalk.gray("─".repeat(40)));

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
        if (!options.dryRun) {
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
