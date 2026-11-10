import { loadData } from './datafiles.ts';
import type { RawStops } from './gtfsPack.ts';
import type { StopCfg } from './plan.ts';

export interface StopInfo {
	s: number; // SiriID
	n: string; // name
	la: number;
	lo: number;
	ar: string; // area / municipality
	id: string; // GTFS stop_code
}

let cache: Promise<StopInfo[]> | null = null;

/** the downloaded columns (see gtfsPack.ts) as one object per stop */
export function decodeStops(raw: RawStops): StopInfo[] {
	return raw.s.map((s, k) => ({
		s,
		id: raw.id[k],
		la: raw.la[k] / 1e5,
		lo: raw.lo[k] / 1e5,
		n: raw.names[raw.n[k]],
		ar: raw.areas[raw.ar[k]],
	}));
}

export function loadStops(): Promise<StopInfo[]> {
	cache ??= loadData<RawStops>('stops')
		.then(decodeStops)
		.catch((err: unknown) => {
			cache = null; // try again next time (run `npm run stops` if the file was never generated)
			throw err;
		});
	return cache;
}

/** the settings entry of a stop picked from the list */
export function stopCfg(info: StopInfo, walkMin: number): StopCfg {
	return {
		siriId: info.s,
		code: info.id,
		name: info.n,
		walkMin,
		routes: [],
		la: info.la,
		lo: info.lo,
		area: info.ar || undefined,
	};
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
