import { tempoFetch } from './http';

export interface TempoWorklog {
  tempoWorklogId: number;
  issueId: string;
  startDate: string;
  timeSpentSeconds: number;
  description: string;
}

interface TempoWorklogPage {
  metadata?: { next?: string };
  results?: Array<{
    tempoWorklogId?: number;
    issue?: { id?: number | string };
    startDate?: string;
    timeSpentSeconds?: number;
    description?: string | null;
  }>;
}

export interface ListWorklogsParams {
  accountId: string;
  dateFrom: string;
  dateTo: string;
}

const WORKLOG_PAGE_SIZE = 1000;

export async function listWorklogs(
  params: ListWorklogsParams,
): Promise<TempoWorklog[]> {
  const query = new URLSearchParams({
    from: params.dateFrom,
    to: params.dateTo,
    limit: String(WORKLOG_PAGE_SIZE),
  });
  let url: string | undefined =
    `/worklogs/user/${encodeURIComponent(params.accountId)}?${query}`;

  const out: TempoWorklog[] = [];
  while (url) {
    const res = await tempoFetch(url);
    if (!res.ok) {
      throw new Error(
        `listWorklogs failed: ${res.status} ${await res.text().catch(() => '')}`,
      );
    }
    const page = (await res.json()) as TempoWorklogPage;
    for (const w of page.results ?? []) {
      if (w.issue?.id === undefined || !w.startDate) continue;
      out.push({
        tempoWorklogId: w.tempoWorklogId ?? 0,
        issueId: String(w.issue.id),
        startDate: w.startDate.slice(0, 10),
        timeSpentSeconds: w.timeSpentSeconds ?? 0,
        description: w.description ?? '',
      });
    }
    url = page.metadata?.next;
  }
  return out;
}

export interface CreateWorklogParams {
  issueId: string;
  authorAccountId: string;
  startDate: string;
  timeSpentSeconds: number;
  description: string;
}

export async function createWorklog(params: CreateWorklogParams): Promise<void> {
  const res = await tempoFetch('/worklogs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      issueId: parseInt(params.issueId, 10),
      authorAccountId: params.authorAccountId,
      startDate: params.startDate,
      timeSpentSeconds: params.timeSpentSeconds,
      billableSeconds: params.timeSpentSeconds,
      description: params.description,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `createWorklog failed: ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
}
