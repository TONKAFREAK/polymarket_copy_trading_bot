import path from "path";
import fs from "fs";
import { app, ipcMain, BrowserWindow, shell } from "electron";
import serve from "electron-serve";
import { createWindow } from "./helpers";
import { getBotService, BotService } from "./botService";

const isProd = process.env.NODE_ENV === "production";

// ========== Global Error Handlers to Prevent Crashes ==========

// Log file for crash debugging
function getCrashLogPath(): string {
  try {
    const logDir = isProd
      ? path.join(app.getPath("userData"), "logs")
      : path.join(__dirname, "..", "..", "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    return path.join(logDir, "crash.log");
  } catch {
    return "";
  }
}

function logCrash(type: string, error: any): void {
  try {
    const logPath = getCrashLogPath();
    if (!logPath) return;

    const timestamp = new Date().toISOString();
    const errorStr =
      error instanceof Error
        ? `${error.message}\n${error.stack}`
        : String(error);
    const logEntry = `[${timestamp}] ${type}: ${errorStr}\n\n`;

    fs.appendFileSync(logPath, logEntry);
    console.error(`[CRASH LOG] ${type}:`, error);
  } catch {
    // Ignore logging errors
  }
}

// Catch uncaught exceptions - CRITICAL for preventing crashes
process.on("uncaughtException", (error) => {
  logCrash("UNCAUGHT_EXCEPTION", error);
  // Don't exit - try to keep the app running
});

// Catch unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logCrash("UNHANDLED_REJECTION", reason);
  // Don't exit - try to keep the app running
});

// Log when the process is about to exit
process.on("exit", (code) => {
  logCrash("PROCESS_EXIT", `Exit code: ${code}`);
});

// ========== End Global Error Handlers ==========

// Data directory will be set after app is ready
let dataDir: string;

// Helper to get data directory (must be called after app.whenReady())
function getDataDir(): string {
  if (dataDir) return dataDir;

  if (isProd) {
    // In production, use app's userData folder which is writable
    dataDir = path.join(app.getPath("userData"), "data");
  } else {
    // In development, use the project's data folder
    dataDir = path.join(__dirname, "..", "..", "data");
  }

  // Ensure directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  return dataDir;
}

// Helper to get env file path
function getEnvFilePath(): string {
  if (isProd) {
    // In production, store .env in userData folder (same level as data)
    return path.join(app.getPath("userData"), ".env");
  } else {
    // In development, use project root
    return path.join(__dirname, "..", "..", ".env");
  }
}

// State tracking - now managed by BotService
let startTime = Date.now();
let logs: any[] = [];
const MAX_LOGS = 200; // Maximum logs to keep in memory (reduced from 500)

// Helper to add log with automatic trimming to prevent memory leaks
function addLog(entry: any) {
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(-MAX_LOGS);
  }
}

// Initialize bot service
let botService: BotService;

// Market metadata cache: { slug: { question, image, icon, fetchedAt } }
interface MarketMeta {
  question: string;
  image?: string;
  icon?: string;
  title?: string;
  fetchedAt: number;
}
const marketMetaCache: Map<string, MarketMeta> = new Map();
// Cache by token_id as well
const tokenIdToMetaCache: Map<string, MarketMeta> = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 200; // Maximum cache entries to prevent memory leaks (reduced from 500)

// Helper to add to cache with size limit (evicts oldest entries)
function addToCache(
  cache: Map<string, MarketMeta>,
  key: string,
  value: MarketMeta,
) {
  cache.set(key, value);
  // Evict oldest entries if cache is too large
  if (cache.size > MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(cache.keys()).slice(
      0,
      cache.size - MAX_CACHE_SIZE,
    );
    keysToDelete.forEach((k) => cache.delete(k));
  }
}

// Fetch market metadata by token_id from Polymarket Gamma API
async function fetchMarketMetaByTokenId(
  tokenId: string,
): Promise<MarketMeta | null> {
  // Check cache first
  const cached = tokenIdToMetaCache.get(tokenId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    // Use clob_token_ids parameter to fetch by token ID
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets?clob_token_ids=${tokenId}`,
    );

    if (!response.ok) {
      return null;
    }

    const markets = await response.json();
    if (markets && markets.length > 0) {
      const market = markets[0];
      const meta: MarketMeta = {
        question:
          market.question ||
          market.groupItemTitle ||
          market.title ||
          market.slug,
        image: market.image,
        icon: market.icon,
        title: market.title || market.groupItemTitle,
        fetchedAt: Date.now(),
      };

      // Cache by both token_id and slug (with size limits)
      addToCache(tokenIdToMetaCache, tokenId, meta);
      if (market.slug) {
        addToCache(marketMetaCache, market.slug, meta);
      }

      return meta;
    }
    return null;
  } catch (e) {
    console.error(`Failed to fetch market meta for token ${tokenId}:`, e);
    return null;
  }
}

// Fetch market metadata from Polymarket Gamma API by slug
async function fetchMarketMeta(slug: string): Promise<MarketMeta | null> {
  // Check cache first
  const cached = marketMetaCache.get(slug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets/${slug}`,
    );
    if (!response.ok) {
      // For short-term markets, try the events endpoint
      const eventResponse = await fetch(
        `https://gamma-api.polymarket.com/events?slug=${slug}`,
      );
      if (eventResponse.ok) {
        const events = await eventResponse.json();
        if (events && events.length > 0) {
          const event = events[0];
          const meta: MarketMeta = {
            question: event.title || event.question || slug,
            image: event.image || event.featuredImage,
            icon: event.icon,
            title: event.title,
            fetchedAt: Date.now(),
          };
          addToCache(marketMetaCache, slug, meta);
          return meta;
        }
      }
      return null;
    }

    const market = await response.json();
    const meta: MarketMeta = {
      question:
        market.question || market.groupItemTitle || market.title || slug,
      image: market.image,
      icon: market.icon,
      title: market.title || market.groupItemTitle,
      fetchedAt: Date.now(),
    };
    addToCache(marketMetaCache, slug, meta);
    return meta;
  } catch (e) {
    console.error(`Failed to fetch market meta for ${slug}:`, e);
    return null;
  }
}

// Batch fetch market metadata for multiple slugs or token IDs
async function fetchMarketMetaBatch(
  slugsOrTokenIds: string[],
  isTokenIds: boolean = false,
): Promise<void> {
  const unique = Array.from(
    new Set(slugsOrTokenIds.filter((s) => s && s !== "unknown")),
  );

  const cache = isTokenIds ? tokenIdToMetaCache : marketMetaCache;
  const unfetched = unique.filter((s) => {
    const cached = cache.get(s);
    return !cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS;
  });

  // Fetch in parallel with limit
  const batchSize = 5;
  for (let i = 0; i < unfetched.length; i += batchSize) {
    const batch = unfetched.slice(i, i + batchSize);
    const fetchFn = isTokenIds ? fetchMarketMetaByTokenId : fetchMarketMeta;
    await Promise.all(batch.map((s) => fetchFn(s).catch(() => null)));
  }
}

