/**
 * Live Data Client - Fetches live account data from Polymarket APIs
 *
 * This is a simplified HTTP client that fetches portfolio data without
 * requiring the full CLOB SDK or signing capabilities.
 *
 * Uses native Node.js crypto for address derivation to avoid ethers dependency.
 */

import https from "https";
import http from "http";
import crypto from "crypto";

const GAMMA_API_URL = "https://gamma-api.polymarket.com";
const CLOB_API_URL = "https://clob.polymarket.com";
const DATA_API_URL = "https://data-api.polymarket.com";
const POLYGON_RPC = "https://polygon-rpc.com";
const PROFILE_API_URL = "https://polymarket.com/api/profile";

// HTTP Agent with connection pooling to prevent socket exhaustion
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 5,           // Limit concurrent connections per host
  maxFreeSockets: 2,       // Keep 2 sockets ready
  timeout: 15000,          // Socket timeout
});

// Cache for balance to prevent flickering
let cachedBalance: { usdc: number; timestamp: number } | null = null;
const BALANCE_CACHE_TTL = 60000; // 60 seconds - longer TTL to prevent flickering

// Request queue to prevent too many simultaneous requests
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 3;

// Persistent balance file for live mode
import * as fs from "fs";
import * as path from "path";
const DATA_DIR = path.join(process.cwd(), "data");
const LIVE_BALANCE_FILE = path.join(DATA_DIR, "live-balance.json");

interface Position {
  tokenId: string;
  conditionId?: string;
  outcome: string;
  shares: number;
  avgEntryPrice: number;
  currentPrice?: number;
  currentValue: number;
  market?: string;
  marketSlug?: string;
  isResolved?: boolean;
  isRedeemable?: boolean;
  feesPaid?: number;
}

interface Trade {
  id: string;
  timestamp: number;
  tokenId: string;
  marketSlug?: string;
  market?: string;
  outcome: string;
  side: "BUY" | "SELL";
  price: number;
  shares: number;
  usdValue: number;
  fees?: number;
  pnl?: number;
}

interface LiveDataResult {
  balance: number;
  positions: Position[];
  trades: Trade[];
}

async function httpGet(url: string): Promise<any> {
  // Wait if too many concurrent requests
  while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  activeRequests++;
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      agent: httpsAgent,
      timeout: 10000,
    };

    const request = https.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => {
        activeRequests--;
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    request.on("error", (err) => {
      activeRequests--;
      reject(err);
    });
    request.on("timeout", () => {
      activeRequests--;
      request.destroy();
      reject(new Error("Request timeout"));
    });
    request.end();
  });
}

async function httpPost(url: string, data: any): Promise<any> {
  // Wait if too many concurrent requests
  while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  activeRequests++;
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = JSON.stringify(data);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: "POST",
      agent: httpsAgent,
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const request = https.request(options, (response) => {
      let responseData = "";
      response.on("data", (chunk) => (responseData += chunk));
      response.on("end", () => {
        activeRequests--;
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve(responseData);
        }
      });
    });

    request.on("error", (err) => {
      activeRequests--;
      reject(err);
    });
    request.on("timeout", () => {
      activeRequests--;
      request.destroy();
      reject(new Error("Request timeout"));
    });

    request.write(body);
    request.end();
  });
}

// Derive Ethereum address from private key without ethers.js
// Uses secp256k1 curve via Node.js crypto
function deriveAddress(privateKey: string): string {
  // Remove 0x prefix if present
  const pk = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;

  // Create EC key pair from private key using secp256k1
  const ecdh = crypto.createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(pk, "hex"));

  // Get uncompressed public key (65 bytes: 0x04 + 32 bytes X + 32 bytes Y)
  const publicKey = ecdh.getPublicKey();

  // Remove the 0x04 prefix and hash with keccak256
  const publicKeyWithoutPrefix = publicKey.slice(1); // Remove 04 prefix

  // Use SHA3-256 (keccak256) - but Node's sha3-256 is NOT keccak256
  // We need to use a proper keccak256 implementation
  // For simplicity, we'll use the js-sha3 algorithm inline
  const keccak256 = keccakHash(publicKeyWithoutPrefix);

  // Take last 20 bytes for address
  const address = "0x" + keccak256.slice(-40);

  return address.toLowerCase();
}

