import { ensureGeo, nearStops, progress, stopNameByCode } from './geo.ts';
import { buildRows, type GoalCfg, type LocationCfg, type Row } from './plan.ts';
import { state, walkMinOf } from './state.ts';

export const XFER = { near: nearStops, name: stopNameByCode, progress };

/**
 * Catchable departures of every stop of a location, soonest to leave first. Towards a goal, connections
 * with a change are included only if no stop has a direct trip – the same rule the dashboard uses.
 * A stop switched to «at the stop» has no walking time, so everything that has not left yet is catchable.
 */
export function locationRows(loc: LocationCfg, goal: GoalCfg | undefined, elapsed: number): Row[] {
	const idx = state.gtfs;
	const build = (transfers: boolean) =>
		loc.stops.flatMap((s) =>
			buildRows(
				{ id: loc.id, name: loc.name, walkMin: walkMinOf(loc, s), stops: [s] },
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
