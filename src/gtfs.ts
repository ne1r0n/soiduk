import { loadData } from './datafiles.ts';
import type { RawGtfs } from './gtfsPack.ts';
import { clearArrivalCache, type StopCfg } from './plan.ts';
import { knownDests, knownRoutes, render, state } from './state.ts';
import { buildIndex, stopOverview } from './trip.ts';
import { routeSort } from './util.ts';

let gtfsPromise: Promise<void> | null = null;
let retryAt = 0;

/** loads the timetable once; resolves when it is ready (or failed – see state.gtfsState) */
export function ensureGtfs(): Promise<void> {
	if (gtfsPromise) return gtfsPromise;
	if (Date.now() < retryAt) return Promise.resolve();
	state.gtfsState = 'loading';
	gtfsPromise = loadData<RawGtfs>('gtfs')
		.then((raw) => {
			state.gtfs = buildIndex(raw);
			state.gtfsState = 'idle';
			clearArrivalCache();
			render();
		})
		.catch(() => {
			gtfsPromise = null;
			retryAt = Date.now() + 20_000;
			state.gtfsState = 'error';
			render();
		});
	return gtfsPromise;
}

/** routes/destinations of a stop: live feed first, timetable when the feed has nothing */
export function stopInfo(stop: StopCfg): { routes: string[]; dests: string[]; planned: boolean } {
	const routes = knownRoutes.get(stop.siriId) ?? [];
	const dests = knownDests.get(stop.siriId) ?? [];
	if (routes.length || !stop.code) return { routes, dests, planned: false };
	if (!state.gtfs) {
		ensureGtfs();
		return { routes, dests, planned: false };
	}
	const o = stopOverview(state.gtfs, stop.code);
	return { routes: o.routes.sort(routeSort), dests: o.dests, planned: true };
}
