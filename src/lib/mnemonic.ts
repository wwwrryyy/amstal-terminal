import type { ParsedMnemonicCommand } from "./types";

export const STANDALONE_MNEMONICS = new Set([
  "HMM",
  "PORT",
  "GP",
  "FA",
  "DES",
  "SPLC",
  "EDGAR",
  "NEWS",
  "HP",
  "ANR",
  "COPILOT",
  "HELP",
  "TOP",
  "GRID",
  "ALL",
  "CLEAR",
]);

export const RECOGNIZED_MARKETS = new Set(["US", "LN", "GY", "JP", "HK", "IN", "TO", "PA"]);

export const KNOWN_ASSET_CLASSES = new Set([
  "EQUITY",
  "INDEX",
  "CORP",
  "CURNCY",
  "COMDTY",
  "GOVT",
  "MUNI",
  "MTGE",
]);

/**
 * Bloomberg-style RPN Mnemonic Command Parser.
 * Syntax: [TICKER] [MARKET] <ASSET CLASS> [MNEMONIC] <GO>
 * Examples:
 *   - 'NVDA US <EQUITY> FA <GO>' -> ticker: NVDA, market: US, class: EQUITY, mnemonic: FA
 *   - 'AAPL US <EQUITY> GP <GO>' -> ticker: AAPL, market: US, class: EQUITY, mnemonic: GP
 *   - 'CRWD PORT <GO>' -> ticker: CRWD, mnemonic: PORT
 *   - 'HMM <GO>' -> mnemonic: HMM
 *   - 'NVDA FA' -> ticker: NVDA, mnemonic: FA
 */
export function parse_mnemonic_command(raw_input: string): ParsedMnemonicCommand {
  const cleaned = raw_input.trim();
  if (!cleaned) {
    return {
      raw_input: "",
      is_valid: false,
      has_go: false,
      identifier: "SPY",
      market: "US",
      asset_class: "EQUITY",
      mnemonic: "GP",
      parameters: {},
      error: "Empty command",
    };
  }

  let tokens = cleaned.split(/\s+/);

  // Normalize ending <GO> or GO
  let has_go = false;
  if (tokens.length > 0 && (tokens[tokens.length - 1].toUpperCase() === "<GO>" || tokens[tokens.length - 1].toUpperCase() === "GO")) {
    has_go = true;
    tokens = tokens.slice(0, -1);
  }

  let identifier = "SPY";
  let market = "US";
  let asset_class = "EQUITY";
  let mnemonic = "GP";
  const parameters: Record<string, any> = {};

  // Extract <ASSET CLASS> if present (e.g. <EQUITY>, <INDEX>, <CORP>)
  // Note: Ignore <GO> which is the terminal execution mnemonic
  const assetClassMatch = cleaned.match(/<(?!GO\b)([A-Za-z]+)>/i);
  if (assetClassMatch) {
    asset_class = assetClassMatch[1].toUpperCase();
    // Remove the <ASSET_CLASS> token from token list
    tokens = tokens.filter((t) => !/^<(?!GO\b)[A-Za-z]+>$/i.test(t));
  }

  if (tokens.length === 1) {
    const tok = tokens[0].toUpperCase();
    if (STANDALONE_MNEMONICS.has(tok)) {
      mnemonic = tok;
    } else {
      identifier = tok;
    }
  } else if (tokens.length === 2) {
    // e.g. "NVDA FA", "CRWD PORT", "AAPL GP"
    identifier = tokens[0].toUpperCase();
    mnemonic = tokens[1].toUpperCase();
  } else if (tokens.length >= 3) {
    identifier = tokens[0].toUpperCase();
    if (RECOGNIZED_MARKETS.has(tokens[1].toUpperCase())) {
      market = tokens[1].toUpperCase();
      mnemonic = tokens[2].toUpperCase();
    } else {
      mnemonic = tokens[tokens.length - 1].toUpperCase();
    }
  }

  return {
    raw_input,
    is_valid: true,
    has_go,
    identifier,
    market,
    asset_class,
    mnemonic,
    parameters,
  };
}
