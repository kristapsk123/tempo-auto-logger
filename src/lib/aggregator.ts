import type { CommitActivity, ReviewActivity } from './github-client';
import type { CalendarEvent } from './calendar-client';
import type {
  AttendanceFilter,
  DescriptionTemplates,
  MeetingMapping,
  TeamDefaults,
} from '../types';

export interface WorklogEntry {
  id: string;
  date: string;
  issueKey: string | null;
  issueTitle?: string;
  minutes: number;
  comment: string;
  source: 'commit' | 'review' | 'meeting' | 'manual';
  include: boolean;
  sourceInfo: {
    commitCount?: number;
    commits?: Array<{ sha: string; message: string; repo: string }>;
    prNumber?: number;
    prTitle?: string;
    repo?: string;
    eventId?: string;
    eventTitle?: string;
    matchedBy?: string;
  };
}

export interface AggregatorInput {
  commits: CommitActivity[];
  reviews: ReviewActivity[];
  events: CalendarEvent[];
  teamDefaults: TeamDefaults;
  userMeetingMappings: MeetingMapping[];
  userDescriptionTemplates?: Partial<DescriptionTemplates>;
  attendanceFilter: AttendanceFilter;
  timeZone: string;
  dateFrom: string;
  dateTo: string;
}

export interface AggregatorOutput {
  entries: WorklogEntry[];
  unmappedMeetings: CalendarEvent[];
  skippedByAttendance: number;
  skippedAllDay: number;
  skippedByMapping: number;
}

function resolveTemplate(
  defaults: DescriptionTemplates,
  overrides: Partial<DescriptionTemplates> | undefined,
): DescriptionTemplates {
  return {
    commit: overrides?.commit ?? defaults.commit,
    review: overrides?.review ?? defaults.review,
    meeting: overrides?.meeting ?? defaults.meeting,
  };
}

function fillTemplate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? `{${key}}` : String(v);
  });
}

export function computeSignature(entry: {
  source: WorklogEntry['source'];
  issueKey: string | null;
  sourceInfo: WorklogEntry['sourceInfo'];
}): string {
  if (entry.source === 'commit') {
    return `commit-${entry.issueKey ?? 'unknown'}`;
  }
  if (entry.source === 'review') {
    return `review-pr${entry.sourceInfo.prNumber ?? 'unknown'}`;
  }
  return `meeting-${entry.sourceInfo.eventId ?? 'unknown'}`;
}

const SIG_REGEX = /\s*\[#sig:[^\]]+\]\s*$/;

export function stripSignature(comment: string): string {
  return comment.replace(SIG_REGEX, '');
}

function localDate(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
  return parts;
}

function shouldIncludeByAttendance(
  status: CalendarEvent['attendanceStatus'],
  filter: AttendanceFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'accepted') return status === 'accepted';
  return status !== 'declined';
}

function findMapping(
  title: string,
  userMappings: MeetingMapping[],
  teamMappings: MeetingMapping[],
): { mapping: MeetingMapping; source: 'user' | 'team' } | null {
  const haystack = title.toLowerCase();
  const byLongest = (a: MeetingMapping, b: MeetingMapping) =>
    b.match.length - a.match.length;

  for (const m of [...userMappings].sort(byLongest)) {
    if (haystack.includes(m.match.toLowerCase())) {
      return { mapping: m, source: 'user' };
    }
  }
  for (const m of [...teamMappings].sort(byLongest)) {
    if (haystack.includes(m.match.toLowerCase())) {
      return { mapping: m, source: 'team' };
    }
  }
  return null;
}

