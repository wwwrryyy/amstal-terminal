import { describe, it, expect } from "vitest";
import {
  generateHistoricalCandles,
  get10YFinancialLakehouse,
  getFilingMetadata,
  createDefaultSignalFrame,
  getSecurityMaster,
  getPeerGraph,
  getEdgarFilingData,
  getNewsFeed,
  getHistoricalPrices,
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

  it("loads Security Master factsheet for DES <GO>", () => {
    const sm = getSecurityMaster("NVDA");
    expect(sm.ticker).toBe("NVDA");
    expect(sm.company_name).toBe("NVIDIA Corporation");
    expect(sm.primary_exchange).toContain("NASDAQ");
    expect(sm.cik).toBe("0001045810");
    expect(sm.beta_market_60d).toBeGreaterThan(0.5);
    expect(sm.market_cap_billions).toBeGreaterThan(100.0);
    expect(sm.business_summary.length).toBeGreaterThan(50);
  });

  it("builds 10-Node dynamic Peer GAT graph for SPLC <GO>", () => {
    const pg = getPeerGraph("NVDA");
    expect(pg.target_ticker).toBe("NVDA");
    expect(pg.nodes.length).toBe(10);
    expect(pg.edges.length).toBeGreaterThanOrEqual(9);

    // Node 0 is Target
    expect(pg.nodes[0].role).toBe("TARGET");
    expect(pg.nodes[0].role_code).toBe(0.0);

    // GICS peers (roles = 0.33)
    const gicsPeers = pg.nodes.filter((n) => n.role === "GICS_PEER");
    expect(gicsPeers.length).toBe(4);
    for (const p of gicsPeers) {
      expect(p.role_code).toBe(0.33);
    }

    // Lead-lag peers (roles = 0.66)
    const leadLagPeers = pg.nodes.filter((n) => n.role === "LEAD_LAG");
    expect(leadLagPeers.length).toBe(4);
    for (const p of leadLagPeers) {
      expect(p.role_code).toBe(0.66);
      expect(p.cross_corr_5d).toBeDefined();
    }

    // Sector ETF (role = 1.0)
    const etf = pg.nodes.find((n) => n.role === "SECTOR_ETF");
    expect(etf).toBeDefined();
    expect(etf?.role_code).toBe(1.0);
  });

  it("extracts SEC 10-K/10-Q redlines and Form 4 insider clusters for EDGAR <GO>", () => {
    const edgar = getEdgarFilingData("NVDA");
    expect(edgar.ticker).toBe("NVDA");
    expect(edgar.item1a_similarity).toBeGreaterThan(0.7);
    expect(edgar.redlines.length).toBeGreaterThan(0);
    expect(edgar.form4_transactions.length).toBeGreaterThan(0);

    // Form 4 transactions have valid structure
    for (const tx of edgar.form4_transactions) {
      expect(["P", "S"]).toContain(tx.transaction_code);
      expect(tx.shares).toBeGreaterThan(0);
      expect(tx.price).toBeGreaterThan(0);
      expect(typeof tx.is_10b5_1).toBe("boolean");
    }
  });

  it("fetches FinBERT news feed with continuous exponential decay for NEWS <GO>", () => {
    const news = getNewsFeed("NVDA");
    expect(news.length).toBeGreaterThanOrEqual(3);

    for (const item of news) {
      expect(item.headline.length).toBeGreaterThan(15);
      expect(item.finbert_score).toBeGreaterThanOrEqual(-1.0);
      expect(item.finbert_score).toBeLessThanOrEqual(1.0);
      expect(["BULLISH", "BEARISH", "NEUTRAL"]).toContain(item.sentiment_label);
      expect(item.decay_half_life_days).toBe(3.0);
      // Decay magnitude must not exceed raw magnitude
      expect(Math.abs(item.decayed_sentiment)).toBeLessThanOrEqual(Math.abs(item.finbert_score) + 1e-6);
    }
  });

  it("computes overnight vs intraday return decomposition for HP <GO>", () => {
    const prices = getHistoricalPrices("NVDA", 20);
    expect(prices.length).toBe(20);

    for (const p of prices) {
      expect(p.high).toBeGreaterThanOrEqual(p.open);
      expect(p.high).toBeGreaterThanOrEqual(p.close);
      expect(p.low).toBeLessThanOrEqual(p.open);
      expect(p.low).toBeLessThanOrEqual(p.close);
      expect(p.volume).toBeGreaterThan(0);
      expect(typeof p.overnight_return).toBe("number");
      expect(typeof p.intraday_return).toBe("number");
      expect(typeof p.total_return).toBe("number");
    }
  });
});
