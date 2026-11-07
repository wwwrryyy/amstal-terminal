<script lang="ts">
  import { get10YFinancialLakehouse } from "../lib/data_lake";
  import type { ColorChannel, FinancialFilingMetadata, FinancialMetricRow } from "../lib/types";

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

<div class="flex flex-col h-full w-full bg-[#0C111B] border border-[#172033] rounded select-none overflow-hidden">
  <!-- Panel Subheader -->
  <div class="flex items-center justify-between px-3 py-1 bg-[#090D16] border-b border-[#172033] text-xs">
    <div class="flex items-center gap-2">
      <!-- Color Channel Link Pill -->
      <button
        onclick={cycleChannel}
        class="px-1.5 py-0.5 rounded text-2xs font-bold border transition-colors {channelColors[channel].bg} {channelColors[channel].text} {channelColors[channel].border}"
        title="Color Channel Link"
      >
        [{channel}]
      </button>
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
  <div class="flex-1 flex flex-col overflow-x-auto overflow-y-auto bg-[#06090F]">
    <table class="w-full text-2xs border-collapse font-mono select-text">
      <!-- Period / SEC EDGAR Headers -->
      <thead>
        <tr class="bg-[#090D16] text-[#5E6D82] border-b border-[#172033] sticky top-0 z-10">
          <th class="p-2 text-left sticky left-0 bg-[#090D16] z-20 min-w-[180px] border-r border-[#172033]">
            FINANCIAL METRIC
          </th>
          {#each lakehouse.filings as f}
            <th class="p-2 text-right min-w-[95px]">
              <div class="font-bold text-[#E6EDF5]">{f.period}</div>
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
      <tbody class="divide-y divide-[#172033]/60">
        {#each currentRows as row}
          <tr class="hover:bg-[#0C111B] transition-colors">
            <td class="p-1.5 sticky left-0 bg-[#0C111B] z-10 border-r border-[#172033] text-[#E6EDF5] font-semibold truncate">
              {row.label}
            </td>
            {#each lakehouse.filings as f}
              {@const val = row.values[f.period]}
              <td class="p-1.5 text-right font-mono text-[#8B98A5]">
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
    <div class="p-2 bg-[#06090F] border-t border-[#172033] flex items-center justify-between text-2xs">
      <div class="flex items-center gap-3">
        <span class="text-[#00D2FF] font-bold">{selectedFiling.period} 10-K FILING METADATA:</span>
        <span class="text-[#5E6D82]">FILED: <strong class="text-[#E6EDF5]">{selectedFiling.filed_date}</strong></span>
        <span class="text-[#5E6D82]">PERIOD END: <strong class="text-[#E6EDF5]">{selectedFiling.period_end_date}</strong></span>
        <span class="text-[#5E6D82]">ACCESSION: <code class="text-[#FFB000]">{selectedFiling.accession_number}</code></span>
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
</style>
