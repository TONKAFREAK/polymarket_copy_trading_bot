/**
 * Polymarket CLOB Client wrapper
 * Handles order placement and wallet interaction
 * Uses Builder Signing SDK for order attribution
 */

import { ethers } from "ethers";
import { ClobClient, AssetType } from "@polymarket/clob-client";
import { Side } from "@polymarket/clob-client/dist/types";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { OrderRequest, OrderResult, TradeSide } from "../copier/types";
import { getEnvConfig } from "../config/env";
import { getLogger } from "../utils/logger";

const logger = getLogger();

// Chain configuration
const CHAIN_CONFIG = {
  137: {
    name: "Polygon Mainnet",
    rpcUrl: "https://polygon-rpc.com",
    clobUrl: "https://clob.polymarket.com",
  },
  80001: {
    name: "Mumbai Testnet",
    rpcUrl: "https://rpc-mumbai.maticvigil.com",
    clobUrl: "https://clob.polymarket.com", // May differ for testnet
  },
};

export interface ClobClientConfig {
  privateKey: string;
  chainId: number;
  clobUrl?: string;
  rpcUrl?: string;
}

export class ClobClientWrapper {
  private client: ClobClient | null = null;
  private wallet: ethers.Wallet | null = null;
  private config: ClobClientConfig;
  private initialized: boolean = false;
  // Cache market params for faster order placement
  private marketParamsCache: Map<
    string,
    {
      tickSize: string;
      negRisk: boolean;
      feeRateBps: number;
      timestamp: number;
    }
  > = new Map();
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache

  constructor(config: ClobClientConfig) {
    this.config = config;
  }

  /**
   * Initialize the CLOB client
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const env = getEnvConfig();
    const chainConfig =
      CHAIN_CONFIG[this.config.chainId as keyof typeof CHAIN_CONFIG];

    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${this.config.chainId}`);
    }

    // Create wallet from private key
    const provider = new ethers.providers.JsonRpcProvider(
      this.config.rpcUrl || chainConfig.rpcUrl
    );

    // Ensure private key has 0x prefix
    const pk = this.config.privateKey.startsWith("0x")
      ? this.config.privateKey
      : `0x${this.config.privateKey}`;

    this.wallet = new ethers.Wallet(pk, provider);

    logger.info("Initializing CLOB client", {
      chain: chainConfig.name,
      walletAddress: this.wallet.address,
    });

    // Initialize CLOB client
    const clobUrl =
      this.config.clobUrl || chainConfig.clobUrl || env.clobApiUrl;

    // Check if we have Builder API credentials
    const hasBuilderCreds =
      env.polyApiKey && env.polyApiSecret && env.polyPassphrase;

    if (!hasBuilderCreds) {
      throw new Error(
        "Builder API credentials required. Set POLY_API_KEY, POLY_API_SECRET, and POLY_PASSPHRASE in .env. " +
          "Get these from https://builders.polymarket.com/"
      );
    }

    // Create Builder config for local signing (credentials stay on this server)
    const builderConfig = new BuilderConfig({
      localBuilderCreds: {
        key: env.polyApiKey!,
        secret: env.polyApiSecret!,
        passphrase: env.polyPassphrase!,
      },
    });

    logger.info("Builder credentials configured", {
      keyPrefix: env.polyApiKey!.substring(0, 8) + "...",
    });

    // First, derive user API credentials from the wallet
    // This creates/retrieves credentials for the wallet itself
    const tempClient = new ClobClient(
      clobUrl,
      this.config.chainId,
      this.wallet
    );

    let userCreds;
    try {
      userCreds = await tempClient.createOrDeriveApiKey();
      logger.info("User API credentials derived successfully");
    } catch (error) {
      logger.error("Failed to derive user API credentials", {
        error: (error as Error).message,
      });
      throw new Error(
        "Failed to derive API credentials. Make sure your wallet has been used on Polymarket. " +
          "Visit https://polymarket.com and make at least one trade first."
      );
    }

    // Initialize the full client with:
    // - User credentials (for wallet authentication)
    // - Builder config (for order attribution)
    // signatureType: 0 = EOA wallet, 1 = Magic/Email, 2 = Safe proxy
    const signatureType = env.polySignatureType;
    const funderAddress = env.polyFunderAddress;

    logger.info("Setting up CLOB client", {
      signatureType,
      funderAddress: funderAddress || "(not set - using wallet address)",
      walletAddress: this.wallet.address,
    });

    this.client = new ClobClient(
      clobUrl,
      this.config.chainId,
      this.wallet,
      userCreds,
      signatureType,
      funderAddress, // Polymarket profile address for Magic/Email login
      undefined, // options
      false, // useServerTime
      builderConfig
    );

    logger.info("CLOB client initialized with Builder attribution");
    this.initialized = true;
  }

  /**
   * Get the wallet address
   */
  getWalletAddress(): string {
    if (!this.wallet) {
      throw new Error("Client not initialized");
    }
    return this.wallet.address;
  }

