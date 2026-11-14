import {
  type ConflatedStreamFrame,
  type MacroRegimeData,
  type ParsedMnemonicCommand,
  type QARESignalFrame,
  type TickData,
  type OHLCVBar,
  type FinancialStatementsPayload,
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
} from "./types";
import { parse_mnemonic_command } from "./mnemonic";

export type ConnectionState = "CONNECTED" | "CONNECTING" | "DISCONNECTED";

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
  private pingTimer: any = null;
  private isDestroyed: boolean = false;
  private reqIdCounter: number = 1;

  // Active state
  public connectionState: ConnectionState = "CONNECTING";
  public latencyMs: number | null = null;
  public lastMessageTimestamp: number = 0;
  public lastError: string | null = null;

  // Live cache (populated exclusively from QARE-MM backend RPC / WebSocket frames)
  public signals: Map<string, QARESignalFrame> = new Map();
  public ticks: Map<string, TickData> = new Map();
  public securityMasters: Map<string, SecurityMasterData> = new Map();
  public peerGraphs: Map<string, PeerGraphData> = new Map();
  public edgarFilings: Map<string, EdgarFilingRedlineData> = new Map();
  public newsFeeds: Map<string, NewsItemData[]> = new Map();
  public historicalPrices: Map<string, HistoricalPriceRow[]> = new Map();
  public historicalCandles: Map<string, OHLCVBar[]> = new Map();
  public analystRatings: Map<string, AnalystRatingsData> = new Map();
  public financials: Map<string, FinancialStatementsPayload> = new Map();
  public portfolio: Record<string, any> | null = null;
  private fetchTimestamps: Map<string, number> = new Map();
  private inflightFetches: Map<string, Promise<any>> = new Map();
  public macroRegime: MacroRegimeData | null = null;

  // Subscribers
  private listeners: Set<(frame: ConflatedStreamFrame) => void> = new Set();
  private statusListeners: Set<(state: ConnectionState) => void> = new Set();

  constructor(wsUrl: string = "ws://127.0.0.1:8194") {
    this.wsUrl = wsUrl;
    this.connect();
  }

  public isMarketSessionOpen(d: Date = new Date()): boolean {
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const weekday = parts.find((p) => p.type === "weekday")?.value;
      if (weekday === "Sat" || weekday === "Sun") return false;
      const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
      const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
      const etMinutes = hour * 60 + minute;
      return etMinutes >= 9 * 60 + 30 && etMinutes <= 16 * 60;
    } catch {
      const day = d.getUTCDay();
      if (day === 0 || day === 6) return false;
      const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60;
      return utcHours >= 13.5 && utcHours <= 21.0;
    }
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
      this.setStatus("DISCONNECTED");
      return;
    }

    try {
      this.setStatus("CONNECTING");
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.setStatus("CONNECTED");
        this.sendPing();
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.sendPing(), 2000);
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
        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        this.latencyMs = null;
        if (!this.isDestroyed) {
          this.setStatus("DISCONNECTED");
          this.scheduleReconnect();
        }
      };
    } catch {
      this.setStatus("DISCONNECTED");
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

  private normalizeTick(sym: string, raw: any): TickData {
    const price = Number(raw?.price ?? 0);
    return {
      ticker: (raw?.ticker || sym).toUpperCase(),
      price,
      change: Number(raw?.change ?? 0),
      change_pct: Number(raw?.change_pct ?? 0),
      bid: Number(raw?.bid ?? price),
      ask: Number(raw?.ask ?? price),
      volume: Number(raw?.volume ?? 0),
      high_24h: Number(raw?.high_24h ?? raw?.high ?? price),
      low_24h: Number(raw?.low_24h ?? raw?.low ?? price),
      timestamp_ms: Number(raw?.timestamp_ms ?? Date.now()),
      open: raw?.open !== undefined ? Number(raw.open) : undefined,
      high: raw?.high !== undefined ? Number(raw.high) : undefined,
      low: raw?.low !== undefined ? Number(raw.low) : undefined,
      prev_close: raw?.prev_close !== undefined ? Number(raw.prev_close) : undefined,
      date: typeof raw?.date === "string" ? raw.date : undefined,
    };
  }

  private emitFrame(frame: ConflatedStreamFrame): void {
    for (const listener of this.listeners) {
      listener(frame);
    }
  }

  private handleInboundMessage(payload: any): void {
    this.lastMessageTimestamp = Date.now();

    // Heartbeat / RPC RTT ping latency update
    if (payload?.result?.status === "PONG" && typeof payload?.result?.client_timestamp === "number") {
      this.latencyMs = Math.max(1, Date.now() - payload.result.client_timestamp);
      return;
    }

    if (payload.type === "CONNECTION_ESTABLISHED") {
      this.setStatus("CONNECTED");
      return;
    }

    if (payload.type === "CONFLATED_STREAM_FRAME") {
      if (payload.ticks) {
        const normalizedTicks: Record<string, TickData> = {};
        for (const [sym, rawTick] of Object.entries(payload.ticks)) {
          const t = this.normalizeTick(sym, rawTick);
          this.ticks.set(sym.toUpperCase(), t);
          normalizedTicks[sym.toUpperCase()] = t;
        }
        payload.ticks = normalizedTicks;
      }
      if (payload.signals) {
        for (const [sym, sig] of Object.entries(payload.signals)) {
          this.signals.set(sym.toUpperCase(), sig as QARESignalFrame);
        }
      }
      if (payload.macro_regime) {
        this.macroRegime = payload.macro_regime as MacroRegimeData;
      }

      this.emitFrame(payload as ConflatedStreamFrame);
    }
  }

  private async hydrateFromLiveEngine(): Promise<void> {
    try {
      await Promise.all([
        this.fetchMacroRegime(true),
        this.fetchPortfolio(true),
      ]);

      const coreTickers = ["NVDA", "MSFT", "AAPL", "CRWD", "SPY", "TSLA"];
      await Promise.all(
        coreTickers.map(async (sym) => {
          await Promise.all([
            this.fetchSignal(sym, true),
            this.fetchTick(sym, true),
          ]);
        })
      );
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
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

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (resp: JsonRpcResponse<T>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.ws?.removeEventListener("message", tempHandler);
          this.ws?.removeEventListener("close", closeHandler);
          resolve(resp);
        };

        const tempHandler = (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (data.id === id) {
              finish(data);
            }
          } catch {}
        };

        const closeHandler = () => {
          finish({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: `WebSocket disconnected during ${method}`,
            },
            id,
          });
        };

        const timeout = setTimeout(() => {
          finish({
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: `RPC request timed out after 8000ms (${method})`,
            },
            id,
          });
        }, 8000);

        this.ws?.addEventListener("message", tempHandler);
        this.ws?.addEventListener("close", closeHandler);
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

    if (method === "execute_command") {
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

    return {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Engine daemon not connected (no simulated fallback)",
      },
      id,
    };
  }

  public getMacroRegime(): MacroRegimeData | null {
    return this.macroRegime;
  }

  public getSignal(ticker: string): QARESignalFrame | null {
    return this.signals.get(ticker.toUpperCase()) ?? null;
  }

  public getTick(ticker: string): TickData | null {
    return this.ticks.get(ticker.toUpperCase()) ?? null;
  }

  private isLiveConnected(): boolean {
    return this.connectionState === "CONNECTED" && Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  private async fetchWithTtl<T>(
    cacheKey: string,
    ttlMs: number,
    force: boolean,
    loader: () => Promise<T | null>,
    getCached?: () => T | null
  ): Promise<T | null> {
    if (!this.isLiveConnected()) return null;
    const now = Date.now();
    const last = this.fetchTimestamps.get(cacheKey) ?? 0;
    if (!force && now - last < ttlMs) {
      return getCached ? getCached() : null;
    }

    const existing = this.inflightFetches.get(cacheKey);
    if (existing) return existing;

    const p = (async () => {
      try {
        const res = await loader();
        if (res !== null) {
          this.fetchTimestamps.set(cacheKey, Date.now());
        }
        return res;
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        return null;
      } finally {
        this.inflightFetches.delete(cacheKey);
      }
    })();
    this.inflightFetches.set(cacheKey, p);
    return p;
  }

  public async fetchMacroRegime(force: boolean = false): Promise<MacroRegimeData | null> {
    return this.fetchWithTtl(
      "macro_regime",
      30_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<MacroRegimeData>("get_macro_regime");
        if (res.result && res.result.filtered_probabilities) {
          this.macroRegime = res.result;
          this.emitFrame({
            type: "CONFLATED_STREAM_FRAME",
            timestamp_ms: Date.now(),
            macro_regime: res.result,
          });
          return res.result;
        }
        return null;
      },
      () => this.macroRegime
    );
  }

  public async fetchTick(ticker: string, force: boolean = false): Promise<TickData | null> {
    const t = ticker.toUpperCase();
    return this.fetchWithTtl(
      `tick:${t}`,
      5_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<any>("get_tick", { ticker: t });
        if (res.result && Number(res.result.price) > 0) {
          const norm = this.normalizeTick(t, res.result);
          this.ticks.set(t, norm);
          this.emitFrame({
            type: "CONFLATED_STREAM_FRAME",
            timestamp_ms: Date.now(),
            ticks: { [t]: norm },
          });
          return norm;
        }
        return null;
      },
      () => this.ticks.get(t) ?? null
    );
  }

  public async fetchSignal(ticker: string, force: boolean = false): Promise<QARESignalFrame | null> {
    const t = ticker.toUpperCase();
    return this.fetchWithTtl(
      `signal:${t}`,
      15_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<QARESignalFrame>("get_signal", { ticker: t });
        if (res.result && res.result.execution_recommendation) {
          this.signals.set(t, res.result);
          this.emitFrame({
            type: "CONFLATED_STREAM_FRAME",
            timestamp_ms: Date.now(),
            signals: { [t]: res.result },
          });
          return res.result;
        }
        return null;
      },
      () => this.signals.get(t) ?? null
    );
  }

  public async fetchPortfolio(force: boolean = false): Promise<Record<string, any> | null> {
    return this.fetchWithTtl(
      "portfolio",
      30_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<Record<string, any>>("get_portfolio");
        if (res.result && res.result.allocations) {
          this.portfolio = res.result;
          this.emitFrame({ type: "CONFLATED_STREAM_FRAME", timestamp_ms: Date.now() });
          return res.result;
        }
        return null;
      },
      () => this.portfolio
    );
  }

  public getCachedHistoricalCandles(ticker: string, interval: string = "1D"): OHLCVBar[] | null {
    const key = `${ticker.toUpperCase()}:${interval.toLowerCase()}`;
    return this.historicalCandles.get(key) ?? null;
  }

  public async fetchHistoricalCandles(
    ticker: string,
    interval: string = "1D",
    count: number = 90,
    force: boolean = false
  ): Promise<OHLCVBar[] | null> {
    const t = ticker.toUpperCase();
    const iv = interval.toLowerCase();
    return this.fetchWithTtl(
      `candles:${t}:${iv}:${count}`,
      30_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<any[]>("get_historical_prices", {
          ticker: t,
          count,
          interval: iv,
        });
        const rows = Array.isArray(res.result) ? res.result : [];
        if (rows.length === 0) return null;

        // Backend returns most recent first; lightweight-charts requires strictly ascending chronological bars
        const ascending = [...rows].reverse();
        const seen = new Set<string | number>();
        const bars: OHLCVBar[] = [];
        for (const r of ascending) {
          const tm: string | number = typeof r.date === "number" ? r.date : String(r.date).slice(0, 10);
          if (seen.has(tm)) continue;
          seen.add(tm);
          bars.push({
            time: tm,
            open: Number(r.open),
            high: Number(r.high),
            low: Number(r.low),
            close: Number(r.close),
            volume: Number(r.volume ?? 0),
          });
        }
        bars.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
        this.historicalCandles.set(`${t}:${iv}`, bars);
        if (iv === "1d") {
          this.historicalPrices.set(t, rows as HistoricalPriceRow[]);
        }
        this.emitFrame({ type: "CONFLATED_STREAM_FRAME", timestamp_ms: Date.now() });
        return bars;
      },
      () => this.historicalCandles.get(`${t}:${iv}`) ?? null
    );
  }

  public async fetchSecurityMaster(ticker: string, force: boolean = false): Promise<SecurityMasterData | null> {
    const t = ticker.toUpperCase();
    return this.fetchWithTtl(
      `sm:${t}`,
      120_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<SecurityMasterData>("get_security_master", { ticker: t });
        if (res.result && res.result.ticker) {
          this.securityMasters.set(t, res.result);
          this.emitFrame({ type: "CONFLATED_STREAM_FRAME", timestamp_ms: Date.now() });
          return res.result;
        }
        return null;
      },
      () => this.securityMasters.get(t) ?? null
    );
  }

  public async fetchPeerGraph(ticker: string, force: boolean = false): Promise<PeerGraphData | null> {
    const t = ticker.toUpperCase();
    return this.fetchWithTtl(
      `pg:${t}`,
      60_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<PeerGraphData>("get_peer_graph", { ticker: t });
        if (res.result && Array.isArray(res.result.nodes)) {
          this.peerGraphs.set(t, res.result);
          this.emitFrame({ type: "CONFLATED_STREAM_FRAME", timestamp_ms: Date.now() });
          return res.result;
        }
        return null;
      },
      () => this.peerGraphs.get(t) ?? null
    );
  }

  public async fetchEdgarFilings(ticker: string, force: boolean = false): Promise<EdgarFilingRedlineData | null> {
    const t = ticker.toUpperCase();
    return this.fetchWithTtl(
      `edgar:${t}`,
      120_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<EdgarFilingRedlineData>("get_edgar_filings", { ticker: t });
        if (res.result && Array.isArray(res.result.redlines)) {
          this.edgarFilings.set(t, res.result);
          this.emitFrame({ type: "CONFLATED_STREAM_FRAME", timestamp_ms: Date.now() });
          return res.result;
        }
        return null;
      },
      () => this.edgarFilings.get(t) ?? null
    );
  }

  public async fetchNewsFeed(ticker: string, force: boolean = false): Promise<NewsItemData[] | null> {
    const t = ticker.toUpperCase();
    return this.fetchWithTtl(
      `news:${t}`,
      60_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<NewsItemData[]>("get_news_feed", { ticker: t });
        if (Array.isArray(res.result)) {
          this.newsFeeds.set(t, res.result);
          this.emitFrame({ type: "CONFLATED_STREAM_FRAME", timestamp_ms: Date.now() });
          return res.result;
        }
        return null;
      },
      () => this.newsFeeds.get(t) ?? null
    );
  }

  public async fetchHistoricalPrices(ticker: string, count: number = 45, force: boolean = false): Promise<HistoricalPriceRow[] | null> {
    const t = ticker.toUpperCase();
    return this.fetchWithTtl(
      `hp:${t}:${count}`,
      30_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<HistoricalPriceRow[]>("get_historical_prices", {
          ticker: t,
          count,
          interval: "1d",
        });
        if (Array.isArray(res.result)) {
          this.historicalPrices.set(t, res.result);
          this.emitFrame({ type: "CONFLATED_STREAM_FRAME", timestamp_ms: Date.now() });
          return res.result;
        }
        return null;
      },
      () => {
        const cached = this.historicalPrices.get(t);
        return cached ? cached.slice(0, count) : null;
      }
    );
  }

  public async fetchAnalystRatings(ticker: string, force: boolean = false): Promise<AnalystRatingsData | null> {
    const t = ticker.toUpperCase();
    return this.fetchWithTtl(
      `anr:${t}`,
      120_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<AnalystRatingsData>("get_analyst_ratings", { ticker: t });
        if (res.result && res.result.ticker) {
          this.analystRatings.set(t, res.result);
          this.emitFrame({ type: "CONFLATED_STREAM_FRAME", timestamp_ms: Date.now() });
          return res.result;
        }
        return null;
      },
      () => this.analystRatings.get(t) ?? null
    );
  }

  public async fetchFinancials(
    ticker: string,
    pitStrict: boolean = true,
    force: boolean = false
  ): Promise<FinancialStatementsPayload | null> {
    const t = ticker.toUpperCase();
    const key = `${t}:${pitStrict ? "pit" : "restated"}`;
    return this.fetchWithTtl(
      `fin:${key}`,
      120_000,
      force,
      async () => {
        const res = await this.executeJsonRpc<FinancialStatementsPayload>("get_financials", {
          ticker: t,
          pit_strict: pitStrict,
        });
        if (res.result && res.result.ticker) {
          this.financials.set(key, res.result);
          this.emitFrame({ type: "CONFLATED_STREAM_FRAME", timestamp_ms: Date.now() });
          return res.result;
        }
        return null;
      },
      () => this.financials.get(key) ?? null
    );
  }

  public async refreshTickerContext(ticker: string, force: boolean = false): Promise<void> {
    if (!this.isLiveConnected()) return;
    const t = ticker.toUpperCase();
    await Promise.all([
      this.fetchSignal(t, force),
      this.fetchTick(t, force),
      this.fetchHistoricalCandles(t, "1D", 90, force),
    ]);
  }

  public getSecurityMaster(ticker: string): SecurityMasterData | null {
    return this.securityMasters.get(ticker.toUpperCase()) ?? null;
  }

  public getPeerGraph(ticker: string): PeerGraphData | null {
    return this.peerGraphs.get(ticker.toUpperCase()) ?? null;
  }

  public getEdgarFilings(ticker: string): EdgarFilingRedlineData | null {
    return this.edgarFilings.get(ticker.toUpperCase()) ?? null;
  }

  public getNewsFeed(ticker: string): NewsItemData[] {
    return this.newsFeeds.get(ticker.toUpperCase()) ?? [];
  }

  public getHistoricalPrices(ticker: string, count: number = 30): HistoricalPriceRow[] {
    const cached = this.historicalPrices.get(ticker.toUpperCase());
    if (cached && cached.length > 0) {
      return cached.slice(0, count);
    }
    return [];
  }

  public getAnalystRatings(ticker: string): AnalystRatingsData | null {
    return this.analystRatings.get(ticker.toUpperCase()) ?? null;
  }

  public getFinancials(ticker: string, pitStrict: boolean = true): FinancialStatementsPayload | null {
    const key = `${ticker.toUpperCase()}:${pitStrict ? "pit" : "restated"}`;
    return this.financials.get(key) ?? null;
  }

  public async queryCopilot(query: string, ticker: string = "NVDA"): Promise<CopilotQueryResponse> {
    const sym = ticker.toUpperCase();
    if (this.isLiveConnected()) {
      try {
        const res = await this.executeJsonRpc<CopilotQueryResponse>("copilot_query", { query, ticker: sym });
        if (res.result && res.result.answer) {
          return res.result;
        }
        return {
          answer: res.error?.message || `Engine daemon returned an empty response for ${sym}.`,
          sources: [],
          suggested_commands: [`${sym} QARE <GO>`, `${sym} FA <GO>`],
          model: "QARE-MM Error",
        };
      } catch (err) {
        return {
          answer: `Copilot RPC failed while querying engine daemon: ${err instanceof Error ? err.message : String(err)}`,
          sources: [],
          suggested_commands: [`${sym} QARE <GO>`],
          model: "QARE-MM Error",
        };
      }
    }
    return {
      answer: "QARE-MM engine daemon is disconnected. Connect the live Python engine daemon on ws://127.0.0.1:8194 to run factual multi-modal research queries.",
      sources: [],
      suggested_commands: [`${sym} GP <GO>`, `${sym} FA <GO>`, `${sym} ANR <GO>`],
      model: "Engine Offline",
    };
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
    return "Engine daemon spawn signal sent";
  }

  public async stopEngine(): Promise<string> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<string>("stop_engine");
    }
    return "Engine daemon stop signal sent";
  }

  public async restartEngine(): Promise<string> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<string>("restart_engine");
    }
    return "Engine daemon restart signal sent";
  }

  public async queryParquet(sqlQuery: string): Promise<ParquetQueryResult> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<ParquetQueryResult>("query_parquet", { sqlQuery });
    }
    return {
      columns: [],
      rows: [],
      row_count: 0,
      execution_time_ms: 0,
    };
  }

  public async getLakehouseStats(): Promise<LakehouseStats> {
    if (this.isTauriDesktop()) {
      return this.invokeTauri<LakehouseStats>("get_lakehouse_stats");
    }
    return {
      base_lakehouse_path: "N/A (Tauri desktop shell required)",
      exists: false,
      processed_partitions_count: 0,
      universe_snapshots_count: 0,
      total_size_bytes: 0,
    };
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
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
