import type { Departure, StopDepartures } from './api.ts';
import { t } from './i18n.ts';
import { findTransfer, type Near } from './transfer.ts';
import { findArrival, type GtfsIndex } from './trip.ts';

export interface StopCfg {
	siriId: number;
	/** GTFS stop_code, needed to look up where a trip goes */
	code?: string;
	/** walking time from home to this stop, minutes */
	walkMin?: number;
	/** optional short note shown on the card, e.g. «в центр» */
	label?: string;
	name: string;
	/** empty = all routes */
	routes: string[];
	la?: number;
	lo?: number;
	area?: string;
	/** neighbouring stop names, for orientation */
	nb?: string[];
}

/** A place you want to get to, e.g. a shopping centre with several nearby stops */
export interface GoalCfg {
	id: string;
	name: string;
	/** pref = preferred stop: if a trip reaches it, arrival is shown there instead of an earlier goal stop */
	stops: { code: string; name: string; pref?: boolean }[];
}

export interface LocationCfg {
	id: string;
	name: string;
	/** default walking time for newly added stops, minutes (each stop has its own) */
	walkMin: number;
	stops: StopCfg[];
	goals?: GoalCfg[];
}

export interface Row {
	siriId: number;
	/** GTFS code of the boarding stop */
	code?: string;
	dep: Departure;
	stopName: string;
	/** seconds until the vehicle arrives */
	inSec: number;
	/** seconds until you must leave home */
	leaveInSec: number;
	/** actual delay in seconds (positive = late) */
	delaySec: number;
	/** present when planning towards a goal */
	arrive?: {
		sec: number;
		travelSec: number;
		stopName: string;
		/** set when the trip needs a change: where, onto which route, and how far to walk */
		via?: {
			stopName: string;
			route: string;
			mode: 'bus' | 'trol' | 'tram';
			depSec: number;
			walkSec: number;
			/** no second vehicle: the goal is reached on foot from here */
			walk?: boolean;
		};
	};
}

export function matches(dep: Departure, stop: StopCfg): boolean {
	if (stop.routes.length && !stop.routes.includes(dep.route)) return false;
	return true;
}

/**
 * Builds sorted rows for a location. Departures you can no longer catch
 * (leave time passed by more than `graceSec`) are dropped.
 */
export interface GoalCtx {
	goal: GoalCfg;
	idx: GtfsIndex;
	/** when set, trips without a direct route get a one-change connection */
	transfers?: {
		near: (code: string) => Near[];
		name: (code: string) => string;
		/** is changing at `via` a step towards the goal (as opposed to away from it)? */
		progress: (from: string, via: string, goals: ReadonlySet<string>) => boolean;
	};
}

const arrivalCache = new Map<string, ReturnType<typeof findArrival>>();
const transferCache = new Map<string, ReturnType<typeof findTransfer>>();
export const clearArrivalCache = () => {
	arrivalCache.clear();
	transferCache.clear();
};

export function buildRows(
	loc: LocationCfg,
	data: Map<number, StopDepartures>,
	elapsedSec = 0,
	graceSec = 30,
	ctx?: GoalCtx,
): Row[] {
	const goalCodes = ctx ? new Set(ctx.goal.stops.map((s) => s.code)) : null;
	const preferred = ctx
		? new Set(ctx.goal.stops.filter((s) => s.pref).map((s) => s.code))
		: undefined;
	const rows: Row[] = [];
	for (const stop of loc.stops) {
		const d = data.get(stop.siriId);
		if (!d) continue;
		for (const dep of d.items) {
			if (!matches(dep, stop)) continue;
			const inSec = dep.expected - d.now - elapsedSec;
			const leaveInSec = inSec - loc.walkMin * 60;
			if (leaveInSec < -graceSec) continue;
			const row: Row = {
				siriId: stop.siriId,
				code: stop.code,
				dep,
				stopName: stop.name,
				inSec,
				leaveInSec,
				delaySec: dep.expected - dep.scheduled,
			};
			if (ctx && goalCodes) {
				if (!stop.code) continue;
				const key = `${ctx.goal.id}|${stop.code}|${dep.route}|${dep.scheduled}`;
				let a = arrivalCache.get(key);
				if (a === undefined) {
					a = findArrival(
						ctx.idx,
						dep.route,
						stop.code,
						dep.scheduled,
						goalCodes,
						new Date(),
						preferred,
					);
					arrivalCache.set(key, a);
				}
				const goalName = (code: string) => ctx.goal.stops.find((g) => g.code === code)?.name ?? '';
				if (a) {
					const travelSec = a.sec - dep.scheduled;
					row.arrive = {
						sec: dep.expected + travelSec,
						travelSec,
						stopName: goalName(a.toCode),
					};
				} else if (ctx.transfers) {
					const tkey = `${key}|x|${dep.expected}`;
					let x = transferCache.get(tkey);
					if (x === undefined) {
						x = findTransfer(
							ctx.idx,
							dep.route,
							stop.code,
							dep.scheduled,
							dep.expected - dep.scheduled,
							goalCodes,
							ctx.transfers.near,
							new Date(),
							preferred,
							(via) => ctx.transfers!.progress(stop.code!, via, goalCodes),
						);
						transferCache.set(tkey, x);
					}
					if (!x) continue;
					row.arrive = {
						sec: x.sec,
						travelSec: x.sec - dep.expected,
						stopName: goalName(x.toCode),
						via: {
							stopName: ctx.transfers.name(x.viaCode),
							route: x.route,
							mode: x.mode,
							depSec: x.depSec,
							walkSec: x.walkSec,
							walk: x.walkOnly,
						},
					};
				} else continue; // this trip never reaches the goal
			}
			rows.push(row);
		}
	}
	rows.sort((a, b) => a.leaveInSec - b.leaveInSec);
	return dropRedundantChanges(rows);
}

/**
 * Several first vehicles often lead to the same second vehicle; leaving earlier than necessary gains
 * nothing, so only the latest of them is kept (rows are sorted by leave time).
 */
export function dropRedundantChanges(rows: Row[]): Row[] {
	const lastFor = new Map<string, Row>();
	for (const r of rows) {
		const v = r.arrive?.via;
		if (v) lastFor.set(`${r.siriId}|${v.route}|${v.depSec}`, r);
	}
	return rows.filter((r) => {
		const v = r.arrive?.via;
		return !v || lastFor.get(`${r.siriId}|${v.route}|${v.depSec}`) === r;
	});
}

export function fmtClock(secFromMidnight: number): string {
	const s = ((Math.round(secFromMidnight) % 86400) + 86400) % 86400;
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The line under a departure: «выйти через 5 мин» / «выйти сейчас». At the stop there is nowhere to walk,
 * so it counts down to the departure itself: «через 5 мин» / «сейчас».
 */
export function leaveText(sec: number, atStop = false): string {
	if (atStop) return sec < 60 ? t('dep.now') : t('dep.in', { t: fmtMinutes(sec) });
	return sec < 60 ? t('leave.now') : t('leave.in', { t: fmtMinutes(sec) });
}

/** "now" / "5 min" / "1 h 05 min" */
export function fmtMinutes(sec: number): string {
	const m = Math.floor(sec / 60);
	if (m <= 0) return t('time.now');
	if (m < 60) return `${m} ${t('unit.min')}`;
	return `${Math.floor(m / 60)} ${t('unit.h')} ${String(m % 60).padStart(2, '0')} ${t('unit.min')}`;
}
