import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
	batches,
	clearDepartureCache,
	fetchDepartures,
	MAX_STOPS_PER_REQUEST,
	parseStops,
} from './api.ts';

const HEADER =
	'Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,72403,version20201024';
const three = `${HEADER}
stop,1115
bus,33,72629,72635,Männiku,226,Z
trol,85,72703,72613,Mustamäe,300,
stop,888
bus,27,72557,72467,Laagri alevik,154,Z
stop,894
tram,4,72745,72619,Kopli,342,Z
boat,X,72800,72800,Aegna,397,Z
`;

test('parseStops: one block per stop, in one response', () => {
	const r = parseStops(three);
	assert.equal(r.now, 72403);
	assert.deepEqual([...r.byStop.keys()], [1115, 888, 894]);
	assert.deepEqual(
		r.byStop.get(1115)?.map((d) => [d.mode, d.route, d.expected, d.scheduled, d.dest]),
		[
			['bus', '33', 72629, 72635, 'Männiku'],
			['trol', '85', 72703, 72613, 'Mustamäe'],
		],
	);
	assert.deepEqual(
		r.byStop.get(894)?.map((d) => d.mode),
		['tram', 'other'],
	);
	assert.deepEqual(r.rest, []);
});

test('parseStops: broken lines are skipped, a broken header is an error', () => {
	const r = parseStops(`${HEADER}\r\nstop,7\r\nbus,1,abc,5,X\r\nbus,2\r\nbus,3,10,20,Y,1,Z\r\n`);
	assert.deepEqual(
		r.byStop.get(7)?.map((d) => d.route),
		['3'],
	);
	assert.throws(() => parseStops('ERROR: Stop id is not specified in request URL'));
	assert.throws(() => parseStops(''));
});

test('parseStops: departures without a stop line are kept apart; a stop without departures has no block', () => {
	const text = `${HEADER}\nbus,5,100,90,A,1,Z\nstop,9\nbus,6,200,190,B,1,Z\n`;
	const r = parseStops(text);
	assert.deepEqual(
		r.rest.map((d) => d.route),
		['5'],
	);
	assert.deepEqual(
		r.byStop.get(9)?.map((d) => d.route),
		['6'],
	);
	const empty = parseStops(`${HEADER}\n`);
	assert.equal(empty.now, 72403);
	assert.equal(empty.byStop.size, 0);
	assert.deepEqual(empty.rest, []);
});

test('batches: never more than the limit, as even as possible, nothing lost', () => {
	assert.ok(MAX_STOPS_PER_REQUEST <= 15, 'the feed answers with nothing for more than 15 stops');
	const sizes = (n: number) => batches(Array.from({ length: n }, (_, i) => i)).map((g) => g.length);
	assert.deepEqual(sizes(0), []);
	assert.deepEqual(sizes(1), [1]);
	assert.deepEqual(sizes(5), [5]);
	assert.deepEqual(sizes(6), [3, 3]);
	assert.deepEqual(sizes(8), [4, 4]);
	assert.deepEqual(sizes(11), [4, 3, 4]);
	for (let n = 0; n <= 40; n++) {
		const ids = Array.from({ length: n }, (_, i) => i * 7);
		const groups = batches(ids);
		assert.deepEqual(groups.flat(), ids);
		assert.ok(groups.every((g) => g.length >= 1 && g.length <= MAX_STOPS_PER_REQUEST));
		assert.equal(groups.length, Math.ceil(n / MAX_STOPS_PER_REQUEST));
	}
	assert.deepEqual(batches(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
});

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	clearDepartureCache();
});
/** replaces fetch with a canned answer and records what was asked */
function fakeFetch(body: string, status = 200): string[] {
	const urls: string[] = [];
	globalThis.fetch = (async (url: string | URL | Request) => {
		urls.push(String(url));
		return new Response(body, { status });
	}) as typeof fetch;
	return urls;
}

