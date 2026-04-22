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
    setGithubToken,
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
  };

  type UnmappedRow = {
    event: CalendarEvent;
    jiraInput: string;
    matchInput: string;
    skipInput: boolean;
    saving: boolean;
  };

  let patInput = $state('');
  let patStatus = $state<'unset' | 'saved'>('unset');

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
      if (t) {
        patInput = t;
        patStatus = 'saved';
      }
    })();
  });

  function isoDate(offsetDays: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function savePat() {
    await setGithubToken(patInput.trim());
    patStatus = 'saved';
  }

  function deriveMatchSuggestion(title: string): string {
    return title
      .replace(/[,].*$/, '')
      .replace(/\d+[:.]\d+\s*(am|pm)?/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
  }

  function rebuildRows(p: LoadedPreview) {
    rows = p.entries.map((e) => ({
      entry: e,
      include: !p.alreadyLoggedIds.has(e.id),
      alreadyLogged: p.alreadyLoggedIds.has(e.id),
      postStatus: 'idle' as const,
    }));
    unmapped = p.unmapped.map((ev) => ({
      event: ev,
      jiraInput: '',
      matchInput: deriveMatchSuggestion(ev.title),
      skipInput: false,
      saving: false,
    }));
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
      preview.jiraUsername,
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
    return '📅';
  }

  function sourceColor(source: WorklogEntry['source']): string {
    if (source === 'commit') return 'text-orange-600';
    if (source === 'review') return 'text-purple-600';
    return 'text-emerald-600';
  }

  function rowBg(r: RowState): string {
    if (r.postStatus === 'ok') return 'bg-green-50 border-green-200';
    if (r.postStatus === 'fail') return 'bg-red-50 border-red-200';
    if (r.postStatus === 'posting') return 'bg-blue-50 border-blue-200';
    if (r.alreadyLogged) return 'bg-gray-50 border-gray-200 opacity-60';
    return 'bg-white border-gray-200';
  }

  let toPostCount = $derived(
    rows.filter(
      (r) => r.include && !r.alreadyLogged && r.postStatus !== 'ok',
    ).length,
  );
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

  <div class="flex gap-2 mb-3">
    <input
      type="password"
      placeholder="GitHub PAT"
      bind:value={patInput}
      class="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono bg-white"
    />
    <button
      class="px-3 py-1.5 bg-gray-700 hover:bg-gray-800 text-white text-xs rounded"
      onclick={savePat}
    >
      {patStatus === 'saved' ? 'Saved ✓' : 'Save'}
    </button>
  </div>

  <div class="flex gap-2">
    <button
      class="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
      disabled={loading || posting}
      onclick={() => load(isoDate(-1), isoDate(-1))}
    >
      {loading ? 'Loading…' : 'Log yesterday'}
    </button>
    <button
      class="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
      disabled={loading || posting}
      onclick={() => load(isoDate(0), isoDate(0))}
    >
      Log today
    </button>
  </div>

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
        {#each rows as r (r.entry.id)}
          <div class="flex items-center gap-2 px-2 py-1.5 border rounded text-xs {rowBg(r)}">
            <input
              type="checkbox"
              class="shrink-0"
              bind:checked={r.include}
              disabled={r.alreadyLogged || posting || r.postStatus === 'ok'}
            />
            <span class="shrink-0 {sourceColor(r.entry.source)}" title={r.entry.source}>
              {sourceIcon(r.entry.source)}
            </span>
            <span class="shrink-0 text-gray-500 w-20 font-mono">{r.entry.date}</span>
            <span class="shrink-0 text-blue-600 w-24 font-mono font-medium">
              {r.entry.issueKey ?? '—'}
            </span>
            <span class="shrink-0 text-amber-700 w-10 text-right font-mono">{r.entry.minutes}m</span>
            <span class="flex-1 min-w-0 text-gray-700 truncate" title={r.entry.comment}>
              {r.entry.comment}
            </span>
            <span class="shrink-0 w-4 text-right">
              {#if r.alreadyLogged}
                <span class="text-gray-500" title="Already logged in Tempo">⊘</span>
              {:else if r.postStatus === 'posting'}
                <span class="text-blue-600">…</span>
              {:else if r.postStatus === 'ok'}
                <span class="text-green-600">✓</span>
              {:else if r.postStatus === 'fail'}
                <span class="text-red-600" title={r.postError}>✗</span>
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
              Ready to post {toPostCount} entries
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
