import type { Departure, StopDepartures } from './api.ts';
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
  dep: Departure;
  stopName: string;
  /** seconds until the vehicle arrives */
  inSec: number;
  /** seconds until you must leave home */
  leaveInSec: number;
  /** actual delay in seconds (positive = late) */
  delaySec: number;
  /** present when planning towards a goal */
  arrive?: { sec: number; travelSec: number; stopName: string };
}

export function matches(dep: Departure, stop: StopCfg): boolean {
  if (stop.routes.length && !stop.routes.includes(dep.route)) return false;
  return true;
}

/**
 * Builds sorted rows for a location. Departures you can no longer catch
 * (leave time passed by more than `graceSec`) are dropped.
 */
export interface GoalCtx { goal: GoalCfg; idx: GtfsIndex }

const arrivalCache = new Map<string, ReturnType<typeof findArrival>>();
export const clearArrivalCache = () => arrivalCache.clear();

export function buildRows(
  loc: LocationCfg,
  data: Map<number, StopDepartures>,
  elapsedSec = 0,
  graceSec = 30,
  ctx?: GoalCtx,
): Row[] {
  const goalCodes = ctx ? new Set(ctx.goal.stops.map(s => s.code)) : null;
  const preferred = ctx ? new Set(ctx.goal.stops.filter(s => s.pref).map(s => s.code)) : undefined;
  const rows: Row[] = [];
  for (const stop of loc.stops) {
    const d = data.get(stop.siriId);
    if (!d) continue;
    for (const dep of d.items) {
      if (!matches(dep, stop)) continue;
      const inSec = dep.expected - d.now - elapsedSec;
      const leaveInSec = inSec - loc.walkMin * 60;
      if (leaveInSec < -graceSec) continue;
      const row: Row = { siriId: stop.siriId, dep, stopName: stop.name, inSec, leaveInSec, delaySec: dep.expected - dep.scheduled };
      if (ctx && goalCodes) {
        if (!stop.code) continue;
        const key = `${ctx.goal.id}|${stop.code}|${dep.route}|${dep.scheduled}`;
        let a = arrivalCache.get(key);
        if (a === undefined) { a = findArrival(ctx.idx, dep.route, stop.code, dep.scheduled, goalCodes, new Date(), preferred); arrivalCache.set(key, a); }
        if (!a) continue; // this trip never reaches the goal
        const travelSec = a.sec - dep.scheduled;
        row.arrive = { sec: dep.expected + travelSec, travelSec, stopName: ctx.goal.stops.find(g => g.code === a!.toCode)?.name ?? '' };
      }
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.leaveInSec - b.leaveInSec);
  return rows;
}

export function fmtClock(secFromMidnight: number): string {
  const s = ((Math.round(secFromMidnight) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "now" / "5 min" / "1 h 05 min" */
export function fmtMinutes(sec: number): string {
  const m = Math.floor(sec / 60);
  if (m <= 0) return 'сейчас';
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}
