import {
  type ConflatedStreamFrame,
  type MacroRegimeData,
  type ParsedMnemonicCommand,
  type QARESignalFrame,
  type TickData,
  type SecurityMasterData,
  type PeerGraphData,
  type EdgarFilingRedlineData,
  type NewsItemData,
  type HistoricalPriceRow,
  type AnalystRatingsData,
  type CopilotQueryResponse,
  type EngineStatus,
  type LakehouseStats,
  type ParquetQueryResult,
  type MacroDispatchResult,
} from "./types";
import {
  createDefaultSignalFrame,
  getSecurityMaster,
  getPeerGraph,
  getEdgarFilingData,
  getNewsFeed,
  getHistoricalPrices,
  getAnalystRatings,
  queryCopilot,
  SAMPLE_TICKERS,
} from "./data_lake";
import { parse_mnemonic_command } from "./mnemonic";

export type ConnectionState = "CONNECTED" | "CONNECTING" | "SIMULATED_FALLBACK" | "DISCONNECTED";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, any>;
  id: string | number;
}

export interface JsonRpcResponse<T = any> {
  jsonrpc: "2.0";
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number | null;
}

export class IpcClientService {
  private ws: WebSocket | null = null;
  private wsUrl: string = "ws://127.0.0.1:8194";
  private reconnectIntervalMs: number = 3000;
  private reconnectTimer: any = null;
  private simulationTimer: any = null;
  private isDestroyed: boolean = false;
  private reqIdCounter: number = 1;

  // Active state
  public connectionState: ConnectionState = "CONNECTING";
  public latencyMs: number = 12;
  public lastMessageTimestamp: number = 0;

  // Cache
  public signals: Map<string, QARESignalFrame> = new Map();
  public ticks: Map<string, TickData> = new Map();
  public macroRegime: MacroRegimeData = {
    current_state: "LOW_VOLATILITY",
    state_index: 0,
    filtered_probabilities: {
      low_volatility: 0.812,
      medium_volatility: 0.145,
      high_volatility: 0.043,
    },
    kappa: 0.80,
    transition_matrix: [
      [0.898, 0.096, 0.006],
      [0.185, 0.766, 0.049],
      [0.012, 0.321, 0.667],
    ],
  };

  // Subscribers
  private listeners: Set<(frame: ConflatedStreamFrame) => void> = new Set();
  private statusListeners: Set<(state: ConnectionState) => void> = new Set();

  constructor(wsUrl: string = "ws://127.0.0.1:8194") {
    this.wsUrl = wsUrl;
    this.initDefaultData();
    this.connect();
  }

  private initDefaultData(): void {
    const basePrices: Record<string, number> = {
      NVDA: 138.25,
      AAPL: 224.5,
      MSFT: 421.15,
      CRWD: 312.4,
      SPY: 574.8,
      TSLA: 248.9,
    };

    for (const ticker of SAMPLE_TICKERS) {
      const price = basePrices[ticker] ?? 100.0;
      const change = +(Math.random() * 4.0 - 1.5).toFixed(2);
      const changePct = +((change / price) * 100).toFixed(2);

      this.ticks.set(ticker, {
        ticker,
        price,
        change,
        change_pct: changePct,
        bid: +(price - 0.02).toFixed(2),
        ask: +(price + 0.02).toFixed(2),
        volume: Math.floor(15000000 + Math.random() * 20000000),
        high_24h: +(price * 1.025).toFixed(2),
        low_24h: +(price * 0.985).toFixed(2),
        timestamp_ms: Date.now(),
      });

      this.signals.set(ticker, createDefaultSignalFrame(ticker, price));
    }
  }

  public isMarketSessionOpen(d: Date = new Date()): boolean {
    const day = d.getUTCDay();
    // 0 = Sunday, 6 = Saturday -> Exchange Closed
    if (day === 0 || day === 6) return false;
    const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60;
    // 9:30 AM to 4:00 PM US Eastern is approx 13:30 to 21:00 UTC
    return utcHours >= 13.5 && utcHours <= 21.0;
  }

  public subscribe(callback: (frame: ConflatedStreamFrame) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public subscribeStatus(callback: (state: ConnectionState) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.connectionState);
    return () => this.statusListeners.delete(callback);
  }

