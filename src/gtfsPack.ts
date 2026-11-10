/**
 * The compact form of the timetable and of the road geometry that the browser downloads
 * (public/data/gtfs.<hash>.json, shapes.<hash>.json), and the functions that produce it.
 * They are used by scripts/build-gtfs.mjs and by the tests – not by the app itself.
 *
 * Why not simply «patterns with their stops»: in the Tallinn feed nearly every trip has running times of
 * its own, so there are ~7000 patterns over fewer than 200 distinct stop lists. Writing the list of stops
 * into each pattern made the file three and a half times larger than it needs to be.
 */

export type Vehicle = 'bus' | 'trol' | 'tram';

export interface Service {
	/** weekdays it runs on, index = JS getDay(): '0111110' */
	d: string;
	/** first and last day, yyyymmdd */
	a: string;
	b: string;
	/** days added / removed, yyyymmdd */
	x: string[];
	y: string[];
}

/** What the build script collects from the feed (and what the tests are written in): plain and readable. */
export interface GtfsSource {
	/** route, mode (bus when omitted), headsign, stop codes, seconds from the trip's start to each stop */
	patterns: { r: string; m?: Vehicle; h: string; s: string[]; o: number[] }[];
	/** [pattern, start in seconds from midnight, service] */
	trips: [number, number, number][];
	services: Service[];
}

/** The timetable as downloaded by the browser. */
export interface RawGtfs {
	v: 2;
	/** stop codes */
	stops: string[];
	/** distinct lists of stops, as indices into `stops` */
	seqs: number[][];
	/** distinct [route, mode] */
	routes: [string, Vehicle][];
	/** distinct headsigns */
	heads: string[];
	/**
	 * per pattern, in the order of GtfsSource.patterns:
	 * [route, headsign, stop list, seconds from each stop to the next (the first number: from the start to the
	 * first stop), trips sorted by start as start, service, seconds since the previous start, service, …]
	 */
	pats: [number, number, number, number[], number[]][];
	services: Service[];
}

/** index of `value` in `list`, appended on first sight */
function intern<T>(list: T[], seen: Map<string, number>, key: string, value: T): number {
	let i = seen.get(key);
	if (i === undefined) {
		i = list.length;
		seen.set(key, i);
		list.push(value);
	}
	return i;
}

export function packGtfs(src: GtfsSource): RawGtfs {
	const stops: string[] = [];
	const stopIdx = new Map<string, number>();
	const seqs: number[][] = [];
	const seqIdx = new Map<string, number>();
	const routes: [string, Vehicle][] = [];
	const routeIdx = new Map<string, number>();
	const heads: string[] = [];
	const headIdx = new Map<string, number>();

	// trips of each pattern, by start (trips that start together keep the order of the feed)
	const starts: [number, number][][] = src.patterns.map(() => []);
	for (const [p, start, svc] of src.trips) starts[p].push([start, svc]);

	const pats = src.patterns.map((pat, p): RawGtfs['pats'][number] => {
		const mode = pat.m ?? 'bus';
		const seq = pat.s.map((code) => intern(stops, stopIdx, code, code));
		const trips: number[] = [];
		let prev = 0;
		for (const [start, svc] of starts[p].sort((a, b) => a[0] - b[0])) {
			trips.push(start - prev, svc);
			prev = start;
		}
		return [
			intern(routes, routeIdx, `${mode}|${pat.r}`, [pat.r, mode]),
			intern(heads, headIdx, pat.h, pat.h),
			intern(seqs, seqIdx, seq.join(), seq),
			pat.o.map((sec, i) => (i ? sec - pat.o[i - 1] : sec)),
			trips,
		];
	});
	return { v: 2, stops, seqs, routes, heads, pats, services: src.services };
}

/** position of each stop of a pattern along a shape: point index + fraction */
export type ShapeRef = [shape: number, at: number[]];

/** The road geometry as downloaded by the browser. */
export interface RawShapes {
	/** per shape: delta-encoded [lat, lon, dlat, dlon, …] in 1e-5 degrees */
	shapes: number[][];
	/** distinct [shape, positions of the stops along it] */
	refs: ShapeRef[];
	/** per pattern: index into `refs`, -1 when the feed has no geometry for it */
	pat: number[];
}

/** `perPattern`: for each pattern its shape and the positions of its stops along it, or null */
export function packShapes(shapes: number[][], perPattern: (ShapeRef | null)[]): RawShapes {
	const refs: ShapeRef[] = [];
	const seen = new Map<string, number>();
	const pat = perPattern.map((ref) => (ref ? intern(refs, seen, JSON.stringify(ref), ref) : -1));
	return { shapes, refs, pat };
}

/** The list of stops as downloaded by the browser: one column per property. */
export interface RawStops {
	/** SiriID, the id of the live departures feed */
	s: number[];
	/** GTFS stop_code */
	id: string[];
	/** latitude and longitude in 1e-5 degrees */
	la: number[];
	lo: number[];
	/** distinct names and areas … */
	names: string[];
	areas: string[];
	/** … and the index of each stop's name and area in them */
	n: number[];
	ar: number[];
}

export function packStops(
	list: { s: number; id: string; la: number; lo: number; n: string; ar: string }[],
): RawStops {
	const out: RawStops = { s: [], id: [], la: [], lo: [], names: [], areas: [], n: [], ar: [] };
	const nameIdx = new Map<string, number>();
	const areaIdx = new Map<string, number>();
	for (const st of list) {
		out.s.push(st.s);
		out.id.push(st.id);
		out.la.push(Math.round(st.la * 1e5));
		out.lo.push(Math.round(st.lo * 1e5));
		out.n.push(intern(out.names, nameIdx, st.n, st.n));
		out.ar.push(intern(out.areas, areaIdx, st.ar, st.ar));
	}
	return out;
}