// Helper to read JSON files safely
function readJsonFile(filename: string, defaultValue: any = {}) {
  try {
    const filePath = path.join(getDataDir(), filename);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (e) {
    console.error(`Error reading ${filename}:`, e);
  }
  return defaultValue;
}

// Helper to write JSON files
function writeJsonFile(filename: string, data: any) {
  try {
    const dir = getDataDir();
    // Ensure directory exists before writing
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error(`Error writing ${filename}:`, e);
    return false;
  }
}

// Auto-detect and add account from .env file if valid credentials exist
async function autoAddEnvAccount(): Promise<void> {
  try {
    const envFile = getEnvFilePath();
    if (!fs.existsSync(envFile)) {
      console.log("No .env file found, skipping auto-add account");
      return;
    }

    const content = fs.readFileSync(envFile, "utf-8");

    // Parse .env values
    const getValue = (key: string): string | null => {
      const match = content.match(new RegExp(`^${key}=([^\\n\\r]+)`, "m"));
      return match ? match[1].trim() : null;
    };

    const privateKey = getValue("PRIVATE_KEY");
    const polyApiKey = getValue("POLY_API_KEY");
    const polyApiSecret = getValue("POLY_API_SECRET");
    const polyPassphrase = getValue("POLY_PASSPHRASE");
    const polyFunderAddress = getValue("POLY_FUNDER_ADDRESS");

    // Check if we have valid credentials (not placeholder values)
    if (
      !privateKey ||
      privateKey === "your_private_key_here_without_0x" ||
      privateKey.length < 64
    ) {
      console.log("No valid private key in .env, skipping auto-add account");
      return;
    }

    if (!polyApiKey || !polyApiSecret || !polyPassphrase) {
      console.log(
        "Missing Polymarket API credentials in .env, skipping auto-add account",
      );
      return;
    }

    // Derive wallet address from private key
    const { ethers } = await import("ethers");
    let pk = privateKey.trim();
    if (!pk.startsWith("0x")) {
      pk = "0x" + pk;
    }

    let address: string;
    try {
      const wallet = new ethers.Wallet(pk);
      address = wallet.address;
    } catch (e) {
      console.error("Invalid private key in .env:", e);
      return;
    }

    // Load current accounts state
    const accountsState = readJsonFile("accounts.json", {
      activeAccountId: null,
      accounts: [],
      hasSeenPaperPopup: false,
    });

    // Check if this account already exists (by address)
    const existingAccount = accountsState.accounts.find(
      (acc: any) => acc.address?.toLowerCase() === address.toLowerCase(),
    );

    if (existingAccount) {
      console.log(
        `Account ${address.slice(0, 8)}... already exists, skipping auto-add`,
      );

      // If no account is currently active and this one exists, activate it
      if (accountsState.activeAccountId === null) {
        accountsState.activeAccountId = existingAccount.id;

        // Update config to live mode
        const config = readJsonFile("config.json", {});
        config.mode = "live";
        writeJsonFile("config.json", config);
        writeJsonFile("accounts.json", accountsState);

        console.log(`Activated existing account: ${existingAccount.name}`);
      }
      return;
    }

    // Create new account from .env
    const newAccount = {
      id: `account-env-${Date.now()}`,
      name: polyFunderAddress
        ? `Wallet ${address.slice(0, 6)}...${address.slice(-4)}`
        : `Primary Wallet`,
      address,
      privateKey: privateKey.startsWith("0x")
        ? privateKey.slice(2)
        : privateKey,
      polyApiKey,
      polyApiSecret,
      polyPassphrase,
      polyFunderAddress: polyFunderAddress || undefined,
      createdAt: Date.now(),
    };

    accountsState.accounts.push(newAccount);
    accountsState.activeAccountId = newAccount.id; // Auto-activate the account

    // Update config to live mode
    const config = readJsonFile("config.json", {});
    config.mode = "live";
    writeJsonFile("config.json", config);
    writeJsonFile("accounts.json", accountsState);

    console.log(
      `Auto-added and activated account from .env: ${newAccount.name} (${address})`,
    );
  } catch (e) {
    console.error("Error auto-adding account from .env:", e);
  }
}

if (isProd) {
  serve({ directory: "app" });
} else {
  app.setPath("userData", `${app.getPath("userData")} (development)`);
}

let mainWindow: BrowserWindow | null = null;

(async () => {
  await app.whenReady();

  // Initialize data directory (must be after app.whenReady())
  const dir = getDataDir();
  console.log("Data directory:", dir);

  // Initialize bot service with data directory
  botService = getBotService(dir);

  // Auto-detect and add account from .env if credentials exist
  await autoAddEnvAccount();

  mainWindow = createWindow("main", {
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    transparent: false,
    backgroundColor: "#0a0a0b",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Set the main window for bot service to send events
  botService.setMainWindow(mainWindow);

  // Handle renderer process crashes
  mainWindow.webContents.on("render-process-gone", (event, details) => {
    logCrash(
      "RENDERER_CRASH",
      `Reason: ${details.reason}, exitCode: ${details.exitCode}`,
    );
    // Try to reload the window instead of closing
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  // Handle unresponsive renderer
  mainWindow.on("unresponsive", () => {
    logCrash("RENDERER_UNRESPONSIVE", "Window became unresponsive");
  });

  mainWindow.on("responsive", () => {
    console.log("[Main] Window became responsive again");
  });

  // Handle window closed
  mainWindow.on("closed", () => {
    logCrash("WINDOW_CLOSED", "Main window was closed");
    mainWindow = null;
  });

  if (isProd) {
    await mainWindow.loadURL("app://./home");
  } else {
    const port = process.argv[2];
    await mainWindow.loadURL(`http://localhost:${port}/home`);
    mainWindow.webContents.openDevTools();
  }
})();

// Handle GPU process crashes
app.on("gpu-process-crashed" as any, (event: any, killed: boolean) => {
  logCrash("GPU_CRASH", `GPU process crashed. Killed: ${killed}`);
});

// Handle child process crashes
app.on("child-process-gone", (event, details) => {
  logCrash(
    "CHILD_PROCESS_GONE",
    `Type: ${details.type}, reason: ${details.reason}`,
  );
});

app.on("window-all-closed", () => {
  app.quit();
});

// ========== Window Control IPC Handlers ==========

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("window:isMaximized", () => {
  return mainWindow?.isMaximized() ?? false;
});

// ========== IPC Handlers ==========

ipcMain.on("message", async (event, arg) => {
  event.reply("message", `${arg} World!`);
});

// Get wallet address from env - derive from private key if needed
ipcMain.handle("wallet:getAddress", async () => {
  const envFile = getEnvFilePath();
  try {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, "utf-8");

      // First, check for explicit WALLET_ADDRESS
      const addrMatch = content.match(/WALLET_ADDRESS=([^\n\r]+)/);
      if (addrMatch && addrMatch[1].trim()) {
        return { address: addrMatch[1].trim() };
      }

      // Check for POLY_FUNDER_ADDRESS (Polymarket profile address)
      const funderMatch = content.match(/POLY_FUNDER_ADDRESS=([^\n\r]+)/);
      if (funderMatch && funderMatch[1].trim()) {
        return { address: funderMatch[1].trim() };
      }

      // Derive address from PRIVATE_KEY
      const pkMatch = content.match(/PRIVATE_KEY=([^\n\r]+)/);
      if (
        pkMatch &&
        pkMatch[1].trim() &&
        pkMatch[1].trim() !== "your_private_key_here_without_0x"
      ) {
        try {
          // Use ethers to derive address from private key
          const { ethers } = await import("ethers");
          let privateKey = pkMatch[1].trim();
          // Ensure 0x prefix
          if (!privateKey.startsWith("0x")) {
            privateKey = "0x" + privateKey;
          }
          const wallet = new ethers.Wallet(privateKey);
          return { address: wallet.address };
        } catch (e) {
          console.error("Error deriving wallet address from private key:", e);
        }
      }
    }
  } catch (e) {
    console.error("Error reading wallet address:", e);
  }
  return { address: null };
});

// Get configuration
ipcMain.handle("config:get", async () => {
  const defaults = {
    trading: {
      sizingMode: "proportional",
      fixedUsdSize: 10,
      fixedSharesSize: 10,
      proportionalMultiplier: 0.01,
      minOrderSize: 1,
      minOrderShares: 0.01,
      slippage: 0.01,
    },
    risk: {
      maxUsdPerTrade: 1000,
      maxUsdPerMarket: 1e22,
      maxDailyUsdVolume: 1e22,
      doNotTradeMarketsOlderThanSecondsFromResolution: 0,
      marketAllowlist: [],
      marketDenylist: [],
      dryRun: false,
    },
    stopLoss: {
      enabled: false,
      percent: 80,
      checkIntervalMs: 30000,
    },
    autoRedeem: {
      enabled: false,
      intervalMs: 300000,
    },
    paperTrading: {
      enabled: true,
      startingBalance: 10000,
      feeRate: 0.001,
    },
    polling: {
      intervalMs: 2000,
      tradeLimit: 20,
      maxRetries: 3,
      baseBackoffMs: 2000,
    },
    targets: [],
    chainId: 137,
  };

  // Read saved config and deep-merge with defaults
  const saved = readJsonFile("config.json", {});
  const merged = {
    ...defaults,
    ...saved,
    trading: { ...defaults.trading, ...saved.trading },
    risk: { ...defaults.risk, ...saved.risk },
    stopLoss: { ...defaults.stopLoss, ...saved.stopLoss },
    autoRedeem: { ...defaults.autoRedeem, ...saved.autoRedeem },
    paperTrading: { ...defaults.paperTrading, ...saved.paperTrading },
    polling: { ...defaults.polling, ...saved.polling },
  };

  // Force dryRun to false when paper trading is enabled
  if (merged.paperTrading?.enabled) {
    merged.risk.dryRun = false;
  }

  return merged;
});

// Update configuration
ipcMain.handle("config:set", async (_event, newConfig) => {
  console.log(
    "[config:set] Saving config:",
    JSON.stringify(newConfig, null, 2),
  );
  const success = writeJsonFile("config.json", newConfig);
  console.log("[config:set] Save result:", success);

  if (!success) {
    throw new Error("Failed to save configuration");
  }

  // Verify the save by reading back
  const savedConfig = readJsonFile("config.json", null);
  console.log(
    "[config:set] Verified saved config:",
    JSON.stringify(savedConfig, null, 2),
  );

  return { success: true, config: savedConfig };
});

// Update specific config section
ipcMain.handle(
  "config:update",
  async (_event, section: string, values: any) => {
    const config = readJsonFile("config.json", {});
    if (section === "trading") {
      config.trading = { ...config.trading, ...values };
    } else if (section === "risk") {
      config.risk = { ...config.risk, ...values };
    } else if (section === "polling") {
      config.polling = { ...config.polling, ...values };
    } else if (section === "stopLoss") {
      config.stopLoss = { ...config.stopLoss, ...values };
    } else if (section === "autoRedeem") {
      config.autoRedeem = { ...config.autoRedeem, ...values };
    } else if (section === "paperTrading") {
      config.paperTrading = { ...config.paperTrading, ...values };
    }
    return writeJsonFile("config.json", config);
  },
);

// Get dashboard stats
ipcMain.handle("stats:get", async () => {
  const config = readJsonFile("config.json", {
    targets: [],
    risk: { dryRun: true },
    mode: "paper",
  });

  // Determine mode from accounts state (takes priority over config)
  const accountsState = loadAccountsState();
  let mode: "dry-run" | "paper" | "live" = accountsState.activeAccountId
    ? "live"
    : "paper";
  if (config.risk?.dryRun && mode !== "live") mode = "dry-run";

  // Get bot status from service
  const isRunning = botService?.isRunning() || false;
  const isConnected = botService?.isConnected() || false;

  // For LIVE mode, try to fetch real data from Polymarket
  if (mode === "live") {
    try {
      const liveData = await botService?.getLiveStats();
      if (liveData) {
        return {
          mode: "live",
          balance: liveData.balance,
          startingBalance: liveData.startingBalance || liveData.balance,
          openPositions: liveData.positions?.length || 0,
          positionsValue: liveData.positionsValue || 0,
          unrealizedPnl: liveData.unrealizedPnl || 0,
          realizedPnl: liveData.realizedPnl || 0,
          totalTrades: liveData.totalTrades || 0,
          totalFees: liveData.totalFees || 0,
          winRate: liveData.winRate || 0,
          winningTrades: liveData.winningTrades || 0,
          losingTrades: liveData.losingTrades || 0,
          largestWin: liveData.largestWin || 0,
          largestLoss: liveData.largestLoss || 0,
          profitFactor: liveData.profitFactor || 0,
          avgTradeSize: liveData.avgTradeSize || 0,
          uptime: isRunning ? Date.now() - startTime : 0,
          lastUpdate: Date.now(),
          pollingInterval: config.polling?.intervalMs || 2000,
          targetsCount: config.targets?.length || 0,
          openOrdersCount: 0,
          botRunning: isRunning,
          botConnected: isConnected,
        };
      }
      // Live mode but no data yet - return empty stats (do NOT fall through to paper)
      return {
        mode: "live",
        balance: 0,
        startingBalance: 0,
        openPositions: 0,
        positionsValue: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        totalTrades: 0,
        totalFees: 0,
        winRate: 0,
        winningTrades: 0,
        losingTrades: 0,
        largestWin: 0,
        largestLoss: 0,
        profitFactor: 0,
        avgTradeSize: 0,
        uptime: isRunning ? Date.now() - startTime : 0,
        lastUpdate: Date.now(),
        pollingInterval: config.polling?.intervalMs || 2000,
        targetsCount: config.targets?.length || 0,
        openOrdersCount: 0,
        botRunning: isRunning,
        botConnected: isConnected,
      };
    } catch (e) {
      console.error("Failed to fetch live stats:", e);
      // In live mode, return empty stats instead of falling through to paper
      return {
        mode: "live",
        balance: 0,
        startingBalance: 0,
        openPositions: 0,
        positionsValue: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        totalTrades: 0,
        totalFees: 0,
        winRate: 0,
        winningTrades: 0,
        losingTrades: 0,
        largestWin: 0,
        largestLoss: 0,
        profitFactor: 0,
        avgTradeSize: 0,
        uptime: isRunning ? Date.now() - startTime : 0,
        lastUpdate: Date.now(),
        pollingInterval: config.polling?.intervalMs || 2000,
        targetsCount: config.targets?.length || 0,
        openOrdersCount: 0,
        botRunning: isRunning,
        botConnected: isConnected,
      };
    }
  }

  // Paper/Dry-run mode: use local paper state
  const paperState = readJsonFile("paper-state.json", {
    currentBalance: 10000,
    startingBalance: 10000,
    positions: {},
    trades: [],
    stats: {},
  });

  // Calculate stats from paper state
  const positions = Object.values(paperState.positions || {});
  const activePositions = positions.filter(
    (p: any) => p.shares > 0 && !p.settled,
  );
  const positionsValue = activePositions.reduce((sum: number, p: any) => {
    const price = p.currentPrice || p.avgEntryPrice;
    return sum + p.shares * price;
  }, 0);

  // Calculate unrealized PnL
  const unrealizedPnl = activePositions.reduce((sum: number, p: any) => {
    const currentPrice = p.currentPrice || p.avgEntryPrice;
    const entryValue = p.totalCost || p.avgEntryPrice * p.shares;
    const currentValue = p.shares * currentPrice;
    return sum + (currentValue - entryValue);
  }, 0);

  const trades = paperState.trades || [];
  const stats = paperState.stats || {};
  const winningTrades =
    stats.winningTrades || trades.filter((t: any) => (t.pnl || 0) > 0).length;
  const losingTrades =
    stats.losingTrades || trades.filter((t: any) => (t.pnl || 0) < 0).length;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

  return {
    mode,
    balance: paperState.currentBalance || 0,
    startingBalance: paperState.startingBalance || 10000,
    openPositions: activePositions.length,
    positionsValue,
    unrealizedPnl,
    realizedPnl: stats.totalRealizedPnl || 0,
    totalTrades,
    totalFees: stats.totalFees || 0,
    winRate,
    winningTrades,
    losingTrades,
    largestWin: stats.largestWin || 0,
    largestLoss: stats.largestLoss || 0,
    profitFactor: stats.profitFactor || 0,
    avgTradeSize: stats.avgTradeSize || 0,
    uptime: isRunning ? Date.now() - startTime : 0,
    lastUpdate: Date.now(),
    pollingInterval: config.polling?.intervalMs || 2000,
    targetsCount: config.targets?.length || 0,
    openOrdersCount: 0,
    botRunning: isRunning,
    botConnected: isConnected,
  };
});

// Get portfolio positions
ipcMain.handle("portfolio:get", async () => {
  // Determine mode from accounts state
  const accountsState = loadAccountsState();
  const mode = accountsState.activeAccountId ? "live" : "paper";

  // For LIVE mode, fetch real positions from Polymarket
  if (mode === "live") {
    try {
      const liveData = await botService?.getLiveStats();
      if (liveData && liveData.positions) {
        // Fetch market metadata by token IDs
        const tokenIds = liveData.positions
          .map((pos: any) => pos.tokenId)
          .filter(Boolean);
        await fetchMarketMetaBatch(tokenIds, true);

        const positions = liveData.positions.map((pos: any) => {
          // Try to get metadata from token ID
          const meta = pos.tokenId ? tokenIdToMetaCache.get(pos.tokenId) : null;
          const marketName =
            meta?.question || meta?.title || pos.market || "Unknown Market";
          const imageUrl =
            meta?.image ||
            (pos.marketSlug
              ? `https://polymarket-upload.s3.us-east-2.amazonaws.com/${pos.marketSlug}.png`
              : undefined);

          return {
            tokenId: pos.tokenId,
            outcome: pos.outcome || "YES",
            shares: pos.shares || 0,
            avgEntryPrice: pos.avgEntryPrice || 0,
            currentValue: pos.currentValue || 0,
            currentPrice:
              pos.shares > 0
                ? pos.currentValue / pos.shares
                : pos.avgEntryPrice,
            market: marketName,
            marketSlug: pos.marketSlug,
            side: "BUY",
            pnl: pos.currentValue - pos.avgEntryPrice * pos.shares,
            pnlPercent:
              pos.avgEntryPrice > 0
                ? ((pos.currentValue / pos.shares - pos.avgEntryPrice) /
                    pos.avgEntryPrice) *
                  100
                : 0,
            totalCost: pos.avgEntryPrice * pos.shares,
            openedAt: Date.now(),
            isResolved: pos.isResolved || false,
            isRedeemable: pos.isRedeemable || false,
            settled: false,
            conditionId: pos.conditionId,
            feesPaid: pos.feesPaid || 0,
            image: imageUrl,
          };
        });

        // Filter to show only positions with shares > 0
        const activePositions = positions.filter((p: any) => p.shares > 0);
        return { positions: activePositions };
      }
      // Live mode but no positions - return empty array (do NOT fall through to paper)
      return { positions: [] };
    } catch (e) {
      console.error("Failed to fetch live positions:", e);
      // In live mode, return empty positions instead of falling through to paper
      return { positions: [] };
    }
  }

  // Paper mode: use local state
  const paperState = readJsonFile("paper-state.json", { positions: {} });
  const positionEntries = Object.entries(paperState.positions || {});

  // Collect all market slugs and token IDs to fetch metadata
  const slugs = positionEntries
    .map(([_, pos]: [string, any]) => pos.marketSlug)
    .filter(Boolean);
  const tokenIds = positionEntries
    .map(([tokenId, _]: [string, any]) => tokenId)
    .filter(Boolean);

  // Try to fetch by slug first, then by token ID for any missing
  await fetchMarketMetaBatch(slugs);
  await fetchMarketMetaBatch(tokenIds, true);

  const positions = positionEntries.map(([tokenId, pos]: [string, any]) => {
    const currentPrice = pos.currentPrice || pos.avgEntryPrice;
    const currentValue = pos.shares * currentPrice;
    const entryValue = pos.totalCost || pos.avgEntryPrice * pos.shares;
    const pnl = pos.settled
      ? pos.settlementPnl || 0
      : currentValue - entryValue;
    const pnlPercent = entryValue > 0 ? (pnl / entryValue) * 100 : 0;

    // Get cached market metadata - try slug first, then token ID
    const meta =
      (pos.marketSlug ? marketMetaCache.get(pos.marketSlug) : null) ||
      tokenIdToMetaCache.get(tokenId);

    // Use image from cache or generate from slug
    const imageUrl =
      meta?.image ||
      (pos.marketSlug
        ? `https://polymarket-upload.s3.us-east-2.amazonaws.com/${pos.marketSlug}.png`
        : undefined);

    // Use question/title from cache or stored position data
    const marketName =
      meta?.question ||
      meta?.title ||
      pos.title ||
      pos.question ||
      pos.marketSlug ||
      "Unknown Market";

    return {
      tokenId,
      outcome: pos.outcome || "YES",
      shares: pos.shares || 0,
      avgEntryPrice: pos.avgEntryPrice || 0,
      currentValue,
      currentPrice,
      market: marketName,
      marketSlug: pos.marketSlug,
      side: pos.side || "BUY",
      pnl,
      pnlPercent,
      totalCost: pos.totalCost || 0,
      openedAt: pos.openedAt || Date.now(),
      isResolved: pos.resolved || false,
      isRedeemable: pos.resolved && !pos.settled,
      settled: pos.settled || false,
      settlementPrice: pos.settlementPrice,
      settlementPnl: pos.settlementPnl,
      conditionId: pos.conditionId,
      feesPaid: pos.feesPaid || 0,
      image: imageUrl,
    };
  });

  // Filter to show only positions with shares > 0 or unsettled
  const activePositions = positions.filter((p) => p.shares > 0 || !p.settled);

  return { positions: activePositions };
});

// Get trade history
ipcMain.handle("trades:get", async () => {
  // Determine mode from accounts state
  const accountsState = loadAccountsState();
  const mode = accountsState.activeAccountId ? "live" : "paper";

  // For LIVE mode, fetch real trades from Polymarket
  if (mode === "live") {
    try {
      const liveData = await botService?.getLiveStats();
      if (liveData && liveData.trades) {
        // Collect all token IDs to fetch metadata
        const tokenIds = liveData.trades
          .map((t: any) => t.tokenId)
          .filter(Boolean);
        await fetchMarketMetaBatch(tokenIds, true);

        const trades = liveData.trades.map((t: any, idx: number) => {
          const meta = t.tokenId ? tokenIdToMetaCache.get(t.tokenId) : null;
          const marketName =
            meta?.question || meta?.title || t.market || "Unknown Market";
          const imageUrl = meta?.image || undefined;

          return {
            id: t.id || `trade-${idx}`,
            timestamp: t.timestamp,
            tokenId: t.tokenId,
            marketSlug: t.marketSlug,
            market: marketName,
            outcome: t.outcome,
            side: t.side,
            price: t.price,
            shares: t.shares,
            usdValue: t.usdValue,
            fees: t.fees,
            pnl: t.pnl,
            targetWallet: t.targetWallet,
            tradeId: t.tradeId,
            image: imageUrl,
          };
        });

        // Sort by timestamp descending (newest first)
        trades.sort((a: any, b: any) => b.timestamp - a.timestamp);
        return { trades };
      }
      // Live mode but no trades yet - return empty array (do NOT fall through to paper)
      return { trades: [] };
    } catch (e) {
      console.error("Failed to fetch live trades:", e);
      // In live mode, return empty trades instead of falling through to paper
      return { trades: [] };
    }
  }

  // Paper mode: use local state
  const paperState = readJsonFile("paper-state.json", { trades: [] });
  const rawTrades = paperState.trades || [];

  // Collect all market slugs and token IDs to fetch metadata
  const slugs = rawTrades.map((t: any) => t.marketSlug).filter(Boolean);
  const tokenIds = rawTrades.map((t: any) => t.tokenId).filter(Boolean);

  // Fetch by slug first, then by token ID for missing entries
  await fetchMarketMetaBatch(slugs);
  await fetchMarketMetaBatch(tokenIds, true);

  const trades = rawTrades.map((t: any, idx: number) => {
    // Try to get metadata from slug first, then from token ID
    const meta =
      (t.marketSlug ? marketMetaCache.get(t.marketSlug) : null) ||
      (t.tokenId ? tokenIdToMetaCache.get(t.tokenId) : null);
    const marketName =
      meta?.question || meta?.title || t.marketSlug || "Unknown Market";
    const imageUrl =
      meta?.image ||
      (t.marketSlug
        ? `https://polymarket-upload.s3.us-east-2.amazonaws.com/${t.marketSlug}.png`
        : undefined);

    return {
      id: t.id || `trade-${idx}`,
      timestamp: t.timestamp,
      tokenId: t.tokenId,
      marketSlug: t.marketSlug,
      market: marketName,
      outcome: t.outcome,
      side: t.side,
      price: t.price,
      shares: t.shares,
      usdValue: t.usdValue,
      fees: t.fees,
      pnl: t.pnl,
      targetWallet: t.targetWallet,
      tradeId: t.tradeId,
      image: imageUrl,
    };
  });

  // Sort by timestamp descending (newest first)
  trades.sort((a: any, b: any) => b.timestamp - a.timestamp);

  return { trades };
});

// Get performance stats
ipcMain.handle("performance:get", async () => {
  // Determine mode from accounts state
  const accountsState = loadAccountsState();
  const mode = accountsState.activeAccountId ? "live" : "paper";

  // For LIVE mode, calculate performance from live data
  if (mode === "live") {
    try {
      const liveData = await botService?.getLiveStats();
      if (liveData) {
        const trades = liveData.trades || [];
        const positions = liveData.positions || [];

        // Calculate performance metrics from live data
        const closedTrades = trades.filter((t: any) => t.pnl !== undefined);
        const winningTrades = closedTrades.filter((t: any) => t.pnl > 0);
        const losingTrades = closedTrades.filter((t: any) => t.pnl < 0);

        const totalWins = winningTrades.reduce(
          (sum: number, t: any) => sum + t.pnl,
          0,
        );
        const totalLosses = Math.abs(
          losingTrades.reduce((sum: number, t: any) => sum + t.pnl, 0),
        );

        const avgWin =
          winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
        const avgLoss =
          losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;

        const largestWin =
          winningTrades.length > 0
            ? Math.max(...winningTrades.map((t: any) => t.pnl))
            : 0;
        const largestLoss =
          losingTrades.length > 0
            ? Math.min(...losingTrades.map((t: any) => t.pnl))
            : 0;

        const totalVolume = trades.reduce(
          (sum: number, t: any) => sum + (t.usdValue || 0),
          0,
        );
        const totalFees = trades.reduce(
          (sum: number, t: any) => sum + (t.fees || 0),
          0,
        );

        // Calculate unrealized PnL from positions
        const unrealizedPnl = positions.reduce((sum: number, pos: any) => {
          const currentValue =
            pos.currentValue ||
            pos.shares * (pos.currentPrice || pos.avgEntryPrice);
          const entryValue = pos.avgEntryPrice * pos.shares;
          return sum + (currentValue - entryValue);
        }, 0);

        // Get balance from live data
        const currentBalance = liveData.balance || 0;
        const positionsValue = positions.reduce((sum: number, pos: any) => {
          return (
            sum +
            (pos.currentValue ||
              pos.shares * (pos.currentPrice || pos.avgEntryPrice))
          );
        }, 0);

        // Estimate starting balance (current balance + positions value - unrealized PnL - realized PnL)
        const realizedPnl = totalWins - totalLosses;
        const totalPnl = realizedPnl + unrealizedPnl;
        const startingBalance = currentBalance + positionsValue - totalPnl;
        const returns =
          startingBalance > 0
            ? ((currentBalance + positionsValue - startingBalance) /
                startingBalance) *
              100
            : 0;

        return {
          totalTrades: trades.length,
          winningTrades: winningTrades.length,
          losingTrades: losingTrades.length,
          winRate:
            closedTrades.length > 0
              ? winningTrades.length / closedTrades.length
              : 0,
          totalPnl,
          realizedPnl,
          unrealizedPnl,
          largestWin,
          largestLoss,
          profitFactor:
            totalLosses > 0
              ? totalWins / totalLosses
              : totalWins > 0
                ? Infinity
                : 0,
          avgWin,
          avgLoss,
          avgTradeSize: trades.length > 0 ? totalVolume / trades.length : 0,
          totalVolume,
          totalFees,
          startingBalance,
          currentBalance: currentBalance + positionsValue,
          returns,
        };
      }
      // Live mode but no data yet - return empty performance stats (do NOT fall through to paper)
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnl: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
        largestWin: 0,
        largestLoss: 0,
        profitFactor: 0,
        avgWin: 0,
        avgLoss: 0,
        avgTradeSize: 0,
        totalVolume: 0,
        totalFees: 0,
        startingBalance: 0,
        currentBalance: 0,
        returns: 0,
      };
    } catch (e) {
      console.error("Failed to fetch live performance:", e);
      // In live mode, return empty performance stats instead of falling through to paper
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnl: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
        largestWin: 0,
        largestLoss: 0,
        profitFactor: 0,
        avgWin: 0,
        avgLoss: 0,
        avgTradeSize: 0,
        totalVolume: 0,
        totalFees: 0,
        startingBalance: 0,
        currentBalance: 0,
        returns: 0,
      };
    }
  }

  // Paper mode: use local state
  const paperState = readJsonFile("paper-state.json", {
    trades: [],
    stats: {},
    startingBalance: 10000,
    currentBalance: 10000,
  });

  const trades = paperState.trades || [];
  const stats = paperState.stats || {};

  // Calculate performance metrics
  const closedTrades = trades.filter((t: any) => t.pnl !== undefined);
  const winningTrades = closedTrades.filter((t: any) => t.pnl > 0);
  const losingTrades = closedTrades.filter((t: any) => t.pnl < 0);

  const totalWins = winningTrades.reduce(
    (sum: number, t: any) => sum + t.pnl,
    0,
  );
  const totalLosses = Math.abs(
    losingTrades.reduce((sum: number, t: any) => sum + t.pnl, 0),
  );

  const avgWin =
    winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
  const avgLoss =
    losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;

  const largestWin =
    winningTrades.length > 0
      ? Math.max(...winningTrades.map((t: any) => t.pnl))
      : 0;
  const largestLoss =
    losingTrades.length > 0
      ? Math.min(...losingTrades.map((t: any) => t.pnl))
      : 0;

  const totalVolume = trades.reduce(
    (sum: number, t: any) => sum + (t.usdValue || 0),
    0,
  );
  const totalFees = trades.reduce(
    (sum: number, t: any) => sum + (t.fees || 0),
    0,
  );

  const startingBalance = paperState.startingBalance || 10000;
  const currentBalance = paperState.currentBalance || 10000;
  const returns =
    startingBalance > 0
      ? ((currentBalance - startingBalance) / startingBalance) * 100
      : 0;

  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate:
      closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
    totalPnl: totalWins - totalLosses,
    realizedPnl: stats.totalRealizedPnl || totalWins - totalLosses,
    unrealizedPnl: stats.totalUnrealizedPnl || 0,
    largestWin,
    largestLoss,
    profitFactor:
      totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    avgWin,
    avgLoss,
    avgTradeSize: trades.length > 0 ? totalVolume / trades.length : 0,
    totalVolume,
    totalFees,
    startingBalance,
    currentBalance,
    returns,
  };
});

