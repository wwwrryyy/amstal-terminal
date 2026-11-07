import { describe, it, expect } from "vitest";
import {
  generateHistoricalCandles,
  get10YFinancialLakehouse,
  getFilingMetadata,
  createDefaultSignalFrame,
} from "../src/lib/data_lake";

describe("Data Lake & Quantitative Signal Provider", () => {
  it("generates valid OHLCV candlestick series", () => {
    const bars = generateHistoricalCandles("NVDA", 60);
    expect(bars.length).toBe(60);

    for (const bar of bars) {
      expect(bar.time).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(bar.high).toBeGreaterThanOrEqual(bar.open);
      expect(bar.high).toBeGreaterThanOrEqual(bar.close);
      expect(bar.low).toBeLessThanOrEqual(bar.open);
      expect(bar.low).toBeLessThanOrEqual(bar.close);
      expect(bar.volume).toBeGreaterThan(0);
    }
  });

  it("calculates ATR dynamic take-profit and stop-loss bounds", () => {
    const sig = createDefaultSignalFrame("NVDA", 140.0);
    const rec = sig.execution_recommendation;

    expect(rec.entry_price).toBe(140.0);
    expect(rec.dynamic_take_profit).toBeGreaterThan(rec.entry_price);
    expect(rec.dynamic_stop_loss).toBeLessThan(rec.entry_price);
    expect(rec.reward_to_risk_ratio).toBeGreaterThanOrEqual(1.5);
  });

  it("loads 10-Year XBRL lakehouse financial statements", () => {
    const lakehouse = get10YFinancialLakehouse("NVDA", true);

    expect(lakehouse.filings.length).toBe(10);
    expect(lakehouse.incomeStatement.length).toBeGreaterThan(0);
    expect(lakehouse.balanceSheet.length).toBeGreaterThan(0);
    expect(lakehouse.cashFlow.length).toBeGreaterThan(0);
    expect(lakehouse.ratios.length).toBeGreaterThan(0);

    // Verify accession numbers format
    for (const f of lakehouse.filings) {
      expect(f.accession_number).toMatch(/^\d{10}-\d{2}-\d{6}$/);
      expect(f.filed_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    // Revenue line item exists
    const revRow = lakehouse.incomeStatement.find((r) => r.tag === "Revenues");
    expect(revRow).toBeDefined();
    expect(revRow?.values["FY2024"]).toBeGreaterThan(0);
  });

  it("handles PIT Strict vs As-Restated cutoff modes", () => {
    const pitLakehouse = get10YFinancialLakehouse("NVDA", true);
    const restatedLakehouse = get10YFinancialLakehouse("NVDA", false);

    const pitRev = pitLakehouse.incomeStatement.find((r) => r.tag === "Revenues")?.values["FY2024"];
    const restatedRev = restatedLakehouse.incomeStatement.find((r) => r.tag === "Revenues")?.values["FY2024"];

    expect(pitRev).toBeDefined();
    expect(restatedRev).toBeDefined();
    // In restated mode, restateShift modifies values
    expect(restatedRev).toBeGreaterThan(pitRev!);
  });
});
