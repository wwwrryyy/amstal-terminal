<script lang="ts">
  import { onMount, onDestroy } from "svelte";
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

  let priceRows = $state<HistoricalPriceRow[]>(ipcService.getHistoricalPrices("NVDA", 45));
  let connState = $state<string>(ipcService.connectionState);
  let unsubscribeStatus: (() => void) | null = null;
  let unsubscribeIpc: (() => void) | null = null;

  $effect(() => {
    const sym = ticker;
    const connected = connState === "CONNECTED";
    if (sym) {
      priceRows = ipcService.getHistoricalPrices(sym, 45);
      if (connected) {
        ipcService.fetchHistoricalPrices(sym, 45).then((fresh) => {
          if (fresh && fresh.length > 0 && sym === ticker) priceRows = fresh;
        });
      }
    }
  });

  onMount(() => {
    unsubscribeStatus = ipcService.subscribeStatus((st) => {
      connState = st;
    });
    unsubscribeIpc = ipcService.subscribe(() => {
      const sym = ticker;
      const latest = ipcService.getHistoricalPrices(sym, 45);
      if (latest.length > 0 && latest !== priceRows) {
        priceRows = latest;
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeStatus) unsubscribeStatus();
    if (unsubscribeIpc) unsubscribeIpc();
  });

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
      <span class="font-bold text-[#FFB000]">HP &lt;GO&gt;</span>
      <span class="text-[#E6EDF5] font-semibold">{ticker} US</span>
    </div>

    <div class="flex items-center gap-2">
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

  <!-- Historical Price Table -->
  <div class="flex-1 overflow-y-auto p-1 bg-[#06090F]">
    <table class="w-full text-left border-collapse font-mono text-2xs">
      <thead class="bg-[#090D16] text-[#5E6D82] sticky top-0 border-b border-[#172033]">
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
          <th class="p-2 text-right">VWAP</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-[#172033]/40">
        {#if priceRows.length === 0}
          <tr>
            <td colspan="10" class="p-8 text-center text-[#5E6D82]">
              {connState === "CONNECTED"
                ? `NO HISTORICAL SESSIONS RETURNED FOR ${ticker}`
                : "ENGINE DAEMON OFFLINE — NO SIMULATED HISTORICAL BARS"}
            </td>
          </tr>
        {:else}
          {#each priceRows as row}
          <tr class="hover:bg-[#0C111B] transition-colors">
            <td class="p-2 text-[#E6EDF5]">{row.date}</td>
            <td class="p-2 text-right text-[#E6EDF5]">${row.open.toFixed(2)}</td>
            <td class="p-2 text-right text-[#E6EDF5]">${row.high.toFixed(2)}</td>
            <td class="p-2 text-right text-[#E6EDF5]">${row.low.toFixed(2)}</td>
            <td class="p-2 text-right font-bold text-[#E6EDF5]">${row.close.toFixed(2)}</td>
            <td class="p-2 text-right text-[#5E6D82]">{(row.volume / 1000000).toFixed(1)}M</td>
            <td class="p-2 text-right font-mono {row.overnight_return >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
              {row.overnight_return >= 0 ? "+" : ""}{row.overnight_return.toFixed(2)}%
            </td>
            <td class="p-2 text-right font-mono {row.intraday_return >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
              {row.intraday_return >= 0 ? "+" : ""}{row.intraday_return.toFixed(2)}%
            </td>
            <td class="p-2 text-right font-bold font-mono {row.total_return >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
              {row.total_return >= 0 ? "+" : ""}{row.total_return.toFixed(2)}%
            </td>
            <td class="p-2 text-right text-[#00D2FF]">
              ${row.vwap ? row.vwap.toFixed(2) : ((row.high + row.low + row.close) / 3).toFixed(2)}
            </td>
          </tr>
        {/each}
        {/if}
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
