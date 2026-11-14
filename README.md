# Amstal Terminal (`amstal-terminal`)

Desktop quantitative financial workstation built with **Tauri 2.0 (Rust)**, **Svelte 5 (Runes)**, and **TradingView Lightweight Charts**, paired over local IPC with [`amstal-engine`](https://github.com/wwwrryyy/amstal-engine).

For full specifications, see [`PRD.md`](./PRD.md) and [`architecture.md`](./architecture.md).

## Architecture & Features

- **Local IPC & OLAP**: Managed `amstal-engine` daemon (`daemon_supervisor.rs`), JSON-RPC over Unix Domain Socket (`/tmp/amstal.sock`), 100 ms conflated WebSocket stream (`ws://127.0.0.1:8194`), and confined read-only DuckDB Parquet queries (`parquet_query.rs`).
- **Mnemonic Workspace**: Bloomberg-style command bar (e.g., `NVDA US <EQUITY> GP <GO>`) with synchronized panels:
  - `GP`: Multi-timeframe candlesticks, VWAP, and triple-barrier levels.
  - `PORT` / `QARE`: Temperature-calibrated signal breakdown, missing-modality flags, and L1-normalized Kelly sizing.
  - `HMM`: Forward-filtered 3-state macro volatility regime dashboard.
  - `DES` / `FA`: Security master profile and Point-in-Time SEC XBRL financials.
  - `SPLC` / `EDGAR` / `NEWS` / `COPILOT`: Rolling peer graph, 10-Q/10-K redlines & Form 4 filings, decayed news sentiment, and local quant copilot.

## Directory Layout

```text
amstal-terminal/
├── src-tauri/src/           # main.rs, daemon_supervisor.rs, parquet_query.rs
├── src/
│   ├── App.svelte           # Main workspace & ticker/panel state
│   ├── components/          # ChartPanel, PortfolioKellyPanel, RegimePanel, CopilotPanel, etc.
│   └── lib/                 # ipc.ts, mnemonic.ts, types.ts
└── tests/                   # ipc.test.ts, mnemonic.test.ts, terminal_math.test.ts
```

## Development & Testing

```bash
git clone git@github.com:wwwrryyy/amstal-terminal.git
cd amstal-terminal
npm install

npm run check
npm test
npm run build
cd src-tauri && cargo test --locked
```

## License

[MIT](./LICENSE). Independent open-source research project; not affiliated with Bloomberg Finance L.P.
