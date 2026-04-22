# tempo-auto-logger

Chrome extention that auto-logs time to Jira Tempo from your GitHub activity and Google Calendar meetings.

## Status

**Phase 1 — scaffold.** The extension loads, popup and options pages render, but nothing is wired up to Jira / GitHub / Calendar yet. Next phases build those integrations.

## How it works (planned)

- **Auth** — piggybacks on your existing browser sessions. Jira/Tempo and Google Calendar are reached via same-origin fetches from your logged-in tabs (no OAuth, no API tokens). GitHub uses a personal access token stored in `chrome.storage.local`.
- **GitHub** — scans configured orgs (`github-orgs.json`) for commits you authored and reviews you submitted. Extracts Jira keys from PR title → branch name → commit message.
- **Calendar** — reads events from `calendar.google.com` for the chosen date range. Meeting → Jira mapping is substring-based and learns over time (team defaults in repo + per-user overrides in local storage).
- **Time rules** — commits: 1 min per Jira issue per day. Reviews: 15 min per PR per day. Meetings: exact calendar duration.
- **Preview** — before any POST to Tempo, a preview screen shows every entry with a per-row include/exclude checkbox. Entries are deduped against existing Tempo worklogs by comparing the issue/date and the comment text (with a legacy `[#sig:…]` marker still recognized for entries posted before this simplification).

## Install (just use it)

If you just want to use the extension, see **[INSTALL.md](INSTALL.md)** — a
step-by-step guide with no coding required. Ask Kristaps for the latest
`.zip`.

## Developer setup (build from source)

```bash
npm install
npm run dev
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the `dist/` folder

The popup appears when you click the extension icon. Settings live on the options page (gear icon in the popup, or right-click the extension icon → Options).

For a production build without HMR: `npm run build`. Type-check with
`npm run check` (must be 0 errors, 0 warnings before committing).

## Project layout

```
src/
  background/   service worker (currently empty)
  popup/        main action UI (Log yesterday / today / custom range)
  options/      full-page settings with tabs
  lib/          clients and pure helpers (Jira, Tempo, GitHub, Calendar)
  types/        shared TypeScript types
team-defaults.json   shipped with repo; shared across all teammates
github-orgs.json     shipped with repo; which GitHub orgs to scan
```

## License

Internal tool. Not licensed for external distribution.
