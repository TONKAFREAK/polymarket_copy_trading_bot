import React, { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import NavBar from "../components/NavBar";
import Tabs from "../components/Tabs";
import type { TradeLog, WalletStatus, AccountInfo } from "../types";

// Bot event types
interface BotEvent {
  type:
    | "status"
    | "connected"
    | "disconnected"
    | "trade-detected"
    | "trade-executed"
    | "trade-skipped"
    | "error"
    | "log";
  data?: any;
}

// Debug log entry
interface DebugLog {
  id: string;
  timestamp: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

// Add Account Modal - for adding new live trading accounts
function AddAccountModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (account: AccountInfo) => void;
}) {
  const [accountName, setAccountName] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [polyApiKey, setPolyApiKey] = useState("");
  const [polyApiSecret, setPolyApiSecret] = useState("");
  const [polyPassphrase, setPolyPassphrase] = useState("");
  const [polyFunderAddress, setPolyFunderAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!privateKey.trim()) {
      setError("Private key is required");
      return;
    }
    if (!polyApiKey.trim()) {
      setError("API Key is required");
      return;
    }
    if (!polyApiSecret.trim()) {
      setError("API Secret is required");
      return;
    }
    if (!polyPassphrase.trim()) {
      setError("Passphrase is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = await window.ipc?.invoke<{
        success: boolean;
        error?: string;
        account?: AccountInfo;
      }>("accounts:add", {
        name: accountName.trim() || "My Account",
        privateKey: privateKey.trim(),
        polyApiKey: polyApiKey.trim(),
        polyApiSecret: polyApiSecret.trim(),
        polyPassphrase: polyPassphrase.trim(),
        polyFunderAddress: polyFunderAddress.trim() || undefined,
      });

      if (result?.success && result.account) {
        onSave(result.account);
        onClose();
      } else {
        setError(result?.error || "Failed to add account");
      }
    } catch (e: any) {
      setError(e.message || "Failed to add account");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#0f0f10] border border-white/10 rounded-lg shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Add Live Trading Account
            </h2>
            <p className="text-sm text-white/50 mt-0.5">
              Enter your Polymarket API credentials for live trading
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded transition-colors"
          >
            <svg
              className="w-5 h-5"
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

        {/* Form */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="px-4 py-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm text-white/70">
              Account Name <span className="text-white/30">(optional)</span>
            </label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="My Trading Account"
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 text-sm"
            />
            <p className="text-xs text-white/40">
              A friendly name to identify this account
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-white/70">
              Private Key <span className="text-rose-400">*</span>
            </label>
            <input
              type="password"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="Enter your private key (without 0x prefix)"
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
            />
            <p className="text-xs text-white/40">
              Your Ethereum private key for signing transactions
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-white/70">
              API Key <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={polyApiKey}
              onChange={(e) => setPolyApiKey(e.target.value)}
              placeholder="Enter your Polymarket API key"
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-white/70">
              API Secret <span className="text-rose-400">*</span>
            </label>
            <input
              type="password"
              value={polyApiSecret}
              onChange={(e) => setPolyApiSecret(e.target.value)}
              placeholder="Enter your Polymarket API secret"
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-white/70">
              Passphrase <span className="text-rose-400">*</span>
            </label>
            <input
              type="password"
              value={polyPassphrase}
              onChange={(e) => setPolyPassphrase(e.target.value)}
              placeholder="Enter your Polymarket passphrase"
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-white/70">
              Funder Address <span className="text-white/30">(optional)</span>
            </label>
            <input
              type="text"
              value={polyFunderAddress}
              onChange={(e) => setPolyFunderAddress(e.target.value)}
              placeholder="0x... (leave empty to use wallet address)"
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
            />
            <p className="text-xs text-white/40">
              Your Polymarket profile address (if different from wallet)
            </p>
          </div>

          <div className="pt-2 bg-amber-500/5 border border-amber-500/20 rounded p-4">
            <div className="flex gap-3">
              <svg
                className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5"
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
              <div>
                <p className="text-amber-400 text-sm font-medium">
                  Security Notice
                </p>
                <p className="text-amber-400/70 text-xs mt-1">
                  Your credentials are stored locally and encrypted. Never share
                  your private key or API secrets with anyone.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
          >
            {saving ? "Adding..." : "Add Account"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Paper Trading Welcome Popup
function PaperTradingPopup({
  onClose,
  onAddAccount,
}: {
  onClose: () => void;
  onAddAccount: () => void;
}) {
  const handleDismiss = async () => {
    await window.ipc?.invoke("accounts:markPaperPopupSeen");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#0f0f10] border border-white/10 rounded-lg shadow-2xl w-full max-w-md mx-4">
        {/* Icon */}
        <div className="flex justify-center pt-8">
          <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-amber-400"
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
        </div>

        {/* Content */}
        <div className="px-6 py-6 text-center">
          <h2 className="text-xl font-semibold text-white mb-2">
            Welcome to Paper Trading
          </h2>
          <p className="text-white/60 text-sm leading-relaxed mb-6">
            You&apos;re starting in{" "}
            <span className="text-amber-400 font-medium">Paper Trading</span>{" "}
            mode with $10,000 in virtual funds. This allows you to test
            strategies risk-free before trading with real money.
          </p>

          {/* Info box */}
          <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-6 text-left">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <p className="text-white text-sm font-medium mb-1">
                  Ready for live trading?
                </p>
                <p className="text-white/50 text-xs">
                  Click the account selector in the navbar and add a live
                  trading account with your Polymarket API credentials.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <button
              onClick={handleDismiss}
              className="w-full px-4 py-3 bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium rounded-lg transition-colors"
            >
              Start Paper Trading
            </button>
            <button
              onClick={() => {
                handleDismiss();
                onAddAccount();
              }}
              className="w-full px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm font-medium rounded-lg border border-white/10 transition-colors"
            >
              Add Live Account Instead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [status, setStatus] = useState({ running: false, connected: false });
  const [realtimeLogs, setRealtimeLogs] = useState<TradeLog[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [walletConfigured, setWalletConfigured] = useState(true);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showPaperPopup, setShowPaperPopup] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await window.ipc?.invoke<{
          running: boolean;
          connected: boolean;
          stats?: any;
        }>("bot:status");
        if (res) {
          setStatus({ running: res.running, connected: res.connected });
          // Clear restart warning if bot is stopped
          if (!res.running) {
            setNeedsRestart(false);
          }
        }
      } catch (e) {
        console.error("Failed to fetch status:", e);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  // Check if should show paper trading popup on first load
  useEffect(() => {
    const checkPaperPopup = async () => {
      try {
        const hasSeenPopup = await window.ipc?.invoke<boolean>(
          "accounts:hasSeenPaperPopup",
        );
        if (!hasSeenPopup) {
          setShowPaperPopup(true);
        }
      } catch (e) {
        console.error("Failed to check paper popup status:", e);
      }
    };
    checkPaperPopup();
  }, []);

  // Check accounts on mount
  useEffect(() => {
    const checkAccounts = async () => {
      try {
        const accounts =
          await window.ipc?.invoke<AccountInfo[]>("accounts:getAll");
        setWalletConfigured(accounts && accounts.length > 0);
      } catch (e) {
        console.error("Failed to check accounts:", e);
      }
    };
    checkAccounts();
  }, []);

  // Callback when settings are saved - called from Tabs component
  const handleSettingsSaved = useCallback(() => {
    if (status.running) {
      setNeedsRestart(true);
      addDebugLog(
        "warn",
        "Settings saved while bot running - restart required for changes to take effect",
      );
    }
  }, [status.running]);

  // Listen for real-time bot events from main process
  useEffect(() => {
    if (!window.ipc?.on) return;

    const unsubscribe = window.ipc.on("bot:event", (event: BotEvent) => {
      console.log("[BotEvent]", event.type, event.data);

      switch (event.type) {
        case "connected":
          setStatus((prev) => ({ ...prev, connected: true }));
          addSimpleLog("info", "Connected to Polymarket WebSocket");
          addDebugLog(
            "info",
            "WebSocket connected to Polymarket real-time data feed",
          );
          addDebugLog("debug", "Subscribed to: trades, orders_matched");
          break;
        case "disconnected":
          setStatus((prev) => ({ ...prev, connected: false }));
          addSimpleLog("info", "Disconnected from Polymarket WebSocket");
          addDebugLog("warn", "WebSocket disconnected from Polymarket");
          break;
        case "status":
          if (event.data) {
            setStatus((prev) => ({
              ...prev,
              connected: event.data.connected,
            }));
            addDebugLog(
              "debug",
              `Status: connected=${event.data.connected}, messages=${event.data.messagesReceived || 0}, trades=${event.data.targetTradesDetected || 0}`,
            );
          }
          break;
        case "trade-detected":
          if (event.data) {
            // Add target detection log
            addTradeLog("target", event.data);
            addDebugLog(
              "info",
              `Trade detected from target: ${event.data.targetWallet?.slice(0, 10)}...`,
            );
            addDebugLog(
              "debug",
              `  > ${event.data.side} ${event.data.outcome} | ${event.data.size?.toFixed(2)} shares @ $${event.data.price?.toFixed(3)}`,
            );
            addDebugLog(
              "debug",
              `  > Market: ${event.data.marketSlug || event.data.title || "unknown"}`,
            );
          }
          break;
        case "trade-executed":
          if (event.data) {
            // Add executed trade log with full details
            addExecutedTradeLog(event.data);
            addDebugLog(
              "info",
              `Trade executed: ${event.data.yourShares?.toFixed(2)} shares @ $${event.data.yourPrice?.toFixed(3)}`,
            );
            addDebugLog(
              "debug",
              `  > Total: $${event.data.yourTotal?.toFixed(2)} | Fees: $${event.data.fees?.toFixed(4)} | Latency: ${event.data.latencyMs}ms`,
            );
          }
          break;
        case "trade-skipped":
          if (event.data) {
            addSkippedTradeLog(event.data);
            addDebugLog("warn", `Trade skipped: ${event.data.reason}`);
            if (event.data.signal) {
              addDebugLog(
                "debug",
                `  > Would have been: ${event.data.signal.side} ${event.data.signal.outcome} @ $${event.data.signal.price?.toFixed(3)}`,
              );
            }
          }
          break;
        case "error":
          if (event.data) {
            addSimpleLog("error", event.data.message);
            addDebugLog("error", `Error: ${event.data.message}`);
            if (event.data.context) {
              addDebugLog("debug", `  > Context: ${event.data.context}`);
            }
          }
          break;
        case "log":
          if (event.data) {
            // Always add to debug logs with appropriate formatting
            const level = event.data.level || "info";
            let prefix = "";
            if (level === "info" && event.data.message?.includes("poll")) {
              prefix = "";
            } else if (
              level === "info" &&
              event.data.message?.includes("redeem")
            ) {
              prefix = "";
            } else if (
              level === "info" &&
              event.data.message?.includes("position")
            ) {
              prefix = "";
            } else if (
              level === "info" &&
              event.data.message?.includes("balance")
            ) {
              prefix = "";
            }
            addDebugLog(
              level as DebugLog["level"],
              `${prefix}${event.data.message}`,
            );

            // Only add non-debug logs to activity log
            if (level !== "debug") {
              const logType =
                event.data.level === "error"
                  ? "error"
                  : event.data.level === "warn"
                    ? "skip"
                    : "info";
              addSimpleLog(logType as TradeLog["type"], event.data.message);
            }
          }
          break;
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Add simple message log
  const addSimpleLog = (type: TradeLog["type"], message: string) => {
    setRealtimeLogs((prev) => {
      const newLog: TradeLog = {
        id: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        type,
        message,
        isNew: true,
      };
      // Keep all logs (no limit)
      return [newLog, ...prev];
    });
  };

  // Add debug log (for the collapsible panel)
  const addDebugLog = (level: DebugLog["level"], message: string) => {
    setDebugLogs((prev) => {
      const newLog: DebugLog = {
        id: `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        level,
        message,
      };
      // Keep last 500 debug logs
      return [newLog, ...prev].slice(0, 500);
    });
  };

  // Add target trade detection log
  const addTradeLog = (type: TradeLog["type"], signal: any) => {
    setRealtimeLogs((prev) => {
      const newLog: TradeLog = {
        id: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        type,
        side: signal.side,
        outcome: signal.outcome,
        marketName: signal.title || signal.name || signal.marketSlug,
        targetWallet: signal.targetWallet,
        targetShares: signal.size,
        targetPrice: signal.price,
        targetTotal: signal.size * signal.price,
        isNew: true,
      };
      return [newLog, ...prev];
    });
  };

  // Add executed trade log with both target and our trade info
  const addExecutedTradeLog = (data: any) => {
    const { signal, yourShares, yourPrice, yourTotal, fees, latencyMs } = data;
    setRealtimeLogs((prev) => {
      const newLog: TradeLog = {
        id: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        type: "copy",
        side: signal.side,
        outcome: signal.outcome,
        marketName: signal.title || signal.name || signal.marketSlug,
        targetWallet: signal.targetWallet,
        targetShares: signal.size,
        targetPrice: signal.price,
        targetTotal: signal.size * signal.price,
        yourShares,
        yourPrice,
        yourTotal,
        latencyMs,
        isNew: true,
      };
      return [newLog, ...prev];
    });
  };

  // Add skipped trade log
  const addSkippedTradeLog = (data: any) => {
    const { signal, reason } = data;
    setRealtimeLogs((prev) => {
      const newLog: TradeLog = {
        id: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        type: "skip",
        side: signal?.side,
        outcome: signal?.outcome,
        marketName: signal?.title || signal?.name || signal?.marketSlug,
        targetWallet: signal?.targetWallet,
        targetShares: signal?.size,
        targetPrice: signal?.price,
        targetTotal: signal?.size * signal?.price,
        copyError: reason,
        message: reason,
        isNew: true,
      };
      return [newLog, ...prev];
    });
  };

  const toggleBot = useCallback(async () => {
    try {
      if (status.running) {
        await window.ipc?.invoke("bot:stop");
        setStatus((prev) => ({ ...prev, running: false, connected: false }));
        addSimpleLog("info", "Bot stopped");
        addDebugLog("info", "Bot stopped by user");
        // Clear restart warning when stopped
        setNeedsRestart(false);
      } else {
        await window.ipc?.invoke("bot:start");
        setStatus((prev) => ({ ...prev, running: true }));
        addSimpleLog("info", "Bot starting...");
        addDebugLog("info", "Bot start requested");
        addDebugLog("debug", "Loading configuration and targets...");
        // Clear restart warning on fresh start
        setNeedsRestart(false);
      }
    } catch (e) {
      console.error("Failed to toggle bot:", e);
      addSimpleLog("error", `Failed to toggle bot: ${e}`);
      addDebugLog("error", `Failed to toggle bot: ${e}`);
    }
  }, [status.running]);

  const handleRestartBot = useCallback(async () => {
    try {
      addDebugLog("info", "Restarting bot with new configuration...");
      await window.ipc?.invoke("bot:restart");
      setStatus((prev) => ({ ...prev, running: true }));
      addSimpleLog("info", "Bot restarted with new settings");
      addDebugLog("info", "Bot restarted successfully");
      // Clear restart warning after restart
      setNeedsRestart(false);
    } catch (e) {
      console.error("Failed to restart bot:", e);
      addSimpleLog("error", `Failed to restart bot: ${e}`);
      addDebugLog("error", `Failed to restart bot: ${e}`);
    }
  }, []);

  const handleAccountAdded = useCallback((account: AccountInfo) => {
    setWalletConfigured(true);
    addDebugLog(
      "info",
      `Account added: ${account.name} (${account.address.slice(0, 6)}...${account.address.slice(-4)})`,
    );
  }, []);

  const handleAccountSwitch = useCallback((needsRestartBot: boolean) => {
    if (needsRestartBot) {
      setNeedsRestart(true);
      addDebugLog(
        "warn",
        "Account switched - restart required for changes to take effect",
      );
    }
  }, []);

  const formatDebugTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const getLevelColor = (level: DebugLog["level"]) => {
    switch (level) {
      case "error":
        return "text-rose-400";
      case "warn":
        return "text-amber-400";
      case "info":
        return "text-cyan-400";
      default:
        return "text-white/40";
    }
  };

  return (
    <React.Fragment>
      <Head>
        <title>Polymarket Copy Trader</title>
        <meta
          name="description"
          content="Professional Polymarket trading dashboard"
        />
      </Head>
      <div className="flex flex-col h-screen bg-[#0a0a0b]">
        <NavBar
          status={status}
          onToggleBot={toggleBot}
          onAddWallet={() => setShowAddAccountModal(true)}
          walletConfigured={walletConfigured}
          onAccountSwitch={handleAccountSwitch}
        />
        <div className="flex-1 overflow-hidden">
          <Tabs
            realtimeLogs={realtimeLogs}
            onSettingsSaved={handleSettingsSaved}
          />
        </div>

        {/* Settings Saved While Running Warning Banner */}
        {needsRestart && (
          <div className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 flex items-center justify-between animate-slide-up">
            <div className="flex items-center gap-3">
              <svg
                className="w-5 h-5 text-amber-400"
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
              <span className="text-amber-400 text-sm font-medium">
                Settings changed. For the new changes to take place, please
                restart the bot.
              </span>
            </div>
            <button
              onClick={handleRestartBot}
              className="flex items-center gap-2 px-4 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-sm font-medium border border-amber-500/30 rounded transition-colors"
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
              Restart Bot
            </button>
          </div>
        )}

        {/* Collapsible Debug Logs Panel */}
        <div
          className={`border-t border-white/[0.06] bg-black/50 transition-all duration-300 ${logsExpanded ? "h-48" : "h-7"}`}
        >
          {/* Toggle bar */}
          <button
            onClick={() => setLogsExpanded(!logsExpanded)}
            className="w-full h-7 px-3 flex items-center justify-between text-xs text-white/50 hover:text-white/80 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-3 h-3 transition-transform duration-200 ${logsExpanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 15l7-7 7 7"
                />
              </svg>
              <span className="font-medium">Debug Logs</span>
              <span className="text-white/30">({debugLogs.length})</span>
            </div>
            {!logsExpanded && debugLogs.length > 0 && (
              <span className="text-white/30 font-mono truncate max-w-[60%]">
                {debugLogs[0]?.message}
              </span>
            )}
          </button>

          {/* Log content */}
          {logsExpanded && (
            <div className="h-[calc(100%-1.75rem)] overflow-y-auto font-mono text-[11px] leading-relaxed">
              {debugLogs.length === 0 ? (
                <div className="px-3 py-2 text-white/30">
                  No debug logs yet...
                </div>
              ) : (
                debugLogs.map((log) => (
                  <div
                    key={log.id}
                    className="px-3 py-0.5 hover:bg-white/[0.02] flex gap-2"
                  >
                    <span className="text-white/30 flex-shrink-0">
                      {formatDebugTime(log.timestamp)}
                    </span>
                    <span
                      className={`flex-shrink-0 w-10 uppercase ${getLevelColor(log.level)}`}
                    >
                      [{log.level}]
                    </span>
                    <span className="text-white/70 break-all">
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Account Modal */}
      {showAddAccountModal && (
        <AddAccountModal
          onClose={() => setShowAddAccountModal(false)}
          onSave={handleAccountAdded}
        />
      )}

      {/* Paper Trading Welcome Popup */}
      {showPaperPopup && (
        <PaperTradingPopup
          onClose={() => setShowPaperPopup(false)}
          onAddAccount={() => {
            setShowPaperPopup(false);
            setShowAddAccountModal(true);
          }}
        />
      )}
    </React.Fragment>
  );
}
