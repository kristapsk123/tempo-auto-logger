const POPUP_URL = 'src/popup/index.html';
const POPUP_WINDOW_KEY = 'popupWindowId';
const UPDATE_ALARM = 'checkUpdate';
const UPDATE_PERIOD_MIN = 5;

// Force Chrome to poll our self-hosted updates.xml now instead of waiting
// its default ~5h cadence. Only meaningful when the extension is installed
// via the ExtensionInstallForcelist policy from the CRX (see install.ps1);
// harmless during unpacked development.
function pokeUpdateCheck(): void {
  try {
    chrome.runtime.requestUpdateCheck?.((status) => {
      console.log('[tempo-auto-logger] update check', status);
    });
  } catch {
    // requestUpdateCheck isn't available in all contexts; ignore.
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[tempo-auto-logger] Installed');
  }
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MIN });
  pokeUpdateCheck();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MIN });
  pokeUpdateCheck();
});

chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MIN });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) {
    pokeUpdateCheck();
  }
});

pokeUpdateCheck();

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
