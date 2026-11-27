import {
  aggregate,
  computeSignature,
  stripSignature,
  type WorklogEntry,
} from './aggregator';
import {
  fetchIssues,
  getMyself,
  searchIssuePicker,
  type JiraIssueInfo,
  type JiraIssueOption,
} from './jira-client';

export type { JiraIssueOption } from './jira-client';
import {
  isHostMissingError,
  syncClaudeSettings,
  type ClaudeSettingsSnapshot,
  type ClaudeTimesheet,
  type ClaudeTimesheetEntry,
} from './claude-timesheet-client';
import type { MeetingMapping } from '../types';
import {
  createWorklog,
  listWorklogs,
  type TempoWorklog,
} from './tempo-client';
import {
  getGithubUser,
  listMyReviews,
  searchMyCommits,
  type CommitActivity,
  type ReviewActivity,
} from './github-client';
import {
  listCalendarEvents,
  type CalendarEvent,
} from './calendar-client';
import {
  getAttendanceFilter,
  getFallbackCommitJira,
  getGithubToken,
  getUserMeetingMappings,
  getUserTemplates,
} from './storage';
import teamDefaults from '../../team-defaults.json';
import githubOrgsConfig from '../../github-orgs.json';

export interface CachedFetch {
  commits: CommitActivity[];
  reviews: ReviewActivity[];
  events: CalendarEvent[];
  timeZone: string;
}

export interface LoadedPreview {
  dateFrom: string;
  dateTo: string;
  entries: WorklogEntry[];
  unmapped: CalendarEvent[];
  skippedAllDay: number;
  skippedByAttendance: number;
  skippedByMapping: number;
  existingWorklogs: TempoWorklog[];
  alreadyLoggedIds: Set<string>;
  jiraAccountId: string;
  favorites: JiraIssueOption[];
  cachedFetch: CachedFetch;
  isFromClaude: boolean;
}

export type ReaggregatedPreview = Pick<
  LoadedPreview,
  | 'entries'
  | 'unmapped'
  | 'skippedAllDay'
  | 'skippedByAttendance'
  | 'skippedByMapping'
  | 'alreadyLoggedIds'
>;

export async function loadPreview(
  dateFrom: string,
  dateTo: string,
): Promise<LoadedPreview> {
  const me = await getMyself();
  if (!me.emailAddress) {
    throw new Error(
      'Jira did not return your email, so calendar events cannot be matched. Check the email visibility setting in your Atlassian account profile.',
    );
  }
  // Meetings-only mode: when no GitHub PAT is saved, skip commits/reviews
  // entirely and log only calendar meetings. Intended for users with no
  // GitHub activity (managers, QA, etc.) who shouldn't have to create a
  // token just to use the extension.
  const token = await getGithubToken();
  const [userMappings, attendanceFilter, userTemplates, fallbackCommitJira] = await Promise.all([
    getUserMeetingMappings(),
    getAttendanceFilter(),
    getUserTemplates(),
    getFallbackCommitJira(),
  ]);
  const orgs = githubOrgsConfig.orgs;
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Riga';

  const githubPromise = token
    ? (async () => {
        const user = await getGithubUser(token);
        const [c, r] = await Promise.all([
          searchMyCommits({ token, username: user.login, orgs, dateFrom, dateTo }),
          listMyReviews({ token, username: user.login, orgs, dateFrom, dateTo }),
        ]);
        return { commits: c, reviews: r };
      })()
    : Promise.resolve({
        commits: [] as CommitActivity[],
        reviews: [] as ReviewActivity[],
      });

  const [github, events, existing, jiraRecent] =
    await Promise.all([
      githubPromise,
      listCalendarEvents({
        userEmail: me.emailAddress,
        dateFrom,
        dateTo,
      }),
      listWorklogs({ accountId: me.accountId, dateFrom, dateTo }),
      // The favorites lookup is non-critical; fall back to empty
      searchIssuePicker('').catch(() => [] as JiraIssueOption[]),
    ]);
  const { commits, reviews } = github;

  const favorites = mergeFavorites(
    jiraRecent,
    userMappings.map((m) => m.jiraKey),
  );
  await fillMissingSummaries(favorites);

  const aggregated = aggregate({
    commits,
    reviews,
    events,
    teamDefaults,
    userMeetingMappings: userMappings,
    userDescriptionTemplates: userTemplates,
    attendanceFilter,
    timeZone,
    dateFrom,
    dateTo,
    fallbackCommitJira,
  });

  const issueIds = await attachIssueTitles(aggregated.entries);
  const alreadyLoggedIds = computeAlreadyLogged(aggregated.entries, existing, issueIds);

  return {
    dateFrom,
    dateTo,
    entries: aggregated.entries,
    unmapped: aggregated.unmappedMeetings,
    skippedAllDay: aggregated.skippedAllDay,
    skippedByAttendance: aggregated.skippedByAttendance,
    skippedByMapping: aggregated.skippedByMapping,
    existingWorklogs: existing,
    alreadyLoggedIds,
    jiraAccountId: me.accountId,
    favorites,
    cachedFetch: { commits, reviews, events, timeZone },
    isFromClaude: false,
  };
}

