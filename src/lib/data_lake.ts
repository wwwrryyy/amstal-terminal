import type {
  FinancialFilingMetadata,
  FinancialMetricRow,
  OHLCVBar,
  QARESignalFrame,
  MacroRegimeData,
  TickData,
  SecurityMasterData,
  PeerGraphData,
  EdgarFilingRedlineData,
  NewsItemData,
  HistoricalPriceRow,
  AnalystRatingsData,
  CopilotQueryResponse,
} from "./types";

export const SAMPLE_TICKERS = ["NVDA", "AAPL", "MSFT", "CRWD", "SPY", "TSLA"];

export function createDefaultSignalFrame(ticker: string, priceOverride?: number): QARESignalFrame {
  const t = ticker.toUpperCase();
  const basePrices: Record<string, number> = {
    NVDA: 138.25,
    AAPL: 224.5,
    MSFT: 421.15,
    CRWD: 312.4,
    SPY: 574.8,
    TSLA: 248.9,
  };
  const entryPrice = priceOverride ?? basePrices[t] ?? 100.0;
  const atr = entryPrice * 0.035; // 3.5% ATR estimate
  const dynamicTakeProfit = +(entryPrice + 2.0 * atr).toFixed(2);
  const dynamicStopLoss = +(entryPrice - 1.0 * atr).toFixed(2);

  const factorProfiles: Record<string, Record<string, number>> = {
    NVDA: {
      residual_momentum_20d_rank: 0.94,
      overnight_return_rank: 0.81,
      intraday_return_rank: 0.62,
      amihud_illiquidity_rank: -0.45,
      closing_power_rank: 0.88,
      decayed_finbert_sentiment: 0.76,
      decayed_form4_insider_cluster: 0.82,
      decayed_pead_shock: 0.64,
      decayed_10q_legal_risk_delta: -0.02,
      decayed_mda_catalyst_score: 0.85,
      peer_gat_spillover: 0.72,
      smart_money_divergence_pos: 0.28,
      smart_money_divergence_neg: 0.0,
    },
    AAPL: {
      residual_momentum_20d_rank: 0.58,
      overnight_return_rank: 0.35,
      intraday_return_rank: 0.42,
      amihud_illiquidity_rank: -0.85,
      closing_power_rank: 0.52,
      decayed_finbert_sentiment: 0.38,
      decayed_form4_insider_cluster: 0.15,
      decayed_pead_shock: 0.18,
      decayed_10q_legal_risk_delta: -0.08,
      decayed_mda_catalyst_score: 0.34,
      peer_gat_spillover: 0.44,
      smart_money_divergence_pos: 0.05,
      smart_money_divergence_neg: 0.02,
    },
    CRWD: {
      residual_momentum_20d_rank: 0.78,
      overnight_return_rank: 0.42,
      intraday_return_rank: 0.15,
      amihud_illiquidity_rank: -0.31,
      closing_power_rank: 0.65,
      decayed_finbert_sentiment: 0.54,
      decayed_form4_insider_cluster: 0.82,
      decayed_pead_shock: 0.35,
      decayed_10q_legal_risk_delta: -0.04,
      decayed_mda_catalyst_score: 0.28,
      peer_gat_spillover: 0.49,
      smart_money_divergence_pos: 0.0,
      smart_money_divergence_neg: 0.19,
    },
  };

  const signals = factorProfiles[t] ?? {
    residual_momentum_20d_rank: 0.65,
    overnight_return_rank: 0.5,
    intraday_return_rank: 0.3,
    amihud_illiquidity_rank: -0.2,
    closing_power_rank: 0.55,
    decayed_finbert_sentiment: 0.45,
    decayed_form4_insider_cluster: 0.4,
    decayed_pead_shock: 0.3,
    decayed_10q_legal_risk_delta: 0.0,
    decayed_mda_catalyst_score: 0.35,
    peer_gat_spillover: 0.4,
    smart_money_divergence_pos: 0.1,
    smart_money_divergence_neg: 0.05,
  };

  const isStrong = (signals.residual_momentum_20d_rank ?? 0.5) > 0.7;
  const pBuy = isStrong ? 0.635 : 0.485;
  const pHold = isStrong ? 0.245 : 0.345;
  const pSell = +(1.0 - pBuy - pHold).toFixed(3);
  const action = pBuy > 0.55 ? "BUY" : pSell > 0.35 ? "SELL" : "HOLD";
  const convictionTier = pBuy > 0.6 ? "HIGH" : pBuy > 0.5 ? "TACTICAL" : "NEUTRAL";
  const rawKelly = +(pBuy * 12.0 - pSell * 8.0).toFixed(2);
  // Under LONG_ONLY execution mode, HOLD and SELL strictly exit to cash (0.00%)
  const unconstrainedKelly = action === "BUY" ? Math.max(0, rawKelly) : 0.0;
  const l1NormPct = action === "BUY" ? +(unconstrainedKelly * 0.75).toFixed(2) : 0.0;

  return {
    message_id: `sig-${Date.now().toString(16)}`,
    ticker: t,
    timestamp_utc: new Date().toISOString(),
    horizon_days: 10,
    winning_engine: "LIGHTGBM_105",
    execution_mode: "LONG_ONLY",
    data_integrity: {
      point_in_time_shifted: true,
      xbrl_filed_date_verified: true,
      intraday_mode: "HOURLY_FULL",
      missing_modalities: [],
    },
    macro_regime: {
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
    },
    signal_breakdown: signals,
    calibration: {
      temperature: 1.34,
      calibrated_probabilities: {
        outperform_buy: pBuy,
        neutral_hold: pHold,
        underperform_sell: pSell,
      },
    },
    execution_recommendation: {
      action,
      conviction_tier: convictionTier,
      unconstrained_kelly_pct: Math.max(0, unconstrainedKelly),
      l1_normalized_portfolio_allocation_pct: l1NormPct,
      entry_price: entryPrice,
      dynamic_take_profit: dynamicTakeProfit,
      dynamic_stop_loss: dynamicStopLoss,
      reward_to_risk_ratio: 2.0,
      estimated_round_trip_cost_bps: 15.0,
    },
  };
}

