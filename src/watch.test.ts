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

test('pickRow: nearest unless pinned departure is still catchable', () => {
	const rows = [mk('42', 30600, 400), mk('41', 31200, 1000)];
	assert.equal(pickRow(rows)?.dep.route, '42');
	assert.equal(pickRow(rows, rowKey(rows[1]))?.dep.route, '41');
	assert.equal(pickRow(rows, 'gone')?.dep.route, '42');
});

test('watchNotice text', () => {
	const n = watchNotice(mk('42', 30600, 420), 'Дом');
	assert.equal(n.title, 'Выходите в 08:25 (через 7 мин)');
	assert.match(n.body, /^42 → Mõisa · отправление 08:30 · прибытие 08:52\nДом$/);
	assert.equal(watchNotice(mk('42', 30600, 20), 'Дом').title, 'Выходите сейчас');
});
