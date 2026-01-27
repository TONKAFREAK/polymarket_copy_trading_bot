/**
 * Polymarket CLOB Client wrapper for Electron app
 * Handles order placement and wallet interaction
 * Uses Builder Signing SDK for order attribution
 */

import { ethers } from "ethers";
import { ClobClient, AssetType, OrderType } from "@polymarket/clob-client";
import { Side } from "@polymarket/clob-client/dist/types";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import path from "path";
import fs from "fs";
// Try to import axios to set headers globally for the SDK
let axios: any;
try {
  axios = require("axios");
  if (axios) {
    axios.defaults.headers.common["User-Agent"] =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    axios.defaults.headers.common["Origin"] = "https://polymarket.com";
  }
} catch (e) {
  console.warn("Could not patch axios headers:", e);
}

// Types
export interface OrderRequest {
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  type?: "GTC" | "GTD" | "FOK";
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  executedPrice?: number;
  executedSize?: number;
  errorMessage?: string;
}

// Get data directory for logging
function getDataDir(): string {
  const possiblePaths = [
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "..", "data"),
    path.join(__dirname, "..", "..", "data"),
    path.join(__dirname, "..", "..", "..", "data"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  const fallback = path.join(process.cwd(), "data");
  if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

// API call logger - writes to file
function logApiCall(
  method: string,
  endpoint: string,
  status: number | string,
  data?: any,
  error?: string,
): void {
  try {
    const logDir = path.join(getDataDir(), "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const logFile = path.join(logDir, "api-calls.log");
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      method,
      endpoint,
      status,
      data: data
        ? typeof data === "string"
          ? data.substring(0, 500)
          : JSON.stringify(data).substring(0, 500)
        : undefined,
      error,
    };

    fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n");
  } catch (e) {
    // Silently fail if logging fails
  }
}

// Simple logger for electron context
const logger = {
  info: (msg: string, data?: any) =>
    console.log(`[ClobClient] ${msg}`, data || ""),
  debug: (msg: string, data?: any) =>
    console.log(`[ClobClient DEBUG] ${msg}`, data || ""),
  warn: (msg: string, data?: any) =>
    console.warn(`[ClobClient] ${msg}`, data || ""),
  error: (msg: string, data?: any) =>
    console.error(`[ClobClient ERROR] ${msg}`, data || ""),
};

// Chain configuration with multiple RPC endpoints for fallback
const POLYGON_RPC_ENDPOINTS = [
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.llamarpc.com",
  "https://rpc.ankr.com/polygon",
  "https://polygon-rpc.com",
];

const CHAIN_CONFIG = {
  137: {
    name: "Polygon Mainnet",
    rpcUrl: POLYGON_RPC_ENDPOINTS[0],
    rpcUrls: POLYGON_RPC_ENDPOINTS,
    clobUrl: "https://clob.polymarket.com",
  },
  80001: {
    name: "Mumbai Testnet",
    rpcUrl: "https://rpc-mumbai.maticvigil.com",
    rpcUrls: ["https://rpc-mumbai.maticvigil.com"],
    clobUrl: "https://clob.polymarket.com",
  },
};

// Request throttler to prevent rate limiting
class RequestThrottler {
  private lastRequestTime: number = 0;
  private readonly minInterval: number;
  private pendingRequests: Map<string, Promise<any>> = new Map();
  private consecutiveErrors: number = 0;
  private readonly maxConsecutiveErrors = 3;
  private backoffMultiplier: number = 1;

  constructor(minIntervalMs: number = 200) {
    this.minInterval = minIntervalMs;
  }

  private getAdaptiveInterval(): number {
    // Increase interval when seeing errors
    return this.minInterval * this.backoffMultiplier;
  }

  onError(): void {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      // Exponentially increase backoff up to 8x
      this.backoffMultiplier = Math.min(8, this.backoffMultiplier * 2);
      this.consecutiveErrors = 0;
      console.log(
        `[Throttler] Increasing backoff to ${this.backoffMultiplier}x (${this.getAdaptiveInterval()}ms)`,
      );
    }
  }

  onSuccess(): void {
    this.consecutiveErrors = 0;
    // Gradually decrease backoff on success
    if (this.backoffMultiplier > 1) {
      this.backoffMultiplier = Math.max(1, this.backoffMultiplier * 0.9);
    }
  }

  async throttle<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // If same request is pending, return that promise (deduplication)
    const pendingKey = key;
    if (this.pendingRequests.has(pendingKey)) {
      return this.pendingRequests.get(pendingKey) as Promise<T>;
    }

    const now = Date.now();
    const interval = this.getAdaptiveInterval();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < interval) {
      await new Promise((resolve) =>
        setTimeout(resolve, interval - timeSinceLastRequest),
      );
    }

    this.lastRequestTime = Date.now();

    const promise = fn()
      .then((result) => {
        this.onSuccess();
        return result;
      })
      .catch((error) => {
        const errMsg = error?.message || String(error);
        if (
          errMsg.includes("rate limit") ||
          errMsg.includes("Too many requests") ||
          errMsg.includes("-32090")
        ) {
          this.onError();
        }
        throw error;
      })
      .finally(() => {
        this.pendingRequests.delete(pendingKey);
      });

    this.pendingRequests.set(pendingKey, promise);
    return promise;
  }
}

const globalThrottler = new RequestThrottler(250); // 250ms between requests (more conservative)

export interface ClobClientConfig {
  privateKey: string;
  chainId: number;
  clobUrl?: string;
  rpcUrl?: string;
  polyApiKey?: string;
  polyApiSecret?: string;
  polyPassphrase?: string;
  polyFunderAddress?: string;
  signatureType?: number;
}

export class ClobClientWrapper {
  private client: ClobClient | null = null;
  private wallet: ethers.Wallet | null = null;
  private config: ClobClientConfig;
  private initialized: boolean = false;
  private marketParamsCache: Map<
    string,
    {
      tickSize: string;
      negRisk: boolean;
      feeRateBps: number;
      timestamp: number;
    }
  > = new Map();
  private readonly CACHE_TTL_MS = 60000;

