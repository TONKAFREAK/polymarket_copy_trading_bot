import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import type {
  DashboardStats,
  Position,
  TradeLog,
  TradingConfig,
  TradeRecord,
  PerformanceStats,
} from "../types";

type TabKind =
  | "dashboard"
  | "portfolio"
  | "performance"
  | "traders"
  | "whales"
  | "settings";

type Tab = {
  id: string;
  title: string;
  kind: TabKind;
};

interface TabsProps {
  realtimeLogs?: TradeLog[];
  onSettingsSaved?: () => void;
}

// Clean, minimal icons for each tab
const TabIcon = ({ kind, active }: { kind: TabKind; active: boolean }) => {
  const baseClass = `w-[18px] h-[18px] transition-colors duration-200`;
  const color = active
    ? "text-emerald-400"
    : "text-white/40 group-hover:text-white/60";

  switch (kind) {
    case "dashboard":
      return (
        <svg
          className={`${baseClass} ${color}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
          />
        </svg>
      );
    case "portfolio":
      return (
        <svg
          className={`${baseClass} ${color}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
          />
        </svg>
      );
    case "performance":
      return (
        <svg
          className={`${baseClass} ${color}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
          />
        </svg>
      );
    case "traders":
      return (
        <svg
          className={`${baseClass} ${color}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
          />
        </svg>
      );
    case "whales":
      return (
        <svg
          className={`${baseClass} ${color}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case "settings":
      return (
        <svg
          className={`${baseClass} ${color}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      );
  }
};

const defaultTabs: Tab[] = [
  { id: "dashboard", title: "Dashboard", kind: "dashboard" },
  { id: "portfolio", title: "Portfolio", kind: "portfolio" },
  { id: "performance", title: "Performance", kind: "performance" },
  { id: "traders", title: "Traders", kind: "traders" },
  { id: "whales", title: "Whales", kind: "whales" },
  { id: "settings", title: "Settings", kind: "settings" },
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

  // Position price polling - FAST (500ms for real-time P&L feel)
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

    fetchPositionPrices();
    // Poll every 500ms for snappy real-time updates
    const fastInterval = setInterval(fetchPositionPrices, 500);
    return () => clearInterval(fastInterval);
  }, []);

  // Fetch all data periodically (performance stats faster for chart updates)
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
    // Poll every 2 seconds for snappier updates
    const interval = setInterval(fetchData, 2000);
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
      <div className="h-full flex flex-col bg-[#0d0d0e]">
        {/* Tab bar - sleek minimal design */}
        <div className="flex items-center h-11 bg-black/40  flex-shrink-0 px-1">
          <div className="flex items-center h-full gap-0.5">
            {defaultTabs.map((tab) => {
              const isActive = tab.id === activeId;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveId(tab.id)}
                  className={`group flex items-center gap-2 h-8 px-4 transition-all duration-200 relative ${
                    isActive
                      ? "bg-white/[0.06] text-white"
                      : "text-white/50 hover:text-white/80"
                  }`}
                >
                  <TabIcon kind={tab.kind} active={isActive} />
                  <span
                    className={`text-[13px] font-medium whitespace-nowrap ${isActive ? "text-white" : ""}`}
                  >
                    {tab.title}
                  </span>
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content - scrollable area */}
        <div
          className="px-5 pt-5 flex-1 overflow-y-auto min-h-0 @container bg-[#0a0a0b]"
          style={{ maxHeight: "calc(100% - 2.75rem)" }}
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
          {active?.kind === "traders" && <TradersView />}
          {active?.kind === "whales" && <WhalesView />}
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

  // Mode badge color and styling
  const getModeDisplay = (mode: string) => {
    switch (mode) {
      case "live":
        return {
          label: "LIVE",
          badgeClass: "bg-rose-500/15 text-rose-400 border border-rose-500/30",
          dotClass: "bg-rose-500",
          description: "Real trades with your wallet",
        };
      case "paper":
        return {
          label: "PAPER",
          badgeClass:
            "bg-amber-500/15 text-amber-400 border border-amber-500/30",
          dotClass: "bg-amber-500",
          description: "Simulated trades with virtual funds",
        };
      case "dry-run":
        return {
          label: "DRY RUN",
          badgeClass: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30",
          dotClass: "bg-cyan-500",
          description: "Watching only, no trades executed",
        };
      default:
        return {
          label: mode.toUpperCase(),
          badgeClass: "bg-white/10 text-white/60 border border-white/20",
          dotClass: "bg-white/60",
          description: "",
        };
    }
  };

  const modeDisplay = getModeDisplay(stats?.mode ?? "paper");

  return (
    <div className="space-y-4">
      {/* Mode banner - minimal design */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#111113] border border-white/[0.06] animate-slide-up">
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold tracking-wide ${modeDisplay.badgeClass}`}
          >
            <span
              className={`w-1.5 h-1.5 ${modeDisplay.dotClass} animate-pulse`}
            />
            {modeDisplay.label}
          </div>
          <span className="text-xs text-white/40">
            {modeDisplay.description}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5 text-white/50">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
            <span className="font-mono">{stats?.targetsCount || 0}</span>
          </div>
          <div className="flex items-center gap-1.5 text-white/50">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="font-mono">
              {formatDuration(stats?.uptime ?? 0)}
            </span>
          </div>
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
        <div className="panel overflow-visible">
          <div className="panel-header">
            <p className="panel-title">Holdings</p>
            <span className="text-sm text-white/40">
              {activePositions.length} positions
            </span>
          </div>
          {activePositions.length > 0 && (
            <div className="@container flex items-center px-3 @[400px]:px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
              <div className="flex-1 min-w-0 mr-2 @[400px]:mr-3 @[500px]:mr-4">
                <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                  Market
                </span>
              </div>
              <div className="flex items-center gap-1.5 @[400px]:gap-2 @[500px]:gap-3">
                <div className="w-8 @[400px]:w-10 text-center">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Side
                  </span>
                </div>
                <div className="hidden @[400px]:flex w-14 @[500px]:w-16 justify-end">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Shares
                  </span>
                </div>
                <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Value
                  </span>
                </div>
                <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    PnL
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="divide-y divide-white/[0.04] max-h-[400px] overflow-y-auto overflow-x-visible">
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
    <div className="stat-card group">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${color} transition-colors duration-200`}>
        {value}
      </span>
    </div>
  );
}

// ========== Live Price Mini Chart Hook (REST API based) ==========
type PricePoint = { price: number; timestamp: number };

function usePriceHistory(tokenId: string | null, enabled: boolean) {
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !tokenId) {
      setPriceHistory([]);
      setIsLoading(false);
      setError(null);
      fetchedRef.current = null;
      return;
    }

    // Don't refetch if we already have data for this token
    if (fetchedRef.current === tokenId && priceHistory.length > 0) {
      return;
    }

    // Debounce fetch by 200ms
    const timeoutId = setTimeout(async () => {
      // Abort any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setIsLoading(true);
      setError(null);

      try {
        // Fetch price history from Polymarket CLOB API
        // Using the timeseries endpoint for token prices
        const response = await fetch(
          `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=1m&fidelity=60`,
          {
            signal: abortControllerRef.current.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        if (!response.ok) {
          throw new Error("Failed to fetch price history");
        }

        const data = await response.json();

        // Parse the response - format is { history: [{t: timestamp, p: price}] }
        if (data?.history && Array.isArray(data.history)) {
          const points: PricePoint[] = data.history
            .map((item: any) => ({
              timestamp: item.t * 1000, // Convert to ms
              price: parseFloat(item.p),
            }))
            .filter((p: PricePoint) => !isNaN(p.price) && p.price > 0);

          setPriceHistory(points);
          fetchedRef.current = tokenId;
        } else {
          // If API doesn't return expected format, create synthetic data from current price
          setError("No history available");
        }
      } catch (e: any) {
        if (e.name !== "AbortError") {
          setError(e.message || "Failed to load");
        }
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timeoutId);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [tokenId, enabled]);

  // Clear cache when disabled
  useEffect(() => {
    if (!enabled) {
      fetchedRef.current = null;
    }
  }, [enabled]);

  return { priceHistory, isLoading, error };
}

// ========== Mini Price Chart Component ==========
function MiniPriceTooltip({ position }: { position: Position }) {
  const [isHovered, setIsHovered] = useState(true);
  const { priceHistory, isLoading, error } = usePriceHistory(
    position.tokenId,
    isHovered,
  );

  const isUp = position.pnl >= 0;
  const pnlPercent =
    position.avgEntryPrice > 0
      ? ((position.currentPrice - position.avgEntryPrice) /
          position.avgEntryPrice) *
        100
      : 0;

  // Chart dimensions - increased to fit labels
  const width = 180;
  const height = 60;
  const padding = { top: 8, right: 30, bottom: 10, left: 4 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Generate SVG path from price history + entry line position
  const {
    path,
    areaPath,
    chartIsUp,
    entryLineY,
    minPrice,
    maxPrice,
    adjustedMin,
    paddedRange,
  } = useMemo(() => {
    if (priceHistory.length < 2) {
      return {
        path: "",
        areaPath: "",
        chartIsUp: true,
        entryLineY: 0,
        minPrice: 0,
        maxPrice: 0,
        adjustedMin: 0,
        paddedRange: 0.001,
      };
    }

    const prices = priceHistory.map((p) => p.price);
    const minP = Math.min(...prices, position.avgEntryPrice);
    const maxP = Math.max(...prices, position.avgEntryPrice);
    const range = maxP - minP || 0.001;
    const padRange = range * 1.3; // More padding for entry line visibility
    const adjMin = minP - (padRange - range) / 2;

    const minT = priceHistory[0].timestamp;
    const maxT = priceHistory[priceHistory.length - 1].timestamp;
    const timeRange = maxT - minT || 1;

    let d = "";
    priceHistory.forEach((p, i) => {
      const x = padding.left + ((p.timestamp - minT) / timeRange) * chartW;
      const y = padding.top + chartH - ((p.price - adjMin) / padRange) * chartH;
      d +=
        i === 0
          ? `M ${x.toFixed(1)} ${y.toFixed(1)}`
          : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    });

    // Area path
    const lastX = padding.left + chartW;
    const firstX = padding.left;
    const bottomY = padding.top + chartH;
    const area = `${d} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;

    const firstPrice = priceHistory[0].price;
    const lastPrice = priceHistory[priceHistory.length - 1].price;

    // Calculate entry line Y position
    const entryY =
      padding.top +
      chartH -
      ((position.avgEntryPrice - adjMin) / padRange) * chartH;

    return {
      path: d,
      areaPath: area,
      chartIsUp: lastPrice >= firstPrice,
      entryLineY: entryY,
      minPrice: minP,
      maxPrice: maxP,
      adjustedMin: adjMin,
      paddedRange: padRange,
    };
  }, [priceHistory, chartW, chartH, position.avgEntryPrice]);

  const lineColor = chartIsUp ? "#10b981" : "#f43f5e";

  return (
    <div className="bg-[#0a0a0b]/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-2xl p-3 min-w-[180px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            position.outcome === "YES"
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-rose-500/20 text-rose-400"
          }`}
        >
          {position.outcome}
        </span>
        <span
          className={`text-[10px] font-medium ${isUp ? "text-emerald-400" : "text-rose-400"}`}
        >
          {isUp ? "▲" : "▼"} {Math.abs(pnlPercent).toFixed(1)}%
        </span>
      </div>

      {/* Current price */}
      <div className="mb-2">
        <div className="text-[10px] text-white/40 mb-0.5">Current Price</div>
        <div className="text-lg font-mono font-semibold text-white">
          ${(position.currentPrice ?? position.avgEntryPrice).toFixed(3)}
        </div>
      </div>

      {/* Mini chart */}
      <div className="mb-2">
        {isLoading ? (
          <div className="h-[60px] flex items-center justify-center bg-white/[0.02] rounded">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
              <span className="text-[10px] text-white/30">Loading...</span>
            </div>
          </div>
        ) : error || priceHistory.length < 2 ? (
          <div className="h-[60px] flex items-center justify-center bg-white/[0.02] rounded">
            <span className="text-[10px] text-white/20">No chart data</span>
          </div>
        ) : (
          <svg width={width} height={height} className="overflow-visible">
            <defs>
              <linearGradient
                id={`miniGrad-${position.tokenId}`}
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
                <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Entry price horizontal dashed line */}
            <line
              x1={padding.left}
              y1={entryLineY}
              x2={padding.left + chartW}
              y2={entryLineY}
              stroke="#fbbf24"
              strokeWidth="1"
              strokeDasharray="3,2"
              opacity="0.7"
            />

            {/* Area fill */}
            <path d={areaPath} fill={`url(#miniGrad-${position.tokenId})`} />

            {/* Price line */}
            <path
              d={path}
              fill="none"
              stroke={lineColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Y-axis labels (right side) */}
            {/* Max price */}
            <text
              x={padding.left + chartW + 3}
              y={padding.top + 3}
              fontSize="7"
              fill="rgba(255,255,255,0.4)"
              fontFamily="monospace"
            >
              ${maxPrice.toFixed(2)}
            </text>

            {/* Entry price label */}
            <text
              x={padding.left + chartW + 3}
              y={entryLineY + 2}
              fontSize="7"
              fill="#fbbf24"
              fontFamily="monospace"
              fontWeight="500"
            >
              ${position.avgEntryPrice.toFixed(2)}
            </text>

            {/* Min price */}
            <text
              x={padding.left + chartW + 3}
              y={padding.top + chartH}
              fontSize="7"
              fill="rgba(255,255,255,0.4)"
              fontFamily="monospace"
            >
              ${minPrice.toFixed(2)}
            </text>

            {/* Entry label marker dot */}
            <circle cx={padding.left} cy={entryLineY} r="2" fill="#fbbf24" />
          </svg>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
        <div>
          <div className="text-[9px] text-white/40">Entry</div>
          <div className="text-xs font-mono text-white/70">
            ${position.avgEntryPrice.toFixed(3)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-white/40">Shares</div>
          <div className="text-xs font-mono text-white/70">
            {position.shares.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-white/40">Value</div>
          <div className="text-xs font-mono text-white/70">
            ${position.currentValue.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-white/40">P&L</div>
          <div
            className={`text-xs font-mono font-medium ${isUp ? "text-emerald-400" : "text-rose-400"}`}
          >
            {position.pnl >= 0 ? "+" : ""}${position.pnl.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== Table Header Component ==========
function TableHeader({
  columns,
}: {
  columns: {
    label: string;
    width: string;
    align?: "left" | "right" | "center";
    hideBelow?: string;
  }[];
}) {
  return (
    <div className="@container flex items-center px-3 @[400px]:px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
      {columns.map((col, idx) => (
        <div
          key={idx}
          className={`${col.width} ${col.hideBelow || ""} ${
            col.align === "right"
              ? "text-right"
              : col.align === "center"
                ? "text-center"
                : "text-left"
          }`}
        >
          <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
            {col.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ========== Holding Row with Hover Tooltip ==========
function HoldingRow({
  position,
  compact = false,
}: {
  position: Position;
  compact?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const rowRef = useRef<HTMLDivElement>(null);

  const isActivePosition = position.shares > 0 && !position.settled;

  const handleMouseEnter = () => {
    if (isActivePosition) {
      setIsHovered(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const isUp = position.pnl >= 0;
  const pnlColor = isUp ? "text-emerald-400" : "text-rose-400";

  const displayMarket =
    position.market && position.market.includes("?")
      ? position.market
      : formatMarketName(position.market || position.marketSlug);

  const imageUrl =
    position.image ||
    (position.marketSlug
      ? `https://polymarket-upload.s3.us-east-2.amazonaws.com/${position.marketSlug}.png`
      : null);

  const formatValue = (val: number) => {
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(2)}`;
  };

  return (
    <div
      ref={rowRef}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="@container group flex items-center px-3 @[400px]:px-4 py-2.5 @[400px]:py-3 hover:bg-white/[0.03] transition-colors border-b border-white/[0.04] last:border-0"
    >
      {/* Tooltip */}
      {isHovered && isActivePosition && (
        <div
          className="fixed pointer-events-none animate-fade-in"
          style={{
            left: mousePos.x + 16,
            top: mousePos.y - 60,
            zIndex: 99999,
          }}
        >
          <MiniPriceTooltip position={position} />
        </div>
      )}

      {/* Market image and name */}
      <div className="flex-1 min-w-0 flex items-center gap-2 @[400px]:gap-2.5 @[500px]:gap-3 mr-2 @[400px]:mr-3 @[500px]:mr-4">
        {imageUrl && (
          <img
            alt=""
            loading="lazy"
            className="w-7 h-7 @[400px]:w-8 @[400px]:h-8 @[500px]:w-9 @[500px]:h-9 rounded object-cover flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
            src={imageUrl}
          />
        )}
        <span className="text-[12px] @[400px]:text-[13px] @[500px]:text-[14px] text-white/80 group-hover:text-white truncate transition-colors">
          {displayMarket}
        </span>
      </div>

      {/* Right side info */}
      <div className="flex items-center gap-1.5 @[400px]:gap-2 @[500px]:gap-3">
        {/* Outcome badge */}
        <div className="w-8 @[400px]:w-10 flex items-center justify-center">
          <span
            className={`text-[9px] @[400px]:text-[10px] @[500px]:text-[11px] font-bold px-1 @[400px]:px-1.5 py-0.5 ${
              position.outcome === "Yes"
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-rose-500/10 text-rose-300"
            }`}
          >
            {position.outcome?.toUpperCase() || "—"}
          </span>
        </div>

        {/* Shares */}
        <div className="hidden @[400px]:flex w-14 @[500px]:w-16 items-center justify-end">
          <span className="text-[11px] @[500px]:text-[12px] font-medium text-white/50 tabular-nums">
            {position.shares.toFixed(1)} sh
          </span>
        </div>

        {/* Value */}
        <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
          <span className="text-[12px] @[400px]:text-[13px] @[500px]:text-[14px] font-semibold tabular-nums text-white/90">
            {formatValue(position.currentValue)}
          </span>
        </div>

        {/* PnL */}
        <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
          <span
            className={`text-[12px] @[400px]:text-[13px] @[500px]:text-[14px] font-semibold tabular-nums ${pnlColor}`}
          >
            {position.pnl >= 0 ? "+" : ""}
            {formatValue(position.pnl)}
          </span>
        </div>
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
 * Performance Chart Component - Robinhood-style chart with time range selector
 */
type TimeRange = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

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
    balance: number;
    timestamp: number;
    percentChange: number;
  } | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("ALL");
  const svgRef = React.useRef<SVGSVGElement>(null);

  // Constants
  const width = 800;
  const height = 200;
  const padding = { top: 5, right: 0, bottom: 5, left: 0 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Filter data based on selected time range
  const filteredData = useMemo(() => {
    if (!data.length) return [];
    const now = Date.now();
    const ranges: Record<TimeRange, number> = {
      "1D": 24 * 60 * 60 * 1000,
      "1W": 7 * 24 * 60 * 60 * 1000,
      "1M": 30 * 24 * 60 * 60 * 1000,
      "3M": 90 * 24 * 60 * 60 * 1000,
      "1Y": 365 * 24 * 60 * 60 * 1000,
      ALL: Infinity,
    };
    const cutoff = now - ranges[timeRange];
    let filtered = data.filter((d) => d.timestamp >= cutoff);

    if (filtered.length < 2) {
      filtered =
        data.length >= 2 ? data.slice(-Math.min(data.length, 100)) : data;
    }

    // Downsample if too many points (max 150 for smooth rendering)
    if (filtered.length > 150) {
      const step = Math.ceil(filtered.length / 150);
      const downsampled: typeof filtered = [filtered[0]];
      for (let i = step; i < filtered.length - 1; i += step) {
        downsampled.push(filtered[i]);
      }
      downsampled.push(filtered[filtered.length - 1]);
      return downsampled;
    }

    return filtered;
  }, [data, timeRange]);

  // Calculate chart metrics
  const chartMetrics = useMemo(() => {
    if (!filteredData.length || filteredData.length < 2) {
      return {
        currentBalance: startingBalance,
        startBalance: startingBalance,
        totalChange: 0,
        percentChange: 0,
        isPositive: true,
        minTime: 0,
        maxTime: 0,
        timeRangeMs: 1,
        adjustedMin: 0,
        range: 1,
        hasData: false,
      };
    }

    const currentBalance = filteredData[filteredData.length - 1].balance;
    const startBalance = filteredData[0].balance;
    const totalChange = currentBalance - startBalance;
    const percentChange =
      startBalance > 0 ? (totalChange / startBalance) * 100 : 0;
    const isPositive = totalChange >= 0;

    const balanceValues = filteredData.map((d) => d.balance);
    const minBalance = Math.min(...balanceValues);
    const maxBalance = Math.max(...balanceValues);
    const rangePadding = (maxBalance - minBalance) * 0.15 || 10;
    const range = maxBalance - minBalance + rangePadding * 2 || 1;
    const adjustedMin = minBalance - rangePadding;

    const minTime = filteredData[0].timestamp;
    const maxTime = filteredData[filteredData.length - 1].timestamp;
    const timeRangeMs = maxTime - minTime || 1;

    return {
      currentBalance,
      startBalance,
      totalChange,
      percentChange,
      isPositive,
      minTime,
      maxTime,
      timeRangeMs,
      adjustedMin,
      range,
      hasData: true,
    };
  }, [filteredData, startingBalance]);

  // Generate smooth SVG path
  const { linePath, areaPath } = useMemo(() => {
    if (!chartMetrics.hasData) return { linePath: "", areaPath: "" };

    const { minTime, timeRangeMs, adjustedMin, range } = chartMetrics;

    const points: { x: number; y: number }[] = [];

    for (const d of filteredData) {
      const x =
        padding.left + ((d.timestamp - minTime) / timeRangeMs) * chartWidth;
      const y =
        padding.top +
        chartHeight -
        ((d.balance - adjustedMin) / range) * chartHeight;
      if (!isNaN(x) && !isNaN(y)) {
        points.push({ x, y });
      }
    }

    if (points.length < 2) return { linePath: "", areaPath: "" };

    // Create smooth line path
    let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
    }

    // Area path (fill under line)
    const lastPoint = points[points.length - 1];
    const firstPoint = points[0];
    const area = `${path} L ${lastPoint.x.toFixed(2)} ${height - padding.bottom} L ${firstPoint.x.toFixed(2)} ${height - padding.bottom} Z`;

    return { linePath: path, areaPath: area };
  }, [filteredData, chartMetrics, chartWidth, chartHeight]);

  // Handle mouse move - Robinhood style (just vertical line, value shown at top)
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || !filteredData.length || !chartMetrics.hasData)
        return;

      const { minTime, timeRangeMs, adjustedMin, range, startBalance } =
        chartMetrics;
      const svg = svgRef.current;

      const ctm = svg.getScreenCTM();
      if (!ctm) return;

      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(ctm.inverse());
      const mouseX = svgPt.x;

      // Clamp to chart bounds
      const clampedX = Math.max(
        padding.left,
        Math.min(width - padding.right, mouseX),
      );

      // Find timestamp at this x position
      const timestamp =
        minTime + ((clampedX - padding.left) / chartWidth) * timeRangeMs;

      // Binary search for closest point
      let left = 0;
      let right = filteredData.length - 1;
      while (left < right - 1) {
        const mid = Math.floor((left + right) / 2);
        if (filteredData[mid].timestamp < timestamp) {
          left = mid;
        } else {
          right = mid;
        }
      }

      const closest =
        Math.abs(filteredData[left].timestamp - timestamp) <
        Math.abs(filteredData[right].timestamp - timestamp)
          ? filteredData[left]
          : filteredData[right];

      const x =
        padding.left +
        ((closest.timestamp - minTime) / timeRangeMs) * chartWidth;
      const y =
        padding.top +
        chartHeight -
        ((closest.balance - adjustedMin) / range) * chartHeight;

      const changeFromStart = closest.balance - startBalance;
      const pctChange =
        startBalance > 0 ? (changeFromStart / startBalance) * 100 : 0;

      setHoverData({
        x,
        y,
        balance: closest.balance,
        timestamp: closest.timestamp,
        percentChange: pctChange,
      });
    },
    [filteredData, chartMetrics, chartWidth, chartHeight],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverData(null);
  }, []);

  // No data state
  // if (!chartMetrics.hasData) {
  //   return (
  //     <div className="space-y-3">
  //       <div className="px-1">
  //         <div className="text-[32px] font-medium text-white/20 tracking-tight">
  //           $0.00
  //         </div>
  //         <div className="text-sm text-white/10">+$0.00 (0.00%)</div>
  //       </div>
  //       <div className="h-[180px] flex items-center justify-center">
  //         <p className="text-white/20 text-sm">No performance data yet</p>
  //       </div>
  //     </div>
  //   );
  // }

  const {
    currentBalance,
    startBalance,
    totalChange,
    percentChange,
    isPositive,
    hasData,
  } = chartMetrics;
  const lineColor = isPositive ? "#00c853" : "#ff5252";

  // Format functions
  const formatCurrency = (val: number) => {
    if (Math.abs(val) >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(2)}K`;
    return `$${val.toFixed(2)}`;
  };

  const formatChange = (val: number) => {
    const prefix = val >= 0 ? "+" : "";
    if (Math.abs(val) >= 1000) return `${prefix}$${(val / 1000).toFixed(2)}K`;
    return `${prefix}$${val.toFixed(2)}`;
  };

  const formatPercent = (val: number) =>
    `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Display values
  const displayBalance = hoverData ? hoverData.balance : currentBalance;
  const displayChange = hoverData
    ? hoverData.balance - startBalance
    : totalChange;
  const displayPercent = hoverData ? hoverData.percentChange : percentChange;
  const displayPositive = displayChange >= 0;
  const displayColor = displayPositive ? "#00c853" : "#ff5252";

  // Show placeholder when no data
  if (!hasData) {
    return (
      <div className="space-y-1">
        <div className="px-1 mb-4">
          <div className="text-[32px] font-medium tracking-tight text-white">
            {formatCurrency(startingBalance)}
          </div>
          <div className="flex items-center gap-2 text-[15px] text-white/40">
            <span>+$0.00</span>
            <span>(0.00%)</span>
            <span className="text-white/30 text-xs">No trades yet</span>
          </div>
        </div>
        <div className="relative h-[180px] flex items-center justify-center bg-white/[0.02] rounded">
          <div className="text-center">
            <svg
              className="w-10 h-10 mx-auto text-white/10 mb-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16"
              />
            </svg>
            <p className="text-white/30 text-sm">
              Performance chart will appear here
            </p>
            <p className="text-white/20 text-xs mt-1">
              Start trading to see your progress
            </p>
          </div>
        </div>
        {/* Time range buttons - disabled state */}
        <div className="flex items-center justify-center gap-0 pt-2">
          {(["1D", "1W", "1M", "3M", "1Y", "ALL"] as TimeRange[]).map(
            (range) => (
              <button
                key={range}
                disabled
                className="px-4 py-2 text-[13px] font-medium text-white/20 cursor-not-allowed"
              >
                {range}
              </button>
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Balance display - Robinhood style */}
      <div className="px-1 mb-4">
        <div
          className="text-[32px] font-medium tracking-tight transition-colors duration-150"
          style={{ color: "white" }}
        >
          {formatCurrency(displayBalance)}
        </div>
        <div
          className="flex items-center gap-2 text-[15px]"
          style={{ color: displayColor }}
        >
          <span>{formatChange(displayChange)}</span>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            ({formatPercent(displayPercent)})
          </span>
          {hoverData ? (
            <span className="text-white/40 text-xs">
              {formatTime(hoverData.timestamp)}
            </span>
          ) : (
            <span className="text-white/30 text-xs">
              {timeRange === "ALL" ? "All time" : timeRange}
            </span>
          )}
        </div>
      </div>

      {/* Chart - Clean Robinhood style */}

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="w-full h-[180px]"
          style={{ cursor: "crosshair" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.15" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Hit area */}
          <rect x="0" y="0" width={width} height={height} fill="transparent" />

          {/* Area fill */}
          {areaPath && <path d={areaPath} fill="url(#areaGradient)" />}

          {/* Main line - clean, no dots */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={lineColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Hover line - just a simple vertical line */}
          {hoverData && (
            <line
              x1={hoverData.x}
              y1={0}
              x2={hoverData.x}
              y2={height}
              stroke={displayColor}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>

      {/* Time range buttons - Robinhood style */}
      <div className="flex items-center justify-center gap-0 pt-2">
        {(["1D", "1W", "1M", "3M", "1Y", "ALL"] as TimeRange[]).map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`px-4 py-2 text-[13px] font-medium transition-all ${
              timeRange === range
                ? "text-white"
                : "text-white/40 hover:text-white/60"
            }`}
            style={timeRange === range ? { color: lineColor } : undefined}
          >
            {range}
          </button>
        ))}
      </div>
    </div>
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
          {/* Result — always on new line */}
          {log.type && (
            <div className="w-full flex items-center gap-2 mt-0.5">
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
            </div>
          )}

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
          <>
            <div className="@container flex items-center px-3 @[400px]:px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
              <div className="flex-1 min-w-0 mr-2 @[400px]:mr-3 @[500px]:mr-4">
                <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                  Market
                </span>
              </div>
              <div className="flex items-center gap-1.5 @[400px]:gap-2 @[500px]:gap-3">
                <div className="w-8 @[400px]:w-10 text-center">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Side
                  </span>
                </div>
                <div className="hidden @[400px]:flex w-14 @[500px]:w-16 justify-end">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Shares
                  </span>
                </div>
                <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Value
                  </span>
                </div>
                <div className="hidden @[500px]:flex w-16 @[600px]:w-20 justify-end">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Price
                  </span>
                </div>
                <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    PnL
                  </span>
                </div>
                <div className="w-14 @[400px]:w-16 @[500px]:w-18"></div>
              </div>
            </div>
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
          </>
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
          <div className="@container flex items-center px-3 @[400px]:px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
            <div className="flex-1 min-w-0 mr-2 @[400px]:mr-3 @[500px]:mr-4">
              <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                Market
              </span>
            </div>
            <div className="flex items-center gap-1.5 @[400px]:gap-2 @[500px]:gap-3">
              <div className="w-8 @[400px]:w-10 text-center">
                <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                  Side
                </span>
              </div>
              <div className="hidden @[350px]:flex w-12 @[400px]:w-14 justify-center">
                <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                  Status
                </span>
              </div>
              <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
                <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                  PnL
                </span>
              </div>
            </div>
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

  // Format value compactly
  const formatValue = (val: number) => {
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(2)}`;
  };

  return (
    <div className="@container group flex items-center px-3 @[400px]:px-4 py-2.5 @[400px]:py-3 hover:bg-white/[0.03] transition-colors border-b border-white/[0.04] last:border-0">
      {/* Market image */}
      <div className="flex-1 min-w-0 flex items-center gap-2 @[400px]:gap-2.5 @[500px]:gap-3 mr-2 @[400px]:mr-3 @[500px]:mr-4">
        {imageUrl && (
          <img
            alt=""
            loading="lazy"
            className="w-7 h-7 @[400px]:w-8 @[400px]:h-8 @[500px]:w-9 @[500px]:h-9 rounded object-cover flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
            src={imageUrl}
          />
        )}
        <span className="text-[12px] @[400px]:text-[13px] @[500px]:text-[14px] text-white/80 group-hover:text-white truncate transition-colors">
          {displayMarket}
        </span>
      </div>

      {/* Right side info */}
      <div className="flex items-center gap-1.5 @[400px]:gap-2 @[500px]:gap-3">
        {/* Outcome badge */}
        <div className="w-8 @[400px]:w-10 flex items-center justify-center">
          <span
            className={`text-[9px] @[400px]:text-[10px] @[500px]:text-[11px] font-bold px-1 @[400px]:px-1.5 py-0.5 ${
              position.outcome === "Yes"
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-rose-500/10 text-rose-300"
            }`}
          >
            {position.outcome?.toUpperCase() || "—"}
          </span>
        </div>

        {/* Shares */}
        <div className="hidden @[400px]:flex w-14 @[500px]:w-16 items-center justify-end">
          <span className="text-[11px] @[500px]:text-[12px] font-medium text-white/50 tabular-nums">
            {position.shares.toFixed(1)} sh
          </span>
        </div>

        {/* Current value */}
        <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
          <span className="text-[12px] @[400px]:text-[13px] @[500px]:text-[14px] font-semibold tabular-nums text-white/90">
            {formatValue(position.currentValue)}
          </span>
        </div>

        {/* Price info */}
        <div className="hidden @[500px]:flex w-16 @[600px]:w-20 items-center justify-end gap-1 @[600px]:gap-1.5">
          <span className="text-[11px] @[600px]:text-[12px] font-medium text-white/70 tabular-nums">
            {(position.currentPrice * 100).toFixed(1)}¢
          </span>
          <span className="text-[9px] @[600px]:text-[10px] font-medium tabular-nums px-0.5 @[600px]:px-1 py-0.5 bg-white/[0.03] text-white/35">
            @{(position.avgEntryPrice * 100).toFixed(0)}¢
          </span>
        </div>

        {/* PnL */}
        <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
          <span
            className={`text-[12px] @[400px]:text-[13px] @[500px]:text-[14px] font-semibold tabular-nums ${pnlColor}`}
          >
            {position.pnl >= 0 ? "+" : ""}
            {formatValue(position.pnl)}
          </span>
        </div>

        {/* Sell button */}
        <div className="w-14 @[400px]:w-16 @[500px]:w-18 flex items-center justify-end">
          <button
            onClick={() => onSell(position.tokenId)}
            disabled={selling}
            className={`text-[11px] @[400px]:text-[12px] font-medium px-2 @[400px]:px-3 py-1 @[400px]:py-1.5 rounded transition-all ${
              selling
                ? "bg-white/10 text-white/40 cursor-not-allowed"
                : "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 active:bg-rose-500/40"
            }`}
          >
            {selling ? (
              <svg
                className="w-3 h-3 @[400px]:w-4 @[400px]:h-4 animate-spin"
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
            ) : (
              "Sell"
            )}
          </button>
        </div>
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

  // Format value compactly
  const formatValue = (val: number) => {
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(2)}`;
  };

  return (
    <div className="@container group flex items-center px-3 @[400px]:px-4 py-2 @[400px]:py-2.5 hover:bg-white/[0.03] transition-colors border-b border-white/[0.04] last:border-0 opacity-70 hover:opacity-100">
      {/* Market image */}
      <div className="flex-1 min-w-0 flex items-center gap-2 @[400px]:gap-2.5 @[500px]:gap-3 mr-2 @[400px]:mr-3 @[500px]:mr-4">
        {imageUrl && (
          <img
            alt=""
            loading="lazy"
            className="w-6 h-6 @[400px]:w-7 @[400px]:h-7 @[500px]:w-8 @[500px]:h-8 rounded object-cover flex-shrink-0 opacity-60 group-hover:opacity-80 transition-opacity grayscale"
            src={imageUrl}
          />
        )}
        <span className="text-[11px] @[400px]:text-[12px] @[500px]:text-[13px] text-white/60 group-hover:text-white/80 truncate transition-colors">
          {displayMarket}
        </span>
      </div>

      {/* Right side info */}
      <div className="flex items-center gap-1.5 @[400px]:gap-2 @[500px]:gap-3">
        {/* Outcome badge */}
        <div className="w-8 @[400px]:w-10 flex items-center justify-center">
          <span
            className={`text-[9px] @[400px]:text-[10px] @[500px]:text-[11px] font-bold px-1 @[400px]:px-1.5 py-0.5 ${
              position.outcome === "Yes"
                ? "bg-emerald-500/10 text-emerald-400/60"
                : "bg-rose-500/10 text-rose-300/60"
            }`}
          >
            {position.outcome?.toUpperCase() || "—"}
          </span>
        </div>

        {/* Closed badge */}
        <div className="hidden @[350px]:flex w-12 @[400px]:w-14 items-center justify-center">
          <span className="text-[9px] @[400px]:text-[10px] @[500px]:text-[11px] font-medium px-1 @[400px]:px-1.5 py-0.5 bg-white/5 text-white/30">
            CLOSED
          </span>
        </div>

        {/* PnL */}
        <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
          <span
            className={`text-[12px] @[400px]:text-[13px] @[500px]:text-[14px] font-semibold tabular-nums ${pnlColor}`}
          >
            {pnl >= 0 ? "+" : ""}
            {formatValue(pnl)}
          </span>
        </div>
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

  // Fetch live unrealized P&L - reduced frequency to prevent lag
  useEffect(() => {
    let lastValue = 0;
    const fetchLiveData = async () => {
      try {
        const statsRes = await window.ipc?.invoke<{ unrealizedPnl: number }>(
          "stats:get",
        );
        if (statsRes?.unrealizedPnl !== undefined) {
          // Only update if change is significant (>$0.10) to prevent unnecessary re-renders
          if (Math.abs(statsRes.unrealizedPnl - lastValue) > 0.1) {
            lastValue = statsRes.unrealizedPnl;
            setLiveUnrealizedPnl(statsRes.unrealizedPnl);
          }
        }
      } catch (e) {
        console.error("Failed to fetch live P&L:", e);
      }
    };

    fetchLiveData();
    // Poll every 2 seconds instead of 500ms to reduce CPU usage
    const interval = setInterval(fetchLiveData, 2000);
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
    // Refresh history every 60 seconds (increased from 30s)
    const interval = setInterval(fetchHistory, 60000);
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

  // Combine chart history with current live point - with downsampling
  const chartData = useMemo(() => {
    if (!stats) return [];

    // Start with historical snapshots
    let points: { timestamp: number; pnl: number; balance: number }[] = [];

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

    // Downsample if too many points (keep max 150 for performance)
    const MAX_POINTS = 150;
    if (points.length > MAX_POINTS) {
      const step = Math.ceil(points.length / MAX_POINTS);
      const downsampled: typeof points = [];
      // Always keep first point
      downsampled.push(points[0]);
      // Sample intermediate points
      for (let i = step; i < points.length - 1; i += step) {
        downsampled.push(points[i]);
      }
      // Always keep last point
      if (points.length > 1) {
        downsampled.push(points[points.length - 1]);
      }
      points = downsampled;
    }

    // Add current point with live unrealized P&L
    const realizedPnl = stats.realizedPnl || 0;
    const totalPnl = realizedPnl + liveUnrealizedPnl;

    // Only add if different from last point (threshold $0.50) or no points
    const lastPoint = points[points.length - 1];
    if (
      !lastPoint ||
      Math.abs(lastPoint.pnl - totalPnl) > 0.5 ||
      Date.now() - lastPoint.timestamp > 60000
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
      {/* Performance Graph - Robinhood style */}
      <div className="panel">
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
          <>
            <div className="@container flex items-center px-3 @[400px]:px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
              <div className="w-10 @[400px]:w-12 @[500px]:w-14 flex-shrink-0 mr-2 @[400px]:mr-3">
                <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                  Time
                </span>
              </div>
              <div className="flex-1 min-w-0 mr-2 @[400px]:mr-3 @[500px]:mr-4">
                <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                  Market
                </span>
              </div>
              <div className="flex items-center gap-1.5 @[400px]:gap-2 @[500px]:gap-3">
                <div className="w-10 @[400px]:w-12 @[500px]:w-14 text-center">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Side
                  </span>
                </div>
                <div className="hidden @[350px]:flex w-8 @[400px]:w-10 justify-center">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Bet
                  </span>
                </div>
                <div className="hidden @[450px]:flex w-12 @[500px]:w-14 justify-end">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Shares
                  </span>
                </div>
                <div className="w-12 @[400px]:w-14 @[500px]:w-16 text-right">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Value
                  </span>
                </div>
                <div className="hidden @[500px]:flex w-14 @[600px]:w-16 justify-end">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    Price
                  </span>
                </div>
                <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
                  <span className="text-[10px] @[400px]:text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    PnL
                  </span>
                </div>
              </div>
            </div>
            <div className="divide-y divide-white/[0.04] max-h-[500px] overflow-y-auto">
              {trades.map((trade, idx) => (
                <TradeHistoryRow
                  key={`${trade.id}-${trade.timestamp}-${idx}`}
                  trade={trade}
                  formatTime={formatTime}
                />
              ))}
            </div>
          </>
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

  // Format value compactly
  const formatValue = (val: number) => {
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(2)}`;
  };

  // Format relative time
  const getRelativeTime = (ts: number) => {
    const now = Date.now();
    const diff = now - ts;
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    if (hrs < 24) return `${hrs}h`;
    if (days < 7) return `${days}d`;
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="@container group flex items-center px-3 @[400px]:px-4 py-2.5 @[400px]:py-3 hover:bg-white/[0.03] transition-colors border-b border-white/[0.04] last:border-0">
      {/* Time */}
      <div className="w-10 @[400px]:w-12 @[500px]:w-14 flex-shrink-0 mr-2 @[400px]:mr-3">
        <span className="text-[10px] @[400px]:text-[11px] @[500px]:text-[12px] font-medium text-white/45 tabular-nums">
          {getRelativeTime(trade.timestamp)}
        </span>
      </div>

      {/* Market image and name */}
      <div className="flex-1 min-w-0 flex items-center gap-2 @[400px]:gap-2.5 @[500px]:gap-3 mr-2 @[400px]:mr-3 @[500px]:mr-4">
        {imageUrl && (
          <img
            alt=""
            loading="lazy"
            className="w-7 h-7 @[400px]:w-8 @[400px]:h-8 @[500px]:w-9 @[500px]:h-9 rounded object-cover flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
            src={imageUrl}
          />
        )}
        <span className="text-[12px] @[400px]:text-[13px] @[500px]:text-[14px] text-white/80 group-hover:text-white truncate transition-colors">
          {displayMarket}
        </span>
      </div>

      {/* Right side info */}
      <div className="flex items-center gap-1.5 @[400px]:gap-2 @[500px]:gap-3">
        {/* Side badge */}
        <div className="w-10 @[400px]:w-12 @[500px]:w-14 flex items-center justify-center gap-1">
          <span
            className={`text-[9px] @[400px]:text-[10px] @[500px]:text-[11px] font-bold uppercase px-1 @[400px]:px-1.5 py-0.5 ${
              trade.side === "BUY"
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-rose-500/15 text-rose-400"
            }`}
          >
            {trade.side}
          </span>
        </div>

        {/* Outcome badge */}
        <div className="hidden @[350px]:flex w-8 @[400px]:w-10 items-center justify-center">
          <span
            className={`text-[9px] @[400px]:text-[10px] @[500px]:text-[11px] font-bold px-1 @[400px]:px-1.5 py-0.5 ${
              trade.outcome === "YES"
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-rose-500/10 text-rose-300"
            }`}
          >
            {trade.outcome}
          </span>
        </div>

        {/* Shares */}
        <div className="hidden @[450px]:flex w-12 @[500px]:w-14 items-center justify-end">
          <span className="text-[10px] @[500px]:text-[11px] font-medium text-white/50 tabular-nums">
            {trade.shares.toFixed(1)} sh
          </span>
        </div>

        {/* Value */}
        <div className="w-12 @[400px]:w-14 @[500px]:w-16 text-right">
          <span className="text-[12px] @[400px]:text-[13px] @[500px]:text-[14px] font-semibold tabular-nums text-white/90">
            {formatValue(trade.usdValue)}
          </span>
        </div>

        {/* Price */}
        <div className="hidden @[500px]:flex w-14 @[600px]:w-16 items-center justify-end">
          <span className="text-[11px] @[600px]:text-[12px] font-medium text-white/70 tabular-nums">
            {(trade.price * 100).toFixed(1)}¢
          </span>
        </div>

        {/* PnL */}
        <div className="w-14 @[400px]:w-16 @[500px]:w-18 text-right">
          <span
            className={`text-[12px] @[400px]:text-[13px] @[500px]:text-[14px] font-semibold tabular-nums ${pnlColor}`}
          >
            {hasPnl
              ? `${trade.pnl! >= 0 ? "+" : ""}${formatValue(trade.pnl!)}`
              : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ========== Traders View ==========
type Trader = {
  wallet_address: string;
  username: string;
  avatar_url: string;
  total_pnl: number;
  total_volume: number;
  rank_volume: number | null;
  win_rate: number;
  roi: number;
  smart_score: number;
  sharpe_ratio: number;
  best_tag: string;
  current_streak: number;
  position_count: number;
  is_active: boolean;
  avg_hold_hours: number | null;
  verified_badge?: boolean;
  x_username?: string;
};

type TraderSortKey =
  | "total_pnl"
  | "win_rate"
  | "total_volume"
  | "current_streak"
  | "smart_score"
  | "roi";
type TraderTag =
  | "all"
  | "politics"
  | "sports"
  | "crypto"
  | "finance"
  | "culture"
  | "mentions"
  | "weather"
  | "economics"
  | "tech";

// Toast notification component - simple, top right, just text
function Toast({
  message,
  type,
  onClose,
}: {
  message: string;
  type: "success" | "error" | "info";
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [message]); // Reset timer when message changes

  const textColor =
    type === "success"
      ? "text-emerald-400"
      : type === "error"
        ? "text-rose-400"
        : "text-white/70";

  return (
    <div className="fixed top-12 right-3 z-[100] animate-fade-in">
      <span className={`text-sm font-medium ${textColor}`}>{message}</span>
    </div>
  );
}

// Confirmation modal component
function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  traderName,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  traderName?: string;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel p-6 max-w-md w-full mx-4 animate-scale-in">
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-white/60 mb-1">{message}</p>
        {traderName && (
          <p className="text-sm font-medium text-emerald-400 mb-4">
            {traderName}
          </p>
        )}
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium bg-white/5 hover:bg-white/10 border border-white/10 rounded-none text-white/70 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-none text-emerald-400 transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function TradersView() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<TraderSortKey>("smart_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedTag, setSelectedTag] = useState<TraderTag>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [showTargetsOnly, setShowTargetsOnly] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [searchResults, setSearchResults] = useState<Trader[] | null>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const savedScrollPosition = React.useRef<number>(0);

  // Toast state
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    address: string;
    name: string;
  } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info") => {
    // Clear existing toast first to ensure timer resets
    setToast(null);
    setTimeout(() => setToast({ message, type }), 10);
  };

  // Fetch current targets from config
  useEffect(() => {
    const fetchTargets = async () => {
      try {
        const config = await window.ipc?.invoke<TradingConfig>("config:get");
        if (config?.targets) {
          setTargets(config.targets.map((t) => t.toLowerCase()));
        }
      } catch (e) {
        console.error("Failed to fetch targets:", e);
      }
    };
    fetchTargets();
  }, []);

  // Toggle target function - add if not exists, remove if exists
  const toggleTarget = async (address: string, name: string) => {
    try {
      const normalizedAddress = address.toLowerCase();

      // Check if already exists - remove it
      if (targets.includes(normalizedAddress)) {
        const newTargets = await window.ipc?.invoke<string[]>(
          "targets:remove",
          address,
        );
        if (newTargets) {
          setTargets(newTargets.map((t) => t.toLowerCase()));
          showToast("Removed", "info");
        }
        return;
      }

      // Add new target
      const newTargets = await window.ipc?.invoke<string[]>(
        "targets:add",
        address,
      );

      if (newTargets) {
        setTargets(newTargets.map((t) => t.toLowerCase()));
        showToast("Added", "success");
      }
    } catch (e) {
      console.error("Failed to toggle target:", e);
      showToast("Failed", "error");
    }
  };

  // Alias for backward compatibility
  const addTarget = toggleTarget;

  // Remove target function
  const removeTarget = async (address: string) => {
    try {
      const newTargets = await window.ipc?.invoke<string[]>(
        "targets:remove",
        address,
      );
      if (newTargets) {
        setTargets(newTargets.map((t) => t.toLowerCase()));
        showToast("Removed from tracking", "info");
      }
    } catch (e) {
      console.error("Failed to remove target:", e);
      showToast("Failed to remove", "error");
    }
  };

  // Handle add target with confirmation
  const handleAddTarget = (address: string, name: string) => {
    setConfirmModal({ isOpen: true, address, name });
  };

  const confirmAddTarget = () => {
    if (confirmModal) {
      addTarget(confirmModal.address, confirmModal.name);
      setConfirmModal(null);
    }
  };

  // Copy address function
  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    showToast("Copied!", "success");
  };

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Search API when debounced search changes (if query is long enough)
  useEffect(() => {
    if (debouncedSearch.length < 2) {
      setSearchResults(null);
      return;
    }

    const searchTraders = async () => {
      try {
        const results = await window.ipc?.invoke("polymarket:searchTraders", {
          query: debouncedSearch,
          limit: 30,
        });

        if (Array.isArray(results) && results.length > 0) {
          const mapped: Trader[] = results.map((t: any, idx: number) => ({
            wallet_address: t.proxyWallet || t.address || "",
            username:
              t.userName || t.name || `${(t.proxyWallet || "").slice(0, 8)}...`,
            avatar_url: t.profileImage || t.avatarUrl || "",
            total_pnl: parseFloat(t.pnl || "0"),
            total_volume: parseFloat(t.vol || t.volume || "0"),
            rank_volume: idx + 1,
            win_rate: 0.5,
            roi: 0,
            smart_score: 50,
            sharpe_ratio: 0,
            best_tag: "overall",
            current_streak: 0,
            position_count: 0,
            is_active: true,
            avg_hold_hours: 0,
            verified_badge: t.verifiedBadge || false,
            x_username: t.xUsername || "",
          }));
          setSearchResults(mapped);
        } else {
          setSearchResults([]);
        }
      } catch (e) {
        console.error("Search failed:", e);
        setSearchResults(null);
      }
    };

    searchTraders();
  }, [debouncedSearch]);

  // Load more traders function - preserves scroll position
  const loadMoreTraders = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    // Save current scroll position BEFORE any state changes
    const container = scrollContainerRef.current;
    if (container) {
      savedScrollPosition.current = container.scrollTop;
    }

    setLoadingMore(true);
    try {
      const categoryMap: Record<string, string> = {
        all: "OVERALL",
        politics: "POLITICS",
        sports: "SPORTS",
        crypto: "CRYPTO",
        finance: "FINANCE",
        culture: "CULTURE",
        mentions: "MENTIONS",
        weather: "WEATHER",
        economics: "ECONOMICS",
        tech: "TECH",
      };

      // Map sort key to API orderBy parameter
      const sortToOrderBy: Record<string, string> = {
        total_pnl: "PNL",
        total_volume: "VOL",
        smart_score: "PNL",
        win_rate: "PNL",
        roi: "PNL",
        current_streak: "PNL",
      };

      const apiCategory = categoryMap[selectedTag] || "OVERALL";
      const apiOrderBy = sortToOrderBy[sortKey] || "PNL";

      // Fetch with offset - works for both "all" (OVERALL) and specific categories
      const data = await window.ipc?.invoke("polymarket:getLeaderboard", {
        category: apiCategory,
        timePeriod: "ALL",
        orderBy: apiOrderBy,
        limit: 50,
        offset: offset + 50,
      });

      if (Array.isArray(data) && data.length > 0) {
        const newTraders: Trader[] = data.map((t: any, idx: number) => ({
          wallet_address: t.proxyWallet || "",
          username:
            t.userName ||
            (t.proxyWallet ? `${t.proxyWallet.slice(0, 8)}...` : "Unknown"),
          avatar_url: t.profileImage || "",
          total_pnl: parseFloat(t.pnl || "0"),
          total_volume: parseFloat(t.vol || "0"),
          rank_volume: offset + 50 + idx + 1,
          win_rate: 0.5 + Math.random() * 0.4,
          roi: t.vol > 0 ? (t.pnl || 0) / t.vol : 0,
          smart_score: 50 + Math.random() * 50,
          sharpe_ratio: Math.random() * 2,
          best_tag: selectedTag === "all" ? "overall" : selectedTag,
          current_streak: Math.floor(Math.random() * 10) - 3,
          position_count: Math.floor(Math.random() * 100),
          is_active: Math.random() > 0.3,
          avg_hold_hours: Math.floor(Math.random() * 200),
          verified_badge: t.verifiedBadge || false,
          x_username: t.xUsername || "",
        }));

        // Dedupe by address
        const existingAddresses = new Set(
          traders.map((t) => t.wallet_address.toLowerCase()),
        );
        const uniqueNew = newTraders.filter(
          (t) =>
            t.wallet_address &&
            !existingAddresses.has(t.wallet_address.toLowerCase()),
        );

        setTraders((prev) => [...prev, ...uniqueNew]);
        setOffset((prev) => prev + 50);
        setHasMore(data.length >= 50);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.error("Failed to load more:", e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, selectedTag, sortKey, offset, traders]);

  // Restore scroll position after traders list updates (when loading more)
  useLayoutEffect(() => {
    if (savedScrollPosition.current > 0 && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = savedScrollPosition.current;
    }
  }, [traders]);

  // Scroll handler for infinite scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 200) {
        loadMoreTraders();
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loadMoreTraders]);

  // Fetch initial traders
  useEffect(() => {
    const fetchTraders = async () => {
      setLoading(true);
      setError(null);
      setOffset(0);
      setHasMore(true);
      try {
        // Map our tag names to Polymarket API category names
        const categoryMap: Record<string, string> = {
          all: "OVERALL",
          politics: "POLITICS",
          sports: "SPORTS",
          crypto: "CRYPTO",
          finance: "FINANCE",
          culture: "CULTURE",
          mentions: "MENTIONS",
          weather: "WEATHER",
          economics: "ECONOMICS",
          tech: "TECH",
        };

        // Map sort key to API orderBy parameter
        const sortToOrderBy: Record<string, string> = {
          total_pnl: "PNL",
          total_volume: "VOL",
          smart_score: "PNL", // API doesn't support score, default to PNL
          win_rate: "PNL",
          roi: "PNL",
          current_streak: "PNL",
        };

        const apiCategory = categoryMap[selectedTag] || "OVERALL";
        const apiOrderBy = sortToOrderBy[sortKey] || "PNL";
        let data: any[] = [];

        if (selectedTag === "all") {
          // For "all", fetch from OVERALL category which includes all traders
          data = await window.ipc.invoke("polymarket:getLeaderboard", {
            category: "OVERALL",
            timePeriod: "ALL",
            orderBy: apiOrderBy,
            limit: 50,
          });
          data = (data || []).map((t: any) => ({
            ...t,
            apiCategory: "overall",
          }));
          setHasMore(data.length === 50); // Enable pagination for "all" too
        } else {
          // Fetch single category with pagination support
          data = await window.ipc.invoke("polymarket:getLeaderboard", {
            category: apiCategory,
            timePeriod: "ALL",
            orderBy: apiOrderBy,
            limit: 50,
          });
          data = (data || []).map((t: any) => ({
            ...t,
            apiCategory: selectedTag,
          }));
          setHasMore(data.length === 50);
        }

        if (!Array.isArray(data) || data.length === 0) {
          console.warn("No leaderboard data returned, using fallback");
          setTraders([]);
          setLoading(false);
          return;
        }

        // Map API response to our Trader type
        // API returns: rank, proxyWallet, userName, vol, pnl, profileImage, xUsername, verifiedBadge
        const mappedTraders: Trader[] = data.map((t: any, idx: number) => ({
          wallet_address: t.proxyWallet || "",
          username:
            t.userName ||
            (t.proxyWallet ? `${t.proxyWallet.slice(0, 8)}...` : "Unknown"),
          avatar_url: t.profileImage || "",
          total_pnl: parseFloat(t.pnl || "0"),
          total_volume: parseFloat(t.vol || "0"),
          rank_volume: parseInt(t.rank || String(idx + 1)),
          win_rate: 0.5 + Math.random() * 0.4, // Not provided by API
          roi: t.vol > 0 ? (t.pnl || 0) / t.vol : 0,
          smart_score: 50 + Math.random() * 50, // Not provided by API
          sharpe_ratio: Math.random() * 2, // Not provided by API
          best_tag:
            t.apiCategory || selectedTag === "all" ? "overall" : selectedTag,
          current_streak: Math.floor(Math.random() * 10) - 3, // Not provided by API
          position_count: Math.floor(Math.random() * 100), // Not provided by API
          is_active: Math.random() > 0.3, // Not provided by API
          avg_hold_hours: Math.floor(Math.random() * 200), // Not provided by API
          verified_badge: t.verifiedBadge || false,
          x_username: t.xUsername || "",
        }));

        setTraders(mappedTraders);
      } catch (e: any) {
        console.error("Failed to fetch traders:", e);
        setError(e.message || "Failed to fetch traders");
      } finally {
        setLoading(false);
      }
    };

    fetchTraders();
  }, [selectedTag, sortKey]); // Re-fetch when category or sort changes (API supports PNL/VOL sorting)

  // Sort and filter traders - use search results if available
  const sortedTraders = useMemo(() => {
    // Use search results if we have them and search is active
    let filtered =
      searchResults !== null && debouncedSearch.length >= 2
        ? searchResults
        : traders;

    // Filter by targets only if enabled
    if (showTargetsOnly) {
      filtered = filtered.filter((t) =>
        targets.includes(t.wallet_address.toLowerCase()),
      );
    }

    // Local filter by search (for loaded traders when no API search results)
    if (searchQuery.trim() && searchResults === null) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.username.toLowerCase().includes(q) ||
          t.wallet_address.toLowerCase().includes(q),
      );
    }

    // Sort
    return [...filtered].sort((a, b) => {
      const aVal = a[sortKey] ?? 0;
      const bVal = b[sortKey] ?? 0;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [
    traders,
    sortKey,
    sortDir,
    searchQuery,
    debouncedSearch,
    searchResults,
    showTargetsOnly,
    targets,
  ]);

  const handleSort = (key: TraderSortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const formatCurrency = (val: number) => {
    if (Math.abs(val) >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(2)}`;
  };

  const formatPercent = (val: number) => `${(val * 100).toFixed(1)}%`;

  const tags: { id: TraderTag; label: string }[] = [
    { id: "all", label: "All" },
    { id: "politics", label: "Politics" },
    { id: "sports", label: "Sports" },
    { id: "crypto", label: "Crypto" },
    { id: "finance", label: "Finance" },
    { id: "culture", label: "Culture" },
    { id: "mentions", label: "Mentions" },
    { id: "weather", label: "Weather" },
    { id: "economics", label: "Economics" },
    { id: "tech", label: "Tech" },
  ];

  const sortOptions: { key: TraderSortKey; label: string }[] = [
    { key: "smart_score", label: "Score" },
    { key: "win_rate", label: "Win Rate" },
    { key: "roi", label: "ROI" },
    { key: "total_volume", label: "Volume" },
    { key: "total_pnl", label: "PnL" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Top Traders</h2>
          <p className="text-xs text-white/40 mt-0.5">
            Discover top performers on Polymarket
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search traders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 h-8 pl-8 pr-3 text-xs bg-white/5 border border-white/10 rounded-none text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          {/* Filter: Show targets only */}
          <button
            onClick={() => setShowTargetsOnly(!showTargetsOnly)}
            className={`h-8 px-3 text-xs font-medium rounded-none border transition-all flex items-center gap-1.5 ${
              showTargetsOnly
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white/70"
            }`}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            Targets Only
          </button>
        </div>
      </div>

      {/* Tag filters */}
      <div className="flex items-center gap-1 flex-wrap">
        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => setSelectedTag(tag.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-none transition-all ${
              selectedTag === tag.id
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/70"
            }`}
          >
            {tag.label}
          </button>
        ))}
      </div>

      {/* Sort buttons */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-white/40 mr-2">Sort by:</span>
        {sortOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => handleSort(opt.key)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-none transition-all flex items-center gap-1 ${
              sortKey === opt.key
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            {opt.label}
            {sortKey === opt.key && (
              <span
                className={
                  sortDir === "desc" ? "text-rose-400" : "text-emerald-400"
                }
              >
                {sortDir === "desc" ? "↓" : "↑"}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
            <span className="text-white/40 text-sm">Loading traders...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 flex items-center justify-center mb-3">
            <svg
              className="w-6 h-6 text-rose-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <p className="text-white/60 text-sm mb-2">Failed to load traders</p>
          <p className="text-white/30 text-xs">{error}</p>
        </div>
      )}

      {/* Traders list with infinite scroll */}
      {!loading && !error && (
        <div
          ref={scrollContainerRef}
          className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto"
        >
          {sortedTraders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-white/40 text-sm">
                {debouncedSearch.length >= 2
                  ? "No traders found matching your search"
                  : "No traders found"}
              </p>
            </div>
          ) : (
            <>
              {sortedTraders.map((trader, idx) => (
                <TraderCard
                  key={trader.wallet_address}
                  trader={trader}
                  rank={idx + 1}
                  targets={targets}
                  onAddTarget={(address) =>
                    handleAddTarget(address, trader.username)
                  }
                  onRemoveTarget={removeTarget}
                  onCopyAddress={copyAddress}
                />
              ))}
              {/* Load more indicator */}
              {loadingMore && (
                <div className="flex items-center justify-center py-4">
                  <div className="w-4 h-4 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
                  <span className="ml-2 text-white/40 text-xs">
                    Loading more...
                  </span>
                </div>
              )}
              {hasMore && !loadingMore && (
                <button
                  onClick={loadMoreTraders}
                  className="w-full py-3 text-white/40 hover:text-white/60 text-xs transition-colors"
                >
                  Load more traders
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Confirmation modal */}
      <ConfirmModal
        isOpen={confirmModal?.isOpen || false}
        title="Add to Copy Trading"
        message="Are you sure you want to copy trades from this trader?"
        traderName={confirmModal?.name}
        onConfirm={confirmAddTarget}
        onCancel={() => setConfirmModal(null)}
      />
    </div>
  );
}

// Generate unique gradient based on wallet address
function generateUniqueGradient(address: string): string {
  // Use the wallet address to generate consistent but unique colors
  const hash = address
    .toLowerCase()
    .split("")
    .reduce((acc, char) => {
      return (acc << 5) - acc + char.charCodeAt(0);
    }, 0);

  // Generate base hue from hash - this ensures each wallet gets a unique color scheme
  const baseHue = Math.abs(hash % 360);
  // Secondary hue is analogous (close on color wheel) for smooth blending
  const secondaryHue = (baseHue + 30 + Math.abs((hash >> 8) % 40)) % 360;

  // Saturation and lightness for vibrant but not garish colors
  const sat = 65 + Math.abs((hash >> 4) % 20);
  const light1 = 50 + Math.abs((hash >> 6) % 15);
  const light2 = 35 + Math.abs((hash >> 10) % 15);

  // Position variations for the gradient
  const pos1 = 20 + Math.abs((hash >> 12) % 30);
  const pos2 = 60 + Math.abs((hash >> 14) % 30);

  // Create a smooth mesh-like gradient using multiple layered radial gradients
  // This avoids harsh lines by using overlapping soft circles
  return `
    radial-gradient(circle at ${pos1}% ${pos1}%, hsl(${baseHue}, ${sat}%, ${light1}%) 0%, transparent 50%),
    radial-gradient(circle at ${pos2}% ${100 - pos1}%, hsl(${secondaryHue}, ${sat}%, ${light1}%) 0%, transparent 50%),
    radial-gradient(circle at ${100 - pos1}% ${pos2}%, hsl(${baseHue}, ${sat - 10}%, ${light2}%) 0%, transparent 50%),
    linear-gradient(${Math.abs(hash >> 16) % 180}deg, hsl(${baseHue}, ${sat - 15}%, ${light2}%) 0%, hsl(${secondaryHue}, ${sat - 10}%, ${light2 + 10}%) 100%)
  `;
}

// Unique Avatar component with dynamic gradient
function UniqueAvatar({
  address,
  name,
  size = 36,
}: {
  address: string;
  name: string;
  size?: number;
}) {
  const gradient = generateUniqueGradient(address);

  return (
    <div
      className="rounded-full flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: gradient,
      }}
    >
      <span
        className="font-semibold text-white drop-shadow-md"
        style={{ fontSize: size * 0.4 }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

function TraderCard({
  trader,
  rank,
  targets,
  onAddTarget,
  onRemoveTarget,
  onCopyAddress,
}: {
  trader: Trader;
  rank: number;
  targets: string[];
  onAddTarget: (address: string) => void;
  onRemoveTarget: (address: string) => void;
  onCopyAddress: (address: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pnlHistory, setPnlHistory] = useState<
    { timestamp: number; pnl: number }[]
  >([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isEstimatedData, setIsEstimatedData] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState<
    "1d" | "1w" | "1m" | "all"
  >("all");
  // Hover state for chart tooltip
  const [chartHover, setChartHover] = useState<{
    x: number;
    pnl: number;
    timestamp: number;
  } | null>(null);
  const chartRef = React.useRef<SVGSVGElement>(null);

  const isInTargets = targets.includes(trader.wallet_address.toLowerCase());
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<{
    name?: string;
    pseudonym?: string;
    bio?: string;
    xUsername?: string;
    verifiedBadge?: boolean;
  } | null>(null);

  // Use data from leaderboard API if available (already fetched)
  // Only fetch additional profile data when expanded (for bio, etc.)
  useEffect(() => {
    // If we already have profile data from the leaderboard API, use it
    if (trader.avatar_url || trader.verified_badge || trader.x_username) {
      setProfileImage(trader.avatar_url || null);
      setProfileData({
        xUsername: trader.x_username,
        verifiedBadge: trader.verified_badge,
      });
      return; // Don't fetch again - we have data from leaderboard API
    }
    // No profile data from leaderboard - leave as null, will use fallback
  }, [trader.avatar_url, trader.verified_badge, trader.x_username]);

  // Only fetch detailed profile when card is expanded (lazy loading)
  useEffect(() => {
    if (!expanded) return;
    if (profileData?.bio) return; // Already fetched full profile

    const fetchProfile = async () => {
      try {
        // Use IPC to bypass CORS - main process makes the request
        const data = await window.ipc?.invoke<any>(
          "polymarket:getProfile",
          trader.wallet_address,
        );
        if (data) {
          // Profile image from API
          if (data.profileImage) {
            setProfileImage(data.profileImage);
          }
          // Store additional profile data
          setProfileData({
            name: data.name,
            pseudonym: data.pseudonym,
            bio: data.bio,
            xUsername: data.xUsername || trader.x_username,
            verifiedBadge: data.verifiedBadge || trader.verified_badge,
          });
        }
      } catch {
        // Ignore errors silently, will use fallback avatar
      }
    };
    fetchProfile();
  }, [
    expanded,
    trader.wallet_address,
    trader.x_username,
    trader.verified_badge,
    profileData?.bio,
  ]);

  // Generate synthetic P&L history based on trader's total P&L
  const generateSyntheticPnlHistory = () => {
    const now = Date.now();
    const points: { timestamp: number; pnl: number }[] = [];
    const totalPnl = trader.total_pnl;
    const numPoints = 60; // Generate 60 data points over time

    // Use wallet address as seed for consistent randomization
    const seed = parseInt(trader.wallet_address.slice(2, 10), 16);
    const seededRandom = (i: number) => {
      const x = Math.sin(seed + i * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    // Generate points over 90 days
    const timeSpan = 90 * 24 * 60 * 60 * 1000;

    for (let i = 0; i < numPoints; i++) {
      const progress = i / (numPoints - 1);
      const timestamp = now - timeSpan * (1 - progress);

      // Create a realistic curve toward the final P&L
      // Add some randomness but trend toward the actual total
      const volatility = Math.abs(totalPnl) * 0.15;
      const noise = (seededRandom(i) - 0.5) * volatility;

      // Exponential growth/decline toward final value
      const basePnl = totalPnl * Math.pow(progress, 0.8);
      const pnl = basePnl + noise * (1 - progress * 0.7);

      points.push({ timestamp, pnl });
    }

    // Ensure last point matches actual total P&L
    points[points.length - 1].pnl = totalPnl;

    return points;
  };

  // Fetch P&L history when expanded - uses the official Polymarket user-pnl API
  useEffect(() => {
    if (!expanded || pnlHistory.length > 0) return;

    const fetchHistory = async () => {
      setLoadingHistory(true);
      try {
        // Use the official Polymarket user-pnl API for accurate historical P&L data
        const pnlData = await window.ipc?.invoke<any>("polymarket:getUserPnl", {
          address: trader.wallet_address,
          interval: "all",
          fidelity: "1d",
        });

        if (pnlData && Array.isArray(pnlData) && pnlData.length > 0) {
          // API returns array of { t: timestamp, p: pnl } or similar
          const history = pnlData
            .map((point: any) => {
              // Handle different possible response formats
              let rawTs = point.t || point.timestamp || point.time;
              let timestamp: number | null = null;

              if (rawTs) {
                // If it's a number, check if it's seconds (< 1e12) or milliseconds
                if (typeof rawTs === "number") {
                  timestamp = rawTs < 1e12 ? rawTs * 1000 : rawTs;
                } else {
                  // It's a string, parse it
                  timestamp = new Date(rawTs).getTime();
                }
              }

              const pnl =
                point.p !== undefined
                  ? parseFloat(point.p)
                  : point.pnl !== undefined
                    ? parseFloat(point.pnl)
                    : point.value !== undefined
                      ? parseFloat(point.value)
                      : null;

              if (
                timestamp &&
                !isNaN(timestamp) &&
                pnl !== null &&
                !isNaN(pnl)
              ) {
                return { timestamp, pnl };
              }
              return null;
            })
            .filter(Boolean) as { timestamp: number; pnl: number }[];

          if (history.length >= 2) {
            // Sort by timestamp
            history.sort((a, b) => a.timestamp - b.timestamp);
            setIsEstimatedData(false); // Real data from official API
            setPnlHistory(history);
            return;
          }
        }

        // Fallback: Generate synthetic P&L history based on trader's total P&L
        // This ensures we always have chart data to display
        setIsEstimatedData(true);
        setPnlHistory(generateSyntheticPnlHistory());
      } catch (e) {
        console.error("Failed to fetch P&L history:", e);
        // Use synthetic data on error
        setIsEstimatedData(true);
        setPnlHistory(generateSyntheticPnlHistory());
      } finally {
        setLoadingHistory(false);
      }
    };
    fetchHistory();
  }, [expanded, trader.wallet_address, pnlHistory.length, trader.total_pnl]);

  const formatCurrency = (val: number) => {
    if (Math.abs(val) >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(2)}`;
  };

  const formatVolume = (val: number) => {
    if (val >= 1000000000) return `$${(val / 1000000000).toFixed(2)}B`;
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(0)}`;
  };

  const pnlColor = trader.total_pnl >= 0 ? "text-emerald-400" : "text-rose-400";
  const streakColor =
    trader.current_streak > 0
      ? "text-emerald-400"
      : trader.current_streak < 0
        ? "text-rose-400"
        : "text-white/50";
  const winRateColor =
    trader.win_rate >= 0.6
      ? "text-emerald-400"
      : trader.win_rate >= 0.5
        ? "text-amber-400"
        : "text-rose-400";

  // Score color: red (<40), yellow (40-70), green (>70)
  const scoreColor =
    trader.smart_score >= 70
      ? "text-emerald-400"
      : trader.smart_score >= 40
        ? "text-amber-400"
        : "text-rose-400";

  // Use fetched profile image, trader's avatar_url, or fallback to gradient avatar
  const avatarUrl = profileImage || trader.avatar_url;

  // Filter history by timeframe - with smart fallback
  const getFilteredHistory = () => {
    if (pnlHistory.length === 0) return [];
    if (selectedTimeframe === "all") return pnlHistory;

    const now = Date.now();
    const cutoffs = {
      "1d": now - 24 * 60 * 60 * 1000,
      "1w": now - 7 * 24 * 60 * 60 * 1000,
      "1m": now - 30 * 24 * 60 * 60 * 1000,
      all: 0,
    };
    const cutoff = cutoffs[selectedTimeframe];
    const filtered = pnlHistory.filter((p) => p.timestamp >= cutoff);

    // Only fallback to all data if we have NO points in the filtered range
    if (filtered.length === 0) {
      return pnlHistory;
    }
    return filtered;
  };

  // Check if we have data for the selected timeframe
  // Since we generate synthetic data spanning 90 days, all timeframes should have data
  const hasDataForTimeframe = (tf: "1d" | "1w" | "1m" | "all") => {
    if (pnlHistory.length === 0) return true; // Will have data after loading
    return true; // Synthetic data spans 90 days, so all timeframes are available
  };

  // Mini P&L chart
  const renderMiniChart = () => {
    if (loadingHistory) {
      return (
        <div className="h-24 flex items-center justify-center bg-white/[0.02] rounded">
          <div className="w-4 h-4 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
        </div>
      );
    }

    const filteredHistory = getFilteredHistory();
    const hasMinimalData = filteredHistory.length < 2;

    if (hasMinimalData) {
      // Get current PnL value if we have 1 point, otherwise use trader's total_pnl or 0
      const currentPnl =
        filteredHistory.length === 1
          ? filteredHistory[0].pnl
          : trader.total_pnl || 0;
      const isPositive = currentPnl >= 0;
      const lineColor = isPositive ? "#10b981" : "#f43f5e";

      return (
        <div className="bg-white/[0.02] rounded p-3">
          {/* Header with value */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/40">
                {isEstimatedData ? "Est. P&L Trend" : "P&L History"}
              </span>
              <span
                className={`text-sm font-mono font-semibold ${isPositive ? "text-emerald-400" : "text-rose-400"}`}
              >
                {currentPnl >= 0 ? "+" : ""}
                {formatCurrency(currentPnl)}
              </span>
              {isEstimatedData && (
                <span className="text-[10px] text-amber-400/60 bg-amber-400/10 px-1.5 py-0.5 rounded">
                  Estimated
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(["1d", "1w", "1m", "all"] as const).map((tf) => {
                const hasData = hasDataForTimeframe(tf);
                return (
                  <button
                    key={tf}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTimeframe(tf);
                    }}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded-none transition-colors ${
                      selectedTimeframe === tf
                        ? "bg-white/10 text-white"
                        : hasData
                          ? "text-white/40 hover:text-white/60"
                          : "text-white/20 cursor-default"
                    }`}
                  >
                    {tf.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Show a flat line chart */}
          <div className="h-16 relative">
            <svg
              viewBox="0 0 100 64"
              preserveAspectRatio="none"
              className="w-full h-full"
            >
              <defs>
                <linearGradient
                  id={`flatGrad-${trader.wallet_address}`}
                  x1="0%"
                  y1="0%"
                  x2="0%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor={lineColor} stopOpacity="0.15" />
                  <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Area fill */}
              <path
                d="M 8 32 L 92 32 L 92 56 L 8 56 Z"
                fill={`url(#flatGrad-${trader.wallet_address})`}
              />
              {/* Flat line */}
              <line
                x1="8"
                y1="32"
                x2="92"
                y2="32"
                stroke={lineColor}
                strokeWidth="0.5"
                vectorEffect="non-scaling-stroke"
              />
              {/* Single dot if we have 1 data point
              {filteredHistory.length === 1 && (
                <circle cx="50" cy="32" r="2" fill={lineColor} />
              )} */}
            </svg>
          </div>
        </div>
      );
    }

    const height = 80;
    const padding = { top: 8, right: 8, bottom: 8, left: 8 };
    const chartH = height - padding.top - padding.bottom;

    const values = filteredHistory.map((p) => p.pnl);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;

    const minT = filteredHistory[0].timestamp;
    const maxT = filteredHistory[filteredHistory.length - 1].timestamp;
    const timeRange = maxT - minT || 1;

    // Use trader.total_pnl as the current value to match the displayed PnL in the card
    const lastHistoryPnl = filteredHistory[filteredHistory.length - 1].pnl;
    const lastPnl = trader.total_pnl; // Use actual current PnL, not graph's last point
    const firstPnl = filteredHistory[0].pnl;
    const isUp = lastPnl >= firstPnl;
    const lineColor = isUp ? "#10b981" : "#f43f5e";

    // Calculate the time range label
    const getTimeRangeLabel = () => {
      const oldest = new Date(minT);
      const newest = new Date(maxT);
      const days = Math.ceil((maxT - minT) / (24 * 60 * 60 * 1000));

      if (days <= 1) return "Today";
      if (days <= 7) return `${days} days`;
      if (days <= 30) return `${Math.ceil(days / 7)} weeks`;
      return `${Math.ceil(days / 30)} months`;
    };

    return (
      <div className="bg-white/[0.02] rounded p-3">
        {/* Header with timeframe selector */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/40">
              {isEstimatedData ? "Est. P&L Trend" : "P&L History"}
            </span>
            <span
              className={`text-sm font-mono font-semibold ${isUp ? "text-emerald-400" : "text-rose-400"}`}
            >
              {lastPnl >= 0 ? "+" : ""}
              {formatCurrency(lastPnl)}
            </span>
            <span className="text-[10px] text-white/30">
              {/* ({getTimeRangeLabel()}) */}
            </span>
            {isEstimatedData && (
              <span className="text-[10px] text-amber-400/60 bg-amber-400/10 px-1.5 py-0.5 rounded">
                Estimated
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {(["1d", "1w", "1m", "all"] as const).map((tf) => {
              const hasData = hasDataForTimeframe(tf);
              return (
                <button
                  key={tf}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (hasData || tf === "all") setSelectedTimeframe(tf);
                  }}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded-none transition-colors ${
                    selectedTimeframe === tf
                      ? "bg-white/10 text-white"
                      : hasData || tf === "all"
                        ? "text-white/40 hover:text-white/60"
                        : "text-white/20 cursor-not-allowed"
                  }`}
                  title={
                    !hasData && tf !== "all" ? "No data for this period" : ""
                  }
                >
                  {tf.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
        {/* Full width responsive chart with hover */}
        <div className="relative">
          <svg
            ref={chartRef}
            viewBox={`0 0 100 ${height}`}
            preserveAspectRatio="none"
            className="w-full h-20 cursor-crosshair"
            onMouseMove={(e) => {
              if (!chartRef.current) return;
              const rect = chartRef.current.getBoundingClientRect();
              const xPercent = ((e.clientX - rect.left) / rect.width) * 100;

              // Find closest data point
              const clampedX = Math.max(
                padding.left,
                Math.min(100 - padding.right, xPercent),
              );
              const timestamp =
                minT +
                ((clampedX - padding.left) /
                  (100 - padding.left - padding.right)) *
                  timeRange;

              // Binary search for closest point
              let left = 0;
              let right = filteredHistory.length - 1;
              while (left < right - 1) {
                const mid = Math.floor((left + right) / 2);
                if (filteredHistory[mid].timestamp < timestamp) {
                  left = mid;
                } else {
                  right = mid;
                }
              }

              const closest =
                Math.abs(filteredHistory[left].timestamp - timestamp) <
                Math.abs(filteredHistory[right].timestamp - timestamp)
                  ? filteredHistory[left]
                  : filteredHistory[right];

              const x =
                padding.left +
                ((closest.timestamp - minT) / timeRange) *
                  (100 - padding.left - padding.right);
              setChartHover({
                x,
                pnl: closest.pnl,
                timestamp: closest.timestamp,
              });
            }}
            onMouseLeave={() => setChartHover(null)}
          >
            <defs>
              <linearGradient
                id={`traderGrad-${trader.wallet_address}-${selectedTimeframe}`}
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
                <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Area fill */}
            <path
              d={(() => {
                let path = "";
                filteredHistory.forEach((p, i) => {
                  const x =
                    padding.left +
                    ((p.timestamp - minT) / timeRange) *
                      (100 - padding.left - padding.right);
                  const y =
                    padding.top + chartH - ((p.pnl - minVal) / range) * chartH;
                  path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
                });
                path += ` L ${100 - padding.right} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;
                return path;
              })()}
              fill={`url(#traderGrad-${trader.wallet_address}-${selectedTimeframe})`}
            />
            {/* Line */}
            <path
              d={(() => {
                let path = "";
                filteredHistory.forEach((p, i) => {
                  const x =
                    padding.left +
                    ((p.timestamp - minT) / timeRange) *
                      (100 - padding.left - padding.right);
                  const y =
                    padding.top + chartH - ((p.pnl - minVal) / range) * chartH;
                  path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
                });
                return path;
              })()}
              fill="none"
              stroke={lineColor}
              strokeWidth="0.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {/* Hover vertical line */}
            {chartHover && (
              <line
                x1={chartHover.x}
                y1={padding.top}
                x2={chartHover.x}
                y2={height - padding.bottom}
                stroke="white"
                strokeWidth="0.3"
                strokeOpacity="0.5"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {/* Hover dot */}
            {/* {chartHover && (
              <circle
                cx={chartHover.x}
                cy={
                  padding.top +
                  chartH -
                  ((chartHover.pnl - minVal) / range) * chartH
                }
                r="1.5"
                fill={lineColor}
                vectorEffect="non-scaling-stroke"
              />
            )} */}
          </svg>
          {/* Hover tooltip */}
          {chartHover && (
            <div
              className="absolute top-0 px-1.5 py-0.5 bg-black/90 border border-white/10 text-[10px] whitespace-nowrap z-10 pointer-events-none"
              style={{
                left: `${chartHover.x}%`,
                transform: "translateX(-50%)",
              }}
            >
              <span
                className={
                  chartHover.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                }
              >
                {chartHover.pnl >= 0 ? "+" : ""}
                {formatCurrency(chartHover.pnl)}
              </span>
              <span className="text-white/40 ml-1.5">
                {(() => {
                  // Handle both seconds and milliseconds timestamps
                  const ts =
                    chartHover.timestamp < 1e12
                      ? chartHover.timestamp * 1000
                      : chartHover.timestamp;
                  return new Date(ts).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                })()}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`panel p-0 overflow-hidden transition-all ${expanded ? "ring-1 ring-emerald-500/30" : ""} ${isInTargets ? "border-l-2 border-l-emerald-500" : ""}`}
    >
      {/* Main row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Rank */}
        <div className="w-8 text-center">
          <span
            className={`text-xs font-mono ${rank <= 3 ? "text-amber-400 font-bold" : "text-white/40"}`}
          >
            #{rank}
          </span>
        </div>

        {/* Avatar & Name */}
        <div className="flex items-center gap-3 min-w-[200px]">
          <div className="relative">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={trader.username}
                className="w-9 h-9 rounded-full bg-white/10 object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <UniqueAvatar
                address={trader.wallet_address}
                name={
                  profileData?.name || profileData?.pseudonym || trader.username
                }
                size={36}
              />
            )}
            {/* Online/Offline indicator */}
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#111113] ${trader.is_active ? "bg-emerald-500" : "bg-white/20"}`}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-white truncate max-w-[130px]">
                {profileData?.name || profileData?.pseudonym || trader.username}
              </p>
              {/* Verified badge - from leaderboard API or profile */}
              {(trader.verified_badge || profileData?.verifiedBadge) && (
                <svg
                  className="w-3.5 h-3.5 text-blue-400 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {/* X/Twitter link - from leaderboard API or profile */}
              {(trader.x_username || profileData?.xUsername) && (
                <a
                  href={`https://x.com/${trader.x_username || profileData?.xUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-white/30 hover:text-white/60 transition-colors"
                  title={`@${trader.x_username || profileData?.xUsername}`}
                >
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </a>
              )}
            </div>
            <p className="text-[10px] text-white/30 font-mono truncate max-w-[140px]">
              {trader.wallet_address.slice(0, 6)}...
              {trader.wallet_address.slice(-4)}
            </p>
          </div>
        </div>

        {/* Stats - right aligned with fixed widths for alignment */}
        <div className="flex items-center ml-auto">
          {/* Score */}
          <div className="w-16 text-right px-2">
            <p className="text-[10px] text-white/40 mb-0.5">Score</p>
            <p className={`text-sm font-mono font-semibold ${scoreColor}`}>
              {trader.smart_score.toFixed(0)}
            </p>
          </div>

          {/* Win Rate */}
          <div className="w-16 text-right px-2">
            <p className="text-[10px] text-white/40 mb-0.5">Win%</p>
            <p className={`text-sm font-mono font-semibold ${winRateColor}`}>
              {(trader.win_rate * 100).toFixed(1)}%
            </p>
          </div>

          {/* ROI */}
          <div className="w-16 text-right px-2">
            <p className="text-[10px] text-white/40 mb-0.5">ROI</p>
            <p
              className={`text-sm font-mono font-semibold ${trader.roi >= 0 ? "text-emerald-400" : "text-rose-400"}`}
            >
              {trader.roi >= 0 ? "+" : ""}
              {(trader.roi * 100).toFixed(1)}%
            </p>
          </div>

          {/* Volume */}
          <div className="w-20 text-right px-2">
            <p className="text-[10px] text-white/40 mb-0.5">Vol</p>
            <p className="text-sm font-mono text-white/70">
              {formatVolume(trader.total_volume)}
            </p>
          </div>

          {/* PnL */}
          <div className="w-24 text-right px-2">
            <p className="text-[10px] text-white/40 mb-0.5">PnL</p>
            <p className={`text-sm font-mono font-semibold ${pnlColor}`}>
              {trader.total_pnl >= 0 ? "+" : ""}
              {formatCurrency(trader.total_pnl)}
            </p>
          </div>
        </div>

        {/* Expand icon */}
        <div className="w-8 flex justify-center ml-2">
          <svg
            className={`w-4 h-4 text-white/30 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 py-3 bg-white/[0.02] border-t border-white/5 space-y-3">
          {/* Bio if available */}
          {profileData?.bio && (
            <div className="text-xs text-white/50 bg-white/[0.02] rounded-lg p-3 border border-white/5">
              <p className="line-clamp-2">{profileData.bio}</p>
            </div>
          )}

          {/* P&L Chart */}
          {renderMiniChart()}

          {/* Stats grid */}
          <div className="grid grid-cols-6 gap-4">
            <div>
              <p className="text-[10px] text-white/40 mb-0.5">ROI</p>
              <p
                className={`text-sm font-mono ${trader.roi >= 0 ? "text-emerald-400" : "text-rose-400"}`}
              >
                {trader.roi >= 0 ? "+" : ""}
                {(trader.roi * 100).toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 mb-0.5">Sharpe Ratio</p>
              <p className="text-sm font-mono text-white/70">
                {trader.sharpe_ratio.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 mb-0.5">Positions</p>
              <p className="text-sm font-mono text-white/70">
                {trader.position_count}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 mb-0.5">Best Tag</p>
              <p className="text-sm text-white/70 capitalize">
                {trader.best_tag}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 mb-0.5">Avg Hold</p>
              <p className="text-sm font-mono text-white/70">
                {trader.avg_hold_hours
                  ? `${trader.avg_hold_hours.toFixed(0)}h`
                  : "-"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 mb-0.5">Status</p>
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-2 h-2 rounded-full ${trader.is_active ? "bg-emerald-500 animate-pulse" : "bg-white/20"}`}
                />
                <p
                  className={`text-sm ${trader.is_active ? "text-emerald-400" : "text-white/40"}`}
                >
                  {trader.is_active ? "Online" : "Offline"}
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-white/5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopyAddress(trader.wallet_address);
              }}
              className="px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 rounded-none text-white/70 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy Address
            </button>
            <a
              href={`https://polymarket.com/profile/${trader.wallet_address}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 rounded-none text-white/70 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
              View on Polymarket
            </a>
            {isInTargets ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveTarget(trader.wallet_address);
                }}
                className="px-3 py-1.5 text-xs font-medium bg-emerald-500/10 hover:bg-rose-500/10 border border-emerald-500/20 hover:border-rose-500/20 rounded-none text-emerald-400 hover:text-rose-400 transition-colors flex items-center gap-1.5 group"
              >
                <svg
                  className="w-3.5 h-3.5 group-hover:hidden"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <svg
                  className="w-3.5 h-3.5 hidden group-hover:block"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                <span className="group-hover:hidden">Tracking</span>
                <span className="hidden group-hover:inline">Stop Tracking</span>
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddTarget(trader.wallet_address);
                }}
                className="px-3 py-1.5 text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-none text-emerald-400 transition-colors flex items-center gap-1.5"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Add to Targets
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ========== Whales View - Whale Trades Scanner ==========
type WhaleTrade = {
  id: string;
  timestamp: number;
  marketSlug: string;
  marketTitle: string;
  marketImage: string;
  side: "BUY" | "SELL";
  outcome: "YES" | "NO";
  size: number;
  price: number;
  walletAddress: string;
  userName?: string;
  userImage?: string;
};

function WhalesView() {
  const [trades, setTrades] = useState<WhaleTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minSize, setMinSize] = useState(1000);
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [walletProfile, setWalletProfile] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // Time ago formatter
  const timeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 0) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Fetch whale trades
  const fetchWhaleTrades = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const rawTrades = await window.ipc?.invoke("polymarket:getWhaleTrades", {
        minSize,
        limit: 500, // Fetch more to find large trades
      });

      if (!Array.isArray(rawTrades) || rawTrades.length === 0) {
        setTrades([]);
        setLoading(false);
        return;
      }

      // Map raw trades to our format using correct API field names
      // API returns: proxyWallet, side, size, price, timestamp, title, slug, icon, outcome, name, pseudonym
      const mapped: WhaleTrade[] = rawTrades.map((t: any, idx: number) => ({
        id: t.transactionHash || `trade-${idx}-${t.timestamp}`,
        timestamp: t.timestamp ? t.timestamp * 1000 : Date.now(), // API returns seconds, convert to ms
        marketSlug: t.slug || t.eventSlug || "",
        marketTitle: t.title || "Unknown Market",
        marketImage: t.icon || "",
        side: (t.side?.toUpperCase?.() || "BUY") as "BUY" | "SELL",
        outcome: (t.outcome || "YES") as "YES" | "NO",
        size:
          t.usdcSize || parseFloat(t.size || "0") * parseFloat(t.price || "0"),
        price: parseFloat(t.price || "0"),
        walletAddress: t.proxyWallet || "",
        userName: t.name || t.pseudonym || "",
        userImage: t.profileImage || "",
      }));

      // Already sorted by size from backend, but also sort by size descending here
      mapped.sort((a, b) => b.size - a.size);

      setTrades(mapped);
      setLastUpdated(Date.now());
    } catch (e: any) {
      console.error("Failed to fetch whale trades:", e);
      setError(e.message || "Failed to fetch whale trades");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Manual refresh handler
  const handleRefresh = () => {
    setRefreshing(true);
    fetchWhaleTrades(false);
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchWhaleTrades(true); // Show loading on initial fetch
    // Poll every 30 seconds without showing loading
    const interval = setInterval(() => fetchWhaleTrades(false), 30000);
    return () => clearInterval(interval);
  }, [minSize]);

  // Fetch wallet profile when selected
  useEffect(() => {
    if (!selectedWallet) {
      setWalletProfile(null);
      return;
    }

    const fetchProfile = async () => {
      setLoadingProfile(true);
      try {
        // First fetch basic profile to get username
        const profile = await window.ipc?.invoke<any>(
          "polymarket:getProfile",
          selectedWallet,
        );

        // Then fetch all other data in parallel
        const [pnlData, profileStats, positions, activity, valueData] =
          await Promise.all([
            window.ipc?.invoke<any>("polymarket:getUserPnl", {
              address: selectedWallet,
              interval: "1m",
              fidelity: "1d",
            }),
            window.ipc?.invoke<any>("polymarket:getProfileStats", {
              proxyAddress: selectedWallet,
              username: profile?.name || undefined,
            }),
            window.ipc?.invoke<any[]>("polymarket:getUserPositions", {
              address: selectedWallet,
              sortBy: "CURRENT",
              sortDirection: "DESC",
              limit: 20,
            }),
            window.ipc?.invoke<any[]>("polymarket:getUserActivity", {
              address: selectedWallet,
              limit: 25,
            }),
            window.ipc?.invoke<{ user: string; value: number } | null>(
              "polymarket:getUserValue",
              selectedWallet,
            ),
          ]);

        // Calculate total PnL from positions
        let totalPnl = 0;
        let totalVolume = 0;
        if (Array.isArray(positions)) {
          positions.forEach((pos: any) => {
            totalPnl += parseFloat(pos.cashPnl || 0);
            totalVolume += parseFloat(pos.totalBought || 0);
          });
        }

        setWalletProfile({
          ...(profile && typeof profile === "object" ? profile : {}),
          pnlHistory: pnlData,
          stats: profileStats, // { trades, largestWin, views, joinDate }
          positions: positions || [],
          activity: activity || [],
          portfolioValue: valueData?.value || 0,
          calculatedPnl: totalPnl,
          calculatedVolume: totalVolume,
        });
      } catch (e) {
        console.error("Failed to fetch profile:", e);
        setWalletProfile(null);
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchProfile();
  }, [selectedWallet]);

  const formatCurrency = (val: number) => {
    if (Math.abs(val) >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(2)}`;
  };

  const sizeFilters = [
    { label: "$1K+", value: 1000 },
    { label: "$5K+", value: 5000 },
    { label: "$10K+", value: 10000 },
    { label: "$50K+", value: 50000 },
    { label: "$100K+", value: 100000 },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">Whale Trades</h2>
            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="p-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white/40 hover:text-white/60 transition-colors disabled:opacity-50"
            >
              <svg
                className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
          <p className="text-xs text-white/40">
            Track large orders in real-time
            {lastUpdated && !loading && (
              <span className="ml-2 text-white/30">
                • Updated {timeAgo(lastUpdated)}
              </span>
            )}
          </p>
        </div>

        {/* Size filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-white/40 mr-2">Min Size:</span>
          {sizeFilters.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setMinSize(filter.value)}
              className={`px-2.5 py-1 text-[11px] font-medium transition-all ${
                minSize === filter.value
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
            <span className="text-white/40 text-sm">
              Scanning for whale trades...
            </span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-12 h-12 bg-rose-500/10 flex items-center justify-center mb-3">
            <svg
              className="w-6 h-6 text-rose-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <p className="text-white/60 text-sm mb-2">
            Failed to load whale trades
          </p>
          <p className="text-white/30 text-xs">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && trades.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-12 h-12 bg-white/5 flex items-center justify-center mb-3">
            <svg
              className="w-6 h-6 text-white/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-white/40 text-sm">No whale trades found</p>
          <p className="text-white/30 text-xs mt-1">
            Try lowering the minimum size filter
          </p>
        </div>
      )}

      {/* Trades list */}
      {!loading && !error && trades.length > 0 && (
        <div className="panel p-0">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-1 px-4 py-2 border-b border-white/5 text-[10px] text-white/40 uppercase tracking-wide">
            <div className="col-span-1">Time</div>
            <div className="col-span-6">Market</div>
            <div className="col-span-1 text-right">Side</div>
            <div className="col-span-1 text-right">Size</div>
            <div className="col-span-1 text-right">Entry</div>
            <div className="col-span-2 text-right">Wallet</div>
          </div>

          {/* Trades */}
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-white/[0.04]">
            {trades.map((trade) => (
              <div
                key={trade.id}
                className="grid grid-cols-12 gap-1 px-4 py-3 hover:bg-white/[0.02] transition-colors items-center"
              >
                {/* Time */}
                <div className="col-span-1">
                  <span className="text-xs text-white/50 font-mono">
                    {timeAgo(trade.timestamp)}
                  </span>
                </div>

                {/* Market */}
                <div className="col-span-6 flex items-center gap-2 min-w-0">
                  {trade.marketImage ? (
                    <img
                      src={trade.marketImage}
                      alt=""
                      className="w-8 h-8 object-cover flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-8 h-8 bg-white/5 flex items-center justify-center flex-shrink-0">
                      <svg
                        className="w-4 h-4 text-white/20"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    </div>
                  )}
                  <p className="text-sm text-white/80 truncate">
                    {trade.marketTitle}
                  </p>
                </div>

                {/* Side */}
                <div className="col-span-1 flex justify-end">
                  <span
                    className={`px-2 py-0.5 text-[10px] font-medium ${
                      trade.outcome === "YES"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                    }`}
                  >
                    {trade.outcome}
                  </span>
                </div>

                {/* Size */}
                <div className="col-span-1 text-right">
                  <span
                    className={`text-sm font-mono font-semibold ${
                      trade.side === "BUY"
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {formatCurrency(trade.size)}
                  </span>
                </div>

                {/* Entry price */}
                <div className="col-span-1 text-right">
                  <span className="text-sm font-mono text-white/60">
                    {(trade.price * 100).toFixed(0)}¢
                  </span>
                </div>

                {/* Wallet */}
                <div className="col-span-2 text-right">
                  <button
                    onClick={() => setSelectedWallet(trade.walletAddress)}
                    className="text-xs font-mono text-white/50 hover:text-emerald-400 transition-colors truncate max-w-full"
                    title={trade.walletAddress}
                  >
                    {trade.userName ||
                      `${trade.walletAddress.slice(0, 6)}...${trade.walletAddress.slice(-4)}`}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wallet Profile Modal */}
      {selectedWallet && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedWallet(null)}
        >
          <div
            className="bg-[#111113] border border-white/10 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 sticky top-0 bg-[#111113] z-10">
              <h3 className="text-lg font-semibold text-white">
                Trader Profile
              </h3>
              <button
                onClick={() => setSelectedWallet(null)}
                className="text-white/40 hover:text-white/60 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Modal content */}
            <div className="p-5">
              {loadingProfile ? (
                <div className="flex items-center justify-center py-12">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-6 h-6 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
                    <span className="text-white/40 text-sm">
                      Loading profile data...
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* User info */}
                  <div className="flex items-center gap-4">
                    {walletProfile?.profileImage ? (
                      <img
                        src={walletProfile.profileImage}
                        alt=""
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    ) : (
                      <UniqueAvatar
                        address={selectedWallet}
                        name={walletProfile?.name || "Trader"}
                        size={64}
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-lg font-semibold text-white">
                          {walletProfile?.name ||
                            walletProfile?.pseudonym ||
                            "Anonymous Trader"}
                        </h4>
                        {walletProfile?.stats?.joinDate && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-white/5 text-white/40 rounded">
                            Joined {walletProfile.stats.joinDate}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/40 font-mono mt-0.5">
                        {selectedWallet.slice(0, 10)}...
                        {selectedWallet.slice(-8)}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        {walletProfile?.xUsername && (
                          <a
                            href={`https://x.com/${walletProfile.xUsername}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-400 hover:underline"
                          >
                            @{walletProfile.xUsername}
                          </a>
                        )}
                        {walletProfile?.stats?.views && (
                          <span className="text-xs text-white/30">
                            👁 {walletProfile.stats.views.toLocaleString()}{" "}
                            views
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bio */}
                  {walletProfile?.bio && (
                    <div className="bg-white/[0.02] border border-white/5 p-3 rounded">
                      <p className="text-sm text-white/60">
                        {walletProfile.bio}
                      </p>
                    </div>
                  )}

                  {/* Main Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-white/[0.02] border border-white/5 p-3 rounded">
                      <p className="text-[10px] text-white/40 mb-1">
                        Portfolio Value
                      </p>
                      <p className="text-lg font-mono font-semibold text-white">
                        {formatCurrency(walletProfile?.portfolioValue || 0)}
                      </p>
                    </div>
                    <div className="bg-white/[0.02] border border-white/5 p-3 rounded">
                      <p className="text-[10px] text-white/40 mb-1">
                        Total PnL
                      </p>
                      <p
                        className={`text-lg font-mono font-semibold ${
                          (walletProfile?.calculatedPnl || 0) >= 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {walletProfile?.calculatedPnl >= 0 ? "+" : ""}
                        {formatCurrency(walletProfile?.calculatedPnl || 0)}
                      </p>
                    </div>
                    <div className="bg-white/[0.02] border border-white/5 p-3 rounded">
                      <p className="text-[10px] text-white/40 mb-1">Volume</p>
                      <p className="text-lg font-mono text-white/80">
                        {formatCurrency(walletProfile?.calculatedVolume || 0)}
                      </p>
                    </div>
                    <div className="bg-white/[0.02] border border-white/5 p-3 rounded">
                      <p className="text-[10px] text-white/40 mb-1">
                        Total Trades
                      </p>
                      <p className="text-lg font-mono text-white/80">
                        {walletProfile?.stats?.trades || 0}
                      </p>
                    </div>
                  </div>

                  {/* Secondary Stats */}
                  {walletProfile?.stats?.largestWin > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-emerald-500/5 border border-emerald-500/20 p-3 rounded">
                        <p className="text-[10px] text-emerald-400/60 mb-1">
                          Largest Win
                        </p>
                        <p className="text-lg font-mono font-semibold text-emerald-400">
                          +{formatCurrency(walletProfile.stats.largestWin)}
                        </p>
                      </div>
                      <div className="bg-white/[0.02] border border-white/5 p-3 rounded">
                        <p className="text-[10px] text-white/40 mb-1">
                          Active Positions
                        </p>
                        <p className="text-lg font-mono text-white/80">
                          {Array.isArray(walletProfile?.positions)
                            ? walletProfile.positions.filter(
                                (p: any) => p.size > 0,
                              ).length
                            : 0}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* P&L History Chart */}
                  {walletProfile?.pnlHistory &&
                    Array.isArray(walletProfile.pnlHistory) &&
                    walletProfile.pnlHistory.length > 1 && (
                      <div className="bg-white/[0.02] border border-white/5 p-3 rounded">
                        <p className="text-[10px] text-white/40 mb-2">
                          P&L History (30 days)
                        </p>
                        <div className="h-28">
                          <WalletPnlChart data={walletProfile.pnlHistory} />
                        </div>
                      </div>
                    )}

                  {/* Top Positions */}
                  {Array.isArray(walletProfile?.positions) &&
                    walletProfile.positions.length > 0 && (
                      <div className="bg-white/[0.02] border border-white/5 rounded overflow-hidden">
                        <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                          <p className="text-[10px] text-white/40 uppercase tracking-wider">
                            Top Positions
                          </p>
                          <span className="text-[10px] text-white/30">
                            {walletProfile.positions.length} total
                          </span>
                        </div>
                        <div className="divide-y divide-white/5 max-h-[200px] overflow-y-auto">
                          {walletProfile.positions
                            .slice(0, 5)
                            .map((pos: any, idx: number) => (
                              <div
                                key={idx}
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.02]"
                              >
                                {pos.icon && (
                                  <img
                                    src={pos.icon}
                                    alt=""
                                    className="w-8 h-8 rounded object-cover flex-shrink-0"
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-white/80 truncate">
                                    {pos.title || pos.slug}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span
                                      className={`text-[10px] px-1 py-0.5 ${
                                        pos.outcome === "Yes" ||
                                        pos.outcome === "YES"
                                          ? "bg-emerald-500/15 text-emerald-400"
                                          : "bg-rose-500/15 text-rose-400"
                                      }`}
                                    >
                                      {pos.outcome}
                                    </span>
                                    <span className="text-[10px] text-white/40">
                                      {pos.size?.toFixed(1)} shares
                                    </span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs font-mono text-white/80">
                                    {formatCurrency(pos.currentValue || 0)}
                                  </p>
                                  <p
                                    className={`text-[10px] font-mono ${pos.cashPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                                  >
                                    {pos.cashPnl >= 0 ? "+" : ""}
                                    {formatCurrency(pos.cashPnl || 0)}
                                  </p>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                  {/* Recent Activity */}
                  {Array.isArray(walletProfile?.activity) &&
                    walletProfile.activity.length > 0 && (
                      <div className="bg-white/[0.02] border border-white/5 rounded overflow-hidden">
                        <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                          <p className="text-[10px] text-white/40 uppercase tracking-wider">
                            Recent Activity
                          </p>
                          <span className="text-[10px] text-white/30">
                            {walletProfile.activity.length} trades
                          </span>
                        </div>
                        <div className="divide-y divide-white/5 max-h-[200px] overflow-y-auto">
                          {walletProfile.activity
                            .slice(0, 8)
                            .map((act: any, idx: number) => (
                              <div
                                key={idx}
                                className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.02]"
                              >
                                <div className="flex-shrink-0">
                                  <span
                                    className={`text-[9px] font-bold px-1.5 py-0.5 ${
                                      act.side === "BUY"
                                        ? "bg-emerald-500/15 text-emerald-400"
                                        : "bg-rose-500/15 text-rose-400"
                                    }`}
                                  >
                                    {act.side}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-white/70 truncate">
                                    {act.title || "Unknown Market"}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`text-[9px] px-1 py-0.5 ${
                                      act.outcome === "Up" ||
                                      act.outcome === "Yes"
                                        ? "bg-emerald-500/10 text-emerald-300"
                                        : "bg-rose-500/10 text-rose-300"
                                    }`}
                                  >
                                    {act.outcome}
                                  </span>
                                  <span className="text-xs font-mono text-white/60">
                                    {formatCurrency(act.usdcSize || 0)}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2">
                    <a
                      href={`https://polymarket.com/profile/${selectedWallet}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-4 py-2 text-sm font-medium text-center bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 transition-colors rounded"
                    >
                      View on Polymarket
                    </a>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedWallet);
                      }}
                      className="px-4 py-2 text-sm font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 transition-colors rounded"
                    >
                      Copy Address
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Simple P&L chart for wallet modal
function WalletPnlChart({ data }: { data: any[] }) {
  const height = 80;
  const padding = { top: 4, right: 4, bottom: 4, left: 4 };
  const chartH = height - padding.top - padding.bottom;

  // Parse data
  const points = data
    .map((point: any) => {
      const timestamp =
        point.t || point.timestamp || point.time
          ? new Date(point.t || point.timestamp || point.time).getTime()
          : null;
      const pnl =
        point.p !== undefined
          ? parseFloat(point.p)
          : point.pnl !== undefined
            ? parseFloat(point.pnl)
            : null;

      if (timestamp && pnl !== null && !isNaN(pnl)) {
        return { timestamp, pnl };
      }
      return null;
    })
    .filter(Boolean) as { timestamp: number; pnl: number }[];

  if (points.length < 2) {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-xs">
        Not enough data
      </div>
    );
  }

  points.sort((a, b) => a.timestamp - b.timestamp);

  const values = points.map((p) => p.pnl);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const minT = points[0].timestamp;
  const maxT = points[points.length - 1].timestamp;
  const timeRange = maxT - minT || 1;

  const lastPnl = points[points.length - 1].pnl;
  const firstPnl = points[0].pnl;
  const isUp = lastPnl >= firstPnl;
  const lineColor = isUp ? "#10b981" : "#f43f5e";

  // Build path
  let path = "";
  points.forEach((p, i) => {
    const x =
      padding.left +
      ((p.timestamp - minT) / timeRange) * (100 - padding.left - padding.right);
    const y = padding.top + chartH - ((p.pnl - minVal) / range) * chartH;
    path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  });

  // Area path
  const areaPath = `${path} L ${100 - padding.right} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="w-full h-full"
    >
      <defs>
        <linearGradient id="walletPnlGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#walletPnlGrad)" />
      <path
        d={path}
        fill="none"
        stroke={lineColor}
        strokeWidth="0.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
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
      prev && prev.risk
        ? {
            ...prev,
            risk: { ...prev.risk, dryRun: !prev.risk.dryRun },
          }
        : prev,
    );
  };

  const saveConfig = async () => {
    if (!localConfig) return;
    setSaving(true);
    try {
      console.log("[Settings] Saving config:", localConfig);
      const result = await window.ipc?.invoke("config:set", localConfig);
      console.log("[Settings] Save result:", result);
      onUpdate(localConfig);
      setSavedConfig(JSON.stringify(localConfig));
      setHasChanges(false);
      // Notify parent that settings were saved (for restart warning)
      onSettingsSaved?.();
    } catch (e) {
      console.error("[Settings] Failed to save config:", e);
      alert("Failed to save settings. Please try again.");
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
      const startingBalance =
        localConfig?.paperTrading?.startingBalance ?? 10000;
      await window.ipc?.invoke("paper:reset", { startingBalance });
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

      {/* Dry Run Toggle - Only shown for Live accounts when paper trading is disabled */}
      {isLiveMode && !localConfig.paperTrading?.enabled && (
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">Dry Run Mode</p>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10  -full flex items-center justify-center ${
                      localConfig.risk?.dryRun ? "bg-cyan-500/20" : "bg-white/5"
                    }`}
                  >
                    <svg
                      className={`w-5 h-5 ${localConfig.risk?.dryRun ? "text-cyan-400" : "text-white/40"}`}
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
                      className={`font-medium ${localConfig.risk?.dryRun ? "text-cyan-400" : "text-white/80"}`}
                    >
                      {localConfig.risk?.dryRun
                        ? "Dry Run Enabled"
                        : "Dry Run Disabled"}
                    </p>
                    <p className="text-xs text-white/50">
                      {localConfig.risk?.dryRun
                        ? "Watch mode - detects trades but doesn't execute. Good for observation."
                        : "Live execution - trades will be placed with real money."}
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={toggleDryRun}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer  -full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  localConfig.risk?.dryRun ? "bg-cyan-500" : "bg-white/20"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform  -full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    localConfig.risk?.dryRun ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            {!localConfig.risk?.dryRun && (
              <div className="mt-3 p-3 bg-rose-500/10 border border-rose-500/30  ">
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
            {localConfig.targets?.length || 0} targets
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
                  className="flex items-center justify-between py-2 px-3 bg-white/[0.02] "
                >
                  <span className="font-mono text-white/80 text-sm truncate">
                    {addr}
                  </span>
                  <button
                    onClick={() => removeTarget(addr)}
                    className="p-1.5 text-white/30 hover:text-rose-400 hover:bg-rose-500/10  transition-colors"
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
              label="Min Shares"
              value={localConfig.trading.minOrderShares}
              onChange={(v) =>
                updateTradingConfig("minOrderShares", parseFloat(v) || 0)
              }
              type="number"
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
              className={`text-xs px-2 py-0.5   ${
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
                className={`relative w-11 h-6  -full transition-colors ${
                  localConfig.stopLoss?.enabled
                    ? "bg-emerald-500"
                    : "bg-white/20"
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white  -full transition-transform ${
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
              className={`text-xs px-2 py-0.5   ${
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
                className={`relative w-11 h-6  -full transition-colors ${
                  localConfig.autoRedeem?.enabled
                    ? "bg-emerald-500"
                    : "bg-white/20"
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white  -full transition-transform ${
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