const CLAUDE_ID_PREFIX = 'claude';
const SECONDS_PER_MINUTE = 60;

function toClaudeEntry(entry: ClaudeTimesheetEntry, index: number): WorklogEntry {
  return {
    id: `${CLAUDE_ID_PREFIX}:${entry.date}:${index}`,
    date: entry.date,
    issueKey: entry.issueKey,
    minutes: entry.minutes,
    comment: entry.comment,
    source: 'claude',
    include: true,
    sourceInfo: {
      ...(entry.note ? { claudeNote: entry.note } : {}),
      ...(entry.meeting?.title ? { eventTitle: entry.meeting.title } : {}),
      ...(entry.evidence ? { claudeEvidence: entry.evidence } : {}),
    },
  };
}

/**
 * Builds the same preview as loadPreview, but the rows come from a Claude timesheet instead of GitHub and
 * Calendar, so dedupe against existing Tempo worklogs and posting work unchanged.
 */
export async function loadClaudePreview(timesheet: ClaudeTimesheet): Promise<LoadedPreview> {
  const me = await getMyself();
  const [existing, jiraRecent, userMappings] = await Promise.all([
    listWorklogs({ accountId: me.accountId, dateFrom: timesheet.from, dateTo: timesheet.to }),
    searchIssuePicker('').catch(() => [] as JiraIssueOption[]),
    getUserMeetingMappings(),
  ]);
  const favorites = mergeFavorites(jiraRecent, userMappings.map((m) => m.jiraKey));
  await fillMissingSummaries(favorites);
  const entries = timesheet.entries.map(toClaudeEntry);
  const issueIds = await attachIssueTitles(entries);
  return {
    dateFrom: timesheet.from,
    dateTo: timesheet.to,
    entries,
    unmapped: [],
    skippedAllDay: 0,
    skippedByAttendance: 0,
    skippedByMapping: 0,
    existingWorklogs: existing,
    alreadyLoggedIds: computeAlreadyLogged(entries, existing, issueIds),
    jiraAccountId: me.accountId,
    favorites,
    cachedFetch: {
      commits: [],
      reviews: [],
      events: [],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Riga',
    },
    isFromClaude: true,
  };
}

/** The settings the Claude skill needs to map and skip exactly like this extension. */
export async function collectClaudeSettings(): Promise<ClaudeSettingsSnapshot> {
  const [userMeetingMappings, attendanceFilter, fallbackCommitJira] = await Promise.all([
    getUserMeetingMappings(),
    getAttendanceFilter(),
    getFallbackCommitJira(),
  ]);
  return {
    userMeetingMappings,
    teamMeetingMappings: teamDefaults.meetings as MeetingMapping[],
    attendanceFilter,
    fallbackCommitJira,
  };
}

// Teammates without the Claude plugin have no host, so for them there is nothing to sync.
export async function syncClaudeSettingsIfInstalled(): Promise<void> {
  try {
    await syncClaudeSettings(await collectClaudeSettings());
  } catch (e) {
    if (isHostMissingError(e)) return;
    throw e;
  }
}

export async function loadFavorites(): Promise<JiraIssueOption[]> {
  const [fromJira, mappings] = await Promise.all([
    searchIssuePicker('').catch(() => [] as JiraIssueOption[]),
    getUserMeetingMappings(),
  ]);
  const merged = mergeFavorites(
    fromJira,
    mappings.map((m) => m.jiraKey),
  );
  await fillMissingSummaries(merged);
  return merged;
}

type IssueIds = Map<string, string>;

async function fetchIssuesOrEmpty(keys: string[]): Promise<Map<string, JiraIssueInfo>> {
  return fetchIssues(keys).catch(() => new Map<string, JiraIssueInfo>());
}

/** Fills in each entry's title and returns the issue key -> id map that dedupe against Tempo needs. */
async function attachIssueTitles(entries: WorklogEntry[]): Promise<IssueIds> {
  const keys = entries.map((e) => e.issueKey).filter((k): k is string => !!k);
  const issues = await fetchIssuesOrEmpty(keys);
  for (const e of entries) {
    const issue = e.issueKey ? issues.get(e.issueKey) : undefined;
    if (issue) e.issueTitle = issue.summary;
  }
  return new Map([...issues].map(([key, issue]) => [key, issue.id]));
}

