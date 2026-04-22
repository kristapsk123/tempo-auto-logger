<script lang="ts">
  import type { JiraIssueOption } from '../lib/jira-client';

  let {
    value = $bindable(''),
    favorites = [] as JiraIssueOption[],
    placeholder = 'NUMO-1234',
    inputClass = '',
    onchange,
  }: {
    value?: string;
    favorites?: JiraIssueOption[];
    placeholder?: string;
    inputClass?: string;
    onchange?: (newValue: string) => void;
  } = $props();

  let showDropdown = $state(false);

  let filtered = $derived.by(() => {
    const q = value.trim().toLowerCase();
    if (!q) return favorites.slice(0, 20);
    return favorites
      .filter(
        (f) =>
          f.key.toLowerCase().includes(q) ||
          f.summary.toLowerCase().includes(q),
      )
      .slice(0, 20);
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
    oninput={() => onchange?.(value)}
    onfocus={() => (showDropdown = true)}
    onblur={() => {
      // Delay so click on a dropdown item registers before dropdown closes
      setTimeout(() => (showDropdown = false), 150);
    }}
    {placeholder}
    class="w-full px-1.5 py-1 border border-gray-300 rounded text-[11px] font-mono uppercase {inputClass}"
  />
  {#if showDropdown && filtered.length > 0}
    <div
      class="absolute top-full left-0 z-20 bg-white border border-gray-300 shadow-lg rounded-b max-h-56 overflow-auto mt-0.5 min-w-full w-[22rem] max-w-[24rem]"
    >
      {#each filtered as fav (fav.key)}
        <button
          type="button"
          title={fav.summary || fav.key}
          class="w-full text-left px-2 py-1.5 hover:bg-blue-50 flex gap-2 items-baseline text-[11px] border-b border-gray-100 last:border-0 {fav.sectionLabel ===
          'Previously used'
            ? 'border-l-2 border-l-amber-400'
            : ''}"
          onmousedown={(e) => {
            e.preventDefault();
            pick(fav.key);
          }}
        >
          <span class="text-blue-600 font-mono shrink-0 w-20">{fav.key}</span>
          <span class="text-gray-700 truncate flex-1 font-sans">
            {fav.summary || '(no summary)'}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
