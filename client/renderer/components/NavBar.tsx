import React, { useState, useEffect, useRef } from "react";
import type { AccountInfo, TradingModeInfo } from "../types";

type Props = {
  onSearch?: (q: string) => void;
  status?: { running: boolean; connected: boolean };
  onToggleBot?: () => void;
  onAddWallet?: () => void;
  walletConfigured?: boolean;
  onAccountSwitch?: (needsRestart: boolean) => void;
};

export default function NavBar({
  onSearch,
  status,
  onToggleBot,
  onAddWallet,
  walletConfigured = true,
  onAccountSwitch,
}: Props) {
  const [tradingMode, setTradingMode] = useState<TradingModeInfo | null>(null);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch trading mode and accounts
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [modeInfo, accountsList] = await Promise.all([
          window.ipc?.invoke<TradingModeInfo>("accounts:getTradingMode"),
          window.ipc?.invoke<AccountInfo[]>("accounts:getAll"),
        ]);
        if (modeInfo) setTradingMode(modeInfo);
        if (accountsList) setAccounts(accountsList);
      } catch (e) {
        console.error("Failed to fetch account data:", e);
      }
    };

    fetchData();
    // Refresh periodically
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Check initial maximized state
  useEffect(() => {
    window.ipc
      ?.invoke<boolean>("window:isMaximized")
      .then((maximized) => {
        setIsMaximized(maximized ?? false);
      })
      .catch(() => {});
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMinimize = () => {
    window.ipc?.invoke("window:minimize");
  };

  const handleMaximize = () => {
    window.ipc?.invoke("window:maximize").then(() => {
      window.ipc?.invoke<boolean>("window:isMaximized").then((maximized) => {
        setIsMaximized(maximized ?? false);
      });
    });
  };

  const handleClose = () => {
    window.ipc?.invoke("window:close");
  };

  const handleAccountSwitch = async (accountId: string | null) => {
    try {
      const result = await window.ipc?.invoke<{
        success: boolean;
        needsRestart?: boolean;
        mode: string;
        error?: string;
      }>("accounts:switch", accountId);

      if (result?.success) {
        // Refresh trading mode
        const modeInfo = await window.ipc?.invoke<TradingModeInfo>(
          "accounts:getTradingMode",
        );
        if (modeInfo) setTradingMode(modeInfo);

        // Refresh accounts list
        const accountsList =
          await window.ipc?.invoke<AccountInfo[]>("accounts:getAll");
        if (accountsList) setAccounts(accountsList);

        setIsDropdownOpen(false);

        // Notify parent if bot needs restart
        if (result.needsRestart && onAccountSwitch) {
          onAccountSwitch(true);
        }
      } else {
        console.error("Failed to switch account:", result?.error);
      }
    } catch (e) {
      console.error("Error switching account:", e);
    }
  };

  // Get display info
  const isPaperMode = tradingMode?.mode === "paper";
  const displayAddress = isPaperMode
    ? "Paper Trading"
    : tradingMode?.activeAccount?.address
      ? `${tradingMode.activeAccount.address.slice(0, 6)}...${tradingMode.activeAccount.address.slice(-4)}`
      : "No Account";

  const displayBalance = isPaperMode
    ? (tradingMode?.paperBalance ?? 10000)
    : tradingMode?.liveBalance;

  return (
    <nav className="relative z-[100] bg-black/30 border-b border-white/[0.06]">
      {/* Draggable title bar area */}
      <div
        className="flex items-center justify-between h-10 px-2"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* Left section - no drag */}
        <div
          className="flex items-center gap-3"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <a className="group flex items-center gap-2" href="#">
            <div className="w-5 h-5 bg-transparent from-slate-800 to-slate-600 flex items-center justify-center">
              <svg
                className="w-3 h-3 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
            <span className="text-xs font-bold text-white/90 group-hover:text-white transition-colors">
              PMcopy
            </span>
          </a>

          {/* Status indicator */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 bg-white/[0.04] border border-white/[0.08]">
            <span
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                status?.running
                  ? "bg-emerald-500 animate-pulse shadow-lg shadow-emerald-500/50"
                  : "bg-white/20"
              }`}
            ></span>
            <span className="text-[10px] font-medium text-white/60">
              {status?.running ? "Running" : "Stopped"}
            </span>
          </div>

          {/* Connection status */}
          <div
            className={`hidden sm:flex items-center gap-1.5 px-2 py-0.5 border transition-all duration-500 ${
              status?.connected
                ? "bg-emerald-500/10 border-emerald-500/30"
                : "bg-white/[0.04] border-white/[0.08]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                status?.connected
                  ? "bg-emerald-500 shadow-lg shadow-emerald-500/50"
                  : status?.running
                    ? "bg-amber-500 animate-pulse"
                    : "bg-rose-500/50"
              }`}
            ></span>
            <span
              className={`text-[10px] font-medium transition-colors duration-300 ${
                status?.connected ? "text-emerald-400" : "text-white/60"
              }`}
            >
              {status?.connected
                ? "Connected"
                : status?.running
                  ? "Connecting..."
                  : "Disconnected"}
            </span>
          </div>

          {/* Trading Mode Badge */}
          <div
            className={`hidden sm:flex items-center gap-1.5 px-2 py-0.5 border transition-all duration-300 ${
              isPaperMode
                ? "bg-amber-500/10 border-amber-500/30"
                : "bg-emerald-500/10 border-emerald-500/30"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isPaperMode ? "bg-amber-500" : "bg-emerald-500"
              }`}
            ></span>
            <span
              className={`text-[10px] font-medium ${
                isPaperMode ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              {isPaperMode ? "Paper" : "Live"}
            </span>
          </div>
        </div>

        {/* Right section - no drag */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Start/Stop button */}
          <button
            onClick={onToggleBot}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium transition-colors ${
              status?.running
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30"
                : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
            }`}
          >
            {status?.running ? (
              <>
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8 7a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H8Z"
                    clipRule="evenodd"
                  />
                </svg>
                Stop
              </>
            ) : (
              <>
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-1.5-5.5v-5l4.5 2.5-4.5 2.5Z"
                    clipRule="evenodd"
                  />
                </svg>
                Start
              </>
            )}
          </button>

          <div className="h-5 w-px bg-white/[0.06] mx-1.5"></div>

          {/* Account Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`flex items-center gap-1.5 px-2 py-1 transition-colors rounded ${
                isDropdownOpen
                  ? "bg-white/10 text-white"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              {/* Icon based on mode */}
              {isPaperMode ? (
                <div className="w-4 h-4 flex items-center justify-center">
                  <svg
                    className="w-3.5 h-3.5 text-amber-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
                    />
                  </svg>
                </div>
              ) : (
                <div className="w-4 h-4 bg-gradient-to-bl from-transparent via-slate-800 via-slate-600 to-transparent flex items-center justify-center text-[8px] font-bold">
                  {tradingMode?.activeAccount?.address
                    ?.charAt(2)
                    .toUpperCase() || "?"}
                </div>
              )}
              <span className="hidden sm:inline text-[10px] font-medium font-mono">
                {displayAddress}
              </span>
              <svg
                className={`w-3 h-3 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-[#0f0f10] border border-white/10 rounded-lg shadow-xl overflow-hidden z-50">
                {/* Paper Trading Option */}
                <button
                  onClick={() => handleAccountSwitch(null)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    isPaperMode
                      ? "bg-amber-500/10 border-l-2 border-amber-500"
                      : "hover:bg-white/5 border-l-2 border-transparent"
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <svg
                      className="w-4 h-4 text-amber-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">
                      Paper Trading
                    </div>
                    <div className="text-[10px] text-white/40">
                      Simulated trading - $
                      {tradingMode?.paperBalance?.toFixed(2) ?? "10,000.00"}
                    </div>
                  </div>
                  {isPaperMode && (
                    <svg
                      className="w-4 h-4 text-amber-400 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>

                {/* Divider if there are accounts */}
                {accounts.length > 0 && (
                  <div className="border-t border-white/10 my-1">
                    <div className="px-3 py-1.5 text-[10px] font-medium text-white/30 uppercase tracking-wider">
                      Live Accounts
                    </div>
                  </div>
                )}

                {/* Live Accounts List */}
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => handleAccountSwitch(account.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      account.isActive
                        ? "bg-emerald-500/10 border-l-2 border-emerald-500"
                        : "hover:bg-white/5 border-l-2 border-transparent"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-emerald-400">
                        {account.address.charAt(2).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {account.name}
                      </div>
                      <div className="text-[10px] text-white/40 font-mono">
                        {account.address.slice(0, 6)}...
                        {account.address.slice(-4)}
                      </div>
                    </div>
                    {account.isActive && (
                      <svg
                        className="w-4 h-4 text-emerald-400 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                ))}

                {/* Add Account Button */}
                <div className="border-t border-white/10">
                  <button
                    onClick={() => {
                      setIsDropdownOpen(false);
                      if (onAddWallet) onAddWallet();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 border border-dashed border-white/20 flex items-center justify-center flex-shrink-0">
                      <svg
                        className="w-4 h-4 text-white/40"
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
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white/60">
                        Add Account
                      </div>
                      <div className="text-[10px] text-white/30">
                        Connect a live trading account
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="h-5 w-px bg-white/[0.06] mx-1.5"></div>

          {/* Window Controls */}
          <div className="flex items-center">
            <button
              onClick={handleMinimize}
              className="flex items-center justify-center w-8 h-8 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              title="Minimize"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M4 8h8v1H4z" />
              </svg>
            </button>
            <button
              onClick={handleMaximize}
              className="flex items-center justify-center w-8 h-8 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <rect x="3" y="5" width="8" height="8" rx="0.5" />
                  <path d="M5 5V3.5a.5.5 0 0 1 .5-.5H13.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H11" />
                </svg>
              ) : (
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <rect x="3" y="3" width="10" height="10" rx="0.5" />
                </svg>
              )}
            </button>
            <button
              onClick={handleClose}
              className="flex items-center justify-center w-8 h-8 text-white/40 hover:text-white hover:bg-rose-500/80 transition-colors"
              title="Close"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 16 16"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
