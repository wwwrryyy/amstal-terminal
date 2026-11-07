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
        const newSig = frame.signals[sym];
        const oldEntry = signal.execution_recommendation.entry_price;
        const newEntry = newSig.execution_recommendation.entry_price;
        if (
          Math.abs(newEntry - oldEntry) >= 0.01 ||
          newSig.execution_recommendation.action !== signal.execution_recommendation.action ||
          newSig.winning_engine !== signal.winning_engine
        ) {
          signal = newSig;
        }
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeIpc) unsubscribeIpc();
  });

  // Derived Kelly calculations
  let unconstrainedKelly = $derived(signal.execution_recommendation.unconstrained_kelly_pct || 0);
  let l1NormBase = $derived(signal.execution_recommendation.l1_normalized_portfolio_allocation_pct || 0);
  // Synchronized with HMM dynamic multiplier formula: 0.85 * (1 - 0.80 * P(S_2)) * (1 - 0.20 * P(S_1))
  let kappa = $derived.by(() => {
    const fp = signal.macro_regime?.filtered_probabilities;
    if (fp) {
      return +(0.85 * (1 - 0.80 * (fp.high_volatility ?? 0.043)) * (1 - 0.20 * (fp.medium_volatility ?? 0.145))).toFixed(2);
    }
    return signal.macro_regime?.kappa ?? 0.80;
  });
  let isBuyAction = $derived(signal.execution_recommendation.action === "BUY");

  // Scaled portfolio weight: base * (kellyMultiplier / 0.5) * kappa (strictly 0.00% if HOLD/SELL in LONG_ONLY)
  let finalAllocPct = $derived(
    isBuyAction ? +(l1NormBase * (kellyMultiplier / 0.5) * (kappa / 0.80)).toFixed(2) : 0.0
  );

  // Clear execution rationale explaining why action is BUY, SELL, or HOLD
  let executionRationale = $derived.by(() => {
    const act = signal.execution_recommendation.action;
    const pBuy = signal.calibration.calibrated_probabilities.outperform_buy;
    const pSell = signal.calibration.calibrated_probabilities.underperform_sell;
    const frictionBps = signal.execution_recommendation.estimated_round_trip_cost_bps || 15;

    if (act === "HOLD") {
      return `HOLD RATIONALE: Edge (+${((pBuy - 0.45) * 100).toFixed(2)}%) below ${frictionBps} bps friction hurdle (Zero-skill prior guard active)`;
    } else if (act === "BUY") {
      return `ALLOCATE RATIONALE: Bull posterior ${(pBuy * 100).toFixed(1)}% exceeds hurdle; Kelly sized with κ=${kappa.toFixed(2)} haircut`;
    } else {
      return `EXIT RATIONALE: Downside posterior ${(pSell * 100).toFixed(1)}% > 35.0% threshold (Capital preservation hedge)`;
    }
  });

  // Expected growth rate g(f) decomposed: Portfolio Growth vs Committed Risk Sleeve Return
  // g_port(f) = (termBuy + termSell - friction) * (252 / horizon)
  let horizonDays = $derived(signal.horizon_days || 10);
  let tradesPerYear = $derived(252 / horizonDays);

  let expectedPortfolioGrowth = $derived.by(() => {
    if (!isBuyAction || finalAllocPct <= 0) return "0.00";
    const sleeveVal = parseFloat(expectedSleeveGrowth);
    const portGrowth = (finalAllocPct / 100) * sleeveVal;
    return Math.max(0, portGrowth).toFixed(2);
  });

  let expectedSleeveGrowth = $derived.by(() => {
    const pBuy = signal.calibration.calibrated_probabilities.outperform_buy;
    const pSell = signal.calibration.calibrated_probabilities.underperform_sell;
    const entry = signal.execution_recommendation.entry_price || 100;
    const tp = signal.execution_recommendation.dynamic_take_profit || entry * 1.07;
    const sl = signal.execution_recommendation.dynamic_stop_loss || entry * 0.965;
    const rWin = Math.max(0.01, (tp - entry) / entry);
    const rLoss = Math.max(0.005, (entry - sl) / entry);
    const friction = (signal.execution_recommendation.estimated_round_trip_cost_bps || 15) / 10000;

    const sleeveBuy = pBuy * Math.log(1 + rWin);
    const sleeveSell = pSell * Math.log(1 - rLoss);
    const g = (sleeveBuy + sleeveSell - friction) * tradesPerYear * 100;
    return Math.max(0, g).toFixed(1);
  });

  // Factor breakdown formatted definitions: all centered on 0 (-1 to 1) for strict diverging symmetry
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
    smart_money_divergence_pos: { label: "Smart Money Div (+) Pos", group: "Network & Alternative", min: -1, max: 1 },
    smart_money_divergence_neg: { label: "Smart Money Div (-) Neg", group: "Network & Alternative", min: -1, max: 1 },
  };
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
  <div class="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden p-2 gap-2 text-xs">
    <!-- Kelly Execution Summary Tile with Rationale Bar -->
    <div class="flex flex-col p-2 bg-[#06090F] border border-[#172033] rounded gap-1.5 shrink-0">
      <div class="grid grid-cols-4 gap-2">
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
            <span class="text-sm font-bold text-[#00FF66]">+{expectedPortfolioGrowth}%</span>
            <span class="text-2xs text-[#5E6D82]">port. ann.</span>
          </div>
          <div class="text-3xs text-[#5E6D82] font-mono truncate" title="Per-sleeve standalone capital drift: +{expectedSleeveGrowth}% ann.">
            Sleeve: <strong class="text-[#00D2FF]">+{expectedSleeveGrowth}%</strong> | Fric: <strong class="text-[#E6EDF5]">{signal.execution_recommendation.estimated_round_trip_cost_bps} bps</strong>
          </div>
        </div>
      </div>

      <!-- Dedicated One-Line Rationale Strip -->
      <div class="pt-1.5 border-t border-[#172033] flex items-center justify-between text-2xs font-mono">
        <div class="flex items-center gap-1.5">
          <span class={signal.execution_recommendation.action === 'BUY' ? 'text-[#00FF66]' : signal.execution_recommendation.action === 'SELL' ? 'text-[#FF3344]' : 'text-[#FFB000]'}>●</span>
          <span class="text-[#E6EDF5] font-semibold">{executionRationale}</span>
        </div>
        <div class="text-[#5E6D82] text-3xs">
          EXECUTION: {signal.execution_mode}
        </div>
      </div>
    </div>

    <!-- Factor Ranks Breakdown Table (Fully unclipped with min-h-0 and smooth scrolling) -->
    <div class="flex-1 min-h-0 flex flex-col bg-[#06090F] border border-[#172033] rounded overflow-hidden relative">
      <div class="flex items-center justify-between px-3 py-1 bg-[#090D16] text-2xs font-bold text-[#5E6D82] border-b border-[#172033] shrink-0">
        <span class="w-1/3">ALPHA FACTOR</span>
        <span class="w-1/4">CATEGORY</span>
        <span class="w-1/6 text-right">RAW SCORE</span>
        <span class="w-1/4 pl-4">NORMALIZED RANK / DISPERSION</span>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto divide-y divide-[#172033]/60 pb-2 custom-scrollbar">
        {#each Object.entries(signal.signal_breakdown) as [key, val]}
          {@const meta = factorLabels[key] || { label: key, group: "General", min: -1, max: 1 }}
          <div class="flex items-center justify-between px-3 py-[3px] text-2xs hover:bg-[#0C111B] transition-colors">
            <span class="w-1/3 font-semibold text-[#E6EDF5] truncate" title={meta.label}>
              {meta.label}
            </span>
            <span class="w-1/4 text-[#5E6D82] truncate">
              {meta.group}
            </span>
            <span class="w-1/6 text-right font-mono {val >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
              {val >= 0 ? "+" : ""}{val.toFixed(2)}
            </span>

            <!-- Zero-centered diverging rank meter (Uniform center anchor) -->
            <div class="w-1/4 pl-4 flex items-center">
              <div class="w-full h-2 bg-[#121824] rounded flex relative">
                <div class="absolute left-1/2 top-0 bottom-0 w-px bg-[#5E6D82]/50"></div>
                {#if val >= 0}
                  <div
                    style="left: 50%; width: {Math.min(50, Math.abs(val) * 50)}%"
                    class="absolute top-0 bottom-0 {key.includes('smart_money') ? 'bg-[#00D2FF]' : 'bg-[#00FF66]'} rounded-r"
                  ></div>
                {:else}
                  <div
                    style="right: 50%; width: {Math.min(50, Math.abs(val) * 50)}%"
                    class="absolute top-0 bottom-0 bg-[#FF3344] rounded-l"
                  ></div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>

      <!-- Polished bottom fade gradient -->
      <div class="pointer-events-none absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-[#06090F] to-transparent"></div>
    </div>
  </div>
</div>

<style>
  .text-2xs {
    font-size: 0.6875rem; /* 11px */
    line-height: 0.95rem;
  }

  .custom-scrollbar::-webkit-scrollbar {
    width: 4px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: #06090F;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #23314B;
    border-radius: 2px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #00D2FF;
  }
</style>
