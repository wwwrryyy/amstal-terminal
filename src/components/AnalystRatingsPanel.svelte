<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ipcService } from "../lib/ipc";
  import type { AnalystRatingsData, ColorChannel } from "../lib/types";

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

  let anr = $state<AnalystRatingsData | null>(ipcService.getAnalystRatings("NVDA"));
  let connState = $state<string>(ipcService.connectionState);
  let isLoading = $state<boolean>(false);
  let unsubscribeStatus: (() => void) | null = null;
  let unsubscribeIpc: (() => void) | null = null;

  $effect(() => {
    const sym = ticker;
    const connected = connState === "CONNECTED";
    if (sym) {
      const cached = ipcService.getAnalystRatings(sym);
      anr = cached;
      if (connected) {
        if (!cached) isLoading = true;
        ipcService
          .fetchAnalystRatings(sym)
          .then((fresh) => {
            if (fresh && sym === ticker) anr = fresh;
          })
          .finally(() => {
            if (sym === ticker) isLoading = false;
          });
      } else {
        isLoading = false;
      }
    }
  });

  onMount(() => {
    unsubscribeStatus = ipcService.subscribeStatus((st) => {
      connState = st;
    });
    unsubscribeIpc = ipcService.subscribe(() => {
      const updated = ipcService.getAnalystRatings(ticker);
      if (updated) anr = updated;
    });
  });

  onDestroy(() => {
    if (unsubscribeStatus) unsubscribeStatus();
    if (unsubscribeIpc) unsubscribeIpc();
  });

  let rev3mDeltaPct = $derived.by<number | null>(() => {
    const revs = anr?.historical_revisions ?? [];
    if (revs.length < 2) return null;
    const latest = revs[0]?.mean_target;
    const oldest = revs[revs.length - 1]?.mean_target;
    if (latest === null || latest === undefined || oldest === null || oldest === undefined || oldest <= 0) {
      return null;
    }
    return +(((latest - oldest) / oldest) * 100).toFixed(1);
  });

  let latestBuyRatio = $derived(anr?.historical_revisions?.[0]?.buy_pct ?? null);
  let oldestBuyRatio = $derived(
    anr?.historical_revisions && anr.historical_revisions.length > 0
      ? anr.historical_revisions[anr.historical_revisions.length - 1].buy_pct
      : null
  );

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

  function getRatingColor(rating: string): { bg: string; text: string; border: string } {
    switch (rating) {
      case "STRONG_BUY":
        return { bg: "bg-[#00FF66]/20", text: "text-[#00FF66]", border: "border-[#00FF66]/50" };
      case "BUY":
        return { bg: "bg-[#00D2FF]/20", text: "text-[#00D2FF]", border: "border-[#00D2FF]/50" };
      case "HOLD":
        return { bg: "bg-[#FFB000]/20", text: "text-[#FFB000]", border: "border-[#FFB000]/50" };
      case "UNDERPERFORM":
      case "SELL":
        return { bg: "bg-[#FF3344]/20", text: "text-[#FF3344]", border: "border-[#FF3344]/50" };
      default:
        return { bg: "bg-[#64748B]/20", text: "text-[#64748B]", border: "border-[#64748B]/50" };
    }
  }

  // Normalize range across [target_low, target_high, current_price, target_mean, target_median]
  // so current price outside street low/high never clips or collides off-bar.
  let rangeGeometry = $derived.by(() => {
    if (
      !anr ||
      anr.target_low === null ||
      anr.target_high === null ||
      anr.target_mean === null ||
      anr.current_price <= 0
    ) {
      return null;
    }
    const vals = [anr.target_low, anr.target_high, anr.current_price, anr.target_mean];
    if (anr.target_median !== null) vals.push(anr.target_median);
    const visMin = Math.min(...vals);
    const visMax = Math.max(...vals);
    const span = Math.max(0.01, visMax - visMin);
    const pct = (v: number) => Math.min(97, Math.max(3, ((v - visMin) / span) * 100));
    const currentPosPct = pct(anr.current_price);
    const meanPosPct = pct(anr.target_mean);
    const medianPosPct = anr.target_median !== null ? pct(anr.target_median) : null;
    const fillLeft = Math.min(currentPosPct, meanPosPct);
    const fillWidth = Math.abs(meanPosPct - currentPosPct);
    const isUpside = anr.target_mean >= anr.current_price;
    return { currentPosPct, meanPosPct, medianPosPct, fillLeft, fillWidth, isUpside };
  });

  // Breakdown percentages
  let totalBreakdown = $derived(
    anr
      ? Math.max(
          1,
          anr.ratings_breakdown.strong_buy +
            anr.ratings_breakdown.buy +
            anr.ratings_breakdown.hold +
            anr.ratings_breakdown.underperform +
            anr.ratings_breakdown.sell
        )
      : 1
  );
  let strongBuyPct = $derived(anr ? (anr.ratings_breakdown.strong_buy / totalBreakdown) * 100 : 0);
  let buyPct = $derived(anr ? (anr.ratings_breakdown.buy / totalBreakdown) * 100 : 0);
  let holdPct = $derived(anr ? (anr.ratings_breakdown.hold / totalBreakdown) * 100 : 0);
  let underperformPct = $derived(anr ? (anr.ratings_breakdown.underperform / totalBreakdown) * 100 : 0);
  let sellPct = $derived(anr ? (anr.ratings_breakdown.sell / totalBreakdown) * 100 : 0);
