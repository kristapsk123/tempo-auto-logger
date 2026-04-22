import {
  aggregate,
  computeSignature,
  stripSignature,
  type WorklogEntry,
} from './aggregator';
import {
  getMyself,
  searchIssuePicker,
  type JiraIssueOption,
} from './jira-client';

export type { JiraIssueOption } from './jira-client';
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
  getGithubToken,
  getUserMeetingMappings,
  getUserTemplates,
} from './storage';
import { AUTO_COMMENT_PREFIX } from './config';
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
  existingWorklogs: TempoWorklog[];
  alreadyLoggedIds: Set<string>;
  jiraUsername: string;
  favorites: JiraIssueOption[];
  cachedFetch: CachedFetch;
}

export type ReaggregatedPreview = Pick<
  LoadedPreview,
  'entries' | 'unmapped' | 'skippedAllDay' | 'skippedByAttendance' | 'alreadyLoggedIds'
>;

export async function loadPreview(
  dateFrom: string,
  dateTo: string,
): Promise<LoadedPreview> {
  const me = await getMyself();
  if (!me.emailAddress) {
    throw new Error(
      'Your Jira profile has no email — cannot match calendar events',
    );
  }
  const token = await getGithubToken();
  if (!token) {
    throw new Error('No GitHub PAT saved — paste one in the field above first');
  }
  const user = await getGithubUser(token);
  const [userMappings, attendanceFilter, userTemplates] = await Promise.all([
    getUserMeetingMappings(),
    getAttendanceFilter(),
    getUserTemplates(),
  ]);
  const orgs = githubOrgsConfig.orgs;
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Riga';

  const [commits, reviews, events, existing, jiraFavorites] = await Promise.all(
    [
      searchMyCommits({ token, username: user.login, orgs, dateFrom, dateTo }),
      listMyReviews({ token, username: user.login, orgs, dateFrom, dateTo }),
      listCalendarEvents({
        userEmail: me.emailAddress,
        dateFrom,
        dateTo,
      }),
      listWorklogs({ usernames: [me.name], dateFrom, dateTo }),
      // Non-critical; fall back to empty list if the endpoint fails
      searchIssuePicker('').catch(() => [] as JiraIssueOption[]),
    ],
  );

  const favorites = mergeFavorites(jiraFavorites, userMappings.map((m) => m.jiraKey));

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
  });

  const alreadyLoggedIds = computeAlreadyLogged(aggregated.entries, existing);

  return {
    dateFrom,
    dateTo,
    entries: aggregated.entries,
    unmapped: aggregated.unmappedMeetings,
    skippedAllDay: aggregated.skippedAllDay,
    skippedByAttendance: aggregated.skippedByAttendance,
    existingWorklogs: existing,
    alreadyLoggedIds,
    jiraUsername: me.name,
    favorites,
    cachedFetch: { commits, reviews, events, timeZone },
  };
}

export async function loadFavorites(): Promise<JiraIssueOption[]> {
  const [fromJira, mappings] = await Promise.all([
    searchIssuePicker('').catch(() => [] as JiraIssueOption[]),
    getUserMeetingMappings(),
  ]);
  return mergeFavorites(fromJira, mappings.map((m) => m.jiraKey));
}

function mergeFavorites(
  fromJira: JiraIssueOption[],
  userMappingKeys: string[],
): JiraIssueOption[] {
  // Put user's previously-mapped Jiras first (they're tried-and-true),
  // then the rest of Jira's picker suggestions. Dedupe by key.
  const seen = new Set<string>();
  const out: JiraIssueOption[] = [];

  // Previously used: try to match them with summaries from the picker result
  const pickerMap = new Map(fromJira.map((i) => [i.key, i]));
  for (const key of userMappingKeys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const fromPicker = pickerMap.get(key);
    out.push({
      key,
      summary: fromPicker?.summary ?? '',
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
  const [userMappings, attendanceFilter, userTemplates] = await Promise.all([
    getUserMeetingMappings(),
    getAttendanceFilter(),
    getUserTemplates(),
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
  });
  return {
    entries: aggregated.entries,
    unmapped: aggregated.unmappedMeetings,
    skippedAllDay: aggregated.skippedAllDay,
    skippedByAttendance: aggregated.skippedByAttendance,
    alreadyLoggedIds: computeAlreadyLogged(aggregated.entries, existingWorklogs),
  };
}

function computeAlreadyLogged(
  entries: WorklogEntry[],
  existing: TempoWorklog[],
): Set<string> {
  const already = new Set<string>();
  for (const e of entries) {
    if (!e.issueKey) continue;
    const sig = computeSignature(e);
    const sigMarker = `[#sig:${sig}]`;
    const humanOnly = stripSignature(e.comment);
    for (const w of existing) {
      if (!w.issue || typeof w.comment !== 'string') continue;
      if (!w.comment.startsWith(AUTO_COMMENT_PREFIX)) continue;
      if (w.issue.key !== e.issueKey) continue;
      const wDate = typeof w.started === 'string' ? w.started.slice(0, 10) : '';
      if (wDate !== e.date) continue;
      if (w.comment.includes(sigMarker)) {
        already.add(e.id);
        break;
      }
      if (stripSignature(w.comment) === humanOnly) {
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
  jiraUsername: string,
  onProgress: (result: PostResult) => void,
): Promise<PostResult[]> {
  const results: PostResult[] = [];
  for (const e of entries) {
    try {
      await createWorklog({
        issueKey: e.issueKey,
        worker: jiraUsername,
        started: e.date,
        timeSpentSeconds: e.minutes * 60,
        comment: e.comment,
      });
      const r: PostResult = { id: e.id, status: 'ok' };
      results.push(r);
      onProgress(r);
    } catch (err) {
      const r: PostResult = {
        id: e.id,
        status: 'fail',
        error: err instanceof Error ? err.message : String(err),
      };
      results.push(r);
      onProgress(r);
    }
  }
  return results;
}
