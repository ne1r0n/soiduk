import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type GtfsSource, packGtfs } from './gtfsPack.ts';
import {
	buildIndex,
	dayTimetable,
	findArrival,
	findBoarding,
	hourTable,
	positions,
	scheduledDepartures,
	stopOverview,
	tallinnDate,
	tallinnSec,
} from './trip.ts';

// Monday 2026-11-09 12:00 Tallinn
const NOW = new Date('2026-11-09T10:00:00Z');

const raw: GtfsSource = {
	patterns: [
		{ r: '41', h: 'Rocca', s: ['A', 'B', 'ROCCA1', 'ROCCA2'], o: [0, 300, 900, 960] },
		{ r: '41', h: 'Center', s: ['ROCCA2', 'B', 'A'], o: [0, 60, 600] },
	],
	trips: [
		[0, 43200, 0], // 12:00 weekday -> departs A 12:00
		[0, 45000, 0],
		[1, 43200, 0],
		[0, 86400 + 1800, 0], // 24:30 weekday trip, belongs to Monday service
	],
	services: [{ d: '0111110', a: '20260101', b: '20271231', x: [], y: ['20260110'] }],
};
const idx = buildIndex(packGtfs(raw));

test('finds arrival at goal stop', () => {
	const r = findArrival(idx, '41', 'A', 43200, new Set(['ROCCA1', 'ROCCA2']), NOW);
	assert.deepEqual(r, { toCode: 'ROCCA1', sec: 43200 + 900, headsign: 'Rocca', p: 0, i: 0, j: 2 });
});

test('wrong direction does not match goal', () => {
	const r = findArrival(idx, '41', 'B', 43200 + 60, new Set(['ROCCA1']), NOW);
	assert.equal(r, null); // trip from ROCCA2 goes toward A, never reaches ROCCA1
});

test('tolerates live schedule drift, rejects far times', () => {
	const near = findArrival(idx, '41', 'A', 43200 + 54, new Set(['ROCCA1']), NOW);
	assert.equal(near?.sec, 43200 + 54 + 900);
	assert.equal(findArrival(idx, '41', 'A', 43200 + 600, new Set(['ROCCA1']), NOW), null);
});

test('inactive service day returns null', () => {
	const sunday = new Date('2026-11-08T10:00:00Z');
	assert.equal(findArrival(idx, '41', 'A', 43200, new Set(['ROCCA1']), sunday), null);
});

test('after-midnight trip of previous service day', () => {
	// Tuesday 00:30 Tallinn = Monday service 24:30
	const tue = new Date('2026-11-09T22:40:00Z');
	const r = findArrival(idx, '41', 'A', 1800, new Set(['ROCCA1']), tue);
	assert.deepEqual(r, { toCode: 'ROCCA1', sec: 1800 + 900, headsign: 'Rocca', p: 0, i: 0, j: 2 });
});

test('preferred goal stop later on the trip wins over an earlier goal stop', () => {
	const both = new Set(['ROCCA1', 'ROCCA2']);
	const plain = findArrival(idx, '41', 'A', 43200, both, NOW);
	assert.equal(plain?.toCode, 'ROCCA1');
	const pref = findArrival(idx, '41', 'A', 43200, both, NOW, new Set(['ROCCA2']));
	assert.deepEqual(pref, {
		toCode: 'ROCCA2',
		sec: 43200 + 960,
		headsign: 'Rocca',
		p: 0,
		i: 0,
		j: 3,
	});
});

test('preferred stop not on the trip falls back to other goal stops', () => {
	const r = findArrival(idx, '41', 'A', 43200, new Set(['ROCCA1']), NOW, new Set(['NOWHERE']));
	assert.equal(r?.toCode, 'ROCCA1');
});

test('scheduledDepartures: weekday timetable within the window', () => {
	const r = scheduledDepartures(idx, 'A', 43000, NOW, 1000);
	assert.deepEqual(
		r.map((x) => [x.route, x.sec, x.headsign]),
		[['41', 43200, 'Rocca']],
	);
});

