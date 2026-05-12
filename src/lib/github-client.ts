import { extractJiraKeys, firstJiraKey } from './jira-key-extractor';
import { SessionExpiredError } from './http';

const GITHUB_API = 'https://api.github.com';

async function gh(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...init?.headers,
    },
  });
  if (res.status === 401) throw new SessionExpiredError('github');
  return res;
}

export interface GithubUser {
  login: string;
  id: number;
  name: string | null;
}

export async function getGithubUser(token: string): Promise<GithubUser> {
  const res = await gh(token, '/user');
  if (!res.ok) throw new Error(`getGithubUser failed: ${res.status}`);
  return res.json();
}

export interface CommitActivity {
  date: string;
  committedAt: string;
  jiraKey: string;
  repo: string;
  commitSha: string;
  message: string;
}

export async function searchMyCommits(params: {
  token: string;
  username: string;
  orgs: string[];
  dateFrom: string;
  dateTo: string;
}): Promise<CommitActivity[]> {
  const results: CommitActivity[] = [];
  for (const org of params.orgs) {
    const q = `author:${params.username} org:${org} author-date:${params.dateFrom}..${params.dateTo}`;
    const res = await gh(
      params.token,
      `/search/commits?q=${encodeURIComponent(q)}&per_page=100`,
    );
    if (!res.ok) {
      throw new Error(
        `searchMyCommits failed for ${org}: ${res.status} ${await res
          .text()
          .catch(() => '')}`,
      );
    }
    const data = (await res.json()) as {
      items: Array<{
        sha: string;
        commit: { message: string; author: { date: string } };
        repository: { full_name: string };
      }>;
    };
    for (const item of data.items) {
      const firstLine = item.commit.message.split('\n')[0];
      const jiraKeys = extractJiraKeys(firstLine);
      if (jiraKeys.length === 0) continue;
      for (const jiraKey of jiraKeys) {
        results.push({
          date: item.commit.author.date.slice(0, 10),
          committedAt: item.commit.author.date,
          jiraKey,
          repo: item.repository.full_name,
          commitSha: item.sha,
          message: firstLine,
        });
      }
    }
  }
  return results;
}

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';

export interface ReviewActivity {
  date: string;
  jiraKey: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prBranch: string;
  reviewState: ReviewState;
}

export async function listMyReviews(params: {
  token: string;
  username: string;
  orgs: string[];
  dateFrom: string;
  dateTo: string;
}): Promise<ReviewActivity[]> {
  const results: ReviewActivity[] = [];
  const seen = new Set<string>();

  for (const org of params.orgs) {
    const q = `reviewed-by:${params.username} type:pr org:${org} updated:${params.dateFrom}..${params.dateTo}`;
    const searchRes = await gh(
      params.token,
      `/search/issues?q=${encodeURIComponent(q)}&per_page=100`,
    );
    if (!searchRes.ok) {
      throw new Error(
        `listMyReviews search failed for ${org}: ${searchRes.status}`,
      );
    }
    const search = (await searchRes.json()) as {
      items: Array<{
        number: number;
        title: string;
        repository_url: string;
        user: { login: string };
      }>;
    };

    for (const pr of search.items) {
      if (pr.user.login === params.username) continue;
      const repoPath = pr.repository_url.replace(`${GITHUB_API}/repos/`, '');

      const reviewsRes = await gh(
        params.token,
        `/repos/${repoPath}/pulls/${pr.number}/reviews`,
      );
      if (!reviewsRes.ok) continue;
      const reviews = (await reviewsRes.json()) as Array<{
        user: { login: string };
        state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
        submitted_at: string;
      }>;

      let branch: string | null = null;
      const titleKey = firstJiraKey([pr.title]);

      for (const review of reviews) {
        if (review.user.login !== params.username) continue;
        if (review.state === 'DISMISSED' || review.state === 'PENDING') continue;

        const dateOnly = review.submitted_at.slice(0, 10);
        if (dateOnly < params.dateFrom || dateOnly > params.dateTo) continue;

        const dedupeKey = `${repoPath}#${pr.number}@${dateOnly}`;
        if (seen.has(dedupeKey)) continue;

        let jiraKey = titleKey;
        if (!jiraKey) {
          if (branch === null) {
            const prRes = await gh(
              params.token,
              `/repos/${repoPath}/pulls/${pr.number}`,
            );
            if (prRes.ok) {
              const prData = (await prRes.json()) as { head: { ref: string } };
              branch = prData.head.ref;
            } else {
              branch = '';
            }
          }
          jiraKey = firstJiraKey([branch]);
        }
        if (!jiraKey) continue;

        seen.add(dedupeKey);
        results.push({
          date: dateOnly,
          jiraKey,
          repo: repoPath,
          prNumber: pr.number,
          prTitle: pr.title,
          prBranch: branch ?? '',
          reviewState: review.state as ReviewState,
        });
      }
    }
  }
  return results;
}
