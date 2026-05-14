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
    getNeonTheme,
    setNeonTheme,
    getSessionCaptchaPassed,
    getSessionPopupDates,
    getSessionUnmappedInputs,
    setSessionCaptchaPassed,
    setSessionPopupDates,
    setSessionUnmappedInputs,
    clearSessionUnmappedInputs,
    type UnmappedInputCache,
  } from '../lib/storage';
  import type { WorklogEntry } from '../lib/aggregator';
  import type { CalendarEvent } from '../lib/calendar-client';
  import { SessionExpiredError, type AuthService } from '../lib/http';
  import { JIRA_BASE_URL, CALENDAR_BASE_URL } from '../lib/config';
  import { getMyself } from '../lib/jira-client';
  import { isEmailGated } from '../lib/captcha-gate';
  import CaptchaGate from '../components/CaptchaGate.svelte';
  import { theme, applyThemeClass } from '../lib/theme.svelte';

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
    showCommitDetails: boolean;
  };

  type UnmappedRow = {
    event: CalendarEvent;
    jiraInput: string;
    matchInput: string;
    skipInput: boolean;
    saving: boolean;
  };

  type DateGroup = {
    date: string;
    groupRows: RowState[];
  };

  // null = not-yet-decided, true = blocking, false = passed / not required
  let captchaRequired = $state<boolean | null>(null);
  let hasPat = $state<boolean | null>(null); // null = loading
  const currentVersion = chrome.runtime.getManifest().version;
  let updateCheckStatus = $state<
    'idle' | 'checking' | 'no_update' | 'update_available' | 'throttled' | 'error'
  >('idle');
  let updateCheckStatusTimer: ReturnType<typeof setTimeout> | null = null;

  function checkForUpdates(): void {
    updateCheckStatus = 'checking';
    if (updateCheckStatusTimer) clearTimeout(updateCheckStatusTimer);
    try {
      chrome.runtime.requestUpdateCheck((status) => {
        if (status === 'update_available') updateCheckStatus = 'update_available';
        else if (status === 'no_update') updateCheckStatus = 'no_update';
        else if (status === 'throttled') updateCheckStatus = 'throttled';
        else updateCheckStatus = 'error';
        updateCheckStatusTimer = setTimeout(() => {
          updateCheckStatus = 'idle';
        }, 4000);
      });
    } catch {
      updateCheckStatus = 'error';
      updateCheckStatusTimer = setTimeout(() => {
        updateCheckStatus = 'idle';
      }, 4000);
    }
  }
  let dateFrom = $state(isoDate(-1));
  let dateTo = $state(isoDate(-1));
  let sessionUnmappedInputs = $state<UnmappedInputCache>({});

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
      const [t, savedDates, savedInputs, neon] = await Promise.all([
        getGithubToken(),
        getSessionPopupDates().catch(() => ({ dateFrom: null, dateTo: null })),
        getSessionUnmappedInputs().catch(() => ({} as UnmappedInputCache)),
        getNeonTheme(),
      ]);
      hasPat = !!t;
      if (savedDates.dateFrom && savedDates.dateTo) {
        dateFrom = savedDates.dateFrom;
        dateTo = savedDates.dateTo;
      }
      sessionUnmappedInputs = savedInputs;
      theme.neon = neon;
      applyThemeClass(neon);

      try {
        const me = await getMyself();
        const gated = isEmailGated(me.emailAddress);
        const alreadyPassed = gated ? await getSessionCaptchaPassed() : false;
        console.log('[captcha-gate] getMyself()', {
          emailAddress: me.emailAddress,
          name: me.name,
          key: me.key,
          gated,
          alreadyPassed,
        });
        if (!gated) {
          captchaRequired = false;
        } else {
          captchaRequired = !alreadyPassed;
        }
        console.log('[captcha-gate] decision', { captchaRequired });
      } catch (err) {
        console.warn('[captcha-gate] getMyself() failed, skipping gate', err);
        // Identity lookup failed — fall through to the main UI so the
        // existing session-expired handling can surface the error.
        captchaRequired = false;
      }
    })();
  });

  async function handleCaptchaPass(): Promise<void> {
    await setSessionCaptchaPassed();
    captchaRequired = false;
  }

  async function toggleNeon() {
    const next = !theme.neon;
    theme.neon = next;
    applyThemeClass(next);
    await setNeonTheme(next);
  }

  // Sync unmapped row inputs to session storage so they survive popup close.
  // When all meetings are mapped (unmapped becomes empty), clear the cache.
  $effect(() => {
    if (unmapped.length === 0) {
      if (preview !== null) void clearSessionUnmappedInputs().catch(() => {});
      return;
    }
    const cache: UnmappedInputCache = {};
    for (const u of unmapped) {
      cache[u.event.id] = {
        jiraInput: u.jiraInput,
        matchInput: u.matchInput,
        skipInput: u.skipInput,
      };
    }
    void setSessionUnmappedInputs(cache).catch(() => {});
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

  let activePreset = $derived.by((): string | null => {
    const yesterday = isoDate(-1);
    const today = isoDate(0);
    if (dateFrom === yesterday && dateTo === yesterday) return 'Yesterday';
    if (dateFrom === today && dateTo === today) return 'Today';
    if (dateFrom === isoDate(-7) && dateTo === yesterday) return 'Last 7 days';
    const daysToMonday = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
    if (dateFrom === isoDate(-daysToMonday) && dateTo === today) return 'This week';
    if (
      dateFrom === isoDate(-daysToMonday - 7) &&
      dateTo === isoDate(-daysToMonday - 1)
    )
      return 'Last week';
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
    // Snapshot user edits from existing non-manual rows keyed by entry ID so
    // they survive re-aggregation (e.g. after saving an unmapped meeting mapping).
    const prevEdits = new Map(
      rows
        .filter((r) => r.entry.source !== 'manual')
        .map((r) => [
          r.entry.id,
          {
            include: r.include,
            hoursInput: r.hoursInput,
            minutesInput: r.minutesInput,
            minutes: r.entry.minutes,
            showCommitDetails: r.showCommitDetails,
            comment: r.entry.comment,
          },
        ]),
    );
    // Manual rows live only in the popup's rows state — preserve them across
    // re-aggregations (e.g. after saving an unmapped meeting mapping).
    const manual = rows.filter((r) => r.entry.source === 'manual');
    rows = [
      ...p.entries.map((e) => {
        const alreadyLogged = p.alreadyLoggedIds.has(e.id);
        const prev = prevEdits.get(e.id);
        return {
          entry: prev ? { ...e, minutes: prev.minutes, comment: prev.comment } : e,
          include: alreadyLogged ? false : (prev ? prev.include : true),
          alreadyLogged,
          postStatus: 'idle' as const,
          hoursInput: prev ? prev.hoursInput : Math.floor(e.minutes / 60),
          minutesInput: prev ? prev.minutesInput : e.minutes % 60,
          showCommitDetails: prev?.showCommitDetails ?? false,
        };
      }),
      ...manual,
    ];
    // Preserve any inputs the user has already typed: check in-memory state
    // first (handles save-one-by-one reset), then session storage (handles
    // popup close/reopen).
    const currentInputs = new Map(unmapped.map((u) => [u.event.id, u]));
    unmapped = p.unmapped.map((ev) => {
      const cur = currentInputs.get(ev.id);
      if (cur) return { ...cur, saving: false };
      const ses = sessionUnmappedInputs[ev.id];
      if (ses) return { event: ev, ...ses, saving: false };
      return {
        event: ev,
        jiraInput: '',
        matchInput: deriveMatchSuggestion(ev.title),
        skipInput: false,
        saving: false,
      };
    });
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
        showCommitDetails: false,
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
      void setSessionPopupDates(dateFrom, dateTo).catch(() => {});
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
    if (theme.neon) {
      if (source === 'commit') return 'text-neon-orange';
      if (source === 'review') return 'text-neon-purple';
      if (source === 'manual') return 'text-neon-purple';
      return 'text-neon-cyan';
    }
    if (source === 'commit') return 'text-orange-600';
    if (source === 'review') return 'text-purple-600';
    if (source === 'manual') return 'text-indigo-600';
    return 'text-emerald-600';
  }

  function rowBg(r: RowState): string {
    if (theme.neon) {
      if (r.postStatus === 'ok') return 'bg-neon-green-bg border-neon-green';
      if (r.postStatus === 'fail') return 'bg-neon-red-bg border-neon-red';
      if (r.postStatus === 'posting') return 'bg-neon-blue-bg border-neon-blue';
      if (r.alreadyLogged) return 'bg-retro-bg border-retro-border opacity-60';
      return 'bg-retro-surface2 border-retro-border';
    }
    if (r.postStatus === 'ok') return 'bg-green-50 border-green-200';
    if (r.postStatus === 'fail') return 'bg-red-50 border-red-200';
    if (r.postStatus === 'posting') return 'bg-blue-50 border-blue-200';
    if (r.alreadyLogged) return 'bg-gray-50 border-gray-200 opacity-60';
    return 'bg-white border-gray-200';
  }

  // Shorthand: picks neon class when neon theme is active, otherwise default
  function n(neonClass: string, baseClass: string): string {
    return theme.neon ? neonClass : baseClass;
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

  let rowsByDate = $derived.by((): DateGroup[] => {
    const groups = new Map<string, RowState[]>();
    for (const r of rows) {
      const d = r.entry.date || '';
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d)!.push(r);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, groupRows]) => ({ date, groupRows }));
  });

  function formatDateHeader(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function dayTotalMinutes(groupRows: RowState[]): number {
    return groupRows
      .filter((r) => r.include && !r.alreadyLogged && r.postStatus !== 'ok')
      .reduce((sum, r) => sum + (r.entry.minutes || 0), 0);
  }

  function formatCommitTime(committedAt: string | undefined): string {
    if (!committedAt) return '';
    const d = new Date(committedAt);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${min}`;
  }

  function formatDuration(minutes: number): string {
    if (minutes <= 0) return '0m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function handleDateFromChange(newFrom: string) {
    if (!newFrom || !dateTo) {
      dateFrom = newFrom;
      return;
    }
    if (newFrom > dateTo) {
      const deltaMs = Math.max(
        0,
        new Date(dateTo + 'T00:00:00').getTime() -
          new Date(dateFrom + 'T00:00:00').getTime(),
      );
      const newToMs = new Date(newFrom + 'T00:00:00').getTime() + deltaMs;
      const d = new Date(newToMs);
      dateTo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    dateFrom = newFrom;
  }
</script>

{#if captchaRequired === null}
  <main class="p-4 min-w-[38.25rem] min-h-[360px] w-full max-w-[1280px] mx-auto font-sans {n('bg-retro-bg retro-grid text-retro-text', 'bg-gray-50 text-slate-600')} text-sm">
    Loading…
  </main>
{:else if captchaRequired}
  <CaptchaGate onPass={handleCaptchaPass} />
{:else}
<main class="p-4 min-w-[38.25rem] min-h-[360px] w-full max-w-[1280px] mx-auto font-sans flex flex-col {n('bg-retro-bg retro-grid', 'bg-gray-50')}">
  <header class="flex items-start justify-between mb-3">
    <div>
      <h1 class="text-lg font-semibold {n('retro-glow-text', 'text-gray-900')}">
        Tempo Auto Logger
        <button
          type="button"
          class="ml-1 align-middle text-[10px] font-normal {n('text-retro-muted hover:text-neon-cyan', 'text-gray-400 hover:text-blue-600')} hover:underline cursor-pointer"
          onclick={checkForUpdates}
          title="Check for updates"
          disabled={updateCheckStatus === 'checking'}
        >
          v{currentVersion}
        </button>
        {#if updateCheckStatus !== 'idle'}
          <span class="ml-1 align-middle text-[10px] font-normal {n('text-retro-muted', 'text-gray-500')}">
            {#if updateCheckStatus === 'checking'}
              checking…
            {:else if updateCheckStatus === 'no_update'}
              ✓ up to date
            {:else if updateCheckStatus === 'update_available'}
              ↻ installing — restart Chrome to apply
            {:else if updateCheckStatus === 'throttled'}
              throttled, try again in a minute
            {:else}
              check failed
            {/if}
          </span>
        {/if}
      </h1>
      <p class="text-xs {n('text-retro-muted', 'text-gray-500')} mt-0.5">
        Log commits, reviews and meetings to Tempo
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="text-xs px-1.5 py-0.5 rounded border {theme.neon
          ? 'border-neon-pink text-neon-pink hover:bg-neon-pink-bg shadow-neon-pink'
          : 'border-gray-300 text-gray-500 hover:bg-gray-100'}"
        onclick={toggleNeon}
        title={theme.neon ? 'Disable neon theme' : 'Enable neon theme'}
        aria-label="Toggle neon theme"
      >
        {theme.neon ? 'Neon ON' : 'Neon OFF'}
      </button>
      <button
        class="text-xs {n('text-neon-cyan', 'text-blue-600')} hover:underline"
        onclick={() => chrome.runtime.openOptionsPage()}
      >
        Settings
      </button>
      <button
        class="{n('text-retro-dim hover:text-retro-bright', 'text-gray-400 hover:text-gray-700')} text-base leading-none"
        onclick={() => window.close()}
        title="Close"
        aria-label="Close"
      >
        ✕
      </button>
    </div>
  </header>

  {#if hasPat !== null}
    {#if hasPat === false}
      <div class="mb-2 px-2.5 py-1.5 {n('bg-neon-blue-bg border border-neon-blue text-neon-blue', 'bg-sky-50 border border-sky-200 text-sky-900')} rounded text-[11px] flex items-center justify-between gap-2">
        <span>
          <span class="font-medium">Meetings-only mode.</span>
          Add a GitHub token in Settings to also log commits and PR reviews.
        </span>
        <button
          class="shrink-0 {n('text-neon-cyan', 'text-sky-700')} hover:underline"
          onclick={() => chrome.runtime.openOptionsPage()}
        >
          Settings
        </button>
      </div>
    {/if}
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
            class="px-2.5 py-1 border text-xs rounded {activePreset === preset.label
              ? n('border-neon-cyan bg-neon-cyan-bg text-neon-cyan font-medium shadow-neon-cyan', 'border-blue-500 bg-blue-100 text-blue-800 font-medium')
              : n('border-retro-border2 hover:bg-retro-surface2 bg-retro-surface text-retro-text', 'border-gray-300 hover:bg-gray-100 bg-white')}"
            disabled={loading || posting}
            onclick={preset.action}
          >
            {preset.label}
          </button>
        {/each}
      </div>

      <div class="flex items-center gap-2 text-xs {n('text-retro-text', 'text-gray-700')}">
        <label class="flex items-center gap-1">
          From
          <input
            type="date"
            value={dateFrom}
            onchange={(e) => handleDateFromChange((e.currentTarget as HTMLInputElement).value)}
            class="px-1.5 py-1 border {n('border-retro-border2 bg-retro-surface text-retro-text', 'border-gray-300 bg-white')} rounded"
          />
        </label>
        <label class="flex items-center gap-1">
          To
          <input
            type="date"
            bind:value={dateTo}
            class="px-1.5 py-1 border {n('border-retro-border2 bg-retro-surface text-retro-text', 'border-gray-300 bg-white')} rounded"
          />
        </label>
      </div>

      {#if rangeError}
        <div class="text-xs {n('text-neon-red', 'text-red-700')}">{rangeError}</div>
      {/if}

      <button
        class="w-full px-3 py-2 {n('bg-neon-pink hover:bg-neon-pink-dark disabled:bg-retro-border2 disabled:shadow-none shadow-neon-pink', 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300')} text-white text-sm rounded disabled:cursor-not-allowed font-medium"
        disabled={loading || posting || rangeError !== null}
        onclick={() => load(dateFrom, dateTo)}
      >
        {loading ? 'Loading…' : `Log ${dateFrom}${dateFrom !== dateTo ? ` → ${dateTo}` : ''}`}
      </button>
    </div>
  {/if}

  {#if loadError}
    <div class="mt-3 p-2.5 {n('bg-neon-red-bg border border-neon-red text-neon-red', 'bg-red-50 border border-red-200 text-red-800')} rounded text-xs">
      <div class="font-medium mb-1">⚠ {loadError}</div>
      {#if loadErrorService === 'jira'}
        <button
          class="mt-1 px-2 py-1 border {n('border-neon-red-dark hover:bg-neon-red-bg text-neon-red', 'border-red-300 hover:bg-red-100')} rounded text-xs"
          onclick={openJira}
        >
          Open Jira to log in
        </button>
      {:else if loadErrorService === 'calendar'}
        <button
          class="mt-1 px-2 py-1 border {n('border-neon-red-dark hover:bg-neon-red-bg text-neon-red', 'border-red-300 hover:bg-red-100')} rounded text-xs"
          onclick={openCalendar}
        >
          Open Calendar to log in
        </button>
      {/if}
    </div>
  {/if}

  {#if preview}
    <div class="mt-3 flex-1 flex flex-col min-h-0 {n('bg-retro-surface border-retro-border', 'bg-white border-gray-200')} border rounded shadow-sm">
      <div class="px-3 py-2 border-b {n('border-retro-border', 'border-gray-200')} flex items-center justify-between">
        <div class="text-xs {n('text-retro-text', 'text-gray-700')}">
          <span class="font-medium">{preview.dateFrom}</span>
          {#if preview.dateFrom !== preview.dateTo}
            <span> → {preview.dateTo}</span>
          {/if}
        </div>
        <div class="text-[11px] {n('text-retro-dim', 'text-gray-500')}">
          {rows.length} entries · {rows.filter((r) => r.alreadyLogged).length} already logged · {unmapped.length} unmapped · {preview.skippedByMapping} skipped by mapping · {preview.skippedAllDay} all-day · {preview.skippedByAttendance} declined
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-auto p-2 space-y-1">
        {#if rows.length === 0}
          <div class="text-xs {n('text-retro-muted', 'text-gray-500')} italic text-center py-4">
            No commits, reviews or mapped meetings in this date range
          </div>
        {/if}
        <button
          class="w-full px-2 py-1 border border-dashed {n('border-neon-purple text-neon-purple hover:bg-neon-purple-bg', 'border-indigo-300 text-indigo-700 hover:bg-indigo-50')} rounded text-xs"
          onclick={addManualRow}
          disabled={posting}
        >
          + Add manual entry
        </button>
        {#each rowsByDate as group (group.date)}
          {#if rowsByDate.length > 1}
            <div class="flex items-center justify-between px-2 py-1 rounded {n('bg-retro-surface2 text-retro-bright', 'bg-gray-100 text-gray-700')} text-[11px] font-medium">
              <span>{formatDateHeader(group.date)}</span>
              {#if dayTotalMinutes(group.groupRows) > 0}
                <span class="{n('text-neon-cyan', 'text-blue-600')} font-mono">{formatDuration(dayTotalMinutes(group.groupRows))}</span>
              {/if}
            </div>
          {/if}
          {#each group.groupRows as r (r.entry.id)}
          <div class="border rounded text-xs {rowBg(r)}">
          <div class="flex items-center gap-2 px-2 py-1.5">
            <input
              type="checkbox"
              class="shrink-0 {n('accent-neon-cyan', '')}"
              bind:checked={r.include}
              disabled={r.alreadyLogged || posting || r.postStatus === 'ok'}
            />
            <span class="shrink-0 w-4 text-center {sourceColor(r.entry.source)}" title={r.entry.source}>
              {sourceIcon(r.entry.source)}
            </span>
            {#if r.entry.source === 'manual'}
              <input
                type="date"
                class="shrink-0 w-28 px-1 py-0.5 border {n('border-retro-border2 font-mono text-retro-text bg-retro-surface disabled:bg-retro-bg', 'border-gray-300 font-mono text-gray-700 bg-white disabled:bg-gray-50')} rounded"
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
              <span class="shrink-0 {n('text-retro-muted', 'text-gray-500')} w-20 font-mono">{r.entry.date}</span>
              <div class="shrink-0 w-32 flex items-center gap-3">
                <button
                  class="{n('text-neon-cyan', 'text-blue-600')} font-mono font-medium text-left hover:underline truncate"
                  title={r.entry.issueTitle ?? r.entry.issueKey ?? ''}
                  onclick={() => { if (r.entry.issueKey) chrome.tabs.create({ url: `${JIRA_BASE_URL}/browse/${r.entry.issueKey}` }); }}
                >
                  {r.entry.issueKey ?? '—'}
                </button>
                {#if r.entry.source === 'review' && r.entry.sourceInfo.prNumber != null && r.entry.sourceInfo.repo}
                  <button
                    class="shrink-0 {n('text-neon-purple hover:text-neon-purple-dark', 'text-purple-500 hover:text-purple-700')} leading-none"
                    title="Open PR #{r.entry.sourceInfo.prNumber} on GitHub"
                    onclick={() => chrome.tabs.create({ url: `https://github.com/${r.entry.sourceInfo.repo}/pull/${r.entry.sourceInfo.prNumber}` })}
                  >PR🔗</button>
                {/if}
                {#if r.entry.source === 'commit' && r.entry.sourceInfo.commits?.length}
                  <button
                    class="shrink-0 {n('text-neon-orange hover:text-neon-orange-dark', 'text-orange-500 hover:text-orange-700')} leading-none text-sm font-medium tabular-nums"
                    title="{r.entry.sourceInfo.commits.length} commit{r.entry.sourceInfo.commits.length !== 1 ? 's' : ''} — click to {r.showCommitDetails ? 'hide' : 'show'}"
                    onclick={() => { r.showCommitDetails = !r.showCommitDetails; }}
                  >{r.entry.sourceInfo.commits.length}⎇</button>
                {/if}
              </div>
            {/if}
            <div class="shrink-0 flex items-center gap-0.5" title="Hours and minutes">
              <input
                type="number"
                min="0"
                class="w-9 px-1 py-0.5 border {n('border-retro-border2 text-neon-yellow bg-retro-surface disabled:bg-retro-bg disabled:text-retro-dim', 'border-gray-300 text-amber-700 bg-white disabled:bg-gray-50 disabled:text-gray-500')} rounded text-right font-mono"
                bind:value={r.hoursInput}
                oninput={() => syncRowMinutes(r)}
                disabled={r.alreadyLogged || posting || r.postStatus === 'ok'}
                aria-label="Hours"
              />
              <span class="text-[10px] {n('text-retro-muted', 'text-gray-500')}">h</span>
              <input
                type="number"
                min="0"
                class="w-9 px-1 py-0.5 border {n('border-retro-border2 text-neon-yellow bg-retro-surface disabled:bg-retro-bg disabled:text-retro-dim', 'border-gray-300 text-amber-700 bg-white disabled:bg-gray-50 disabled:text-gray-500')} rounded text-right font-mono"
                bind:value={r.minutesInput}
                oninput={() => syncRowMinutes(r)}
                disabled={r.alreadyLogged || posting || r.postStatus === 'ok'}
                aria-label="Minutes"
              />
              <span class="text-[10px] {n('text-retro-muted', 'text-gray-500')}">m</span>
            </div>
            {#if r.entry.source === 'manual'}
              <input
                type="text"
                placeholder="description"
                class="flex-1 min-w-0 px-1.5 py-0.5 border {n('border-retro-border2 text-retro-text bg-retro-surface disabled:bg-retro-bg', 'border-gray-300 text-gray-700 bg-white disabled:bg-gray-50')} rounded"
                bind:value={r.entry.comment}
                disabled={posting || r.postStatus === 'ok'}
              />
            {:else}
              <input
                type="text"
                class="flex-1 min-w-0 px-1.5 py-0.5 border {n('border-retro-border2 text-retro-text bg-retro-surface disabled:bg-retro-bg disabled:text-retro-dim', 'border-gray-300 text-gray-700 bg-white disabled:bg-gray-50 disabled:text-gray-400')} rounded"
                bind:value={r.entry.comment}
                disabled={r.alreadyLogged || posting || r.postStatus === 'ok'}
                title={r.entry.comment}
              />
            {/if}
            <span class="shrink-0 w-4 text-right">
              {#if r.postStatus === 'posting'}
                <span class="{n('text-neon-cyan', 'text-blue-600')}">…</span>
              {:else if r.postStatus === 'ok'}
                <span class="{n('text-neon-green', 'text-green-600')}">✓</span>
              {:else if r.postStatus === 'fail'}
                <span class="{n('text-neon-red', 'text-red-600')}" title={r.postError}>✗</span>
              {:else if r.alreadyLogged}
                <span class="{n('text-retro-dim', 'text-gray-500')}" title="Already logged in Tempo">⊘</span>
              {:else if r.entry.source === 'manual'}
                <button
                  class="{n('text-neon-red hover:bg-neon-red-bg', 'text-red-600 hover:bg-red-50')} rounded"
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
          {#if r.showCommitDetails && r.entry.source === 'commit' && r.entry.sourceInfo.commits?.length}
            <div class="border-t {n('border-neon-orange/30 bg-retro-surface', 'border-orange-100 bg-orange-50')} px-3 py-1.5 space-y-0.5">
              {#each r.entry.sourceInfo.commits as c}
                <div class="flex gap-2 items-baseline">
                  <button
                    class="font-mono text-[10px] {n('text-neon-orange hover:text-neon-orange-dark', 'text-orange-500 hover:text-orange-700')} hover:underline shrink-0"
                    title="Open commit on GitHub"
                    onclick={() => chrome.tabs.create({ url: `https://github.com/${c.repo}/commit/${c.sha}` })}
                  >{c.sha.slice(0, 7)}</button>
                  {#if c.committedAt}
                    <span class="text-[10px] {n('text-retro-dim', 'text-gray-400')} shrink-0 tabular-nums">{formatCommitTime(c.committedAt)}</span>
                  {/if}
                  <span class="text-[11px] {n('text-retro-text', 'text-gray-600')} truncate" title={c.message}>{c.message.length > 72 ? c.message.slice(0, 72) + '…' : c.message}</span>
                </div>
              {/each}
            </div>
          {/if}
          </div>
          {/each}
        {/each}
      </div>

      {#if unmapped.length > 0}
        <div class="border-t {n('border-retro-border bg-neon-yellow-bg', 'border-gray-200 bg-amber-50')} px-3 py-2">
          <div class="text-xs font-medium {n('text-neon-yellow', 'text-amber-900')} mb-1">
            Map {unmapped.length} meeting{unmapped.length === 1 ? '' : 's'} to Jira
          </div>
          <div class="text-[10px] {n('text-neon-yellow opacity-80', 'text-amber-700')} mb-2">
            Edit the match text to control future auto-mapping (substring, case-insensitive). Longest match wins.
          </div>
          <div class="space-y-1.5">
            {#each unmapped as u (u.event.id)}
              <div class="{n('bg-retro-surface2 border border-neon-yellow/40', 'bg-white border border-amber-200')} rounded p-2">
                <div class="text-xs {n('text-retro-bright', 'text-gray-800')} font-medium truncate" title={u.event.title}>
                  {u.event.title}
                </div>
                <div class="text-[10px] {n('text-retro-dim', 'text-gray-500')} mb-1.5">
                  {new Date(u.event.startMs).toLocaleString()} · {u.event.durationMinutes}m
                </div>
                <div class="flex gap-1.5 items-center">
                  <input
                    type="text"
                    placeholder="match substring"
                    bind:value={u.matchInput}
                    class="flex-1 px-1.5 py-1 border {n('border-retro-border2 bg-retro-surface text-retro-text', 'border-gray-300')} rounded text-[11px]"
                  />
                  <div class="w-32">
                    <JiraPicker
                      bind:value={u.jiraInput}
                      favorites={preview?.favorites ?? []}
                      disabled={u.skipInput}
                    />
                  </div>
                  <label
                    class="flex items-center gap-0.5 text-[10px] {n('text-retro-text', 'text-gray-700')} cursor-pointer shrink-0"
                    title="Drop this meeting — don't log it"
                  >
                    <input
                      type="checkbox"
                      class="{n('accent-neon-yellow', 'accent-amber-600')} w-3 h-3"
                      bind:checked={u.skipInput}
                    />
                    Skip
                  </label>
                  <button
                    class="px-2 py-1 {n('bg-neon-orange hover:bg-neon-orange-dark disabled:bg-retro-border2', 'bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300')} text-white text-[11px] rounded shrink-0"
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

      <div class="border-t {n('border-retro-border', 'border-gray-200')} px-3 py-2 flex items-center justify-between gap-2">
        {#if summary}
          <div class="text-xs">
            <span class="{n('text-neon-green', 'text-green-700')} font-medium">✓ {summary.ok} posted</span>
            {#if summary.fail > 0}
              <span class="{n('text-neon-red', 'text-red-700')} font-medium ml-2">✗ {summary.fail} failed</span>
            {/if}
            {#if summary.skipped > 0}
              <span class="{n('text-retro-muted', 'text-gray-500')} ml-2">⊘ {summary.skipped} skipped</span>
            {/if}
          </div>
        {:else}
          <div class="text-xs {n('text-retro-muted', 'text-gray-500')}">
            {#if toPostCount > 0}
              Ready to post {toPostCount} entries · <span class="font-medium {n('text-retro-text', 'text-gray-700')}">{formatDuration(toPostMinutes)}</span>
            {:else}
              Nothing to post — check entries above
            {/if}
          </div>
        {/if}
        <button
          class="px-4 py-1.5 {n('bg-neon-green-dark hover:bg-neon-green disabled:bg-retro-border2 disabled:shadow-none shadow-neon-green', 'bg-green-600 hover:bg-green-700 disabled:bg-gray-300')} text-white text-sm rounded disabled:cursor-not-allowed font-medium"
          disabled={posting || loading || toPostCount === 0}
          onclick={post}
        >
          {posting ? 'Posting…' : `Post to Tempo${toPostCount > 0 ? ` (${toPostCount})` : ''}`}
        </button>
      </div>
    </div>
  {/if}
</main>
{/if}

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
