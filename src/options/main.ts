import { mount } from 'svelte';
import Options from './Options.svelte';
import '../app.css';
import { applyThemeClass, theme } from '../lib/theme.svelte';
import { getNeonTheme } from '../lib/storage';

// Read the persisted theme preference before mount so the first paint
// matches the user's setting (default: neon on).
const neonEnabled = await getNeonTheme();
theme.neon = neonEnabled;
applyThemeClass(neonEnabled);

const app = mount(Options, {
  target: document.getElementById('app')!,
});

export default app;
