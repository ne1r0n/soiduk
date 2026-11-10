import { batches, fetchDepartures } from './api.ts';
import { ensureGtfs } from './gtfs.ts';
import { isDefaultName } from './i18n.ts';
import { loadMapLib } from './maps.ts';
import { openPicker, refreshPicker } from './picker.ts';
import type { GoalCfg, LocationCfg } from './plan.ts';
import {
	edit,
	knownDests,
	persist,
	remember,
	render,
	scheduleRender,
	state,
	stopKey,
} from './state.ts';
import { distanceM, loadStops, type StopInfo, stopCfg } from './stops.ts';
import { saveSelection } from './store.ts';
import { stopOverview } from './trip.ts';
import { routeSort } from './util.ts';

const peekPending = new Set<number>();

/**
 * stops.txt lists every stop ever defined, including temporary ones and stops without any service
 * (transport.tallinn.ee does not show them). Only stops that appear in the timetable are offered;
 * if the timetable could not be loaded we can't tell, so nothing is hidden.
 */
function inService<T extends { id: string }>(all: T[]): T[] {
	const served = state.gtfs?.routesByStop;
	return served ? all.filter((s) => served.has(s.id)) : all;
}

/** lazily load live info for stops shown in the picker */
function peek(ids: number[]) {
	const want = ids.filter((id) => !knownDests.has(id) && !peekPending.has(id));
	for (const group of batches(want)) {
		for (const id of group) peekPending.add(id);
		fetchDepartures(group)
			.then((live) => {
				for (const [id, d] of live) remember(id, d);
				// only when something was learned: redrawing after a failure would just ask again, in a loop
				refreshPicker();
				if (state.view === 'edit') scheduleRender();
			})
			.catch(() => {})
			.finally(() => {
				for (const id of group) peekPending.delete(id);
			});
	}
}

function centroid(pts: { la?: number; lo?: number }[]) {
	const p = pts.filter((x) => x.la !== undefined && x.lo !== undefined) as {
		la: number;
		lo: number;
	}[];
	return p.length
		? {
				la: p.reduce((a, b) => a + b.la, 0) / p.length,
				lo: p.reduce((a, b) => a + b.lo, 0) / p.length,
			}
		: undefined;
}

/** the nearest stop in service within this distance is offered first when the position is known */
const NEAR_M = 1500;

export interface PickStopOpts {
	/** the user's position: the map opens there with the nearest stop selected */
	near?: { la: number; lo: number };
	/** replaces the default «add to the location» */
	onPick?: (s: StopInfo) => void;
}

/** @returns false when a position was given but no stop is close to it (the map is not opened) */
export async function pickStop(loc: LocationCfg, o: PickStopOpts = {}): Promise<boolean> {
	loadMapLib().catch(() => {}); // the map script downloads while the stops and the timetable do
	const [everyStop] = await Promise.all([loadStops(), ensureGtfs()]);
	const all = inService(everyStop);
	let preselect: StopInfo | undefined;
	if (o.near) {
		const { la, lo } = o.near;
		let best = Infinity;
		for (const s of all) {
			const d = distanceM(la, lo, s.la, s.lo);
			if (d < best) {
				best = d;
				preselect = s;
			}
		}
		if (best > NEAR_M) return false;
	}
	const codeBySiri = new Map(all.map((s) => [s.s, s.id]));
	await openPicker({
		all,
		goal: false,
		taken: new Set(loc.stops.map((s) => s.siriId)),
		center: o.near ?? centroid(loc.stops),
		preselect,
		// the timetable answers at once; the live feed (loaded lazily) takes over when it has something
		dests: (id) => {
			const live = knownDests.get(id);
			if (live?.length) return live;
			const code = codeBySiri.get(id);
			const planned = code && state.gtfs ? stopOverview(state.gtfs, code).dests : [];
			return planned.length ? planned : live;
		},
		routesAt: (code) =>
			state.gtfs ? stopOverview(state.gtfs, code).routes.sort(routeSort) : undefined,
		peek,
		onPick: (info) => {
			if (o.onPick) return o.onPick(info);
			loc.stops.push(stopCfg(info, loc.stops.at(-1)?.walkMin ?? loc.walkMin));
			fetchDepartures([info.s])
				.then((live) => {
					for (const [id, d] of live) remember(id, d);
					if (state.view === 'edit') render();
				})
				.catch(() => {});
			edit.openStops.add(stopKey(loc.id, info.s)); // pick the routes right away
			persist();
		},
	});
	return true;
}

export async function pickGoalStop(loc: LocationCfg, goal: GoalCfg) {
	loadMapLib().catch(() => {});
	const [everyStop] = await Promise.all([loadStops(), ensureGtfs()]);
	const goalStops = everyStop.filter((s) => goal.stops.some((g) => g.code === s.id));
	await openPicker({
		all: inService(everyStop),
		goal: true,
		taken: new Set(goalStops.map((s) => s.s)),
		center: centroid(goalStops),
		dests: () => undefined,
		peek: () => {},
		routesAt: (code) => {
			const r = state.gtfs?.routesByStop.get(code);
			return r && [...r].sort(routeSort);
		},
		onPick: (info) => {
			if (!goal.stops.some((g) => g.code === info.id))
				goal.stops.push({ code: info.id, name: info.n });
			if (isDefaultName('def.newGoal', goal.name)) goal.name = info.n;
			state.selection[loc.id] = goal.id;
			saveSelection(state.selection);
			persist();
		},
	});
}
