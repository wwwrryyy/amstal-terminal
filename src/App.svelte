<script lang="ts">
  // Svelte 5 Runes Workstation Shell
  const STANDALONE_MNEMONICS = new Set(["HMM", "PORT", "GP", "FA", "DES", "HELP", "TOP"]);

  let omnibarInput = $state("NVDA US <EQUITY> FA <GO>");
  let activeTicker = $state("NVDA");
  let macroRegime = $state("LOW_VOLATILITY");
  let daemonOnline = $state(true);

  function handleCommandSubmit(e: SubmitEvent) {
    e.preventDefault();
    const cleanTokens = omnibarInput
      .trim()
      .split(/\s+/)
      .filter((t) => t && t.toUpperCase() !== "<GO>" && t.toUpperCase() !== "GO");

    if (cleanTokens.length === 0) return;

    const firstToken = cleanTokens[0].toUpperCase();
    if (!STANDALONE_MNEMONICS.has(firstToken)) {
      activeTicker = firstToken;
    }
  }
</script>

<div class="flex flex-col h-screen w-screen bg-[#0A0E17] text-[#E2E8F0] font-mono select-none">
  <!-- Top Command Omnibar -->
  <header class="flex items-center justify-between px-4 py-2 bg-[#111622] border-b border-[#1E2638]">
    <div class="flex items-center gap-3">
      <span class="text-xs font-bold tracking-widest text-[#FF9E00]">AMSTAL // TERMINAL</span>
      <span class="text-xs px-2 py-0.5 rounded bg-[#182030] text-[#00D2FF]">v1.3</span>
      <div class="flex items-center gap-1.5 text-xs text-[#64748B]">
        <span class="w-2 h-2 rounded-full {daemonOnline ? 'bg-[#00E676]' : 'bg-[#FF3366]'}"></span>
        <span>{daemonOnline ? 'ENGINE CONNECTED' : 'DAEMON OFFLINE'}</span>
      </div>
    </div>

    <!-- Mnemonic Command Input -->
    <form onsubmit={handleCommandSubmit} class="flex-1 max-w-xl mx-4">
      <div class="relative flex items-center">
        <span class="absolute left-3 text-[#FF9E00] text-xs font-bold">&gt;</span>
        <input
          type="text"
          bind:value={omnibarInput}
          class="w-full pl-8 pr-16 py-1.5 text-xs bg-[#0A0E17] border border-[#1E2638] rounded text-[#FF9E00] focus:outline-none focus:border-[#FF9E00]"
          placeholder="ENTER MNEMONIC (e.g. AAPL US GP <GO>)..."
        />
        <button
          type="submit"
          class="absolute right-1 px-2.5 py-0.5 text-xs font-bold bg-[#FF9E00] text-black rounded hover:bg-[#E08A00]"
        >
          GO
        </button>
      </div>
    </form>

    <div class="flex items-center gap-3 text-xs">
      <span class="text-[#64748B]">REGIME:</span>
      <span class="px-2 py-0.5 rounded bg-[#182030] text-[#00E676] font-semibold">{macroRegime}</span>
    </div>
  </header>

  <!-- 4-Tile Workstation Grid -->
  <main class="flex-1 grid grid-cols-2 grid-rows-2 gap-1 p-1 bg-[#0A0E17]">
    <!-- Panel 1: GP (Graph Price & Barriers) -->
    <section class="flex flex-col bg-[#111622] border border-[#1E2638] rounded overflow-hidden">
      <div class="flex items-center justify-between px-3 py-1.5 bg-[#182030] border-b border-[#1E2638] text-xs">
        <span class="font-bold text-[#00D2FF]">GP // {activeTicker} US [PRICE & ATR BARRIERS]</span>
        <span class="text-[#64748B]">HOURLY & DAILY OHLCV</span>
      </div>
      <div class="flex-1 flex items-center justify-center text-xs text-[#64748B]">
        [TRADINGVIEW LIGHTWEIGHT CHARTS CANVAS]
      </div>
    </section>

    <!-- Panel 2: PORT / QARE (Signal & Kelly Sizing) -->
    <section class="flex flex-col bg-[#111622] border border-[#1E2638] rounded overflow-hidden">
      <div class="flex items-center justify-between px-3 py-1.5 bg-[#182030] border-b border-[#1E2638] text-xs">
        <span class="font-bold text-[#FF9E00]">PORT // QARE-MM v1.3 [KELLY SIZER]</span>
        <span class="text-[#64748B]">L1-NORMALIZED</span>
      </div>
      <div class="flex-1 flex items-center justify-center text-xs text-[#64748B]">
        [MULTI-OUTCOME FRACTIONAL KELLY ALLOCATION PANEL]
      </div>
    </section>

    <!-- Panel 3: HMM / Macro Regime Monitor -->
    <section class="flex flex-col bg-[#111622] border border-[#1E2638] rounded overflow-hidden">
      <div class="flex items-center justify-between px-3 py-1.5 bg-[#182030] border-b border-[#1E2638] text-xs">
        <span class="font-bold text-[#00E676]">HMM // MACRO VOLATILITY REGIME</span>
        <span class="text-[#64748B]">FORWARD-FILTERED</span>
      </div>
      <div class="flex-1 flex items-center justify-center text-xs text-[#64748B]">
        [3-STATE GAUSSIAN HMM PROBABILITY STREAM]
      </div>
    </section>

    <!-- Panel 4: FA / Point-in-Time Financial Analysis -->
    <section class="flex flex-col bg-[#111622] border border-[#1E2638] rounded overflow-hidden">
      <div class="flex items-center justify-between px-3 py-1.5 bg-[#182030] border-b border-[#1E2638] text-xs">
        <span class="font-bold text-[#E2E8F0]">FA // {activeTicker} [POINT-IN-TIME 10Y XBRL]</span>
        <span class="text-[#64748B]">RESTATEMENT-SAFE</span>
      </div>
      <div class="flex-1 flex items-center justify-center text-xs text-[#64748B]">
        [PARQUET LAKEHOUSE FINANCIAL STATEMENTS GRID]
      </div>
    </section>
  </main>
</div>
