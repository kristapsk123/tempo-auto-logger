# CLAUDE.md — project brief for AI sessions

This file tells Claude (or any AI assistant) what this repo is, so you
don't have to re-explain the project every time. Read this first.

## What it is

Chrome extension (Manifest V3) that auto-logs time to Jira Tempo from
three data sources, picked on click:

- **GitHub commits** — your own commits are tallied as 1 min per Jira
  issue per day.
- **GitHub PR reviews** — submitted reviews (not file-level comments) are
  tallied as 15 min per PR per day, but only for PRs you didn't author.
- **Google Calendar meetings** — the exact duration of each timed event
  that you have a Jira mapping for.

User clicks "Log yesterday" (or "Log today"), sees a preview with
checkboxes, clicks "Post to Tempo (N)", each entry posts serially with
live per-row status, done.

## Why it exists

Built for Kristaps Krauze at Visma. Goal: stop wasting time copy-pasting
GitHub/Calendar activity into Tempo every day. Targeted for teammates on
the same `Numo.WorkTimePlanning.App` team — they can clone, `npm install`,
`npm run build`, load unpacked in Chrome.

## Auth — why it works without OAuth or API tokens

Visma's infra blocks OAuth app registration, and Jira PATs 302-redirect
to AWS Cognito when used as bearer tokens (Cognito gates the load
balancer before requests reach Jira). **Workaround:** a Chrome extension
with `host_permissions` can `fetch()` Jira/Calendar endpoints
same-origin, riding the user's existing browser session cookies. No
token dance.

- **Jira/Tempo:** `fetch('/rest/...')` against `jira.visma.com` with
  `credentials: 'include'`.
- **Calendar:** `fetch('/calendar/u/0/sync.fetcheventrange', POST, form-encoded)`
  against `calendar.google.com`. Undocumented internal endpoint but
  stable for the purpose. **No `secid` XSRF param needed** — cookies
  alone authenticate it (verified 2026-04-21).
- **GitHub:** uses a normal personal access token (no SSO-like problem
  on github.com). Stored in `chrome.storage.local`.

## Environment-specific facts

Jira: `https://jira.visma.com` — **Atlassian Jira Data Center
v9.12.14**, NOT Jira Cloud. Use `/rest/api/2/...` and
`/rest/tempo-timesheets/4/...` endpoints. Username for Tempo `worker`
field is the `name` field returned by `/rest/api/2/myself` (e.g.
`kristaps.krauze`). Project key: `NUMO-`.

Tempo create-worklog payload needs `originTaskId` (numeric Jira issue
id), not the key. Resolve via `GET /rest/api/2/issue/{KEY}?fields=summary`
first. `started` accepts `YYYY-MM-DD` (tested working).

## Tech stack

- **Svelte 5** (runes: `$state`, `$derived`, `$effect`, `$props`)
- **Vite 5** + **`@crxjs/vite-plugin` 2.0** (MV3 manifest + HMR)
- **TypeScript** strict
- **Tailwind 3**
- **Chrome Extension MV3** — popup + options page + service worker

`team-defaults.json` and `github-orgs.json` live at repo root and are
shared across teammates. Per-user settings live in `chrome.storage.local`.

## File layout

```
src/
  background/
    service-worker.ts       MV3 background worker (mostly a stub today)
  popup/
    Popup.svelte            Main UI: Log yesterday/today, preview, post
    index.html, main.ts
  options/
    Options.svelte          Settings page: 5 tabs
    index.html, main.ts
  components/
    JiraPicker.svelte       Reusable combobox for picking Jira keys
                            with favorites / recent issues dropdown
  lib/
    config.ts               Base URLs
    http.ts                 jiraFetch() helper, SessionExpiredError
    storage.ts              chrome.storage.local wrappers for user
                            settings (PAT, mappings, attendance filter,
                            templates)
    jira-client.ts          Jira REST API client (myself, getIssue,
                            searchIssuePicker, fetchIssueSummaries)
    tempo-client.ts         Tempo Timesheets v4 (listWorklogs,
                            createWorklog)
    github-client.ts        GitHub API (user, search commits,
                            list reviews)
    calendar-client.ts      Google Calendar sync.fetcheventrange
                            (same-origin, undocumented endpoint)
    jira-key-extractor.ts   Regex for extracting NUMO-\d+ from text
    aggregator.ts           Pure function: (commits, reviews, events,
                            mappings, settings) -> WorklogEntry[]
                            + signature tagging for dedupe
    orchestrator.ts         Glue layer: loadPreview() fetches
                            everything, aggregate()s, computes
                            already-logged set, returns ready state.
                            postEntries() serial-posts with progress
                            callback.
  types/
    index.ts                Shared types (WorklogEntry, MeetingMapping,
                            AttendanceFilter, etc.)
team-defaults.json           Shared across repo: default meeting
                             mappings, templates, default minutes
github-orgs.json             Shared across repo: which GH orgs to scan
```

## Locked design decisions

These were agreed with the user; don't relitigate unless they ask:

- **Commits:** 1 min per Jira issue per day, deduplicated by
  (date, issue).
- **Reviews:** 15 min per PR per day, deduplicated by (date, PR number).
  Only counts submitted reviews, not file-level inline comments, and
  never counts PRs the user authored.
- **Meetings:** exact calendar duration. Filtered by attendance setting
  (default: "all except declined"). All-day events always skipped.