export function aggregate(input: AggregatorInput): AggregatorOutput {
  const templates = resolveTemplate(
    input.teamDefaults.descriptionTemplates,
    input.userDescriptionTemplates,
  );

  // Comments are posted verbatim — no [auto] prefix, no [#sig:…] tag.
  // Dedupe relies on (a) sig-marker detection in legacy Tempo entries that
  // were posted before this change, and (b) exact-comment matching for new
  // entries. See orchestrator.computeAlreadyLogged.

  const entries: WorklogEntry[] = [];
  const unmappedMeetings: CalendarEvent[] = [];
  let skippedByAttendance = 0;
  let skippedAllDay = 0;
  let skippedByMapping = 0;

  const commitGroups = new Map<
    string,
    { date: string; issueKey: string; commits: Array<{ sha: string; message: string; repo: string }> }
  >();
  for (const c of input.commits) {
    const key = `${c.date}:${c.jiraKey}`;
    const existing = commitGroups.get(key);
    if (existing) {
      existing.commits.push({ sha: c.commitSha, message: c.message, repo: c.repo });
    } else {
      commitGroups.set(key, {
        date: c.date,
        issueKey: c.jiraKey,
        commits: [{ sha: c.commitSha, message: c.message, repo: c.repo }],
      });
    }
  }
  for (const { date, issueKey, commits } of commitGroups.values()) {
    entries.push({
      id: `commit:${date}:${issueKey}`,
      date,
      issueKey,
      minutes: input.teamDefaults.defaultMinutes.commitPerIssuePerDay,
      comment: fillTemplate(templates.commit, { issue: issueKey }),
      source: 'commit',
      include: true,
      sourceInfo: { commitCount: commits.length, commits },
    });
  }

  const reviewGroups = new Map<
    string,
    {
      date: string;
      repo: string;
      prNumber: number;
      prTitle: string;
      jiraKey: string;
    }
  >();
  for (const r of input.reviews) {
    const key = `${r.date}:${r.repo}#${r.prNumber}`;
    if (!reviewGroups.has(key)) {
      reviewGroups.set(key, {
        date: r.date,
        repo: r.repo,
        prNumber: r.prNumber,
        prTitle: r.prTitle,
        jiraKey: r.jiraKey,
      });
    }
  }
  for (const g of reviewGroups.values()) {
    entries.push({
      id: `review:${g.date}:${g.repo}#${g.prNumber}`,
      date: g.date,
      issueKey: g.jiraKey,
      minutes: input.teamDefaults.defaultMinutes.reviewPerPrPerDay,
      comment: fillTemplate(templates.review, {
        issue: g.jiraKey,
        prNum: g.prNumber,
        prTitle: g.prTitle,
      }),
      source: 'review',
      include: true,
      sourceInfo: {
        prNumber: g.prNumber,
        prTitle: g.prTitle,
        repo: g.repo,
      },
    });
  }

  for (const ev of input.events) {
    if (ev.allDay) {
      skippedAllDay += 1;
      continue;
    }
    const evDate = localDate(ev.startMs, input.timeZone);
    if (evDate < input.dateFrom || evDate > input.dateTo) {
      continue;
    }
    if (!shouldIncludeByAttendance(ev.attendanceStatus, input.attendanceFilter)) {
      skippedByAttendance += 1;
      continue;
    }

    const match = findMapping(
      ev.title,
      input.userMeetingMappings,
      input.teamDefaults.meetings,
    );
    if (!match) {
      unmappedMeetings.push(ev);
      continue;
    }
    if (match.mapping.skip === true) {
      skippedByMapping += 1;
      continue;
    }

    const issueKey = match.mapping.jiraKey;
    const hasCustomDescription = typeof match.mapping.description === 'string';

    const comment = hasCustomDescription
      ? match.mapping.description!
      : fillTemplate(templates.meeting, {
          title: ev.title,
          issue: issueKey,
        });

    entries.push({
      id: `meeting:${ev.id}`,
      date: localDate(ev.startMs, input.timeZone),
      issueKey,
      minutes: ev.durationMinutes,
      comment,
      source: 'meeting',
      include: true,
      sourceInfo: {
        eventId: ev.id,
        eventTitle: ev.title,
        matchedBy: `${match.source}:"${match.mapping.match}"`,
      },
    });
  }

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const order = { meeting: 0, review: 1, commit: 2, manual: 3 } as const;
    if (order[a.source] !== order[b.source]) {
      return order[a.source] - order[b.source];
    }
    return (a.issueKey ?? '').localeCompare(b.issueKey ?? '');
  });

  return {
    entries,
    unmappedMeetings,
    skippedByAttendance,
    skippedAllDay,
    skippedByMapping,
  };
}
