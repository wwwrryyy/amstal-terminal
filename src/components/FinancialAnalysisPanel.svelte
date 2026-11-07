<script lang="ts">
  import { get10YFinancialLakehouse } from "../lib/data_lake";
  import type { FinancialFilingMetadata, FinancialMetricRow } from "../lib/types";

  let {
    ticker = "NVDA",
    isMaximized = false,
    onToggleMaximize,
  }: {
    ticker?: string;
    isMaximized?: boolean;
    onToggleMaximize?: () => void;
  } = $props();

  type StatementType = "INCOME" | "BALANCE" | "CASHFLOW" | "RATIOS";

  let activeStatement = $state<StatementType>("INCOME");
  let pitStrict = $state<boolean>(true); // Point-in-Time strict cutoff toggle
  let selectedFiling = $state<FinancialFilingMetadata | null>(null);

  // Derived data based on ticker and pitStrict
  let lakehouse = $derived(get10YFinancialLakehouse(ticker, pitStrict));

  let currentRows = $derived.by<FinancialMetricRow[]>(() => {
    switch (activeStatement) {
      case "INCOME":
        return lakehouse.incomeStatement;
      case "BALANCE":
        return lakehouse.balanceSheet;
      case "CASHFLOW":
        return lakehouse.cashFlow;
      case "RATIOS":
        return lakehouse.ratios;
      default:
        return lakehouse.incomeStatement;
    }
  });

  function formatValue(val: number | null, format: FinancialMetricRow["format"]): string {
    if (val === null || val === undefined) return "—";
    if (format === "currency") {
      // Numbers are in millions
      if (Math.abs(val) >= 1000) {
        return `$${(val / 1000).toFixed(2)}B`;
      }
      return `$${val.toLocaleString()}M`;
    }
    if (format === "percent") {
      return `${val.toFixed(1)}%`;
    }
    if (format === "number") {
      return val.toFixed(2);
    }
    return val.toString();
  }
</script>

