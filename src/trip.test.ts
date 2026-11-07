import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, findArrival, type RawGtfs } from './trip.ts';

// Monday 2026-11-09 12:00 Tallinn
const NOW = new Date('2026-11-09T10:00:00Z');

const raw: RawGtfs = {
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
const idx = buildIndex(raw);

test('finds arrival at goal stop', () => {
  const r = findArrival(idx, '41', 'A', 43200, new Set(['ROCCA1', 'ROCCA2']), NOW);
  assert.deepEqual(r, { toCode: 'ROCCA1', sec: 43200 + 900, headsign: 'Rocca' });
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
  assert.deepEqual(r, { toCode: 'ROCCA1', sec: 1800 + 900, headsign: 'Rocca' });
});

test('preferred goal stop later on the trip wins over an earlier goal stop', () => {
  const both = new Set(['ROCCA1', 'ROCCA2']);
  const plain = findArrival(idx, '41', 'A', 43200, both, NOW);
  assert.equal(plain?.toCode, 'ROCCA1');
  const pref = findArrival(idx, '41', 'A', 43200, both, NOW, new Set(['ROCCA2']));
  assert.deepEqual(pref, { toCode: 'ROCCA2', sec: 43200 + 960, headsign: 'Rocca' });
});

test('preferred stop not on the trip falls back to other goal stops', () => {
  const r = findArrival(idx, '41', 'A', 43200, new Set(['ROCCA1']), NOW, new Set(['NOWHERE']));
  assert.equal(r?.toCode, 'ROCCA1');
});
