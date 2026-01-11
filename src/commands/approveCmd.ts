/**
 * Approve Command
 *
 * Sets up on-chain allowances for Polymarket trading
 */

import { Command } from "commander";
import { approveAllowances } from "./approve";

export function createApproveCommand(): Command {
  const command = new Command("approve");

  command
    .description(
      "Approve on-chain allowances for Polymarket trading (one-time setup)"
    )
    .action(async () => {
      try {
        await approveAllowances();
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  return command;
}
