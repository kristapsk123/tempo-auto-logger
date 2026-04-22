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
  // Tempo's `worker` field sometimes wants the Jira username (e.g.
  // "karlis.birznieks"), sometimes the user key (e.g. "JIRAUSER132909") —
  // it depends on how the account was migrated. We keep both so postEntries
  // can try one and fall back to the other.
  jiraWorker: { name: string; key: string };
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
  // Meetings-only mode: when no GitHub PAT is saved, skip commits/reviews
  // entirely and log only calendar meetings. Intended for users with no
  // GitHub activity (managers, QA, etc.) who shouldn't have to create a
  // token just to use the extension.
  const token = await getGithubToken();
  const [userMappings, attendanceFilter, userTemplates] = await Promise.all([
    getUserMeetingMappings(),
    getAttendanceFilter(),
    getUserTemplates(),
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

  const [github, events, existing, jiraRecent, tempoFavoriteKeys] =
    await Promise.all([
      githubPromise,
      listCalendarEvents({
        userEmail: me.emailAddress,
        dateFrom,
        dateTo,
      }),
      // Pass both identifiers so dedupe covers worklogs posted under
      // either one.
      listWorklogs({ usernames: [me.name, me.key], dateFrom, dateTo }),
      // Both favorites lookups are non-critical; fall back to empty
      searchIssuePicker('').catch(() => [] as JiraIssueOption[]),
      getTempoFavoriteIssueKeys().catch(() => [] as string[]),
    ]);
  const { commits, reviews } = github;

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
    jiraWorker: { name: me.name, key: me.key },
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
      // 2. Exact-match after stripping any sig — handles both new entries
      // (which no longer carry a sig tag) and legacy [auto]-prefixed ones
      // that lost their sig.
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

function isWorkerInvalidError(msg: string): boolean {
  // Tempo returns: 400 {"errors":{"worker":"User is invalid"},...}
  return /"worker"\s*:\s*"[^"]*invalid/i.test(msg);
}

export async function postEntries(
  entries: PostItem[],
  jiraWorker: { name: string; key: string },
  onProgress: (result: PostResult) => void,
): Promise<PostResult[]> {
  const results: PostResult[] = [];
  // Start with the username. If Tempo rejects it as invalid, switch to the
  // user key (e.g. JIRAUSER132909) for the rest of the batch.
  let currentWorker = jiraWorker.name;
  let triedFallback = false;

  for (const e of entries) {
    const attempt = async (worker: string) =>
      createWorklog({
        issueKey: e.issueKey,
        worker,
        started: e.date,
        timeSpentSeconds: e.minutes * 60,
        comment: e.comment,
      });

    try {
      await attempt(currentWorker);
      const r: PostResult = { id: e.id, status: 'ok' };
      results.push(r);
      onProgress(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        !triedFallback &&
        currentWorker === jiraWorker.name &&
        jiraWorker.key &&
        jiraWorker.key !== jiraWorker.name &&
        isWorkerInvalidError(msg)
      ) {
        triedFallback = true;
        currentWorker = jiraWorker.key;
        try {
          await attempt(currentWorker);
          const r: PostResult = { id: e.id, status: 'ok' };
          results.push(r);
          onProgress(r);
          continue;
        } catch (err2) {
          const msg2 = err2 instanceof Error ? err2.message : String(err2);
          const r: PostResult = { id: e.id, status: 'fail', error: msg2 };
          results.push(r);
          onProgress(r);
          continue;
        }
      }
      const r: PostResult = { id: e.id, status: 'fail', error: msg };
      results.push(r);
      onProgress(r);
    }
  }
  return results;
}
