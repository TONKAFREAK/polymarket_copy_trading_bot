/**
 * Type declarations for @polymarket/clob-client
 *
 * The official package may not include complete type definitions.
 * These declarations provide type safety for the features we use.
 */

declare module "@polymarket/clob-client" {
  import { Wallet } from "ethers";

  /**
   * Asset types for balance queries
   */
  export enum AssetType {
    COLLATERAL = "COLLATERAL",
    CONDITIONAL = "CONDITIONAL",
  }

  export interface BalanceAllowanceParams {
    asset_type: AssetType;
    token_id?: string;
  }

  export interface BalanceAllowanceResponse {
    balance: string;
    allowance: string;
  }

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

  export interface TradeParams {
    id?: string;
    maker_address?: string;
    market?: string;
    asset_id?: string;
    before?: string;
    after?: string;
  }

  export interface Trade {
    id: string;
    taker_order_id: string;
    market: string;
    asset_id: string;
    side: "BUY" | "SELL";
    size: string;
    fee_rate_bps: string;
    price: string;
    status: string;
    match_time: string;
    last_update: string;
    outcome: string;
    bucket_index: number;
    owner: string;
    maker_address: string;
    transaction_hash: string;
    trader_side: "TAKER" | "MAKER";
    maker_orders?: Array<{
      order_id: string;
      owner: string;
      maker_address: string;
      matched_amount: string;
      price: string;
      fee_rate_bps: string;
      asset_id: string;
    }>;
  }

  export interface TradesPaginatedResponse {
    data: Trade[];
    next_cursor: string;
  }

  export class ClobClient {
    constructor(
      host: string,
      chainId: number,
      wallet?: Wallet,
      creds?: ApiKeyCreds,
      signatureType?: number,
      funderAddress?: string,
      options?: unknown,
      useServerTime?: boolean,
      builderConfig?: unknown
    );

    /**
     * Create or derive API credentials for the wallet
     */
    createOrDeriveApiKey(): Promise<ApiKeyCreds>;
    
    /**
     * Derive existing API key
     */
    deriveApiKey(): Promise<ApiKeyCreds>;
    
    /**
     * Create new API key
     */
    createApiKey(): Promise<ApiKeyCreds>;

    /**
     * Create an order object (signs it)
     */
    createOrder(params: OrderParams, options?: { tickSize?: string; negRisk?: boolean }): Promise<Order>;

    /**
     * Create and post an order in one atomic call (recommended)
     */
    createAndPostOrder(
      params: OrderParams,
      options?: { tickSize?: string; negRisk?: boolean },
      orderType?: string,
      deferExec?: boolean,
      postOnly?: boolean
    ): Promise<PostOrderResponse>;

    /**
     * Post a signed order to the CLOB
     */
    postOrder(order: Order, orderType?: string, deferExec?: boolean, postOnly?: boolean): Promise<PostOrderResponse>;

    /**
     * Get tick size for a token
     */
    getTickSize(tokenId: string): Promise<string>;

    /**
     * Get negative risk setting for a token
     */
    getNegRisk(tokenId: string): Promise<boolean>;

    /**
     * Get fee rate in basis points for a token
     */
    getFeeRateBps(tokenId: string): Promise<number>;

    /**
     * Get all open orders for the wallet
     */
    getOpenOrders(): Promise<OpenOrder[]>;

    /**
     * Get trade history for the authenticated user
     */
    getTrades(params?: TradeParams, only_first_page?: boolean, next_cursor?: string): Promise<Trade[]>;

    /**
     * Get paginated trade history
     */
    getTradesPaginated(params?: TradeParams, next_cursor?: string): Promise<TradesPaginatedResponse>;

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

    /**
     * Get balance and allowance for an asset (USDC collateral or conditional tokens)
     */
    getBalanceAllowance(
      params: BalanceAllowanceParams
    ): Promise<BalanceAllowanceResponse>;

    /**
     * Update/refresh balance allowance cache
     */
    updateBalanceAllowance(params: BalanceAllowanceParams): Promise<void>;
  }
}
