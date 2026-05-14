import { mount } from 'svelte';
import Popup from './Popup.svelte';
import '../app.css';
import { applyThemeClass, theme } from '../lib/theme.svelte';
import { getNeonTheme, getCustomIcon } from '../lib/storage';

// Read persisted preferences before mount so the first paint matches the
// user's settings (neon default: on).
const [neonEnabled, customIcon] = await Promise.all([getNeonTheme(), getCustomIcon()]);
theme.neon = neonEnabled;
applyThemeClass(neonEnabled);

// Set page favicon so the popup window title bar reflects the custom icon.
const faviconLink = document.createElement('link');
faviconLink.rel = 'icon';
faviconLink.href = customIcon ?? chrome.runtime.getURL('src/icons/pony48.png');
document.head.appendChild(faviconLink);

const app = mount(Popup, {
  target: document.getElementById('app')!,
});

export default app;
