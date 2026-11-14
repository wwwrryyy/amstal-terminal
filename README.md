# Amstal Terminal (`amstal-terminal`)

Institutional-grade, AI-native desktop quantitative financial workstation reverse-engineered from the **Bloomberg Terminal** and **OpenBB**, built on **Tauri 2.0 (Rust)**, **Svelte 5 (Runes)**, and **TradingView Lightweight Charts (WebGL)**.

Deeply integrated via zero-copy local IPC with [`amstal-engine`](https://github.com/wwwrryyy/amstal-engine).

---

## Key Architecture & Specifications

For the complete end-to-end specifications, consult:
- **Product Requirements Document (PRD):** [`PRD.md`](./PRD.md)
- **Technical & Integration Architecture:** [`architecture.md`](./architecture.md)

---

## Desktop Workstation Highlights

1. **Native Performance & Thermal Ergonomics**:
   - Built on **Tauri 2.0** with macOS WKWebView / Windows WebView2, consuming ~150 MB RAM (vs 900+ MB for Electron).
   - Designed for fanless Apple Silicon (M5 Air 24 GB) with zero thermal throttling.

2. **Tri-Channel Local IPC Integration**:
   - **JSON-RPC 2.0 Control Plane**: Unix Domain Socket (`/tmp/amstal.sock` / Windows Named Pipe) for synchronous mnemonic execution and process lifecycle management (<1.5 ms latency).
   - **Streaming Conflation Broadcaster**: Local WebSocket (`ws://127.0.0.1:8194`, canonical Bloomberg port) receiving 100 ms conflated market ticks, order book updates, and regime transitions.
   - **In-Process Columnar OLAP**: Stateless `duckdb-rs` / `polars-rs` sessions querying immutable Apache Parquet files directly from disk (<15 ms for multi-year historical queries) with POSIX atomic write-and-rename (`os.replace`).

3. **Bloomberg Workflow Re-Creation**:
   - **Mnemonic Lexer & Grammar**: Reverse Polish Notation command bar supporting syntax like `NVDA US <EQUITY> FA <GO>`.
   - **Dockable 4-Tile Grid**: Responsive layout managed via Svelte 5 runes (`$state`, `$derived`) and `paneforge` with cross-panel ticker synchronization.

4. **Two-Tier Analytical Modules**:
   - **Tier 1 (MVP)**:
     - `GP <GO>`: Multi-timeframe candlesticks, intraday VWAP, dynamic ATR triple-barrier lines.
     - `PORT <GO>` / `QARE <GO>`: Multi-Outcome Fractional Kelly allocation sizer with $L_1$ portfolio normalization.
     - `HMM <GO>`: Forward-filtered 3-state Gaussian macro volatility regime dashboard (`low_volatility`, `medium_volatility`, `high_volatility`).
     - `DES <GO>`: Security master profile, orthogonalized market/sector betas, Point-in-Time business summaries.
     - `FA <GO>`: 10-year Point-in-Time financial statements keyed strictly by SEC `filed` acceptance date.
   - **Tier 2 (Alt-Data & Hardware)**:
     - `SPLC <GO>`: Dynamic rolling peer graph visualizing GICS and lead-lag correlations from PyG GAT.
     - `EDGAR <GO>`: SEC 10-K/10-Q filing browser with `difflib` redlines and Form 4 insider cluster tracking.
     - `NEWS <GO>`: Real-time headlines scored via local FinBERT with continuous exponential event decay.

---

## Project Structure

```
amstal-terminal/
├── PRD.md                             # Master Unified PRD
├── architecture.md                    # Technical & Integration Architecture
├── README.md                          # This Document
├── LICENSE                            # MIT License
├── src-tauri/                         # Tauri 2.0 Rust Core
│   ├── Cargo.toml                     # Rust dependencies (duckdb, tokio, interprocess)
│   ├── tauri.conf.json                # Window, permissions & build configuration
│   └── src/
│       ├── main.rs                    # Application entry point & engine daemon manager
│       ├── ipc/                       # UDS JSON-RPC 2.0 client & WebSocket listener
│       └── olap/                      # In-process duckdb-rs Parquet reader
└── src/                               # Svelte 5 Frontend
    ├── lib/
    │   ├── components/                # Omnibar, Panels (GP, PORT, HMM, DES, FA)
    │   ├── stores/                    # Svelte 5 Runes ($state) global workspace state
    │   └── charts/                    # Lightweight Charts WebGL rendering wrappers
    ├── App.svelte                     # Main 4-tile workspace window
    └── main.ts                        # Svelte initialization
```

---

## Development & Roadmap

Per the Amstal **Non-Negotiable Stop Rules**, workstation development (Phase 4) will commence once `amstal-engine` successfully passes Gate 1 out-of-sample quantitative falsification tests.

---

## License

This project is open-source under the [MIT License](./LICENSE). Amstal is an independent research project and is not affiliated with or endorsed by Bloomberg Finance L.P.
