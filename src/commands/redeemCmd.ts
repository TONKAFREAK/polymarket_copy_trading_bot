/**
 * Redeem command CLI wrapper
 */

import { Command } from "commander";
import { redeemWinnings, redeemByConditionId } from "./redeem";

export function createRedeemCommand(): Command {
  const command = new Command("redeem")
    .description("Redeem winning positions from resolved markets")
    .argument(
      "[conditionId]",
      "Optional: Specific market condition ID to redeem"
    )
    .action(async (conditionId?: string) => {
      if (conditionId) {
        await redeemByConditionId(conditionId);
      } else {
        await redeemWinnings();
      }
    });

  return command;
}
