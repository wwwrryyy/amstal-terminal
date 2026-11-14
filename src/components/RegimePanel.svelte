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

  let regime = $state<MacroRegimeData | null>(ipcService.getMacroRegime());
  let connState = $state<string>(ipcService.connectionState);
  let unsubscribeIpc: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;

  onMount(() => {
    unsubscribeStatus = ipcService.subscribeStatus((st) => {
      connState = st;
      if (st === "CONNECTED") {
        ipcService.fetchMacroRegime().then((r) => {
          if (r) regime = r;
        });
      }
    });

    unsubscribeIpc = ipcService.subscribe((frame) => {
      if (frame.macro_regime) {
        const newReg = frame.macro_regime;
        const curr = regime;
        const histChanged = (newReg.regime_history?.length ?? 0) !== (curr?.regime_history?.length ?? 0);
        if (
          !curr ||
          histChanged ||
          newReg.available !== curr.available ||
          newReg.current_state !== curr.current_state ||
          Math.abs((newReg.filtered_probabilities?.low_volatility ?? 0) - (curr.filtered_probabilities?.low_volatility ?? 0)) >= 0.002
        ) {
          regime = newReg;
        }
      }
    });

    if (connState === "CONNECTED") {
      ipcService.fetchMacroRegime().then((r) => {
        if (r) regime = r;
      });
    }
  });

  onDestroy(() => {
    if (unsubscribeIpc) unsubscribeIpc();
    if (unsubscribeStatus) unsubscribeStatus();
  });

  let hasRegime = $derived(Boolean(regime && regime.available !== false && regime.filtered_probabilities));

  // Probabilities directly from backend Gaussian HMM forward filter
  let pLow = $derived(hasRegime ? (regime?.filtered_probabilities?.low_volatility ?? null) : null);
  let pMed = $derived(hasRegime ? (regime?.filtered_probabilities?.medium_volatility ?? null) : null);
  let pHigh = $derived(hasRegime ? (regime?.filtered_probabilities?.high_volatility ?? null) : null);

  // Active regime index
  let activeIndex = $derived.by(() => {
    if (pLow === null || pMed === null || pHigh === null) return -1;
    if (pHigh >= pLow && pHigh >= pMed) return 2;
    if (pMed >= pLow && pMed >= pHigh) return 1;
    return 0;
  });

  // Confidence margin = max_prob - second_max_prob
  let confidence = $derived.by(() => {
    if (pLow === null || pMed === null || pHigh === null) return null;
    const sorted = [pLow, pMed, pHigh].sort((a, b) => b - a);
    return Math.round((sorted[0] - sorted[1]) * 100);
  });

  const baseKappa = 0.85;

  // Backend dynamic Kappa haircut (kappa = kappa_0 * (1 - 0.80 * P(S_2)) * (1 - 0.20 * P(S_1)))
  let kappa = $derived.by(() => {
    if (!hasRegime || pMed === null || pHigh === null) return null;
    if (typeof regime?.kappa === "number" && Number.isFinite(regime.kappa)) {
      return +regime.kappa.toFixed(2);
    }
    return +(baseKappa * (1.0 - 0.80 * pHigh) * (1.0 - 0.20 * pMed)).toFixed(2);
  });

  let stressPenalty = $derived(kappa !== null ? +(kappa - baseKappa).toFixed(2) : null);

  function solveStationaryVector(A: number[][] | undefined): [number, number, number] | null {
    if (!A || A.length !== 3) return null;
    const rows = A.map((row) => {
      const s = row.reduce((acc, v) => acc + Math.max(0, Number(v) || 0), 0);
      return s > 0 ? row.map((v) => Math.max(0, Number(v) || 0) / s) : [1 / 3, 1 / 3, 1 / 3];
    });
    const a00 = rows[0][0] - 1.0;
    const a10 = rows[1][0];
    const a20 = rows[2][0];
    const a01 = rows[0][1];
    const a11 = rows[1][1] - 1.0;
    const a21 = rows[2][1];

    const c0 = Math.max(0, a10 * a21 - a20 * a11);
    const c1 = Math.max(0, a20 * a01 - a00 * a21);
    const c2 = Math.max(0, a00 * a11 - a10 * a01);
    const sum = c0 + c1 + c2;
    if (sum < 1e-9) return null;
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

  let transitionMatrix = $derived<number[][] | null>(
    hasRegime && Array.isArray(regime?.transition_matrix) && regime!.transition_matrix!.length === 3
      ? regime!.transition_matrix!
      : null
  );

  let stationaryVector = $derived.by<[number, number, number] | null>(() => {
    if (!hasRegime) return null;
    const sd = regime?.stationary_distribution;
    if (Array.isArray(sd) && sd.length === 3) {
      return [sd[0], sd[1], sd[2]];
    }
    return transitionMatrix ? solveStationaryVector(transitionMatrix) : null;
  });

  // Expected Duration (mean dwell time in days): 1 / (1 - A_ii)
  let expectedDwell = $derived.by<[number, number, number] | null>(() => {
    if (!transitionMatrix) return null;
    return [
      +(1.0 / Math.max(0.001, 1.0 - transitionMatrix[0][0])).toFixed(1),
      +(1.0 / Math.max(0.001, 1.0 - transitionMatrix[1][1])).toFixed(1),
      +(1.0 / Math.max(0.001, 1.0 - transitionMatrix[2][2])).toFixed(1),
    ];
  });

  // True Half-Life (days to 50% persistence decay): ln(0.5) / ln(A_ii)
  let trueHalfLives = $derived.by<[number, number, number] | null>(() => {
    if (!transitionMatrix) return null;
    return [
      +(Math.log(0.5) / Math.log(Math.max(1e-6, transitionMatrix[0][0]))).toFixed(1),
      +(Math.log(0.5) / Math.log(Math.max(1e-6, transitionMatrix[1][1]))).toFixed(1),
      +(Math.log(0.5) / Math.log(Math.max(1e-6, transitionMatrix[2][2]))).toFixed(1),
    ];
  });

  // Empirical annualized state volatilities returned directly by the fitted HMM
  let stateVols = $derived<[number | null, number | null, number | null]>(
    hasRegime && Array.isArray(regime?.state_volatilities) && regime!.state_volatilities!.length >= 3
      ? [regime!.state_volatilities![0], regime!.state_volatilities![1], regime!.state_volatilities![2]]
      : [null, null, null]
  );

  // Real forward-filtered 60-period regime trajectory from backend HMM filter_sequence
  let regimeHistory = $derived(
    hasRegime && Array.isArray(regime?.regime_history) ? regime!.regime_history! : []
  );

  let p2SparklinePoints = $derived.by(() => {
    const pts = regimeHistory.map((h) => Number(h.p_high ?? (h.state_index === 2 ? h.confidence : 0)));
    if (pts.length < 2) return { poly: "", area: "" };
    const xStep = 59 / Math.max(1, pts.length - 1);
    const coords = pts.map((val, idx) => {
      const clamped = Math.max(0, Math.min(1, Number.isFinite(val) ? val : 0));
      const x = (idx * xStep).toFixed(2);
      const y = (19 - clamped * 18).toFixed(2);
      return `${x},${y}`;
    });
    return {
      poly: coords.join(" "),
      area: `0,19 ${coords.join(" ")} 59,19`,
    };
  });

  const stateTags = ["CALM / BULL REGIME", "MEAN-REVERTING / CHOP", "STRESS / CRISIS"];
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
          {activeIndex >= 0 && pLow !== null && pMed !== null && pHigh !== null
            ? `${(([pLow, pMed, pHigh][activeIndex] ?? 0) * 100).toFixed(1)}%`
            : "—"}
        </span>
      </div>

      <div class="flex items-center gap-1.5 text-2xs" title="Separation margin over second-highest regime candidate (P_0 - P_1)">
        <span class="text-[#5E6D82]">FIT MARGIN:</span>
        <span class="px-1.5 py-0.5 rounded bg-[#06090F] border border-[#00D2FF]/40 text-[#00D2FF] font-mono font-bold">
          {confidence !== null ? `${confidence}%` : "—"}
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
    {#if !hasRegime}
      <div class="p-3 bg-[#06090F] border border-[#FFB000]/40 rounded font-mono text-2xs text-[#8B98A5]">
        <div class="text-[#FFB000] font-bold">
          {connState === "CONNECTED" ? "MACRO HMM MODEL UNAVAILABLE / AWAITING SPY HISTORICAL FIT" : "ENGINE DAEMON OFFLINE — NO SIMULATED MACRO REGIME"}
        </div>
        <div class="text-3xs text-[#5E6D82] mt-1">
          Start the QARE-MM Python daemon with SPY historical lakehouse bars to view real Gaussian HMM state posteriors, transition matrix A_ij, and 60d forward-filtered trajectory.
        </div>
      </div>
    {:else}
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
          <span class="text-base font-mono font-bold text-[#00FF66]">{pLow !== null ? `${(pLow * 100).toFixed(1)}%` : "—"}</span>
          <span class="text-2xs text-[#5E6D82]">&sigma; {stateVols[0] !== null ? `${(stateVols[0] * 100).toFixed(1)}%` : "—"}</span>
        </div>
        <div class="w-full bg-[#121824] h-1.5 rounded mt-1.5 overflow-hidden">
          <div style="width: {(pLow ?? 0) * 100}%" class="h-full bg-[#00FF66]"></div>
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
          <span class="text-base font-mono font-bold text-[#FFB000]">{pMed !== null ? `${(pMed * 100).toFixed(1)}%` : "—"}</span>
          <span class="text-2xs text-[#5E6D82]">&sigma; {stateVols[1] !== null ? `${(stateVols[1] * 100).toFixed(1)}%` : "—"}</span>
        </div>
        <div class="w-full bg-[#121824] h-1.5 rounded mt-1.5 overflow-hidden">
          <div style="width: {(pMed ?? 0) * 100}%" class="h-full bg-[#FFB000]"></div>
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
          <span class="text-base font-mono font-bold text-[#FF3344]">{pHigh !== null ? `${(pHigh * 100).toFixed(1)}%` : "—"}</span>
          <span class="text-2xs text-[#5E6D82]">&sigma; {stateVols[2] !== null ? `${(stateVols[2] * 100).toFixed(1)}%` : "—"}</span>
        </div>
        <div class="w-full bg-[#121824] h-1.5 rounded mt-1.5 overflow-hidden">
          <div style="width: {(pHigh ?? 0) * 100}%" class="h-full bg-[#FF3344]"></div>
        </div>
      </div>
    </div>

    <!-- Real Backend Forward-Filtered Historical Regime Ribbon -->
    <div class="flex flex-col p-2 bg-[#06090F] border border-[#172033] rounded shrink-0">
      <div class="flex items-center justify-between text-2xs mb-1">
        <span class="text-[#5E6D82] font-bold">FORWARD-FILTERED HISTORICAL TRAJECTORY ({regimeHistory.length}D REALIZED)</span>
        <span class="text-3xs text-[#5E6D82]">SPY GAUSSIAN HMM POSTERIOR STATES</span>
      </div>
      {#if regimeHistory.length > 0}
        <div class="flex items-center gap-0.5 h-3.5 w-full">
          {#each regimeHistory as entry}
            <div
              title={`${entry.timestamp}: ${entry.state_index === 0 ? "Low Vol" : entry.state_index === 1 ? "Med Vol" : "Crash Vol"} (Conf: ${(entry.confidence * 100).toFixed(1)}%)`}
              class="flex-1 h-full rounded-2xs transition-colors {entry.state_index === 0 ? 'bg-[#00FF66]/70 hover:bg-[#00FF66]' : entry.state_index === 1 ? 'bg-[#FFB000]/70 hover:bg-[#FFB000]' : 'bg-[#FF3344]/80 hover:bg-[#FF3344]'}"
            ></div>
          {/each}
        </div>
      {:else}
        <div class="text-3xs text-[#5E6D82] font-mono py-1">No regime history points emitted by daemon.</div>
      {/if}
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
          {#if transitionMatrix}
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
          {:else}
            <div class="text-3xs text-[#5E6D82] font-mono p-2">Transition matrix unavailable.</div>
          {/if}

          <!-- Stationary Distribution & Persistence Diagnostics -->
          <div class="pt-2 border-t border-[#172033]/80 flex flex-col gap-1 text-3xs font-mono">
            <div class="flex items-center justify-between text-[#5E6D82]">
              <span>STATIONARY VECTOR &pi;:</span>
              <span class="text-[#E6EDF5] font-bold">
                {stationaryVector
                  ? `[${(stationaryVector[0] * 100).toFixed(1)}% | ${(stationaryVector[1] * 100).toFixed(1)}% | ${(stationaryVector[2] * 100).toFixed(1)}%]`
                  : "—"}
              </span>
            </div>
            <div class="flex items-center justify-between text-[#5E6D82]">
              <span title="Expected dwell duration E[d] = 1 / (1 - A_ii)">EXPECTED DWELL E[d]:</span>
              <span class="text-[#00D2FF]">
                {expectedDwell ? `S_0: ${expectedDwell[0]}d | S_1: ${expectedDwell[1]}d | S_2: ${expectedDwell[2]}d` : "—"}
              </span>
            </div>
            <div class="flex items-center justify-between text-[#5E6D82]">
              <span title="True half-life t_1/2 = ln(0.5) / ln(A_ii)">TRUE HALF-LIFE t_1/2:</span>
              <span class="text-[#8B98A5]">
                {trueHalfLives ? `S_0: ${trueHalfLives[0]}d | S_1: ${trueHalfLives[1]}d | S_2: ${trueHalfLives[2]}d` : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Macro Risk Impact & Multiplier Tile -->
      <div class="flex flex-col bg-[#06090F] border border-[#172033] rounded p-2.5 justify-between overflow-hidden">
        <div>
          <div class="flex items-center justify-between text-2xs font-bold text-[#5E6D82] border-b border-[#172033] pb-1">
            <span>DYNAMIC SIZING MULTIPLIER (&kappa;)</span>
            <span class="text-[#00D2FF] font-mono text-sm font-bold">{kappa !== null ? `${kappa.toFixed(2)}x` : "—"}</span>
          </div>

          <!-- Formula Breakdown -->
          <div class="mt-2 p-1.5 bg-[#090D16] border border-[#172033] rounded text-3xs font-mono text-[#8B98A5] flex flex-col gap-1">
            <div class="text-[#00D2FF] font-semibold">&kappa; = &kappa;_0 &times; (1 - 0.80&middot;P(S_2)) &times; (1 - 0.20&middot;P(S_1))</div>
            <div class="flex justify-between text-[#5E6D82]">
              <span>Base &kappa;_0: <strong class="text-[#E6EDF5]">{baseKappa.toFixed(2)}x</strong></span>
              <span>Stress Penalty: <strong class="text-[#FFB000]">{stressPenalty !== null ? `${stressPenalty}x` : "—"}</strong></span>
              <span>Effective &kappa;: <strong class="text-[#00D2FF] font-bold">{kappa !== null ? `${kappa.toFixed(2)}x` : "—"}</strong></span>
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

          <!-- P(S_2) Tail-Risk Trajectory Sparkline Over [0, 1] Scale -->
          <div class="mt-2 p-1.5 bg-[#090D16] border border-[#172033] rounded flex flex-col gap-1">
            <div class="flex items-center justify-between text-3xs font-mono">
              <span class="text-[#5E6D82] font-semibold">CRISIS PROBABILITY P(S_2) [0-100%]</span>
              <span class="text-[#FF3344] font-bold">{pHigh !== null ? `${(pHigh * 100).toFixed(1)}%` : "—"}</span>
            </div>
            <div class="h-6 w-full relative">
              {#if p2SparklinePoints.poly}
                <svg class="w-full h-full" preserveAspectRatio="none" viewBox="0 0 60 20">
                  <defs>
                    <linearGradient id="p2Grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#FF3344" stop-opacity="0.45" />
                      <stop offset="100%" stop-color="#FF3344" stop-opacity="0.02" />
                    </linearGradient>
                  </defs>
                  <!-- Circuit breaker 0.40 threshold (y = 19 - 0.40 * 18 = 11.8) -->
                  <line x1="0" y1="11.8" x2="60" y2="11.8" stroke="#FF3344" stroke-opacity="0.3" stroke-dasharray="2 2" stroke-width="0.6" />
                  <polygon points={p2SparklinePoints.area} fill="url(#p2Grad)" />
                  <polyline points={p2SparklinePoints.poly} fill="none" stroke="#FF3344" stroke-width="1.2" />
                </svg>
              {:else}
                <div class="text-3xs text-[#5E6D82] font-mono">Insufficient history points</div>
              {/if}
            </div>
          </div>
        </div>

        <div class="border-t border-[#172033] pt-2 mt-2 flex items-center justify-between text-2xs">
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full {(pHigh ?? 0) >= 0.40 ? 'bg-[#FF3344]' : 'bg-[#00FF66]'}"></span>
            <span class="text-[#5E6D82]">CIRCUIT BREAKER:</span>
            <strong class="{(pHigh ?? 0) >= 0.40 ? 'text-[#FF3344]' : 'text-[#00FF66]'} text-3xs font-mono">
              {pHigh !== null ? ((pHigh >= 0.40 ? "ACTIVE (P_2 >= 0.40)" : "INACTIVE (P_2 < 0.40)")) : "—"}
            </strong>
          </div>
          <span class="text-[#00FF66] font-mono font-bold text-3xs">
            {activeIndex >= 0 ? stateTags[activeIndex] : "UNAVAILABLE"}
          </span>
        </div>
      </div>
    </div>
    {/if}
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
