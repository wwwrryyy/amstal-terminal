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

<div class="flex flex-col h-full w-full bg-[#111622] border border-[#1E2638] rounded select-none overflow-hidden text-xs">
  <!-- Subheader -->
  <div class="flex items-center justify-between px-3 py-1.5 bg-[#182030] border-b border-[#1E2638]">
    <div class="flex items-center gap-2">
      <!-- Color Channel Link Pill -->
      <button
        onclick={cycleChannel}
        class="px-1.5 py-0.5 rounded text-2xs font-bold border transition-colors {channelColors[channel].bg} {channelColors[channel].text} {channelColors[channel].border}"
        title="Color Channel Link"
      >
        [{channel}]
      </button>
      <span class="font-bold text-[#FF9E00]">EDGAR &lt;GO&gt;</span>
      <span class="text-[#E2E8F0] font-semibold">{ticker} US</span>
      <span class="text-[#64748B]">SEC 10-K/10-Q REDLINES & FORM 4 CLUSTERS</span>
    </div>

    <div class="flex items-center gap-2">
      <!-- Section Tabs -->
      <div class="flex items-center bg-[#0A0E17] rounded border border-[#1E2638] p-0.5 text-2xs">
        <button
          onclick={() => (activeTab = "RISK")}
          class="px-2 py-0.5 rounded transition-colors {activeTab === 'RISK' ? 'bg-[#1E2638] text-[#00D2FF] font-bold' : 'text-[#64748B] hover:text-[#E2E8F0]'}"
        >
          ITEM 1A RISK
        </button>
        <button
          onclick={() => (activeTab = "MDA")}
          class="px-2 py-0.5 rounded transition-colors {activeTab === 'MDA' ? 'bg-[#1E2638] text-[#00D2FF] font-bold' : 'text-[#64748B] hover:text-[#E2E8F0]'}"
        >
          ITEM 7 MD&amp;A
        </button>
        <button
          onclick={() => (activeTab = "FORM4")}
          class="px-2 py-0.5 rounded transition-colors {activeTab === 'FORM4' ? 'bg-[#1E2638] text-[#00D2FF] font-bold' : 'text-[#64748B] hover:text-[#E2E8F0]'}"
        >
          FORM 4 INSIDERS
        </button>
      </div>

      {#if onSwitchFunction}
        <div class="flex items-center gap-1 text-2xs">
          <button onclick={() => onSwitchFunction("GP")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00D2FF] hover:bg-[#1E2638]">GP</button>
          <button onclick={() => onSwitchFunction("PORT")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#FF9E00] hover:bg-[#1E2638]">PORT</button>
          <button onclick={() => onSwitchFunction("FA")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#E2E8F0] hover:bg-[#1E2638]">FA</button>
          <button onclick={() => onSwitchFunction("DES")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00E676] hover:bg-[#1E2638]">DES</button>
        </div>
      {/if}

      {#if onToggleMaximize}
        <button
          onclick={onToggleMaximize}
          class="px-2 py-0.5 text-2xs rounded border border-[#1E2638] bg-[#0A0E17] text-[#94A3B8] hover:text-white"
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
        <div class="p-2 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col justify-between">
          <span class="text-2xs text-[#64748B]">DIFFLIB SIMILARITY</span>
          <div class="flex items-baseline gap-1 mt-1 font-mono">
            <span class="text-sm font-bold text-[#00D2FF]">
              {activeTab === "RISK" ? (edgarData.item1a_similarity * 100).toFixed(1) : (edgarData.mda_similarity * 100).toFixed(1)}%
            </span>
            <span class="text-2xs text-[#64748B]">vs prior FY</span>
          </div>
          <span class="text-2xs text-[#64748B] mt-0.5">Automated NLP Hash</span>
        </div>

        <div class="p-2 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col justify-between">
          <span class="text-2xs text-[#64748B]">SENTIMENT DRIFT (&Delta;)</span>
          <div class="flex items-baseline gap-1 mt-1 font-mono">
            <span class="text-sm font-bold {edgarData.item1a_sentiment_drift >= 0 ? 'text-[#00E676]' : 'text-[#FF3366]'}">
              {edgarData.item1a_sentiment_drift >= 0 ? "+" : ""}{edgarData.item1a_sentiment_drift.toFixed(2)}
            </span>
            <span class="text-2xs text-[#64748B]">score</span>
          </div>
          <span class="text-2xs text-[#64748B] mt-0.5">FinBERT Embedding</span>
        </div>

        <div class="p-2 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col justify-between">
          <span class="text-2xs text-[#64748B]">NEW RISK CLAUSES</span>
          <div class="flex items-baseline gap-1 mt-1 font-mono">
            <span class="text-sm font-bold text-[#FF9E00]">
              +{selectedRedline?.added_clauses.length ?? 0}
            </span>
            <span class="text-2xs text-[#64748B]">clauses</span>
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
      <div class="flex-1 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-3 py-1.5 bg-[#182030] border-b border-[#1E2638] text-2xs font-mono">
          <span class="font-bold text-[#FF9E00]">{selectedRedline?.section}</span>
          <span class="text-[#00E676]">{selectedRedline?.status}</span>
        </div>

        <div class="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-2xs">
          <!-- Added clauses -->
          {#each selectedRedline?.added_clauses || [] as clause}
            <div class="p-2 bg-[#00E676]/10 border-l-2 border-[#00E676] rounded text-[#E2E8F0] leading-relaxed">
              <span class="font-bold text-[#00E676] block mb-0.5">[+] ADDED // NEW MATERIAL DISCLOSURE:</span>
              {clause}
            </div>
          {/each}

          <!-- Removed clauses -->
          {#each selectedRedline?.removed_clauses || [] as clause}
            <div class="p-2 bg-[#FF3366]/10 border-l-2 border-[#FF3366] rounded text-[#94A3B8] leading-relaxed line-through">
              <span class="font-bold text-[#FF3366] block mb-0.5">[-] STRICKEN // FORMER RISK CLAUSE:</span>
              {clause}
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <!-- Form 4 Insider Clusters Table -->
      <div class="flex-1 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-3 py-1.5 bg-[#182030] border-b border-[#1E2638] text-2xs font-mono">
          <span class="font-bold text-[#FF9E00]">FORM 4 OPEN-MARKET CLUSTER TRANSACTIONS</span>
          <span class="text-[#64748B]">RULE 10B5-1 FILTERING ENFORCED</span>
        </div>

        <div class="flex-1 overflow-y-auto">
          <table class="w-full text-left border-collapse text-2xs font-mono">
            <thead class="bg-[#182030]/60 text-[#64748B] sticky top-0">
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
            <tbody class="divide-y divide-[#182030]/50">
              {#each edgarData.form4_transactions as tx}
                <tr class="hover:bg-[#111622] transition-colors">
                  <td class="p-2 text-[#E2E8F0]">{tx.filing_date}</td>
                  <td class="p-2 font-semibold text-[#00D2FF]">{tx.insider_name}</td>
                  <td class="p-2 text-[#64748B]">{tx.relationship}</td>
                  <td class="p-2 text-center">
                    <span
                      class="px-1.5 py-0.2 rounded font-bold {tx.transaction_code === 'P'
                        ? 'bg-[#00E676]/20 text-[#00E676]'
                        : 'bg-[#FF3366]/20 text-[#FF3366]'}"
                    >
                      {tx.transaction_code === 'P' ? 'BUY (P)' : 'SELL (S)'}
                    </span>
                  </td>
                  <td class="p-2 text-right text-[#E2E8F0]">{tx.shares.toLocaleString()}</td>
                  <td class="p-2 text-right text-[#E2E8F0]">${tx.price.toFixed(2)}</td>
                  <td class="p-2 text-right font-bold {tx.transaction_code === 'P' ? 'text-[#00E676]' : 'text-[#FF3366]'}">
                    ${(tx.value / 1000000).toFixed(2)}M
                  </td>
                  <td class="p-2 text-center">
                    {#if tx.is_10b5_1}
                      <span class="px-1.5 py-0.5 rounded bg-[#FF9E00]/20 text-[#FF9E00] text-3xs font-semibold">
                        10b5-1 SCHEDULED
                      </span>
                    {:else}
                      <span class="px-1.5 py-0.5 rounded bg-[#00E676]/20 text-[#00E676] text-3xs font-semibold">
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
