import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IpcClientService } from "../src/lib/ipc";
import { createDefaultSignalFrame } from "../src/lib/data_lake";

describe("IPC Client Service & JSON-RPC Protocol", () => {
  let ipc: IpcClientService;

  beforeEach(() => {
    ipc = new IpcClientService("ws://127.0.0.1:8194");
  });

  afterEach(() => {
    ipc.destroy();
  });

  it("initializes with connecting state and falls back to simulated stream when daemon is offline", async () => {
    expect(["CONNECTING", "SIMULATED_FALLBACK"]).toContain(ipc.connectionState);
    expect(ipc.ticks.has("NVDA")).toBe(true);
    expect(ipc.signals.has("NVDA")).toBe(true);
  });

  it("handles ping JSON-RPC request", async () => {
    const res = await ipc.executeJsonRpc("ping", { timestamp: Date.now() });
    expect(res.jsonrpc).toBe("2.0");
    expect(res.result).toBeDefined();
    expect(res.result.status).toBe("PONG");
    expect(res.result.server_timestamp).toBeGreaterThan(0);
  });

  it("handles execute_command JSON-RPC request", async () => {
    const res = await ipc.executeJsonRpc("execute_command", {
      raw_input: "NVDA US <EQUITY> FA <GO>",
    });
    expect(res.jsonrpc).toBe("2.0");
    expect(res.result.status).toBe("COMMAND_PROCESSED");
    expect(res.result.parsed.identifier).toBe("NVDA");
    expect(res.result.parsed.mnemonic).toBe("FA");
  });

  it("handles get_signal JSON-RPC request matching QARESignalFrame contract", async () => {
    const res = await ipc.executeJsonRpc("get_signal", { ticker: "NVDA" });
    expect(res.jsonrpc).toBe("2.0");
    const sig = res.result;
    expect(sig.ticker).toBe("NVDA");
    expect(sig.winning_engine).toBe("LIGHTGBM_105");
    expect(sig.execution_mode).toBe("LONG_ONLY");
    expect(sig.calibration).toBeDefined();
    expect(sig.calibration.calibrated_probabilities).toBeDefined();
    expect(sig.execution_recommendation).toBeDefined();
    expect(sig.macro_regime).toBeDefined();
  });

  it("enforces LONG_ONLY mode cash exit for non-BUY recommendations", () => {
    const holdFrame = createDefaultSignalFrame("AAPL");
    // Under LONG_ONLY, if action is HOLD or SELL, kelly allocations are 0.00
    if (holdFrame.execution_recommendation.action !== "BUY") {
      expect(holdFrame.execution_recommendation.unconstrained_kelly_pct).toBe(0.0);
      expect(holdFrame.execution_recommendation.l1_normalized_portfolio_allocation_pct).toBe(0.0);
    }
  });

  it("handles get_portfolio JSON-RPC request", async () => {
    const res = await ipc.executeJsonRpc("get_portfolio");
    expect(res.jsonrpc).toBe("2.0");
    expect(res.result.allocations).toBeDefined();
    expect(res.result.gross_exposure).toBeLessThanOrEqual(1.0);
  });

  it("handles get_macro_regime JSON-RPC request", async () => {
    const res = await ipc.executeJsonRpc("get_macro_regime");
    expect(res.jsonrpc).toBe("2.0");
    expect(res.result.filtered_probabilities).toBeDefined();
    expect(res.result.filtered_probabilities.low_volatility).toBeGreaterThan(0);
  });

  it("handles get_security_master and get_peer_graph JSON-RPC requests", async () => {
    const smRes = await ipc.executeJsonRpc("get_security_master", { ticker: "NVDA" });
    expect(smRes.jsonrpc).toBe("2.0");
    expect(smRes.result.ticker).toBe("NVDA");
    expect(smRes.result.cik).toBe("0001045810");

    const pgRes = await ipc.executeJsonRpc("get_peer_graph", { ticker: "NVDA" });
    expect(pgRes.jsonrpc).toBe("2.0");
    expect(pgRes.result.target_ticker).toBe("NVDA");
    expect(pgRes.result.nodes.length).toBe(10);
  });

  it("handles get_edgar_filings, get_news_feed, and get_historical_prices JSON-RPC requests", async () => {
    const edgarRes = await ipc.executeJsonRpc("get_edgar_filings", { ticker: "NVDA" });
    expect(edgarRes.jsonrpc).toBe("2.0");
    expect(edgarRes.result.ticker).toBe("NVDA");
    expect(edgarRes.result.redlines.length).toBeGreaterThan(0);
    expect(edgarRes.result.form4_transactions.length).toBeGreaterThan(0);

    const newsRes = await ipc.executeJsonRpc("get_news_feed", { ticker: "NVDA" });
    expect(newsRes.jsonrpc).toBe("2.0");
    expect(Array.isArray(newsRes.result)).toBe(true);
    expect(newsRes.result.length).toBeGreaterThan(0);
    expect(newsRes.result[0].finbert_score).toBeDefined();

    const hpRes = await ipc.executeJsonRpc("get_historical_prices", { ticker: "NVDA", count: 15 });
    expect(hpRes.jsonrpc).toBe("2.0");
    expect(Array.isArray(hpRes.result)).toBe(true);
    expect(hpRes.result.length).toBe(15);
    expect(hpRes.result[0].overnight_return).toBeDefined();
    expect(hpRes.result[0].intraday_return).toBeDefined();
  });

  it("returns -32601 error for unknown methods", async () => {
    const res = await ipc.executeJsonRpc("unknown_method_xyz");
    expect(res.jsonrpc).toBe("2.0");
    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe(-32601);
  });
});