export function generateHistoricalCandles(ticker: string, count: number = 90): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  const basePrices: Record<string, number> = {
    NVDA: 138.25,
    AAPL: 224.5,
    MSFT: 421.15,
    CRWD: 312.4,
    SPY: 574.8,
    TSLA: 248.9,
  };
  const endPrice = basePrices[ticker.toUpperCase()] ?? 150.0;
  let price = endPrice * 0.82; // start 18% lower and walk up

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - count * 1.45);

  let curDate = new Date(startDate);
  for (let i = 0; i < count; i++) {
    // skip weekends
    while (curDate.getDay() === 0 || curDate.getDay() === 6) {
      curDate.setDate(curDate.getDate() + 1);
    }

    const dateStr = curDate.toISOString().split("T")[0];
    const dailyVol = price * 0.022;
    const drift = (endPrice - price) / (count - i + 5);
    const delta = (Math.random() - 0.48) * dailyVol * 1.5 + drift;
    const open = +(price).toFixed(2);
    const close = +(price + delta).toFixed(2);
    const high = +(Math.max(open, close) + Math.random() * dailyVol * 0.8).toFixed(2);
    const low = +(Math.min(open, close) - Math.random() * dailyVol * 0.8).toFixed(2);
    const volume = Math.floor(10000000 + Math.random() * 35000000);

    bars.push({
      time: dateStr,
      open,
      high,
      low,
      close,
      volume,
    });

    price = close;
    curDate.setDate(curDate.getDate() + 1);
  }

  // Ensure last bar close matches endPrice
  if (bars.length > 0) {
    const last = bars[bars.length - 1];
    last.close = endPrice;
    last.high = Math.max(last.high, endPrice);
    last.low = Math.min(last.low, endPrice);
  }

  return bars;
}

export function getFilingMetadata(ticker: string): FinancialFilingMetadata[] {
  const years = [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015];
  const cikMap: Record<string, string> = {
    NVDA: "0001045810",
    AAPL: "0000320193",
    MSFT: "0000789019",
    CRWD: "0001535527",
    SPY: "0000884394",
    TSLA: "0001318605",
  };
  const cik = cikMap[ticker.toUpperCase()] ?? "0000000000";

  return years.map((yr, idx) => ({
    period: `FY${yr}`,
    filed_date: `${yr + 1}-02-${15 + (idx % 10)}`,
    period_end_date: `${yr}-12-31`,
    accession_number: `${cik}-${(yr - 2000).toString().padStart(2, "0")}-0000${(28 + idx).toString().padStart(2, "0")}`,
    sec_url: `https://www.sec.gov/edgar/data/${cik}/${cik}${(yr - 2000).toString().padStart(2, "0")}000028`,
    is_restated: idx === 2 || idx === 5,
    restatement_delta_notes:
      idx === 2
        ? "ASC 606 revenue reclassification (+0.4% restatement)"
        : idx === 5
          ? "Tax cuts and jobs act transition tax adjustment"
          : undefined,
  }));
}

