#!/usr/bin/env node

/**
 * Polymarket Copy Trader CLI
 *
 * A CLI tool for copy-trading on Polymarket prediction markets.
 *
 * ⚠️  WARNING: Trading prediction markets involves significant risk.
 * Only trade with money you can afford to lose. Always start with dry-run mode.
 */

import { Command } from "commander";
import chalk from "chalk";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

import {
  createInitCommand,
  createRunCommand,
  createStatusCommand,
  createTargetsCommand,
  createConfigCommand,
  createStatsCommand,
  createPaperCommand,
  createApproveCommand,
} from "./commands";
import { createRedeemCommand } from "./commands/redeemCmd";
import { createDiagnoseCommand } from "./commands/diagnose";

// ASCII Banner
const banner = `
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ██████╗  ██████╗ ██╗  ██╗   ██╗███╗   ███╗ █████╗ ██████╗   ║
║   ██╔══██╗██╔═══██╗██║  ╚██╗ ██╔╝████╗ ████║██╔══██╗██╔══██╗  ║
║   ██████╔╝██║   ██║██║   ╚████╔╝ ██╔████╔██║███████║██████╔╝  ║
║   ██╔═══╝ ██║   ██║██║    ╚██╔╝  ██║╚██╔╝██║██╔══██║██╔══██╗  ║
║   ██║     ╚██████╔╝███████╗██║   ██║ ╚═╝ ██║██║  ██║██║  ██║  ║
║   ╚═╝      ╚═════╝ ╚══════╝╚═╝   ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝  ║
║                                                               ║
║                     C O P Y   T R A D E R                     ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`;

// Create the CLI program
const program = new Command();

program
  .name("pmcopy")
  .description(
    "Polymarket Copy Trader - Automatically copy trades from target wallets"
  )
  .version("1.0.0")
  .hook("preAction", () => {
    // Don't show banner for status and simple commands
    const args = process.argv.slice(2);
    const silentCommands = ["status", "config", "targets"];
    const shouldShowBanner =
      args.length === 0 ||
      (args[0] && !silentCommands.some((cmd) => args[0].startsWith(cmd)));

    if (shouldShowBanner && args[0] !== "--help" && args[0] !== "-h") {
      console.log(chalk.cyan(banner));
    }
  });

// Add commands
program.addCommand(createInitCommand());
program.addCommand(createRunCommand());
program.addCommand(createStatusCommand());
program.addCommand(createTargetsCommand());
program.addCommand(createConfigCommand());
program.addCommand(createStatsCommand());
program.addCommand(createPaperCommand());
program.addCommand(createApproveCommand());
program.addCommand(createRedeemCommand());
program.addCommand(createDiagnoseCommand());

// Default action (no command)
program.action(() => {
  console.log(chalk.cyan(banner));
  console.log(chalk.bold("Welcome to Polymarket Copy Trader!\n"));

  console.log(chalk.yellow("⚠️  DISCLAIMER: "));
  console.log(
    chalk.gray(
      "Trading prediction markets involves significant financial risk."
    )
  );
  console.log(
    chalk.gray("Past performance does not guarantee future results.")
  );
  console.log(chalk.gray("Only trade with money you can afford to lose.\n"));

  console.log(chalk.bold("Quick Start:"));
  console.log(chalk.gray("─".repeat(50)));
  console.log(
    `  1. Copy ${chalk.cyan(".env.example")} to ${chalk.cyan(
      ".env"
    )} and configure`
  );
  console.log(
    `  2. Run ${chalk.cyan("pmcopy init --targets 0x...")} to initialize`
  );
  console.log(`  3. Run ${chalk.cyan("pmcopy run --dry-run")} to test`);
  console.log(`  4. Run ${chalk.cyan("pmcopy run")} to start live trading`);
  console.log(chalk.gray("─".repeat(50)));

  console.log(chalk.bold("\nAvailable Commands:"));
  console.log(`  ${chalk.cyan("init")}      Initialize configuration`);
  console.log(`  ${chalk.cyan("run")}       Start the copy trading bot`);
  console.log(`  ${chalk.cyan("approve")}   Approve on-chain allowances (required once)`);
  console.log(`  ${chalk.cyan("diagnose")}  Check wallet configuration and balances`);
  console.log(`  ${chalk.cyan("redeem")}    Redeem winnings from resolved markets`);
  console.log(`  ${chalk.cyan("status")}    Show current status`);
  console.log(`  ${chalk.cyan("stats")}     Show paper trading performance`);
  console.log(`  ${chalk.cyan("targets")}   Manage target wallets`);
  console.log(`  ${chalk.cyan("config")}    Manage configuration`);

  console.log(
    chalk.gray("\nRun pmcopy <command> --help for more information.\n")
  );
});

// Error handling
program.exitOverride((err) => {
  if (err.code === "commander.help") {
    process.exit(0);
  }
  if (err.code === "commander.version") {
    process.exit(0);
  }
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});

// Parse and execute
program.parse(process.argv);
