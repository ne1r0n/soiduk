import { fetchDepartures, type StopDepartures } from './api.ts';
import { ensureGtfs } from './gtfs.ts';
import { updateLive } from './live.ts';
import { clearArrivalCache } from './plan.ts';
import { remember, render, state } from './state.ts';
import { loadStops } from './stops.ts';
import { save } from './store.ts';
import { scheduledDepartures } from './trip.ts';

let afterRefresh: () => void = () => {};
/** hook called after every successful refresh cycle (used by the notification watcher) */
export const setAfterRefresh = (fn: () => void) => {
	afterRefresh = fn;
};

/** Fetches live departures for every configured stop; falls back to the timetable per stop. */
export async function refresh() {
	if (state.loading) return;
	state.loading = true;
	updateLive();
	const stops = state.cfg.locations.flatMap((l) => l.stops);
	const ids = [...new Set(stops.map((s) => s.siriId))];
	const next = new Map<number, StopDepartures>();
	const bad = new Set<number>();
	const plan = new Set<number>();
	const codeOf = new Map(stops.map((s) => [s.siriId, s.code]));
	await Promise.all(
		ids.map(async (id) => {
			try {
				let d = await fetchDepartures(id);
				remember(id, d);
				// the live feed is empty (outage or no data): fall back to the timetable (today's calendar)
				const code = codeOf.get(id);
				if (!d.items.length && code) {
					await ensureGtfs();
					if (state.gtfs) {
						d = {
							now: d.now,
							items: scheduledDepartures(state.gtfs, code, d.now).map((x) => ({
								mode: x.mode,
								route: x.route,
								expected: x.sec,
								scheduled: x.sec,
								dest: x.headsign,
							})),
						};
						plan.add(id);
					}
				}
				next.set(id, d);
			} catch {
				bad.add(id);
				const old = state.data.get(id);
				if (old) {
					next.set(id, {
						now: old.now + (Date.now() - state.fetchedAt) / 1000,
						items: old.items,
					});
				}
			}
		}),
	);
	state.data = next;
	state.failed = bad;
	state.planned = plan;
	state.fetchedAt = Date.now();
	state.loading = false;
	clearArrivalCache();
	state.lastOk = bad.size < Math.max(ids.length, 1);
	updateLive();
	render();
	afterRefresh();
}

/** fills in position / area / code for stops saved without them (older versions, shared links) */
export function backfill() {
	loadStops()
		.then((all) => {
			const byId = new Map(all.map((x) => [x.s, x]));
			let changed = false;
			for (const st of state.cfg.locations.flatMap((l) => l.stops)) {
				const info = byId.get(st.siriId);
				if (info && (st.la === undefined || !st.code)) {
					Object.assign(st, {
						code: info.id,
						la: info.la,
						lo: info.lo,
						area: info.ar || undefined,
						nb: info.nb,
					});
					changed = true;
				}
			}
			if (changed) {
				save(state.cfg);
				clearArrivalCache();
				render();
			}
		})
		.catch(() => {});
}
