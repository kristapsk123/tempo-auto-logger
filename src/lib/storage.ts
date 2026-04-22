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

