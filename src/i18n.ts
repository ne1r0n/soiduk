import { en } from './lang/en.ts';
import { et } from './lang/et.ts';
import { type Key, ru } from './lang/ru.ts';

export type Lang = 'ru' | 'en' | 'et';
export const LANGS: Lang[] = ['ru', 'en', 'et'];
/** each language written in itself */
export const LANG_NAMES: Record<Lang, string> = { ru: 'Русский', en: 'English', et: 'Eesti' };
export const DICT: Record<Lang, Record<Key, string>> = { ru, en, et };

const KEY = 'soiduk.lang';
let current: Lang = 'ru';
let chosen = false;

const isLang = (v: unknown): v is Lang => v === 'ru' || v === 'en' || v === 'et';

function storedLang(): Lang | null {
	try {
		const v = localStorage.getItem(KEY);
		return isLang(v) ? v : null;
	} catch {
		return null;
	}
}

/** the first language of the browser that we support, English otherwise */
export function detectLang(langs: readonly string[] = navigator.languages ?? [navigator.language]) {
	for (const l of langs) {
		const p = l.slice(0, 2).toLowerCase();
		if (isLang(p)) return p;
	}
	return 'en';
}

export const getLang = () => current;
/** false until the user has picked a language (the app then shows the welcome screen) */
export const langChosen = () => chosen;

/** labels of the static markup in index.html */
function applyStatic() {
	if (typeof document === 'undefined') return;
	document.documentElement.lang = current;
	for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-aria]'))
		el.setAttribute('aria-label', t(el.dataset.i18nAria as Key));
}

export function initLang() {
	const saved = storedLang();
	chosen = saved !== null;
	current = saved ?? detectLang();
	applyStatic();
}

export function setLang(l: Lang) {
	current = l;
	chosen = true;
	try {
		localStorage.setItem(KEY, l);
	} catch {
		/* private mode: the choice just lasts for this session */
	}
	applyStatic();
}

/** translates a key; `{name}` placeholders are filled from `params` */
export function t(key: Key, params?: Record<string, string | number>): string {
	const s = DICT[current][key];
	return params ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '')) : s;
}

const pluralRules = new Map<Lang, Intl.PluralRules>();

/** picks the word form for a count from a «one|few|many» entry */
export function plural(key: Key, n: number): string {
	const forms = t(key).split('|');
	let rules = pluralRules.get(current);
	if (!rules) {
		rules = new Intl.PluralRules(current);
		pluralRules.set(current, rules);
	}
	const idx = { one: 0, few: 1 }[rules.select(n) as string] ?? 2;
	return forms[Math.min(idx, forms.length - 1)];
}

/** true if `name` is the default name `key` in any language (names are stored in the language they were created in) */
export const isDefaultName = (key: Key, name: string) => LANGS.some((l) => DICT[l][key] === name);