// Get chart history data (periodic balance snapshots)
ipcMain.handle("chart:getHistory", async () => {
  // Determine mode from accounts state
  const accountsState = loadAccountsState();
  const mode = accountsState.activeAccountId ? "live" : "paper";

  // For LIVE mode, use live-chart-history.json
  if (mode === "live") {
    const chartHistory = readJsonFile("live-chart-history.json", {
      snapshots: [],
    });

    // If no history, try to generate initial point from current data
    if (!chartHistory.snapshots || chartHistory.snapshots.length === 0) {
      try {
        const liveData = await botService?.getLiveStats();
        if (liveData) {
          const positions = liveData.positions || [];
          const balance = liveData.balance || 0;
          const positionsValue = positions.reduce((sum: number, pos: any) => {
            return (
              sum +
              (pos.currentValue ||
                pos.shares * (pos.currentPrice || pos.avgEntryPrice))
            );
          }, 0);

          // Create initial snapshot
          const initialSnapshot = {
            timestamp: Date.now(),
            pnl: 0,
            realizedPnl: 0,
            unrealizedPnl: 0,
            balance: balance + positionsValue,
          };
          return [initialSnapshot];
        }
      } catch (e) {
        console.error("Failed to generate initial live chart point:", e);
      }
    }

    return chartHistory.snapshots || [];
  }

  // Paper mode: use paper chart history
  const chartHistory = readJsonFile("chart-history.json", { snapshots: [] });
  return chartHistory.snapshots || [];
});

