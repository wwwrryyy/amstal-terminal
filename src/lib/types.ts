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

export type ColorChannel = "BLUE" | "AMBER" | "GREEN" | "RED" | "UNLINKED";

export interface SecurityMasterData {
  ticker: string;
  company_name: string;
  primary_exchange: string;
  cik: string;
  figi: string;
  gics_sector: string;
  gics_sub_industry: string;
  beta_market_60d: number;
  beta_sector_60d: number;
  adv_30d_shares: number;
  market_cap_billions: number;
  pe_ratio_ltm: number;
  pe_forward?: number;
  dividend_yield_pct: number;
  high_52w: number;
  low_52w: number;
  business_summary: string;
  headquarters: string;
  ceo: string;
  employees: number;
}

export type PeerNodeRole = "TARGET" | "GICS_PEER" | "LEAD_LAG" | "SECTOR_ETF";

export interface PeerGraphNode {
  id: string;
  role: PeerNodeRole;
  role_code: number;
  label: string;
  cross_corr_5d?: number;
  beta_market?: number;
  return_5d?: number;
  spillover_contribution?: number;
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
  item1a_similarity: number;
  mda_similarity: number;
  item1a_sentiment_drift: number;
  mda_catalyst_score: number;
  redlines: RedlineClauseDiff[];
  form4_transactions: Form4Transaction[];
}

export interface NewsItemData {
  headline: string;
  source: string;
  published_at: string;
  finbert_score: number;
  sentiment_label: "BULLISH" | "BEARISH" | "NEUTRAL";
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
  current_price: number;
  target_mean: number;
  target_median: number;
  target_high: number;
  target_low: number;
  upside_pct: number;
  consensus_rating: "STRONG_BUY" | "BUY" | "HOLD" | "UNDERPERFORM" | "SELL";
  consensus_score: number; // 1.0 - 5.0
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
    mean_target: number;
    buy_pct: number;
  }>;
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

