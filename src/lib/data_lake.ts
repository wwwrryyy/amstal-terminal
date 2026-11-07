import type {
  FinancialFilingMetadata,
  FinancialMetricRow,
  OHLCVBar,
  QARESignalFrame,
  MacroRegimeData,
  TickData,
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
