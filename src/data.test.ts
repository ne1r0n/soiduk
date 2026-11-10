import assert from 'node:assert/strict';
import { afterEach, beforeEach, type TestContext, test } from 'node:test';
import { clearDepartureCache } from './api.ts';
import { refresh, refreshIfDue, setAfterRefresh } from './data.ts';
import { packGtfs } from './gtfsPack.ts';
import { setRenderer, state } from './state.ts';
import { buildIndex } from './trip.ts';

const realFetch = globalThis.fetch;
const realDocument = globalThis.document;
const NOW = Date.parse('2026-11-10T10:00:00Z');
let hidden = false;
let renders = 0;
let urls: string[] = [];
let notices = 0;

beforeEach((context) => {
	const t = context as TestContext;
	t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
	hidden = false;
	renders = 0;
	urls = [];
	notices = 0;
	const classes = new Set<string>();
	globalThis.document = {
		get hidden() {
			return hidden;
		},
		body: {
			classList: {
				contains: (s: string) => classes.has(s),
				add: (s: string) => classes.add(s),
				remove: (s: string) => classes.delete(s),
			},
		},
		getElementById: () => ({ hidden: false }),
	} as unknown as Document;
	state.cfg = {
		locations: [
			{
				id: 'home',
				name: 'Home',
				walkMin: 0,
				stops: [
					{ siriId: 1, code: 'A', name: 'A', routes: [] },
					{ siriId: 2, code: 'B', name: 'B', routes: [] },
				],
			},
		],
	};
	state.data = new Map();
	state.failed = new Set();
	state.planned = new Set();
	state.loading = false;
	state.lastOk = true;
	state.fetchedAt = 0;
	state.watch = null;
	state.gtfs = buildIndex(
		packGtfs({
			patterns: [{ r: '1', h: 'Goal', s: ['A', 'B', 'G'], o: [0, 60, 600] }],
			trips: [[0, 43500, 0]],
			services: [{ d: '1111111', a: '20200101', b: '20990101', x: [], y: [] }],
		}),
	);
	setRenderer(() => renders++);
	setAfterRefresh(() => notices++);
	clearDepartureCache();
	globalThis.fetch = (async (url) => {
		urls.push(String(url));
		return new Response(
			'Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,43200,v\nstop,1\nbus,1,43500,43500,G\nstop,2\nbus,1,43560,43560,G\n',
		);
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	globalThis.document = realDocument;
	setRenderer(() => {});
	setAfterRefresh(() => {});
	clearDepartureCache();
});

test('background refresh fetches the pinned stop only and keeps other cards in the same time frame', async (t) => {
	await refresh();
	const items = state.data.get(2)!.items;
	state.watch = { locId: 'home', goalId: '', pin: '1|1|43500', until: NOW + 90_000 };
	hidden = true;
	t.mock.timers.tick(20_000);
	await refresh();
	assert.ok(urls[1].endsWith('stopid=1'));
	assert.equal(state.data.size, 2);
	assert.equal(state.data.get(2)!.now, 43220);
	assert.equal(state.data.get(2)!.items, items);
	assert.equal(renders, 1, 'the hidden dashboard is not rebuilt');
	assert.equal(notices, 2, 'tracking still updates');
});

test('returning to the foreground refreshes all stops even after a recent narrow refresh', async (t) => {
	hidden = true;
	state.watch = { locId: 'home', goalId: '', pin: '1|1|43500', until: NOW + 90_000 };
	await refresh();
	hidden = false;
	t.mock.timers.tick(3000);
	await refreshIfDue();
	assert.equal(urls.length, 2);
	assert.ok(urls[1].includes('stopid=1,2'));
	await refreshIfDue();
	assert.equal(urls.length, 2, 'a quick repeated visibility event does not request again');
});

test('cold offline start uses the timetable and reports the unavailable live feed', async () => {
	globalThis.fetch = (async () => {
		throw new TypeError('offline');
	}) as typeof fetch;
	await refresh();
	assert.equal(state.loading, false);
	assert.equal(state.lastOk, false);
	assert.deepEqual([...state.planned], [1, 2]);
	assert.deepEqual([...state.failed], [1, 2]);
	assert.equal(state.data.get(1)?.items[0]?.expected, 43500);
	assert.equal(state.data.get(1)?.now, 43200);
});

test('an unavailable feed retains old live predictions; every refresh tries again', async (t) => {
	await refresh();
	const items = state.data.get(1)!.items;
	clearDepartureCache();
	globalThis.fetch = (async () => {
		urls.push('offline');
		throw new TypeError('offline');
	}) as typeof fetch;
	t.mock.timers.tick(20_000);
	await refresh();
	assert.equal(state.data.get(1)!.items, items);
	assert.equal(state.data.get(1)!.now, 43220);
	assert.equal(state.planned.size, 0);
	assert.equal(state.lastOk, false);
	t.mock.timers.tick(20_000);
	await refresh();
	assert.equal(urls.length, 3, 'the feed is asked again 20 s later: it may be back');
});

test('returning to the screen asks again unless the same stops were asked for a moment ago', async (t) => {
	await refresh();
	t.mock.timers.tick(9000);
	await refreshIfDue();
	assert.equal(urls.length, 1, '9 s after a refresh: what is on the screen is fresh enough');
	t.mock.timers.tick(1000);
	await refreshIfDue();
	assert.equal(urls.length, 2, '10 s after: asked again');
	state.cfg.locations[0].stops.pop();
	t.mock.timers.tick(3000);
	await refreshIfDue();
	assert.equal(urls.length, 3, 'other stops than last time: asked at once');
});

test('no stops left: nothing is asked for, and «no connection» does not stay on the screen', async () => {
	state.lastOk = false;
	state.cfg.locations[0].stops = [];
	await refresh();
	assert.equal(urls.length, 0);
	assert.equal(state.lastOk, true);
	assert.equal(notices, 1);
});

test('a hidden page without an active watch makes no request, but lets the watch expire', async () => {
	hidden = true;
	state.watch = { locId: 'home', goalId: '', pin: '1|1|43500', until: NOW - 1 };
	await refresh();
	assert.equal(urls.length, 0);
	assert.equal(notices, 1);
});