// Record a chart snapshot (called periodically by the bot)
ipcMain.handle("chart:recordSnapshot", async () => {
  // Determine mode from accounts state
  const accountsState = loadAccountsState();
  const mode = accountsState.activeAccountId ? "live" : "paper";

  // For LIVE mode, record to live-chart-history.json
  if (mode === "live") {
    try {
      const liveData = await botService?.getLiveStats();
      if (liveData) {
        const positions = liveData.positions || [];
        const trades = liveData.trades || [];
        const balance = liveData.balance || 0;

        // Calculate unrealized PnL from positions
        const unrealizedPnl = positions.reduce((sum: number, pos: any) => {
          const currentValue =
            pos.currentValue ||
            pos.shares * (pos.currentPrice || pos.avgEntryPrice);
          const entryValue = pos.avgEntryPrice * pos.shares;
          return sum + (currentValue - entryValue);
        }, 0);

        // Calculate realized PnL from trades
        const closedTrades = trades.filter((t: any) => t.pnl !== undefined);
        const realizedPnl = closedTrades.reduce(
          (sum: number, t: any) => sum + (t.pnl || 0),
          0,
        );

        const positionsValue = positions.reduce((sum: number, pos: any) => {
          return (
            sum +
            (pos.currentValue ||
              pos.shares * (pos.currentPrice || pos.avgEntryPrice))
          );
        }, 0);

        const totalPnl = realizedPnl + unrealizedPnl;

        const snapshot = {
          timestamp: Date.now(),
          pnl: totalPnl,
          realizedPnl,
          unrealizedPnl,
          balance: balance + positionsValue,
        };

        // Load existing live history
        const chartHistory = readJsonFile("live-chart-history.json", {
          snapshots: [],
        });

        // Add new snapshot (keep last 10080 points = 7 days at 1 min intervals)
        chartHistory.snapshots.push(snapshot);
        if (chartHistory.snapshots.length > 10080) {
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
          const recentSnapshots = chartHistory.snapshots.filter(
            (s: any) => s.timestamp >= oneDayAgo,
          );
          const oldSnapshots = chartHistory.snapshots.filter(
            (s: any) => s.timestamp < oneDayAgo,
          );
          const downsampledOld = oldSnapshots.filter(
            (_: any, i: number) => i % 5 === 0,
          );
          chartHistory.snapshots = [...downsampledOld, ...recentSnapshots];
        }

        writeJsonFile("live-chart-history.json", chartHistory);
        return snapshot;
      }
    } catch (e) {
      console.error("Failed to record live chart snapshot:", e);
      // Fall through to paper
    }
  }

  // Paper mode: use local paper state
  const paperState = readJsonFile("paper-state.json", {
    startingBalance: 10000,
    currentBalance: 10000,
    positions: {},
  });

  // Calculate unrealized PnL
  let unrealizedPnl = 0;
  const positions = paperState.positions || {};
  for (const pos of Object.values(positions) as any[]) {
    if (pos && pos.shares > 0 && pos.currentPrice !== undefined) {
      const currentValue = pos.shares * pos.currentPrice;
      const costBasis = pos.totalCost || pos.avgEntryPrice * pos.shares;
      unrealizedPnl += currentValue - costBasis;
    }
  }

  const realizedPnl = paperState.stats?.totalRealizedPnl || 0;
  const totalPnl = realizedPnl + unrealizedPnl;

  const snapshot = {
    timestamp: Date.now(),
    pnl: totalPnl,
    realizedPnl,
    unrealizedPnl,
    balance: paperState.startingBalance + totalPnl,
  };

  // Load existing history
  const chartHistory = readJsonFile("chart-history.json", { snapshots: [] });

  // Add new snapshot (keep last 10080 points = 7 days at 1 min intervals)
  chartHistory.snapshots.push(snapshot);
  if (chartHistory.snapshots.length > 10080) {
    // Downsample older data: keep every 5th point for data older than 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentSnapshots = chartHistory.snapshots.filter(
      (s: any) => s.timestamp >= oneDayAgo,
    );
    const oldSnapshots = chartHistory.snapshots.filter(
      (s: any) => s.timestamp < oneDayAgo,
    );
    const downsampledOld = oldSnapshots.filter(
      (_: any, i: number) => i % 5 === 0,
    );
    chartHistory.snapshots = [...downsampledOld, ...recentSnapshots];
  }

  writeJsonFile("chart-history.json", chartHistory);
  return snapshot;
});

