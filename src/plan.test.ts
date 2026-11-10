import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStops, type StopDepartures } from './api.ts';
import { packGtfs } from './gtfsPack.ts';
import {
	ageArrivalCache,
	buildRows,
	clearArrivalCache,
	fmtClock,
	fmtMinutes,
	type GoalCfg,
	type LocationCfg,
	leaveText,
} from './plan.ts';
import { buildIndex } from './trip.ts';

const sample = `Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,55022,version20201024
stop,1000
bus,33,55048,54954,Kopli,26,Z
bus,18,55760,55750,Urda,738,Z
bus,33,57954,57954,Kopli,2932,Z
`;

/** the sample as the app holds it: the departures of stop 1000 */
function departures(): StopDepartures {
	const { now, byStop } = parseStops(sample);
	return { now, items: byStop.get(1000) ?? [] };
}

test('buildRows filters by route, walk time and drops missed', () => {
	const loc: LocationCfg = {
		id: 'h',
		name: 'Дом',
		walkMin: 5,
		stops: [{ siriId: 1000, name: 'Test', routes: ['33'] }],
	};
	const data = new Map([[1000, departures()]]);
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
	const rows = buildRows(loc, new Map([[1000, departures()]]));
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

test('timetable lookups survive a refresh; unused ones and those of another day are dropped', () => {
	// two timetables that disagree on the travel time: the answer tells whether it came from the cache
	const timetable = (travelSec: number) =>
		buildIndex(
			packGtfs({
				patterns: [{ r: '33', h: 'Kopli', s: ['A', 'G'], o: [0, travelSec] }],
				trips: [[0, 54954, 0]],
				services: [{ d: '1111111', a: '20200101', b: '20991231', x: [], y: [] }],
			}),
		);
	const [fast, slow] = [timetable(600), timetable(900)];
	const loc: LocationCfg = {
		id: 'h',
		name: 'Дом',
		walkMin: 0,
		stops: [{ siriId: 1000, code: 'A', name: 'Test', routes: [] }],
	};
	const goal: GoalCfg = { id: 'lookups', name: 'G', stops: [{ code: 'G', name: 'G' }] };
	const data = new Map([[1000, departures()]]);
	const travel = (idx: typeof fast) =>
		buildRows(loc, data, 0, 30, { goal, idx }).map((r) => r.arrive?.travelSec);
	const day = new Date('2026-11-09T10:00:00Z');
	const nextDay = new Date('2026-11-10T10:00:00Z');

	ageArrivalCache(day);
	assert.deepEqual(travel(fast), [600]);
	assert.deepEqual(travel(slow), [600], 'answered from the cache');
	ageArrivalCache(day); // a refresh: what is on screen stays
	assert.deepEqual(travel(slow), [600]);
	ageArrivalCache(day);
	ageArrivalCache(day); // not asked for during a whole refresh: forgotten
	assert.deepEqual(travel(slow), [900]);
	ageArrivalCache(nextDay); // another service day: everything is looked up again
	assert.deepEqual(travel(fast), [600]);
	clearArrivalCache(); // the settings or the timetable changed
	assert.deepEqual(travel(slow), [900]);
});