export function get10YFinancialLakehouse(
  ticker: string,
  pitStrict: boolean = true
): {
  incomeStatement: FinancialMetricRow[];
  balanceSheet: FinancialMetricRow[];
  cashFlow: FinancialMetricRow[];
  ratios: FinancialMetricRow[];
  filings: FinancialFilingMetadata[];
} {
  const t = ticker.toUpperCase();
  const filings = getFilingMetadata(t);
  const years = filings.map((f) => f.period);

  // Scaled multipliers for companies
  const scale = t === "NVDA" ? 1.0 : t === "AAPL" ? 3.8 : t === "MSFT" ? 2.4 : 0.4;
  const restateShift = pitStrict ? 0 : 0.05;

  const revBase = 26974 * scale;
  const incomeStatement: FinancialMetricRow[] = [
    {
      tag: "Revenues",
      label: "Total Revenue",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 2.26 * (1 + restateShift)),
        FY2023: Math.round(revBase * 1.0),
        FY2022: Math.round(revBase * 0.98),
        FY2021: Math.round(revBase * 0.61),
        FY2020: Math.round(revBase * 0.4),
        FY2019: Math.round(revBase * 0.43),
        FY2018: Math.round(revBase * 0.36),
        FY2017: Math.round(revBase * 0.26),
        FY2016: Math.round(revBase * 0.19),
        FY2015: Math.round(revBase * 0.17),
      },
    },
    {
      tag: "CostOfRevenue",
      label: "Cost of Revenue",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 2.26 * 0.27),
        FY2023: Math.round(revBase * 0.44),
        FY2022: Math.round(revBase * 0.35),
        FY2021: Math.round(revBase * 0.38),
        FY2020: Math.round(revBase * 0.4),
        FY2019: Math.round(revBase * 0.39),
        FY2018: Math.round(revBase * 0.4),
        FY2017: Math.round(revBase * 0.41),
        FY2016: Math.round(revBase * 0.43),
        FY2015: Math.round(revBase * 0.44),
      },
    },
    {
      tag: "GrossProfit",
      label: "Gross Profit",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 2.26 * 0.73),
        FY2023: Math.round(revBase * 0.56),
        FY2022: Math.round(revBase * 0.63),
        FY2021: Math.round(revBase * 0.62),
        FY2020: Math.round(revBase * 0.6),
        FY2019: Math.round(revBase * 0.61),
        FY2018: Math.round(revBase * 0.6),
        FY2017: Math.round(revBase * 0.59),
        FY2016: Math.round(revBase * 0.57),
        FY2015: Math.round(revBase * 0.56),
      },
    },
    {
      tag: "ResearchAndDevelopment",
      label: "Research & Development",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 0.32),
        FY2023: Math.round(revBase * 0.27),
        FY2022: Math.round(revBase * 0.22),
        FY2021: Math.round(revBase * 0.15),
        FY2020: Math.round(revBase * 0.11),
        FY2019: Math.round(revBase * 0.1),
        FY2018: Math.round(revBase * 0.08),
        FY2017: Math.round(revBase * 0.06),
        FY2016: Math.round(revBase * 0.05),
        FY2015: Math.round(revBase * 0.04),
      },
    },
    {
      tag: "OperatingIncome",
      label: "Operating Income",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 2.26 * 0.54),
        FY2023: Math.round(revBase * 0.16),
        FY2022: Math.round(revBase * 0.38),
        FY2021: Math.round(revBase * 0.34),
        FY2020: Math.round(revBase * 0.26),
        FY2019: Math.round(revBase * 0.27),
        FY2018: Math.round(revBase * 0.31),
        FY2017: Math.round(revBase * 0.28),
        FY2016: Math.round(revBase * 0.18),
        FY2015: Math.round(revBase * 0.15),
      },
    },
    {
      tag: "NetIncome",
      label: "Net Income (Loss)",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 2.26 * 0.49),
        FY2023: Math.round(revBase * 0.16),
        FY2022: Math.round(revBase * 0.36),
        FY2021: Math.round(revBase * 0.26),
        FY2020: Math.round(revBase * 0.22),
        FY2019: Math.round(revBase * 0.26),
        FY2018: Math.round(revBase * 0.27),
        FY2017: Math.round(revBase * 0.24),
        FY2016: Math.round(revBase * 0.16),
        FY2015: Math.round(revBase * 0.13),
      },
    },
    {
      tag: "DilutedEPS",
      label: "Diluted EPS ($)",
      format: "number",
      values: {
        FY2024: 1.19,
        FY2023: 0.18,
        FY2022: 0.4,
        FY2021: 0.29,
        FY2020: 0.24,
        FY2019: 0.28,
        FY2018: 0.26,
        FY2017: 0.23,
        FY2016: 0.14,
        FY2015: 0.11,
      },
    },
  ];

  const balanceSheet: FinancialMetricRow[] = [
    {
      tag: "CashAndEquivalents",
      label: "Cash & Cash Equivalents",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 0.96),
        FY2023: Math.round(revBase * 0.49),
        FY2022: Math.round(revBase * 0.74),
        FY2021: Math.round(revBase * 0.7),
        FY2020: Math.round(revBase * 0.64),
        FY2019: Math.round(revBase * 0.58),
        FY2018: Math.round(revBase * 0.55),
        FY2017: Math.round(revBase * 0.42),
        FY2016: Math.round(revBase * 0.35),
        FY2015: Math.round(revBase * 0.31),
      },
    },
    {
      tag: "TotalCurrentAssets",
      label: "Total Current Assets",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 1.64),
        FY2023: Math.round(revBase * 0.86),
        FY2022: Math.round(revBase * 1.05),
        FY2021: Math.round(revBase * 0.98),
        FY2020: Math.round(revBase * 0.88),
        FY2019: Math.round(revBase * 0.8),
        FY2018: Math.round(revBase * 0.74),
        FY2017: Math.round(revBase * 0.6),
        FY2016: Math.round(revBase * 0.51),
        FY2015: Math.round(revBase * 0.45),
      },
    },
    {
      tag: "TotalAssets",
      label: "Total Assets",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 2.44),
        FY2023: Math.round(revBase * 1.53),
        FY2022: Math.round(revBase * 1.64),
        FY2021: Math.round(revBase * 1.54),
        FY2020: Math.round(revBase * 1.12),
        FY2019: Math.round(revBase * 0.99),
        FY2018: Math.round(revBase * 0.91),
        FY2017: Math.round(revBase * 0.72),
        FY2016: Math.round(revBase * 0.63),
        FY2015: Math.round(revBase * 0.54),
      },
    },
    {
      tag: "TotalDebt",
      label: "Total Long-Term Debt",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 0.31),
        FY2023: Math.round(revBase * 0.36),
        FY2022: Math.round(revBase * 0.4),
        FY2021: Math.round(revBase * 0.43),
        FY2020: Math.round(revBase * 0.26),
        FY2019: Math.round(revBase * 0.25),
        FY2018: Math.round(revBase * 0.24),
        FY2017: Math.round(revBase * 0.21),
        FY2016: Math.round(revBase * 0.17),
        FY2015: Math.round(revBase * 0.15),
      },
    },
    {
      tag: "StockholdersEquity",
      label: "Stockholders' Equity",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 1.6),
        FY2023: Math.round(revBase * 0.82),
        FY2022: Math.round(revBase * 0.97),
        FY2021: Math.round(revBase * 0.89),
        FY2020: Math.round(revBase * 0.62),
        FY2019: Math.round(revBase * 0.58),
        FY2018: Math.round(revBase * 0.53),
        FY2017: Math.round(revBase * 0.43),
        FY2016: Math.round(revBase * 0.36),
        FY2015: Math.round(revBase * 0.31),
      },
    },
  ];

  const cashFlow: FinancialMetricRow[] = [
    {
      tag: "OperatingCashFlow",
      label: "Cash from Operations",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 1.05),
        FY2023: Math.round(revBase * 0.21),
        FY2022: Math.round(revBase * 0.34),
        FY2021: Math.round(revBase * 0.31),
        FY2020: Math.round(revBase * 0.22),
        FY2019: Math.round(revBase * 0.24),
        FY2018: Math.round(revBase * 0.23),
        FY2017: Math.round(revBase * 0.2),
        FY2016: Math.round(revBase * 0.14),
        FY2015: Math.round(revBase * 0.11),
      },
    },
    {
      tag: "CapitalExpenditures",
      label: "Capital Expenditures (CapEx)",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 0.12),
        FY2023: Math.round(revBase * 0.07),
        FY2022: Math.round(revBase * 0.07),
        FY2021: Math.round(revBase * 0.05),
        FY2020: Math.round(revBase * 0.04),
        FY2019: Math.round(revBase * 0.04),
        FY2018: Math.round(revBase * 0.03),
        FY2017: Math.round(revBase * 0.03),
        FY2016: Math.round(revBase * 0.02),
        FY2015: Math.round(revBase * 0.02),
      },
    },
    {
      tag: "FreeCashFlow",
      label: "Free Cash Flow (FCF)",
      format: "currency",
      values: {
        FY2024: Math.round(revBase * 0.93),
        FY2023: Math.round(revBase * 0.14),
        FY2022: Math.round(revBase * 0.27),
        FY2021: Math.round(revBase * 0.26),
        FY2020: Math.round(revBase * 0.18),
        FY2019: Math.round(revBase * 0.2),
        FY2018: Math.round(revBase * 0.2),
        FY2017: Math.round(revBase * 0.17),
        FY2016: Math.round(revBase * 0.12),
        FY2015: Math.round(revBase * 0.09),
      },
    },
  ];

  const ratios: FinancialMetricRow[] = [
    {
      tag: "GrossMargin",
      label: "Gross Margin %",
      format: "percent",
      values: {
        FY2024: 72.7,
        FY2023: 56.9,
        FY2022: 64.9,
        FY2021: 62.3,
        FY2020: 62.0,
        FY2019: 61.2,
        FY2018: 60.0,
        FY2017: 58.8,
        FY2016: 57.0,
        FY2015: 55.8,
      },
    },
    {
      tag: "OperatingMargin",
      label: "Operating Margin %",
      format: "percent",
      values: {
        FY2024: 54.1,
        FY2023: 17.4,
        FY2022: 38.8,
        FY2021: 34.2,
        FY2020: 27.5,
        FY2019: 28.1,
        FY2018: 31.8,
        FY2017: 29.5,
        FY2016: 21.0,
        FY2015: 18.2,
      },
    },
    {
      tag: "ROIC",
      label: "ROIC %",
      format: "percent",
      values: {
        FY2024: 48.2,
        FY2023: 12.1,
        FY2022: 32.5,
        FY2021: 28.0,
        FY2020: 21.4,
        FY2019: 24.0,
        FY2018: 27.5,
        FY2017: 26.1,
        FY2016: 17.8,
        FY2015: 15.0,
      },
    },
  ];

  return {
    incomeStatement,
    balanceSheet,
    cashFlow,
    ratios,
    filings,
  };
}

