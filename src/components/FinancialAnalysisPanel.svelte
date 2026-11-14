<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ipcService } from "../lib/ipc";
  import type {
    ColorChannel,
    FinancialFilingMetadata,
    FinancialMetricRow,
    FinancialStatementsPayload,
  } from "../lib/types";

  let {
    ticker = "NVDA",
    channel = "GREEN",
    isMaximized = false,
    onToggleMaximize,
    onChannelChange,
    onSwitchFunction,
  }: {
    ticker?: string;
    channel?: ColorChannel;
    isMaximized?: boolean;
    onToggleMaximize?: () => void;
    onChannelChange?: (ch: ColorChannel) => void;
    onSwitchFunction?: (mnemonic: string) => void;
  } = $props();

  const channelColors: Record<ColorChannel, { bg: string; text: string; border: string }> = {
    BLUE: { bg: "bg-[#00D2FF]/20", text: "text-[#00D2FF]", border: "border-[#00D2FF]/40" },
    AMBER: { bg: "bg-[#FF9E00]/20", text: "text-[#FF9E00]", border: "border-[#FF9E00]/40" },
    GREEN: { bg: "bg-[#00E676]/20", text: "text-[#00E676]", border: "border-[#00E676]/40" },
    RED: { bg: "bg-[#FF3366]/20", text: "text-[#FF3366]", border: "border-[#FF3366]/40" },
    UNLINKED: { bg: "bg-[#64748B]/20", text: "text-[#64748B]", border: "border-[#64748B]/40" },
  };

  function cycleChannel() {
    if (!onChannelChange) return;
    const channels: ColorChannel[] = ["BLUE", "AMBER", "GREEN", "RED", "UNLINKED"];
    const nextIdx = (channels.indexOf(channel) + 1) % channels.length;
    onChannelChange(channels[nextIdx]);
  }

  type StatementType = "INCOME" | "BALANCE" | "CASHFLOW" | "RATIOS";

  let activeStatement = $state<StatementType>("INCOME");
  let pitStrict = $state<boolean>(true);
  let selectedFiling = $state<FinancialFilingMetadata | null>(null);
  let payload = $state<FinancialStatementsPayload | null>(null);
  let connState = $state<string>(ipcService.connectionState);
  let isLoading = $state<boolean>(false);

  let unsubIpc: (() => void) | null = null;
  let unsubStatus: (() => void) | null = null;

  function loadFinancials(sym: string, strict: boolean) {
    const cached = ipcService.getFinancials(sym, strict);
    if (cached) {
      payload = cached;
    } else {
      payload = null;
    }

    if (ipcService.connectionState === "CONNECTED") {
      if (!cached) isLoading = true;
      ipcService
        .fetchFinancials(sym, strict)
        .then((res) => {
          if (res && res.ticker === sym.toUpperCase()) {
            payload = res;
          }
        })
        .finally(() => {
          isLoading = false;
        });
    } else {
      isLoading = false;
    }
  }

  onMount(() => {
    unsubStatus = ipcService.subscribeStatus((st) => {
      connState = st;
      if (st === "CONNECTED") {
        loadFinancials(ticker, pitStrict);
      }
    });

    unsubIpc = ipcService.subscribe(() => {
      const updated = ipcService.getFinancials(ticker, pitStrict);
      if (updated) payload = updated;
    });
  });

  onDestroy(() => {
    if (unsubIpc) unsubIpc();
    if (unsubStatus) unsubStatus();
  });

  $effect(() => {
    const sym = ticker;
    const strict = pitStrict;
    void connState;
    selectedFiling = null;
    if (sym) {
      loadFinancials(sym, strict);
    }
  });

  let filings = $derived(payload?.filings ?? []);

  let currentRows = $derived.by<FinancialMetricRow[]>(() => {
    if (!payload || !payload.available) return [];
    switch (activeStatement) {
      case "INCOME":
        return payload.incomeStatement;
      case "BALANCE":
        return payload.balanceSheet;
      case "CASHFLOW":
        return payload.cashFlow;
      case "RATIOS":
        return payload.ratios;
      default:
        return payload.incomeStatement;
    }
  });

  let revenueCagrDisplay = $derived.by(() => {
    if (!payload || !payload.available || filings.length < 2) return "—";
    const revRow = payload.incomeStatement.find((r) => r.tag === "Revenues");
    if (!revRow) return "—";

    const pts: Array<{ year: number; val: number }> = [];
    for (const f of filings) {
      const v = revRow.values[f.period];
      if (typeof v === "number" && v > 0) {
        const yMatch = (f.period_end_date || f.period).match(/\d{4}/);
        if (yMatch) {
          pts.push({ year: Number(yMatch[0]), val: v });
        }
      }
    }
    if (pts.length < 2) return "—";
    pts.sort((a, b) => a.year - b.year);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const span = last.year - first.year;
    if (span <= 0 || first.val <= 0) return "—";
    const cagr = (Math.pow(last.val / first.val, 1 / span) - 1) * 100;
    return `${cagr >= 0 ? "+" : ""}${cagr.toFixed(1)}% (${span}Y)`;
  });

  let restatedFilingsCount = $derived(filings.filter((f) => f.is_restated).length);

  function formatValue(val: number | null, format: FinancialMetricRow["format"]): string {
    if (val === null || val === undefined || !Number.isFinite(val)) return "—";
    if (format === "currency") {
      if (Math.abs(val) >= 1000) {
        return `$${(val / 1000).toFixed(2)}B`;
      }
      return `$${val.toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
    }
    if (format === "percent") {
      return `${val.toFixed(1)}%`;
    }
    if (format === "number" || format === "ratio") {
      return val.toFixed(2);
    }
    return String(val);
  }
</script>

<div class="flex flex-col h-full w-full bg-[#0C111B] border border-[#172033] rounded select-none overflow-hidden">
  <!-- Panel Subheader -->
  <div class="flex items-center justify-between px-3 py-1 bg-[#090D16] border-b border-[#172033] text-xs">
    <div class="flex items-center gap-2">
      <!-- Color Channel Link Pill -->
      <button
        onclick={cycleChannel}
        class="px-1.5 py-0.5 rounded text-2xs font-bold border transition-colors {channelColors[channel].bg} {channelColors[channel].text} {channelColors[channel].border}"
        title="Color Channel Link (Click to cycle)"
      >
        [{channel}]
      </button>
      {#if channel !== "BLUE"}
        <span class="px-1.5 py-0.5 rounded text-3xs font-mono font-bold bg-[#151D2E] text-[#8B98A5] border border-[#23314B]" title="Independent color channel - decoupled from master Blue ticker">
          INDEPENDENT CHANNEL
        </span>
      {/if}
      <span class="font-bold text-[#E6EDF5]">FA &lt;GO&gt;</span>
      <span class="text-[#00D2FF] font-semibold">{ticker} US</span>
    </div>

    <div class="flex items-center gap-2">
      <!-- Statement Selector -->
      <div class="flex items-center bg-[#06090F] rounded border border-[#172033] p-0.5 text-2xs font-mono">
        <button
          onclick={() => (activeStatement = "INCOME")}
          class="px-2 py-0.5 rounded transition-colors {activeStatement === 'INCOME' ? 'bg-[#151D2E] text-[#00D2FF] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          INCOME
        </button>
        <button
          onclick={() => (activeStatement = "BALANCE")}
          class="px-2 py-0.5 rounded transition-colors {activeStatement === 'BALANCE' ? 'bg-[#151D2E] text-[#00D2FF] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          BALANCE
        </button>
        <button
          onclick={() => (activeStatement = "CASHFLOW")}
          class="px-2 py-0.5 rounded transition-colors {activeStatement === 'CASHFLOW' ? 'bg-[#151D2E] text-[#00D2FF] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          CASH FLOW
        </button>
        <button
          onclick={() => (activeStatement = "RATIOS")}
          class="px-2 py-0.5 rounded transition-colors {activeStatement === 'RATIOS' ? 'bg-[#151D2E] text-[#00D2FF] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          RATIOS
        </button>
      </div>

      <!-- PIT Safe Toggle -->
      <button
        onclick={() => (pitStrict = !pitStrict)}
        class="flex items-center gap-1.5 px-2 py-0.5 text-2xs rounded border transition-colors {pitStrict ? 'border-[#00FF66]/50 bg-[#00FF66]/10 text-[#00FF66]' : 'border-[#FFB000]/50 bg-[#FFB000]/10 text-[#FFB000]'}"
        title="Enforces XBRL filed-date cutoffs to eliminate lookahead bias in restatements"
      >
        <span class="w-1.5 h-1.5 rounded-full {pitStrict ? 'bg-[#00FF66]' : 'bg-[#FFB000]'}"></span>
        <span>{pitStrict ? "PIT STRICT" : "AS-RESTATED"}</span>
      </button>

      {#if onToggleMaximize}
        <button
          onclick={onToggleMaximize}
          class="px-2 py-0.5 text-2xs rounded border border-[#172033] bg-[#06090F] text-[#8B98A5] hover:text-white transition-colors"
          title={isMaximized ? "Restore 2x2 Grid" : "Maximize Panel"}
        >
          {isMaximized ? "RESTORE" : "MAX"}
        </button>
      {/if}
    </div>
  </div>

  <!-- Table Container -->
  <div class="flex-1 flex flex-col overflow-x-auto overflow-y-auto bg-[#06090F] custom-scrollbar">
    {#if isLoading && !payload}
      <div class="flex-1 flex flex-col items-center justify-center p-6 text-center font-mono">
        <span class="text-xs font-bold text-[#00D2FF]">FETCHING SEC EDGAR XBRL COMPANYFACTS FOR {ticker}…</span>
        <span class="text-2xs text-[#5E6D82] mt-1">Extracting point-in-time US-GAAP income, balance sheet, and cash flow statements.</span>
      </div>
    {:else if !payload || !payload.available || currentRows.length === 0}
      <div class="flex-1 flex flex-col items-center justify-center p-6 text-center font-mono">
        <span class="text-xs font-bold text-[#FFB000]">
          {connState === "CONNECTED" ? `NO SEC EDGAR XBRL FUNDAMENTALS FOR ${ticker}` : "ENGINE DAEMON OFFLINE — NO SIMULATED STATEMENTS"}
        </span>
        <span class="text-2xs text-[#5E6D82] mt-1 max-w-md">
          {payload?.message || (connState === "CONNECTED" ? "Ticker may be an ETF, index, ADRs without US-GAAP XBRL tags, or network offline." : "Connect the live QARE-MM Python daemon on ws://127.0.0.1:8194 to retrieve authentic SEC EDGAR XBRL filings.")}
        </span>
      </div>
    {:else}
      <table class="w-max min-w-full text-2xs border-collapse font-mono select-text">
        <!-- Period / SEC EDGAR Headers -->
        <thead>
          <tr class="bg-[#090D16] text-[#5E6D82] border-b border-[#172033] sticky top-0 z-10">
            <th class="p-2 text-left sticky left-0 bg-[#090D16] z-20 min-w-[170px] border-r border-[#172033]">
              FINANCIAL METRIC
            </th>
            {#each filings as f}
              <th class="px-2.5 py-1.5 text-right min-w-[76px] border-r border-[#172033]/40">
                <div class="font-bold text-[#E6EDF5]">{f.period}</div>
                <button
                  onclick={() => (selectedFiling = f)}
                  class="text-3xs text-[#7A8B9E] hover:text-[#00D2FF] hover:underline cursor-pointer block mt-0.5 font-mono tracking-tight transition-colors truncate max-w-[82px] ml-auto text-right"
                  title={`Click for EDGAR Filing Metadata\nFiled: ${f.filed_date}\nPeriod End: ${f.period_end_date}\nAccession: ${f.accession_number}`}
                >
                  10-K {f.filed_date ? f.filed_date.slice(0, 7) : ""}
                </button>
              </th>
            {/each}
          </tr>
        </thead>

        <!-- Statement Rows -->
        <tbody class="divide-y divide-[#172033]/60">
          {#each currentRows as row}
            {@const isHeaderMetric = row.tag === "Revenues" || row.tag === "GrossProfit" || row.tag === "OperatingIncome" || row.tag === "NetIncome" || row.tag === "TotalAssets" || row.tag === "StockholdersEquity" || row.tag === "FreeCashFlow"}
            <tr class="hover:bg-[#0C111B] transition-colors {isHeaderMetric ? 'bg-[#090D16]/70' : ''}">
              <td class="p-1.5 sticky left-0 z-10 border-r border-[#172033] truncate {isHeaderMetric ? 'bg-[#090D16] text-[#00D2FF] font-bold' : 'bg-[#0C111B] text-[#E6EDF5] font-semibold'}">
                {row.label}
              </td>
              {#each filings as f}
                {@const val = row.values[f.period] ?? null}
                <td class="px-2.5 py-1.5 text-right font-mono border-r border-[#172033]/30 {isHeaderMetric ? 'text-[#E6EDF5] font-semibold' : 'text-[#8B98A5]'}">
                  {formatValue(val, row.format)}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <!-- Financial Lakehouse Audit & Point-in-Time Status Footer -->
  <div class="px-3 py-1.5 bg-[#090D16] border-t border-[#172033] flex items-center justify-between text-2xs font-mono">
    <div class="flex items-center gap-3">
      <span class="text-[#5E6D82]">
        SOURCE: <strong class={payload?.available ? "text-[#00FF66]" : "text-[#8B98A5]"}>{payload?.source || "UNAVAILABLE"}</strong>
      </span>
      <span class="text-[#5E6D82]">|</span>
      <span class="text-[#5E6D82]">
        REVENUE CAGR: <strong class="text-[#E6EDF5]">{revenueCagrDisplay}</strong>
      </span>
      <span class="text-[#5E6D82]">|</span>
      <span class="text-[#5E6D82]">
        RESTATEMENT CHECK: <strong class={pitStrict ? "text-[#00FF66]" : restatedFilingsCount > 0 ? "text-[#FFB000]" : "text-[#E6EDF5]"}>
          {pitStrict ? "STRICT PIT CUTOFF" : `${restatedFilingsCount} RESTATED PERIOD(S)`}
        </strong>
      </span>
    </div>
    <div class="text-[#5E6D82]">
      SEC EDGAR CIK: <strong class="text-[#00D2FF]">{payload?.cik || "—"}</strong>
    </div>
  </div>

  <!-- SEC Filing Drawer Modal if selected -->
  {#if selectedFiling}
    <div class="p-2 bg-[#06090F] border-t border-[#172033] flex items-center justify-between text-2xs">
      <div class="flex items-center gap-3">
        <span class="text-[#00D2FF] font-bold">{selectedFiling.period} 10-K FILING METADATA:</span>
        <span class="text-[#5E6D82]">FILED: <strong class="text-[#E6EDF5]">{selectedFiling.filed_date}</strong></span>
        <span class="text-[#5E6D82]">PERIOD END: <strong class="text-[#E6EDF5]">{selectedFiling.period_end_date}</strong></span>
        <span class="text-[#5E6D82]">ACCESSION: <code class="text-[#FFB000]">{selectedFiling.accession_number}</code></span>
        {#if selectedFiling.sec_url}
          <a
            href={selectedFiling.sec_url}
            target="_blank"
            rel="noopener noreferrer"
            class="text-[#00D2FF] underline hover:text-white"
          >
            SEC.GOV
          </a>
        {/if}
        {#if selectedFiling.is_restated}
          <span class="px-1.5 py-0.5 rounded bg-[#FF3344]/20 text-[#FF3344] text-3xs font-bold border border-[#FF3344]/40">
            RESTATEMENT DETECTED: {selectedFiling.restatement_delta_notes}
          </span>
        {/if}
      </div>
      <button
        onclick={() => (selectedFiling = null)}
        class="px-2 py-0.5 rounded bg-[#121824] border border-[#172033] text-[#8B98A5] hover:text-white transition-colors"
      >
        DISMISS
      </button>
    </div>
  {/if}
</div>

<style>
  .text-2xs {
    font-size: 0.6875rem; /* 11px */
    line-height: 0.95rem;
  }
  .text-3xs {
    font-size: 0.5625rem; /* 9px */
    line-height: 0.75rem;
  }

  .custom-scrollbar::-webkit-scrollbar {
    width: 5px;
    height: 5px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: #06090F;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #172033;
    border-radius: 2px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #00D2FF;
  }
</style>
