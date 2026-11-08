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

export function save(cfg: Config): void {
	localStorage.setItem(KEY, JSON.stringify(cfg));
}

export function sanitize(x: unknown): Config {
	const locs = (x as Config)?.locations;
	if (!Array.isArray(locs)) throw new Error('Неверный формат конфигурации');
	return {
		locations: locs.map((l, i) => ({
			id: String(l.id ?? `loc${i}`),
			name: String(l.name ?? 'Локация'),
			walkMin: Math.max(0, Number(l.walkMin) || 0),
			stops: (Array.isArray(l.stops) ? l.stops : [])
				.map((s: any) => ({
					siriId: Number(s.siriId),
					name: String(s.name ?? ''),
					code: s.code ? String(s.code) : undefined,
					walkMin:
						Number.isFinite(Number(s.walkMin)) && s.walkMin != null
							? Math.max(0, Number(s.walkMin))
							: Math.max(0, Number(l.walkMin) || 0),
					label: s.label ? String(s.label) : undefined,
					routes: Array.isArray(s.routes) ? s.routes.map(String) : [],
					la: Number.isFinite(Number(s.la)) && s.la != null ? Number(s.la) : undefined,
					lo: Number.isFinite(Number(s.lo)) && s.lo != null ? Number(s.lo) : undefined,
					area: s.area ? String(s.area) : undefined,
					nb: Array.isArray(s.nb) ? s.nb.map(String) : undefined,
				}))
				.filter((s: { siriId: number }) => Number.isFinite(s.siriId)),
			goals: (Array.isArray(l.goals) ? l.goals : []).map((g: any, j: number) => ({
				id: String(g.id ?? `g${i}_${j}`),
				name: String(g.name ?? 'Цель'),
				stops: (Array.isArray(g.stops) ? g.stops : [])
					.map((x: any) => ({
						code: String(x.code),
						name: String(x.name ?? ''),
						pref: x.pref ? true : undefined,
					}))
					.filter((x: { code: string }) => x.code),
			})),
		})),
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
		return c && c.locations.length ? c : null;
	} catch {
		return null;
	}
}
