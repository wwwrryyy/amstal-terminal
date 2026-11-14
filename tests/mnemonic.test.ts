import { describe, it, expect } from "vitest";
import { parse_mnemonic_command, STANDALONE_MNEMONICS } from "../src/lib/mnemonic";

describe("Bloomberg RPN Mnemonic Command Parser", () => {
  it("parses full canonical command: NVDA US <EQUITY> FA <GO>", () => {
    const res = parse_mnemonic_command("NVDA US <EQUITY> FA <GO>");
    expect(res.is_valid).toBe(true);
    expect(res.has_go).toBe(true);
    expect(res.identifier).toBe("NVDA");
    expect(res.market).toBe("US");
    expect(res.asset_class).toBe("EQUITY");
    expect(res.mnemonic).toBe("FA");
  });

  it("parses ticker and mnemonic: CRWD PORT <GO>", () => {
    const res = parse_mnemonic_command("CRWD PORT <GO>");
    expect(res.is_valid).toBe(true);
    expect(res.has_go).toBe(true);
    expect(res.identifier).toBe("CRWD");
    expect(res.mnemonic).toBe("PORT");
    expect(res.asset_class).toBe("EQUITY");
    expect(res.market).toBe("US");
  });

  it("parses standalone mnemonics: HMM <GO>, PORT <GO>, GP <GO>, FA <GO>", () => {
    for (const m of ["HMM", "PORT", "GP", "FA", "DES", "SPLC", "EDGAR", "NEWS", "HP", "ANR", "COPILOT", "GRID", "ALL", "HELP", "TOP"]) {
      const res = parse_mnemonic_command(`${m} <GO>`);
      expect(res.is_valid).toBe(true);
      expect(res.has_go).toBe(true);
      expect(res.mnemonic).toBe(m);
    }
  });

  it("parses Tier 2 Step 3 commands: NVDA ANR <GO>, COPILOT <GO>, TSLA COPILOT <GO>", () => {
    const resAnr = parse_mnemonic_command("NVDA US <EQUITY> ANR <GO>");
    expect(resAnr.is_valid).toBe(true);
    expect(resAnr.identifier).toBe("NVDA");
    expect(resAnr.mnemonic).toBe("ANR");

    const resCopilot = parse_mnemonic_command("COPILOT <GO>");
    expect(resCopilot.is_valid).toBe(true);
    expect(resCopilot.mnemonic).toBe("COPILOT");

    const resTickerCopilot = parse_mnemonic_command("TSLA COPILOT <GO>");
    expect(resTickerCopilot.is_valid).toBe(true);
    expect(resTickerCopilot.identifier).toBe("TSLA");
    expect(resTickerCopilot.mnemonic).toBe("COPILOT");
  });

  it("parses Tier 1/2 commands: NVDA DES <GO>, CRWD SPLC <GO>, EDGAR, NEWS, HP", () => {
    const resDes = parse_mnemonic_command("NVDA US <EQUITY> DES <GO>");
    expect(resDes.is_valid).toBe(true);
    expect(resDes.identifier).toBe("NVDA");
    expect(resDes.mnemonic).toBe("DES");

    const resSplc = parse_mnemonic_command("CRWD SPLC <GO>");
    expect(resSplc.is_valid).toBe(true);
    expect(resSplc.identifier).toBe("CRWD");
    expect(resSplc.mnemonic).toBe("SPLC");

    const resEdgar = parse_mnemonic_command("NVDA EDGAR <GO>");
    expect(resEdgar.is_valid).toBe(true);
    expect(resEdgar.identifier).toBe("NVDA");
    expect(resEdgar.mnemonic).toBe("EDGAR");

    const resNews = parse_mnemonic_command("AAPL NEWS <GO>");
    expect(resNews.is_valid).toBe(true);
    expect(resNews.identifier).toBe("AAPL");
    expect(resNews.mnemonic).toBe("NEWS");

    const resHp = parse_mnemonic_command("MSFT HP <GO>");
    expect(resHp.is_valid).toBe(true);
    expect(resHp.identifier).toBe("MSFT");
    expect(resHp.mnemonic).toBe("HP");
  });

  it("parses commands without trailing <GO>", () => {
    const res = parse_mnemonic_command("AAPL GP");
    expect(res.is_valid).toBe(true);
    expect(res.has_go).toBe(false);
    expect(res.identifier).toBe("AAPL");
    expect(res.mnemonic).toBe("GP");
  });

  it("parses commands with bare GO", () => {
    const res = parse_mnemonic_command("MSFT PORT GO");
    expect(res.is_valid).toBe(true);
    expect(res.has_go).toBe(true);
    expect(res.identifier).toBe("MSFT");
    expect(res.mnemonic).toBe("PORT");
  });

  it("handles recognized international markets", () => {
    const resLn = parse_mnemonic_command("AZN LN <EQUITY> GP <GO>");
    expect(resLn.identifier).toBe("AZN");
    expect(resLn.market).toBe("LN");
    expect(resLn.mnemonic).toBe("GP");

    const resJp = parse_mnemonic_command("7203 JP <EQUITY> FA <GO>");
    expect(resJp.identifier).toBe("7203");
    expect(resJp.market).toBe("JP");
    expect(resJp.mnemonic).toBe("FA");
  });

  it("handles different asset classes", () => {
    const resIndex = parse_mnemonic_command("SPX <INDEX> GP <GO>");
    expect(resIndex.identifier).toBe("SPX");
    expect(resIndex.asset_class).toBe("INDEX");
    expect(resIndex.mnemonic).toBe("GP");

    const resCorp = parse_mnemonic_command("AAPL <CORP> FA <GO>");
    expect(resCorp.identifier).toBe("AAPL");
    expect(resCorp.asset_class).toBe("CORP");
  });

  it("handles empty or whitespace strings gracefully", () => {
    const resEmpty = parse_mnemonic_command("");
    expect(resEmpty.is_valid).toBe(false);
    expect(resEmpty.error).toBe("Empty command");

    const resSpaces = parse_mnemonic_command("   ");
    expect(resSpaces.is_valid).toBe(false);
  });

  it("keeps identifier empty on standalone mnemonics and preserves extra params", () => {
    const resHmm = parse_mnemonic_command("HMM <GO>");
    expect(resHmm.is_valid).toBe(true);
    expect(resHmm.identifier).toBe("");
    expect(resHmm.mnemonic).toBe("HMM");

    const resMulti = parse_mnemonic_command("NVDA FA 1D <GO>");
    expect(resMulti.identifier).toBe("NVDA");
    expect(resMulti.mnemonic).toBe("FA");
    expect(resMulti.parameters.args).toEqual(["1D"]);
  });
});
