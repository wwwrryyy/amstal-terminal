/**
 * QARE-MM v1.3 Institutional Financial Terminal Type Definitions
 */

export type MacroRegimeState = "LOW_VOLATILITY" | "MEDIUM_VOLATILITY" | "HIGH_VOLATILITY";

export interface MacroRegimeData {
  current_state: MacroRegimeState | string;
  state_index: number;
  filtered_probabilities: {
    low_volatility: number;
    medium_volatility: number;
    high_volatility: number;
  };
  kappa?: number; // Macro risk penalty multiplier (0.2 to 1.0)
  transition_matrix?: number[][];
  regime_history?: Array<{
    timestamp: string;
    state_index: number;
    confidence: number;
  }>;
}

export interface CalibrationData {
  temperature: number;
  calibrated_probabilities: {
    outperform_buy: number;
    neutral_hold: number;
    underperform_sell: number;
  };
}

export interface ExecutionRecommendation {
  action: "BUY" | "HOLD" | "SELL" | string;
  conviction_tier: "HIGH" | "TACTICAL" | "CONVICTION" | "NEUTRAL" | string;
  unconstrained_kelly_pct: number;
  l1_normalized_portfolio_allocation_pct: number;
  entry_price: number;
  dynamic_take_profit: number;
  dynamic_stop_loss: number;
  reward_to_risk_ratio: number;
  estimated_round_trip_cost_bps: number;
}

export interface DataIntegrity {
  point_in_time_shifted: boolean;
  xbrl_filed_date_verified: boolean;
  intraday_mode: string;
  missing_modalities: string[];
}

export interface QARESignalFrame {
  message_id: string;
  ticker: string;
  timestamp_utc: string;
  horizon_days: number;
  winning_engine: string;
  execution_mode: string;
  data_integrity: DataIntegrity;
  macro_regime: MacroRegimeData;
  signal_breakdown: Record<string, number>;
  calibration: CalibrationData;
  execution_recommendation: ExecutionRecommendation;
}

export interface TickData {
  ticker: string;
  price: number;
  change: number;
  change_pct: number;
  bid: number;
  ask: number;
  volume: number;
  high_24h: number;
  low_24h: number;
  timestamp_ms: number;
}

export interface ConflatedStreamFrame {
  type: "CONFLATED_STREAM_FRAME" | "CONNECTION_ESTABLISHED" | string;
  conflation_interval_ms?: number;
  timestamp_ms?: number;
  ticks?: Record<string, TickData>;
  signals?: Record<string, QARESignalFrame>;
  macro_regime?: MacroRegimeData;
}

export interface ParsedMnemonicCommand {
  raw_input: string;
  is_valid: boolean;
  has_go: boolean;
  identifier: string;
  market: string;
  asset_class: string;
  mnemonic: string;
  parameters: Record<string, any>;
  error?: string;
}

export interface OHLCVBar {
  time: string; // YYYY-MM-DD or Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FinancialMetricRow {
  tag: string;
  label: string;
  values: Record<string, number | null>; // year -> value
  format: "currency" | "percent" | "number" | "ratio";
  indent?: boolean;
  isHeader?: boolean;
}

export interface FinancialFilingMetadata {
  period: string;
  filed_date: string;
  period_end_date: string;
  accession_number: string;
  sec_url: string;
  is_restated: boolean;
  restatement_delta_notes?: string;
}
