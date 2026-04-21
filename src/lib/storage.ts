import type { MeetingMapping } from '../types';

const KEYS = {
  GITHUB_TOKEN: 'githubToken',
  USER_MEETING_MAPPINGS: 'userMeetingMappings',
} as const;

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