// Sell a position (supports both paper and live trading)
ipcMain.handle(
  "position:sell",
  async (
    _event,
    tokenId: string,
    requestedShares?: number,
    requestedPrice?: number,
  ) => {
    // Determine mode from accounts state
    const accountsState = loadAccountsState();
    const mode = accountsState.activeAccountId ? "live" : "paper";

    console.log(`[position:sell] Mode: ${mode}, tokenId: ${tokenId}`);

    // ============ LIVE MODE ============
    if (mode === "live") {
      try {
        // Initialize CLOB client if needed
        if (!botService) {
          return { success: false, error: "Bot service not initialized" };
        }

        // Get the CLOB client from botService (access internal clobClient)
        const clobWrapper = (botService as any).clobClient;
        if (!clobWrapper) {
          // Try to initialize it
          try {
            await (botService as any).initializeClobClient();
          } catch (e: any) {
            return {
              success: false,
              error: `Failed to initialize CLOB client: ${e.message}`,
            };
          }
        }

        const clobClient = (botService as any).clobClient;
        if (!clobClient) {
          return {
            success: false,
            error: "CLOB client not available for live trading",
          };
        }

        // Get token balance to determine how many shares we can sell
        let sharesToSell = requestedShares;
        if (!sharesToSell) {
          try {
            const tokenBalance = await clobClient.getTokenBalance(tokenId);
            // Balance is in micro-units (6 decimals), convert to actual shares
            const rawBalance = parseFloat(tokenBalance.balance) || 0;
            sharesToSell = rawBalance / 1_000_000; // Convert from micro-units
            console.log(
              `[position:sell] Token balance (raw): ${rawBalance}, shares: ${sharesToSell}`,
            );
          } catch (e: any) {
            console.error(
              `[position:sell] Failed to get token balance: ${e.message}`,
            );
            sharesToSell = 0;
          }
        }

        if (!sharesToSell || sharesToSell <= 0) {
          return { success: false, error: "No shares to sell" };
        }

        // Determine sell price - use provided price, or get market price
        let sellPrice = requestedPrice;
        if (!sellPrice) {
          // Use a default price (the market bid price would be better but requires additional API call)
          // For now, use 0.50 as a default market price - the order will fill at best available
          sellPrice = 0.5;
        }

        // Apply slippage (sell at 2% below target to ensure fill)
        const slippagePrice = Math.max(0.01, sellPrice * 0.98);

        console.log(
          `[position:sell] Placing SELL order: ${sharesToSell} shares @ $${slippagePrice.toFixed(4)}`,
        );

        // Place sell order
        const orderResult = await clobClient.placeOrder({
          tokenId,
          side: "SELL",
          price: slippagePrice,
          size: sharesToSell,
        });

        if (orderResult.success) {
          console.log(
            `[position:sell] LIVE SELL SUCCESS: orderId=${orderResult.orderId}`,
          );

          // Add log entry
          addLog({
            id: `log-${Date.now()}`,
            timestamp: Date.now(),
            type: "profit",
            side: "SELL",
            marketName: tokenId.substring(0, 20) + "...",
            outcome: "YES",
            shares: sharesToSell,
            price: slippagePrice,
            total: sharesToSell * slippagePrice,
            message: `[LIVE] Sold ${sharesToSell.toFixed(2)} shares @ $${slippagePrice.toFixed(4)}`,
          });

          return {
            success: true,
            orderId: orderResult.orderId,
            shares: sharesToSell,
            price: slippagePrice,
            mode: "live",
          };
        } else {
          console.error(
            `[position:sell] LIVE SELL FAILED: ${orderResult.errorMessage}`,
          );
          return {
            success: false,
            error: orderResult.errorMessage || "Order failed",
          };
        }
      } catch (e: any) {
        console.error(`[position:sell] LIVE SELL ERROR: ${e.message}`);
        return { success: false, error: e.message };
      }
    }

    // ============ PAPER MODE ============
    const paperState = readJsonFile("paper-state.json", {
      positions: {},
      trades: [],
      currentBalance: 10000,
      stats: {},
    });

    const position = paperState.positions[tokenId];
    if (!position || position.shares <= 0) {
      return { success: false, error: "Position not found or no shares" };
    }

    // Simulate selling at current price (with 1% slippage)
    const currentPrice = position.currentPrice || position.avgEntryPrice;
    const sellPrice = currentPrice * 0.99; // 1% slippage
    const shares = position.shares;
    const proceeds = shares * sellPrice;
    const fees = proceeds * 0.001; // 0.1% fee
    const netProceeds = proceeds - fees;

    // Calculate PnL
    const entryValue = position.totalCost || position.avgEntryPrice * shares;
    const pnl = netProceeds - entryValue;

    // Record the sell trade
    const sellTrade = {
      id: `sell-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      tokenId,
      marketSlug: position.marketSlug,
      outcome: position.outcome,
      side: "SELL",
      price: sellPrice,
      shares,
      usdValue: proceeds,
      fees,
      pnl,
      targetWallet: "manual_sell",
      tradeId: `manual-${Date.now()}`,
    };

    paperState.trades.push(sellTrade);

    // Update balance
    paperState.currentBalance =
      (paperState.currentBalance || 10000) + netProceeds;

    // Update stats
    if (!paperState.stats) paperState.stats = {};
    paperState.stats.totalTrades = (paperState.stats.totalTrades || 0) + 1;
    paperState.stats.totalFees = (paperState.stats.totalFees || 0) + fees;
    paperState.stats.totalRealizedPnl =
      (paperState.stats.totalRealizedPnl || 0) + pnl;

    if (pnl > 0) {
      paperState.stats.winningTrades =
        (paperState.stats.winningTrades || 0) + 1;
      paperState.stats.largestWin = Math.max(
        paperState.stats.largestWin || 0,
        pnl,
      );
    } else if (pnl < 0) {
      paperState.stats.losingTrades = (paperState.stats.losingTrades || 0) + 1;
      paperState.stats.largestLoss = Math.min(
        paperState.stats.largestLoss || 0,
        pnl,
      );
    }

    // Close the position
    position.shares = 0;
    position.settled = true;
    position.settlementPnl = pnl;

    // Save state
    writeJsonFile("paper-state.json", paperState);

    // Add log entry
    addLog({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: pnl >= 0 ? "profit" : "loss",
      side: "SELL",
      marketName: position.marketSlug,
      outcome: position.outcome,
      shares,
      price: sellPrice,
      total: netProceeds,
      message: `Sold ${shares.toFixed(2)} shares @ $${sellPrice.toFixed(3)} for ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} PnL`,
    });

    return {
      success: true,
      pnl,
      proceeds: netProceeds,
      trade: sellTrade,
    };
  },
);

// Get activity logs
ipcMain.handle("logs:get", async () => {
  // Read from recent logs if they exist
  const logsDir = path.join(getDataDir(), "logs");
  const recentLogs: any[] = [];

  try {
    if (fs.existsSync(logsDir)) {
      const files = fs.readdirSync(logsDir).filter((f) => f.endsWith(".log"));
      const latestFile = files.sort().reverse()[0];
      if (latestFile) {
        const content = fs.readFileSync(
          path.join(logsDir, latestFile),
          "utf-8",
        );
        const lines = content
          .split("\n")
          .filter((l) => l.trim())
          .slice(-50); // Reduced from 100 to 50
        lines.forEach((line, idx) => {
          try {
            const parsed = JSON.parse(line);
            recentLogs.push({
              id: `log-${idx}`,
              timestamp: parsed.timestamp || Date.now(),
              type:
                parsed.level === "error"
                  ? "error"
                  : parsed.message?.includes("skip")
                    ? "skip"
                    : parsed.message?.includes("copy")
                      ? "copy"
                      : "info",
              message: parsed.message,
              details: parsed.details,
            });
          } catch {
            // Skip non-JSON lines
          }
        });
      }
    }
  } catch (e) {
    console.error("Error reading logs:", e);
  }

  // Combine with in-memory logs (reduced from 200 to 100)
  return { logs: [...logs, ...recentLogs].slice(-100) };
});

// Add log entry
ipcMain.handle("logs:add", async (_event, entry) => {
  addLog({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    ...entry,
  });
  // Keep only last MAX_LOGS in memory
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
  return true;
});

// ========== Polymarket API Proxies (bypass CORS) ==========

// Fetch profile from gamma-api (CORS-free from main process)
// Now with shorter timeout and silent error handling
ipcMain.handle("polymarket:getProfile", async (_event, address: string) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(
      `https://gamma-api.polymarket.com/public-profile?address=${address}`,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    // Silently return null - network errors are expected
    return null;
  }
});

