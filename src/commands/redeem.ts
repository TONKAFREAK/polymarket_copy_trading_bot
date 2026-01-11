/**
 * Redeem command - Claim winnings from resolved markets
 *
 * This command allows you to redeem your winning positions from
 * resolved Polymarket markets. It checks for redeemable tokens
 * and calls the CTF contract to convert them to USDC.
 */

import { ethers } from "ethers";
import { getEnvConfig } from "../config/env";
import { getLogger } from "../utils/logger";
import { ClobClientWrapper } from "../polymarket/clobClient";
import { getGammaApiClient } from "../polymarket/gammaApi";

const logger = getLogger();

// Contract addresses on Polygon Mainnet
const POLYGON_CONTRACTS = {
  exchange: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  negRiskExchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  collateral: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
};

// CTF ABI for redemption
const CTF_ABI = [
  // Check balance of a specific token
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  // Redeem positions after market is resolved
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
  // Get outcome slot count for a condition
  "function getOutcomeSlotCount(bytes32 conditionId) view returns (uint256)",
  // Check if condition is resolved
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
];

export interface RedeemablePosition {
  conditionId: string;
  tokenId: string;
  outcome: string;
  balance: string;
  marketName?: string;
  isResolved: boolean;
  isWinner: boolean;
}

/**
 * Check if a market condition is resolved and get payout info
 */
async function checkConditionResolution(
  ctf: ethers.Contract,
  conditionId: string
): Promise<{ isResolved: boolean; winningOutcome?: number }> {
  try {
    // conditionId should be a bytes32 hex string
    const conditionIdBytes32 = conditionId.startsWith("0x")
      ? conditionId
      : `0x${conditionId}`;

    // Check if condition has been resolved by checking payout denominator
    const payoutDenom = await ctf.payoutDenominator(conditionIdBytes32);
    const isResolved = payoutDenom.gt(0);

    if (isResolved) {
      // Find winning outcome
      const outcomeCount = await ctf.getOutcomeSlotCount(conditionIdBytes32);
      for (let i = 0; i < outcomeCount.toNumber(); i++) {
        const payoutNum = await ctf.payoutNumerators(conditionIdBytes32, i);
        if (payoutNum.gt(0)) {
          return { isResolved: true, winningOutcome: i };
        }
      }
    }

    return { isResolved, winningOutcome: undefined };
  } catch (error) {
    logger.error("Failed to check condition resolution", {
      conditionId,
      error: (error as Error).message,
    });
    return { isResolved: false };
  }
}

/**
 * Redeem positions for a resolved market
 */
