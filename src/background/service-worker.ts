chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // TODO (phase 8): open onboarding wizard
    console.log('[tempo-auto-logger] Installed');
  }
});
