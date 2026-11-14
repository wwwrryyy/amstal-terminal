<script lang="ts">
  import { onMount, onDestroy } from "svelte";
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

  let graph = $state<PeerGraphData | null>(ipcService.getPeerGraph("NVDA"));
  let selectedNodeId = $state<string | null>(null);
  let connState = $state<string>(ipcService.connectionState);
  let isLoading = $state<boolean>(false);
  let unsubscribeStatus: (() => void) | null = null;
  let unsubscribeIpc: (() => void) | null = null;

  $effect(() => {
    const sym = ticker;
    const connected = connState === "CONNECTED";
    if (sym) {
      const cached = ipcService.getPeerGraph(sym);
      graph = cached;
      selectedNodeId = null;
      if (connected) {
        if (!cached) isLoading = true;
        ipcService
          .fetchPeerGraph(sym)
          .then((fresh) => {
            if (fresh && sym === ticker) graph = fresh;
          })
          .finally(() => {
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
    unsubscribeIpc = ipcService.subscribe(() => {
      const updated = ipcService.getPeerGraph(ticker);
      if (updated) graph = updated;
    });
  });

  onDestroy(() => {
    if (unsubscribeStatus) unsubscribeStatus();
    if (unsubscribeIpc) unsubscribeIpc();
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
    selectedNodeId && graph ? graph.nodes.find((n) => n.id === selectedNodeId) || null : null
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
      <span class="font-bold text-[#FFB000]">SPLC &lt;GO&gt;</span>
      <span class="text-[#E6EDF5] font-semibold">{ticker} US</span>
      <span class="text-3xs text-[#5E6D82] font-mono">PEER GAT GRAPH (10N)</span>
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

  <!-- Main Graph Area & Details Split -->
  <div class="flex-1 flex flex-col md:flex-row overflow-hidden p-2 gap-2">
    <!-- SVG Canvas -->
    <div class="flex-1 relative bg-[#06090F] border border-[#172033] rounded flex flex-col overflow-hidden">
      <!-- Top Metrics Banner inside canvas -->
      <div class="flex items-center justify-between px-3 py-1 bg-[#090D16] border-b border-[#172033] text-2xs font-mono">
        <div class="flex items-center gap-3">
          <span>
            GAT ENTROPY: <strong class="text-[#00D2FF]">
              {graph?.gat_attention_entropy !== undefined && graph?.gat_attention_entropy !== null
                ? graph.gat_attention_entropy.toFixed(2)
                : "—"}
            </strong>
          </span>
          <span>
            SPILLOVER LEADER: <strong class="text-[#00FF66]">{graph?.top_spillover_contributor || "—"}</strong>
          </span>
        </div>
        <div class="flex items-center gap-2">
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[#FFB000]"></span>Target</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[#00D2FF]"></span>GICS</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[#00FF66]"></span>Lead-Lag</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[#A855F7]"></span>ETF</span>
        </div>
      </div>

      <!-- Interactive SVG Graph -->
      <div class="flex-1 flex items-center justify-center p-2">
        {#if !graph || graph.nodes.length === 0}
          <div class="text-center font-mono px-4">
            <div class="text-xs font-bold {isLoading ? 'text-[#00D2FF]' : 'text-[#FFB000]'}">
              {isLoading ? `BUILDING PEER SUBGRAPH FOR ${ticker}…` : connState === "CONNECTED" ? `NO PEER GRAPH NODES FOR ${ticker}` : "ENGINE DAEMON OFFLINE — NO SIMULATED PEER GRAPH"}
            </div>
            <div class="text-2xs text-[#5E6D82] mt-1">
              Connect the live QARE-MM Python daemon on ws://127.0.0.1:8194 to inspect 60d GICS &amp; lead-lag spillover attention.
            </div>
          </div>
        {:else}
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
            {@const srcPos = nodePositions[srcNodeIdx !== -1 ? srcNodeIdx : 0] || { x: 250, y: 160 }}
            {@const tgtPos = nodePositions[tgtNodeIdx !== -1 ? tgtNodeIdx : 0] || { x: 250, y: 160 }}
            {@const isLeadLag = edge.lead_days !== undefined && edge.lead_days !== null}
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

            <g
              onclick={() => handleNodeClick(node.id)}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleNodeClick(node.id);
                }
              }}
              role="button"
              tabindex="0"
              aria-label={`Inspect ${node.label} (${node.role})`}
              class="cursor-pointer transition-transform hover:scale-110 focus:outline-none"
            >
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

              <circle
                cx={pos.x}
                cy={pos.y}
                r={radius}
                fill="#111622"
                stroke={isSelected ? "#FF9E00" : theme.stroke}
                stroke-width={isTarget ? 3 : 2}
              />

              <circle
                cx={pos.x}
                cy={pos.y}
                r={radius * 0.45}
                fill={theme.fill}
                opacity="0.25"
              />

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
        {/if}
      </div>
    </div>

    <!-- Right Sidebar: Node Details & Lead-Lag Breakdown -->
    <div class="w-full md:w-64 bg-[#06090F] border border-[#172033] rounded p-2.5 flex flex-col justify-between text-2xs">
      <div>
        <div class="border-b border-[#172033] pb-1.5 mb-2">
          <span class="font-bold text-[#FFB000] tracking-wider block">INSPECTION NODE</span>
          <span class="text-[#5E6D82]">Click any node in graph to inspect</span>
        </div>

        {#if selectedNode}
          {@const theme = roleThemes[selectedNode.role]}
          <div class="space-y-2 font-mono">
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold {theme.textCol}">{selectedNode.label}</span>
              <span class="px-1.5 py-0.5 rounded bg-[#121824] border border-[#172033] text-2xs text-[#E6EDF5]">{theme.label}</span>
            </div>

            <div class="p-2 bg-[#0C111B] rounded border border-[#172033] space-y-1">
              <div class="flex justify-between text-[#5E6D82]">
                <span>ROLE CODE:</span>
                <span class="text-[#E6EDF5]">{selectedNode.role_code}</span>
              </div>
              {#if selectedNode.cross_corr_5d !== undefined && selectedNode.cross_corr_5d !== null}
                <div class="flex justify-between text-[#5E6D82]">
                  <span>5D LEAD-LAG CORR:</span>
                  <span class="{selectedNode.cross_corr_5d >= 0 ? 'text-[#00FF66]' : 'text-[#FF3344]'} font-bold">
                    {selectedNode.cross_corr_5d >= 0 ? "+" : ""}{selectedNode.cross_corr_5d.toFixed(2)}
                  </span>
                </div>
              {/if}
              <div class="flex justify-between text-[#5E6D82]">
                <span>MARKET BETA (60D):</span>
                <span class="text-[#00D2FF]">
                  {selectedNode.beta_market !== null && selectedNode.beta_market !== undefined
                    ? selectedNode.beta_market.toFixed(2)
                    : "N/A"}
                </span>
              </div>
            </div>

            {#if selectedNode.id !== ticker}
              <button
                onclick={() => handleSetAsActiveTicker(selectedNode.id)}
                class="w-full py-1.5 rounded font-bold bg-[#FFB000] text-black hover:bg-[#E09900] transition-colors mt-2"
              >
                FOCUS [{selectedNode.id}] WORKSPACE &gt;
              </button>
            {/if}
          </div>
        {:else}
          <!-- Default target overview -->
          <div class="space-y-2 text-[#5E6D82] font-mono">
            <div>TARGET ANCHOR: <strong class="text-[#FFB000]">{ticker}</strong></div>
            <p class="leading-relaxed text-[#8B98A5]">
              10-node localized subgraph:
              4 GICS peers, 4 5-day lead-lag cross-correlation stocks, and sector ETF.
            </p>
            <div class="p-2 bg-[#0C111B] rounded border border-[#172033] space-y-1">
              <div>&bull; Cyan Nodes: GICS Sub-Industry</div>
              <div>&bull; Green Nodes: 5D Lead-Lag Network</div>
              <div>&bull; Purple Node: Sector ETF</div>
              <div>&bull; Line Thickness: Attention (&alpha;<sub>ij</sub>)</div>
            </div>
          </div>
        {/if}
      </div>

      <div class="border-t border-[#172033] pt-2 text-[#5E6D82] text-2xs font-mono">
        <div>GRAPH ARCHITECTURE: PEER GAT</div>
        <div>ZERO-LOOKAHEAD ENFORCED</div>
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
