/**
 * Logging utilities using Winston
 */

import * as winston from "winston";
import * as path from "path";
import * as fs from "fs";
import { getEnvConfig } from "../config/env";

const { combine, timestamp, printf, colorize, json } = winston.format;

// Flag to indicate if dashboard is active (console should be silent)
let dashboardMode = false;

// Store original console methods to restore later
const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

// Callback for intercepted console output (for dashboard)
let consoleInterceptCallback: ((type: string, message: string) => void) | null =
  null;

// Custom format for console output
const consoleFormat = printf(
  ({ level, message, timestamp: ts, ...metadata }) => {
    let msg = `${ts} [${level}]: ${message}`;

    if (Object.keys(metadata).length > 0) {
      // Only show metadata if it's not empty
      const metaStr = JSON.stringify(metadata);
      if (metaStr !== "{}") {
        msg += ` ${metaStr}`;
      }
    }

    return msg;
  }
);

let loggerInstance: winston.Logger | null = null;
let consoleTransport: winston.transports.ConsoleTransportInstance | null = null;

/**
 * Enable dashboard mode - silences console output and intercepts it
 */
export function enableDashboardMode(): void {
  dashboardMode = true;
  if (loggerInstance && consoleTransport) {
    loggerInstance.remove(consoleTransport);
  }

  // Intercept console methods to prevent library output from breaking dashboard
  const interceptConsole =
    (type: string) =>
    (...args: unknown[]) => {
      // Convert args to string
      const message = args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ");

      // If we have a callback, send it there (for dashboard to display)
      if (consoleInterceptCallback) {
        consoleInterceptCallback(type, message);
      }

      // Also log to file if available
      if (loggerInstance) {
        if (type === "error") {
          loggerInstance.error(message);
        } else if (type === "warn") {
          loggerInstance.warn(message);
        } else {
          loggerInstance.debug(message);
        }
      }
    };

  console.log = interceptConsole("log");
  console.error = interceptConsole("error");
  console.warn = interceptConsole("warn");
  console.info = interceptConsole("info");
  console.debug = interceptConsole("debug");
}

/**
 * Disable dashboard mode - restores console output
 */
export function disableDashboardMode(): void {
  dashboardMode = false;
  if (loggerInstance && consoleTransport) {
    loggerInstance.add(consoleTransport);
  }

  // Restore original console methods
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;

  consoleInterceptCallback = null;
}

/**
 * Set a callback to receive intercepted console output
 */
export function setConsoleInterceptCallback(
  callback: (type: string, message: string) => void
): void {
  consoleInterceptCallback = callback;
}

/**
 * Check if dashboard mode is active
 */
export function isDashboardMode(): boolean {
  return dashboardMode;
}

/**
 * Get or create the Winston logger instance
 */
export function getLogger(): winston.Logger {
  if (loggerInstance) {
    return loggerInstance;
  }

  const env = getEnvConfig();
  const transports: winston.transport[] = [];

  // Console transport (can be removed in dashboard mode)
  consoleTransport = new winston.transports.Console({
    format: combine(
      colorize(),
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      consoleFormat
    ),
  });

  if (!dashboardMode) {
    transports.push(consoleTransport);
  }

  // File transport (optional)
  if (env.logToFile) {
    const logDir = path.dirname(env.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    transports.push(
      new winston.transports.File({
        filename: env.logFile,
        format: combine(timestamp(), json()),
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
      })
    );

    // Error-only file
    const errorLogPath = env.logFile.replace(".log", "-error.log");
    transports.push(
      new winston.transports.File({
        filename: errorLogPath,
        level: "error",
        format: combine(timestamp(), json()),
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
      })
    );
  }

  loggerInstance = winston.createLogger({
    level: env.logLevel,
    transports,
  });

  return loggerInstance;
}

/**
 * Reset the logger (for testing)
 */
export function resetLogger(): void {
  if (loggerInstance) {
    loggerInstance.close();
    loggerInstance = null;
  }
}

/**
 * Log a trade detection event
 */
export function logTradeDetected(
  logger: winston.Logger,
  targetWallet: string,
  tradeId: string,
  side: string,
  price: number,
  tokenId: string
): void {
  logger.info("Trade detected", {
    event: "TRADE_DETECTED",
    targetWallet: formatAddr(targetWallet),
    tradeId,
    side,
    price,
    tokenId: formatAddr(tokenId),
  });
}

/**
 * Log an order placement
 */
export function logOrderPlaced(
  logger: winston.Logger,
  tradeId: string,
  orderId: string,
  side: string,
  price: number,
  size: number,
  dryRun: boolean
): void {
  logger.info(dryRun ? "Order simulated (dry-run)" : "Order placed", {
    event: "ORDER_PLACED",
    tradeId,
    orderId,
    side,
    price,
    size,
    dryRun,
  });
}

/**
 * Log an order skip
 */
export function logOrderSkipped(
  logger: winston.Logger,
  tradeId: string,
  reason: string
): void {
  logger.info("Order skipped", {
    event: "ORDER_SKIPPED",
    tradeId,
    reason,
  });
}

/**
 * Log an error with context
 */
export function logError(
  logger: winston.Logger,
  error: Error,
  context?: string
): void {
  logger.error(context || "Error occurred", {
    event: "ERROR",
    error: error.message,
    stack: error.stack,
    context,
  });
}

/**
 * Format address for logging (truncated)
 */
function formatAddr(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
