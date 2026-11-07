<script lang="ts">
  import { ipcService } from "../lib/ipc";
  import type { ColorChannel, EdgarFilingRedlineData } from "../lib/types";

  let {
    ticker = "NVDA",
    channel = "BLUE",
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

  let edgarData = $derived<EdgarFilingRedlineData>(ipcService.getEdgarFilings(ticker));
  let activeTab = $state<"RISK" | "MDA" | "FORM4">("RISK");

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

  let selectedRedline = $derived(
    activeTab === "RISK"
      ? edgarData.redlines.find((r) => r.section.includes("1A")) || edgarData.redlines[0]
      : edgarData.redlines.find((r) => r.section.includes("MD&A")) || edgarData.redlines[1]
  );
</script>

<div class="flex flex-col h-full w-full bg-[#0C111B] border border-[#172033] rounded select-none overflow-hidden text-xs">
  <!-- Subheader -->
  <div class="flex items-center justify-between px-3 py-1 bg-[#090D16] border-b border-[#172033]">
    <div class="flex items-center gap-2">
      <!-- Color Channel Link Pill -->
      <button
        onclick={cycleChannel}
        class="px-1.5 py-0.5 rounded text-2xs font-bold border transition-colors {channelColors[channel].bg} {channelColors[channel].text} {channelColors[channel].border}"
        title="Color Channel Link"
      >
        [{channel}]
      </button>
      <span class="font-bold text-[#FFB000]">EDGAR &lt;GO&gt;</span>
      <span class="text-[#E6EDF5] font-semibold">{ticker} US</span>
    </div>

    <div class="flex items-center gap-2">
      <!-- Section Tabs -->
      <div class="flex items-center bg-[#06090F] rounded border border-[#172033] p-0.5 text-2xs font-mono">
        <button
          onclick={() => (activeTab = "RISK")}
          class="px-2 py-0.5 rounded transition-colors {activeTab === 'RISK' ? 'bg-[#151D2E] text-[#00D2FF] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          ITEM 1A RISK
        </button>
        <button
          onclick={() => (activeTab = "MDA")}
          class="px-2 py-0.5 rounded transition-colors {activeTab === 'MDA' ? 'bg-[#151D2E] text-[#00D2FF] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          ITEM 7 MD&amp;A
        </button>
        <button
          onclick={() => (activeTab = "FORM4")}
          class="px-2 py-0.5 rounded transition-colors {activeTab === 'FORM4' ? 'bg-[#151D2E] text-[#00D2FF] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          FORM 4 INSIDERS
        </button>
      </div>

      {#if onToggleMaximize}
        <button
          onclick={onToggleMaximize}
          class="px-2 py-0.5 text-2xs rounded border border-[#172033] bg-[#06090F] text-[#8B98A5] hover:text-white transition-colors"
        >
          {isMaximized ? "RESTORE" : "MAX"}
        </button>
      {/if}
    </div>
  </div>

  <!-- Main View Area -->
  <div class="flex-1 flex flex-col p-2.5 gap-2.5 overflow-hidden">
    {#if activeTab === "RISK" || activeTab === "MDA"}
      <!-- Summary Metrics Bar -->
      <div class="grid grid-cols-4 gap-2">
        <div class="p-2 bg-[#06090F] border border-[#172033] rounded flex flex-col justify-between">
          <span class="text-2xs text-[#5E6D82]">DIFFLIB SIMILARITY</span>
          <div class="flex items-baseline gap-1 mt-1 font-mono">
            <span class="text-sm font-bold text-[#00D2FF]">
              {activeTab === "RISK" ? (edgarData.item1a_similarity * 100).toFixed(1) : (edgarData.mda_similarity * 100).toFixed(1)}%
            </span>
            <span class="text-2xs text-[#5E6D82]">vs prior FY</span>
          </div>
          <span class="text-2xs text-[#5E6D82] mt-0.5">NLP Hash</span>
        </div>

        <div class="p-2 bg-[#06090F] border border-[#172033] rounded flex flex-col justify-between">
          <span class="text-2xs text-[#5E6D82]">SENTIMENT DRIFT (&Delta;)</span>
          <div class="flex items-baseline gap-1 mt-1 font-mono">
            <span class="text-sm font-bold {edgarData.item1a_sentiment_drift >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
              {edgarData.item1a_sentiment_drift >= 0 ? "+" : ""}{edgarData.item1a_sentiment_drift.toFixed(2)}
            </span>
            <span class="text-2xs text-[#5E6D82]">score</span>
          </div>
          <span class="text-2xs text-[#5E6D82] mt-0.5">FinBERT Embedding</span>
        </div>

        <div class="p-2 bg-[#06090F] border border-[#172033] rounded flex flex-col justify-between">
          <span class="text-2xs text-[#5E6D82]">NEW RISK CLAUSES</span>
          <div class="flex items-baseline gap-1 mt-1 font-mono">
            <span class="text-sm font-bold text-[#FFB000]">
              +{selectedRedline?.added_clauses.length ?? 0}
            </span>
            <span class="text-2xs text-[#5E6D82]">clauses</span>
          </div>
          <span class="text-2xs text-[#64748B] mt-0.5">High Attention Delta</span>
        </div>

        <div class="p-2 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col justify-between">
          <span class="text-2xs text-[#64748B]">DELETED CLAUSES</span>
          <div class="flex items-baseline gap-1 mt-1 font-mono">
            <span class="text-sm font-bold text-[#E2E8F0]">
              -{selectedRedline?.removed_clauses.length ?? 0}
            </span>
            <span class="text-2xs text-[#64748B]">clauses</span>
          </div>
          <span class="text-2xs text-[#64748B] mt-0.5">Mitigated / Outdated</span>
        </div>
      </div>

      <!-- Redline Inspector Box -->
      <div class="flex-1 bg-[#06090F] border border-[#172033] rounded flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-3 py-1.5 bg-[#090D16] border-b border-[#172033] text-2xs font-mono">
          <span class="font-bold text-[#FFB000]">{selectedRedline?.section}</span>
          <span class="text-[#00FF66]">{selectedRedline?.status}</span>
        </div>

        <div class="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-2xs">
          <!-- Added clauses -->
          {#each selectedRedline?.added_clauses || [] as clause}
            <div class="p-2 bg-[#00FF66]/10 border-l-2 border-[#00FF66] rounded text-[#E6EDF5] leading-relaxed">
              <span class="font-bold text-[#00FF66] block mb-0.5">[+] ADDED // NEW MATERIAL DISCLOSURE:</span>
              {clause}
            </div>
          {/each}

          <!-- Removed clauses -->
          {#each selectedRedline?.removed_clauses || [] as clause}
            <div class="p-2 bg-[#FF3344]/10 border-l-2 border-[#FF3344] rounded text-[#8B98A5] leading-relaxed line-through">
              <span class="font-bold text-[#FF3344] block mb-0.5">[-] STRICKEN // FORMER RISK CLAUSE:</span>
              {clause}
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <!-- Form 4 Insider Clusters Table -->
      <div class="flex-1 bg-[#06090F] border border-[#172033] rounded flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-3 py-1.5 bg-[#090D16] border-b border-[#172033] text-2xs font-mono">
          <span class="font-bold text-[#FFB000]">FORM 4 CLUSTER TRANSACTIONS</span>
          <span class="text-[#5E6D82]">RULE 10B5-1 FILTERING ENFORCED</span>
        </div>

        <div class="flex-1 overflow-y-auto">
          <table class="w-full text-left border-collapse text-2xs font-mono">
            <thead class="bg-[#090D16] text-[#5E6D82] sticky top-0">
              <tr>
                <th class="p-2">FILING DATE</th>
                <th class="p-2">INSIDER NAME</th>
                <th class="p-2">TITLE / ROLE</th>
                <th class="p-2 text-center">TYPE</th>
                <th class="p-2 text-right">SHARES</th>
                <th class="p-2 text-right">PRICE</th>
                <th class="p-2 text-right">VALUE ($)</th>
                <th class="p-2 text-center">PLAN STATUS</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#172033]/50">
              {#each edgarData.form4_transactions as tx}
                <tr class="hover:bg-[#0C111B] transition-colors">
                  <td class="p-2 text-[#E6EDF5]">{tx.filing_date}</td>
                  <td class="p-2 font-semibold text-[#00D2FF]">{tx.insider_name}</td>
                  <td class="p-2 text-[#5E6D82]">{tx.relationship}</td>
                  <td class="p-2 text-center">
                    <span
                      class="px-1.5 py-0.2 rounded font-bold {tx.transaction_code === 'P'
                        ? 'bg-[#00FF66]/20 text-[#00FF66]'
                        : 'bg-[#FF3344]/20 text-[#FF3344]'}"
                    >
                      {tx.transaction_code === 'P' ? 'BUY (P)' : 'SELL (S)'}
                    </span>
                  </td>
                  <td class="p-2 text-right text-[#E6EDF5]">{tx.shares.toLocaleString()}</td>
                  <td class="p-2 text-right text-[#E6EDF5]">${tx.price.toFixed(2)}</td>
                  <td class="p-2 text-right font-bold {tx.transaction_code === 'P' ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
                    ${(tx.value / 1000000).toFixed(2)}M
                  </td>
                  <td class="p-2 text-center">
                    {#if tx.is_10b5_1}
                      <span class="px-1.5 py-0.5 rounded bg-[#FFB000]/20 text-[#FFB000] text-3xs font-semibold">
                        10b5-1 SCHEDULED
                      </span>
                    {:else}
                      <span class="px-1.5 py-0.5 rounded bg-[#00FF66]/20 text-[#00FF66] text-3xs font-semibold">
                        DISCRETIONARY CLUSTER
                      </span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
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
