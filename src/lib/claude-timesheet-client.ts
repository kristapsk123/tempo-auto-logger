import type { AttendanceFilter, MeetingMapping } from '../types';

/**
 * Talks to the native messaging host of the Claude Code plugin visma-tempo-auto-logger, which serves
 * timesheets rendered by Claude Code and stores this extension's mapping settings for it. Posting still
 * goes through the normal Tempo flow after the user reviews.
 */

export const CLAUDE_TIMESHEET_HOST = 'com.visma.tempo_auto_logger';
export const CLAUDE_TIMESHEET_FORMAT = 'tempo-auto-logger/claude-v1';

// Chrome reports a host that is not registered this way; teammates without the skill must not see an error.
const HOST_NOT_FOUND_PATTERN = /native messaging host not found/i;

export interface ClaudeTimesheetSummary {
  from: string;
  to: string;
  renderedAt: string;
  entryCount: number;
  totalMinutes: number;
}

export interface ClaudeTimesheetEntry {
  date: string;
  issueKey: string | null;
  minutes: number;
  comment: string;
  note?: string;
}

export interface ClaudeTimesheet {
  format: string;
  from: string;
  to: string;
  renderedAt: string;
  entries: ClaudeTimesheetEntry[];
}

export interface ClaudeSettingsSnapshot {
  userMeetingMappings: MeetingMapping[];
  teamMeetingMappings: MeetingMapping[];
  attendanceFilter: AttendanceFilter;
  fallbackCommitJira: string | null;
}

type HostResponse<T> = ({ ok: true } & T) | { ok: false; error: string };

function sendToHost<T>(message: object): Promise<HostResponse<T>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(CLAUDE_TIMESHEET_HOST, message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? 'Claude timesheet host failed'));
        return;
      }
      resolve(response as HostResponse<T>);
    });
  });
}

export async function listClaudeTimesheets(): Promise<ClaudeTimesheetSummary[] | null> {
  try {
    const response = await sendToHost<{ timesheets: ClaudeTimesheetSummary[] }>({ type: 'listTimesheets' });
    if (!response.ok) throw new Error(response.error);
    return response.timesheets;
  } catch (e) {
    if (e instanceof Error && HOST_NOT_FOUND_PATTERN.test(e.message)) return null;
    throw e;
  }
}

export async function getClaudeTimesheet(from: string, to: string): Promise<ClaudeTimesheet> {
  const response = await sendToHost<{ timesheet: ClaudeTimesheet }>({ type: 'getTimesheet', from, to });
  if (!response.ok) throw new Error(response.error);
  if (response.timesheet.format !== CLAUDE_TIMESHEET_FORMAT) {
    throw new Error(`Unsupported Claude timesheet format: ${response.timesheet.format}`);
  }
  return response.timesheet;
}

export async function syncClaudeSettings(settings: ClaudeSettingsSnapshot): Promise<void> {
  const response = await sendToHost<{ syncedAt: string }>({ type: 'syncSettings', settings });
  if (!response.ok) throw new Error(response.error);
}
