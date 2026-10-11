// Themes are CSS-only: a theme sets `data-theme` on <html> and app.css does the
// rest, so adding one means a CSS block plus an entry here. `dark` forces the
// dark variant on or off; 'system' follows the OS setting.
export type ThemeId =
  | 'classic'
  | 'sticker'
  | 'organic'
  | 'meadow'
  | 'night'
  | 'field';

const GF = 'https://fonts.googleapis.com/css2?family=';

export const THEMES: {
  id: ThemeId;
  label: string;
  dark: 'system' | boolean;
  // Google Fonts stylesheet, loaded only while the theme is in use.
  fonts?: string;
}[] = [
  { id: 'classic', label: 'Classic', dark: 'system' },
  {
    id: 'sticker',
    label: 'Sticker Garden',
    dark: false,
    fonts: `${GF}Baloo+2:wght@600;800&family=Nunito:wght@600;700;800&display=swap`,
  },
  {
    id: 'organic',
    label: 'Organic',
    dark: false,
    fonts: `${GF}Caprasimo&family=Figtree:wght@400;600;700&display=swap`,
  },
  {
    id: 'meadow',
    label: 'Sprout Meadow',
    dark: false,
    fonts: `${GF}Bricolage+Grotesque:wght@500;700;800&family=DM+Sans:wght@400;500;700&display=swap`,
  },
  {
    id: 'night',
    label: 'Night Greenhouse',
    dark: true,
    fonts: `${GF}Space+Grotesk:wght@400;500;700&display=swap`,
  },
  {
    id: 'field',
    label: 'Field Guide',
    dark: false,
    fonts: `${GF}Newsreader:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap`,
  },
];

const KEY = 'sprout-theme';

export function loadTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(KEY);
    if (THEMES.some((t) => t.id === saved)) return saved as ThemeId;
  } catch {
    // Storage blocked: fall through to the default.
  }
  return 'classic';
}

export function applyTheme(id: ThemeId) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  const dark =
    theme.dark === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : theme.dark;
  root.classList.toggle('dark', dark);

  const existing = document.getElementById('theme-fonts');
  if (theme.fonts) {
    const link = existing ?? document.createElement('link');
    link.id = 'theme-fonts';
    (link as HTMLLinkElement).rel = 'stylesheet';
    (link as HTMLLinkElement).href = theme.fonts;
    if (!existing) document.head.appendChild(link);
  } else {
    existing?.remove();
  }
}

export function saveTheme(id: ThemeId) {
  try {
    localStorage.setItem(KEY, id);
    // Read by the inline script in index.html to pick light/dark before paint.
    const dark = THEMES.find((t) => t.id === id)?.dark;
    localStorage.setItem(`${KEY}-dark`, dark === true ? '1' : '0');
  } catch {
    // Not persisted; still applied for this session.
  }
  applyTheme(id);
}
