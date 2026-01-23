/**
 * Utility functions - HTTP client with retry/backoff
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from "axios";
import { getLogger } from "./logger";

const logger = getLogger();

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff with jitter
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  // Add jitter: random value between 0 and exponentialDelay * 0.5
  const jitter = Math.random() * exponentialDelay * 0.5;
  // Cap at max delay
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: AxiosError): boolean {
  // Retry on network errors
  if (!error.response) {
    return true;
  }

  const status = error.response.status;

  // Retry on rate limit (429) and server errors (5xx)
  if (status === 429 || (status >= 500 && status < 600)) {
    return true;
  }

  // Retry on 403 - might be temporary Cloudflare block
  if (status === 403) {
    // Check if it's a Cloudflare challenge
    const data = error.response.data;
    if (typeof data === 'string' &&
        (data.includes('Cloudflare') || data.includes('cloudflare') ||
         data.includes('Attention Required') || data.includes('cf-browser-verification'))) {
      logger.warn('Cloudflare challenge detected, will retry with backoff');
      return true;
    }
    // Also retry generic 403s with longer backoff
    return true;
  }

  // Retry on timeout
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return true;
  }

  return false;
}

/**
 * Create an HTTP client with built-in retry logic
 */
export function createHttpClient(
  baseURL: string,
  _retryConfig: Partial<RetryConfig> = {}
): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      // Add User-Agent to avoid Cloudflare blocking
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
  });

  // Request interceptor for logging
  client.interceptors.request.use(
    (request) => {
      logger.debug(`HTTP ${request.method?.toUpperCase()} ${request.url}`, {
        params: request.params,
      });
      return request;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor for logging
  client.interceptors.response.use(
    (response) => {
      logger.debug(`HTTP Response ${response.status}`, {
        url: response.config.url,
      });
      return response;
    },
    (error) => Promise.reject(error)
  );

  return client;
}

/**
 * Execute an HTTP request with retry logic
 */
export async function fetchWithRetry<T>(
  client: AxiosInstance,
  config: AxiosRequestConfig,
  retryConfig: Partial<RetryConfig> = {}
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = {
    ...DEFAULT_RETRY_CONFIG,
    ...retryConfig,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.request<T>(config);
      return response.data;
    } catch (error) {
      lastError = error as Error;

      if (axios.isAxiosError(error)) {
        if (!isRetryableError(error)) {
          // Non-retryable error, throw immediately
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = calculateBackoff(attempt, baseDelayMs, maxDelayMs);
          logger.warn(
            `Request failed, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${maxRetries})`,
            {
              url: config.url,
              error: error.message,
              status: error.response?.status,
            }
          );
          await sleep(delay);
        }
      } else {
        // Non-Axios error, throw immediately
        throw error;
      }
    }
  }

  throw lastError || new Error("Request failed after retries");
}

/**
 * Format a wallet address for display (truncated)
 */
export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format USD amount
 */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Format timestamp to human-readable string
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Generate a stable hash for trade deduplication
 */
export function hashTrade(
  wallet: string,
  timestamp: number,
  tokenId: string,
  side: string,
  price: number,
  size?: number
): string {
  const components = [
    wallet.toLowerCase(),
    timestamp.toString(),
    tokenId,
    side,
    price.toFixed(6),
    size?.toFixed(6) || "0",
  ];
  return components.join(":");
}

/**
 * Parse a comma-separated string into an array
 */
export function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Check if a value matches any pattern in a list
 */
export function matchesAnyPattern(value: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;

  const lowerValue = value.toLowerCase();
  return patterns.some((pattern) => {
    const lowerPattern = pattern.toLowerCase();
    return (
      lowerValue.includes(lowerPattern) || lowerPattern.includes(lowerValue)
    );
  });
}

/**
 * Normalize an Ethereum address to lowercase with 0x prefix
 */
export function normalizeAddress(address: string): string {
  const cleaned = address.toLowerCase().trim();
  return cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`;
}

/**
 * Validate an Ethereum address
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/i.test(address);
}

/**
 * Simple rate limiter class to prevent API overload
 * Uses token bucket algorithm
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRatePerSecond: number;

  constructor(maxTokens: number = 10, refillRatePerSecond: number = 2) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRatePerSecond = refillRatePerSecond;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillRatePerSecond;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Check if a request can be made (non-blocking)
   */
  canMakeRequest(): boolean {
    this.refill();
    return this.tokens >= 1;
  }

  /**
   * Wait until a request can be made
   */
  async waitForToken(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Calculate wait time
    const tokensNeeded = 1 - this.tokens;
    const waitTimeMs = (tokensNeeded / this.refillRatePerSecond) * 1000;
    await sleep(Math.ceil(waitTimeMs));
    this.refill();
    this.tokens -= 1;
  }

  /**
   * Consume a token immediately (use after making request)
   */
  consumeToken(): void {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
    }
  }
}

/**
 * Global rate limiter for Polymarket API calls
 * 10 tokens max, refill at 5 per second (conservative rate)
 */
export const globalRateLimiter = new RateLimiter(10, 5);

/**
 * Execute a function with rate limiting
 */
export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  await globalRateLimiter.waitForToken();
  return fn();
}

/**
 * Execute multiple promises with controlled concurrency and rate limiting
 */
export async function parallelWithLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number = 5,
  delayBetweenBatches: number = 100
): Promise<T[]> {
  const results: T[] = [];

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((task) => task()));
    results.push(...batchResults);

    // Add delay between batches
    if (i + concurrency < tasks.length && delayBetweenBatches > 0) {
      await sleep(delayBetweenBatches);
    }
  }

  return results;
}