- **Meeting → Jira mapping:** substring match on event title,
  case-insensitive, longest-match wins. Team defaults in
  `team-defaults.json` + per-user overrides in `chrome.storage.local`.
  Prompt-and-learn UI in popup's unmapped section (inline) + full CRUD
  in Settings → Meetings tab. A mapping with `skip: true` drops
  matching meetings from the preview entirely (use it for "Out of
  office", holidays, lunch breaks, etc. — the aggregator counts them
  as `skippedByMapping` but doesn't create an entry).
- **Jira key extraction from GitHub activity:** PR title → branch →
  commit message (first match wins).
- **Date range cap:** 30 days (not currently exposed in UI).
- **Comment format:** comments are posted to Tempo **verbatim** — no
  `[auto]` prefix, no `[#sig:…]` tag. Templates (team defaults or user
  overrides) are simple placeholder-substituted strings, e.g.
  `"Commits on {issue}"`, `"{title}"`. Manual entries and meeting
  mappings with a custom `description` are already verbatim by nature.
  `appendSignature` and the `AUTO_COMMENT_PREFIX` constant have been
  removed.
- **Dedupe:** existing Tempo worklogs on the same issue/date are
  checked in two passes (see `orchestrator.computeAlreadyLogged`):
  1. **Legacy sig-marker:** if an existing comment contains
     `[#sig:<type>-<id>]` matching `computeSignature(entry)`, treat it
     as already logged. Handles entries posted before the verbatim
     simplification.
  2. **Exact-comment:** `stripSignature(existing) === stripSignature(new)`.
     Handles new entries and any custom-description / manual-entry
     case.

  `computeSignature` and `stripSignature` are kept for pass 1 and for
  future robustness, but new entries no longer carry a sig.
- **Manual entries:** the popup has an "+ Add manual entry" button that
  appends a row with an editable date, Jira picker, minutes, and
  description. Source is `'manual'`, icon `✎`, color indigo. These rows
  live only in the popup's `rows` state — not persisted across popup
  opens, but preserved across re-aggregation (e.g. after saving an
  unmapped meeting mapping) via `rebuildRows` merging them back in.
  Posted comment is verbatim (no sig tag).
- **Editable time:** each row has two `type=number` inputs for hours
  and minutes, labelled `h` and `m`. Both bind to `RowState.hoursInput`
  / `RowState.minutesInput` and sync to `r.entry.minutes` on each
  `oninput` via `syncRowMinutes()`. `entry.minutes` stays the source
  of truth for posting and the footer total. Spinner arrows are
  hidden via scoped CSS in `Popup.svelte`. The footer shows a running
  total of included, not-yet-posted rows as `Xh Ym` via
  `formatDuration`.
- **Distribution:** unpacked extension from this git repo. `npm run
  build`, load `dist/` at `chrome://extensions`.

## Known quirks / gotchas

- **Calendar returns events from a wider window than requested.**
  `sync.fetcheventrange` uses Google's incremental-sync model; the
  server sends events from a broader cached range. **Always filter
  events in-app** against the requested `[dateFrom, dateTo]` before
  processing. This is done inside `aggregator.ts`.
- **Jira issue-picker endpoint** (`/rest/api/2/issue/picker`) returns
  the user's recent issues but often without summaries when there's no
  query. `fetchIssueSummaries()` does a single JQL batch search to fill
  them in. Don't call `getIssue` per item — it'd be N+1.
- **Tempo favorites endpoint:** `GET /rest/tempo-core/1/favorites/issue/`
  returns a flat array of issue key strings — these are the Jiras shown
  under the "Favorite" tab in Tempo's Log Time dialog. In the picker
  UI, favorites get a ⭐ and always sort to the top.
- **No `secid` needed for calendar.** Don't try to scrape it from the
  page HTML — the literal string isn't there anyway.
- **All-day events** (Latvian name-days from `Apsveicam.lv` in
  particular) show up in calendar responses. They're filtered out by
  checking `event.allDay` before aggregating.
- **Chrome extension popup closes on focus loss.** Long-running
  operations (like posting N entries serially) run inside the popup
  script, so if the popup closes mid-batch it aborts. Per-entry status
  is updated in `rows` state which is discarded on close. In practice
  users keep the popup open while posting — but if this becomes a
  problem, move posting to the service worker with message-passing.
- **LF/CRLF warnings on Windows.** Harmless; git is just translating
  line endings on commit.

## How to work on this

1. `npm install` once.
2. `npm run dev` for HMR (Chrome auto-reloads most changes, but when
   the manifest or background-worker changes you need to click Reload
   on the extension card).
3. `npm run build` produces `dist/`. Load unpacked at
   `chrome://extensions` with Developer mode on.
4. `npm run check` runs `svelte-check` — must be 0 errors, 0 warnings
   before committing.

## Verifying changes

The user tests by:
1. `npm run build`
2. Reload extension at `chrome://extensions`
3. Click the extension icon → interact

After any meaningful change, ensure build + check pass, commit with a
descriptive message (Co-Authored-By: Claude trailer per house style),
push to `origin/master`.

## Remote

`https://github.com/kristapsk123/tempo-auto-logger` — private.

## Things deliberately NOT done yet

- Onboarding wizard (install-triggered full-page walkthrough)
- Custom icons (uses Chrome's default puzzle-piece)
- Custom date range picker in popup (only yesterday / today quick buttons)
- Retry button for failed post entries (just shows red ✗ with tooltip)
- Persisting manual entries across popup opens (they currently live in
  in-memory state and are gone after a reload — explicitly agreed that's
  OK for now)