  // Cache for balance to prevent flickering on API errors
  private balanceCache: {
    usdc: string;
    matic: string;
    timestamp: number;
  } | null = null;
  private readonly BALANCE_CACHE_TTL = 30000; // 30 seconds

  // Cache for closed positions (token IDs with 0 balance) - cleared periodically
  private closedPositionsCache: Set<string> = new Set();
  private lastClosedCacheClear: number = 0;
  // Cache for open positions to avoid re-fetching balances too often
  private openPositionsCache: Map<
    string,
    { balance: number; timestamp: number }
  > = new Map();
  private readonly POSITION_CACHE_TTL = 120000; // 2 minutes for open positions (extended to handle API timeouts)

  // RPC provider with fallback support
  private provider: ethers.providers.JsonRpcProvider | null = null;
  private currentRpcIndex: number = 0;
  private rpcUrls: string[] = [];

  // Trades cache to avoid repeated fetching
  private tradesCache: { data: any; timestamp: number } | null = null;
  private readonly TRADES_CACHE_TTL = 15000; // 15 seconds

  constructor(config: ClobClientConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const chainConfig =
      CHAIN_CONFIG[this.config.chainId as keyof typeof CHAIN_CONFIG];

    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${this.config.chainId}`);
    }

    // Setup RPC URLs with fallback
    this.rpcUrls = this.config.rpcUrl
      ? [this.config.rpcUrl, ...chainConfig.rpcUrls]
      : chainConfig.rpcUrls;

    // Create provider with first RPC
    this.provider = new ethers.providers.JsonRpcProvider(this.rpcUrls[0]);
    this.currentRpcIndex = 0;

    // Ensure private key has 0x prefix
    const pk = this.config.privateKey.startsWith("0x")
      ? this.config.privateKey
      : `0x${this.config.privateKey}`;

    this.wallet = new ethers.Wallet(pk, this.provider);

    logger.info("Initializing CLOB client", {
      chain: chainConfig.name,
      walletAddress: this.wallet.address,
    });

    const clobUrl = this.config.clobUrl || chainConfig.clobUrl;

    // Check if we have Builder API credentials
    const hasBuilderCreds =
      this.config.polyApiKey &&
      this.config.polyApiSecret &&
      this.config.polyPassphrase;

    if (!hasBuilderCreds) {
      throw new Error(
        "Builder API credentials required. Set POLY_API_KEY, POLY_API_SECRET, and POLY_PASSPHRASE.",
      );
    }

    // Create Builder config for local signing
    const builderConfig = new BuilderConfig({
      localBuilderCreds: {
        key: this.config.polyApiKey!,
        secret: this.config.polyApiSecret!,
        passphrase: this.config.polyPassphrase!,
      },
    });

    logger.info("Builder credentials configured");

    // Derive user API credentials from the wallet
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
        "Failed to derive API credentials. Make sure your wallet has been used on Polymarket.",
      );
    }

    const signatureType = this.config.signatureType ?? 0;
    const funderAddress = this.config.polyFunderAddress;

    logger.info("Creating CLOB client with config", {
      clobUrl,
      chainId: this.config.chainId,
      walletAddress: this.wallet.address,
      signatureType,
      funderAddress: funderAddress || "(using wallet address)",
    });

    // Custom options to avoid Cloudflare blocks (if supported by SDK)
    const apiOptions = {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Origin: "https://polymarket.com",
      },
    };

    this.client = new ClobClient(
      clobUrl,
      this.config.chainId,
      this.wallet,
      userCreds,
      signatureType,
      funderAddress,
      apiOptions,
      false,
      builderConfig,
    );

    logger.info("CLOB client initialized with Builder attribution");
    this.initialized = true;
  }

  getWalletAddress(): string {
    if (!this.wallet) {
      throw new Error("Client not initialized");
    }
    return this.wallet.address;
  }

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    if (!this.client || !this.wallet) {
      throw new Error("Client not initialized. Call initialize() first.");
    }

    const orderValue = request.price * request.size;
    const MIN_ORDER_VALUE_USD = 0.5;
    const MIN_ORDER_SHARES = 0.1;

    if (orderValue < MIN_ORDER_VALUE_USD) {
      return {
        success: false,
        errorMessage: `Order value $${orderValue.toFixed(2)} below minimum $${MIN_ORDER_VALUE_USD}`,
      };
    }

    if (request.size < MIN_ORDER_SHARES) {
      return {
        success: false,
        errorMessage: `Order size ${request.size.toFixed(4)} below minimum ${MIN_ORDER_SHARES}`,
      };
    }

    // Pre-flight balance check for BUY orders
    if (request.side === "BUY") {
      try {
        const balances = await this.getBalances();
        const availableUsdc = parseFloat(balances.usdc) || 0;
        const requiredUsdc = orderValue * 1.01;

        if (availableUsdc < requiredUsdc) {
          return {
            success: false,
            errorMessage: `Insufficient balance: have $${availableUsdc.toFixed(2)}, need $${requiredUsdc.toFixed(2)}`,
          };
        }
      } catch (balanceError) {
        logger.debug("Balance check failed, proceeding with order");
      }
    }

    // For SELL orders, verify we have the shares
    if (request.side === "SELL") {
      try {
        const { balance } = await this.getTokenBalance(request.tokenId);
        const availableShares = parseFloat(balance) / 1_000_000;

        if (availableShares < request.size) {
          return {
            success: false,
            errorMessage: `Insufficient shares: have ${availableShares.toFixed(2)}, need ${request.size.toFixed(2)}`,
          };
        }
      } catch (shareError) {
        logger.debug("Share balance check failed, proceeding");
      }
    }

    try {
      logger.debug("Placing order", {
        tokenId: request.tokenId,
        side: request.side,
        price: request.price,
        size: request.size,
      });

      let tickSize = "0.01";
      let negRisk = false;
      let feeRateBps: number | undefined = undefined;

      const cached = this.marketParamsCache.get(request.tokenId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
        tickSize = cached.tickSize;
        negRisk = cached.negRisk;
        feeRateBps = cached.feeRateBps;
      } else {
        try {
          logApiCall(
            "GET",
            `getMarketParams(${request.tokenId.substring(0, 16)}...)`,
            "pending",
          );
          const [fetchedTickSize, fetchedNegRisk, fetchedFeeRateBps] =
            await Promise.all([
              this.client.getTickSize(request.tokenId),
              this.client.getNegRisk(request.tokenId),
              this.client.getFeeRateBps(request.tokenId),
            ]);
          tickSize = fetchedTickSize;
          negRisk = fetchedNegRisk;
          feeRateBps = fetchedFeeRateBps;
          logApiCall(
            "GET",
            `getMarketParams(${request.tokenId.substring(0, 16)}...)`,
            200,
            { tickSize, negRisk, feeRateBps },
          );
          this.marketParamsCache.set(request.tokenId, {
            tickSize,
            negRisk,
            feeRateBps,
            timestamp: Date.now(),
          });
        } catch (e: any) {
          logApiCall(
            "GET",
            `getMarketParams(${request.tokenId.substring(0, 16)}...)`,
            e?.response?.status || "error",
            null,
            e?.message,
          );
          logger.debug("Using default market params");
        }
      }

      const orderRequest: any = {
        tokenID: request.tokenId,
        side: request.side === "BUY" ? Side.BUY : Side.SELL,
        price: request.price,
        size: request.size,
      };

      if (feeRateBps !== undefined) {
        orderRequest.feeRateBps = feeRateBps;
      }

      logger.info("Calling createAndPostOrder", {
        orderRequest,
        tickSize,
        negRisk,
      });

      logApiCall(
        "POST",
        `createAndPostOrder(${request.side}, ${request.tokenId.substring(0, 16)}...)`,
        "pending",
        { price: request.price, size: request.size },
      );

      const response = await this.client.createAndPostOrder(
        orderRequest,
        {
          tickSize: tickSize as any,
          negRisk,
        },
        OrderType.GTC, // Good-Til-Cancelled order type
      );

      logger.info("createAndPostOrder response", { response });
      logApiCall(
        "POST",
        `createAndPostOrder(${request.side}, ${request.tokenId.substring(0, 16)}...)`,
        200,
        response,
      );

      const resp = response as {
        orderID?: string;
        status?: string;
        transactionsHashes?: string[];
        errorMsg?: string;
        error?: string | object;
        message?: string;
      };

      const txHashes = resp?.transactionsHashes;
      if (
        resp &&
        (resp.orderID || (Array.isArray(txHashes) && txHashes.length > 0))
      ) {
        const orderId = resp.orderID || txHashes?.[0] || `order-${Date.now()}`;
        logger.info("Order placed successfully", { orderId });

        // Invalidate position cache for this token since balance changed
        this.invalidatePositionCache(request.tokenId);

        return {
          success: true,
          orderId,
          executedPrice: request.price,
          executedSize: request.size,
        };
      } else {
        let errorMsg = "No order ID returned";
        if (resp?.errorMsg) errorMsg = resp.errorMsg;
        else if (resp?.error)
          errorMsg =
            typeof resp.error === "string"
              ? resp.error
              : JSON.stringify(resp.error);
        else if (resp?.message) errorMsg = resp.message;

        const rawErrorMsg = errorMsg;
        if (errorMsg.includes("<!DOCTYPE") || errorMsg.includes("<html")) {
          errorMsg = "API rate limited or blocked";
        }
        if (errorMsg.length > 100) errorMsg = errorMsg.substring(0, 97) + "...";

        logApiCall(
          "POST",
          `createAndPostOrder(${request.side}, ${request.tokenId.substring(0, 16)}...)`,
          "failed",
          null,
          rawErrorMsg.substring(0, 200),
        );
        return { success: false, errorMessage: errorMsg };
      }
    } catch (error: any) {
      let errorMessage = (error as Error).message;
      const rawError = errorMessage;
      const status = error?.response?.status || "error";

      if (
        errorMessage.includes("<!DOCTYPE") ||
        errorMessage.includes("<html")
      ) {
        errorMessage = "API rate limited or blocked";
      }
      if (errorMessage.length > 100)
        errorMessage = errorMessage.substring(0, 97) + "...";

      logApiCall(
        "POST",
        `createAndPostOrder(${request.side}, ${request.tokenId.substring(0, 16)}...)`,
        status,
        null,
        rawError.substring(0, 300),
      );
      logger.error("Failed to place order", {
        error: errorMessage,
        status,
        rawError: rawError.substring(0, 200),
      });
      return { success: false, errorMessage };
    }
  }

  async getBalances(): Promise<{ usdc: string; matic: string }> {
    if (!this.wallet || !this.client) {
      throw new Error("Client not initialized");
    }

    // Return cached if fresh enough (reduce API calls)
    if (
      this.balanceCache &&
      Date.now() - this.balanceCache.timestamp < 15000 // 15 second freshness
    ) {
      return { usdc: this.balanceCache.usdc, matic: this.balanceCache.matic };
    }

    return globalThrottler.throttle("getBalances", async () => {
      try {
        logger.debug("Fetching balances from Polymarket API...");
        logApiCall("GET", "getBalanceAllowance(COLLATERAL)", "pending");

        // Try to get MATIC balance with RPC fallback
        let maticBalance;
        try {
          maticBalance = await this.wallet!.getBalance();
        } catch (rpcError: any) {
          // RPC rate limited, try next endpoint
          if (
            rpcError?.message?.includes("Too many requests") ||
            rpcError?.message?.includes("rate limit")
          ) {
            await this.switchToNextRpc();
            maticBalance = await this.wallet!.getBalance();
          } else {
            throw rpcError;
          }
        }

        const collateralBalance = await this.client!.getBalanceAllowance({
          asset_type: AssetType.COLLATERAL,
        });

        const rawBalance = collateralBalance.balance || "0";
        const usdBalance = (parseFloat(rawBalance) / 1_000_000).toFixed(6);

        logApiCall("GET", "getBalanceAllowance(COLLATERAL)", 200, {
          rawBalance,
          usdBalance,
        });

        logger.debug("Balances fetched", {
          rawBalance,
          usdBalance,
          maticBalance: ethers.utils.formatEther(maticBalance),
        });

        const result = {
          usdc: usdBalance,
          matic: ethers.utils.formatEther(maticBalance),
        };

        // Cache successful result
        this.balanceCache = { ...result, timestamp: Date.now() };

        return result;
      } catch (error: any) {
        const errMsg = error?.message || String(error);
        const status = error?.response?.status || "error";
        logApiCall(
          "GET",
          "getBalanceAllowance(COLLATERAL)",
          status,
          null,
          errMsg,
        );

        logger.error("Failed to get balances", {
          error: errMsg,
        });

        // Return cached balance if available and not too old
        if (
          this.balanceCache &&
          Date.now() - this.balanceCache.timestamp < this.BALANCE_CACHE_TTL
        ) {
          logger.debug("Using cached balance due to API error");
          return {
            usdc: this.balanceCache.usdc,
            matic: this.balanceCache.matic,
          };
        }

        return { usdc: "0", matic: "0" };
      }
    });
  }

  // Switch to next RPC endpoint when rate limited
  private async switchToNextRpc(): Promise<void> {
    this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcUrls.length;
    const newRpcUrl = this.rpcUrls[this.currentRpcIndex];
    logger.warn(`Switching RPC endpoint to: ${newRpcUrl}`);

    this.provider = new ethers.providers.JsonRpcProvider(newRpcUrl);
    if (this.wallet) {
      const pk = this.config.privateKey.startsWith("0x")
        ? this.config.privateKey
        : `0x${this.config.privateKey}`;
      this.wallet = new ethers.Wallet(pk, this.provider);
    }
  }

  async getTokenBalance(
    tokenId: string,
  ): Promise<{ balance: string; allowance: string }> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    return globalThrottler.throttle(`getTokenBalance:${tokenId}`, async () => {
      try {
        const result = await this.client!.getBalanceAllowance({
          asset_type: AssetType.CONDITIONAL,
          token_id: tokenId,
        });
        logApiCall(
          "GET",
          `getBalanceAllowance(CONDITIONAL, ${tokenId.substring(0, 16)}...)`,
          200,
          { balance: result.balance },
        );
        return {
          balance: result.balance || "0",
          allowance: result.allowance || "0",
        };
      } catch (error: any) {
        const errMsg = error?.message || String(error);
        const status = error?.response?.status || "error";
        logApiCall(
          "GET",
          `getBalanceAllowance(CONDITIONAL, ${tokenId.substring(0, 16)}...)`,
          status,
          null,
          errMsg,
        );
        logger.error("Failed to get token balance", {
          error: errMsg,
        });
        return { balance: "0", allowance: "0" };
      }
    });
  }

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

    // Return cached trades if fresh enough
    if (
      this.tradesCache &&
      Date.now() - this.tradesCache.timestamp < this.TRADES_CACHE_TTL
    ) {
      return this.tradesCache.data;
    }

    return globalThrottler.throttle("getTrades", async () => {
      try {
        logger.debug("Fetching trades from CLOB API...");
        logApiCall("GET", "getTrades()", "pending");
        const trades = await this.client!.getTrades();
        logApiCall("GET", "getTrades()", 200, { count: trades?.length || 0 });
        logger.debug(`Fetched ${trades?.length || 0} trades from CLOB API`);

        const result = {
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

        // Cache the result
        this.tradesCache = { data: result, timestamp: Date.now() };
        return result;
      } catch (error: any) {
        const status = error?.response?.status || "error";
        const errMsg = error?.message || String(error);
        logApiCall("GET", "getTrades()", status, null, errMsg);

        // Handle 404 as "no trades" instead of error
        if (
          error?.response?.status === 404 ||
          error?.message?.includes("404")
        ) {
          logger.debug("No trades found (404 response)");
          return { trades: [], count: 0 };
        }
        logger.error("Failed to fetch trades", {
          error: errMsg,
          status,
        });

        // Return cached if available
        if (this.tradesCache) {
          return this.tradesCache.data;
        }
        return { trades: [], count: 0 };
      }
    });
  }

  async getOpenOrders(): Promise<unknown[]> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      logApiCall("GET", "getOpenOrders()", "pending");
      const orders = await this.client.getOpenOrders();
      logApiCall("GET", "getOpenOrders()", 200, { count: orders?.length || 0 });
      return orders || [];
    } catch (error: any) {
      const status = error?.response?.status || "error";
      logApiCall("GET", "getOpenOrders()", status, null, error?.message);
      logger.error("Failed to get open orders", {
        error: (error as Error).message,
      });
      return [];
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      logApiCall("DELETE", `cancelOrder(${orderId})`, "pending");
      await this.client.cancelOrder({ orderID: orderId } as any);
      logApiCall("DELETE", `cancelOrder(${orderId})`, 200);
      logger.info("Order cancelled", { orderId });
      return true;
    } catch (error) {
      logger.error("Failed to cancel order", {
        error: (error as Error).message,
      });
      return false;
    }
  }

  async cancelAllOrders(): Promise<number> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      await this.client.cancelAll();
      logger.info("All orders cancelled");
      return 1;
    } catch (error) {
      logger.error("Failed to cancel all orders", {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  /**
   * Get positions from Polymarket Data API
   * Much faster and more reliable than calculating from trade history
   */
  async getPositions(): Promise<{
    positions: Array<{
      tokenId: string;
      outcome: string;
      shares: number;
      avgEntryPrice: number;
      currentPrice: number;
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
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }

    const walletAddress = this.wallet.address;

    try {
      // Fetch positions directly from Polymarket Data API
      logger.debug(`Fetching positions for ${walletAddress} from Data API...`);

      const response = await fetch(
        `https://data-api.polymarket.com/positions?user=${walletAddress}&sortBy=CURRENT&sortDirection=DESC&sizeThreshold=0.1&limit=50&offset=0`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            Origin: "https://polymarket.com",
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Data API returned ${response.status}: ${response.statusText}`,
        );
      }

      const rawPositions = await response.json();
      logger.debug(`Data API returned ${rawPositions.length} positions`);

      // Log first position to see available fields
      if (rawPositions.length > 0) {
        logger.debug(`Data API position sample fields: ${Object.keys(rawPositions[0]).join(", ")}`);
        logger.debug(`Data API position sample: ${JSON.stringify(rawPositions[0]).substring(0, 500)}`);
      }

      if (!Array.isArray(rawPositions) || rawPositions.length === 0) {
        return { positions: [], totalValue: 0, totalFees: 0 };
      }

      // Batch fetch market info from Gamma API for resolved status and conditionId
      // The Data API returns proxyTicker/slug that we can use to fetch market info
      const marketInfoMap = new Map<
        string,
        {
          question?: string;
          conditionId?: string;
          umaResolutionStatus?: string; // "resolved" means market is resolved and redeemable
          closed?: boolean;
        }
      >();

      // Fetch market info for each position individually by slug (more reliable)
      const marketFetches = rawPositions.map(async (pos: any) => {
        const slug = pos.proxyTicker || pos.slug || pos.marketSlug;
        const tokenId = pos.asset;

        if (!slug && !tokenId) return;

        try {
          // Try by slug first (more reliable)
          let url = slug
            ? `https://gamma-api.polymarket.com/markets/slug/${slug}`
            : `https://gamma-api.polymarket.com/markets?clob_token_ids=${tokenId}`;

          const marketRes = await fetch(url);
          if (marketRes.ok) {
            const marketData = await marketRes.json();
            // If querying by clob_token_ids, result is an array
            const market = Array.isArray(marketData) ? marketData[0] : marketData;

            if (market) {
              marketInfoMap.set(tokenId, {
                question: market.question || market.title,
                conditionId: market.conditionId,
                umaResolutionStatus: market.umaResolutionStatus,
                closed: market.closed === true || String(market.closed) === "true",
              });

              logger.debug(
                `Market info for ${tokenId.substring(0, 16)}...: umaResolutionStatus=${market.umaResolutionStatus}, closed=${market.closed}`
              );
            }
          }
        } catch (e) {
          logger.debug(`Failed to fetch market info for ${tokenId?.substring(0, 16)}: ${(e as Error).message}`);
        }
      });

      // Wait for all market info fetches (with timeout)
      await Promise.race([
        Promise.all(marketFetches),
        new Promise(resolve => setTimeout(resolve, 10000)) // 10 second timeout
      ]);

      // Log resolved markets for debugging
      let resolvedCount = 0;
      for (const [tokenId, info] of marketInfoMap) {
        if (info.umaResolutionStatus === "resolved") {
          resolvedCount++;
          logger.info(
            `Resolved market detected: ${tokenId.substring(0, 16)}... status=${info.umaResolutionStatus}, conditionId=${info.conditionId?.substring(0, 16)}...`,
          );
        }
      }
      if (resolvedCount > 0) {
        logger.info(
          `Found ${resolvedCount} resolved market(s) - should show Redeem button`,
        );
      }

      // Map positions to our format
      const positions: Array<{
        tokenId: string;
        outcome: string;
        shares: number;
        avgEntryPrice: number;
        currentPrice: number;
        currentValue: number;
        market: string;
        conditionId?: string;
        isResolved?: boolean;
        isRedeemable?: boolean;
        feesPaid?: number;
      }> = [];

      let totalValue = 0;
      let totalFees = 0;

      for (const pos of rawPositions) {
        const tokenId = pos.asset;
        const shares = parseFloat(pos.size) || 0;

        if (shares < 0.01) continue;

        const avgEntryPrice = parseFloat(pos.avgPrice) || 0;
        const currentPrice = parseFloat(pos.curPrice) || avgEntryPrice;
        const currentValue = shares * currentPrice;

        // Get market info from Gamma API
        const marketInfo = marketInfoMap.get(tokenId);
        const marketName =
          marketInfo?.question || pos.title || pos.market || "Unknown Market";
        const conditionId = marketInfo?.conditionId || pos.conditionId;
        // Market is resolved when umaResolutionStatus === "resolved" (not just closed)
        const isResolved = marketInfo?.umaResolutionStatus === "resolved";
        const isRedeemable = isResolved && !!conditionId;

        // Determine outcome from position data
        const outcome =
          pos.outcome ||
          (pos.side === "YES" ? "Yes" : pos.side === "NO" ? "No" : "Yes");

        logger.debug(
          `Position: ${tokenId.substring(0, 16)}... shares=${shares.toFixed(2)}, price=${currentPrice.toFixed(3)}, resolved=${isResolved}`,
        );

        positions.push({
          tokenId,
          outcome,
          shares,
          avgEntryPrice,
          currentPrice,
          currentValue,
          market: marketName,
          conditionId,
          isResolved,
          isRedeemable,
          feesPaid: 0, // Data API doesn't include fees, would need trade history for this
        });

        totalValue += currentValue;
      }

      logger.info(
        `Found ${positions.length} open positions, total value: $${totalValue.toFixed(2)}`,
      );

      return { positions, totalValue, totalFees };
    } catch (error) {
      logger.error("Failed to get positions from Data API", {
        error: (error as Error).message,
      });

      // Fallback to old method if Data API fails
      logger.info("Falling back to trade history method...");
      return this.getPositionsFromTradeHistory();
    }
  }

  /**
   * Fallback: Get positions from trade history (slower, used when Data API fails)
   */
  private async getPositionsFromTradeHistory(): Promise<{
    positions: Array<{
      tokenId: string;
      outcome: string;
      shares: number;
      avgEntryPrice: number;
      currentPrice: number;
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
    try {
      // Fetch all trades
      const { trades } = await this.getTrades();
      logger.debug(`Fetched ${trades.length} trades for position calculation`);

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
          pos.totalCost += size * price + fee;
          pos.totalFees += fee;
        } else {
          pos.shares -= size;
          pos.totalCost -= size * price - fee;
          pos.totalFees += fee;
        }
      }

      // Filter to positions with shares > 0
      const openPositions = Array.from(positionMap.values()).filter(
        (p) => p.shares >= 0.01,
      );

      // Batch fetch market info
      const tokenIds = openPositions.map((p) => p.tokenId);
      const marketInfoMap = new Map<
        string,
        {
          question?: string;
          conditionId?: string;
          umaResolutionStatus?: string;
          currentPrice?: number;
        }
      >();

      if (tokenIds.length > 0) {
        try {
          const response = await fetch(
            `https://gamma-api.polymarket.com/markets?clob_token_ids=${tokenIds.join(",")}`,
          );
          if (response.ok) {
            const markets = await response.json();
            for (const market of markets) {
              // clobTokenIds can be a JSON string or array - parse if string
              let clobTokenIds: string[] = [];
              if (typeof market.clobTokenIds === "string") {
                try {
                  clobTokenIds = JSON.parse(market.clobTokenIds);
                } catch {
                  clobTokenIds = [];
                }
              } else if (Array.isArray(market.clobTokenIds)) {
                clobTokenIds = market.clobTokenIds;
              }

              // outcomePrices can also be a JSON string
              let outcomePrices: number[] = [];
              if (typeof market.outcomePrices === "string") {
                try {
                  outcomePrices = JSON.parse(market.outcomePrices).map(
                    (p: string) => parseFloat(p) || 0,
                  );
                } catch {
                  outcomePrices = [];
                }
              }

              for (let i = 0; i < clobTokenIds.length; i++) {
                const tid = clobTokenIds[i];
                marketInfoMap.set(tid, {
                  question: market.question || market.title,
                  conditionId: market.conditionId,
                  umaResolutionStatus: market.umaResolutionStatus,
                  currentPrice: outcomePrices[i] || 0,
                });
              }
            }
          }
        } catch (e) {
          logger.debug(`Failed to fetch market info: ${(e as Error).message}`);
        }
      }

      // Build positions array
      const positions: Array<{
        tokenId: string;
        outcome: string;
        shares: number;
        avgEntryPrice: number;
        currentPrice: number;
        currentValue: number;
        market: string;
        conditionId?: string;
        isResolved?: boolean;
        isRedeemable?: boolean;
        feesPaid?: number;
      }> = [];

      let totalValue = 0;
      let totalFees = 0;

      for (const pos of openPositions) {
        const avgPrice = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
        const marketInfo = marketInfoMap.get(pos.tokenId);
        const currentPrice = marketInfo?.currentPrice || avgPrice;
        const currentValue = pos.shares * currentPrice;
        // Market is resolved when umaResolutionStatus === "resolved"
        const isResolved = marketInfo?.umaResolutionStatus === "resolved";

        positions.push({
          tokenId: pos.tokenId,
          outcome: pos.outcome,
          shares: pos.shares,
          avgEntryPrice: avgPrice,
          currentPrice,
          currentValue,
          market: marketInfo?.question || pos.market || "Unknown Market",
          conditionId: marketInfo?.conditionId,
          isResolved,
          isRedeemable: isResolved && !!marketInfo?.conditionId,
          feesPaid: pos.totalFees,
        });

        totalValue += currentValue;
        totalFees += pos.totalFees;
      }

      logger.info(
        `Fallback: Found ${positions.length} positions, total value: $${totalValue.toFixed(2)}`,
      );
      return { positions, totalValue, totalFees };
    } catch (error) {
      logger.error("Failed to get positions from trade history", {
        error: (error as Error).message,
      });
      return { positions: [], totalValue: 0, totalFees: 0 };
    }
  }

  /**
   * Redeem a resolved position
   * Calls the CTF contract to convert winning tokens to USDC
   */
  async redeemPosition(conditionId: string): Promise<{
    success: boolean;
    txHash?: string;
    error?: string;
    redeemedAmount?: number;
  }> {
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }

    try {
      logger.info(`Redeeming position for condition: ${conditionId}`);

      // CTF contract address on Polygon
      const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
      const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

      // CTF ABI for redemption
      const CTF_ABI = [
        "function balanceOf(address account, uint256 id) view returns (uint256)",
        "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
        "function getOutcomeSlotCount(bytes32 conditionId) view returns (uint256)",
        "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
      ];

      const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, this.wallet);

      // Format condition ID as bytes32
      const conditionIdBytes32 = conditionId.startsWith("0x")
        ? conditionId
        : `0x${conditionId}`;

      // Check if condition is resolved
      const payoutDenom = await ctf.payoutDenominator(conditionIdBytes32);
      if (payoutDenom.eq(0)) {
        return { success: false, error: "Market is not yet resolved" };
      }

      // Get outcome count
      const outcomeCount = await ctf.getOutcomeSlotCount(conditionIdBytes32);

      // Create index sets for all outcomes (2^i for each outcome)
      const indexSets: number[] = [];
      for (let i = 0; i < outcomeCount.toNumber(); i++) {
        indexSets.push(1 << i);
      }

      // Parent collection ID is 0x0 for top-level positions
      const parentCollectionId = ethers.constants.HashZero;

      // Get gas price
      const gasPrice = await this.wallet.getGasPrice();
      const boostedGas = gasPrice.mul(120).div(100); // 20% boost

      logger.info(`Sending redemption transaction...`);

      const tx = await ctf.redeemPositions(
        USDC_ADDRESS,
        parentCollectionId,
        conditionIdBytes32,
        indexSets,
        { gasPrice: boostedGas, gasLimit: 300000 },
      );

      logger.info(`Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();

      logger.info(`Redemption successful! TX: ${tx.hash}`);

      return {
        success: true,
        txHash: tx.hash,
      };
    } catch (error: any) {
      logger.error("Failed to redeem position", {
        conditionId,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear position caches - useful after placing orders or when positions may have changed
   */
  clearPositionCaches(): void {
    this.closedPositionsCache.clear();
    this.openPositionsCache.clear();
    logger.debug("Position caches cleared");
  }

  /**
   * Clear balance cache - useful after redeem/sell to force fresh balance fetch
   */
  clearBalanceCache(): void {
    this.balanceCache = null;
    logger.debug("Balance cache cleared");
  }

  /**
   * Clear all caches (positions + balance) - useful after redeem
   */
  clearAllCaches(): void {
    this.clearPositionCaches();
    this.clearBalanceCache();
    logger.debug("All caches cleared");
  }

  /**
   * Remove a specific token from closed cache (e.g., if user buys back in)
   */
  invalidatePositionCache(tokenId: string): void {
    this.closedPositionsCache.delete(tokenId);
    this.openPositionsCache.delete(tokenId);
  }

  getClient(): ClobClient | null {
    return this.client;
  }

  getWallet(): ethers.Wallet | null {
    return this.wallet;
  }
}

/**
 * WebSocket client for real-time market data
 * Connects to Polymarket's market channel for live price updates
 */
export class MarketWebSocket {
  private ws: any = null;
  private WebSocketLib: any = null;
  private subscribedMarkets: Set<string> = new Set();
  private priceCallbacks: Map<
    string,
    (price: { bid: number; ask: number; lastPrice: number }) => void
  > = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private isConnecting = false;

  private readonly WS_URL =
    "wss://ws-subscriptions-clob.polymarket.com/ws/market";

  /**
   * Connect to the WebSocket server
   */
  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === 1 /* WebSocket.OPEN */) {
      return Promise.resolve();
    }

    if (this.isConnecting) {
      return Promise.resolve();
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        // Import WebSocket for Node.js environment
        if (!this.WebSocketLib) {
          this.WebSocketLib = require("ws");
        }
        this.ws = new this.WebSocketLib(this.WS_URL);

        this.ws!.onopen = () => {
          logger.info("Market WebSocket connected");
          this.isConnecting = false;
          this.reconnectAttempts = 0;

          // Resubscribe to all markets
          for (const marketId of this.subscribedMarkets) {
            this.sendSubscription(marketId);
          }

          // Start ping interval to keep connection alive
          this.startPingInterval();

          resolve();
        };

        this.ws!.onmessage = (event: any) => {
          try {
            const data = JSON.parse(event.data.toString());
            this.handleMessage(data);
          } catch (e) {
            // Ignore parse errors
          }
        };

        this.ws!.onerror = (error: any) => {
          logger.error("Market WebSocket error", { error: error.message });
          this.isConnecting = false;
        };

        this.ws!.onclose = () => {
          logger.info("Market WebSocket disconnected");
          this.isConnecting = false;
          this.stopPingInterval();
          this.attemptReconnect();
        };
      } catch (e: any) {
        this.isConnecting = false;
        logger.error("Failed to create WebSocket", { error: e.message });
        reject(e);
      }
    });
  }

  /**
   * Subscribe to a market for real-time price updates
   */
  subscribe(
    tokenId: string,
    callback: (price: { bid: number; ask: number; lastPrice: number }) => void,
  ): void {
    this.subscribedMarkets.add(tokenId);
    this.priceCallbacks.set(tokenId, callback);

    if (this.ws && this.ws.readyState === 1 /* WebSocket.OPEN */) {
      this.sendSubscription(tokenId);
    } else {
      this.connect().catch(() => {});
    }
  }

  /**
   * Unsubscribe from a market
   */
  unsubscribe(tokenId: string): void {
    this.subscribedMarkets.delete(tokenId);
    this.priceCallbacks.delete(tokenId);
  }

  /**
   * Send subscription message to server
   */
  private sendSubscription(tokenId: string): void {
    if (!this.ws || this.ws.readyState !== 1 /* WebSocket.OPEN */) return;

    const message = {
      type: "subscribe",
      channel: "market",
      markets: [tokenId],
    };

    this.ws.send(JSON.stringify(message));
    logger.debug(`Subscribed to market: ${tokenId.substring(0, 16)}...`);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: any): void {
    const eventType = data.event_type || data.type;

    switch (eventType) {
      case "price_change":
      case "best_bid_ask":
        this.handlePriceUpdate(data);
        break;
      case "last_trade_price":
        this.handleLastTrade(data);
        break;
      case "book":
        this.handleOrderbook(data);
        break;
      case "pong":
        // Pong response - connection is alive
        break;
    }
  }

  /**
   * Handle price update message
   */
  private handlePriceUpdate(data: any): void {
    const changes = data.price_changes || [data];
    for (const change of changes) {
      const tokenId = change.asset_id;
      const callback = this.priceCallbacks.get(tokenId);
      if (callback) {
        callback({
          bid: parseFloat(change.best_bid) || 0,
          ask: parseFloat(change.best_ask) || 0,
          lastPrice:
            parseFloat(change.price) || parseFloat(change.best_bid) || 0,
        });
      }
    }
  }

  /**
   * Handle last trade message
   */
  private handleLastTrade(data: any): void {
    const tokenId = data.asset_id;
    const callback = this.priceCallbacks.get(tokenId);
    if (callback) {
      callback({
        bid: 0,
        ask: 0,
        lastPrice: parseFloat(data.price) || 0,
      });
    }
  }

  /**
   * Handle orderbook message
   */
  private handleOrderbook(data: any): void {
    const tokenId = data.asset_id;
    const callback = this.priceCallbacks.get(tokenId);
    if (callback && data.bids && data.asks) {
      const bestBid = data.bids[0] ? parseFloat(data.bids[0].price) : 0;
      const bestAsk = data.asks[0] ? parseFloat(data.asks[0].price) : 0;
      callback({
        bid: bestBid,
        ask: bestAsk,
        lastPrice: bestBid || bestAsk,
      });
    }
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1 /* WebSocket.OPEN */) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error("Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribedMarkets.clear();
    this.priceCallbacks.clear();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1 /* WebSocket.OPEN */;
  }
}

/**
 * User Channel WebSocket for tracking user's trades and orders
 * Authenticated channel that provides real-time updates for the user's activity
 */
export interface TradeUpdate {
  assetId: string;
  market: string;
  outcome: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  status: string;
  timestamp: number;
  tradeId: string;
}

export interface OrderUpdate {
  orderId: string;
  assetId: string;
  market: string;
  outcome: string;
  side: "BUY" | "SELL";
  price: number;
  originalSize: number;
  sizeMatched: number;
  type: "PLACEMENT" | "UPDATE" | "CANCELLATION";
  timestamp: number;
}

export class UserChannelWebSocket {
  private ws: any = null;
  private WebSocketLib: any = null;
  private apiKey: string = "";
  private apiSecret: string = "";
  private passphrase: string = "";
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private isConnecting = false;

  // Callbacks for trade and order events
  private onTrade: ((trade: TradeUpdate) => void) | null = null;
  private onOrder: ((order: OrderUpdate) => void) | null = null;
  private onPositionChange: (() => void) | null = null;

  private readonly WS_URL =
    "wss://ws-subscriptions-clob.polymarket.com/ws/user";

  /**
   * Initialize with API credentials
   */
  initialize(apiKey: string, apiSecret: string, passphrase: string): void {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
  }

  /**
   * Set callbacks for trade and order events
   */
  setCallbacks(
    onTrade: (trade: TradeUpdate) => void,
    onOrder: (order: OrderUpdate) => void,
    onPositionChange: () => void,
  ): void {
    this.onTrade = onTrade;
    this.onOrder = onOrder;
    this.onPositionChange = onPositionChange;
  }

  /**
   * Connect to the WebSocket server with authentication
   */
  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === 1) {
      return;
    }

    if (this.isConnecting || !this.apiKey) {
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        if (!this.WebSocketLib) {
          this.WebSocketLib = require("ws");
        }

        this.ws = new this.WebSocketLib(this.WS_URL);

        this.ws.onopen = () => {
          logger.info("User Channel WebSocket connected");
          this.isConnecting = false;
          this.reconnectAttempts = 0;

          // Send authentication and subscription message
          this.sendAuthSubscription();

          // Start ping interval
          this.startPingInterval();

          resolve();
        };

        this.ws.onmessage = (event: any) => {
          try {
            const data = JSON.parse(event.data.toString());
            this.handleMessage(data);
          } catch (e) {
            // Ignore parse errors
          }
        };

        this.ws.onerror = (error: any) => {
          logger.error("User Channel WebSocket error", {
            error: error.message,
          });
          this.isConnecting = false;
        };

        this.ws.onclose = () => {
          logger.info("User Channel WebSocket disconnected");
          this.isConnecting = false;
          this.stopPingInterval();
          this.attemptReconnect();
        };
      } catch (e: any) {
        this.isConnecting = false;
        logger.error("Failed to create User Channel WebSocket", {
          error: e.message,
        });
        reject(e);
      }
    });
  }

  /**
   * Send authentication and subscription message
   */
  private sendAuthSubscription(): void {
    if (!this.ws || this.ws.readyState !== 1) return;

    // Generate timestamp for auth
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Create HMAC signature for authentication
    const crypto = require("crypto");
    const message = timestamp + "GET" + "/ws/user";
    const hmac = crypto.createHmac(
      "sha256",
      Buffer.from(this.apiSecret, "base64"),
    );
    hmac.update(message);
    const signature = hmac.digest("base64");

    const subscriptionMessage = {
      auth: {
        apiKey: this.apiKey,
        secret: this.apiSecret,
        passphrase: this.passphrase,
        timestamp,
        signature,
      },
      type: "USER",
      markets: [], // Empty array subscribes to all markets for this user
    };

    this.ws.send(JSON.stringify(subscriptionMessage));
    logger.info("User Channel: Sent authentication and subscription");
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: any): void {
    const eventType = data.event_type || data.type;

    switch (eventType) {
      case "trade":
        this.handleTradeMessage(data);
        break;
      case "order":
        this.handleOrderMessage(data);
        break;
      case "pong":
        // Connection alive
        break;
      case "subscribed":
        logger.info("User Channel: Successfully subscribed");
        break;
      case "error":
        logger.error("User Channel error:", data.message || data);
        break;
    }
  }

  /**
   * Handle trade message - when user's orders are filled
   */
  private handleTradeMessage(data: any): void {
    const trade: TradeUpdate = {
      assetId: data.asset_id,
      market: data.market,
      outcome: data.outcome,
      side: data.side,
      size: parseFloat(data.size) || 0,
      price: parseFloat(data.price) || 0,
      status: data.status,
      timestamp: parseInt(data.timestamp) * 1000 || Date.now(),
      tradeId: data.id,
    };

    logger.info(
      `User Channel: Trade ${trade.side} ${trade.size} @ ${trade.price} (${trade.status})`,
    );

    if (this.onTrade) {
      this.onTrade(trade);
    }

    // Notify position change when trade is confirmed
    if (data.status === "CONFIRMED" || data.status === "MINED") {
      if (this.onPositionChange) {
        this.onPositionChange();
      }
    }
  }

  /**
   * Handle order message - when orders are placed, updated, or cancelled
   */
  private handleOrderMessage(data: any): void {
    const order: OrderUpdate = {
      orderId: data.id,
      assetId: data.asset_id,
      market: data.market,
      outcome: data.outcome,
      side: data.side,
      price: parseFloat(data.price) || 0,
      originalSize: parseFloat(data.original_size) || 0,
      sizeMatched: parseFloat(data.size_matched) || 0,
      type: data.type,
      timestamp: parseInt(data.timestamp) * 1000 || Date.now(),
    };

    logger.info(
      `User Channel: Order ${order.type} - ${order.side} ${order.originalSize} @ ${order.price}`,
    );

    if (this.onOrder) {
      this.onOrder(order);
    }

    // Notify position change when order is filled
    if (order.sizeMatched > 0 && this.onPositionChange) {
      this.onPositionChange();
    }
  }

  /**
   * Start ping interval
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Attempt reconnection
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error("User Channel: Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info(
      `User Channel: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }
}
