/**
 * Diagnose command - check wallet configuration and balances
 */

import { Command } from "commander";
import chalk from "chalk";
import { ethers } from "ethers";
import { getEnvConfig } from "../config/env";

const CONTRACTS = {
  usdc: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  exchange: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  negRiskExchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const ERC1155_ABI = [
  "function isApprovedForAll(address account, address operator) view returns (bool)",
];

export function createDiagnoseCommand(): Command {
  const command = new Command("diagnose")
    .description("Diagnose wallet configuration and check for issues")
    .action(async () => {
      const env = getEnvConfig();
      
      console.log(chalk.bold.cyan("\n🔍 Polymarket Copy Trader Diagnostics\n"));
      console.log(chalk.gray("─".repeat(60)));
      
      // Setup provider
      const provider = new ethers.providers.JsonRpcProvider(env.rpcUrl);
      
      // Get wallet from private key
      const pk = env.privateKey.startsWith("0x") ? env.privateKey : `0x${env.privateKey}`;
      const wallet = new ethers.Wallet(pk, provider);
      
      // Display configuration
      console.log(chalk.bold("\n📋 Configuration:\n"));
      
      const sigTypeNames: Record<number, string> = {
        0: "EOA (direct wallet)",
        1: "POLY_PROXY (Magic/Email)",
        2: "GNOSIS_SAFE (browser wallet)",
      };
      
      console.log(`  ${chalk.cyan("Private Key Wallet:")}  ${wallet.address}`);
      console.log(`  ${chalk.cyan("Funder Address:")}      ${env.polyFunderAddress || "(not set)"}`);
      console.log(`  ${chalk.cyan("Signature Type:")}      ${env.polySignatureType} (${sigTypeNames[env.polySignatureType] || "Unknown"})`);
      
      // Check if wallets match
      const funderAddress = env.polyFunderAddress?.toLowerCase() || wallet.address.toLowerCase();
      const walletMatch = wallet.address.toLowerCase() === funderAddress;
      
      console.log("");
      if (walletMatch) {
        console.log(chalk.green("  ✅ Wallet addresses match - configuration looks correct"));
      } else {
        console.log(chalk.red("  ❌ WALLET MISMATCH DETECTED!"));
        console.log(chalk.yellow(`     Private key creates: ${wallet.address}`));
        console.log(chalk.yellow(`     Funder address is:   ${env.polyFunderAddress}`));
        console.log(chalk.yellow("\n     This will cause 'not enough balance/allowance' errors."));
        console.log(chalk.yellow("     Your funds are in the funder address, but the private key"));
        console.log(chalk.yellow("     cannot sign for that wallet."));
        console.log(chalk.cyan("\n  🔧 To fix: Export the Magic wallet private key from Polymarket:"));
        console.log(chalk.gray("     1. Go to polymarket.com → Settings → Export Wallet"));
        console.log(chalk.gray("     2. Replace PRIVATE_KEY in .env with the exported key"));
        console.log(chalk.gray("     3. Set POLY_SIGNATURE_TYPE=0"));
      }
      
      // Check balances
      console.log(chalk.bold("\n💰 Balances:\n"));
      
      const usdc = new ethers.Contract(CONTRACTS.usdc, ERC20_ABI, provider);
      
      // Check private key wallet balance
      const walletBalance = await usdc.balanceOf(wallet.address);
      const walletBalanceFormatted = parseFloat(ethers.utils.formatUnits(walletBalance, 6));
      console.log(`  ${chalk.cyan("Private Key Wallet:")}`);
      console.log(`    USDC: $${walletBalanceFormatted.toFixed(2)}`);
      
      // Check funder wallet balance if different
      if (!walletMatch && env.polyFunderAddress) {
        const funderBalance = await usdc.balanceOf(env.polyFunderAddress);
        const funderBalanceFormatted = parseFloat(ethers.utils.formatUnits(funderBalance, 6));
        console.log(`  ${chalk.cyan("Funder Wallet:")}`);
        console.log(`    USDC: ${chalk.green(`$${funderBalanceFormatted.toFixed(2)}`)}`);
        
        if (funderBalanceFormatted > 0 && walletBalanceFormatted === 0) {
          console.log(chalk.yellow(`\n  ⚠️  Your $${funderBalanceFormatted.toFixed(2)} is in the funder wallet,`));
          console.log(chalk.yellow("     but your private key controls a different wallet!"));
        }
      }
      
      // Check MATIC for gas
      const maticBalance = await provider.getBalance(wallet.address);
      const maticFormatted = parseFloat(ethers.utils.formatEther(maticBalance));
      console.log(`  ${chalk.cyan("MATIC (for gas):")} ${maticFormatted.toFixed(4)} MATIC`);
      
      // Check allowances for the appropriate wallet
      const checkAddress = walletMatch ? wallet.address : (env.polyFunderAddress || wallet.address);
      
      console.log(chalk.bold(`\n🔐 Allowances for ${checkAddress.substring(0, 10)}...:\n`));
      
      const ctf = new ethers.Contract(CONTRACTS.conditionalTokens, ERC1155_ABI, provider);
      
      const allowanceExchange = await usdc.allowance(checkAddress, CONTRACTS.exchange);
      const allowanceNegRisk = await usdc.allowance(checkAddress, CONTRACTS.negRiskExchange);
      const allowanceCTF = await usdc.allowance(checkAddress, CONTRACTS.conditionalTokens);
      const ctfApprovedExchange = await ctf.isApprovedForAll(checkAddress, CONTRACTS.exchange);
      const ctfApprovedNegRisk = await ctf.isApprovedForAll(checkAddress, CONTRACTS.negRiskExchange);
      
      const check = (approved: boolean) => approved ? chalk.green("✅ Approved") : chalk.red("❌ Not approved");
      
      console.log(`  USDC → Exchange:      ${check(allowanceExchange.gt(0))}`);
      console.log(`  USDC → CTF:           ${check(allowanceCTF.gt(0))}`);
      console.log(`  USDC → NegRisk:       ${check(allowanceNegRisk.gt(0))}`);
      console.log(`  CTF → Exchange:       ${check(ctfApprovedExchange)}`);
      console.log(`  CTF → NegRisk:        ${check(ctfApprovedNegRisk)}`);
      
      // Summary
      console.log(chalk.gray("\n" + "─".repeat(60)));
      console.log(chalk.bold("\n📊 Summary:\n"));
      
      const allAllowancesOk = allowanceExchange.gt(0) && allowanceNegRisk.gt(0) && 
                               allowanceCTF.gt(0) && ctfApprovedExchange && ctfApprovedNegRisk;
      
      if (walletMatch && allAllowancesOk && walletBalanceFormatted > 0) {
        console.log(chalk.green("  ✅ Configuration looks good! You're ready to trade."));
      } else {
        if (!walletMatch) {
          console.log(chalk.red("  ❌ Wallet mismatch - export Magic wallet private key"));
        }
        if (!allAllowancesOk) {
          console.log(chalk.yellow("  ⚠️  Missing allowances - run: node dist/cli.js approve"));
        }
        if (walletBalanceFormatted === 0 && (walletMatch || !env.polyFunderAddress)) {
          console.log(chalk.yellow("  ⚠️  No USDC balance - deposit funds to trade"));
        }
      }
      
      console.log("");
    });

  return command;
}
