import type {
  AttendanceFilter,
  DescriptionTemplates,
  MeetingMapping,
} from '../types';

const KEYS = {
  GITHUB_TOKEN: 'githubToken',
  USER_MEETING_MAPPINGS: 'userMeetingMappings',
  ATTENDANCE_FILTER: 'attendanceFilter',
  USER_TEMPLATES: 'userDescriptionTemplates',
  FALLBACK_COMMIT_JIRA: 'fallbackCommitJira',
  NEON_THEME: 'neonTheme',
} as const;

export const DEFAULT_ATTENDANCE_FILTER: AttendanceFilter = 'all-except-declined';

export async function getGithubToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(KEYS.GITHUB_TOKEN);
  const token = result[KEYS.GITHUB_TOKEN];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

export async function setGithubToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [KEYS.GITHUB_TOKEN]: token });
}

export async function clearGithubToken(): Promise<void> {
  await chrome.storage.local.remove(KEYS.GITHUB_TOKEN);
}

export async function getUserMeetingMappings(): Promise<MeetingMapping[]> {
  const result = await chrome.storage.local.get(KEYS.USER_MEETING_MAPPINGS);
  const value = result[KEYS.USER_MEETING_MAPPINGS];
  return Array.isArray(value) ? (value as MeetingMapping[]) : [];
}

export async function addUserMeetingMapping(
  mapping: MeetingMapping,
): Promise<void> {
  const existing = await getUserMeetingMappings();
  const normalizedNew = mapping.match.toLowerCase();
  const filtered = existing.filter(
    (m) => m.match.toLowerCase() !== normalizedNew,
  );
  filtered.push(mapping);
  await chrome.storage.local.set({ [KEYS.USER_MEETING_MAPPINGS]: filtered });
}

export async function removeUserMeetingMapping(match: string): Promise<void> {
  const existing = await getUserMeetingMappings();
  const normalized = match.toLowerCase();
  const filtered = existing.filter(
    (m) => m.match.toLowerCase() !== normalized,
  );
  await chrome.storage.local.set({ [KEYS.USER_MEETING_MAPPINGS]: filtered });
}

export async function replaceUserMeetingMappings(
  mappings: MeetingMapping[],
): Promise<void> {
  await chrome.storage.local.set({ [KEYS.USER_MEETING_MAPPINGS]: mappings });
}

export async function getAttendanceFilter(): Promise<AttendanceFilter> {
  const result = await chrome.storage.local.get(KEYS.ATTENDANCE_FILTER);
  const value = result[KEYS.ATTENDANCE_FILTER];
  if (
    value === 'accepted' ||
    value === 'all' ||
    value === 'all-except-declined'
  ) {
    return value;
  }
  return DEFAULT_ATTENDANCE_FILTER;
}

export async function setAttendanceFilter(
  filter: AttendanceFilter,
): Promise<void> {
  await chrome.storage.local.set({ [KEYS.ATTENDANCE_FILTER]: filter });
}

export async function getUserTemplates(): Promise<Partial<DescriptionTemplates>> {
  const result = await chrome.storage.local.get(KEYS.USER_TEMPLATES);
  const value = result[KEYS.USER_TEMPLATES];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Partial<DescriptionTemplates> = {};
    const v = value as Record<string, unknown>;
    if (typeof v.commit === 'string') out.commit = v.commit;
    if (typeof v.review === 'string') out.review = v.review;
    if (typeof v.meeting === 'string') out.meeting = v.meeting;
    return out;
  }
  return {};
}

export async function setUserTemplates(
  templates: Partial<DescriptionTemplates>,
): Promise<void> {
  await chrome.storage.local.set({ [KEYS.USER_TEMPLATES]: templates });
}

export async function getFallbackCommitJira(): Promise<string | null> {
  const result = await chrome.storage.local.get(KEYS.FALLBACK_COMMIT_JIRA);
  const value = result[KEYS.FALLBACK_COMMIT_JIRA];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function setFallbackCommitJira(jiraKey: string): Promise<void> {
  await chrome.storage.local.set({ [KEYS.FALLBACK_COMMIT_JIRA]: jiraKey });
}

export async function clearFallbackCommitJira(): Promise<void> {
  await chrome.storage.local.remove(KEYS.FALLBACK_COMMIT_JIRA);
}

export async function getNeonTheme(): Promise<boolean> {
  const result = await chrome.storage.local.get(KEYS.NEON_THEME);
  // Default to true (neon on) when not yet set
  return result[KEYS.NEON_THEME] !== false;
}

export async function setNeonTheme(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [KEYS.NEON_THEME]: enabled });
}

// --- Session storage: popup state within a single browser session ---

export type UnmappedInputCache = Record<
  string,
  { jiraInput: string; matchInput: string; skipInput: boolean }
>;

const SESSION_KEYS = {
  POPUP_DATE_FROM: 'popupDateFrom',
  POPUP_DATE_TO: 'popupDateTo',
  UNMAPPED_INPUTS: 'unmappedInputs',
  CAPTCHA_PASSED: 'captchaPassed',
} as const;

export async function getSessionPopupDates(): Promise<{
  dateFrom: string | null;
  dateTo: string | null;
}> {
  const result = await chrome.storage.session.get([
    SESSION_KEYS.POPUP_DATE_FROM,
    SESSION_KEYS.POPUP_DATE_TO,
  ]);
  return {
    dateFrom:
      typeof result[SESSION_KEYS.POPUP_DATE_FROM] === 'string'
        ? (result[SESSION_KEYS.POPUP_DATE_FROM] as string)
        : null,
    dateTo:
      typeof result[SESSION_KEYS.POPUP_DATE_TO] === 'string'
        ? (result[SESSION_KEYS.POPUP_DATE_TO] as string)
        : null,
  };
}

export async function setSessionPopupDates(
  dateFrom: string,
  dateTo: string,
): Promise<void> {
  await chrome.storage.session.set({
    [SESSION_KEYS.POPUP_DATE_FROM]: dateFrom,
    [SESSION_KEYS.POPUP_DATE_TO]: dateTo,
  });
}

export async function getSessionUnmappedInputs(): Promise<UnmappedInputCache> {
  const result = await chrome.storage.session.get(SESSION_KEYS.UNMAPPED_INPUTS);
  const value = result[SESSION_KEYS.UNMAPPED_INPUTS];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as UnmappedInputCache;
  }
  return {};
}

export async function setSessionUnmappedInputs(
  inputs: UnmappedInputCache,
): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEYS.UNMAPPED_INPUTS]: inputs });
}

export async function clearSessionUnmappedInputs(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEYS.UNMAPPED_INPUTS);
}

export async function getSessionCaptchaPassed(): Promise<boolean> {
  const result = await chrome.storage.session.get(SESSION_KEYS.CAPTCHA_PASSED);
  return result[SESSION_KEYS.CAPTCHA_PASSED] === true;
}

export async function setSessionCaptchaPassed(): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEYS.CAPTCHA_PASSED]: true });
}

