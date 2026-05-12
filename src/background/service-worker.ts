const POPUP_URL = 'src/popup/index.html';
const POPUP_WINDOW_KEY = 'popupWindowId';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // TODO (phase 8): open onboarding wizard
    console.log('[tempo-auto-logger] Installed');
  }
});

chrome.action.onClicked.addListener(async () => {
  const stored = await chrome.storage.session.get(POPUP_WINDOW_KEY);
  const existingId: number | undefined = stored[POPUP_WINDOW_KEY];

  if (existingId !== undefined) {
    try {
      await chrome.windows.update(existingId, { focused: true });
      return;
    } catch {
      // Window no longer exists; fall through to create a new one.
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(POPUP_URL),
    type: 'popup',
    width: 648,
    height: 700,
  });

  if (win.id !== undefined) {
    await chrome.storage.session.set({ [POPUP_WINDOW_KEY]: win.id });
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = await chrome.storage.session.get(POPUP_WINDOW_KEY);
  if (stored[POPUP_WINDOW_KEY] === windowId) {
    await chrome.storage.session.remove(POPUP_WINDOW_KEY);
  }
});
