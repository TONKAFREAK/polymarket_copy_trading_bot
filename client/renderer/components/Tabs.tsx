import React, { useMemo, useState, useEffect, useCallback } from "react";
import type {
  DashboardStats,
  Position,
  TradeLog,
  TradingConfig,
  TradeRecord,
  PerformanceStats,
} from "../types";

type TabKind = "dashboard" | "portfolio" | "performance" | "settings";

type Tab = {
  id: string;
  title: string;
  kind: TabKind;
  icon: React.ReactNode;
};

interface TabsProps {
  realtimeLogs?: TradeLog[];
  onSettingsSaved?: () => void;
}

const defaultTabs: Tab[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    kind: "dashboard",
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v4A1.5 1.5 0 0 0 2.5 10h6A1.5 1.5 0 0 0 10 8.5v-4A1.5 1.5 0 0 0 8.5 3h-6ZM2.5 11A1.5 1.5 0 0 0 1 12.5v3A1.5 1.5 0 0 0 2.5 17h6A1.5 1.5 0 0 0 10 15.5v-3A1.5 1.5 0 0 0 8.5 11h-6ZM11.5 3A1.5 1.5 0 0 0 10 4.5v3A1.5 1.5 0 0 0 11.5 9h6A1.5 1.5 0 0 0 19 7.5v-3A1.5 1.5 0 0 0 17.5 3h-6ZM11.5 10a1.5 1.5 0 0 0-1.5 1.5v4a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5v-4a1.5 1.5 0 0 0-1.5-1.5h-6Z" />
      </svg>
    ),
  },
  {
    id: "portfolio",
    title: "Portfolio",
    kind: "portfolio",
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M1 4.75C1 3.784 1.784 3 2.75 3h14.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 17.25 17H2.75A1.75 1.75 0 0 1 1 15.25V4.75ZM2.75 4.5a.25.25 0 0 0-.25.25V7.5h15V4.75a.25.25 0 0 0-.25-.25H2.75Zm-.25 4.5v6.25c0 .138.112.25.25.25h14.5a.25.25 0 0 0 .25-.25V9h-15Z" />
      </svg>
    ),
  },
  {
    id: "performance",
    title: "Performance",
    kind: "performance",
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 1.5 1.5h1a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 16.5 2h-1ZM9.5 6A1.5 1.5 0 0 0 8 7.5v9A1.5 1.5 0 0 0 9.5 18h1a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 10.5 6h-1ZM3.5 10A1.5 1.5 0 0 0 2 11.5v5A1.5 1.5 0 0 0 3.5 18h1A1.5 1.5 0 0 0 6 16.5v-5A1.5 1.5 0 0 0 4.5 10h-1Z" />
      </svg>
    ),
  },
  {
    id: "settings",
    title: "Settings",
    kind: "settings",
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 0 1 .804.98v1.361a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.294 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.294A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.03l1.25.834a6.957 6.957 0 0 1 1.416-.587l.294-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
];

