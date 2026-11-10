/**
 * Answers "if I board the trip that leaves stop A at time T on route R,
 * when does it reach one of the goal stops?" using the compact timetable
 * produced by scripts/build-gtfs.mjs (see gtfsPack.ts for its format).
 */

import type { RawGtfs, Service, Vehicle } from './gtfsPack.ts';
import { getOrCreate } from './util.ts';

/** A route variant with running times of its own; most trips have a pattern to themselves. */
export interface Pattern {
	r: string;
	m: Vehicle;
	h: string;
	/** its list of stops: index into GtfsIndex.seqs */
	q: number;
	/** seconds from the trip's start to each stop */
	o: number[];
	/** its trips, sorted by start: start, service, start, service, … */
	t: number[];
}

export interface GtfsIndex {
	services: Service[];
	/** the distinct lists of stops (stop codes); patterns share them */
	seqs: string[][];
	pats: Pattern[];
	/** stopCode -> routes that serve it */
	routesByStop: Map<string, Set<string>>;
	/** stopCode -> the stop lists it is on, and where */
	occurs: Map<string, { q: number; i: number }[]>;
	/** stop list -> its patterns, ascending */
	patsOfSeq: number[][];
	/** `positions` already asked for */
	asked: Map<string, { p: number; i: number }[]>;
}

export interface Arrival {
	toCode: string;
	/** scheduled arrival, seconds from service-day midnight (may exceed 86400) */
	sec: number;
	headsign: string;
	/** the ride in the timetable: pattern, boarding index, alighting index */
	p: number;
	i: number;
	j: number;
}

export function buildIndex(raw: RawGtfs): GtfsIndex {
	const seqs = raw.seqs.map((seq) => seq.map((s) => raw.stops[s]));
	const occurs = new Map<string, { q: number; i: number }[]>();
	seqs.forEach((codes, q) => {
		codes.forEach((code, i) => {
			getOrCreate(occurs, code, () => []).push({ q, i });
		});
	});
	const routesByStop = new Map<string, Set<string>>();
	const patsOfSeq: number[][] = seqs.map(() => []);
	const served = new Set<string>();
	const pats = raw.pats.map(([route, head, q, gaps, trips], p): Pattern => {
		const [r, m] = raw.routes[route];
		// the first pattern of a route on a stop list puts the route on every stop of the list
		if (!served.has(`${r}|${q}`)) {
			served.add(`${r}|${q}`);
			for (const code of seqs[q]) getOrCreate(routesByStop, code, () => new Set<string>()).add(r);
		}
		patsOfSeq[q].push(p);
		const o: number[] = [];
		let sec = 0;
		for (const gap of gaps) {
			sec += gap;
			o.push(sec);
		}
		const t: number[] = [];
		let start = 0;
		for (let k = 0; k < trips.length; k += 2) {
			start += trips[k];
			t.push(start, trips[k + 1]);
		}
		return { r, m, h: raw.heads[head], q, o, t };
	});
	return { services: raw.services, seqs, pats, routesByStop, occurs, patsOfSeq, asked: new Map() };
}

/** the stops of a pattern, as stop codes */
export const stopsOf = (idx: GtfsIndex, p: number): string[] => idx.seqs[idx.pats[p].q];

/**
 * Where a stop is inside the patterns of a route, in pattern order. Worked out on first request: an app with
 * a handful of stops never needs most of the ~180 000 combinations.
 */
export function positions(idx: GtfsIndex, route: string, code: string): { p: number; i: number }[] {
	return getOrCreate(idx.asked, `${route}|${code}`, () => {
		const out: { p: number; i: number }[] = [];
		for (const { q, i } of idx.occurs.get(code) ?? []) {
			for (const p of idx.patsOfSeq[q]) if (idx.pats[p].r === route) out.push({ p, i });
		}
		return out.sort((a, b) => a.p - b.p || a.i - b.i);
	});
}

// Creating a formatter costs about as much as looking up a whole departure, and these two are needed for
// every departure on every refresh: each is made once, on first use.
let dayFmt: Intl.DateTimeFormat | undefined;
let timeFmt: Intl.DateTimeFormat | undefined;

