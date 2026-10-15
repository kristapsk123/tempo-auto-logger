<script lang="ts">
  import type { ClaudeMessage, ClaudeRowEvidence } from '../lib/claude-timesheet-client';
  import { theme } from '../lib/theme.svelte';

  let { evidence }: { evidence: ClaudeRowEvidence } = $props();

  // Links come from a local file, so only GitHub pages are opened.
  const SAFE_LINK_PREFIX = 'https://github.com/';
  const SHORT_HASH_LENGTH = 7;

  let isShowingCommits = $state(false);
  let isShowingMessages = $state(false);

  const commits = $derived(evidence.commits ?? []);
  const pullRequests = $derived(evidence.pullRequests ?? []);
  const messages = $derived(evidence.messages ?? []);
  const conversations = $derived(groupByChannel(messages));

  function n(neonClass: string, baseClass: string): string {
    return theme.neon ? neonClass : baseClass;
  }

  function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
  }

  function isSafeLink(url: string | undefined): url is string {
    return !!url && url.startsWith(SAFE_LINK_PREFIX);
  }

  function openLink(url: string | undefined) {
    if (isSafeLink(url)) chrome.tabs.create({ url });
  }

  function groupByChannel(list: ClaudeMessage[]): Array<{ channel: string; messages: ClaudeMessage[] }> {
    const groups = new Map<string, ClaudeMessage[]>();
    for (const message of list) {
      if (!groups.has(message.channel)) groups.set(message.channel, []);
      groups.get(message.channel)!.push(message);
    }
    return [...groups.entries()].map(([channel, channelMessages]) => ({ channel, messages: channelMessages }));
  }

  function authorOf(message: ClaudeMessage): string {
    if (message.isOwn) return 'you';
    return message.author ?? 'them';
  }

  const chipClass = 'px-1.5 py-0.5 rounded-md border leading-none transition-colors';
</script>

<div class="mx-2.5 mb-1.5 space-y-1">
  <div class="flex flex-wrap gap-1.5 text-[10px]">
    {#if commits.length > 0}
      <button
        class="{chipClass} {n('border-neon-orange/40 text-neon-orange hover:bg-retro-surface', 'border-orange-200 text-orange-600 hover:bg-orange-50')}"
        title="{isShowingCommits ? 'Hide' : 'Show'} the commits behind this row"
        onclick={() => (isShowingCommits = !isShowingCommits)}
      >⎇ {plural(commits.length, 'commit')}</button>
    {/if}
    {#each pullRequests as pullRequest (`${pullRequest.repo}#${pullRequest.number}`)}
      <button
        class="{chipClass} {n('border-neon-purple/40 text-neon-purple hover:bg-retro-surface disabled:opacity-60', 'border-purple-200 text-purple-600 hover:bg-purple-50 disabled:opacity-60')}"
        title="{pullRequest.repo}#{pullRequest.number}: {pullRequest.title}{isSafeLink(pullRequest.url) ? '' : ' (no link: the repository is not cloned locally)'}"
        disabled={!isSafeLink(pullRequest.url)}
        onclick={() => openLink(pullRequest.url)}
      >PR #{pullRequest.number}{isSafeLink(pullRequest.url) ? ' ↗' : ''}</button>
    {/each}
    {#if messages.length > 0}
      <button
        class="{chipClass} {n('border-neon-blue/40 text-neon-blue hover:bg-retro-surface', 'border-sky-200 text-sky-700 hover:bg-sky-50')}"
        title="{isShowingMessages ? 'Hide' : 'Show'} the Slack conversations behind this row"
        onclick={() => (isShowingMessages = !isShowingMessages)}
      >💬 {plural(messages.length, 'message')}</button>
    {/if}
  </div>

  {#if isShowingCommits}
    <div class="rounded-md px-2 py-1 space-y-0.5 {n('bg-retro-surface', 'bg-slate-50')}">
      {#each commits as commit (commit.hash)}
        <div class="flex gap-2 items-baseline text-[11px]">
          <span class="text-[10px] tabular-nums shrink-0 {n('text-retro-dim', 'text-slate-400')}">{commit.time}</span>
          {#if isSafeLink(commit.url)}
            <button
              class="font-mono text-[10px] shrink-0 hover:underline {n('text-neon-orange hover:text-neon-orange-dark', 'text-orange-500 hover:text-orange-600')}"
              title="Open commit on GitHub"
              onclick={() => openLink(commit.url)}
            >{commit.hash.slice(0, SHORT_HASH_LENGTH)}</button>
          {:else}
            <span class="font-mono text-[10px] shrink-0 {n('text-neon-orange', 'text-orange-500')}" title="No link: the repository's GitHub address is not known">{commit.hash.slice(0, SHORT_HASH_LENGTH)}</span>
          {/if}
          <span class="text-[10px] shrink-0 {n('text-retro-muted', 'text-slate-400')}">{commit.repo}</span>
          <span class="truncate {n('text-retro-text', 'text-slate-600')}" title={commit.subject}>{commit.subject}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if isShowingMessages}
    <div class="rounded-md px-2 py-1 space-y-1.5 {n('bg-retro-surface', 'bg-slate-50')}">
      {#each conversations as conversation (conversation.channel)}
        <div class="space-y-0.5">
          <div class="text-[10px] font-medium {n('text-neon-blue', 'text-sky-700')}">{conversation.channel}</div>
          {#each conversation.messages as message}
            <div class="flex gap-2 items-baseline text-[11px]">
              <span class="text-[10px] tabular-nums shrink-0 {n('text-retro-dim', 'text-slate-400')}">{message.time}</span>
              <span class="text-[10px] shrink-0 font-medium {message.isOwn ? n('text-neon-green', 'text-emerald-600') : n('text-retro-bright', 'text-slate-700')}">{authorOf(message)}</span>
              <span class="whitespace-pre-wrap break-words {n('text-retro-text', 'text-slate-600')}">{message.text}</span>
            </div>
          {/each}
        </div>
      {/each}
      {#if evidence.omittedMessageCount}
        <div class="text-[10px] {n('text-retro-dim', 'text-slate-400')}">+{evidence.omittedMessageCount} more messages not shown</div>
      {/if}
    </div>
  {/if}
</div>