export function getSecurityMaster(ticker: string): import("./types").SecurityMasterData {
  const t = ticker.toUpperCase();
  const profiles: Record<string, Partial<import("./types").SecurityMasterData>> = {
    NVDA: {
      company_name: "NVIDIA Corporation",
      primary_exchange: "NASDAQ GS",
      cik: "0001045810",
      figi: "BBG000BBJQV0",
      gics_sector: "Information Technology",
      gics_sub_industry: "Semiconductors",
      beta_market_60d: 1.72,
      beta_sector_60d: 1.15,
      adv_30d_shares: 48200000,
      market_cap_billions: 3412.5,
      pe_ratio_ltm: 54.2,
      pe_forward: 32.8,
      dividend_yield_pct: 0.03,
      high_52w: 140.76,
      low_52w: 45.11,
      business_summary:
        "NVIDIA Corporation designs graphics processing units (GPUs) and full-stack accelerated computing platforms for enterprise artificial intelligence, hyperscale data centers, autonomous machines, robotics, and high-performance scientific simulations.",
      headquarters: "Santa Clara, California, USA",
      ceo: "Jensen Huang",
      employees: 29600,
    },
    AAPL: {
      company_name: "Apple Inc.",
      primary_exchange: "NASDAQ GS",
      cik: "0000320193",
      figi: "BBG000B9XRY4",
      gics_sector: "Information Technology",
      gics_sub_industry: "Technology Hardware, Storage & Peripherals",
      beta_market_60d: 1.08,
      beta_sector_60d: 0.88,
      adv_30d_shares: 55400000,
      market_cap_billions: 3420.0,
      pe_ratio_ltm: 34.1,
      pe_forward: 29.5,
      dividend_yield_pct: 0.44,
      high_52w: 237.23,
      low_52w: 164.08,
      business_summary:
        "Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories, and sells a variety of related services including Apple Music, iCloud, Apple Pay, and Apple TV+.",
      headquarters: "Cupertino, California, USA",
      ceo: "Tim Cook",
      employees: 161000,
    },
    MSFT: {
      company_name: "Microsoft Corporation",
      primary_exchange: "NASDAQ GS",
      cik: "0000789019",
      figi: "BBG000BPH459",
      gics_sector: "Information Technology",
      gics_sub_industry: "Systems Software",
      beta_market_60d: 1.18,
      beta_sector_60d: 0.95,
      adv_30d_shares: 21800000,
      market_cap_billions: 3120.8,
      pe_ratio_ltm: 36.2,
      pe_forward: 30.1,
      dividend_yield_pct: 0.71,
      high_52w: 468.35,
      low_52w: 366.5,
      business_summary:
        "Microsoft Corporation develops and supports software, services, devices and solutions worldwide. The Productivity and Business Processes segment offers Office, Exchange, SharePoint, Teams, Office 365 Security and Compliance, Microsoft Viva, and Skype for Business.",
      headquarters: "Redmond, Washington, USA",
      ceo: "Satya Nadella",
      employees: 221000,
    },
    CRWD: {
      company_name: "CrowdStrike Holdings, Inc.",
      primary_exchange: "NASDAQ GS",
      cik: "0001535527",
      figi: "BBG00K1314T7",
      gics_sector: "Information Technology",
      gics_sub_industry: "Cybersecurity Software",
      beta_market_60d: 1.48,
      beta_sector_60d: 1.32,
      adv_30d_shares: 4100000,
      market_cap_billions: 74.8,
      pe_ratio_ltm: 68.4,
      pe_forward: 42.1,
      dividend_yield_pct: 0.0,
      high_52w: 398.33,
      low_52w: 200.81,
      business_summary:
        "CrowdStrike Holdings provides cloud-delivered protection across endpoints, cloud workloads, identity, and data via its AI-native Falcon platform. Sells subscriptions to its Falcon platform and cloud modules.",
      headquarters: "Austin, Texas, USA",
      ceo: "George Kurtz",
      employees: 7925,
    },
    SPY: {
      company_name: "SPDR S&P 500 ETF Trust",
      primary_exchange: "NYSE Arca",
      cik: "0000884394",
      figi: "BBG000BDTBL9",
      gics_sector: "Broad Index ETF",
      gics_sub_industry: "Large Cap Equity ETF",
      beta_market_60d: 1.0,
      beta_sector_60d: 1.0,
      adv_30d_shares: 62000000,
      market_cap_billions: 580.4,
      pe_ratio_ltm: 27.5,
      pe_forward: 22.8,
      dividend_yield_pct: 1.22,
      high_52w: 585.2,
      low_52w: 432.1,
      business_summary:
        "The SPDR S&P 500 ETF Trust seeks to provide investment results that correspond generally to the price and yield performance of the S&P 500 Index. S&P 500 includes 500 leading companies and covers approximately 80% of available market capitalization.",
      headquarters: "Boston, Massachusetts, USA",
      ceo: "State Street Global Advisors",
      employees: 0,
    },
    TSLA: {
      company_name: "Tesla, Inc.",
      primary_exchange: "NASDAQ GS",
      cik: "0001318605",
      figi: "BBG000N9MNX3",
      gics_sector: "Consumer Discretionary",
      gics_sub_industry: "Automobile Manufacturers",
      beta_market_60d: 2.12,
      beta_sector_60d: 1.85,
      adv_30d_shares: 78500000,
      market_cap_billions: 795.0,
      pe_ratio_ltm: 72.5,
      pe_forward: 58.0,
      dividend_yield_pct: 0.0,
      high_52w: 271.0,
      low_52w: 138.8,
      business_summary:
        "Tesla, Inc. designs, develops, manufactures, sells, and leases electric vehicles, energy storage systems, and solar panels, and offers services related to its products including full self-driving capability.",
      headquarters: "Austin, Texas, USA",
      ceo: "Elon Musk",
      employees: 140473,
    },
  };

  const p = profiles[t] || {
    company_name: `${t} Corporation`,
    primary_exchange: "NASDAQ GS",
    cik: "0001000000",
    figi: `BBG000${t}001`,
    gics_sector: "Information Technology",
    gics_sub_industry: "Technology",
    beta_market_60d: 1.2,
    beta_sector_60d: 1.05,
    adv_30d_shares: 12000000,
    market_cap_billions: 120.0,
    pe_ratio_ltm: 28.0,
    pe_forward: 24.0,
    dividend_yield_pct: 0.5,
    high_52w: 200.0,
    low_52w: 120.0,
    business_summary: `${t} operates in enterprise technology markets delivering software and hardware systems.`,
    headquarters: "United States",
    ceo: "Executive Officer",
    employees: 15000,
  };

  return {
    ticker: t,
    company_name: p.company_name ?? `${t} Inc.`,
    primary_exchange: p.primary_exchange ?? "NASDAQ",
    cik: p.cik ?? "0001045810",
    figi: p.figi ?? `BBG000${t}001`,
    gics_sector: p.gics_sector ?? "Information Technology",
    gics_sub_industry: p.gics_sub_industry ?? "Technology",
    beta_market_60d: p.beta_market_60d ?? 1.2,
    beta_sector_60d: p.beta_sector_60d ?? 1.0,
    adv_30d_shares: p.adv_30d_shares ?? 20000000,
    market_cap_billions: p.market_cap_billions ?? 150.0,
    pe_ratio_ltm: p.pe_ratio_ltm ?? 30.0,
    pe_forward: p.pe_forward ?? 25.0,
    dividend_yield_pct: p.dividend_yield_pct ?? 0.0,
    high_52w: p.high_52w ?? 200.0,
    low_52w: p.low_52w ?? 100.0,
    business_summary: p.business_summary ?? `${t} operates enterprise technology platforms.`,
    headquarters: p.headquarters ?? "United States",
    ceo: p.ceo ?? "Executive",
    employees: p.employees ?? 10000,
  };
}

