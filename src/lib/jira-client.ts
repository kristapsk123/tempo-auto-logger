import { jiraFetch } from './http';

export interface JiraUser {
  accountId: string;
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

export interface JiraIssueInfo {
  id: string;
  summary: string;
}

export async function getMyself(): Promise<JiraUser> {
  const res = await jiraFetch('/rest/api/3/myself');
  if (!res.ok) throw new Error(`getMyself failed: ${res.status}`);
  return res.json();
}

export async function getIssue(key: string): Promise<JiraIssue | null> {
  const res = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary`,
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

interface SearchPage {
  issues?: Array<{ id?: string; key?: string; fields?: { summary?: string } }>;
  nextPageToken?: string;
}

const SEARCH_PAGE_SIZE = 100;

async function searchIssuesByKey(
  keys: string[],
  out: Map<string, JiraIssueInfo>,
): Promise<void> {
  const jql = `issueKey in (${keys.map((k) => `"${k}"`).join(',')})`;
  let nextPageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      jql,
      fields: 'summary',
      maxResults: String(SEARCH_PAGE_SIZE),
    });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await jiraFetch(`/rest/api/3/search/jql?${params}`);
    if (!res.ok) return;
    const page = (await res.json()) as SearchPage;
    for (const iss of page.issues ?? []) {
      if (iss.key && iss.id) {
        out.set(iss.key, { id: iss.id, summary: iss.fields?.summary ?? '' });
      }
    }
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
}

/**
 * Resolves issue keys to their numeric id and summary. Tempo Cloud identifies issues by id only, so
 * both posting and dedupe need this. One JQL search covers the batch; a key the search did not return
 * (the whole search fails when any key is unknown, and a moved issue comes back under its new key) is
 * looked up on its own.
 */
export async function fetchIssues(
  keys: string[],
): Promise<Map<string, JiraIssueInfo>> {
  const out = new Map<string, JiraIssueInfo>();
  const unique = [...new Set(keys)];
  if (unique.length === 0) return out;

  await searchIssuesByKey(unique, out);

  const missing = unique.filter((k) => !out.has(k));
  await Promise.all(
    missing.map(async (key) => {
      const issue = await getIssue(key).catch(() => null);
      if (issue) out.set(key, { id: issue.id, summary: issue.fields?.summary ?? '' });
    }),
  );
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
  const res = await jiraFetch(`/rest/api/3/issue/picker?${params}`);
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
