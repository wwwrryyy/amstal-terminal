<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    createChart,
    ColorType,
    CrosshairMode,
    LineStyle,
    type IChartApi,
    type ISeriesApi,
    type IPriceLine,
    type SeriesMarker,
    type Time,
  } from "lightweight-charts";
  import { ipcService } from "../lib/ipc";
  import { generateHistoricalCandles } from "../lib/data_lake";
  import type { ColorChannel, OHLCVBar, QARESignalFrame, TickData } from "../lib/types";

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

  let chartContainer: HTMLDivElement | null = $state(null);
  let chart: IChartApi | null = null;
  let candleSeries: ISeriesApi<"Candlestick"> | null = null;
  let volumeSeries: ISeriesApi<"Histogram"> | null = null;

  // Price lines for Triple Barriers
  let tpLine: IPriceLine | null = null;
  let slLine: IPriceLine | null = null;
  let entryLine: IPriceLine | null = null;

  // Options
  let timeframe = $state<"1H" | "4H" | "1D">("1D");
  let showBarriers = $state(true);
  let showVolume = $state(true);

  // Crosshair hover state
  let hoverData = $state<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  } | null>(null);

  // Active signal & tick
  let currentSignal = $state<QARESignalFrame>(ipcService.getSignal("NVDA"));
  let currentTick = $state<TickData>(ipcService.getTick("NVDA"));

  let resizeObserver: ResizeObserver | null = null;
  let unsubscribeIpc: (() => void) | null = null;
  let bars: OHLCVBar[] = [];

  function initChart() {
    if (!chartContainer) return;

    if (chart) {
      chart.remove();
      chart = null;
    }

    const { clientWidth, clientHeight } = chartContainer;

    chart = createChart(chartContainer, {
      width: clientWidth || 600,
      height: clientHeight || 380,
      layout: {
        background: { type: ColorType.Solid, color: "#06090F" },
        textColor: "#5E6D82",
        fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#121824", style: LineStyle.Dotted },
        horzLines: { color: "#121824", style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#00D2FF",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#121824",
        },
        horzLine: {
          color: "#00D2FF",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#121824",
        },
      },
      rightPriceScale: {
        borderColor: "#172033",
        scaleMargins: {
          top: 0.12,
          bottom: 0.22,
        },
      },
      timeScale: {
        borderColor: "#172033",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    candleSeries = chart.addCandlestickSeries({
      upColor: "#00E676",
      downColor: "#FF3366",
      borderUpColor: "#00E676",
      borderDownColor: "#FF3366",
      wickUpColor: "#00E676",
      wickDownColor: "#FF3366",
    });

    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "", // overlay scale
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    loadData();

    // Crosshair hover listener
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData || !candleSeries) {
        hoverData = null;
        return;
      }
      const candle = param.seriesData.get(candleSeries) as any;
      if (candle) {
        hoverData = {
          time: String(param.time),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        };
      }
    });

    // Resize observer
    resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0 || !chart) return;
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(chartContainer);
  }

  function loadData() {
    if (!candleSeries || !volumeSeries || !chart) return;

    bars = generateHistoricalCandles(ticker, timeframe === "1D" ? 90 : 120);

    const candleData = bars.map((b) => ({
      time: b.time as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    const volData = bars.map((b) => ({
      time: b.time as Time,
      value: b.volume,
      color: b.close >= b.open ? "rgba(0, 230, 118, 0.25)" : "rgba(255, 51, 102, 0.25)",
    }));

    candleSeries.setData(candleData);
    if (showVolume) {
      volumeSeries.setData(volData);
    } else {
      volumeSeries.setData([]);
    }

    renderTripleBarriers();
    chart.timeScale().fitContent();
  }

  function renderTripleBarriers() {
    if (!candleSeries) return;

    // Remove existing lines
    if (tpLine) {
      candleSeries.removePriceLine(tpLine);
      tpLine = null;
    }
    if (slLine) {
      candleSeries.removePriceLine(slLine);
      slLine = null;
    }
    if (entryLine) {
      candleSeries.removePriceLine(entryLine);
      entryLine = null;
    }

    if (!showBarriers || bars.length === 0) {
      candleSeries.setMarkers([]);
      return;
    }

    const rec = currentSignal.execution_recommendation;
    const entryPrice = rec.entry_price || bars[bars.length - 1].close;
    const tpPrice = rec.dynamic_take_profit || +(entryPrice * 1.07).toFixed(2);
    const slPrice = rec.dynamic_stop_loss || +(entryPrice * 0.965).toFixed(2);

    // 1. Take Profit Barrier (Horizontal Upper)
    tpLine = candleSeries.createPriceLine({
      price: tpPrice,
      color: "#00E676",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `TP: $${tpPrice.toFixed(2)} (+2.0 ATR)`,
    });

    // 2. Entry Price Level
    entryLine = candleSeries.createPriceLine({
      price: entryPrice,
      color: "#00D2FF",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: `ENTRY: $${entryPrice.toFixed(2)}`,
    });

    // 3. Stop Loss Barrier (Horizontal Lower)
    slLine = candleSeries.createPriceLine({
      price: slPrice,
      color: "#FF3366",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `SL: $${slPrice.toFixed(2)} (-1.0 ATR)`,
    });

    // 4. Vertical Time Barrier marker at last bar
    const lastBar = bars[bars.length - 1];
    const markers: SeriesMarker<Time>[] = [
      {
        time: lastBar.time as Time,
        position: "aboveBar",
        color: "#FF9E00",
        shape: "arrowDown",
        text: "T_0 ENTRY",
      },
    ];
    candleSeries.setMarkers(markers);
  }

  // Effect to react to ticker changes
  $effect(() => {
    if (ticker) {
      currentSignal = ipcService.getSignal(ticker);
      currentTick = ipcService.getTick(ticker);
      loadData();
    }
  });

  onMount(() => {
    initChart();

    unsubscribeIpc = ipcService.subscribe((frame) => {
      const sym = ticker.toUpperCase();
      if (frame.ticks && frame.ticks[sym]) {
        currentTick = frame.ticks[sym];
        // Update the last candle with live tick
        if (candleSeries && bars.length > 0) {
          const last = bars[bars.length - 1];
          const newPrice = currentTick.price;
          const updatedLast = {
            time: last.time as Time,
            open: last.open,
            high: Math.max(last.high, newPrice),
            low: Math.min(last.low, newPrice),
            close: newPrice,
          };
          candleSeries.update(updatedLast);
        }
      }
      if (frame.signals && frame.signals[sym]) {
        currentSignal = frame.signals[sym];
        renderTripleBarriers();
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeIpc) unsubscribeIpc();
    if (resizeObserver) resizeObserver.disconnect();
    if (chart) {
      chart.remove();
      chart = null;
    }
  });

  function toggleBarriers() {
    showBarriers = !showBarriers;
    renderTripleBarriers();
  }

  function toggleVolume() {
    showVolume = !showVolume;
    if (volumeSeries && bars.length > 0) {
      if (showVolume) {
        const volData = bars.map((b) => ({
          time: b.time as Time,
          value: b.volume,
          color: b.close >= b.open ? "rgba(0, 230, 118, 0.25)" : "rgba(255, 51, 102, 0.25)",
        }));
        volumeSeries.setData(volData);
      } else {
        volumeSeries.setData([]);
      }
    }
  }

  function handleTimeframeChange(tf: "1H" | "4H" | "1D") {
    timeframe = tf;
    loadData();
  }
</script>

<div class="flex flex-col h-full w-full bg-[#0C111B] border border-[#172033] rounded select-none overflow-hidden">
  <!-- Panel Subheader / Toolstrip -->
  <div class="flex items-center justify-between px-3 py-1 bg-[#090D16] border-b border-[#172033] text-xs">
    <div class="flex items-center gap-2">
      <!-- Color Channel Link Pill -->
      <button
        onclick={cycleChannel}
        class="px-1.5 py-0.5 rounded text-2xs font-bold border transition-colors {channelColors[channel].bg} {channelColors[channel].text} {channelColors[channel].border}"
        title="Color Channel Link"
      >
        [{channel}]
      </button>
      <span class="font-bold text-[#00D2FF]">GP &lt;GO&gt;</span>
      <span class="text-[#E6EDF5] font-semibold">{ticker} US</span>

      <!-- Live Tick Pill -->
      <span class="ml-2 font-mono font-bold {currentTick.change >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
        ${currentTick.price.toFixed(2)}
      </span>
      <span class="text-2xs font-mono {currentTick.change >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'}">
        {currentTick.change >= 0 ? "+" : ""}{currentTick.change.toFixed(2)} ({currentTick.change_pct >= 0 ? "+" : ""}{currentTick.change_pct.toFixed(2)}%)
      </span>
    </div>

    <!-- Controls -->
    <div class="flex items-center gap-2">
      <!-- Timeframe selector -->
      <div class="flex items-center bg-[#06090F] rounded border border-[#172033] p-0.5 text-2xs font-mono">
        <button
          onclick={() => handleTimeframeChange("1H")}
          class="px-2 py-0.5 rounded transition-colors {timeframe === '1H' ? 'bg-[#151D2E] text-[#00D2FF] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          1H
        </button>
        <button
          onclick={() => handleTimeframeChange("4H")}
          class="px-2 py-0.5 rounded transition-colors {timeframe === '4H' ? 'bg-[#151D2E] text-[#00D2FF] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          4H
        </button>
        <button
          onclick={() => handleTimeframeChange("1D")}
          class="px-2 py-0.5 rounded transition-colors {timeframe === '1D' ? 'bg-[#151D2E] text-[#00D2FF] font-bold' : 'text-[#5E6D82] hover:text-[#E6EDF5]'}"
        >
          1D
        </button>
      </div>

      <!-- Overlays Toggles -->
      <button
        onclick={toggleBarriers}
        class="px-2 py-0.5 text-2xs rounded border transition-colors {showBarriers ? 'border-[#00FF66]/50 bg-[#00FF66]/10 text-[#00FF66]' : 'border-[#172033] bg-[#06090F] text-[#5E6D82]'}"
      >
        BARRIERS
      </button>

      <button
        onclick={toggleVolume}
        class="px-2 py-0.5 text-2xs rounded border transition-colors {showVolume ? 'border-[#00D2FF]/50 bg-[#00D2FF]/10 text-[#00D2FF]' : 'border-[#172033] bg-[#06090F] text-[#5E6D82]'}"
      >
        VOL
      </button>

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

  <!-- Metric Badges Bar -->
  <div class="flex items-center justify-between px-3 py-1 bg-[#0C111B] border-b border-[#172033] text-2xs font-mono">
    <div class="flex items-center gap-4 text-[#8B98A5]">
      <div>
        <span class="text-[#5E6D82]">TP (Upper):</span>
        <span class="text-[#00FF66] font-bold">${currentSignal.execution_recommendation.dynamic_take_profit.toFixed(2)}</span>
      </div>
      <div>
        <span class="text-[#5E6D82]">ENTRY:</span>
        <span class="text-[#00D2FF] font-bold">${currentSignal.execution_recommendation.entry_price.toFixed(2)}</span>
      </div>
      <div>
        <span class="text-[#5E6D82]">SL (Lower):</span>
        <span class="text-[#FF3344] font-bold">${currentSignal.execution_recommendation.dynamic_stop_loss.toFixed(2)}</span>
      </div>
      <div>
        <span class="text-[#5E6D82]">R:R:</span>
        <span class="text-[#FFB000] font-bold">{currentSignal.execution_recommendation.reward_to_risk_ratio.toFixed(1)}x</span>
      </div>
      <div>
        <span class="text-[#5E6D82]">HORIZON:</span>
        <span class="text-[#E6EDF5] font-bold">{currentSignal.horizon_days}D VERTICAL</span>
      </div>
    </div>

    <!-- Candlestick hover crosshair details -->
    {#if hoverData}
      <div class="flex items-center gap-2 text-[#5E6D82]">
        <span>DATE: <strong class="text-[#E6EDF5]">{hoverData.time}</strong></span>
        <span>O: <strong class="text-[#E6EDF5]">${hoverData.open.toFixed(2)}</strong></span>
        <span>H: <strong class="text-[#00FF66]">${hoverData.high.toFixed(2)}</strong></span>
        <span>L: <strong class="text-[#FF3344]">${hoverData.low.toFixed(2)}</strong></span>
        <span>C: <strong class="text-[#00D2FF]">${hoverData.close.toFixed(2)}</strong></span>
      </div>
    {:else}
      <div class="text-[#5E6D82] text-2xs">
        100ms CONFLATION | ATR TRIPLE BARRIERS
      </div>
    {/if}
  </div>

  <!-- Lightweight Charts canvas container -->
  <div class="flex-1 relative w-full h-full min-h-[180px] bg-[#06090F]">
    <div bind:this={chartContainer} class="absolute inset-0 w-full h-full"></div>
  </div>
</div>

<style>
  .text-2xs {
    font-size: 0.6875rem; /* 11px */
    line-height: 0.95rem;
  }
</style>
