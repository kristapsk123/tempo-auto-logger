import {
  aggregate,
  computeSignature,
  stripSignature,
  type WorklogEntry,
} from './aggregator';
import {
  fetchIssueSummaries,
  getMyself,
  searchIssuePicker,
  type JiraIssueOption,
} from './jira-client';

export type { JiraIssueOption } from './jira-client';
import {
  createWorklog,
  getTempoFavoriteIssueKeys,
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
  jiraUsername: string;
  favorites: JiraIssueOption[];
  cachedFetch: CachedFetch;
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

  const [commits, reviews, events, existing, jiraRecent, tempoFavoriteKeys] =
    await Promise.all([
      searchMyCommits({ token, username: user.login, orgs, dateFrom, dateTo }),
      listMyReviews({ token, username: user.login, orgs, dateFrom, dateTo }),
      listCalendarEvents({
        userEmail: me.emailAddress,
        dateFrom,
        dateTo,
      }),
      listWorklogs({ usernames: [me.name], dateFrom, dateTo }),
      // Both favorites lookups are non-critical; fall back to empty
      searchIssuePicker('').catch(() => [] as JiraIssueOption[]),
      getTempoFavoriteIssueKeys().catch(() => [] as string[]),
    ]);

  const favorites = mergeFavorites(
    jiraRecent,
    userMappings.map((m) => m.jiraKey),
    tempoFavoriteKeys,
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
  });

  const alreadyLoggedIds = computeAlreadyLogged(aggregated.entries, existing);

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
    jiraUsername: me.name,
    favorites,
    cachedFetch: { commits, reviews, events, timeZone },
  };
}

export async function loadFavorites(): Promise<JiraIssueOption[]> {
  const [fromJira, mappings, tempoFavoriteKeys] = await Promise.all([
    searchIssuePicker('').catch(() => [] as JiraIssueOption[]),
    getUserMeetingMappings(),
    getTempoFavoriteIssueKeys().catch(() => [] as string[]),
  ]);
  const merged = mergeFavorites(
    fromJira,
    mappings.map((m) => m.jiraKey),
    tempoFavoriteKeys,
  );
  await fillMissingSummaries(merged);
  return merged;
}

async function fillMissingSummaries(items: JiraIssueOption[]): Promise<void> {
  const needed = items.filter((i) => !i.summary).map((i) => i.key);
  if (needed.length === 0) return;
  const summaries = await fetchIssueSummaries(needed).catch(
    () => new Map<string, string>(),
  );
  for (const item of items) {
    if (!item.summary && summaries.has(item.key)) {
      item.summary = summaries.get(item.key) ?? '';
    }
  }
}

function mergeFavorites(
  fromJira: JiraIssueOption[],
  userMappingKeys: string[],
  tempoFavoriteKeys: string[],
): JiraIssueOption[] {
  const favoriteSet = new Set(tempoFavoriteKeys);
  const pickerMap = new Map(fromJira.map((i) => [i.key, i]));
  const seen = new Set<string>();
  const out: JiraIssueOption[] = [];

  // 1. Tempo favorites first, always, with ⭐.
  for (const key of tempoFavoriteKeys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const fromPicker = pickerMap.get(key);
    out.push({
      key,
      summary: fromPicker?.summary ?? '',
      isFavorite: true,
      sectionLabel: 'Favorite',
    });
  }

  // 2. Previously used (not already added as a favorite).
  for (const key of userMappingKeys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const fromPicker = pickerMap.get(key);
    out.push({
      key,
      summary: fromPicker?.summary ?? '',
      isFavorite: false,
      sectionLabel: 'Previously used',
    });
  }

  // 3. Everything else from Jira's picker (recent/suggested).
  for (const iss of fromJira) {
    if (seen.has(iss.key)) continue;
    seen.add(iss.key);
    out.push({
      ...iss,
      isFavorite: favoriteSet.has(iss.key),
    });
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
    skippedByMapping: aggregated.skippedByMapping,
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
      if (w.issue.key !== e.issueKey) continue;
      const wDate = typeof w.started === 'string' ? w.started.slice(0, 10) : '';
      if (wDate !== e.date) continue;
      // 1. New format: sig marker present in existing comment.
      if (w.comment.includes(sigMarker)) {
        already.add(e.id);
        break;
      }
      // 2. Exact-match after stripping any sig — covers both legacy
      // [auto]-prefixed entries and custom-description mappings where we
      // deliberately don't attach a sig.
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
