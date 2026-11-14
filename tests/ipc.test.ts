import { describe, expect, it, vi, beforeEach } from "vitest";
import { IpcClientService } from "../src/lib/ipc";

describe("IpcClientService (no-fallback live contract)", () => {
  let ipc: IpcClientService;

  beforeEach(() => {
    ipc = new IpcClientService("ws://127.0.0.1:19999");
  });

  it("initializes disconnected with null telemetry and empty stores (zero synthetic fixtures)", () => {
    expect(ipc.connectionState).toBe("DISCONNECTED");
    expect(ipc.latencyMs).toBeNull();
    expect(ipc.ticks.size).toBe(0);
    expect(ipc.signals.size).toBe(0);
    expect(ipc.macroRegime).toBeNull();

    expect(ipc.getMacroRegime()).toBeNull();
    expect(ipc.getSignal("NVDA")).toBeNull();
    expect(ipc.getTick("NVDA")).toBeNull();
    expect(ipc.getSecurityMaster("NVDA")).toBeNull();
    expect(ipc.getPeerGraph("NVDA")).toBeNull();
    expect(ipc.getEdgarFilings("NVDA")).toBeNull();
    expect(ipc.getAnalystRatings("NVDA")).toBeNull();
    expect(ipc.getFinancials("NVDA", true)).toBeNull();
    expect(ipc.getCachedHistoricalCandles("NVDA", "1d")).toBeNull();
    expect(ipc.getNewsFeed("NVDA")).toEqual([]);
    expect(ipc.getHistoricalPrices("NVDA", 20)).toEqual([]);
  });

  it("returns structured JSON-RPC -32000 error offline while allowing local execute_command parsing", async () => {
    const signalResp = await ipc.executeJsonRpc("get_signal", { ticker: "NVDA" });
    expect(signalResp).toMatchObject({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Engine daemon not connected (no simulated fallback)",
      },
    });
    expect(ipc.getSignal("NVDA")).toBeNull();

    const cmdResp = await ipc.executeJsonRpc("execute_command", { raw_input: "AAPL DES" });
    expect(cmdResp).toMatchObject({
      jsonrpc: "2.0",
      result: {
        status: "COMMAND_PROCESSED",
        raw_input: "AAPL DES",
        parsed: {
          identifier: "AAPL",
          mnemonic: "DES",
          is_valid: true,
        },
      },
    });
  });

  it("returns Engine Offline metadata for copilot and empty desktop fallbacks outside Tauri", async () => {
    const copilot = await ipc.queryCopilot("What is NVDA regime?", "NVDA");
    expect(copilot.model).toBe("Engine Offline");
    expect(copilot.sources).toEqual([]);
    expect(copilot.answer.toLowerCase()).toContain("disconnected");

    const parquet = await ipc.queryParquet("SELECT 1");
    expect(parquet).toEqual({
      columns: [],
      rows: [],
      row_count: 0,
      execution_time_ms: 0,
    });

    const stats = await ipc.getLakehouseStats();
    expect(stats).toEqual({
      base_lakehouse_path: "N/A (Tauri desktop shell required)",
      exists: false,
      processed_partitions_count: 0,
      universe_snapshots_count: 0,
      total_size_bytes: 0,
    });
  });

  it("evaluates NYSE/NASDAQ market hours accurately in America/New_York including DST and weekends", () => {
    // 2026-07-15 is a Wednesday in EDT (UTC-4): 14:30 UTC == 10:30 EDT (open)
    expect(ipc.isMarketSessionOpen(new Date("2026-07-15T14:30:00Z"))).toBe(true);
    // 2026-07-15 13:00 UTC == 09:00 EDT (pre-market, closed)
    expect(ipc.isMarketSessionOpen(new Date("2026-07-15T13:00:00Z"))).toBe(false);
    // 2026-11-12 is a Thursday in EST (UTC-5): 15:00 UTC == 10:00 EST (open)
    expect(ipc.isMarketSessionOpen(new Date("2026-11-12T15:00:00Z"))).toBe(true);
    // 2026-11-12 21:05 UTC == 16:05 EST (after close)
    expect(ipc.isMarketSessionOpen(new Date("2026-11-12T21:05:00Z"))).toBe(false);
    // 2026-11-14 is Saturday (closed even midday)
    expect(ipc.isMarketSessionOpen(new Date("2026-11-14T16:00:00Z"))).toBe(false);
  });

  it("hydrates ticks, signals, macroRegime, and latency from inbound WebSocket frames", () => {
    const notifySpy = vi.fn();
    const unsub = ipc.subscribe(notifySpy);

    const internal = ipc as unknown as {
      handleInboundMessage: (payload: Record<string, unknown>) => void;
    };

    const nowMs = Date.now();
    internal.handleInboundMessage({
      jsonrpc: "2.0",
      result: {
        status: "PONG",
        client_timestamp: nowMs - 12,
      },
      id: 1,
    });
    expect(typeof ipc.latencyMs).toBe("number");
    expect((ipc.latencyMs ?? -1) >= 12).toBe(true);

    internal.handleInboundMessage({
      type: "CONFLATED_STREAM_FRAME",
      ticks: {
        NVDA: {
          ticker: "NVDA",
          price: 185.42,
          change_pct: 1.85,
          volume: 42_000_000,
          timestamp: "2026-11-12T21:00:00Z",
        },
      },
      signals: {
        NVDA: {
          ticker: "NVDA",
          entry_price: 185.42,
          alpha_score: 0.64,
          take_profit_price: 198.0,
          stop_loss_price: 176.0,
          kelly_fraction: 0.085,
          kappa_regime_haircut: 0.72,
        },
      },
      macro_regime: {
        current_state: 1,
        state_probs: [0.22, 0.68, 0.10],
        regime_label: "Normal Vol",
        timestamp: "2026-11-12",
      },
    });

    expect(ipc.getTick("NVDA")?.price).toBe(185.42);
    expect(ipc.getSignal("NVDA")?.alpha_score).toBe(0.64);
    expect(ipc.getMacroRegime()?.current_state).toBe(1);
    expect(notifySpy).toHaveBeenCalled();

    unsub();
  });

  it("deduplicates concurrent fetchFinancials and sorts historical candles ascending", async () => {
    const internal = ipc as unknown as {
      ws: { readyState: number } | null;
      connectionState: string;
    };
    (globalThis as any).WebSocket ??= { OPEN: 1 };
    internal.ws = { readyState: (globalThis as any).WebSocket.OPEN ?? 1 };
    internal.connectionState = "CONNECTED";

    const rpcSpy = vi.spyOn(ipc, "executeJsonRpc").mockImplementation(async (method) => {
      if (method === "get_financials") {
        return {
          jsonrpc: "2.0",
          id: 1,
          result: {
            ticker: "NVDA",
            cik: "0001045810",
            pit_strict: true,
            source: "SEC_EDGAR_XBRL",
            records: [
              { fiscal_year: 2024, revenue_m: 60922 },
              { fiscal_year: 2025, revenue_m: 130497 },
            ],
          } as any,
        };
      }
      if (method === "get_historical_prices") {
        return {
          jsonrpc: "2.0",
          id: 2,
          result: [
            { date: "2026-11-12", open: 183, high: 186, low: 182, close: 185, volume: 30000000 },
            { date: "2026-11-10", open: 178, high: 181, low: 177, close: 180, volume: 28000000 },
            { date: "2026-11-11", open: 180, high: 184, low: 179, close: 183, volume: 29000000 },
          ] as any,
        };
      }
      return { jsonrpc: "2.0", id: 0, result: {} as any };
    });

    const [fin1, fin2] = await Promise.all([
      ipc.fetchFinancials("NVDA", true),
      ipc.fetchFinancials("NVDA", true),
    ]);
    expect(fin1?.cik).toBe("0001045810");
    expect(fin2).toEqual(fin1);
    expect(rpcSpy).toHaveBeenCalledTimes(1);

    // Subsequent sequential call inside 120s TTL also returns cached payload cleanly without RPC
    const fin3 = await ipc.fetchFinancials("NVDA", true);
    expect(fin3?.cik).toBe("0001045810");
    expect(rpcSpy).toHaveBeenCalledTimes(1);

    const candles = await ipc.fetchHistoricalCandles("NVDA", "1d");
    expect(candles?.map((c) => c.time)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(ipc.getCachedHistoricalCandles("NVDA", "1d")?.length).toBe(3);

    rpcSpy.mockRestore();
  });
});
