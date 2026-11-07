import {
  type ConflatedStreamFrame,
  type MacroRegimeData,
  type ParsedMnemonicCommand,
  type QARESignalFrame,
  type TickData,
} from "./types";
import { createDefaultSignalFrame, SAMPLE_TICKERS } from "./data_lake";
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
    kappa: 0.85,
    transition_matrix: [
      [0.942, 0.051, 0.007],
      [0.082, 0.871, 0.047],
      [0.012, 0.138, 0.85],
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
    if (typeof WebSocket === "undefined") {
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

  private startSimulation(): void {
    this.setStatus("SIMULATED_FALLBACK");
    if (this.simulationTimer) return;

    // Simulate 100ms conflated engine ticks
    this.simulationTimer = setInterval(() => {
      this.stepSimulation();
    }, 100);
  }

  private stopSimulation(): void {
    if (this.simulationTimer) {
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
  }

  private stepSimulation(): void {
    const updatedTicks: Record<string, TickData> = {};
    const updatedSignals: Record<string, QARESignalFrame> = {};

    // Micro jitter for ticks
    for (const [ticker, currentTick] of this.ticks.entries()) {
      const delta = (Math.random() - 0.495) * (currentTick.price * 0.0006);
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

      // Update signal frame price and barriers
      const currentSig = this.signals.get(ticker) ?? createDefaultSignalFrame(ticker, newPrice);
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

    // Micro regime drift
    const probLow = Math.min(0.95, Math.max(0.65, this.macroRegime.filtered_probabilities.low_volatility + (Math.random() - 0.5) * 0.002));
    const probMed = Math.min(0.25, Math.max(0.05, this.macroRegime.filtered_probabilities.medium_volatility + (Math.random() - 0.5) * 0.002));
    const probHigh = +(1.0 - probLow - probMed).toFixed(3);

    this.macroRegime = {
      ...this.macroRegime,
      filtered_probabilities: {
        low_volatility: +probLow.toFixed(3),
        medium_volatility: +probMed.toFixed(3),
        high_volatility: probHigh,
      },
    };

    const conflatedFrame: ConflatedStreamFrame = {
      type: "CONFLATED_STREAM_FRAME",
      conflation_interval_ms: 100,
      timestamp_ms: Date.now(),
      ticks: updatedTicks,
      signals: updatedSignals,
      macro_regime: this.macroRegime,
    };

    for (const listener of this.listeners) {
      listener(conflatedFrame);
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
        const timeout = setTimeout(() => {
          resolve(this.mockJsonRpcResponse(method, params, id));
        }, 1500);

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
