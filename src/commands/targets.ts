/**
 * Targets command - manage target wallets
 */

import { Command } from "commander";
import chalk from "chalk";
import { getConfigManager } from "../config";
import { getEnvConfig } from "../config/env";
import { isValidAddress } from "../utils/http";

export function createTargetsCommand(): Command {
  const command = new Command("targets").description(
    "Manage target wallets to copy"
  );

  // Add subcommand
  command
    .command("add <address>")
    .description("Add a target wallet address")
    .action((address: string) => {
      const env = getEnvConfig();
      const configManager = getConfigManager(env.dataDir);

      // Validate address
      if (!isValidAddress(address)) {
        console.log(chalk.red(`\n❌ Invalid Ethereum address: ${address}`));
        console.log(
          chalk.gray("Address should be 42 characters starting with 0x")
        );
        process.exit(1);
      }

      // Add target
      const added = configManager.addTarget(address);

      if (added) {
        console.log(chalk.green(`\n✅ Target added: ${address}`));
      } else {
        console.log(chalk.yellow(`\n⚠️  Target already exists: ${address}`));
      }

      // Show current targets
      const targets = configManager.getTargets();
      console.log(chalk.gray(`\nTotal targets: ${targets.length}`));
    });

  // Remove subcommand
  command
    .command("remove <address>")
    .alias("rm")
    .description("Remove a target wallet address")
    .action((address: string) => {
      const env = getEnvConfig();
      const configManager = getConfigManager(env.dataDir);

      const removed = configManager.removeTarget(address);

      if (removed) {
        console.log(chalk.green(`\n✅ Target removed: ${address}`));
      } else {
        console.log(chalk.yellow(`\n⚠️  Target not found: ${address}`));
      }

      // Show remaining targets
      const targets = configManager.getTargets();
      console.log(chalk.gray(`\nRemaining targets: ${targets.length}`));
    });

  // List subcommand
  command
    .command("list")
    .alias("ls")
    .description("List all target wallets")
    .option("-j, --json", "Output as JSON")
    .action((options) => {
      const env = getEnvConfig();
      const configManager = getConfigManager(env.dataDir);
      const targets = configManager.getTargets();

      if (options.json) {
        console.log(JSON.stringify({ targets }, null, 2));
        return;
      }

      console.log(chalk.bold.cyan("\n📋 Target Wallets\n"));

      if (targets.length === 0) {
        console.log(chalk.yellow("No targets configured."));
        console.log(chalk.gray("\nAdd targets with: pmcopy targets add 0x..."));
      } else {
        console.log(chalk.gray("─".repeat(50)));
        targets.forEach((target, index) => {
          console.log(`  ${chalk.cyan(`${index + 1}.`)} ${target}`);
        });
        console.log(chalk.gray("─".repeat(50)));
        console.log(chalk.gray(`\nTotal: ${targets.length} target(s)`));
      }
    });

  // Clear subcommand
  command
    .command("clear")
    .description("Remove all targets")
    .option("-f, --force", "Skip confirmation")
    .action((options) => {
      const env = getEnvConfig();
      const configManager = getConfigManager(env.dataDir);
      const targets = configManager.getTargets();

      if (targets.length === 0) {
        console.log(chalk.yellow("\nNo targets to clear."));
        return;
      }

      if (!options.force) {
        console.log(
          chalk.yellow(
            `\n⚠️  This will remove all ${targets.length} target(s).`
          )
        );
        console.log(chalk.gray("Use --force to skip this confirmation."));
        process.exit(0);
      }

      configManager.setTargets([]);
      console.log(chalk.green(`\n✅ Cleared all ${targets.length} target(s).`));
    });

  return command;
}
