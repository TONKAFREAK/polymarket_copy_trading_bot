/**
 * Polymarket CLOB Client wrapper
 * Handles order placement and wallet interaction
 */

import { ethers } from "ethers";
import { ClobClient } from "@polymarket/clob-client";
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

    this.client = new ClobClient(clobUrl, this.config.chainId, this.wallet);

    // Derive API credentials if needed
    try {
      await this.client.createOrDeriveApiCreds();
      logger.info("CLOB client initialized successfully");
    } catch (error) {
      logger.warn("Failed to derive API credentials, will try on first order", {
        error: (error as Error).message,
      });
    }

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

      // Create the order
      const order = await this.client.createOrder({
        tokenID: request.tokenId,
        side: request.side,
        price: request.price,
        size: request.size,
        feeRateBps: 0, // Use default fee rate
        nonce: Date.now(),
        expiration: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days
      });

      // Post the order
      const response = await this.client.postOrder(order);

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
        return {
          success: false,
          errorMessage: "No order ID returned",
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
   * Get wallet balances
   */
  async getBalances(): Promise<{ usdc: string; matic: string }> {
    if (!this.wallet) {
      throw new Error("Client not initialized");
    }

    try {
      const maticBalance = await this.wallet.getBalance();

      // USDC contract on Polygon
      const usdcAddress = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
      const usdcAbi = ["function balanceOf(address) view returns (uint256)"];
      const usdcContract = new ethers.Contract(
        usdcAddress,
        usdcAbi,
        this.wallet.provider
      );
      const usdcBalance = await usdcContract.balanceOf(this.wallet.address);

      return {
        usdc: ethers.utils.formatUnits(usdcBalance, 6),
        matic: ethers.utils.formatEther(maticBalance),
      };
    } catch (error) {
      logger.error("Failed to get balances", {
        error: (error as Error).message,
      });
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