// Batch fetch profiles (more efficient) - with timeout
ipcMain.handle(
  "polymarket:getProfiles",
  async (_event, addresses: string[]) => {
    const results: Record<string, any> = {};

    // Fetch in parallel with rate limiting (max 5 concurrent, shorter timeout)
    const batchSize = 5;
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      const promises = batch.map(async (address) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(
            `https://gamma-api.polymarket.com/public-profile?address=${address}`,
            {
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              signal: controller.signal,
            },
          );
          clearTimeout(timeoutId);

          if (response.ok) {
            results[address.toLowerCase()] = await response.json();
          }
        } catch {
          // Ignore individual errors silently
        }
      });
      await Promise.all(promises);
    }

    return results;
  },
);

// Fetch available tags from gamma-api
ipcMain.handle("polymarket:getTags", async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      "https://gamma-api.polymarket.com/tags?limit=100",
      {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      return [];
    }
    return await response.json();
  } catch {
    return [];
  }
});

// Fetch recent large trades (whale trades) from data-api
// This fetches the most recent trades across all markets, filtered by size
ipcMain.handle(
  "polymarket:getWhaleTrades",
  async (
    _event,
    options: {
      minSize?: number; // Minimum trade size in USD
      limit?: number;
    },
  ) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const minSize = options.minSize || 1000; // Default $1000 minimum
      const limit = Math.min(options.limit || 500, 1000); // Fetch more to filter

      // Fetch recent trades from data-api - it already includes market details
      const url = `https://data-api.polymarket.com/trades?limit=${limit}`;
      console.log("[WhaleTrades] Fetching:", url);

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error("[WhaleTrades] Error:", response.status);
        return [];
      }

      const trades = await response.json();

      // Filter for whale trades and calculate USD size
      // The API returns: size (shares), price (0-1), so usdcSize = size * price
      const whaleTrades = (trades || [])
        .map((t: any) => {
          // Calculate USD value of the trade
          const shares = parseFloat(t.size || "0");
          const price = parseFloat(t.price || "0");
          const usdcSize = shares * price;

          return {
            ...t,
            usdcSize, // Calculated USD value
          };
        })
        .filter((t: any) => t.usdcSize >= minSize)
        .sort((a: any, b: any) => b.usdcSize - a.usdcSize); // Sort by size descending

      console.log(
        `[WhaleTrades] Found ${whaleTrades.length} trades >= $${minSize}`,
      );
      return whaleTrades;
    } catch (e) {
      console.error("[WhaleTrades] Failed:", e);
      return [];
    }
  },
);

// Fetch user profile stats from polymarket.com/api/profile/stats
// Returns: { trades, largestWin, views, joinDate }
ipcMain.handle(
  "polymarket:getProfileStats",
  async (_event, options: { proxyAddress: string; username?: string }) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      let url = `https://polymarket.com/api/profile/stats?proxyAddress=${options.proxyAddress}`;
      if (options.username) {
        url += `&username=${options.username}`;
      }

      console.log("[ProfileStats] Fetching:", url);
      const response = await fetch(url, {
        headers: {
          Accept: "*/*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error("[ProfileStats] Error:", response.status);
        return null;
      }

      return await response.json();
    } catch (e) {
      console.error("[ProfileStats] Failed:", e);
      return null;
    }
  },
);

// Fetch user positions from data-api
// Returns array of positions with detailed info
ipcMain.handle(
  "polymarket:getUserPositions",
  async (
    _event,
    options: {
      address: string;
      sortBy?: string; // CURRENT, INITIAL, PNL
      sortDirection?: string; // ASC, DESC
      limit?: number;
      offset?: number;
    },
  ) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const params = new URLSearchParams();
      params.set("user", options.address);
      params.set("sortBy", options.sortBy || "CURRENT");
      params.set("sortDirection", options.sortDirection || "DESC");
      params.set("sizeThreshold", ".1");
      params.set("limit", String(options.limit || 50));
      if (options.offset) params.set("offset", String(options.offset));

      const url = `https://data-api.polymarket.com/positions?${params.toString()}`;
      console.log("[UserPositions] Fetching:", url);

      const response = await fetch(url, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error("[UserPositions] Error:", response.status);
        return [];
      }

      return await response.json();
    } catch (e) {
      console.error("[UserPositions] Failed:", e);
      return [];
    }
  },
);

// Fetch user activity from data-api
// Returns array of recent activities (trades, redeems, etc.)
ipcMain.handle(
  "polymarket:getUserActivity",
  async (
    _event,
    options: {
      address: string;
      limit?: number;
      offset?: number;
    },
  ) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const url = `https://data-api.polymarket.com/activity?user=${options.address}&limit=${options.limit || 25}&offset=${options.offset || 0}`;
      console.log("[UserActivity] Fetching:", url);

      const response = await fetch(url, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error("[UserActivity] Error:", response.status);
        return [];
      }

      return await response.json();
    } catch (e) {
      console.error("[UserActivity] Failed:", e);
      return [];
    }
  },
);

// Fetch user portfolio value from data-api
// Returns: [{ user, value }]
ipcMain.handle("polymarket:getUserValue", async (_event, address: string) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const url = `https://data-api.polymarket.com/value?user=${address}`;
    console.log("[UserValue] Fetching:", url);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error("[UserValue] Error:", response.status);
      return null;
    }

    const data = await response.json();
    // Returns array, get first item
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch (e) {
    console.error("[UserValue] Failed:", e);
    return null;
  }
});

// Fetch market details by condition ID or slug
ipcMain.handle(
  "polymarket:getMarket",
  async (_event, conditionIdOrSlug: string) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      // Try gamma-api first for market details
      const url = `https://gamma-api.polymarket.com/markets/${conditionIdOrSlug}`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (e) {
      console.error("[GetMarket] Failed:", e);
      return null;
    }
  },
);

// Fetch trades for a user (CORS-free)
ipcMain.handle(
  "polymarket:getTrades",
  async (_event, address: string, limit: number = 500) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s for trades

      const response = await fetch(
        `https://data-api.polymarket.com/trades?user=${address}&limit=${limit}`,
        {
          headers: {
            Accept: "application/json",
          },
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        return [];
      }
      return await response.json();
    } catch {
      return [];
    }
  },
);

// Fetch user P&L history from Polymarket's user-pnl API
// This is the official API for getting accurate historical P&L data
ipcMain.handle(
  "polymarket:getUserPnl",
  async (
    _event,
    options: {
      address: string;
      interval?: string; // "1d", "1w", "1m", "3m", "1y", "all"
      fidelity?: string; // "1h", "1d", etc.
    },
  ) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      // Map our intervals to API intervals
      const intervalMap: Record<string, string> = {
        "1d": "1d",
        "1w": "1w",
        "1m": "1m",
        "3m": "3m",
        "1y": "1y",
        all: "all",
      };

      // Determine fidelity based on interval
      const fidelityMap: Record<string, string> = {
        "1d": "1h",
        "1w": "4h",
        "1m": "1d",
        "3m": "1d",
        "1y": "1w",
        all: "1w",
      };

      const interval = intervalMap[options.interval || "all"] || "all";
      const fidelity = options.fidelity || fidelityMap[interval] || "1d";

      const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${options.address}&interval=${interval}&fidelity=${fidelity}`;
      console.log("[UserPnl] Fetching:", url);

      const response = await fetch(url, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error("[UserPnl] Error:", response.status);
        return null;
      }

      const data = await response.json();
      return data;
    } catch (e) {
      console.error("[UserPnl] Failed:", e);
      return null;
    }
  },
);

// Fetch leaderboard from data-api (CORS-free)
// API: https://data-api.polymarket.com/v1/leaderboard
// Params: category (OVERALL, POLITICS, SPORTS, CRYPTO, CULTURE, etc.)
//         timePeriod (DAY, WEEK, MONTH, ALL)
//         orderBy (PNL, VOL)
//         limit (1-50)
ipcMain.handle(
  "polymarket:getLeaderboard",
  async (
    _event,
    options: {
      category?: string;
      timePeriod?: string;
      orderBy?: string;
      limit?: number;
      offset?: number;
    },
  ) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const params = new URLSearchParams();
      params.set("category", options.category || "OVERALL");
      params.set("timePeriod", options.timePeriod || "ALL");
      params.set("orderBy", options.orderBy || "PNL");
      params.set("limit", String(options.limit || 50));
      if (options.offset) params.set("offset", String(options.offset));

      const url = `https://data-api.polymarket.com/v1/leaderboard?${params.toString()}`;
      console.log("[Leaderboard] Fetching:", url);

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(
          "[Leaderboard] API error:",
          response.status,
          response.statusText,
        );
        return [];
      }

      const data = await response.json();
      console.log(
        `[Leaderboard] Got ${Array.isArray(data) ? data.length : 0} traders for ${options.category}`,
      );
      return data;
    } catch (error: any) {
      if (error?.name === "AbortError") {
        console.error("[Leaderboard] Request timed out");
      } else {
        console.error("[Leaderboard] Failed:", error?.message || error);
      }
      return [];
    }
  },
);