/** yyyymmdd + weekday (0=Sunday) of a moment in Europe/Tallinn, optionally shifted by whole days */
export function tallinnDate(now = new Date(), shiftDays = 0): { ymd: string; dow: number } {
	dayFmt ??= new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Tallinn',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});
	const parts = dayFmt.format(now).split('-').map(Number);
	const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + shiftDays));
	const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
	return { ymd, dow: d.getUTCDay() };
}

export function serviceActive(s: Service, date: { ymd: string; dow: number }): boolean {
	if (s.y.includes(date.ymd)) return false;
	if (s.x.includes(date.ymd)) return true;
	return s.d[date.dow] === '1' && s.a <= date.ymd && date.ymd <= s.b;
}

export interface PlannedDeparture {
	route: string;
	mode: Vehicle;
	headsign: string;
	sec: number;
}

type Overview = { routes: string[]; dests: string[] };
/** what `stopOverview` has worked out, per timetable: the picker asks for the same stops again and again */
const overviews = new WeakMap<GtfsIndex, Map<string, Overview>>();

/** Routes and destinations (most frequent first) of vehicles that depart from a stop, per the timetable */
export function stopOverview(idx: GtfsIndex, code: string): Overview {
	let cache = overviews.get(idx);
	if (!cache) {
		cache = new Map();
		overviews.set(idx, cache);
	}
	const known = cache.get(code);
	if (known) return known;
	const routes = new Set<string>();
	const cnt = new Map<string, number>();
	for (const route of idx.routesByStop.get(code) ?? []) {
		for (const { p, i } of positions(idx, route, code)) {
			const pat = idx.pats[p];
			if (i >= pat.o.length - 1) continue; // terminus: nothing departs from here
			routes.add(route);
			cnt.set(pat.h, (cnt.get(pat.h) ?? 0) + pat.t.length / 2);
		}
	}
	const result = {
		routes: [...routes],
		dests: [...cnt].sort((a, b) => b[1] - a[1]).map((x) => x[0]),
	};
	cache.set(code, result);
	return result;
}

/**
 * Timetable departures from a stop in the window [nowSec - backSec, nowSec + horizonSec]
 * (seconds from Tallinn midnight). Used when the live feed has nothing for the stop.
 * Weekday/weekend/holiday calendars are respected via serviceActive.
 */
export function scheduledDepartures(
	idx: GtfsIndex,
	code: string,
	nowSec: number,
	now = new Date(),
	horizonSec = 2 * 3600,
	backSec = 60,
): PlannedDeparture[] {
	const out: PlannedDeparture[] = [];
	// service days whose trips can fall into the window: yesterday (after-midnight times), today, tomorrow
	const days = [-1, 0, 1].map((d) => ({ date: tallinnDate(now, d), shift: d * 86400 }));
	for (const route of idx.routesByStop.get(code) ?? []) {
		for (const { p, i } of positions(idx, route, code)) {
			const pat = idx.pats[p];
			if (i >= pat.o.length - 1) continue; // last stop: vehicles only arrive there
			for (let k = 0; k < pat.t.length; k += 2) {
				for (const { date, shift } of days) {
					const sec = pat.t[k] + pat.o[i] + shift;
					if (sec < nowSec - backSec || sec > nowSec + horizonSec) continue;
					if (serviceActive(idx.services[pat.t[k + 1]], date))
						out.push({ route, mode: pat.m, headsign: pat.h, sec });
				}
			}
		}
	}
	return out.sort((a, b) => a.sec - b.sec);
}

/** seconds since midnight, Tallinn time */
export function tallinnSec(now = new Date()): number {
	timeFmt ??= new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/Tallinn',
		hourCycle: 'h23',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
	const p = timeFmt.formatToParts(now);
	const n = (type: string) => Number(p.find((x) => x.type === type)?.value ?? 0);
	return n('hour') * 3600 + n('minute') * 60 + n('second');
}

/** The whole timetable of a stop for today, from the start of the day to 02:00 of the next one. */
export function dayTimetable(idx: GtfsIndex, code: string, now = new Date()): PlannedDeparture[] {
	return scheduledDepartures(idx, code, 0, now, 26 * 3600, 0);
}

export interface HourRow {
	/** 0..25; 24 and above are after midnight, still part of today's service day */
	hour: number;
	items: PlannedDeparture[];
}

