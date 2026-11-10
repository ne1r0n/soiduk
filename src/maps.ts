export type MapLib = typeof import('./leaflet.ts');

let lib: Promise<MapLib> | undefined;

/** Leaflet, fetched on first use; a failed download is retried the next time a map is wanted */
export function loadMapLib(): Promise<MapLib> {
	lib ??= import('./leaflet.ts').catch((err: unknown) => {
		lib = undefined;
		throw err;
	});
	return lib;
}
