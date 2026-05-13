import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Tempo Auto Logger',
  description:
    'Auto-logs time to Jira Tempo from GitHub activity and Google Calendar meetings',
  version: pkg.version,
  update_url:
    'https://kristapsk123.github.io/tempo-auto-logger/updates.xml',
  action: {
    default_title: 'Tempo Auto Logger',
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  permissions: ['storage', 'alarms'],
  host_permissions: [
    'https://jira.visma.com/*',
    'https://calendar.google.com/*',
    'https://api.github.com/*',
  ],
});
