import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Row } from './plan.ts';
import { pickRow, rowKey, watchNotice } from './watch.ts';

const mk = (route: string, sched: number, leaveInSec: number): Row => ({
	siriId: 1,
	dep: { mode: 'bus', route, expected: sched, scheduled: sched, dest: 'X' },
	stopName: 'S',
	inSec: leaveInSec + 300,
	leaveInSec,
	delaySec: 0,
	arrive: { sec: sched + 1320, travelSec: 1320, stopName: 'Mõisa' },
});

test('pickRow: only the pinned departure, none once it is gone', () => {
	const rows = [mk('42', 30600, 400), mk('41', 31200, 1000)];
	assert.equal(pickRow(rows, rowKey(rows[1]))?.dep.route, '41');
	assert.equal(pickRow(rows, 'gone'), undefined);
});

test('watchNotice text', () => {
	const n = watchNotice(mk('42', 30600, 420), 'Дом');
	assert.equal(n.title, 'Выходите в 08:25 (через 7 мин)');
	assert.match(n.body, /^42 → Mõisa · отправление 08:30 · прибытие 08:52\nДом$/);
	assert.equal(watchNotice(mk('42', 30600, 20), 'Дом').title, 'Выходите сейчас');
});

test('watchNotice without a goal: destination, no arrival', () => {
	const { arrive: _, ...noArrival } = mk('42', 30600, 420);
	const n = watchNotice(noArrival, 'Дом');
	assert.equal(n.title, 'Выходите в 08:25 (через 7 мин)');
	assert.equal(n.body, '42 → X · отправление 08:30\nДом');
});
