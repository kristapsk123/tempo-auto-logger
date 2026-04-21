import { jiraFetch } from './http';
import { getIssue } from './jira-client';

export interface TempoWorklog {
  tempoWorklogId?: number;
  jiraWorklogId?: number;
  issue: { key: string; id: number; summary?: string };
  timeSpentSeconds: number;
  billableSeconds?: number;
  comment: string;
  started: string;
  dateStarted?: string;
  worker: string;
}

export interface ListWorklogsParams {
  usernames: string[];
  dateFrom: string;
  dateTo: string;
}

export async function listWorklogs(
  params: ListWorklogsParams,
): Promise<TempoWorklog[]> {
  const res = await jiraFetch('/rest/tempo-timesheets/4/worklogs/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: params.dateFrom,
      to: params.dateTo,
      worker: params.usernames,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `listWorklogs failed: ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
  return res.json();
}

export interface CreateWorklogParams {
  issueKey: string;
  worker: string;
  started: string;
  timeSpentSeconds: number;
  comment: string;
}

export async function createWorklog(
  params: CreateWorklogParams,
): Promise<TempoWorklog> {
  const issue = await getIssue(params.issueKey);
  if (!issue) throw new Error(`Issue ${params.issueKey} not found`);

  const body = {
    originTaskId: parseInt(issue.id, 10),
    worker: params.worker,
    started: params.started,
    timeSpentSeconds: params.timeSpentSeconds,
    billableSeconds: params.timeSpentSeconds,
    comment: params.comment,
    remainingEstimate: 0,
    attributes: {},
  };

  const res = await jiraFetch('/rest/tempo-timesheets/4/worklogs/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `createWorklog failed: ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
  return res.json();
}
