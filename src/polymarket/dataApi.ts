/**
 * Polymarket Data API client for fetching target wallet trades
 */

import { AxiosInstance } from "axios";
import { createHttpClient, fetchWithRetry } from "../utils/http";
import { DataApiTrade, TradeSignal, ActivityType } from "../copier/types";
import { getEnvConfig } from "../config/env";
import { getLogger } from "../utils/logger";

const logger = getLogger();

/**
 * Activity types we can copy/track:
 * - TRADE: Regular buy/sell trades (primary)
 * - SPLIT: Split collateral into YES/NO tokens (creates position)
 * - MERGE: Merge YES+NO tokens back into collateral (closes positions)
 * - REDEEM: Redeem winning tokens after market resolution (settles P&L)
 *
 * Activity types we skip:
 * - REWARD: Liquidity rewards (not actionable)
 * - CONVERSION: Token conversion (internal)
 * - MAKER_REBATE: Rebate for market makers (not actionable)
 */
const COPYABLE_ACTIVITY_TYPES = new Set<string>([
  "TRADE",
  "SPLIT",
  "MERGE",
  "REDEEM", // Track REDEEMs to realize P&L on settled positions
]);

const SKIPPED_ACTIVITY_TYPES = new Set<string>([
  "REWARD",
  "CONVERSION",
  "MAKER_REBATE",
]);

export interface DataApiConfig {
  baseUrl: string;
  tradeLimit: number;
  maxRetries: number;
  baseBackoffMs: number;
}

export class DataApiClient {
  private client: AxiosInstance;
  private config: DataApiConfig;

  constructor(config?: Partial<DataApiConfig>) {
    const env = getEnvConfig();
    this.config = {
      baseUrl: config?.baseUrl || env.dataApiUrl,
      tradeLimit: config?.tradeLimit || 20,
      maxRetries: config?.maxRetries || 3,
      baseBackoffMs: config?.baseBackoffMs || 1000,
    };

    this.client = createHttpClient(this.config.baseUrl, {
      maxRetries: this.config.maxRetries,
      baseDelayMs: this.config.baseBackoffMs,
    });
  }