test('fetchDepartures: several stops in one request; a stop without departures gets an empty list', async () => {
	const urls = fakeFetch(three);
	const r = await fetchDepartures([888, 1115, 4242]);
	assert.equal(urls.length, 1);
	assert.ok(urls[0].endsWith('?stopid=888,1115,4242'));
	assert.deepEqual([...r.keys()], [888, 1115, 4242]);
	assert.equal(r.get(888)?.items.length, 1);
	assert.equal(r.get(1115)?.items.length, 2);
	assert.deepEqual(r.get(4242), { now: 72403, items: [] });
	assert.equal(r.has(894), false, 'not asked for');
});

test('fetchDepartures: a lone stop also gets the lines that came without a stop header', async () => {
	fakeFetch(`${HEADER}\nbus,5,100,90,A,1,Z\n`);
	assert.equal((await fetchDepartures([9])).get(9)?.items.length, 1);
	clearDepartureCache();
	fakeFetch(`${HEADER}\nbus,5,100,90,A,1,Z\n`);
	const two = await fetchDepartures([9, 10]);
	assert.deepEqual([two.get(9)?.items.length, two.get(10)?.items.length], [0, 0]);
});

test('fetchDepartures: an HTTP error or a broken answer rejects', async () => {
	fakeFetch('nope', 503);
	await assert.rejects(fetchDepartures([1]), /HTTP 503/);
	fakeFetch('<html>maintenance</html>');
	await assert.rejects(fetchDepartures([1]));
});

test('fetchDepartures: overlapping groups share pending stops and reuse recent answers with elapsed time', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
	const urls = fakeFetch(three);
	const [a, b] = await Promise.all([fetchDepartures([1115, 888]), fetchDepartures([888, 894])]);
	assert.equal(urls.length, 2);
	assert.ok(urls[1].endsWith('?stopid=894'));
	assert.deepEqual(a.get(888), b.get(888));
	t.mock.timers.tick(1500);
	assert.equal((await fetchDepartures([888])).get(888)?.now, 72404.5);
	assert.equal(urls.length, 2);
	t.mock.timers.tick(501);
	await fetchDepartures([888]);
	assert.equal(urls.length, 3);
	// the clock of the device is set back a minute: the answer just received must not live for a minute
	t.mock.timers.setTime(40_000);
	await fetchDepartures([888]);
	assert.equal(urls.length, 4);
});

test('fetchDepartures: queued groups never exceed three concurrent requests', async () => {
	const release: (() => void)[] = [];
	let active = 0;
	let peak = 0;
	globalThis.fetch = (async () => {
		active++;
		peak = Math.max(peak, active);
		await new Promise<void>((resolve) => release.push(resolve));
		active--;
		return new Response(HEADER);
	}) as typeof fetch;
	const result = fetchDepartures(Array.from({ length: 23 }, (_, i) => i + 1));
	for (let i = 0; i < 5; i++) {
		await new Promise<void>((resolve) => setImmediate(resolve));
		release.shift()!();
	}
	assert.equal((await result).size, 23);
	assert.equal(peak, 3);
});

test('fetchDepartures: a timeout releases the stop for retry and a failed answer is not cached', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	globalThis.fetch = (async (_url, init) =>
		new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
		})) as typeof fetch;
	const request = fetchDepartures([888]);
	const rejected = assert.rejects(request, /timed out/);
	t.mock.timers.tick(10_000);
	await rejected;
	fakeFetch(three);
	assert.equal((await fetchDepartures([888])).get(888)?.items.length, 1);
});

test('fetchDepartures: an independently aborted request does not cancel shared consumers', async () => {
	const controller = new AbortController();
	globalThis.fetch = (async (_url, init) =>
		new Promise<Response>((_resolve, reject) => {
			if (init?.signal?.aborted) reject(init.signal.reason);
			else
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
		})) as typeof fetch;
	const result = fetchDepartures([888], controller.signal);
	controller.abort();
	await assert.rejects(result, { name: 'AbortError' });
	fakeFetch(three);
	assert.equal((await fetchDepartures([888])).get(888)?.items.length, 1);
});
