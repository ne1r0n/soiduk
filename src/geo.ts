import { clearArrivalCache } from './plan.ts';
import { render } from './state.ts';
import { distanceM, loadStops } from './stops.ts';
import { makeNear, type Near } from './transfer.ts';

let near: ((code: string) => Near[]) | null = null;
let names: Map<string, string> | null = null;
let started = false;

/** loads stop coordinates once (needed to find walkable transfers); re-renders when ready */
export function ensureGeo() {
	if (started) return;
	started = true;
	loadStops()
		.then((all) => {
			near = makeNear(all, distanceM);
			names = new Map(all.map((s) => [s.id, s.n]));
			clearArrivalCache(); // results computed before the coordinates arrived lack walkable changes
			render();
		})
		.catch(() => {
			started = false;
		});
}

export const geoReady = () => near !== null;
export const nearStops = (code: string): Near[] => near?.(code) ?? [];
export const stopNameByCode = (code: string): string => names?.get(code) ?? code;
