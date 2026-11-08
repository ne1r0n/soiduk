/** Returns map[key], creating it with `make()` on first use. */
export function getOrCreate<K, V>(map: Map<K, V>, key: K, make: () => V): V {
	let v = map.get(key);
	if (v === undefined) {
		v = make();
		map.set(key, v);
	}
	return v;
}

const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

/** HTML-escapes text before it is put into a template string */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** numeric routes first by number, then by natural string order ("26" < "26A" < "8A"…) */
export function routeSort(a: string, b: string): number {
	const na = parseInt(a, 10);
	const nb = parseInt(b, 10);
	if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
	return a.localeCompare(b, undefined, { numeric: true });
}

/** Element that must exist in index.html */
export function byId(id: string): HTMLElement {
	const el = document.getElementById(id);
	if (!el) throw new Error(`#${id} missing in index.html`);
	return el;
}
