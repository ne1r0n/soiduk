export interface StopInfo {
	s: number; // SiriID
	n: string; // name
	st: string; // street
	la: number;
	lo: number;
	ar: string; // area / municipality
	nb: string[]; // names of neighbouring stops
	id: string; // GTFS stop_code
}

let cache: Promise<StopInfo[]> | null = null;

export function loadStops(): Promise<StopInfo[]> {
	cache ??= fetch(`${import.meta.env.BASE_URL}stops.json`).then((r) => {
		if (!r.ok) throw new Error('stops.json not found – run `npm run stops`');
		return r.json();
	});
	return cache;
}

export function distanceM(aLa: number, aLo: number, bLa: number, bLo: number): number {
	const R = 6371000,
		rad = Math.PI / 180;
	const dLa = (bLa - aLa) * rad,
		dLo = (bLo - aLo) * rad;
	const h =
		Math.sin(dLa / 2) ** 2 + Math.cos(aLa * rad) * Math.cos(bLa * rad) * Math.sin(dLo / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

export function searchStops(
	all: StopInfo[],
	q: string,
	pos?: { la: number; lo: number },
	limit = 25,
	exclude?: Set<number>,
): (StopInfo & { dist?: number })[] {
	const query = q.trim().toLowerCase();
	let res = (exclude?.size ? all.filter((s) => !exclude.has(s.s)) : all).map((s) => ({
		...s,
		dist: pos ? distanceM(pos.la, pos.lo, s.la, s.lo) : undefined,
	}));
	if (query) res = res.filter((s) => `${s.n} ${s.st} ${s.ar}`.toLowerCase().includes(query));
	else if (!pos) return [];
	if (pos) res.sort((a, b) => a.dist! - b.dist!);
	else res.sort((a, b) => a.n.localeCompare(b.n));
	return res.slice(0, limit);
}
