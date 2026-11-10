/** What a tapped departure looks like on a map: the stops of each ride (and the walk between them). */

import type { GoalCfg, Row } from './plan.ts';
import { findTransfer, type Near } from './transfer.ts';
import { findArrival, findBoarding, type GtfsIndex, stopsOf } from './trip.ts';

export interface Leg {
	route: string;
	mode: 'bus' | 'trol' | 'tram';
	/** stop codes from boarding to alighting */
	codes: string[];
	/** the ride in the timetable: pattern, boarding index, alighting index */
	p: number;
	i: number;
	j: number;
}

export interface Journey {
	legs: Leg[];
	/** the second ride starts at a neighbouring stop: walk from the last stop of leg 1 to the first of leg 2 */
	walkSec: number;
	/** the connection ends on foot: the goal stop to walk to from the last stop of the only ride */
	walkTo?: string;
}

const leg = (idx: GtfsIndex, p: number, i: number, j?: number): Leg => {
	const pat = idx.pats[p];
	const stops = stopsOf(idx, p);
	const to = j ?? stops.length - 1;
	return { route: pat.r, mode: pat.m, codes: stops.slice(i, to + 1), p, i, j: to };
};

/**
 * Rebuilds the timetable path of a departure row.
 * Without a goal: the rest of the route. Towards a goal: the ride to it, or both rides of a connection.
 */
export function journeyOf(
	idx: GtfsIndex,
	row: Row,
	goal: GoalCfg | undefined,
	near: (code: string) => Near[],
	now = new Date(),
): Journey | null {
	const from = row.code;
	if (!from) return null;
	const { route, scheduled, expected } = row.dep;
	if (goal && row.arrive) {
		const goals = new Set(goal.stops.map((s) => s.code));
		const preferred = new Set(goal.stops.filter((s) => s.pref).map((s) => s.code));
		if (row.arrive.via) {
			const x = findTransfer(
				idx,
				route,
				from,
				scheduled,
				expected - scheduled,
				goals,
				near,
				now,
				preferred,
			);
			if (!x) return null;
			const [a, b] = x.legs;
			if (!b) {
				return { legs: [leg(idx, a.p, a.i, a.j)], walkSec: x.walkSec, walkTo: x.toCode };
			}
			return {
				legs: [leg(idx, a.p, a.i, a.j), leg(idx, b.p, b.i, b.j)],
				walkSec: x.walkSec,
			};
		}
		const a = findArrival(idx, route, from, scheduled, goals, now, preferred);
		return a && { legs: [leg(idx, a.p, a.i, a.j)], walkSec: 0 };
	}
	const b = findBoarding(idx, route, from, scheduled, now);
	return b && { legs: [leg(idx, b.p, b.i)], walkSec: 0 };
}
