import type { WorklogEntry } from './aggregator';
import type { CalendarEvent } from './calendar-client';

/** A meeting the popup offers to map, from the calendar preview or from a Claude timesheet. */
export interface MeetingToMap {
  id: string;
  title: string;
  whenLabel: string;
}

const CLAUDE_MEETING_ID_PREFIX = 'claude-meeting';

export function calendarMeetingsToMap(events: CalendarEvent[]): MeetingToMap[] {
  return events.map((event) => ({
    id: event.id,
    title: event.title,
    whenLabel: `${new Date(event.startMs).toLocaleString()} · ${event.durationMinutes}m`,
  }));
}

export function claudeMeetingId(title: string): string {
  return `${CLAUDE_MEETING_ID_PREFIX}:${title.toLowerCase()}`;
}

// A Claude timesheet has one row per meeting per day, so one form covers every day the same meeting appears on.
export function claudeMeetingsToMap(entries: WorklogEntry[]): MeetingToMap[] {
  const groups = new Map<string, { title: string; dates: Set<string>; minutes: number }>();
  for (const entry of entries) {
    const title = entry.sourceInfo.eventTitle;
    if (entry.source !== 'claude' || !title) continue;
    const id = claudeMeetingId(title);
    const group = groups.get(id) ?? { title, dates: new Set<string>(), minutes: 0 };
    group.dates.add(entry.date);
    group.minutes += entry.minutes;
    groups.set(id, group);
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    title: group.title,
    whenLabel: `${claudeDaysLabel(group.dates)} · ${group.minutes}m`,
  }));
}

function claudeDaysLabel(dates: Set<string>): string {
  return dates.size === 1 ? [...dates][0] : `${dates.size} days`;
}

// The same rule as the aggregator's mapping lookup: a case-insensitive substring of the title.
export function isMatchedBy(title: string, match: string): boolean {
  return title.toLowerCase().includes(match.trim().toLowerCase());
}
