/**
 * Risk Manager - enforces trading limits and safety controls
 */

import { TradeSignal, RiskConfig, AppConfig } from "./types";
import { StateManager, getStateManager } from "./state";
import { getTokenResolver, TokenResolver } from "../polymarket/tokenResolver";
import { getLogger } from "../utils/logger";
import { matchesAnyPattern } from "../utils/http";

const logger = getLogger();

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export class RiskManager {
  private config: RiskConfig;
  private stateManager: StateManager;
  private tokenResolver: TokenResolver;

  constructor(
    config: RiskConfig,
    stateManager?: StateManager,
    tokenResolver?: TokenResolver
  ) {
    this.config = config;
    this.stateManager = stateManager || getStateManager();
    this.tokenResolver = tokenResolver || getTokenResolver();
  }

  /**
   * Update risk configuration
   */
  updateConfig(config: RiskConfig): void {
    this.config = config;
  }

  /**
   * Check if a trade is allowed based on all risk controls
   */
  async checkTrade(
    signal: TradeSignal,
    proposedUsdValue: number
  ): Promise<RiskCheckResult> {
    // Check 1: Dry run mode
    if (this.config.dryRun) {
      // In dry run, we don't block trades but flag them
      logger.debug("Dry run mode active, trade will be simulated");
    }

    // Check 2: Max USD per trade
    const maxTradeCheck = this.checkMaxUsdPerTrade(proposedUsdValue);
    if (!maxTradeCheck.allowed) {
      return maxTradeCheck;
    }

    // Check 3: Max daily volume
    const dailyVolumeCheck = await this.checkDailyVolume(proposedUsdValue);
    if (!dailyVolumeCheck.allowed) {
      return dailyVolumeCheck;
    }

    // Check 4: Max market exposure
    const marketExposureCheck = await this.checkMarketExposure(
      signal.conditionId,
      proposedUsdValue
    );
    if (!marketExposureCheck.allowed) {
      return marketExposureCheck;
    }

    // Check 5: Market allowlist/denylist
    const marketFilterCheck = this.checkMarketFilter(signal);
    if (!marketFilterCheck.allowed) {
      return marketFilterCheck;
    }

    // Check 6: Market end date (if configured)
    const endDateCheck = await this.checkMarketEndDate(signal);
    if (!endDateCheck.allowed) {
      return endDateCheck;
    }

    return { allowed: true };
  }

  /**
   * Check max USD per trade limit
   */
  private checkMaxUsdPerTrade(proposedUsdValue: number): RiskCheckResult {
    if (proposedUsdValue > this.config.maxUsdPerTrade) {
      return {
        allowed: false,
        reason: `Trade value $${proposedUsdValue.toFixed(
          2
        )} exceeds max per trade limit of $${this.config.maxUsdPerTrade}`,
      };
    }
    return { allowed: true };
  }

  /**
   * Check daily volume limit
   */
  private async checkDailyVolume(
    proposedUsdValue: number
  ): Promise<RiskCheckResult> {
    const currentVolume = await this.stateManager.getDailyVolume();
    const projectedVolume = currentVolume + proposedUsdValue;

    if (projectedVolume > this.config.maxDailyUsdVolume) {
      return {
        allowed: false,
        reason: `Daily volume limit reached. Current: $${currentVolume.toFixed(
          2
        )}, Limit: $${this.config.maxDailyUsdVolume}`,
      };
    }
    return { allowed: true };
  }

  /**
   * Check market exposure limit
   */
  private async checkMarketExposure(
    conditionId: string | undefined,
    proposedUsdValue: number
  ): Promise<RiskCheckResult> {
    if (!conditionId) {
      // Can't check without condition ID, allow it
      return { allowed: true };
    }

    const currentExposure = await this.stateManager.getMarketExposure(
      conditionId
    );
    const projectedExposure = currentExposure + proposedUsdValue;

    if (projectedExposure > this.config.maxUsdPerMarket) {
      return {
        allowed: false,
        reason: `Market exposure limit reached. Current: $${currentExposure.toFixed(
          2
        )}, Limit: $${this.config.maxUsdPerMarket}`,
      };
    }
    return { allowed: true };
  }

  /**
   * Check market allowlist and denylist
   */
  private checkMarketFilter(signal: TradeSignal): RiskCheckResult {
    const identifiers = [
      signal.conditionId,
      signal.marketSlug,
      signal.tokenId,
    ].filter(Boolean) as string[];

    // Check denylist first
    if (this.config.marketDenylist.length > 0) {
      for (const id of identifiers) {
        if (matchesAnyPattern(id, this.config.marketDenylist)) {
          return {
            allowed: false,
            reason: `Market is on denylist: ${id}`,
          };
        }
      }
    }

    // Check allowlist (if not empty, only allow listed markets)
    if (this.config.marketAllowlist.length > 0) {
      const isAllowed = identifiers.some((id) =>
        matchesAnyPattern(id, this.config.marketAllowlist)
      );
      if (!isAllowed) {
        return {
          allowed: false,
          reason: "Market is not on allowlist",
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if market is too close to resolution
   */
  private async checkMarketEndDate(
    signal: TradeSignal
  ): Promise<RiskCheckResult> {
    if (this.config.doNotTradeMarketsOlderThanSecondsFromResolution <= 0) {
      // Feature disabled
      return { allowed: true };
    }

    // Try to get market metadata
    let endDate: string | undefined;

    if (signal.conditionId) {
      const metadata = await this.tokenResolver.getByConditionId(
        signal.conditionId
      );
      endDate = metadata?.endDate;
    } else if (signal.tokenId) {
      const metadata = await this.tokenResolver.getByTokenId(signal.tokenId);
      endDate = metadata?.endDate;
    }

    if (!endDate) {
      // Can't determine end date, allow the trade
      return { allowed: true };
    }

    const endTime = new Date(endDate).getTime();
    const now = Date.now();
    const secondsUntilEnd = (endTime - now) / 1000;

    if (
      secondsUntilEnd <
      this.config.doNotTradeMarketsOlderThanSecondsFromResolution
    ) {
      return {
        allowed: false,
        reason: `Market ends in ${Math.round(
          secondsUntilEnd / 60
        )} minutes, below threshold of ${
          this.config.doNotTradeMarketsOlderThanSecondsFromResolution / 60
        } minutes`,
      };
    }

    return { allowed: true };
  }

  /**
   * Calculate the allowed trade size based on limits
   */
  async calculateAllowedSize(
    signal: TradeSignal,
    requestedUsdValue: number
  ): Promise<number> {
    // Start with the requested value
    let allowedUsd = requestedUsdValue;

    // Cap at max per trade
    allowedUsd = Math.min(allowedUsd, this.config.maxUsdPerTrade);

    // Cap at remaining daily volume
    const currentDailyVolume = await this.stateManager.getDailyVolume();
    const remainingDailyVolume =
      this.config.maxDailyUsdVolume - currentDailyVolume;
    allowedUsd = Math.min(allowedUsd, remainingDailyVolume);

    // Cap at remaining market exposure
    if (signal.conditionId) {
      const currentExposure = await this.stateManager.getMarketExposure(
        signal.conditionId
      );
      const remainingExposure = this.config.maxUsdPerMarket - currentExposure;
      allowedUsd = Math.min(allowedUsd, remainingExposure);
    }

    // Ensure non-negative
    return Math.max(0, allowedUsd);
  }

  /**
   * Get current risk status
   */
  async getRiskStatus(): Promise<{
    dailyVolumeUsed: number;
    dailyVolumeRemaining: number;
    dailyVolumeLimit: number;
    maxPerTrade: number;
    maxPerMarket: number;
    dryRun: boolean;
  }> {
    const dailyVolume = await this.stateManager.getDailyVolume();

    return {
      dailyVolumeUsed: dailyVolume,
      dailyVolumeRemaining: Math.max(
        0,
        this.config.maxDailyUsdVolume - dailyVolume
      ),
      dailyVolumeLimit: this.config.maxDailyUsdVolume,
      maxPerTrade: this.config.maxUsdPerTrade,
      maxPerMarket: this.config.maxUsdPerMarket,
      dryRun: this.config.dryRun,
    };
  }
}

// Factory function
export function createRiskManager(config: AppConfig): RiskManager {
  return new RiskManager(config.risk);
}
