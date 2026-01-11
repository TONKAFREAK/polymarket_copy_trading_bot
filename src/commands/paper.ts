/**
 * Paper trading management commands
 * - View positions
 * - Force settle expired positions
 * - Reset paper trading account
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { PaperTradingManager } from "../copier/paperTrading";
import { getEnvConfig } from "../config/env";

export function createPaperCommand(): Command {
  const paper = new Command("paper").description(
    "Paper trading management commands"
  );

  // Show positions
  paper
    .command("positions")
    .description("Show current paper trading positions")
    .action(async () => {
      const env = getEnvConfig();
      const manager = new PaperTradingManager(
        "./data",
        env.paperStartingBalance
      );
      const state = manager.getState();

      console.log(chalk.bold("\n📊 Paper Trading Positions\n"));

      const positions = Object.values(state.positions);
      const openPositions = positions.filter((p) => !p.settled && p.shares > 0);
      const settledPositions = positions.filter((p) => p.settled);

      console.log(chalk.gray("─".repeat(70)));
      console.log(
        chalk.bold(
          `Balance: ${chalk.green("$" + state.currentBalance.toFixed(2))}`
        )
      );
      console.log(
        chalk.bold(
          `Starting: $${state.startingBalance.toFixed(2)} | P&L: ${
            state.stats.totalRealizedPnl >= 0
              ? chalk.green("+$" + state.stats.totalRealizedPnl.toFixed(2))
              : chalk.red(
                  "-$" + Math.abs(state.stats.totalRealizedPnl).toFixed(2)
                )
          }`
        )
      );
      console.log(chalk.gray("─".repeat(70)));

      if (openPositions.length === 0) {
        console.log(chalk.yellow("\nNo open positions."));
      } else {
        console.log(
          chalk.bold(`\n📈 Open Positions (${openPositions.length}):\n`)
        );

        for (const pos of openPositions) {
          const isExpired = isMarketExpired(pos.marketSlug);
          const statusTag = isExpired
            ? chalk.red("[EXPIRED]")
            : pos.resolved
            ? chalk.yellow("[RESOLVED]")
            : chalk.green("[OPEN]");

          console.log(`  ${statusTag} ${chalk.cyan(pos.marketSlug)}`);
          console.log(
            `    ${pos.outcome} | ${pos.shares.toFixed(
              2
            )} shares @ $${pos.avgEntryPrice.toFixed(4)}`
          );
          console.log(
            `    Cost: $${pos.totalCost.toFixed(
              2
            )} | Token: ${pos.tokenId.substring(0, 20)}...`
          );
          console.log("");
        }
      }

      console.log(chalk.gray("─".repeat(70)));
      console.log(
        `Total Settled: ${settledPositions.length} | ` +
          `Wins: ${state.stats.winningTrades} | Losses: ${state.stats.losingTrades} | ` +
          `Win Rate: ${state.stats.winRate.toFixed(1)}%`
      );
      console.log(chalk.gray("─".repeat(70)));
      console.log("");
    });

  // Force settle expired positions
  paper
    .command("settle")
    .description(
      "Force settle expired positions that couldn't be resolved via API"
    )
    .option("-w, --win", "Assume all positions won (default is loss)")
    .option(
      "-m, --market <slug>",
      "Only settle positions in this specific market"
    )
    .action(async (options) => {
      const env = getEnvConfig();
      const manager = new PaperTradingManager(
        "./data",
        env.paperStartingBalance
      );

      const expiredPositions = manager.getExpiredPositions();
      const targetPositions = options.market
        ? expiredPositions.filter((p) => p.marketSlug === options.market)
        : expiredPositions;

      if (targetPositions.length === 0) {
        console.log(chalk.yellow("\nNo expired positions to settle."));
        return;
      }

      console.log(chalk.bold("\n⚠️  Force Settle Expired Positions\n"));
      console.log(chalk.gray("─".repeat(60)));
      console.log(
        `Positions to settle: ${chalk.bold(targetPositions.length.toString())}`
      );
      console.log(
        `Assumed outcome: ${
          options.win ? chalk.green("WIN ($1.00)") : chalk.red("LOSS ($0.00)")
        }`
      );
      console.log(chalk.gray("─".repeat(60)));

      for (const pos of targetPositions) {
        console.log(`  ${chalk.cyan(pos.marketSlug)}`);
        console.log(
          `    ${pos.outcome} | ${pos.shares.toFixed(
            2
          )} shares @ $${pos.avgEntryPrice.toFixed(4)}`
        );
        console.log(`    Cost: $${pos.totalCost.toFixed(2)}`);
      }

      console.log("");

      const spinner = ora("Settling positions...").start();

      try {
        const result = await manager.settleExpiredPositions(
          !!options.win,
          options.market
        );

        spinner.succeed("Positions settled");

        console.log(chalk.gray("─".repeat(60)));
        console.log(
          `Settled: ${chalk.bold(result.settled.toString())} positions`
        );
        console.log(
          `Total P&L: ${
            result.totalPnl >= 0
              ? chalk.green("+$" + result.totalPnl.toFixed(2))
              : chalk.red("-$" + Math.abs(result.totalPnl).toFixed(2))
          }`
        );
        console.log(chalk.gray("─".repeat(60)));
        console.log("");
      } catch (error) {
        spinner.fail("Failed to settle positions");
        console.error(chalk.red((error as Error).message));
      }
    });

  // Show stats
  paper
    .command("stats")
    .description("Show paper trading statistics")
    .action(async () => {
      const env = getEnvConfig();
      const manager = new PaperTradingManager(
        "./data",
        env.paperStartingBalance
      );
      const stats = manager.getFormattedStats();
      console.log(stats);
    });

  // Reset paper trading
  paper
    .command("reset")
    .description("Reset paper trading account to starting balance")
    .option("-b, --balance <amount>", "Starting balance (default from config)")
    .action(async (options) => {
      const env = getEnvConfig();
      const balance = options.balance
        ? parseFloat(options.balance)
        : env.paperStartingBalance;

      console.log(
        chalk.yellow(`\n⚠️  This will reset all paper trading data!\n`)
      );
      console.log(`New starting balance: $${balance.toFixed(2)}\n`);

      const manager = new PaperTradingManager(
        "./data",
        env.paperStartingBalance
      );
      manager.reset(balance);

      console.log(chalk.green("✅ Paper trading account reset.\n"));
    });

  return paper;
}

/**
 * Check if a market is expired based on its slug timestamp
 * Slug format: "btc-updown-15m-1768032000" where the number is Unix timestamp
 */
function isMarketExpired(slug: string): boolean {
  const match = slug.match(/(\d{10})$/);
  if (match) {
    const marketTimestamp = parseInt(match[1], 10) * 1000;
    const now = Date.now();
    return now > marketTimestamp + 5 * 60 * 1000; // 5 min after expiry
  }
  return false;
}
