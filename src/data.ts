import { batches, fetchDepartures, type StopDepartures } from './api.ts';
import { ensureGtfs } from './gtfs.ts';
import { updateLive } from './live.ts';
import { ageArrivalCache, clearArrivalCache, type StopCfg } from './plan.ts';
import { remember, render, state } from './state.ts';
import { loadStops } from './stops.ts';
import { save } from './store.ts';
import { scheduledDepartures, tallinnSec } from './trip.ts';

let afterRefresh: () => void = () => {};
/** hook called after every successful refresh cycle (used by the notification watcher) */
export const setAfterRefresh = (fn: () => void) => {
	afterRefresh = fn;
};

/** In the background only the pinned stop needs live data. */
function stopIds(): number[] {
	const all = [...new Set(state.cfg.locations.flatMap((l) => l.stops.map((s) => s.siriId)))];
	if (!document.hidden) return all;
	const watch = state.watch;
	if (!watch || watch.until <= Date.now()) return [];
	const id = Number(watch.pin.split('|')[0]);
	return all.includes(id) ? [id] : [];
}

/** stops of the refresh that is under way */
let fetching = '';
/** the stops changed while a refresh was under way: fetch again as soon as it is done */
let again = false;
/** when the last refresh started, and for which stops */
let lastAttempt = 0;
let lastRequested = '';
/** a return to the screen this soon after a refresh shows what is already there */
const FRESH_MS = 10_000;

/** A refresh on returning to the screen: not needed when the same stops were asked for a moment ago. */
export function refreshIfDue() {
	const since = Date.now() - lastAttempt;
	if (stopIds().join() === lastRequested && since >= 0 && since < FRESH_MS) return;
	return refresh();
}

/** Fetches live departures; retains other stops in the same time frame during a narrow background refresh. */
export async function refresh() {
	const ids = stopIds();
	if (state.loading) {
		again = ids.join() !== fetching;
		return;
	}
	if (!ids.length) {
		// no stops at all (as opposed to a hidden page, which just waits): nothing can be wrong with them
		if (!document.hidden && !state.lastOk) {
			state.lastOk = true;
			updateLive();
		}
		afterRefresh(); // expires a background watch even when there is nothing to fetch
		return;
	}
	state.loading = true;
	fetching = ids.join();
	lastRequested = fetching;
	lastAttempt = Date.now();
	again = false;
	updateLive();
	const next = new Map<number, StopDepartures>();
	const bad = new Set(state.failed);
	const plan = new Set(state.planned);
	const configured = new Map(
		state.cfg.locations.flatMap((l) => l.stops).map((s) => [s.siriId, s.code]),
	);
	const received = new Map<number, { data: StopDepartures; at: number }>();
	const fallback = async (id: number, now: number): Promise<StopDepartures | undefined> => {
		const code = configured.get(id);
		if (!code) return;
		if (!state.gtfs) await ensureGtfs();
		if (!state.gtfs) return;
		try {
			const items = scheduledDepartures(state.gtfs, code, now).map((x) => ({
				mode: x.mode,
				route: x.route,
				expected: x.sec,
				scheduled: x.sec,
				dest: x.headsign,
			}));
			plan.add(id);
			return { now, items };
		} catch {
			return; // whatever is wrong with the timetable of one stop, the others get their departures
		}
	};
	try {
		await Promise.all(
			batches(ids).map(async (group) => {
				let live: Map<number, StopDepartures>;
				try {
					live = await fetchDepartures(group);
				} catch {
					await Promise.all(
						group.map(async (id) => {
							bad.add(id);
							// Keep an existing live prediction; on a cold offline launch use the cached timetable.
							if (state.data.has(id) && !state.planned.has(id)) return;
							const at = Date.now();
							const data = await fallback(id, tallinnSec(new Date(at)));
							if (data) received.set(id, { data, at });
						}),
					);
					return;
				}
				await Promise.all(
					group.map(async (id) => {
						const at = Date.now();
						let data = live.get(id)!;
						bad.delete(id);
						plan.delete(id);
						remember(id, data);
						if (!data.items.length) data = (await fallback(id, data.now)) ?? data;
						received.set(id, { data, at });
					}),
				);
			}),
		);
		const at = Date.now();
		for (const id of configured.keys()) {
			const fresh = received.get(id);
			const old = state.data.get(id);
			const data = fresh?.data ?? old;
			if (data)
				next.set(id, {
					now: data.now + (at - (fresh?.at ?? state.fetchedAt)) / 1000,
					items: data.items,
				});
		}
		state.data = next;
		state.failed = new Set([...bad].filter((id) => configured.has(id)));
		state.planned = new Set([...plan].filter((id) => configured.has(id)));
		state.fetchedAt = at;
		ageArrivalCache();
		state.lastOk = ids.some((id) => !bad.has(id));
	} finally {
		state.loading = false;
		updateLive();
		if (!document.hidden) render();
		afterRefresh();
	}
	if (again) return refresh();
}

/** fills in position / area / code for stops saved without them (older versions, shared links) */
export function backfill() {
	const incomplete = (st: StopCfg) => st.la === undefined || !st.code;
	// nothing to fill in – the usual case: don't download the list of stops on every launch
	if (!state.cfg.locations.some((l) => l.stops.some(incomplete))) return;
	loadStops()
		.then((all) => {
			const byId = new Map(all.map((x) => [x.s, x]));
			let changed = false;
			for (const st of state.cfg.locations.flatMap((l) => l.stops)) {
				const info = byId.get(st.siriId);
				if (info && incomplete(st)) {
					Object.assign(st, {
						code: info.id,
						la: info.la,
						lo: info.lo,
						area: info.ar || undefined,
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
