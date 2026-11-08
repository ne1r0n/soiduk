import { clearArrivalCache } from './plan.ts';
import { render } from './state.ts';
import { distanceM, loadStops } from './stops.ts';
import { makeNear, type Near } from './transfer.ts';

let near: ((code: string) => Near[]) | null = null;
let pos: Map<string, { la: number; lo: number; n: string }> | null = null;
let started = false;

/** loads stop coordinates once (needed to find walkable transfers); re-renders when ready */
export function ensureGeo() {
	if (started) return;
	started = true;
	loadStops()
		.then((all) => {
			near = makeNear(all, distanceM);
			pos = new Map(all.map((s) => [s.id, { la: s.la, lo: s.lo, n: s.n }]));
			clearArrivalCache(); // results computed before the coordinates arrived lack walkable changes
			render();
		})
		.catch(() => {
			started = false;
		});
}

export const nearStops = (code: string): Near[] => near?.(code) ?? [];
export const stopNameByCode = (code: string): string => pos?.get(code)?.n ?? code;
export const stopPos = (code: string) => pos?.get(code);

const nearestGoalM = (code: string, goals: ReadonlySet<string>): number | undefined => {
	const a = pos?.get(code);
	if (!a) return undefined;
	let best: number | undefined;
	for (const g of goals) {
		const b = pos?.get(g);
		if (b) best = Math.min(best ?? Infinity, distanceM(a.la, a.lo, b.la, b.lo));
	}
	return best;
};

/**
 * A change only makes sense at a stop that is not (much) farther from the goal than where you started;
 * otherwise the route runs away from the goal and back. Unknown coordinates: no restriction.
 */
export function progress(from: string, via: string, goals: ReadonlySet<string>): boolean {
	const d0 = nearestGoalM(from, goals);
	const d1 = nearestGoalM(via, goals);
	return d0 === undefined || d1 === undefined || d1 <= d0 * 1.1;
}
