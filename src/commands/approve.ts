/**
 * Approve allowances for Polymarket trading
 *
 * This is a ONE-TIME on-chain transaction that allows the Polymarket
 * Exchange contracts to spend your USDC for trading.
 */

import { ethers, BigNumber } from "ethers";
import { getEnvConfig } from "../config/env";

// Contract addresses on Polygon Mainnet
const POLYGON_CONTRACTS = {
  exchange: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  negRiskExchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  collateral: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
};

// Minimal ABIs for approval functions
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

const ERC1155_ABI = [
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
];

export async function approveAllowances(): Promise<void> {
  const env = getEnvConfig();

  console.log("\n🔐 Polymarket Allowance Setup\n");
  console.log(
    "This will approve the Polymarket Exchange contracts to trade on your behalf."
  );
  console.log(
    "This is a ONE-TIME on-chain transaction (requires MATIC for gas).\n"
  );

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

  if (maticBalance.lt(ethers.utils.parseEther("0.01"))) {
    console.log("\n❌ Insufficient MATIC for gas fees!");
    console.log("   You need at least 0.01 MATIC to approve allowances.");
    console.log("   Send some MATIC to your wallet first.");
    return;
  }

  // Setup contracts
  const usdc = new ethers.Contract(
    POLYGON_CONTRACTS.collateral,
    ERC20_ABI,
    wallet
  );
  const ctf = new ethers.Contract(
    POLYGON_CONTRACTS.conditionalTokens,
    ERC1155_ABI,
    wallet
  );

  // Check current USDC balance
  const usdcBalance = await usdc.balanceOf(wallet.address);
  console.log(
    `💰 USDC Balance: ${ethers.utils.formatUnits(usdcBalance, 6)} USDC\n`
  );

  // Check current allowances
  console.log("📋 Checking current allowances...\n");

  const usdcAllowanceExchange: BigNumber = await usdc.allowance(
    wallet.address,
    POLYGON_CONTRACTS.exchange
  );
  const usdcAllowanceCTF: BigNumber = await usdc.allowance(
    wallet.address,
    POLYGON_CONTRACTS.conditionalTokens
  );
  const usdcAllowanceNegRisk: BigNumber = await usdc.allowance(
    wallet.address,
    POLYGON_CONTRACTS.negRiskExchange
  );
  const ctfApprovedExchange: boolean = await ctf.isApprovedForAll(
    wallet.address,
    POLYGON_CONTRACTS.exchange
  );
  const ctfApprovedNegRisk: boolean = await ctf.isApprovedForAll(
    wallet.address,
    POLYGON_CONTRACTS.negRiskExchange
  );

  console.log("Current allowances:");
  console.log(
    `  USDC → Exchange:     ${
      usdcAllowanceExchange.gt(0) ? "✅ Approved" : "❌ Not approved"
    }`
  );
  console.log(
    `  USDC → CTF:          ${
      usdcAllowanceCTF.gt(0) ? "✅ Approved" : "❌ Not approved"
    }`
  );
  console.log(
    `  USDC → NegRisk:      ${
      usdcAllowanceNegRisk.gt(0) ? "✅ Approved" : "❌ Not approved"
    }`
  );
  console.log(
    `  CTF → Exchange:      ${
      ctfApprovedExchange ? "✅ Approved" : "❌ Not approved"
    }`
  );
  console.log(
    `  CTF → NegRisk:       ${
      ctfApprovedNegRisk ? "✅ Approved" : "❌ Not approved"
    }`
  );
  console.log("");

  // Get current gas price and add 20%
  const feeData = await provider.getFeeData();
  const baseGasPrice =
    feeData.gasPrice || ethers.utils.parseUnits("100", "gwei");
  const gasPrice = baseGasPrice.mul(120).div(100); // Add 20% buffer

  console.log(
    `⛽ Using gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei\n`
  );

  const gasSettings = {
    gasPrice,
    gasLimit: 100_000,
  };

  let txCount = 0;

  // Approve USDC for Exchange
  if (usdcAllowanceExchange.eq(0)) {
    console.log("📝 Approving USDC for Exchange...");
    const tx = await usdc.approve(
      POLYGON_CONTRACTS.exchange,
      ethers.constants.MaxUint256,
      gasSettings
    );
    console.log(`   TX: ${tx.hash}`);
    console.log("   ⏳ Waiting for confirmation...");
    await tx.wait();
    console.log("   ✅ Done\n");
    txCount++;
  }

  // Approve USDC for CTF (Conditional Token Framework)
  if (usdcAllowanceCTF.eq(0)) {
    console.log("📝 Approving USDC for CTF...");
    const tx = await usdc.approve(
      POLYGON_CONTRACTS.conditionalTokens,
      ethers.constants.MaxUint256,
      gasSettings
    );
    console.log(`   TX: ${tx.hash}`);
    await tx.wait();
    console.log("   ✅ Done\n");
    txCount++;
  }

  // Approve USDC for NegRisk Exchange
  if (usdcAllowanceNegRisk.eq(0)) {
    console.log("📝 Approving USDC for NegRisk Exchange...");
    const tx = await usdc.approve(
      POLYGON_CONTRACTS.negRiskExchange,
      ethers.constants.MaxUint256,
      gasSettings
    );
    console.log(`   TX: ${tx.hash}`);
    await tx.wait();
    console.log("   ✅ Done\n");
    txCount++;
  }

  // Approve CTF (Conditional Tokens) for Exchange
  if (!ctfApprovedExchange) {
    console.log("📝 Approving Conditional Tokens for Exchange...");
    const tx = await ctf.setApprovalForAll(
      POLYGON_CONTRACTS.exchange,
      true,
      gasSettings
    );
    console.log(`   TX: ${tx.hash}`);
    await tx.wait();
    console.log("   ✅ Done\n");
    txCount++;
  }

  // Approve CTF for NegRisk Exchange
  if (!ctfApprovedNegRisk) {
    console.log("📝 Approving Conditional Tokens for NegRisk Exchange...");
    const tx = await ctf.setApprovalForAll(
      POLYGON_CONTRACTS.negRiskExchange,
      true,
      gasSettings
    );
    console.log(`   TX: ${tx.hash}`);
    await tx.wait();
    console.log("   ✅ Done\n");
    txCount++;
  }

  if (txCount === 0) {
    console.log("✅ All allowances already set! You're ready to trade.\n");
  } else {
    console.log(`✅ Completed ${txCount} approval transaction(s).\n`);
    console.log("🎉 You're now ready to trade on Polymarket!\n");
  }
}
