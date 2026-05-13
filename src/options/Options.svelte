<script lang="ts">
  import {
    DEFAULT_ATTENDANCE_FILTER,
    clearFallbackCommitJira,
    clearGithubToken,
    clearCustomIcon,
    getAttendanceFilter,
    getFallbackCommitJira,
    getGithubToken,
    getNeonTheme,
    getCustomIcon,
    getUserMeetingMappings,
    getUserTemplates,
    replaceUserMeetingMappings,
    setAttendanceFilter,
    setFallbackCommitJira,
    setGithubToken,
    setCustomIcon,
    setUserTemplates,
  } from '../lib/storage';
  import { aggregate } from '../lib/aggregator';
  import { loadFavorites, type JiraIssueOption } from '../lib/orchestrator';
  import JiraPicker from '../components/JiraPicker.svelte';
  import type {
    AttendanceFilter,
    DescriptionTemplates,
    MeetingMapping,
  } from '../types';
  import teamDefaultsJson from '../../team-defaults.json';
  import githubOrgsConfig from '../../github-orgs.json';
  import type { TeamDefaults } from '../types';
  import { theme, applyThemeClass } from '../lib/theme.svelte';

  const teamDefaults = teamDefaultsJson as TeamDefaults;

  type Tab = 'general' | 'meetings' | 'github' | 'templates' | 'appearance' | 'about';
  let active = $state<Tab>('general');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'github', label: 'GitHub' },
    { id: 'templates', label: 'Templates' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'about', label: 'About' },
  ];

  // General tab
  let attendanceFilter = $state<AttendanceFilter>(DEFAULT_ATTENDANCE_FILTER);
  let attendanceSavedFlash = $state(false);

  // Meetings tab
  type MappingRow = {
    match: string;
    jiraKey: string;
    description: string;
    skip: boolean;
    invalidJira: boolean;
    invalidMatch: boolean;
  };
  let userMappings = $state<MappingRow[]>([]);
  let mappingsDirty = $state(false);
  let mappingsSavedFlash = $state(false);

  // GitHub tab
  let pat = $state('');
  let patStoredLength = $state(0);
  let patEditing = $state(false);
  let patSavedFlash = $state(false);

  let fallbackCommitJira = $state('');
  let fallbackCommitJiraSavedFlash = $state(false);

  // Templates tab
  let templateInputs = $state({
    commit: '',
    review: '',
    meeting: '',
  });
  let templateSavedFlash = $state(false);

  // Appearance tab
  let customIconDataUrl = $state<string | null>(null);
  let iconUploadError = $state('');
  let iconSavedFlash = $state(false);

  // Favorites from Jira (+ previously used) for the picker
  let favorites = $state<JiraIssueOption[]>([]);

  $effect(() => {
    void (async () => {
      const [af, mappings, token, userT, savedFallback, neon, savedIcon] = await Promise.all([
        getAttendanceFilter(),
        getUserMeetingMappings(),
        getGithubToken(),
        getUserTemplates(),
        getFallbackCommitJira(),
        getNeonTheme(),
        getCustomIcon(),
      ]);
      attendanceFilter = af;
      userMappings = mappings.map((m) => ({
        match: m.match,
        jiraKey: m.jiraKey,
        description: m.description ?? '',
        skip: m.skip === true,
        invalidJira: false,
        invalidMatch: false,
      }));
      if (token) {
        pat = '';
        patStoredLength = token.length;
      } else {
        pat = '';
        patStoredLength = 0;
        patEditing = true;
      }
      fallbackCommitJira = savedFallback ?? '';
      templateInputs = {
        commit: userT.commit ?? teamDefaults.descriptionTemplates.commit,
        review: userT.review ?? teamDefaults.descriptionTemplates.review,
        meeting: userT.meeting ?? teamDefaults.descriptionTemplates.meeting,
      };
      theme.neon = neon;
      applyThemeClass(neon);
      customIconDataUrl = savedIcon;

      // Non-critical: fetch favorites for the Jira picker
      loadFavorites()
        .then((f) => {
          favorites = f;
        })
        .catch(() => {
          favorites = [];
        });
    })();
  });

  // Shorthand: picks neon class when neon theme is active, otherwise default
  function n(neonClass: string, baseClass: string): string {
    return theme.neon ? neonClass : baseClass;
  }

  function flash(setter: (v: boolean) => void) {
    setter(true);
    setTimeout(() => setter(false), 1500);
  }

  async function saveAttendance() {
    await setAttendanceFilter(attendanceFilter);
    flash((v) => (attendanceSavedFlash = v));
  }

  function addMappingRow() {
    userMappings = [
      ...userMappings,
      {
        match: '',
        jiraKey: '',
        description: '',
        skip: false,
        invalidJira: false,
        invalidMatch: false,
      },
    ];
    mappingsDirty = true;
  }

  function removeMappingRow(i: number) {
    userMappings = userMappings.filter((_, idx) => idx !== i);
    mappingsDirty = true;
  }

  function onMappingChange() {
    mappingsDirty = true;
  }

  function validateMappings(): boolean {
    let ok = true;
    const seen = new Set<string>();
    for (const r of userMappings) {
      r.invalidMatch = r.match.trim().length === 0;
      // Jira key is only required when the mapping actually logs.
      r.invalidJira = r.skip
        ? false
        : !/^[A-Z][A-Z0-9]+-\d+$/i.test(r.jiraKey.trim());
      if (r.invalidMatch || r.invalidJira) ok = false;
      const key = r.match.trim().toLowerCase();
      if (seen.has(key)) {
        r.invalidMatch = true;
        ok = false;
      }
      seen.add(key);
    }
    userMappings = [...userMappings];
    return ok;
  }

  async function saveMappings() {
    if (!validateMappings()) return;
    const normalized: MeetingMapping[] = userMappings.map((r) => ({
      match: r.match.trim(),
      jiraKey: r.skip ? '' : r.jiraKey.trim().toUpperCase(),
      description: r.description.trim(),
      skip: r.skip === true ? true : undefined,
    }));
    await replaceUserMeetingMappings(normalized);
    mappingsDirty = false;
    flash((v) => (mappingsSavedFlash = v));
  }

  async function savePat() {
    const trimmed = pat.trim();
    if (trimmed.length === 0) return;
    await setGithubToken(trimmed);
    patStoredLength = trimmed.length;
    pat = '';
    patEditing = false;
    flash((v) => (patSavedFlash = v));
  }

  async function removePat() {
    if (!confirm('Remove the stored GitHub PAT?')) return;
    await clearGithubToken();
    patStoredLength = 0;
    pat = '';
    patEditing = true;
  }

  async function saveFallbackCommitJira() {
    const trimmed = fallbackCommitJira.trim().toUpperCase();
    if (trimmed.length === 0) {
      await clearFallbackCommitJira();
    } else {
      await setFallbackCommitJira(trimmed);
      fallbackCommitJira = trimmed;
    }
    flash((v) => (fallbackCommitJiraSavedFlash = v));
  }

  async function saveTemplates() {
    const out: Partial<DescriptionTemplates> = {};
    const d = teamDefaults.descriptionTemplates;
    if (templateInputs.commit.trim() && templateInputs.commit !== d.commit) {
      out.commit = templateInputs.commit;
    }
    if (templateInputs.review.trim() && templateInputs.review !== d.review) {
      out.review = templateInputs.review;
    }
    if (templateInputs.meeting.trim() && templateInputs.meeting !== d.meeting) {
      out.meeting = templateInputs.meeting;
    }
    await setUserTemplates(out);
    flash((v) => (templateSavedFlash = v));
  }

  function resetTemplate(key: keyof DescriptionTemplates) {
    templateInputs = {
      ...templateInputs,
      [key]: teamDefaults.descriptionTemplates[key],
    };
  }

  const MAX_ICON_BYTES = 2 * 1024 * 1024; // 2 MB

  function handleIconFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    iconUploadError = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      iconUploadError = 'Please choose an image file.';
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      iconUploadError = 'Image must be smaller than 2 MB.';
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      await setCustomIcon(dataUrl);
      customIconDataUrl = dataUrl;
      flash((v) => (iconSavedFlash = v));
    };
    reader.readAsDataURL(file);
  }

  async function removeCustomIcon() {
    await clearCustomIcon();
    customIconDataUrl = null;
  }

  // Live template preview — simulate a fake entry to show what the comment would look like
  const previewSample = $derived.by(() => {
    const fake = aggregate({
      commits: [
        { date: '2026-04-20', committedAt: '2026-04-20T09:00:00Z', jiraKey: 'NUMO-123', repo: 'Visma/example', commitSha: 'abc', message: 'example' },
      ],
      reviews: [
        {
          date: '2026-04-20',
          jiraKey: 'NUMO-456',
          repo: 'Visma/example',
          prNumber: 999,
          prTitle: 'Example PR title',
          prBranch: 'feature/NUMO-456',
          reviewState: 'APPROVED',
        },
      ],
      events: [
        {
          id: 'fake-event',
          title: 'Daily standup',
          startMs: Date.parse('2026-04-20T09:00:00Z'),
          endMs: Date.parse('2026-04-20T09:15:00Z'),
          allDay: false,
          attendanceStatus: 'accepted',
          durationMinutes: 15,
        },
      ],
      teamDefaults: {
        ...teamDefaults,
        meetings: [{ match: 'daily', jiraKey: 'NUMO-1000' }],
      },
      userMeetingMappings: [],
      userDescriptionTemplates: {
        commit: templateInputs.commit,
        review: templateInputs.review,
        meeting: templateInputs.meeting,
      },
      attendanceFilter: 'all',
      timeZone: 'Europe/Riga',
      dateFrom: '2026-04-20',
      dateTo: '2026-04-20',
    });
    return fake.entries;
  });
