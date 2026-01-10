/**
 * Status command - show bot status
 */

import { Command } from "commander";
import chalk from "chalk";
import { getConfigManager } from "../config";
import { getEnvConfig } from "../config/env";
// State manager imported for future use
// import { getStateManager } from '../copier/state';
import { getPersistenceProvider } from "../data";

export function createStatusCommand(): Command {
  const command = new Command("status")
    .description("Show the copy trader status")
    .option("-j, --json", "Output as JSON")
    .action(async (options) => {
      const env = getEnvConfig();
      const configManager = getConfigManager(env.dataDir);
      const config = configManager.getConfig();
      const persistence = getPersistenceProvider();

      // Get daily volume
      const dailyVolume = await persistence.getDailyVolume();

      // Build status object
      const status = {
        configured: config.targets.length > 0,
        targets: config.targets,
        mode: config.risk.dryRun ? "dry-run" : "live",
        sizingMode: config.trading.sizingMode,
        sizingValue: getSizingValue(config),
        slippage: `${(config.trading.slippage * 100).toFixed(1)}%`,
        pollingInterval: `${config.polling.intervalMs}ms`,
        riskLimits: {
          maxPerTrade: config.risk.maxUsdPerTrade,
          maxPerMarket: config.risk.maxUsdPerMarket,
          maxDailyVolume: config.risk.maxDailyUsdVolume,
        },
        dailyStats: {
          date: dailyVolume.date,
          volumeUsed: dailyVolume.totalUsd,
          volumeRemaining: Math.max(
            0,
            config.risk.maxDailyUsdVolume - dailyVolume.totalUsd
          ),
        },
        allowlist: config.risk.marketAllowlist,
        denylist: config.risk.marketDenylist,
      };

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      // Pretty print status
      console.log(chalk.bold.cyan("\n📊 Polymarket Copy Trader Status\n"));
      console.log(chalk.gray("─".repeat(50)));

      // Configuration status
      console.log(chalk.bold("Configuration:"));
      console.log(`  ${chalk.cyan("Targets:")} ${status.targets.length}`);
      status.targets.forEach((t) => {
        console.log(`    ${chalk.gray("•")} ${t}`);
      });

      // Show trading mode (Dry Run / Paper Trading / Live)
      let modeDisplay: string;
      if (status.mode === "dry-run") {
        modeDisplay = chalk.yellow("DRY RUN");
      } else if (env.paperTrading) {
        modeDisplay = chalk.blue("PAPER TRADING");
      } else {
        modeDisplay = chalk.red("LIVE");
      }
      console.log(`  ${chalk.cyan("Mode:")} ${modeDisplay}`);
      console.log(
        `  ${chalk.cyan("Sizing:")} ${status.sizingMode} (${
          status.sizingValue
        })`
      );
      console.log(`  ${chalk.cyan("Slippage:")} ${status.slippage}`);
      console.log(`  ${chalk.cyan("Polling:")} ${status.pollingInterval}`);

      console.log(chalk.gray("─".repeat(50)));

      // Risk limits
      console.log(chalk.bold("Risk Limits:"));
      const maxTrade = status.riskLimits.maxPerTrade;
      const maxMarket = status.riskLimits.maxPerMarket;
      const maxDaily = status.riskLimits.maxDailyVolume;
      console.log(
        `  ${chalk.cyan("Max per Trade:")} $${
          maxTrade > 1e9 ? "unlimited" : maxTrade.toLocaleString()
        }`
      );
      console.log(
        `  ${chalk.cyan("Max per Market:")} $${
          maxMarket > 1e9 ? "unlimited" : maxMarket.toLocaleString()
        }`
      );
      console.log(
        `  ${chalk.cyan("Max Daily Volume:")} $${
          maxDaily > 1e9 ? "unlimited" : maxDaily.toLocaleString()
        }`
      );

      console.log(chalk.gray("─".repeat(50)));

      // Daily stats
      console.log(
        chalk.bold("Daily Stats:"),
        chalk.gray(`(${status.dailyStats.date})`)
      );
      console.log(
        `  ${chalk.cyan(
          "Volume Used:"
        )} $${status.dailyStats.volumeUsed.toFixed(2)}`
      );

      // Only show remaining and progress bar if there's an actual limit
      if (maxDaily <= 1e9) {
        console.log(
          `  ${chalk.cyan(
            "Volume Remaining:"
          )} $${status.dailyStats.volumeRemaining.toFixed(2)}`
        );

        // Progress bar for daily volume
        const volumePercent =
          (status.dailyStats.volumeUsed / config.risk.maxDailyUsdVolume) * 100;
        const progressWidth = 30;
        const filledWidth = Math.min(
          progressWidth,
          Math.round((volumePercent / 100) * progressWidth)
        );
        const emptyWidth = progressWidth - filledWidth;
        const progressBar =
          chalk.green("█".repeat(filledWidth)) +
          chalk.gray("░".repeat(emptyWidth));
        console.log(`  ${progressBar} ${volumePercent.toFixed(1)}%`);
      }

      console.log(chalk.gray("─".repeat(50)));

      // Market filters
      if (status.allowlist.length > 0 || status.denylist.length > 0) {
        console.log(chalk.bold("Market Filters:"));
        if (status.allowlist.length > 0) {
          console.log(
            `  ${chalk.green("Allowlist:")} ${status.allowlist.join(", ")}`
          );
        }
        if (status.denylist.length > 0) {
          console.log(
            `  ${chalk.red("Denylist:")} ${status.denylist.join(", ")}`
          );
        }
        console.log(chalk.gray("─".repeat(50)));
      }

      // Quick actions
      console.log(chalk.bold("Quick Actions:"));
      console.log(`  ${chalk.cyan("Start bot:")} pmcopy run`);
      console.log(`  ${chalk.cyan("Add target:")} pmcopy targets add 0x...`);
      console.log(
        `  ${chalk.cyan("Update config:")} pmcopy config set <key> <value>`
      );

      console.log();

      await persistence.close();
    });

  return command;
}

function getSizingValue(config: {
  trading: {
    sizingMode: string;
    fixedUsdSize: number;
    fixedSharesSize: number;
    proportionalMultiplier: number;
  };
}): string {
  switch (config.trading.sizingMode) {
    case "fixed_usd":
      return `$${config.trading.fixedUsdSize}`;
    case "fixed_shares":
      return `${config.trading.fixedSharesSize} shares`;
    case "proportional":
      return `${config.trading.proportionalMultiplier}x`;
    default:
      return "unknown";
  }
}
