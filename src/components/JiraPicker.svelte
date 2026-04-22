<script lang="ts">
  import type { JiraIssueOption } from '../lib/jira-client';

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
      ? 'w-full px-2 py-1.5 border rounded text-sm font-mono uppercase'
      : 'w-full px-1.5 py-1 border border-gray-300 rounded text-[11px] font-mono uppercase',
  );

  let showDropdown = $state(false);

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

<div class="relative">
  <input
    type="text"
    bind:value
    {disabled}
    oninput={() => onchange?.(value)}
    onfocus={() => (showDropdown = true)}
    onblur={() => {
      // Delay so click on a dropdown item registers before dropdown closes
      setTimeout(() => (showDropdown = false), 150);
    }}
    {placeholder}
    class="{baseInputClass} border-gray-300 disabled:bg-gray-100 disabled:text-gray-400 {inputClass}"
  />
  {#if showDropdown && !disabled && filtered.length > 0}
    <div
      class="absolute top-full left-0 z-20 bg-white border border-gray-300 shadow-lg rounded-b max-h-56 overflow-auto mt-0.5 min-w-full w-[22rem] max-w-[24rem]"
    >
      {#each filtered as fav (fav.key)}
        <button
          type="button"
          title={fav.isFavorite
            ? `⭐ Favorite — ${fav.summary || fav.key}`
            : fav.summary || fav.key}
          class="w-full text-left px-2 py-1.5 hover:bg-blue-50 flex gap-1.5 items-baseline text-[11px] border-b border-gray-100 last:border-0"
          onmousedown={(e) => {
            e.preventDefault();
            pick(fav.key);
          }}
        >
          <span class="shrink-0 w-3 text-center">
            {#if fav.isFavorite}⭐{/if}
          </span>
          <span class="text-blue-600 font-mono shrink-0 w-20">{fav.key}</span>
          <span class="text-gray-700 truncate flex-1 font-sans">
            {fav.summary || '(no summary)'}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