export function getPeerGraph(ticker: string): import("./types").PeerGraphData {
  const t = ticker.toUpperCase();

  const peerMaps: Record<
    string,
    {
      gics: string[];
      leadLag: Array<{ sym: string; corr: number }>;
      etf: string;
    }
  > = {
    NVDA: {
      gics: ["AMD", "AVGO", "QCOM", "INTC"],
      leadLag: [
        { sym: "TSM", corr: 0.68 },
        { sym: "ASML", corr: 0.61 },
        { sym: "MSFT", corr: 0.54 },
        { sym: "AMZN", corr: 0.51 },
      ],
      etf: "XLK",
    },
    AAPL: {
      gics: ["MSFT", "GOOGL", "DELL", "HPQ"],
      leadLag: [
        { sym: "TSM", corr: 0.64 },
        { sym: "FOXCONN", corr: 0.58 },
        { sym: "QCOM", corr: 0.52 },
        { sym: "CRWD", corr: 0.46 },
      ],
      etf: "XLK",
    },
    CRWD: {
      gics: ["PANW", "FTNT", "NET", "ZS"],
      leadLag: [
        { sym: "MSFT", corr: 0.62 },
        { sym: "AMZN", corr: 0.55 },
        { sym: "DDOG", corr: 0.52 },
        { sym: "SNOW", corr: 0.48 },
      ],
      etf: "XLK",
    },
    MSFT: {
      gics: ["ORCL", "ADBE", "CRM", "SAP"],
      leadLag: [
        { sym: "NVDA", corr: 0.66 },
        { sym: "AMZN", corr: 0.63 },
        { sym: "GOOGL", corr: 0.59 },
        { sym: "META", corr: 0.52 },
      ],
      etf: "XLK",
    },
    TSLA: {
      gics: ["RIVN", "LCID", "F", "GM"],
      leadLag: [
        { sym: "BYD", corr: 0.58 },
        { sym: "CATL", corr: 0.54 },
        { sym: "NVDA", corr: 0.49 },
        { sym: "ALB", corr: 0.44 },
      ],
      etf: "XLY",
    },
    SPY: {
      gics: ["QQQ", "IWM", "DIA", "VOO"],
      leadLag: [
        { sym: "TLT", corr: -0.45 },
        { sym: "HYG", corr: 0.72 },
        { sym: "GLD", corr: 0.32 },
        { sym: "EEM", corr: 0.58 },
      ],
      etf: "SPY",
    },
  };

  const map = peerMaps[t] || {
    gics: ["PEER1", "PEER2", "PEER3", "PEER4"],
    leadLag: [
      { sym: "LL1", corr: 0.58 },
      { sym: "LL2", corr: 0.52 },
      { sym: "LL3", corr: 0.48 },
      { sym: "LL4", corr: 0.44 },
    ],
    etf: "XLK",
  };

  // Node 0: Target
  const nodes: import("./types").PeerGraphNode[] = [
    { id: t, role: "TARGET", role_code: 0.0, label: t, beta_market: 1.25 },
  ];

  // Nodes 1..4: GICS Peers
  map.gics.forEach((sym) => {
    nodes.push({ id: sym, role: "GICS_PEER", role_code: 0.33, label: sym, beta_market: 1.15 });
  });

  // Nodes 5..8: Lead-Lag Peers
  map.leadLag.forEach((item) => {
    nodes.push({
      id: item.sym,
      role: "LEAD_LAG",
      role_code: 0.66,
      label: item.sym,
      cross_corr_5d: item.corr,
      beta_market: 1.1,
    });
  });

  // Node 9: Sector ETF
  nodes.push({ id: map.etf, role: "SECTOR_ETF", role_code: 1.0, label: map.etf, beta_market: 1.0 });

  // Edges with attention weights
  const edges: import("./types").PeerGraphEdge[] = [
    { source: t, target: map.gics[0], attention_weight: 0.165 },
    { source: t, target: map.gics[1], attention_weight: 0.142 },
    { source: t, target: map.gics[2], attention_weight: 0.118 },
    { source: t, target: map.gics[3], attention_weight: 0.085 },
    { source: map.leadLag[0].sym, target: t, attention_weight: 0.185, lead_days: 5 },
    { source: map.leadLag[1].sym, target: t, attention_weight: 0.134, lead_days: 5 },
    { source: map.leadLag[2].sym, target: t, attention_weight: 0.098, lead_days: 5 },
    { source: map.leadLag[3].sym, target: t, attention_weight: 0.073, lead_days: 5 },
    { source: map.etf, target: t, attention_weight: 0.22 },
  ];

  return {
    target_ticker: t,
    nodes,
    edges,
    gat_attention_entropy: 1.84,
    top_spillover_contributor: map.leadLag[0].sym,
  };
}

