<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ipcService } from "../lib/ipc";
  import type { ColorChannel, SecurityMasterData } from "../lib/types";

  let {
    ticker = "NVDA",
    channel = "BLUE",
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

  let master = $state<SecurityMasterData | null>(ipcService.getSecurityMaster("NVDA"));
  let currentPrice = $state<number>(ipcService.getTick("NVDA")?.price ?? 0);
  let connState = $state<string>(ipcService.connectionState);
  let isLoading = $state<boolean>(false);
  let unsubscribeIpc: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;

  $effect(() => {
    const sym = ticker;
    const connected = connState === "CONNECTED";
    if (sym) {
      const cached = ipcService.getSecurityMaster(sym);
      master = cached;
      currentPrice = ipcService.getTick(sym)?.price ?? 0;
      if (connected) {
        if (!cached) isLoading = true;
        Promise.all([
          ipcService.fetchSecurityMaster(sym).then((fresh) => {
            if (fresh && sym === ticker) master = fresh;
          }),
          ipcService.fetchTick(sym).then((freshTick) => {
            if (freshTick && freshTick.price > 0 && sym === ticker) currentPrice = freshTick.price;
          }),
        ]).finally(() => {
          if (sym === ticker) isLoading = false;
        });
      } else {
        isLoading = false;
      }
    }
  });

  onMount(() => {
    unsubscribeStatus = ipcService.subscribeStatus((st) => {
      connState = st;
    });
    unsubscribeIpc = ipcService.subscribe((frame) => {
      const sym = ticker.toUpperCase();
      if (frame.ticks && frame.ticks[sym]) {
        currentPrice = frame.ticks[sym].price;
      }
      const updated = ipcService.getSecurityMaster(sym);
      if (updated) master = updated;
    });
  });

  onDestroy(() => {
    if (unsubscribeIpc) unsubscribeIpc();
    if (unsubscribeStatus) unsubscribeStatus();
  });

  const sectorEtfMap: Record<string, string> = {
    "Information Technology": "XLK",
    "Health Care": "XLV",
    Financials: "XLF",
    "Consumer Discretionary": "XLY",
    "Communication Services": "XLC",
    Industrials: "XLI",
    "Consumer Staples": "XLP",
    Energy: "XLE",
    Utilities: "XLU",
    "Real Estate": "XLRE",
    Materials: "XLB",
  };
  let sectorEtf = $derived((master?.gics_sector && sectorEtfMap[master.gics_sector]) || "SPY");

  let rangePct = $derived.by<number | null>(() => {
    if (
      !master ||
      master.low_52w === null ||
      master.high_52w === null ||
      !(currentPrice > 0) ||
      !(master.high_52w > master.low_52w)
    ) {
      return null;
    }
    return Math.min(100, Math.max(0, ((currentPrice - master.low_52w) / (master.high_52w - master.low_52w)) * 100));
  });

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
</script>

<div class="flex flex-col h-full w-full bg-[#0C111B] border border-[#172033] rounded select-none overflow-hidden text-xs">
  <!-- Subheader -->
  <div class="flex items-center justify-between px-3 py-1 bg-[#090D16] border-b border-[#172033]">
    <div class="flex items-center gap-2">
      <!-- Color Channel Link Pill -->
      <button
        onclick={cycleChannel}
        class="px-1.5 py-0.5 rounded text-2xs font-bold border transition-colors {channelColors[channel].bg} {channelColors[channel].text} {channelColors[channel].border}"
        title="Color Channel Link"
      >
        [{channel}]
      </button>
      <span class="font-bold text-[#FFB000]">DES &lt;GO&gt;</span>
      <span class="text-[#E6EDF5] font-semibold">{ticker} US</span>
    </div>

    <div class="flex items-center gap-2">
      {#if onToggleMaximize}
        <button
          onclick={onToggleMaximize}
          class="px-2 py-0.5 text-2xs rounded border border-[#172033] bg-[#06090F] text-[#8B98A5] hover:text-white transition-colors"
        >
          {isMaximized ? "RESTORE" : "MAX"}
        </button>
      {/if}
    </div>
  </div>

  <!-- Content Container -->
  <div class="flex-1 flex flex-col p-2.5 gap-2.5 overflow-y-auto">
    {#if isLoading && !master}
      <div class="flex-1 flex flex-col items-center justify-center p-6 text-center font-mono">
        <span class="text-xs font-bold text-[#00D2FF]">LOADING SECURITY MASTER &amp; FUNDAMENTAL METADATA FOR {ticker}…</span>
        <span class="text-2xs text-[#5E6D82] mt-1">Computing 60d market/sector betas and querying live SEC/Yahoo profile.</span>
      </div>
    {:else if !master}
      <div class="flex-1 flex flex-col items-center justify-center p-6 text-center font-mono">
        <span class="text-xs font-bold text-[#FFB000]">
          {connState === "CONNECTED" ? `NO SECURITY MASTER RECORD FOR ${ticker}` : "ENGINE DAEMON OFFLINE — NO SIMULATED SECURITY PROFILE"}
        </span>
        <span class="text-2xs text-[#5E6D82] mt-1 max-w-md">
          Connect live QARE-MM Python daemon on ws://127.0.0.1:8194 to retrieve authentic betas, fundamentals, and SEC EDGAR metadata.
        </span>
      </div>
    {:else}
    <!-- Top Identity Card -->
    <div class="flex items-start justify-between p-2.5 bg-[#06090F] border border-[#172033] rounded">
      <div>
        <div class="flex items-baseline gap-2">
          <span class="text-base font-bold text-[#FFB000] font-mono">{master.ticker}</span>
          <span class="text-sm font-semibold text-[#E6EDF5]">{master.company_name}</span>
          <span class="px-1.5 py-0.2 rounded bg-[#121824] border border-[#172033] text-2xs text-[#00D2FF]">{master.primary_exchange}</span>
        </div>
        <div class="flex items-center gap-2 text-2xs text-[#5E6D82] mt-1 font-mono">
          <span>CIK: <strong class="text-[#E6EDF5]">{master.cik || "—"}</strong></span>
          <span>|</span>
          <span>FIGI: <strong class="text-[#E6EDF5]">{master.figi || "—"}</strong></span>
          <span>|</span>
          <span>SECTOR: <strong class="text-[#00FF66]">{master.gics_sector || "—"}</strong></span>
          <span>|</span>
          <span>SUB-IND: <strong class="text-[#E6EDF5]">{master.gics_sub_industry || "—"}</strong></span>
        </div>
      </div>

      <div class="text-right font-mono">
        <div class="text-2xs text-[#5E6D82]">MARKET CAP</div>
        <div class="text-sm font-bold text-[#E6EDF5]">
          {master.market_cap_billions !== null && master.market_cap_billions !== undefined
            ? `$${master.market_cap_billions.toLocaleString()}B`
            : "—"}
        </div>
      </div>
    </div>

    <!-- 8-Card Quantitative & Market Profile Grid -->
    <div class="grid grid-cols-4 gap-2">
      <!-- 60d Market Beta -->
      <div class="p-2 bg-[#06090F] border border-[#172033] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#5E6D82]">60D MARKET BETA (&beta;<sub>mkt</sub>)</span>
        <div class="flex items-baseline gap-1 mt-1 font-mono">
          <span class="text-sm font-bold text-[#00D2FF]">
            {master.beta_market_60d !== null && master.beta_market_60d !== undefined ? master.beta_market_60d.toFixed(2) : "—"}
          </span>
          <span class="text-2xs text-[#5E6D82]">vs SPY</span>
        </div>
        <span class="text-2xs text-[#5E6D82] mt-0.5">Empirical OLS</span>
      </div>

      <!-- 60d Sector Beta -->
      <div class="p-2 bg-[#06090F] border border-[#172033] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#5E6D82]">60D SECTOR BETA (&beta;<sub>sec</sub>)</span>
        <div class="flex items-baseline gap-1 mt-1 font-mono">
          <span class="text-sm font-bold text-[#FFB000]">
            {master.beta_sector_60d !== null && master.beta_sector_60d !== undefined ? master.beta_sector_60d.toFixed(2) : "—"}
          </span>
          <span class="text-2xs text-[#5E6D82]">vs {sectorEtf}</span>
        </div>
        <span class="text-2xs text-[#5E6D82] mt-0.5">Residualized</span>
      </div>

      <!-- 30d ADV -->
      <div class="p-2 bg-[#06090F] border border-[#172033] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#5E6D82]">30D ADV (SHARES)</span>
        <div class="flex items-baseline gap-1 mt-1 font-mono">
          <span class="text-sm font-bold text-[#E6EDF5]">
            {master.adv_30d_shares !== null && master.adv_30d_shares !== undefined ? `${(master.adv_30d_shares / 1000000).toFixed(1)}M` : "—"}
          </span>
          <span class="text-2xs text-[#5E6D82]">/ day</span>
        </div>
        <span class="text-2xs text-[#5E6D82] mt-0.5">Realized 30d Avg</span>
      </div>

      <!-- Valuation Ratios -->
      <div class="p-2 bg-[#06090F] border border-[#172033] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#5E6D82]">P/E (LTM / FWD)</span>
        <div class="flex items-baseline gap-1 mt-1 font-mono">
          <span class="text-sm font-bold text-[#00FF66]">
            {master.pe_ratio_ltm !== null && master.pe_ratio_ltm !== undefined ? `${master.pe_ratio_ltm.toFixed(1)}x` : "—"}
          </span>
          <span class="text-2xs text-[#5E6D82]">
            / {master.pe_forward !== null && master.pe_forward !== undefined ? `${master.pe_forward.toFixed(1)}x` : "—"}
          </span>
        </div>
        <span class="text-2xs text-[#5E6D82] mt-0.5">
          Div Yield: {master.dividend_yield_pct !== null && master.dividend_yield_pct !== undefined ? `${master.dividend_yield_pct.toFixed(2)}%` : "—"}
        </span>
      </div>

      <!-- 52W High / Low Range -->
      <div class="col-span-2 p-2 bg-[#06090F] border border-[#172033] rounded flex flex-col justify-between">
        <div class="flex items-center justify-between text-2xs text-[#5E6D82]">
          <span>52-WEEK RANGE</span>
          <span class="font-mono text-[#E6EDF5]">
            {master.low_52w !== null && master.high_52w !== null ? `$${master.low_52w.toFixed(2)} - $${master.high_52w.toFixed(2)}` : "—"}
          </span>
        </div>
        <div class="w-full bg-[#121824] h-2 rounded-full relative mt-1.5 overflow-hidden">
          {#if rangePct !== null}
            <div
              style="left: 0%; width: {rangePct.toFixed(1)}%"
              class="absolute top-0 bottom-0 bg-[#00D2FF]/40 rounded"
            ></div>
            <div
              style="left: {rangePct.toFixed(1)}%"
              class="absolute top-0 bottom-0 w-1 bg-[#FFB000]"
              title="Current Range Position"
            ></div>
          {/if}
        </div>
        <div class="flex items-center justify-between text-2xs text-[#5E6D82] mt-1 font-mono">
          <span>Low: {master.low_52w !== null ? `$${master.low_52w.toFixed(2)}` : "—"}</span>
          <span class="text-[#FFB000]">
            Position: {rangePct !== null ? `${rangePct.toFixed(0)}%` : "—"} ({currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : "$—"})
          </span>
          <span>High: {master.high_52w !== null ? `$${master.high_52w.toFixed(2)}` : "—"}</span>
        </div>
      </div>

      <!-- Corporate Identifiers -->
      <div class="col-span-2 p-2 bg-[#06090F] border border-[#172033] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#5E6D82]">CORPORATE SUMMARY</span>
        <div class="grid grid-cols-3 gap-1 mt-1 text-2xs font-mono">
          <div>
            <span class="text-[#5E6D82] block">HEADQUARTERS</span>
            <span class="text-[#E6EDF5] truncate block" title={master.headquarters || ""}>{master.headquarters || "—"}</span>
          </div>
          <div>
            <span class="text-[#5E6D82] block">CEO</span>
            <span class="text-[#E6EDF5] truncate block" title={master.ceo || ""}>{master.ceo || "—"}</span>
          </div>
          <div>
            <span class="text-[#5E6D82] block">EMPLOYEES</span>
            <span class="text-[#E6EDF5] block">{master.employees !== null && master.employees !== undefined ? master.employees.toLocaleString() : "—"}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Business Summary -->
    <div class="flex-1 flex flex-col bg-[#06090F] border border-[#172033] rounded p-2.5 overflow-hidden">
      <div class="flex items-center justify-between border-b border-[#172033] pb-1 mb-2">
        <span class="text-2xs font-bold text-[#FFB000] tracking-wider">
          ITEM 1 // BUSINESS DESCRIPTION
        </span>
        <span class="text-2xs text-[#5E6D82] font-mono">LIVE / SEC METADATA</span>
      </div>
      <div class="flex-1 overflow-y-auto text-2xs text-[#8B98A5] leading-relaxed pr-1 font-mono whitespace-pre-line">
        {master.business_summary || "No business description available."}
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
</style>