// Search leaderboard traders by name/address
ipcMain.handle(
  "polymarket:searchTraders",
  async (
    _event,
    options: {
      query: string;
      limit?: number;
    },
  ) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      // Search using the gamma API profile endpoint
      const query = encodeURIComponent(options.query || "");
      const url = `https://gamma-api.polymarket.com/users?_limit=${options.limit || 20}&userName_contains=${query}`;
      console.log("[Search] Fetching:", url);

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error("[Search] API error:", response.status);
        return [];
      }

      const data = await response.json();
      console.log(
        `[Search] Got ${Array.isArray(data) ? data.length : 0} results`,
      );
      return data;
    } catch (error: any) {
      console.error("[Search] Failed:", error?.message || error);
      return [];
    }
  },
);

// Fetch user profile with image
ipcMain.handle("polymarket:getUserProfile", async (_event, address: string) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    // Try gamma API first
    const url = `https://gamma-api.polymarket.com/users/${address.toLowerCase()}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        address: data.proxyWallet || address,
        username: data.userName || data.name,
        profileImage:
          data.profileImage || data.avatarUrl || data.profilePicture,
        bio: data.bio,
        xUsername: data.xUsername || data.twitterHandle,
        verified: data.verifiedBadge || data.verified,
      };
    }
    return null;
  } catch (error: any) {
    console.error("[Profile] Failed:", error?.message || error);
    return null;
  }
});

// ========== End Polymarket API Proxies ==========

// Add target wallet
ipcMain.handle("targets:add", async (_event, address: string) => {
  const config = readJsonFile("config.json", { targets: [] });
  const normalizedAddr = address.toLowerCase().trim();
  if (
    !config.targets.map((t: string) => t.toLowerCase()).includes(normalizedAddr)
  ) {
    config.targets.push(normalizedAddr);
    writeJsonFile("config.json", config);
  }
  return config.targets;
});

// Remove target wallet
ipcMain.handle("targets:remove", async (_event, address: string) => {
  const config = readJsonFile("config.json", { targets: [] });
  config.targets = config.targets.filter(
    (t: string) => t.toLowerCase() !== address.toLowerCase(),
  );
  writeJsonFile("config.json", config);
  return config.targets;
});

// Bot control - now uses actual bot service
ipcMain.handle("bot:start", async () => {
  try {
    await botService.start();
    startTime = Date.now();
    addLog({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "info",
      message: "Bot started - connecting to Polymarket...",
    });
    return { running: true };
  } catch (error: any) {
    addLog({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "error",
      message: `Failed to start bot: ${error.message}`,
    });
    return { running: false, error: error.message };
  }
});

ipcMain.handle("bot:stop", async () => {
  try {
    await botService.stop();
    addLog({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "info",
      message: "Bot stopped",
    });
    return { running: false };
  } catch (error: any) {
    return { running: true, error: error.message };
  }
});

ipcMain.handle("bot:status", async () => {
  const stats = botService.getStats();
  return {
    running: botService.isRunning(),
    connected: botService.isConnected(),
    stats,
  };
});

// Restart bot (stop then start)
ipcMain.handle("bot:restart", async () => {
  try {
    await botService.stop();
    // Small delay to ensure clean shutdown
    await new Promise((resolve) => setTimeout(resolve, 500));
    await botService.start();
    startTime = Date.now();
    addLog({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "info",
      message: "Bot restarted with new configuration",
    });
    return { running: true };
  } catch (error: any) {
    addLog({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "error",
      message: `Failed to restart bot: ${error.message}`,
    });
    return { running: false, error: error.message };
  }
});

// Open external link
ipcMain.handle("shell:openExternal", async (_event, url: string) => {
  await shell.openExternal(url);
});

// Check wallet configuration status
ipcMain.handle("wallet:checkConfig", async () => {
  const envFile = getEnvFilePath();
  let configured = false;
  let address: string | null = null;
  let hasApiKey = false;
  let hasPrivateKey = false;

  try {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, "utf-8");

      // Check for private key
      const pkMatch = content.match(/PRIVATE_KEY=([^\n\r]+)/);
      if (
        pkMatch &&
        pkMatch[1].trim() &&
        pkMatch[1].trim() !== "your_private_key_here_without_0x"
      ) {
        hasPrivateKey = true;
        try {
          const { ethers } = await import("ethers");
          let privateKey = pkMatch[1].trim();
          if (!privateKey.startsWith("0x")) {
            privateKey = "0x" + privateKey;
          }
          const wallet = new ethers.Wallet(privateKey);
          address = wallet.address;
        } catch (e) {
          console.error("Error deriving wallet address:", e);
        }
      }

      // Check for API key
      const apiKeyMatch = content.match(/POLY_API_KEY=([^\n\r]+)/);
      if (apiKeyMatch && apiKeyMatch[1].trim()) {
        hasApiKey = true;
      }

      configured = hasPrivateKey && hasApiKey;
    }
  } catch (e) {
    console.error("Error checking wallet config:", e);
  }

  return { configured, address, hasApiKey, hasPrivateKey };
});

// Save wallet configuration
ipcMain.handle(
  "wallet:saveConfig",
  async (
    _event,
    config: {
      privateKey: string;
      polyApiKey: string;
      polyApiSecret: string;
      polyPassphrase: string;
      polyFunderAddress?: string;
    },
  ) => {
    const envFile = getEnvFilePath();
    try {
      let content = "";

      // Read existing content if file exists
      if (fs.existsSync(envFile)) {
        content = fs.readFileSync(envFile, "utf-8");
      }

      // Helper to update or add a key
      const updateEnvKey = (key: string, value: string) => {
        const regex = new RegExp(`^${key}=.*$`, "m");
        if (regex.test(content)) {
          content = content.replace(regex, `${key}=${value}`);
        } else {
          content += `${content.endsWith("\n") || content === "" ? "" : "\n"}${key}=${value}\n`;
        }
      };

      // Update all keys
      if (config.privateKey) {
        // Remove 0x prefix if present for storage
        const pk = config.privateKey.startsWith("0x")
          ? config.privateKey.slice(2)
          : config.privateKey;
        updateEnvKey("PRIVATE_KEY", pk);
      }
      if (config.polyApiKey) {
        updateEnvKey("POLY_API_KEY", config.polyApiKey);
      }
      if (config.polyApiSecret) {
        updateEnvKey("POLY_API_SECRET", config.polyApiSecret);
      }
      if (config.polyPassphrase) {
        updateEnvKey("POLY_PASSPHRASE", config.polyPassphrase);
      }
      if (config.polyFunderAddress) {
        updateEnvKey("POLY_FUNDER_ADDRESS", config.polyFunderAddress);
      }

      // Write the file
      fs.writeFileSync(envFile, content, "utf-8");

      addLog({
        id: `log-${Date.now()}`,
        timestamp: Date.now(),
        type: "info",
        message: "Wallet configuration saved",
      });

      return { success: true };
    } catch (e: any) {
      console.error("Error saving wallet config:", e);
      return { success: false, error: e.message };
    }
  },
);

// Reset paper trading state
ipcMain.handle(
  "paper:reset",
  async (event, params?: { startingBalance?: number }) => {
    const startingBalance = params?.startingBalance ?? 10000;
    const newState = {
      enabled: true,
      startingBalance: startingBalance,
      currentBalance: startingBalance,
      positions: {},
      trades: [],
      stats: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalRealizedPnl: 0,
        totalUnrealizedPnl: 0,
        totalFees: 0,
        largestWin: 0,
        largestLoss: 0,
        winRate: 0,
        profitFactor: 0,
        avgTradeSize: 0,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    writeJsonFile("paper-state.json", newState);
    addLog({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "info",
      message: "Paper trading state reset",
    });
    return { success: true };
  },
);

// ========== Account Management IPC Handlers ==========

interface LiveAccount {
  id: string;
  name: string;
  address: string;
  privateKey: string;
  polyApiKey: string;
  polyApiSecret: string;
  polyPassphrase: string;
  polyFunderAddress?: string;
  createdAt: number;
  lastUsedAt?: number;
}

interface AccountsState {
  activeAccountId: string | null;
  accounts: LiveAccount[];
  hasSeenPaperPopup: boolean;
}

// Helper to load accounts state
function loadAccountsState(): AccountsState {
  const state = readJsonFile("accounts.json", null);
  if (!state) {
    return {
      activeAccountId: null, // null = paper trading mode
      accounts: [],
      hasSeenPaperPopup: false,
    };
  }
  return state;
}

// Helper to save accounts state
function saveAccountsState(state: AccountsState): boolean {
  return writeJsonFile("accounts.json", state);
}

// Helper to derive address from private key
async function deriveAddressFromPrivateKey(
  privateKey: string,
): Promise<string | null> {
  try {
    const { ethers } = await import("ethers");
    let pk = privateKey.trim();
    if (!pk.startsWith("0x")) {
      pk = "0x" + pk;
    }
    const wallet = new ethers.Wallet(pk);
    return wallet.address;
  } catch (e) {
    console.error("Error deriving address from private key:", e);
    return null;
  }
}

// Get all accounts (without sensitive data)
ipcMain.handle("accounts:getAll", async () => {
  const state = loadAccountsState();
  return state.accounts.map((acc) => ({
    id: acc.id,
    name: acc.name,
    address: acc.address,
    isActive: acc.id === state.activeAccountId,
    lastUsedAt: acc.lastUsedAt,
  }));
});

// Get current trading mode info
ipcMain.handle("accounts:getTradingMode", async () => {
  const state = loadAccountsState();
  const paperState = readJsonFile("paper-state.json", {
    currentBalance: 10000,
  });

  // Get the bot's actual trading mode (may differ from accounts state if CLOB init failed)
  const botActualMode = botService?.isRunning() ? botService.getMode() : null;

  if (state.activeAccountId === null) {
    // Paper trading mode
    return {
      mode: "paper",
      botMode: botActualMode || "paper",
      activeAccount: null,
      paperBalance: paperState.currentBalance || 10000,
    };
  }

  // Live trading mode (based on accounts.json)
  const activeAccount = state.accounts.find(
    (acc) => acc.id === state.activeAccountId,
  );
  if (!activeAccount) {
    // Account not found, fall back to paper
    return {
      mode: "paper",
      botMode: botActualMode || "paper",
      activeAccount: null,
      paperBalance: paperState.currentBalance || 10000,
    };
  }

  // Try to get live balance
  let liveBalance: number | undefined;
  try {
    const liveData = await botService?.getLiveStats();
    if (liveData) {
      liveBalance = liveData.balance;
    }
  } catch (e) {
    // Ignore errors
  }

  // If bot is running but in a different mode than expected, report it
  const expectedMode = "live";
  const actualMode = botActualMode || expectedMode;

  return {
    mode: actualMode, // Use bot's actual mode, not the expected mode
    botMode: actualMode,
    activeAccount: {
      id: activeAccount.id,
      name: activeAccount.name,
      address: activeAccount.address,
      isActive: true,
      lastUsedAt: activeAccount.lastUsedAt,
    },
    paperBalance: paperState.currentBalance || 10000,
    liveBalance,
  };
});

// Add a new live account
ipcMain.handle(
  "accounts:add",
  async (
    _event,
    accountData: {
      name: string;
      privateKey: string;
      polyApiKey: string;
      polyApiSecret: string;
      polyPassphrase: string;
      polyFunderAddress?: string;
    },
  ) => {
    try {
      const state = loadAccountsState();

      // Derive address from private key
      const address = await deriveAddressFromPrivateKey(accountData.privateKey);
      if (!address) {
        return { success: false, error: "Invalid private key" };
      }

      // Check if account with this address already exists
      const existingAccount = state.accounts.find(
        (acc) => acc.address.toLowerCase() === address.toLowerCase(),
      );
      if (existingAccount) {
        return {
          success: false,
          error: "Account with this address already exists",
        };
      }

      // Create new account
      const newAccount: LiveAccount = {
        id: `account-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: accountData.name || `Account ${state.accounts.length + 1}`,
        address,
        privateKey: accountData.privateKey.startsWith("0x")
          ? accountData.privateKey.slice(2)
          : accountData.privateKey,
        polyApiKey: accountData.polyApiKey,
        polyApiSecret: accountData.polyApiSecret,
        polyPassphrase: accountData.polyPassphrase,
        polyFunderAddress: accountData.polyFunderAddress,
        createdAt: Date.now(),
      };

      state.accounts.push(newAccount);
      saveAccountsState(state);

      addLog({
        id: `log-${Date.now()}`,
        timestamp: Date.now(),
        type: "info",
        message: `Added live account: ${newAccount.name} (${address.slice(0, 6)}...${address.slice(-4)})`,
      });

      return {
        success: true,
        account: {
          id: newAccount.id,
          name: newAccount.name,
          address: newAccount.address,
          isActive: false,
          lastUsedAt: undefined,
        },
      };
    } catch (e: any) {
      console.error("Error adding account:", e);
      return { success: false, error: e.message };
    }
  },
);

