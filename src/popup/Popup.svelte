<script lang="ts">
  import {
    loadPreview,
    reaggregate,
    postEntries,
    type LoadedPreview,
  } from '../lib/orchestrator';
  import JiraPicker from '../components/JiraPicker.svelte';
  import {
    addUserMeetingMapping,
    getGithubToken,
  } from '../lib/storage';
  import type { WorklogEntry } from '../lib/aggregator';
  import type { CalendarEvent } from '../lib/calendar-client';
  import { SessionExpiredError, type AuthService } from '../lib/http';
  import { JIRA_BASE_URL, CALENDAR_BASE_URL } from '../lib/config';

  type RowState = {
    entry: WorklogEntry;
    include: boolean;
    alreadyLogged: boolean;
    postStatus: 'idle' | 'posting' | 'ok' | 'fail';
    postError?: string;
    // hoursInput / minutesInput drive the two-field h/m editor. entry.minutes
    // stays the source of truth for posting and the footer total.
    hoursInput: number;
    minutesInput: number;
  };

  type UnmappedRow = {
    event: CalendarEvent;
    jiraInput: string;
    matchInput: string;
    skipInput: boolean;
    saving: boolean;
  };

  let hasPat = $state<boolean | null>(null); // null = loading
  let dateFrom = $state(isoDate(-1));
  let dateTo = $state(isoDate(-1));

  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let loadErrorService = $state<AuthService | null>(null);

  let preview = $state<LoadedPreview | null>(null);
  let rows = $state<RowState[]>([]);
  let unmapped = $state<UnmappedRow[]>([]);

  let posting = $state(false);
  let summary = $state<{ ok: number; fail: number; skipped: number } | null>(
    null,
  );

  $effect(() => {
    void (async () => {
      const t = await getGithubToken();
      hasPat = !!t;
    })();
  });

  function isoDate(offsetDays: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function presetYesterday() {
    const d = isoDate(-1);
    dateFrom = d;
    dateTo = d;
  }

  function presetToday() {
    const d = isoDate(0);
    dateFrom = d;
    dateTo = d;
  }

  function presetLast7() {
    dateFrom = isoDate(-7);
    dateTo = isoDate(-1);
  }

  function presetThisWeek() {
    const now = new Date();
    const dow = now.getDay(); // 0=Sun, 1=Mon, ...
    const daysBack = dow === 0 ? 6 : dow - 1;
    dateFrom = isoDate(-daysBack);
    dateTo = isoDate(0);
  }

  function presetLastWeek() {
    const now = new Date();
    const dow = now.getDay();
    const daysBackToMonday = dow === 0 ? 6 : dow - 1;
    dateFrom = isoDate(-daysBackToMonday - 7);
    dateTo = isoDate(-daysBackToMonday - 1);
  }

  let rangeError = $derived.by(() => {
    if (!dateFrom || !dateTo) return 'Pick a date range';
    if (dateFrom > dateTo) return 'From must be on or before To';
    const days =
      (new Date(dateTo + 'T00:00:00').getTime() -
        new Date(dateFrom + 'T00:00:00').getTime()) /
        86400000 +
      1;
    if (days > 30) return 'Range is capped at 30 days';
    return null;
  });

  function deriveMatchSuggestion(title: string): string {
    return title
      .replace(/[,].*$/, '')
      .replace(/\d+[:.]\d+\s*(am|pm)?/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
  }

  function rebuildRows(p: LoadedPreview) {
    // Manual rows live only in the popup's rows state — preserve them across
    // re-aggregations (e.g. after saving an unmapped meeting mapping).
    const manual = rows.filter((r) => r.entry.source === 'manual');
    rows = [
      ...p.entries.map((e) => ({
        entry: e,
        include: !p.alreadyLoggedIds.has(e.id),
        alreadyLogged: p.alreadyLoggedIds.has(e.id),
        postStatus: 'idle' as const,
        hoursInput: Math.floor(e.minutes / 60),
        minutesInput: e.minutes % 60,
      })),
      ...manual,
    ];
    unmapped = p.unmapped.map((ev) => ({
      event: ev,
      jiraInput: '',
      matchInput: deriveMatchSuggestion(ev.title),
      skipInput: false,
      saving: false,
    }));
  }

  function addManualRow() {
    if (!preview) return;
    const id = `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    rows = [
      ...rows,
      {
        entry: {
          id,
          date: preview.dateFrom,
          issueKey: '',
          minutes: 30,
          comment: '',
          source: 'manual',
          include: true,
          sourceInfo: {},
        },
        include: true,
        alreadyLogged: false,
        postStatus: 'idle',
        hoursInput: 0,
        minutesInput: 30,
      },
    ];
  }

  function removeManualRow(id: string) {
    rows = rows.filter((r) => r.entry.id !== id);
  }

  function syncRowMinutes(row: RowState) {
    const h = Math.max(0, Number(row.hoursInput) || 0);
    const m = Math.max(0, Number(row.minutesInput) || 0);
    row.entry.minutes = h * 60 + m;
  }

  async function load(dateFrom: string, dateTo: string) {
    loading = true;
    loadError = null;
    loadErrorService = null;
    preview = null;
    rows = [];
    unmapped = [];
    summary = null;

    try {
      const result = await loadPreview(dateFrom, dateTo);
      preview = result;
      rebuildRows(result);
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        loadErrorService = e.service;
        loadError = `${e.service} session expired — log in and retry`;
      } else {
        loadError = e instanceof Error ? e.message : String(e);
      }
    }
    loading = false;
  }

  async function saveMapping(row: UnmappedRow) {
    if (!preview) return;
    const match = row.matchInput.trim();
    if (!match) return;
    if (!row.skipInput) {
      const jira = row.jiraInput.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]+-\d+$/.test(jira)) return;
      row.saving = true;
      await addUserMeetingMapping({ match, jiraKey: jira });
    } else {
      row.saving = true;
      await addUserMeetingMapping({ match, jiraKey: '', skip: true });
    }
    const fresh = await reaggregate(
      preview.cachedFetch,
      preview.existingWorklogs,
      preview.dateFrom,
      preview.dateTo,
    );
    preview = {
      ...preview,
      entries: fresh.entries,
      unmapped: fresh.unmapped,
      skippedAllDay: fresh.skippedAllDay,
      skippedByAttendance: fresh.skippedByAttendance,
      alreadyLoggedIds: fresh.alreadyLoggedIds,
    };
    rebuildRows(preview);
  }

  async function post() {
    if (!preview || posting) return;
    const toPost = rows.filter(
      (r) =>
        r.include &&
        !r.alreadyLogged &&
        r.postStatus !== 'ok' &&
        r.entry.issueKey,
    );
    if (toPost.length === 0) return;

    posting = true;
    summary = null;

    for (const r of toPost) {
      r.postStatus = 'posting';
    }

    let ok = 0;
    let fail = 0;
    await postEntries(
      toPost.map((r) => ({
        id: r.entry.id,
        issueKey: r.entry.issueKey!,
        date: r.entry.date,
        minutes: r.entry.minutes,
        comment: r.entry.comment,
      })),
      preview.jiraWorker,
      (result) => {
        const row = rows.find((x) => x.entry.id === result.id);
        if (!row) return;
        row.postStatus = result.status;
        row.postError = result.error;
        if (result.status === 'ok') ok += 1;
        else fail += 1;
      },
    );

    summary = {
      ok,
      fail,
      skipped: rows.length - toPost.length,
    };
    posting = false;
  }

  function openJira() {
    chrome.tabs.create({ url: JIRA_BASE_URL });
  }

  function openCalendar() {
    chrome.tabs.create({ url: `${CALENDAR_BASE_URL}/calendar/u/0/r` });
  }

  function sourceIcon(source: WorklogEntry['source']): string {
    if (source === 'commit') return '⎇';
    if (source === 'review') return '👁';
    if (source === 'manual') return '✎';
    return '📅';
  }

  function sourceColor(source: WorklogEntry['source']): string {
    if (source === 'commit') return 'text-orange-600';
    if (source === 'review') return 'text-purple-600';
    if (source === 'manual') return 'text-indigo-600';
    return 'text-emerald-600';
  }

  function rowBg(r: RowState): string {
    if (r.postStatus === 'ok') return 'bg-green-50 border-green-200';
    if (r.postStatus === 'fail') return 'bg-red-50 border-red-200';
    if (r.postStatus === 'posting') return 'bg-blue-50 border-blue-200';
    if (r.alreadyLogged) return 'bg-gray-50 border-gray-200 opacity-60';
    return 'bg-white border-gray-200';
  }

  let toPostRows = $derived(
    rows.filter(
      (r) => r.include && !r.alreadyLogged && r.postStatus !== 'ok',
    ),
  );
  let toPostCount = $derived(toPostRows.length);
  let toPostMinutes = $derived(
    toPostRows.reduce((sum, r) => sum + (r.entry.minutes || 0), 0),
  );

  function formatDuration(minutes: number): string {
    if (minutes <= 0) return '0m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }
</script>

<main class="p-4 w-[32rem] min-h-[360px] font-sans bg-gray-50">
  <header class="flex items-start justify-between mb-3">
    <div>
      <h1 class="text-lg font-semibold text-gray-900">Tempo Auto Logger</h1>
      <p class="text-xs text-gray-500 mt-0.5">
        Log commits, reviews and meetings to Tempo
      </p>
    </div>
    <button
      class="text-xs text-blue-600 hover:underline"
      onclick={() => chrome.runtime.openOptionsPage()}
    >
      Settings
    </button>
  </header>

  {#if hasPat === false}
    <div class="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
      <div class="font-medium mb-1">No GitHub PAT saved</div>
      <div class="mb-2">
        A GitHub personal access token is required to read your commits
        and PR reviews. Add it in Settings.
      </div>
      <button
        class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded"
        onclick={() => chrome.runtime.openOptionsPage()}
      >
        Open Settings
      </button>
    </div>
  {:else if hasPat === true}
    <div class="space-y-2">
      <div class="flex flex-wrap gap-1.5">
        {#each [
          { label: 'Yesterday', action: presetYesterday },
          { label: 'Today', action: presetToday },
          { label: 'Last 7 days', action: presetLast7 },
          { label: 'This week', action: presetThisWeek },
          { label: 'Last week', action: presetLastWeek },
        ] as preset (preset.label)}
          <button
            class="px-2.5 py-1 border border-gray-300 hover:bg-gray-100 bg-white text-xs rounded"
            disabled={loading || posting}
            onclick={preset.action}
          >
            {preset.label}
          </button>
        {/each}
      </div>

      <div class="flex items-center gap-2 text-xs text-gray-700">
        <label class="flex items-center gap-1">
          From
          <input
            type="date"
            bind:value={dateFrom}
            class="px-1.5 py-1 border border-gray-300 rounded bg-white"
          />
        </label>
        <label class="flex items-center gap-1">
          To
          <input
            type="date"
            bind:value={dateTo}
            class="px-1.5 py-1 border border-gray-300 rounded bg-white"
          />
        </label>
      </div>

      {#if rangeError}
        <div class="text-xs text-red-700">{rangeError}</div>
      {/if}

      <button
        class="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
        disabled={loading || posting || rangeError !== null}
        onclick={() => load(dateFrom, dateTo)}
      >
        {loading ? 'Loading…' : `Log ${dateFrom}${dateFrom !== dateTo ? ` → ${dateTo}` : ''}`}
      </button>
    </div>
  {/if}

  {#if loadError}
    <div class="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800">
      <div class="font-medium mb-1">⚠ {loadError}</div>
      {#if loadErrorService === 'jira'}
        <button
          class="mt-1 px-2 py-1 border border-red-300 hover:bg-red-100 rounded text-xs"
          onclick={openJira}
        >
          Open Jira to log in
        </button>
      {:else if loadErrorService === 'calendar'}
        <button
          class="mt-1 px-2 py-1 border border-red-300 hover:bg-red-100 rounded text-xs"
          onclick={openCalendar}
        >
          Open Calendar to log in
        </button>
      {/if}
    </div>
  {/if}

  {#if preview}
    <div class="mt-3 bg-white border border-gray-200 rounded shadow-sm">
      <div class="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <div class="text-xs text-gray-700">
          <span class="font-medium">{preview.dateFrom}</span>
          {#if preview.dateFrom !== preview.dateTo}
            <span> → {preview.dateTo}</span>
          {/if}
        </div>
        <div class="text-[11px] text-gray-500">
          {rows.length} entries · {rows.filter((r) => r.alreadyLogged).length} already logged · {unmapped.length} unmapped · {preview.skippedByMapping} skipped by mapping · {preview.skippedAllDay} all-day · {preview.skippedByAttendance} declined
        </div>
      </div>

      <div class="max-h-64 overflow-auto p-2 space-y-1">
        {#if rows.length === 0}
          <div class="text-xs text-gray-500 italic text-center py-4">
            No commits, reviews or mapped meetings in this date range
          </div>
        {/if}
        <button
          class="w-full px-2 py-1 border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50 rounded text-xs"
          onclick={addManualRow}
          disabled={posting}
        >
          + Add manual entry
        </button>
        {#each rows as r (r.entry.id)}
          <div class="flex items-center gap-2 px-2 py-1.5 border rounded text-xs {rowBg(r)}">
            <input
              type="checkbox"
              class="shrink-0"
              bind:checked={r.include}
              disabled={r.alreadyLogged || posting || r.postStatus === 'ok'}
            />
            <span class="shrink-0 w-4 text-center {sourceColor(r.entry.source)}" title={r.entry.source}>
              {sourceIcon(r.entry.source)}
            </span>
            {#if r.entry.source === 'manual'}
              <input
                type="date"
                class="shrink-0 w-28 px-1 py-0.5 border border-gray-300 rounded font-mono text-gray-700 bg-white disabled:bg-gray-50"
                bind:value={r.entry.date}
                disabled={posting || r.postStatus === 'ok'}
                title="Date"
              />
              <div class="shrink-0 w-24">
                <JiraPicker
                  value={r.entry.issueKey ?? ''}
                  onchange={(v) => {
                    r.entry.issueKey = v;
                  }}
                  favorites={preview?.favorites ?? []}
                  disabled={posting || r.postStatus === 'ok'}
                />
              </div>
            {:else}
              <span class="shrink-0 text-gray-500 w-20 font-mono">{r.entry.date}</span>
              <span class="shrink-0 text-blue-600 w-24 font-mono font-medium">
                {r.entry.issueKey ?? '—'}
              </span>
            {/if}
            <div class="shrink-0 flex items-center gap-0.5" title="Hours and minutes">
              <input
                type="number"
                min="0"
                class="w-9 px-1 py-0.5 border border-gray-300 rounded text-right font-mono text-amber-700 bg-white disabled:bg-gray-50 disabled:text-gray-500"
                bind:value={r.hoursInput}
                oninput={() => syncRowMinutes(r)}
                disabled={r.alreadyLogged || posting || r.postStatus === 'ok'}
                aria-label="Hours"
              />
              <span class="text-[10px] text-gray-500">h</span>
              <input
                type="number"
                min="0"
                class="w-9 px-1 py-0.5 border border-gray-300 rounded text-right font-mono text-amber-700 bg-white disabled:bg-gray-50 disabled:text-gray-500"
                bind:value={r.minutesInput}
                oninput={() => syncRowMinutes(r)}
                disabled={r.alreadyLogged || posting || r.postStatus === 'ok'}
                aria-label="Minutes"
              />
              <span class="text-[10px] text-gray-500">m</span>
            </div>
            {#if r.entry.source === 'manual'}
              <input
                type="text"
                placeholder="description"
                class="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-700 bg-white disabled:bg-gray-50"
                bind:value={r.entry.comment}
                disabled={posting || r.postStatus === 'ok'}
              />
            {:else}
              <span class="flex-1 min-w-0 text-gray-700 truncate" title={r.entry.comment}>
                {r.entry.comment}
              </span>
            {/if}
            <span class="shrink-0 w-4 text-right">
              {#if r.postStatus === 'posting'}
                <span class="text-blue-600">…</span>
              {:else if r.postStatus === 'ok'}
                <span class="text-green-600">✓</span>
              {:else if r.postStatus === 'fail'}
                <span class="text-red-600" title={r.postError}>✗</span>
              {:else if r.alreadyLogged}
                <span class="text-gray-500" title="Already logged in Tempo">⊘</span>
              {:else if r.entry.source === 'manual'}
                <button
                  class="text-red-600 hover:bg-red-50 rounded"
                  onclick={() => removeManualRow(r.entry.id)}
                  disabled={posting}
                  title="Remove manual entry"
                  aria-label="Remove"
                >
                  ✗
                </button>
              {/if}
            </span>
          </div>
        {/each}
      </div>

      {#if unmapped.length > 0}
        <div class="border-t border-gray-200 px-3 py-2 bg-amber-50">
          <div class="text-xs font-medium text-amber-900 mb-1">
            Map {unmapped.length} meeting{unmapped.length === 1 ? '' : 's'} to Jira
          </div>
          <div class="text-[10px] text-amber-700 mb-2">
            Edit the match text to control future auto-mapping (substring, case-insensitive). Longest match wins.
          </div>
          <div class="space-y-1.5">
            {#each unmapped as u (u.event.id)}
              <div class="bg-white rounded p-2 border border-amber-200">
                <div class="text-xs text-gray-800 font-medium truncate" title={u.event.title}>
                  {u.event.title}
                </div>
                <div class="text-[10px] text-gray-500 mb-1.5">
                  {new Date(u.event.startMs).toLocaleString()} · {u.event.durationMinutes}m
                </div>
                <div class="flex gap-1.5 items-center">
                  <input
                    type="text"
                    placeholder="match substring"
                    bind:value={u.matchInput}
                    class="flex-1 px-1.5 py-1 border border-gray-300 rounded text-[11px]"
                  />
                  <div class="w-32">
                    <JiraPicker
                      bind:value={u.jiraInput}
                      favorites={preview?.favorites ?? []}
                      disabled={u.skipInput}
                    />
                  </div>
                  <label
                    class="flex items-center gap-0.5 text-[10px] text-gray-700 cursor-pointer shrink-0"
                    title="Drop this meeting — don't log it"
                  >
                    <input
                      type="checkbox"
                      class="accent-amber-600 w-3 h-3"
                      bind:checked={u.skipInput}
                    />
                    Skip
                  </label>
                  <button
                    class="px-2 py-1 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white text-[11px] rounded shrink-0"
                    disabled={u.saving ||
                      !u.matchInput.trim() ||
                      (!u.skipInput &&
                        !/^[A-Z][A-Z0-9]+-\d+$/i.test(u.jiraInput.trim()))}
                    onclick={() => saveMapping(u)}
                  >
                    {u.saving ? '…' : 'Save'}
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="border-t border-gray-200 px-3 py-2 flex items-center justify-between gap-2">
        {#if summary}
          <div class="text-xs">
            <span class="text-green-700 font-medium">✓ {summary.ok} posted</span>
            {#if summary.fail > 0}
              <span class="text-red-700 font-medium ml-2">✗ {summary.fail} failed</span>
            {/if}
            {#if summary.skipped > 0}
              <span class="text-gray-500 ml-2">⊘ {summary.skipped} skipped</span>
            {/if}
          </div>
        {:else}
          <div class="text-xs text-gray-500">
            {#if toPostCount > 0}
              Ready to post {toPostCount} entries · <span class="font-medium text-gray-700">{formatDuration(toPostMinutes)}</span>
            {:else}
              Nothing to post — check entries above
            {/if}
          </div>
        {/if}
        <button
          class="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
          disabled={posting || loading || toPostCount === 0}
          onclick={post}
        >
          {posting ? 'Posting…' : `Post to Tempo${toPostCount > 0 ? ` (${toPostCount})` : ''}`}
        </button>
      </div>
    </div>
  {/if}
</main>

<style>
  /* Hide spinner arrows on minute inputs — they waste space in the tight row layout. */
  input[type='number']::-webkit-inner-spin-button,
  input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type='number'] {
    -moz-appearance: textfield;
    appearance: textfield;
  }
</style>