  private setStatus(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      for (const cb of this.statusListeners) {
        cb(state);
      }
    }
  }

  public connect(): void {
    if (this.isDestroyed) return;
    if (typeof WebSocket === "undefined" || (globalThis as any).process?.env?.VITEST) {
      this.startSimulation();
      return;
    }

    try {
      this.setStatus("CONNECTING");
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.setStatus("CONNECTED");
        this.stopSimulation();
        this.sendPing();
        this.hydrateFromLiveEngine();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleInboundMessage(data);
        } catch {
          // invalid JSON ignored
        }
      };

      this.ws.onerror = () => {
        // ws error will trigger onclose
      };

      this.ws.onclose = () => {
        if (!this.isDestroyed) {
          this.startSimulation();
          this.scheduleReconnect();
        }
      };
    } catch {
      this.startSimulation();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isDestroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.connectionState !== "CONNECTED") {
        this.connect();
      }
    }, this.reconnectIntervalMs);
  }

  private handleInboundMessage(payload: any): void {
    this.lastMessageTimestamp = Date.now();

    if (payload.type === "CONNECTION_ESTABLISHED") {
      this.setStatus("CONNECTED");
      return;
    }

    if (payload.type === "CONFLATED_STREAM_FRAME") {
      if (payload.ticks) {
        for (const [sym, tick] of Object.entries(payload.ticks)) {
          this.ticks.set(sym, tick as TickData);
        }
      }
      if (payload.signals) {
        for (const [sym, sig] of Object.entries(payload.signals)) {
          this.signals.set(sym, sig as QARESignalFrame);
        }
      }
      if (payload.macro_regime) {
        this.macroRegime = payload.macro_regime as MacroRegimeData;
      }

      for (const listener of this.listeners) {
        listener(payload as ConflatedStreamFrame);
      }
    }
  }

  private simulationTickCount: number = 0;

  private startSimulation(): void {
    this.setStatus("SIMULATED_FALLBACK");
    if (this.simulationTimer) return;

    // Simulate 250ms conflated engine ticks (4Hz institutional standard)
    this.simulationTimer = setInterval(() => {
      this.stepSimulation();
    }, 250);
  }

  private stopSimulation(): void {
    if (this.simulationTimer) {
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
  }

  private stepSimulation(): void {
    this.simulationTickCount++;
    const updatedTicks: Record<string, TickData> = {};
    const updatedSignals: Record<string, QARESignalFrame> = {};

    const allTickers = Array.from(this.ticks.keys());
    if (allTickers.length === 0) return;

    // Conflate micro-ticks across 2 rotating symbols per cycle to eliminate UI flood
    const targetCount = Math.min(2, allTickers.length);
    const startIdx = (this.simulationTickCount * 2) % allTickers.length;
    const activeSubSet: string[] = [];
    for (let i = 0; i < targetCount; i++) {
      activeSubSet.push(allTickers[(startIdx + i) % allTickers.length]);
    }

    // Ensure NVDA (default hero) receives periodic ticks
    if (!activeSubSet.includes("NVDA") && this.ticks.has("NVDA") && this.simulationTickCount % 2 === 0) {
      activeSubSet.push("NVDA");
    }

    for (const ticker of activeSubSet) {
      const currentTick = this.ticks.get(ticker);
      if (!currentTick) continue;

      // On weekends or outside trading sessions, quotes freeze at Friday's closing print
      const delta = this.isMarketSessionOpen()
        ? (Math.random() - 0.495) * (currentTick.price * 0.0006)
        : 0;
      const newPrice = +(currentTick.price + delta).toFixed(2);
      const change = +(currentTick.change + delta).toFixed(2);
      const changePct = +((change / (newPrice - change)) * 100).toFixed(2);

      const updated: TickData = {
        ...currentTick,
        price: newPrice,
        change,
        change_pct: changePct,
        bid: +(newPrice - 0.02).toFixed(2),
        ask: +(newPrice + 0.02).toFixed(2),
        timestamp_ms: Date.now(),
      };
      this.ticks.set(ticker, updated);
      updatedTicks[ticker] = updated;

      // Only update and emit signals when price moves meaningfully (>= 0.15%) or every 16 cycles (~4s)
      const currentSig = this.signals.get(ticker) ?? createDefaultSignalFrame(ticker, newPrice);
      const oldPrice = currentSig.execution_recommendation.entry_price || newPrice;
      const priceDiffPct = Math.abs(newPrice - oldPrice) / oldPrice;

      if (priceDiffPct >= 0.0015 || this.simulationTickCount % 16 === 0) {
        const atr = newPrice * 0.035;
        const dynamicTakeProfit = +(newPrice + 2.0 * atr).toFixed(2);
        const dynamicStopLoss = +(newPrice - 1.0 * atr).toFixed(2);

        const updatedSig: QARESignalFrame = {
          ...currentSig,
          timestamp_utc: new Date().toISOString(),
          execution_recommendation: {
            ...currentSig.execution_recommendation,
            entry_price: newPrice,
            dynamic_take_profit: dynamicTakeProfit,
            dynamic_stop_loss: dynamicStopLoss,
          },
        };
        this.signals.set(ticker, updatedSig);
        updatedSignals[ticker] = updatedSig;
      }
    }

    // Only drift macro regime every 20 cycles (~5 seconds) to avoid constant matrix recalculations
    let emittedRegime: MacroRegimeData | undefined = undefined;
    if (this.simulationTickCount % 20 === 0) {
      const rawLow = Math.min(0.92, Math.max(0.65, this.macroRegime.filtered_probabilities.low_volatility + (Math.random() - 0.5) * 0.002));
      const maxMed = Math.max(0.04, 0.99 - rawLow);
      const rawMed = Math.min(maxMed, Math.max(0.04, this.macroRegime.filtered_probabilities.medium_volatility + (Math.random() - 0.5) * 0.002));
      const probLow = +rawLow.toFixed(3);
      const probMed = +rawMed.toFixed(3);
      const probHigh = +Math.max(0.001, 1.0 - probLow - probMed).toFixed(3);

      this.macroRegime = {
        ...this.macroRegime,
        filtered_probabilities: {
          low_volatility: probLow,
          medium_volatility: probMed,
          high_volatility: probHigh,
        },
      };
      emittedRegime = this.macroRegime;
    }

    const conflatedFrame: ConflatedStreamFrame = {
      type: "CONFLATED_STREAM_FRAME",
      conflation_interval_ms: 250,
      timestamp_ms: Date.now(),
      ticks: updatedTicks,
      signals: Object.keys(updatedSignals).length > 0 ? updatedSignals : undefined,
      macro_regime: emittedRegime,
    };

    for (const listener of this.listeners) {
      listener(conflatedFrame);
    }
  }

  private async hydrateFromLiveEngine(): Promise<void> {
    try {
      const regRes = await this.executeJsonRpc<MacroRegimeData>("get_macro_regime");
      if (regRes.result) {
        this.macroRegime = regRes.result;
      }
      const sigUpdates: Record<string, QARESignalFrame> = {};
      for (const sym of ["NVDA", "MSFT", "AAPL", "CRWD"]) {
        const sigRes = await this.executeJsonRpc<QARESignalFrame>("get_signal", { ticker: sym });
        if (sigRes.result && sigRes.result.execution_recommendation) {
          this.signals.set(sym, sigRes.result);
          sigUpdates[sym] = sigRes.result;
        }
      }
      const frame: ConflatedStreamFrame = {
        type: "CONFLATED_STREAM_FRAME",
        conflation_interval_ms: 100,
        timestamp_ms: Date.now(),
        signals: sigUpdates,
        macro_regime: this.macroRegime,
      };
      for (const listener of this.listeners) {
        listener(frame);
      }
    } catch {
      // fallback silently if initial hydration fails
    }
  }

  public sendPing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const sendTime = Date.now();
      const payload: JsonRpcRequest = {
        jsonrpc: "2.0",
        method: "ping",
        params: { timestamp: sendTime },
        id: this.reqIdCounter++,
      };
      this.ws.send(JSON.stringify(payload));
    }
  }

  /**
   * JSON-RPC 2.0 client execution interface for Unix domain socket / IPC.
   * Matches Unix Domain Socket server methods from amstal-engine/src/ipc/uds_server.py:
   *   - ping
   *   - execute_command
   *   - get_signal
   *   - get_portfolio
   *   - get_macro_regime
   */
  public async executeJsonRpc<T = any>(method: string, params: Record<string, any> = {}): Promise<JsonRpcResponse<T>> {
    const id = this.reqIdCounter++;

    // If active websocket is open and daemon is online, dispatch through it
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return new Promise((resolve) => {
        const tempHandler = (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (data.id === id) {
              clearTimeout(timeout);
              this.ws?.removeEventListener("message", tempHandler);
              resolve(data);
            }
          } catch {}
        };

        const timeout = setTimeout(() => {
          this.ws?.removeEventListener("message", tempHandler);
          resolve(this.mockJsonRpcResponse(method, params, id));
        }, 1500);

        this.ws?.addEventListener("message", tempHandler);
        this.ws?.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method,
            params,
            id,
          })
        );
      });
    }

    // Fallback: synchronous institutional response provider matching engine logic
    return this.mockJsonRpcResponse(method, params, id);
  }

  private mockJsonRpcResponse<T = any>(method: string, params: Record<string, any>, id: number): JsonRpcResponse<T> {
    const start = Date.now();

    switch (method) {
      case "ping":
        return {
          jsonrpc: "2.0",
          result: {
            status: "PONG",
            client_timestamp: params.timestamp,
            server_timestamp: Date.now(),
          } as any,
          id,
        };

      case "execute_command": {
        const raw_input = params.raw_input || "";
        const parsed = parse_mnemonic_command(raw_input);
        return {
          jsonrpc: "2.0",
          result: {
            status: "COMMAND_PROCESSED",
            raw_input,
            parsed,
            timestamp: Date.now(),
          } as any,
          id,
        };
      }

      case "get_signal": {
        const ticker = (params.ticker || "SPY").toUpperCase();
        let sig = this.signals.get(ticker);
        if (!sig) {
          sig = createDefaultSignalFrame(ticker);
          this.signals.set(ticker, sig);
        }
        return {
          jsonrpc: "2.0",
          result: sig as any,
          id,
        };
      }

      case "get_portfolio": {
        return {
          jsonrpc: "2.0",
          result: {
            allocations: {
              NVDA: 0.185,
              AAPL: 0.142,
              MSFT: 0.168,
              CRWD: 0.085,
              SPY: 0.22,
            },
            gross_exposure: 0.8,
            net_exposure: 0.65,
            expected_growth_rate: 0.142,
            friction_bps: 15.0,
          } as any,
          id,
        };
      }

      case "get_macro_regime": {
        return {
          jsonrpc: "2.0",
          result: this.macroRegime as any,
          id,
        };
      }

      case "get_security_master": {
        const ticker = (params.ticker || "SPY").toUpperCase();
        const data = getSecurityMaster(ticker);
        return {
          jsonrpc: "2.0",
          result: data as any,
          id,
        };
      }

      case "get_peer_graph": {
        const ticker = (params.ticker || "SPY").toUpperCase();
        const data = getPeerGraph(ticker);
        return {
          jsonrpc: "2.0",
          result: data as any,
          id,
        };
      }

      case "get_edgar_filings": {
        const ticker = (params.ticker || "SPY").toUpperCase();
        const data = getEdgarFilingData(ticker);
        return {
          jsonrpc: "2.0",
          result: data as any,
          id,
        };
      }

      case "get_news_feed": {
        const ticker = (params.ticker || "SPY").toUpperCase();
        const data = getNewsFeed(ticker);
        return {
          jsonrpc: "2.0",
          result: data as any,
          id,
        };
      }

      case "get_historical_prices": {
        const ticker = (params.ticker || "SPY").toUpperCase();
        const count = params.count || 30;
        const data = getHistoricalPrices(ticker, count);
        return {
          jsonrpc: "2.0",
          result: data as any,
          id,
        };
      }

      case "get_analyst_ratings": {
        const ticker = (params.ticker || "SPY").toUpperCase();
        const data = getAnalystRatings(ticker);
        return {
          jsonrpc: "2.0",
          result: data as any,
          id,
        };
      }

      case "copilot_query": {
        const query = params.query || "";
        const ticker = (params.ticker || "SPY").toUpperCase();
        const data = {
          answer: `Amstal Quant Copilot analyzed your request for ${ticker}. Factor composite indicates strong momentum and robust balance sheet liquidity under Point-in-Time filtering.`,
          sources: ["Amstal Engine Local IPC", "Security Master DB", "FactSet Consensus"],
          suggested_commands: [`${ticker} GP <GO>`, `${ticker} PORT <GO>`, `${ticker} ANR <GO>`],
          model: "amstal-quant-copilot-deterministic-v1.3",
        };
        return {
          jsonrpc: "2.0",
          result: data as any,
          id,
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
          id,
        };
    }
  }

  public getSignal(ticker: string): QARESignalFrame {
    const t = ticker.toUpperCase();
    let s = this.signals.get(t);
    if (!s) {
      s = createDefaultSignalFrame(t);
      this.signals.set(t, s);
    }
    return s;
  }

  public getTick(ticker: string): TickData {
    const t = ticker.toUpperCase();
    let tick = this.ticks.get(t);
    if (!tick) {
      tick = {
        ticker: t,
        price: 150.0,
        change: 0.0,
        change_pct: 0.0,
        bid: 149.98,
        ask: 150.02,
        volume: 12000000,
        high_24h: 152.0,
        low_24h: 148.5,
        timestamp_ms: Date.now(),
      };
      this.ticks.set(t, tick);
    }
    return tick;
  }

  public getSecurityMaster(ticker: string): SecurityMasterData {
    return getSecurityMaster(ticker);
  }

  public getPeerGraph(ticker: string): PeerGraphData {
    return getPeerGraph(ticker);
  }

  public getEdgarFilings(ticker: string): EdgarFilingRedlineData {
    return getEdgarFilingData(ticker);
  }

  public getNewsFeed(ticker: string): NewsItemData[] {
    return getNewsFeed(ticker);
  }

  public getHistoricalPrices(ticker: string, count: number = 30): HistoricalPriceRow[] {
    return getHistoricalPrices(ticker, count);
  }

  public getAnalystRatings(ticker: string): AnalystRatingsData {
    return getAnalystRatings(ticker);
  }

  public async queryCopilot(query: string, ticker: string = "NVDA"): Promise<CopilotQueryResponse> {
    return queryCopilot(query, ticker);
  }

  // -------------------------------------------------------------------------
  // Native Tauri 2.0 Desktop Shell Integration
  // -------------------------------------------------------------------------

  public isTauriDesktop(): boolean {
    return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
  }

  public async invokeTauri<T>(cmd: string, args: Record<string, any> = {}): Promise<T> {
    if (this.isTauriDesktop()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<T>(cmd, args);
      } catch (err) {
        throw new Error(`Tauri invoke failed for ${cmd}: ${err}`);
      }
    }
    throw new Error(`Native desktop execution is only available inside Tauri shell (command: ${cmd})`);
  }

  public async checkEngineStatus(): Promise<EngineStatus> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<EngineStatus>("check_engine_status");
    }
    return {
      is_running: this.connectionState === "CONNECTED",
      socket_path: "/tmp/amstal.sock",
      socket_exists: this.connectionState === "CONNECTED",
      ws_host: "127.0.0.1",
      ws_port: 8194,
      ws_alive: this.connectionState === "CONNECTED",
      managed_child_pid: null,
      uptime_secs: this.connectionState === "CONNECTED" ? 42 : 0,
    };
  }

  public async startEngine(): Promise<string> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<string>("start_engine");
    }
    return "Simulated: Engine daemon spawn signal sent";
  }

  public async stopEngine(): Promise<string> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<string>("stop_engine");
    }
    return "Simulated: Engine daemon stop signal sent";
  }

  public async restartEngine(): Promise<string> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<string>("restart_engine");
    }
    return "Simulated: Engine daemon restart signal sent";
  }

  public async queryParquet(sqlQuery: string): Promise<ParquetQueryResult> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<ParquetQueryResult>("query_parquet", { sqlQuery });
    }
    return {
      columns: ["ticker", "timestamp", "close", "volume"],
      rows: [
        { ticker: "NVDA", timestamp: "2024-11-06T20:00:00Z", close: 138.25, volume: 42500000 },
        { ticker: "AAPL", timestamp: "2024-11-06T20:00:00Z", close: 224.5, volume: 38100000 },
      ],
      row_count: 2,
      execution_time_ms: 1.45,
    };
  }

  public async getLakehouseStats(): Promise<LakehouseStats> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<LakehouseStats>("get_lakehouse_stats");
    }
    return {
      base_lakehouse_path: "amstal-engine/data",
      exists: true,
      processed_partitions_count: 250,
      universe_snapshots_count: 10,
      total_size_bytes: 52428800,
    };
  }

  public async processHardwareMacro(keyCode: string): Promise<MacroDispatchResult> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<MacroDispatchResult>("process_hardware_macro", { keyCode });
    }
    const kc = keyCode.toUpperCase();
    const action = kc === "AM_GO" ? "EXECUTE_GO" : kc === "AM_CANCEL" ? "CANCEL_COMMAND" : "NAVIGATE_PANEL";
    return {
      key_code: kc,
      routed_action: action,
      mnemonic: kc.startsWith("AM_") ? kc.slice(3) : null,
      handled: true,
    };
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.stopSimulation();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
    this.statusListeners.clear();
  }
}

// Global singleton instance for easy import across Svelte 5 components
export const ipcService = new IpcClientService();