  /**
   * Fetch recent activities for a wallet address
   * Uses the /activity endpoint with user parameter
   * Handles all activity types: TRADE, SPLIT, MERGE, REDEEM, etc.
   */
  async fetchTrades(
    walletAddress: string,
    limit?: number
  ): Promise<DataApiTrade[]> {
    const tradeLimit = limit || this.config.tradeLimit;

    try {
      logger.debug(
        `Fetching activities for wallet: ${walletAddress.substring(0, 10)}...`
      );

      const response = await fetchWithRetry<DataApiTrade[]>(
        this.client,
        {
          method: "GET",
          url: "/activity",
          params: {
            user: walletAddress,
            limit: tradeLimit,
            sortBy: "TIMESTAMP",
            sortDirection: "DESC",
          },
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseBackoffMs,
        }
      );

      // Filter to only copyable activity types
      const activities = (response || []).filter((item) => {
        const actType = item.type?.toUpperCase() || "TRADE";

        if (COPYABLE_ACTIVITY_TYPES.has(actType)) {
          return true;
        }

        if (SKIPPED_ACTIVITY_TYPES.has(actType)) {
          logger.debug(`Skipping non-copyable activity type: ${actType}`);
          return false;
        }

        // Unknown type - log and skip
        logger.warn(`Unknown activity type: ${actType}`, { activity: item });
        return false;
      });

      logger.debug(
        `Fetched ${
          activities.length
        } copyable activities for ${walletAddress.substring(0, 10)}...`
      );

      return activities;
    } catch (error) {
      logger.error("Failed to fetch activities from Data API", {
        wallet: walletAddress,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Fetch only non-TRADE activities (REDEEM, SPLIT, MERGE)
   * WebSocket only streams TRADEs, so we need polling for other activity types
   */
  async fetchNonTradeActivities(
    walletAddress: string,
    limit?: number
  ): Promise<DataApiTrade[]> {
    const activityLimit = limit || 20;

    try {
      const response = await fetchWithRetry<DataApiTrade[]>(
        this.client,
        {
          method: "GET",
          url: "/activity",
          params: {
            user: walletAddress,
            limit: activityLimit,
            sortBy: "TIMESTAMP",
            sortDirection: "DESC",
          },
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseBackoffMs,
        }
      );

      // Filter to only non-TRADE copyable activity types (REDEEM, SPLIT, MERGE)
      const nonTradeActivities = (response || []).filter((item) => {
        const actType = item.type?.toUpperCase() || "TRADE";

        // Skip TRADE - we get those via WebSocket
        if (actType === "TRADE") return false;

        // Include REDEEM, SPLIT, MERGE
        return COPYABLE_ACTIVITY_TYPES.has(actType);
      });

      if (nonTradeActivities.length > 0) {
        logger.debug(
          `Found ${
            nonTradeActivities.length
          } non-trade activities for ${walletAddress.substring(0, 10)}...`
        );
      }

      return nonTradeActivities;
    } catch (error) {
      logger.error("Failed to fetch non-trade activities", {
        wallet: walletAddress,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Fetch activity for a wallet address (alternative endpoint)
   * Uses the /activity endpoint
   */
  async fetchActivity(
    walletAddress: string,
    limit?: number
  ): Promise<DataApiTrade[]> {
    const activityLimit = limit || this.config.tradeLimit;

    try {
      const response = await fetchWithRetry<DataApiTrade[]>(
        this.client,
        {
          method: "GET",
          url: "/activity",
          params: {
            user: walletAddress,
            limit: activityLimit,
            sortBy: "TIMESTAMP",
            sortDirection: "DESC",
          },
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseBackoffMs,
        }
      );

      return response || [];
    } catch (error) {
      logger.error("Failed to fetch activity from Data API", {
        wallet: walletAddress,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Normalize a Data API activity into our internal TradeSignal format
   * Handles all activity types: TRADE, SPLIT, MERGE, REDEEM
   */
  normalizeTrade(trade: DataApiTrade, targetWallet: string): TradeSignal {
    // Parse timestamp - activity endpoint returns Unix timestamp in seconds
    let timestamp: number;
    if (typeof trade.timestamp === "string") {
      timestamp = new Date(trade.timestamp).getTime();
    } else {
      // Activity endpoint returns timestamp in seconds, convert to milliseconds
      const ts = trade.timestamp as unknown as number;
      timestamp = ts > 1e12 ? ts : ts * 1000;
    }

    // Get activity type
    const activityType = (trade.type?.toUpperCase() || "TRADE") as ActivityType;

    // Determine side based on activity type
    let side: "BUY" | "SELL";
    switch (activityType) {
      case "TRADE":
        // Regular trade - use the side from API
        side = (trade.side?.toUpperCase() as "BUY" | "SELL") || "BUY";
        break;
      case "SPLIT":
        // SPLIT creates tokens from collateral - similar to buying
        side = "BUY";
        break;
      case "MERGE":
        // MERGE converts tokens back to collateral - similar to selling
        side = "SELL";
        break;
      case "REDEEM":
        // REDEEM cashes out winning position - similar to selling
        side = "SELL";
        break;
      default:
        side = (trade.side?.toUpperCase() as "BUY" | "SELL") || "BUY";
    }

    // Extract token ID - in activity endpoint it's 'asset'
    const tokenId = trade.asset || trade.tokenId || "";

    // Extract condition ID - directly available in activity endpoint
    const conditionId = trade.conditionId;

    // Parse price and size
    // For SPLIT/MERGE, price might be different (1.0 for collateral ratio)
    let price = parseFloat(String(trade.price)) || 0;
    const sizeShares = parseFloat(String(trade.size)) || 0;

    // For SPLIT, the price represents the split ratio (usually 1.0)
    // For MERGE, same - represents merge ratio
    // For REDEEM, price is the redemption value (1.0 for winning tokens)
    if (activityType === "SPLIT" || activityType === "MERGE") {
      // Use a reasonable price estimate for position tracking
      price = price > 0 ? price : 0.5;
    }

    // Activity endpoint may include usdcSize directly
    const usdcSize = (trade as Record<string, unknown>).usdcSize;
    const notionalUsd = usdcSize
      ? parseFloat(String(usdcSize))
      : price * sizeShares;

    // Use transaction hash as stable trade ID
    const tradeId =
      trade.transactionHash ||
      trade.id ||
      this.generateTradeId(trade, targetWallet);

    // Get market slug from activity response
    const marketSlug =
      ((trade as Record<string, unknown>).slug as string) || trade.market;

    return {
      targetWallet: targetWallet.toLowerCase(),
      tradeId,
      timestamp,
      conditionId,
      marketSlug,
      tokenId,
      side,
      price,
      sizeShares,
      notionalUsd,
      outcome: this.parseOutcome(trade.outcome),
      activityType,
      rawData: trade as Record<string, unknown>,
    };
  }

  /**
   * Generate a stable trade ID from trade components
   */
  private generateTradeId(trade: DataApiTrade, wallet: string): string {
    const components = [
      wallet.toLowerCase(),
      trade.timestamp,
      trade.asset || trade.tokenId || "",
      trade.side,
      trade.price,
      trade.size,
      trade.transactionHash || "",
    ];
    return components.join(":");
  }

  /**
   * Parse outcome string to YES/NO
   */
  private parseOutcome(outcome?: string): "YES" | "NO" | undefined {
    if (!outcome) return undefined;
    const upper = outcome.toUpperCase();
    if (upper === "YES" || upper === "NO") {
      return upper as "YES" | "NO";
    }
    return undefined;
  }

  /**
   * Fetch user positions from the Data API /positions endpoint
   * Returns real-time positions with current value and P&L
   */
  async fetchPositions(walletAddress: string): Promise<DataApiPosition[]> {
    try {
      logger.debug(
        `Fetching positions for wallet: ${walletAddress.substring(0, 10)}...`
      );

      const response = await fetchWithRetry<
        DataApiPosition[] | { history: DataApiPosition[] }
      >(
        this.client,
        {
          method: "GET",
          url: "/positions",
          params: {
            user: walletAddress,
            sizeThreshold: 0.01,
            limit: 100,
            sortBy: "CURRENT",
            sortDirection: "DESC",
          },
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseBackoffMs,
        }
      );

      // Handle both array and wrapped response formats
      let positions: DataApiPosition[];
      if (Array.isArray(response)) {
        positions = response;
      } else if (
        response &&
        typeof response === "object" &&
        "history" in response
      ) {
        positions = response.history || [];
      } else {
        logger.warn("Unexpected positions response format", {
          type: typeof response,
          keys: response ? Object.keys(response) : [],
        });
        positions = [];
      }

      logger.debug(`Fetched ${positions.length} positions from Data API`);

      return positions;
    } catch (error) {
      logger.error("Failed to fetch positions from Data API", {
        wallet: walletAddress,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Fetch total value of user's positions
   */
  async fetchTotalValue(walletAddress: string): Promise<number> {
    try {
      const response = await fetchWithRetry<
        Array<{ user: string; value: number }>
      >(
        this.client,
        {
          method: "GET",
          url: "/value",
          params: {
            user: walletAddress,
          },
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseBackoffMs,
        }
      );

      if (response && response.length > 0) {
        return response[0].value || 0;
      }
      return 0;
    } catch (error) {
      logger.error("Failed to fetch total value from Data API", {
        wallet: walletAddress,
        error: (error as Error).message,
      });
      return 0;
    }
  }
}

/**
 * Position data from the Data API /positions endpoint
 */
export interface DataApiPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon?: string;
  eventSlug?: string;
  outcome: string;
  outcomeIndex: number;
}

// Singleton instance
let dataApiClientInstance: DataApiClient | null = null;

export function getDataApiClient(
  config?: Partial<DataApiConfig>
): DataApiClient {
  if (!dataApiClientInstance) {
    dataApiClientInstance = new DataApiClient(config);
  }
  return dataApiClientInstance;
}

export function resetDataApiClient(): void {
  dataApiClientInstance = null;
}
