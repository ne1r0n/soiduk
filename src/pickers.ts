import { fetchDepartures } from './api.ts';
import { ensureGtfs } from './gtfs.ts';
import { isDefaultName } from './i18n.ts';
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
import { loadStops } from './stops.ts';
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
	for (const id of ids) {
		if (knownDests.has(id) || peekPending.has(id)) continue;
		peekPending.add(id);
		fetchDepartures(id)
			.then((d) => remember(id, d))
			.catch(() => {})
			.finally(() => {
				peekPending.delete(id);
				refreshPicker();
				if (state.view === 'edit') scheduleRender();
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

export async function pickStop(loc: LocationCfg) {
	const everyStop = await loadStops();
	await ensureGtfs(); // directions come from the timetable when the live feed has nothing
	const all = inService(everyStop);
	const codeBySiri = new Map(all.map((s) => [s.s, s.id]));
	openPicker({
		all,
		goal: false,
		taken: new Set(loc.stops.map((s) => s.siriId)),
		center: centroid(loc.stops),
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
			loc.stops.push({
				siriId: info.s,
				code: info.id,
				name: info.n,
				walkMin: loc.stops.at(-1)?.walkMin ?? loc.walkMin,
				routes: [],
				la: info.la,
				lo: info.lo,
				area: info.ar || undefined,
				nb: info.nb,
			});
			fetchDepartures(info.s)
				.then((d) => {
					remember(info.s, d);
					if (state.view === 'edit') render();
				})
				.catch(() => {});
			edit.openStops.add(stopKey(loc.id, info.s)); // pick the routes right away
			persist();
		},
	});
}

export async function pickGoalStop(loc: LocationCfg, goal: GoalCfg) {
	const everyStop = await loadStops();
	await ensureGtfs(); // routes at a stop help choosing the right side / the right stop
	const goalStops = everyStop.filter((s) => goal.stops.some((g) => g.code === s.id));
	openPicker({
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
