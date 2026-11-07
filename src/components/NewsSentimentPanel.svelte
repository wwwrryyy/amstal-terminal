<script lang="ts">
  import { ipcService } from "../lib/ipc";
  import type { ColorChannel, NewsItemData } from "../lib/types";

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

  let newsItems = $derived<NewsItemData[]>(ipcService.getNewsFeed(ticker));

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

  let avgDecayedScore = $derived.by(() => {
    if (newsItems.length === 0) return 0;
    const total = newsItems.reduce((acc, item) => acc + item.decayed_sentiment, 0);
    return +(total / newsItems.length).toFixed(2);
  });
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
      <span class="font-bold text-[#FF9E00]">NEWS &lt;GO&gt;</span>
      <span class="text-[#E2E8F0] font-semibold">{ticker} US</span>
      <span class="text-[#64748B]">FINBERT HEADLINE STREAM & EXPONENTIAL DECAY (&tau;=3d)</span>
    </div>

    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1.5 text-2xs font-mono">
        <span class="text-[#64748B]">COMPOSITE SENTIMENT:</span>
        <span class="font-bold {avgDecayedScore >= 0 ? 'text-[#00E676]' : 'text-[#FF3366]'}">
          {avgDecayedScore >= 0 ? "+" : ""}{avgDecayedScore}
        </span>
      </div>

      {#if onSwitchFunction}
        <div class="flex items-center gap-1 text-2xs">
          <button onclick={() => onSwitchFunction("GP")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00D2FF] hover:bg-[#1E2638]">GP</button>
          <button onclick={() => onSwitchFunction("PORT")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#FF9E00] hover:bg-[#1E2638]">PORT</button>
          <button onclick={() => onSwitchFunction("EDGAR")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#E2E8F0] hover:bg-[#1E2638]">EDGAR</button>
          <button onclick={() => onSwitchFunction("HP")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00E676] hover:bg-[#1E2638]">HP</button>
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

  <!-- News Stream Container -->
  <div class="flex-1 overflow-y-auto p-2 space-y-2">
    {#each newsItems as item}
      <div class="p-2.5 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col gap-1.5 hover:border-[#1E2638]*2 transition-colors">
        <div class="flex items-center justify-between text-2xs font-mono">
          <div class="flex items-center gap-2">
            <span class="px-1.5 py-0.2 rounded bg-[#182030] text-[#00D2FF] font-semibold">{item.source}</span>
            <span class="text-[#64748B]">{item.published_at.replace("T", " ").replace("Z", " UTC")}</span>
          </div>

          <div class="flex items-center gap-2">
            <span
              class="px-1.5 py-0.2 rounded text-3xs font-bold {item.sentiment_label === 'BULLISH'
                ? 'bg-[#00E676]/20 text-[#00E676]'
                : item.sentiment_label === 'BEARISH'
                  ? 'bg-[#FF3366]/20 text-[#FF3366]'
                  : 'bg-[#64748B]/20 text-[#64748B]'}"
            >
              {item.sentiment_label}
            </span>
            <span class="font-mono text-[#E2E8F0]">RAW: <strong class={item.finbert_score >= 0 ? "text-[#00E676]" : "text-[#FF3366]"}>{item.finbert_score >= 0 ? "+" : ""}{item.finbert_score.toFixed(2)}</strong></span>
            <span class="text-[#64748B]">|</span>
            <span class="font-mono text-[#FF9E00]">DECAYED (&tau;=3d): <strong>{item.decayed_sentiment >= 0 ? "+" : ""}{item.decayed_sentiment.toFixed(2)}</strong></span>
          </div>
        </div>

        <div class="text-xs font-semibold text-[#E2E8F0] leading-snug">
          {item.headline}
        </div>

        <!-- Sentiment Decay Progress Bar -->
        <div class="flex items-center gap-2 text-3xs font-mono text-[#64748B]">
          <span>WEIGHT RETENTION:</span>
          <div class="flex-1 bg-[#182030] h-1 rounded-full overflow-hidden">
            <div
              style="width: {Math.max(5, (Math.abs(item.decayed_sentiment) / (Math.abs(item.finbert_score) + 1e-6)) * 100)}%"
              class="h-full bg-[#FF9E00]"
            ></div>
          </div>
          <span>{( (Math.abs(item.decayed_sentiment) / (Math.abs(item.finbert_score) + 1e-6)) * 100 ).toFixed(0)}%</span>
        </div>
      </div>
    {/each}
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