async function redeemPosition(
  _wallet: ethers.Wallet,
  ctf: ethers.Contract,
  conditionId: string,
  gasSettings: { gasPrice: ethers.BigNumber; gasLimit: number }
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const conditionIdBytes32 = conditionId.startsWith("0x")
      ? conditionId
      : `0x${conditionId}`;

    // Get outcome count
    const outcomeCount = await ctf.getOutcomeSlotCount(conditionIdBytes32);

    // Create index sets for all outcomes
    // For binary markets (YES/NO), indexSets would be [1, 2] representing [01, 10] in binary
    const indexSets: number[] = [];
    for (let i = 0; i < outcomeCount.toNumber(); i++) {
      indexSets.push(1 << i); // 2^i
    }

    // Parent collection ID is usually 0x0 for top-level positions
    const parentCollectionId = ethers.constants.HashZero;

    console.log(
      `   📝 Redeeming position for condition ${conditionId.substring(
        0,
        10
      )}...`
    );

    const tx = await ctf.redeemPositions(
      POLYGON_CONTRACTS.collateral,
      parentCollectionId,
      conditionIdBytes32,
      indexSets,
      gasSettings
    );

    console.log(`   TX: ${tx.hash}`);
    console.log("   ⏳ Waiting for confirmation...");
    await tx.wait();

    return { success: true, txHash: tx.hash };
  } catch (error) {
    const errorMsg = (error as Error).message;
    logger.error("Failed to redeem position", {
      conditionId,
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  }
}

/**
 * Main redeem function - Lists positions and attempts redemption
 */
export async function redeemWinnings(): Promise<void> {
  const env = getEnvConfig();

  console.log("\n🎫 Polymarket Position Redemption\n");
  console.log("Checking your positions and redemption status...\n");

  // Setup wallet
  const provider = new ethers.providers.JsonRpcProvider(env.rpcUrl);
  const pk = env.privateKey.startsWith("0x")
    ? env.privateKey
    : `0x${env.privateKey}`;
  const wallet = new ethers.Wallet(pk, provider);

  console.log(`📍 Wallet Address: ${wallet.address}`);

  // Check MATIC balance for gas
  const maticBalance = await wallet.getBalance();
  const maticFormatted = ethers.utils.formatEther(maticBalance);
  console.log(`⛽ MATIC Balance: ${maticFormatted} MATIC`);

  if (maticBalance.lt(ethers.utils.parseEther("0.005"))) {
    console.log("\n❌ Insufficient MATIC for gas fees!");
    console.log("   You need at least 0.005 MATIC to redeem positions.");
    return;
  }

  // Check USDC balance before
  const usdc = new ethers.Contract(
    POLYGON_CONTRACTS.collateral,
    ERC20_ABI,
    provider
  );
  const usdcBefore = await usdc.balanceOf(wallet.address);
  console.log(
    `💰 USDC Balance: ${ethers.utils.formatUnits(usdcBefore, 6)} USDC\n`
  );

  // Initialize CLOB client to fetch positions
  console.log("📋 Fetching your positions...\n");

  try {
    const clobClient = new ClobClientWrapper({
      privateKey: env.privateKey,
      chainId: 137,
    });
    await clobClient.initialize();

    // Get positions from trades
    const { positions, totalValue } = await clobClient.getPositions();

    if (positions.length === 0) {
      console.log("ℹ️  No positions found.\n");
      console.log("This could mean:");
      console.log("  - You have no open positions");
      console.log("  - All positions have been redeemed");
      console.log("  - Trades haven't synced yet\n");
      return;
    }

    console.log(`Found ${positions.length} position(s):\n`);
    console.log("─".repeat(60));

    // Get Gamma API for market names and resolution status
    const gammaApi = getGammaApiClient();
    const ctf = new ethers.Contract(
      POLYGON_CONTRACTS.conditionalTokens,
      CTF_ABI,
      wallet
    );

    const redeemablePositions: Array<{
      tokenId: string;
      conditionId: string;
      shares: number;
      value: number;
      outcome: string;
      marketName: string;
    }> = [];

    for (const pos of positions) {
      // Try to get market info
      let marketName = "Unknown Market";
      let isResolved = false;
      let conditionId: string | null = null;

      try {
        const market = await gammaApi.getMarketByTokenId(pos.tokenId);
        if (market) {
          marketName = String(market.question || market.title || "Unknown");
          conditionId = market.conditionId ? String(market.conditionId) : null;

          // Check if market is resolved - ONLY if we have a valid condition ID
          if (
            conditionId &&
            conditionId.startsWith("0x") &&
            conditionId.length === 66
          ) {
            const resolution = await checkConditionResolution(ctf, conditionId);
            isResolved = resolution.isResolved;
          }
        }
      } catch {
        // Ignore errors fetching market info - market stays as not resolved
      }

      // Truncate market name for display
      if (marketName.length > 45) {
        marketName = marketName.substring(0, 42) + "...";
      }

      const statusIcon = isResolved ? "✅" : "⏳";
      const sharesStr = pos.shares.toFixed(2);
      const valueStr = `$${pos.currentValue.toFixed(2)}`;

      console.log(
        `${statusIcon} ${pos.outcome
          .toUpperCase()
          .padEnd(4)} | ${sharesStr.padStart(10)} shares | ${valueStr.padStart(
          10
        )}`
      );
      console.log(`   ${marketName}`);
      console.log(`   Token: ${pos.tokenId.substring(0, 20)}...`);

      if (isResolved && conditionId) {
        console.log(`   🎫 REDEEMABLE`);
        redeemablePositions.push({
          tokenId: pos.tokenId,
          conditionId,
          shares: pos.shares,
          value: pos.currentValue,
          outcome: pos.outcome,
          marketName,
        });
      }
      console.log("");
    }

    console.log("─".repeat(60));
    console.log(`Total Position Value: $${totalValue.toFixed(2)}\n`);

    if (redeemablePositions.length === 0) {
      console.log("ℹ️  No resolved markets to redeem.\n");
      console.log("Your positions are in active (unresolved) markets.");
      console.log("Once markets resolve, you can redeem winning positions.\n");
    } else {
      console.log(
        `\n🎉 Found ${redeemablePositions.length} redeemable position(s)!\n`
      );

      // Get gas settings
      const feeData = await provider.getFeeData();
      const baseGasPrice =
        feeData.gasPrice || ethers.utils.parseUnits("50", "gwei");
      const gasPrice = baseGasPrice.mul(120).div(100);
      const gasSettings = { gasPrice, gasLimit: 200_000 };

      console.log(
        `⛽ Gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei\n`
      );

      // Attempt to redeem each position
      let totalRedeemed = 0;

      for (const pos of redeemablePositions) {
        console.log(
          `Redeeming: ${pos.outcome} - ${pos.marketName.substring(0, 30)}...`
        );

        const result = await redeemPosition(
          wallet,
          ctf,
          pos.conditionId,
          gasSettings
        );

        if (result.success) {
          console.log(`   ✅ Success! TX: ${result.txHash}`);
          totalRedeemed++;
        } else {
          console.log(`   ❌ Failed: ${result.error?.substring(0, 50)}`);
        }
      }

      // Check final USDC balance
      const usdcAfter = await usdc.balanceOf(wallet.address);
      const usdcGained = usdcAfter.sub(usdcBefore);

      console.log(`\n${"─".repeat(60)}`);
      console.log(
        `Redeemed: ${totalRedeemed}/${redeemablePositions.length} positions`
      );
      console.log(
        `💰 USDC Before: ${ethers.utils.formatUnits(usdcBefore, 6)} USDC`
      );
      console.log(
        `💰 USDC After:  ${ethers.utils.formatUnits(usdcAfter, 6)} USDC`
      );
      if (usdcGained.gt(0)) {
        console.log(
          `💵 Gained:      +${ethers.utils.formatUnits(usdcGained, 6)} USDC`
        );
      }
      console.log("");
    }
  } catch (error) {
    console.log(`⚠️  Error: ${(error as Error).message}\n`);
    logger.error("Redeem error", { error: (error as Error).message });
  }

  console.log("✅ Redemption check complete.\n");
}

/**
 * Redeem a specific condition by ID
 */
export async function redeemByConditionId(conditionId: string): Promise<void> {
  const env = getEnvConfig();

  console.log("\n🎫 Redeeming Specific Market Position\n");
  console.log(`Condition ID: ${conditionId}\n`);

  // Setup wallet
  const provider = new ethers.providers.JsonRpcProvider(env.rpcUrl);
  const pk = env.privateKey.startsWith("0x")
    ? env.privateKey
    : `0x${env.privateKey}`;
  const wallet = new ethers.Wallet(pk, provider);

  console.log(`📍 Wallet Address: ${wallet.address}`);

  // Check MATIC balance for gas
  const maticBalance = await wallet.getBalance();
  if (maticBalance.lt(ethers.utils.parseEther("0.005"))) {
    console.log("\n❌ Insufficient MATIC for gas fees!");
    return;
  }

  // Setup contracts
  const ctf = new ethers.Contract(
    POLYGON_CONTRACTS.conditionalTokens,
    CTF_ABI,
    wallet
  );
  const usdc = new ethers.Contract(
    POLYGON_CONTRACTS.collateral,
    ERC20_ABI,
    provider
  );

  // Check if resolved
  const { isResolved, winningOutcome } = await checkConditionResolution(
    ctf,
    conditionId
  );

  if (!isResolved) {
    console.log("\n❌ This market has not been resolved yet.");
    console.log("   You can only redeem positions from resolved markets.\n");
    return;
  }

  console.log(
    `\n✅ Market is resolved! Winning outcome index: ${winningOutcome}\n`
  );

  // Get USDC balance before
  const usdcBefore = await usdc.balanceOf(wallet.address);
  console.log(
    `💰 USDC Before: ${ethers.utils.formatUnits(usdcBefore, 6)} USDC`
  );

  // Get gas settings
  const feeData = await provider.getFeeData();
  const baseGasPrice =
    feeData.gasPrice || ethers.utils.parseUnits("50", "gwei");
  const gasPrice = baseGasPrice.mul(120).div(100);

  const gasSettings = {
    gasPrice,
    gasLimit: 200_000,
  };

  // Attempt redemption
  const result = await redeemPosition(wallet, ctf, conditionId, gasSettings);

  if (result.success) {
    // Check USDC balance after
    const usdcAfter = await usdc.balanceOf(wallet.address);
    const usdcGained = usdcAfter.sub(usdcBefore);

    console.log(`\n✅ Successfully redeemed!`);
    console.log(
      `💰 USDC After: ${ethers.utils.formatUnits(usdcAfter, 6)} USDC`
    );
    console.log(
      `💵 USDC Gained: +${ethers.utils.formatUnits(usdcGained, 6)} USDC\n`
    );
  } else {
    console.log(`\n❌ Redemption failed: ${result.error}`);
    console.log("\nThis might mean:");
    console.log("  - You don't have any tokens for this market");
    console.log("  - The positions have already been redeemed");
    console.log(
      "  - The market uses NegRisk (requires different redemption)\n"
    );
  }
}

/**
 * Programmatic redemption for a specific token ID
 * Used by the copy trader when target redeems
 * Returns the result without console output (for dashboard logging)
 */
export async function redeemByTokenId(tokenId: string): Promise<{
  success: boolean;
  usdcGained: number;
  txHash?: string;
  error?: string;
  marketName?: string;
}> {
  const env = getEnvConfig();

  // Setup wallet
  const provider = new ethers.providers.JsonRpcProvider(env.rpcUrl);
  const pk = env.privateKey.startsWith("0x")
    ? env.privateKey
    : `0x${env.privateKey}`;
  const wallet = new ethers.Wallet(pk, provider);

  try {
    // Get market info from Gamma API
    const gammaApi = getGammaApiClient();
    const marketInfo = await gammaApi.getMarketByTokenId(tokenId);

    if (!marketInfo || !marketInfo.conditionId) {
      return {
        success: false,
        usdcGained: 0,
        error: "Could not find market for token",
      };
    }

    const conditionId = String(marketInfo.conditionId);
    const marketName = String(
      marketInfo.question || marketInfo.title || "Unknown"
    );

    // Check if resolved
    const ctf = new ethers.Contract(
      POLYGON_CONTRACTS.conditionalTokens,
      CTF_ABI,
      wallet
    );
    const { isResolved } = await checkConditionResolution(ctf, conditionId);

    if (!isResolved) {
      return {
        success: false,
        usdcGained: 0,
        error: "Market not yet resolved",
        marketName,
      };
    }

    // Get USDC balance before
    const usdc = new ethers.Contract(
      POLYGON_CONTRACTS.collateral,
      ERC20_ABI,
      provider
    );
    const usdcBefore = await usdc.balanceOf(wallet.address);

    // Get gas settings
    const feeData = await provider.getFeeData();
    const baseGasPrice =
      feeData.gasPrice || ethers.utils.parseUnits("50", "gwei");
    const gasPrice = baseGasPrice.mul(120).div(100);
    const gasSettings = { gasPrice, gasLimit: 200_000 };

    // Attempt redemption
    const result = await redeemPosition(wallet, ctf, conditionId, gasSettings);

    if (result.success) {
      // Check USDC balance after
      const usdcAfter = await usdc.balanceOf(wallet.address);
      const usdcGained = parseFloat(
        ethers.utils.formatUnits(usdcAfter.sub(usdcBefore), 6)
      );

      logger.info("Auto-redemption successful", {
        tokenId: tokenId.substring(0, 16) + "...",
        marketName,
        usdcGained,
        txHash: result.txHash,
      });

      return {
        success: true,
        usdcGained,
        txHash: result.txHash,
        marketName,
      };
    } else {
      return {
        success: false,
        usdcGained: 0,
        error: result.error,
        marketName,
      };
    }
  } catch (error) {
    logger.error("Auto-redemption failed", {
      tokenId: tokenId.substring(0, 16) + "...",
      error: (error as Error).message,
    });
    return {
      success: false,
      usdcGained: 0,
      error: (error as Error).message,
    };
  }
}
