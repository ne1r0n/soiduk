import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { dataDate, loadData, resetDataFiles, whenDataDated } from './datafiles.ts';

const realFetch = globalThis.fetch;
let asked: string[] = [];
/** a tiny site: path → body; a missing path answers 404, `null` fails like a dead network */
function site(files: Record<string, unknown>) {
	globalThis.fetch = (async (url: string | URL | Request) => {
		const path = String(url).replace(/^\.\//, '');
		asked.push(path);
		if (files[path] === null) throw new TypeError('network down');
		if (!(path in files)) return new Response('not found', { status: 404 });
		return new Response(JSON.stringify(files[path]), { status: 200 });
	}) as typeof fetch;
}
beforeEach(() => {
	asked = [];
	resetDataFiles();
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

test('loadData: the names are fetched once, the files by their hashed names', async () => {
	site({
		'data.json': { gtfs: 'data/gtfs.aaaaaaaa.json', stops: 'data/stops.bbbbbbbb.json' },
		'data/gtfs.aaaaaaaa.json': { v: 1 },
		'data/stops.bbbbbbbb.json': [1, 2],
	});
	assert.deepEqual(await loadData('gtfs'), { v: 1 });
	assert.deepEqual(await loadData('stops'), [1, 2]);
	assert.deepEqual(asked, ['data.json', 'data/gtfs.aaaaaaaa.json', 'data/stops.bbbbbbbb.json']);
});

test('loadData: a name gone stale (the site was rebuilt) is looked up again', async () => {
	const files: Record<string, unknown> = {
		'data.json': { gtfs: 'data/gtfs.aaaaaaaa.json', shapes: 'data/shapes.11111111.json' },
		'data/gtfs.aaaaaaaa.json': { v: 1 },
	};
	site(files);
	await loadData('gtfs');
	// a nightly build replaced the road geometry while the page stayed open
	files['data.json'] = { gtfs: 'data/gtfs.aaaaaaaa.json', shapes: 'data/shapes.22222222.json' };
	files['data/shapes.22222222.json'] = { v: 2 };
	asked = [];
	assert.deepEqual(await loadData('shapes'), { v: 2 });
	assert.deepEqual(asked, ['data/shapes.11111111.json', 'data.json', 'data/shapes.22222222.json']);
});

test('loadData: a file that is really missing fails after one more look at the names', async () => {
	site({ 'data.json': { gtfs: 'data/gtfs.aaaaaaaa.json' } });
	await assert.rejects(loadData('gtfs'), /gtfs: HTTP 404/);
	assert.deepEqual(asked, ['data.json', 'data/gtfs.aaaaaaaa.json', 'data.json']);
	asked = [];
	await assert.rejects(loadData('shapes'), /shapes: no such file/);
});

test('loadData: no network – fails, and works once the network is back', async () => {
	const files: Record<string, unknown> = { 'data.json': null };
	site(files);
	await assert.rejects(loadData('stops'));
	files['data.json'] = { stops: 'data/stops.bbbbbbbb.json' };
	files['data/stops.bbbbbbbb.json'] = ['ok'];
	assert.deepEqual(await loadData('stops'), ['ok']);
});

test('dataDate: unknown until data.json has been read', async () => {
	site({ 'data.json': { date: '2026-11-10' } });
	assert.equal(dataDate(), undefined);
	await new Promise<void>((done) => whenDataDated(done));
	assert.equal(dataDate(), '2026-11-10');
	resetDataFiles();
	site({ 'data.json': {} });
	await new Promise<void>((done) => whenDataDated(done));
	assert.equal(dataDate(), '', 'known, but not recorded');
});