export function getEdgarFilingData(ticker: string): import("./types").EdgarFilingRedlineData {
  const t = ticker.toUpperCase();

  const transactionsMap: Record<string, import("./types").Form4Transaction[]> = {
    NVDA: [
      {
        filing_date: "2024-09-18",
        insider_name: "Huang Jen Hsun",
        relationship: "President & CEO",
        transaction_code: "S",
        shares: 120000,
        price: 119.5,
        value: 14340000,
        is_10b5_1: true,
      },
      {
        filing_date: "2024-08-25",
        insider_name: "Stevens Mark A",
        relationship: "Director",
        transaction_code: "P",
        shares: 25000,
        price: 124.8,
        value: 3120000,
        is_10b5_1: false,
      },
      {
        filing_date: "2024-07-14",
        insider_name: "Kress Colette",
        relationship: "EVP & CFO",
        transaction_code: "S",
        shares: 66670,
        price: 128.45,
        value: 8563761,
        is_10b5_1: true,
      },
      {
        filing_date: "2024-06-02",
        insider_name: "Shoquist Debora",
        relationship: "EVP Operations",
        transaction_code: "S",
        shares: 41140,
        price: 109.62,
        value: 4509766,
        is_10b5_1: true,
      },
    ],
    CRWD: [
      {
        filing_date: "2024-08-12",
        insider_name: "Kurtz George",
        relationship: "CEO & Founder",
        transaction_code: "P",
        shares: 15000,
        price: 242.1,
        value: 3631500,
        is_10b5_1: false,
      },
      {
        filing_date: "2024-06-15",
        insider_name: "Podbere Burt W",
        relationship: "CFO",
        transaction_code: "S",
        shares: 8500,
        price: 365.2,
        value: 3104200,
        is_10b5_1: true,
      },
    ],
  };

  const form4_transactions = transactionsMap[t] || [
    {
      filing_date: "2024-09-01",
      insider_name: "Corporate Executive",
      relationship: "Officer",
      transaction_code: "P",
      shares: 10000,
      price: 135.0,
      value: 1350000,
      is_10b5_1: false,
    },
    {
      filing_date: "2024-07-20",
      insider_name: "Independent Director",
      relationship: "Director",
      transaction_code: "S",
      shares: 15000,
      price: 142.0,
      value: 2130000,
      is_10b5_1: true,
    },
  ];

  return {
    ticker: t,
    item1a_similarity: 0.88,
    mda_similarity: 0.74,
    item1a_sentiment_drift: -0.04,
    mda_catalyst_score: 0.28,
    redlines: [
      {
        section: "Item 1A // Risk Factors",
        status: "HIGH_CONFIDENCE_DIFF",
        added_clauses: [
          "Export administration regulations and heightened multilateral trade controls on high-bandwidth memory (HBM) and advanced tensor computing clusters may restrict shipments to designated geographic regions, directly impacting anticipated data center revenue trajectory.",
          "Extreme concentration of sub-3nm extreme ultraviolet (EUV) lithography packaging capacity at single-source foundry partners increases tail vulnerability to operational interruption, regional seismic events, or geopolitical friction.",
          "Accelerated proliferation of custom in-house hyperscale silicon architectures by primary cloud service provider customers could compress long-term gross margins.",
        ],
        removed_clauses: [
          "Legacy automotive semiconductor fabrication capacity deficits experienced during fiscal 2022 and early fiscal 2023.",
          "Cryptocurrency mining hardware demand volatility impacting entry-level consumer GPU average selling prices (ASPs).",
        ],
      },
      {
        section: "Item 7 // Management's Discussion & Analysis (MD&A)",
        status: "CATALYST_DETECTED",
        added_clauses: [
          "Data Center segment revenue grew 154% year-over-year, driven by universal adoption of accelerated computing platforms across generative AI models, recommendation engines, and high-performance computing clusters.",
          "Gross margin expanded to 75.1% primarily reflecting favorable data center mix and operating leverage against fixed silicon tape-out expenses.",
        ],
        removed_clauses: [
          "Restructuring charges and inventory provisions related to prior-generation desktop graphics architectures.",
        ],
      },
    ],
    form4_transactions,
  };
}

export function getNewsFeed(ticker: string): import("./types").NewsItemData[] {
  const t = ticker.toUpperCase();

  return [
    {
      headline: `${t} Unveils Next-Generation Ultra-Dense Compute Architecture with 3.2x Efficiency Gain`,
      source: "Bloomberg Technology",
      published_at: "2024-11-06T15:24:00Z",
      finbert_score: 0.86,
      sentiment_label: "BULLISH",
      decay_half_life_days: 3.0,
      decayed_sentiment: 0.78,
    },
    {
      headline: `Hyperscale Cloud Providers Announce Multi-Billion CapEx Expansion Dedicated to ${t} Infrastructure`,
      source: "Reuters Financial",
      published_at: "2024-11-05T18:40:00Z",
      finbert_score: 0.74,
      sentiment_label: "BULLISH",
      decay_half_life_days: 3.0,
      decayed_sentiment: 0.58,
    },
    {
      headline: `Department of Commerce Updates Regional Export Compliance Guidance for Advanced Semiconductor Foundries`,
      source: "Wall Street Journal",
      published_at: "2024-11-04T11:15:00Z",
      finbert_score: -0.38,
      sentiment_label: "BEARISH",
      decay_half_life_days: 3.0,
      decayed_sentiment: -0.21,
    },
    {
      headline: `Consensus Options Skew Shifts Towards Out-of-the-Money Calls Ahead of Key Industry Keynote`,
      source: "Benzinga Quant",
      published_at: "2024-11-03T09:30:00Z",
      finbert_score: 0.42,
      sentiment_label: "BULLISH",
      decay_half_life_days: 3.0,
      decayed_sentiment: 0.18,
    },
    {
      headline: `Global Tech Hardware Supply Chain Reports Normalizing Lead Times Across Sub-Component Assemblers`,
      source: "Dow Jones Newswires",
      published_at: "2024-11-01T14:05:00Z",
      finbert_score: 0.15,
      sentiment_label: "NEUTRAL",
      decay_half_life_days: 3.0,
      decayed_sentiment: 0.04,
    },
  ];
}

