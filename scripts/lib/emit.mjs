// Writes a generated data file as public/data/<kind>.<hash of the content>.json and records the name in
// public/data.json. A file that has not changed keeps its name from one nightly build to the next, so
// browsers (and the service worker) keep their copy instead of downloading megabytes again; the app only
// fetches data.json, a hundred bytes, to learn the current names.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';

const PUBLIC = new URL('../../public/', import.meta.url);

/**
 * @param {'stops' | 'gtfs' | 'shapes'} kind
 * @param {string} json the content of the file
 * @param {Record<string, string>} [info] extra fields for data.json (e.g. the date of the timetable)
 * @returns {Promise<string>} the name, relative to public/
 */
export async function emit(kind, json, info = {}) {
	const hash = createHash('sha256').update(json).digest('hex').slice(0, 8);
	const name = `data/${kind}.${hash}.json`;
	await mkdir(new URL('data/', PUBLIC), { recursive: true });
	for (const old of await readdir(new URL('data/', PUBLIC))) {
		if (old.startsWith(`${kind}.`)) await rm(new URL(`data/${old}`, PUBLIC));
	}
	await writeFile(new URL(name, PUBLIC), json);
	let manifest = {};
	try {
		manifest = JSON.parse(await readFile(new URL('data.json', PUBLIC), 'utf8'));
	} catch {
		/* the first file of a fresh checkout */
	}
	await writeFile(
		new URL('data.json', PUBLIC),
		`${JSON.stringify({ ...manifest, ...info, [kind]: name })}\n`,
	);
	return name;
}
