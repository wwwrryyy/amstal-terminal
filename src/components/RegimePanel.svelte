<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ipcService } from "../lib/ipc";
  import type { MacroRegimeData } from "../lib/types";

  let {
    isMaximized = false,
    onToggleMaximize,
    onSwitchFunction,
  }: {
    isMaximized?: boolean;
    onToggleMaximize?: () => void;
    onSwitchFunction?: (mnemonic: string) => void;
  } = $props();

  let regime = $state<MacroRegimeData>(ipcService.macroRegime);
  let unsubscribeIpc: (() => void) | null = null;

  onMount(() => {
    unsubscribeIpc = ipcService.subscribe((frame) => {
      if (frame.macro_regime) {
        const newReg = frame.macro_regime;
        if (
          newReg.current_state !== regime.current_state ||
          Math.abs((newReg.filtered_probabilities?.low_volatility ?? 0) - (regime.filtered_probabilities?.low_volatility ?? 0)) >= 0.005
        ) {
          regime = newReg;
        }
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeIpc) unsubscribeIpc();
  });

  // Probabilities
  let pLow = $derived(regime.filtered_probabilities?.low_volatility ?? 0.812);
  let pMed = $derived(regime.filtered_probabilities?.medium_volatility ?? 0.145);
  let pHigh = $derived(regime.filtered_probabilities?.high_volatility ?? 0.043);

  // Active regime index
  let activeIndex = $derived.by(() => {
    if (pHigh >= pLow && pHigh >= pMed) return 2;
    if (pMed >= pLow && pMed >= pHigh) return 1;
    return 0;
  });

  // Confidence margin = max_prob - second_max_prob
  let confidence = $derived.by(() => {
    const sorted = [pLow, pMed, pHigh].sort((a, b) => b - a);
    return Math.round((sorted[0] - sorted[1]) * 100);
  });

  // Dynamic Kappa penalty
  let kappa = $derived(
    regime.kappa ?? +(0.85 * (1 - pHigh * 0.8)).toFixed(2)
  );

  // Transition Matrix A (default 3x3)
  const defaultTransitionMatrix = [
    [0.942, 0.051, 0.007],
    [0.082, 0.871, 0.047],
    [0.012, 0.138, 0.850],
  ];

  let transitionMatrix = $derived(regime.transition_matrix ?? defaultTransitionMatrix);

  // Simulated 60-period regime history ribbon
  const historyStates = [
    0, 0, 0, 0, 0, 1, 1, 0, 0, 0,
    0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
    0, 0, 1, 1, 2, 2, 1, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 1, 1, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];

  const stateDefinitions = [
    {
      index: 0,
      name: "STATE 0: LOW VOLATILITY",
      tag: "CALM / BULL REGIME",
      color: "#00E676",
      annVol: "11.2%",
      desc: "Low realized & implied vol. Full leverage & Kelly deployment permissible.",
    },
    {
      index: 1,
      name: "STATE 1: MEDIUM VOLATILITY",
      tag: "MEAN-REVERTING / CHOP",
      color: "#FF9E00",
      annVol: "19.8%",
      desc: "Regime uncertainty. Mean-reverting orderflow with moderate drift decay.",
    },
    {
      index: 2,
      name: "STATE 2: HIGH VOLATILITY / CRASH",
      tag: "STRESS / CRISIS",
      color: "#FF3366",
      annVol: "42.5%",
      desc: "Extreme tail risk. Volatility clustering, liquidity contraction.",
    },
  ];
</script>

<div class="flex flex-col h-full w-full bg-[#0C111B] border border-[#172033] rounded select-none overflow-hidden">
  <!-- Panel Subheader -->
  <div class="flex items-center justify-between px-3 py-1 bg-[#090D16] border-b border-[#172033] text-xs">
    <div class="flex items-center gap-2">
      <span class="font-bold text-[#00FF66]">HMM &lt;GO&gt;</span>
      <span class="text-[#E6EDF5] font-semibold">MACRO VOLATILITY REGIME</span>
    </div>

    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1.5 text-2xs">
        <span class="text-[#5E6D82]">CONFIDENCE:</span>
        <span class="px-1.5 py-0.5 rounded bg-[#06090F] border border-[#172033] text-[#00D2FF] font-mono font-bold">
          {confidence}%
        </span>
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

  <!-- Content Grid -->
  <div class="flex-1 flex flex-col p-2 gap-2 overflow-y-auto text-xs">
    <!-- Top 3 Probability Meters -->
    <div class="grid grid-cols-3 gap-2">
      <!-- State 0: Low Vol -->
      <div class="flex flex-col p-2.5 bg-[#06090F] border {activeIndex === 0 ? 'border-[#00FF66]/60 bg-[#00FF66]/5' : 'border-[#172033]'} rounded">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-bold text-[#00FF66]">STATE 0 // LOW VOL</span>
          {#if activeIndex === 0}
            <span class="px-1.5 py-0.2 rounded bg-[#00FF66]/20 text-[#00FF66] text-3xs font-bold uppercase">ACTIVE</span>
          {/if}
        </div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-lg font-mono font-bold text-[#00FF66]">{(pLow * 100).toFixed(1)}%</span>
          <span class="text-2xs text-[#5E6D82]">&sigma; &asymp; 11.2%</span>
        </div>
        <!-- Progress bar -->
        <div class="w-full bg-[#121824] h-1.5 rounded mt-2 overflow-hidden">
          <div style="width: {pLow * 100}%" class="h-full bg-[#00FF66]"></div>
        </div>
      </div>

      <!-- State 1: Medium Vol -->
      <div class="flex flex-col p-2.5 bg-[#06090F] border {activeIndex === 1 ? 'border-[#FFB000]/60 bg-[#FFB000]/5' : 'border-[#172033]'} rounded">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-bold text-[#FFB000]">STATE 1 // MEDIUM VOL</span>
          {#if activeIndex === 1}
            <span class="px-1.5 py-0.2 rounded bg-[#FFB000]/20 text-[#FFB000] text-3xs font-bold uppercase">ACTIVE</span>
          {/if}
        </div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-lg font-mono font-bold text-[#FFB000]">{(pMed * 100).toFixed(1)}%</span>
          <span class="text-2xs text-[#5E6D82]">&sigma; &asymp; 19.8%</span>
        </div>
        <div class="w-full bg-[#121824] h-1.5 rounded mt-2 overflow-hidden">
          <div style="width: {pMed * 100}%" class="h-full bg-[#FFB000]"></div>
        </div>
      </div>

      <!-- State 2: High Vol / Crash -->
      <div class="flex flex-col p-2.5 bg-[#06090F] border {activeIndex === 2 ? 'border-[#FF3344]/60 bg-[#FF3344]/5' : 'border-[#172033]'} rounded">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-bold text-[#FF3344]">STATE 2 // CRASH VOL</span>
          {#if activeIndex === 2}
            <span class="px-1.5 py-0.2 rounded bg-[#FF3344]/20 text-[#FF3344] text-3xs font-bold uppercase">ACTIVE</span>
          {/if}
        </div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-lg font-mono font-bold text-[#FF3344]">{(pHigh * 100).toFixed(1)}%</span>
          <span class="text-2xs text-[#5E6D82]">&sigma; &asymp; 42.5%</span>
        </div>
        <div class="w-full bg-[#121824] h-1.5 rounded mt-2 overflow-hidden">
          <div style="width: {pHigh * 100}%" class="h-full bg-[#FF3344]"></div>
        </div>
      </div>
    </div>

    <!-- 60-Bar Historical Regime Ribbon -->
    <div class="flex flex-col p-2 bg-[#06090F] border border-[#172033] rounded">
      <div class="flex items-center justify-between text-2xs mb-1">
        <span class="text-[#5E6D82] font-bold">FORWARD-FILTERED HISTORICAL TRAJECTORY (T-60 TO T_0)</span>
        <span class="text-3xs text-[#5E6D82]">DAILY OBSERVATIONS</span>
      </div>
      <div class="flex items-center gap-0.5 h-4 w-full">
        {#each historyStates as st}
          <div
            title={`Period state: ${st === 0 ? 'Low Vol' : st === 1 ? 'Med Vol' : 'Crash Vol'}`}
            class="flex-1 h-full rounded-2xs transition-all {st === 0 ? 'bg-[#00FF66]/70 hover:bg-[#00FF66]' : st === 1 ? 'bg-[#FFB000]/70 hover:bg-[#FFB000]' : 'bg-[#FF3344]/80 hover:bg-[#FF3344]'}"
          ></div>
        {/each}
      </div>
    </div>

    <!-- Split: Transition Probability Matrix & Macro Sizing Impact -->
    <div class="flex-1 grid grid-cols-2 gap-2">
      <!-- Transition Matrix Table -->
      <div class="flex flex-col bg-[#06090F] border border-[#172033] rounded overflow-hidden">
        <div class="px-3 py-1 bg-[#090D16] text-2xs font-bold text-[#5E6D82] border-b border-[#172033] flex justify-between">
          <span>MARKOV TRANSITION MATRIX A_ij</span>
          <span>P(S_(t+1) = j | S_t = i)</span>
        </div>
        <div class="p-2 flex-1 flex flex-col justify-center">
          <table class="w-full text-2xs text-center border-collapse font-mono">
            <thead>
              <tr class="text-[#5E6D82] border-b border-[#172033]">
                <th class="p-1 text-left font-normal">FROM \ TO</th>
                <th class="p-1 text-[#00FF66]">S_0 (Low)</th>
                <th class="p-1 text-[#FFB000]">S_1 (Med)</th>
                <th class="p-1 text-[#FF3344]">S_2 (High)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#172033]">
              {#each transitionMatrix as row, i}
                <tr>
                  <td class="p-1 text-left font-bold {i === 0 ? 'text-[#00FF66]' : i === 1 ? 'text-[#FFB000]' : 'text-[#FF3344]'}">
                    S_{i}
                  </td>
                  {#each row as prob, j}
                    <td class="p-1 {i === j ? 'font-bold text-[#E6EDF5] bg-[#121824]' : 'text-[#5E6D82]'}">
                      {(prob * 100).toFixed(1)}%
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Macro Risk Impact & Multiplier Tile -->
      <div class="flex flex-col bg-[#06090F] border border-[#172033] rounded p-2.5 justify-between">
        <div>
          <div class="flex items-center justify-between text-2xs font-bold text-[#5E6D82]">
            <span>DYNAMIC SIZING MULTIPLIER (&kappa;)</span>
            <span class="text-[#00D2FF] font-mono text-xs">{kappa.toFixed(2)}x</span>
          </div>
          <p class="text-2xs text-[#8B98A5] mt-1.5 leading-relaxed">
            The forward-filtered HMM scales Kelly leverage by <span class="text-[#00D2FF] font-bold">&kappa;</span>. When State 2 crash probability rises above 0.05, sizing contracts defensively to protect portfolio drawdown.
          </p>
        </div>

        <div class="border-t border-[#172033] pt-2 mt-2 flex items-center justify-between text-2xs">
          <span class="text-[#5E6D82]">STATE CONFIDENCE:</span>
          <span class="text-[#00FF66] font-mono font-bold">
            {stateDefinitions[activeIndex].tag}
          </span>
        </div>
      </div>
    </div>
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