export default function Tabs({
  realtimeLogs = [],
  onSettingsSaved,
}: TabsProps) {
  const [activeId, setActiveId] = useState<string>("dashboard");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [logs, setLogs] = useState<TradeLog[]>([]);
  const [config, setConfig] = useState<TradingConfig | null>(null);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [perfStats, setPerfStats] = useState<PerformanceStats | null>(null);

  // Combine realtime logs with persisted logs
  const combinedLogs = useMemo(() => {
    // Realtime logs go first (newest), then persisted logs
    const all = [...realtimeLogs, ...logs];
    // Remove duplicates by id
    const seen = new Set<string>();
    return all.filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
  }, [realtimeLogs, logs]);

  // Fast polling for position prices (every 1 second for active positions)
  useEffect(() => {
    const fetchPositionPrices = async () => {
      try {
        const [statsRes, positionsRes] = await Promise.all([
          window.ipc?.invoke<DashboardStats>("stats:get"),
          window.ipc?.invoke<{ positions: Position[] }>("portfolio:get"),
        ]);
        if (statsRes) setStats(statsRes);
        if (positionsRes?.positions) setPositions(positionsRes.positions);
      } catch (e) {
        console.error("Failed to fetch position prices:", e);
      }
    };

    // Fast poll for positions every 1 second
    const fastInterval = setInterval(fetchPositionPrices, 1000);
    return () => clearInterval(fastInterval);
  }, []);

  // Fetch all data periodically (slower interval for non-critical data)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [logsRes, configRes, tradesRes, perfRes] = await Promise.all([
          window.ipc?.invoke<{ logs: TradeLog[] }>("logs:get"),
          window.ipc?.invoke<TradingConfig>("config:get"),
          window.ipc?.invoke<{ trades: TradeRecord[] }>("trades:get"),
          window.ipc?.invoke<PerformanceStats>("performance:get"),
        ]);
        if (logsRes?.logs) setLogs(logsRes.logs);
        if (configRes) setConfig(configRes);
        if (tradesRes?.trades) setTrades(tradesRes.trades);
        if (perfRes) setPerfStats(perfRes);
      } catch (e) {
        console.error("Failed to fetch data:", e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const active = useMemo(
    () => defaultTabs.find((t) => t.id === activeId),
    [activeId],
  );

  // Callback to refresh data after actions
  const refreshData = useCallback(async () => {
    const [positionsRes, statsRes, perfRes] = await Promise.all([
      window.ipc?.invoke<{ positions: Position[] }>("portfolio:get"),
      window.ipc?.invoke<DashboardStats>("stats:get"),
      window.ipc?.invoke<PerformanceStats>("performance:get"),
    ]);
    if (positionsRes?.positions) setPositions(positionsRes.positions);
    if (statsRes) setStats(statsRes);
    if (perfRes) setPerfStats(perfRes);
  }, []);

  return (
    <div className="flex-1 overflow-hidden h-full">
      <div className="h-full flex flex-col border border-white/[0.06] bg-black/30">
        {/* Tab bar */}
        <div className="flex items-center h-12 bg-white/[0.02] border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center h-full overflow-x-auto scrollbar-slim">
            {defaultTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
                className={`group flex items-center gap-2 h-full px-5 transition-all relative ${
                  tab.id === activeId
                    ? "bg-white/[0.04] border-b-2 border-emerald-500 text-white"
                    : "text-white/50 hover:text-white/80 hover:bg-white/[0.02]"
                }`}
              >
                <span
                  className={
                    tab.id === activeId
                      ? "text-emerald-400"
                      : "text-white/40 group-hover:text-white/60"
                  }
                >
                  {tab.icon}
                </span>
                <span className="text-sm font-medium whitespace-nowrap">
                  {tab.title}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Content - scrollable area */}
        <div
          className="p-4 flex-1 overflow-y-auto min-h-0 @container"
          style={{ maxHeight: "calc(100% - 3rem)" }}
        >
          {active?.kind === "dashboard" && (
            <DashboardView
              stats={stats}
              positions={positions}
              logs={combinedLogs}
            />
          )}
          {active?.kind === "portfolio" && (
            <PortfolioView positions={positions} onSell={refreshData} />
          )}
          {active?.kind === "performance" && (
            <PerformanceView stats={perfStats} trades={trades} />
          )}
          {active?.kind === "settings" && (
            <SettingsView
              config={config}
              onUpdate={setConfig}
              onSettingsSaved={onSettingsSaved}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ========== Dashboard View ==========
function DashboardView({
  stats,
  positions,
  logs,
}: {
  stats: DashboardStats | null;
  positions: Position[];
  logs: TradeLog[];
}) {
  const formatDuration = (ms: number) => {
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${secs % 60}s`;
    return `${secs}s`;
  };

  const formatUsd = (val: number) => {
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(2)}`;
  };

  // Filter active positions (shares > 0)
  const activePositions = positions.filter((p) => p.shares > 0 && !p.settled);

  // Mode badge color and icon
  const getModeDisplay = (mode: string) => {
    switch (mode) {
      case "live":
        return {
          label: "LIVE",
          color: "text-rose-400 bg-rose-500/20 border-rose-500/30",
          icon: "●",
        };
      case "paper":
        return {
          label: "PAPER",
          color: "text-amber-400 bg-amber-500/20 border-amber-500/30",
          icon: "◉",
        };
      case "dry-run":
        return {
          label: "DRY RUN",
          color: "text-cyan-400 bg-cyan-500/20 border-cyan-500/30",
          icon: "○",
        };
      default:
        return {
          label: mode.toUpperCase(),
          color: "text-white/60 bg-white/10 border-white/20",
          icon: "•",
        };
    }
  };

  const modeDisplay = getModeDisplay(stats?.mode ?? "paper");

  return (
    <div className="space-y-4">
      {/* Mode banner */}
      <div
        className={`flex items-center justify-between px-4 py-3 border ${modeDisplay.color} animate-slide-up`}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{modeDisplay.icon}</span>
          <div>
            <span className="font-bold tracking-wide">
              {modeDisplay.label} TRADING
            </span>
            <p className="text-xs opacity-70">
              {stats?.mode === "live"
                ? "Real trades with your wallet"
                : stats?.mode === "paper"
                  ? "Simulated trades with virtual funds"
                  : "Watching only, no trades executed"}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-mono">
            {stats?.targetsCount || 0} targets
          </p>
          <p className="text-xs opacity-70">
            Uptime: {formatDuration(stats?.uptime ?? 0)}
          </p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 @[600px]:grid-cols-4 @[900px]:grid-cols-5 gap-3">
        <StatCard
          label="Balance"
          value={formatUsd(stats?.balance ?? 0)}
          color="text-white"
        />
        <StatCard
          label="Positions Value"
          value={formatUsd(stats?.positionsValue ?? 0)}
          color="text-white"
        />
        <StatCard
          label="Unrealized PnL"
          value={formatUsd(stats?.unrealizedPnl ?? 0)}
          color={
            (stats?.unrealizedPnl ?? 0) >= 0
              ? "text-emerald-400"
              : "text-rose-400"
          }
        />
        <StatCard
          label="Realized PnL"
          value={formatUsd(stats?.realizedPnl ?? 0)}
          color={
            (stats?.realizedPnl ?? 0) >= 0
              ? "text-emerald-400"
              : "text-rose-400"
          }
        />
        <StatCard
          label="Total Trades"
          value={String(stats?.totalTrades ?? 0)}
          color="text-white"
        />
        <StatCard
          label="Win Rate"
          value={`${((stats?.winRate ?? 0) * 100).toFixed(1)}%`}
          color={
            (stats?.winRate ?? 0) >= 0.5 ? "text-emerald-400" : "text-amber-400"
          }
        />
        <StatCard
          label="Open Positions"
          value={String(activePositions.length)}
          color="text-white"
        />
        <StatCard
          label="Fees Paid"
          value={formatUsd(stats?.totalFees ?? 0)}
          color="text-white/60"
        />
      </div>

      {/* Two column layout: Holdings + Activity Log */}
      <div className="grid grid-cols-1 @[900px]:grid-cols-2 gap-4">
        {/* Positions/Holdings */}
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Holdings</p>
            <span className="text-sm text-white/40">
              {activePositions.length} positions
            </span>
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[400px] overflow-y-auto">
            {activePositions.length === 0 ? (
              <div className="px-5 py-8 text-center text-white/40">
                No open positions
              </div>
            ) : (
              activePositions
                .slice(0, 10)
                .map((pos, idx) => (
                  <HoldingRow key={idx} position={pos} compact />
                ))
            )}
            {activePositions.length > 10 && (
              <div className="px-5 py-3 text-center text-white/40 text-sm">
                +{activePositions.length - 10} more positions
              </div>
            )}
          </div>
        </div>

        {/* Activity Log - show copy and skip trades with details */}
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Activity Log</p>
            <span className="text-sm text-white/40">
              {
                logs.filter(
                  (l) =>
                    (l.type === "copy" || l.type === "skip") &&
                    l.targetShares !== undefined,
                ).length
              }{" "}
              trades
            </span>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {logs.filter(
              (l) =>
                (l.type === "copy" || l.type === "skip") &&
                l.targetShares !== undefined,
            ).length === 0 ? (
              <div className="px-5 py-8 text-center text-white/40">
                No trades yet
              </div>
            ) : (
              logs
                .filter(
                  (l) =>
                    (l.type === "copy" || l.type === "skip") &&
                    l.targetShares !== undefined,
                )
                .map((log) => <LogRow key={log.id} log={log} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${color}`}>{value}</span>
    </div>
  );
}

function HoldingRow({
  position,
  compact = false,
}: {
  position: Position;
  compact?: boolean;
}) {
  const isUp = position.pnl >= 0;
  const pnlColor = isUp ? "text-emerald-400" : "text-rose-400";
  // Outcome badge color based on PnL (up = green, down = red)
  const outcomeColor = isUp
    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
    : "bg-rose-500/20 text-rose-400 border border-rose-500/30";

  // Use the market name as-is if it looks like a proper question, otherwise format the slug
  const displayMarket =
    position.market && position.market.includes("?")
      ? position.market
      : formatMarketName(position.market || position.marketSlug);

  // Use provided image URL or generate from market slug
  const imageUrl =
    position.image ||
    (position.marketSlug
      ? `https://polymarket-upload.s3.us-east-2.amazonaws.com/${position.marketSlug}.png`
      : null);

  return (
    <div
      className={`group relative flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors overflow-hidden border-b border-white/[0.04] last:border-0 ${
        compact ? "" : "gap-4"
      }`}
    >
      {/* Background image - less zoomed, with gradient edges */}
      {imageUrl && (
        <div
          className="absolute inset-0 opacity-[0.2] saturate-50"
          style={{
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: "40% auto",
            backgroundPosition: "left center",
            backgroundRepeat: "no-repeat",
          }}
        />
      )}
      {/* Left edge gradient to blend image */}
      <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-black/80 to-transparent" />
      {/* Right gradient overlay - fading to black */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/60 to-black/95" />
      {/* Inner shadow for depth */}
      <div className="absolute inset-0 shadow-[inset_0_1px_4px_rgba(0,0,0,0.4)]" />

      <div className="relative flex-1 min-w-0">
        <p className="text-white/90 truncate text-sm font-medium">
          {displayMarket}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs px-1.5 py-0.5 rounded ${outcomeColor}`}>
            {position.outcome}
          </span>
          <span className="text-xs text-white/40">
            {position.shares.toFixed(2)} shares
          </span>
        </div>
      </div>
      <div className="relative text-right">
        <p className={`text-sm font-mono font-semibold ${pnlColor}`}>
          {position.pnl >= 0 ? "+" : ""}${position.pnl.toFixed(2)}
        </p>
        <p className="text-xs text-white/40">
          $
          {position.currentPrice?.toFixed(3) ??
            position.avgEntryPrice.toFixed(3)}
        </p>
      </div>
    </div>
  );
}

/**
 * Format market slug to human-readable title
 * Examples:
 * - "eth-updown-15m-1768544100" -> "ETH Updown 15m"
 * - "btc-updown-1h-1768032000" -> "BTC Updown 1h"
 * - "will-trump-win" -> "Will Trump Win?"
 * - "bitcoin-up-or-down-january-16-12am-et" -> "Bitcoin Up or Down? (Jan 16 12AM ET)"
 */
function formatMarketName(slug?: string): string {
  if (!slug) return "Unknown Market";

  // Remove trailing timestamp (10-digit Unix timestamp)
  let cleaned = slug.replace(/-\d{10}$/, "");

  // Split by dashes
  const parts = cleaned.split("-");

  // Common abbreviations that should stay uppercase
  const upperCaseWords = new Set([
    "btc",
    "eth",
    "sol",
    "bnb",
    "xrp",
    "ada",
    "dot",
    "doge",
    "usdc",
    "usdt",
    "nft",
    "api",
    "ai",
    "usa",
    "uk",
    "eu",
  ]);
  const timezones = new Set([
    "et",
    "pt",
    "ct",
    "mt",
    "utc",
    "gmt",
    "est",
    "pst",
    "cst",
    "mst",
  ]);
  const months = new Map([
    ["january", "Jan"],
    ["february", "Feb"],
    ["march", "Mar"],
    ["april", "Apr"],
    ["may", "May"],
    ["june", "Jun"],
    ["july", "Jul"],
    ["august", "Aug"],
    ["september", "Sep"],
    ["october", "Oct"],
    ["november", "Nov"],
    ["december", "Dec"],
  ]);

  // Detect if this is a prediction/up-or-down market
  const isUpDown = cleaned.includes("up-or-down") || cleaned.includes("updown");

  // Format each part
  const formatted: string[] = [];
  let hasDate = false;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lower = part.toLowerCase();

    // Skip "or" and "down" in "up-or-down" - we'll handle it specially
    if (isUpDown && (lower === "or" || lower === "down")) continue;
    if (isUpDown && lower === "up") {
      formatted.push("Up or Down?");
      continue;
    }

    // Crypto abbreviations
    if (upperCaseWords.has(lower)) {
      formatted.push(part.toUpperCase());
      continue;
    }

    // Timezones - uppercase
    if (timezones.has(lower)) {
      formatted.push(part.toUpperCase());
      continue;
    }

    // Month abbreviations
    if (months.has(lower)) {
      formatted.push(months.get(lower)!);
      hasDate = true;
      continue;
    }

    // Time formats like "12am", "5pm" - uppercase
    if (/^\d{1,2}(am|pm)$/i.test(part)) {
      formatted.push(part.toUpperCase());
      hasDate = true;
      continue;
    }

    // Day numbers (1-31)
    if (/^\d{1,2}$/.test(part) && parseInt(part) <= 31) {
      formatted.push(part);
      hasDate = true;
      continue;
    }

    // Time intervals like "1h", "15m"
    if (/^\d+[hm]$/.test(part)) {
      formatted.push(part);
      continue;
    }

    // Regular words - capitalize first letter
    formatted.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  }

  // If it looks like a prediction with a date, format nicely
  let result = formatted.join(" ");

  // For date-based markets, wrap date part in parentheses
  if (hasDate && isUpDown) {
    // Find where the date portion starts (month or number after question mark)
    const questionIdx = result.indexOf("?");
    if (questionIdx > -1) {
      const beforeQ = result.slice(0, questionIdx + 1);
      const afterQ = result.slice(questionIdx + 1).trim();
      if (afterQ) {
        result = `${beforeQ} (${afterQ})`;
      }
    }
  }

  return result;
}

/**
 * Performance Chart Component - SVG-based line chart for cumulative P&L with smooth transitions
 */
function PerformanceChart({
  data,
  startingBalance,
}: {
  data: { timestamp: number; pnl: number; balance: number }[];
  startingBalance: number;
}) {
  const [hoverData, setHoverData] = useState<{
    x: number;
    y: number;
    pnl: number;
    balance: number;
    timestamp: number;
  } | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);

  if (!data.length || data.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-white/40 text-sm">
        <div className="text-center">
          <svg
            className="w-10 h-10 mx-auto mb-2 text-white/20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
            />
          </svg>
          Not enough data for chart
        </div>
      </div>
    );
  }

  const width = 600;
  const height = 180;
  const padding = { top: 20, right: 60, bottom: 30, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate min/max for scaling with padding
  const pnlValues = data.map((d) => d.pnl);
  const minPnl = Math.min(...pnlValues, 0);
  const maxPnl = Math.max(...pnlValues, 0);
  const rangePadding = (maxPnl - minPnl) * 0.1 || 10;
  const range = maxPnl - minPnl + rangePadding * 2 || 1;
  const adjustedMin = minPnl - rangePadding;

  const minTime = data[0].timestamp;
  const maxTime = data[data.length - 1].timestamp;
  const timeRange = maxTime - minTime || 1;

  // Scale functions
  const scaleX = (ts: number) =>
    padding.left + ((ts - minTime) / timeRange) * chartWidth;
  const scaleY = (pnl: number) =>
    padding.top + chartHeight - ((pnl - adjustedMin) / range) * chartHeight;

  // Build smooth path using cubic bezier curves
  const buildSmoothPath = (points: typeof data) => {
    if (points.length < 2) return "";

    let path = `M ${scaleX(points[0].timestamp)} ${scaleY(points[0].pnl)}`;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const x1 = scaleX(prev.timestamp);
      const y1 = scaleY(prev.pnl);
      const x2 = scaleX(curr.timestamp);
      const y2 = scaleY(curr.pnl);

      // Control point offset for smooth curves
      const cpOffset = (x2 - x1) * 0.3;
      path += ` C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
    }

    return path;
  };

  const linePath = buildSmoothPath(data);

  // Build gradient fill path
  const areaPath = `${linePath} L ${scaleX(maxTime)} ${scaleY(adjustedMin)} L ${scaleX(minTime)} ${scaleY(adjustedMin)} Z`;

  // Zero line position
  const zeroY = scaleY(0);

  // Determine if overall positive or negative
  const finalPnl = data[data.length - 1]?.pnl || 0;
  const lineColor = finalPnl >= 0 ? "#10b981" : "#f43f5e";
  const glowColor = finalPnl >= 0 ? "#10b98140" : "#f43f5e40";
  const fillColor = finalPnl >= 0 ? "url(#greenGradient)" : "url(#redGradient)";

  // Format Y axis labels
  const formatPnl = (val: number) => {
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(0)}`;
  };

  // Y axis ticks
  const yTicks = [
    minPnl,
    minPnl + (maxPnl - minPnl) * 0.25,
    minPnl + (maxPnl - minPnl) * 0.5,
    minPnl + (maxPnl - minPnl) * 0.75,
    maxPnl,
  ];

  // Handle mouse move for tooltip
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !data.length) return;

    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const scaleRatio = width / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleRatio;

    // Check if mouse is in chart area
    if (mouseX < padding.left || mouseX > width - padding.right) {
      setHoverData(null);
      return;
    }

    // Find closest data point
    const timestamp =
      minTime + ((mouseX - padding.left) / chartWidth) * timeRange;
    let closest = data[0];
    let minDist = Math.abs(data[0].timestamp - timestamp);

    for (const point of data) {
      const dist = Math.abs(point.timestamp - timestamp);
      if (dist < minDist) {
        minDist = dist;
        closest = point;
      }
    }

    setHoverData({
      x: scaleX(closest.timestamp),
      y: scaleY(closest.pnl),
      pnl: closest.pnl,
      balance: closest.balance,
      timestamp: closest.timestamp,
    });
  };

  const handleMouseLeave = () => {
    setHoverData(null);
  };

  // Format tooltip time
  const formatTooltipTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-48 cursor-crosshair"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <defs>
        <linearGradient id="greenGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="redGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.4" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Grid lines */}
      {yTicks.map((tick, i) => (
        <line
          key={i}
          x1={padding.left}
          y1={scaleY(tick)}
          x2={width - padding.right}
          y2={scaleY(tick)}
          stroke="rgba(255,255,255,0.06)"
          strokeDasharray="4,4"
        />
      ))}

      {/* Zero line */}
      <line
        x1={padding.left}
        y1={zeroY}
        x2={width - padding.right}
        y2={zeroY}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1"
      />

      {/* Area fill with smooth transition */}
      <path
        d={areaPath}
        fill={fillColor}
        style={{ transition: "d 0.3s ease-out" }}
      />

      {/* Glow effect line */}
      <path
        d={linePath}
        fill="none"
        stroke={glowColor}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: "d 0.3s ease-out" }}
      />

      {/* Main line with smooth transition */}
      <path
        d={linePath}
        fill="none"
        stroke={lineColor}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: "d 0.3s ease-out" }}
      />

      {/* Only show last point (live indicator) with pulse effect */}
      {data.length > 0 && (
        <g>
          <circle
            cx={scaleX(data[data.length - 1].timestamp)}
            cy={scaleY(data[data.length - 1].pnl)}
            r="6"
            fill={lineColor}
            opacity="0.3"
            style={{ transition: "cx 0.3s ease-out, cy 0.3s ease-out" }}
          >
            <animate
              attributeName="r"
              values="4;8;4"
              dur="2s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.3;0.1;0.3"
              dur="2s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            cx={scaleX(data[data.length - 1].timestamp)}
            cy={scaleY(data[data.length - 1].pnl)}
            r="4"
            fill={lineColor}
            style={{ transition: "cx 0.3s ease-out, cy 0.3s ease-out" }}
          />
        </g>
      )}

      {/* Y axis labels */}
      {yTicks.map((tick, i) => (
        <text
          key={i}
          x={padding.left - 8}
          y={scaleY(tick)}
          textAnchor="end"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.4)"
          fontSize="10"
        >
          {formatPnl(tick)}
        </text>
      ))}

      {/* X axis labels */}
      <text
        x={padding.left}
        y={height - 8}
        textAnchor="start"
        fill="rgba(255,255,255,0.4)"
        fontSize="10"
      >
        {new Date(minTime).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
      </text>
      <text
        x={width - padding.right}
        y={height - 8}
        textAnchor="end"
        fill="rgba(255,255,255,0.4)"
        fontSize="10"
      >
        Now
      </text>

      {/* Current value label with background */}
      <rect
        x={scaleX(maxTime) + 4}
        y={scaleY(finalPnl) - 10}
        width="50"
        height="20"
        fill="rgba(0,0,0,0.6)"
        rx="4"
        style={{ transition: "y 0.3s ease-out" }}
      />
      <text
        x={scaleX(maxTime) + 8}
        y={scaleY(finalPnl)}
        dominantBaseline="middle"
        fill={lineColor}
        fontSize="11"
        fontWeight="600"
        style={{ transition: "y 0.3s ease-out" }}
      >
        {finalPnl >= 0 ? "+" : ""}
        {formatPnl(finalPnl)}
      </text>

      {/* Hover tooltip and crosshair */}
      {hoverData && (
        <g>
          {/* Vertical line */}
          <line
            x1={hoverData.x}
            y1={padding.top}
            x2={hoverData.x}
            y2={height - padding.bottom}
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="1"
            strokeDasharray="3,3"
          />
          {/* Hover point */}
          <circle
            cx={hoverData.x}
            cy={hoverData.y}
            r="5"
            fill={hoverData.pnl >= 0 ? "#10b981" : "#f43f5e"}
            stroke="rgba(255,255,255,0.8)"
            strokeWidth="2"
          />
          {/* Tooltip background */}
          <rect
            x={Math.min(hoverData.x - 45, width - padding.right - 95)}
            y={Math.max(hoverData.y - 50, padding.top)}
            width="90"
            height="42"
            fill="rgba(0,0,0,0.85)"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="1"
            rx="4"
          />
          {/* Tooltip PnL */}
          <text
            x={Math.min(hoverData.x, width - padding.right - 50)}
            y={Math.max(hoverData.y - 32, padding.top + 18)}
            textAnchor="middle"
            fill={hoverData.pnl >= 0 ? "#10b981" : "#f43f5e"}
            fontSize="12"
            fontWeight="600"
          >
            {hoverData.pnl >= 0 ? "+" : ""}${hoverData.pnl.toFixed(2)}
          </text>
          {/* Tooltip Time */}
          <text
            x={Math.min(hoverData.x, width - padding.right - 50)}
            y={Math.max(hoverData.y - 16, padding.top + 34)}
            textAnchor="middle"
            fill="rgba(255,255,255,0.6)"
            fontSize="10"
          >
            {formatTooltipTime(hoverData.timestamp)}
          </text>
        </g>
      )}
    </svg>
  );
}

function LogRow({ log }: { log: TradeLog }) {
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatLatency = (ms: number) => {
    if (!ms || ms <= 0 || ms > 60000) return null; // Invalid or too large
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Display market name: prefer formatted title over raw slug
  const displayMarketName = log.marketName
    ? formatMarketName(log.marketName)
    : undefined;

  // Border color based on side (BUY = green, SELL = red), type, or activity type
  const getBorderClass = (
    side?: "BUY" | "SELL",
    activityType?: string,
    logType?: string,
  ) => {
    if (logType === "skip") return "border-l-2 border-l-amber-500";
    if (logType === "error") return "border-l-2 border-l-rose-500";
    if (activityType === "REDEEM") return "border-l-2 border-l-violet-500";
    if (activityType === "MERGE") return "border-l-2 border-l-cyan-500";
    if (activityType === "SPLIT") return "border-l-2 border-l-amber-500";
    if (side === "BUY") return "border-l-2 border-l-emerald-500";
    if (side === "SELL") return "border-l-2 border-l-rose-500";
    return "border-l-2 border-l-white/20";
  };

  const getSideColor = (side?: "BUY" | "SELL") => {
    if (side === "BUY") return "text-emerald-400";
    if (side === "SELL") return "text-rose-400";
    return "text-white/60";
  };

  const isNew = log.isNew;
  const animClass = isNew
    ? log.type === "copy"
      ? "animate-flash-success"
      : log.type === "error"
        ? "animate-flash-error"
        : log.type === "skip"
          ? "animate-flash-error"
          : ""
    : "";
  const borderClass = getBorderClass(log.side, log.activityType, log.type);

  // Check if this is a trade entry (has price/shares info)
  const hasTradeDetails =
    log.targetShares !== undefined || log.yourShares !== undefined;

  if (hasTradeDetails) {
    const latencyDisplay = formatLatency(log.latencyMs ?? 0);

    // Combined format showing target + our copy in one entry
    return (
      <div
        className={`px-3 py-2 hover:bg-white/[0.02] transition-colors ${borderClass} ${animClass} text-xs font-mono`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {/* Time */}
          <span className="text-white/40 flex-shrink-0">
            {formatTime(log.timestamp)}
          </span>

          {/* Side */}
          <span className={`font-bold ${getSideColor(log.side)}`}>
            {log.side || log.activityType || "TRADE"}
          </span>

          {/* Outcome */}
          {log.outcome && (
            <span
              className={
                log.outcome === "YES" ? "text-emerald-400" : "text-rose-400"
              }
            >
              {log.outcome}
            </span>
          )}

          {/* Target info */}
          <span className="text-amber-400">TGT:</span>
          <span className="text-white/70">
            {(log.targetShares ?? 0).toFixed(1)} @ $
            {(log.targetPrice ?? 0).toFixed(3)} → $
            {(log.targetTotal ?? 0).toFixed(2)}
          </span>

          {/* Result */}
          {log.type === "copy" ? (
            <>
              <span className="text-emerald-400">→ COPIED</span>
              <span className="text-white/70">
                {(log.yourShares ?? 0).toFixed(1)} @ $
                {(log.yourPrice ?? 0).toFixed(3)} → $
                {(log.yourTotal ?? 0).toFixed(2)}
              </span>
            </>
          ) : log.type === "skip" ? (
            <span className="text-amber-400">
              → SKIP: {log.copyError || log.message || "filtered"}
            </span>
          ) : log.type === "target" ? (
            <span className="text-cyan-400">→ DETECTED</span>
          ) : log.type === "error" ? (
            <span className="text-rose-400">
              → ERR: {log.copyError || log.message}
            </span>
          ) : null}

          {/* Latency */}
          {latencyDisplay && (
            <span className="text-rose-400/70">{latencyDisplay}</span>
          )}
        </div>

        {/* Market name on new line */}
        {displayMarketName && (
          <div className="text-violet-400/70 mt-1 truncate">
            {displayMarketName}
          </div>
        )}
      </div>
    );
  }

  // Simple log format for non-trade entries (error without details)
  return (
    <div
      className={`px-3 py-2 hover:bg-white/[0.02] transition-colors ${borderClass} ${animClass} text-xs font-mono`}
    >
      <div className="flex items-center gap-2">
        <span className="text-white/40 flex-shrink-0">
          {formatTime(log.timestamp)}
        </span>
        <span
          className={
            log.type === "copy"
              ? "text-emerald-400"
              : log.type === "error"
                ? "text-rose-400"
                : log.type === "skip"
                  ? "text-amber-400"
                  : log.type === "target"
                    ? "text-cyan-400"
                    : "text-white/40"
          }
        >
          {log.type.toUpperCase()}
        </span>
        {log.side && <span className={getSideColor(log.side)}>{log.side}</span>}
        {log.outcome && (
          <span
            className={
              log.outcome === "YES" ? "text-emerald-400" : "text-rose-400"
            }
          >
            {log.outcome}
          </span>
        )}
        {log.message && (
          <span className="text-white/60 truncate">{log.message}</span>
        )}
        {displayMarketName && !log.message && (
          <span className="text-violet-400/70">{displayMarketName}</span>
        )}
      </div>
    </div>
  );
}

// ========== Portfolio View ==========
function PortfolioView({
  positions,
  onSell,
}: {
  positions: Position[];
  onSell: () => void;
}) {
  const [selling, setSelling] = useState<string | null>(null);

  const activePositions = positions.filter((p) => p.shares > 0 && !p.settled);
  const closedPositions = positions.filter((p) => p.shares === 0 || p.settled);

  const totalValue = activePositions.reduce(
    (sum, p) => sum + p.currentValue,
    0,
  );
  const totalPnl = activePositions.reduce((sum, p) => sum + p.pnl, 0);
  const totalCost = activePositions.reduce((sum, p) => sum + p.totalCost, 0);

  const handleSell = async (tokenId: string) => {
    if (selling) return;
    setSelling(tokenId);
    try {
      const result = await window.ipc?.invoke<{
        success: boolean;
        pnl?: number;
        error?: string;
      }>("position:sell", tokenId);
      if (result?.success) {
        onSell();
      } else {
        console.error("Sell failed:", result?.error);
      }
    } catch (e) {
      console.error("Sell error:", e);
    } finally {
      setSelling(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Portfolio summary */}
      <div className="grid grid-cols-2 @[600px]:grid-cols-4 gap-3">
        <StatCard
          label="Open Positions"
          value={String(activePositions.length)}
          color="text-white"
        />
        <StatCard
          label="Total Value"
          value={`$${totalValue.toFixed(2)}`}
          color="text-white"
        />
        <StatCard
          label="Total Cost"
          value={`$${totalCost.toFixed(2)}`}
          color="text-white/60"
        />
        <StatCard
          label="Total PnL"
          value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
          color={totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
      </div>

      {/* Active positions table */}
      <div className="panel">
        <div className="panel-header">
          <p className="panel-title">Open Positions</p>
          <span className="text-sm text-white/40">
            {activePositions.length} active
          </span>
        </div>
        {activePositions.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <svg
              className="w-12 h-12 mx-auto text-white/20 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
            <p className="text-white/40">No open positions</p>
            <p className="text-white/30 text-sm mt-1">
              Positions will appear here when the bot copies trades
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {activePositions.map((pos, idx) => (
              <PositionRowWithSell
                key={idx}
                position={pos}
                onSell={handleSell}
                selling={selling === pos.tokenId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Closed positions */}
      {closedPositions.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Closed Positions</p>
            <span className="text-sm text-white/40">
              {closedPositions.length} closed
            </span>
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[300px] overflow-y-auto">
            {closedPositions.slice(0, 20).map((pos, idx) => (
              <ClosedPositionRow key={idx} position={pos} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PositionRowWithSell({
  position,
  onSell,
  selling,
}: {
  position: Position;
  onSell: (tokenId: string) => void;
  selling: boolean;
}) {
  const isUp = position.pnl >= 0;
  const pnlColor = isUp ? "text-emerald-400" : "text-rose-400";
  // Outcome badge color based on PnL (up = green, down = red)
  const outcomeColor = isUp
    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
    : "bg-rose-500/20 text-rose-400 border border-rose-500/30";
  // Border accent based on PnL
  const borderAccent = isUp
    ? "border-l-4 border-l-emerald-500"
    : "border-l-4 border-l-rose-500";

  // Use the market name as-is if it looks like a proper question, otherwise format the slug
  const displayMarket =
    position.market && position.market.includes("?")
      ? position.market
      : formatMarketName(position.market || position.marketSlug);

  // Use provided image URL or generate from market slug
  const imageUrl =
    position.image ||
    (position.marketSlug
      ? `https://polymarket-upload.s3.us-east-2.amazonaws.com/${position.marketSlug}.png`
      : null);

  return (
    <div
      className={`group relative flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] transition-colors overflow-hidden border-b border-white/[0.04] last:border-0 ${borderAccent}`}
    >
      {/* Background image - positioned left, brighter opacity */}
      {imageUrl && (
        <div
          className="absolute inset-0 bg-cover bg-left opacity-[0.25] saturate-75"
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
      )}
      {/* Gradient overlay - transparent on left, fading to black on right */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/70 to-black/95" />
      {/* Inner shadow for depth */}
      <div className="absolute inset-0 shadow-[inset_0_2px_8px_rgba(0,0,0,0.5)]" />

      {/* Content */}
      <div className="relative flex-1 min-w-0">
        <p className="text-white/90 truncate font-medium">{displayMarket}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs px-1.5 py-0.5 rounded ${outcomeColor}`}>
            {position.outcome}
          </span>
          <span className="text-xs text-white/40">
            {position.shares.toFixed(2)} shares
          </span>
          <span className="text-xs text-white/30">
            @ ${position.avgEntryPrice.toFixed(3)}
          </span>
        </div>
      </div>
      <div className="relative flex items-center gap-6 text-right">
        <div>
          <p className="text-xs text-white/40">Value</p>
          <p className="text-sm font-mono text-white/80">
            ${position.currentValue.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/40">PnL</p>
          <p className={`text-sm font-mono font-semibold ${pnlColor}`}>
            {position.pnl >= 0 ? "+" : ""}${position.pnl.toFixed(2)}
          </p>
        </div>
        <button
          onClick={() => onSell(position.tokenId)}
          disabled={selling}
          className={`px-4 py-2 text-sm font-medium rounded transition-all ${
            selling
              ? "bg-white/10 text-white/40 cursor-not-allowed"
              : "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 active:bg-rose-500/40"
          }`}
        >
          {selling ? (
            <span className="flex items-center gap-2">
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Selling...
            </span>
          ) : (
            "Sell"
          )}
        </button>
      </div>
    </div>
  );
}

function ClosedPositionRow({ position }: { position: Position }) {
  const pnl = position.settlementPnl ?? position.pnl;
  const isUp = pnl >= 0;
  const pnlColor = isUp ? "text-emerald-400" : "text-rose-400";

  // Use the market name as-is if it looks like a proper question, otherwise format the slug
  const displayMarket =
    position.market && position.market.includes("?")
      ? position.market
      : formatMarketName(position.market || position.marketSlug);

  // Use provided image URL or generate from market slug
  const imageUrl =
    position.image ||
    (position.marketSlug
      ? `https://polymarket-upload.s3.us-east-2.amazonaws.com/${position.marketSlug}.png`
      : null);

  return (
    <div className="group relative flex items-center justify-between px-5 py-3 hover:bg-white/[0.03] transition-colors overflow-hidden border-b border-white/[0.04] last:border-0">
      {/* Background image - less zoomed, with gradient edges */}
      {imageUrl && (
        <div
          className="absolute inset-0 opacity-[0.15] saturate-50"
          style={{
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: "35% auto",
            backgroundPosition: "left center",
            backgroundRepeat: "no-repeat",
          }}
        />
      )}
      {/* Left edge gradient to blend image */}
      <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-black/80 to-transparent" />
      {/* Right gradient overlay - fading to black */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/60 to-black/95" />
      {/* Inner shadow for depth */}
      <div className="absolute inset-0 shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)]" />

      <div className="relative flex-1 min-w-0">
        <p className="text-white/70 truncate text-sm">{displayMarket}</p>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              pnl >= 0
                ? "bg-emerald-500/10 text-emerald-400/60"
                : "bg-rose-500/10 text-rose-400/60"
            }`}
          >
            {position.outcome}
          </span>
          <span className="text-xs text-white/30">Closed</span>
        </div>
      </div>
      <div className="relative text-right">
        <p className={`text-sm font-mono font-semibold ${pnlColor}`}>
          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
        </p>
      </div>
    </div>
  );
}

// ========== Performance View ==========
function PerformanceView({
  stats,
  trades,
}: {
  stats: PerformanceStats | null;
  trades: TradeRecord[];
}) {
  const [liveUnrealizedPnl, setLiveUnrealizedPnl] = useState(0);
  const [chartHistory, setChartHistory] = useState<
    { timestamp: number; pnl: number; balance: number }[]
  >([]);

  // Fetch live unrealized P&L frequently for real-time chart updates
  useEffect(() => {
    const fetchLiveData = async () => {
      try {
        const statsRes = await window.ipc?.invoke<{ unrealizedPnl: number }>(
          "stats:get",
        );
        if (statsRes?.unrealizedPnl !== undefined) {
          setLiveUnrealizedPnl(statsRes.unrealizedPnl);
        }
      } catch (e) {
        console.error("Failed to fetch live P&L:", e);
      }
    };

    fetchLiveData();
    // Fast poll for real-time chart updates
    const interval = setInterval(fetchLiveData, 500);
    return () => clearInterval(interval);
  }, []);

  // Fetch chart history (periodic snapshots)
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const history =
          await window.ipc?.invoke<
            { timestamp: number; pnl: number; balance: number }[]
          >("chart:getHistory");
        if (history && Array.isArray(history)) {
          setChartHistory(history);
        }
      } catch (e) {
        console.error("Failed to fetch chart history:", e);
      }
    };

    fetchHistory();
    // Refresh history every 30 seconds
    const interval = setInterval(fetchHistory, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return (
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    );
  };

  // Combine chart history with current live point
  const chartData = useMemo(() => {
    if (!stats) return [];

    // Start with historical snapshots
    const points: { timestamp: number; pnl: number; balance: number }[] = [];

    if (chartHistory.length > 0) {
      // Use chart history (periodic snapshots)
      chartHistory.forEach((snapshot) => {
        points.push({
          timestamp: snapshot.timestamp,
          pnl: snapshot.pnl,
          balance: snapshot.balance,
        });
      });
    } else if (trades.length > 0) {
      // Fallback to trade-based chart if no history
      const sortedTrades = [...trades].sort(
        (a, b) => a.timestamp - b.timestamp,
      );
      let cumPnl = 0;

      points.push({
        timestamp: sortedTrades[0].timestamp,
        pnl: 0,
        balance: stats.startingBalance,
      });

      sortedTrades.forEach((trade) => {
        if (trade.pnl !== undefined) {
          cumPnl += trade.pnl;
          points.push({
            timestamp: trade.timestamp,
            pnl: cumPnl,
            balance: stats.startingBalance + cumPnl,
          });
        }
      });
    }

    // Add current point with live unrealized P&L
    const realizedPnl = stats.realizedPnl || 0;
    const totalPnl = realizedPnl + liveUnrealizedPnl;

    // Only add if different from last point or first point
    const lastPoint = points[points.length - 1];
    if (
      !lastPoint ||
      Math.abs(lastPoint.pnl - totalPnl) > 0.01 ||
      Date.now() - lastPoint.timestamp > 30000
    ) {
      points.push({
        timestamp: Date.now(),
        pnl: totalPnl,
        balance: stats.startingBalance + totalPnl,
      });
    }

    return points;
  }, [trades, stats, liveUnrealizedPnl, chartHistory]);

  if (!stats) {
    return (
      <div className="panel">
        <div className="px-5 py-16 text-center">
          <p className="text-white/40">Loading performance data...</p>
        </div>
      </div>
    );
  }

  // Calculate accurate total return including unrealized PnL
  const totalPnlWithUnrealized = (stats?.realizedPnl || 0) + liveUnrealizedPnl;
  const accurateReturn =
    stats?.startingBalance > 0
      ? (totalPnlWithUnrealized / stats.startingBalance) * 100
      : 0;

  return (
    <div className="space-y-4">
      {/* Performance Graph */}
      <div className="panel">
        <div className="panel-header">
          <p className="panel-title">Performance Chart</p>
          <span className="text-sm text-white/40">Cumulative P&L</span>
        </div>
        <div className="p-4">
          <PerformanceChart
            data={chartData}
            startingBalance={stats.startingBalance}
          />
        </div>
      </div>

      {/* Performance summary */}
      <div className="grid grid-cols-2 @[600px]:grid-cols-4 @[900px]:grid-cols-6 gap-3">
        <StatCard
          label="Total Return"
          value={`${accurateReturn >= 0 ? "+" : ""}${accurateReturn.toFixed(2)}%`}
          color={accurateReturn >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <StatCard
          label="Total PnL"
          value={`${totalPnlWithUnrealized >= 0 ? "+" : ""}$${totalPnlWithUnrealized.toFixed(
            2,
          )}`}
          color={
            totalPnlWithUnrealized >= 0 ? "text-emerald-400" : "text-rose-400"
          }
        />
        <StatCard
          label="Starting Balance"
          value={`$${stats.startingBalance.toFixed(2)}`}
          color="text-white/60"
        />
        <StatCard
          label="Current Balance"
          value={`$${stats.currentBalance.toFixed(2)}`}
          color="text-white"
        />
        <StatCard
          label="Total Volume"
          value={`$${stats.totalVolume.toFixed(2)}`}
          color="text-white/60"
        />
        <StatCard
          label="Total Fees"
          value={`$${stats.totalFees.toFixed(2)}`}
          color="text-white/40"
        />
      </div>

      {/* Win/Loss stats */}
      <div className="grid grid-cols-2 @[600px]:grid-cols-4 @[900px]:grid-cols-6 gap-3">
        <StatCard
          label="Total Trades"
          value={String(stats.totalTrades)}
          color="text-white"
        />
        <StatCard
          label="Winning Trades"
          value={String(stats.winningTrades)}
          color="text-emerald-400"
        />
        <StatCard
          label="Losing Trades"
          value={String(stats.losingTrades)}
          color="text-rose-400"
        />
        <StatCard
          label="Win Rate"
          value={`${(stats.winRate * 100).toFixed(1)}%`}
          color={stats.winRate >= 0.5 ? "text-emerald-400" : "text-amber-400"}
        />
        <StatCard
          label="Profit Factor"
          value={
            stats.profitFactor === Infinity
              ? "∞"
              : stats.profitFactor.toFixed(2)
          }
          color={stats.profitFactor >= 1 ? "text-emerald-400" : "text-rose-400"}
        />
        <StatCard
          label="Avg Trade Size"
          value={`$${stats.avgTradeSize.toFixed(2)}`}
          color="text-white/60"
        />
      </div>

      {/* Best/Worst */}
      <div className="grid grid-cols-2 @[600px]:grid-cols-4 gap-3">
        <StatCard
          label="Largest Win"
          value={`+$${stats.largestWin.toFixed(2)}`}
          color="text-emerald-400"
        />
        <StatCard
          label="Largest Loss"
          value={`$${stats.largestLoss.toFixed(2)}`}
          color="text-rose-400"
        />
        <StatCard
          label="Avg Win"
          value={`+$${stats.avgWin.toFixed(2)}`}
          color="text-emerald-400"
        />
        <StatCard
          label="Avg Loss"
          value={`-$${stats.avgLoss.toFixed(2)}`}
          color="text-rose-400"
        />
      </div>

      {/* Trade history */}
      <div className="panel">
        <div className="panel-header">
          <p className="panel-title">Trade History</p>
          <span className="text-sm text-white/40">{trades.length} trades</span>
        </div>
        {trades.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <svg
              className="w-12 h-12 mx-auto text-white/20 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
              />
            </svg>
            <p className="text-white/40">No trades yet</p>
            <p className="text-white/30 text-sm mt-1">
              Trade history will appear here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04] max-h-[500px] overflow-y-auto">
            {trades.map((trade) => (
              <TradeHistoryRow
                key={trade.id}
                trade={trade}
                formatTime={formatTime}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TradeHistoryRow({
  trade,
  formatTime,
}: {
  trade: TradeRecord;
  formatTime: (ts: number) => string;
}) {
  const hasPnl = trade.pnl !== undefined;
  const isUp = hasPnl && trade.pnl! >= 0;
  const pnlColor = hasPnl
    ? isUp
      ? "text-emerald-400"
      : "text-rose-400"
    : "text-white/40";
  const sideColor =
    trade.side === "BUY"
      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
      : "bg-rose-500/20 text-rose-400 border border-rose-500/30";
  // Outcome badge color based on trade PnL
  const outcomeColor = hasPnl
    ? isUp
      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
      : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
    : trade.outcome === "YES"
      ? "bg-emerald-500/10 text-emerald-400"
      : "bg-rose-500/10 text-rose-400";
  // Border accent based on PnL
  const borderAccent = hasPnl
    ? isUp
      ? "border-l-4 border-l-emerald-500"
      : "border-l-4 border-l-rose-500"
    : trade.side === "BUY"
      ? "border-l-4 border-l-emerald-500/50"
      : "border-l-4 border-l-rose-500/50";

  // Use the market name as-is if it looks like a proper question, otherwise format the slug
  const displayMarket =
    trade.market && trade.market.includes("?")
      ? trade.market
      : formatMarketName(trade.market || trade.marketSlug);

  // Get image URL from trade or generate from slug
  const imageUrl =
    trade.image ||
    (trade.marketSlug
      ? `https://polymarket-upload.s3.us-east-2.amazonaws.com/${trade.marketSlug}.png`
      : null);

  return (
    <div
      className={`group relative flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] transition-colors overflow-hidden border-b border-white/[0.04] last:border-0 ${borderAccent}`}
    >
      {/* Background image - positioned left, brighter opacity */}
      {imageUrl && (
        <div
          className="absolute inset-0 bg-cover bg-left opacity-[0.2] saturate-75"
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
      )}
      {/* Gradient overlay - transparent on left, fading to black on right */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/70 to-black/95" />
      {/* Inner shadow for depth */}
      <div className="absolute inset-0 shadow-[inset_0_1px_4px_rgba(0,0,0,0.3)]" />

      <div className="relative flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-1.5 py-0.5 rounded ${sideColor}`}>
            {trade.side}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${outcomeColor}`}>
            {trade.outcome}
          </span>
          <span className="text-xs text-white/40 font-mono">
            {formatTime(trade.timestamp)}
          </span>
        </div>
        <p className="text-white/80 mt-1 truncate text-sm">{displayMarket}</p>
      </div>
      <div className="relative flex items-center gap-6 text-right">
        <div>
          <p className="text-xs text-white/40">Shares</p>
          <p className="text-sm font-mono text-white/80">
            {trade.shares.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/40">Price</p>
          <p className="text-sm font-mono text-white/80">
            ${trade.price.toFixed(3)}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/40">Value</p>
          <p className="text-sm font-mono text-white/80">
            ${trade.usdValue.toFixed(2)}
          </p>
        </div>
        <div className="min-w-[80px]">
          <p className="text-xs text-white/40">PnL</p>
          <p className={`text-sm font-mono font-semibold ${pnlColor}`}>
            {hasPnl
              ? `${trade.pnl! >= 0 ? "+" : ""}$${trade.pnl!.toFixed(2)}`
              : "-"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ========== Settings View ==========
function SettingsView({
  config,
  onUpdate,
  onSettingsSaved,
}: {
  config: TradingConfig | null;
  onUpdate: (config: TradingConfig) => void;
  onSettingsSaved?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [localConfig, setLocalConfig] = useState<TradingConfig | null>(null);
  const [newTarget, setNewTarget] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [savedConfig, setSavedConfig] = useState<string | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);

  // Fetch current trading mode from accounts state
  useEffect(() => {
    const fetchTradingMode = async () => {
      try {
        const modeInfo = await window.ipc?.invoke<{
          mode: "paper" | "live";
          activeAccount: any;
        }>("accounts:getTradingMode");
        setIsLiveMode(modeInfo?.mode === "live");
      } catch (e) {
        console.error("Failed to fetch trading mode:", e);
      }
    };
    fetchTradingMode();
  }, []);

  // Initialize localConfig only once when config first arrives
  useEffect(() => {
    if (config && localConfig === null) {
      setLocalConfig(config);
      setSavedConfig(JSON.stringify(config));
    }
  }, [config, localConfig]);

  // Track changes by comparing to saved config
  useEffect(() => {
    if (localConfig && savedConfig) {
      const currentStr = JSON.stringify(localConfig);
      setHasChanges(currentStr !== savedConfig);
    }
  }, [localConfig, savedConfig]);

  if (!localConfig) {
    return (
      <div className="panel">
        <div className="px-5 py-16 text-center">
          <p className="text-white/40">Loading configuration...</p>
        </div>
      </div>
    );
  }

  const updateTradingConfig = (key: string, value: any) => {
    setLocalConfig((prev) =>
      prev
        ? {
            ...prev,
            trading: { ...prev.trading, [key]: value },
          }
        : null,
    );
  };

  const updateRiskConfig = (key: string, value: any) => {
    setLocalConfig((prev) =>
      prev
        ? {
            ...prev,
            risk: { ...prev.risk, [key]: value },
          }
        : null,
    );
  };

  const updatePollingConfig = (key: string, value: any) => {
    setLocalConfig((prev) =>
      prev
        ? {
            ...prev,
            polling: { ...prev.polling, [key]: value },
          }
        : null,
    );
  };

  const updateStopLossConfig = (key: string, value: any) => {
    setLocalConfig((prev) =>
      prev
        ? {
            ...prev,
            stopLoss: {
              ...(prev.stopLoss || {
                enabled: false,
                percent: 80,
                checkIntervalMs: 30000,
              }),
              [key]: value,
            },
          }
        : null,
    );
  };

  const updateAutoRedeemConfig = (key: string, value: any) => {
    setLocalConfig((prev) =>
      prev
        ? {
            ...prev,
            autoRedeem: {
              ...(prev.autoRedeem || { enabled: false, intervalMs: 300000 }),
              [key]: value,
            },
          }
        : null,
    );
  };

  const updatePaperTradingConfig = (key: string, value: any) => {
    setLocalConfig((prev) =>
      prev
        ? {
            ...prev,
            paperTrading: {
              ...(prev.paperTrading || {
                enabled: true,
                startingBalance: 10000,
                feeRate: 0.001,
              }),
              [key]: value,
            },
          }
        : null,
    );
  };

  // Toggle dry run mode (only for live accounts)
  const toggleDryRun = () => {
    setLocalConfig((prev) =>
      prev
        ? {
            ...prev,
            risk: { ...prev.risk, dryRun: !prev.risk.dryRun },
          }
        : null,
    );
  };

  const saveConfig = async () => {
    if (!localConfig) return;
    setSaving(true);
    try {
      await window.ipc?.invoke("config:set", localConfig);
      onUpdate(localConfig);
      setSavedConfig(JSON.stringify(localConfig));
      setHasChanges(false);
      // Notify parent that settings were saved (for restart warning)
      onSettingsSaved?.();
    } catch (e) {
      console.error("Failed to save config:", e);
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    if (savedConfig) {
      setLocalConfig(JSON.parse(savedConfig));
      setHasChanges(false);
    }
  };

  const addTarget = async () => {
    if (!newTarget.trim() || !localConfig) return;
    const addr = newTarget.trim().toLowerCase();
    if (!localConfig.targets.includes(addr)) {
      const newTargets = [...localConfig.targets, addr];
      setLocalConfig({ ...localConfig, targets: newTargets });
    }
    setNewTarget("");
  };

  const removeTarget = async (addr: string) => {
    if (!localConfig) return;
    const newTargets = localConfig.targets.filter((t) => t !== addr);
    setLocalConfig({ ...localConfig, targets: newTargets });
  };

  const resetPaperTrading = async () => {
    if (
      confirm(
        "Are you sure you want to reset paper trading? This will clear all positions and trades.",
      )
    ) {
      await window.ipc?.invoke("paper:reset");
    }
  };

  return (
    <div className="space-y-4 pb-0 relative">
      {/* Sticky Save Banner - shown when there are unsaved changes */}
      {hasChanges && (
        <div className="sticky -top-4 z-50 -mx-4 -mt-4 mb-4 px-4 bg-emerald-500/10 border-b border-emerald-500/30 backdrop-blur-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-emerald-400 text-sm font-normal">
              You have unsaved changes
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={discardChanges} className="btn-danger !py-0 !my-1">
              Discard
            </button>
            <button
              onClick={saveConfig}
              disabled={saving}
              className="btn-primary !py-0 !my-1"
            >
              {saving ? (
                <>
                  <svg
                    className="w-3.5 h-3.5 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Saving...
                </>
              ) : (
                <>Save Changes</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Dry Run Toggle - Only shown for Live accounts */}
      {isLiveMode && (
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Dry Run Mode</p>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      localConfig.risk.dryRun ? "bg-cyan-500/20" : "bg-white/5"
                    }`}
                  >
                    <svg
                      className={`w-5 h-5 ${localConfig.risk.dryRun ? "text-cyan-400" : "text-white/40"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  </div>
                  <div>
                    <p
                      className={`font-medium ${localConfig.risk.dryRun ? "text-cyan-400" : "text-white/80"}`}
                    >
                      {localConfig.risk.dryRun
                        ? "Dry Run Enabled"
                        : "Dry Run Disabled"}
                    </p>
                    <p className="text-xs text-white/50">
                      {localConfig.risk.dryRun
                        ? "Watch mode - detects trades but doesn't execute. Good for observation."
                        : "Live execution - trades will be placed with real money."}
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={toggleDryRun}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  localConfig.risk.dryRun ? "bg-cyan-500" : "bg-white/20"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    localConfig.risk.dryRun ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            {!localConfig.risk.dryRun && (
              <div className="mt-3 p-3 bg-rose-500/10 border border-rose-500/30 rounded">
                <div className="flex items-start gap-2">
                  <svg
                    className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  </svg>
                  <p className="text-xs text-rose-400">
                    Real money at risk! The bot will execute real trades on your
                    live account.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Targets section */}
      <div className="panel">
        <div className="panel-header">
          <p className="panel-title">Target Wallets</p>
          <span className="text-sm text-white/40">
            {localConfig.targets.length} targets
          </span>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              placeholder="0x... wallet address"
              className="input-field flex-1 font-mono text-sm"
              onKeyDown={(e) => e.key === "Enter" && addTarget()}
            />
            <button onClick={addTarget} className="btn-primary">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Add
            </button>
          </div>
          {localConfig.targets.length === 0 ? (
            <p className="text-white/40 text-sm text-center py-4">
              No target wallets configured
            </p>
          ) : (
            <div className="space-y-2">
              {localConfig.targets.map((addr, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-2 px-3 bg-white/[0.02] rounded"
                >
                  <span className="font-mono text-white/80 text-sm truncate">
                    {addr}
                  </span>
                  <button
                    onClick={() => removeTarget(addr)}
                    className="p-1.5 text-white/30 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 @[900px]:grid-cols-2 gap-4">
        {/* Trading settings */}
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Trading Settings</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-white/50 text-sm">Sizing Mode</label>
              <select
                value={localConfig.trading.sizingMode}
                onChange={(e) =>
                  updateTradingConfig("sizingMode", e.target.value)
                }
                className="input-field w-full"
              >
                <option value="proportional">Proportional</option>
                <option value="fixed_usd">Fixed USD</option>
                <option value="fixed_shares">Fixed Shares</option>
              </select>
            </div>
            <InputField
              label="Fixed USD Size"
              value={localConfig.trading.fixedUsdSize}
              onChange={(v) =>
                updateTradingConfig("fixedUsdSize", parseFloat(v) || 0)
              }
              type="number"
              prefix="$"
            />
            <InputField
              label="Fixed Shares Size"
              value={localConfig.trading.fixedSharesSize}
              onChange={(v) =>
                updateTradingConfig("fixedSharesSize", parseFloat(v) || 0)
              }
              type="number"
            />
            <InputField
              label="Proportional Multiplier"
              value={(localConfig.trading.proportionalMultiplier * 100).toFixed(
                1,
              )}
              onChange={(v) =>
                updateTradingConfig(
                  "proportionalMultiplier",
                  (parseFloat(v) || 0) / 100,
                )
              }
              type="number"
              suffix="%"
            />
            <InputField
              label="Min Order Size"
              value={localConfig.trading.minOrderSize}
              onChange={(v) =>
                updateTradingConfig("minOrderSize", parseFloat(v) || 0)
              }
              type="number"
              prefix="$"
            />
            <InputField
              label="Slippage"
              value={(localConfig.trading.slippage * 100).toFixed(1)}
              onChange={(v) =>
                updateTradingConfig("slippage", (parseFloat(v) || 0) / 100)
              }
              type="number"
              suffix="%"
            />
          </div>
        </div>

        {/* Risk settings */}
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Risk Management</p>
          </div>
          <div className="p-4 space-y-4">
            <InputField
              label="Max USD/Trade"
              value={localConfig.risk.maxUsdPerTrade}
              onChange={(v) =>
                updateRiskConfig("maxUsdPerTrade", parseFloat(v) || 0)
              }
              type="number"
              prefix="$"
            />
            <InputField
              label="Max USD/Market"
              value={
                localConfig.risk.maxUsdPerMarket > 1e20
                  ? ""
                  : localConfig.risk.maxUsdPerMarket
              }
              onChange={(v) =>
                updateRiskConfig(
                  "maxUsdPerMarket",
                  v === "" ? 1e22 : parseFloat(v) || 0,
                )
              }
              type="number"
              prefix="$"
              placeholder="Unlimited"
            />
            <InputField
              label="Max Daily Volume"
              value={
                localConfig.risk.maxDailyUsdVolume > 1e20
                  ? ""
                  : localConfig.risk.maxDailyUsdVolume
              }
              onChange={(v) =>
                updateRiskConfig(
                  "maxDailyUsdVolume",
                  v === "" ? 1e22 : parseFloat(v) || 0,
                )
              }
              type="number"
              prefix="$"
              placeholder="Unlimited"
            />
            <InputField
              label="Skip Markets Older Than"
              value={
                localConfig.risk
                  .doNotTradeMarketsOlderThanSecondsFromResolution || 0
              }
              onChange={(v) =>
                updateRiskConfig(
                  "doNotTradeMarketsOlderThanSecondsFromResolution",
                  parseInt(v) || 0,
                )
              }
              type="number"
              suffix="sec"
            />
            <p className="text-white/40 text-xs">
              Skip markets resolving within this many seconds. 0 = disabled.
            </p>
          </div>
        </div>

        {/* Stop-Loss Settings */}
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Stop-Loss</p>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                localConfig.stopLoss?.enabled
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-white/10 text-white/40"
              }`}
            >
              {localConfig.stopLoss?.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-sm">Enable Stop-Loss</label>
              <button
                onClick={() =>
                  updateStopLossConfig(
                    "enabled",
                    !localConfig.stopLoss?.enabled,
                  )
                }
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  localConfig.stopLoss?.enabled
                    ? "bg-emerald-500"
                    : "bg-white/20"
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    localConfig.stopLoss?.enabled ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
            <InputField
              label="Loss Threshold"
              value={localConfig.stopLoss?.percent ?? 80}
              onChange={(v) =>
                updateStopLossConfig("percent", parseFloat(v) || 0)
              }
              type="number"
              suffix="%"
            />
            <p className="text-white/40 text-xs">
              Auto-sell positions when they lose this percentage of value (e.g.,
              80 = sell at 80% loss)
            </p>
            <InputField
              label="Check Interval"
              value={localConfig.stopLoss?.checkIntervalMs ?? 30000}
              onChange={(v) =>
                updateStopLossConfig("checkIntervalMs", parseInt(v) || 30000)
              }
              type="number"
              suffix="ms"
            />
          </div>
        </div>

        {/* Auto-Redeem Settings */}
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Auto-Redeem</p>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                localConfig.autoRedeem?.enabled
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-white/10 text-white/40"
              }`}
            >
              {localConfig.autoRedeem?.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-sm">
                Enable Auto-Redeem
              </label>
              <button
                onClick={() =>
                  updateAutoRedeemConfig(
                    "enabled",
                    !localConfig.autoRedeem?.enabled,
                  )
                }
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  localConfig.autoRedeem?.enabled
                    ? "bg-emerald-500"
                    : "bg-white/20"
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    localConfig.autoRedeem?.enabled ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
            <InputField
              label="Redeem Interval"
              value={localConfig.autoRedeem?.intervalMs ?? 300000}
              onChange={(v) =>
                updateAutoRedeemConfig("intervalMs", parseInt(v) || 300000)
              }
              type="number"
              suffix="ms"
            />
            <p className="text-white/40 text-xs">
              Automatically redeem winning positions after market resolution.
              Default: 5 minutes (300000ms)
            </p>
          </div>
        </div>

        {/* Paper Trading Settings */}
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Paper Trading</p>
          </div>
          <div className="p-4 space-y-4">
            <InputField
              label="Starting Balance"
              value={localConfig.paperTrading?.startingBalance ?? 10000}
              onChange={(v) =>
                updatePaperTradingConfig(
                  "startingBalance",
                  parseFloat(v) || 10000,
                )
              }
              type="number"
              prefix="$"
            />
            <InputField
              label="Fee Rate"
              value={(
                (localConfig.paperTrading?.feeRate ?? 0.001) * 100
              ).toFixed(2)}
              onChange={(v) =>
                updatePaperTradingConfig("feeRate", (parseFloat(v) || 0) / 100)
              }
              type="number"
              suffix="%"
            />
            <p className="text-white/40 text-xs">
              Simulated trading fee rate. Default: 0.1% (0.001)
            </p>
          </div>
        </div>

        {/* Polling settings */}
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Polling Settings</p>
          </div>
          <div className="p-4 space-y-4">
            <InputField
              label="Polling Interval"
              value={localConfig.polling.intervalMs}
              onChange={(v) =>
                updatePollingConfig("intervalMs", parseInt(v) || 2000)
              }
              type="number"
              suffix="ms"
            />
            <InputField
              label="Trade Limit"
              value={localConfig.polling.tradeLimit}
              onChange={(v) =>
                updatePollingConfig("tradeLimit", parseInt(v) || 20)
              }
              type="number"
            />
            <InputField
              label="Max Retries"
              value={localConfig.polling.maxRetries}
              onChange={(v) =>
                updatePollingConfig("maxRetries", parseInt(v) || 3)
              }
              type="number"
            />
            <InputField
              label="Base Backoff"
              value={localConfig.polling.baseBackoffMs}
              onChange={(v) =>
                updatePollingConfig("baseBackoffMs", parseInt(v) || 2000)
              }
              type="number"
              suffix="ms"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Actions</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-white/80 text-sm font-medium">Chain ID</p>
                <p className="text-white/40 text-xs">
                  {localConfig.chainId === 137
                    ? "Polygon Mainnet"
                    : `Chain ${localConfig.chainId}`}
                </p>
              </div>
              <span className="text-white/60 text-sm font-mono">
                {localConfig.chainId}
              </span>
            </div>
            <button
              onClick={resetPaperTrading}
              className="w-full btn-secondary text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
              Reset Paper Trading
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  prefix,
  suffix,
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number";
  prefix?: string;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-white/50 text-sm">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">
            {prefix}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`input-field w-full ${prefix ? "pl-7" : ""} ${
            suffix ? "pr-12" : ""
          }`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
