import { t } from './i18n.ts';
import type { LocationCfg } from './plan.ts';

const KEY = 'ttransport.config.v1';

export interface Config {
	locations: LocationCfg[];
}

export function load(): Config {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) return sanitize(JSON.parse(raw));
	} catch {
		/* ignore broken storage */
	}
	return { locations: [] };
}

/** while the demo is shown nothing is written: the visitor's own settings stay untouched */
let demoMode = false;
export const inDemo = () => demoMode;
export const setDemo = (on: boolean) => {
	demoMode = on;
};

export function save(cfg: Config): void {
	if (demoMode) return;
	localStorage.setItem(KEY, JSON.stringify(cfg));
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** a finite number, or undefined for null/garbage */
const num = (v: unknown): number | undefined =>
	v != null && Number.isFinite(Number(v)) ? Number(v) : undefined;
const str = (v: unknown): string | undefined => (v ? String(v) : undefined);

export function sanitize(x: unknown): Config {
	const locs = obj(x).locations;
	if (!Array.isArray(locs)) throw new Error(t('err.config'));
	return {
		locations: locs.map((raw, i) => {
			const l = obj(raw);
			const walkMin = Math.max(0, Number(l.walkMin) || 0);
			return {
				id: String(l.id ?? `loc${i}`),
				name: String(l.name ?? t('def.loc')),
				walkMin,
				stops: arr(l.stops)
					.map((raw) => {
						const s = obj(raw);
						return {
							siriId: Number(s.siriId),
							name: String(s.name ?? ''),
							code: str(s.code),
							walkMin: Math.max(0, num(s.walkMin) ?? walkMin),
							label: str(s.label),
							routes: arr(s.routes).map(String),
							la: num(s.la),
							lo: num(s.lo),
							area: str(s.area),
						};
					})
					.filter((s) => Number.isFinite(s.siriId)),
				goals: arr(l.goals).map((raw, j) => {
					const g = obj(raw);
					return {
						id: String(g.id ?? `g${i}_${j}`),
						name: String(g.name ?? t('def.goal')),
						stops: arr(g.stops)
							.map((raw) => {
								const x = obj(raw);
								return {
									code: String(x.code),
									name: String(x.name ?? ''),
									pref: x.pref ? true : undefined,
								};
							})
							.filter((x) => x.code),
					};
				}),
			};
		}),
	};
}

export const uid = () => Math.random().toString(36).slice(2, 9);

const UI_KEY = 'ttransport.ui.v1';
/** which goal is selected per location ('' = all departures) */
export function loadSelection(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}');
	} catch {
		return {};
	}
}
export function saveSelection(sel: Record<string, string>): void {
	if (demoMode) return;
	localStorage.setItem(UI_KEY, JSON.stringify(sel));
}

const PREV_KEY = 'ttransport.config.prev';
/** the settings that were replaced by the last import – lets you undo an accidental overwrite */
export function savePrev(cfg: Config): void {
	localStorage.setItem(PREV_KEY, JSON.stringify(cfg));
}
export function loadPrev(): Config | null {
	try {
		const raw = localStorage.getItem(PREV_KEY);
		const c = raw ? sanitize(JSON.parse(raw)) : null;
		return c?.locations.length ? c : null;
	} catch {
		return null;
	}
}
