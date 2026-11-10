import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resetDataFiles } from './datafiles.ts';
import { ensureGtfs } from './gtfs.ts';
import { packGtfs } from './gtfsPack.ts';
import { state } from './state.ts';

test('a failed GTFS download can be retried after the cooldown without reloading the page', async (t) => {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
	const realFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
		resetDataFiles();
	});
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		throw new TypeError('offline');
	}) as typeof fetch;
	await ensureGtfs();
	assert.equal(state.gtfsState, 'error');
	await ensureGtfs();
	assert.equal(calls, 1, 'no retry loop while rendering the error');
	t.mock.timers.tick(20_000);
	const raw = packGtfs({ patterns: [], trips: [], services: [] });
	globalThis.fetch = (async (url) =>
		new Response(
			JSON.stringify(String(url).endsWith('data.json') ? { gtfs: 'data/gtfs.aaaaaaaa.json' } : raw),
		)) as typeof fetch;
	await ensureGtfs();
	assert.equal(state.gtfsState, 'idle');
	assert.ok(state.gtfs);
});
