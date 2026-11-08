<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import ChartPanel from "./components/ChartPanel.svelte";
  import PortfolioKellyPanel from "./components/PortfolioKellyPanel.svelte";
  import RegimePanel from "./components/RegimePanel.svelte";
  import FinancialAnalysisPanel from "./components/FinancialAnalysisPanel.svelte";
  import SecurityMasterPanel from "./components/SecurityMasterPanel.svelte";
  import PeerGraphPanel from "./components/PeerGraphPanel.svelte";
  import EdgarRedlinePanel from "./components/EdgarRedlinePanel.svelte";
  import NewsSentimentPanel from "./components/NewsSentimentPanel.svelte";
  import HistoricalPricePanel from "./components/HistoricalPricePanel.svelte";
  import AnalystRatingsPanel from "./components/AnalystRatingsPanel.svelte";
  import CopilotPanel from "./components/CopilotPanel.svelte";
  import { ipcService, type ConnectionState } from "./lib/ipc";
  import { parse_mnemonic_command, STANDALONE_MNEMONICS } from "./lib/mnemonic";
  import type { ColorChannel, MacroRegimeData, QARESignalFrame, TickData } from "./lib/types";

  type FunctionMnemonic = "GP" | "PORT" | "HMM" | "FA" | "DES" | "SPLC" | "EDGAR" | "NEWS" | "HP" | "ANR" | "COPILOT";

  // Reactive Multi-Panel Workstation State
  let omnibarInput = $state("NVDA US <EQUITY> GP <GO>");
  let omnibarRef: HTMLInputElement | null = $state(null);
  let activeTicker = $state("NVDA");
  let activeMarket = $state("US");
  let activeAssetClass = $state("EQUITY");

  // 4 Workstation Slots: Functions & Channel Links
  let slotFunctions = $state<FunctionMnemonic[]>(["GP", "PORT", "HMM", "FA"]);
  let slotChannels = $state<ColorChannel[]>(["BLUE", "BLUE", "AMBER", "GREEN"]);
  let focusedSlot = $state<number>(0);
  let maximizedSlot = $state<number | null>(null);

  // Reactive Color Channel Stores (PRD Section 3.4 & Architecture Section 3.3)
  let channelTickers = $state<Record<ColorChannel, string>>({
    BLUE: "NVDA",
    AMBER: "AAPL",
    GREEN: "MSFT",
    RED: "CRWD",
    UNLINKED: "SPY",
  });

  // Command history
  let commandHistory = $state<string[]>([
    "NVDA US <EQUITY> GP <GO>",
    "CRWD PORT <GO>",
    "HMM <GO>",
    "NVDA FA <GO>",
    "NVDA DES <GO>",
    "NVDA SPLC <GO>",
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
  let marketOpen = $state(ipcService.isMarketSessionOpen());

  let unsubscribeIpc: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;
  let clockTimer: any = null;

  function updateClock() {
    const now = new Date();
    marketOpen = ipcService.isMarketSessionOpen(now);
    systemTimeUtc = now.toISOString().replace("T", " ").substring(0, 19) + " UTC";
  }

  function getSlotTicker(slotIdx: number): string {
    const ch = slotChannels[slotIdx];
    if (ch === "UNLINKED") return activeTicker;
    return channelTickers[ch] || activeTicker;
  }

  function setSlotTicker(slotIdx: number, newTicker: string) {
    const ch = slotChannels[slotIdx];
    const upper = newTicker.toUpperCase();
    if (ch !== "UNLINKED") {
      channelTickers[ch] = upper;
    }
    activeTicker = upper;
  }

  onMount(() => {
    updateClock();
    clockTimer = setInterval(updateClock, 1000);

    // Automatically trigger engine daemon startup if running inside Tauri desktop workstation
    ipcService.startEngine().catch(() => {});

    unsubscribeStatus = ipcService.subscribeStatus((state) => {
      connectionState = state;
    });

    unsubscribeIpc = ipcService.subscribe((frame) => {
      if (frame.macro_regime) {
        const newReg = frame.macro_regime;
        if (
          newReg.current_state !== activeRegime.current_state ||
          Math.abs((newReg.filtered_probabilities?.low_volatility ?? 0) - (activeRegime.filtered_probabilities?.low_volatility ?? 0)) >= 0.005
        ) {
          activeRegime = newReg;
        }
      }
      const sym = activeTicker.toUpperCase();
      if (frame.signals && frame.signals[sym]) {
        const newSig = frame.signals[sym];
        const oldPrice = activeSignal.execution_recommendation.entry_price;
        const newPrice = newSig.execution_recommendation.entry_price;
        if (Math.abs(newPrice - oldPrice) >= 0.01 || newSig.execution_recommendation.action !== activeSignal.execution_recommendation.action) {
          activeSignal = newSig;
        }
      }
      if (frame.ticks && frame.ticks[sym]) {
        const newTick = frame.ticks[sym];
        if (newTick.price !== activeTick.price || newTick.change !== activeTick.change) {
          activeTick = newTick;
        }
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
      commandHistory = [inputString, ...commandHistory.slice(0, 25)];
    }
    historyIndex = -1;

    // Apply Ticker / Asset Class / Market
    if (parsed.identifier && !STANDALONE_MNEMONICS.has(parsed.identifier)) {
      setSlotTicker(focusedSlot, parsed.identifier);
    }
    if (parsed.market) activeMarket = parsed.market.toUpperCase();
    if (parsed.asset_class) activeAssetClass = parsed.asset_class.toUpperCase();

    // Mnemonic Action
    const m = parsed.mnemonic.toUpperCase();
    if (["GP", "PORT", "HMM", "FA", "DES", "SPLC", "EDGAR", "NEWS", "HP", "ANR", "COPILOT"].includes(m)) {
      slotFunctions[focusedSlot] = m as FunctionMnemonic;
    } else if (m === "GRID" || m === "ALL") {
      maximizedSlot = null;
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
      slotFunctions[focusedSlot] = "GP";
      omnibarInput = `${getSlotTicker(focusedSlot)} ${activeMarket} <${activeAssetClass}> GP <GO>`;
    } else if (e.key === "F3") {
      e.preventDefault();
      slotFunctions[focusedSlot] = "PORT";
      omnibarInput = `${getSlotTicker(focusedSlot)} PORT <GO>`;
    } else if (e.key === "F4") {
      e.preventDefault();
      slotFunctions[focusedSlot] = "HMM";
      omnibarInput = `HMM <GO>`;
    } else if (e.key === "F5") {
      e.preventDefault();
      slotFunctions[focusedSlot] = "FA";
      omnibarInput = `${getSlotTicker(focusedSlot)} FA <GO>`;
    } else if (e.key === "F6") {
      e.preventDefault();
      maximizedSlot = null;
      omnibarInput = `GRID <GO>`;
    } else if (e.key === "F7") {
      e.preventDefault();
      slotFunctions[focusedSlot] = "DES";
      omnibarInput = `${getSlotTicker(focusedSlot)} DES <GO>`;
    } else if (e.key === "F8") {
      e.preventDefault();
      slotFunctions[focusedSlot] = "SPLC";
      omnibarInput = `${getSlotTicker(focusedSlot)} SPLC <GO>`;
    } else if (e.key === "F9") {
      e.preventDefault();
      slotFunctions[focusedSlot] = "EDGAR";
      omnibarInput = `${getSlotTicker(focusedSlot)} EDGAR <GO>`;
    } else if (e.key === "F10") {
      e.preventDefault();
      slotFunctions[focusedSlot] = "NEWS";
      omnibarInput = `${getSlotTicker(focusedSlot)} NEWS <GO>`;
    } else if (e.key === "F11") {
      e.preventDefault();
      slotFunctions[focusedSlot] = "HP";
      omnibarInput = `${getSlotTicker(focusedSlot)} HP <GO>`;
    } else if (e.key === "F12") {
      e.preventDefault();
      slotFunctions[focusedSlot] = "COPILOT";
      omnibarInput = `${getSlotTicker(focusedSlot)} COPILOT <GO>`;
    } else if (e.key === "Escape") {
      if (showHelpModal) {
        showHelpModal = false;
      } else if (maximizedSlot !== null) {
        maximizedSlot = null;
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
    if (s === "LOW_VOLATILITY") return "text-[#00E676] bg-[#00E676]/10 border-[#00E676]/40";
    if (s === "MEDIUM_VOLATILITY") return "text-[#FF9E00] bg-[#FF9E00]/10 border-[#FF9E00]/40";
    return "text-[#FF3366] bg-[#FF3366]/10 border-[#FF3366]/40";
  });

  let regimeProbPct = $derived.by(() => {
    const s = activeRegime.current_state;
    const p = activeRegime.filtered_probabilities;
    if (!p) return 80;
    if (s === "LOW_VOLATILITY") return Math.round(p.low_volatility * 100);
    if (s === "MEDIUM_VOLATILITY") return Math.round(p.medium_volatility * 100);
    return Math.round(p.high_volatility * 100);
  });
</script>

<div class="flex flex-col h-screen w-screen bg-[#06090F] text-[#E2E8F0] font-mono select-none overflow-hidden">
  <!-- Streamlined Telemetry Header -->
  <header class="flex items-center justify-between px-3 py-1 bg-[#090D16] border-b border-[#172033] text-xs">
    <!-- Brand & Connection -->
    <div class="flex items-center gap-2.5">
      <span class="text-xs font-semibold tracking-wider text-[#FFB000]">Amstal</span>

      <!-- Telemetry Status Beacon -->
      <div
        class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#06090F] border border-[#172033] text-3xs"
        title={!marketOpen ? "US Equity Session: CLOSED (Weekend / After-hours: quotes frozen at Friday closing print)" : "US Equity Session: OPEN (Streaming continuous real-time quotes)"}
      >
        <span
          class="w-1.5 h-1.5 rounded-full {connectionState === 'CONNECTED' && marketOpen
            ? 'bg-[#00FF66] shadow-[0_0_6px_#00FF66]'
            : connectionState === 'CONNECTED' && !marketOpen
              ? 'bg-[#8B98A5]'
              : connectionState === 'CONNECTING'
                ? 'bg-[#FFB000] animate-ping'
                : 'bg-[#FF3344]'}"
        ></span>
        <span class="font-medium text-[#8B98A5]">
          {connectionState === "CONNECTED"
            ? (marketOpen ? "LIVE" : "CLOSED")
            : connectionState === "CONNECTING"
              ? "CONNECTING"
              : (!marketOpen ? "CLOSED" : "DISCONNECTED")}
        </span>
        <span class="text-[#475569]">[{latencyMs}ms]</span>
      </div>
    </div>

    <!-- Center: Streamlined Omnibar -->
    <form onsubmit={handleFormSubmit} class="flex-1 max-w-xl mx-3">
      <div class="relative flex items-center">
        <span class="absolute left-2.5 text-[#FFB000] text-xs font-bold select-none">&gt;</span>
        <input
          bind:this={omnibarRef}
          type="text"
          bind:value={omnibarInput}
          onkeydown={handleInputKeydown}
          aria-label="Bloomberg RPN Command Omnibar"
          autocomplete="off"
          class="w-full pl-7 pr-14 py-1 text-xs bg-[#06090F] border border-[#172033] rounded text-[#FFB000] font-mono tracking-wide focus:outline-none focus:border-[#FFB000] focus:ring-1 focus:ring-[#FFB000]/50 placeholder:text-[#3B4758]"
          placeholder="COMMAND <GO> (e.g. NVDA GP <GO>)…"
          spellcheck="false"
        />
        <div class="absolute right-1 flex items-center gap-1">
          <button
            type="submit"
            class="px-2 py-0.5 text-2xs font-bold bg-[#FFB000] text-black rounded hover:bg-[#E09900] transition-colors cursor-pointer"
          >
            GO
          </button>
        </div>
      </div>
    </form>

    <!-- Right Side: Security, Regime & UTC Clock -->
    <div class="flex items-center gap-2">
      <!-- Active Security Pill -->
      <div class="flex items-center gap-1.5 px-2 py-0.5 bg-[#06090F] border border-[#172033] rounded text-2xs">
        <span class="font-bold text-[#FFB000]">{activeTicker}</span>
        <span class="text-[#E2E8F0] font-mono">${activeTick.price.toFixed(2)}</span>
        <span class="font-mono {activeTick.change >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
          {activeTick.change >= 0 ? "+" : ""}{activeTick.change_pct.toFixed(2)}%
        </span>
        {#if !marketOpen}
          <span class="text-3xs text-[#7A8B9E] font-bold px-1 bg-[#151D2E] rounded border border-[#23314B]" title="Official Friday closing bell session">
            CLOSED
          </span>
        {/if}
      </div>

      <!-- Regime Pill with explicit Posterior Probability Label -->
      <div
        class="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded border border-[#172033] bg-[#06090F] text-2xs {regimeStateColor}"
        title="Forward-Filtered Active Regime Posterior Probability P(S_t). (See HMM panel for margin over runner-up state)"
      >
        <span class="text-[#5E6D82]">REGIME:</span>
        <span class="font-bold">{activeRegime.current_state.replace('_VOLATILITY', '')}</span>
        <span class="font-mono text-3xs">(P={regimeProbPct}%)</span>
      </div>

      <!-- Live UTC Clock -->
      <div class="text-3xs text-[#5E6D82] font-mono hidden xl:block">
        {systemTimeUtc}
      </div>

      <!-- Quick Help Trigger -->
      <button
        type="button"
        onclick={() => (showHelpModal = true)}
        aria-label="Open Workstation Guide (F1)"
        class="px-1.5 py-0.5 text-3xs font-mono text-[#8B98A5] hover:text-[#E2E8F0] rounded border border-[#172033] hover:border-[#8B98A5] transition-colors cursor-pointer"
        title="Press F1 for Workstation Guide"
      >
        ?
      </button>
    </div>
  </header>

  <!-- Dynamic Multi-Panel Workstation Grid Area -->
  <main class="flex-1 min-h-0 p-1 bg-[#06090F]">
    {#if maximizedSlot !== null}
      <!-- Single Maximized Slot View -->
      <div class="h-full w-full">
        {#if slotFunctions[maximizedSlot] === "GP"}
          <ChartPanel
            ticker={getSlotTicker(maximizedSlot)}
            channel={slotChannels[maximizedSlot]}
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onChannelChange={(ch) => (slotChannels[maximizedSlot!] = ch)}
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
          />
        {:else if slotFunctions[maximizedSlot] === "PORT"}
          <PortfolioKellyPanel
            ticker={getSlotTicker(maximizedSlot)}
            channel={slotChannels[maximizedSlot]}
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onChannelChange={(ch) => (slotChannels[maximizedSlot!] = ch)}
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
          />
        {:else if slotFunctions[maximizedSlot] === "HMM"}
          <RegimePanel
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onSwitchFunction={(fn: string) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
          />
        {:else if slotFunctions[maximizedSlot] === "FA"}
          <FinancialAnalysisPanel
            ticker={getSlotTicker(maximizedSlot)}
            channel={slotChannels[maximizedSlot]}
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onChannelChange={(ch) => (slotChannels[maximizedSlot!] = ch)}
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
          />
        {:else if slotFunctions[maximizedSlot] === "DES"}
          <SecurityMasterPanel
            ticker={getSlotTicker(maximizedSlot)}
            channel={slotChannels[maximizedSlot]}
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onChannelChange={(ch) => (slotChannels[maximizedSlot!] = ch)}
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
          />
        {:else if slotFunctions[maximizedSlot] === "SPLC"}
          <PeerGraphPanel
            ticker={getSlotTicker(maximizedSlot)}
            channel={slotChannels[maximizedSlot]}
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onChannelChange={(ch) => (slotChannels[maximizedSlot!] = ch)}
            onSelectTicker={(t) => setSlotTicker(maximizedSlot!, t)}
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
          />
        {:else if slotFunctions[maximizedSlot] === "EDGAR"}
          <EdgarRedlinePanel
            ticker={getSlotTicker(maximizedSlot)}
            channel={slotChannels[maximizedSlot]}
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onChannelChange={(ch) => (slotChannels[maximizedSlot!] = ch)}
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
          />
        {:else if slotFunctions[maximizedSlot] === "NEWS"}
          <NewsSentimentPanel
            ticker={getSlotTicker(maximizedSlot)}
            channel={slotChannels[maximizedSlot]}
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onChannelChange={(ch) => (slotChannels[maximizedSlot!] = ch)}
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
          />
        {:else if slotFunctions[maximizedSlot] === "HP"}
          <HistoricalPricePanel
            ticker={getSlotTicker(maximizedSlot)}
            channel={slotChannels[maximizedSlot]}
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onChannelChange={(ch) => (slotChannels[maximizedSlot!] = ch)}
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
          />
        {:else if slotFunctions[maximizedSlot] === "ANR"}
          <AnalystRatingsPanel
            ticker={getSlotTicker(maximizedSlot)}
            channel={slotChannels[maximizedSlot]}
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onChannelChange={(ch) => (slotChannels[maximizedSlot!] = ch)}
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
          />
        {:else if slotFunctions[maximizedSlot] === "COPILOT"}
          <CopilotPanel
            ticker={getSlotTicker(maximizedSlot)}
            channel={slotChannels[maximizedSlot]}
            isMaximized={true}
            onToggleMaximize={() => (maximizedSlot = null)}
            onChannelChange={(ch) => (slotChannels[maximizedSlot!] = ch)}
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
            onExecuteCommand={(cmd) => executeCommand(cmd)}
          />
        {/if}
      </div>
    {:else}
      <!-- Standard Responsive 2x2 Bloomberg Grid -->
      <div class="h-full w-full grid grid-cols-2 grid-rows-2 gap-1">
        {#each [0, 1, 2, 3] as slotIdx}
          <!-- Slot Container with Focus Border -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            onclick={() => (focusedSlot = slotIdx)}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                focusedSlot = slotIdx;
              }
            }}
            role="region"
            aria-label={`Workstation Panel Slot ${slotIdx + 1}`}
            class="min-h-0 min-w-0 h-full rounded transition-colors {focusedSlot === slotIdx ? 'ring-1 ring-[#FFB000]/70 border border-[#FFB000]/40' : 'border border-[#172033]'}"
          >
            {#if slotFunctions[slotIdx] === "GP"}
              <ChartPanel
                ticker={getSlotTicker(slotIdx)}
                channel={slotChannels[slotIdx]}
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onChannelChange={(ch) => (slotChannels[slotIdx] = ch)}
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
              />
            {:else if slotFunctions[slotIdx] === "PORT"}
              <PortfolioKellyPanel
                ticker={getSlotTicker(slotIdx)}
                channel={slotChannels[slotIdx]}
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onChannelChange={(ch) => (slotChannels[slotIdx] = ch)}
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
              />
            {:else if slotFunctions[slotIdx] === "HMM"}
              <RegimePanel
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onSwitchFunction={(fn: string) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
              />
            {:else if slotFunctions[slotIdx] === "FA"}
              <FinancialAnalysisPanel
                ticker={getSlotTicker(slotIdx)}
                channel={slotChannels[slotIdx]}
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onChannelChange={(ch) => (slotChannels[slotIdx] = ch)}
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
              />
            {:else if slotFunctions[slotIdx] === "DES"}
              <SecurityMasterPanel
                ticker={getSlotTicker(slotIdx)}
                channel={slotChannels[slotIdx]}
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onChannelChange={(ch) => (slotChannels[slotIdx] = ch)}
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
              />
            {:else if slotFunctions[slotIdx] === "SPLC"}
              <PeerGraphPanel
                ticker={getSlotTicker(slotIdx)}
                channel={slotChannels[slotIdx]}
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onChannelChange={(ch) => (slotChannels[slotIdx] = ch)}
                onSelectTicker={(t) => setSlotTicker(slotIdx, t)}
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
              />
            {:else if slotFunctions[slotIdx] === "EDGAR"}
              <EdgarRedlinePanel
                ticker={getSlotTicker(slotIdx)}
                channel={slotChannels[slotIdx]}
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onChannelChange={(ch) => (slotChannels[slotIdx] = ch)}
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
              />
            {:else if slotFunctions[slotIdx] === "NEWS"}
              <NewsSentimentPanel
                ticker={getSlotTicker(slotIdx)}
                channel={slotChannels[slotIdx]}
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onChannelChange={(ch) => (slotChannels[slotIdx] = ch)}
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
              />
            {:else if slotFunctions[slotIdx] === "HP"}
              <HistoricalPricePanel
                ticker={getSlotTicker(slotIdx)}
                channel={slotChannels[slotIdx]}
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onChannelChange={(ch) => (slotChannels[slotIdx] = ch)}
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
              />
            {:else if slotFunctions[slotIdx] === "ANR"}
              <AnalystRatingsPanel
                ticker={getSlotTicker(slotIdx)}
                channel={slotChannels[slotIdx]}
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onChannelChange={(ch) => (slotChannels[slotIdx] = ch)}
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
              />
            {:else if slotFunctions[slotIdx] === "COPILOT"}
              <CopilotPanel
                ticker={getSlotTicker(slotIdx)}
                channel={slotChannels[slotIdx]}
                isMaximized={false}
                onToggleMaximize={() => (maximizedSlot = slotIdx)}
                onChannelChange={(ch) => (slotChannels[slotIdx] = ch)}
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
                onExecuteCommand={(cmd) => executeCommand(cmd)}
              />
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </main>

  <!-- Sleek Tactical Telemetry Status Bar -->
  <footer class="flex items-center justify-between px-3 py-1 bg-[#090D16] border-t border-[#172033] text-3xs text-[#5E6D82] select-none">
    <!-- Left: Focus & Hotkey Indicators -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1.5">
        <span class="text-[#8B98A5]">SLOT:</span>
        <span class="font-bold text-[#FFB000] font-mono">#{focusedSlot + 1}</span>
      </div>
      <span class="text-[#232F48]">|</span>
      <div class="flex items-center gap-2 text-[#8B98A5]">
        <span><kbd class="px-1 py-0.2 rounded bg-[#06090F] border border-[#172033] text-[#FFB000] font-mono font-bold">ESC</kbd> GRID</span>
        <span><kbd class="px-1 py-0.2 rounded bg-[#06090F] border border-[#172033] text-[#00D2FF] font-mono font-bold">F1</kbd> GUIDE</span>
        <span><kbd class="px-1 py-0.2 rounded bg-[#06090F] border border-[#172033] text-[#00FF66] font-mono font-bold">F12</kbd> COPILOT</span>
      </div>
    </div>

    <!-- Center: Telemetry Status -->
    <div class="hidden md:flex items-center gap-3 font-mono">
      <span>FEED: <strong class="text-[#00FF66]">{connectionState === "CONNECTED" ? "100ms CONFLATION" : "250ms CONFLATION"}</strong></span>
      <span class="text-[#232F48]">|</span>
      <span>IPC: <strong class="text-[#8B98A5]">/tmp/amstal.sock</strong></span>
      <span class="text-[#232F48]">|</span>
      <span>LAKEHOUSE: <strong class="text-[#00D2FF]">DUCKDB</strong></span>
    </div>

    <!-- Right: Brand & Latency -->
    <div class="flex items-center gap-2 font-mono">
      <span class="text-[#8B98A5]">CHANNEL:</span>
      <span class="font-bold text-[#00D2FF]">{slotChannels[focusedSlot]}</span>
      <span class="text-[#232F48]">|</span>
      <span class="text-[#FFB000] font-semibold">Amstal</span>
    </div>
  </footer>

  <!-- Help / Keyboard Shortcuts Modal -->
  {#if showHelpModal}
    <div class="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div class="bg-[#0C111B] border border-[#FFB000]/60 rounded max-w-2xl w-full p-5 text-xs shadow-2xl flex flex-col gap-4">
        <div class="flex items-center justify-between border-b border-[#172033] pb-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-[#FFB000] tracking-wide">Amstal Workstation Guide</span>
          </div>
          <button
            onclick={() => (showHelpModal = false)}
            aria-label="Close Workstation Guide"
            class="text-[#5E6D82] hover:text-white font-bold text-sm px-2 cursor-pointer"
          >
            &times;
          </button>
        </div>

        <div class="space-y-3 text-[#8B98A5] leading-relaxed">
          <div>
            <h4 class="font-bold text-[#E6EDF5] mb-1">Bloomberg-Style Command Syntax:</h4>
            <code class="block p-2 bg-[#06090F] border border-[#172033] text-[#FFB000] rounded font-mono">
              [TICKER] [MARKET] &lt;ASSET CLASS&gt; [MNEMONIC] &lt;GO&gt;
            </code>
          </div>

          <div class="grid grid-cols-2 gap-3 text-2xs">
            <div class="p-2.5 bg-[#06090F] rounded border border-[#172033]">
              <span class="font-bold text-[#00D2FF] block mb-1">COMMAND EXAMPLES:</span>
              <ul class="space-y-1 font-mono text-[#E6EDF5]">
                <li><code class="text-[#FFB000]">NVDA US &lt;EQUITY&gt; GP &lt;GO&gt;</code> - Graph Price</li>
                <li><code class="text-[#FFB000]">CRWD PORT &lt;GO&gt;</code> - Kelly Sizer &amp; Signals</li>
                <li><code class="text-[#FFB000]">HMM &lt;GO&gt;</code> - 3-State Volatility Regime</li>
                <li><code class="text-[#FFB000]">AAPL FA &lt;GO&gt;</code> - 10Y XBRL Lakehouse</li>
                <li><code class="text-[#FFB000]">NVDA DES &lt;GO&gt;</code> - Security Master Profile</li>
                <li><code class="text-[#FFB000]">NVDA SPLC &lt;GO&gt;</code> - 10-Node Dynamic Peer GAT</li>
                <li><code class="text-[#FFB000]">NVDA EDGAR &lt;GO&gt;</code> - SEC Redlines &amp; Form 4</li>
                <li><code class="text-[#FFB000]">NVDA NEWS &lt;GO&gt;</code> - FinBERT Headline Stream</li>
                <li><code class="text-[#FFB000]">NVDA HP &lt;GO&gt;</code> - Historical Return Decomp</li>
                <li><code class="text-[#FFB000]">NVDA ANR &lt;GO&gt;</code> - Analyst Consensus &amp; Targets</li>
                <li><code class="text-[#FFB000]">COPILOT &lt;GO&gt;</code> - Quantitative AI Copilot</li>
                <li><code class="text-[#FFB000]">GRID &lt;GO&gt;</code> - Restore 2x2 Grid</li>
              </ul>
            </div>

            <div class="p-2.5 bg-[#06090F] rounded border border-[#172033]">
              <span class="font-bold text-[#00FF66] block mb-1">HOTKEY SHORTCUTS:</span>
              <ul class="space-y-1 font-mono text-[#E6EDF5]">
                <li><strong class="text-[#00D2FF]">F1:</strong> Toggle Workstation Guide</li>
                <li><strong class="text-[#00D2FF]">F2:</strong> Graph Price (GP)</li>
                <li><strong class="text-[#00D2FF]">F3:</strong> Portfolio &amp; Kelly (PORT)</li>
                <li><strong class="text-[#00D2FF]">F4:</strong> Macro Regime (HMM)</li>
                <li><strong class="text-[#00D2FF]">F5:</strong> Financial Lakehouse (FA)</li>
                <li><strong class="text-[#00D2FF]">F6:</strong> Restore 2x2 Grid</li>
                <li><strong class="text-[#00D2FF]">F7:</strong> Security Master (DES)</li>
                <li><strong class="text-[#00D2FF]">F8:</strong> Dynamic Peer Graph (SPLC)</li>
                <li><strong class="text-[#00D2FF]">F9:</strong> SEC Redlines &amp; Form 4 (EDGAR)</li>
                <li><strong class="text-[#00D2FF]">F10:</strong> FinBERT News Feed (NEWS)</li>
                <li><strong class="text-[#00D2FF]">F11:</strong> Historical Prices (HP)</li>
                <li><strong class="text-[#00D2FF]">F12:</strong> Quantitative AI Copilot (COPILOT)</li>
                <li><strong class="text-[#00D2FF]">ESC:</strong> Restore Grid / Clear</li>
              </ul>
            </div>
          </div>

          <div class="p-2.5 bg-[#06090F] rounded border border-[#172033] text-2xs">
            <span class="font-bold text-[#FFB000] block mb-1">COLOR-CHANNEL SYNCHRONIZATION:</span>
            <p class="text-[#8B98A5]">
              Every panel toolbar includes a color channel link button (<strong class="text-[#00D2FF]">[BLUE]</strong>, <strong class="text-[#FFB000]">[AMBER]</strong>, <strong class="text-[#00FF66]">[GREEN]</strong>, <strong class="text-[#FF3344]">[RED]</strong>, <strong class="text-[#5E6D82]">[UNLINKED]</strong>). Changing a ticker in any linked panel (or clicking a peer in <code class="text-[#00D2FF]">SPLC</code>) reactively updates all other panels linked to that color channel.
            </p>
          </div>
        </div>

        <div class="flex justify-end pt-2 border-t border-[#172033]">
          <button
            onclick={() => (showHelpModal = false)}
            class="px-4 py-1 bg-[#FFB000] text-black font-bold rounded hover:bg-[#E09900] transition-colors cursor-pointer"
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
