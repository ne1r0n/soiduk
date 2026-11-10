import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type GtfsSource, packGtfs, packShapes, packStops } from './gtfsPack.ts';
import { decodeStops } from './stops.ts';
import { buildIndex, positions, stopsOf } from './trip.ts';

const services = [{ d: '0111110', a: '20260101', b: '20271231', x: [], y: [] }];

// two routes over the same street, a loop (the stop L is called at twice), trips given out of order
const src: GtfsSource = {
	patterns: [
		{ r: '1', m: 'tram', h: 'East', s: ['A', 'B', 'C'], o: [0, 60, 150] },
		{ r: '1', m: 'tram', h: 'East', s: ['A', 'B', 'C'], o: [0, 75, 180] }, // the same stops, slower
		{ r: '2', h: 'East', s: ['A', 'B', 'C'], o: [-30, 60, 150] }, // another route, no mode: a bus
		{ r: '1', m: 'tram', h: 'Loop', s: ['L', 'B', 'L'], o: [0, 100, 200] },
		{ r: '1', m: 'bus', h: 'East', s: ['A', 'B', 'C'], o: [0, 60, 150] }, // a bus numbered like the tram
	],
	trips: [
		[1, 30000, 0],
		[0, 28800, 0],
		[0, 25200, 0],
		[3, 40000, 0],
		[0, 28800, 0], // two trips at the same minute
		[2, 26000, 0],
	],
	services,
};

test('packGtfs: stop lists, routes and headsigns are written once; times as differences', () => {
	const raw = packGtfs(src);
	assert.equal(raw.v, 2);
	assert.deepEqual(raw.stops, ['A', 'B', 'C', 'L']);
	assert.deepEqual(raw.seqs, [
		[0, 1, 2],
		[3, 1, 3],
	]);
	assert.deepEqual(raw.routes, [
		['1', 'tram'],
		['2', 'bus'],
		['1', 'bus'],
	]);
	assert.deepEqual(raw.heads, ['East', 'Loop']);
	assert.deepEqual(raw.pats, [
		[0, 0, 0, [0, 60, 90], [25200, 0, 3600, 0, 0, 0]],
		[0, 0, 0, [0, 75, 105], [30000, 0]],
		[1, 0, 0, [-30, 90, 90], [26000, 0]],
		[0, 1, 1, [0, 100, 100], [40000, 0]],
		[2, 0, 0, [0, 60, 90], []],
	]);
	assert.equal(raw.services, services);
});

test('buildIndex gives back exactly what was packed', () => {
	const idx = buildIndex(packGtfs(src));
	assert.equal(idx.pats.length, src.patterns.length);
	src.patterns.forEach((pat, p) => {
		const got = idx.pats[p];
		assert.deepEqual(
			{ r: got.r, m: got.m, h: got.h, s: stopsOf(idx, p), o: got.o },
			{ r: pat.r, m: pat.m ?? 'bus', h: pat.h, s: pat.s, o: pat.o },
			`pattern ${p}`,
		);
		const trips = src.trips
			.filter((t) => t[0] === p)
			.map((t) => [t[1], t[2]])
			.sort((a, b) => a[0] - b[0])
			.flat();
		assert.deepEqual(got.t, trips, `trips of pattern ${p}`);
	});
	assert.deepEqual([...(idx.routesByStop.get('B') ?? [])], ['1', '2']);
	assert.deepEqual([...(idx.routesByStop.get('L') ?? [])], ['1']);
	// the tram and the bus numbered «1» are one route as far as lookups go; the loop calls at L twice
	assert.deepEqual(positions(idx, '1', 'B'), [
		{ p: 0, i: 1 },
		{ p: 1, i: 1 },
		{ p: 3, i: 1 },
		{ p: 4, i: 1 },
	]);
	assert.deepEqual(positions(idx, '1', 'L'), [
		{ p: 3, i: 0 },
		{ p: 3, i: 2 },
	]);
	assert.deepEqual(positions(idx, '2', 'A'), [{ p: 2, i: 0 }]);
});

test('packShapes: patterns that share a shape and stop positions share one entry', () => {
	const shapes = [
		[5943000, 2474000, 10, -5],
		[5940000, 2470000, 1, 1],
	];
	const raw = packShapes(shapes, [
		[0, [0, 0.5, 1]],
		null,
		[0, [0, 0.5, 1]],
		[1, [0, 1]],
		[0, [0, 1]],
	]);
	assert.equal(raw.shapes, shapes);
	assert.deepEqual(raw.refs, [
		[0, [0, 0.5, 1]],
		[1, [0, 1]],
		[0, [0, 1]],
	]);
	assert.deepEqual(raw.pat, [0, -1, 0, 1, 2]);
});

test('packStops / decodeStops: one column per property, nothing lost', () => {
	const list = [
		{ s: 1115, id: '07906-1', la: 59.4284, lo: 24.70343, n: 'Hipodroom', ar: 'Tallinn' },
		{ s: 1116, id: '07907-1', la: 59.42851, lo: 24.70402, n: 'Hipodroom', ar: 'Tallinn' },
		{ s: 13319, id: '21465-1', la: 59.21508, lo: 25.49078, n: 'Kreo', ar: '' },
	];
	const raw = packStops(list);
	assert.deepEqual(raw.names, ['Hipodroom', 'Kreo']);
	assert.deepEqual(raw.areas, ['Tallinn', '']);
	assert.deepEqual(raw.la, [5942840, 5942851, 5921508]);
	assert.deepEqual(raw.n, [0, 0, 1]);
	assert.deepEqual(decodeStops(raw), list);
});
