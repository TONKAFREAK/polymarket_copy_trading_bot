/**
 * Config command - manage configuration
 */

import { Command } from "commander";
import chalk from "chalk";
import { getConfigManager, ConfigManager } from "../config";
import { getEnvConfig } from "../config/env";

export function createConfigCommand(): Command {
  const command = new Command("config").description(
    "Manage configuration settings"
  );

  // Get subcommand
  command
    .command("get [key]")
    .description("Get configuration value(s)")
    .option("-j, --json", "Output as JSON")
    .action((key: string | undefined, options) => {
      const env = getEnvConfig();
      const configManager = getConfigManager(env.dataDir);

      if (key) {
        // Get specific key
        const value = configManager.get(key);

        if (value === undefined) {
          console.log(chalk.red(`\n❌ Unknown configuration key: ${key}`));
          console.log(chalk.gray("\nAvailable keys:"));
          ConfigManager.getConfigKeys().forEach((k) => {
            console.log(chalk.gray(`  • ${k}`));
          });
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify({ [key]: value }, null, 2));
        } else {
          console.log(`${chalk.cyan(key)}: ${formatValue(value)}`);
        }
      } else {
        // Get all config
        const config = configManager.getConfig();

        if (options.json) {
          console.log(JSON.stringify(config, null, 2));
          return;
        }

        console.log(chalk.bold.cyan("\n⚙️  Configuration\n"));
        console.log(chalk.gray("─".repeat(50)));

        // Trading config
        console.log(chalk.bold("\nTrading:"));
        console.log(
          `  ${chalk.cyan("sizingMode:")} ${config.trading.sizingMode}`
        );
        console.log(
          `  ${chalk.cyan("fixedUsdSize:")} $${config.trading.fixedUsdSize}`
        );
        console.log(
          `  ${chalk.cyan("fixedSharesSize:")} ${
            config.trading.fixedSharesSize
          }`
        );
        console.log(
          `  ${chalk.cyan("proportionalMultiplier:")} ${
            config.trading.proportionalMultiplier
          }x`
        );
        console.log(
          `  ${chalk.cyan("slippage:")} ${(
            config.trading.slippage * 100
          ).toFixed(1)}%`
        );

        // Risk config
        console.log(chalk.bold("\nRisk:"));
        const maxTrade = config.risk.maxUsdPerTrade;
        const maxMarket = config.risk.maxUsdPerMarket;
        const maxDaily = config.risk.maxDailyUsdVolume;
        console.log(
          `  ${chalk.cyan("maxUsdPerTrade:")} $${
            maxTrade > 1e9 ? "unlimited" : maxTrade.toLocaleString()
          }`
        );
        console.log(
          `  ${chalk.cyan("maxUsdPerMarket:")} $${
            maxMarket > 1e9 ? "unlimited" : maxMarket.toLocaleString()
          }`
        );
        console.log(
          `  ${chalk.cyan("maxDailyUsdVolume:")} $${
            maxDaily > 1e9 ? "unlimited" : maxDaily.toLocaleString()
          }`
        );
        console.log(
          `  ${chalk.cyan("dryRun:")} ${
            config.risk.dryRun ? chalk.yellow("true") : chalk.red("false")
          }`
        );

        if (config.risk.marketAllowlist.length > 0) {
          console.log(
            `  ${chalk.cyan(
              "marketAllowlist:"
            )} ${config.risk.marketAllowlist.join(", ")}`
          );
        }
        if (config.risk.marketDenylist.length > 0) {
          console.log(
            `  ${chalk.cyan(
              "marketDenylist:"
            )} ${config.risk.marketDenylist.join(", ")}`
          );
        }

        // Polling config
        console.log(chalk.bold("\nPolling:"));
        console.log(
          `  ${chalk.cyan("intervalMs:")} ${config.polling.intervalMs}ms`
        );
        console.log(
          `  ${chalk.cyan("tradeLimit:")} ${config.polling.tradeLimit}`
        );
        console.log(
          `  ${chalk.cyan("maxRetries:")} ${config.polling.maxRetries}`
        );

        // General
        console.log(chalk.bold("\nGeneral:"));
        console.log(`  ${chalk.cyan("chainId:")} ${config.chainId}`);
        console.log(
          `  ${chalk.cyan("targets:")} ${config.targets.length} wallet(s)`
        );

        console.log("\n" + chalk.gray("─".repeat(50)));
        console.log(
          chalk.gray("\nUse: pmcopy config set <key> <value> to update\n")
        );
      }
    });

  // Set subcommand
  command
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      const env = getEnvConfig();
      const configManager = getConfigManager(env.dataDir);

      // Validate key
      const validKeys = ConfigManager.getConfigKeys();
      if (!validKeys.includes(key)) {
        console.log(chalk.red(`\n❌ Unknown configuration key: ${key}`));
        console.log(chalk.gray("\nAvailable keys:"));
        validKeys.forEach((k) => {
          console.log(chalk.gray(`  • ${k}`));
        });
        process.exit(1);
      }

      // Set the value
      const success = configManager.set(key, value);

      if (success) {
        const newValue = configManager.get(key);
        console.log(chalk.green(`\n✅ Configuration updated:`));
        console.log(`  ${chalk.cyan(key)}: ${formatValue(newValue)}`);

        // Warning for critical settings
        if (key === "risk.dryRun" && value === "false") {
          console.log(chalk.bgRed.white.bold("\n ⚠️  WARNING "));
          console.log(
            chalk.red(
              "Dry run mode disabled! Real money will be used for trades."
            )
          );
        }
      } else {
        console.log(chalk.red(`\n❌ Failed to set ${key}`));
        console.log(
          chalk.gray("Check that the value is valid for this setting.")
        );
      }
    });

  // Reset subcommand
  command
    .command("reset")
    .description("Reset configuration to defaults")
    .option("-f, --force", "Skip confirmation")
    .action((options) => {
      const env = getEnvConfig();
      const configManager = getConfigManager(env.dataDir);

      if (!options.force) {
        console.log(
          chalk.yellow("\n⚠️  This will reset all configuration to defaults.")
        );
        console.log(chalk.gray("Use --force to skip this confirmation."));
        process.exit(0);
      }

      configManager.reset();
      console.log(chalk.green("\n✅ Configuration reset to defaults."));
    });

  // List available keys
  command
    .command("keys")
    .description("List all available configuration keys")
    .action(() => {
      console.log(chalk.bold.cyan("\n⚙️  Available Configuration Keys\n"));
      console.log(chalk.gray("─".repeat(50)));

      const keys = ConfigManager.getConfigKeys();

      // Group by prefix
      const groups: Record<string, string[]> = {};
      for (const key of keys) {
        const prefix = key.split(".")[0];
        if (!groups[prefix]) {
          groups[prefix] = [];
        }
        groups[prefix].push(key);
      }

      for (const [group, groupKeys] of Object.entries(groups)) {
        console.log(chalk.bold(`\n${group}:`));
        for (const key of groupKeys) {
          console.log(`  ${chalk.cyan(key)}`);
        }
      }

      console.log(chalk.gray("\n─".repeat(50)));
      console.log(chalk.gray("\nUsage: pmcopy config set <key> <value>\n"));
    });

  return command;
}

/**
 * Format a configuration value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.gray("(not set)");
  }
  if (typeof value === "boolean") {
    return value ? chalk.green("true") : chalk.red("false");
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return chalk.gray("(empty)");
    }
    return value.join(", ");
  }
  if (typeof value === "number") {
    return chalk.yellow(value.toString());
  }
  return String(value);
}