async function fillMissingSummaries(items: JiraIssueOption[]): Promise<void> {
  const needed = items.filter((i) => !i.summary).map((i) => i.key);
  if (needed.length === 0) return;
  const issues = await fetchIssuesOrEmpty(needed);
  for (const item of items) {
    if (!item.summary) item.summary = issues.get(item.key)?.summary ?? '';
  }
}

function mergeFavorites(
  fromJira: JiraIssueOption[],
  userMappingKeys: string[],
): JiraIssueOption[] {
  const pickerMap = new Map(fromJira.map((i) => [i.key, i]));
  const seen = new Set<string>();
  const out: JiraIssueOption[] = [];

  for (const key of userMappingKeys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      summary: pickerMap.get(key)?.summary ?? '',
      sectionLabel: 'Previously used',
    });
  }

  for (const iss of fromJira) {
    if (seen.has(iss.key)) continue;
    seen.add(iss.key);
    out.push(iss);
  }

  return out;
}

export async function reaggregate(
  cached: CachedFetch,
  existingWorklogs: TempoWorklog[],
  dateFrom: string,
  dateTo: string,
): Promise<ReaggregatedPreview> {
  const [userMappings, attendanceFilter, userTemplates, fallbackCommitJira] = await Promise.all([
    getUserMeetingMappings(),
    getAttendanceFilter(),
    getUserTemplates(),
    getFallbackCommitJira(),
  ]);
  const aggregated = aggregate({
    commits: cached.commits,
    reviews: cached.reviews,
    events: cached.events,
    teamDefaults,
    userMeetingMappings: userMappings,
    userDescriptionTemplates: userTemplates,
    attendanceFilter,
    timeZone: cached.timeZone,
    dateFrom,
    dateTo,
    fallbackCommitJira,
  });
  const issueIds = await attachIssueTitles(aggregated.entries);
  return {
    entries: aggregated.entries,
    unmapped: aggregated.unmappedMeetings,
    skippedAllDay: aggregated.skippedAllDay,
    skippedByAttendance: aggregated.skippedByAttendance,
    skippedByMapping: aggregated.skippedByMapping,
    alreadyLoggedIds: computeAlreadyLogged(aggregated.entries, existingWorklogs, issueIds),
  };
}

function computeAlreadyLogged(
  entries: WorklogEntry[],
  existing: TempoWorklog[],
  issueIds: IssueIds,
): Set<string> {
  const already = new Set<string>();
  for (const e of entries) {
    if (!e.issueKey) continue;
    const issueId = issueIds.get(e.issueKey);
    if (!issueId) continue;
    const sig = computeSignature(e);
    const sigMarker = `[#sig:${sig}]`;
    const humanOnly = stripSignature(e.comment);
    for (const w of existing) {
      if (w.issueId !== issueId) continue;
      if (w.startDate !== e.date) continue;
      // A Claude row covers a whole ticket-day, so a shorter worklog with the same comment is a different entry.
      if (e.source === 'claude' && w.timeSpentSeconds !== e.minutes * SECONDS_PER_MINUTE) continue;
      // 1. New format: sig marker present in existing comment.
      if (w.description.includes(sigMarker)) {
        already.add(e.id);
        break;
      }
      // 2. Exact-match after stripping any sig — handles both new entries
      // (which no longer carry a sig tag) and legacy [auto]-prefixed ones
      // that lost their sig.
      if (stripSignature(w.description) === humanOnly) {
        already.add(e.id);
        break;
      }
    }
  }
  return already;
}

export interface PostItem {
  id: string;
  issueKey: string;
  date: string;
  minutes: number;
  comment: string;
}

export interface PostResult {
  id: string;
  status: 'ok' | 'fail';
  error?: string;
}

export async function postEntries(
  entries: PostItem[],
  jiraAccountId: string,
  onProgress: (result: PostResult) => void,
): Promise<PostResult[]> {
  const results: PostResult[] = [];
  const report = (r: PostResult) => {
    results.push(r);
    onProgress(r);
  };
  const issues = await fetchIssuesOrEmpty(entries.map((e) => e.issueKey));

  for (const e of entries) {
    const issue = issues.get(e.issueKey);
    if (!issue) {
      report({ id: e.id, status: 'fail', error: `Issue ${e.issueKey} not found` });
      continue;
    }
    try {
      await createWorklog({
        issueId: issue.id,
        authorAccountId: jiraAccountId,
        startDate: e.date,
        timeSpentSeconds: e.minutes * SECONDS_PER_MINUTE,
        description: e.comment,
      });
      report({ id: e.id, status: 'ok' });
    } catch (err) {
      report({
        id: e.id,
        status: 'fail',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