export function getHistoricalPrices(ticker: string, count: number = 30): import("./types").HistoricalPriceRow[] {
  const t = ticker.toUpperCase();
  const basePrices: Record<string, number> = {
    NVDA: 138.25,
    AAPL: 224.5,
    MSFT: 421.15,
    CRWD: 312.4,
    SPY: 574.8,
    TSLA: 248.9,
  };
  const endPrice = basePrices[t] ?? 150.0;
  const rows: import("./types").HistoricalPriceRow[] = [];

  let curPrice = endPrice;
  const today = new Date();

  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 1.45);
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1);
    }
    const dateStr = d.toISOString().split("T")[0];

    const dailyVol = curPrice * 0.022;
    const overnightGap = (Math.random() - 0.48) * (dailyVol * 0.4);
    const open = +(curPrice - overnightGap).toFixed(2);
    const close = +(curPrice).toFixed(2);
    const high = +(Math.max(open, close) + Math.random() * dailyVol * 0.5).toFixed(2);
    const low = +(Math.min(open, close) - Math.random() * dailyVol * 0.5).toFixed(2);
    const volume = Math.floor(18000000 + Math.random() * 32000000);
    const vwap = +((high + low + close) / 3).toFixed(2);

    const prevClose = +(open - overnightGap).toFixed(2);
    const overnightReturn = +(((open - prevClose) / prevClose) * 100).toFixed(2);
    const intradayReturn = +(((close - open) / open) * 100).toFixed(2);
    const totalReturn = +(((close - prevClose) / prevClose) * 100).toFixed(2);

    rows.push({
      date: dateStr,
      open,
      high,
      low,
      close,
      volume,
      overnight_return: overnightReturn,
      intraday_return: intradayReturn,
      total_return: totalReturn,
      vwap,
    });

    curPrice = prevClose;
  }

  return rows;
}

export function getAnalystRatings(ticker: string): AnalystRatingsData {
  const t = ticker.toUpperCase();
  const basePrices: Record<string, number> = {
    NVDA: 138.25,
    AAPL: 224.5,
    MSFT: 421.15,
    CRWD: 312.4,
    SPY: 574.8,
    TSLA: 248.9,
  };
  const current_price = basePrices[t] ?? 150.0;

  const dataset: Record<string, AnalystRatingsData> = {
    NVDA: {
      ticker: "NVDA",
      current_price: 138.25,
      target_mean: 172.5,
      target_median: 170.0,
      target_high: 200.0,
      target_low: 125.0,
      upside_pct: 24.8,
      consensus_rating: "STRONG_BUY",
      consensus_score: 4.75,
      total_analysts: 48,
      ratings_breakdown: {
        strong_buy: 36,
        buy: 9,
        hold: 3,
        underperform: 0,
        sell: 0,
      },
      historical_revisions: [
        { period: "Current", mean_target: 172.5, buy_pct: 93.8 },
        { period: "1M Ago", mean_target: 165.2, buy_pct: 91.5 },
        { period: "2M Ago", mean_target: 154.0, buy_pct: 88.0 },
        { period: "3M Ago", mean_target: 142.5, buy_pct: 84.0 },
      ],
    },
    AAPL: {
      ticker: "AAPL",
      current_price: 224.5,
      target_mean: 245.0,
      target_median: 242.0,
      target_high: 275.0,
      target_low: 195.0,
      upside_pct: 9.1,
      consensus_rating: "BUY",
      consensus_score: 4.15,
      total_analysts: 42,
      ratings_breakdown: {
        strong_buy: 22,
        buy: 12,
        hold: 7,
        underperform: 1,
        sell: 0,
      },
      historical_revisions: [
        { period: "Current", mean_target: 245.0, buy_pct: 81.0 },
        { period: "1M Ago", mean_target: 240.0, buy_pct: 79.5 },
        { period: "2M Ago", mean_target: 232.0, buy_pct: 76.0 },
        { period: "3M Ago", mean_target: 225.0, buy_pct: 74.0 },
      ],
    },
    MSFT: {
      ticker: "MSFT",
      current_price: 421.15,
      target_mean: 495.0,
      target_median: 500.0,
      target_high: 550.0,
      target_low: 440.0,
      upside_pct: 17.5,
      consensus_rating: "STRONG_BUY",
      consensus_score: 4.82,
      total_analysts: 45,
      ratings_breakdown: {
        strong_buy: 34,
        buy: 9,
        hold: 2,
        underperform: 0,
        sell: 0,
      },
      historical_revisions: [
        { period: "Current", mean_target: 495.0, buy_pct: 95.6 },
        { period: "1M Ago", mean_target: 485.0, buy_pct: 93.3 },
        { period: "2M Ago", mean_target: 470.0, buy_pct: 91.0 },
        { period: "3M Ago", mean_target: 455.0, buy_pct: 89.0 },
      ],
    },
    CRWD: {
      ticker: "CRWD",
      current_price: 312.4,
      target_mean: 345.0,
      target_median: 340.0,
      target_high: 390.0,
      target_low: 260.0,
      upside_pct: 10.4,
      consensus_rating: "BUY",
      consensus_score: 4.2,
      total_analysts: 38,
      ratings_breakdown: {
        strong_buy: 18,
        buy: 14,
        hold: 5,
        underperform: 1,
        sell: 0,
      },
      historical_revisions: [
        { period: "Current", mean_target: 345.0, buy_pct: 84.2 },
        { period: "1M Ago", mean_target: 338.0, buy_pct: 82.0 },
        { period: "2M Ago", mean_target: 320.0, buy_pct: 75.0 },
        { period: "3M Ago", mean_target: 310.0, buy_pct: 70.0 },
      ],
    },
    TSLA: {
      ticker: "TSLA",
      current_price: 248.9,
      target_mean: 260.0,
      target_median: 250.0,
      target_high: 330.0,
      target_low: 115.0,
      upside_pct: 4.5,
      consensus_rating: "HOLD",
      consensus_score: 3.25,
      total_analysts: 35,
      ratings_breakdown: {
        strong_buy: 11,
        buy: 9,
        hold: 10,
        underperform: 3,
        sell: 2,
      },
      historical_revisions: [
        { period: "Current", mean_target: 260.0, buy_pct: 57.1 },
        { period: "1M Ago", mean_target: 255.0, buy_pct: 56.0 },
        { period: "2M Ago", mean_target: 245.0, buy_pct: 52.0 },
        { period: "3M Ago", mean_target: 230.0, buy_pct: 48.0 },
      ],
    },
  };

  if (dataset[t]) return dataset[t];

  // Generic fallback
  const meanTarget = +(current_price * 1.15).toFixed(2);
  const upsidePct = +(((meanTarget - current_price) / current_price) * 100).toFixed(1);
  return {
    ticker: t,
    current_price,
    target_mean: meanTarget,
    target_median: +(current_price * 1.14).toFixed(2),
    target_high: +(current_price * 1.35).toFixed(2),
    target_low: +(current_price * 0.95).toFixed(2),
    upside_pct: upsidePct,
    consensus_rating: "BUY",
    consensus_score: 4.1,
    total_analysts: 28,
    ratings_breakdown: {
      strong_buy: 12,
      buy: 10,
      hold: 5,
      underperform: 1,
      sell: 0,
    },
    historical_revisions: [
      { period: "Current", mean_target: meanTarget, buy_pct: 78.5 },
      { period: "1M Ago", mean_target: +(meanTarget * 0.98).toFixed(2), buy_pct: 77.0 },
      { period: "2M Ago", mean_target: +(meanTarget * 0.95).toFixed(2), buy_pct: 74.0 },
      { period: "3M Ago", mean_target: +(meanTarget * 0.92).toFixed(2), buy_pct: 71.0 },
    ],
  };
}

