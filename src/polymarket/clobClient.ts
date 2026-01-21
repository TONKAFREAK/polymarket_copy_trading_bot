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

  // Pending balance tracking to prevent concurrent orders exceeding balance
  private pendingOrderValue: number = 0;
  private lastKnownBalance: number = 0;
  private lastBalanceFetchTime: number = 0;
  private readonly BALANCE_CACHE_MS = 5000; // Cache balance for 5 seconds

  // Sequential order processing to avoid race conditions
  private orderQueuePromise: Promise<void> = Promise.resolve();
  private lastBalanceInsufficientTime: number = 0;
  private readonly BALANCE_COOLDOWN_MS = 10000; // Wait 10s after balance error

  constructor(config: ClobClientConfig) {
    this.config = config;
  }

  /**
   * Get available balance considering pending orders
   */
  private getAvailableBalance(): number {
    return Math.max(0, this.lastKnownBalance - this.pendingOrderValue);
  }

  /**
   * Reserve balance for a pending order
   */
  private reserveBalance(amount: number): void {
    this.pendingOrderValue += amount;
    logger.debug("Balance reserved for order", {
      amount: amount.toFixed(2),
      pendingTotal: this.pendingOrderValue.toFixed(2),
      available: this.getAvailableBalance().toFixed(2),
    });
  }

  /**
   * Release reserved balance (on order completion or failure)
   */
  private releaseBalance(amount: number): void {
    this.pendingOrderValue = Math.max(0, this.pendingOrderValue - amount);
    logger.debug("Balance released", {
      amount: amount.toFixed(2),
      pendingTotal: this.pendingOrderValue.toFixed(2),
    });
  }

  /**
   * Check if we're in balance cooldown (after insufficient balance error)
   */
  private isInBalanceCooldown(): boolean {
    return (
      Date.now() - this.lastBalanceInsufficientTime < this.BALANCE_COOLDOWN_MS
    );
  }

  /**
   * Reset balance tracking state
   * Call this after manual balance changes or to clear cooldown
   */
  resetBalanceTracking(): void {
    this.pendingOrderValue = 0;
    this.lastKnownBalance = 0;
    this.lastBalanceFetchTime = 0;
    this.lastBalanceInsufficientTime = 0;
    logger.info("Balance tracking state reset");
  }

  /**
   * Get current balance tracking state for debugging
   */
  getBalanceTrackingState(): {
    lastKnownBalance: number;
    pendingOrderValue: number;
    availableBalance: number;
    inCooldown: boolean;
    cooldownRemaining: number;
  } {
    return {
      lastKnownBalance: this.lastKnownBalance,
      pendingOrderValue: this.pendingOrderValue,
      availableBalance: this.getAvailableBalance(),
      inCooldown: this.isInBalanceCooldown(),
      cooldownRemaining: this.isInBalanceCooldown()
        ? Math.ceil(
            (this.BALANCE_COOLDOWN_MS -
              (Date.now() - this.lastBalanceInsufficientTime)) /
              1000,
          )
        : 0,
    };
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
      this.config.rpcUrl || chainConfig.rpcUrl,
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
          "Get these from https://builders.polymarket.com/",
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
      this.wallet,
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
          "Visit https://polymarket.com and make at least one trade first.",
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
      builderConfig,
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
   * Includes pre-flight balance check and minimum order validation
   * Orders are processed sequentially to prevent race conditions
   */
  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    // Queue this order to ensure sequential processing
    const result = await this.queueOrder(request);
    return result;
  }

  /**
   * Internal method to queue and process orders sequentially
   */
  private async queueOrder(request: OrderRequest): Promise<OrderResult> {
    // Wait for any pending orders to complete
    const previousPromise = this.orderQueuePromise;
    let resolve: (value: OrderResult) => void;

    this.orderQueuePromise = new Promise<void>((res) => {
      resolve = (result: OrderResult) => {
        res();
        return result;
      };
    });

    await previousPromise;

    // Now process this order
    const result = await this.processOrder(request);
    resolve!(result);
    return result;
  }

  /**
   * Internal method to actually process an order
   */
  private async processOrder(request: OrderRequest): Promise<OrderResult> {
    if (!this.client || !this.wallet) {
      throw new Error("Client not initialized. Call initialize() first.");
    }

    // Check if we're in balance cooldown (recent insufficient balance error)
    if (request.side === "BUY" && this.isInBalanceCooldown()) {
      logger.debug("Skipping order due to balance cooldown", {
        orderValue: (request.price * request.size).toFixed(2),
        cooldownRemaining: Math.ceil(
          (this.BALANCE_COOLDOWN_MS -
            (Date.now() - this.lastBalanceInsufficientTime)) /
            1000,
        ),
      });
      return {
        success: false,
        errorMessage:
          "Temporarily paused - insufficient balance detected recently",
      };
    }

    // Validate minimum order size (Polymarket minimum is typically $1 or 1 share)
    const orderValue = request.price * request.size;
    const MIN_ORDER_VALUE_USD = 0.5; // Minimum $0.50 order
    const MIN_ORDER_SHARES = 0.1; // Minimum 0.1 shares

    if (orderValue < MIN_ORDER_VALUE_USD) {
      logger.warn("Order value too small, skipping", {
        orderValue: orderValue.toFixed(4),
        minRequired: MIN_ORDER_VALUE_USD,
      });
      return {
        success: false,
        errorMessage: `Order value $${orderValue.toFixed(2)} below minimum $${MIN_ORDER_VALUE_USD}`,
      };
    }

    if (request.size < MIN_ORDER_SHARES) {
      logger.warn("Order size too small, skipping", {
        size: request.size,
        minRequired: MIN_ORDER_SHARES,
      });
      return {
        success: false,
        errorMessage: `Order size ${request.size.toFixed(4)} below minimum ${MIN_ORDER_SHARES}`,
      };
    }

    // Pre-flight balance check for BUY orders (with pending order tracking)
    const requiredUsdc = orderValue * 1.01; // Add 1% buffer for fees

    if (request.side === "BUY") {
      try {
        // Fetch balance if cache is stale
        const now = Date.now();
        if (now - this.lastBalanceFetchTime > this.BALANCE_CACHE_MS) {
          const balances = await this.getBalances();
          this.lastKnownBalance = parseFloat(balances.usdc) || 0;
          this.lastBalanceFetchTime = now;
        }

        const availableBalance = this.getAvailableBalance();

        if (availableBalance < requiredUsdc) {
          logger.warn("Insufficient available balance for order", {
            lastKnownBalance: this.lastKnownBalance.toFixed(2),
            pendingOrders: this.pendingOrderValue.toFixed(2),
            available: availableBalance.toFixed(2),
            required: requiredUsdc.toFixed(2),
          });
          return {
            success: false,
            errorMessage: `Insufficient balance: have $${availableBalance.toFixed(2)} available, need $${requiredUsdc.toFixed(2)}`,
          };
        }
      } catch (balanceError) {
        // Don't fail the order if balance check fails - proceed anyway
        logger.debug("Balance check failed, proceeding with order", {
          error: (balanceError as Error).message,
        });
      }
    }

    // For SELL orders, verify we have the shares
    if (request.side === "SELL") {
      try {
        const { balance } = await this.getTokenBalance(request.tokenId);
        const availableShares = parseFloat(balance) / 1_000_000; // Convert from micro-units

        if (availableShares < request.size) {
          logger.warn("Insufficient shares for sell order", {
            available: availableShares.toFixed(4),
            required: request.size.toFixed(4),
          });
          return {
            success: false,
            errorMessage: `Insufficient shares: have ${availableShares.toFixed(2)}, need ${request.size.toFixed(2)}`,
          };
        }
      } catch (shareError) {
        // Don't fail if share check fails
        logger.debug("Share balance check failed, proceeding", {
          error: (shareError as Error).message,
        });
      }
    }

    // Reserve balance for this order (for BUY orders)
    if (request.side === "BUY") {
      this.reserveBalance(requiredUsdc);
    }

    try {
      logger.debug("Placing order", {
        tokenId: request.tokenId,
        side: request.side,
        price: request.price,
        size: request.size,
        orderValue: orderValue.toFixed(2),
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

      // Cast response to access all possible fields
      const resp = response as {
        orderID?: string;
        status?: string;
        transactionsHashes?: string[];
        errorMsg?: string;
        error?: string | object;
        message?: string;
      };

      // Log full response for debugging
      logger.debug("Order response received", {
        response: JSON.stringify(response),
        hasOrderId: !!(resp && resp.orderID),
        status: resp?.status,
        transactionsHashes: resp?.transactionsHashes,
      });

      // Handle successful order - either has orderID or transactionsHashes
      const txHashes = resp?.transactionsHashes;
      if (
        resp &&
        (resp.orderID || (Array.isArray(txHashes) && txHashes.length > 0))
      ) {
        const orderId = resp.orderID || txHashes?.[0] || `order-${Date.now()}`;
        logger.info("Order placed successfully", {
          orderId,
          status: resp.status,
          tokenId: request.tokenId,
          side: request.side,
          price: request.price,
          size: request.size,
        });

        // Order succeeded - update balance tracking
        // For BUY: the balance is now reduced by order value (keep reserved as spent)
        // For SELL: balance will increase when filled
        if (request.side === "BUY") {
          const orderCost = request.price * request.size * 1.01;
          // The reserved amount stays reserved until order fills/cancels
          // But we should update our known balance to reflect the commitment
          this.lastKnownBalance = Math.max(
            0,
            this.lastKnownBalance - orderCost,
          );
          this.releaseBalance(orderCost); // Remove from pending since it's now committed
        }

        return {
          success: true,
          orderId,
          executedPrice: request.price,
          executedSize: request.size,
        };
      } else {
        // Extract error message from response - handle various formats
        let errorMsg = "No order ID returned";

        // Try various error fields
        if (resp?.errorMsg) {
          errorMsg = resp.errorMsg;
        } else if (resp?.error) {
          errorMsg =
            typeof resp.error === "string"
              ? resp.error
              : JSON.stringify(resp.error);
        } else if (resp?.message) {
          errorMsg = resp.message;
        } else if (
          resp?.status &&
          resp.status !== "open" &&
          resp.status !== "matched"
        ) {
          // The status field itself might describe the issue
          errorMsg = `Order status: ${resp.status}`;
        }

        // Clean up error message - remove HTML if present (rate limit/Cloudflare pages)
        if (errorMsg.includes("<!DOCTYPE") || errorMsg.includes("<html")) {
          errorMsg = "API rate limited or blocked";
        }

        // Truncate very long error messages
        if (errorMsg.length > 100) {
          errorMsg = errorMsg.substring(0, 97) + "...";
        }

        // Check for balance/allowance error
        if (
          errorMsg.toLowerCase().includes("balance") ||
          errorMsg.toLowerCase().includes("allowance")
        ) {
          this.lastBalanceInsufficientTime = Date.now();
          this.lastKnownBalance = 0; // Reset to force re-fetch
          logger.warn("Balance/allowance error detected, entering cooldown", {
            cooldownMs: this.BALANCE_COOLDOWN_MS,
          });
        }

        logger.warn("Order submission issue", {
          response: JSON.stringify(resp),
          errorMsg,
        });

        // Release reserved balance
        if (request.side === "BUY") {
          this.releaseBalance(request.price * request.size * 1.01);
        }

        return {
          success: false,
          errorMessage: errorMsg,
        };
      }
    } catch (error) {
      let errorMessage = (error as Error).message;

      // Check for balance/allowance error from API response
      const errorStr = String(error);
      if (
        errorStr.includes("not enough balance") ||
        errorStr.includes("allowance")
      ) {
        this.lastBalanceInsufficientTime = Date.now();
        this.lastKnownBalance = 0; // Reset to force re-fetch
        errorMessage = "Insufficient balance/allowance";
        logger.warn("Balance/allowance error from API, entering cooldown", {
          cooldownMs: this.BALANCE_COOLDOWN_MS,
        });
      }

      // Clean up common error messages
      if (
        errorMessage.includes("<!DOCTYPE") ||
        errorMessage.includes("<html")
      ) {
        errorMessage = "API rate limited or blocked";
      } else if (
        errorMessage.includes("ECONNRESET") ||
        errorMessage.includes("ETIMEDOUT")
      ) {
        errorMessage = "Connection error - network issue";
      } else if (errorMessage.includes("socket hang up")) {
        errorMessage = "Connection dropped";
      }

      // Truncate if too long
      if (errorMessage.length > 100) {
        errorMessage = errorMessage.substring(0, 97) + "...";
      }

      logger.error("Failed to place order", {
        error: errorMessage,
        tokenId: request.tokenId,
        side: request.side,
      });

      // Release reserved balance
      if (request.side === "BUY") {
        this.releaseBalance(request.price * request.size * 1.01);
      }

      return {
        success: false,
        errorMessage,
      };
    }
  }

  /**
   * Place a marketable limit order (with slippage)
   * Includes automatic retry for transient errors
   */
  async placeMarketableLimitOrder(
    tokenId: string,
    side: TradeSide,
    targetPrice: number,
    size: number,
    slippage: number = 0.01,
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

    // Round size to reasonable precision (avoid floating point issues)
    size = Math.round(size * 100) / 100;

    const orderRequest: OrderRequest = {
      tokenId,
      side,
      price: limitPrice,
      size,
      type: "GTC",
    };

    // Retry logic for transient errors
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 500;
    const RETRYABLE_ERRORS = [
      "rate limit",
      "ECONNRESET",
      "ETIMEDOUT",
      "socket hang up",
      "Connection dropped",
      "Connection error",
      "API blocked",
    ];

    let lastResult: OrderResult | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await this.placeOrder(orderRequest);
      lastResult = result;

      // If successful, return immediately
      if (result.success) {
        return result;
      }

      // Check if error is retryable
      const errorMsg = result.errorMessage || "";
      const isRetryable = RETRYABLE_ERRORS.some((e) =>
        errorMsg.toLowerCase().includes(e.toLowerCase()),
      );

      if (!isRetryable || attempt >= MAX_RETRIES) {
        // Not retryable or max retries reached
        return result;
      }

      // Wait before retry
      logger.debug("Retrying order after transient error", {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        error: errorMsg,
      });

      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)),
      );
    }

    return (
      lastResult || {
        success: false,
        errorMessage: "Max retries exceeded",
      }
    );
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
      fee_rate_bps?: string;
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
          fee_rate_bps: (t as any).fee_rate_bps,
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
        options?.market ? { market: options.market } : undefined,
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
      feesPaid?: number;
    }>;
    totalValue: number;
    totalFees: number;
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
          totalFees: number;
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
            totalFees: 0,
          };
          positionMap.set(tokenId, pos);
        }

        const feeRateBps = parseFloat(trade.fee_rate_bps || "0") || 0;
        const fee = Math.abs(size * price * (feeRateBps / 10000));

        if (isBuy) {
          pos.shares += size;
          // Buy cost includes fee
          pos.totalCost += size * price + fee;
          pos.totalFees += fee;
        } else {
          pos.shares -= size;
          // Sell reduces cost basis by proceeds; fee reduces proceeds
          pos.totalCost -= size * price - fee;
          pos.totalFees += fee;
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
        feesPaid?: number;
      }> = [];

      let totalValue = 0;
      let totalFees = 0;

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
                    "Unknown",
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
              feesPaid: pos.totalFees,
            });

            totalValue += currentValue;
            totalFees += pos.totalFees;
          }
        }
      }

      logger.debug(
        `Found ${
          positions.length
        } open positions, total value: $${totalValue.toFixed(2)}`,
      );

      return { positions, totalValue, totalFees };
    } catch (error) {
      logger.error("Failed to get positions", {
        error: (error as Error).message,
      });
      return { positions: [], totalValue: 0, totalFees: 0 };
    }
  }

  /**
   * Get conditional token balance for a specific token ID
   */
  async getTokenBalance(
    tokenId: string,
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
  forceNew: boolean = false,
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