  /**
   * Place an order on the CLOB
   * Uses the current Polymarket API format with tickSize and negRisk
   */
  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    if (!this.client || !this.wallet) {
      throw new Error("Client not initialized. Call initialize() first.");
    }

    try {
      logger.debug("Placing order", {
        tokenId: request.tokenId,
        side: request.side,
        price: request.price,
        size: request.size,
      });

      // Get market parameters (with caching for speed)
      let tickSize = "0.01"; // Default
      let negRisk = false; // Default
      let feeRateBps: number | undefined = undefined; // Let API use default if not fetched

      // Check cache first for faster order placement
      const cached = this.marketParamsCache.get(request.tokenId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
        tickSize = cached.tickSize;
        negRisk = cached.negRisk;
        feeRateBps = cached.feeRateBps;
        logger.debug("Using cached market params", {
          tickSize,
          negRisk,
          feeRateBps,
        });
      } else {
        try {
          // Fetch in parallel for speed (including fee rate from API)
          const [fetchedTickSize, fetchedNegRisk, fetchedFeeRateBps] =
            await Promise.all([
              this.client.getTickSize(request.tokenId),
              this.client.getNegRisk(request.tokenId),
              this.client.getFeeRateBps(request.tokenId),
            ]);
          tickSize = fetchedTickSize;
          negRisk = fetchedNegRisk;
          feeRateBps = fetchedFeeRateBps;
          // Cache for future orders
          this.marketParamsCache.set(request.tokenId, {
            tickSize,
            negRisk,
            feeRateBps,
            timestamp: Date.now(),
          });
          logger.debug("Fetched and cached market params", {
            tickSize,
            negRisk,
            feeRateBps,
          });
        } catch (e) {
          logger.debug("Using default market params (fee rate from API)", {
            tickSize,
            negRisk,
          });
        }
      }

      // Build order request - only include feeRateBps if we have it from API
      const orderRequest: any = {
        tokenID: request.tokenId,
        side: request.side === "BUY" ? Side.BUY : Side.SELL,
        price: request.price,
        size: request.size,
      };

      // Only specify feeRateBps if we fetched it from API (valid value)
      if (feeRateBps !== undefined) {
        orderRequest.feeRateBps = feeRateBps;
      }

      // Use createAndPostOrder for atomic order creation and posting
      const response = await this.client.createAndPostOrder(orderRequest, {
        tickSize,
        negRisk,
      });

      // Log full response for debugging
      logger.debug("Order response received", {
        response: JSON.stringify(response),
        hasOrderId: !!(response && response.orderID),
      });

      if (response && response.orderID) {
        logger.info("Order placed successfully", {
          orderId: response.orderID,
          tokenId: request.tokenId,
          side: request.side,
          price: request.price,
          size: request.size,
        });

        return {
          success: true,
          orderId: response.orderID,
          executedPrice: request.price,
          executedSize: request.size,
        };
      } else {
        // Log the full response to understand why no order ID
        const errorMsg =
          response?.errorMsg || response?.error || "No order ID returned";
        logger.warn("Order submission issue", {
          response: JSON.stringify(response),
          errorMsg,
        });
        return {
          success: false,
          errorMessage: String(errorMsg),
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error("Failed to place order", {
        error: errorMessage,
        tokenId: request.tokenId,
        side: request.side,
      });

      return {
        success: false,
        errorMessage,
      };
    }
  }

  /**
   * Place a marketable limit order (with slippage)
   */
  async placeMarketableLimitOrder(
    tokenId: string,
    side: TradeSide,
    targetPrice: number,
    size: number,
    slippage: number = 0.01
  ): Promise<OrderResult> {
    // Calculate limit price with slippage
    let limitPrice: number;
    if (side === "BUY") {
      // For BUY, we're willing to pay more
      limitPrice = Math.min(targetPrice * (1 + slippage), 0.99);
    } else {
      // For SELL, we're willing to accept less
      limitPrice = Math.max(targetPrice * (1 - slippage), 0.01);
    }

    // Round to 2 decimal places (Polymarket price precision)
    limitPrice = Math.round(limitPrice * 100) / 100;

    const orderRequest: OrderRequest = {
      tokenId,
      side,
      price: limitPrice,
      size,
      type: "GTC",
    };

    return this.placeOrder(orderRequest);
  }

  /**
   * Get open orders
   */
  async getOpenOrders(): Promise<unknown[]> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      const orders = await this.client.getOpenOrders();
      return orders || [];
    } catch (error) {
      logger.error("Failed to get open orders", {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      await this.client.cancelOrder(orderId);
      logger.info("Order cancelled", { orderId });
      return true;
    } catch (error) {
      logger.error("Failed to cancel order", {
        orderId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Cancel all open orders
   */
  async cancelAllOrders(): Promise<number> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      await this.client.cancelAll();
      logger.info("All orders cancelled");
      return 1; // Return success indicator
    } catch (error) {
      logger.error("Failed to cancel all orders", {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  /**
   * Get Polymarket account balances (USDC deposited in Polymarket, not on-chain)
   */
  async getBalances(): Promise<{ usdc: string; matic: string }> {
    if (!this.wallet || !this.client) {
      throw new Error("Client not initialized");
    }

    try {
      // Get MATIC balance from wallet (on-chain)
      const maticBalance = await this.wallet.getBalance();

      // Get USDC balance from Polymarket account (not on-chain!)
      // This is the collateral balance deposited into Polymarket for trading
      logger.info("Fetching Polymarket collateral balance...");

      const collateralBalance = await this.client.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });

      // Balance is returned in micro USDC (6 decimals), convert to USD
      const rawBalance = collateralBalance.balance || "0";
      const usdBalance = (parseFloat(rawBalance) / 1_000_000).toFixed(6);

      logger.info("Polymarket balance fetched", {
        rawBalance: rawBalance,
        usdBalance: usdBalance,
        maticBalance: ethers.utils.formatEther(maticBalance),
        walletAddress: this.wallet.address,
      });

      return {
        usdc: usdBalance,
        matic: ethers.utils.formatEther(maticBalance),
      };
    } catch (error) {
      logger.error("Failed to get balances from Polymarket API", {
        error: (error as Error).message,
        stack: (error as Error).stack,
        walletAddress: this.wallet.address,
      });

      // Return 0 but log the full error for debugging
      return { usdc: "0", matic: "0" };
    }
  }

  /**
   * Simulate an order (dry run)
   */
  simulateOrder(request: OrderRequest): OrderResult {
    logger.info("Simulating order (dry-run)", {
      tokenId: request.tokenId,
      side: request.side,
      price: request.price,
      size: request.size,
    });

    return {
      success: true,
      orderId: `DRY_RUN_${Date.now()}`,
      executedPrice: request.price,
      executedSize: request.size,
    };
  }

  /**
   * Get trade history for the authenticated user
   * Fetches all trades from the CLOB API
   */
  async getTrades(): Promise<{
    trades: Array<{
      id: string;
      asset_id: string;
      side: string;
      size: string;
      price: string;
      market: string;
      match_time: string;
      outcome: string;
    }>;
    count: number;
  }> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      // Use the CLOB client's getTrades method
      const trades = await this.client.getTrades();
      logger.debug(`Fetched ${trades?.length || 0} trades from CLOB API`);

      return {
        trades: (trades || []).map((t) => ({
          id: t.id,
          asset_id: t.asset_id,
          side: t.side,
          size: t.size,
          price: t.price,
          market: t.market,
          match_time: t.match_time,
          outcome: t.outcome,
        })),
        count: trades?.length || 0,
      };
    } catch (error) {
      logger.error("Failed to fetch trades", {
        error: (error as Error).message,
      });
      return { trades: [], count: 0 };
    }
  }

  /**
   * Get paginated trade history with metadata
   */
  async getTradesPaginated(options?: { market?: string }): Promise<{
    trades: Array<{
      id: string;
      asset_id: string;
      side: string;
      size: string;
      price: string;
      market: string;
      match_time: string;
      outcome: string;
    }>;
    next_cursor: string;
    count: number;
    limit: number;
  }> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      const result = await this.client.getTradesPaginated(
        options?.market ? { market: options.market } : undefined
      );
      return {
        trades: (result.data || []).map((t) => ({
          id: t.id,
          asset_id: t.asset_id,
          side: t.side,
          size: t.size,
          price: t.price,
          market: t.market,
          match_time: t.match_time,
          outcome: t.outcome,
        })),
        next_cursor: result.next_cursor || "",
        count: result.data?.length || 0,
        limit: 100,
      };
    } catch (error) {
      logger.error("Failed to fetch paginated trades", {
        error: (error as Error).message,
      });
      return { trades: [], next_cursor: "", count: 0, limit: 100 };
    }
  }

  /**
   * Get current positions (aggregated from trade history)
   * Returns net positions with shares held, average entry price, and resolution status
   */
  async getPositions(): Promise<{
    positions: Array<{
      tokenId: string;
      outcome: string;
      shares: number;
      avgEntryPrice: number;
      currentValue: number;
      market: string;
      conditionId?: string;
      isResolved?: boolean;
      isRedeemable?: boolean;
    }>;
    totalValue: number;
  }> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      // Import gamma API for market info
      const { getGammaApiClient } = await import("./gammaApi");
      const gammaApi = getGammaApiClient();

      // Fetch all trades
      const { trades } = await this.getTrades();

      // Aggregate trades into positions by asset_id
      const positionMap = new Map<
        string,
        {
          tokenId: string;
          outcome: string;
          shares: number;
          totalCost: number;
          market: string;
        }
      >();

      for (const trade of trades) {
        const tokenId = trade.asset_id;
        const size = parseFloat(trade.size) || 0;
        const price = parseFloat(trade.price) || 0;
        const isBuy = trade.side === "BUY";

        let pos = positionMap.get(tokenId);
        if (!pos) {
          pos = {
            tokenId,
            outcome: trade.outcome || "Yes",
            shares: 0,
            totalCost: 0,
            market: trade.market,
          };
          positionMap.set(tokenId, pos);
        }

        if (isBuy) {
          pos.shares += size;
          pos.totalCost += size * price;
        } else {
          pos.shares -= size;
          pos.totalCost -= size * price;
        }
      }

      // Convert to array and filter out zero positions
      const positions: Array<{
        tokenId: string;
        outcome: string;
        shares: number;
        avgEntryPrice: number;
        currentValue: number;
        market: string;
        conditionId?: string;
        isResolved?: boolean;
        isRedeemable?: boolean;
      }> = [];

      let totalValue = 0;

      for (const pos of positionMap.values()) {
        if (Math.abs(pos.shares) >= 0.01) {
          // Get current token balance to verify
          const { balance } = await this.getTokenBalance(pos.tokenId);
          // Balance is in micro-units (6 decimals), convert to actual shares
          const rawBalance = parseFloat(balance) || 0;
          const actualShares = rawBalance / 1_000_000;

          if (actualShares >= 0.01) {
            const avgPrice = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
            // Current value = shares * avg entry price
            const currentValue = actualShares * avgPrice;

            // Fetch market info for resolution status
            let marketName = pos.market || "Unknown";
            let conditionId: string | undefined;
            let isResolved = false;
            let isRedeemable = false;

            try {
              const marketInfo = await gammaApi.getMarketByTokenId(pos.tokenId);
              if (marketInfo) {
                marketName = String(
                  marketInfo.question ||
                    marketInfo.title ||
                    pos.market ||
                    "Unknown"
                );
                conditionId = marketInfo.conditionId
                  ? String(marketInfo.conditionId)
                  : undefined;
                isResolved =
                  marketInfo.closed === true ||
                  String(marketInfo.closed) === "true";

                // Check if redeemable (resolved AND we might be a winner)
                // For now, mark as redeemable if resolved - actual redemption will verify
                if (isResolved && conditionId) {
                  isRedeemable = true;
                }
              }
            } catch {
              // Ignore market fetch errors
            }

            positions.push({
              tokenId: pos.tokenId,
              outcome: pos.outcome,
              shares: actualShares,
              avgEntryPrice: avgPrice,
              currentValue,
              market: marketName,
              conditionId,
              isResolved,
              isRedeemable,
            });

            totalValue += currentValue;
          }
        }
      }

      logger.debug(
        `Found ${
          positions.length
        } open positions, total value: $${totalValue.toFixed(2)}`
      );

      return { positions, totalValue };
    } catch (error) {
      logger.error("Failed to get positions", {
        error: (error as Error).message,
      });
      return { positions: [], totalValue: 0 };
    }
  }

  /**
   * Get conditional token balance for a specific token ID
   */
  async getTokenBalance(
    tokenId: string
  ): Promise<{ balance: string; allowance: string }> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      const result = await this.client.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: tokenId,
      });
      return {
        balance: result.balance || "0",
        allowance: result.allowance || "0",
      };
    } catch (error) {
      logger.error("Failed to get token balance", {
        error: (error as Error).message,
        tokenId: tokenId.substring(0, 16) + "...",
      });
      return { balance: "0", allowance: "0" };
    }
  }

  /**
   * Refresh/update balance cache
   */
  async updateBalanceCache(): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      await this.client.updateBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });
      logger.debug("Balance cache updated");
    } catch (error) {
      logger.error("Failed to update balance cache", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get detailed live stats for dashboard
   * Returns balance, open orders count, recent trade stats
   */
  async getLiveStats(): Promise<{
    balance: number;
    openOrdersCount: number;
    recentTradesCount: number;
    totalVolume: number;
  }> {
    if (!this.client || !this.wallet) {
      throw new Error("Client not initialized");
    }

    try {
      // Fetch in parallel for speed
      const [balances, openOrders, trades] = await Promise.all([
        this.getBalances(),
        this.getOpenOrders(),
        this.getTrades(),
      ]);

      // Calculate total volume from trades (trades may have various shapes)
      let totalVolume = 0;
      (trades.trades || []).forEach((trade: Record<string, unknown>) => {
        const price = parseFloat(String(trade.price || 0)) || 0;
        const size = parseFloat(String(trade.size || 0)) || 0;
        totalVolume += price * size;
      });

      return {
        balance: parseFloat(balances.usdc) || 0,
        openOrdersCount: (openOrders as unknown[]).length,
        recentTradesCount: trades.count,
        totalVolume,
      };
    } catch (error) {
      logger.error("Failed to get live stats", {
        error: (error as Error).message,
      });
      return {
        balance: 0,
        openOrdersCount: 0,
        recentTradesCount: 0,
        totalVolume: 0,
      };
    }
  }

  /**
   * Get the underlying CLOB client for advanced operations
   */
  getClient(): ClobClient | null {
    return this.client;
  }

  /**
   * Get the wallet
   */
  getWallet(): ethers.Wallet | null {
    return this.wallet;
  }
}

// Singleton instance
let clobClientInstance: ClobClientWrapper | null = null;

export async function getClobClient(
  forceNew: boolean = false
): Promise<ClobClientWrapper> {
  if (clobClientInstance && !forceNew) {
    return clobClientInstance;
  }

  const env = getEnvConfig();

  clobClientInstance = new ClobClientWrapper({
    privateKey: env.privateKey,
    chainId: env.chainId,
    clobUrl: env.clobApiUrl,
    rpcUrl: env.rpcUrl,
  });

  await clobClientInstance.initialize();
  return clobClientInstance;
}

export function resetClobClient(): void {
  clobClientInstance = null;
}