<div class="flex flex-col h-full w-full bg-[#111622] border border-[#1E2638] rounded select-none overflow-hidden">
  <!-- Panel Subheader -->
  <div class="flex items-center justify-between px-3 py-1.5 bg-[#182030] border-b border-[#1E2638] text-xs">
    <div class="flex items-center gap-2">
      <span class="font-bold text-[#E2E8F0]">FA &lt;GO&gt;</span>
      <span class="text-[#00D2FF] font-semibold">{ticker} US</span>
      <span class="text-[#64748B]">10Y POINT-IN-TIME XBRL LAKEHOUSE</span>
    </div>

    <div class="flex items-center gap-2">
      <!-- Statement Selector -->
      <div class="flex items-center bg-[#0A0E17] rounded border border-[#1E2638] p-0.5 text-2xs">
        <button
          onclick={() => (activeStatement = "INCOME")}
          class="px-2 py-0.5 rounded transition-colors {activeStatement === 'INCOME' ? 'bg-[#1E2638] text-[#00D2FF] font-bold' : 'text-[#64748B] hover:text-[#E2E8F0]'}"
        >
          INCOME
        </button>
        <button
          onclick={() => (activeStatement = "BALANCE")}
          class="px-2 py-0.5 rounded transition-colors {activeStatement === 'BALANCE' ? 'bg-[#1E2638] text-[#00D2FF] font-bold' : 'text-[#64748B] hover:text-[#E2E8F0]'}"
        >
          BALANCE
        </button>
        <button
          onclick={() => (activeStatement = "CASHFLOW")}
          class="px-2 py-0.5 rounded transition-colors {activeStatement === 'CASHFLOW' ? 'bg-[#1E2638] text-[#00D2FF] font-bold' : 'text-[#64748B] hover:text-[#E2E8F0]'}"
        >
          CASH FLOW
        </button>
        <button
          onclick={() => (activeStatement = "RATIOS")}
          class="px-2 py-0.5 rounded transition-colors {activeStatement === 'RATIOS' ? 'bg-[#1E2638] text-[#00D2FF] font-bold' : 'text-[#64748B] hover:text-[#E2E8F0]'}"
        >
          RATIOS
        </button>
      </div>

      <!-- PIT Safe Toggle -->
      <button
        onclick={() => (pitStrict = !pitStrict)}
        class="flex items-center gap-1.5 px-2 py-0.5 text-2xs rounded border transition-colors {pitStrict ? 'border-[#00E676]/50 bg-[#00E676]/10 text-[#00E676]' : 'border-[#FF9E00]/50 bg-[#FF9E00]/10 text-[#FF9E00]'}"
        title="Enforces XBRL filed-date cutoffs to eliminate lookahead bias in restatements"
      >
        <span class="w-1.5 h-1.5 rounded-full {pitStrict ? 'bg-[#00E676]' : 'bg-[#FF9E00]'}"></span>
        <span>{pitStrict ? "PIT STRICT (AS-FILED)" : "AS-RESTATED"}</span>
      </button>

      {#if onToggleMaximize}
        <button
          onclick={onToggleMaximize}
          class="px-2 py-0.5 text-2xs rounded border border-[#1E2638] bg-[#0A0E17] text-[#94A3B8] hover:text-white"
          title={isMaximized ? "Restore 2x2 Grid" : "Maximize Panel"}
        >
          {isMaximized ? "RESTORE" : "MAX"}
        </button>
      {/if}
    </div>
  </div>

  <!-- Table Container -->
  <div class="flex-1 flex flex-col overflow-x-auto overflow-y-auto">
    <table class="w-full text-2xs border-collapse font-mono select-text">
      <!-- Period / SEC EDGAR Headers -->
      <thead>
        <tr class="bg-[#0A0E17] text-[#64748B] border-b border-[#1E2638] sticky top-0 z-10">
          <th class="p-2 text-left sticky left-0 bg-[#0A0E17] z-20 min-w-[180px] border-r border-[#1E2638]">
            FINANCIAL METRIC
          </th>
          {#each lakehouse.filings as f}
            <th class="p-2 text-right min-w-[95px]">
              <div class="font-bold text-[#E2E8F0]">{f.period}</div>
              <button
                onclick={() => (selectedFiling = f)}
                class="text-3xs text-[#00D2FF] hover:underline cursor-pointer block mt-0.5 font-normal truncate"
                title={`Filed: ${f.filed_date} | Accession: ${f.accession_number}`}
              >
                {f.accession_number.split("-")[1]}-{f.accession_number.split("-")[2]}
              </button>
            </th>
          {/each}
        </tr>
      </thead>

      <!-- Statement Rows -->
      <tbody class="divide-y divide-[#182030]/60">
        {#each currentRows as row}
          <tr class="hover:bg-[#182030]/50 transition-colors">
            <td class="p-1.5 sticky left-0 bg-[#111622] z-10 border-r border-[#1E2638] text-[#E2E8F0] font-semibold truncate">
              {row.label}
            </td>
            {#each lakehouse.filings as f}
              {@const val = row.values[f.period]}
              <td class="p-1.5 text-right font-mono text-[#94A3B8]">
                {formatValue(val, row.format)}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- SEC Filing Drawer Modal if selected -->
  {#if selectedFiling}
    <div class="p-2 bg-[#0A0E17] border-t border-[#1E2638] flex items-center justify-between text-2xs">
      <div class="flex items-center gap-3">
        <span class="text-[#00D2FF] font-bold">{selectedFiling.period} 10-K FILING METADATA:</span>
        <span class="text-[#64748B]">FILED: <strong class="text-[#E2E8F0]">{selectedFiling.filed_date}</strong></span>
        <span class="text-[#64748B]">PERIOD END: <strong class="text-[#E2E8F0]">{selectedFiling.period_end_date}</strong></span>
        <span class="text-[#64748B]">ACCESSION: <code class="text-[#FF9E00]">{selectedFiling.accession_number}</code></span>
        {#if selectedFiling.is_restated}
          <span class="px-1.5 py-0.5 rounded bg-[#FF3366]/20 text-[#FF3366] text-3xs font-bold">
            RESTATEMENT DETECTED: {selectedFiling.restatement_delta_notes}
          </span>
        {/if}
      </div>
      <button
        onclick={() => (selectedFiling = null)}
        class="px-2 py-0.5 rounded bg-[#182030] text-[#94A3B8] hover:text-white"
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
</style>
