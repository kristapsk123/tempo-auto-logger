import { JIRA_BASE_URL, TEMPO_API_BASE_URL } from './config';
import { getTempoToken } from './storage';

export type AuthService = 'jira' | 'tempo' | 'calendar' | 'github';

export class SessionExpiredError extends Error {
  constructor(public readonly service: AuthService) {
    super(
      service === 'tempo'
        ? 'Tempo API token is missing or invalid'
        : `${service} session expired or not logged in`,
    );
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

/**
 * Tempo Cloud lives on its own host and does not accept the Jira session, so every call carries the
 * user's Tempo API token. Pagination links come back as absolute URLs, which are accepted only for that host.
 */
export async function tempoFetch(
  pathOrUrl: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getTempoToken();
  if (!token) throw new SessionExpiredError('tempo');

  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${TEMPO_API_BASE_URL}${pathOrUrl}`;
  if (!url.startsWith(`${TEMPO_API_BASE_URL}/`)) {
    throw new Error(`Refusing to send the Tempo token to ${url}`);
  }

  const response = await fetch(url, {
    ...init,
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401) throw new SessionExpiredError('tempo');
  return response;
}