// Keccak-256 hash implementation
function keccakHash(input: Buffer): string {
  // Keccak-256 constants
  const ROUNDS = 24;
  const RC = [
    0x0000000000000001n,
    0x0000000000008082n,
    0x800000000000808an,
    0x8000000080008000n,
    0x000000000000808bn,
    0x0000000080000001n,
    0x8000000080008081n,
    0x8000000000008009n,
    0x000000000000008an,
    0x0000000000000088n,
    0x0000000080008009n,
    0x000000008000000an,
    0x000000008000808bn,
    0x800000000000008bn,
    0x8000000000008089n,
    0x8000000000008003n,
    0x8000000000008002n,
    0x8000000000000080n,
    0x000000000000800an,
    0x800000008000000an,
    0x8000000080008081n,
    0x8000000000008080n,
    0x0000000080000001n,
    0x8000000080008008n,
  ];

  const ROTATIONS = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
  ];

  // State array (5x5 of 64-bit words)
  const state = new Array(25).fill(0n);

  // Pad the input (keccak padding: 0x01 ... 0x80)
  const rate = 136; // Rate for keccak-256 in bytes
  const inputLen = input.length;
  const padLen = rate - (inputLen % rate);
  const padded = Buffer.alloc(inputLen + padLen);
  input.copy(padded);
  padded[inputLen] = 0x01;
  padded[padded.length - 1] |= 0x80;

  // Process each block
  for (let offset = 0; offset < padded.length; offset += rate) {
    // XOR block into state
    for (let i = 0; i < rate / 8; i++) {
      const word = padded.readBigUInt64LE(offset + i * 8);
      state[i] ^= word;
    }

    // Apply keccak-f[1600] permutation
    for (let round = 0; round < ROUNDS; round++) {
      // θ step
      const C = new Array(5);
      const D = new Array(5);
      for (let x = 0; x < 5; x++) {
        C[x] =
          state[x] ^
          state[x + 5] ^
          state[x + 10] ^
          state[x + 15] ^
          state[x + 20];
      }
      for (let x = 0; x < 5; x++) {
        D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1n);
      }
      for (let i = 0; i < 25; i++) {
        state[i] ^= D[i % 5];
      }

      // ρ and π steps
      const temp = new Array(25);
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const newX = y;
          const newY = (2 * x + 3 * y) % 5;
          temp[newX + newY * 5] = rotl64(
            state[x + y * 5],
            BigInt(ROTATIONS[y][x]),
          );
        }
      }

      // χ step
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          state[x + y * 5] =
            temp[x + y * 5] ^
            (~temp[((x + 1) % 5) + y * 5] & temp[((x + 2) % 5) + y * 5]);
        }
      }

      // ι step
      state[0] ^= RC[round];
    }
  }

  // Squeeze output (32 bytes for keccak-256)
  const output = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) {
    output.writeBigUInt64LE(state[i], i * 8);
  }

  return output.toString("hex");
}

function rotl64(x: bigint, n: bigint): bigint {
  const nn = Number(n) % 64;
  return ((x << BigInt(nn)) | (x >> BigInt(64 - nn))) & 0xffffffffffffffffn;
}

export class LiveDataClient {
  private walletAddress: string;

  constructor(walletAddressOrPrivateKey: string) {
    // Check if it looks like a wallet address (starts with 0x and is 42 chars)
    if (
      walletAddressOrPrivateKey.startsWith("0x") &&
      walletAddressOrPrivateKey.length === 42
    ) {
      this.walletAddress = walletAddressOrPrivateKey.toLowerCase();
    } else {
      // It's likely a private key - log a warning since we can't derive without ethers
      console.warn(
        "[LiveDataClient] Received private key instead of address. Cannot derive address without ethers.",
      );
      // Store as-is, but this won't work for API calls
      this.walletAddress = walletAddressOrPrivateKey.toLowerCase();
    }

    console.log("[LiveDataClient] Initialized for wallet:", this.walletAddress);
  }

