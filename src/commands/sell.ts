/**
 * Sell command - Sell positions at the best available price
 *
 * This command allows you to sell your positions on Polymarket.
 * You can sell all positions at once, or specify a specific token ID.
 * Orders are placed at the best bid price with optional slippage tolerance.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getEnvConfig } from "../config/env";
import { getLogger } from "../utils/logger";
import { ClobClientWrapper } from "../polymarket/clobClient";
import { getDataApiClient } from "../polymarket/dataApi";

const logger = getLogger();

interface Position {
  tokenId: string;
  outcome: string;
  shares: number;
  avgEntryPrice: number;
  currentValue: number;
  market: string;
  conditionId?: string;
  isRedeemable?: boolean;
}

interface SellResult {
  tokenId: string;
  market: string;
  outcome: string;
  shares: number;
  price: number;
  value: number;
  success: boolean;
  orderId?: string;
  error?: string;
}

/**
 * Get the best bid price for a token
 */
async function getBestBidPrice(
  clobClient: ClobClientWrapper,
  tokenId: string
): Promise<number | null> {
  try {
    // Access the underlying CLOB client
    const client = (clobClient as any).client;
    if (!client) {
      logger.error("CLOB client not available");
      return null;
    }

    // Get the best price for selling (best bid)
    const priceData = await client.getPrice(tokenId, "SELL");

    if (priceData && priceData.price) {
      return parseFloat(priceData.price);
    }

    return null;
  } catch (error) {
    logger.error("Failed to get best bid price", {
      tokenId,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Sell a position at the best available price
 */
async function sellPosition(
  clobClient: ClobClientWrapper,
  position: Position,
  slippage: number = 0.02, // 2% slippage by default
  dryRun: boolean = false
): Promise<SellResult> {
  const result: SellResult = {
    tokenId: position.tokenId,
    market: position.market,
    outcome: position.outcome,
    shares: position.shares,
    price: 0,
    value: 0,
    success: false,
  };

  try {
    // Get the best bid price
    const bestBid = await getBestBidPrice(clobClient, position.tokenId);

    if (!bestBid || bestBid <= 0) {
      result.error = "No bids available - market may be illiquid";
      return result;
    }

    // Apply slippage to get the minimum acceptable price
    const minPrice = Math.max(bestBid * (1 - slippage), 0.01);
    const roundedPrice = Math.round(minPrice * 100) / 100;

    result.price = roundedPrice;
    result.value = roundedPrice * position.shares;

    logger.info("Selling position", {
      market: position.market.substring(0, 40),
      outcome: position.outcome,
      shares: position.shares,
      bestBid,
      sellPrice: roundedPrice,
      estimatedValue: result.value.toFixed(2),
    });

    if (dryRun) {
      result.success = true;
      result.orderId = `DRY_RUN_${Date.now()}`;
      return result;
    }

    // Place the sell order using the marketable limit order approach
    const orderResult = await clobClient.placeMarketableLimitOrder(
      position.tokenId,
      "SELL",
      bestBid, // Target price is best bid
      position.shares,
      slippage
    );

    if (orderResult.success) {
      result.success = true;
      result.orderId = orderResult.orderId;
      result.price = orderResult.executedPrice || roundedPrice;
      result.value = result.price * position.shares;
    } else {
      result.error = orderResult.errorMessage || "Order placement failed";
    }

    return result;
  } catch (error) {
    result.error = (error as Error).message;
    return result;
  }
}

/**
 * Main sell function - can be called programmatically
 */
export async function sellPositions(options: {
  tokenId?: string;
  all?: boolean;
  slippage?: number;
  dryRun?: boolean;
}): Promise<SellResult[]> {
  const env = getEnvConfig();
  const results: SellResult[] = [];

  if (!env.privateKey) {
    throw new Error("PRIVATE_KEY not set in environment");
  }

  // Initialize CLOB client
  const clobClient = new ClobClientWrapper({
    privateKey: env.privateKey,
    chainId: env.chainId,
  });
  await clobClient.initialize();

  // Get Data API client for fetching positions
  const dataApi = getDataApiClient();

  // Get user's wallet address
  let userWallet = env.polyFunderAddress;
  if (!userWallet) {
    userWallet = clobClient.getWalletAddress();
  }

  if (!userWallet) {
    throw new Error("No wallet address available");
  }

  // Fetch current positions
  const apiPositions = await dataApi.fetchPositions(userWallet);

  // Convert to our position format
  const positions: Position[] = apiPositions
    .filter((p) => p.size > 0.01) // Only positions with meaningful size
    .map((pos) => ({
      tokenId: pos.asset,
      outcome: pos.outcome || "Yes",
      shares: pos.size,
      avgEntryPrice: pos.avgPrice,
      currentValue: pos.currentValue,
      market: pos.title || "Unknown",
      conditionId: pos.conditionId,
      isRedeemable: pos.redeemable,
    }));

  if (positions.length === 0) {
    logger.info("No positions to sell");
    return results;
  }

  // Filter positions based on options
  let positionsToSell: Position[];

  if (options.tokenId) {
    // Sell specific token
    positionsToSell = positions.filter(
      (p) => p.tokenId.toLowerCase() === options.tokenId!.toLowerCase()
    );
    if (positionsToSell.length === 0) {
      throw new Error(`No position found with token ID: ${options.tokenId}`);
    }
  } else if (options.all) {
    // Sell all positions (excluding redeemable ones - those should be redeemed instead)
    positionsToSell = positions.filter((p) => !p.isRedeemable);
    if (positionsToSell.length === 0) {
      logger.info("No sellable positions (all may be redeemable)");
      return results;
    }
  } else {
    throw new Error("Must specify --all or --token-id");
  }

  // Sell each position
  for (const position of positionsToSell) {
    const result = await sellPosition(
      clobClient,
      position,
      options.slippage || 0.02,
      options.dryRun || false
    );
    results.push(result);

    // Small delay between orders to avoid rate limiting
    if (positionsToSell.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Create the sell command
 */
export function createSellCommand(): Command {
  const command = new Command("sell")
    .description("Sell positions at the best available price")
    .option("--all", "Sell all positions")
    .option("--token-id <tokenId>", "Sell a specific position by token ID")
    .option(
      "--slippage <percent>",
      "Slippage tolerance in percent (default: 2)",
      "2"
    )
    .option("--dry-run", "Simulate the sell without executing")
    .action(async (opts) => {
      const spinner = ora("Initializing...").start();

      try {
        // Parse slippage
        const slippage = parseFloat(opts.slippage) / 100;
        if (isNaN(slippage) || slippage < 0 || slippage > 0.5) {
          throw new Error("Slippage must be between 0 and 50 percent");
        }

        // Validate options
        if (!opts.all && !opts.tokenId) {
          spinner.fail("Must specify --all or --token-id");
          console.log(chalk.gray("\nExamples:"));
          console.log(chalk.gray("  npx pmcopy sell --all"));
          console.log(chalk.gray("  npx pmcopy sell --token-id 123456..."));
          console.log(chalk.gray("  npx pmcopy sell --all --slippage 5"));
          console.log(chalk.gray("  npx pmcopy sell --all --dry-run"));
          return;
        }

        spinner.text = "Fetching positions...";

        const results = await sellPositions({
          tokenId: opts.tokenId,
          all: opts.all,
          slippage,
          dryRun: opts.dryRun,
        });

        spinner.stop();

        if (results.length === 0) {
          console.log(chalk.yellow("\n⚠️  No positions to sell"));
          return;
        }

        // Display results
        console.log(
          chalk.bold(
            `\n${opts.dryRun ? "🧪 DRY RUN - " : ""}📤 Sell Results:\n`
          )
        );
        console.log(chalk.gray("─".repeat(70)));

        let totalValue = 0;
        let successCount = 0;

        for (const result of results) {
          const marketName =
            result.market.length > 40
              ? result.market.substring(0, 37) + "..."
              : result.market;

          if (result.success) {
            successCount++;
            totalValue += result.value;
            console.log(
              chalk.green("✓"),
              chalk.white(marketName),
              chalk.gray(`(${result.outcome})`)
            );
            console.log(
              chalk.gray("  "),
              chalk.cyan(`${result.shares.toFixed(2)} shares`),
              chalk.gray("@"),
              chalk.yellow(`$${result.price.toFixed(2)}`),
              chalk.gray("="),
              chalk.green(`$${result.value.toFixed(2)}`)
            );
            if (result.orderId) {
              console.log(
                chalk.gray("  Order ID:"),
                chalk.gray(result.orderId.substring(0, 20) + "...")
              );
            }
          } else {
            console.log(
              chalk.red("✗"),
              chalk.white(marketName),
              chalk.gray(`(${result.outcome})`)
            );
            console.log(
              chalk.gray("  "),
              chalk.red(`Error: ${result.error || "Unknown error"}`)
            );
          }
          console.log();
        }

        console.log(chalk.gray("─".repeat(70)));
        console.log(
          chalk.bold("Summary:"),
          chalk.green(`${successCount}/${results.length} orders placed`)
        );
        console.log(
          chalk.bold("Total Value:"),
          chalk.green(`$${totalValue.toFixed(2)}`)
        );

        if (opts.dryRun) {
          console.log(
            chalk.yellow("\n⚠️  This was a dry run. No orders were placed.")
          );
        }
      } catch (error) {
        spinner.fail("Failed to sell positions");
        console.error(chalk.red((error as Error).message));
        logger.error("Sell command failed", {
          error: (error as Error).message,
        });
        process.exit(1);
      }
    });

  return command;
}
