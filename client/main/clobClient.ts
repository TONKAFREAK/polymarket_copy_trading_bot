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

  // Cache for closed positions (token IDs with 0 balance) - these don't need to be re-checked
  private closedPositionsCache: Set<string> = new Set();
  // Cache for open positions to avoid re-fetching balances too often
  private openPositionsCache: Map<
    string,
    { balance: number; timestamp: number }
  > = new Map();
  private readonly POSITION_CACHE_TTL = 60000; // 1 minute for open positions

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
   * Get positions aggregated from trade history
   * Returns net positions with shares held, average entry price, and current value
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

      // Convert to array and verify actual on-chain balances
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

      const positionEntries = Array.from(positionMap.values());
      let checkedCount = 0;
      let skippedCount = 0;
      let cachedCount = 0;

      for (const pos of positionEntries) {
        if (Math.abs(pos.shares) >= 0.01) {
          // Skip if we already know this position is closed
          if (this.closedPositionsCache.has(pos.tokenId)) {
            skippedCount++;
            continue;
          }

          // Check if we have a recent cached balance for this position
          const cachedPos = this.openPositionsCache.get(pos.tokenId);
          const now = Date.now();

          let actualShares: number;

          if (
            cachedPos &&
            now - cachedPos.timestamp < this.POSITION_CACHE_TTL
          ) {
            // Use cached balance
            actualShares = cachedPos.balance;
            cachedCount++;
          } else {
            // Get actual token balance to verify
            const { balance } = await this.getTokenBalance(pos.tokenId);
            // Balance is in micro-units (6 decimals), convert to actual shares
            const rawBalance = parseFloat(balance) || 0;
            actualShares = rawBalance / 1_000_000;
            checkedCount++;

            // Cache the result
            if (actualShares < 0.01) {
              // Position is closed, add to closed cache (permanent)
              this.closedPositionsCache.add(pos.tokenId);
            } else {
              // Position is open, cache with TTL
              this.openPositionsCache.set(pos.tokenId, {
                balance: actualShares,
                timestamp: now,
              });
            }
          }

          logger.debug(
            `Token ${pos.tokenId.substring(0, 16)}... calculated shares: ${pos.shares.toFixed(4)}, actual: ${actualShares.toFixed(4)}`,
          );

          if (actualShares >= 0.01) {
            const avgPrice = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
            const currentValue = actualShares * avgPrice;

            positions.push({
              tokenId: pos.tokenId,
              outcome: pos.outcome,
              shares: actualShares,
              avgEntryPrice: avgPrice,
              currentValue,
              market: pos.market || "Unknown Market",
              feesPaid: pos.totalFees,
            });

            totalValue += currentValue;
            totalFees += pos.totalFees;
          }
        }
      }

      logger.info(
        `Found ${positions.length} open positions, total value: $${totalValue.toFixed(2)} (checked: ${checkedCount}, cached: ${cachedCount}, skipped closed: ${skippedCount})`,
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
