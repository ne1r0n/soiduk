/** Returns map[key], creating it with `make()` on first use. */
export function getOrCreate<K, V>(map: Map<K, V>, key: K, make: () => V): V {
	let v = map.get(key);
	if (v === undefined) {
		v = make();
		map.set(key, v);
	}
	return v;
}
