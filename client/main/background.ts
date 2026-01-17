import path from "path";
import fs from "fs";
import { app, ipcMain, BrowserWindow, shell } from "electron";
import serve from "electron-serve";
import { createWindow } from "./helpers";
import { getBotService, BotService } from "./botService";

const isProd = process.env.NODE_ENV === "production";

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
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Fetch market metadata from Polymarket Gamma API
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
          marketMetaCache.set(slug, meta);
          return meta;
        }
      }
      return null;
    }

    const market = await response.json();
    const meta: MarketMeta = {
      question: market.question || market.title || slug,
      image: market.image,
      icon: market.icon,
      title: market.title,
      fetchedAt: Date.now(),
    };
    marketMetaCache.set(slug, meta);
    return meta;
  } catch (e) {
    console.error(`Failed to fetch market meta for ${slug}:`, e);
    return null;
  }
}

// Batch fetch market metadata for multiple slugs
async function fetchMarketMetaBatch(slugs: string[]): Promise<void> {
  const uniqueSlugs = Array.from(
    new Set(slugs.filter((s) => s && s !== "unknown")),
  );
  const unfetched = uniqueSlugs.filter((s) => {
    const cached = marketMetaCache.get(s);
    return !cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS;
  });

  // Fetch in parallel with limit
  const batchSize = 5;
  for (let i = 0; i < unfetched.length; i += batchSize) {
    const batch = unfetched.slice(i, i + batchSize);
    await Promise.all(batch.map((s) => fetchMarketMeta(s).catch(() => null)));
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

  if (isProd) {
    await mainWindow.loadURL("app://./home");
  } else {
    const port = process.argv[2];
    await mainWindow.loadURL(`http://localhost:${port}/home`);
    mainWindow.webContents.openDevTools();
  }
})();

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
  return readJsonFile("config.json", {
    trading: {
      sizingMode: "proportional",
      fixedUsdSize: 10,
      fixedSharesSize: 10,
      proportionalMultiplier: 0.01,
      minOrderSize: 1,
      slippage: 0.01,
    },
    risk: {
      maxUsdPerTrade: 1000,
      maxUsdPerMarket: 1e22,
      maxDailyUsdVolume: 1e22,
      doNotTradeMarketsOlderThanSecondsFromResolution: 0,
      marketAllowlist: [],
      marketDenylist: [],
      dryRun: true,
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
  });
});

// Update configuration
ipcMain.handle("config:set", async (_event, newConfig) => {
  return writeJsonFile("config.json", newConfig);
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
    } catch (e) {
      console.error("Failed to fetch live stats:", e);
      // Fall through to paper stats as fallback
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
        const positions = liveData.positions.map((pos: any) => ({
          tokenId: pos.tokenId,
          outcome: pos.outcome || "YES",
          shares: pos.shares || 0,
          avgEntryPrice: pos.avgEntryPrice || 0,
          currentValue: pos.currentValue || 0,
          currentPrice:
            pos.shares > 0 ? pos.currentValue / pos.shares : pos.avgEntryPrice,
          market: pos.market || "Unknown Market",
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
          image: pos.marketSlug
            ? `https://polymarket-upload.s3.us-east-2.amazonaws.com/${pos.marketSlug}.png`
            : undefined,
        }));

        // Filter to show only positions with shares > 0
        const activePositions = positions.filter((p: any) => p.shares > 0);
        return { positions: activePositions };
      }
    } catch (e) {
      console.error("Failed to fetch live positions:", e);
      // Fall through to paper positions
    }
  }

  // Paper mode: use local state
  const paperState = readJsonFile("paper-state.json", { positions: {} });
  const positionEntries = Object.entries(paperState.positions || {});

  // Collect all market slugs and fetch metadata in batch
  const slugs = positionEntries
    .map(([_, pos]: [string, any]) => pos.marketSlug)
    .filter(Boolean);
  await fetchMarketMetaBatch(slugs);

  const positions = positionEntries.map(([tokenId, pos]: [string, any]) => {
    const currentPrice = pos.currentPrice || pos.avgEntryPrice;
    const currentValue = pos.shares * currentPrice;
    const entryValue = pos.totalCost || pos.avgEntryPrice * pos.shares;
    const pnl = pos.settled
      ? pos.settlementPnl || 0
      : currentValue - entryValue;
    const pnlPercent = entryValue > 0 ? (pnl / entryValue) * 100 : 0;

    // Get cached market metadata
    const meta = pos.marketSlug ? marketMetaCache.get(pos.marketSlug) : null;

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
  const paperState = readJsonFile("paper-state.json", { trades: [] });
  const rawTrades = paperState.trades || [];

  // Collect all market slugs and fetch metadata in batch
  const slugs = rawTrades.map((t: any) => t.marketSlug).filter(Boolean);
  await fetchMarketMetaBatch(slugs);

  const trades = rawTrades.map((t: any, idx: number) => {
    const meta = t.marketSlug ? marketMetaCache.get(t.marketSlug) : null;
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
  const chartHistory = readJsonFile("chart-history.json", { snapshots: [] });
  return chartHistory.snapshots || [];
});

// Record a chart snapshot (called periodically by the bot)
ipcMain.handle("chart:recordSnapshot", async () => {
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

// Sell a position (paper trading)
ipcMain.handle("position:sell", async (_event, tokenId: string) => {
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
    paperState.stats.winningTrades = (paperState.stats.winningTrades || 0) + 1;
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
  logs.push({
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
});

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
          .slice(-100);
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

  // Combine with in-memory logs
  return { logs: [...logs, ...recentLogs].slice(-200) };
});

// Add log entry
ipcMain.handle("logs:add", async (_event, entry) => {
  logs.push({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    ...entry,
  });
  // Keep only last 500 logs in memory
  if (logs.length > 500) logs = logs.slice(-500);
  return true;
});

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
    logs.push({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "info",
      message: "Bot started - connecting to Polymarket...",
    });
    return { running: true };
  } catch (error: any) {
    logs.push({
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
    logs.push({
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
    logs.push({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "info",
      message: "Bot restarted with new configuration",
    });
    return { running: true };
  } catch (error: any) {
    logs.push({
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

      logs.push({
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
ipcMain.handle("paper:reset", async () => {
  const newState = {
    enabled: true,
    startingBalance: 10000,
    currentBalance: 10000,
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
  logs.push({
    id: `log-${Date.now()}`,
    timestamp: Date.now(),
    type: "info",
    message: "Paper trading state reset",
  });
  return { success: true };
});

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

  if (state.activeAccountId === null) {
    // Paper trading mode
    return {
      mode: "paper",
      activeAccount: null,
      paperBalance: paperState.currentBalance || 10000,
    };
  }

  // Live trading mode
  const activeAccount = state.accounts.find(
    (acc) => acc.id === state.activeAccountId,
  );
  if (!activeAccount) {
    // Account not found, fall back to paper
    return {
      mode: "paper",
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

  return {
    mode: "live",
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

      logs.push({
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

    logs.push({
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

      logs.push({
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

      logs.push({
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
