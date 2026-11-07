<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import ChartPanel from "./components/ChartPanel.svelte";
  import PortfolioKellyPanel from "./components/PortfolioKellyPanel.svelte";
  import RegimePanel from "./components/RegimePanel.svelte";
  import FinancialAnalysisPanel from "./components/FinancialAnalysisPanel.svelte";
  import { ipcService, type ConnectionState } from "./lib/ipc";
  import { parse_mnemonic_command } from "./lib/mnemonic";
  import type { MacroRegimeData, QARESignalFrame, TickData } from "./lib/types";

  // Application State
  let omnibarInput = $state("NVDA US <EQUITY> GP <GO>");
  let omnibarRef: HTMLInputElement | null = $state(null);
  let activeTicker = $state("NVDA");
  let activeMarket = $state("US");
  let activeAssetClass = $state("EQUITY");

  // View state: null means 2x2 grid, or "GP" | "PORT" | "HMM" | "FA"
  let maximizedPanel = $state<"GP" | "PORT" | "HMM" | "FA" | null>(null);

  // Command history
  let commandHistory = $state<string[]>([
    "NVDA US <EQUITY> GP <GO>",
    "CRWD PORT <GO>",
    "HMM <GO>",
    "NVDA FA <GO>",
    "GRID <GO>",
  ]);
  let historyIndex = $state<number>(-1);

  // Connection & Telemetry
  let connectionState = $state<ConnectionState>(ipcService.connectionState);
  let latencyMs = $state<number>(ipcService.latencyMs);
  let activeRegime = $state<MacroRegimeData>(ipcService.macroRegime);
  let activeSignal = $state<QARESignalFrame>(ipcService.getSignal("NVDA"));
  let activeTick = $state<TickData>(ipcService.getTick("NVDA"));

  // Modals & Popovers
  let showHelpModal = $state(false);
  let systemTimeUtc = $state("");

  let unsubscribeIpc: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;
  let clockTimer: any = null;

  function updateClock() {
    const now = new Date();
    systemTimeUtc = now.toISOString().replace("T", " ").substring(0, 19) + " UTC";
  }

  onMount(() => {
    updateClock();
    clockTimer = setInterval(updateClock, 1000);

    unsubscribeStatus = ipcService.subscribeStatus((state) => {
      connectionState = state;
    });

    unsubscribeIpc = ipcService.subscribe((frame) => {
      if (frame.macro_regime) {
        activeRegime = frame.macro_regime;
      }
      const sym = activeTicker.toUpperCase();
      if (frame.signals && frame.signals[sym]) {
        activeSignal = frame.signals[sym];
      }
      if (frame.ticks && frame.ticks[sym]) {
        activeTick = frame.ticks[sym];
      }
    });

    window.addEventListener("keydown", handleGlobalKeydown);
  });

  onDestroy(() => {
    if (clockTimer) clearInterval(clockTimer);
    if (unsubscribeStatus) unsubscribeStatus();
    if (unsubscribeIpc) unsubscribeIpc();
    window.removeEventListener("keydown", handleGlobalKeydown);
  });

  $effect(() => {
    if (activeTicker) {
      activeSignal = ipcService.getSignal(activeTicker);
      activeTick = ipcService.getTick(activeTicker);
    }
  });

  function executeCommand(inputString: string) {
    const parsed = parse_mnemonic_command(inputString);
    if (!parsed.is_valid) return;

    // Send to JSON-RPC over IPC
    ipcService.executeJsonRpc("execute_command", {
      raw_input: inputString,
      parsed,
    });

    // Update command history
    if (!commandHistory.includes(inputString)) {
      commandHistory = [inputString, ...commandHistory.slice(0, 20)];
    }
    historyIndex = -1;

    // Apply Ticker / Asset Class / Market
    if (parsed.identifier && !["HMM", "PORT", "GP", "FA", "GRID", "ALL", "HELP", "CLEAR"].includes(parsed.identifier)) {
      activeTicker = parsed.identifier.toUpperCase();
    }
    if (parsed.market) activeMarket = parsed.market.toUpperCase();
    if (parsed.asset_class) activeAssetClass = parsed.asset_class.toUpperCase();

    // Mnemonic Action
    const m = parsed.mnemonic.toUpperCase();
    if (m === "GP") {
      maximizedPanel = "GP";
    } else if (m === "PORT") {
      maximizedPanel = "PORT";
    } else if (m === "HMM") {
      maximizedPanel = "HMM";
    } else if (m === "FA") {
      maximizedPanel = "FA";
    } else if (m === "GRID" || m === "ALL") {
      maximizedPanel = null;
    } else if (m === "HELP") {
      showHelpModal = true;
    } else if (m === "CLEAR") {
      omnibarInput = "";
    }
  }

  function handleFormSubmit(e: SubmitEvent) {
    e.preventDefault();
    executeCommand(omnibarInput);
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    // Focus Omnibar with '/' or Ctrl+K / Cmd+K
    if ((e.key === "/" || (e.key === "k" && (e.ctrlKey || e.metaKey))) && document.activeElement !== omnibarRef) {
      e.preventDefault();
      omnibarRef?.focus();
      omnibarRef?.select();
      return;
    }

    // Function keys (Bloomberg keyboard style)
    if (e.key === "F1") {
      e.preventDefault();
      showHelpModal = !showHelpModal;
    } else if (e.key === "F2") {
      e.preventDefault();
      maximizedPanel = maximizedPanel === "GP" ? null : "GP";
      omnibarInput = `${activeTicker} ${activeMarket} <${activeAssetClass}> GP <GO>`;
    } else if (e.key === "F3") {
      e.preventDefault();
      maximizedPanel = maximizedPanel === "PORT" ? null : "PORT";
      omnibarInput = `${activeTicker} PORT <GO>`;
    } else if (e.key === "F4") {
      e.preventDefault();
      maximizedPanel = maximizedPanel === "HMM" ? null : "HMM";
      omnibarInput = `HMM <GO>`;
    } else if (e.key === "F5") {
      e.preventDefault();
      maximizedPanel = maximizedPanel === "FA" ? null : "FA";
      omnibarInput = `${activeTicker} FA <GO>`;
    } else if (e.key === "F6") {
      e.preventDefault();
      maximizedPanel = null;
      omnibarInput = `GRID <GO>`;
    } else if (e.key === "Escape") {
      if (showHelpModal) {
        showHelpModal = false;
      } else if (maximizedPanel !== null) {
        maximizedPanel = null;
      } else {
        omnibarInput = "";
      }
    }
  }

  function handleInputKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length > 0) {
        historyIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        omnibarInput = commandHistory[historyIndex];
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        omnibarInput = commandHistory[historyIndex];
      } else if (historyIndex === 0) {
        historyIndex = -1;
        omnibarInput = "";
      }
    }
  }

  // Active regime formatting
  let regimeStateColor = $derived.by(() => {
    const s = activeRegime.current_state;
    if (s === "HIGH_VOLATILITY" || s === "CRASH") return "text-[#FF3366] bg-[#FF3366]/20 border-[#FF3366]/50";
    if (s === "MEDIUM_VOLATILITY") return "text-[#FF9E00] bg-[#FF9E00]/20 border-[#FF9E00]/50";
    return "text-[#00E676] bg-[#00E676]/20 border-[#00E676]/50";
  });

  let connectionBadge = $derived.by(() => {
    switch (connectionState) {
      case "CONNECTED":
        return { label: "DAEMON ONLINE (8194)", color: "text-[#00E676]", dot: "bg-[#00E676]" };
      case "SIMULATED_FALLBACK":
        return { label: "SIM STREAM (100ms)", color: "text-[#FF9E00]", dot: "bg-[#FF9E00] animate-pulse" };
      case "CONNECTING":
        return { label: "CONNECTING...", color: "text-[#00D2FF]", dot: "bg-[#00D2FF] animate-ping" };
      default:
        return { label: "DISCONNECTED", color: "text-[#FF3366]", dot: "bg-[#FF3366]" };
    }
  });
