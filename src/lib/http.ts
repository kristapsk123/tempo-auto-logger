import { JIRA_BASE_URL } from './config';

export type AuthService = 'jira' | 'calendar' | 'github';

export class SessionExpiredError extends Error {
  constructor(public readonly service: AuthService) {
    super(`${service} session expired or not logged in`);
    this.name = 'SessionExpiredError';
  }
}

export async function jiraFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${JIRA_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });

  if (!response.url.startsWith(JIRA_BASE_URL)) {
    throw new SessionExpiredError('jira');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError('jira');
  }
  if (contentType.includes('text/html') && !response.ok) {
    throw new SessionExpiredError('jira');
  }

  return response;
}
