/**
 * Type declarations for @polymarket/clob-client
 *
 * The official package may not include complete type definitions.
 * These declarations provide type safety for the features we use.
 */

declare module "@polymarket/clob-client" {
  import { Wallet } from "ethers";

  export interface OrderParams {
    tokenID: string;
    side: "BUY" | "SELL";
    price: number;
    size: number;
    feeRateBps?: number;
    nonce?: number;
    expiration?: number;
  }

  export interface Order {
    id?: string;
    owner: string;
    tokenID: string;
    side: "BUY" | "SELL";
    price: number;
    size: number;
    remainingSize?: number;
    status?: string;
    createdAt?: string;
    // Signature and other fields
    [key: string]: unknown;
  }

  export interface PostOrderResponse {
    orderID: string;
    success?: boolean;
    [key: string]: unknown;
  }

  export interface ApiKeyCreds {
    key: string;
    secret: string;
    passphrase: string;
  }

  export interface OpenOrder {
    id: string;
    tokenID: string;
    side: "BUY" | "SELL";
    price: number;
    size: number;
    remainingSize: number;
    status: string;
    createdAt: string;
    [key: string]: unknown;
  }

  export class ClobClient {
    constructor(
      host: string,
      chainId: number,
      wallet: Wallet,
      creds?: ApiKeyCreds
    );

    /**
     * Create or derive API credentials for the wallet
     */
    createOrDeriveApiCreds(): Promise<ApiKeyCreds>;

    /**
     * Create an order object (signs it)
     */
    createOrder(params: OrderParams): Promise<Order>;

    /**
     * Post a signed order to the CLOB
     */
    postOrder(order: Order): Promise<PostOrderResponse>;

    /**
     * Get all open orders for the wallet
     */
    getOpenOrders(): Promise<OpenOrder[]>;

    /**
     * Cancel a specific order
     */
    cancelOrder(orderId: string): Promise<void>;

    /**
     * Cancel all open orders
     */
    cancelAll(): Promise<void>;

    /**
     * Get API credentials
     */
    getCreds(): ApiKeyCreds | null;

    /**
     * Set API credentials
     */
    setCreds(creds: ApiKeyCreds): void;
  }
}
