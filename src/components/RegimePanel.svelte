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
        regime = frame.macro_regime;
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

<div class="flex flex-col h-full w-full bg-[#111622] border border-[#1E2638] rounded select-none overflow-hidden">
  <!-- Panel Subheader -->
  <div class="flex items-center justify-between px-3 py-1.5 bg-[#182030] border-b border-[#1E2638] text-xs">
    <div class="flex items-center gap-2">
      <span class="font-bold text-[#00E676]">HMM &lt;GO&gt;</span>
      <span class="text-[#E2E8F0] font-semibold">MACRO VOLATILITY REGIME</span>
      <span class="text-[#64748B]">3-STATE FORWARD-FILTERED GAUSSIAN HMM</span>
    </div>

    <div class="flex items-center gap-2">
      {#if onSwitchFunction}
        <div class="flex items-center gap-1 text-2xs">
          <button onclick={() => onSwitchFunction("GP")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00D2FF] hover:bg-[#1E2638]">GP</button>
          <button onclick={() => onSwitchFunction("PORT")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#FF9E00] hover:bg-[#1E2638]">PORT</button>
          <button onclick={() => onSwitchFunction("FA")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#E2E8F0] hover:bg-[#1E2638]">FA</button>
          <button onclick={() => onSwitchFunction("DES")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00E676] hover:bg-[#1E2638]">DES</button>
          <button onclick={() => onSwitchFunction("SPLC")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00D2FF] hover:bg-[#1E2638]">SPLC</button>
        </div>
      {/if}

      <div class="flex items-center gap-1.5 text-2xs">
        <span class="text-[#64748B]">FILTERED CONFIDENCE:</span>
        <span class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00D2FF] font-mono font-bold">
          {confidence}%
        </span>
      </div>

      {#if onToggleMaximize}
        <button
          onclick={onToggleMaximize}
          class="px-2 py-0.5 text-2xs rounded border border-[#1E2638] bg-[#0A0E17] text-[#94A3B8] hover:text-white"
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
      <div class="flex flex-col p-2.5 bg-[#0A0E17] border {activeIndex === 0 ? 'border-[#00E676]/60 bg-[#00E676]/5' : 'border-[#1E2638]'} rounded">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-bold text-[#00E676]">STATE 0 // LOW VOL</span>
          {#if activeIndex === 0}
            <span class="px-1.5 py-0.2 rounded bg-[#00E676]/20 text-[#00E676] text-3xs font-bold uppercase">ACTIVE</span>
          {/if}
        </div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-lg font-mono font-bold text-[#00E676]">{(pLow * 100).toFixed(1)}%</span>
          <span class="text-2xs text-[#64748B]">&sigma; &asymp; 11.2%</span>
        </div>
        <!-- Progress bar -->
        <div class="w-full bg-[#182030] h-1.5 rounded mt-2 overflow-hidden">
          <div style="width: {pLow * 100}%" class="h-full bg-[#00E676]"></div>
        </div>
      </div>

      <!-- State 1: Medium Vol -->
      <div class="flex flex-col p-2.5 bg-[#0A0E17] border {activeIndex === 1 ? 'border-[#FF9E00]/60 bg-[#FF9E00]/5' : 'border-[#1E2638]'} rounded">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-bold text-[#FF9E00]">STATE 1 // MEDIUM VOL</span>
          {#if activeIndex === 1}
            <span class="px-1.5 py-0.2 rounded bg-[#FF9E00]/20 text-[#FF9E00] text-3xs font-bold uppercase">ACTIVE</span>
          {/if}
        </div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-lg font-mono font-bold text-[#FF9E00]">{(pMed * 100).toFixed(1)}%</span>
          <span class="text-2xs text-[#64748B]">&sigma; &asymp; 19.8%</span>
        </div>
        <div class="w-full bg-[#182030] h-1.5 rounded mt-2 overflow-hidden">
          <div style="width: {pMed * 100}%" class="h-full bg-[#FF9E00]"></div>
        </div>
      </div>

      <!-- State 2: High Vol / Crash -->
      <div class="flex flex-col p-2.5 bg-[#0A0E17] border {activeIndex === 2 ? 'border-[#FF3366]/60 bg-[#FF3366]/5' : 'border-[#1E2638]'} rounded">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-bold text-[#FF3366]">STATE 2 // CRASH VOL</span>
          {#if activeIndex === 2}
            <span class="px-1.5 py-0.2 rounded bg-[#FF3366]/20 text-[#FF3366] text-3xs font-bold uppercase">ACTIVE</span>
          {/if}
        </div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-lg font-mono font-bold text-[#FF3366]">{(pHigh * 100).toFixed(1)}%</span>
          <span class="text-2xs text-[#64748B]">&sigma; &asymp; 42.5%</span>
        </div>
        <div class="w-full bg-[#182030] h-1.5 rounded mt-2 overflow-hidden">
          <div style="width: {pHigh * 100}%" class="h-full bg-[#FF3366]"></div>
        </div>
      </div>
    </div>

    <!-- 60-Bar Historical Regime Ribbon -->
    <div class="flex flex-col p-2 bg-[#0A0E17] border border-[#1E2638] rounded">
      <div class="flex items-center justify-between text-2xs mb-1">
        <span class="text-[#64748B] font-bold">FORWARD-FILTERED HISTORICAL TRAJECTORY (T-60 TO T_0)</span>
        <span class="text-3xs text-[#64748B]">DAILY OBSERVATIONS</span>
      </div>
      <div class="flex items-center gap-0.5 h-4 w-full">
        {#each historyStates as st}
          <div
            title={`Period state: ${st === 0 ? 'Low Vol' : st === 1 ? 'Med Vol' : 'Crash Vol'}`}
            class="flex-1 h-full rounded-2xs transition-all {st === 0 ? 'bg-[#00E676]/70 hover:bg-[#00E676]' : st === 1 ? 'bg-[#FF9E00]/70 hover:bg-[#FF9E00]' : 'bg-[#FF3366]/80 hover:bg-[#FF3366]'}"
          ></div>
        {/each}
      </div>
    </div>

    <!-- Split: Transition Probability Matrix & Macro Sizing Impact -->
    <div class="flex-1 grid grid-cols-2 gap-2">
      <!-- Transition Matrix Table -->
      <div class="flex flex-col bg-[#0A0E17] border border-[#1E2638] rounded overflow-hidden">
        <div class="px-3 py-1 bg-[#182030] text-2xs font-bold text-[#64748B] border-b border-[#1E2638] flex justify-between">
          <span>MARKOV TRANSITION MATRIX A_ij</span>
          <span>P(S_(t+1) = j | S_t = i)</span>
        </div>
        <div class="p-2 flex-1 flex flex-col justify-center">
          <table class="w-full text-2xs text-center border-collapse font-mono">
            <thead>
              <tr class="text-[#64748B] border-b border-[#1E2638]">
                <th class="p-1 text-left font-normal">FROM \ TO</th>
                <th class="p-1 text-[#00E676]">S_0 (Low)</th>
                <th class="p-1 text-[#FF9E00]">S_1 (Med)</th>
                <th class="p-1 text-[#FF3366]">S_2 (High)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#182030]">
              {#each transitionMatrix as row, i}
                <tr>
                  <td class="p-1 text-left font-bold {i === 0 ? 'text-[#00E676]' : i === 1 ? 'text-[#FF9E00]' : 'text-[#FF3366]'}">
                    S_{i}
                  </td>
                  {#each row as prob, j}
                    <td class="p-1 {i === j ? 'font-bold text-[#E2E8F0] bg-[#182030]/60' : 'text-[#64748B]'}">
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
      <div class="flex flex-col bg-[#0A0E17] border border-[#1E2638] rounded p-2.5 justify-between">
        <div>
          <div class="flex items-center justify-between text-2xs font-bold text-[#64748B]">
            <span>DYNAMIC SIZING MULTIPLIER (&kappa;)</span>
            <span class="text-[#00D2FF] font-mono text-xs">{kappa.toFixed(2)}x</span>
          </div>
          <p class="text-2xs text-[#94A3B8] mt-1.5 leading-relaxed">
            The forward-filtered HMM scales Kelly leverage by <span class="text-[#00D2FF] font-bold">&kappa;</span>. When State 2 crash probability rises above 0.05, sizing contracts defensively to protect portfolio drawdown.
          </p>
        </div>

        <div class="border-t border-[#1E2638] pt-2 mt-2 flex items-center justify-between text-2xs">
          <span class="text-[#64748B]">STATE CONFIDENCE:</span>
          <span class="text-[#00E676] font-mono font-bold">
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
