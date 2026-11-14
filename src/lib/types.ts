/**
 * QARE-MM v1.3 Institutional Financial Terminal Type Definitions
 */

export type MacroRegimeState = "LOW_VOLATILITY" | "MEDIUM_VOLATILITY" | "HIGH_VOLATILITY";

export interface MacroRegimeData {
  available?: boolean;
  current_state: MacroRegimeState | string;
  state_index: number;
  filtered_probabilities?: {
    low_volatility?: number;
    medium_volatility?: number;
    high_volatility?: number;
  };
  kappa?: number | null; // Macro risk penalty multiplier (0.2 to 1.0)
  transition_matrix?: number[][];
  state_volatilities?: number[];
  stationary_distribution?: number[];
  regime_history?: Array<{
    timestamp: string;
    state_index: number;
    p_low?: number;
    p_med?: number;
    p_high?: number;
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
  open?: number;
  high?: number;
  low?: number;
  prev_close?: number;
  date?: string;
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
  time: string | number; // YYYY-MM-DD or Unix epoch seconds
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

export interface FinancialStatementsPayload {
  ticker: string;
  available: boolean;
  source: string;
  entity_name?: string;
  cik?: string;
  pit_strict: boolean;
  filings: FinancialFilingMetadata[];
  incomeStatement: FinancialMetricRow[];
  balanceSheet: FinancialMetricRow[];
  cashFlow: FinancialMetricRow[];
  ratios: FinancialMetricRow[];
  message?: string;
}

export type ColorChannel = "BLUE" | "AMBER" | "GREEN" | "RED" | "UNLINKED";

export interface SecurityMasterData {
  ticker: string;
  company_name: string;
  primary_exchange: string;
  cik: string;
  figi: string;
  gics_sector: string;
  gics_sub_industry: string;
  available_fundamentals?: boolean;
  beta_market_60d: number | null;
  beta_sector_60d: number | null;
  adv_30d_shares: number | null;
  market_cap_billions: number | null;
  pe_ratio_ltm: number | null;
  pe_forward?: number | null;
  dividend_yield_pct: number | null;
  high_52w: number | null;
  low_52w: number | null;
  business_summary: string;
  headquarters: string | null;
  ceo: string | null;
  employees: number | null;
}

export type PeerNodeRole = "TARGET" | "GICS_PEER" | "LEAD_LAG" | "SECTOR_ETF";

export interface PeerGraphNode {
  id: string;
  role: PeerNodeRole;
  role_code: number;
  label: string;
  cross_corr_5d?: number | null;
  beta_market?: number | null;
  return_5d?: number | null;
  spillover_contribution?: number | null;
}

export interface PeerGraphEdge {
  source: string;
  target: string;
  attention_weight: number;
  lead_days?: number;
}

export interface PeerGraphData {
  target_ticker: string;
  nodes: PeerGraphNode[];
  edges: PeerGraphEdge[];
  gat_attention_entropy?: number;
  top_spillover_contributor?: string;
}

export interface Form4Transaction {
  filing_date: string;
  insider_name: string;
  relationship: string;
  transaction_code: string;
  shares: number;
  price: number;
  value: number;
  is_10b5_1: boolean;
}

export interface RedlineClauseDiff {
  section: string;
  status: string;
  added_clauses: string[];
  removed_clauses: string[];
}

export interface EdgarFilingRedlineData {
  ticker: string;
  available?: boolean;
  filing_type?: string;
  current_filing_date?: string | null;
  prior_filing_date?: string | null;
  acceptance_timestamp_et?: string;
  item1a_similarity: number | null;
  mda_similarity: number | null;
  item1a_sentiment_drift: number | null;
  mda_catalyst_score: number | null;
  redlines: RedlineClauseDiff[];
  form4_transactions: Form4Transaction[];
  message?: string;
}

export interface NewsItemData {
  headline: string;
  source: string;
  published_at: string;
  finbert_score: number;
  sentiment_label: "BULLISH" | "BEARISH" | "NEUTRAL" | string;
  decay_half_life_days: number;
  decayed_sentiment: number;
}

export interface HistoricalPriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  overnight_return: number;
  intraday_return: number;
  total_return: number;
  vwap?: number;
}

export interface AnalystRatingsData {
  ticker: string;
  available?: boolean;
  source?: string;
  current_price: number;
  target_mean: number | null;
  target_median: number | null;
  target_high: number | null;
  target_low: number | null;
  upside_pct: number | null;
  consensus_rating: "STRONG_BUY" | "BUY" | "HOLD" | "UNDERPERFORM" | "SELL" | string;
  consensus_score: number | null; // 1.0 - 5.0
  total_analysts: number;
  ratings_breakdown: {
    strong_buy: number;
    buy: number;
    hold: number;
    underperform: number;
    sell: number;
  };
  historical_revisions: Array<{
    period: string;
    mean_target: number | null;
    buy_pct: number;
    total_analysts?: number;
  }>;
  message?: string;
}

export interface CopilotMessage {
  id: string;
  sender: "USER" | "COPILOT" | "SYSTEM";
  timestamp_iso: string;
  text: string;
  sources?: string[];
  suggested_commands?: string[];
}

export interface CopilotQueryResponse {
  answer: string;
  sources: string[];
  suggested_commands: string[];
  model: string;
}

export interface EngineStatus {
  is_running: boolean;
  socket_path: string;
  socket_exists: boolean;
  ws_host: string;
  ws_port: number;
  ws_alive: boolean;
  managed_child_pid?: number | null;
  uptime_secs: number;
}

export interface LakehouseStats {
  base_lakehouse_path: string;
  exists: boolean;
  processed_partitions_count: number;
  universe_snapshots_count: number;
  total_size_bytes: number;
}

export interface ParquetQueryResult {
  columns: string[];
  rows: Array<Array<string | number | boolean | null> | Record<string, any>>;
  row_count: number;
  execution_time_ms: number;
}

