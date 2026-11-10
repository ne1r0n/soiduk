/** Road geometry of the patterns (built by scripts/build-gtfs.mjs, format in gtfsPack.ts), loaded on demand. */

import { loadData } from './datafiles.ts';
import type { RawShapes } from './gtfsPack.ts';

export interface Shapes {
	raw: RawShapes;
	/** shapes decoded so far: a trip sheet needs one or two of the ~200 */
	pts: Map<number, [number, number][]>;
}

let loaded: Promise<Shapes | null> | null = null;

export function loadShapes(): Promise<Shapes | null> {
	loaded ??= loadData<RawShapes>('shapes')
		.then((raw): Shapes => ({ raw, pts: new Map() }))
		.catch(() => {
			loaded = null; // try again next time
			return null;
		});
	return loaded;
}

/** the points of a shape, [lat, lon] in degrees */
function points(s: Shapes, shape: number): [number, number][] {
	let out = s.pts.get(shape);
	if (!out) {
		out = [];
		const flat = s.raw.shapes[shape] ?? [];
		let la = 0;
		let lo = 0;
		for (let k = 0; k < flat.length; k += 2) {
			la += flat[k];
			lo += flat[k + 1];
			out.push([la / 1e5, lo / 1e5]);
		}
		s.pts.set(shape, out);
	}
	return out;
}

/** the stretch of the road between stop i and stop j of a pattern; undefined if there is no geometry */
export function roadBetween(
	s: Shapes | null,
	p: number,
	i: number,
	j: number,
): [number, number][] | undefined {
	const e = s?.raw.refs[s.raw.pat[p]];
	if (!s || !e) return undefined;
	const pts = points(s, e[0]);
	const [a, b] = [e[1][i], e[1][j]];
	const at = (x: number): [number, number] => {
		const k = Math.floor(x);
		const t = x - k;
		const p = pts[k];
		const q = pts[k + 1];
		return q && t ? [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] : p;
	};
	// the exact start, the corners of the road in between, the exact end
	const line = [at(a), ...pts.slice(Math.floor(a) + 1, Math.floor(b) + 1), at(b)];
	return line.length > 1 ? line : undefined;
}
