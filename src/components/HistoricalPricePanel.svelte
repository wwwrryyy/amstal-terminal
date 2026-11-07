<script lang="ts">
  import { ipcService } from "../lib/ipc";
  import type { ColorChannel, HistoricalPriceRow } from "../lib/types";

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

  let priceRows = $derived<HistoricalPriceRow[]>(ipcService.getHistoricalPrices(ticker, 45));

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
      <span class="font-bold text-[#FF9E00]">HP &lt;GO&gt;</span>
      <span class="text-[#E2E8F0] font-semibold">{ticker} US</span>
      <span class="text-[#64748B]">HISTORICAL PRICES & RETURN DECOMPOSITION</span>
    </div>

    <div class="flex items-center gap-2">
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

  <!-- Historical Price Table -->
  <div class="flex-1 overflow-y-auto p-1">
    <table class="w-full text-left border-collapse font-mono text-2xs">
      <thead class="bg-[#182030]/80 text-[#64748B] sticky top-0 border-b border-[#1E2638]">
        <tr>
          <th class="p-2">DATE</th>
          <th class="p-2 text-right">OPEN</th>
          <th class="p-2 text-right">HIGH</th>
          <th class="p-2 text-right">LOW</th>
          <th class="p-2 text-right">CLOSE</th>
          <th class="p-2 text-right">VOLUME</th>
          <th class="p-2 text-right">OVERNIGHT (R<sub>on</sub>)</th>
          <th class="p-2 text-right">INTRADAY (R<sub>id</sub>)</th>
          <th class="p-2 text-right">TOTAL (R<sub>tot</sub>)</th>
          <th class="p-2 text-right">TYPICAL VWAP</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-[#182030]/40">
        {#each priceRows as row}
          <tr class="hover:bg-[#0A0E17] transition-colors">
            <td class="p-2 text-[#E2E8F0]">{row.date}</td>
            <td class="p-2 text-right text-[#E2E8F0]">${row.open.toFixed(2)}</td>
            <td class="p-2 text-right text-[#E2E8F0]">${row.high.toFixed(2)}</td>
            <td class="p-2 text-right text-[#E2E8F0]">${row.low.toFixed(2)}</td>
            <td class="p-2 text-right font-bold text-[#E2E8F0]">${row.close.toFixed(2)}</td>
            <td class="p-2 text-right text-[#64748B]">{(row.volume / 1000000).toFixed(1)}M</td>
            <td class="p-2 text-right font-mono {row.overnight_return >= 0 ? 'text-[#00E676]' : 'text-[#FF3366]'}">
              {row.overnight_return >= 0 ? "+" : ""}{row.overnight_return.toFixed(2)}%
            </td>
            <td class="p-2 text-right font-mono {row.intraday_return >= 0 ? 'text-[#00E676]' : 'text-[#FF3366]'}">
              {row.intraday_return >= 0 ? "+" : ""}{row.intraday_return.toFixed(2)}%
            </td>
            <td class="p-2 text-right font-bold font-mono {row.total_return >= 0 ? 'text-[#00E676]' : 'text-[#FF3366]'}">
              {row.total_return >= 0 ? "+" : ""}{row.total_return.toFixed(2)}%
            </td>
            <td class="p-2 text-right text-[#00D2FF]">
              ${row.vwap ? row.vwap.toFixed(2) : ((row.high + row.low + row.close) / 3).toFixed(2)}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .text-2xs {
    font-size: 0.6875rem; /* 11px */
    line-height: 0.95rem;
  }
</style>