/** Departures grouped by hour like on a stop sign; `route` narrows them down to one line. */
export function hourTable(deps: PlannedDeparture[], route?: string): HourRow[] {
	const rows = new Map<number, PlannedDeparture[]>();
	for (const d of deps) {
		if (route && d.route !== route) continue;
		const h = Math.floor(d.sec / 3600);
		const a = rows.get(h) ?? [];
		a.push(d);
		rows.set(h, a);
	}
	return [...rows]
		.sort((a, b) => a[0] - b[0])
		.map(([hour, items]) => ({ hour, items: items.sort((a, b) => a.sec - b.sec) }));
}

/**
 * The live feed's scheduled times differ from GTFS by up to a minute or so,
 * so trips are matched to the nearest GTFS time within this tolerance.
 */
export const MATCH_TOLERANCE_SEC = 150;

/**
 * The ride a live departure is: of the patterns of `route` through `fromCode`, the one with a trip leaving
 * nearest to `schedSec` (within the tolerance) on a day it runs. `alight` says where one would get off a
 * pattern boarded at stop `i` (-1: this pattern is of no use).
 */
function matchRide(
	idx: GtfsIndex,
	route: string,
	fromCode: string,
	schedSec: number,
	now: Date,
	alight: (p: number, i: number) => number,
): { p: number; i: number; j: number } | null {
	// today's service day, or – for small times after midnight – yesterday's (times there exceed 24:00)
	const days = [
		{ date: tallinnDate(now, 0), t: schedSec },
		{ date: tallinnDate(now, -1), t: schedSec + 86400 },
	];
	let best = null as { p: number; i: number; j: number; diff: number } | null;
	for (const { date, t } of days) {
		for (const { p, i } of positions(idx, route, fromCode)) {
			const j = alight(p, i);
			if (j < 0) continue;
			const pat = idx.pats[p];
			for (let k = 0; k < pat.t.length; k += 2) {
				const diff = Math.abs(pat.t[k] + pat.o[i] - t);
				if (diff > MATCH_TOLERANCE_SEC || (best && diff >= best.diff)) continue;
				if (serviceActive(idx.services[pat.t[k + 1]], date)) best = { p, i, j, diff };
			}
		}
		if (best) break;
	}
	return best && { p: best.p, i: best.i, j: best.j };
}

/**
 * @param schedSec scheduled departure from `fromCode`, seconds from Tallinn midnight (as reported live)
 * @param preferred subset of goalCodes to prefer when the trip serves several goal stops
 * @returns arrival time expressed in the same frame as `schedSec` (live schedule + GTFS travel time)
 */
export function findArrival(
	idx: GtfsIndex,
	route: string,
	fromCode: string,
	schedSec: number,
	goalCodes: ReadonlySet<string>,
	now = new Date(),
	preferred?: ReadonlySet<string>,
): Arrival | null {
	// dozens of patterns share a few stop lists: where to get off is worked out once per list
	const known = new Map<number, number>();
	const ride = matchRide(idx, route, fromCode, schedSec, now, (p, i) =>
		getOrCreate(known, idx.pats[p].q * 4096 + i, () => {
			const stops = stopsOf(idx, p);
			// a preferred goal stop later on the trip wins over an earlier ordinary one
			let j = -1;
			for (let k = i + 1; k < stops.length; k++) {
				if (preferred?.has(stops[k])) return k;
				if (j < 0 && goalCodes.has(stops[k])) j = k;
			}
			return j; // -1: this stop list never reaches the goal after boarding
		}),
	);
	if (!ride) return null;
	const pat = idx.pats[ride.p];
	return {
		toCode: stopsOf(idx, ride.p)[ride.j],
		sec: schedSec + (pat.o[ride.j] - pat.o[ride.i]),
		headsign: pat.h,
		...ride,
	};
}

/** the pattern a live departure belongs to (nearest timetable time within tolerance), and the stop's index in it */
export function findBoarding(
	idx: GtfsIndex,
	route: string,
	fromCode: string,
	schedSec: number,
	now = new Date(),
): { p: number; i: number } | null {
	const last = (p: number) => idx.pats[p].o.length - 1;
	// boarding at the last stop is not a ride
	const ride = matchRide(idx, route, fromCode, schedSec, now, (p, i) =>
		i >= last(p) ? -1 : last(p),
	);
	return ride && { p: ride.p, i: ride.i };
}
