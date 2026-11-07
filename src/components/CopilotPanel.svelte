<script lang="ts">
  import { onMount, tick } from "svelte";
  import { ipcService } from "../lib/ipc";
  import type { ColorChannel, CopilotMessage } from "../lib/types";

  let {
    ticker = "NVDA",
    channel = "BLUE",
    isMaximized = false,
    onToggleMaximize,
    onChannelChange,
    onSwitchFunction,
    onExecuteCommand,
  }: {
    ticker?: string;
    channel?: ColorChannel;
    isMaximized?: boolean;
    onToggleMaximize?: () => void;
    onChannelChange?: (ch: ColorChannel) => void;
    onSwitchFunction?: (mnemonic: string) => void;
    onExecuteCommand?: (cmd: string) => void;
  } = $props();

  let inputQuery = $state("");
  let isThinking = $state(false);
  let chatContainer: HTMLDivElement | null = $state(null);

  let messages = $state<CopilotMessage[]>([
    {
      id: "msg-welcome",
      sender: "SYSTEM",
      timestamp_iso: new Date().toISOString(),
      text: "Amstal AI Copilot online. Powered by quantitative heuristic router and IPC semantic index. Ask questions regarding factor ranking, fractional Kelly sizing, forward-filtered HMM regimes, EDGAR redlines, or analyst consensus targets.",
      sources: ["Amstal Engine", "Local IPC JSON-RPC 2.0"],
      suggested_commands: ["NVDA PORT <GO>", "HMM <GO>", "NVDA ANR <GO>"],
    },
  ]);

  let suggestedQueries = $derived([
    `${ticker} Kelly Sizing`,
    "Current Volatility Regime",
    `${ticker} Form 4 Insider Cluster`,
    `${ticker} SPLC Peer Graph`,
    `${ticker} Analyst Consensus`,
  ]);

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

  async function scrollToBottom() {
    await tick();
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  async function handleSubmit(customQuery?: string) {
    const q = (customQuery ?? inputQuery).trim();
    if (!q || isThinking) return;

    inputQuery = "";

    // Append User Message
    const userMsg: CopilotMessage = {
      id: `usr-${Date.now()}`,
      sender: "USER",
      timestamp_iso: new Date().toISOString(),
      text: q,
    };
    messages = [...messages, userMsg];
    isThinking = true;
    await scrollToBottom();

    try {
      const resp = await ipcService.queryCopilot(q, ticker);
      const copilotMsg: CopilotMessage = {
        id: `ai-${Date.now()}`,
        sender: "COPILOT",
        timestamp_iso: new Date().toISOString(),
        text: resp.answer,
        sources: resp.sources,
        suggested_commands: resp.suggested_commands,
      };
      messages = [...messages, copilotMsg];
    } catch {
      messages = [
        ...messages,
        {
          id: `err-${Date.now()}`,
          sender: "SYSTEM",
          timestamp_iso: new Date().toISOString(),
          text: "Error connecting to local engine IPC router. Defaulting to cached workstation heuristics.",
        },
      ];
    } finally {
      isThinking = false;
      await scrollToBottom();
    }
  }

  function handleCommandClick(cmd: string) {
    if (onExecuteCommand) {
      onExecuteCommand(cmd);
    } else if (onSwitchFunction) {
      const tokens = cmd.replace(/<GO>/i, "").trim().split(/\s+/);
      const fn = tokens[tokens.length - 1].toUpperCase();
      onSwitchFunction(fn);
    }
  }

  onMount(() => {
    scrollToBottom();
  });
</script>

<div class="flex flex-col h-full w-full bg-[#0C111B] border border-[#172033] rounded select-none overflow-hidden text-xs font-mono">
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
      <span class="font-bold text-[#FFB000]">COPILOT &lt;GO&gt;</span>
      <span class="text-[#E6EDF5] font-semibold">{ticker} US</span>
      <span class="px-1.5 py-0.2 rounded bg-[#00FF66]/10 text-[#00FF66] border border-[#00FF66]/30 text-3xs font-bold">
        LOCAL ENGINE
      </span>
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

  <!-- Suggested Chips Bar -->
  <div class="flex items-center gap-1.5 px-3 py-1 bg-[#090D16] border-b border-[#172033] overflow-x-auto text-2xs">
    <span class="text-[#5E6D82] text-3xs uppercase font-bold tracking-wider mr-1">SUGGESTIONS:</span>
    {#each suggestedQueries as chip}
      <button
        onclick={() => handleSubmit(chip)}
        class="px-2 py-0.5 rounded-full bg-[#06090F] hover:bg-[#121824] text-[#00D2FF] border border-[#172033] text-3xs whitespace-nowrap transition-colors cursor-pointer"
      >
        {chip}
      </button>
    {/each}
  </div>

  <!-- Messages Chat Stream -->
  <div bind:this={chatContainer} class="flex-1 p-3 overflow-y-auto space-y-3 bg-[#06090F]">
    {#each messages as msg}
      {#if msg.sender === "USER"}
        <!-- User Chat Bubble -->
        <div class="flex flex-col items-end">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-3xs text-[#5E6D82]">{msg.timestamp_iso.substring(11, 19)} UTC</span>
            <span class="text-2xs font-bold text-[#FFB000]">ANALYST</span>
          </div>
          <div class="max-w-[85%] p-2.5 rounded bg-[#121824] border border-[#172033] text-[#E6EDF5] text-xs leading-relaxed">
            {msg.text}
          </div>
        </div>
      {:else if msg.sender === "COPILOT"}
        <!-- Copilot Response -->
        <div class="flex flex-col items-start">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-2xs font-bold text-[#00D2FF]">Amstal Copilot</span>
            <span class="px-1.5 py-0.2 rounded bg-[#00D2FF]/10 text-[#00D2FF] text-3xs font-semibold">LOCAL ENGINE</span>
            <span class="text-3xs text-[#5E6D82]">{msg.timestamp_iso.substring(11, 19)} UTC</span>
          </div>
          <div class="max-w-[90%] p-3 rounded bg-[#0C111B] border border-[#172033] text-[#E6EDF5] text-xs leading-relaxed space-y-2">
            <p>{msg.text}</p>

            <!-- Sources tags -->
            {#if msg.sources && msg.sources.length > 0}
              <div class="pt-1.5 border-t border-[#172033] flex items-center gap-2 flex-wrap text-3xs text-[#5E6D82]">
                <span class="font-bold text-[#8B98A5]">SOURCES:</span>
                {#each msg.sources as src}
                  <span class="px-1.5 py-0.5 rounded bg-[#06090F] border border-[#172033] text-[#8B98A5]">
                    {src}
                  </span>
                {/each}
              </div>
            {/if}

            <!-- Suggested Commands pills -->
            {#if msg.suggested_commands && msg.suggested_commands.length > 0}
              <div class="pt-1.5 border-t border-[#172033] flex items-center gap-2 flex-wrap text-3xs">
                <span class="font-bold text-[#FFB000]">EXECUTE:</span>
                {#each msg.suggested_commands as cmd}
                  <button
                    onclick={() => handleCommandClick(cmd)}
                    class="px-2 py-0.5 rounded bg-[#06090F] hover:bg-[#121824] text-[#FFB000] border border-[#FFB000]/40 font-bold transition-colors cursor-pointer"
                    title={`Click to execute ${cmd}`}
                  >
                    {cmd}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <!-- System Message -->
        <div class="p-2.5 rounded bg-[#0C111B] border border-[#172033] text-[#8B98A5] text-2xs leading-relaxed">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-3xs font-bold text-[#FFB000]">TELEMETRY</span>
            <span class="text-3xs text-[#5E6D82]">{msg.timestamp_iso.substring(11, 19)} UTC</span>
          </div>
          <p>{msg.text}</p>
          {#if msg.suggested_commands && msg.suggested_commands.length > 0}
            <div class="mt-2 flex items-center gap-2 flex-wrap text-3xs">
              <span class="text-[#5E6D82]">QUICK MNEMONICS:</span>
              {#each msg.suggested_commands as cmd}
                <button
                  onclick={() => handleCommandClick(cmd)}
                  class="px-2 py-0.5 rounded bg-[#06090F] hover:bg-[#121824] text-[#00D2FF] border border-[#172033] font-bold cursor-pointer"
                >
                  {cmd}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}

    {#if isThinking}
      <div class="flex items-center gap-2 text-2xs text-[#00D2FF] py-2 animate-pulse">
        <span class="w-1.5 h-1.5 rounded-full bg-[#00D2FF]"></span>
        <span>Evaluating quantitative heuristics & local semantics...</span>
      </div>
    {/if}
  </div>

  <!-- Prompt Input Bar -->
  <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="p-2 bg-[#090D16] border-t border-[#172033]">
    <div class="relative flex items-center">
      <span class="absolute left-3 text-[#FFB000] text-2xs font-extrabold select-none">
        AMSTAL&gt;
      </span>
      <input
        type="text"
        bind:value={inputQuery}
        placeholder="ASK QUANT QUESTION (e.g., NVDA Kelly Sizing)..."
        class="w-full pl-24 pr-16 py-1.5 text-xs bg-[#06090F] border border-[#172033] rounded text-[#E6EDF5] placeholder-[#3B4758] focus:outline-none focus:border-[#FFB000] focus:ring-1 focus:ring-[#FFB000]/40 transition-all font-mono"
      />
      <button
        type="submit"
        disabled={isThinking || !inputQuery.trim()}
        class="absolute right-1 px-3 py-1 text-2xs font-bold bg-[#FFB000] text-black rounded hover:bg-[#E09900] disabled:opacity-30 disabled:hover:bg-[#FFB000] transition-colors cursor-pointer"
      >
        GO
      </button>
    </div>
  </form>
</div>

<style>
  .text-2xs {
    font-size: 0.6875rem;
    line-height: 0.95rem;
  }
  .text-3xs {
    font-size: 0.5625rem;
    line-height: 0.75rem;
  }
</style>
