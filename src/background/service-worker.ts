const POPUP_URL = 'src/popup/index.html';
const POPUP_WINDOW_KEY = 'popupWindowId';
const UPDATE_ALARM = 'checkUpdate';
const UPDATE_PERIOD_MIN = 5;

const DEFAULT_ICON_PATHS = {
  16: 'src/icons/pony16.png',
  32: 'src/icons/pony32.png',
  48: 'src/icons/pony48.png',
  128: 'src/icons/pony128.png',
};

async function applyCustomIcon(): Promise<void> {
  const result = await chrome.storage.local.get('customIcon');
  const dataUrl: unknown = result['customIcon'];
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return;

  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const sizes = [16, 32, 48, 128] as const;
    const imageDataMap: { [size: number]: ImageData } = {};

    for (const size of sizes) {
      const bitmap = await createImageBitmap(blob, {
        resizeWidth: size,
        resizeHeight: size,
        resizeQuality: 'high',
      });
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      ctx.drawImage(bitmap, 0, 0, size, size);
      imageDataMap[size] = ctx.getImageData(0, 0, size, size);
      bitmap.close();
    }

    await chrome.action.setIcon({ imageData: imageDataMap });
  } catch (e) {
    console.warn('[tempo-auto-logger] failed to apply custom icon', e);
  }
}

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
  void applyCustomIcon();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MIN });
  pokeUpdateCheck();
  void applyCustomIcon();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && 'customIcon' in changes) {
    const newValue = changes['customIcon'].newValue;
    if (typeof newValue === 'string' && newValue.startsWith('data:')) {
      void applyCustomIcon();
    } else {
      void chrome.action.setIcon({ path: DEFAULT_ICON_PATHS });
    }
  }
});

chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MIN });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) {
    pokeUpdateCheck();
  }
});

pokeUpdateCheck();
void applyCustomIcon();

chrome.action.onClicked.addListener(async () => {
  // Ensure the custom icon is applied before the window is created so Windows
  // captures the correct taskbar icon (action icon) at creation time.
  await applyCustomIcon();

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