</script>

<div class="flex flex-col h-screen w-screen bg-[#0A0E17] text-[#E2E8F0] font-mono select-none overflow-hidden">
  <!-- Top Bloomberg Institutional Header -->
  <header class="flex items-center justify-between px-3 py-1.5 bg-[#111622] border-b border-[#1E2638] text-xs z-30">
    <!-- Brand & Connection Status -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1.5">
        <span class="font-black tracking-wider text-[#FF9E00] text-sm">AMSTAL</span>
        <span class="text-3xs px-1.5 py-0.5 rounded bg-[#182030] text-[#00D2FF] font-bold">WORKSTATION v1.3</span>
      </div>

      <!-- Engine Status Pill -->
      <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#0A0E17] border border-[#1E2638] text-2xs {connectionBadge.color}">
        <span class="w-1.5 h-1.5 rounded-full {connectionBadge.dot}"></span>
        <span class="font-bold">{connectionBadge.label}</span>
        <span class="text-[#64748B] text-3xs font-mono ml-1">[{latencyMs}ms]</span>
      </div>

      <!-- Active Ticker Pill -->
      <div class="flex items-center gap-2 px-2.5 py-0.5 rounded bg-[#182030] border border-[#1E2638] text-2xs">
        <span class="font-bold text-[#E2E8F0]">{activeTicker} {activeMarket}</span>
        <span class="text-[#00D2FF] font-semibold">&lt;{activeAssetClass}&gt;</span>
        <span class="font-bold {activeTick.change >= 0 ? 'text-[#00E676]' : 'text-[#FF3366]'}">
          ${activeTick.price.toFixed(2)}
        </span>
        <span class="text-3xs {activeTick.change >= 0 ? 'text-[#00E676]' : 'text-[#FF3366]'}">
          {activeTick.change >= 0 ? "+" : ""}{activeTick.change.toFixed(2)} ({activeTick.change_pct >= 0 ? "+" : ""}{activeTick.change_pct.toFixed(2)}%)
        </span>
      </div>
    </div>

    <!-- Mnemonic Omnibar Form -->
    <form onsubmit={handleFormSubmit} class="flex-1 max-w-2xl mx-4">
      <div class="relative flex items-center">
        <span class="absolute left-3 text-[#FF9E00] text-xs font-bold select-none">&gt;</span>
        <input
          bind:this={omnibarRef}
          bind:value={omnibarInput}
          onkeydown={handleInputKeydown}
          type="text"
          spellcheck="false"
          autocomplete="off"
          class="w-full pl-8 pr-16 py-1.5 text-xs bg-[#0A0E17] border border-[#1E2638] rounded text-[#FF9E00] font-mono tracking-wide placeholder-[#64748B] focus:outline-none focus:border-[#FF9E00] focus:ring-1 focus:ring-[#FF9E00]/40 transition-all uppercase"
          placeholder="ENTER RPN COMMAND: [TICKER] [MARKET] <EQUITY> [GP|PORT|HMM|FA] <GO>"
        />
        <button
          type="submit"
          class="absolute right-1 px-3 py-1 text-2xs font-extrabold bg-[#FF9E00] text-black rounded hover:bg-[#E08A00] transition-colors cursor-pointer"
        >
          &lt;GO&gt;
        </button>
      </div>
    </form>

    <!-- Regime & System Clock -->
    <div class="flex items-center gap-3 text-2xs">
      <!-- Active Macro Regime Pill -->
      <div class="flex items-center gap-1.5">
        <span class="text-[#64748B]">REGIME:</span>
        <span class="px-2 py-0.5 rounded border text-3xs font-bold font-mono {regimeStateColor}">
          {activeRegime.current_state} ({(activeRegime.filtered_probabilities.low_volatility * 100).toFixed(0)}%)
        </span>
      </div>

      <!-- Live Clock -->
      <div class="text-[#64748B] font-mono text-2xs hidden xl:block">
        {systemTimeUtc}
      </div>

      <!-- Quick Help Trigger -->
      <button
        onclick={() => (showHelpModal = true)}
        class="px-2 py-0.5 rounded bg-[#182030] border border-[#1E2638] text-[#94A3B8] hover:text-[#FF9E00] text-2xs font-bold cursor-pointer"
        title="View Mnemonic Syntax & Help (F1)"
      >
        HELP ?
      </button>
    </div>
  </header>

  <!-- Keyboard Shortcuts Bar -->
  <div class="flex items-center justify-between px-3 py-0.5 bg-[#0A0E17] border-b border-[#1E2638] text-3xs text-[#64748B]">
    <div class="flex items-center gap-4">
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => (showHelpModal = true)}>
        <strong class="text-[#FF9E00]">F1</strong> HELP
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${activeTicker} GP <GO>`)}>
        <strong class="text-[#00D2FF]">F2</strong> GP &lt;PRICE&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${activeTicker} PORT <GO>`)}>
        <strong class="text-[#FF9E00]">F3</strong> PORT &lt;KELLY&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`HMM <GO>`)}>
        <strong class="text-[#00E676]">F4</strong> HMM &lt;REGIME&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${activeTicker} FA <GO>`)}>
        <strong class="text-[#E2E8F0]">F5</strong> FA &lt;XBRL LAKEHOUSE&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => (maximizedPanel = null)}>
        <strong class="text-[#00D2FF]">F6</strong> 2x2 GRID
      </button>
    </div>

    <div>
      <span class="text-[#94A3B8]">RPN PARSER ACTIVE</span> | PRESS <code class="text-[#FF9E00] font-bold">ESC</code> TO RESTORE GRID
    </div>
  </div>

  <!-- Main Workstation View Area -->
  <main class="flex-1 min-h-0 p-1 bg-[#0A0E17]">
    {#if maximizedPanel === "GP"}
      <!-- Maximized Chart Panel -->
      <div class="h-full w-full">
        <ChartPanel
          ticker={activeTicker}
          isMaximized={true}
          onToggleMaximize={() => (maximizedPanel = null)}
        />
      </div>
    {:else if maximizedPanel === "PORT"}
      <!-- Maximized Portfolio Kelly Panel -->
      <div class="h-full w-full">
        <PortfolioKellyPanel
          ticker={activeTicker}
          isMaximized={true}
          onToggleMaximize={() => (maximizedPanel = null)}
        />
      </div>
    {:else if maximizedPanel === "HMM"}
      <!-- Maximized HMM Regime Panel -->
      <div class="h-full w-full">
        <RegimePanel
          isMaximized={true}
          onToggleMaximize={() => (maximizedPanel = null)}
        />
      </div>
    {:else if maximizedPanel === "FA"}
      <!-- Maximized FA Panel -->
      <div class="h-full w-full">
        <FinancialAnalysisPanel
          ticker={activeTicker}
          isMaximized={true}
          onToggleMaximize={() => (maximizedPanel = null)}
        />
      </div>
    {:else}
      <!-- Standard Responsive 2x2 Bloomberg Grid -->
      <div class="h-full w-full grid grid-cols-2 grid-rows-2 gap-1">
        <!-- Top Left: Panel 1 GP -->
        <div class="min-h-0 min-w-0 h-full">
          <ChartPanel
            ticker={activeTicker}
            isMaximized={false}
            onToggleMaximize={() => (maximizedPanel = "GP")}
          />
        </div>

        <!-- Top Right: Panel 2 PORT -->
        <div class="min-h-0 min-w-0 h-full">
          <PortfolioKellyPanel
            ticker={activeTicker}
            isMaximized={false}
            onToggleMaximize={() => (maximizedPanel = "PORT")}
          />
        </div>

        <!-- Bottom Left: Panel 3 HMM -->
        <div class="min-h-0 min-w-0 h-full">
          <RegimePanel
            isMaximized={false}
            onToggleMaximize={() => (maximizedPanel = "HMM")}
          />
        </div>

        <!-- Bottom Right: Panel 4 FA -->
        <div class="min-h-0 min-w-0 h-full">
          <FinancialAnalysisPanel
            ticker={activeTicker}
            isMaximized={false}
            onToggleMaximize={() => (maximizedPanel = "FA")}
          />
        </div>
      </div>
    {/if}
  </main>

  <!-- Help / Keyboard Shortcuts Modal -->
  {#if showHelpModal}
    <div class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div class="bg-[#111622] border border-[#FF9E00]/60 rounded-lg max-w-2xl w-full p-6 text-xs shadow-2xl flex flex-col gap-4">
        <div class="flex items-center justify-between border-b border-[#1E2638] pb-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-[#FF9E00]">AMSTAL MNEMONIC WORKSTATION HELP</span>
            <span class="px-2 py-0.5 rounded bg-[#182030] text-[#00D2FF] text-2xs">RPN SPEC v1.3</span>
          </div>
          <button
            onclick={() => (showHelpModal = false)}
            class="text-[#64748B] hover:text-white font-bold text-sm px-2 cursor-pointer"
          >
            &times;
          </button>
        </div>

        <div class="space-y-3 text-[#94A3B8] leading-relaxed">
          <div>
            <h4 class="font-bold text-[#E2E8F0] mb-1">Bloomberg-Style Command Syntax:</h4>
            <code class="block p-2 bg-[#0A0E17] border border-[#1E2638] text-[#FF9E00] rounded">
              [TICKER] [MARKET] &lt;ASSET CLASS&gt; [MNEMONIC] &lt;GO&gt;
            </code>
          </div>

          <div class="grid grid-cols-2 gap-3 text-2xs">
            <div class="p-2.5 bg-[#0A0E17] rounded border border-[#1E2638]">
              <span class="font-bold text-[#00D2FF] block mb-1">COMMAND EXAMPLES:</span>
              <ul class="space-y-1 font-mono text-[#E2E8F0]">
                <li><code class="text-[#FF9E00]">NVDA US &lt;EQUITY&gt; GP &lt;GO&gt;</code> - Graph Price</li>
                <li><code class="text-[#FF9E00]">CRWD PORT &lt;GO&gt;</code> - Kelly Sizer &amp; Signals</li>
                <li><code class="text-[#FF9E00]">HMM &lt;GO&gt;</code> - 3-State Volatility Regime</li>
                <li><code class="text-[#FF9E00]">AAPL FA &lt;GO&gt;</code> - 10Y XBRL Lakehouse</li>
                <li><code class="text-[#FF9E00]">GRID &lt;GO&gt;</code> or <code class="text-[#FF9E00]">ALL &lt;GO&gt;</code> - Restore 2x2</li>
              </ul>
            </div>

            <div class="p-2.5 bg-[#0A0E17] rounded border border-[#1E2638]">
              <span class="font-bold text-[#00E676] block mb-1">HOTKEY SHORTCUTS:</span>
              <ul class="space-y-1 font-mono text-[#E2E8F0]">
                <li><strong class="text-[#00D2FF]">F1:</strong> Toggle Help Modal</li>
                <li><strong class="text-[#00D2FF]">F2:</strong> Graph Price (GP)</li>
                <li><strong class="text-[#00D2FF]">F3:</strong> Portfolio &amp; Kelly (PORT)</li>
                <li><strong class="text-[#00D2FF]">F4:</strong> Macro Regime (HMM)</li>
                <li><strong class="text-[#00D2FF]">F5:</strong> Financial Lakehouse (FA)</li>
                <li><strong class="text-[#00D2FF]">F6 / ESC:</strong> Restore 2x2 Grid</li>
              </ul>
            </div>
          </div>

          <div class="text-3xs text-[#64748B] border-t border-[#1E2638] pt-2">
            Amstal Terminal automatically connects to WebSocket broadcast on <code class="text-[#00D2FF]">ws://127.0.0.1:8194</code> and communicates via Unix Domain Socket <code class="text-[#00D2FF]">/tmp/amstal.sock</code>. When daemon is offline, high-frequency simulated conflation stream ensures interactive zero-latency operation.
          </div>
        </div>

        <div class="flex justify-end pt-2 border-t border-[#1E2638]">
          <button
            onclick={() => (showHelpModal = false)}
            class="px-4 py-1.5 bg-[#FF9E00] text-black font-bold rounded hover:bg-[#E08A00] transition-colors cursor-pointer"
          >
            DISMISS [ESC]
          </button>
        </div>
      </div>
    </div>
  {/if}
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
