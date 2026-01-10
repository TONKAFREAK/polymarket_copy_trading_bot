/**
 * Stats command - show paper trading performance
 */

import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import { getEnvConfig } from "../config/env";
import { getPaperTradingManager } from "../copier/paperTrading";

export function createStatsCommand(): Command {
  const command = new Command("stats")
    .description("Show paper trading statistics and PnL")
    .option("-j, --json", "Output as JSON")
    .option("-c, --csv", "Export trades to CSV")
    .option("-r, --reset", "Reset paper trading account")
    .option("-w, --watch", "Live stats mode - auto-refresh every few seconds")
    .option(
      "-i, --interval <seconds>",
      "Refresh interval for watch mode (default: 10)",
      parseFloat
    )
    .option("-s, --settle", "Force settlement check for resolved markets")
    .option(
      "-b, --balance <amount>",
      "Set starting balance when resetting",
      parseFloat
    )
    .action(async (options) => {
      const env = getEnvConfig();

      if (!env.paperTrading) {
        console.log(chalk.yellow("\n⚠️  Paper trading is not enabled."));
        console.log(
          chalk.gray("Set PAPER_TRADING=true in your .env file to enable it.\n")
        );
        return;
      }

      const paperManager = getPaperTradingManager(
        env.dataDir,
        env.paperStartingBalance
      );

      // Reset account if requested
      if (options.reset) {
        const balance = options.balance || env.paperStartingBalance;
        paperManager.reset(balance);
        console.log(
          chalk.green(
            `\n✅ Paper trading account reset with $${balance.toFixed(
              2
            )} balance.\n`
          )
        );
        return;
      }

      // Export to CSV if requested
      if (options.csv) {
        const csv = paperManager.exportTradesToCsv();
        const csvFile = path.join(env.dataDir, "paper-trades.csv");
        fs.writeFileSync(csvFile, csv);
        console.log(chalk.green(`\n✅ Trades exported to ${csvFile}\n`));
        return;
      }

      // JSON output
      if (options.json) {
        await paperManager.updatePrices();
        const stats = paperManager.getStats();
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      // Force settlement check
      if (options.settle) {
        console.log(
          chalk.cyan("\n🔄 Checking for resolved markets to settle...\n")
        );
        const result = await paperManager.settleResolvedPositions();
        if (result.settled > 0) {
          console.log(chalk.green(`✅ Settled ${result.settled} position(s):`));
          console.log(
            chalk.gray(`   Wins: ${result.wins}, Losses: ${result.losses}`)
          );
          console.log(
            chalk.gray(`   Total P&L: $${result.totalPnl.toFixed(2)}\n`)
          );
        } else {
          console.log(chalk.gray("No positions to settle.\n"));
        }
      }

      // Watch mode - live stats
      if (options.watch) {
        const interval = (options.interval || 10) * 1000;
        console.log(
          chalk.cyan(
            `\n📊 Live Stats Mode - Refreshing every ${interval / 1000}s`
          )
        );
        console.log(chalk.gray("Press Ctrl+C to exit\n"));

        const updateStats = async () => {
          try {
            // Clear console (except on first run)
            console.clear();
            console.log(
              chalk.cyan(
                `📊 Live Stats Mode - Refreshing every ${interval / 1000}s`
              )
            );
            console.log(
              chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`)
            );
            console.log(chalk.gray("Press Ctrl+C to exit\n"));

            await paperManager.updatePrices();
            console.log(paperManager.getFormattedStats());
          } catch (error) {
            console.error(
              chalk.red("Error updating stats:"),
              (error as Error).message
            );
          }
        };

        // Initial update
        await updateStats();

        // Set up interval
        const timer = setInterval(updateStats, interval);

        // Handle exit
        process.on("SIGINT", () => {
          clearInterval(timer);
          console.log(chalk.gray("\n\n👋 Live stats stopped.\n"));
          process.exit(0);
        });

        // Keep process running
        await new Promise(() => {});
        return;
      }

      // Pretty print stats (one-time)
      await paperManager.updatePrices();
      console.log("\n" + paperManager.getFormattedStats() + "\n");

      // Show tips
      const stats = paperManager.getStats();
      if (stats.totalTrades === 0) {
        console.log(
          chalk.gray(
            '💡 Tip: Run "pmcopy run" to start copying trades in paper mode.'
          )
        );
      } else if (stats.totalReturn > 0) {
        console.log(
          chalk.green(
            "📈 Your copy trading strategy is profitable in paper mode!"
          )
        );
        console.log(
          chalk.gray(
            "   Consider running with real funds when you are confident."
          )
        );
      } else if (stats.totalReturn < -10) {
        console.log(
          chalk.yellow("📉 The strategy is showing losses. Consider:")
        );
        console.log(chalk.gray("   - Reviewing target wallet selections"));
        console.log(chalk.gray("   - Adjusting sizing and risk settings"));
        console.log(
          chalk.gray("   - Adding market allowlist/denylist filters")
        );
      }

      console.log("");
      console.log(chalk.gray("Commands:"));
      console.log(
        chalk.gray("  pmcopy stats                 Show current stats")
      );
      console.log(
        chalk.gray("  pmcopy stats --watch         Live stats (auto-refresh)")
      );
      console.log(
        chalk.gray("  pmcopy stats --watch -i 5    Live stats every 5 seconds")
      );
      console.log(
        chalk.gray(
          "  pmcopy stats --settle        Force settlement of resolved markets"
        )
      );
      console.log(
        chalk.gray("  pmcopy stats --reset         Reset paper account")
      );
      console.log(
        chalk.gray("  pmcopy stats --reset -b 500  Reset with $500 balance")
      );
      console.log(
        chalk.gray("  pmcopy stats --csv           Export trades to CSV")
      );
      console.log(chalk.gray("  pmcopy stats --json          Output as JSON"));
      console.log("");
    });

  return command;
}
