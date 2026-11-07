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

  it("returns -32601 error for unknown methods", async () => {
    const res = await ipc.executeJsonRpc("unknown_method_xyz");
    expect(res.jsonrpc).toBe("2.0");
    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe(-32601);
  });
});
