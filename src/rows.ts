import { ensureGeo, nearStops, progress, stopNameByCode } from './geo.ts';
import { buildRows, type GoalCfg, type LocationCfg, type Row } from './plan.ts';
import { state } from './state.ts';

export const XFER = { near: nearStops, name: stopNameByCode, progress };

/**
 * Catchable departures of every stop of a location, soonest to leave first. Towards a goal, connections
 * with a change are included only if no stop has a direct trip – the same rule the dashboard uses.
 */
export function locationRows(loc: LocationCfg, goal: GoalCfg | undefined, elapsed: number): Row[] {
	const idx = state.gtfs;
	const build = (transfers: boolean) =>
		loc.stops.flatMap((s) =>
			buildRows(
				{ id: loc.id, name: loc.name, walkMin: s.walkMin ?? loc.walkMin, stops: [s] },
				state.data,
				elapsed,
				30,
				goal && idx ? { goal, idx, transfers: transfers ? XFER : undefined } : undefined,
			),
		);
	let rows = build(false);
	if (goal && idx && !rows.length) {
		ensureGeo();
		rows = build(true);
	}
	return rows.sort((a, b) => a.leaveInSec - b.leaveInSec);
}
