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
        const stats = paperManager.getStats();
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      // Pretty print stats
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
