import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropRedundantChanges, type Row } from './plan.ts';
import { findTransfer, makeNear } from './transfer.ts';
import { buildIndex, type RawGtfs } from './trip.ts';

// Monday 2026-11-09 12:00 Tallinn
const NOW = new Date('2026-11-09T10:00:00Z');
const H = 3600;

// 10: HOME -> X -> Y ; 20: X2 -> GOAL (X2 is a stop across the street from X); 30: Y -> GOAL
const raw: RawGtfs = {
	patterns: [
		{ r: '10', h: 'Y', s: ['HOME', 'X', 'Y'], o: [0, 600, 1200] },
		{ r: '20', h: 'Goal', s: ['X2', 'GOAL'], o: [0, 900] },
		{ r: '30', h: 'Goal', s: ['Y', 'GOAL'], o: [0, 300] },
	],
	trips: [
		[0, 12 * H, 0], // 10 leaves HOME 12:00, X 12:10, Y 12:20
		[1, 12 * H + 11 * 60, 0], // 20 leaves X2 12:11 – too tight after a walk
		[1, 12 * H + 20 * 60, 0], // 20 leaves X2 12:20
		[2, 12 * H + 30 * 60, 0], // 30 leaves Y 12:30, GOAL 12:35
	],
	services: [{ d: '0111110', a: '20260101', b: '20271231', x: [], y: [] }],
};
const idx = buildIndex(raw);
const goal = new Set(['GOAL']);
const noNear = () => [];
const nearX = (c: string) => (c === 'X' ? [{ code: 'X2', walkSec: 60 }] : []);

test('connection at the same stop: waits for the next vehicle', () => {
	const r = findTransfer(idx, '10', 'HOME', 12 * H, 0, goal, noNear, NOW);
	assert.equal(r?.route, '30');
	assert.equal(r?.viaCode, 'Y');
	assert.equal(r?.sec, 12 * H + 35 * 60);
});

test('walking to a neighbouring stop is considered as a boarding point', () => {
	const r = findTransfer(idx, '10', 'HOME', 12 * H, 0, goal, nearX, NOW);
	assert.equal(r?.route, '20');
	assert.equal(r?.boardCode, 'X2');
	assert.equal(r?.walkSec, 60);
	assert.equal(r?.depSec, 12 * H + 20 * 60);
	assert.equal(r?.sec, 12 * H + 35 * 60);
});

test('the first vehicle running late breaks a tight connection', () => {
	// 10 is 12 min late: reaches Y at 12:32, bus 30 (12:30) is gone, nothing else
	const r = findTransfer(idx, '10', 'HOME', 12 * H, 12 * 60, goal, noNear, NOW);
	assert.equal(r, null);
});

test('no connection when nothing reaches the goal', () => {
	assert.equal(findTransfer(idx, '10', 'HOME', 12 * H, 0, new Set(['NOWHERE']), noNear, NOW), null);
});

test('makeNear finds stops within the radius only', () => {
	const stops = [
		{ id: 'a', la: 59.4, lo: 24.7 },
		{ id: 'b', la: 59.4009, lo: 24.7 }, // ~100 m
		{ id: 'c', la: 59.41, lo: 24.7 }, // ~1.1 km
	];
	const d = (aLa: number, aLo: number, bLa: number, bLo: number) =>
		Math.hypot((aLa - bLa) * 111_000, (aLo - bLo) * 57_000);
	const near = makeNear(stops, d);
	assert.deepEqual(
		near('a').map((n) => n.code),
		['b'],
	);
	assert.equal(near('a')[0].walkSec, Math.round(near('a')[0].walkSec));
});

test('dropRedundantChanges keeps the latest first vehicle per second vehicle', () => {
	const via = { stopName: 'P', route: '41', mode: 'bus' as const, depSec: 100, walkSec: 0 };
	const mk = (leave: number, v = via): Row => ({
		siriId: 1,
		dep: { mode: 'bus', route: '8', expected: 0, scheduled: 0, dest: '' },
		stopName: 'S',
		inSec: leave,
		leaveInSec: leave,
		delaySec: 0,
		arrive: { sec: 1, travelSec: 1, stopName: 'G', via: v },
	});
	const rows = [mk(10), mk(20), mk(30, { ...via, depSec: 200 })];
	assert.deepEqual(
		dropRedundantChanges(rows).map((r) => r.leaveInSec),
		[20, 30],
	);
});

test('a change that leads away from the goal is skipped (viaOk)', () => {
	const r = findTransfer(
		idx,
		'10',
		'HOME',
		12 * H,
		0,
		goal,
		noNear,
		NOW,
		undefined,
		(c) => c !== 'Y',
	);
	assert.equal(r, null);
});

test('a goal stop within walking distance of the first ride: walk instead of changing', () => {
	const nearGoal = (c: string) => (c === 'Y' ? [{ code: 'GOAL', walkSec: 200 }] : []);
	const r = findTransfer(idx, '10', 'HOME', 12 * H, 0, goal, nearGoal, NOW);
	assert.equal(r?.walkOnly, true);
	assert.equal(r?.viaCode, 'Y');
	assert.equal(r?.toCode, 'GOAL');
	assert.equal(r?.sec, 12 * H + 20 * 60 + 200);
	assert.equal(r?.legs[1], null);
});

test('a long walk loses to the second ride', () => {
	const farGoal = (c: string) => (c === 'Y' ? [{ code: 'GOAL', walkSec: 1200 }] : []);
	const r = findTransfer(idx, '10', 'HOME', 12 * H, 0, goal, farGoal, NOW);
	assert.equal(r?.route, '30');
	assert.equal(r?.walkOnly, undefined);
});
