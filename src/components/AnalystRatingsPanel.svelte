<script lang="ts">
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

  let anr = $derived<AnalystRatingsData>(ipcService.getAnalystRatings(ticker));

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

  // Calculate target range visual percentages (normalized between target_low and target_high)
  let rangeSpan = $derived(Math.max(1, anr.target_high - anr.target_low));
  let currentPosPct = $derived(
    Math.min(100, Math.max(0, ((anr.current_price - anr.target_low) / rangeSpan) * 100))
  );
  let medianPosPct = $derived(
    Math.min(100, Math.max(0, ((anr.target_median - anr.target_low) / rangeSpan) * 100))
  );
  let meanPosPct = $derived(
    Math.min(100, Math.max(0, ((anr.target_mean - anr.target_low) / rangeSpan) * 100))
  );

  // Breakdown percentages
  let totalBreakdown = $derived(
    Math.max(
      1,
      anr.ratings_breakdown.strong_buy +
        anr.ratings_breakdown.buy +
        anr.ratings_breakdown.hold +
        anr.ratings_breakdown.underperform +
        anr.ratings_breakdown.sell
    )
  );
  let strongBuyPct = $derived((anr.ratings_breakdown.strong_buy / totalBreakdown) * 100);
  let buyPct = $derived((anr.ratings_breakdown.buy / totalBreakdown) * 100);
  let holdPct = $derived((anr.ratings_breakdown.hold / totalBreakdown) * 100);
  let underperformPct = $derived((anr.ratings_breakdown.underperform / totalBreakdown) * 100);
  let sellPct = $derived((anr.ratings_breakdown.sell / totalBreakdown) * 100);
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
        <!-- 5-Star / 5-Point Rating Bar -->
        <div class="mt-2 flex items-center gap-1.5">
          <span class="text-2xs font-bold text-[#E2E8F0]">{anr.consensus_score.toFixed(2)} / 5.00</span>
          <div class="flex-1 bg-[#182030] h-1.5 rounded overflow-hidden">
            <div
              style="width: {(anr.consensus_score / 5.0) * 100}%"
              class="h-full bg-[#00FF66]"
            ></div>
          </div>
        </div>
      </div>

      <!-- Current Price vs Mean Target -->
      <div class="p-2.5 bg-[#111622] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">CURRENT PRICE</span>
        <div class="mt-1 flex items-baseline gap-1.5">
          <span class="text-base font-bold text-[#E2E8F0]">${anr.current_price.toFixed(2)}</span>
          <span class="text-2xs text-[#64748B]">USD</span>
        </div>
        <div class="text-2xs text-[#94A3B8]">
          LOW: <span class="text-[#FF3344] font-semibold">${anr.target_low.toFixed(2)}</span>
          | HIGH: <span class="text-[#00FF66] font-semibold">${anr.target_high.toFixed(2)}</span>
        </div>
      </div>

      <!-- Mean Target & Upside -->
      <div class="p-2.5 bg-[#111622] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">12M CONSENSUS TARGET</span>
        <div class="mt-1 flex items-baseline gap-1.5">
          <span class="text-base font-bold text-[#00D2FF]">${anr.target_mean.toFixed(2)}</span>
          <span class="text-2xs {anr.upside_pct >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'} font-bold">
            {anr.upside_pct >= 0 ? "+" : ""}{anr.upside_pct.toFixed(1)}%
          </span>
        </div>
        <div class="text-2xs text-[#94A3B8]">
          MEDIAN: <span class="text-[#E2E8F0] font-semibold">${anr.target_median.toFixed(2)}</span>
        </div>
      </div>

      <!-- Revision Sentiment Trend -->
      <div class="p-2.5 bg-[#111622] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">REVISION TREND (3M)</span>
        <div class="mt-1 flex items-baseline gap-1.5">
          <span class="text-sm font-bold text-[#00FF66]">
            +{((anr.target_mean - anr.historical_revisions[3].mean_target) / anr.historical_revisions[3].mean_target * 100).toFixed(1)}%
          </span>
          <span class="text-2xs text-[#64748B]">UPWARD DRIFT</span>
        </div>
        <div class="text-2xs text-[#94A3B8]">
          BUY RATIO: <span class="text-[#00FF66] font-bold">{anr.historical_revisions[0].buy_pct}%</span> (from {anr.historical_revisions[3].buy_pct}%)
        </div>
      </div>
    </div>

    <!-- Target Price Visualizer Range Bar -->
    <div class="p-3 bg-[#111622] border border-[#1E2638] rounded flex flex-col gap-2">
      <div class="flex items-center justify-between text-2xs">
        <span class="font-bold text-[#E2E8F0]">12-MONTH TARGET PRICE RANGE DISTRIBUTION</span>
        <span class="text-[#64748B]">SPAN: ${anr.target_low.toFixed(2)} - ${anr.target_high.toFixed(2)}</span>
      </div>

      <!-- Range Graphic -->
      <div class="relative w-full h-8 bg-[#0A0E17] rounded border border-[#1E2638] flex items-center px-4 my-2">
        <!-- Target Range Bar (between Low and High) -->
        <div class="w-full h-2 bg-[#182030] rounded relative">
          <!-- Upside Fill from current to mean -->
          {#if anr.target_mean >= anr.current_price}
            <div
              style="left: {currentPosPct}%; width: {Math.max(0, meanPosPct - currentPosPct)}%"
              class="absolute top-0 bottom-0 bg-[#00FF66]/30 border-y border-[#00FF66]/60"
            ></div>
          {/if}

          <!-- Current Price Marker -->
          <div
            style="left: {currentPosPct}%"
            class="absolute -top-3.5 -bottom-3.5 w-1 bg-[#E2E8F0] shadow-[0_0_8px_#FFF] z-20 flex flex-col items-center"
            title="Current Price: ${anr.current_price.toFixed(2)}"
          >
            <span class="text-3xs font-bold text-[#E2E8F0] -mt-3.5 bg-[#0A0E17] px-1 rounded border border-[#1E2638] whitespace-nowrap">
              NOW ${anr.current_price.toFixed(2)}
            </span>
          </div>

          <!-- Median Marker -->
          <div
            style="left: {medianPosPct}%"
            class="absolute -top-2.5 -bottom-2.5 w-0.5 bg-[#FFB000] z-10 flex flex-col items-center"
            title="Median Target: ${anr.target_median.toFixed(2)}"
          >
            <span class="text-3xs font-semibold text-[#FFB000] mt-4 bg-[#0A0E17] px-1 rounded whitespace-nowrap">
              MED ${anr.target_median.toFixed(2)}
            </span>
          </div>

          <!-- Mean Target Marker -->
          <div
            style="left: {meanPosPct}%"
            class="absolute -top-3.5 -bottom-3.5 w-1 bg-[#00D2FF] shadow-[0_0_8px_#00D2FF] z-20 flex flex-col items-center"
            title="Mean Target: ${anr.target_mean.toFixed(2)}"
          >
            <span class="text-3xs font-bold text-[#00D2FF] -mt-3.5 bg-[#0A0E17] px-1 rounded border border-[#1E2638] whitespace-nowrap">
              TARGET ${anr.target_mean.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between text-2xs text-[#64748B]">
        <span>STREET LOW: <strong class="text-[#FF3344]">${anr.target_low.toFixed(2)}</strong></span>
        <span>CURRENT: <strong class="text-[#E2E8F0]">${anr.current_price.toFixed(2)}</strong></span>
        <span>MEAN TARGET: <strong class="text-[#00D2FF]">${anr.target_mean.toFixed(2)}</strong></span>
        <span>STREET HIGH: <strong class="text-[#00FF66]">${anr.target_high.toFixed(2)}</strong></span>
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
        <span class="font-bold text-[#E2E8F0]">HISTORICAL TARGET REVISION TRAJECTORY</span>
        <span class="text-[#64748B]">ROLLING QUARTERLY DRIFT</span>
      </div>

      <div class="flex-1 overflow-x-auto overflow-y-auto">
        <table class="w-full text-2xs text-left border-collapse">
          <thead>
            <tr class="bg-[#0A0E17] text-[#64748B] border-b border-[#1E2638]">
              <th class="p-2">PERIOD</th>
              <th class="p-2 text-right">MEAN TARGET ($)</th>
              <th class="p-2 text-right">BUY / STRONG BUY (%)</th>
              <th class="p-2 text-right">PRICE MOMENTUM DELTA</th>
              <th class="p-2 text-center">STREET SENTIMENT</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#1E2638]/60">
            {#each anr.historical_revisions as rev, idx}
              <tr class="hover:bg-[#182030]/40 transition-colors">
                <td class="p-2 font-bold text-[#E2E8F0]">{rev.period}</td>
                <td class="p-2 text-right font-mono text-[#00D2FF] font-bold">${rev.mean_target.toFixed(2)}</td>
                <td class="p-2 text-right font-mono text-[#00FF66]">{rev.buy_pct.toFixed(1)}%</td>
                <td class="p-2 text-right font-mono text-[#94A3B8]">
                  {#if idx < anr.historical_revisions.length - 1}
                    {@const diff = rev.mean_target - anr.historical_revisions[idx + 1].mean_target}
                    <span class={diff >= 0 ? "text-[#00FF66]" : "text-[#FF3344]"}>
                      {diff >= 0 ? "+" : ""}${diff.toFixed(2)}
                    </span>
                  {:else}
                    <span class="text-[#64748B]">BASE</span>
                  {/if}
                </td>
                <td class="p-2 text-center">
                  <span class="px-2 py-0.5 rounded text-3xs font-bold {rev.buy_pct >= 85 ? 'bg-[#00FF66]/20 text-[#00FF66]' : rev.buy_pct >= 70 ? 'bg-[#00D2FF]/20 text-[#00D2FF]' : 'bg-[#FFB000]/20 text-[#FFB000]'}">
                    {rev.buy_pct >= 85 ? 'HIGH CONVICTION' : rev.buy_pct >= 70 ? 'BULLISH' : 'NEUTRAL'}
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
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
