const JIRA_KEY_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

export function extractJiraKeys(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(JIRA_KEY_REGEX);
  return matches ? Array.from(new Set(matches)) : [];
}

export function firstJiraKey(sources: Array<string | null | undefined>): string | null {
  for (const source of sources) {
    const keys = extractJiraKeys(source);
    if (keys.length > 0) return keys[0];
  }
  return null;
}
