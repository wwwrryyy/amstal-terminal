<script lang="ts">
  import { ipcService } from "../lib/ipc";
  import type { ColorChannel, PeerGraphData, PeerGraphNode } from "../lib/types";

  let {
    ticker = "NVDA",
    channel = "BLUE",
    isMaximized = false,
    onToggleMaximize,
    onChannelChange,
    onSelectTicker,
    onSwitchFunction,
  }: {
    ticker?: string;
    channel?: ColorChannel;
    isMaximized?: boolean;
    onToggleMaximize?: () => void;
    onChannelChange?: (ch: ColorChannel) => void;
    onSelectTicker?: (newTicker: string) => void;
    onSwitchFunction?: (mnemonic: string) => void;
  } = $props();

  let graph = $derived<PeerGraphData>(ipcService.getPeerGraph(ticker));
  let selectedNodeId = $state<string | null>(null);

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

  // Node role visual theme
  const roleThemes: Record<string, { fill: string; stroke: string; label: string; textCol: string }> = {
    TARGET: { fill: "#FF9E00", stroke: "#FFE082", label: "TARGET v0", textCol: "text-[#FF9E00]" },
    GICS_PEER: { fill: "#00D2FF", stroke: "#80EAFF", label: "GICS PEER (0.33)", textCol: "text-[#00D2FF]" },
    LEAD_LAG: { fill: "#00E676", stroke: "#B9F6CA", label: "5D LEAD-LAG (0.66)", textCol: "text-[#00E676]" },
    SECTOR_ETF: { fill: "#A855F7", stroke: "#D8B4FE", label: "SECTOR ETF (1.00)", textCol: "text-[#A855F7]" },
  };

  // Fixed SVG canvas layout coordinates for deterministic institutional topology
  // Center: (250, 160)
  const nodePositions: Record<number, { x: number; y: number }> = {
    0: { x: 250, y: 160 }, // v0: Target center
    // GICS Peers (right cluster)
    1: { x: 380, y: 80 },  // v1
    2: { x: 420, y: 150 }, // v2
    3: { x: 410, y: 220 }, // v3
    4: { x: 340, y: 270 }, // v4
    // Lead-Lag Peers (left cluster)
    5: { x: 120, y: 70 },  // v5
    6: { x: 80, y: 140 },  // v6
    7: { x: 90, y: 220 },  // v7
    8: { x: 150, y: 270 }, // v8
    // Sector ETF (top center)
    9: { x: 250, y: 45 },  // v9
  };

  let selectedNode = $derived<PeerGraphNode | null>(
    selectedNodeId ? graph.nodes.find((n) => n.id === selectedNodeId) || null : null
  );

  function handleNodeClick(nodeId: string) {
    if (selectedNodeId === nodeId) {
      selectedNodeId = null;
    } else {
      selectedNodeId = nodeId;
    }
  }

  function handleSetAsActiveTicker(sym: string) {
    if (onSelectTicker) {
      onSelectTicker(sym);
    }
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
        title="Color Channel Link"
      >
        [{channel}]
      </button>
      <span class="font-bold text-[#FF9E00]">SPLC &lt;GO&gt;</span>
      <span class="text-[#E2E8F0] font-semibold">{ticker} US</span>
      <span class="text-[#64748B]">DYNAMIC ROLLING PEER GAT GRAPH (10 NODES)</span>
    </div>

    <div class="flex items-center gap-2">
      {#if onSwitchFunction}
        <div class="flex items-center gap-1 text-2xs">
          <button onclick={() => onSwitchFunction("GP")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00D2FF] hover:bg-[#1E2638]">GP</button>
          <button onclick={() => onSwitchFunction("PORT")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#FF9E00] hover:bg-[#1E2638]">PORT</button>
          <button onclick={() => onSwitchFunction("FA")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#E2E8F0] hover:bg-[#1E2638]">FA</button>
          <button onclick={() => onSwitchFunction("DES")} class="px-1.5 py-0.5 rounded bg-[#0A0E17] text-[#00E676] hover:bg-[#1E2638]">DES</button>
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

  <!-- Main Graph Area & Details Split -->
  <div class="flex-1 flex flex-col md:flex-row overflow-hidden p-2 gap-2">
    <!-- SVG Canvas -->
    <div class="flex-1 relative bg-[#0A0E17] border border-[#1E2638] rounded flex flex-col overflow-hidden">
      <!-- Top Metrics Banner inside canvas -->
      <div class="flex items-center justify-between px-3 py-1 bg-[#182030]/80 border-b border-[#1E2638]/60 text-2xs font-mono">
        <div class="flex items-center gap-3">
          <span>GAT ENTROPY: <strong class="text-[#00D2FF]">{graph.gat_attention_entropy?.toFixed(2) ?? '1.84'}</strong></span>
          <span>SPILLOVER LEADER: <strong class="text-[#00E676]">{graph.top_spillover_contributor ?? 'TSM'}</strong></span>
        </div>
        <div class="flex items-center gap-2">
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[#FF9E00]"></span>Target</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[#00D2FF]"></span>GICS</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[#00E676]"></span>Lead-Lag (5D)</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[#A855F7]"></span>ETF</span>
        </div>
      </div>

      <!-- Interactive SVG Graph -->
      <div class="flex-1 flex items-center justify-center p-2">
        <svg viewBox="0 0 500 320" class="w-full h-full max-h-[360px] select-none font-mono">
          <defs>
            <!-- Arrow markers for lead-lag spillover direction -->
            <marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#00E676" />
            </marker>
            <marker id="arrow-gics" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#00D2FF" opacity="0.6" />
            </marker>
          </defs>

          <!-- Render Edges -->
          {#each graph.edges as edge}
            {@const srcNodeIdx = graph.nodes.findIndex((n) => n.id === edge.source)}
            {@const tgtNodeIdx = graph.nodes.findIndex((n) => n.id === edge.target)}
            {@const srcPos = nodePositions[srcNodeIdx !== -1 ? srcNodeIdx : 0]}
            {@const tgtPos = nodePositions[tgtNodeIdx !== -1 ? tgtNodeIdx : 0]}
            {@const isLeadLag = edge.lead_days !== undefined}
            {@const isSelected = selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId)}

            <line
              x1={srcPos.x}
              y1={srcPos.y}
              x2={tgtPos.x}
              y2={tgtPos.y}
              stroke={isSelected ? "#FF9E00" : isLeadLag ? "#00E676" : "#00D2FF"}
              stroke-width={isSelected ? 3.0 : Math.max(1.2, edge.attention_weight * 9.0)}
              stroke-opacity={isSelected ? 1.0 : 0.45}
              stroke-dasharray={isLeadLag ? "4,3" : "none"}
              marker-end={isLeadLag ? "url(#arrow)" : "url(#arrow-gics)"}
            />

            <!-- Edge Attention Label on hover or selected -->
            {#if isSelected || edge.attention_weight > 0.15}
              {@const midX = (srcPos.x + tgtPos.x) / 2}
              {@const midY = (srcPos.y + tgtPos.y) / 2}
              <text
                x={midX}
                y={midY}
                fill={isSelected ? "#FF9E00" : "#64748B"}
                font-size="8"
                text-anchor="middle"
                dy="-3"
                class="pointer-events-none"
              >
                &alpha;={(edge.attention_weight * 100).toFixed(0)}%
              </text>
            {/if}
          {/each}

          <!-- Render Nodes -->
          {#each graph.nodes as node, idx}
            {@const pos = nodePositions[idx] || { x: 250, y: 160 }}
            {@const theme = roleThemes[node.role] || roleThemes.GICS_PEER}
            {@const isTarget = node.role === "TARGET"}
            {@const isSelected = selectedNodeId === node.id}
            {@const radius = isTarget ? 22 : 16}

            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <g
              onclick={() => handleNodeClick(node.id)}
              class="cursor-pointer transition-transform hover:scale-110"
            >
              <!-- Outer halo ring on selected -->
              {#if isSelected}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={radius + 5}
                  fill="none"
                  stroke="#FF9E00"
                  stroke-width="2"
                  stroke-dasharray="3,2"
                />
              {/if}

              <!-- Node Body -->
              <circle
                cx={pos.x}
                cy={pos.y}
                r={radius}
                fill="#111622"
                stroke={isSelected ? "#FF9E00" : theme.stroke}
                stroke-width={isTarget ? 3 : 2}
              />

              <!-- Node Center Dot -->
              <circle
                cx={pos.x}
                cy={pos.y}
                r={radius * 0.45}
                fill={theme.fill}
                opacity="0.25"
              />

              <!-- Ticker Text -->
              <text
                x={pos.x}
                y={pos.y + 4}
                fill={isSelected ? "#FF9E00" : "#E2E8F0"}
                font-size={isTarget ? "11" : "9"}
                font-weight="bold"
                text-anchor="middle"
              >
                {node.label}
              </text>
            </g>
          {/each}
        </svg>
      </div>
    </div>

    <!-- Right Sidebar: Node Details & Lead-Lag Breakdown -->
    <div class="w-full md:w-64 bg-[#0A0E17] border border-[#1E2638] rounded p-2.5 flex flex-col justify-between text-2xs">
      <div>
        <div class="border-b border-[#1E2638] pb-1.5 mb-2">
          <span class="font-bold text-[#FF9E00] tracking-wider block">INSPECTION NODE</span>
          <span class="text-[#64748B]">Click any node in graph to inspect</span>
        </div>

        {#if selectedNode}
          {@const theme = roleThemes[selectedNode.role]}
          <div class="space-y-2 font-mono">
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold {theme.textCol}">{selectedNode.label}</span>
              <span class="px-1.5 py-0.5 rounded bg-[#182030] text-2xs text-[#E2E8F0]">{theme.label}</span>
            </div>

            <div class="p-2 bg-[#111622] rounded border border-[#1E2638] space-y-1">
              <div class="flex justify-between text-[#64748B]">
                <span>ROLE CODE:</span>
                <span class="text-[#E2E8F0]">{selectedNode.role_code}</span>
              </div>
              {#if selectedNode.cross_corr_5d !== undefined}
                <div class="flex justify-between text-[#64748B]">
                  <span>5D LEAD-LAG CORR:</span>
                  <span class="text-[#00E676] font-bold">+{selectedNode.cross_corr_5d.toFixed(2)}</span>
                </div>
              {/if}
              <div class="flex justify-between text-[#64748B]">
                <span>MARKET BETA:</span>
                <span class="text-[#00D2FF]">{selectedNode.beta_market?.toFixed(2) ?? '1.15'}</span>
              </div>
            </div>

            {#if selectedNode.id !== ticker}
              <button
                onclick={() => handleSetAsActiveTicker(selectedNode.id)}
                class="w-full py-1.5 rounded font-bold bg-[#FF9E00] text-black hover:bg-[#E08A00] transition-colors mt-2"
              >
                FOCUS [{selectedNode.id}] WORKSPACE &gt;
              </button>
            {/if}
          </div>
        {:else}
          <!-- Default target overview -->
          <div class="space-y-2 text-[#64748B] font-mono">
            <div>TARGET ANCHOR: <strong class="text-[#FF9E00]">{ticker}</strong></div>
            <p class="leading-relaxed">
              10-node localized subgraph extracted per PRD Section 5.7:
              4 GICS sub-industry peers, 4 5-day lead-lag cross-correlation stocks, and sector benchmark ETF.
            </p>
            <div class="p-2 bg-[#111622] rounded border border-[#1E2638] space-y-1">
              <div>&bull; Cyan Nodes: GICS Sub-Industry</div>
              <div>&bull; Green Nodes: 5D Lead-Lag Network</div>
              <div>&bull; Purple Node: Sector ETF</div>
              <div>&bull; Line Thickness: GAT Attention (&alpha;<sub>ij</sub>)</div>
            </div>
          </div>
        {/if}
      </div>

      <div class="border-t border-[#1E2638] pt-2 text-[#64748B] text-2xs font-mono">
        <div>GRAPH ARCHITECTURE: PEER GAT (CPU)</div>
        <div>STRICT ZERO-LOOKAHEAD ENFORCED</div>
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
