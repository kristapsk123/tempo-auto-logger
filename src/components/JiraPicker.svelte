<script lang="ts">
  import type { JiraIssueOption } from '../lib/jira-client';
  import { theme } from '../lib/theme.svelte';

  let {
    value = $bindable(''),
    favorites = [] as JiraIssueOption[],
    placeholder = 'NUMO-1234',
    inputClass = '',
    size = 'compact' as 'compact' | 'normal',
    disabled = false,
    onchange,
  }: {
    value?: string;
    favorites?: JiraIssueOption[];
    placeholder?: string;
    inputClass?: string;
    size?: 'compact' | 'normal';
    disabled?: boolean;
    onchange?: (newValue: string) => void;
  } = $props();

  const baseInputClass = $derived(
    size === 'normal'
      ? theme.neon
        ? 'w-full px-2 py-1.5 border rounded-lg text-sm font-mono uppercase bg-retro-surface text-retro-text'
        : 'w-full px-2 py-1.5 border rounded-lg text-sm font-mono uppercase text-slate-800'
      : theme.neon
        ? 'w-full px-1.5 py-1 border rounded-md text-[11px] font-mono uppercase bg-retro-surface text-retro-text'
        : 'w-full px-1.5 py-1 border border-slate-200 rounded-md text-[11px] font-mono uppercase text-slate-700',
  );

  let showDropdown = $state(false);
  let inputEl: HTMLInputElement | undefined = $state();
  let dropdownPos = $state<{
    top: number;
    left: number;
    width: number;
    openUp: boolean;
  } | null>(null);
  const DROPDOWN_MAX_H = 224; // matches max-h-56 below (56 * 4px)

  function computePos() {
    if (!inputEl) return;
    const rect = inputEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp =
      spaceBelow < DROPDOWN_MAX_H && rect.top > spaceBelow;
    dropdownPos = {
      top: openUp ? rect.top : rect.bottom,
      left: rect.left,
      width: rect.width,
      openUp,
    };
  }

  function openDropdown() {
    computePos();
    showDropdown = true;
  }

  function closeDropdown() {
    // Delay so click on a dropdown item registers before dropdown closes
    setTimeout(() => (showDropdown = false), 150);
  }

  // Reposition on any scroll (the popup has an overflow-auto list) or resize.
  $effect(() => {
    if (!showDropdown) return;
    const onScroll = () => computePos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  });

  let filtered = $derived.by(() => {
    const q = value.trim().toLowerCase();
    const matching = q
      ? favorites.filter(
          (f) =>
            f.key.toLowerCase().includes(q) ||
            f.summary.toLowerCase().includes(q),
        )
      : favorites.slice();
    // Stable sort: Tempo favorites first, rest keep incoming order.
    matching.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return 0;
    });
    return matching.slice(0, 20);
  });

  function pick(key: string) {
    value = key;
    showDropdown = false;
    onchange?.(key);
  }
</script>

<div>
  <input
    bind:this={inputEl}
    type="text"
    bind:value
    {disabled}
    oninput={() => {
      onchange?.(value);
      if (showDropdown) computePos();
    }}
    onfocus={openDropdown}
    onblur={closeDropdown}
    {placeholder}
    class="{baseInputClass} {theme.neon ? 'border-retro-border2 disabled:bg-retro-bg disabled:text-retro-dim' : 'border-slate-200 disabled:bg-slate-50 disabled:text-slate-400'} {inputClass}"
  />
  {#if showDropdown && !disabled && filtered.length > 0 && dropdownPos}
    <div
      class="fixed z-50 {theme.neon ? 'bg-retro-surface border border-retro-border' : 'bg-white border border-slate-200'} shadow-lg rounded-xl max-h-56 overflow-auto w-[22rem] max-w-[24rem]"
      style:top="{dropdownPos.openUp ? 'auto' : dropdownPos.top + 2 + 'px'}"
      style:bottom="{dropdownPos.openUp ? window.innerHeight - dropdownPos.top + 2 + 'px' : 'auto'}"
      style:left="{dropdownPos.left}px"
      style:min-width="{dropdownPos.width}px"
    >
      {#each filtered as fav (fav.key)}
        <button
          type="button"
          title={fav.isFavorite
            ? `⭐ Favorite — ${fav.summary || fav.key}`
            : fav.summary || fav.key}
          class="w-full text-left px-2 py-1.5 {theme.neon ? 'hover:bg-retro-surface2 border-b border-retro-border' : 'hover:bg-slate-50 border-b border-slate-100'} flex gap-1.5 items-baseline text-[11px] last:border-0 transition-colors"
          onmousedown={(e) => {
            e.preventDefault();
            pick(fav.key);
          }}
        >
          <span class="shrink-0 w-3 text-center">
            {#if fav.isFavorite}⭐{/if}
          </span>
          <span class="{theme.neon ? 'text-neon-cyan' : 'text-blue-600'} font-mono shrink-0 w-20">{fav.key}</span>
          <span class="{theme.neon ? 'text-retro-text' : 'text-slate-600'} truncate flex-1 font-sans">
            {fav.summary || '(no summary)'}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
