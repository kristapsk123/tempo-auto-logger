import { CALENDAR_BASE_URL } from './config';
import { SessionExpiredError } from './http';

async function calendarFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${CALENDAR_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      ...init?.headers,
    },
  });
  if (!res.url.startsWith(CALENDAR_BASE_URL)) {
    throw new SessionExpiredError('calendar');
  }
  return res;
}

function dateIsoToUnixDay(iso: string): number {
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export type AttendanceStatus =
  | 'accepted'
  | 'declined'
  | 'tentative'
  | 'needsAction'
  | 'unknown';

export interface CalendarEvent {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  attendanceStatus: AttendanceStatus;
  durationMinutes: number;
}

function parseAttendanceStatus(value: unknown): AttendanceStatus {
  if (value === 3) return 'accepted';
  if (value === 2) return 'tentative';
  if (value === 1) return 'declined';
  if (value === 0) return 'needsAction';
  return 'unknown';
}

function findAttendees(ev: unknown[]): unknown[][] | null {
  for (const v of ev) {
    if (
      Array.isArray(v) &&
      v.length > 0 &&
      Array.isArray(v[0]) &&
      typeof (v[0] as unknown[])[0] === 'string' &&
      ((v[0] as unknown[])[0] as string).includes('@')
    ) {
      return v as unknown[][];
    }
  }
  return null;
}

function findTimeRange(
  ev: unknown[],
): { startMs: number; endMs: number; allDay: boolean } | null {
  let startMs: number | null = null;
  let endMs: number | null = null;
  let allDay = false;

  for (const v of ev) {
    if (
      Array.isArray(v) &&
      v.length === 3 &&
      v[0] === null &&
      Array.isArray(v[1]) &&
      typeof v[1][0] === 'number' &&
      typeof v[2] === 'string'
    ) {
      const ms = v[1][0] as number;
      if (ms < 1_000_000_000_000) continue;
      if (startMs === null) startMs = ms;
      else if (endMs === null) {
        endMs = ms;
        break;
      }
    } else if (
      Array.isArray(v) &&
      v.length === 1 &&
      typeof v[0] === 'number' &&
      v[0] > 1_000_000_000_000
    ) {
      if (startMs === null) {
        startMs = v[0] as number;
        allDay = true;
      } else if (endMs === null) {
        endMs = v[0] as number;
        break;
      }
    }
  }

  if (startMs === null || endMs === null) return null;
  return { startMs, endMs, allDay };
}

function parseEvent(ev: unknown[], userEmail: string): CalendarEvent | null {
  const id = ev[0];
  const title = ev[5];
  if (typeof id !== 'string' || typeof title !== 'string') return null;

  const range = findTimeRange(ev);
  if (!range) return null;

  let attendance: AttendanceStatus = 'unknown';
  const attendees = findAttendees(ev);
  if (attendees) {
    for (const att of attendees) {
      if (Array.isArray(att) && att[0] === userEmail) {
        attendance = parseAttendanceStatus(att[5]);
        break;
      }
    }
  } else {
    attendance = 'accepted';
  }

  return {
    id,
    title,
    startMs: range.startMs,
    endMs: range.endMs,
    allDay: range.allDay,
    attendanceStatus: attendance,
    durationMinutes: Math.round((range.endMs - range.startMs) / 60000),
  };
}

export async function listCalendarEvents(params: {
  userEmail: string;
  dateFrom: string;
  dateTo: string;
}): Promise<CalendarEvent[]> {
  const dayFrom = dateIsoToUnixDay(params.dateFrom);
  const dayTo = dateIsoToUnixDay(params.dateTo) + 1;

  const fReq = JSON.stringify([
    [
      [params.userEmail],
      [null, null, dayFrom, dayTo],
      [
        null, 3, 'calendar.web_20260413.06_p0', null, null, null, null,
        898975674, null, 'WEB', 'prod-02-eu.web', 1, null, null, null, 0,
        null, '2025b', 1, 1, null, 1, 1, null, 0, 0,
      ],
      [null, 1, 1, 1, 1, null, 0],
    ],
  ]);

  const body = new URLSearchParams({
    'f.req': fReq,
    cwuik: '10',
    hl: 'en_GB',
  });

  const res = await calendarFetch('/calendar/u/0/sync.fetcheventrange', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(
      `Calendar event fetch failed: ${res.status} ${await res
        .text()
        .catch(() => '')}`,
    );
  }

  const text = await res.text();
  const jsonText = text.startsWith(")]}'") ? text.slice(4) : text;
  const data = JSON.parse(jsonText);

  const calendars = data?.[0]?.[2]?.[1];
  if (!Array.isArray(calendars)) return [];

  const out: CalendarEvent[] = [];
  for (const cal of calendars) {
    const events = cal?.[1];
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      if (!Array.isArray(ev)) continue;
      const parsed = parseEvent(ev, params.userEmail);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}
