import {
  clearAvailableUpdate,
  getAvailableUpdate,
  setAvailableUpdate,
} from './storage';

const RELEASES_URL =
  'https://api.github.com/repos/kristapsk123/tempo-auto-logger/releases/latest';

function parseSemver(v: string): number[] {
  return v
    .replace(/^v/, '')
    .split('.')
    .map((p) => Number.parseInt(p, 10) || 0);
}

function isNewer(remote: string, local: string): boolean {
  const r = parseSemver(remote);
  const l = parseSemver(local);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const a = r[i] ?? 0;
    const b = l[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

export async function checkForUpdate(): Promise<void> {
  const currentVersion = chrome.runtime.getManifest().version;
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
    };
    const tag = data.tag_name?.replace(/^v/, '');
    const htmlUrl = data.html_url;
    if (!tag || !htmlUrl) return;

    if (isNewer(tag, currentVersion)) {
      await setAvailableUpdate({
        version: tag,
        htmlUrl,
        checkedAt: Date.now(),
      });
    } else {
      const existing = await getAvailableUpdate();
      if (existing) await clearAvailableUpdate();
    }
  } catch {
    // Silent: network errors shouldn't surface to the user.
  }
}
