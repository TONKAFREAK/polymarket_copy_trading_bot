# Architecture & Development Guide

This document provides a technical overview of the Polymarket Copy Trading Bot for developers who wish to contribute or modify the codebase.

## System Overview

The application is a hybrid **Electron** desktop app with a **Node.js** backend process.
It follows a modular architecture separating the UI (Renderer), Main Process (Electron), and the Core Trading Logic.

```mermaid
graph TD
    UI[Renderer Process (React/Next.js)] <--> IPC[Electron IPC Bridge]
    IPC <--> Main[Main Process (Node.js)]
    Main --> Service[Bot Service]
    Service --> Watcher[Market Watcher]
    Service --> Executor[Order Executor]
    Service --> Risk[Risk Manager]
    Watcher -- Polling/WS --> PolyAPI[Polymarket API]
    Executor -- CLOB --> PolyCLOB[CLOB Client]
```

## Directory Structure

- `client/`: The Election + Next.js application.
  - `main/`: Electron Main process.
    - `background.ts`: Entry point. Handles window creation and IPC events.
    - `botService.ts`: Bridge between Electron and the Trading Core.
  - `renderer/`: Next.js UI.
    - `components/`: React components (Tabs, Charts, Tables).
    - `pages/`: Application routes.
- `src/`: The Core Trading Logic (shared with CLI).
  - `copier/`: The "Brain".
    - `watcher.ts`: Monitors target wallets for new activities.
    - `executor.ts`: Calculates sizing and places orders.
    - `risk.ts`: Validates trades against safety rules.
    - `paperTrading.ts`: Simulates execution and balance.
  - `polymarket/`: API Wrappers.
    - `clobClient.ts`: Official CLOB client wrapper.
    - `dataApi.ts`: Fetches user activity and positions.
  - `config/`: Configuration loading.

## Key Components

### 1. The Watcher (`src/copier/watcher.ts`)

Responsible for detecting trades.

- Polls `data-api.polymarket.com` for recent activity of target wallets.
- Filters for `TRADE` and `SPLIT` events.
- Uses a `seenTradeIds` Set to prevent duplicate copying.
- If it sees a trade transaction hash it hasn't processed, it emits a `trade` event.

### 2. The Executor (`src/copier/executor.ts`)

Receives `trade` events from the Watcher.

- **Step 1**: Fetches Market Metadata (Name, TokenID) via `Gamma API`.
- **Step 2**: Risk Check. Calls `RiskManager` to ensure limits aren't breached.
- **Step 3**: Sizing Calculation. Determines how much to buy based on `SIZING_MODE`.
- **Step 4**: Execution.
  - If Live: Signs and sends order to CLOB.
  - If Paper: Updates internal `paper-state.json`.

### 3. IPC Communication

The UI does not run trading logic directly. It sends commands to the Main process via `window.ipc`.

- **Channels**:
  - `polymarket:getProfileStats`: Fetch user data.
  - `config:read` / `config:write`: Manage settings.
  - `trading:status`: Get bot health.

## Development Workflow

1.  **Run in Dev Mode**:
    `npm run dev` (in root) spawns both the CLI and Desktop dev environment.
2.  **Hot Reloading**:
    - Changes to `client/renderer` auto-reload the UI.
    - Changes to `client/main` or `src/` require a restart of the electron process (handled by `nextron`).

## Technologies Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5
- **Desktop Wrapper**: Electron 28
- **UI Framework**: Next.js 14, React 18
- **Styling**: Tailwind CSS
- **State Management**: React Hooks + File Persistence (JSON)
- **API Integration**: Axios + WebSocket

---

## Contributing

1.  Fork the repo.
2.  Create a feature branch.
3.  Ensure `npm run build` passes.
4.  Submit a Pull Request.
