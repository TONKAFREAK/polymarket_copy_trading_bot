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
    clobUrl: "https://clob.polymarket.com",
  },
};

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

    this.client = new ClobClient(
      clobUrl,
      this.config.chainId,
      this.wallet,
      userCreds,
      signatureType,
      funderAddress,
      undefined,
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
          const [fetchedTickSize, fetchedNegRisk, fetchedFeeRateBps] =
            await Promise.all([
              this.client.getTickSize(request.tokenId),
              this.client.getNegRisk(request.tokenId),
              this.client.getFeeRateBps(request.tokenId),
            ]);
          tickSize = fetchedTickSize;
          negRisk = fetchedNegRisk;
          feeRateBps = fetchedFeeRateBps;
          this.marketParamsCache.set(request.tokenId, {
            tickSize,
            negRisk,
            feeRateBps,
            timestamp: Date.now(),
          });
        } catch (e) {
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

      const response = await this.client.createAndPostOrder(
        orderRequest,
        {
          tickSize: tickSize as any,
          negRisk,
        },
        OrderType.GTC, // Good-Til-Cancelled order type
      );

      logger.info("createAndPostOrder response", { response });

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

        if (errorMsg.includes("<!DOCTYPE") || errorMsg.includes("<html")) {
          errorMsg = "API rate limited or blocked";
        }
        if (errorMsg.length > 100) errorMsg = errorMsg.substring(0, 97) + "...";

        return { success: false, errorMessage: errorMsg };
      }
    } catch (error) {
      let errorMessage = (error as Error).message;
      if (
        errorMessage.includes("<!DOCTYPE") ||
        errorMessage.includes("<html")
      ) {
        errorMessage = "API rate limited or blocked";
      }
      if (errorMessage.length > 100)
        errorMessage = errorMessage.substring(0, 97) + "...";

      logger.error("Failed to place order", { error: errorMessage });
      return { success: false, errorMessage };
    }
  }

  async getBalances(): Promise<{ usdc: string; matic: string }> {
    if (!this.wallet || !this.client) {
      throw new Error("Client not initialized");
    }

    try {
      const maticBalance = await this.wallet.getBalance();
      const collateralBalance = await this.client.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });

      const rawBalance = collateralBalance.balance || "0";
      const usdBalance = (parseFloat(rawBalance) / 1_000_000).toFixed(6);

      return {
        usdc: usdBalance,
        matic: ethers.utils.formatEther(maticBalance),
      };
    } catch (error) {
      logger.error("Failed to get balances", {
        error: (error as Error).message,
      });
      return { usdc: "0", matic: "0" };
    }
  }

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
      });
      return { balance: "0", allowance: "0" };
    }
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

    try {
      const trades = await this.client.getTrades();
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

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      await this.client.cancelOrder({ orderID: orderId } as any);
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
      for (const pos of positionEntries) {
        if (Math.abs(pos.shares) >= 0.01) {
          // Get actual token balance to verify
          const { balance } = await this.getTokenBalance(pos.tokenId);
          // Balance is in micro-units (6 decimals), convert to actual shares
          const rawBalance = parseFloat(balance) || 0;
          const actualShares = rawBalance / 1_000_000;

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
        `Found ${positions.length} open positions, total value: $${totalValue.toFixed(2)}`,
      );

      return { positions, totalValue, totalFees };
    } catch (error) {
      logger.error("Failed to get positions", {
        error: (error as Error).message,
      });
      return { positions: [], totalValue: 0, totalFees: 0 };
    }
  }

  getClient(): ClobClient | null {
    return this.client;
  }

  getWallet(): ethers.Wallet | null {
    return this.wallet;
  }
}