test('scheduledDepartures: nothing on a weekend (different calendar)', () => {
	const sunday = new Date('2026-11-08T10:00:00Z');
	assert.deepEqual(scheduledDepartures(idx, 'A', 43000, sunday, 3600), []);
});

test('scheduledDepartures: skips the last stop and carries after-midnight trips of the previous day', () => {
	assert.deepEqual(
		scheduledDepartures(idx, 'A', 43000, NOW, 3600).filter((x) => x.headsign === 'Center'),
		[],
	);
	const tue = new Date('2026-11-10T00:10:00+02:00');
	const r = scheduledDepartures(idx, 'A', 600, tue, 3600);
	assert.deepEqual(
		r.map((x) => x.sec),
		[1800],
	);
});

test('stopOverview: routes and destinations by timetable, terminus excluded', () => {
	assert.deepEqual(stopOverview(idx, 'A'), { routes: ['41'], dests: ['Rocca'] });
	assert.deepEqual(stopOverview(idx, 'ROCCA2'), { routes: ['41'], dests: ['Center'] });
	assert.deepEqual(stopOverview(idx, 'NOPE'), { routes: [], dests: [] });
});

test('dayTimetable: the weekday and weekend calendars give different days', () => {
	const mon = dayTimetable(idx, 'A', NOW).map((x) => x.sec);
	assert.deepEqual(mon, [43200, 45000, 86400 + 1800]);
	const sun = new Date('2026-11-08T10:00:00Z');
	assert.deepEqual(dayTimetable(idx, 'A', sun), []);
});

test('hourTable: groups by hour, after-midnight trips stay at the end, a route filter narrows', () => {
	const all = dayTimetable(idx, 'A', NOW);
	assert.deepEqual(
		hourTable(all).map((r) => [r.hour, r.items.map((x) => x.sec % 3600)]),
		[
			[12, [0, 1800]],
			[24, [1800]],
		],
	);
	assert.deepEqual(hourTable(all, '99'), []);
	assert.equal(hourTable(all, '41').length, 2);
});

test('tallinnSec: seconds since Tallinn midnight', () => {
	assert.equal(tallinnSec(new Date('2026-11-09T10:00:00Z')), 12 * 3600);
	assert.equal(tallinnSec(new Date('2026-07-09T10:00:00Z')), 13 * 3600);
});

test('tallinnDate: the calendar day in Tallinn, shifted by whole days', () => {
	// 2026-11-09 22:40 UTC is already Tuesday the 10th in Tallinn
	const late = new Date('2026-11-09T22:40:00Z');
	assert.deepEqual(tallinnDate(late), { ymd: '20261110', dow: 2 });
	assert.deepEqual(tallinnDate(late, -1), { ymd: '20261109', dow: 1 });
	assert.deepEqual(tallinnDate(new Date('2026-12-31T21:59:00Z'), 1), { ymd: '20270101', dow: 5 });
	assert.deepEqual(tallinnDate(new Date('2026-07-01T20:59:59Z')), { ymd: '20260701', dow: 3 });
});

test('findBoarding: the pattern of a live departure; the last stop cannot be boarded', () => {
	assert.deepEqual(findBoarding(idx, '41', 'B', 43200 + 300 + 40, NOW), { p: 0, i: 1 });
	assert.deepEqual(findBoarding(idx, '41', 'B', 43200 + 60, NOW), { p: 1, i: 1 });
	assert.equal(findBoarding(idx, '41', 'A', 43200 + 600, NOW), null, 'A is where pattern 1 ends');
	assert.equal(findBoarding(idx, '99', 'A', 43200, NOW), null);
});

test('positions: where a stop is inside the patterns of a route, in pattern order', () => {
	assert.deepEqual(positions(idx, '41', 'B'), [
		{ p: 0, i: 1 },
		{ p: 1, i: 1 },
	]);
	assert.deepEqual(positions(idx, '41', 'ROCCA1'), [{ p: 0, i: 2 }]);
	assert.deepEqual(positions(idx, '41', 'NOPE'), []);
	assert.deepEqual(positions(idx, '7', 'B'), []);
});
