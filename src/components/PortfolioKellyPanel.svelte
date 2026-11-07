<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ipcService } from "../lib/ipc";
  import type { ColorChannel, QARESignalFrame } from "../lib/types";

  let {
    ticker = "NVDA",
    channel = "AMBER",
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

  let signal = $state<QARESignalFrame>(ipcService.getSignal("NVDA"));
  let kellyMultiplier = $state<number>(0.5); // Half-Kelly default (institutional standard)
  let unsubscribeIpc: (() => void) | null = null;

  $effect(() => {
    if (ticker) {
      signal = ipcService.getSignal(ticker);
    }
  });

  onMount(() => {
    unsubscribeIpc = ipcService.subscribe((frame) => {
      const sym = ticker.toUpperCase();
      if (frame.signals && frame.signals[sym]) {
        signal = frame.signals[sym];
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeIpc) unsubscribeIpc();
  });

  // Derived Kelly calculations
  let unconstrainedKelly = $derived(signal.execution_recommendation.unconstrained_kelly_pct || 0);
  let l1NormBase = $derived(signal.execution_recommendation.l1_normalized_portfolio_allocation_pct || 0);
  let kappa = $derived(signal.macro_regime.kappa ?? 0.85);
  let isBuyAction = $derived(signal.execution_recommendation.action === "BUY");

  // Scaled portfolio weight: base * (kellyMultiplier / 0.5) * kappa (strictly 0.00% if HOLD/SELL in LONG_ONLY)
  let finalAllocPct = $derived(
    isBuyAction ? +(l1NormBase * (kellyMultiplier / 0.5) * (kappa / 0.85)).toFixed(2) : 0.0
  );

  // Expected growth rate g(f) = p_buy * ln(1 + f * r_win) + p_sell * ln(1 - f * r_loss) - friction
  let expectedGrowthRate = $derived.by(() => {
    const pBuy = signal.calibration.calibrated_probabilities.outperform_buy;
    const pSell = signal.calibration.calibrated_probabilities.underperform_sell;
    const f = Math.max(0.01, finalAllocPct / 100);
    const rWin = 0.07; // 7% win target
    const rLoss = 0.035; // 3.5% loss stop
    const friction = (signal.execution_recommendation.estimated_round_trip_cost_bps || 15) / 10000;

    const termBuy = pBuy * Math.log(Math.max(0.001, 1 + f * rWin));
    const termSell = pSell * Math.log(Math.max(0.001, 1 - f * rLoss));
    const g = (termBuy + termSell - friction) * 252 * 100; // annualized %
    return Math.max(0, g).toFixed(2);
  });

  // Factor breakdown formatted definitions
  const factorLabels: Record<string, { label: string; group: string; min: number; max: number }> = {
    residual_momentum_20d_rank: { label: "Residual Momentum (20D)", group: "Technical / Momentum", min: -1, max: 1 },
    overnight_return_rank: { label: "Overnight Return Rank", group: "Technical / Momentum", min: -1, max: 1 },
    intraday_return_rank: { label: "Intraday Return Rank", group: "Technical / Momentum", min: -1, max: 1 },
    closing_power_rank: { label: "Closing Power Rank", group: "Technical / Momentum", min: -1, max: 1 },
    amihud_illiquidity_rank: { label: "Amihud Illiquidity (Neg)", group: "Market Microstructure", min: -1, max: 1 },
    decayed_finbert_sentiment: { label: "Decayed FinBERT Sentiment", group: "NLP / Alternative Alpha", min: -1, max: 1 },
    decayed_form4_insider_cluster: { label: "Form 4 Insider Cluster", group: "NLP / Alternative Alpha", min: -1, max: 1 },
    decayed_pead_shock: { label: "PEAD Earnings Shock Drift", group: "Fundamental & Filing", min: -1, max: 1 },
    decayed_10q_legal_risk_delta: { label: "10-Q Legal Risk Delta", group: "Fundamental & Filing", min: -1, max: 1 },
    decayed_mda_catalyst_score: { label: "MD&A Catalyst Alpha", group: "Fundamental & Filing", min: -1, max: 1 },
    peer_gat_spillover: { label: "Peer GAT Graph Spillover", group: "Network & Alternative", min: -1, max: 1 },
    smart_money_divergence_pos: { label: "Smart Money Div (+) Pos", group: "Network & Alternative", min: 0, max: 1 },
    smart_money_divergence_neg: { label: "Smart Money Div (-) Neg", group: "Network & Alternative", min: 0, max: 1 },
  };

  function getBarWidth(val: number, min: number, max: number): { width: string; isPositive: boolean } {
    if (min < 0) {
      // Range -1 to 1: center at 50%
      const pct = Math.min(100, Math.abs(val) * 100);
      return { width: `${pct}%`, isPositive: val >= 0 };
    } else {
      // Range 0 to 1
      const pct = Math.min(100, Math.max(0, val * 100));
      return { width: `${pct}%`, isPositive: true };
    }
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
      <span class="font-bold text-[#FFB000]">PORT &lt;GO&gt;</span>
      <span class="text-[#E6EDF5] font-semibold">{ticker} US</span>
    </div>

    <div class="flex items-center gap-2">
      <!-- Kelly Multiplier Controls -->
      <div class="flex items-center bg-[#06090F] rounded border border-[#172033] p-0.5 text-2xs font-mono">
        <button
          onclick={() => (kellyMultiplier = 0.25)}
          class="px-2 py-0.5 rounded transition-colors {kellyMultiplier === 0.25 ? 'bg-[#151D2E] text-[#FFB000] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          1/4 KELLY
        </button>
        <button
          onclick={() => (kellyMultiplier = 0.5)}
          class="px-2 py-0.5 rounded transition-colors {kellyMultiplier === 0.5 ? 'bg-[#151D2E] text-[#FFB000] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          1/2 KELLY
        </button>
        <button
          onclick={() => (kellyMultiplier = 1.0)}
          class="px-2 py-0.5 rounded transition-colors {kellyMultiplier === 1.0 ? 'bg-[#151D2E] text-[#FFB000] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          FULL KELLY
        </button>
      </div>

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

  <!-- Main Split Layout: Top Kelly Sizer Card, Bottom Factor Breakdown -->
  <div class="flex-1 flex flex-col overflow-y-auto overflow-x-hidden p-2 gap-2 text-xs">
    <!-- Kelly Execution Summary Tile -->
    <div class="grid grid-cols-4 gap-2 p-2 bg-[#06090F] border border-[#172033] rounded">
      <!-- Action & Conviction -->
      <div class="flex flex-col justify-between border-r border-[#172033] pr-2">
        <span class="text-2xs text-[#5E6D82]">EXECUTION ACTION</span>
        <div class="flex items-center gap-2 mt-1">
          <span
            class="px-2 py-0.5 text-xs font-bold rounded {signal.execution_recommendation.action === 'BUY'
              ? 'bg-[#00FF66]/20 text-[#00FF66] border border-[#00FF66]/40'
              : signal.execution_recommendation.action === 'SELL'
                ? 'bg-[#FF3344]/20 text-[#FF3344] border border-[#FF3344]/40'
                : 'bg-[#FFB000]/20 text-[#FFB000] border border-[#FFB000]/40'}"
          >
            {signal.execution_recommendation.action}
          </span>
          <span class="text-2xs font-semibold text-[#00D2FF]">
            {signal.execution_recommendation.conviction_tier}
          </span>
        </div>
        <span class="text-2xs text-[#5E6D82] mt-1 font-mono">
          ENGINE: {signal.winning_engine}
        </span>
      </div>

      <!-- Kelly Weights -->
      <div class="flex flex-col justify-between border-r border-[#172033] pr-2">
        <span class="text-2xs text-[#5E6D82]">ALLOCATION WEIGHT</span>
        <div class="flex items-baseline gap-1 mt-1 font-mono">
          <span class="text-sm font-bold text-[#FFB000]">{finalAllocPct}%</span>
          <span class="text-2xs text-[#5E6D82]">(L1 Norm)</span>
        </div>
        <div class="text-2xs text-[#5E6D82] font-mono">
          Unconstrained: <strong class="text-[#E6EDF5]">{unconstrainedKelly}%</strong>
        </div>
      </div>

      <!-- Calibrated Probabilities -->
      <div class="flex flex-col justify-between border-r border-[#172033] pr-2">
        <span class="text-2xs text-[#5E6D82]">CALIBRATED POSTERIOR (T={signal.calibration.temperature})</span>
        <div class="flex items-center gap-1.5 mt-1 font-mono text-2xs">
          <span class="text-[#00FF66]">P(B): {(signal.calibration.calibrated_probabilities.outperform_buy * 100).toFixed(1)}%</span>
          <span class="text-[#5E6D82]">|</span>
          <span class="text-[#FFB000]">P(H): {(signal.calibration.calibrated_probabilities.neutral_hold * 100).toFixed(1)}%</span>
          <span class="text-[#5E6D82]">|</span>
          <span class="text-[#FF3344]">P(S): {(signal.calibration.calibrated_probabilities.underperform_sell * 100).toFixed(1)}%</span>
        </div>
        <div class="w-full bg-[#121824] h-1.5 rounded-full overflow-hidden flex mt-1">
          <div style="width: {signal.calibration.calibrated_probabilities.outperform_buy * 100}%" class="bg-[#00FF66] h-full"></div>
          <div style="width: {signal.calibration.calibrated_probabilities.neutral_hold * 100}%" class="bg-[#FFB000] h-full"></div>
          <div style="width: {signal.calibration.calibrated_probabilities.underperform_sell * 100}%" class="bg-[#FF3344] h-full"></div>
        </div>
      </div>

      <!-- Growth & Friction -->
      <div class="flex flex-col justify-between">
        <span class="text-2xs text-[#5E6D82]">EXPECTED GROWTH g(f)</span>
        <div class="flex items-baseline gap-1 mt-1 font-mono">
          <span class="text-sm font-bold text-[#00FF66]">+{expectedGrowthRate}%</span>
          <span class="text-2xs text-[#5E6D82]">ann.</span>
        </div>
        <div class="text-2xs text-[#5E6D82] font-mono">
          Friction: <strong class="text-[#E6EDF5]">{signal.execution_recommendation.estimated_round_trip_cost_bps} bps</strong> | &kappa;: <strong class="text-[#00D2FF]">{kappa.toFixed(2)}</strong>
        </div>
      </div>
    </div>

    <!-- Factor Ranks Breakdown Table -->
    <div class="flex-1 flex flex-col bg-[#06090F] border border-[#172033] rounded overflow-hidden">
      <div class="flex items-center justify-between px-3 py-1 bg-[#090D16] text-2xs font-bold text-[#5E6D82] border-b border-[#172033]">
        <span class="w-1/3">ALPHA FACTOR</span>
        <span class="w-1/4">CATEGORY</span>
        <span class="w-1/6 text-right">RAW SCORE</span>
        <span class="w-1/4 pl-4">NORMALIZED RANK / DISPERSION</span>
      </div>

      <div class="flex-1 overflow-y-auto divide-y divide-[#172033]/60">
        {#each Object.entries(signal.signal_breakdown) as [key, val]}
          {@const meta = factorLabels[key] || { label: key, group: "General", min: -1, max: 1 }}
          {@const bar = getBarWidth(val, meta.min, meta.max)}
          <div class="flex items-center justify-between px-3 py-1 text-2xs hover:bg-[#0C111B] transition-colors">
            <span class="w-1/3 font-semibold text-[#E6EDF5] truncate" title={meta.label}>
              {meta.label}
            </span>
            <span class="w-1/4 text-[#5E6D82] truncate">
              {meta.group}
            </span>
            <span class="w-1/6 text-right font-mono {val >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
              {val >= 0 ? "+" : ""}{val.toFixed(2)}
            </span>

            <!-- Horizontal rank meter -->
            <div class="w-1/4 pl-4 flex items-center">
              {#if meta.min < 0}
                <!-- Zero-centered meter -->
                <div class="w-full h-2 bg-[#121824] rounded flex relative">
                  <div class="absolute left-1/2 top-0 bottom-0 w-px bg-[#5E6D82]/50"></div>
                  {#if val >= 0}
                    <div
                      style="left: 50%; width: {Math.min(50, (val / meta.max) * 50)}%"
                      class="absolute top-0 bottom-0 bg-[#00FF66] rounded-r"
                    ></div>
                  {:else}
                    <div
                      style="right: 50%; width: {Math.min(50, (Math.abs(val) / Math.abs(meta.min)) * 50)}%"
                      class="absolute top-0 bottom-0 bg-[#FF3344] rounded-l"
                    ></div>
                  {/if}
                </div>
              {:else}
                <!-- 0 to 1 meter -->
                <div class="w-full h-2 bg-[#121824] rounded overflow-hidden">
                  <div
                    style="width: {bar.width}"
                    class="h-full bg-[#00D2FF]"
                  ></div>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .text-2xs {
    font-size: 0.6875rem; /* 11px */
    line-height: 0.95rem;
  }
</style>
