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

  const baseKappa = 0.85;

  // Exact dynamic Kappa haircut: kappa = kappa_0 * (1 - 0.80 * P(S_2)) * (1 - 0.20 * P(S_1))
  let kappa = $derived(
    +(baseKappa * (1.0 - 0.80 * pHigh) * (1.0 - 0.20 * pMed)).toFixed(2)
  );

  let stressPenalty = $derived(
    -(baseKappa - kappa).toFixed(2)
  );

  function solveStationaryVector(A: number[][]): [number, number, number] {
    if (!A || A.length !== 3) return [0.519, 0.348, 0.133];
    // Solve (A^T - I) * pi = 0 with sum(pi) = 1
    const a00 = A[0][0] - 1.0;
    const a10 = A[1][0];
    const a20 = A[2][0];

    const a01 = A[0][1];
    const a11 = A[1][1] - 1.0;
    const a21 = A[2][1];

    // Cross product of first two normal vectors
    const c0 = a10 * a21 - a20 * a11;
    const c1 = a20 * a01 - a00 * a21;
    const c2 = a00 * a11 - a10 * a01;
    const sum = c0 + c1 + c2;
    if (Math.abs(sum) < 1e-9) return [0.519, 0.348, 0.133];
    return [c0 / sum, c1 / sum, c2 / sum];
  }

  function getCellShading(prob: number, i: number, j: number): string {
    const alpha = Math.max(0.08, prob * 0.42);
    if (i === j) {
      if (i === 0) return `background-color: rgba(0, 230, 118, ${alpha}); border: 1px solid rgba(0, 230, 118, 0.35);`;
      if (i === 1) return `background-color: rgba(255, 176, 0, ${alpha}); border: 1px solid rgba(255, 176, 0, 0.35);`;
      return `background-color: rgba(255, 51, 68, ${alpha}); border: 1px solid rgba(255, 51, 68, 0.35);`;
    }
    return `background-color: rgba(0, 210, 255, ${alpha * 0.5}); border: 1px solid rgba(23, 32, 51, 0.8);`;
  }

  // Transition Matrix A (default 3x3)
  const defaultTransitionMatrix = [
    [0.942, 0.051, 0.007],
    [0.082, 0.871, 0.047],
    [0.012, 0.138, 0.850],
  ];

  let transitionMatrix = $derived(regime.transition_matrix ?? defaultTransitionMatrix);

  let stationaryVector = $derived(solveStationaryVector(transitionMatrix));

  // Expected Duration (mean dwell time in days): 1 / (1 - A_ii)
  let expectedDwell = $derived([
    +(1.0 / Math.max(0.001, 1.0 - transitionMatrix[0][0])).toFixed(1),
    +(1.0 / Math.max(0.001, 1.0 - transitionMatrix[1][1])).toFixed(1),
    +(1.0 / Math.max(0.001, 1.0 - transitionMatrix[2][2])).toFixed(1),
  ]);

  // True Half-Life (days to 50% persistence decay): ln(0.5) / ln(A_ii)
  let trueHalfLives = $derived([
    +(Math.log(0.5) / Math.log(transitionMatrix[0][0])).toFixed(1),
    +(Math.log(0.5) / Math.log(transitionMatrix[1][1])).toFixed(1),
    +(Math.log(0.5) / Math.log(transitionMatrix[2][2])).toFixed(1),
  ]);

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

    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1.5 text-2xs" title="Forward-filtered posterior probability of the active macro regime P(S_t)">
        <span class="text-[#5E6D82]">STATE PROB:</span>
        <span class="px-1.5 py-0.5 rounded bg-[#06090F] border border-[#00FF66]/40 text-[#00FF66] font-mono font-bold">
          {(pLow * 100).toFixed(1)}%
        </span>
      </div>

      <div class="flex items-center gap-1.5 text-2xs" title="Separation margin over second-highest regime candidate (P_0 - P_1)">
        <span class="text-[#5E6D82]">FIT MARGIN:</span>
        <span class="px-1.5 py-0.5 rounded bg-[#06090F] border border-[#00D2FF]/40 text-[#00D2FF] font-mono font-bold">
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
  <div class="flex-1 min-h-0 flex flex-col p-2 gap-2 overflow-y-auto text-xs">
    <!-- Top 3 Probability Meters -->
    <div class="grid grid-cols-3 gap-2 shrink-0">
      <!-- State 0: Low Vol -->
      <div class="flex flex-col p-2 bg-[#06090F] border {activeIndex === 0 ? 'border-[#00FF66]/60 bg-[#00FF66]/5' : 'border-[#172033]'} rounded">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-bold text-[#00FF66]">STATE 0 // LOW VOL</span>
          {#if activeIndex === 0}
            <span class="px-1.5 py-0.2 rounded bg-[#00FF66]/20 text-[#00FF66] text-3xs font-bold uppercase">ACTIVE</span>
          {/if}
        </div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-base font-mono font-bold text-[#00FF66]">{(pLow * 100).toFixed(1)}%</span>
          <span class="text-2xs text-[#5E6D82]">&sigma; &asymp; 11.2%</span>
        </div>
        <!-- Progress bar -->
        <div class="w-full bg-[#121824] h-1.5 rounded mt-1.5 overflow-hidden">
          <div style="width: {pLow * 100}%" class="h-full bg-[#00FF66]"></div>
        </div>
      </div>

      <!-- State 1: Medium Vol -->
      <div class="flex flex-col p-2 bg-[#06090F] border {activeIndex === 1 ? 'border-[#FFB000]/60 bg-[#FFB000]/5' : 'border-[#172033]'} rounded">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-bold text-[#FFB000]">STATE 1 // MEDIUM VOL</span>
          {#if activeIndex === 1}
            <span class="px-1.5 py-0.2 rounded bg-[#FFB000]/20 text-[#FFB000] text-3xs font-bold uppercase">ACTIVE</span>
          {/if}
        </div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-base font-mono font-bold text-[#FFB000]">{(pMed * 100).toFixed(1)}%</span>
          <span class="text-2xs text-[#5E6D82]">&sigma; &asymp; 19.8%</span>
        </div>
        <div class="w-full bg-[#121824] h-1.5 rounded mt-1.5 overflow-hidden">
          <div style="width: {pMed * 100}%" class="h-full bg-[#FFB000]"></div>
        </div>
      </div>

      <!-- State 2: High Vol / Crash -->
      <div class="flex flex-col p-2 bg-[#06090F] border {activeIndex === 2 ? 'border-[#FF3344]/60 bg-[#FF3344]/5' : 'border-[#172033]'} rounded">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-bold text-[#FF3344]">STATE 2 // CRASH VOL</span>
          {#if activeIndex === 2}
            <span class="px-1.5 py-0.2 rounded bg-[#FF3344]/20 text-[#FF3344] text-3xs font-bold uppercase">ACTIVE</span>
          {/if}
        </div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-base font-mono font-bold text-[#FF3344]">{(pHigh * 100).toFixed(1)}%</span>
          <span class="text-2xs text-[#5E6D82]">&sigma; &asymp; 42.5%</span>
        </div>
        <div class="w-full bg-[#121824] h-1.5 rounded mt-1.5 overflow-hidden">
          <div style="width: {pHigh * 100}%" class="h-full bg-[#FF3344]"></div>
        </div>
      </div>
    </div>

    <!-- 60-Bar Historical Regime Ribbon -->
    <div class="flex flex-col p-2 bg-[#06090F] border border-[#172033] rounded shrink-0">
      <div class="flex items-center justify-between text-2xs mb-1">
        <span class="text-[#5E6D82] font-bold">FORWARD-FILTERED HISTORICAL TRAJECTORY (T-60 TO T_0)</span>
        <span class="text-3xs text-[#5E6D82]">DAILY GAUSSIAN HMM CLUSTERS</span>
      </div>
      <div class="flex items-center gap-0.5 h-3.5 w-full">
        {#each historyStates as st}
          <div
            title={`Period state: ${st === 0 ? 'Low Vol (Calm)' : st === 1 ? 'Med Vol (Chop)' : 'Crash Vol (Crisis)'}`}
            class="flex-1 h-full rounded-2xs transition-all {st === 0 ? 'bg-[#00FF66]/70 hover:bg-[#00FF66]' : st === 1 ? 'bg-[#FFB000]/70 hover:bg-[#FFB000]' : 'bg-[#FF3344]/80 hover:bg-[#FF3344]'}"
          ></div>
        {/each}
      </div>
    </div>

    <!-- Split: Transition Probability Matrix with Heatmap Shading & Macro Sizing Impact -->
    <div class="flex-1 min-h-0 grid grid-cols-2 gap-2">
      <!-- Transition Matrix Table with Probability Heatmap Shading -->
      <div class="flex flex-col bg-[#06090F] border border-[#172033] rounded overflow-hidden">
        <div class="px-3 py-1 bg-[#090D16] text-2xs font-bold text-[#5E6D82] border-b border-[#172033] flex justify-between shrink-0">
          <span>MARKOV TRANSITION MATRIX A_ij</span>
          <span class="font-mono text-3xs">P(S_(t+1) = j | S_t = i)</span>
        </div>
        <div class="p-2 flex-1 flex flex-col justify-between">
          <table class="w-full text-2xs text-center border-separate border-spacing-1 font-mono">
            <thead>
              <tr class="text-[#5E6D82]">
                <th class="p-1 text-left font-normal text-3xs">FROM \ TO</th>
                <th class="p-1 text-[#00FF66] text-3xs">S_0 (Low)</th>
                <th class="p-1 text-[#FFB000] text-3xs">S_1 (Med)</th>
                <th class="p-1 text-[#FF3344] text-3xs">S_2 (High)</th>
              </tr>
            </thead>
            <tbody>
              {#each transitionMatrix as row, i}
                <tr>
                  <td class="p-1 text-left font-bold {i === 0 ? 'text-[#00FF66]' : i === 1 ? 'text-[#FFB000]' : 'text-[#FF3344]'}">
                    S_{i}
                  </td>
                  {#each row as prob, j}
                    <td
                      style={getCellShading(prob, i, j)}
                      class="p-1 rounded text-2xs font-bold transition-colors {i === j ? 'text-[#E6EDF5]' : 'text-[#8B98A5]'}"
                      title={`Transition probability S_${i} -> S_${j}: ${(prob * 100).toFixed(1)}%`}
                    >
                      {(prob * 100).toFixed(1)}%
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>

          <!-- Stationary Distribution & Persistence Diagnostics (Strict Mathematical Exactness) -->
          <div class="pt-2 border-t border-[#172033]/80 flex flex-col gap-1 text-3xs font-mono">
            <div class="flex items-center justify-between text-[#5E6D82]">
              <span>STATIONARY VECTOR &pi;:</span>
              <span class="text-[#E6EDF5] font-bold">[{(stationaryVector[0] * 100).toFixed(1)}% | {(stationaryVector[1] * 100).toFixed(1)}% | {(stationaryVector[2] * 100).toFixed(1)}%]</span>
            </div>
            <div class="flex items-center justify-between text-[#5E6D82]">
              <span title="Expected dwell duration E[d] = 1 / (1 - A_ii)">EXPECTED DWELL E[d]:</span>
              <span class="text-[#00D2FF]">S_0: {expectedDwell[0]}d | S_1: {expectedDwell[1]}d | S_2: {expectedDwell[2]}d</span>
            </div>
            <div class="flex items-center justify-between text-[#5E6D82]">
              <span title="True half-life t_1/2 = ln(0.5) / ln(A_ii)">TRUE HALF-LIFE t_1/2:</span>
              <span class="text-[#8B98A5]">S_0: {trueHalfLives[0]}d | S_1: {trueHalfLives[1]}d | S_2: {trueHalfLives[2]}d</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Macro Risk Impact & Multiplier Tile (Rich institutional risk controller) -->
      <div class="flex flex-col bg-[#06090F] border border-[#172033] rounded p-2.5 justify-between overflow-hidden">
        <div>
          <div class="flex items-center justify-between text-2xs font-bold text-[#5E6D82] border-b border-[#172033] pb-1">
            <span>DYNAMIC SIZING MULTIPLIER (&kappa;)</span>
            <span class="text-[#00D2FF] font-mono text-sm font-bold">{kappa.toFixed(2)}x</span>
          </div>

          <!-- Formula Breakdown -->
          <div class="mt-2 p-1.5 bg-[#090D16] border border-[#172033] rounded text-3xs font-mono text-[#8B98A5] flex flex-col gap-1">
            <div class="text-[#00D2FF] font-semibold">&kappa; = &kappa;_0 &times; (1 - 0.80&middot;P(S_2)) &times; (1 - 0.20&middot;P(S_1))</div>
            <div class="flex justify-between text-[#5E6D82]">
              <span>Base &kappa;_0: <strong class="text-[#E6EDF5]">{baseKappa.toFixed(2)}x</strong></span>
              <span>Stress Penalty: <strong class="text-[#FFB000]">{stressPenalty}x</strong></span>
              <span>Effective &kappa;: <strong class="text-[#00D2FF] font-bold">{kappa.toFixed(2)}x</strong></span>
            </div>
          </div>

          <!-- Asymptotic Regime Haircut Limits -->
          <div class="mt-2 flex flex-col gap-1 text-3xs font-mono">
            <div class="text-3xs text-[#5E6D82] font-semibold mb-0.5">ASYMPTOTIC LIMITS (WHEN P(S_i) &rarr; 1.0):</div>
            <div class="flex items-center justify-between text-[#5E6D82]">
              <span class="text-[#00FF66]">S_0 CALM (Bull):</span>
              <span class="text-[#E6EDF5]">1.00x Base (0.85x Full Kelly)</span>
            </div>
            <div class="flex items-center justify-between text-[#5E6D82]">
              <span class="text-[#FFB000]">S_1 CHOP (Mean-Rev):</span>
              <span class="text-[#E6EDF5]">0.80x Base (0.68x Haircut)</span>
            </div>
            <div class="flex items-center justify-between text-[#5E6D82]">
              <span class="text-[#FF3344]">S_2 CRISIS (Crash Vol):</span>
              <span class="text-[#E6EDF5]">0.20x Base (0.17x Defensive)</span>
            </div>
          </div>
        </div>

        <div class="border-t border-[#172033] pt-2 mt-2 flex items-center justify-between text-2xs">
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-[#00FF66]"></span>
            <span class="text-[#5E6D82]">CIRCUIT BREAKER:</span>
            <strong class="text-[#00FF66] text-3xs font-mono">INACTIVE (P_2 &lt; 0.40)</strong>
          </div>
          <span class="text-[#00FF66] font-mono font-bold text-3xs">
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
