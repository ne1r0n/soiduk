/**
 * One-transfer journeys: «route A to some stop X, then route B (from X or a stop a short walk away) to the goal».
 * Used only when no single route reaches the goal. The first leg is the live departure (its delay shifts
 * the arrival at X); the second leg is taken from the timetable.
 */

import { type GtfsIndex, MATCH_TOLERANCE_SEC, serviceActive, tallinnDate } from './trip.ts';
import { getOrCreate } from './util.ts';

/** a stop reachable on foot from another one */
export interface Near {
	code: string;
	walkSec: number;
}

export interface Transfer {
	/** stop where the first vehicle is left (as the first leg reports it) */
	viaCode: string;
	/** stop where the second vehicle is boarded (viaCode itself or a neighbour) */
	boardCode: string;
	walkSec: number;
	route: string;
	mode: 'bus' | 'trol' | 'tram';
	headsign: string;
	/** departure of the second vehicle, seconds in the frame of the live schedule */
	depSec: number;
	toCode: string;
	/** scheduled arrival at the goal stop */
	sec: number;
}

/** minimum time to change vehicles at the same stop / after a walk */
export const MIN_CHANGE_SEC = 120;
export const MIN_CHANGE_AFTER_WALK_SEC = 60;
/** a longer wait than this is not a sensible connection */
export const MAX_WAIT_SEC = 40 * 60;

interface Feeder {
	p: number;
	i: number;
	j: number;
}

const feederCache = new WeakMap<GtfsIndex, Map<string, Map<string, Feeder[]>>>();

/** stopCode -> boarding positions from which a trip reaches the goal without changing */
function feeders(
	idx: GtfsIndex,
	goalCodes: ReadonlySet<string>,
	preferred?: ReadonlySet<string>,
): Map<string, Feeder[]> {
	const key = `${[...goalCodes].sort().join(',')}|${[...(preferred ?? [])].sort().join(',')}`;
	const perIdx = feederCache.get(idx) ?? new Map<string, Map<string, Feeder[]>>();
	feederCache.set(idx, perIdx);
	return getOrCreate(perIdx, key, () => {
		const out = new Map<string, Feeder[]>();
		idx.raw.patterns.forEach((pat, p) => {
			let nextGoal = -1;
			let nextPref = -1;
			for (let k = pat.s.length - 1; k >= 0; k--) {
				const j = nextPref >= 0 ? nextPref : nextGoal;
				if (j >= 0) getOrCreate(out, pat.s[k], () => []).push({ p, i: k, j });
				if (goalCodes.has(pat.s[k])) nextGoal = k;
				if (preferred?.has(pat.s[k])) nextPref = k;
			}
		});
		return out;
	});
}

/**
 * @param schedSec scheduled departure of the first leg from `fromCode` (live frame, seconds from Tallinn midnight)
 * @param delaySec how late the first vehicle runs
 * @returns the connection that reaches the goal earliest, or null
 */
export function findTransfer(
	idx: GtfsIndex,
	route: string,
	fromCode: string,
	schedSec: number,
	delaySec: number,
	goalCodes: ReadonlySet<string>,
	near: (code: string) => Near[],
	now = new Date(),
	preferred?: ReadonlySet<string>,
): Transfer | null {
	const cands = idx.byRouteStop.get(`${route}|${fromCode}`);
	if (!cands) return null;
	const feed = feeders(idx, goalCodes, preferred);
	const first = [
		{ date: tallinnDate(now, 0), t: schedSec },
		{ date: tallinnDate(now, -1), t: schedSec + 86400 },
	];
	// service days of the second leg: its times are shifted into the live frame by `off`
	const second = [
		{ date: tallinnDate(now, 0), off: 0 },
		{ date: tallinnDate(now, -1), off: 86400 },
		{ date: tallinnDate(now, 1), off: -86400 },
	];
	let best: Transfer | null = null;
	for (const { date, t } of first) {
		for (const { p, i } of cands) {
			const pat = idx.raw.patterns[p];
			const matched = (idx.tripsByPattern.get(p) ?? []).some(
				([start, svc]) =>
					Math.abs(start + pat.o[i] - t) <= MATCH_TOLERANCE_SEC &&
					serviceActive(idx.raw.services[svc], date),
			);
			if (!matched) continue;
			for (let k = i + 1; k < pat.s.length; k++) {
				const arrive = schedSec + (pat.o[k] - pat.o[i]) + delaySec;
				const via = pat.s[k];
				const options: Near[] = [{ code: via, walkSec: 0 }, ...near(via)];
				for (const { code, walkSec } of options) {
					const ready = arrive + walkSec + (walkSec ? MIN_CHANGE_AFTER_WALK_SEC : MIN_CHANGE_SEC);
					for (const f of feed.get(code) ?? []) {
						const p2 = idx.raw.patterns[f.p];
						for (const [start, svc] of idx.tripsByPattern.get(f.p) ?? []) {
							for (const { date: d2, off } of second) {
								const dep = start + p2.o[f.i] - off;
								if (dep < ready || dep > ready + MAX_WAIT_SEC) continue;
								const sec = start + p2.o[f.j] - off;
								if (best && sec >= best.sec) continue;
								if (!serviceActive(idx.raw.services[svc], d2)) continue;
								best = {
									viaCode: via,
									boardCode: code,
									walkSec,
									route: p2.r,
									mode: p2.m ?? 'bus',
									headsign: p2.h,
									depSec: dep,
									toCode: p2.s[f.j],
									sec,
								};
							}
						}
					}
				}
			}
		}
		if (best) break;
	}
	return best;
}

/** builds the «stops within walking distance» lookup from stop coordinates (grid of ~0.003° cells) */
export function makeNear(
	stops: { id: string; la: number; lo: number }[],
	distance: (aLa: number, aLo: number, bLa: number, bLo: number) => number,
	maxM = 250,
	speedMps = 1.2,
): (code: string) => Near[] {
	// at 59°N 0.003° of latitude ≈ 330 m and 0.006° of longitude ≈ 340 m
	const CLA = 0.003;
	const CLO = 0.006;
	const cell = (la: number, lo: number) => `${Math.floor(la / CLA)}:${Math.floor(lo / CLO)}`;
	const grid = new Map<string, typeof stops>();
	for (const s of stops) getOrCreate(grid, cell(s.la, s.lo), () => []).push(s);
	const byCode = new Map(stops.map((s) => [s.id, s]));
	const memo = new Map<string, Near[]>();
	return (code) =>
		getOrCreate(memo, code, () => {
			const s = byCode.get(code);
			if (!s) return [];
			const cx = Math.floor(s.la / CLA);
			const cy = Math.floor(s.lo / CLO);
			const out: Near[] = [];
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					for (const o of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
						if (o.id === code) continue;
						const m = distance(s.la, s.lo, o.la, o.lo);
						if (m <= maxM) out.push({ code: o.id, walkSec: Math.round(m / speedMps) });
					}
				}
			}
			return out;
		});
}
