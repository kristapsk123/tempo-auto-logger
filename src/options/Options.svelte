<script lang="ts">
  import {
    DEFAULT_ATTENDANCE_FILTER,
    clearGithubToken,
    getAttendanceFilter,
    getGithubToken,
    getUserMeetingMappings,
    getUserTemplates,
    replaceUserMeetingMappings,
    setAttendanceFilter,
    setGithubToken,
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

  const teamDefaults = teamDefaultsJson as TeamDefaults;

  type Tab = 'general' | 'meetings' | 'github' | 'templates' | 'about';
  let active = $state<Tab>('general');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'github', label: 'GitHub' },
    { id: 'templates', label: 'Templates' },
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

  // Templates tab
  let templateInputs = $state({
    commit: '',
    review: '',
    meeting: '',
  });
  let templateSavedFlash = $state(false);

  // Favorites from Jira (+ previously used) for the picker
  let favorites = $state<JiraIssueOption[]>([]);

  $effect(() => {
    void (async () => {
      const [af, mappings, token, userT] = await Promise.all([
        getAttendanceFilter(),
        getUserMeetingMappings(),
        getGithubToken(),
        getUserTemplates(),
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
      templateInputs = {
        commit: userT.commit ?? teamDefaults.descriptionTemplates.commit,
        review: userT.review ?? teamDefaults.descriptionTemplates.review,
        meeting: userT.meeting ?? teamDefaults.descriptionTemplates.meeting,
      };

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
      description: r.description.trim() || undefined,
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

  // Live template preview — simulate a fake entry to show what the comment would look like
  const previewSample = $derived.by(() => {
    const fake = aggregate({
      commits: [
        { date: '2026-04-20', jiraKey: 'NUMO-123', repo: 'Visma/example', commitSha: 'abc', message: 'example' },
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

<main class="min-h-screen bg-gray-50 font-sans">
  <div class="max-w-4xl mx-auto p-6">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold text-gray-900">Tempo Auto Logger</h1>
      <p class="text-sm text-gray-600 mt-1">Settings</p>
    </header>

    <div class="bg-white rounded shadow-sm border border-gray-200">
      <nav class="flex border-b border-gray-200" aria-label="Settings tabs">
        {#each tabs as tab (tab.id)}
          <button
            class="px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors {active === tab.id
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'}"
            onclick={() => (active = tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </nav>

      <div class="p-6">
        {#if active === 'general'}
          <h2 class="text-lg font-medium text-gray-900 mb-4">General</h2>

          <div class="space-y-4">
            <div>
              <h3 class="text-sm font-medium text-gray-900 mb-2">
                Which calendar meetings should be logged?
              </h3>
              <p class="text-xs text-gray-600 mb-3">
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
                      class="accent-blue-600"
                    />
                    <span class="text-sm text-gray-800">{opt.label}</span>
                  </label>
                {/each}
              </div>
            </div>

            <div class="pt-3 border-t border-gray-200 flex items-center gap-3">
              <button
                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
                onclick={saveAttendance}
              >
                Save
              </button>
              {#if attendanceSavedFlash}
                <span class="text-sm text-green-700">Saved ✓</span>
              {/if}
            </div>
          </div>
        {:else if active === 'meetings'}
          <h2 class="text-lg font-medium text-gray-900 mb-2">
            Your meeting mappings
          </h2>
          <p class="text-xs text-gray-600 mb-4">
            A meeting's title is matched against these "match" strings
            (case-insensitive substring). Longest match wins. Description
            is optional — if blank, the meeting's actual calendar title is
            used. Tick <strong>Skip</strong> to drop matching meetings
            from the preview entirely (useful for "Out of office",
            holidays, etc.).
          </p>

          <div class="space-y-2 mb-3">
            {#if userMappings.length === 0}
              <div class="text-sm text-gray-500 italic py-4 text-center bg-gray-50 rounded border border-dashed border-gray-300">
                No mappings yet — add one below, or save them from the popup
                when unmapped meetings appear.
              </div>
            {/if}
            <div class="flex gap-2 items-center text-[11px] text-gray-500 uppercase px-1">
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
                      ? 'border-red-400 bg-red-50'
                      : 'border-gray-300'}"
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
                    class="accent-blue-600 w-4 h-4 cursor-pointer"
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
                    class="w-full px-2 py-1.5 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
                <button
                  class="w-8 text-red-600 hover:bg-red-50 rounded text-sm"
                  onclick={() => removeMappingRow(i)}
                  aria-label="Remove"
                >
                  ✗
                </button>
              </div>
            {/each}
          </div>

          <button
            class="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 text-sm rounded text-gray-700"
            onclick={addMappingRow}
          >
            + Add mapping
          </button>

          <div class="mt-4 pt-3 border-t border-gray-200 flex items-center gap-3">
            <button
              class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded"
              disabled={!mappingsDirty}
              onclick={saveMappings}
            >
              Save mappings
            </button>
            {#if mappingsSavedFlash}
              <span class="text-sm text-green-700">Saved ✓</span>
            {:else if mappingsDirty}
              <span class="text-sm text-amber-700">Unsaved changes</span>
            {/if}
          </div>

          {#if teamDefaults.meetings.length > 0}
            <div class="mt-6 pt-4 border-t border-gray-200">
              <h3 class="text-sm font-medium text-gray-900 mb-2">
                Team defaults (read-only, shipped in repo)
              </h3>
              <div class="text-xs text-gray-600 space-y-1">
                {#each teamDefaults.meetings as m (m.match)}
                  <div class="font-mono">
                    {m.match} → <span class="text-blue-600">{m.jiraKey}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {:else if active === 'github'}
          <h2 class="text-lg font-medium text-gray-900 mb-2">GitHub</h2>
          <p class="text-xs text-gray-600 mb-4">
            <strong>Optional.</strong> Add a personal access token if
            you want the extension to read your commits and submitted
            PR reviews. Leave it blank to run in <em>meetings-only
            mode</em> (only calendar meetings get logged). Stored in
            <code>chrome.storage.local</code> on this device only.
          </p>

          <div class="space-y-3">
            <div>
              <label for="pat-input" class="block text-sm font-medium text-gray-900 mb-1">
                Personal access token
              </label>
              {#if patStoredLength > 0 && !patEditing}
                <div class="flex items-center gap-3">
                  <div class="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded font-mono text-sm text-gray-500">
                    {'•'.repeat(Math.min(patStoredLength, 40))}
                  </div>
                  <button
                    class="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 text-sm rounded"
                    onclick={() => {
                      patEditing = true;
                      pat = '';
                    }}
                  >
                    Replace
                  </button>
                  <button
                    class="px-3 py-1.5 border border-red-300 text-red-700 hover:bg-red-50 text-sm rounded"
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
                    class="flex-1 px-3 py-2 border border-gray-300 rounded font-mono text-sm"
                  />
                  <button
                    class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded"
                    disabled={pat.trim().length === 0}
                    onclick={savePat}
                  >
                    Save
                  </button>
                  {#if patStoredLength > 0}
                    <button
                      class="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 text-sm rounded text-gray-700"
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
                <div class="text-sm text-green-700 mt-1">Saved ✓</div>
              {/if}
              <p class="text-xs text-gray-500 mt-2">
                Create one at
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noopener"
                  class="text-blue-600 hover:underline">github.com/settings/tokens</a
                >. Scopes: <code>repo</code> + <code>read:user</code> for
                classic, or <code>Contents: Read</code> + <code>Pull requests: Read</code>
                + <code>Metadata: Read</code> for fine-grained.
              </p>
            </div>

            <div class="pt-3 border-t border-gray-200">
              <h3 class="text-sm font-medium text-gray-900 mb-1">
                Scanned GitHub orgs
              </h3>
              <p class="text-xs text-gray-600 mb-2">
                Configured in <code>github-orgs.json</code> in the repo —
                shared across teammates. Edit the file and rebuild to change.
              </p>
              <div class="flex flex-wrap gap-1.5">
                {#each githubOrgsConfig.orgs as org (org)}
                  <span class="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded font-mono">
                    {org}
                  </span>
                {/each}
              </div>
            </div>
          </div>
        {:else if active === 'templates'}
          <h2 class="text-lg font-medium text-gray-900 mb-2">
            Description templates
          </h2>
          <p class="text-xs text-gray-600 mb-4">
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
                  <label for="tpl-{field.key}" class="text-sm font-medium text-gray-900">
                    {field.label}
                  </label>
                  <button
                    class="text-xs text-blue-600 hover:underline"
                    onclick={() => resetTemplate(field.key)}
                  >
                    Reset to team default
                  </button>
                </div>
                <input
                  id="tpl-{field.key}"
                  type="text"
                  bind:value={templateInputs[field.key]}
                  class="w-full px-3 py-2 border border-gray-300 rounded font-mono text-sm"
                />
                <p class="text-xs text-gray-500 mt-1">{field.hint}</p>
              </div>
            {/each}
          </div>

          <div class="mt-5 p-3 bg-gray-50 rounded border border-gray-200">
            <h3 class="text-xs font-medium text-gray-700 mb-2">
              Live preview (sample data)
            </h3>
            <div class="space-y-1 text-xs font-mono text-gray-700">
              {#each previewSample as e (e.id)}
                <div class="truncate" title={e.comment}>{e.comment}</div>
              {/each}
            </div>
          </div>

          <div class="mt-4 pt-3 border-t border-gray-200 flex items-center gap-3">
            <button
              class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
              onclick={saveTemplates}
            >
              Save templates
            </button>
            {#if templateSavedFlash}
              <span class="text-sm text-green-700">Saved ✓</span>
            {/if}
          </div>
        {:else if active === 'about'}
          <h2 class="text-lg font-medium text-gray-900 mb-3">About</h2>
          <div class="space-y-3 text-sm text-gray-700">
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
            <p class="pt-2 border-t border-gray-200">
              <a
                href="https://github.com/kristapsk123/tempo-auto-logger"
                target="_blank"
                rel="noopener"
                class="text-blue-600 hover:underline">Source on GitHub</a
              >
              · report bugs there or push improvements directly.
            </p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</main>