export async function queryCopilot(query: string, ticker: string = "NVDA"): Promise<CopilotQueryResponse> {
  const q = query.toLowerCase();
  const t = ticker.toUpperCase();

  if (q.includes("kelly") || q.includes("size") || q.includes("allocation")) {
    return {
      answer: `QARE-MM v1.3 currently projects a +6.40% L1-normalized allocation for ${t} under LONG_ONLY execution mode with half-Kelly multiplier (0.50x). Expected annualized log growth rate g(f) is +14.2% after deducting 15.0 bps round-trip friction penalty.`,
      sources: ["QARE-MM Kelly Sizer", "amstal-engine::optimizer", "PRD Section 2.4.2"],
      suggested_commands: [`${t} PORT <GO>`, `${t} GP <GO>`],
      model: "amstal-quant-copilot-deterministic-v1.3",
    };
  }

  if (q.includes("regime") || q.includes("volatility") || q.includes("hmm")) {
    return {
      answer: `The 3-state forward-filtered Gaussian HMM macro volatility regime is currently in State 0: Low Volatility (81.2% posterior confidence). State 1 (Medium/Chop) is at 14.5% and State 2 (Crash) is at 4.3%. Macro risk sizing multiplier kappa is set to 0.85x.`,
      sources: ["Gaussian HMM 3-State Filter", "CBOE VIX Intraday", "amstal-engine::regime"],
      suggested_commands: ["HMM <GO>", `${t} PORT <GO>`],
      model: "amstal-quant-copilot-deterministic-v1.3",
    };
  }

  if (q.includes("insider") || q.includes("form 4") || q.includes("sec") || q.includes("edgar")) {
    return {
      answer: `Recent SEC Form 4 filings indicate high cluster buying intensity for ${t} over the last 30 days (+0.82 decayed cluster score). 10-Q Item 1A legal risk drift delta remains negative (-0.02) with 94.2% semantic similarity across consecutive quarterly disclosures.`,
      sources: ["EDGAR Form 4 Lakehouse", "SEC 10-Q Item 1A NLP Parser", "FinBERT"],
      suggested_commands: [`${t} EDGAR <GO>`, `${t} NEWS <GO>`],
      model: "amstal-quant-copilot-deterministic-v1.3",
    };
  }

  if (q.includes("peer") || q.includes("gat") || q.includes("graph") || q.includes("spillover") || q.includes("splc")) {
    return {
      answer: `Peer Graph Attention Network (GAT) computes high cross-momentum spillover (+0.72) from key tier-1 partners into ${t}. Network attention entropy is 1.48 with dominant lead-lag flow originating from semiconductor capital equipment and cloud infrastructure providers.`,
      sources: ["GAT Dynamic Graph Embeddings", "S&P 500 Sub-Industry Matrix", "amstal-engine::graph"],
      suggested_commands: [`${t} SPLC <GO>`, `${t} HP <GO>`],
      model: "amstal-quant-copilot-deterministic-v1.3",
    };
  }

  if (q.includes("analyst") || q.includes("rating") || q.includes("target") || q.includes("anr")) {
    const anr = getAnalystRatings(t);
    return {
      answer: `Wall Street consensus for ${t} is ${anr.consensus_rating} (${anr.consensus_score.toFixed(2)}/5.0) with an average 12-month target of $${anr.target_mean.toFixed(2)} (+${anr.upside_pct}% upside from $${anr.current_price.toFixed(2)}). Total of ${anr.total_analysts} analysts covering with ${anr.ratings_breakdown.strong_buy + anr.ratings_breakdown.buy} Buy/Strong Buy ratings.`,
      sources: ["FactSet Consensus Feeds", "Bloomberg ANR Equities", "SEC 13F Institutional"],
      suggested_commands: [`${t} ANR <GO>`, `${t} DES <GO>`],
      model: "amstal-quant-copilot-deterministic-v1.3",
    };
  }

  return {
    answer: `Amstal Quant Copilot analyzed your request for ${t}. The active quantitative factor composite shows strong residual momentum (+0.78 rank), steady overnight drift, and robust balance sheet liquidity under Point-in-Time restatement-safe filtering.`,
    sources: ["Amstal Engine Local IPC", "Security Master DB", "QARE Signal Lakehouse"],
    suggested_commands: [`${t} GP <GO>`, `${t} PORT <GO>`, `${t} ANR <GO>`, "HMM <GO>"],
    model: "amstal-quant-copilot-deterministic-v1.3",
  };
}
