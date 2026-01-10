/**
 * Polymarket Data API client for fetching target wallet trades
 */

import { AxiosInstance } from "axios";
import { createHttpClient, fetchWithRetry } from "../utils/http";
import { DataApiTrade, TradeSignal } from "../copier/types";
import { getEnvConfig } from "../config/env";
import { getLogger } from "../utils/logger";

const logger = getLogger();

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
   * Fetch recent trades for a wallet address
   * Uses the /activity endpoint with user parameter
   */
  async fetchTrades(
    walletAddress: string,
    limit?: number
  ): Promise<DataApiTrade[]> {
    const tradeLimit = limit || this.config.tradeLimit;

    try {
      logger.debug(
        `Fetching trades for wallet: ${walletAddress.substring(0, 10)}...`
      );

      const response = await fetchWithRetry<DataApiTrade[]>(
        this.client,
        {
          method: "GET",
          url: "/activity",
          params: {
            user: walletAddress,
            limit: tradeLimit,
          },
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseBackoffMs,
        }
      );

      // Filter to only TRADE type activities
      const trades = (response || []).filter(
        (item) => !item.type || item.type === "TRADE"
      );

      logger.debug(
        `Fetched ${trades.length} trades for ${walletAddress.substring(
          0,
          10
        )}...`
      );

      return trades;
    } catch (error) {
      logger.error("Failed to fetch trades from Data API", {
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
   * Normalize a Data API trade into our internal TradeSignal format
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

    // Side is directly available from activity endpoint
    const side = (trade.side?.toUpperCase() as "BUY" | "SELL") || "BUY";

    // Extract token ID - in activity endpoint it's 'asset'
    const tokenId = trade.asset || trade.tokenId || "";

    // Extract condition ID - directly available in activity endpoint
    const conditionId = trade.conditionId;

    // Parse price and size
    const price = parseFloat(String(trade.price)) || 0;
    const sizeShares = parseFloat(String(trade.size)) || 0;

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
