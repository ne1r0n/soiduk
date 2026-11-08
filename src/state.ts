import type { StopDepartures } from './api.ts';
import { clearArrivalCache, type GoalCfg, type LocationCfg } from './plan.ts';
import { type Config, load, loadSelection, save } from './store.ts';
import type { GtfsIndex } from './trip.ts';
import { routeSort } from './util.ts';
import { loadWatch, type Watch } from './watch.ts';

/** The single mutable application state; modules read and update it directly. */
export const state = {
	cfg: load() as Config,
	view: 'dash' as 'dash' | 'edit' | 'start',
	/** latest departures per stop (SiriID) */
	data: new Map<number, StopDepartures>(),
	fetchedAt: 0,
	failed: new Set<number>(),
	/** stops whose live feed was empty, so the timetable is shown instead */
	planned: new Set<number>(),
	loading: false,
	lastOk: true,
	/** which goal is selected per location ('' = all departures) */
	selection: loadSelection(),
	/** timetable (GTFS), loaded lazily */
	gtfs: null as GtfsIndex | null,
	gtfsState: 'idle' as 'idle' | 'loading' | 'error',
	watch: loadWatch() as Watch | null,
};
/** UI state of the settings screen (not persisted: it always opens on «Места» with the first location expanded) */
export const edit = {
	tab: 'places' as 'places' | 'app',
	/** id of the expanded location, '' = all collapsed */
	openLoc: state.cfg.locations[0]?.id ?? '',
	/** expanded stops, keyed `${locId}:${siriId}` */
	openStops: new Set<string>(),
};
export const stopKey = (locId: string, siriId: number) => `${locId}:${siriId}`;

state.view = state.cfg.locations.length ? 'dash' : 'start';

/** routes seen live at a stop – used for chips in the editor */
export const knownRoutes = new Map<number, string[]>();
/** destinations seen live at a stop, most frequent first – tells you which way it goes */
export const knownDests = new Map<number, string[]>();

export function remember(id: number, d: StopDepartures) {
	knownRoutes.set(id, [...new Set(d.items.map((i) => i.route))].sort(routeSort));
	const cnt = new Map<string, number>();
	for (const i of d.items) cnt.set(i.dest, (cnt.get(i.dest) ?? 0) + 1);
	knownDests.set(
		id,
		[...cnt].sort((a, b) => b[1] - a[1]).map((x) => x[0]),
	);
}

/** undefined = show all departures */
export function selectedGoal(loc: LocationCfg): GoalCfg | undefined {
	const goals = loc.goals ?? [];
	const id = state.selection[loc.id];
	if (id === '') return undefined;
	return goals.find((g) => g.id === id) ?? (id === undefined ? goals[0] : undefined);
}

// Rendering is registered by main.ts, so state-level code can trigger it without import cycles.
let renderer: () => void = () => {};
export const setRenderer = (fn: () => void) => {
	renderer = fn;
};
export const render = () => renderer();

let renderTimer = 0;
export function scheduleRender() {
	clearTimeout(renderTimer);
	renderTimer = window.setTimeout(render, 150);
}

/** saves the settings and refreshes the view */
export function persist(rerender = true) {
	save(state.cfg);
	clearArrivalCache();
	if (rerender) render();
}
