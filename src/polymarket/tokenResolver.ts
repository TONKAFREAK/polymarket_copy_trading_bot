/**
 * Token Resolver - resolves token IDs and caches market metadata
 */

import { TokenMetadata, TokenCache } from "../copier/types";
import { GammaApiClient, getGammaApiClient } from "./gammaApi";
import { getPersistenceProvider, PersistenceProvider } from "../data";
import { getLogger } from "../utils/logger";

const logger = getLogger();

// Cache TTL: 1 hour (for future use)
// const CACHE_TTL_MS = 60 * 60 * 1000;

export class TokenResolver {
  private gammaApi: GammaApiClient;
  private persistence: PersistenceProvider;
  private memoryCache: Map<string, TokenMetadata>;
  private tokenToCondition: Map<string, string>; // token_id -> condition_id

  constructor(gammaApi?: GammaApiClient, persistence?: PersistenceProvider) {
    this.gammaApi = gammaApi || getGammaApiClient();
    this.persistence = persistence || getPersistenceProvider();
    this.memoryCache = new Map();
    this.tokenToCondition = new Map();

    // Load persisted cache into memory
    this.loadCache();
  }

  /**
   * Load persisted token cache into memory
   */
  private async loadCache(): Promise<void> {
    try {
      const cache = await this.persistence.loadTokenCache();

      for (const [conditionId, metadata] of Object.entries(cache.tokens)) {
        this.memoryCache.set(conditionId, metadata);
        // Index tokens for reverse lookup
        if (metadata.yesTokenId) {
          this.tokenToCondition.set(metadata.yesTokenId, conditionId);
        }
        if (metadata.noTokenId) {
          this.tokenToCondition.set(metadata.noTokenId, conditionId);
        }
      }

      logger.debug(`Loaded ${this.memoryCache.size} markets into token cache`);
    } catch (error) {
      logger.warn("Failed to load token cache", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Save memory cache to persistence
   */
  private async saveCache(): Promise<void> {
    try {
      const cache: TokenCache = {
        tokens: Object.fromEntries(this.memoryCache),
        lastUpdated: Date.now(),
      };
      await this.persistence.saveTokenCache(cache);
    } catch (error) {
      logger.warn("Failed to save token cache", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get token metadata by condition ID
   */
  async getByConditionId(conditionId: string): Promise<TokenMetadata | null> {
    // Check memory cache first
    const cached = this.memoryCache.get(conditionId);
    if (cached) {
      return cached;
    }

    // Fetch from Gamma API
    const market = await this.gammaApi.getMarketByConditionId(conditionId);
    if (!market) {
      return null;
    }

    const metadata = this.gammaApi.normalizeMarket(market);
    if (metadata) {
      await this.cacheMetadata(metadata);
    }

    return metadata;
  }

  /**
   * Get token metadata by market slug
   */
  async getBySlug(slug: string): Promise<TokenMetadata | null> {
    // Check if we have it cached by slug
    for (const metadata of this.memoryCache.values()) {
      if (metadata.marketSlug === slug) {
        return metadata;
      }
    }

    // Fetch from Gamma API
    const market = await this.gammaApi.getMarketBySlug(slug);
    if (!market) {
      return null;
    }

    const metadata = this.gammaApi.normalizeMarket(market);
    if (metadata) {
      await this.cacheMetadata(metadata);
    }

    return metadata;
  }

  /**
   * Get token metadata by token ID (either YES or NO token)
   */
  async getByTokenId(tokenId: string): Promise<TokenMetadata | null> {
    // Check reverse index first
    const conditionId = this.tokenToCondition.get(tokenId);
    if (conditionId) {
      return this.memoryCache.get(conditionId) || null;
    }

    // Fetch from Gamma API
    const market = await this.gammaApi.getMarketByTokenId(tokenId);
    if (!market) {
      return null;
    }

    const metadata = this.gammaApi.normalizeMarket(market);
    if (metadata) {
      await this.cacheMetadata(metadata);
    }

    return metadata;
  }

  /**
   * Resolve a token ID for order placement
   * Given partial information (tokenId, conditionId, slug, outcome),
   * returns the correct token ID for the CLOB
   */
  async resolveTokenId(params: {
    tokenId?: string;
    conditionId?: string;
    marketSlug?: string;
    outcome?: "YES" | "NO";
  }): Promise<string | null> {
    // If tokenId is already provided and looks valid, use it directly
    // Token IDs are long numeric strings (77+ digits)
    if (params.tokenId && params.tokenId.length > 20) {
      // Try to verify it exists in our cache or API
      try {
        const metadata = await this.getByTokenId(params.tokenId);
        if (metadata) {
          // Found it - return the matching token
          if (
            params.tokenId === metadata.yesTokenId ||
            params.tokenId === metadata.noTokenId
          ) {
            return params.tokenId;
          }
        }
      } catch {
        // API lookup failed - token might be expired/unavailable
        logger.debug(
          `Token lookup failed for ${params.tokenId.substring(
            0,
            20
          )}..., using directly`
        );
      }

      // Even if we can't verify via API, use the token ID directly
      // This is essential for short-term markets that expire quickly
      return params.tokenId;
    }

    // Try to get metadata by condition ID
    if (params.conditionId) {
      try {
        const metadata = await this.getByConditionId(params.conditionId);
        if (metadata) {
          return this.selectToken(metadata, params.outcome);
        }
      } catch {
        logger.debug(`Condition ID lookup failed: ${params.conditionId}`);
      }
    }

    // Try to get metadata by market slug
    if (params.marketSlug) {
      try {
        const metadata = await this.getBySlug(params.marketSlug);
        if (metadata) {
          return this.selectToken(metadata, params.outcome);
        }
      } catch {
        logger.debug(`Slug lookup failed: ${params.marketSlug}`);
      }
    }

    return null;
  }

  /**
   * Select the appropriate token from metadata based on outcome
   */
  private selectToken(metadata: TokenMetadata, outcome?: "YES" | "NO"): string {
    if (outcome === "NO") {
      return metadata.noTokenId;
    }
    // Default to YES token
    return metadata.yesTokenId;
  }

  /**
   * Determine if a token ID is YES or NO
   */
  async getTokenOutcome(tokenId: string): Promise<"YES" | "NO" | null> {
    const metadata = await this.getByTokenId(tokenId);
    if (!metadata) {
      return null;
    }

    if (tokenId === metadata.yesTokenId) {
      return "YES";
    }
    if (tokenId === metadata.noTokenId) {
      return "NO";
    }
    return null;
  }

  /**
   * Cache token metadata
   */
  private async cacheMetadata(metadata: TokenMetadata): Promise<void> {
    this.memoryCache.set(metadata.conditionId, metadata);

    // Update reverse index
    if (metadata.yesTokenId) {
      this.tokenToCondition.set(metadata.yesTokenId, metadata.conditionId);
    }
    if (metadata.noTokenId) {
      this.tokenToCondition.set(metadata.noTokenId, metadata.conditionId);
    }

    // Persist cache
    await this.saveCache();
  }

  /**
   * Prefetch and cache markets for given slugs
   */
  async prefetchMarkets(slugs: string[]): Promise<number> {
    let cached = 0;

    for (const slug of slugs) {
      try {
        const metadata = await this.getBySlug(slug);
        if (metadata) {
          cached++;
        }
      } catch (error) {
        logger.warn(`Failed to prefetch market: ${slug}`, {
          error: (error as Error).message,
        });
      }
    }

    return cached;
  }

  /**
   * Clear the token cache
   */
  async clearCache(): Promise<void> {
    this.memoryCache.clear();
    this.tokenToCondition.clear();
    await this.persistence.saveTokenCache({ tokens: {}, lastUpdated: 0 });
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; conditionIds: number; tokenIds: number } {
    return {
      size: this.memoryCache.size,
      conditionIds: this.memoryCache.size,
      tokenIds: this.tokenToCondition.size,
    };
  }
}

// Singleton instance
let tokenResolverInstance: TokenResolver | null = null;

export function getTokenResolver(): TokenResolver {
  if (!tokenResolverInstance) {
    tokenResolverInstance = new TokenResolver();
  }
  return tokenResolverInstance;
}

export function resetTokenResolver(): void {
  tokenResolverInstance = null;
}
