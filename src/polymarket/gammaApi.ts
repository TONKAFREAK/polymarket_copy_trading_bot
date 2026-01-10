/**
 * Polymarket Gamma API client for market metadata
 */

import { AxiosInstance } from "axios";
import { createHttpClient, fetchWithRetry } from "../utils/http";
import { GammaMarket, TokenMetadata } from "../copier/types";
import { getEnvConfig } from "../config/env";
import { getLogger } from "../utils/logger";

const logger = getLogger();

export interface GammaApiConfig {
  baseUrl: string;
  maxRetries: number;
  baseBackoffMs: number;
}

export class GammaApiClient {
  private client: AxiosInstance;
  private config: GammaApiConfig;

  constructor(config?: Partial<GammaApiConfig>) {
    const env = getEnvConfig();
    this.config = {
      baseUrl: config?.baseUrl || env.gammaApiUrl,
      maxRetries: config?.maxRetries || 3,
      baseBackoffMs: config?.baseBackoffMs || 1000,
    };

    this.client = createHttpClient(this.config.baseUrl, {
      maxRetries: this.config.maxRetries,
      baseDelayMs: this.config.baseBackoffMs,
    });
  }

  /**
   * Fetch market by condition ID
   */
  async getMarketByConditionId(
    conditionId: string
  ): Promise<GammaMarket | null> {
    try {
      const response = await fetchWithRetry<GammaMarket[]>(
        this.client,
        {
          method: "GET",
          url: "/markets",
          params: {
            condition_id: conditionId,
          },
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseBackoffMs,
        }
      );

      if (response && response.length > 0) {
        return response[0];
      }
      return null;
    } catch (error) {
      logger.error("Failed to fetch market by condition ID", {
        conditionId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Fetch market by slug
   */
  async getMarketBySlug(slug: string): Promise<GammaMarket | null> {
    try {
      const response = await fetchWithRetry<GammaMarket>(
        this.client,
        {
          method: "GET",
          url: `/markets/${slug}`,
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseBackoffMs,
        }
      );

      return response || null;
    } catch (error) {
      // 422 errors mean market expired/resolved - don't log as error
      const axiosError = error as { response?: { status?: number } };
      if (axiosError.response?.status !== 422) {
        logger.error("Failed to fetch market by slug", {
          slug,
          error: (error as Error).message,
        });
      }
      return null;
    }
  }

  /**
   * Fetch market by token ID
   */
  async getMarketByTokenId(tokenId: string): Promise<GammaMarket | null> {
    try {
      // First try to fetch markets and filter by token
      const response = await fetchWithRetry<GammaMarket[]>(
        this.client,
        {
          method: "GET",
          url: "/markets",
          params: {
            token_id: tokenId,
          },
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseBackoffMs,
        }
      );

      if (response && response.length > 0) {
        return response[0];
      }
      return null;
    } catch (error) {
      logger.error("Failed to fetch market by token ID", {
        tokenId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Search markets by query
   */
  async searchMarkets(
    query: string,
    limit: number = 10
  ): Promise<GammaMarket[]> {
    try {
      const response = await fetchWithRetry<GammaMarket[]>(
        this.client,
        {
          method: "GET",
          url: "/markets",
          params: {
            _q: query,
            _limit: limit,
            active: true,
          },
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseBackoffMs,
        }
      );

      return response || [];
    } catch (error) {
      logger.error("Failed to search markets", {
        query,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Convert a Gamma market response to our TokenMetadata format
   */
  normalizeMarket(market: GammaMarket): TokenMetadata | null {
    if (!market || !market.tokens || market.tokens.length < 2) {
      return null;
    }

    // Find YES and NO tokens
    let yesTokenId = "";
    let noTokenId = "";

    for (const token of market.tokens) {
      const outcome = token.outcome?.toUpperCase();
      if (outcome === "YES") {
        yesTokenId = token.token_id;
      } else if (outcome === "NO") {
        noTokenId = token.token_id;
      }
    }

    // If not found by name, assume first is YES, second is NO
    if (!yesTokenId && !noTokenId && market.tokens.length >= 2) {
      yesTokenId = market.tokens[0].token_id;
      noTokenId = market.tokens[1].token_id;
    }

    return {
      conditionId: market.conditionId,
      marketSlug: market.slug,
      question: market.question,
      yesTokenId,
      noTokenId,
      endDate: market.endDate,
      active: market.active && !market.closed,
    };
  }

  /**
   * Get market resolution info - determine if market is resolved and which outcome won
   * Returns: { resolved: boolean, winningOutcome: "YES" | "NO" | null, winningTokenId: string | null }
   */
  async getMarketResolution(
    slug: string
  ): Promise<{
    resolved: boolean;
    winningOutcome: "YES" | "NO" | null;
    winningTokenId: string | null;
    outcomePrices: number[];
  }> {
    try {
      const market = await this.getMarketBySlug(slug);
      if (!market) {
        return { resolved: false, winningOutcome: null, winningTokenId: null, outcomePrices: [] };
      }

      // Check if market is closed/resolved
      const isResolved = market.closed === true;

      if (!isResolved) {
        return { resolved: false, winningOutcome: null, winningTokenId: null, outcomePrices: [] };
      }

      // Parse outcome prices to determine winner
      // outcomePrices is comma-separated, e.g., "1,0" means first outcome (YES) won
      // "0,1" means second outcome (NO) won
      let winningOutcome: "YES" | "NO" | null = null;
      let winningTokenId: string | null = null;
      let outcomePrices: number[] = [];

      if (market.outcomePrices) {
        try {
          // Parse as comma-separated or JSON array
          if (market.outcomePrices.startsWith("[")) {
            outcomePrices = JSON.parse(market.outcomePrices);
          } else {
            outcomePrices = market.outcomePrices.split(",").map((p) => parseFloat(p));
          }

          // Determine winner based on which price is 1 (or closest to 1)
          if (outcomePrices.length >= 2) {
            if (outcomePrices[0] >= 0.99) {
              winningOutcome = "YES";
              if (market.tokens && market.tokens.length > 0) {
                winningTokenId = market.tokens[0].token_id;
              }
            } else if (outcomePrices[1] >= 0.99) {
              winningOutcome = "NO";
              if (market.tokens && market.tokens.length > 1) {
                winningTokenId = market.tokens[1].token_id;
              }
            }
          }
        } catch {
          logger.warn("Failed to parse outcomePrices", { slug, outcomePrices: market.outcomePrices });
        }
      }

      // Also check CLOB token IDs to match
      if (market.clobTokenIds) {
        try {
          const tokenIds = JSON.parse(market.clobTokenIds);
          if (Array.isArray(tokenIds) && tokenIds.length >= 2) {
            if (winningOutcome === "YES") {
              winningTokenId = tokenIds[0];
            } else if (winningOutcome === "NO") {
              winningTokenId = tokenIds[1];
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      return { resolved: isResolved, winningOutcome, winningTokenId, outcomePrices };
    } catch (error) {
      logger.debug("Failed to get market resolution", { slug, error: (error as Error).message });
      return { resolved: false, winningOutcome: null, winningTokenId: null, outcomePrices: [] };
    }
  }

  /**
   * Check if a specific token ID is a winner in a resolved market
   */
  async isTokenWinner(tokenId: string, slug: string): Promise<boolean | null> {
    const resolution = await this.getMarketResolution(slug);
    if (!resolution.resolved) {
      return null; // Market not resolved yet
    }
    return resolution.winningTokenId === tokenId;
  }
}

// Singleton instance
let gammaApiClientInstance: GammaApiClient | null = null;

export function getGammaApiClient(
  config?: Partial<GammaApiConfig>
): GammaApiClient {
  if (!gammaApiClientInstance) {
    gammaApiClientInstance = new GammaApiClient(config);
  }
  return gammaApiClientInstance;
}

export function resetGammaApiClient(): void {
  gammaApiClientInstance = null;
}