// Remove an account
ipcMain.handle("accounts:remove", async (_event, accountId: string) => {
  try {
    const state = loadAccountsState();

    const accountIndex = state.accounts.findIndex(
      (acc) => acc.id === accountId,
    );
    if (accountIndex === -1) {
      return { success: false, error: "Account not found" };
    }

    const removedAccount = state.accounts[accountIndex];
    state.accounts.splice(accountIndex, 1);

    // If removing active account, switch to paper trading
    if (state.activeAccountId === accountId) {
      state.activeAccountId = null;
      // Update config mode
      const config = readJsonFile("config.json", {});
      config.mode = "paper";
      writeJsonFile("config.json", config);
    }

    saveAccountsState(state);

    addLog({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "info",
      message: `Removed account: ${removedAccount.name}`,
    });

    return { success: true };
  } catch (e: any) {
    console.error("Error removing account:", e);
    return { success: false, error: e.message };
  }
});

// Switch to a different account (or paper trading)
ipcMain.handle("accounts:switch", async (_event, accountId: string | null) => {
  try {
    const state = loadAccountsState();
    const config = readJsonFile("config.json", {});

    if (accountId === null) {
      // Switch to paper trading
      state.activeAccountId = null;
      config.mode = "paper";

      addLog({
        id: `log-${Date.now()}`,
        timestamp: Date.now(),
        type: "info",
        message: "Switched to Paper Trading mode",
      });
    } else {
      // Switch to live account
      const account = state.accounts.find((acc) => acc.id === accountId);
      if (!account) {
        return { success: false, error: "Account not found" };
      }

      state.activeAccountId = accountId;
      account.lastUsedAt = Date.now();
      config.mode = "live";

      // Update .env file with account credentials
      const envFile = getEnvFilePath();
      let content = "";
      if (fs.existsSync(envFile)) {
        content = fs.readFileSync(envFile, "utf-8");
      }

      const updateEnvKey = (key: string, value: string) => {
        const regex = new RegExp(`^${key}=.*$`, "m");
        if (regex.test(content)) {
          content = content.replace(regex, `${key}=${value}`);
        } else {
          content += `${content.endsWith("\n") || content === "" ? "" : "\n"}${key}=${value}\n`;
        }
      };

      updateEnvKey("PRIVATE_KEY", account.privateKey);
      updateEnvKey("POLY_API_KEY", account.polyApiKey);
      updateEnvKey("POLY_API_SECRET", account.polyApiSecret);
      updateEnvKey("POLY_PASSPHRASE", account.polyPassphrase);
      if (account.polyFunderAddress) {
        updateEnvKey("POLY_FUNDER_ADDRESS", account.polyFunderAddress);
      }

      fs.writeFileSync(envFile, content, "utf-8");

      addLog({
        id: `log-${Date.now()}`,
        timestamp: Date.now(),
        type: "info",
        message: `Switched to Live Trading: ${account.name} (${account.address.slice(0, 6)}...${account.address.slice(-4)})`,
      });
    }

    saveAccountsState(state);
    writeJsonFile("config.json", config);

    // Notify bot service to reload if running
    if (botService?.isRunning()) {
      // The bot will need to be restarted to pick up the new credentials
      return {
        success: true,
        needsRestart: true,
        mode: accountId === null ? "paper" : "live",
      };
    }

    return {
      success: true,
      needsRestart: false,
      mode: accountId === null ? "paper" : "live",
    };
  } catch (e: any) {
    console.error("Error switching account:", e);
    return { success: false, error: e.message };
  }
});

// Check if user has seen paper trading popup
ipcMain.handle("accounts:hasSeenPaperPopup", async () => {
  const state = loadAccountsState();
  return state.hasSeenPaperPopup;
});

// Mark paper trading popup as seen
ipcMain.handle("accounts:markPaperPopupSeen", async () => {
  const state = loadAccountsState();
  state.hasSeenPaperPopup = true;
  saveAccountsState(state);
  return { success: true };
});

// Update an existing account
ipcMain.handle(
  "accounts:update",
  async (
    _event,
    accountId: string,
    updates: {
      name?: string;
      privateKey?: string;
      polyApiKey?: string;
      polyApiSecret?: string;
      polyPassphrase?: string;
      polyFunderAddress?: string;
    },
  ) => {
    try {
      const state = loadAccountsState();

      const account = state.accounts.find((acc) => acc.id === accountId);
      if (!account) {
        return { success: false, error: "Account not found" };
      }

      // Update fields
      if (updates.name) account.name = updates.name;
      if (updates.privateKey) {
        account.privateKey = updates.privateKey.startsWith("0x")
          ? updates.privateKey.slice(2)
          : updates.privateKey;
        // Re-derive address
        const address = await deriveAddressFromPrivateKey(updates.privateKey);
        if (address) account.address = address;
      }
      if (updates.polyApiKey) account.polyApiKey = updates.polyApiKey;
      if (updates.polyApiSecret) account.polyApiSecret = updates.polyApiSecret;
      if (updates.polyPassphrase)
        account.polyPassphrase = updates.polyPassphrase;
      if (updates.polyFunderAddress !== undefined) {
        account.polyFunderAddress = updates.polyFunderAddress || undefined;
      }

      saveAccountsState(state);

      // If this is the active account, update .env file too
      if (state.activeAccountId === accountId) {
        const envFile = getEnvFilePath();
        let content = "";
        if (fs.existsSync(envFile)) {
          content = fs.readFileSync(envFile, "utf-8");
        }

        const updateEnvKey = (key: string, value: string) => {
          const regex = new RegExp(`^${key}=.*$`, "m");
          if (regex.test(content)) {
            content = content.replace(regex, `${key}=${value}`);
          } else {
            content += `${content.endsWith("\n") || content === "" ? "" : "\n"}${key}=${value}\n`;
          }
        };

        updateEnvKey("PRIVATE_KEY", account.privateKey);
        updateEnvKey("POLY_API_KEY", account.polyApiKey);
        updateEnvKey("POLY_API_SECRET", account.polyApiSecret);
        updateEnvKey("POLY_PASSPHRASE", account.polyPassphrase);
        if (account.polyFunderAddress) {
          updateEnvKey("POLY_FUNDER_ADDRESS", account.polyFunderAddress);
        }

        fs.writeFileSync(envFile, content, "utf-8");
      }

      return {
        success: true,
        account: {
          id: account.id,
          name: account.name,
          address: account.address,
          isActive: account.id === state.activeAccountId,
          lastUsedAt: account.lastUsedAt,
        },
      };
    } catch (e: any) {
      console.error("Error updating account:", e);
      return { success: false, error: e.message };
    }
  },
);
