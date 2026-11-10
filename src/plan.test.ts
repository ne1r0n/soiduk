import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDepartures } from './api.ts';
import { buildRows, fmtClock, fmtMinutes, type LocationCfg, leaveText } from './plan.ts';

const sample = `Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,55022,version20201024
stop,1000
bus,33,55048,54954,Kopli,26,Z
bus,18,55760,55750,Urda,738,Z
bus,33,57954,57954,Kopli,2932,Z
`;

test('parseDepartures', () => {
	const r = parseDepartures(sample);
	assert.equal(r.now, 55022);
	assert.equal(r.items.length, 3);
	assert.deepEqual(r.items[0], {
		mode: 'bus',
		route: '33',
		expected: 55048,
		scheduled: 54954,
		dest: 'Kopli',
	});
});

test('parseDepartures empty stop', () => {
	const r = parseDepartures(
		'Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,52859,version20201024\n',
	);
	assert.equal(r.items.length, 0);
});

test('buildRows filters by route, walk time and drops missed', () => {
	const loc: LocationCfg = {
		id: 'h',
		name: 'Дом',
		walkMin: 5,
		stops: [{ siriId: 1000, name: 'Test', routes: ['33'] }],
	};
	const data = new Map([[1000, parseDepartures(sample)]]);
	const rows = buildRows(loc, data);
	// first bus in 26s: leave in -274s => missed; second 33 in 2932s
	assert.equal(rows.length, 1);
	assert.equal(rows[0].inSec, 2932);
	assert.equal(rows[0].leaveInSec, 2932 - 300);
});

test('buildRows without a walk (at the stop) keeps everything that has not left yet', () => {
	const loc: LocationCfg = {
		id: 'h',
		name: 'Дом',
		walkMin: 0,
		stops: [{ siriId: 1000, name: 'Test', routes: ['33'] }],
	};
	const rows = buildRows(loc, new Map([[1000, parseDepartures(sample)]]));
	// the 33 in 26 s is too late to walk to, but not when you are standing at the stop
	assert.deepEqual(
		rows.map((r) => r.leaveInSec),
		[26, 2932],
	);
});

test('leaveText: when to leave home, or the countdown to the departure at the stop', () => {
	assert.equal(leaveText(20), 'выйти сейчас');
	assert.equal(leaveText(420), 'выйти через 7 мин');
	assert.equal(leaveText(20, true), 'сейчас');
	assert.equal(leaveText(420, true), 'через 7 мин');
});

test('formatting', () => {
	assert.equal(fmtClock(55048), '15:17');
	assert.equal(fmtClock(86400 + 60), '00:01');
	assert.equal(fmtMinutes(20), 'сейчас');
	assert.equal(fmtMinutes(600), '10 мин');
	assert.equal(fmtMinutes(3900), '1 ч 05 мин');
});