  // Load persisted balance from file
  private loadPersistedBalance(): number | null {
    try {
      if (fs.existsSync(LIVE_BALANCE_FILE)) {
        const data = JSON.parse(fs.readFileSync(LIVE_BALANCE_FILE, "utf-8"));
        if (data.address === this.walletAddress && data.balance > 0) {
          console.log(
            "[LiveDataClient] Loaded persisted balance:",
            data.balance,
          );
          return data.balance;
        }
      }
    } catch (e) {
      // Ignore
    }
    return null;
  }

  // Save balance to file for persistence
  private saveBalance(balance: number): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(
        LIVE_BALANCE_FILE,
        JSON.stringify(
          {
            address: this.walletAddress,
            balance,
            updatedAt: Date.now(),
          },
          null,
          2,
        ),
        "utf-8",
      );
    } catch (e) {
      // Ignore
    }
  }

  async getBalances(): Promise<{ usdc: string; matic: string }> {
    try {
      // First, check memory cache
      if (
        cachedBalance &&
        Date.now() - cachedBalance.timestamp < BALANCE_CACHE_TTL
      ) {
        console.log(
          "[LiveDataClient] Using cached balance:",
          cachedBalance.usdc,
        );
        return {
          usdc: cachedBalance.usdc.toFixed(2),
          matic: "0",
        };
      }

      // Try to load persisted balance first (for stability)
      const persistedBalance = this.loadPersistedBalance();

      // Try to get portfolio value from data-api (includes balance + positions value)
      try {
        const portfolioUrl = `${DATA_API_URL}/portfolio?user=${this.walletAddress}`;
        const portfolioData = await httpGet(portfolioUrl);

        if (portfolioData && typeof portfolioData.totalValue === "number") {
          const balance = portfolioData.totalValue;
          cachedBalance = { usdc: balance, timestamp: Date.now() };
          this.saveBalance(balance);
          console.log(
            "[LiveDataClient] Got portfolio value from data API:",
            balance,
          );
          return {
            usdc: balance.toFixed(2),
            matic: "0",
          };
        }

        // Some responses have 'balance' directly
        if (portfolioData && typeof portfolioData.balance === "number") {
          const balance = portfolioData.balance;
          cachedBalance = { usdc: balance, timestamp: Date.now() };
          this.saveBalance(balance);
          console.log("[LiveDataClient] Got balance from data API:", balance);
          return {
            usdc: balance.toFixed(2),
            matic: "0",
          };
        }
      } catch (e) {
        console.log("[LiveDataClient] Data API portfolio failed");
      }

      // Try Gamma API for user profile
      try {
        const gammaUrl = `${GAMMA_API_URL}/users/${this.walletAddress}`;
        const userData = await httpGet(gammaUrl);

        if (
          userData &&
          (userData.balance !== undefined || userData.totalValue !== undefined)
        ) {
          const balance = parseFloat(
            userData.balance || userData.totalValue || "0",
          );
          if (balance > 0) {
            cachedBalance = { usdc: balance, timestamp: Date.now() };
            this.saveBalance(balance);
            console.log(
              "[LiveDataClient] Got balance from Gamma API:",
              balance,
            );
            return {
              usdc: balance.toFixed(2),
              matic: "0",
            };
          }
        }
      } catch (e) {
        console.log("[LiveDataClient] Gamma API user profile failed");
      }

      // If we have a persisted balance, use it
      if (persistedBalance !== null && persistedBalance > 0) {
        cachedBalance = { usdc: persistedBalance, timestamp: Date.now() };
        console.log(
          "[LiveDataClient] Using persisted balance:",
          persistedBalance,
        );
        return {
          usdc: persistedBalance.toFixed(2),
          matic: "0",
        };
      }

      // Last resort: Query on-chain USDC (will be 0 if deposited to Polymarket)
      const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
      const addressPadded = this.walletAddress.slice(2).padStart(64, "0");
      const balanceOfData = "0x70a08231" + addressPadded;

      const usdcResult = await httpPost(POLYGON_RPC, {
        jsonrpc: "2.0",
        method: "eth_call",
        params: [
          {
            to: USDC_ADDRESS,
            data: balanceOfData,
          },
          "latest",
        ],
        id: 1,
      });

      const usdcHex = usdcResult?.result || "0x0";
      const usdcWei = BigInt(usdcHex);
      const usdc = Number(usdcWei) / 1e6;

      if (usdc > 0) {
        cachedBalance = { usdc, timestamp: Date.now() };
        this.saveBalance(usdc);
        console.log("[LiveDataClient] Got on-chain USDC balance:", usdc);
      } else {
        console.log(
          "[LiveDataClient] On-chain USDC is 0 (probably deposited to Polymarket)",
        );
      }

      return {
        usdc: usdc.toFixed(2),
        matic: "0",
      };
    } catch (e) {
      console.error("[LiveDataClient] Failed to get balances:", e);

      // Return cached value if available
      if (cachedBalance) {
        return {
          usdc: cachedBalance.usdc.toFixed(2),
          matic: "0",
        };
      }

      // Try persisted balance as last fallback
      const persistedBalance = this.loadPersistedBalance();
      if (persistedBalance !== null) {
        return {
          usdc: persistedBalance.toFixed(2),
          matic: "0",
        };
      }

      return { usdc: "0", matic: "0" };
    }
  }

  async getPositions(): Promise<{ positions: Position[] }> {
    try {
      // Fetch positions from Gamma API
      const url = `${GAMMA_API_URL}/positions?user=${this.walletAddress}`;
      console.log(`[LiveDataClient] Fetching positions from: ${url}`);
      const data = await httpGet(url);

      console.log(`[LiveDataClient] Positions API response type: ${typeof data}, isArray: ${Array.isArray(data)}`);
      if (data && typeof data === 'object') {
        console.log(`[LiveDataClient] Response keys: ${Object.keys(data).slice(0, 10).join(', ')}`);
      }

      // Handle different response formats
      let positionsArray: any[] = [];
      if (Array.isArray(data)) {
        positionsArray = data;
      } else if (data && data.positions && Array.isArray(data.positions)) {
        positionsArray = data.positions;
      } else if (data && data.data && Array.isArray(data.data)) {
        positionsArray = data.data;
      }

      if (positionsArray.length === 0) {
        console.log(`[LiveDataClient] No positions found in response`);
        return { positions: [] };
      }

      console.log(`[LiveDataClient] Found ${positionsArray.length} positions`);
      // Log first position structure for debugging
      if (positionsArray.length > 0) {
        console.log(`[LiveDataClient] Sample position keys: ${Object.keys(positionsArray[0]).join(', ')}`);
      }

      const positions: Position[] = positionsArray.map((pos: any) => {
        // Handle various field name formats from different API responses
        const shares = parseFloat(pos.size || pos.shares || pos.amount || pos.balance || "0");
        const avgPrice = parseFloat(pos.avgPrice || pos.averagePrice || pos.average_price || pos.entryPrice || "0");
        const currentPrice = parseFloat(pos.currentPrice || pos.price || pos.marketPrice || avgPrice);
        const tokenId = pos.tokenId || pos.token_id || pos.assetId || pos.asset_id || pos.asset || "";

        return {
          tokenId,
          conditionId: pos.conditionId || pos.condition_id || pos.marketId || pos.market_id,
          outcome: pos.outcome || pos.outcomeName || (pos.outcomeIndex === 0 ? "YES" : "NO"),
          shares,
          avgEntryPrice: avgPrice,
          currentPrice,
          currentValue: shares * currentPrice,
          market: pos.title || pos.question || pos.marketTitle || pos.market_title,
          marketSlug: pos.slug || pos.marketSlug || pos.market_slug,
          isResolved: pos.resolved || pos.isResolved || false,
          isRedeemable: pos.redeemable || pos.isRedeemable || false,
          feesPaid: parseFloat(pos.feesPaid || pos.fees_paid || "0"),
        };
      });

      const filteredPositions = positions.filter((p) => p.shares > 0);
      console.log(`[LiveDataClient] Returning ${filteredPositions.length} active positions`);
      return { positions: filteredPositions };
    } catch (e: any) {
      console.error("[LiveDataClient] Failed to get positions:", e.message || e);
      return { positions: [] };
    }
  }

  async getTrades(): Promise<{ trades: Trade[] }> {
    try {
      // Fetch trade history from Data API
      const url = `${DATA_API_URL}/activity?user=${this.walletAddress}&limit=100`;
      console.log(`[LiveDataClient] Fetching trades from: ${url}`);
      const data = await httpGet(url);

      console.log(`[LiveDataClient] Trades API response type: ${typeof data}, isArray: ${Array.isArray(data)}`);

      // Handle different response formats
      let tradesArray: any[] = [];
      if (Array.isArray(data)) {
        tradesArray = data;
      } else if (data && data.trades && Array.isArray(data.trades)) {
        tradesArray = data.trades;
      } else if (data && data.activity && Array.isArray(data.activity)) {
        tradesArray = data.activity;
      } else if (data && data.data && Array.isArray(data.data)) {
        tradesArray = data.data;
      }

      if (tradesArray.length === 0) {
        console.log(`[LiveDataClient] No trades found in response`);
        return { trades: [] };
      }

      console.log(`[LiveDataClient] Found ${tradesArray.length} activity items`);
      // Log first item structure for debugging
      if (tradesArray.length > 0) {
        console.log(`[LiveDataClient] Sample activity keys: ${Object.keys(tradesArray[0]).join(', ')}`);
      }

      const trades: Trade[] = tradesArray
        .filter((item: any) => item.type === "trade" || item.side || item.tradeType)
        .map((trade: any, idx: number) => {
          const price = parseFloat(trade.price || "0");
          const size = parseFloat(trade.size || trade.shares || trade.amount || "0");

          return {
            id: trade.id || trade.transactionHash || trade.transaction_hash || `trade-${idx}`,
            timestamp: new Date(trade.timestamp || trade.created_at || trade.createdAt || Date.now()).getTime(),
            tokenId: trade.tokenId || trade.token_id || trade.asset_id || trade.assetId || trade.asset,
            marketSlug: trade.slug || trade.marketSlug || trade.market_slug,
            market: trade.title || trade.question || trade.marketTitle,
            outcome: trade.outcome || trade.outcomeName || (trade.outcomeIndex === 0 ? "YES" : "NO"),
            side: (trade.side || trade.tradeType || "BUY").toUpperCase() as "BUY" | "SELL",
            price,
            shares: size,
            usdValue: price * size,
            fees: parseFloat(trade.fees || trade.fee || trade.feeAmount || "0"),
            pnl: trade.pnl !== undefined ? parseFloat(trade.pnl) : undefined,
          };
        });

      console.log(`[LiveDataClient] Returning ${trades.length} trades`);
      return { trades };
    } catch (e: any) {
      console.error("[LiveDataClient] Failed to get trades:", e.message || e);
      return { trades: [] };
    }
  }

  async getLiveData(): Promise<LiveDataResult> {
    // Fetch positions and trades in parallel
    const [positionsResult, tradesResult] = await Promise.all([
      this.getPositions(),
      this.getTrades(),
    ]);

    // Calculate total positions value
    let positionsValue = 0;
    for (const pos of positionsResult.positions) {
      positionsValue += pos.currentValue || 0;
    }

    // Get balance - this will try APIs first, then use cache/persistence
    const balances = await this.getBalances();
    let balance = parseFloat(balances.usdc) || 0;

    // If balance is 0 but we have positions, use positions value as a minimum
    // This handles the case where deposited USDC can't be queried via API
    if (balance === 0 && positionsValue > 0) {
      // Use positions value - better than showing 0
      console.log(
        "[LiveDataClient] Balance is 0, using positions value:",
        positionsValue,
      );
      balance = positionsValue;
      // Also persist this estimate
      this.saveBalance(positionsValue);
    }

    return {
      balance,
      positions: positionsResult.positions,
      trades: tradesResult.trades,
    };
  }

  getWalletAddress(): string {
    return this.walletAddress;
  }
}