</script>

<div class="flex flex-col h-full w-full bg-[#0C111B] border border-[#172033] rounded select-none overflow-hidden text-xs font-mono">
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
      <span class="font-bold text-[#FFB000]">ANR &lt;GO&gt;</span>
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

  <!-- Content Container -->
  <div class="flex-1 flex flex-col p-2.5 gap-2.5 overflow-y-auto bg-[#06090F]">
    {#if isLoading && !anr}
      <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <span class="text-xs font-bold text-[#00D2FF]">FETCHING LIVE SELL-SIDE ANALYST CONSENSUS FOR {ticker}…</span>
        <span class="text-2xs text-[#5E6D82] mt-1">Querying Yahoo Finance recommendations &amp; price targets.</span>
      </div>
    {:else if !anr || anr.available === false}
      <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <span class="text-xs font-bold text-[#FFB000]">
          {connState === "CONNECTED" ? `NO ANALYST CONSENSUS COVERAGE FOR ${ticker}` : "ENGINE DAEMON OFFLINE — NO SIMULATED RATINGS"}
        </span>
        <span class="text-2xs text-[#5E6D82] mt-1 max-w-md">
          {anr?.message || (connState === "CONNECTED" ? "Ticker may be an ETF, index, or outside coverage universe." : "Connect live QARE-MM Python daemon on ws://127.0.0.1:8194 for authentic Wall Street consensus targets.")}
        </span>
      </div>
    {:else}
    <!-- Top KPI Grid -->
    <div class="grid grid-cols-4 gap-2">
      <!-- Consensus Rating Badge -->
      <div class="p-2.5 bg-[#0C111B] border border-[#172033] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#5E6D82]">CONSENSUS RATING</span>
        <div class="mt-1 flex items-center gap-2">
          <span class="px-2 py-0.5 text-xs font-bold rounded border {getRatingColor(anr.consensus_rating).bg} {getRatingColor(anr.consensus_rating).text} {getRatingColor(anr.consensus_rating).border}">
            {anr.consensus_rating.replace("_", " ")}
          </span>
          <span class="text-2xs text-[#8B98A5]">{anr.total_analysts} ANALYSTS</span>
        </div>
        <div class="mt-2 flex items-center gap-1.5">
          <span class="text-2xs font-bold text-[#E2E8F0]">
            {anr.consensus_score !== null ? `${anr.consensus_score.toFixed(2)} / 5.00` : "— / 5.00"}
          </span>
          <div class="flex-1 bg-[#182030] h-1.5 rounded overflow-hidden">
            <div
              style="width: {anr.consensus_score !== null ? (anr.consensus_score / 5.0) * 100 : 0}%"
              class="h-full bg-[#00FF66]"
            ></div>
          </div>
        </div>
      </div>

      <!-- Current Price vs Mean Target -->
      <div class="p-2.5 bg-[#111622] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">CURRENT PRICE</span>
        <div class="mt-1 flex items-baseline gap-1.5">
          <span class="text-base font-bold text-[#E2E8F0]">
            {anr.current_price > 0 ? `$${anr.current_price.toFixed(2)}` : "$—"}
          </span>
          <span class="text-2xs text-[#64748B]">USD</span>
        </div>
        <div class="text-2xs text-[#94A3B8]">
          LOW: <span class="text-[#FF3344] font-semibold">{anr.target_low !== null ? `$${anr.target_low.toFixed(2)}` : "—"}</span>
          | HIGH: <span class="text-[#00FF66] font-semibold">{anr.target_high !== null ? `$${anr.target_high.toFixed(2)}` : "—"}</span>
        </div>
      </div>

      <!-- Mean Target & Upside -->
      <div class="p-2.5 bg-[#111622] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">12M CONSENSUS TARGET</span>
        <div class="mt-1 flex items-baseline gap-1.5">
          <span class="text-base font-bold text-[#00D2FF]">{anr.target_mean !== null ? `$${anr.target_mean.toFixed(2)}` : "$—"}</span>
          {#if anr.upside_pct !== null}
            <span class="text-2xs {anr.upside_pct >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'} font-bold">
              {anr.upside_pct >= 0 ? "+" : ""}{anr.upside_pct.toFixed(1)}%
            </span>
          {/if}
        </div>
        <div class="text-2xs text-[#94A3B8]">
          MEDIAN: <span class="text-[#E2E8F0] font-semibold">{anr.target_median !== null ? `$${anr.target_median.toFixed(2)}` : "—"}</span>
        </div>
      </div>

      <!-- Revision Sentiment Trend -->
      <div class="p-2.5 bg-[#111622] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">REVISION TREND (HIST)</span>
        <div class="mt-1 flex items-baseline gap-1.5">
          {#if rev3mDeltaPct !== null}
            <span class="text-sm font-bold {rev3mDeltaPct >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
              {rev3mDeltaPct >= 0 ? "+" : ""}{rev3mDeltaPct.toFixed(1)}%
            </span>
            <span class="text-2xs text-[#64748B]">
              {rev3mDeltaPct >= 0 ? "UPWARD DRIFT" : "DOWNWARD DRIFT"}
            </span>
          {:else}
            <span class="text-sm font-bold text-[#8B98A5]">—</span>
            <span class="text-2xs text-[#64748B]">NO PRIOR TARGET SERIES</span>
          {/if}
        </div>
        <div class="text-2xs text-[#94A3B8]">
          BUY RATIO: <span class="text-[#00FF66] font-bold">{latestBuyRatio !== null ? `${latestBuyRatio.toFixed(1)}%` : "—"}</span>
          {#if oldestBuyRatio !== null && latestBuyRatio !== null}
            (from {oldestBuyRatio.toFixed(1)}%)
          {/if}
        </div>
      </div>
    </div>

    <!-- Target Price Visualizer Range Bar -->
    <div class="p-3 bg-[#111622] border border-[#1E2638] rounded flex flex-col gap-2">
      <div class="flex items-center justify-between text-2xs">
        <span class="font-bold text-[#E2E8F0]">12-MONTH TARGET PRICE RANGE DISTRIBUTION</span>
        <span class="text-[#64748B]">
          SPAN: {anr.target_low !== null ? `$${anr.target_low.toFixed(2)}` : "—"} - {anr.target_high !== null ? `$${anr.target_high.toFixed(2)}` : "—"}
        </span>
      </div>

      {#if rangeGeometry}
        <!-- Range Graphic (top track: NOW, bottom track: TARGET so labels never collide) -->
        <div class="relative w-full h-11 bg-[#0A0E17] rounded border border-[#1E2638] flex items-center px-4 my-1">
          <div class="w-full h-2 bg-[#182030] rounded relative">
            <div
              style="left: {rangeGeometry.fillLeft}%; width: {rangeGeometry.fillWidth}%"
              class="absolute top-0 bottom-0 {rangeGeometry.isUpside ? 'bg-[#00FF66]/30 border-y border-[#00FF66]/60' : 'bg-[#FF3344]/30 border-y border-[#FF3344]/60'}"
            ></div>

            {#if rangeGeometry.medianPosPct !== null && anr.target_median !== null}
              <div
                style="left: {rangeGeometry.medianPosPct}%; transform: translateX(-50%);"
                class="absolute -top-1 -bottom-1 w-0.5 bg-[#FFB000] z-10"
                title={`Median Target: $${anr.target_median.toFixed(2)}`}
              ></div>
            {/if}

            <!-- Current Price Marker (Top track label) -->
            <div
              style="left: {rangeGeometry.currentPosPct}%; transform: translateX(-50%);"
              class="absolute -top-3.5 -bottom-2 w-0.5 bg-[#E2E8F0] shadow-[0_0_6px_#FFF] z-20 flex flex-col items-center"
              title={`Current Price: $${anr.current_price.toFixed(2)}`}
            >
              <span class="text-3xs font-bold text-[#E2E8F0] -mt-3.5 bg-[#0A0E17] px-1 rounded border border-[#1E2638] whitespace-nowrap">
                NOW ${anr.current_price.toFixed(2)}
              </span>
            </div>

            <!-- Mean Target Marker (Bottom track label) -->
            <div
              style="left: {rangeGeometry.meanPosPct}%; transform: translateX(-50%);"
              class="absolute -top-2 -bottom-3.5 w-0.5 bg-[#00D2FF] shadow-[0_0_6px_#00D2FF] z-20 flex flex-col items-center justify-end"
              title={`Mean Target: $${anr.target_mean?.toFixed(2)}`}
            >
              <span class="text-3xs font-bold text-[#00D2FF] -mb-3.5 bg-[#0A0E17] px-1 rounded border border-[#1E2638] whitespace-nowrap">
                TARGET ${anr.target_mean?.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      {:else}
        <div class="text-3xs text-[#5E6D82] py-2">Target range distribution unavailable for {ticker}.</div>
      {/if}

      <div class="flex items-center justify-between text-2xs text-[#64748B]">
        <span>STREET LOW: <strong class="text-[#FF3344]">{anr.target_low !== null ? `$${anr.target_low.toFixed(2)}` : "—"}</strong></span>
        <span>CURRENT: <strong class="text-[#E2E8F0]">{anr.current_price > 0 ? `$${anr.current_price.toFixed(2)}` : "—"}</strong></span>
        <span>MEDIAN: <strong class="text-[#FFB000]">{anr.target_median !== null ? `$${anr.target_median.toFixed(2)}` : "—"}</strong></span>
        <span>MEAN TARGET: <strong class="text-[#00D2FF]">{anr.target_mean !== null ? `$${anr.target_mean.toFixed(2)}` : "—"}</strong></span>
        <span>STREET HIGH: <strong class="text-[#00FF66]">{anr.target_high !== null ? `$${anr.target_high.toFixed(2)}` : "—"}</strong></span>
      </div>
    </div>

    <!-- Analyst Ratings Breakdown Stacked Bar -->
    <div class="p-3 bg-[#111622] border border-[#1E2638] rounded flex flex-col gap-2">
      <div class="flex items-center justify-between text-2xs">
        <span class="font-bold text-[#E2E8F0]">ANALYST RECOMMENDATIONS BREAKDOWN ({anr.total_analysts} TOTAL)</span>
        <div class="flex items-center gap-3 text-3xs font-semibold">
          <span class="text-[#00FF66]">■ STRONG BUY ({anr.ratings_breakdown.strong_buy})</span>
          <span class="text-[#00D2FF]">■ BUY ({anr.ratings_breakdown.buy})</span>
          <span class="text-[#FFB000]">■ HOLD ({anr.ratings_breakdown.hold})</span>
          <span class="text-[#FF8800]">■ UNDERPERFORM ({anr.ratings_breakdown.underperform})</span>
          <span class="text-[#FF3344]">■ SELL ({anr.ratings_breakdown.sell})</span>
        </div>
      </div>

      <!-- Multi-Color Segmented Bar -->
      <div class="w-full h-3.5 bg-[#0A0E17] rounded-sm overflow-hidden flex border border-[#1E2638]">
        <div style="width: {strongBuyPct}%" class="bg-[#00FF66] h-full" title="Strong Buy: {anr.ratings_breakdown.strong_buy}"></div>
        <div style="width: {buyPct}%" class="bg-[#00D2FF] h-full" title="Buy: {anr.ratings_breakdown.buy}"></div>
        <div style="width: {holdPct}%" class="bg-[#FFB000] h-full" title="Hold: {anr.ratings_breakdown.hold}"></div>
        <div style="width: {underperformPct}%" class="bg-[#FF8800] h-full" title="Underperform: {anr.ratings_breakdown.underperform}"></div>
        <div style="width: {sellPct}%" class="bg-[#FF3344] h-full" title="Sell: {anr.ratings_breakdown.sell}"></div>
      </div>
    </div>

    <!-- Historical Target & Buy Ratio Revision Trajectory Table -->
    <div class="flex-1 bg-[#111622] border border-[#1E2638] rounded overflow-hidden flex flex-col">
      <div class="px-3 py-1.5 bg-[#182030] border-b border-[#1E2638] flex items-center justify-between text-2xs">
        <span class="font-bold text-[#E2E8F0]">RECOMMENDATION REVISION TRAJECTORY</span>
        <span class="text-[#64748B]">MONTHLY BUY-RATIO TRENDS</span>
      </div>

      <div class="flex-1 overflow-x-auto overflow-y-auto">
        <table class="w-full text-2xs text-left border-collapse">
          <thead>
            <tr class="bg-[#0A0E17] text-[#64748B] border-b border-[#1E2638]">
              <th class="p-2">PERIOD</th>
              <th class="p-2 text-right">MEAN TARGET ($)</th>
              <th class="p-2 text-right">BUY / STRONG BUY (%)</th>
              <th class="p-2 text-right">TARGET DELTA</th>
              <th class="p-2 text-center">STREET SENTIMENT</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#1E2638]/60">
            {#if anr.historical_revisions.length === 0}
              <tr>
                <td colspan="5" class="p-4 text-center text-[#5E6D82]">No historical recommendation revision rows returned.</td>
              </tr>
            {:else}
              {#each anr.historical_revisions as rev, idx}
                {@const prevTarget = anr.historical_revisions[idx + 1]?.mean_target ?? null}
                <tr class="hover:bg-[#182030]/40 transition-colors">
                  <td class="p-2 font-bold text-[#E2E8F0]">{rev.period}</td>
                  <td class="p-2 text-right font-mono text-[#00D2FF] font-bold">
                    {rev.mean_target !== null ? `$${rev.mean_target.toFixed(2)}` : "—"}
                  </td>
                  <td class="p-2 text-right font-mono text-[#00FF66]">{rev.buy_pct.toFixed(1)}%</td>
                  <td class="p-2 text-right font-mono text-[#94A3B8]">
                    {#if rev.mean_target !== null && prevTarget !== null}
                      {@const diff = rev.mean_target - prevTarget}
                      <span class={diff >= 0 ? "text-[#00FF66]" : "text-[#FF3344]"}>
                        {diff >= 0 ? "+" : ""}${diff.toFixed(2)}
                      </span>
                    {:else}
                      <span class="text-[#64748B]">—</span>
                    {/if}
                  </td>
                  <td class="p-2 text-center">
                    <span class="px-2 py-0.5 rounded text-3xs font-bold {rev.buy_pct >= 85 ? 'bg-[#00FF66]/20 text-[#00FF66]' : rev.buy_pct >= 70 ? 'bg-[#00D2FF]/20 text-[#00D2FF]' : 'bg-[#FFB000]/20 text-[#FFB000]'}">
                      {rev.buy_pct >= 85 ? "HIGH CONVICTION" : rev.buy_pct >= 70 ? "BULLISH" : rev.buy_pct >= 50 ? "MODERATE" : "NEUTRAL / BEARISH"}
                    </span>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
    {/if}
  </div>
</div>

<style>
  .text-2xs {
    font-size: 0.6875rem;
    line-height: 0.95rem;
  }
  .text-3xs {
    font-size: 0.5625rem;
    line-height: 0.75rem;
  }
</style>
