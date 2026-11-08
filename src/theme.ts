export type ThemePref = 'auto' | 'light' | 'dark';

const KEY = 'soiduk.theme';
/** browser UI colour (address bar / status bar) per theme */
const CHROME: Record<'light' | 'dark', string> = { light: '#f3f5fa', dark: '#0b0f19' };

export const THEMES: { id: ThemePref; label: 'theme.auto' | 'theme.light' | 'theme.dark' }[] = [
	{ id: 'auto', label: 'theme.auto' },
	{ id: 'light', label: 'theme.light' },
	{ id: 'dark', label: 'theme.dark' },
];

/** 'auto' follows the system setting */
export function resolveTheme(pref: ThemePref, systemLight: boolean): 'light' | 'dark' {
	return pref === 'auto' ? (systemLight ? 'light' : 'dark') : pref;
}

export function loadTheme(): ThemePref {
	try {
		const v = localStorage.getItem(KEY);
		return v === 'light' || v === 'dark' ? v : 'auto';
	} catch {
		return 'auto';
	}
}

const systemQuery = () => window.matchMedia('(prefers-color-scheme: light)');

function apply(pref: ThemePref) {
	const theme = resolveTheme(pref, systemQuery().matches);
	document.documentElement.dataset.theme = theme;
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme]);
}

export function setTheme(pref: ThemePref) {
	try {
		if (pref === 'auto') localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, pref);
	} catch {
		/* private mode: the choice just lasts for this session */
	}
	apply(pref);
}

/** applies the saved choice and follows system changes while on 'auto' */
export function initTheme() {
	apply(loadTheme());
	systemQuery().addEventListener('change', () => {
		if (loadTheme() === 'auto') apply('auto');
	});
}
