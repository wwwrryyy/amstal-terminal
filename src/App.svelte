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
  import { ipcService, type ConnectionState } from "./lib/ipc";
  import { parse_mnemonic_command, STANDALONE_MNEMONICS } from "./lib/mnemonic";
  import type { ColorChannel, MacroRegimeData, QARESignalFrame, TickData } from "./lib/types";

  type FunctionMnemonic = "GP" | "PORT" | "HMM" | "FA" | "DES" | "SPLC" | "EDGAR" | "NEWS" | "HP";

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

  let unsubscribeIpc: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;
  let clockTimer: any = null;

  function updateClock() {
    const now = new Date();
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
    if (["GP", "PORT", "HMM", "FA", "DES", "SPLC", "EDGAR", "NEWS", "HP"].includes(m)) {
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

<div class="flex flex-col h-screen w-screen bg-[#0A0E17] text-[#E2E8F0] font-mono select-none overflow-hidden">
  <!-- Bloomberg Top Command Header -->
  <header class="flex items-center justify-between px-3 py-1.5 bg-[#111622] border-b border-[#1E2638] text-xs">
    <!-- Brand & Connection -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1.5">
        <span class="font-bold tracking-widest text-[#FF9E00]">AMSTAL</span>
        <span class="text-2xs px-1.5 py-0.2 rounded bg-[#182030] text-[#00D2FF] font-semibold border border-[#1E2638]">
          v1.3
        </span>
      </div>

      <!-- Engine Connection Badge -->
      <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#0A0E17] border border-[#1E2638] text-2xs">
        <span
          class="w-2 h-2 rounded-full {connectionState === 'CONNECTED'
            ? 'bg-[#00E676]'
            : connectionState === 'SIMULATED_FALLBACK'
              ? 'bg-[#00D2FF] animate-pulse'
              : connectionState === 'CONNECTING'
                ? 'bg-[#FF9E00] animate-ping'
                : 'bg-[#FF3366]'}"
        ></span>
        <span class="font-semibold {connectionState === 'CONNECTED' ? 'text-[#00E676]' : 'text-[#94A3B8]'}">
          {connectionState === "CONNECTED"
            ? "DAEMON CONNECTED"
            : connectionState === "SIMULATED_FALLBACK"
              ? "SIMULATED STREAM [100ms]"
              : connectionState === "CONNECTING"
                ? "CONNECTING..."
                : "DAEMON OFFLINE"}
        </span>
        <span class="text-[#64748B]">[{latencyMs}ms]</span>
      </div>
    </div>

    <!-- Center: Mnemonic Omnibar Input -->
    <form onsubmit={handleFormSubmit} class="flex-1 max-w-2xl mx-4">
      <div class="relative flex items-center">
        <span class="absolute left-3 text-[#FF9E00] text-xs font-bold select-none">&gt;</span>
        <input
          bind:this={omnibarRef}
          type="text"
          bind:value={omnibarInput}
          onkeydown={handleInputKeydown}
          class="w-full pl-8 pr-20 py-1 text-xs bg-[#0A0E17] border border-[#1E2638] rounded text-[#FF9E00] font-mono tracking-wide focus:outline-none focus:border-[#FF9E00] focus:ring-1 focus:ring-[#FF9E00]"
          placeholder="ENTER RPN COMMAND (e.g. NVDA US <EQUITY> GP <GO>, SPLC <GO>, DES <GO>)..."
          spellcheck="false"
        />
        <div class="absolute right-1 flex items-center gap-1">
          <kbd class="hidden md:inline px-1 py-0.5 text-3xs rounded bg-[#182030] text-[#64748B] border border-[#1E2638]">
            /
          </kbd>
          <button
            type="submit"
            class="px-2.5 py-0.5 text-xs font-bold bg-[#FF9E00] text-black rounded hover:bg-[#E08A00] transition-colors cursor-pointer"
          >
            GO
          </button>
        </div>
      </div>
    </form>

    <!-- Right Side: Security Pill, Regime & System Time -->
    <div class="flex items-center gap-3">
      <!-- Active Security & Quote Pill -->
      <div class="flex items-center gap-1.5 px-2 py-0.5 bg-[#0A0E17] border border-[#1E2638] rounded text-2xs">
        <span class="font-bold text-[#FF9E00]">{activeTicker}</span>
        <span class="text-[#64748B]">{activeMarket}</span>
        <span class="text-[#E2E8F0] font-mono">${activeTick.price.toFixed(2)}</span>
        <span class="font-mono {activeTick.change >= 0 ? 'text-[#00E676]' : 'text-[#FF3366]'}">
          {activeTick.change >= 0 ? "+" : ""}{activeTick.change.toFixed(2)} ({activeTick.change_pct >= 0 ? "+" : ""}{activeTick.change_pct.toFixed(2)}%)
        </span>
      </div>

      <!-- Macro Volatility Regime Badge -->
      <div class="flex items-center gap-1.5 px-2 py-0.5 rounded border text-2xs font-semibold {regimeStateColor}">
        <span>REGIME:</span>
        <span>{activeRegime.current_state} ({regimeProbPct}%)</span>
      </div>

      <!-- Live UTC System Clock -->
      <div class="text-2xs text-[#94A3B8] font-mono hidden xl:block">
        {systemTimeUtc}
      </div>
    </div>
  </header>

  <!-- Keyboard Shortcuts & Function Key Bar -->
  <div class="flex items-center justify-between px-3 py-0.5 bg-[#0A0E17] border-b border-[#1E2638] text-3xs text-[#64748B]">
    <div class="flex items-center gap-3">
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => (showHelpModal = true)}>
        <strong class="text-[#FF9E00]">F1</strong> HELP
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${getSlotTicker(focusedSlot)} GP <GO>`)}>
        <strong class="text-[#00D2FF]">F2</strong> GP &lt;PRICE&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${getSlotTicker(focusedSlot)} PORT <GO>`)}>
        <strong class="text-[#FF9E00]">F3</strong> PORT &lt;KELLY&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`HMM <GO>`)}>
        <strong class="text-[#00E676]">F4</strong> HMM &lt;REGIME&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${getSlotTicker(focusedSlot)} FA <GO>`)}>
        <strong class="text-[#E2E8F0]">F5</strong> FA &lt;LAKEHOUSE&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => (maximizedSlot = null)}>
        <strong class="text-[#00D2FF]">F6</strong> 2x2 GRID
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${getSlotTicker(focusedSlot)} DES <GO>`)}>
        <strong class="text-[#00E676]">F7</strong> DES &lt;FACTSHEET&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${getSlotTicker(focusedSlot)} SPLC <GO>`)}>
        <strong class="text-[#00D2FF]">F8</strong> SPLC &lt;PEER GRAPH&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${getSlotTicker(focusedSlot)} EDGAR <GO>`)}>
        <strong class="text-[#FF9E00]">F9</strong> EDGAR &lt;REDLINES&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${getSlotTicker(focusedSlot)} NEWS <GO>`)}>
        <strong class="text-[#00E676]">F10</strong> NEWS &lt;FINBERT&gt;
      </button>
      <button class="hover:text-[#E2E8F0] cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit" onclick={() => executeCommand(`${getSlotTicker(focusedSlot)} HP <GO>`)}>
        <strong class="text-[#00D2FF]">F11</strong> HP &lt;PRICES&gt;
      </button>
    </div>

    <div class="flex items-center gap-2">
      <span>FOCUSED SLOT: <strong class="text-[#FF9E00]">SLOT #{focusedSlot + 1}</strong></span>
      <span>|</span>
      <span>PRESS <code class="text-[#FF9E00] font-bold">ESC</code> TO RESTORE GRID</span>
    </div>
  </div>

  <!-- Dynamic Multi-Panel Workstation Grid Area -->
  <main class="flex-1 min-h-0 p-1 bg-[#0A0E17]">
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
            onSwitchFunction={(fn) => (slotFunctions[maximizedSlot!] = fn as FunctionMnemonic)}
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
        {/if}
      </div>
    {:else}
      <!-- Standard Responsive 2x2 Bloomberg Grid -->
      <div class="h-full w-full grid grid-cols-2 grid-rows-2 gap-1">
        {#each [0, 1, 2, 3] as slotIdx}
          <!-- Slot Container with Focus Border -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            onclick={() => (focusedSlot = slotIdx)}
            class="min-h-0 min-w-0 h-full rounded transition-all {focusedSlot === slotIdx ? 'ring-1 ring-[#FF9E00]/60' : ''}"
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
                onSwitchFunction={(fn) => (slotFunctions[slotIdx] = fn as FunctionMnemonic)}
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
            {/if}
          </div>
        {/each}
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
                <li><code class="text-[#FF9E00]">NVDA DES &lt;GO&gt;</code> - Security Master Profile</li>
                <li><code class="text-[#FF9E00]">NVDA SPLC &lt;GO&gt;</code> - 10-Node Dynamic Peer GAT</li>
                <li><code class="text-[#FF9E00]">NVDA EDGAR &lt;GO&gt;</code> - SEC Redlines &amp; Form 4</li>
                <li><code class="text-[#FF9E00]">NVDA NEWS &lt;GO&gt;</code> - FinBERT Headline Stream</li>
                <li><code class="text-[#FF9E00]">NVDA HP &lt;GO&gt;</code> - Historical Return Decomp</li>
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
                <li><strong class="text-[#00D2FF]">F6:</strong> Restore 2x2 Grid</li>
                <li><strong class="text-[#00D2FF]">F7:</strong> Security Master (DES)</li>
                <li><strong class="text-[#00D2FF]">F8:</strong> Dynamic Peer Graph (SPLC)</li>
                <li><strong class="text-[#00D2FF]">F9:</strong> SEC Redlines &amp; Form 4 (EDGAR)</li>
                <li><strong class="text-[#00D2FF]">F10:</strong> FinBERT News Feed (NEWS)</li>
                <li><strong class="text-[#00D2FF]">F11:</strong> Historical Prices (HP)</li>
                <li><strong class="text-[#00D2FF]">ESC:</strong> Restore Grid / Clear</li>
              </ul>
            </div>
          </div>

          <div class="p-2.5 bg-[#0A0E17] rounded border border-[#1E2638] text-2xs">
            <span class="font-bold text-[#FF9E00] block mb-1">REACTIVE COLOR-CHANNEL SYNCHRONIZATION:</span>
            <p class="text-[#CBD5E1]">
              Every panel toolbar includes a color channel link button (e.g. <strong class="text-[#00D2FF]">[BLUE]</strong>, <strong class="text-[#FF9E00]">[AMBER]</strong>, <strong class="text-[#00E676]">[GREEN]</strong>, <strong class="text-[#FF3366]">[RED]</strong>, <strong class="text-[#64748B]">[UNLINKED]</strong>). Changing a ticker in any linked panel (or clicking a peer in <code class="text-[#00D2FF]">SPLC</code>) reactively updates all other panels linked to that color channel.
            </p>
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
