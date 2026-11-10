/**
 * The generated data: stops, the timetable (GTFS) and the road geometry. Each file carries the hash of its
 * content in its name (see scripts/lib/emit.mjs), so it can be cached forever; public/data.json – tiny, always
 * fetched fresh – says what the current names are.
 */

export type DataKind = 'stops' | 'gtfs' | 'shapes';

type Manifest = Partial<Record<DataKind, string>> & { date?: string };

// `import.meta.env` exists in the bundle only; the tests run this file as it is
const base = (): string => import.meta.env?.BASE_URL ?? './';

/** where the current names of the data files are kept */
export const namesUrl = (): string => `${base()}data.json`;

let manifest: Promise<Manifest> | undefined;
let known: Manifest | undefined;

/**
 * Bounds both the download and reading its body, so that a file that never arrives cannot hold a refresh
 * forever. Generous on purpose: on a slow connection the timetable (~100 KB) may well take a quarter of a
 * minute, and giving up early only means downloading it again.
 */
async function download<T>(url: string, cache?: RequestCache) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 60_000);
	try {
		const r = await fetch(url, { cache, signal: controller.signal });
		return { ok: r.ok, status: r.status, data: r.ok ? ((await r.json()) as T) : undefined };
	} finally {
		clearTimeout(timer);
	}
}

function names(fresh = false): Promise<Manifest> {
	if (!manifest || fresh) {
		const p = download<Manifest>(namesUrl(), 'no-cache').then((r) => {
			if (!r.ok) throw new Error(`data.json: HTTP ${r.status}`);
			return r.data!;
		});
		manifest = p;
		p.then(
			(m) => {
				known = m;
			},
			() => {
				if (manifest === p) manifest = undefined; // ask again next time
			},
		);
	}
	return manifest;
}

/**
 * Downloads a data file. The names are remembered while the page lives; if a file is gone by the time it is
 * wanted (the site was rebuilt meanwhile), the names are asked for once more.
 */
export async function loadData<T>(kind: DataKind): Promise<T> {
	let status = 'no such file';
	let tried: string | undefined;
	for (const fresh of [false, true]) {
		const name = (await names(fresh))[kind];
		if (!name || name === tried) continue;
		tried = name;
		const r = await download<T>(base() + name);
		if (r.ok) return r.data!;
		status = `HTTP ${r.status}`;
	}
	throw new Error(`${kind}: ${status}`);
}

/**
 * The day the timetable was downloaded, yyyy-mm-dd; '' if it is not recorded, undefined while unknown
 * (`whenDataDated` tells when to look again).
 */
export const dataDate = (): string | undefined => (known ? (known.date ?? '') : undefined);

/** calls back once the date of the timetable is known (not at all if data.json cannot be fetched) */
export function whenDataDated(then: () => void): void {
	names().then(then, () => {});
}

/** forget what was learned – for the tests */
export function resetDataFiles(): void {
	manifest = undefined;
	known = undefined;
}