</script>

<main class="{n('bg-retro-bg retro-grid', 'bg-gray-50')} min-h-screen font-sans">
  <div class="max-w-4xl mx-auto p-6">
    <header class="mb-6">
      <h1 class="{n('retro-glow-text', 'text-gray-900')} text-2xl font-semibold">Tempo Auto Logger</h1>
      <p class="{n('text-retro-muted', 'text-gray-600')} text-sm mt-1">Settings</p>
    </header>

    <div class="{n('bg-retro-surface border-retro-border', 'bg-white border-gray-200')} rounded shadow-sm border">
      <nav class="flex {n('border-retro-border', 'border-gray-200')} border-b" aria-label="Settings tabs">
        {#each tabs as tab (tab.id)}
          <button
            class="px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors {active === tab.id
              ? n('border-neon-cyan text-neon-cyan', 'border-blue-600 text-blue-600')
              : n('border-transparent text-retro-muted hover:text-retro-bright', 'border-transparent text-gray-600 hover:text-gray-900')}"
            onclick={() => (active = tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </nav>

      <div class="p-6">
        {#if active === 'general'}
          <h2 class="{n('text-retro-bright neon-text-cyan', 'text-gray-900')} text-lg font-medium mb-4">General</h2>

          <div class="space-y-4">
            <div>
              <h3 class="{n('text-retro-bright', 'text-gray-900')} text-sm font-medium mb-2">
                Which calendar meetings should be logged?
              </h3>
              <p class="{n('text-retro-muted', 'text-gray-600')} text-xs mb-3">
                Filters events before mapping. All-day events (like name-day
                calendars) are always skipped regardless of this setting.
              </p>
              <div class="space-y-2">
                {#each [
                  { value: 'accepted', label: 'Only meetings I accepted' },
                  { value: 'all-except-declined', label: 'All except the ones I declined' },
                  { value: 'all', label: 'All meetings in my calendar (even declined)' },
                ] as opt (opt.value)}
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="attendance"
                      value={opt.value}
                      checked={attendanceFilter === opt.value}
                      onchange={() => (attendanceFilter = opt.value as AttendanceFilter)}
                      class="{n('accent-neon-cyan', 'accent-blue-600')}"
                    />
                    <span class="{n('text-retro-text', 'text-gray-800')} text-sm">{opt.label}</span>
                  </label>
                {/each}
              </div>
            </div>

            <div class="pt-3 {n('border-retro-border', 'border-gray-200')} border-t flex items-center gap-3">
              <button
                class="{n('bg-neon-pink hover:bg-neon-pink-dark shadow-neon-pink', 'bg-blue-600 hover:bg-blue-700')} px-3 py-1.5 text-white text-sm rounded"
                onclick={saveAttendance}
              >
                Save
              </button>
              {#if attendanceSavedFlash}
                <span class="{n('text-neon-green', 'text-green-700')} text-sm">Saved ✓</span>
              {/if}
            </div>
          </div>
        {:else if active === 'meetings'}
          <h2 class="{n('text-retro-bright neon-text-cyan', 'text-gray-900')} text-lg font-medium mb-2">
            Your meeting mappings
          </h2>
          <p class="{n('text-retro-muted', 'text-gray-600')} text-xs mb-4">
            A meeting's title is matched against these "match" strings
            (case-insensitive substring). Longest match wins. Description
            is optional — if blank, no description is posted to Tempo (use
            <em>Settings → Templates</em> to default to the meeting title).
            Tick <strong>Skip</strong> to drop matching meetings
            from the preview entirely (useful for "Out of office",
            holidays, etc.).
          </p>

          <div class="space-y-2 mb-3">
            {#if userMappings.length === 0}
              <div class="{n('text-retro-muted bg-retro-surface2 border-retro-border2', 'text-gray-500 bg-gray-50 border-gray-300')} text-sm italic py-4 text-center rounded border border-dashed">
                No mappings yet — add one below, or save them from the popup
                when unmapped meetings appear.
              </div>
            {/if}
            <div class="flex gap-2 items-center {n('text-retro-dim', 'text-gray-500')} text-[11px] uppercase px-1">
              <div class="flex-1">Match substring</div>
              <div class="w-44">Jira key</div>
              <div class="w-16 text-center">Skip</div>
              <div class="flex-1">Description (optional)</div>
              <div class="w-8"></div>
            </div>
            {#each userMappings as row, i (i)}
              <div class="flex gap-2 items-center">
                <div class="flex-1">
                  <input
                    type="text"
                    placeholder="e.g. sigma daily"
                    bind:value={row.match}
                    oninput={onMappingChange}
                    class="w-full px-2 py-1.5 border rounded text-sm {row.invalidMatch
                      ? 'border-red-400 bg-red-50 text-gray-900'
                      : n('border-retro-border2 bg-retro-surface text-retro-text', 'border-gray-300 bg-white text-gray-800')}"
                  />
                </div>
                <div class="w-44">
                  <JiraPicker
                    bind:value={row.jiraKey}
                    {favorites}
                    size="normal"
                    disabled={row.skip}
                    inputClass={row.invalidJira ? 'border-red-400 bg-red-50' : ''}
                    onchange={onMappingChange}
                  />
                </div>
                <div class="w-16 flex justify-center">
                  <input
                    type="checkbox"
                    class="{n('accent-neon-cyan', 'accent-blue-600')} w-4 h-4 cursor-pointer"
                    bind:checked={row.skip}
                    onchange={onMappingChange}
                    title="Drop matching meetings — don't log anything"
                  />
                </div>
                <div class="flex-1">
                  <input
                    type="text"
                    placeholder={row.skip ? 'not used when Skip is on' : 'description (optional)'}
                    bind:value={row.description}
                    oninput={onMappingChange}
                    disabled={row.skip}
                    class="w-full px-2 py-1.5 border rounded text-sm {n('border-retro-border2 bg-retro-surface text-retro-text disabled:bg-retro-bg disabled:text-retro-dim', 'border-gray-300 disabled:bg-gray-100 disabled:text-gray-400')}"
                  />
                </div>
                <button
                  class="{n('text-neon-red hover:bg-neon-red-bg', 'text-red-600 hover:bg-red-50')} w-8 rounded text-sm"
                  onclick={() => removeMappingRow(i)}
                  aria-label="Remove"
                >
                  ✗
                </button>
              </div>
            {/each}
          </div>

          <button
            class="{n('border-retro-border2 hover:bg-retro-surface2 text-retro-text', 'border-gray-300 hover:bg-gray-50 text-gray-700')} px-3 py-1.5 border text-sm rounded"
            onclick={addMappingRow}
          >
            + Add mapping
          </button>

          <div class="mt-4 pt-3 {n('border-retro-border', 'border-gray-200')} border-t flex items-center gap-3">
            <button
              class="{n('bg-neon-pink hover:bg-neon-pink-dark shadow-neon-pink disabled:bg-retro-border2', 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300')} px-3 py-1.5 text-white text-sm rounded"
              disabled={!mappingsDirty}
              onclick={saveMappings}
            >
              Save mappings
            </button>
            {#if mappingsSavedFlash}
              <span class="{n('text-neon-green', 'text-green-700')} text-sm">Saved ✓</span>
            {:else if mappingsDirty}
              <span class="{n('text-neon-yellow', 'text-amber-700')} text-sm">Unsaved changes</span>
            {/if}
          </div>

          {#if teamDefaults.meetings.length > 0}
            <div class="mt-6 pt-4 {n('border-retro-border', 'border-gray-200')} border-t">
              <h3 class="{n('text-retro-bright', 'text-gray-900')} text-sm font-medium mb-2">
                Team defaults (read-only, shipped in repo)
              </h3>
              <div class="{n('text-retro-muted', 'text-gray-600')} text-xs space-y-1">
                {#each teamDefaults.meetings as m (m.match)}
                  <div class="font-mono">
                    {m.match} → <span class="{n('text-neon-cyan', 'text-blue-600')}">{m.jiraKey}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {:else if active === 'github'}
          <h2 class="{n('text-retro-bright neon-text-cyan', 'text-gray-900')} text-lg font-medium mb-2">GitHub</h2>
          <p class="{n('text-retro-muted', 'text-gray-600')} text-xs mb-4">
            <strong>Optional.</strong> Add a personal access token if
            you want the extension to read your commits and submitted
            PR reviews. Leave it blank to run in <em>meetings-only
            mode</em> (only calendar meetings get logged). Stored in
            <code>chrome.storage.local</code> on this device only.
          </p>

          <div class="space-y-3">
            <div>
              <label for="pat-input" class="{n('text-retro-bright', 'text-gray-900')} block text-sm font-medium mb-1">
                Personal access token
              </label>
              {#if patStoredLength > 0 && !patEditing}
                <div class="flex items-center gap-3">
                  <div class="flex-1 px-3 py-2 {n('bg-retro-surface2 border-retro-border text-retro-muted', 'bg-gray-50 border-gray-200 text-gray-500')} border rounded font-mono text-sm">
                    {'•'.repeat(Math.min(patStoredLength, 40))}
                  </div>
                  <button
                    class="{n('border-retro-border2 hover:bg-retro-surface2 text-retro-text', 'border-gray-300 hover:bg-gray-50')} px-3 py-1.5 border text-sm rounded"
                    onclick={() => {
                      patEditing = true;
                      pat = '';
                    }}
                  >
                    Replace
                  </button>
                  <button
                    class="{n('border-neon-red text-neon-red hover:bg-neon-red-bg', 'border-red-300 text-red-700 hover:bg-red-50')} px-3 py-1.5 border text-sm rounded"
                    onclick={removePat}
                  >
                    Remove
                  </button>
                </div>
              {:else}
                <div class="flex items-center gap-2">
                  <input
                    id="pat-input"
                    type="password"
                    placeholder="ghp_…"
                    bind:value={pat}
                    class="flex-1 px-3 py-2 {n('border-retro-border2 bg-retro-surface text-retro-text', 'border-gray-300')} border rounded font-mono text-sm"
                  />
                  <button
                    class="{n('bg-neon-pink hover:bg-neon-pink-dark shadow-neon-pink disabled:bg-retro-border2', 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300')} px-3 py-1.5 text-white text-sm rounded"
                    disabled={pat.trim().length === 0}
                    onclick={savePat}
                  >
                    Save
                  </button>
                  {#if patStoredLength > 0}
                    <button
                      class="{n('border-retro-border2 hover:bg-retro-surface2 text-retro-text', 'border-gray-300 hover:bg-gray-50 text-gray-700')} px-3 py-1.5 border text-sm rounded"
                      onclick={() => {
                        patEditing = false;
                        pat = '';
                      }}
                    >
                      Cancel
                    </button>
                  {/if}
                </div>
              {/if}
              {#if patSavedFlash}
                <div class="{n('text-neon-green', 'text-green-700')} text-sm mt-1">Saved ✓</div>
              {/if}
              <p class="{n('text-retro-muted', 'text-gray-500')} text-xs mt-2">
                Create one at
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noopener"
                  class="{n('text-neon-cyan', 'text-blue-600')} hover:underline">github.com/settings/tokens</a
                >. Scopes: <code>repo</code> + <code>read:user</code> for
                classic, or <code>Contents: Read</code> + <code>Pull requests: Read</code>
                + <code>Metadata: Read</code> for fine-grained.
              </p>
            </div>

            <div class="pt-3 {n('border-retro-border', 'border-gray-200')} border-t">
              <h3 class="{n('text-retro-bright', 'text-gray-900')} text-sm font-medium mb-1">
                Fallback Jira issue for commits without a key
              </h3>
              <p class="{n('text-retro-muted', 'text-gray-600')} text-xs mb-2">
                When set, commits whose message contains no Jira key (e.g.
                <code>NUMO-123</code>) are logged under this issue instead of
                being silently ignored. Leave blank to keep the old behaviour.
              </p>
              <div class="flex items-center gap-2">
                <JiraPicker
                  bind:value={fallbackCommitJira}
                  {favorites}
                  size="normal"
                  placeholder="e.g. NUMO-999"
                />
                <button
                  class="{n('bg-neon-pink hover:bg-neon-pink-dark shadow-neon-pink', 'bg-blue-600 hover:bg-blue-700')} px-3 py-1.5 text-white text-sm rounded"
                  onclick={saveFallbackCommitJira}
                >
                  Save
                </button>
                {#if fallbackCommitJiraSavedFlash}
                  <span class="{n('text-neon-green', 'text-green-700')} text-sm">Saved ✓</span>
                {/if}
              </div>
            </div>

            <div class="pt-3 {n('border-retro-border', 'border-gray-200')} border-t">
              <h3 class="{n('text-retro-bright', 'text-gray-900')} text-sm font-medium mb-1">
                Scanned GitHub orgs
              </h3>
              <p class="{n('text-retro-muted', 'text-gray-600')} text-xs mb-2">
                Configured in <code>github-orgs.json</code> in the repo —
                shared across teammates. Edit the file and rebuild to change.
              </p>
              <div class="flex flex-wrap gap-1.5">
                {#each githubOrgsConfig.orgs as org (org)}
                  <span class="{n('bg-retro-surface2 text-retro-text', 'bg-gray-100 text-gray-800')} px-2 py-1 text-xs rounded font-mono">
                    {org}
                  </span>
                {/each}
              </div>
            </div>
          </div>
        {:else if active === 'templates'}
          <h2 class="{n('text-retro-bright neon-text-cyan', 'text-gray-900')} text-lg font-medium mb-2">
            Description templates
          </h2>
          <p class="{n('text-retro-muted', 'text-gray-600')} text-xs mb-4">
            These become the Tempo worklog comments. Placeholders:
            <code>{'{issue}'}</code>, <code>{'{prNum}'}</code>,
            <code>{'{prTitle}'}</code>, <code>{'{title}'}</code> (meeting title).
            Your edits are saved locally and override the team defaults.
            Comments are posted to Tempo verbatim — no extra prefix or
            tag is appended. Dedupe on re-run compares worklog comments
            by exact match (plus a legacy sig-marker check for entries
            posted before this simplification).
          </p>

          <div class="space-y-4">
            {#each [
              { key: 'commit' as const, label: 'Commits', hint: 'Placeholders: {issue}' },
              { key: 'review' as const, label: 'Reviews', hint: 'Placeholders: {issue}, {prNum}, {prTitle}' },
              { key: 'meeting' as const, label: 'Meetings', hint: 'Placeholders: {issue}, {title}' },
            ] as field (field.key)}
              <div>
                <div class="flex items-baseline justify-between mb-1">
                  <label for="tpl-{field.key}" class="{n('text-retro-bright', 'text-gray-900')} text-sm font-medium">
                    {field.label}
                  </label>
                  <button
                    class="{n('text-neon-cyan', 'text-blue-600')} text-xs hover:underline"
                    onclick={() => resetTemplate(field.key)}
                  >
                    Reset to team default
                  </button>
                </div>
                <input
                  id="tpl-{field.key}"
                  type="text"
                  bind:value={templateInputs[field.key]}
                  class="w-full px-3 py-2 {n('border-retro-border2 bg-retro-surface text-retro-text', 'border-gray-300')} border rounded font-mono text-sm"
                />
                <p class="{n('text-retro-muted', 'text-gray-500')} text-xs mt-1">{field.hint}</p>
              </div>
            {/each}
          </div>

          <div class="mt-5 p-3 {n('bg-retro-surface2 border-retro-border', 'bg-gray-50 border-gray-200')} rounded border">
            <h3 class="{n('text-retro-bright', 'text-gray-700')} text-xs font-medium mb-2">
              Live preview (sample data)
            </h3>
            <div class="{n('text-retro-text', 'text-gray-700')} space-y-1 text-xs font-mono">
              {#each previewSample as e (e.id)}
                <div class="truncate" title={e.comment}>{e.comment}</div>
              {/each}
            </div>
          </div>

          <div class="mt-4 pt-3 {n('border-retro-border', 'border-gray-200')} border-t flex items-center gap-3">
            <button
              class="{n('bg-neon-pink hover:bg-neon-pink-dark shadow-neon-pink', 'bg-blue-600 hover:bg-blue-700')} px-3 py-1.5 text-white text-sm rounded"
              onclick={saveTemplates}
            >
              Save templates
            </button>
            {#if templateSavedFlash}
              <span class="{n('text-neon-green', 'text-green-700')} text-sm">Saved ✓</span>
            {/if}
          </div>
        {:else if active === 'appearance'}
          <h2 class="{n('text-retro-bright neon-text-cyan', 'text-gray-900')} text-lg font-medium mb-4">Appearance</h2>

          <div class="space-y-6">
            <div>
              <h3 class="{n('text-retro-bright', 'text-gray-900')} text-sm font-medium mb-1">
                Extension icon
              </h3>
              <p class="{n('text-retro-muted', 'text-gray-600')} text-xs mb-3">
                Replace the toolbar icon with your own image. PNG or SVG recommended;
                must be under 2 MB. The icon is stored locally on this device.
              </p>

              <div class="flex items-center gap-4 mb-3">
                <div class="{n('bg-retro-surface2 border-retro-border2', 'bg-gray-100 border-gray-300')} border rounded p-2 flex-shrink-0">
                  {#if customIconDataUrl}
                    <img src={customIconDataUrl} alt="Custom extension icon" class="w-10 h-10 object-contain" />
                  {:else}
                    <img src="../../src/icons/pony48.png" alt="Default extension icon" class="w-10 h-10 object-contain" />
                  {/if}
                </div>
                <div class="text-xs {n('text-retro-muted', 'text-gray-500')}">
                  {#if customIconDataUrl}
                    Custom icon active
                  {:else}
                    Default icon (pink pony)
                  {/if}
                </div>
              </div>

              <div class="flex items-center gap-3 flex-wrap">
                <label
                  class="{n('border-retro-border2 hover:bg-retro-surface2 text-retro-text', 'border-gray-300 hover:bg-gray-50 text-gray-700')} px-3 py-1.5 border text-sm rounded cursor-pointer"
                >
                  {customIconDataUrl ? 'Replace icon' : 'Upload icon'}
                  <input
                    type="file"
                    accept="image/*"
                    class="sr-only"
                    onchange={handleIconFileChange}
                  />
                </label>
                {#if customIconDataUrl}
                  <button
                    class="{n('border-neon-red text-neon-red hover:bg-neon-red-bg', 'border-red-300 text-red-700 hover:bg-red-50')} px-3 py-1.5 border text-sm rounded"
                    onclick={removeCustomIcon}
                  >
                    Remove (reset to default)
                  </button>
                {/if}
                {#if iconSavedFlash}
                  <span class="{n('text-neon-green', 'text-green-700')} text-sm">Saved ✓</span>
                {/if}
              </div>
              {#if iconUploadError}
                <p class="text-red-600 text-xs mt-2">{iconUploadError}</p>
              {/if}
            </div>
          </div>
        {:else if active === 'about'}
          <h2 class="{n('text-retro-bright neon-text-cyan', 'text-gray-900')} text-lg font-medium mb-3">About</h2>
          <div class="{n('text-retro-text', 'text-gray-700')} space-y-3 text-sm">
            <p>
              <strong>Tempo Auto Logger</strong> logs commits, reviews, and
              meetings to Jira Tempo with one click. It talks to Jira and
              Google Calendar through your existing browser session (no OAuth
              tokens needed) and uses a GitHub PAT for your activity.
            </p>
            <p>
              <strong>Rules:</strong>
            </p>
            <ul class="list-disc pl-5 space-y-1 text-xs">
              <li>Own commits → 1 min per Jira issue per day</li>
              <li>Submitted PR reviews → 15 min per PR per day (PRs you didn't author)</li>
              <li>Meetings → exact calendar duration, with Jira mapping by title substring</li>
              <li>Dedupe: existing Tempo entries with the same issue/date/comment are detected and skipped on re-run (legacy <code>[#sig:…]</code> tags still recognized)</li>
            </ul>
            <p class="pt-2 {n('border-retro-border', 'border-gray-200')} border-t">
              <a
                href="https://github.com/kristapsk123/tempo-auto-logger"
                target="_blank"
                rel="noopener"
                class="{n('text-neon-cyan', 'text-blue-600')} hover:underline">Source on GitHub</a
              >
              · report bugs there or push improvements directly.
            </p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</main>
