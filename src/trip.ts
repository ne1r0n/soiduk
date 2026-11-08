/**
 * Answers "if I board the trip that leaves stop A at time T on route R,
 * when does it reach one of the goal stops?" using the compact GTFS index
 * produced by scripts/build-gtfs.mjs.
 */

export interface RawGtfs {
  patterns: { r: string; m?: 'bus' | 'trol' | 'tram'; h: string; s: string[]; o: number[] }[];
  /** [patternIdx, startSec, serviceIdx] */
  trips: [number, number, number][];
  services: { d: string; a: string; b: string; x: string[]; y: string[] }[];
}

export interface GtfsIndex {
  raw: RawGtfs;
  /** "route|stopCode" -> positions of that stop inside patterns of the route */
  byRouteStop: Map<string, { p: number; i: number }[]>;
  /** pattern -> its trips as [startSec, serviceIdx] */
  tripsByPattern: Map<number, [number, number][]>;
  /** stopCode -> routes that serve it */
  routesByStop: Map<string, Set<string>>;
}

export interface Arrival {
  toCode: string;
  /** scheduled arrival, seconds from service-day midnight (may exceed 86400) */
  sec: number;
  headsign: string;
}

export function buildIndex(raw: RawGtfs): GtfsIndex {
  const byRouteStop = new Map<string, { p: number; i: number }[]>();
  const routesByStop = new Map<string, Set<string>>();
  raw.patterns.forEach((pat, p) => {
    pat.s.forEach((code, i) => {
      let rs = routesByStop.get(code);
      if (!rs) routesByStop.set(code, rs = new Set());
      rs.add(pat.r);
      const k = `${pat.r}|${code}`;
      let a = byRouteStop.get(k);
      if (!a) byRouteStop.set(k, a = []);
      a.push({ p, i });
    });
  });
  const tripsByPattern = new Map<number, [number, number][]>();
  for (const [p, start, svc] of raw.trips) {
    const a = tripsByPattern.get(p);
    if (a) a.push([start, svc]); else tripsByPattern.set(p, [[start, svc]]);
  }
  return { raw, byRouteStop, tripsByPattern, routesByStop };
}

/** yyyymmdd + weekday (0=Sunday) of a moment in Europe/Tallinn, optionally shifted by whole days */
export function tallinnDate(now = new Date(), shiftDays = 0): { ymd: string; dow: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + shiftDays));
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return { ymd, dow: d.getUTCDay() };
}

export function serviceActive(s: RawGtfs['services'][number], date: { ymd: string; dow: number }): boolean {
  if (s.y.includes(date.ymd)) return false;
  if (s.x.includes(date.ymd)) return true;
  return s.d[date.dow] === '1' && s.a <= date.ymd && date.ymd <= s.b;
}

export interface PlannedDeparture { route: string; mode: 'bus' | 'trol' | 'tram'; headsign: string; sec: number }

/**
 * Timetable departures from a stop in the window [nowSec - backSec, nowSec + horizonSec]
 * (seconds from Tallinn midnight). Used when the live feed has nothing for the stop.
 * Weekday/weekend/holiday calendars are respected via serviceActive.
 */
export function scheduledDepartures(
  idx: GtfsIndex, code: string, nowSec: number, now = new Date(), horizonSec = 2 * 3600, backSec = 60,
): PlannedDeparture[] {
  const out: PlannedDeparture[] = [];
  // service days whose trips can fall into the window: yesterday (after-midnight times), today, tomorrow
  const days = [-1, 0, 1].map(d => ({ date: tallinnDate(now, d), shift: d * 86400 }));
  for (const route of idx.routesByStop.get(code) ?? []) {
    for (const { p, i } of idx.byRouteStop.get(`${route}|${code}`) ?? []) {
      const pat = idx.raw.patterns[p];
      if (i >= pat.s.length - 1) continue; // last stop: vehicles only arrive there
      for (const [start, svc] of idx.tripsByPattern.get(p) ?? []) {
        for (const { date, shift } of days) {
          const sec = start + pat.o[i] + shift;
          if (sec < nowSec - backSec || sec > nowSec + horizonSec) continue;
          if (serviceActive(idx.raw.services[svc], date)) out.push({ route, mode: pat.m ?? 'bus', headsign: pat.h, sec });
        }
      }
    }
  }
  return out.sort((a, b) => a.sec - b.sec);
}

/**
 * The live feed's scheduled times differ from GTFS by up to a minute or so,
 * so trips are matched to the nearest GTFS time within this tolerance.
 */
export const MATCH_TOLERANCE_SEC = 150;

/**
 * @param schedSec scheduled departure from `fromCode`, seconds from Tallinn midnight (as reported live)
 * @param preferred subset of goalCodes to prefer when the trip serves several goal stops
 * @returns arrival time expressed in the same frame as `schedSec` (live schedule + GTFS travel time)
 */
export function findArrival(
  idx: GtfsIndex, route: string, fromCode: string, schedSec: number, goalCodes: ReadonlySet<string>, now = new Date(),
  preferred?: ReadonlySet<string>,
): Arrival | null {
  const cands = idx.byRouteStop.get(`${route}|${fromCode}`);
  if (!cands) return null;
  // today's service day, or – for small times after midnight – yesterday's (times there exceed 24:00)
  const days = [
    { date: tallinnDate(now, 0), t: schedSec },
    { date: tallinnDate(now, -1), t: schedSec + 86400 },
  ];
  let best = null as (Arrival & { diff: number }) | null;
  for (const { date, t } of days) {
    for (const { p, i } of cands) {
      const pat = idx.raw.patterns[p];
      // a preferred goal stop later on the trip wins over an earlier ordinary one
      let j = -1;
      for (let k = i + 1; k < pat.s.length; k++) {
        if (preferred?.has(pat.s[k])) { j = k; break; }
        if (j < 0 && goalCodes.has(pat.s[k])) j = k;
      }
      if (j < 0) continue; // this pattern never reaches the goal after boarding
      for (const [start, svc] of idx.tripsByPattern.get(p) ?? []) {
        const diff = Math.abs(start + pat.o[i] - t);
        if (diff > MATCH_TOLERANCE_SEC || (best && diff >= best.diff)) continue;
        if (!serviceActive(idx.raw.services[svc], date)) continue;
        best = { toCode: pat.s[j], sec: schedSec + (pat.o[j] - pat.o[i]), headsign: pat.h, diff };
      }
    }
    if (best) break;
  }
  return best && { toCode: best.toCode, sec: best.sec, headsign: best.headsign };
}
