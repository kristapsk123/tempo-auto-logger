// Shared reactive theme state. Popup writes it; all components read it.
export const theme = $state({ neon: true });

// Apply/remove `neon-theme` class on <html> to enable neon global CSS.
export function applyThemeClass(neon: boolean) {
  if (neon) {
    document.documentElement.classList.add('neon-theme');
  } else {
    document.documentElement.classList.remove('neon-theme');
  }
}
