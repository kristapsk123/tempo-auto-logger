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
