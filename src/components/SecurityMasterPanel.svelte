<script lang="ts">
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

  let master = $derived<SecurityMasterData>(ipcService.getSecurityMaster(ticker));

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

<div class="flex flex-col h-full w-full bg-[#111622] border border-[#1E2638] rounded select-none overflow-hidden text-xs">
  <!-- Subheader -->
  <div class="flex items-center justify-between px-3 py-1.5 bg-[#182030] border-b border-[#1E2638]">
    <div class="flex items-center gap-2">
      <!-- Color Channel Link Pill -->
      <button
        onclick={cycleChannel}
        class="px-1.5 py-0.5 rounded text-2xs font-bold border transition-colors {channelColors[channel].bg} {channelColors[channel].text} {channelColors[channel].border}"
        title="Color Channel Link (Click to cycle BLUE, AMBER, GREEN, RED, UNLINKED)"
      >
        [{channel}]
      </button>
      <span class="font-bold text-[#FF9E00]">DES &lt;GO&gt;</span>
      <span class="text-[#E2E8F0] font-semibold">{ticker} US</span>
      <span class="text-[#64748B]">SECURITY MASTER FACTSHEET</span>
    </div>

    <div class="flex items-center gap-2">
      {#if onSwitchFunction}
        <div class="flex items-center gap-1 text-2xs">
          <button onclick={() => onSwitchFunction("GP")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00D2FF] hover:bg-[#1E2638]">GP</button>
          <button onclick={() => onSwitchFunction("PORT")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#FF9E00] hover:bg-[#1E2638]">PORT</button>
          <button onclick={() => onSwitchFunction("FA")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#E2E8F0] hover:bg-[#1E2638]">FA</button>
          <button onclick={() => onSwitchFunction("SPLC")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00E676] hover:bg-[#1E2638]">SPLC</button>
        </div>
      {/if}

      {#if onToggleMaximize}
        <button
          onclick={onToggleMaximize}
          class="px-2 py-0.5 text-2xs rounded border border-[#1E2638] bg-[#0A0E17] text-[#94A3B8] hover:text-white"
        >
          {isMaximized ? "RESTORE" : "MAX"}
        </button>
      {/if}
    </div>
  </div>

  <!-- Content Container -->
  <div class="flex-1 flex flex-col p-2.5 gap-2.5 overflow-y-auto">
    <!-- Top Identity Card -->
    <div class="flex items-start justify-between p-2.5 bg-[#0A0E17] border border-[#1E2638] rounded">
      <div>
        <div class="flex items-baseline gap-2">
          <span class="text-base font-bold text-[#FF9E00] font-mono">{master.ticker}</span>
          <span class="text-sm font-semibold text-[#E2E8F0]">{master.company_name}</span>
          <span class="px-1.5 py-0.2 rounded bg-[#182030] text-2xs text-[#00D2FF]">{master.primary_exchange}</span>
        </div>
        <div class="flex items-center gap-2 text-2xs text-[#64748B] mt-1 font-mono">
          <span>CIK: <strong class="text-[#E2E8F0]">{master.cik}</strong></span>
          <span>|</span>
          <span>FIGI: <strong class="text-[#E2E8F0]">{master.figi}</strong></span>
          <span>|</span>
          <span>SECTOR: <strong class="text-[#00E676]">{master.gics_sector}</strong></span>
          <span>|</span>
          <span>SUB-IND: <strong class="text-[#E2E8F0]">{master.gics_sub_industry}</strong></span>
        </div>
      </div>

      <div class="text-right font-mono">
        <div class="text-2xs text-[#64748B]">MARKET CAP</div>
        <div class="text-sm font-bold text-[#E2E8F0]">${master.market_cap_billions.toLocaleString()}B</div>
      </div>
    </div>

    <!-- 8-Card Quantitative & Market Profile Grid -->
    <div class="grid grid-cols-4 gap-2">
      <!-- 60d Market Beta -->
      <div class="p-2 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">60D MARKET BETA (&beta;<sub>mkt</sub>)</span>
        <div class="flex items-baseline gap-1 mt-1 font-mono">
          <span class="text-sm font-bold text-[#00D2FF]">{master.beta_market_60d.toFixed(2)}</span>
          <span class="text-2xs text-[#64748B]">vs SPY</span>
        </div>
        <span class="text-2xs text-[#64748B] mt-0.5">Orthogonalized</span>
      </div>

      <!-- 60d Sector Beta -->
      <div class="p-2 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">60D SECTOR BETA (&beta;<sub>sec</sub>)</span>
        <div class="flex items-baseline gap-1 mt-1 font-mono">
          <span class="text-sm font-bold text-[#FF9E00]">{master.beta_sector_60d.toFixed(2)}</span>
          <span class="text-2xs text-[#64748B]">vs XLK</span>
        </div>
        <span class="text-2xs text-[#64748B] mt-0.5">Residualized</span>
      </div>

      <!-- 30d ADV -->
      <div class="p-2 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">30D ADV (SHARES)</span>
        <div class="flex items-baseline gap-1 mt-1 font-mono">
          <span class="text-sm font-bold text-[#E2E8F0]">{(master.adv_30d_shares / 1000000).toFixed(1)}M</span>
          <span class="text-2xs text-[#64748B]">/ day</span>
        </div>
        <span class="text-2xs text-[#64748B] mt-0.5">Liquid Tier 1</span>
      </div>

      <!-- Valuation Ratios -->
      <div class="p-2 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">P/E (LTM / FWD)</span>
        <div class="flex items-baseline gap-1 mt-1 font-mono">
          <span class="text-sm font-bold text-[#00E676]">{master.pe_ratio_ltm.toFixed(1)}x</span>
          <span class="text-2xs text-[#64748B]">/ {master.pe_forward ? `${master.pe_forward.toFixed(1)}x` : '--'}</span>
        </div>
        <span class="text-2xs text-[#64748B] mt-0.5">Div Yield: {master.dividend_yield_pct.toFixed(2)}%</span>
      </div>

      <!-- 52W High / Low Range -->
      <div class="col-span-2 p-2 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col justify-between">
        <div class="flex items-center justify-between text-2xs text-[#64748B]">
          <span>52-WEEK RANGE</span>
          <span class="font-mono text-[#E2E8F0]">${master.low_52w.toFixed(2)} - ${master.high_52w.toFixed(2)}</span>
        </div>
        <div class="w-full bg-[#182030] h-2 rounded-full relative mt-1.5 overflow-hidden">
          <div
            style="left: 20%; width: 60%"
            class="absolute top-0 bottom-0 bg-[#00D2FF]/40 rounded"
          ></div>
          <div
            style="left: 75%"
            class="absolute top-0 bottom-0 w-1 bg-[#FF9E00]"
            title="Current Range Position"
          ></div>
        </div>
        <div class="flex items-center justify-between text-2xs text-[#64748B] mt-1 font-mono">
          <span>Low: ${master.low_52w.toFixed(2)}</span>
          <span class="text-[#FF9E00]">Position: ~75%</span>
          <span>High: ${master.high_52w.toFixed(2)}</span>
        </div>
      </div>

      <!-- Corporate Identifiers -->
      <div class="col-span-2 p-2 bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col justify-between">
        <span class="text-2xs text-[#64748B]">CORPORATE SUMMARY</span>
        <div class="grid grid-cols-3 gap-1 mt-1 text-2xs font-mono">
          <div>
            <span class="text-[#64748B] block">HEADQUARTERS</span>
            <span class="text-[#E2E8F0] truncate block" title={master.headquarters}>{master.headquarters}</span>
          </div>
          <div>
            <span class="text-[#64748B] block">CEO</span>
            <span class="text-[#E2E8F0] truncate block" title={master.ceo}>{master.ceo}</span>
          </div>
          <div>
            <span class="text-[#64748B] block">EMPLOYEES</span>
            <span class="text-[#E2E8F0] block">{master.employees.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Point-in-Time Item 1 Business Summary -->
    <div class="flex-1 flex flex-col bg-[#0A0E17] border border-[#1E2638] rounded p-2.5 overflow-hidden">
      <div class="flex items-center justify-between border-b border-[#1E2638] pb-1 mb-2">
        <span class="text-2xs font-bold text-[#FF9E00] tracking-wider">
          POINT-IN-TIME ITEM 1 // BUSINESS DESCRIPTION
        </span>
        <span class="text-2xs text-[#64748B] font-mono">SEC EDGAR 10-K EXTRACTION</span>
      </div>
      <div class="flex-1 overflow-y-auto text-2xs text-[#CBD5E1] leading-relaxed pr-1 font-mono whitespace-pre-line">
        {master.business_summary}
      </div>
    </div>
  </div>
</div>

<style>
  .text-2xs {
    font-size: 0.6875rem; /* 11px */
    line-height: 0.95rem;
  }
</style>
