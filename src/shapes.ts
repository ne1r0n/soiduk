/** Road geometry of the patterns (public/shapes.json, built by scripts/build-gtfs.mjs), loaded on demand. */

interface RawShapes {
	/** per shape: delta-encoded [lat, lon, dlat, dlon, …] in 1e-5 degrees */
	shapes: number[][];
	/** per pattern: [shape index, position of each stop along the shape: point index + fraction] */
	pat: ([number, number[]] | null)[];
}

let loaded: Promise<Decoded | null> | null = null;
interface Decoded {
	pts: [number, number][][];
	pat: RawShapes['pat'];
}

export function loadShapes(): Promise<Decoded | null> {
	loaded ??= fetch(`${import.meta.env.BASE_URL}shapes.json`)
		.then((r) => (r.ok ? (r.json() as Promise<RawShapes>) : Promise.reject(r.status)))
		.then((raw) => ({
			pat: raw.pat,
			pts: raw.shapes.map((flat) => {
				const out: [number, number][] = [];
				let la = 0;
				let lo = 0;
				for (let k = 0; k < flat.length; k += 2) {
					la += flat[k];
					lo += flat[k + 1];
					out.push([la / 1e5, lo / 1e5]);
				}
				return out;
			}),
		}))
		.catch(() => {
			loaded = null; // try again next time
			return null;
		});
	return loaded;
}

/** the stretch of the road between stop i and stop j of a pattern; undefined if there is no geometry */
export function roadBetween(
	s: Decoded | null,
	p: number,
	i: number,
	j: number,
): [number, number][] | undefined {
	const e = s?.pat[p];
	if (!s || !e) return undefined;
	const pts = s.pts[e[0]];
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
