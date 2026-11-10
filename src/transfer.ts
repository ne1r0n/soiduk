/**
 * One-transfer journeys: «route A to some stop X, then route B (from X or a stop a short walk away) to the goal».
 * Used only when no single route reaches the goal. The first leg is the live departure (its delay shifts
 * the arrival at X); the second leg is taken from the timetable.
 */

import type { Vehicle } from './gtfsPack.ts';
import {
	type GtfsIndex,
	MATCH_TOLERANCE_SEC,
	positions,
	serviceActive,
	stopsOf,
	tallinnDate,
} from './trip.ts';
import { getOrCreate } from './util.ts';

/** a stop reachable on foot from another one */
export interface Near {
	code: string;
	walkSec: number;
}

export interface Transfer {
	/** stop where the first vehicle is left (as the first leg reports it) */
	viaCode: string;
	walkSec: number;
	route: string;
	mode: Vehicle;
	headsign: string;
	/** departure of the second vehicle, seconds in the frame of the live schedule */
	depSec: number;
	toCode: string;
	/** scheduled arrival at the goal stop */
	sec: number;
	/** where the legs are in the timetable: pattern, boarding index, alighting index – for both rides */
	legs: [{ p: number; i: number; j: number }, { p: number; i: number; j: number } | null];
	/** no second vehicle: from `viaCode` the goal stop `toCode` is reached on foot (`walkSec`) */
	walkOnly?: boolean;
}

/** if walking from the first vehicle to the goal costs at most this much more than the second ride, walk */
const WALK_SLACK_SEC = 180;

/** minimum time to change vehicles at the same stop / after a walk */
const MIN_CHANGE_SEC = 120;
const MIN_CHANGE_AFTER_WALK_SEC = 60;
/** a longer wait than this is not a sensible connection */
const MAX_WAIT_SEC = 25 * 60;

interface Feeder {
	p: number;
	i: number;
	j: number;
}

/** per goal: for every stop list, where a rider boarding at each position gets off (-1: never reaches the goal) */
interface Feed {
	alight: number[][];
	/** stopCode -> boarding positions from which a trip reaches the goal without changing */
	at: Map<string, Feeder[]>;
}

const feedCache = new WeakMap<GtfsIndex, Map<string, Feed>>();

function feedOf(
	idx: GtfsIndex,
	goalCodes: ReadonlySet<string>,
	preferred?: ReadonlySet<string>,
): Feed {
	const key = `${[...goalCodes].sort().join(',')}|${[...(preferred ?? [])].sort().join(',')}`;
	const perIdx = feedCache.get(idx) ?? new Map<string, Feed>();
	feedCache.set(idx, perIdx);
	return getOrCreate(perIdx, key, () => ({
		alight: idx.seqs.map((codes) => {
			const out: number[] = new Array(codes.length);
			let nextGoal = -1;
			let nextPref = -1;
			for (let k = codes.length - 1; k >= 0; k--) {
				out[k] = nextPref >= 0 ? nextPref : nextGoal;
				if (goalCodes.has(codes[k])) nextGoal = k;
				if (preferred?.has(codes[k])) nextPref = k;
			}
			return out;
		}),
		at: new Map(),
	}));
}

/**
 * Boarding positions at `code` from which a trip reaches the goal without changing – in pattern order, the
 * later position first where a pattern calls at the stop twice. Worked out per stop, on first request.
 */
function feeders(idx: GtfsIndex, feed: Feed, code: string): Feeder[] {
	return getOrCreate(feed.at, code, () => {
		const out: Feeder[] = [];
		for (const { q, i } of idx.occurs.get(code) ?? []) {
			const j = feed.alight[q][i];
			if (j >= 0) for (const p of idx.patsOfSeq[q]) out.push({ p, i, j });
		}
		return out.sort((a, b) => a.p - b.p || b.i - a.i);
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
	/** false for changing stops that lead away from the goal */
	viaOk: (code: string) => boolean = () => true,
): Transfer | null {
	const cands = positions(idx, route, fromCode);
	if (!cands.length) return null;
	const feed = feedOf(idx, goalCodes, preferred);
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
	let bestWalk: Transfer | null = null;
	for (const { date, t } of first) {
		for (const { p, i } of cands) {
			const pat = idx.pats[p];
			const stops = stopsOf(idx, p);
			let matched = false;
			for (let n = 0; n < pat.t.length && !matched; n += 2) {
				matched =
					Math.abs(pat.t[n] + pat.o[i] - t) <= MATCH_TOLERANCE_SEC &&
					serviceActive(idx.services[pat.t[n + 1]], date);
			}
			if (!matched) continue;
			for (let k = i + 1; k < stops.length; k++) {
				const arrive = schedSec + (pat.o[k] - pat.o[i]) + delaySec;
				const via = stops[k];
				if (!viaOk(via)) continue;
				const options: Near[] = [{ code: via, walkSec: 0 }, ...near(via)];
				// a goal stop within walking distance: no need to change for the sake of one more stop
				for (const o of options) {
					if (o.walkSec === 0 || !goalCodes.has(o.code)) continue;
					const sec = arrive + o.walkSec;
					if (bestWalk && sec >= bestWalk.sec) continue;
					bestWalk = {
						viaCode: via,
						walkSec: o.walkSec,
						route: '',
						mode: 'bus',
						headsign: '',
						depSec: sec,
						toCode: o.code,
						sec,
						legs: [{ p, i, j: k }, null],
						walkOnly: true,
					};
				}
				for (const { code, walkSec } of options) {
					const ready = arrive + walkSec + (walkSec ? MIN_CHANGE_AFTER_WALK_SEC : MIN_CHANGE_SEC);
					for (const f of feeders(idx, feed, code)) {
						const p2 = idx.pats[f.p];
						for (let n = 0; n < p2.t.length; n += 2) {
							const start = p2.t[n];
							for (const { date: d2, off } of second) {
								const dep = start + p2.o[f.i] - off;
								if (dep < ready || dep > ready + MAX_WAIT_SEC) continue;
								const sec = start + p2.o[f.j] - off;
								if (best && sec >= best.sec) continue;
								if (!serviceActive(idx.services[p2.t[n + 1]], d2)) continue;
								best = {
									viaCode: via,
									walkSec,
									route: p2.r,
									mode: p2.m,
									headsign: p2.h,
									depSec: dep,
									toCode: stopsOf(idx, f.p)[f.j],
									sec,
									legs: [
										{ p, i, j: k },
										{ p: f.p, i: f.i, j: f.j },
									],
								};
							}
						}
					}
				}
			}
		}
		if (best || bestWalk) break;
	}
	const ride = best as Transfer | null;
	const walk = bestWalk as Transfer | null;
	if (walk && (!ride || walk.sec <= ride.sec + WALK_SLACK_SEC)) return walk;
	return ride;
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
