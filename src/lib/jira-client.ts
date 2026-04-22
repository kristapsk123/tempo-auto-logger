import { jiraFetch } from './http';

export interface JiraUser {
  key: string;
  name: string;
  displayName: string;
  emailAddress?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
  };
}

export async function getMyself(): Promise<JiraUser> {
  const res = await jiraFetch('/rest/api/2/myself');
  if (!res.ok) throw new Error(`getMyself failed: ${res.status}`);
  return res.json();
}

export async function getIssue(key: string): Promise<JiraIssue | null> {
  const res = await jiraFetch(
    `/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getIssue(${key}) failed: ${res.status}`);
  return res.json();
}

export interface JiraIssueOption {
  key: string;
  summary: string;
  sectionLabel?: string;
}

interface IssuePickerResponse {
  sections?: Array<{
    id?: string;
    label?: string;
    issues?: Array<{
      key: string;
      summary?: string;
      summaryText?: string;
    }>;
  }>;
}

/**
 * Batch-fetch summaries for the given issue keys via JQL search.
 * Returns a map of key -> summary for issues that were found.
 */
export async function fetchIssueSummaries(
  keys: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;
  const jql = `issueKey in (${keys.map((k) => `"${k}"`).join(',')})`;
  const params = new URLSearchParams({
    jql,
    fields: 'summary',
    maxResults: String(Math.max(keys.length, 50)),
  });
  const res = await jiraFetch(`/rest/api/2/search?${params}`);
  if (!res.ok) return out;
  const data = (await res.json()) as {
    issues?: Array<{ key?: string; fields?: { summary?: string } }>;
  };
  for (const iss of data.issues ?? []) {
    if (iss.key) out.set(iss.key, iss.fields?.summary ?? '');
  }
  return out;
}

/**
 * Uses Jira's issue-picker endpoint — same one the "link to issue" dialog uses.
 * Without a query, returns the user's recent/suggested issues ("History Search").
 * With a query, returns matching issues.
 */
export async function searchIssuePicker(
  query: string = '',
  limit: number = 20,
): Promise<JiraIssueOption[]> {
  const params = new URLSearchParams({
    query,
    showSubTasks: 'true',
    showSubTaskParent: 'true',
  });
  const res = await jiraFetch(`/rest/api/2/issue/picker?${params}`);
  if (!res.ok) return [];
  const data = (await res.json()) as IssuePickerResponse;

  const out: JiraIssueOption[] = [];
  const seen = new Set<string>();
  for (const section of data.sections ?? []) {
    for (const iss of section.issues ?? []) {
      if (!iss.key || seen.has(iss.key)) continue;
      seen.add(iss.key);
      out.push({
        key: iss.key,
        summary: iss.summaryText ?? iss.summary ?? '',
        sectionLabel: section.label,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
